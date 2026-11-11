// Supabase Edge Function: exec-digest-notify — ห้องผู้บริหาร E3-3 "สรุปเช้า" + "แจ้งคะแนนประเมินคำร้อง ≤ 2"
// Deploy: npx --no-install supabase functions deploy exec-digest-notify --no-verify-jwt --project-ref umxssfahtuprnztlytdd
//   ⚠️ ต้อง --no-verify-jwt: pg_cron ยิงมาโดยไม่มี JWT (ยืนยันตัวด้วยหัว x-cron-secret) ถ้าลืม cron จะได้ 401 จากเกตเวย์
//      ทุกเช้าแบบเงียบๆ (supabase/config.toml ไม่มีบล็อก [functions.*] ค่าเริ่มต้นจึงเป็น verify_jwt = true)
//   ⚠️ deploy จาก master หลัง merge เท่านั้น (deploy จากสาขาแล้วถูก session อื่นยิงทับเงียบๆ เคยเกิดแล้ว)
//   ⚠️ deploy "ก่อน" apply migration 20261118100200 (cron) ไม่งั้น cron ยิงไป 404 ทุกเช้า
// Secrets: TELEGRAM_BOT_TOKEN, CRON_SECRET (ชุดเดียวกับ fleet-doc-expiry-notify — vault 'fleet_cron_secret')
//
// ยิงโดย pg_cron (migration 20261118100200):
//   {"mode":"digest"}      07:30 น. จันทร์–ศุกร์ เวลาไทย — สรุปเช้าถึงผู้บริหารทาง Telegram ส่วนตัว (วันหยุดราชการข้ามเอง)
//   {"mode":"low_rating"}  ทุก 30 นาที 08:00–17:30 น. จันทร์–ศุกร์ — คะแนนคำร้อง ≤ 2 ที่ยังไม่ได้แจ้ง (ฉบับรวมต่อผู้รับ)
// ผู้รับ/เนื้อหามาจาก RPC ของ service_role ทั้งหมด (exec_digest_recipients / exec_digest_for / exec_digest_ack / exec_low_ratings_pending)
//   ฟังก์ชันนี้ไม่อ่านตาราง complaints/document_requests/satisfaction_ratings เอง — ข้อความมีแต่ตัวเลข/เลขที่/หมวด/กอง/สถานะ/วันที่
//   (PDPA: ลบย้อนหลังจาก Telegram ไม่ได้) · ตรรกะสร้างข้อความอยู่ที่ _shared/execDigest.ts
//
// body (ต้องมี cron secret ทุกแบบ):
//   {"mode":"digest"|"low_rating"}   บังคับ
//   "dry_run": true                  คำนวณข้อความแล้วคืนให้ดู ไม่ claim ไม่ส่ง ไม่ ack ไม่ลงสมุด
//   "only_slug": "demo"              ทำเฉพาะ อปท. นี้ (ทดสอบบนสนามซ้อม)
//   "only_user": "<uuid>"            ทำเฉพาะผู้รับคนนี้
//   "ignore_working_day": true       ไม่สนวันหยุด — ใช้ได้เฉพาะคู่ only_slug (ทดสอบบน demo นอกวันทำการ)
//
// กันส่งซ้ำ: notification_deliveries (channel 'telegram_dm') — key สรุปเช้าต่อวันต่อคน · key คะแนนต่ำต่อคะแนนต่อคน
//   ชน = ส่งไปแล้ว ข้าม · แถวเดิม failed = ส่งใหม่ได้ · แถวค้าง pending (ฟังก์ชันตายกลางทาง) นับเป็น "ส่งแล้ว" ไม่ส่งซ้ำ
//   (เลือกพลาดทางเงียบดีกว่าทักผู้บริหารซ้ำ — ตรวจย้อนได้จากแถว pending ที่ค้างเกิน 10 นาที)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendTelegramMessage, cleanText } from '../_shared/telegram.ts'
import { isUuid } from '../_shared/execNudge.ts'
import { safeEqual, validSlug } from '../_shared/localPlanMonthlyReminder.ts'
import {
  DIGEST_JOB, DIGEST_NOTIFICATION_TYPE, LOW_RATING_JOB, LOW_RATING_NOTIFICATION_TYPE,
  buildDigestMessage, buildLowRatingMessage, digestKey, isEmptyDigest, lowRatingKey, readDigest, readLowRatings,
  type LowRating,
} from '../_shared/execDigest.ts'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const CRON_SECRET = Deno.env.get('CRON_SECRET')

const CHANNEL = 'telegram_dm'
const LOW_RATING_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000

type Recipient = {
  municipality_id: string
  slug: string
  municipality_name: string
  user_id: string
  chat_id: number | string
  is_working_day: boolean
}

type Summary = {
  recipients: number; sent: number; failed: number; alreadySent: number
  empty: number; notEligible: number; holiday: number; errors: string[]
}

type Preview = { slug: string; user_id: string; text: string }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// ห้ามใส่ chat_id / ชื่อคน ลง log และ error — มีแต่รหัสภายในกับข้อความผิดพลาดที่ตัดแล้ว
const errText = (e: unknown, max = 200) => cleanText(e instanceof Error ? e.message : (e as { message?: unknown })?.message ?? e, max)

// สมุดลงเวลา — thaiwater-watchdog / ผู้ดูแลไล่ย้อนได้ว่ารอบไหนพังเพราะอะไร · เขียนไม่สำเร็จแค่ log
async function recordHeartbeat(admin: SupabaseClient, job: string, outcome: { ok: true } | { ok: false; error: string }) {
  const at = new Date().toISOString()
  const row = outcome.ok
    ? { job_name: job, last_ok_at: at, updated_at: at }
    : { job_name: job, last_error_at: at, last_error: cleanText(outcome.error, 500), updated_at: at }
  const { error } = await admin.from('job_heartbeats').upsert(row, { onConflict: 'job_name' })
  if (error) console.error(`[${job}] ลงสมุดลงเวลาไม่สำเร็จ:`, error.code, error.message)
}

type Claim = { kind: 'claimed' } | { kind: 'already' } | { kind: 'error'; error: string }

/**
 * จองสิทธิ์ส่งผ่าน unique (municipality_id, channel, idempotency_key)
 * ชน 23505 → แถวเดิม failed = พลิกกลับเป็น pending แล้วส่งใหม่ (เงื่อนไข status='failed' ในคำสั่งเดียว — สองรอบแย่งกัน มีรอบเดียวที่ได้)
 *           แถวเดิมสถานะอื่น = ส่งแล้ว/กำลังส่ง ข้าม
 */
async function claim(admin: SupabaseClient, row: {
  municipality_id: string; notification_type: string; resource_id: string; idempotency_key: string
}): Promise<Claim> {
  const { error } = await admin.from('notification_deliveries').insert({
    municipality_id: row.municipality_id,
    channel: CHANNEL,
    notification_type: row.notification_type,
    resource_type: row.notification_type === DIGEST_NOTIFICATION_TYPE ? 'profile' : 'satisfaction_rating',
    resource_id: row.resource_id,
    idempotency_key: row.idempotency_key,
    status: 'pending',
  })
  if (!error) return { kind: 'claimed' }
  if (error.code !== '23505') return { kind: 'error', error: `claim ${error.code ?? ''} ${errText(error, 150)}` }

  const { data, error: retryError } = await admin.from('notification_deliveries')
    .update({ status: 'pending', last_error: null, updated_at: new Date().toISOString() })
    .eq('municipality_id', row.municipality_id).eq('channel', CHANNEL)
    .eq('idempotency_key', row.idempotency_key).eq('status', 'failed')
    .select('id')
  if (retryError) return { kind: 'error', error: `claim-retry ${retryError.code ?? ''} ${errText(retryError, 150)}` }
  return (data ?? []).length > 0 ? { kind: 'claimed' } : { kind: 'already' }
}

type SendResult = Awaited<ReturnType<typeof sendTelegramMessage>>

async function finishClaims(admin: SupabaseClient, municipalityId: string, keys: string[], result: SendResult) {
  if (keys.length === 0) return
  const { error } = await admin.from('notification_deliveries')
    .update({
      status: result.ok ? 'sent' : 'failed',
      attempt_count: result.attempts,
      sent_at: result.ok ? new Date().toISOString() : null,
      provider_message_id: result.ok ? String(result.messageId ?? '') : null,
      last_error: result.ok ? null : cleanText(result.error, 300),
      updated_at: new Date().toISOString(),
    })
    .eq('municipality_id', municipalityId).eq('channel', CHANNEL).in('idempotency_key', keys)
  // แถวค้าง pending = รอบหน้าไม่ส่งซ้ำ (ส่งไปแล้วจริงแต่จดไม่ได้) — ต้องให้เห็นใน log
  if (error) console.error('[exec-digest-notify] เขียนผลส่งไม่สำเร็จ:', error.code, errText(error, 150))
}

// 403 = ผู้ใช้บล็อกบอต/ลบแชท — เลิกผูกเอง (พฤติกรรมเดียวกับ notify-telegram) หน้าเว็บขึ้น "ยังไม่เชื่อม" ให้เชื่อมใหม่ได้
async function unlinkIfBlocked(admin: SupabaseClient, r: Recipient, result: SendResult) {
  if (result.ok || result.status !== 403) return
  const { error } = await admin.from('telegram_user_links').delete().eq('user_id', r.user_id).eq('chat_id', r.chat_id)
  if (error) console.error('[exec-digest-notify] เลิกผูก Telegram ไม่สำเร็จ:', error.code, errText(error, 150))
}

const newSummary = (): Summary => ({
  recipients: 0, sent: 0, failed: 0, alreadySent: 0, empty: 0, notEligible: 0, holiday: 0, errors: [],
})

type Options = { dryRun: boolean; onlySlug: string | null; onlyUser: string | null; ignoreWorkingDay: boolean }

async function loadRecipients(admin: SupabaseClient, category: 'exec_digest' | 'exec_alert', opt: Options): Promise<Recipient[]> {
  const { data, error } = await admin.rpc('exec_digest_recipients', { _category: category })
  if (error) throw new Error(`exec_digest_recipients: ${errText(error, 200)}`)
  return ((data ?? []) as Recipient[])
    .filter((r) => isUuid(r.user_id) && isUuid(r.municipality_id) && r.chat_id != null)
    .filter((r) => !opt.onlySlug || r.slug === opt.onlySlug)
    .filter((r) => !opt.onlyUser || r.user_id === opt.onlyUser)
}

// ───────────────────────── โหมดสรุปเช้า ─────────────────────────

async function runDigest(admin: SupabaseClient, opt: Options, summary: Summary, previews: Preview[]) {
  const recipients = await loadRecipients(admin, 'exec_digest', opt)
  summary.recipients = recipients.length
  const feeByTenant = new Map<string, unknown>()

  for (const r of recipients) {
    try {
      if (!r.is_working_day && !opt.ignoreWorkingDay) { summary.holiday += 1; continue }

      const { data, error } = await admin.rpc('exec_digest_for', { _user_id: r.user_id, _municipality_id: r.municipality_id })
      if (error) { summary.errors.push(`${r.slug}: exec_digest_for ${errText(error, 150)}`); continue }
      const raw = (data ?? {}) as Record<string, unknown>
      if (raw.ok === false) { summary.notEligible += 1; continue }
      const digest = readDigest(raw)
      if (!digest) { summary.errors.push(`${r.slug}: ผลสรุปเช้ารูปแบบไม่ถูกต้อง`); continue }
      if (isEmptyDigest(digest)) { summary.empty += 1; continue }

      // ชื่อประเภทคำขอที่ อปท. เพิ่มเอง (fee_schedule._custom_types) — อ่านครั้งเดียวต่อ อปท.
      if (!feeByTenant.has(r.municipality_id)) {
        const { data: tenant, error: tenantError } = await admin.from('municipalities')
          .select('fee_schedule').eq('id', r.municipality_id).maybeSingle()
        if (tenantError) throw new Error(`municipalities: ${errText(tenantError, 150)}`)
        feeByTenant.set(r.municipality_id, tenant?.fee_schedule ?? null)
      }
      const text = buildDigestMessage({
        digest, tenantName: r.municipality_name, feeSchedule: feeByTenant.get(r.municipality_id),
      })

      if (opt.dryRun) { previews.push({ slug: r.slug, user_id: r.user_id, text }); continue }

      const key = digestKey(digest.asOf, r.user_id)
      const c = await claim(admin, {
        municipality_id: r.municipality_id, notification_type: DIGEST_NOTIFICATION_TYPE, resource_id: r.user_id, idempotency_key: key,
      })
      if (c.kind === 'error') { summary.errors.push(`${r.slug}: ${c.error}`); continue }
      if (c.kind === 'already') { summary.alreadySent += 1; continue }

      const result = await sendTelegramMessage(String(r.chat_id), text, BOT_TOKEN as string)
      await finishClaims(admin, r.municipality_id, [key], result)
      if (!result.ok) {
        summary.failed += 1
        await unlinkIfBlocked(admin, r, result)
        continue
      }
      summary.sent += 1

      // จดสถานะที่แจ้งไปแล้ว + เลิกติดตามเรื่องที่เสร็จ — หลังส่งสำเร็จเท่านั้น (ส่งพลาด พรุ่งนี้แจ้งซ้ำ ไม่หาย)
      // ack ล้ม = ข้อความไปถึงแล้ว แต่พรุ่งนี้อาจแจ้งเรื่องเดิมซ้ำ → นับเป็น error ให้เห็นในสมุด ไม่ throw
      const ack = Array.isArray(raw.ack) ? raw.ack : []
      if (ack.length > 0) {
        const { error: ackError } = await admin.rpc('exec_digest_ack', {
          _user_id: r.user_id, _municipality_id: r.municipality_id, _items: ack,
        })
        if (ackError) {
          console.error('[exec-digest-notify] ack ไม่สำเร็จ:', ackError.code, errText(ackError, 150))
          summary.errors.push(`${r.slug}: exec_digest_ack ${errText(ackError, 150)}`)
        }
      }
    } catch (e) {
      summary.errors.push(`${r.slug}: ${errText(e, 200)}`)
    }
  }
}

// ───────────────────────── โหมดแจ้งคะแนนต่ำ ─────────────────────────

async function runLowRating(admin: SupabaseClient, opt: Options, summary: Summary, previews: Preview[]) {
  const since = new Date(Date.now() - LOW_RATING_LOOKBACK_MS).toISOString()
  const { data, error } = await admin.rpc('exec_low_ratings_pending', { _since: since })
  if (error) throw new Error(`exec_low_ratings_pending: ${errText(error, 200)}`)
  const ratings = readLowRatings(data)

  const recipients = await loadRecipients(admin, 'exec_alert', opt)
  summary.recipients = recipients.length

  const byTenant = new Map<string, { ratingId: string; value: LowRating }[]>()
  for (const x of ratings) {
    const list = byTenant.get(x.municipalityId) ?? []
    list.push({ ratingId: x.ratingId, value: x.value })
    byTenant.set(x.municipalityId, list)
  }

  for (const r of recipients) {
    try {
      if (!r.is_working_day && !opt.ignoreWorkingDay) { summary.holiday += 1; continue }
      const pending = byTenant.get(r.municipality_id) ?? []
      if (pending.length === 0) { summary.empty += 1; continue }

      if (opt.dryRun) {
        previews.push({
          slug: r.slug, user_id: r.user_id,
          text: buildLowRatingMessage({ ratings: pending.map((p) => p.value), tenantName: r.municipality_name }),
        })
        continue
      }

      // จองทีละคะแนน — คะแนนที่คนนี้ได้แจ้งไปแล้ว (รอบก่อน) ไม่ขึ้นซ้ำ
      const mine: { key: string; value: LowRating }[] = []
      for (const p of pending) {
        const key = lowRatingKey(p.ratingId, r.user_id)
        const c = await claim(admin, {
          municipality_id: r.municipality_id, notification_type: LOW_RATING_NOTIFICATION_TYPE,
          resource_id: p.ratingId, idempotency_key: key,
        })
        if (c.kind === 'claimed') mine.push({ key, value: p.value })
        else if (c.kind === 'error') summary.errors.push(`${r.slug}: ${c.error}`)
      }
      if (mine.length === 0) { summary.alreadySent += 1; continue }

      const text = buildLowRatingMessage({ ratings: mine.map((m) => m.value), tenantName: r.municipality_name })
      const result = await sendTelegramMessage(String(r.chat_id), text, BOT_TOKEN as string)
      await finishClaims(admin, r.municipality_id, mine.map((m) => m.key), result)
      if (result.ok) summary.sent += 1
      else {
        summary.failed += 1
        await unlinkIfBlocked(admin, r, result)
      }
    } catch (e) {
      summary.errors.push(`${r.slug}: ${errText(e, 200)}`)
    }
  }
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405)
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ ok: false, error: 'server not configured' }, 500)

  // ใช้ secret เฉพาะกิจ ไม่ใช้ service_role — secret รั่วแล้วทำได้แค่สั่งฟังก์ชันนี้ซ้ำ (ซึ่งกันส่งซ้ำไว้แล้ว)
  if (!CRON_SECRET) return json({ ok: false, error: 'CRON_SECRET is not configured' }, 500)
  if (!safeEqual(req.headers.get('x-cron-secret') ?? '', CRON_SECRET)) return json({ ok: false, error: 'unauthorized' }, 401)

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const mode = body.mode
  if (mode !== 'digest' && mode !== 'low_rating') return json({ ok: false, error: 'invalid mode' }, 400)
  const dryRun = body.dry_run === true
  const onlySlug = body.only_slug === undefined ? null : validSlug(body.only_slug)
  if (body.only_slug !== undefined && !onlySlug) return json({ ok: false, error: 'invalid only_slug' }, 400)
  const onlyUser = body.only_user === undefined ? null : (isUuid(body.only_user) ? body.only_user : null)
  if (body.only_user !== undefined && !onlyUser) return json({ ok: false, error: 'invalid only_user' }, 400)
  const ignoreWorkingDay = body.ignore_working_day === true
  // ข้ามวันหยุดได้เฉพาะรอบทดสอบที่ระบุ อปท. — รอบเต็มของ cron ข้ามวันหยุดเสมอ ห้ามมีทางส่งเช้าวันหยุดโดยไม่ตั้งใจ
  if (ignoreWorkingDay && !onlySlug) return json({ ok: false, error: 'ignore_working_day requires only_slug' }, 400)
  if (!dryRun && !BOT_TOKEN) return json({ ok: false, error: 'TELEGRAM_BOT_TOKEN is not configured' }, 500)

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const job = mode === 'digest' ? DIGEST_JOB : LOW_RATING_JOB
  // รอบทดสอบ (dry_run / only_slug / only_user) ไม่ลงสมุด — สมุดบอกสถานะของรอบเต็มที่ cron ยิงเท่านั้น
  const fullRun = !dryRun && !onlySlug && !onlyUser
  const summary = newSummary()
  const previews: Preview[] = []
  const opt: Options = { dryRun, onlySlug, onlyUser, ignoreWorkingDay }

  try {
    if (mode === 'digest') await runDigest(admin, opt, summary, previews)
    else await runLowRating(admin, opt, summary, previews)
  } catch (e) {
    const message = errText(e, 300)
    if (fullRun) await recordHeartbeat(admin, job, { ok: false, error: message })
    return json({ ok: false, mode, dry_run: dryRun, error: message, summary }, 500)
  }

  if (fullRun) {
    const problems = [...summary.errors, ...(summary.failed > 0 ? [`ส่ง Telegram ไม่สำเร็จ ${summary.failed} คน`] : [])]
    await recordHeartbeat(admin, job, problems.length === 0 ? { ok: true } : { ok: false, error: problems.join(' | ') })
  }

  return json({ ok: true, mode, dry_run: dryRun, summary, ...(dryRun ? { previews } : {}) })
})
