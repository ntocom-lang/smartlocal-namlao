// Supabase Edge Function: exec-nudge-notify — ห้องผู้บริหาร E3-2 "ส่งให้กองเร่งรัด"
// Deploy: npx --no-install supabase functions deploy exec-nudge-notify --project-ref umxssfahtuprnztlytdd
//   ใช้ verify_jwt ค่าเริ่มต้น (true) — ผู้เรียกคือผู้บริหารที่ล็อกอินอยู่ ไม่ใช่ cron ห้ามใส่ --no-verify-jwt
//   ⚠️ deploy จาก master หลัง merge เท่านั้น (deploy จากสาขาแล้วถูก session อื่นยิงทับเงียบๆ เคยเกิดแล้ว)
//   ⚠️ ต้อง apply migration 20261117100000/100100 ก่อน (exec_nudges + exec_nudge_payload) — รันฐานจริงแล้ว 2026-11-11
// Secrets: TELEGRAM_BOT_TOKEN (ตัวเดียวกับ notify-telegram ไม่ต้องตั้งใหม่)
//
// ลำดับ (หน้าเว็บเรียก RPC exec_nudge ได้ nudge_id แล้วเรียกฟังก์ชันนี้ต่อ):
//   1) ยืนยันตัวผู้เรียกจาก JWT
//   2) จองแถว: UPDATE exec_nudges SET delivery='sending' WHERE id AND delivery='pending' AND ผู้กดล่าสุด = ผู้เรียก
//      0 แถว = ไม่ใช่ของเรา/ส่งไปแล้ว/อีกแท็บกำลังส่ง → หยุด ไม่ส่งซ้ำ (กันดับเบิลคลิกส่ง Telegram ซ้ำ)
//   3) อ่าน exec_nudge_payload (service_role) — sendable=false / requester_is_head → ลงผล none ไม่ส่ง
//   4) DM ถึง ผอ.กองที่ผูก Telegram → ไม่มีใครรับได้ → กลุ่ม อปท. → ไม่มีกลุ่ม → none
//   5) เขียนผลกลับ WHERE delivery='sending' แล้วคืนผลให้หน้าเว็บแสดง ("ส่งไม่ถึงต้องบอก")
//   ฟังก์ชันตายกลางทาง → แถวค้าง sending · exec_nudge ยอมให้กดซ้ำเมื่อค้างเกิน 10 นาที
//
// PDPA: ข้อความประกอบจาก payload ที่ไม่มีชื่อคน/รายละเอียดเท่านั้น (ดู _shared/execNudge.ts)
//       ไม่อ่านตาราง complaints/document_requests เองเลย

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendTelegramMessage } from '../_shared/telegram.ts'
import {
  HEAD_ROLES, buildNudgeMessage, deliveryNote, groupReason, isUuid, note, skipReason,
  type Delivery, type NudgePayload,
} from '../_shared/execNudge.ts'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

type Outcome = { delivery: Delivery; delivered_count: number; note: string }

// เขียนผลเฉพาะแถวที่เราจองไว้ (delivery='sending') — แถวที่ถูกกดซ้ำหลัง 10 นาทีไปแล้วจะไม่ถูกทับ
async function finish(admin: SupabaseClient, nudgeId: string, outcome: Outcome) {
  const { error } = await admin.from('exec_nudges')
    .update({
      delivery: outcome.delivery,
      delivered_count: outcome.delivered_count,
      delivery_note: note(outcome.note) || null,
      delivered_at: outcome.delivery === 'dm' || outcome.delivery === 'group' ? new Date().toISOString() : null,
    })
    .eq('id', nudgeId)
    .eq('delivery', 'sending')
  if (error) console.error('[exec-nudge-notify] เขียนผลไม่สำเร็จ:', error.code, error.message)
}

async function deliver(admin: SupabaseClient, payload: NudgePayload): Promise<Outcome> {
  const skip = skipReason(payload)
  if (skip) return { delivery: 'none', delivered_count: 0, note: skip }

  const municipalityId = payload.nudge.municipality_id
  const { data: tenant, error: tenantError } = await admin.from('municipalities')
    .select('id, name, telegram_group_id, fee_schedule')
    .eq('id', municipalityId)
    .maybeSingle()
  if (tenantError || !tenant) throw new Error('อ่านข้อมูลหน่วยงานไม่สำเร็จ')
  if (!BOT_TOKEN) return { delivery: 'failed', delivered_count: 0, note: 'ระบบยังไม่ได้ตั้งค่าบอต Telegram' }

  const now = new Date()
  const base = { payload, tenantName: String(tenant.name ?? ''), feeSchedule: tenant.fee_schedule, now }

  // ตรวจซ้ำว่า heads เป็นบุคลากรของ อปท. เดียวกันและยังเป็นหัวหน้ากองที่ถือเรื่อง (payload คัดมาแล้ว — กันข้อมูลผิดพลาด)
  const headIds = (Array.isArray(payload.heads) ? payload.heads : []).filter(isUuid)
  let heads: string[] = []
  const links = new Map<string, string>()
  if (headIds.length > 0 && payload.department?.id) {
    const [people, linkRows] = await Promise.all([
      admin.from('profiles').select('id, role, municipality_id, department_id, is_dept_head').in('id', headIds),
      admin.from('telegram_user_links').select('user_id, chat_id').in('user_id', headIds),
    ])
    if (people.error || linkRows.error) throw new Error('อ่านรายชื่อหัวหน้ากองไม่สำเร็จ')
    heads = (people.data ?? [])
      .filter((p: Record<string, unknown>) => HEAD_ROLES.has(String(p.role))
        && p.municipality_id === municipalityId
        && p.department_id === payload.department!.id
        && p.is_dept_head === true)
      .map((p: Record<string, unknown>) => String(p.id))
    for (const row of (linkRows.data ?? []) as Record<string, unknown>[]) {
      if (heads.includes(String(row.user_id)) && row.chat_id != null) links.set(String(row.user_id), String(row.chat_id))
    }
  }

  // DM — ไม่เคารพ dm_muted (เจ้าของระบบตัดสิน: ผอ.กองปิดรับเร่งรัดไม่ได้)
  let dmSent = 0
  let dmFailed = 0
  if (links.size > 0) {
    const text = buildNudgeMessage({ ...base, audience: 'dm' })
    for (const [userId, chatId] of links) {
      const result = await sendTelegramMessage(chatId, text, BOT_TOKEN)
      if (result.ok) { dmSent += 1; continue }
      dmFailed += 1
      // 403 = ผู้ใช้บล็อกบอต/ลบแชท — เลิกผูกเอง (พฤติกรรมเดียวกับ notify-telegram) หน้าเว็บขึ้น "ยังไม่เชื่อม" ให้เชื่อมใหม่
      if (result.status === 403) {
        await admin.from('telegram_user_links').delete().eq('user_id', userId).eq('chat_id', chatId)
      }
    }
  }
  if (dmSent > 0) {
    return {
      delivery: 'dm', delivered_count: dmSent,
      note: deliveryNote({ delivery: 'dm', dmSent, headsTotal: heads.length }),
    }
  }

  // ตกมากลุ่ม อปท. (เจ้าของระบบเลือก 2026-11-11) — เรื่องอ่อนไหวไม่มาถึงจุดนี้ (skipReason ตัดไปแล้ว)
  if (tenant.telegram_group_id) {
    const reason = groupReason(heads.length, links.size)
    const text = buildNudgeMessage({ ...base, audience: 'group', groupReason: reason })
    const result = await sendTelegramMessage(String(tenant.telegram_group_id), text, BOT_TOKEN)
    if (result.ok) {
      return {
        delivery: 'group', delivered_count: 1,
        note: deliveryNote({ delivery: 'group', headsTotal: heads.length, linkedHeads: links.size, dmFailed }),
      }
    }
    return {
      delivery: 'failed', delivered_count: 0,
      note: `ส่ง Telegram ไม่สำเร็จ (${result.status || 'ต่อไม่ติด'}) — กดส่งซ้ำได้`,
    }
  }

  if (dmFailed > 0) {
    return { delivery: 'failed', delivered_count: 0, note: `ส่ง Telegram ส่วนตัวไม่สำเร็จ ${dmFailed} คน — กดส่งซ้ำได้` }
  }
  return {
    delivery: 'none', delivered_count: 0,
    note: `ไม่มีช่องทางส่ง: ${groupReason(heads.length, links.size)} และหน่วยงานยังไม่ได้ผูกกลุ่ม Telegram — โปรดแจ้งกองทางอื่น`,
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405)
  if (Number(req.headers.get('content-length') ?? 0) > 1024) return json({ ok: false, error: 'request too large' }, 413)
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: 'server configuration is incomplete' }, 500)
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const nudgeId = body.nudge_id
  if (!isUuid(nudgeId)) return json({ ok: false, error: 'invalid nudge_id' }, 400)

  const authorization = req.headers.get('Authorization') ?? ''
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: authorization ? { Authorization: authorization } : {} },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: authData } = await authClient.auth.getUser()
  const userId = authData.user?.id ?? null
  if (!isUuid(userId)) return json({ ok: false, error: 'unauthorized' }, 401)

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // จองแถว — ผู้กดล่าสุด = COALESCE(last_retry_by, nudged_by) ต้องเป็นผู้เรียก (userId ผ่าน isUuid แล้ว ใส่ในตัวกรองได้ปลอดภัย)
  const mine = `last_retry_by.eq.${userId},and(last_retry_by.is.null,nudged_by.eq.${userId})`
  const { data: claimed, error: claimError } = await admin.from('exec_nudges')
    .update({ delivery: 'sending' })
    .eq('id', nudgeId)
    .eq('delivery', 'pending')
    .or(mine)
    .select('id')
  if (claimError) return json({ ok: false, error: 'claim failed' }, 500)

  if (!claimed || claimed.length === 0) {
    // ไม่ได้จอง — ตอบสถานะปัจจุบันเฉพาะแถวของผู้เรียกเอง (ไม่ให้ไล่ดู nudge_id ของคนอื่น)
    const { data: current } = await admin.from('exec_nudges')
      .select('delivery, delivered_count, delivery_note')
      .eq('id', nudgeId)
      .or(mine)
      .maybeSingle()
    if (!current) return json({ ok: false, error: 'not found' }, 404)
    return json({
      ok: false, reason: current.delivery === 'sending' ? 'in_progress' : 'not_pending',
      delivery: current.delivery, delivered_count: current.delivered_count, note: current.delivery_note,
    }, 409)
  }

  let outcome: Outcome
  try {
    const { data, error } = await admin.rpc('exec_nudge_payload', { _nudge_id: nudgeId })
    if (error) throw new Error('อ่านข้อมูลเรื่องไม่สำเร็จ')
    const payload = data as NudgePayload | null
    // ด่านซ้อน: แถวที่จองต้องเป็นแถวเดียวกับ payload และผู้กดล่าสุดยังเป็นผู้เรียก
    if (payload && (payload.nudge?.id !== nudgeId || payload.nudge?.requested_by !== userId)) {
      outcome = { delivery: 'none', delivered_count: 0, note: 'ไม่ส่ง: ข้อมูลคำสั่งเร่งไม่ตรงกับผู้เรียก' }
    } else {
      outcome = await deliver(admin, payload as NudgePayload)
    }
  } catch (e) {
    console.error('[exec-nudge-notify]', (e as Error).message)
    outcome = { delivery: 'failed', delivered_count: 0, note: 'ระบบส่งขัดข้อง — กดส่งซ้ำได้' }
  }

  await finish(admin, nudgeId, outcome)
  return json({ ok: true, ...outcome })
})
