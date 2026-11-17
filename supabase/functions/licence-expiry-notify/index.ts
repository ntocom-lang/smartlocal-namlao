// Supabase Edge Function: licence-expiry-notify
// Deploy: npx --no-install supabase functions deploy licence-expiry-notify --no-verify-jwt --project-ref umxssfahtuprnztlytdd
//   ⚠️ ต้อง --no-verify-jwt: pg_cron ยิงมาโดยไม่มี JWT (ยืนยันตัวด้วยหัว x-cron-secret) ถ้าลืม cron จะได้ 401 จากเกตเวย์
//      ทุกเช้าแบบเงียบๆ (supabase/config.toml ไม่มีบล็อก [functions.*] ค่าเริ่มต้นจึงเป็น verify_jwt = true)
//   ⚠️ deploy จาก master หลัง merge เท่านั้น (deploy จากสาขาแล้วถูก session อื่นยิงทับเงียบๆ เคยเกิดแล้ว)
//   ⚠️ deploy ฟังก์ชัน "ก่อน" apply migration 20261208100200_licence_expiry_notify_cron.sql — ไม่งั้น cron ยิงไป 404 ทุกเช้า
// Secrets: TELEGRAM_BOT_TOKEN, CRON_SECRET (ชุดเดียวกับ fleet-doc-expiry-notify — vault 'fleet_cron_secret')
//
// ยิงโดย pg_cron (ดู migration 20261208100200_licence_expiry_notify_cron.sql): วันจันทร์–ศุกร์ 08:40 น. เวลาไทย
// เตือนกลุ่ม Telegram ของ อปท. ว่ามีใบอนุญาตใกล้หมดอายุ / หนังสือรับรองการแจ้งใกล้ครบกำหนดค่าธรรมเนียมรายปีกี่ใบ
// กติกาเตือน (หลักเตือน m*, ชนิดเอกสาร, คีย์กันส่งซ้ำ) อยู่ที่ _shared/licenceExpiryNotify.ts · ส่งเฉพาะ อปท. ที่เปิดโมดูล 'licence-registry'
// ไว้ชัดเจน (โมดูลนี้ค่าเริ่มต้นปิด enabled_modules ไม่ใช่ array = ไม่ส่ง)
//
// อ่านด้วย service_role (ข้าม RLS) เฉพาะช่องที่ต้องใช้นับ: รหัสใบ/ประเภท/วันหมดอายุ/วันครบกำหนด/สถานะ — ไม่อ่านชื่อร้าน ชื่อผู้ประกอบการ เลขใบ ที่อยู่
// ข้อความมีแต่ชื่อ อปท. และจำนวนใบ (PDPA: ลบย้อนหลังจาก Telegram ไม่ได้)
//
// body (ต้องมี cron secret ทุกแบบ):
//   {"dry_run": true}       คำนวณข้อความแล้วคืนให้ดู ไม่ claim ไม่ส่ง
//   {"only_slug": "demo"}   ทำเฉพาะ อปท. นี้ (ทดสอบบนสนามซ้อม) — ใช้คู่ dry_run ได้

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendTelegramMessage, cleanText } from '../_shared/telegram.ts'
import {
  JOB_NAME, NOTIFICATION_TYPE, addDays, buildMessage, dueLicences, effectiveRemindDays, moduleEnabled, safeEqual,
  todayBangkok, validSlug, type DocKind, type Due, type LicenceRow,
} from '../_shared/licenceExpiryNotify.ts'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const CRON_SECRET = Deno.env.get('CRON_SECRET')

// ไล่หน้าทีละ 1,000 (max_rows ของ PostgREST) แล้วเทียบยอดกับ count: 'exact' — NOTES ข้อ 14
// ได้ไม่ครบต้องหยุด ไม่งั้นใบที่หายกลายเป็น "ไม่ต้องเตือน" แบบเงียบๆ
const PAGE = 1000
const MAX_PAGES = 50
// เพดานการ claim ต่อ อปท. ต่อรอบ — ทะเบียนที่เพิ่งนำเข้าอาจมีใบหมดอายุค้างเป็นร้อย ส่วนที่เกินเพดานเข้ารอบวันทำการถัดไป (ยังไม่ถูก claim = ยังไม่หาย)
const MAX_CLAIMS_PER_TENANT = 500
const UPDATE_CHUNK = 50

type Tenant = { id: string; slug: string; name: string; telegram_group_id: string | number; enabled_modules: string[] | null }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// build(from, to, withCount) ต้องเรียงด้วยคีย์ที่ไม่ซ้ำ · หน้าแรกขอยอดนับ · เลื่อนตามจำนวนแถวที่ได้จริง ไม่ใช่ขนาดหน้าที่ขอ
// deno-lint-ignore no-explicit-any
async function fetchAll<T>(table: string, build: (from: number, to: number, withCount: boolean) => any): Promise<T[]> {
  const out: T[] = []
  let total: number | null = null
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error, count } = await build(out.length, out.length + PAGE - 1, page === 0)
    if (error) throw new Error(`${table}: ${cleanText(error.message, 200)}`)
    if (page === 0) {
      if (typeof count !== 'number') throw new Error(`${table} ไม่คืนยอดนับ — ตรวจไม่ได้ว่าได้ข้อมูลครบไหม`)
      total = count
    }
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length === 0 || out.length >= (total as number)) break
  }
  if (out.length !== total) throw new Error(`${table} ได้ ${out.length} จาก ${total} แถว — ข้อมูลไม่ครบ ไม่ส่งแจ้งเตือน`)
  return out
}

const withCountOpt = (on: boolean) => (on ? { count: 'exact' as const } : undefined)

// ลงสมุดลงเวลา (ต้นแบบ local-plan-monthly-reminder) — net._http_response เก็บผลแค่ ~6 ชม. สมุดนี้ไว้ไล่ย้อนว่ารอบไหนพังเพราะอะไร
// ⇒ ห้ามลงว่าสำเร็จถ้ามี อปท. ใดพัง · เขียนสมุดไม่สำเร็จแค่ log
async function recordHeartbeat(admin: SupabaseClient, outcome: { ok: true } | { ok: false; error: string }) {
  const at = new Date().toISOString()
  const row = outcome.ok
    ? { job_name: JOB_NAME, last_ok_at: at, updated_at: at }
    : { job_name: JOB_NAME, last_error_at: at, last_error: cleanText(outcome.error, 500), updated_at: at }
  const { error } = await admin.from('job_heartbeats').upsert(row, { onConflict: 'job_name' })
  if (error) console.error(`[${JOB_NAME}] ลงสมุดลงเวลาไม่สำเร็จ:`, error.code, error.message)
}

async function dueForTenant(admin: SupabaseClient, tenantId: string, today: string): Promise<Due[]> {
  const { data: settings, error: settingsError } = await admin.from('licence_settings')
    .select('remind_days').eq('municipality_id', tenantId).maybeSingle()
  if (settingsError) throw new Error(`licence_settings: ${cleanText(settingsError.message, 200)}`)
  const remindDays = effectiveRemindDays(settings?.remind_days)

  const { data: typeRows, error: typeError } = await admin.from('licence_types')
    .select('id, doc_kind').eq('municipality_id', tenantId)
  if (typeError) throw new Error(`licence_types: ${cleanText(typeError.message, 200)}`)
  const docKindByType: Record<string, DocKind> = {}
  for (const t of (typeRows ?? []) as { id: string; doc_kind: DocKind }[]) docKindByType[t.id] = t.doc_kind

  // ดึงเฉพาะใบที่วันเป้าหมายไม่เกินหลักเตือนแรก (วันนี้ + ค่าวันเตือนสูงสุด) — ใบหมดอายุไปแล้วก็เข้าเงื่อนไขนี้ (วันที่น้อยกว่า)
  const limit = addDays(today, Math.max(...remindDays))
  if (!limit) throw new Error('คำนวณวันที่เพดานไม่ได้')
  const licences = await fetchAll<LicenceRow>('licences', (from, to, c) => admin.from('licences')
    .select('id, municipality_id, licence_type_id, expires_on, next_fee_due_on, status', withCountOpt(c))
    .eq('municipality_id', tenantId).in('status', ['active', 'suspended'])
    .or(`expires_on.lte.${limit},next_fee_due_on.lte.${limit}`)
    .order('id').range(from, to))

  return dueLicences({ licences, docKindByType, remindDays, today })
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405)
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ ok: false, error: 'server not configured' }, 500)

  // ใช้ secret เฉพาะกิจ ไม่ใช้ service_role — secret รั่วแล้วทำได้แค่สั่งฟังก์ชันนี้ซ้ำ (ซึ่งกันส่งซ้ำต่อใบต่อหลักไว้แล้ว)
  if (!CRON_SECRET) return json({ ok: false, error: 'CRON_SECRET is not configured' }, 500)
  if (!safeEqual(req.headers.get('x-cron-secret') ?? '', CRON_SECRET)) return json({ ok: false, error: 'unauthorized' }, 401)

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const dryRun = body.dry_run === true
  const onlySlug = body.only_slug === undefined ? null : validSlug(body.only_slug)
  if (body.only_slug !== undefined && !onlySlug) return json({ ok: false, error: 'invalid only_slug' }, 400)
  if (!dryRun && !BOT_TOKEN) return json({ ok: false, error: 'TELEGRAM_BOT_TOKEN is not configured' }, 500)

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const today = todayBangkok(new Date())
  const summary = {
    municipalities: 0, sent: 0, failed: 0, alreadySent: 0, nothingDue: 0, moduleOff: 0, claimed: 0, deferred: 0, errors: [] as string[],
  }
  const previews: { slug: string; text: string }[] = []

  let query = admin.from('municipalities')
    .select('id, slug, name, telegram_group_id, enabled_modules')
    .eq('is_active', true)
    .not('telegram_group_id', 'is', null)
  if (onlySlug) query = query.eq('slug', onlySlug)
  const { data: tenantRows, error: tenantError } = await query
  // รอบทดสอบ (dry_run / only_slug) ไม่ลงสมุด — สมุดบอกสถานะของรอบเต็มที่ cron ยิงเท่านั้น
  const fullRun = !dryRun && !onlySlug
  if (tenantError) {
    if (fullRun) await recordHeartbeat(admin, { ok: false, error: `municipalities: ${tenantError.message}` })
    return json({ ok: false, error: cleanText(tenantError.message, 300) }, 500)
  }

  // อปท. ที่ไม่ได้ผูกกลุ่ม Telegram ไม่ใช่ error — ข้ามเงียบๆ
  const tenants = (tenantRows ?? []) as Tenant[]
  summary.municipalities = tenants.length

  for (const tenant of tenants) {
    // โมดูลนี้ค่าเริ่มต้นปิด: ต้องมีคีย์ 'licence-registry' ใน enabled_modules ชัดเจน (ไม่ใช่ array = ไม่ส่ง) — ไม่แจ้งเตือนของเมนูที่มองไม่เห็น
    if (!moduleEnabled(tenant.enabled_modules)) { summary.moduleOff += 1; continue }

    let due: Due[]
    try {
      due = await dueForTenant(admin, tenant.id, today)
    } catch (e) {
      summary.errors.push(`${tenant.slug}: ${cleanText((e as Error).message, 200)}`)
      continue
    }
    if (due.length === 0) { summary.nothingDue += 1; continue }

    if (dryRun) {
      const text = buildMessage({ tenantName: tenant.name, items: due })
      if (text) previews.push({ slug: tenant.slug, text })
      continue
    }

    // claim ต่อใบต่อหลัก ผ่าน unique constraint ของ notification_deliveries — ชน = หลักนี้ของใบนี้ส่งไปแล้ว
    // ยกเว้นแถวเดิมเป็น failed ให้ส่งใหม่ได้ (เรียกซ้ำหลัง Telegram ล่มต้องส่งได้ ไม่ใช่ถูกบล็อกถาวร)
    const claimed: Due[] = []
    for (const item of due) {
      if (claimed.length >= MAX_CLAIMS_PER_TENANT) { summary.deferred += 1; continue }
      const { error: claimError } = await admin.from('notification_deliveries').insert({
        municipality_id: tenant.id,
        channel: 'telegram',
        notification_type: NOTIFICATION_TYPE,
        resource_type: 'licence',
        resource_id: item.licenceId,
        idempotency_key: item.key,
        status: 'pending',
      })
      if (claimError) {
        if (claimError.code !== '23505') {
          summary.errors.push(`${tenant.slug}: claim ${claimError.code ?? ''} ${cleanText(claimError.message, 150)}`)
          continue
        }
        const { data: existing } = await admin.from('notification_deliveries')
          .select('status').eq('municipality_id', tenant.id).eq('channel', 'telegram')
          .eq('idempotency_key', item.key).maybeSingle()
        if (existing?.status !== 'failed') continue
      }
      claimed.push(item)
    }
    if (claimed.length === 0) { summary.alreadySent += 1; continue }
    summary.claimed += claimed.length

    // ส่ง 1 ข้อความต่อ อปท. จากใบที่เพิ่ง claim ได้ (ใบที่เคยแจ้งหลักนี้ไปแล้วไม่นับซ้ำ)
    const text = buildMessage({ tenantName: tenant.name, items: claimed }) as string
    const result = await sendTelegramMessage(String(tenant.telegram_group_id), text, BOT_TOKEN as string)
    if (result.ok) summary.sent += 1
    else summary.failed += 1

    const keys = claimed.map((c) => c.key)
    for (let i = 0; i < keys.length; i += UPDATE_CHUNK) {
      const { error: updateError } = await admin.from('notification_deliveries')
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
        .in('idempotency_key', keys.slice(i, i + UPDATE_CHUNK))
      if (updateError) summary.errors.push(`${tenant.slug}: บันทึกผลส่ง ${updateError.code ?? ''} ${cleanText(updateError.message, 150)}`)
    }
  }

  if (fullRun) {
    const problems = [...summary.errors, ...(summary.failed > 0 ? [`ส่ง Telegram ไม่สำเร็จ ${summary.failed} อปท.`] : [])]
    await recordHeartbeat(admin, problems.length === 0 ? { ok: true } : { ok: false, error: problems.join(' | ') })
  }

  return json({ ok: true, dry_run: dryRun, today, only_slug: onlySlug, summary, ...(dryRun ? { previews } : {}) })
})
