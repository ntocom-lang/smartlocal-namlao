// Supabase Edge Function: fleet-doc-expiry-notify
// Deploy: supabase functions deploy fleet-doc-expiry-notify
// Secret required: TELEGRAM_BOT_TOKEN (shared with notify-telegram)
//
// Invoked ONLY by the daily pg_cron job (see migration
// ..._fleet_doc_expiry_cron.sql), never by client code — there is no
// end-user JWT here, so auth is a shared x-cron-secret header check
// (see CRON_SECRET below), not a user/service-role bearer token.
// Sweeps every municipality's fleet_vehicles for the 4 expiry-date
// columns and sends a Telegram alert at fixed day-out milestones
// (30/14/7/3/1/0), then weekly (every 7 days) while overdue.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendTelegramMessage, escapeHtml, cleanText } from '../_shared/telegram.ts'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const CRON_SECRET = Deno.env.get('CRON_SECRET')

const MILESTONE_DAYS = new Set([30, 14, 7, 3, 1, 0])

const DOC_FIELDS: { field: string; label: string }[] = [
  { field: 'insurance_expiry', label: 'ประกันภัย' },
  { field: 'act_expiry', label: 'พรบ.' },
  { field: 'registration_expiry', label: 'ภาษี/ทะเบียน' },
  { field: 'inspection_expiry', label: 'ตรวจสภาพ' },
]

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// วันนี้ตามเวลาไทย (Asia/Bangkok) ไม่ใช่ UTC ของเซิร์ฟเวอร์ — กัน off-by-one
// ตอนเที่ยงคืนถึงตี 7 ที่ UTC วันก่อนหน้ายังเป็น "วันนี้" ของไทยอยู่
function todayBangkok(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }) // YYYY-MM-DD
}

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime()
  const b = new Date(`${to}T00:00:00Z`).getTime()
  return Math.round((b - a) / 86_400_000)
}

function shouldNotify(daysLeft: number): boolean {
  if (MILESTONE_DAYS.has(daysLeft)) return true
  return daysLeft < 0 && daysLeft % 7 === 0
}

function urgencyIcon(daysLeft: number): string {
  if (daysLeft < 0) return '🔴 หมดอายุแล้ว'
  if (daysLeft <= 7) return '🟠'
  return '🟡'
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405)

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: 'server not configured' }, 500)
  }

  // ยอมรับเฉพาะเรียกด้วย secret เฉพาะกิจ (x-cron-secret) จาก pg_cron/pg_net เท่านั้น
  // ตั้งใจไม่ใช้ service_role key ตรงนี้ — ถ้า secret รั่ว ผลกระทบจำกัดแค่
  // เรียกฟังก์ชันนี้ซ้ำได้ ไม่ใช่สิทธิ์เข้าถึงฐานข้อมูลแบบเต็ม
  if (!CRON_SECRET) {
    return json({ ok: false, error: 'CRON_SECRET is not configured' }, 500)
  }
  const cronSecret = req.headers.get('x-cron-secret') ?? ''
  if (cronSecret !== CRON_SECRET) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }
  if (!BOT_TOKEN) {
    return json({ ok: false, error: 'TELEGRAM_BOT_TOKEN is not configured' }, 500)
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const today = todayBangkok()
  const summary = { municipalities: 0, vehiclesChecked: 0, alertsMatched: 0, messagesSent: 0, messagesFailed: 0 }

  // หมายเหตุ: 'fleet' ไม่ได้อยู่ใน managedKeys ของ enabled_modules (ดู
  // src/pages/StaffDashboard.jsx) จึง "เปิดใช้งานเสมอ" ไม่มี flag ให้เช็ก —
  // กรองแค่ municipality ที่ตั้ง telegram_group_id ไว้ แล้วปล่อยให้ query
  // fleet_vehicles ด้านล่างเป็นตัวกรองจริง (อปท. ที่ไม่ได้ใช้ fleet จะไม่มีคันรถ)
  const { data: municipalities, error: muniError } = await admin
    .from('municipalities')
    .select('id, name, telegram_group_id')
    .not('telegram_group_id', 'is', null)
  if (muniError) return json({ ok: false, error: cleanText(muniError.message, 300) }, 500)

  summary.municipalities = (municipalities ?? []).length

  for (const municipality of municipalities ?? []) {
    const { data: vehicles, error: vehError } = await admin
      .from('fleet_vehicles')
      .select('id, name, license_plate, insurance_expiry, act_expiry, registration_expiry, inspection_expiry')
      .eq('municipality_id', municipality.id)
      .neq('status', 'retired')
    if (vehError || !vehicles) continue

    for (const vehicle of vehicles) {
      summary.vehiclesChecked += 1
      const alerts = DOC_FIELDS
        .map(({ field, label }) => {
          const expiry = vehicle[field as keyof typeof vehicle] as string | null
          if (!expiry) return null
          const daysLeft = daysBetween(today, expiry)
          if (!shouldNotify(daysLeft)) return null
          return { field, label, expiry, daysLeft }
        })
        .filter((v): v is { field: string; label: string; expiry: string; daysLeft: number } => v !== null)
      if (alerts.length === 0) continue
      summary.alertsMatched += alerts.length

      // กันแจ้งซ้ำ: claim แต่ละ (คัน+เอกสาร+วันหมดอายุ+milestone) ผ่าน unique
      // constraint ของ notification_deliveries — ถ้า insert ชนแปลว่าแจ้งไปแล้ว
      const claimed: typeof alerts = []
      for (const alert of alerts) {
        const idempotencyKey = `fleet_doc_expiry:${vehicle.id}:${alert.field}:${alert.expiry}:${alert.daysLeft}`
        const { error: claimError } = await admin.from('notification_deliveries').insert({
          municipality_id: municipality.id,
          channel: 'telegram',
          notification_type: 'fleet_document_expiring',
          resource_type: 'fleet_vehicle',
          resource_id: vehicle.id,
          idempotency_key: idempotencyKey,
          status: 'pending',
        })
        // unique_violation (23505) = แจ้ง milestone นี้ไปแล้ว ข้ามได้เลย
        if (!claimError) claimed.push(alert)
      }
      if (claimed.length === 0) continue

      const lines = [
        '📋 <b>เอกสารยานพาหนะใกล้/หมดอายุ</b>',
        `🚗 ${escapeHtml(vehicle.name, 120)}${vehicle.license_plate ? ` (${escapeHtml(vehicle.license_plate, 30)})` : ''}`,
        ...claimed.map((a) => {
          const dateLabel = escapeHtml(a.expiry, 10)
          if (a.daysLeft < 0) return `${urgencyIcon(a.daysLeft)} ${escapeHtml(a.label, 40)} — หมดอายุตั้งแต่ ${dateLabel} (เกิน ${Math.abs(a.daysLeft)} วัน)`
          if (a.daysLeft === 0) return `${urgencyIcon(a.daysLeft)} ${escapeHtml(a.label, 40)} — หมดอายุ<b>วันนี้</b> (${dateLabel})`
          return `${urgencyIcon(a.daysLeft)} ${escapeHtml(a.label, 40)} — เหลือ ${a.daysLeft} วัน (${dateLabel})`
        }),
      ].join('\n').slice(0, 1800)

      const result = await sendTelegramMessage(String(municipality.telegram_group_id), lines, BOT_TOKEN)
      const status = result.ok ? 'sent' : 'failed'
      if (result.ok) summary.messagesSent += 1
      else summary.messagesFailed += 1

      for (const alert of claimed) {
        const idempotencyKey = `fleet_doc_expiry:${vehicle.id}:${alert.field}:${alert.expiry}:${alert.daysLeft}`
        await admin.from('notification_deliveries')
          .update({
            status,
            attempt_count: result.attempts,
            sent_at: result.ok ? new Date().toISOString() : null,
            provider_message_id: result.ok ? String(result.messageId ?? '') : null,
            last_error: result.ok ? null : result.error,
            updated_at: new Date().toISOString(),
          })
          .eq('municipality_id', municipality.id)
          .eq('channel', 'telegram')
          .eq('idempotency_key', idempotencyKey)
      }
    }
  }

  return json({ ok: true, date: today, summary })
})
