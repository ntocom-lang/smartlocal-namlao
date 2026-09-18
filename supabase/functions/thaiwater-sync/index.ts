// Supabase Edge Function: thaiwater-sync
// Deploy: npx --no-install supabase functions deploy thaiwater-sync --no-verify-jwt --project-ref <ref>
//   --no-verify-jwt จำเป็น: pg_cron ยิงผ่าน net.http_post โดยไม่มี JWT (มีแค่ x-cron-secret)
//   ถ้า deploy แบบ verify_jwt ปกติ gateway จะตอบ 401 เองก่อนถึงโค้ดนี้ทุกรอบ
// Secret: THAIWATER_CRON_SECRET — ค่าเดียวกับ vault secret 'thaiwater_cron_secret'
//   (ตั้งใจแยกจาก CRON_SECRET ของ fleet-doc-expiry-notify ดูเหตุผลใน 20260918150500)
//
// เรียกโดย pg_cron ทุกชั่วโมงเท่านั้น (20260918150500_water_situation_cron.sql) ไม่มีโค้ดฝั่ง client เรียก
// ดึงข้อมูลฝน/ระดับน้ำ/อ่างเก็บน้ำขนาดกลางจากคลังข้อมูลน้ำแห่งชาติ (ThaiWater, สสน.) แล้วเก็บเฉพาะ
// สถานีที่ water_station_config ของทุก อปท. ระบุไว้ — ดึงรอบเดียวใช้ร่วมทุก อปท. ไม่วนยิงราย อปท.
// หน้าเว็บอ่านผ่าน get_public_water_situation() ไม่ยิงไปต้นทางเอง
//
// ต้นทางเป็น API สาธารณะที่ไม่มี key และไม่มีเอกสารเงื่อนไขการใช้งาน (ตรวจ 2569-09-18)
// จึงดึงแค่ชั่วโมงละครั้ง และขอเฉพาะ endpoint ที่มีสถานีต้องใช้จริง
// ⚠️ ห้ามเปลี่ยนไปใช้ twa-api-public.thaiwater.net (API ของหน้าแผนที่ใหม่) — ต้องแนบ x-api-key ที่
//    สสน. ฝังไว้ในเว็บตัวเอง การเอากุญแจนั้นมาใช้ไม่ใช่การเรียก API สาธารณะ

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const CRON_SECRET = Deno.env.get('THAIWATER_CRON_SECRET')

const API_BASE = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public'
const RAIN_URL = `${API_BASE}/rain_24h`               // ~4.7 MB ทั้งประเทศ
const WATERLEVEL_URL = `${API_BASE}/waterlevel_load`  // ~1.9 MB ทั้งประเทศ
// อ่างเก็บน้ำอยู่นอก /public (ไม่มีชุดอ่างใน /public — ไล่ลองแล้ว 404 ทุกชื่อ) ~1 MB
// ใช้เฉพาะก้อน dam_medium (อ่างขนาดกลาง ข้อมูลรายวันของกรมชลประทาน)
const DAM_URL = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/analyst/dam'

// งบเวลารวมต้องจบก่อน pg_net ตัดสาย (timeout_milliseconds 60000 ใน cron)
// 15 วิ × 3 ครั้ง + พัก 1+2 วิ = 48 วิ ต่อ endpoint (ทุก endpoint ยิงขนานกัน)
const FETCH_TIMEOUT_MS = 15_000
const MAX_ATTEMPTS = 3
const DEADLINE_MS = 50_000
// ค่าที่เก่ากว่านี้ไม่เก็บ — ตรงกับที่ cleanup_old_water_readings() ลบทิ้งอยู่แล้ว
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
// เวลาในอนาคตเกินนี้ถือว่าข้อมูลผิด (นาฬิกาสถานีเพี้ยน)
const MAX_FUTURE_MS = 2 * 60 * 60 * 1000

type StationConfig = { id: string; station_type: 'rain' | 'waterlevel' | 'dam'; station_code: string }
type FetchResult = { ok: true; data: unknown } | { ok: false; error: string }
type Json = Record<string, unknown>

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// เทียบ secret แบบใช้เวลาเท่ากันทุกกรณี — ไม่ให้เดาค่าจากเวลาตอบกลับได้
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  let diff = x.length ^ y.length
  const len = Math.max(x.length, y.length)
  for (let i = 0; i < len; i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

function asObject(value: unknown): Json | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : null
}

// ต้นทางส่งตัวเลขปนกันทั้ง number และ string ("172.84") — ค่าผิดรูปคืน null ไม่ throw
function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  return Number.isFinite(n) ? n : null
}

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits

// ต้นทางส่ง "2026-09-18 10:00" (บางชุดมีวินาที) เป็นเวลาไทย ไม่มี offset — ตีความเป็น +07:00 เสมอ
// ห้ามส่งเข้า new Date() ตรงๆ: จะถูกอ่านเป็นเวลาเครื่องเซิร์ฟเวอร์ (UTC) เพี้ยนไป 7 ชั่วโมง
function parseBangkokDatetime(value: unknown, now: number): string | null {
  const m = String(value ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null
  const at = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}+07:00`)
  const t = at.getTime()
  if (Number.isNaN(t) || t > now + MAX_FUTURE_MS || t < now - MAX_AGE_MS) return null
  return at.toISOString()
}

// ข้อมูลอ่างเป็นรายวัน ต้นทางส่ง dam_date "2026-09-18" → เก็บเป็นเที่ยงคืนเวลาไทยของวันนั้น
// อ่านแค่ 10 ตัวแรก เผื่อต้นทางเติมเวลาต่อท้ายในอนาคต (วันที่คือสิ่งเดียวที่มีความหมายสำหรับข้อมูลรายวัน)
// แถวที่ไม่มีข้อมูลจริงของต้นทางมาเป็น "1970-01-01" — ตกเกณฑ์ MAX_AGE_MS ทิ้งเองตรงนี้
function parseBangkokDate(value: unknown, now: number): string | null {
  const m = String(value ?? '').trim().slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const at = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+07:00`)
  const t = at.getTime()
  if (Number.isNaN(t) || t > now + MAX_FUTURE_MS || t < now - MAX_AGE_MS) return null
  return at.toISOString()
}

async function fetchWithRetry(url: string, startedAt: number): Promise<FetchResult> {
  let lastError = 'fetch failed'
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (Date.now() - startedAt > DEADLINE_MS) return { ok: false, error: `deadline exceeded (${lastError})` }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'SmartLocal-WaterSituation/1.0' },
      })
      if (res.ok) {
        const data = await res.json()
        clearTimeout(timer)
        return { ok: true, data }
      }
      clearTimeout(timer)
      await res.body?.cancel()
      lastError = `HTTP ${res.status}`
      // 4xx อื่นนอกจาก 429 = ต้นทางปฏิเสธจริง ลองซ้ำไปก็ได้ผลเดิม
      if (res.status !== 429 && res.status < 500) break
    } catch (err) {
      clearTimeout(timer)
      lastError = err instanceof Error ? err.message : String(err)
    }
    if (attempt < MAX_ATTEMPTS - 1) await new Promise(r => setTimeout(r, 1000 * 2 ** attempt))
  }
  return { ok: false, error: lastError }
}

// ป้ายและสีสถานการณ์น้ำตามเกณฑ์ที่ต้นทางส่งมาในคำตอบเดียวกัน (scale.data)
//   scale[]   : { trans: 'waterlevel_level_N', situation: 'น้ำปกติ', color: '#00B050' }
//   rule_web[]: { operator: '>', term: '30', level: 3 } — ใช้เมื่อสถานีไม่ได้ส่ง situation_level มา
// ไม่เขียนเกณฑ์ไว้ในโค้ดเอง — ถ้า สสน. ปรับเกณฑ์ ป้ายบนเว็บเปลี่ยนตามโดยไม่ต้องแก้อะไร
function buildSituationLookup(payload: Json | null) {
  const scaleData = asObject(asObject(payload?.scale)?.data)
  const scale = Array.isArray(scaleData?.scale) ? scaleData?.scale as Json[] : []
  const rules = Array.isArray(scaleData?.rule_web) ? scaleData?.rule_web as Json[] : []

  const byLevel = new Map<number, { text: string | null; color: string | null }>()
  for (const entry of scale) {
    const level = Number(String(entry?.trans ?? '').match(/^waterlevel_level_(\d)$/)?.[1])
    if (!Number.isInteger(level)) continue
    const text = typeof entry.situation === 'string' ? entry.situation.trim().slice(0, 40) || null : null
    const color = typeof entry.color === 'string' && /^#[0-9a-f]{6}$/i.test(entry.color) ? entry.color : null
    byLevel.set(level, { text, color })
  }

  function levelFromPercent(percent: number | null): number | null {
    if (percent === null) return null
    for (const rule of rules) {
      const term = num(rule?.term)
      const level = num(rule?.level)
      if (term === null || level === null) continue
      const hit = rule.operator === '>' ? percent > term
        : rule.operator === '>=' ? percent >= term
        : rule.operator === '<' ? percent < term
        : rule.operator === '<=' ? percent <= term
        : false
      if (hit) return level
    }
    return null
  }

  return (rawLevel: unknown, percent: number | null) => {
    const given = num(rawLevel)
    const level = given !== null && Number.isInteger(given) && given >= 1 && given <= 5
      ? given
      : levelFromPercent(percent)
    const label = level !== null ? byLevel.get(level) : undefined
    return { level, text: label?.text ?? null, color: label?.color ?? null }
  }
}

function indexByCode(rows: unknown, wanted: Set<string>) {
  const map = new Map<string, Json>()
  if (!Array.isArray(rows)) return map
  for (const row of rows) {
    const code = asObject(asObject(row)?.station)?.tele_station_oldcode
    if (typeof code === 'string' && wanted.has(code)) map.set(code, row as Json)
  }
  return map
}

// อ่างใช้ dam.id ของต้นทางเป็นตัวชี้ (ไม่มี tele_station_oldcode) — ต้นทางส่งเป็นตัวเลข เทียบเป็นข้อความ
function indexDamsById(rows: unknown, wanted: Set<string>) {
  const map = new Map<string, Json>()
  if (!Array.isArray(rows)) return map
  for (const row of rows) {
    const id = asObject(asObject(row)?.dam)?.id
    const code = typeof id === 'number' || typeof id === 'string' ? String(id).trim() : ''
    if (code && wanted.has(code)) map.set(code, row as Json)
  }
  return map
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405)

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: 'server not configured' }, 500)
  }
  if (!CRON_SECRET) {
    return json({ ok: false, error: 'THAIWATER_CRON_SECRET is not configured' }, 500)
  }
  if (!safeEqual(req.headers.get('x-cron-secret') ?? '', CRON_SECRET)) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }

  const startedAt = Date.now()
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: configRows, error: configError } = await admin
    .from('water_station_config')
    .select('id, station_type, station_code')
    .eq('is_active', true)
  if (configError) {
    console.error('[thaiwater-sync] read config failed:', configError.message)
    return json({ ok: false, error: 'read config failed' }, 500)
  }

  const stations = (configRows ?? []) as StationConfig[]
  if (stations.length === 0) return json({ ok: true, summary: { configured: 0 } })

  const rainCodes = new Set(stations.filter(s => s.station_type === 'rain').map(s => s.station_code))
  const levelCodes = new Set(stations.filter(s => s.station_type === 'waterlevel').map(s => s.station_code))
  const damCodes = new Set(stations.filter(s => s.station_type === 'dam').map(s => s.station_code))

  // ขอเฉพาะ endpoint ที่มีสถานีต้องใช้จริง — ไม่ดึงก้อนใหญ่ทิ้งเปล่า
  const skipped: FetchResult = { ok: true, data: null }
  const [rainResult, levelResult, damResult] = await Promise.all([
    rainCodes.size ? fetchWithRetry(RAIN_URL, startedAt) : Promise.resolve(skipped),
    levelCodes.size ? fetchWithRetry(WATERLEVEL_URL, startedAt) : Promise.resolve(skipped),
    damCodes.size ? fetchWithRetry(DAM_URL, startedAt) : Promise.resolve(skipped),
  ])

  const rainPayload = rainResult.ok ? asObject(rainResult.data) : null
  const levelPayload = levelResult.ok ? asObject(levelResult.data) : null
  const damPayload = damResult.ok ? asObject(damResult.data) : null
  const rainByCode = indexByCode(rainPayload?.data, rainCodes)
  const levelByCode = indexByCode(asObject(levelPayload?.waterlevel_data)?.data, levelCodes)
  const damById = indexDamsById(asObject(damPayload?.data)?.dam_medium, damCodes)
  const situationOf = buildSituationLookup(levelPayload)

  const now = Date.now()
  const fetchedAt = new Date(now).toISOString()
  const rows: Json[] = []
  const unmatched: string[] = []

  for (const station of stations) {
    if (station.station_type === 'rain') {
      const r = rainByCode.get(station.station_code)
      const recordedAt = r ? parseBangkokDatetime(r.rainfall_datetime, now) : null
      const rain24 = r ? num(r.rain_24h) : null
      const rain1 = r ? num(r.rain_1h) : null
      if (!recordedAt || rain24 === null || rain24 < 0) { unmatched.push(station.station_code); continue }
      rows.push({
        station_config_id: station.id,
        recorded_at: recordedAt,
        fetched_at: fetchedAt,
        rain_24h_mm: rain24,
        rain_1h_mm: rain1 !== null && rain1 >= 0 ? rain1 : null,
      })
      continue
    }

    if (station.station_type === 'dam') {
      const d = damById.get(station.station_code)
      const recordedAt = d ? parseBangkokDate(d.dam_date, now) : null
      const storage = d ? num(d.dam_storage) : null
      const capacity = d ? num(asObject(d.dam)?.normal_storage) : null
      // ความจุ 0/null = แถวที่ต้นทางมีแค่ชื่ออ่าง ไม่มีข้อมูลจริง (เจอ 356 จาก 862 อ่าง)
      if (!recordedAt || storage === null || storage < 0 || capacity === null || capacity <= 0) {
        unmatched.push(station.station_code)
        continue
      }
      // % ของต้นทางคิดเทียบความจุที่ระดับเก็บกักปกติ (รนก.) ตรงกับที่เราคำนวณเอง — ใช้ของต้นทาง
      // ถ้าหาย ค่อยคำนวณจากปริมาตร ÷ ความจุ (สูตรเดียวกัน)
      const givenPercent = num(d?.dam_storage_percent)
      const inflow = num(d?.dam_inflow)
      const released = num(d?.dam_released)
      rows.push({
        station_config_id: station.id,
        recorded_at: recordedAt,
        fetched_at: fetchedAt,
        dam_storage_mcm: storage,
        dam_capacity_mcm: capacity,
        dam_inflow_mcm: inflow !== null && inflow >= 0 ? inflow : null,
        dam_released_mcm: released !== null && released >= 0 ? released : null,
        storage_percent: givenPercent ?? round(storage / capacity * 100, 2),
      })
      continue
    }

    const r = levelByCode.get(station.station_code)
    const recordedAt = r ? parseBangkokDatetime(r.waterlevel_datetime, now) : null
    const level = r ? num(r.waterlevel_msl) : null
    const percent = r ? num(r.storage_percent) : null
    if (!recordedAt || (level === null && percent === null)) { unmatched.push(station.station_code); continue }
    // ต่ำกว่าตลิ่งกี่เมตร คำนวณเองจากตลิ่งต่ำสุดของสถานี ไม่อ่าน diff_wl_bank_text ของต้นทาง
    // (บางสถานีของต้นทางส่งข้อความ "ล้นตลิ่ง" คู่กับตัวเลขระดับน้ำทั้งก้อน ซึ่งผิดความหมาย)
    const minBank = num(asObject(r?.station)?.min_bank)
    const situation = situationOf(r?.situation_level, percent)
    rows.push({
      station_config_id: station.id,
      recorded_at: recordedAt,
      fetched_at: fetchedAt,
      waterlevel_msl: level,
      bank_diff_m: minBank !== null && level !== null ? round(minBank - level, 2) : null,
      storage_percent: percent,
      situation_level: situation.level,
      situation_text: situation.text,
      situation_color: situation.color,
    })
  }

  let upserted = 0
  if (rows.length) {
    const { error: upsertError } = await admin
      .from('water_readings')
      .upsert(rows, { onConflict: 'station_config_id,recorded_at' })
    if (upsertError) {
      console.error('[thaiwater-sync] upsert failed:', upsertError.message)
      return json({ ok: false, error: 'upsert failed' }, 500)
    }
    upserted = rows.length
  }

  const summary = {
    configured: stations.length,
    upserted,
    unmatched,
    rainFetch: rainCodes.size ? (rainResult.ok ? 'ok' : rainResult.error) : 'skipped',
    waterlevelFetch: levelCodes.size ? (levelResult.ok ? 'ok' : levelResult.error) : 'skipped',
    damFetch: damCodes.size ? (damResult.ok ? 'ok' : damResult.error) : 'skipped',
    elapsedMs: Date.now() - startedAt,
  }
  console.log('[thaiwater-sync]', JSON.stringify(summary))

  // ดึงไม่ได้ทั้งหมด = ต้นทางล่มหรือปิดกั้น → 502 ให้เห็นใน net._http_response
  const anyFetchOk = (rainCodes.size > 0 && rainResult.ok)
    || (levelCodes.size > 0 && levelResult.ok)
    || (damCodes.size > 0 && damResult.ok)
  return json({ ok: anyFetchOk, summary }, anyFetchOk ? 200 : 502)
})
