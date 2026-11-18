// Supabase Edge Function: payment-account-alert — แจ้ง Telegram เมื่อบัญชีรับเงินของ อปท. เปลี่ยน (ขั้น 1C / E4 PR2)
// Deploy: npx --no-install supabase functions deploy payment-account-alert --no-verify-jwt --project-ref umxssfahtuprnztlytdd
//   ⚠️ ต้อง --no-verify-jwt: pg_cron ยิงมาโดยไม่มี JWT (ยืนยันตัวด้วยหัว x-cron-secret) ถ้าลืม cron จะได้ 401 เงียบๆ
//   ⚠️ deploy จาก master หลัง merge เท่านั้น · deploy "ก่อน" apply 20261212100200_payment_account_alert_cron.sql
// Secrets: TELEGRAM_BOT_TOKEN, CRON_SECRET (ชุดเดียวกับ licence-expiry-notify — vault 'fleet_cron_secret')
//
// ลำดับ: cron ยิง (เฉพาะตอนมีคิว) → payment_alert_claim (service_role จองคิว + ได้ข้อความที่ปิดเลขแล้ว + ผู้รับ)
//   → ส่งกลุ่ม อปท. + ส่วนตัวถึงผู้บริหาร/หัวหน้ากองคลังที่ผูก Telegram → payment_alert_finish (sent / failed / skipped)
//   ส่งถึงอย่างน้อย 1 ที่ = sent · ส่งไม่ถึงเลย = failed (ฐานให้ลองใหม่ทุก 10 นาที ไม่เกิน 6 ครั้ง)
//   ฟังก์ชันตายกลางทาง → คิวค้าง sending · ครบ 10 นาทีถูกจองใหม่ (อาจได้ข้อความซ้ำ 1 ครั้ง — ยอมรับ ดีกว่าไม่ได้)
// ไม่เคารพ dm_muted: กันแอบเปลี่ยนบัญชี ผู้บริหารปิดรับไม่ได้ (แบบเดียวกับ exec-nudge-notify)
// PDPA: ไม่มีข้อมูลประชาชน · chat id ไม่ลงคิว/ไม่ลง log

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendTelegramMessage, cleanText } from '../_shared/telegram.ts'
import {
  buildAccountAlertMessage, deliveryNote, outcome, safeEqual, type AlertPayload,
} from '../_shared/paymentAccountAlert.ts'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const CRON_SECRET = Deno.env.get('CRON_SECRET')

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405)
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !BOT_TOKEN) return json({ ok: false, error: 'server not configured' }, 500)
  if (!CRON_SECRET) return json({ ok: false, error: 'CRON_SECRET is not configured' }, 500)
  if (!safeEqual(req.headers.get('x-cron-secret') ?? '', CRON_SECRET)) return json({ ok: false, error: 'unauthorized' }, 401)

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await admin.rpc('payment_alert_claim', { p_limit: 20 })
  if (error) return json({ ok: false, error: cleanText(error.message, 300) }, 500)

  const items = (Array.isArray(data) ? data : []) as AlertPayload[]
  const summary = { claimed: items.length, sent: 0, failed: 0, skipped: 0, errors: [] as string[] }

  for (const item of items) {
    const text = buildAccountAlertMessage(item)
    let group: 'sent' | 'failed' | 'none' = 'none'
    let lastError = ''
    if (item.telegram_group_id) {
      const r = await sendTelegramMessage(String(item.telegram_group_id), text, BOT_TOKEN)
      group = r.ok ? 'sent' : 'failed'
      if (!r.ok) lastError = `กลุ่ม: ${r.error}`
    }
    const dmIds = Array.isArray(item.dm_chat_ids) ? [...new Set(item.dm_chat_ids.map(String))] : []
    let dmSent = 0
    for (const chatId of dmIds) {
      const r = await sendTelegramMessage(chatId, text, BOT_TOKEN)
      if (r.ok) dmSent += 1
      else lastError = lastError || `ส่วนตัว: ${r.error}`
    }
    const status = outcome(group, dmSent, dmIds.length)
    summary[status] += 1
    const { error: finishError } = await admin.rpc('payment_alert_finish', {
      p_event_id: item.event_id,
      p_status: status,
      p_note: status === 'skipped' ? 'ไม่มีกลุ่ม Telegram และไม่มีผู้บริหาร/หัวหน้ากองคลังที่ผูก Telegram' : deliveryNote(group, dmSent, dmIds.length),
      p_error: status === 'failed' ? cleanText(lastError, 400) : null,
    })
    if (finishError) summary.errors.push(`event ${item.event_id}: ${cleanText(finishError.message, 150)}`)
  }

  return json({ ok: summary.errors.length === 0, summary })
})
