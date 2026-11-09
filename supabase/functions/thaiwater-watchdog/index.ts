// Supabase Edge Function: thaiwater-watchdog
// Deploy: npx --no-install supabase functions deploy thaiwater-watchdog --no-verify-jwt --project-ref <ref>
//   --no-verify-jwt จำเป็นเหมือน thaiwater-sync: pg_cron ยิงผ่าน net.http_post โดยไม่มี JWT
// Secret: THAIWATER_CRON_SECRET (ค่าเดียวกับที่ thaiwater-sync ใช้ — secret ของ Edge Function
//   เป็นค่ากลางทั้งโปรเจกต์อยู่แล้ว จึงไม่สร้างตัวใหม่ให้ต้องหมุน 2 ที่) + TELEGRAM_BOT_TOKEN
//
// ทำไมต้องแยกฟังก์ชัน ไม่รวมไว้ใน thaiwater-sync:
//   อาการที่ต้องจับให้ได้คือ "thaiwater-sync ไม่ได้ทำงาน" (cron ถูกลบ, secret ไม่ตรงจนได้ 401,
//   ฟังก์ชันพังตอน boot, ต้นทางล่มยาว) ถ้าโค้ดตรวจอยู่ในฟังก์ชันเดียวกัน มันก็ไม่ถูกเรียกไปด้วย
//   และจะไม่มีใครรู้เลย — นี่คือเหตุผลเดียวที่ยอมเพิ่มฟังก์ชันใหม่
//
// ⚠️ ข้อจำกัดที่ยังเหลือ (รู้ตัวไว้ ไม่ใช่บั๊ก): ตัวเฝ้าระวังนี้พึ่ง pg_cron เหมือนกัน ถ้า pg_cron
//   ทั้งระบบตาย จะไม่มีทั้งข้อมูลใหม่และข้อความเตือน การอุดช่องนี้ต้องมีตัวกระตุ้นจากนอกโปรเจกต์
//   (dead-man switch) ซึ่งเป็นบริการภายนอกอีกเจ้า — ยังไม่ทำ
//
// เกณฑ์: ดูเวลา "ดึงสำเร็จครั้งล่าสุด" (water_readings.fetched_at) แยกตามชนิดสถานี ถ้าเกิน
// STALE_MINUTES ถือว่าพลาดติดกัน 2 รอบขึ้นไป (sync ยิงทุกชั่วโมงนาทีที่ 10 ตัวนี้ตรวจนาทีที่ 25
// พลาด 1 รอบ = อายุ 75 นาที · พลาด 2 รอบ = 135 นาที)
// แยกตามชนิดเพราะต้นทางเป็นคนละ endpoint — ฝนล่มแต่ระดับน้ำปกติก็ต้องรู้
//
// ไม่ใช้ recorded_at เป็นตัวตัดสิน: ถ้าต้นทางส่งค่าเก่าค้างมา แปลว่าสถานีนั้นไม่ส่งข้อมูล
// ไม่ใช่ระบบเราพัง (หน้าเว็บมีป้าย "ข้อมูลอาจไม่เป็นปัจจุบัน" รายสถานีอยู่แล้ว)
//
// ตรวจเพิ่ม (2569-09-28): งานที่ต้องลงสมุด job_heartbeats ทุกรอบ (WATCHED_JOBS) — ข้อมูลที่ยังสด
// ไม่ได้แปลว่าแจ้งเตือนยังทำงาน water-alert-notify พังเองได้ขณะที่ sync ปกติ (เคยเกือบเงียบมาแล้ว:
// ข้อมูลเกินเพดาน 1,000 แถวของ PostgREST) · ไม่สำเร็จตามเกณฑ์ของงานนั้น → แจ้งกลุ่มเดิม
// พร้อม error ล่าสุดที่งานลงไว้ · อ่านสมุดไม่ได้ (เช่นตารางยังไม่ถูกสร้าง) ให้ข้ามไป
// ห้ามทำให้การตรวจข้อมูลค้างที่มีอยู่เดิมพังตาม
// (2569-11-09) เพิ่มงานรายเดือน local-plan-monthly-reminder — เกณฑ์แยกตามจังหวะของงาน ดู _shared/jobSchedule.ts

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendTelegramMessage, escapeHtml, cleanText } from '../_shared/telegram.ts'
import { checkJob, type JobSchedule } from '../_shared/jobSchedule.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const CRON_SECRET = Deno.env.get('THAIWATER_CRON_SECRET')
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')

// ปลายทางแจ้งเตือน: กลุ่มของ อปท. นี้เท่านั้น (เจ้าของระบบเลือก 2569-09-18)
// ตั้งใจไม่ส่งเข้ากลุ่ม อปท. จริงทุกแห่ง — เป็นปัญหาที่เจ้าหน้าที่ปลายทางลงมือแก้เองไม่ได้
// ถ้าจะย้ายกลุ่มในอนาคต แก้ค่านี้แล้ว deploy ใหม่ (ไม่มีหน้าจอตั้งค่า)
const ALERT_TENANT_SLUG = 'demo'

const STALE_MINUTES = 125
// อ่างเก็บน้ำเป็นข้อมูลรายวัน — ช่วงเช้าต้นทางขึ้นแถวของวันใหม่ก่อนแต่ยังไม่มีตัวเลข (ปริมาตร null)
// จนกรมชลประทานลงข้อมูลช่วงสาย (เจอจริง 2569-09-19: ดึงสำเร็จล่าสุด 08:10 น. แล้วว่างตั้งแต่ 09:00 น.)
// ใช้ 125 นาทีจะเตือนผิดทุกเช้า → ให้อ่างใช้ 30 ชม. = ต้นทางไม่ลงข้อมูลเลยทั้งวันถึงเตือน
// ถ้าเครื่อง API ของ ThaiWater ล่มทั้งเครื่อง สถานีฝน/ระดับน้ำ (เครื่องเดียวกัน) จับได้ในเกณฑ์ 125 นาทีอยู่แล้ว
const STALE_MINUTES_BY_TYPE: Record<string, number> = { dam: 30 * 60 }
// สถานีเตือนภัย (ews) มาจากเว็บกรมทรัพยากรน้ำ คนละแหล่งกับ ThaiWater — ถ้าเว็บนั้นล่ม แจ้งเตือนน้ำป่า
// ถึง อปท. จะเงียบไปด้วย จึงต้องเฝ้าแยกชนิด
const STATION_TYPES = ['rain', 'waterlevel', 'dam', 'ews'] as const
const TYPE_LABEL: Record<string, string> = {
  rain: 'ข้อมูลฝน',
  waterlevel: 'ข้อมูลระดับน้ำ',
  dam: 'ข้อมูลอ่างเก็บน้ำ',
  ews: 'สถานะสถานีเตือนภัย (กรมทรัพยากรน้ำ)',
}

// งานที่ต้องลงสมุดลงเวลาทุกรอบ — name ต้องตรงกับ JOB_NAME ในฟังก์ชันนั้น (เทสต์อ่านสองไฟล์มาเทียบ)
// แต่ละงานมีเกณฑ์ ข้อความ และชนิดแจ้งเตือนของตัวเอง → งานหนึ่งพังไม่บังข้อความ "กลับมาแล้ว" ของอีกงาน
// alertType ของ water-alert-notify ต้องคง 'water_alert' ไว้ — ตัวตรวจ "กลับมาแล้ว" อ่านประวัติจากชนิดนี้
type WatchedJob = {
  name: string
  label: string
  alertType: string
  schedule: JobSchedule
  staleTitle: string
  recoveredTitle: string
  impact: string
  fix: string
}
const WATCHED_JOBS: WatchedJob[] = [
  // รันทุกชั่วโมงนาทีที่ 15 ตัวนี้ตรวจนาทีที่ 25 · เกณฑ์ STALE_MINUTES เดียวกับข้อมูลค้าง
  // พลาด 1 รอบ = อายุ 70 นาที · พลาด 2 รอบ = 130 นาที
  {
    name: 'water-alert-notify',
    label: 'ระบบแจ้งเตือนน้ำ-ฝนใกล้พื้นที่ (water-alert-notify)',
    alertType: 'water_alert',
    schedule: { kind: 'rolling', maxAgeMinutes: STALE_MINUTES },
    staleTitle: 'ระบบแจ้งเตือนสถานการณ์น้ำ-ฝนหยุดทำงาน',
    recoveredTitle: 'ระบบแจ้งเตือนสถานการณ์น้ำ-ฝนกลับมาทำงานแล้ว',
    impact: 'ระหว่างนี้กลุ่ม อปท. จะไม่ได้รับแจ้งเตือนฝนหนักมาก ระดับน้ำ หรืออ่างเก็บน้ำ แม้เกิดเหตุจริง',
    fix: 'ตรวจที่ Supabase → Edge Functions → water-alert-notify → Logs',
  },
  // cron '45 1 1 * *' (GMT) = วันที่ 1 เวลา 08:45 น. · ตัวนี้ตรวจนาทีที่ 25 → รอบแรกหลังเส้นตาย 09:30 คือ 10:25 น.
  // บาง อปท. พัง ฟังก์ชันลง last_error แต่ไม่เลื่อน last_ok_at → เตือนพร้อม error
  // firstMonth 2026-12: เปิดใช้ พ.ย. 2569 หลังวันที่ 1 จึงยังไม่มีรอบจริงของ พ.ย. ให้ตรวจ
  // ถ้าย้ายเวลา cron ต้องทบทวน dueTime ด้วย
  {
    name: 'local-plan-monthly-reminder',
    label: 'แจ้งเตือนแผนการดำเนินงานรายเดือน (local-plan-monthly-reminder)',
    alertType: 'local_plan_reminder',
    schedule: { kind: 'monthly', day: 1, dueTime: '09:30', firstMonth: '2026-12' },
    staleTitle: 'แจ้งเตือนแผนการดำเนินงานรอบวันที่ 1 ยังไม่สำเร็จ',
    recoveredTitle: 'แจ้งเตือนแผนการดำเนินงานรายเดือนกลับมาทำงานแล้ว',
    impact: 'กองที่ยังไม่ได้รับข้อความจะไม่รู้ว่ามีรายการแผนการดำเนินงานถึงกำหนดแต่ยังไม่บันทึกผล',
    fix: 'ตรวจที่ Supabase → Edge Functions → local-plan-monthly-reminder → Logs แก้แล้วยิงรอบเต็มซ้ำได้ (อปท. ที่ได้ข้อความเดือนนี้แล้วจะไม่ได้ซ้ำ)',
  },
]

type StationType = typeof STATION_TYPES[number]
type StaleFeed = { type: StationType; lastFetchedAt: string | null; ageMinutes: number | null }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// เทียบ secret แบบใช้เวลาเท่ากันทุกกรณี (ยกมาจาก thaiwater-sync ตั้งใจให้เหมือนกัน)
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  let diff = x.length ^ y.length
  const len = Math.max(x.length, y.length)
  for (let i = 0; i < len; i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

function bangkokDate(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }) // YYYY-MM-DD
}

function bangkokText(iso: string | null): string {
  if (!iso) return 'ไม่เคยมีข้อมูลเลย'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'ไม่ทราบเวลา'
  return `${d.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })} น.`
}

// วันของรอบงานรายเดือน เช่น "1 ธ.ค. 2569"
function bangkokDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'ไม่ทราบวัน'
  return d.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' })
}

function ageText(minutes: number | null): string {
  if (minutes === null) return 'ยังไม่เคยดึงสำเร็จ'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} นาที`
  return m === 0 ? `${h} ชม.` : `${h} ชม. ${m} นาที`
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405)
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ ok: false, error: 'server not configured' }, 500)
  if (!CRON_SECRET) return json({ ok: false, error: 'THAIWATER_CRON_SECRET is not configured' }, 500)
  if (!safeEqual(req.headers.get('x-cron-secret') ?? '', CRON_SECRET)) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }
  if (!BOT_TOKEN) return json({ ok: false, error: 'TELEGRAM_BOT_TOKEN is not configured' }, 500)

  // ช่องทดสอบ (ต้องมี cron secret เหมือนกัน): ยิงด้วย {"stale_minutes":1} เพื่อบังคับให้เข้าเงื่อนไข
  // "ค้าง" แล้วดูว่าข้อความถึงกลุ่มจริงไหม · ยิงด้วยค่าสูงมาก (เช่น 99999) เพื่อทดสอบข้อความ
  // "กลับมาแล้ว" · แถวทดสอบแยก notification_type ด้วยท้าย "_test" และคีย์ขึ้นต้น "test:"
  // จึงไม่ปนกับประวัติเหตุการณ์จริงและไม่ไปกินคีย์ของวันเดียวกัน
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const override = Number(body.stale_minutes)
  const isTest = Number.isFinite(override) && override >= 1
  const staleMinutes = isTest ? Math.floor(override) : STALE_MINUTES
  const keyPrefix = isTest ? 'test:' : ''
  const typeSuffix = isTest ? '_test' : ''

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: tenant, error: tenantError } = await admin
    .from('municipalities')
    .select('id, telegram_group_id')
    .eq('slug', ALERT_TENANT_SLUG)
    .maybeSingle()
  if (tenantError) return json({ ok: false, error: cleanText(tenantError.message, 300) }, 500)
  if (!tenant?.telegram_group_id) {
    return json({ ok: false, error: `ยังไม่ได้ตั้ง telegram_group_id ของ ${ALERT_TENANT_SLUG}` }, 500)
  }

  const { data: stations, error: stationsError } = await admin
    .from('water_station_config')
    .select('id, station_type')
    .eq('is_active', true)
  if (stationsError) return json({ ok: false, error: cleanText(stationsError.message, 300) }, 500)
  // ไม่มีสถานีเลย = ยังไม่เปิดใช้โมดูล ไม่ใช่ความผิดปกติ
  if (!stations?.length) return json({ ok: true, checked: 0, stale: [], sent: null })

  const now = Date.now()
  const feeds: StaleFeed[] = []

  for (const type of STATION_TYPES) {
    const ids = stations.filter((s) => s.station_type === type).map((s) => s.id)
    if (!ids.length) continue
    // โหมดทดสอบบังคับทุกชนิดด้วยค่าที่ส่งมา · รอบจริงใช้เกณฑ์รายชนิด (ถ้ามี)
    const staleMs = (isTest ? staleMinutes : (STALE_MINUTES_BY_TYPE[type] ?? staleMinutes)) * 60_000
    const { data: latest, error: latestError } = await admin
      .from('water_readings')
      .select('fetched_at')
      .in('station_config_id', ids)
      .order('fetched_at', { ascending: false })
      .limit(1)
    if (latestError) return json({ ok: false, error: cleanText(latestError.message, 300) }, 500)

    const lastFetchedAt = latest?.[0]?.fetched_at ?? null
    const ageMinutes = lastFetchedAt
      ? Math.round((now - new Date(lastFetchedAt).getTime()) / 60_000)
      : null
    if (lastFetchedAt === null || now - new Date(lastFetchedAt).getTime() > staleMs) {
      feeds.push({ type, lastFetchedAt, ageMinutes })
    }
  }

  // claim คีย์ผ่าน unique constraint ของ notification_deliveries เหมือน fleet-doc-expiry-notify
  // ชน = แจ้งไปแล้ว ไม่ส่งซ้ำ (resource_id ต้องเป็น uuid จึงใช้ id ของ อปท. ปลายทาง)
  //
  // ต่างจาก fleet ตรงที่ยอมส่งซ้ำเมื่อแถวเดิมเป็น 'failed' — ถ้า Telegram ล่มตอนที่ระบบพังพอดี
  // คีย์รายวันจะกลืนการแจ้งเตือนทิ้งทั้งวัน ซึ่งเป็นกรณีที่ต้องการให้เตือนที่สุด
  async function claim(notificationType: string, idempotencyKey: string): Promise<'new' | 'retry' | 'skip'> {
    const { error } = await admin.from('notification_deliveries').insert({
      municipality_id: tenant!.id,
      channel: 'telegram',
      notification_type: notificationType,
      resource_type: 'water_sync',
      resource_id: tenant!.id,
      idempotency_key: idempotencyKey,
      status: 'pending',
    })
    if (!error) return 'new'
    if (error.code !== '23505') {
      // ไม่ควรเกิดกับ service_role — ถ้าเกิด อย่าเดาว่าปลอดภัยที่จะส่ง (กันยิงรัวทุกชั่วโมง)
      console.error('[thaiwater-watchdog] claim ไม่สำเร็จ:', error.code, error.message)
      return 'skip'
    }
    const { data: existing } = await admin.from('notification_deliveries')
      .select('status').eq('municipality_id', tenant!.id).eq('channel', 'telegram')
      .eq('idempotency_key', idempotencyKey).maybeSingle()
    return existing?.status === 'failed' ? 'retry' : 'skip'
  }

  async function finish(idempotencyKey: string, text: string) {
    const result = await sendTelegramMessage(String(tenant!.telegram_group_id), text, BOT_TOKEN!)
    await admin.from('notification_deliveries')
      .update({
        status: result.ok ? 'sent' : 'failed',
        attempt_count: result.attempts,
        sent_at: result.ok ? new Date().toISOString() : null,
        provider_message_id: result.ok ? String(result.messageId ?? '') : null,
        last_error: result.ok ? null : result.error,
        updated_at: new Date().toISOString(),
      })
      .eq('municipality_id', tenant!.id)
      .eq('channel', 'telegram')
      .eq('idempotency_key', idempotencyKey)
    return result.ok
  }

  type Beat = { last_ok_at: string | null; last_error_at: string | null; last_error: string | null }

  async function watchJob(job: WatchedJob, beat: Beat | undefined): Promise<Record<string, unknown>> {
    // โหมดทดสอบบังคับทุกงานด้วยเกณฑ์นาทีที่ส่งมา (เหมือนข้อมูลค้าง) จะได้ทดสอบข้อความได้ทุกวัน
    const schedule: JobSchedule = isTest ? { kind: 'rolling', maxAgeMinutes: staleMinutes } : job.schedule
    const lastOkAt: string | null = beat?.last_ok_at ?? null
    const okAt = lastOkAt ? new Date(lastOkAt).getTime() : NaN
    const check = checkJob(schedule, lastOkAt, new Date(now))
    const staleType = `${job.alertType}_stale${typeSuffix}`
    const recoveredType = `${job.alertType}_recovered${typeSuffix}`

    if (check.stale) {
      // error ที่เก่ากว่าครั้งที่สำเร็จล่าสุด = เรื่องที่หายไปแล้ว ไม่ใช่สาเหตุของรอบนี้ จึงไม่แนบ
      const errorAt = beat?.last_error_at ? new Date(beat.last_error_at).getTime() : NaN
      const freshError = Boolean(beat?.last_error) && Number.isFinite(errorAt) && (!Number.isFinite(okAt) || errorAt > okAt)
      const ageMinutes = Number.isFinite(okAt) ? Math.round((now - okAt) / 60_000) : null
      const result = { stale: true, lastOkAt, cycleStart: check.cycleStart }

      // คีย์ผูกกับ "งาน + วันที่ไทย" → พังต่อเนื่องเตือนวันละครั้งจนกว่าจะแก้
      // (งานน้ำได้คีย์เดิม water_alert_stale:water-alert-notify:<วันที่> — ไม่ส่งซ้ำในวันที่ deploy)
      const key = `${keyPrefix}${job.alertType}_stale:${job.name}:${bangkokDate()}`
      if (await claim(staleType, key) === 'skip') return { ...result, sent: false, reason: 'แจ้งไปแล้ว' }

      const status = check.cycleStart
        ? (lastOkAt
          ? `• ${escapeHtml(job.label, 80)} รอบ ${bangkokDay(check.cycleStart)} ยังไม่สำเร็จ (สำเร็จล่าสุด ${bangkokText(lastOkAt)})`
          : `• ${escapeHtml(job.label, 80)} รอบ ${bangkokDay(check.cycleStart)} ยังไม่สำเร็จ และยังไม่เคยลงสมุดว่าทำงานสำเร็จ`)
        : (lastOkAt
          ? `• ${escapeHtml(job.label, 80)} ทำงานสำเร็จล่าสุด ${bangkokText(lastOkAt)} (ผ่านมา ${ageText(ageMinutes)})`
          : `• ${escapeHtml(job.label, 80)} ยังไม่เคยลงสมุดว่าทำงานสำเร็จ`)
      // ไม่ตัดความยาวแบบข้อความข้อมูลค้าง: ตัดกลาง &amp; แล้ว Telegram ปฏิเสธทั้งข้อความ
      // ความยาวมีเพดานอยู่แล้ว (label 80 · error 300 ตัวก่อน escape · ข้อความคงที่) ต่ำกว่า 4,096 เสมอ
      const text = [
        `🔴 <b>${isTest ? '[ทดสอบ] ' : ''}${escapeHtml(job.staleTitle, 120)}</b>`,
        status,
        freshError
          ? `  error ล่าสุด ${bangkokText(String(beat?.last_error_at))}: ${escapeHtml(String(beat?.last_error), 300)}`
          : '  ไม่มีบันทึก error — ฟังก์ชันอาจไม่ถูกเรียกเลย (cron หาย · secret ไม่ตรง · deploy ไม่ขึ้น)',
        '',
        escapeHtml(job.impact, 300),
        escapeHtml(job.fix, 300),
      ].join('\n')
      return { ...result, sent: await finish(key, text) }
    }

    // กลับมาแล้ว — แจ้งเฉพาะเมื่อเคยแจ้งว่าหยุด และยังไม่เคยแจ้งว่ากลับมาหลังจากนั้น (แบบเดียวกับข้อมูลค้าง)
    const { data: lastJobStale } = await admin.from('notification_deliveries')
      .select('created_at').eq('municipality_id', tenant!.id)
      .eq('notification_type', staleType).eq('status', 'sent')
      .order('created_at', { ascending: false }).limit(1)
    const staleAt: string | undefined = lastJobStale?.[0]?.created_at
    if (!staleAt) return { stale: false, sent: null }
    const { data: lastJobRecovered } = await admin.from('notification_deliveries')
      .select('created_at').eq('municipality_id', tenant!.id)
      .eq('notification_type', recoveredType).eq('status', 'sent')
      .order('created_at', { ascending: false }).limit(1)
    if (lastJobRecovered?.length && lastJobRecovered[0].created_at >= staleAt) return { stale: false, sent: null }

    const recoveryKey = `${keyPrefix}${job.alertType}_recovered:${staleAt}`
    if (await claim(recoveredType, recoveryKey) === 'skip') return { stale: false, sent: false, reason: 'แจ้งไปแล้ว' }
    const text = [
      `✅ <b>${isTest ? '[ทดสอบ] ' : ''}${escapeHtml(job.recoveredTitle, 120)}</b>`,
      `แจ้งว่าหยุดทำงานเมื่อ ${bangkokText(staleAt)} ตอนนี้ทำงานสำเร็จตามรอบแล้ว`,
    ].join('\n')
    return { stale: false, sent: await finish(recoveryKey, text), recovered: true }
  }

  // ── งานที่ต้องลงสมุดลงเวลาทุกรอบ (job_heartbeats) ──
  // ผลรวมไว้ในคำตอบทุกทางผ่าน reply() · อ่านสมุดไม่ได้ = ข้ามไป ไม่ตอบ 500 (การตรวจข้อมูลค้างต้องทำต่อ)
  // ตรวจทีละงาน: แต่ละงานมีคีย์/ชนิดแจ้งเตือนของตัวเอง งานหนึ่งพังอยู่ไม่บังข้อความ "กลับมาแล้ว" ของอีกงาน
  let jobs: Record<string, unknown> = {}
  const { data: beats, error: beatsError } = await admin
    .from('job_heartbeats')
    .select('job_name, last_ok_at, last_error_at, last_error')
    .in('job_name', WATCHED_JOBS.map((j) => j.name))
  if (beatsError) {
    console.error('[thaiwater-watchdog] อ่านสมุดลงเวลาไม่ได้:', beatsError.code, beatsError.message)
    jobs = { error: cleanText(beatsError.message, 300) }
  } else {
    for (const job of WATCHED_JOBS) {
      // งานหนึ่งตรวจไม่ได้ (เช่นตั้งค่าเกณฑ์ผิด) ห้ามลากการตรวจงานอื่นและข้อมูลค้างพังตาม
      try {
        jobs[job.name] = await watchJob(job, (beats ?? []).find((b) => b.job_name === job.name))
      } catch (err) {
        console.error(`[thaiwater-watchdog] ตรวจ ${job.name} ไม่ได้:`, err)
        jobs[job.name] = { error: cleanText(err instanceof Error ? err.message : String(err), 300) }
      }
    }
  }
  const reply = (body: Record<string, unknown>) => json({ ...body, jobs })

  if (feeds.length > 0) {
    // คีย์ผูกกับ "ชนิดที่ค้าง + วันที่ไทย" → เตือนซ้ำได้วันละครั้งตราบใดที่ยังพัง
    // และถ้าลามจากฝนอย่างเดียวเป็นค้างทั้งคู่ คีย์เปลี่ยน จึงได้ข้อความใหม่ทันที
    const key = `${keyPrefix}water_sync_stale:${feeds.map((f) => f.type).join('+')}:${bangkokDate()}`
    if (await claim(`water_sync_stale${typeSuffix}`, key) === 'skip') {
      return reply({ ok: true, stale: feeds, sent: false, reason: 'แจ้งไปแล้ว' })
    }
    const lines = [
      `🔴 <b>${isTest ? '[ทดสอบ] ' : ''}ระบบดึงข้อมูลน้ำ-ฝนหยุดทำงาน</b>`,
      ...feeds.map((f) =>
        `• ${escapeHtml(TYPE_LABEL[f.type] ?? f.type, 40)} ค้างมา ${ageText(f.ageMinutes)} (ดึงสำเร็จล่าสุด ${bangkokText(f.lastFetchedAt)})`),
      '',
      'รอบดึงอัตโนมัติพลาดติดกันอย่างน้อย 2 รอบ ประชาชนจะเห็นป้าย "ข้อมูลอาจไม่เป็นปัจจุบัน" บนหน้าสถานการณ์น้ำ-ฝน',
      'ตรวจที่ Supabase → Edge Functions → thaiwater-sync → Logs',
    ].join('\n').slice(0, 1800)
    const sent = await finish(key, lines)
    return reply({ ok: true, stale: feeds, sent, test: isTest })
  }

  // ปกติดี — ส่งข้อความ "กลับมาแล้ว" เฉพาะเมื่อมีเหตุค้างที่ยังไม่เคยแจ้งว่าหายเท่านั้น
  const { data: lastStale } = await admin.from('notification_deliveries')
    .select('created_at').eq('municipality_id', tenant.id)
    .eq('notification_type', `water_sync_stale${typeSuffix}`).eq('status', 'sent')
    .order('created_at', { ascending: false }).limit(1)
  if (!lastStale?.length) return reply({ ok: true, stale: [], sent: null })

  const { data: lastRecovered } = await admin.from('notification_deliveries')
    .select('created_at').eq('municipality_id', tenant.id)
    .eq('notification_type', `water_sync_recovered${typeSuffix}`).eq('status', 'sent')
    .order('created_at', { ascending: false }).limit(1)
  if (lastRecovered?.length && lastRecovered[0].created_at >= lastStale[0].created_at) {
    return reply({ ok: true, stale: [], sent: null })
  }

  // คีย์ผูกกับเวลาของเหตุการณ์ที่แจ้งไป → 1 เหตุการณ์ได้ข้อความ "กลับมาแล้ว" ครั้งเดียว
  const recoveryKey = `${keyPrefix}water_sync_recovered:${lastStale[0].created_at}`
  if (await claim(`water_sync_recovered${typeSuffix}`, recoveryKey) === 'skip') {
    return reply({ ok: true, stale: [], sent: false, reason: 'แจ้งไปแล้ว' })
  }
  const recovered = [
    `✅ <b>${isTest ? '[ทดสอบ] ' : ''}ระบบดึงข้อมูลน้ำ-ฝนกลับมาทำงานแล้ว</b>`,
    `หยุดไปตั้งแต่ ${bangkokText(lastStale[0].created_at)} ตอนนี้ดึงข้อมูลได้ตามปกติ`,
  ].join('\n')
  const sent = await finish(recoveryKey, recovered)
  return reply({ ok: true, stale: [], sent, recovered: true })
})
