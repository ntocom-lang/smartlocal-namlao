// Supabase Edge Function: superadmin-advisor — ที่ปรึกษา AI เฉพาะ Super Admin (รอบ 2: Claude → Gemini จ่ายเงิน → Gemini ฟรี)
// Deploy (ต้องระบุชื่อเสมอ ห้ามรัน `supabase functions deploy` แบบไม่ระบุชื่อ — บอทเก่าจะกลับมา):
//   supabase functions deploy superadmin-advisor
// ต้องมีในฐานข้อมูลก่อน: migration 20261109130000 + 20261109130100 (ตาราง advisor_provider_slots + key ใน Vault)
// Secrets: GEMINI_API_KEY (สำรองของช่อง 3 Gemini ฟรีเมื่อไม่ได้ใส่ key ในหน้าตั้งค่า) · SUPABASE_URL / ANON / SERVICE_ROLE (มีให้เอง)
//   key ของช่อง 1–2 อยู่ใน Supabase Vault อ่านผ่าน RPC advisor_slot_key() ด้วย service_role เท่านั้น
//
// ── สิทธิ์ ─────────────────────────────────────────────────────────────────────────
// verify_jwt ของแพลตฟอร์มไม่พอ เพราะ anon key ก็เป็น JWT ที่อยู่ในบันเดิลสาธารณะ
// จึงตรวจเองทุกครั้ง: token ต้องเป็นผู้ใช้จริง (auth.getUser) และ profiles.role = 'superadmin' — ไม่ใช่ก็ 403 ก่อนแตะผู้ให้บริการ
//
// ── สลับช่องอัตโนมัติ (ตรรกะอยู่ _shared/advisorRouting.ts) ─────────────────────────────
// ลองตามลำดับช่อง ข้ามช่องที่ปิด/ไม่มี key/key ผิด/ถูกพัก/ครบเพดาน · ล้มแล้วพักช่องตามชนิด error แล้วไปช่องถัดไปในคำขอเดียวกัน
// ประทับพักด้วย UPDATE เฉพาะ paused_until/pause_reason/key_invalid_at (ห้าม upsert ทั้งแถว — ข้อตกลงกับ migration)
// เพดานต่อวันนับรายช่องจาก advisor_messages role = 'user' (จึงต้องเขียน slot ลงแถวคำถามด้วย)
//
// ── ข้อมูลที่ส่งออกนอกระบบ ───────────────────────────────────────────────────────
// ส่งเฉพาะสิ่งที่ผู้ใช้พิมพ์ + ประวัติของบทสนทนานั้น (อ่านจากฐาน ไม่เชื่อที่ client ส่งมา)
// + ภาพรวมระบบ (ตัวเลขรวมจาก RPC advisor_system_overview) เฉพาะคำถามที่ผู้ใช้ติ๊กแนบ — เก็บฉบับที่ส่งจริงใน context_snapshot
// ปิดบังเลขบัตร 13 หลัก/เบอร์โทรก่อนส่งทุกครั้ง แล้วเก็บฉบับที่ปิดบังแล้ว (= ของที่ออกไปจริง) เป็นบันทึกย้อนตรวจ
// ห้าม console.log เนื้อข้อความหรือ key — log ของ Edge Function ไม่ได้อยู่ใต้ RLS · key ส่งทาง header เท่านั้น

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk@1.6.0'
import {
  bangkokDayStartIso, buildContents, extractReply, HISTORY_LIMIT, maskPersonalData, MODEL_PATTERN, overviewBlock, systemPrompt, validateRequest,
} from '../_shared/advisorCore.ts'
import {
  classifyFailure, claudeSupportsFallbacks, extractClaudeReply, routeNote, slotLabel, slotSkipReason, slotTimeoutMs, toClaudeMessages,
  type Failure, type SlotRow,
} from '../_shared/advisorRouting.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
// คำตอบปรึกษายาวได้ แต่ต้องจบในงบเวลา — effort medium + 8000 token (ความเห็นเชิงวิชาชีพ ต้องวัดเวลาจริงหลัง deploy)
const CLAUDE_MAX_TOKENS = 8000
const CLAUDE_EFFORT = 'medium'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

type CallResult = { ok: true, text: string, truncated: boolean } | { ok: false, failure: Failure }
type History = { role: 'user' | 'model', content: string }[]

// ── Claude (SDK ทางการ) ─────────────────────────────────────────────────────────────
// maxRetries 0: การลองใหม่คือ "ไปช่องถัดไป" ของเราเอง ไม่ให้ SDK กินงบเวลาซ้ำ
// thinking: Opus 5.5 ปิดไม่ได้ (ไม่ส่ง = adaptive) คุมความลึกด้วย effort แทน
// fallbacks "default": ถ้าตัวกรองความปลอดภัยของ Anthropic ปฏิเสธ ให้ Anthropic ส่งต่อโมเดลที่แนะนำเองในคำขอเดียวกัน
async function callClaude(slot: SlotRow, apiKey: string, history: History, text: string, timeoutMs: number): Promise<CallResult> {
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: timeoutMs })
  try {
    const params: Record<string, unknown> = {
      model: slot.model,
      max_tokens: CLAUDE_MAX_TOKENS,
      system: systemPrompt(new Date()),
      messages: toClaudeMessages(history, text),
      output_config: { effort: CLAUDE_EFFORT },
    }
    const msg = claudeSupportsFallbacks(slot.model)
      // deno-lint-ignore no-explicit-any
      ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as any)
      // deno-lint-ignore no-explicit-any
      : await client.messages.create(params as any)
    const reply = extractClaudeReply(msg)
    if (!reply.ok) return { ok: false, failure: { kind: 'skip', label: reply.reason } }
    return reply
  } catch (error) {
    // ตรวจ timeout/เน็ตก่อน APIError — ใน SDK ฝั่ง TS APIConnectionError เป็นคลาสลูกของ APIError
    if (error instanceof Anthropic.APIConnectionError) {
      console.error('claude connection error', error.constructor.name)
      return { ok: false, failure: classifyFailure(slot, { status: 0 }, new Date()) }
    }
    if (error instanceof Anthropic.APIError) {
      // deno-lint-ignore no-explicit-any
      const e = error as any
      const errorType = e.type ?? e.error?.error?.type ?? null
      console.error('claude error', e.status, errorType)
      return { ok: false, failure: classifyFailure(slot, { status: e.status ?? 0, errorType, retryAfter: e.headers?.get?.('retry-after') ?? null }, new Date()) }
    }
    throw error
  }
}

// ── Gemini (REST — key ทาง header ไม่ต่อท้าย URL) ──────────────────────────────────────
async function callGemini(slot: SlotRow, apiKey: string, history: History, text: string, timeoutMs: number): Promise<CallResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${slot.model}:generateContent`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt() }] }, contents: buildContents(history, text) }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) {
      const detail = await res.json().catch(() => ({})) as { error?: { message?: string, status?: string } }
      console.error('gemini error', res.status, detail?.error?.status ?? '')
      return { ok: false, failure: classifyFailure(slot, { status: res.status, errorType: detail?.error?.status, message: detail?.error?.message }, new Date()) }
    }
    const reply = extractReply(await res.json())
    if (!reply.ok) return { ok: false, failure: { kind: 'skip', label: `${slotLabel(slot)}: ${reply.reason}` } }
    return { ok: true, text: reply.text, truncated: false }
  } catch (error) {
    const timeout = error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')
    console.error('gemini fetch failed', timeout ? 'timeout' : 'network')
    return { ok: false, failure: classifyFailure(slot, { status: 0 }, new Date()) }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405)
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: 'server configuration is incomplete' }, 500)
  }
  const startedAt = Date.now()

  try {
    // ── 1) ผู้เรียกต้องเป็น superadmin ──
    const authorization = req.headers.get('Authorization') ?? ''
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: authorization ? { Authorization: authorization } : {} },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: authData } = await authClient.auth.getUser()
    const callerId = authData.user?.id ?? null
    if (!callerId) return json({ ok: false, error: 'ต้องเข้าสู่ระบบก่อน' }, 401)

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: caller, error: callerErr } = await admin.from('profiles').select('role').eq('id', callerId).maybeSingle()
    if (callerErr) return json({ ok: false, error: 'ตรวจสิทธิ์ไม่สำเร็จ' }, 500)
    if (caller?.role !== 'superadmin') return json({ ok: false, error: 'เมนูนี้ใช้ได้เฉพาะ Super Admin' }, 403)

    // ── 2) ตรวจข้อความ ──
    let body: unknown = null
    try { body = await req.json() } catch { /* ตรวจต่อด้านล่าง */ }
    const input = validateRequest(body)
    if (!input.ok) return json({ ok: false, error: input.error }, 400)

    // ── 3) สวิตช์ปิดทั้งเมนู + ช่องผู้ให้บริการ + ยอดใช้วันนี้รายช่อง ──
    const { data: settings, error: settingsErr } = await admin.from('advisor_settings').select('enabled').eq('id', 1).maybeSingle()
    if (settingsErr || !settings) return json({ ok: false, error: 'ไม่พบการตั้งค่าที่ปรึกษา AI (ยังไม่ได้รัน migration?)' }, 500)
    if (!settings.enabled) return json({ ok: false, error: 'ที่ปรึกษา AI ปิดอยู่ — เปิดได้ที่แท็บตั้งค่า' }, 403)

    const { data: slotRows, error: slotErr } = await admin.from('advisor_provider_slots')
      .select('slot, provider, tier, enabled, model, daily_cap, key_last4, key_invalid_at, paused_until, pause_reason')
      .order('slot')
    if (slotErr || !slotRows?.length) return json({ ok: false, error: 'ไม่พบช่องผู้ให้บริการ (ยังไม่ได้รัน migration 20261109130000/130100?)' }, 500)
    const slots = slotRows as SlotRow[]

    const { data: todayRows, error: countErr } = await admin.from('advisor_messages')
      .select('slot').eq('role', 'user').gte('created_at', bangkokDayStartIso()).not('slot', 'is', null)
    if (countErr) return json({ ok: false, error: 'นับยอดใช้งานวันนี้ไม่สำเร็จ' }, 500)
    const usedBySlot = new Map<number, number>()
    for (const r of todayRows ?? []) usedBySlot.set(r.slot, (usedBySlot.get(r.slot) ?? 0) + 1)

    // ── 4) ประวัติของบทสนทนานี้ (เฉพาะของผู้เรียก) ──
    const { data: historyDesc, error: histErr } = await admin.from('advisor_messages')
      .select('role, content').eq('user_id', callerId).eq('conversation_id', input.conversationId)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(HISTORY_LIMIT)
    if (histErr) return json({ ok: false, error: 'อ่านประวัติบทสนทนาไม่สำเร็จ' }, 500)
    const history = (historyDesc ?? []).reverse() as History

    // ── 5) ปิดบังข้อมูลส่วนบุคคลก่อน แล้วไล่ช่องตามลำดับ ──
    const { text: safeText, masked } = maskPersonalData(input.message)
    // ติ๊กแนบแล้วดึงไม่ได้ = หยุด ไม่ส่งคำถามไปแบบไม่มีข้อมูลเงียบๆ (ผู้ใช้จะได้คำตอบที่คิดว่าอิงตัวเลขจริง)
    let overview: unknown = null
    let overviewMasked = 0
    if (input.overviewDays) {
      const { data: ov, error: ovErr } = await admin.rpc('advisor_system_overview', { p_days: input.overviewDays })
      if (ovErr || !ov) {
        console.error('advisor_system_overview failed', ovErr?.code ?? 'empty')
        return json({ ok: false, error: 'ดึงภาพรวมระบบไม่สำเร็จ (ยังไม่ได้รัน migration 20261109130200?) — เอาติ๊กออกแล้วถามใหม่ได้' }, 502)
      }
      // ตาข่ายอีกชั้นหลัง whitelist ใน RPC · เก็บฉบับที่ปิดบังแล้วลง context_snapshot ให้ตรงกับของที่ส่งออกจริง
      try {
        const om = maskPersonalData(JSON.stringify(ov))
        overview = JSON.parse(om.text)
        overviewMasked = om.masked // นับเข้า masked_count — บันทึกจะบอกได้ว่าตาข่ายชั้นสองเคยทำงาน (ปกติควรเป็น 0)
      } catch {
        return json({ ok: false, error: 'จัดเตรียมภาพรวมระบบไม่สำเร็จ — เอาติ๊กออกแล้วถามใหม่ได้' }, 502)
      }
    }
    const outgoing = overview ? safeText + overviewBlock(overview) : safeText
    const notes: string[] = []
    let answered: { slot: SlotRow, text: string, truncated: boolean } | null = null

    for (const slot of slots) {
      if (!MODEL_PATTERN.test(String(slot.model))) { notes.push(`${slotLabel(slot)}: ชื่อโมเดลไม่ถูกต้อง`); continue }
      const used = usedBySlot.get(slot.slot) ?? 0
      // ผ่านด่านอื่นก่อนแล้วค่อยถอดรหัส key (ไม่ถอด key ของช่องที่ไม่ได้ใช้)
      const preKey = slotSkipReason(slot, { now: new Date(), usedToday: used, hasKey: true })
      if (preKey) { notes.push(preKey); continue }
      let apiKey: string | null = null
      if (slot.key_last4) {
        const { data: k, error: kErr } = await admin.rpc('advisor_slot_key', { p_slot: slot.slot })
        if (kErr) { console.error('advisor_slot_key failed', slot.slot, kErr.code ?? ''); notes.push(`${slotLabel(slot)}: อ่าน key ไม่สำเร็จ`); continue }
        apiKey = typeof k === 'string' && k ? k : null
      } else if (slot.provider === 'gemini' && slot.tier === 'free') {
        apiKey = GEMINI_API_KEY ?? null // ช่องฟรีไม่ใส่ key = ใช้ key เดิมของระบบใน Secrets
      }
      if (!apiKey) { notes.push(slotSkipReason(slot, { now: new Date(), usedToday: used, hasKey: false }) as string); continue }

      const timeoutMs = slotTimeoutMs(startedAt, Date.now())
      if (timeoutMs == null) { notes.push(`${slotLabel(slot)}: ไม่ได้ลอง — เวลาของคำขอนี้ใกล้หมด`); break }

      const result = slot.provider === 'claude'
        ? await callClaude(slot, apiKey, history, outgoing, timeoutMs)
        : await callGemini(slot, apiKey, history, outgoing, timeoutMs)
      if (result.ok) { answered = { slot, text: result.text, truncated: result.truncated }; break }

      const f = result.failure
      notes.push(f.label)
      // ประทับเฉพาะคอลัมน์สถานะ — ประทับไม่สำเร็จก็ไปช่องถัดไปต่อ (แค่ครั้งหน้าจะลองช่องนี้ซ้ำ)
      if (f.kind === 'pause') {
        const { error } = await admin.from('advisor_provider_slots')
          .update({ paused_until: f.until.toISOString(), pause_reason: f.reason }).eq('slot', slot.slot)
        if (error) console.error('pause slot failed', slot.slot, error.code ?? '')
      } else if (f.kind === 'invalid_key' && slot.key_last4) {
        // key จาก Secrets (ช่องฟรีที่ไม่ได้ใส่ key) ไม่ประทับ — หน้าตั้งค่าล้างป้ายให้ไม่ได้ ต้องแก้ที่ Secrets
        const { error } = await admin.from('advisor_provider_slots')
          .update({ key_invalid_at: new Date().toISOString() }).eq('slot', slot.slot)
        if (error) console.error('flag invalid key failed', slot.slot, error.code ?? '')
      }
    }

    if (!answered) {
      return json({ ok: false, error: 'ไม่มีช่องผู้ให้บริการที่ตอบได้ตอนนี้', notes }, 503)
    }

    // ── 6) บันทึกทั้งคำถาม (ฉบับปิดบังแล้ว) และคำตอบ พร้อมช่องที่ตอบ + เหตุผลการสลับ ──
    //   แถวคำถามต้องมี slot ด้วย ไม่งั้นเพดานรายช่องนับได้ 0 ตลอด (ข้อตกลงกับ migration 20261109130100)
    const s = answered.slot
    const now = Date.now()
    const common = { conversation_id: input.conversationId, user_id: callerId, model: s.model, slot: s.slot, provider: s.provider, route_note: routeNote(notes) }
    const { error: insertErr } = await admin.from('advisor_messages').insert([
      { ...common, role: 'user', content: safeText, masked_count: masked + overviewMasked, context_snapshot: overview, created_at: new Date(now).toISOString() },
      { ...common, role: 'model', content: answered.text, created_at: new Date(now + 1).toISOString() },
    ])
    if (insertErr) console.error('advisor insert failed:', insertErr.code ?? '')

    return json({
      ok: true,
      reply: answered.text,
      truncated: answered.truncated,
      masked,
      overview_attached: Boolean(overview),
      answered_by: { slot: s.slot, provider: s.provider, tier: s.tier, model: s.model, label: slotLabel(s) },
      notes,
      used_today: (usedBySlot.get(s.slot) ?? 0) + 1,
      daily_cap: s.daily_cap,
      saved: !insertErr,
    })
  } catch (error) {
    console.error('superadmin-advisor failed:', error instanceof Error ? error.name : 'unknown')
    return json({ ok: false, error: 'ระบบขัดข้อง ลองใหม่อีกครั้ง' }, 500)
  }
})
