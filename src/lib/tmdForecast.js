// พยากรณ์อากาศในพื้นที่จากกรมอุตุนิยมวิทยา (NWP) — ฟังก์ชันล้วน ทดสอบด้วย node ได้ (tests/tmd-forecast.test.mjs)
//
// ข้อมูลมาจาก RPC get_public_tmd_forecast(_municipality_id) ซึ่ง Edge Function tmd-sync ดึงเก็บไว้ทุก 3 ชม.
// เบราว์เซอร์ไม่ยิงไป data.tmd.go.th เอง (token อยู่ฝั่ง Edge Function) · ที่มาต้องแสดงบนหน้าเสมอ (เจ้าของระบบสั่ง 2569-11-15)
//
// กติกาที่ห้ามพลาด
//   - null = "ไม่มีค่า" ต้องขึ้น "–" ห้ามแปลงเป็น 0 (0 มม. = พยากรณ์ว่าไม่มีฝน คนละความหมายกับกรมไม่ส่งค่ามา)
//   - เกณฑ์ระดับฝนใช้ RAIN_LEVELS / rainLevel ของ waterSituation.js เท่านั้น ไม่เขียนเกณฑ์ซ้ำ
//     เกณฑ์นั้นเป็นของ "ฝนสะสม 24 ชม." จึงใช้กับพยากรณ์รายวันเท่านั้น · ฝนรายชั่วโมงไม่ติดป้ายระดับ (คนละหน่วยเวลา)
import { formatMm, RAIN_LEVELS, rainLevel, toNum } from './waterSituation.js'
import { POSTER_BADGE_TAG } from './waterAlertPoster.js'

// ข้อความแบรนด์ของระบบ (เจ้าของสั่ง 2569-11-15) — แคปซูลในแถบหัวการ์ด + คำ "Smart City Local" ในแถบท้าย
//   คำขวัญใช้ค่าเดียวกับป้ายหน่วยงานบนภาพแชร์ (import มา ไม่พิมพ์ซ้ำ) · "Smart City Local" ภาพแชร์ไม่ได้ export เป็นค่า จึงประกาศที่นี่
export const SMART_CITY_TAG = POSTER_BADGE_TAG
export const SMART_CITY_LOCAL_WORDS = Object.freeze([['Smart', 'blue'], ['City', 'orange'], ['Local', 'blue']])
// สีของโลโก้ตัวหนังสือ "Smart City Local" แบบเดิม — คัดจาก smartCityMarkSvg ใน src/lib/complaintNewsImage.js (เจ้าของสั่ง 2569-11-12 / ยืนยันใช้แบบนี้ 2569-11-15)
//   Smart/Local ไล่น้ำเงิน · City ไล่ส้มทอง · ขอบขาวหนา + เงาน้ำเงินเข้ม · wifi น้ำเงิน · หมุดแดง · เทสต์เทียบสีกับไฟล์ต้นฉบับ
export const SMART_CITY_COLORS = Object.freeze({
  blue: Object.freeze(['#3b8cff', '#1238a8']),
  orange: Object.freeze(['#ffd23f', '#ff8a00', '#f05a00']),
  shadow: '#0a2470',
  stroke: '#0b2f8f',
  wifi: '#1e5bd8',
  pin: '#e53935',
})

export const TMD_SOURCE_NAME = 'กรมอุตุนิยมวิทยา'
export const TMD_SOURCE_DOC_URL = 'https://data.tmd.go.th/nwpapi/doc/'
export const TMD_SOURCE_TEXT = 'ผลพยากรณ์จากแบบจำลองคอมพิวเตอร์ (NWP)'

// พยากรณ์ที่ดึงมานานกว่านี้ = ขึ้นป้ายเหลือง (tmd-sync ดึงทุก 3 ชม. · เกิน 12 ชม. = พลาดไปอย่างน้อย 3 รอบ)
export const TMD_STALE_HOURS = 12
export const TMD_HOURLY_LIMIT = 48

const TZ = 'Asia/Bangkok'
const HOUR_MS = 60 * 60 * 1000

// ตาราง cond ตามเอกสารของกรม (https://data.tmd.go.th/nwpapi/doc/) — icon = ชื่อไอคอน lucide ที่การ์ดแมปให้
export const TMD_CONDITIONS = Object.freeze({
  1: { label: 'ท้องฟ้าแจ่มใส', icon: 'Sun' },
  2: { label: 'มีเมฆบางส่วน', icon: 'CloudSun' },
  3: { label: 'เมฆเป็นส่วนมาก', icon: 'Cloud' },
  4: { label: 'มีเมฆมาก', icon: 'Cloudy' },
  5: { label: 'ฝนตกเล็กน้อย', icon: 'CloudDrizzle' },
  6: { label: 'ฝนปานกลาง', icon: 'CloudRain' },
  7: { label: 'ฝนตกหนัก', icon: 'CloudRainWind' },
  8: { label: 'ฝนฟ้าคะนอง', icon: 'CloudLightning' },
  9: { label: 'อากาศหนาวจัด', icon: 'Snowflake' },
  10: { label: 'อากาศหนาว', icon: 'ThermometerSnowflake' },
  11: { label: 'อากาศเย็น', icon: 'Thermometer' },
  12: { label: 'อากาศร้อนจัด', icon: 'ThermometerSun' },
})

// cond ที่ไม่อยู่ในตาราง (หรือ null) = null · ห้ามเดาข้อความ
export function conditionInfo(cond) {
  const n = toNum(cond)
  if (n === null || !Number.isInteger(n)) return null
  return TMD_CONDITIONS[n] ?? null
}

function validIso(value) {
  if (typeof value !== 'string') return null
  return Number.isNaN(new Date(value).getTime()) ? null : value
}

function normalizeGrid(grid) {
  const lat = toNum(grid?.lat)
  const lon = toNum(grid?.lon)
  return lat === null || lon === null ? null : { lat, lon }
}

const byTime = (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()

/**
 * จัดรูปผลของ RPC: ตัวเลขเป็น number หรือ null (ไม่แปลง null เป็น 0) · ตัดแถวที่เวลาเสีย · เรียงตามเวลา
 * ไม่มีทั้งรายชั่วโมงและรายวัน = null (หน้าเว็บไม่แสดงการ์ด)
 */
export function normalizeForecast(raw) {
  if (!raw || typeof raw !== 'object') return null
  const hourly = (Array.isArray(raw.hourly) ? raw.hourly : [])
    .map(p => ({ time: validIso(p?.time), rain: toNum(p?.rain), tc: toNum(p?.tc), rh: toNum(p?.rh), cond: toNum(p?.cond) }))
    .filter(p => p.time)
    .sort(byTime)
  const daily = (Array.isArray(raw.daily) ? raw.daily : [])
    // ws10m = ลมสูงสุดของวัน (m/s) · wd10m = ทิศที่ลม "พัดมาจาก" (องศา ตามแบบอุตุนิยมวิทยา) — ไม่มีค่า = null ห้ามเป็น 0
    //   (0 m/s = ลมสงบ · 0° = ลมจากทิศเหนือ คนละความหมายกับกรมไม่ส่งค่า)
    .map(p => ({
      time: validIso(p?.time), rain: toNum(p?.rain), tcMax: toNum(p?.tc_max), tcMin: toNum(p?.tc_min), cond: toNum(p?.cond),
      windMs: toNum(p?.ws10m), windDir: toNum(p?.wd10m),
    }))
    .filter(p => p.time)
    .sort(byTime)
  if (hourly.length === 0 && daily.length === 0) return null
  return {
    hourly,
    daily,
    hourlyFetchedAt: validIso(raw.hourly_fetched_at),
    dailyFetchedAt: validIso(raw.daily_fetched_at),
    hourlyGrid: normalizeGrid(raw.hourly_grid),
    dailyGrid: normalizeGrid(raw.daily_grid),
  }
}

/** โหลดจาก RPC — client ส่งเข้ามา (ทดสอบด้วยของปลอมได้) · error/ไม่มีข้อมูล = { forecast: null } ไม่โยน */
export async function fetchTmdForecast(client, municipalityId) {
  if (!municipalityId) return { forecast: null, error: false }
  try {
    const { data, error } = await client.rpc('get_public_tmd_forecast', { _municipality_id: municipalityId })
    if (error) return { forecast: null, error: true }
    return { forecast: normalizeForecast(data), error: false }
  } catch {
    return { forecast: null, error: true }
  }
}

function toMillis(now) {
  return now instanceof Date ? now.getTime() : Number(now)
}

function bangkokDay(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
}

/**
 * รายชั่วโมงที่ยังไม่ผ่านไป — ตัดแถวที่ชั่วโมงนั้นจบไปแล้ว (เวลา + 1 ชม. ≤ ตอนนี้) แต่ "ชั่วโมงปัจจุบัน" ยังเก็บไว้
 * สมมติฐาน: time ของกรมคือต้นชั่วโมงของค่านั้น (ไม่มีในเอกสารว่าเป็นช่วงก่อนหน้า) — ถ้าผิด ผลคือเก็บเกินไป 1 ชั่วโมง ไม่ใช่ตัดทิ้งเกิน
 */
export function upcomingHours(hourly, now, limit = TMD_HOURLY_LIMIT) {
  const at = toMillis(now)
  return (hourly ?? []).filter(p => new Date(p.time).getTime() + HOUR_MS > at).slice(0, limit)
}

/** รายวันตั้งแต่ "วันนี้" (ตามเวลาไทย) เป็นต้นไป — วันที่ผ่านไปแล้วไม่แสดง */
export function upcomingDays(daily, now) {
  const today = bangkokDay(toMillis(now))
  return (daily ?? []).filter(p => bangkokDay(new Date(p.time).getTime()) >= today)
}

/** "วันนี้" · "พรุ่งนี้" · "วันพุธ 18 พ.ย." (เวลาไทยเสมอ) */
export function dayLabel(iso, now) {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const day = bangkokDay(at.getTime())
  const nowMs = toMillis(now)
  if (day === bangkokDay(nowMs)) return 'วันนี้'
  if (day === bangkokDay(nowMs + 24 * HOUR_MS)) return 'พรุ่งนี้'
  const parts = new Intl.DateTimeFormat('th-TH', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'short' }).formatToParts(at)
  const get = type => parts.find(p => p.type === type)?.value ?? ''
  return `${get('weekday')} ${get('day')} ${get('month')}`
}

/** หัวคอลัมน์วัน: { title: 'วันนี้' | 'พรุ่งนี้' | 'วันพุธ', date: '18 พ.ย.' } (เวลาไทย) · เวลาเสีย = null */
export function dayHeading(iso, now) {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const parts = new Intl.DateTimeFormat('th-TH', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'short' }).formatToParts(at)
  const get = type => parts.find(p => p.type === type)?.value ?? ''
  const day = bangkokDay(at.getTime())
  const nowMs = toMillis(now)
  const isToday = day === bangkokDay(nowMs)
  const title = isToday ? 'วันนี้' : day === bangkokDay(nowMs + 24 * HOUR_MS) ? 'พรุ่งนี้' : get('weekday')
  return { title, date: `${get('day')} ${get('month')}`, isToday }
}

/** "15 – 21 พ.ย. 2569" · ข้ามเดือน "29 พ.ย. – 5 ธ.ค. 2569" · ข้ามปีใส่ปีทั้งสองข้าง (พ.ศ.) · ไม่มีวัน = '' */
export function daysRangeText(days) {
  const list = (days ?? []).filter(d => !Number.isNaN(new Date(d.time).getTime()))
  if (list.length === 0) return ''
  const fmt = iso => {
    const parts = new Intl.DateTimeFormat('th-TH', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }).formatToParts(new Date(iso))
    const get = type => parts.find(p => p.type === type)?.value ?? ''
    return { d: get('day'), m: get('month'), y: get('year') }
  }
  const a = fmt(list[0].time)
  const b = fmt(list[list.length - 1].time)
  if (list.length === 1) return `${a.d} ${a.m} ${a.y}`
  if (a.y !== b.y) return `${a.d} ${a.m} ${a.y} – ${b.d} ${b.m} ${b.y}`
  if (a.m !== b.m) return `${a.d} ${a.m} – ${b.d} ${b.m} ${b.y}`
  return `${a.d} – ${b.d} ${b.m} ${b.y}`
}

/** "08:00" ตามเวลาไทย */
export function hourText(iso) {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  return at.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ })
}

/** อุณหภูมิ "31°" · null = "–" ห้ามเป็น 0° */
export function formatTemp(value) {
  const v = toNum(value)
  return v === null ? '–' : `${Math.round(v)}°`
}

/** อุณหภูมิปัดเป็นจำนวนเต็ม — null = null (ห้ามเป็น 0) · ใช้ในตารางที่แยกตัวเลขใหญ่กับ "°C" ตัวเล็ก */
export function tempRound(value) {
  const v = toNum(value)
  return v === null ? null : Math.round(v)
}

// ── ลม (แถว "ทิศทาง/ความเร็วลม" ของตาราง 7 วัน) ──
// ระดับลม + สี: คัดจากภาพแถบสัญลักษณ์ "ความเร็วลม (กิโลเมตร/ชั่วโมง)" ของกรมอุตุนิยมวิทยา (ภาพคาดหมายสภาวะอากาศ 7 วัน
//   ลมเบา 0–5 ฟ้า · ลมอ่อน 5–10 เขียว · ลมเอื่อย 10–20 เหลือง · ลมปานกลาง 20–30 ส้ม · ลมแรง >30 แดง)
//   ⚠️ ยังไม่ได้เทียบกับเอกสาร/ตัวบทของกรม — คัดจากภาพเท่านั้น · ขอบเป็น "ถึงและรวม" เหมือน RAIN_LEVELS
//   (ภาพของกรมลงสีเขียวให้ 10 km/h และเหลืองให้ 11 km/h จึงตีความขอบบนเป็นรวม)
export const WIND_LEVELS = Object.freeze([
  { key: 'calm',     label: 'ลมเบา',     upTo: 5,        range: '0–5',        chip: 'bg-sky-300 text-sky-950' },
  { key: 'light',    label: 'ลมอ่อน',    upTo: 10,       range: '5–10',       chip: 'bg-green-600 text-white' },
  { key: 'breeze',   label: 'ลมเอื่อย',  upTo: 20,       range: '10–20',      chip: 'bg-yellow-300 text-yellow-950' },
  { key: 'moderate', label: 'ลมปานกลาง', upTo: 30,       range: '20–30',      chip: 'bg-orange-400 text-orange-950' },
  { key: 'strong',   label: 'ลมแรง',     upTo: Infinity, range: 'มากกว่า 30', chip: 'bg-red-600 text-white' },
])

/** m/s → km/h ปัดจำนวนเต็ม (× 3.6) · null/ติดลบ = null */
export function windKmh(ms) {
  const v = toNum(ms)
  return v === null || v < 0 ? null : Math.round(v * 3.6)
}

/** ระดับลมจาก km/h (ค่าที่ปัดแล้ว) · null = null */
export function windLevel(kmh) {
  const v = toNum(kmh)
  if (v === null || v < 0) return null
  return WIND_LEVELS.find(level => v <= level.upTo)
}

// 8 ทิศ: ลมที่ "พัดมาจาก" ทิศนั้น (ตามแบบอุตุนิยมวิทยา · "ลมตะวันออกเฉียงเหนือ" = พัดมาจากตะวันออกเฉียงเหนือ)
const WIND_FROM = ['เหนือ', 'ตะวันออกเฉียงเหนือ', 'ตะวันออก', 'ตะวันออกเฉียงใต้', 'ใต้', 'ตะวันตกเฉียงใต้', 'ตะวันตก', 'ตะวันตกเฉียงเหนือ']

/**
 * ทิศลมจากองศา "ที่พัดมาจาก" → { from: 'ตะวันออกเฉียงเหนือ', toDeg } · toDeg = ทิศที่ลมพัดไป (from + 180) ให้ลูกศรชี้ตามนั้น
 * (ลูกศรชี้ขึ้น = 0° = เหนือ หมุนตามเข็มนาฬิกา) · null/นอกช่วง = null ห้ามเดาเป็นเหนือ
 */
export function windDirection(deg) {
  const v = toNum(deg)
  if (v === null || v < 0 || v > 360) return null
  const index = Math.round((v % 360) / 45) % 8
  return { from: WIND_FROM[index], toDeg: (v + 180) % 360 }
}

/**
 * คำอธิบายระดับฝนพร้อมช่วง มม. สำหรับแถบสัญลักษณ์ — คำนวณจาก RAIN_LEVELS (ไม่เขียนเกณฑ์ซ้ำ)
 * ขอบล่าง = ขอบบนของระดับก่อนหน้า + 0.1 (กรมระบุทศนิยม 1 ตำแหน่ง)
 */
export function rainLegend() {
  return RAIN_LEVELS.map((level, i) => {
    if (i === 0) return { level, range: `ต่ำกว่า ${level.below} มม.` }
    // ระดับแรก (ไม่มีฝน) ระบุเป็น "ต่ำกว่า" (below) ไม่มี upTo — ขอบล่างของระดับถัดไปคือ below ตรงๆ
    const prev = RAIN_LEVELS[i - 1]
    const lower = prev.upTo === undefined ? prev.below : Math.round((prev.upTo + 0.1) * 10) / 10
    return { level, range: Number.isFinite(level.upTo) ? `${lower}–${level.upTo} มม.` : `${lower} มม. ขึ้นไป` }
  })
}

/** ฝนพยากรณ์รายวัน (มม./24 ชม.) → ป้ายระดับตามเกณฑ์กรมอุตุฯ · null/ติดลบ = null (ไม่ติดป้าย) */
export function dailyRainLevel(mm) {
  return rainLevel(mm)
}

/** ข้อความมม. — null = "–" (formatMm ของหน้าเดิม) */
export function rainText(mm) {
  return formatMm(mm)
}

/**
 * สรุปฝนรายชั่วโมงในช่วงที่แสดง: ยอดรวม (เฉพาะชั่วโมงที่มีค่า) · ชั่วโมงที่ตกแรงสุด · จำนวนชั่วโมงที่ไม่มีค่า
 * ทุกชั่วโมงไม่มีค่า → total = null (ไม่ใช่ 0)
 */
export function hourlyRainSummary(hours) {
  let total = null
  let peak = null
  let missing = 0
  for (const h of hours ?? []) {
    if (h.rain === null || h.rain === undefined) { missing += 1; continue }
    total = (total ?? 0) + h.rain
    if (!peak || h.rain > peak.rain) peak = h
  }
  return { total: total === null ? null : Math.round(total * 10) / 10, peak: peak && peak.rain > 0 ? peak : null, missing }
}

/**
 * ความเก่าของพยากรณ์ — ใช้ค่าที่เก่าสุดของสองชุด (ชุดเดียวเก่าก็ถือว่าทั้งการ์ดไม่เป็นปัจจุบัน)
 * ไม่รู้เวลาดึงเลย = stale (ไม่ให้ขึ้นว่าเป็นปัจจุบันโดยไม่มีหลักฐาน)
 */
export function forecastFreshness(forecast, now, hours = TMD_STALE_HOURS) {
  const times = [forecast?.hourlyFetchedAt, forecast?.dailyFetchedAt].filter(Boolean).map(t => new Date(t).getTime())
  if (times.length === 0) return { stale: true, fetchedAt: null }
  const oldest = Math.min(...times)
  return { stale: toMillis(now) - oldest > hours * HOUR_MS, fetchedAt: new Date(oldest).toISOString() }
}

/** "17 พ.ย. 14:03 น." หรือ "14:03 น." ถ้าวันนี้ — ยึดเวลาไทย */
export function fetchedAtText(iso, now) {
  if (!iso) return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const time = `${hourText(iso)} น.`
  if (bangkokDay(at.getTime()) === bangkokDay(toMillis(now))) return time
  const date = at.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: TZ })
  return `${date} ${time}`
}

/** "18.27, 100.30" — จุดกริดของแบบจำลอง (ไม่ใช่พิกัดสำนักงาน) · ไม่มี = '' */
export function gridText(grid) {
  if (!grid) return ''
  return `${grid.lat.toFixed(2)}, ${grid.lon.toFixed(2)}`
}
