// Supabase Edge Function: complaint-monthly-reminder
// Deploy: npx --no-install supabase functions deploy complaint-monthly-reminder --no-verify-jwt --project-ref umxssfahtuprnztlytdd
//   ⚠️ ต้อง --no-verify-jwt: pg_cron ยิงมาโดยไม่มี JWT (ยืนยันตัวด้วยหัว x-cron-secret) ถ้าลืม cron จะได้ 401 จากเกตเวย์
//      ทุกเดือนแบบเงียบๆ (supabase/config.toml ไม่มีบล็อก [functions.*] ค่าเริ่มต้นจึงเป็น verify_jwt = true)
// Secrets: TELEGRAM_BOT_TOKEN, CRON_SECRET (ชุดเดียวกับ fleet-doc-expiry-notify — vault 'fleet_cron_secret')
//
// ยิงโดย pg_cron เท่านั้น (ดู migration ..._complaint_monthly_reminder_cron.sql): วันที่ 1 ของเดือน 08:30 น. เวลาไทย
// บอกกลุ่ม Telegram ของแต่ละ อปท. ว่า "สรุปเรื่องร้องเรียนของเดือนที่แล้วพร้อมแล้ว" พร้อมลิงก์ไปหน้า
// /reports/complaints?m=YYYY-MM (ภาพสรุป + ปุ่มดาวน์โหลด/แชร์) — เจ้าหน้าที่กดแชร์เอง ระบบไม่โพสต์ออกสาธารณะ
//
// ข้อความมีแต่ยอดรวม (complaint_stats_fy ของเดือนนั้น) ไม่แตะตารางคำร้องตรงๆ จึงไม่มีทางหยิบชื่อ/เบอร์/ที่อยู่ไปใส่
// รับ body {"dry_run": true} (ต้องมี cron secret เหมือนกัน): คำนวณข้อความของทุก อปท. แล้วคืนให้ดู ไม่ claim ไม่ส่ง

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendTelegramMessage, cleanText } from '../_shared/telegram.ts'
import {
  NOTIFICATION_TYPE, buildReminderMessage, idempotencyKey, moduleOn, previousMonthBangkok, reportUrl, safeEqual,
} from '../_shared/complaintMonthlyReminder.ts'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const CRON_SECRET = Deno.env.get('CRON_SECRET')

type Tenant = {
  id: string
  slug: string
  name: string
  telegram_group_id: string | number
  enabled_modules: string[] | null
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405)
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ ok: false, error: 'server not configured' }, 500)

  // เหตุผลเดียวกับ fleet-doc-expiry-notify: ใช้ secret เฉพาะกิจ ไม่ใช้ service_role — secret รั่วแล้วทำได้แค่สั่งฟังก์ชันนี้ซ้ำ
  if (!CRON_SECRET) return json({ ok: false, error: 'CRON_SECRET is not configured' }, 500)
  if (!safeEqual(req.headers.get('x-cron-secret') ?? '', CRON_SECRET)) return json({ ok: false, error: 'unauthorized' }, 401)

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const dryRun = body.dry_run === true
  if (!dryRun && !BOT_TOKEN) return json({ ok: false, error: 'TELEGRAM_BOT_TOKEN is not configured' }, 500)

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const month = previousMonthBangkok(new Date())
  const summary = {
    municipalities: 0, sent: 0, failed: 0, alreadySent: 0, emptyMonth: 0, badSlug: 0, errors: [] as string[],
  }
  const previews: { slug: string; total: number; text: string }[] = []

  const { data: tenantRows, error: tenantError } = await admin
    .from('municipalities')
    .select('id, slug, name, telegram_group_id, enabled_modules')
    .eq('is_active', true)
    .not('telegram_group_id', 'is', null)
  if (tenantError) return json({ ok: false, error: cleanText(tenantError.message, 300) }, 500)

  // อปท. ที่ไม่ได้ผูกกลุ่ม Telegram หรือปิดโมดูลเรื่องร้องเรียน ไม่ใช่ error — ข้ามเงียบๆ
  const tenants = ((tenantRows ?? []) as Tenant[]).filter((t) => moduleOn(t.enabled_modules))
  summary.municipalities = tenants.length

  for (const tenant of tenants) {
    const { data: stats, error: statsError } = await admin.rpc('complaint_stats_fy', {
      _municipality_id: tenant.id, _from: month.from, _to: month.to,
    })
    if (statsError) {
      summary.errors.push(`${tenant.slug}: ${cleanText(statsError.message, 200)}`)
      continue
    }
    const total = Number((stats as Record<string, unknown> | null)?.total ?? 0)
    // เดือนที่ไม่มีเรื่องเลยไม่ต้องแจ้งว่า "พร้อมแล้ว" — ไม่มีอะไรให้แชร์
    if (!Number.isFinite(total) || total <= 0) { summary.emptyMonth += 1; continue }

    const url = reportUrl(tenant.slug, month.key)
    if (!url) { summary.badSlug += 1; continue }
    const text = buildReminderMessage({ tenantName: tenant.name, month, total, url })

    if (dryRun) { previews.push({ slug: tenant.slug, total, text }); continue }

    // claim ผ่าน unique constraint ของ notification_deliveries — ชน = เดือนนี้ส่งไปแล้ว
    // ยกเว้นแถวเดิมเป็น failed ให้ส่งใหม่ได้ (เรียกฟังก์ชันซ้ำมือหลัง Telegram ล่มต้องส่งได้ ไม่ใช่ถูกบล็อกถาวร)
    const key = idempotencyKey(month.key)
    const { error: claimError } = await admin.from('notification_deliveries').insert({
      municipality_id: tenant.id,
      channel: 'telegram',
      notification_type: NOTIFICATION_TYPE,
      resource_type: 'municipality',
      resource_id: tenant.id,
      idempotency_key: key,
      status: 'pending',
    })
    if (claimError) {
      if (claimError.code !== '23505') {
        summary.errors.push(`${tenant.slug}: claim ${claimError.code ?? ''} ${cleanText(claimError.message, 150)}`)
        continue
      }
      const { data: existing } = await admin.from('notification_deliveries')
        .select('status').eq('municipality_id', tenant.id).eq('channel', 'telegram')
        .eq('idempotency_key', key).maybeSingle()
      if (existing?.status !== 'failed') { summary.alreadySent += 1; continue }
    }

    const result = await sendTelegramMessage(String(tenant.telegram_group_id), text, BOT_TOKEN as string)
    if (result.ok) summary.sent += 1
    else summary.failed += 1
    await admin.from('notification_deliveries')
      .update({
        status: result.ok ? 'sent' : 'failed',
        attempt_count: result.attempts,
        sent_at: result.ok ? new Date().toISOString() : null,
        provider_message_id: result.ok ? String(result.messageId ?? '') : null,
        last_error: result.ok ? null : result.error,
        updated_at: new Date().toISOString(),
      })
      .eq('municipality_id', tenant.id)
      .eq('channel', 'telegram')
      .eq('idempotency_key', key)
  }

  return json({ ok: true, dry_run: dryRun, month: month.key, summary, ...(dryRun ? { previews } : {}) })
})
