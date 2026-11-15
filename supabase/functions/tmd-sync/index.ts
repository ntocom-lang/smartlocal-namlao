// Supabase Edge Function: tmd-sync
// Deploy: npx --no-install supabase functions deploy tmd-sync --no-verify-jwt --project-ref <ref>
//   --no-verify-jwt จำเป็น: pg_cron ยิงผ่าน net.http_post โดยไม่มี JWT (มีแค่ x-cron-secret)
// Secret:
//   TMD_NWP_TOKEN          — token ของ อปท. จาก data.tmd.go.th/nwpapi (เจ้าของระบบสมัครและตั้งเอง 2569-11-15)
//   THAIWATER_CRON_SECRET  — ตัวเดียวกับ thaiwater-sync / water-alert-notify / thaiwater-watchdog
//   TELEGRAM_BOT_TOKEN     — ส่งแจ้งเตือนพยากรณ์ฝนหนักเข้ากลุ่ม อปท.
//
// เรียกโดย pg_cron ทุก 3 ชม. (20261126100200_tmd_forecast_cron.sql) ไม่มีโค้ดฝั่ง client เรียก
// ดึงพยากรณ์ NWP ของกรมอุตุนิยมวิทยา ณ พิกัดของ "ทุก อปท. ที่เปิดใช้งานและมีพิกัด"
// (เจ้าของระบบสั่ง 2569-11-15: ทำทุก municipality) แล้วเก็บลง tmd_forecasts 1 แถว/อปท.
// หน้าเว็บอ่านผ่าน get_public_tmd_forecast() ไม่ยิงไปกรมเอง
//   - รายชั่วโมง 48 ชม. (rain มม./ชม., tc, rh, cond) โดเมน 2 กม.
//   - รายวัน 7 วัน (rain มม./24 ชม., tc_max, tc_min, cond, ws10m m/s, wd10m องศา) โดเมน 18/27 กม.
//   อปท. ที่พิกัดเดียวกัน (เช่น demo ใช้พิกัดน้ำเลา) ยิงกรมครั้งเดียวแล้วใช้ร่วม
//
// ทดสอบจาก IP ของ Supabase แล้ว 2569-11-15: กรมตอบ 200 (ต่างจาก ews / ศูนย์น้ำแพร่ที่บล็อก IP ต่างประเทศ)
// โควตาของกรม: 60 คำขอ/นาที · 100,000 datapoint/ชม. (datapoint = จุด × ช่วงเวลา × ค่า) เกินได้ 429
//
// แจ้งเตือน Telegram (เจ้าของระบบอนุมัติ T2 ข้อ 4 2569-11-15):
//   พยากรณ์รายวันวันนี้ถึง 2 วันข้างหน้า (รวม 3 วัน) มีวันที่ฝนรวม 24 ชม. ถึงเกณฑ์ "ฝนหนัก" ≥ 35.1 มม.
//   ของกรมอุตุฯ (ชุดเดียวกับ RAIN_LEVELS ใน src/lib/waterSituation.js) → ส่งกลุ่มของ อปท.
//   - ส่งครั้งเดียวต่อ "วันที่ถูกพยากรณ์ × ระดับ" (ฝนหนัก / ฝนหนักมาก) — ตัวเลขขยับรอบต่อไปไม่ส่งซ้ำ
//     แต่ยกระดับจากฝนหนักเป็นฝนหนักมากได้ข้อความใหม่ · พยากรณ์ลดลงทีหลังไม่ส่ง "ยกเลิก" (ไม่ใช่ประกาศ)
//   - ผู้รับ: อปท. ที่ตั้ง telegram_group_id และเปิดโมดูล water-situation (ชุดเดียวกับ water-alert-notify)
//   - ข้อความบอกเสมอว่าเป็นผลพยากรณ์จากแบบจำลองของกรมอุตุนิยมวิทยา อาจคลาดเคลื่อน
//     ไม่ใช่ประกาศเตือนภัยของกรมหรือของ อปท. — ไม่สั่งการ ไม่ประกาศแทนผู้บริหาร (ดุลพินิจทางปกครอง)
//   - ส่งไม่สำเร็จ = แถว failed รอบหน้าส่งใหม่ (แบบเดียวกับ water-alert-notify)
//
// body {"test": true} = ดึงตามปกติ แต่แจ้งเตือนเฉพาะ demo ติด [ทดสอบ] และคีย์กันซ้ำแยกจากของจริง
// ลงสมุด job_heartbeats ('tmd-sync') ทุกรอบ

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendTelegramMessage, escapeHtml, cleanText } from '../_shared/telegram.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const CRON_SECRET = Deno.env.get('THAIWATER_CRON_SECRET')
const NWP_TOKEN = Deno.env.get('TMD_NWP_TOKEN')
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')

const NWP_BASE = 'https://data.tmd.go.th/nwpapi/v1/forecast/location'
const HOURLY_FIELDS = 'rain,tc,rh,cond'
// ws10m/wd10m รายวัน = ความเร็ว/ทิศทางลม "สูงสุด" ที่ 10 ม. (m/s · องศา) ตามเอกสารกรม — แถวลมของตาราง 7 วัน
const DAILY_FIELDS = 'rain,tc_max,tc_min,cond,ws10m,wd10m'
const HOURLY_DURATION = 48 // สูงสุดที่กรมให้
const DAILY_DURATION = 7

// เกณฑ์ปริมาณฝน 24 ชม. ของกรมอุตุนิยมวิทยา — ⚠️ ต้องตรงกับ RAIN_LEVELS ใน src/lib/waterSituation.js
//   (heavy.upTo 35.0 → ขอบล่าง 35.1 · veryHeavy ขอบล่าง 90.1 = RAIN_VERY_HEAVY_MM) เทสต์อ่านสองไฟล์มาเทียบ
const HEAVY_RAIN_MM = 35.1
const VERY_HEAVY_RAIN_MM = 90.1
const ALERT_DAYS_AHEAD = 2 // วันนี้ + 2 วัน = 3 วัน

const FETCH_TIMEOUT_MS = 15_000
const MODULE_KEY = 'water-situation'
const JOB_NAME = 'tmd-sync'
const TEST_TENANT_SLUG = 'demo'
const NOTIFICATION_TYPE = 'tmd_forecast_heavy_rain'

// ขอบเขตพิกัดประเทศไทย (กันพิกัดพิมพ์ผิด เช่น สลับ lat/lon) — นอกกรอบไม่ยิงกรม
const TH_BOUNDS = { latMin: 5, latMax: 21, lonMin: 97, lonMax: 106 }

type Tenant = {
  id: string
  slug: string
  name: string | null
  latitude: string | number | null
  longitude: string | number | null
  telegram_group_id: string | number | null
  enabled_modules: string[] | null
}

type HourlyPoint = { time: string; rain: number | null; tc: number | null; rh: number | null; cond: number | null }
type DailyPoint = {
  time: string; rain: number | null; tc_max: number | null; tc_min: number | null; cond: number | null
  ws10m: number | null; wd10m: number | null
}
type Grid = { lat: number; lon: number } | null
type FetchResult<T> = { ok: true; grid: Grid; points: T[] } | { ok: false; status: number; error: string }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
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

function bangkokNow(): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date())
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) }
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// ตัวเลขในช่วงที่สมเหตุสมผล หรือ null — ห้ามแปลงค่าว่างเป็น 0 (Number(null) = 0 จะกลายเป็น "ไม่มีฝน")
function num(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < min || n > max) return null
  return Math.round(n * 100) / 100
}

function cond(value: unknown): number | null {
  const n = num(value, 1, 12)
  return n !== null && Number.isInteger(n) ? n : null
}

// เวลาในคำตอบของกรมเป็น ISO มี offset +07:00 — เก็บสตริงเดิมถ้าแปลงได้จริง
function validTime(value: unknown): string | null {
  const s = cleanText(value, 40)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/.test(s)) return null
  return Number.isNaN(new Date(s).getTime()) ? null : s
}

async function fetchNwp<T>(
  path: 'hourly' | 'daily',
  params: Record<string, string>,
  mapPoint: (time: string, data: Record<string, unknown>) => T,
  maxPoints: number,
): Promise<FetchResult<T>> {
  const url = `${NWP_BASE}/${path}/at?${new URLSearchParams(params)}`
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json', authorization: `Bearer ${NWP_TOKEN}` },
      signal: ctl.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      const hint = res.status === 401 ? 'token ไม่ถูกต้องหรือหมดอายุ (TMD_NWP_TOKEN)'
        : res.status === 429 ? 'เกินโควตาของกรม (429)' : text
      return { ok: false, status: res.status, error: cleanText(`${path} HTTP ${res.status}: ${hint}`, 300) }
    }
    const body = JSON.parse(text) as { WeatherForecasts?: { location?: { lat?: unknown; lon?: unknown }; forecasts?: unknown[] }[] }
    const first = body.WeatherForecasts?.[0]
    if (!first || !Array.isArray(first.forecasts)) {
      return { ok: false, status: res.status, error: `${path}: คำตอบไม่มี WeatherForecasts[0].forecasts` }
    }
    const glat = num(first.location?.lat, -90, 90)
    const glon = num(first.location?.lon, -180, 180)
    const points: T[] = []
    for (const raw of first.forecasts.slice(0, maxPoints)) {
      const row = raw as { time?: unknown; data?: Record<string, unknown> }
      const time = validTime(row?.time)
      if (!time || !row.data || typeof row.data !== 'object') continue
      points.push(mapPoint(time, row.data))
    }
    if (!points.length) return { ok: false, status: res.status, error: `${path}: ไม่มีช่วงเวลาที่อ่านได้` }
    return { ok: true, grid: glat !== null && glon !== null ? { lat: glat, lon: glon } : null, points }
  } catch (e) {
    return { ok: false, status: 0, error: cleanText(`${path}: ${e instanceof Error ? e.message : String(e)}`, 300) }
  } finally {
    clearTimeout(timer)
  }
}

const mapHourly = (time: string, d: Record<string, unknown>): HourlyPoint => ({
  time,
  rain: num(d.rain, 0, 500),
  tc: num(d.tc, -20, 60),
  rh: num(d.rh, 0, 100),
  cond: cond(d.cond),
})

const mapDaily = (time: string, d: Record<string, unknown>): DailyPoint => ({
  time,
  rain: num(d.rain, 0, 2000),
  tc_max: num(d.tc_max, -20, 60),
  tc_min: num(d.tc_min, -20, 60),
  cond: cond(d.cond),
  ws10m: num(d.ws10m, 0, 100),
  wd10m: num(d.wd10m, 0, 360),
})

// รับแค่ส่วนที่ใช้ — ReturnType<typeof createClient> ชนกับ generic ของ supabase-js รุ่นใหม่ (TS2345)
type HeartbeatClient = { from: (table: string) => { upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => PromiseLike<{ error: { code?: string; message: string } | null }> } }

async function recordHeartbeat(
  admin: HeartbeatClient,
  outcome: { ok: true } | { ok: false; error: string },
) {
  const at = new Date().toISOString()
  const row: Record<string, unknown> = outcome.ok
    ? { job_name: JOB_NAME, last_ok_at: at, updated_at: at }
    : { job_name: JOB_NAME, last_error_at: at, last_error: cleanText(outcome.error, 500), updated_at: at }
  const { error } = await admin.from('job_heartbeats').upsert(row, { onConflict: 'job_name' })
  if (error) console.error('[tmd-sync] ลงสมุดลงเวลาไม่สำเร็จ:', error.code, error.message)
}

// สอดคล้องกับ isModuleEnabled() ฝั่งหน้าเว็บ: enabled_modules เป็น null = เปิดทุกโมดูล
function moduleOn(t: Tenant): boolean {
  return t.enabled_modules === null || t.enabled_modules.includes(MODULE_KEY)
}

function thaiDay(date: string): string {
  return new Date(`${date}T00:00:00+07:00`).toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok', weekday: 'long', day: 'numeric', month: 'short',
  })
}

function bangkokText(iso: string): string {
  return `${new Date(iso).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })} น.`
}

type RainAlert = { date: string; rain: number; level: 'heavy' | 'veryHeavy'; key: string }

function renderMessage(tenant: Tenant, alerts: RainAlert[], fetchedAt: string, isTest: boolean): string {
  const lines = alerts
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(a => `• ${escapeHtml(thaiDay(a.date))} — <b>${a.rain.toLocaleString('th-TH', { maximumFractionDigits: 1 })} มม.</b> (${a.level === 'veryHeavy' ? 'ฝนหนักมาก' : 'ฝนหนัก'})`)
  return [
    `🌧️ <b>${isTest ? '[ทดสอบ] ' : ''}พยากรณ์ฝนหนักในพื้นที่${tenant.name ? ` ${escapeHtml(tenant.name, 120)}` : ''}</b>`,
    'กรมอุตุนิยมวิทยาพยากรณ์ฝนรวม 24 ชม. ณ พิกัดสำนักงาน',
    ...lines,
    '',
    `เกณฑ์กรมอุตุฯ: ฝนหนัก ${HEAVY_RAIN_MM}–90.0 มม. · ฝนหนักมาก ${VERY_HEAVY_RAIN_MM} มม. ขึ้นไป`,
    'ℹ️ เป็นผลพยากรณ์จากแบบจำลองคอมพิวเตอร์ อาจคลาดเคลื่อน ไม่ใช่ประกาศเตือนภัยของกรมหรือของ อปท. ใช้ประกอบการเตรียมพร้อม',
    `ที่มา: กรมอุตุนิยมวิทยา (data.tmd.go.th) · ดึงเมื่อ ${escapeHtml(bangkokText(fetchedAt))}`,
  ].join('\n')
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405)
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !CRON_SECRET) {
    return json({ ok: false, error: 'server misconfigured' }, 500)
  }
  if (!safeEqual(req.headers.get('x-cron-secret') ?? '', CRON_SECRET)) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const body = await req.json().catch(() => ({})) as { test?: unknown }
  const isTest = body?.test === true
  // โหมดทดสอบไม่ลงสมุด (นิยามใน 20260928140000: last_ok_at ไม่นับโหมดทดสอบ)
  const fail = async (error: string, status = 500) => {
    if (!isTest) await recordHeartbeat(admin, { ok: false, error })
    return json({ ok: false, error }, status)
  }
  if (!NWP_TOKEN) return await fail('ยังไม่ได้ตั้ง secret TMD_NWP_TOKEN')

  const { data: rows, error: tenantError } = await admin
    .from('municipalities')
    .select('id, slug, name, latitude, longitude, telegram_group_id, enabled_modules')
    .eq('is_active', true)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
  if (tenantError) return await fail(cleanText(tenantError.message, 300))

  // จัดกลุ่มตามพิกัด (ทศนิยม 4 ตำแหน่ง ≈ 11 ม.) — พิกัดเดียวกันยิงกรมครั้งเดียว
  const groups = new Map<string, { lat: number; lon: number; tenants: Tenant[] }>()
  const skipped: string[] = []
  for (const t of (rows ?? []) as Tenant[]) {
    const lat = Number(t.latitude)
    const lon = Number(t.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)
      || lat < TH_BOUNDS.latMin || lat > TH_BOUNDS.latMax || lon < TH_BOUNDS.lonMin || lon > TH_BOUNDS.lonMax) {
      skipped.push(t.slug)
      continue
    }
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`
    const g = groups.get(key) ?? { lat, lon, tenants: [] }
    g.tenants.push(t)
    groups.set(key, g)
  }
  if (!groups.size) {
    if (!isTest) await recordHeartbeat(admin, { ok: true })
    return json({ ok: true, test: isTest, points: 0, skipped })
  }

  const now = bangkokNow()
  const errors: string[] = []
  const dailyByTenant = new Map<string, { points: DailyPoint[]; fetchedAt: string }>()
  let okGroups = 0

  for (const g of groups.values()) {
    const coord = { lat: g.lat.toFixed(4), lon: g.lon.toFixed(4) }
    // ทีละพิกัด ไม่ยิงขนาน — จำนวนพิกัดน้อย และไม่เสี่ยงชน 60 คำขอ/นาทีเมื่อ อปท. เพิ่ม
    const firstTry = await fetchNwp('hourly', {
      ...coord, fields: HOURLY_FIELDS, date: now.date, hour: String(now.hour), duration: String(HOURLY_DURATION),
    }, mapHourly, HOURLY_DURATION)
    // ชั่วโมงที่ขออยู่นอกช่วงของรอบโมเดล (เช่น รอบใหม่ยังไม่ออก) — ให้กรมเลือกช่วงเริ่มต้นเอง
    const hourly = !firstTry.ok && firstTry.status === 400
      ? await fetchNwp('hourly', { ...coord, fields: HOURLY_FIELDS, duration: String(HOURLY_DURATION) }, mapHourly, HOURLY_DURATION)
      : firstTry
    const daily = await fetchNwp('daily', {
      ...coord, fields: DAILY_FIELDS, date: now.date, duration: String(DAILY_DURATION),
    }, mapDaily, DAILY_DURATION)

    if (!hourly.ok) errors.push(`${g.tenants.map(t => t.slug).join('/')}: ${hourly.error}`)
    if (!daily.ok) errors.push(`${g.tenants.map(t => t.slug).join('/')}: ${daily.error}`)
    if (!hourly.ok && !daily.ok) continue

    const at = new Date().toISOString()
    const upserts = g.tenants.map(t => ({
      municipality_id: t.id,
      request_lat: Number(coord.lat),
      request_lon: Number(coord.lon),
      updated_at: at,
      ...(hourly.ok ? {
        hourly: hourly.points, hourly_fetched_at: at,
        hourly_grid_lat: hourly.grid?.lat ?? null, hourly_grid_lon: hourly.grid?.lon ?? null,
      } : {}),
      ...(daily.ok ? {
        daily: daily.points, daily_fetched_at: at,
        daily_grid_lat: daily.grid?.lat ?? null, daily_grid_lon: daily.grid?.lon ?? null,
      } : {}),
    }))
    const { error: upsertError } = await admin.from('tmd_forecasts').upsert(upserts, { onConflict: 'municipality_id' })
    if (upsertError) {
      errors.push(`บันทึก ${g.tenants.map(t => t.slug).join('/')}: ${cleanText(upsertError.message, 200)}`)
      continue
    }
    okGroups += 1
    if (daily.ok) for (const t of g.tenants) dailyByTenant.set(t.id, { points: daily.points, fetchedAt: at })
  }

  // ── แจ้งเตือนพยากรณ์ฝนหนัก ──
  const sent: { slug: string; days: number; ok: boolean }[] = []
  if (BOT_TOKEN) {
    const lastDay = addDays(now.date, ALERT_DAYS_AHEAD)
    const recipients = ((rows ?? []) as Tenant[])
      .filter(t => t.telegram_group_id !== null && moduleOn(t) && dailyByTenant.has(t.id))
      .filter(t => !isTest || t.slug === TEST_TENANT_SLUG)

    for (const tenant of recipients) {
      const { points, fetchedAt } = dailyByTenant.get(tenant.id)!
      const alerts: RainAlert[] = []
      for (const p of points) {
        const date = p.time.slice(0, 10)
        if (date < now.date || date > lastDay || p.rain === null || p.rain < HEAVY_RAIN_MM) continue
        const level = p.rain >= VERY_HEAVY_RAIN_MM ? 'veryHeavy' : 'heavy'
        alerts.push({ date, rain: p.rain, level, key: `tmd-rain:${date}:${level}${isTest ? ':test' : ''}` })
      }
      if (!alerts.length) continue

      // claim คีย์ผ่าน unique constraint — ชน = ส่งเรื่องนี้ไปแล้ว ยกเว้นแถวเดิม failed ให้ส่งใหม่
      const claimed: RainAlert[] = []
      for (const a of alerts) {
        const { error } = await admin.from('notification_deliveries').insert({
          municipality_id: tenant.id,
          channel: 'telegram',
          notification_type: NOTIFICATION_TYPE,
          resource_type: 'tmd_forecast',
          resource_id: tenant.id,
          idempotency_key: a.key,
          status: 'pending',
        })
        if (!error) { claimed.push(a); continue }
        if (error.code !== '23505') {
          console.error('[tmd-sync] claim ไม่สำเร็จ:', tenant.slug, error.code, error.message)
          continue
        }
        const { data: existing } = await admin.from('notification_deliveries')
          .select('status').eq('municipality_id', tenant.id).eq('channel', 'telegram')
          .eq('idempotency_key', a.key).maybeSingle()
        if (existing?.status === 'failed') claimed.push(a)
      }
      if (!claimed.length) continue

      const result = await sendTelegramMessage(String(tenant.telegram_group_id), renderMessage(tenant, claimed, fetchedAt, isTest), BOT_TOKEN)
      for (const a of claimed) {
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
          .eq('idempotency_key', a.key)
      }
      sent.push({ slug: tenant.slug, days: claimed.length, ok: result.ok })
    }
  }

  // ทุกพิกัดล้ม = รอบนี้พัง (ตัวเฝ้าระวังเห็น last_error) · ล้มบางพิกัดยังนับว่าทำงาน แต่ส่งรายละเอียดกลับ
  if (!okGroups) return await fail(errors.join(' | ') || 'ดึงไม่สำเร็จทุกพิกัด', 502)
  if (!isTest) await recordHeartbeat(admin, { ok: true })
  return json({ ok: true, test: isTest, points: groups.size, okPoints: okGroups, errors, skipped, sent })
})
