// Supabase Edge Function: local-plan-monthly-reminder
// Deploy: npx --no-install supabase functions deploy local-plan-monthly-reminder --no-verify-jwt --project-ref umxssfahtuprnztlytdd
//   ⚠️ ต้อง --no-verify-jwt: pg_cron ยิงมาโดยไม่มี JWT (ยืนยันตัวด้วยหัว x-cron-secret) ถ้าลืม cron จะได้ 401 จากเกตเวย์
//      ทุกเดือนแบบเงียบๆ (supabase/config.toml ไม่มีบล็อก [functions.*] ค่าเริ่มต้นจึงเป็น verify_jwt = true)
//   ⚠️ deploy จาก master หลัง merge เท่านั้น (deploy จากสาขาแล้วถูก session อื่นยิงทับเงียบๆ เคยเกิดแล้ว)
// Secrets: TELEGRAM_BOT_TOKEN, CRON_SECRET (ชุดเดียวกับ fleet-doc-expiry-notify — vault 'fleet_cron_secret')
//
// ยิงโดย pg_cron (ดู migration ..._local_plan_monthly_reminder_cron.sql): วันที่ 1 ของเดือน 08:45 น. เวลาไทย
// บอกกลุ่ม Telegram ของแต่ละ อปท. ว่าแผนการดำเนินงานปีงบนี้ยังมีรายการที่ถึงกำหนดแต่ยังไม่บันทึกผล กี่รายการ แยกกอง
// กติกา "ถึงกำหนด" อยู่ที่ _shared/localPlanMonthlyReminder.ts (dueKindOf) · ไม่มีรายการค้าง = ไม่ส่ง
//
// อ่านด้วย service_role (ข้าม RLS) เฉพาะช่องที่ต้องใช้นับ: รหัส/ฉบับ/กอง/เดือน/สถานะ — ไม่อ่านชื่อรายการ เหตุผล หมายเหตุ
// ข้อความมีแต่ชื่อ อปท. ชื่อกอง และจำนวน (PDPA: ลบย้อนหลังจาก Telegram ไม่ได้)
//
// body (ต้องมี cron secret ทุกแบบ):
//   {"dry_run": true}       คำนวณข้อความแล้วคืนให้ดู ไม่ claim ไม่ส่ง
//   {"only_slug": "demo"}   ทำเฉพาะ อปท. นี้ (ทดสอบบนสนามซ้อม) — ใช้คู่ dry_run ได้

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendTelegramMessage, cleanText } from '../_shared/telegram.ts'
import {
  NOTIFICATION_TYPE, buildDueMessage, countDueByDepartment, effectivePlans, idempotencyKey, previousMonthBangkok,
  safeEqual, validSlug, type Department, type OpItem, type OpPlan,
} from '../_shared/localPlanMonthlyReminder.ts'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const CRON_SECRET = Deno.env.get('CRON_SECRET')

const JOB_NAME = 'local-plan-monthly-reminder'
// ไล่หน้าทีละ 1,000 (max_rows ของ PostgREST) แล้วเทียบยอดกับ count: 'exact' — NOTES ข้อ 14
// ได้ไม่ครบต้องหยุด ไม่งั้นผลที่หายกลายเป็น "ยังไม่บันทึก" แล้วแจ้งเตือนเกินจริงเข้ากลุ่ม
const PAGE = 1000
const MAX_PAGES = 50

type Tenant = { id: string; slug: string; name: string; telegram_group_id: string | number }

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

// ลงสมุดลงเวลา (ต้นแบบ water-alert-notify) — net._http_response เก็บผลแค่ ~6 ชม. สมุดนี้ไว้ไล่ย้อนว่ารอบวันที่ 1 พังเพราะอะไร
// thaiwater-watchdog เฝ้าสมุดนี้ (WATCHED_JOBS เกณฑ์รายเดือน: พ้นวันที่ 1 เวลา 09:30 ต้องมี last_ok_at ของเดือนนั้น)
// ⇒ ห้ามลงว่าสำเร็จถ้ามี อปท. ใดพัง · เขียนสมุดไม่สำเร็จแค่ log
async function recordHeartbeat(admin: SupabaseClient, outcome: { ok: true } | { ok: false; error: string }) {
  const at = new Date().toISOString()
  const row = outcome.ok
    ? { job_name: JOB_NAME, last_ok_at: at, updated_at: at }
    : { job_name: JOB_NAME, last_error_at: at, last_error: cleanText(outcome.error, 500), updated_at: at }
  const { error } = await admin.from('job_heartbeats').upsert(row, { onConflict: 'job_name' })
  if (error) console.error(`[${JOB_NAME}] ลงสมุดลงเวลาไม่สำเร็จ:`, error.code, error.message)
}

async function countForTenant(admin: SupabaseClient, tenantId: string, fiscalYear: number, fiscalMonth: number) {
  const { data: planRows, error: planError } = await admin.from('local_op_plans')
    .select('id, fiscal_year, kind, revision_no, status')
    .eq('municipality_id', tenantId).eq('fiscal_year', fiscalYear)
  if (planError) throw new Error(cleanText(planError.message, 200))
  const opPlans = (planRows ?? []) as OpPlan[]
  const planIds = effectivePlans(opPlans, fiscalYear).map((p) => p.id)
  if (planIds.length === 0) return null   // ยังไม่มีฉบับประกาศของปีงบนี้ — ไม่มีอะไรให้ติดตาม

  const items = await fetchAll<OpItem>('local_op_plan_items', (from, to, c) => admin.from('local_op_plan_items')
    .select('id, op_plan_id, origin_item_id, department_id, dev_project_id, month_from, month_to, sort_order', withCountOpt(c))
    .eq('municipality_id', tenantId).in('op_plan_id', planIds).order('id').range(from, to))

  const progress = await fetchAll<{ lineage_id: string; status: string }>('local_op_item_progress', (from, to, c) => admin
    .from('local_op_item_progress')
    .select('lineage_id, status', withCountOpt(c))
    .eq('municipality_id', tenantId).eq('fiscal_year', fiscalYear).order('lineage_id').range(from, to))

  // เท่ากับ RPC local_plan_civil_stages(p_fiscal_year) ที่แท็บติดตามผลใช้: ปีงบเก็บเป็น text จึงเทียบหลัง trim
  // (RPC ใช้ไม่ได้ที่นี่ — มันตรวจ auth.uid() ของผู้เรียก)
  const civil = await fetchAll<{ registry_ref: string; fiscal_year: string | null }>('civil_projects', (from, to, c) => admin
    .from('civil_projects')
    .select('registry_ref, fiscal_year', withCountOpt(c))
    .eq('municipality_id', tenantId).not('registry_ref', 'is', null).order('id').range(from, to))

  const { data: deptRows, error: deptError } = await admin.from('departments')
    .select('id, name, sort_order').eq('municipality_id', tenantId)
  if (deptError) throw new Error(cleanText(deptError.message, 200))

  const progressByLineage: Record<string, string> = {}
  for (const p of progress) progressByLineage[p.lineage_id] = p.status
  const civilRefs = new Set(civil
    .filter((c) => String(c.fiscal_year ?? '').trim() === String(fiscalYear))
    .map((c) => String(c.registry_ref)))

  return countDueByDepartment({
    opPlans, items, fiscalYear, fiscalMonth, progressByLineage, civilRefs,
    departments: (deptRows ?? []) as Department[],
  })
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405)
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ ok: false, error: 'server not configured' }, 500)

  // ใช้ secret เฉพาะกิจ ไม่ใช้ service_role — secret รั่วแล้วทำได้แค่สั่งฟังก์ชันนี้ซ้ำ (ซึ่งกันส่งซ้ำรายเดือนไว้แล้ว)
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

  const month = previousMonthBangkok(new Date())
  const summary = {
    municipalities: 0, sent: 0, failed: 0, alreadySent: 0, noPlan: 0, nothingDue: 0, errors: [] as string[],
  }
  const previews: { slug: string; text: string }[] = []

  let query = admin.from('municipalities')
    .select('id, slug, name, telegram_group_id')
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

  // อปท. ที่ไม่ได้ผูกกลุ่ม Telegram ไม่ใช่ error — ข้ามเงียบๆ (เมนูแผนพัฒนาเปิดทุก อปท. ไม่มีคีย์ enabled_modules)
  const tenants = (tenantRows ?? []) as Tenant[]
  summary.municipalities = tenants.length

  for (const tenant of tenants) {
    let counts
    try {
      counts = await countForTenant(admin, tenant.id, month.fiscalYear, month.fiscalMonth)
    } catch (e) {
      summary.errors.push(`${tenant.slug}: ${cleanText((e as Error).message, 200)}`)
      continue
    }
    if (counts === null) { summary.noPlan += 1; continue }
    const text = buildDueMessage({ tenantName: tenant.name, month, counts })
    if (!text) { summary.nothingDue += 1; continue }

    if (dryRun) { previews.push({ slug: tenant.slug, text }); continue }

    // claim ผ่าน unique constraint ของ notification_deliveries — ชน = เดือนนี้ส่งไปแล้ว
    // ยกเว้นแถวเดิมเป็น failed ให้ส่งใหม่ได้ (เรียกซ้ำมือหลัง Telegram ล่มต้องส่งได้ ไม่ใช่ถูกบล็อกถาวร)
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

  if (fullRun) {
    const problems = [...summary.errors, ...(summary.failed > 0 ? [`ส่ง Telegram ไม่สำเร็จ ${summary.failed} อปท.`] : [])]
    await recordHeartbeat(admin, problems.length === 0 ? { ok: true } : { ok: false, error: problems.join(' | ') })
  }

  return json({
    ok: true, dry_run: dryRun, month: month.key, fiscal_year: month.fiscalYear, fiscal_month: month.fiscalMonth,
    only_slug: onlySlug, summary, ...(dryRun ? { previews } : {}),
  })
})
