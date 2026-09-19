// ตัวช่วยของหน้า "สถานการณ์น้ำ-ฝน" (src/pages/WaterSituationPage.jsx) — ฟังก์ชันล้วน ทดสอบได้ใน node
// (tests/water-situation.test.mjs)
//
// ข้อมูลมาจาก get_public_water_situation() ซึ่ง Edge Function thaiwater-sync ดึงจากคลังข้อมูลน้ำ
// แห่งชาติ (ThaiWater, สสน.) มาเก็บทุกชั่วโมง — ไฟล์นี้แค่จัดรูปแบบการแสดงผล ไม่ประเมินสถานการณ์เอง
// ป้ายสถานการณ์ "ระดับน้ำ" (น้ำปกติ/น้ำมาก/…) มากับข้อมูลจากต้นทางแล้ว ห้ามเขียนเกณฑ์ซ้ำที่นี่
// ส่วนฝนกับอ่างเก็บน้ำต้นทางไม่ส่งเกณฑ์มา จึงเทียบกับเกณฑ์ทางการที่อ้างที่มาไว้ (RAIN_LEVELS / DAM_LEVELS)

const TZ = 'Asia/Bangkok'

// ข้อมูลถือว่า "ไม่เป็นปัจจุบัน" เมื่อเก่ากว่านี้
// สถานี: บางหน่วยงานส่งค่าช้ากว่าเวลาวัดราว 1.5 ชม. + ระบบดึงชั่วโมงละครั้ง ปกติจึงเก่าได้ถึง ~2.5 ชม.
// ระบบ: ดึงทุกชั่วโมง พลาดรอบเดียวยังไม่เตือน พลาด 2 รอบติดค่อยเตือน
export const STATION_STALE_HOURS = 3
export const SYNC_STALE_HOURS = 2

// ระดับน้ำต่างกันน้อยกว่านี้ถือว่าทรงตัว — ค่าวัดแกว่งระดับเซนติเมตรเป็นปกติ
export const TREND_FLAT_M = 0.02

// สถานะสถานีเตือนภัยน้ำหลาก-ดินถล่มของกรมทรัพยากรน้ำ (แถวชนิด ews) เก่ากว่านี้ถือว่าไม่เป็นปัจจุบัน
// สถานะของต้นทางค้างได้นาน และเกณฑ์ฝนของระบบนี้ใช้ฝนสะสม 12 ชม. (สมมติฐาน — ต้องตรงกับ FRESH_HOURS
// ใน supabase/functions/ews-warning-notify ไม่งั้นเว็บกับ Telegram จะบอกคนละอย่าง)
export const EWS_FRESH_HOURS = 12

// ป้ายสำรองเผื่อแถวไม่มีข้อความ — ปกติ thaiwater-sync ใส่ป้าย/สีตามหน้าเว็บ ews.dwr.go.th ให้แล้ว
const EWS_FALLBACK_TEXT = { 1: 'เฝ้าระวัง', 2: 'เตรียมพร้อม', 3: 'วิกฤติ' }

// เกณฑ์ปริมาณฝนของกรมอุตุนิยมวิทยา (https://www.tmd.go.th/info/เกณฑ์อากาศ ตรวจ 2569-09-18)
//   ฝนเล็กน้อย 0.1–10.0 · ฝนปานกลาง 10.1–35.0 · ฝนหนัก 35.1–90.0 · ฝนหนักมาก 90.1 มม. ขึ้นไป
// ต่ำกว่า 0.1 มม. ไม่อยู่ในเกณฑ์ จึงแสดงว่า "ไม่มีฝน"
// ค่าของสถานีเป็นฝนสะสม 24 ชั่วโมงล่าสุด ไม่ใช่ช่วง 07.00–07.00 น. แบบรายงานประจำวันของกรมอุตุฯ
// ใช้เกณฑ์นี้เป็นแนวเทียบให้อ่านตัวเลขง่ายขึ้น ไม่ใช่การประกาศสภาพอากาศ
// bar = สีแท่งเทียบฝน ไล่เข้มตามเกณฑ์เดียวกับป้าย (chip) — คนละชุดกับสีอ่างเก็บน้ำที่ลอกมาจากต้นฉบับ
export const RAIN_LEVELS = [
  { key: 'none',      label: 'ไม่มีฝน',     below: 0.1,      chip: 'bg-gray-100 text-gray-500',   bar: '#d1d5db' },
  { key: 'light',     label: 'ฝนเล็กน้อย',  upTo: 10.0,      chip: 'bg-sky-50 text-sky-700',      bar: '#7dd3fc' },
  { key: 'moderate',  label: 'ฝนปานกลาง',  upTo: 35.0,      chip: 'bg-blue-100 text-blue-800',   bar: '#3b82f6' },
  { key: 'heavy',     label: 'ฝนหนัก',      upTo: 90.0,      chip: 'bg-amber-100 text-amber-800', bar: '#f59e0b' },
  { key: 'veryHeavy', label: 'ฝนหนักมาก',   upTo: Infinity,  chip: 'bg-rose-100 text-rose-700',   bar: '#e11d48' },
]

// ขอบล่างของเกณฑ์ "ฝนหนักมาก" — หมุดอ้างอิงบนแท่งเทียบฝน (ต่อจากขอบบนของเกณฑ์ฝนหนัก 90.0)
export const RAIN_VERY_HEAVY_MM = 90.1

// เกณฑ์ปริมาณน้ำในอ่างเก็บน้ำ — % ของความจุที่ระดับเก็บกักปกติ (รนก.) ซึ่งเป็นฐานเดียวกับ storage_percent
//   ป้าย + สี: รายงานสถานภาพน้ำเขื่อนของ สสน. หัวข้อ "สีระดับเกณฑ์ (%รนก.)"
//     https://tiwrm.hii.or.th/DATA/REPORT/php/rid_bigcm.html (คัดจาก HTML ต้นฉบับ 2569-09-19)
//   ช่วงเดียวกันนี้ใช้กับ "อ่างเก็บน้ำขนาดกลาง" ในระบบฐานข้อมูลอ่างเก็บน้ำของกรมชลประทาน
//     https://app.rid.go.th/reservoir/ (≤30 · 31–50 · 51–80 · 81–100 · >100)
// ⚠️ ใช้สีตามต้นฉบับตรงตัว ห้าม "ปรับให้เข้าใจง่าย" — เขียวคือ "น้ำน้อย" ไม่ใช่ "ปกติ" และแดงคือ
//    อ่างใกล้เต็ม ถ้าเปลี่ยนสี ประชาชนที่เปิดเว็บกรมชลประทานเทียบจะเห็นไม่ตรงกัน
export const DAM_LEVELS = [
  { key: 'critical', label: 'น้ำน้อยวิกฤติ',     range: '≤30%',    upTo: 30,       color: '#FFC000' },
  { key: 'low',      label: 'น้ำน้อย',          range: '30–50%',  upTo: 50,       color: '#00B050' },
  { key: 'moderate', label: 'น้ำปานกลาง',       range: '50–80%',  upTo: 80,       color: '#003CFA' },
  { key: 'high',     label: 'น้ำมาก',           range: '80–100%', upTo: 100,      color: '#FF0000' },
  { key: 'over',     label: 'เกินความจุเก็บกัก', range: '>100%',   upTo: Infinity, color: '#C70000' },
]

// ข้อมูลอ่างเป็นรายวันของกรมชลประทาน (1 ค่าต่อวัน เก็บเป็นเที่ยงคืนของวันนั้น) — ถ้าใช้ 3 ชม.
// แบบสถานีโทรมาตร จะขึ้น "ไม่มีค่าใหม่" ตั้งแต่ตี 3 ทุกวัน · 48 ชม. = ยอมให้ค่าของเมื่อวานค้างได้
// จนหมดวันนี้ก่อนค่อยเตือน
export const DAM_STALE_HOURS = 48

// ปริมาตรต่างกันน้อยกว่านี้ถือว่าทรงตัว (ล้าน ลบ.ม.) — ต้นทางปัดทศนิยม 2 ตำแหน่ง
export const DAM_TREND_FLAT_MCM = 0.01

export function toNum(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function rainLevel(mm) {
  const v = toNum(mm)
  if (v === null || v < 0) return null
  if (v < RAIN_LEVELS[0].below) return RAIN_LEVELS[0]
  return RAIN_LEVELS.slice(1).find(level => v <= level.upTo)
}

// "132.5" / "2" / "0" — ไม่เติม .0 ให้เลขกลม ตัวเลขยาวทำให้แถวแน่นบนมือถือ
export function formatMm(mm) {
  const v = toNum(mm)
  return v === null ? '–' : v.toLocaleString('th-TH', { maximumFractionDigits: 1 })
}

// bank_diff_m = ตลิ่งต่ำสุด − ระดับน้ำ (บวก = ต่ำกว่าตลิ่ง)
export function bankText(diff) {
  const d = toNum(diff)
  if (d === null) return null
  if (Math.abs(d) < 0.005) return 'ระดับน้ำเสมอตลิ่ง'
  return d > 0 ? `ต่ำกว่าตลิ่ง ${d.toFixed(2)} ม.` : `สูงกว่าตลิ่ง ${Math.abs(d).toFixed(2)} ม.`
}

export function waterTrend(current, previous) {
  const a = toNum(current)
  const b = toNum(previous)
  if (a === null || b === null) return null
  const diff = Math.round((a - b) * 100) / 100
  if (Math.abs(diff) < TREND_FLAT_M) return { dir: 'flat', diff: 0, label: 'ทรงตัว' }
  return diff > 0
    ? { dir: 'up', diff, label: `น้ำขึ้น ${diff.toFixed(2)} ม.` }
    : { dir: 'down', diff, label: `น้ำลง ${Math.abs(diff).toFixed(2)} ม.` }
}

export function damLevel(percent) {
  const v = toNum(percent)
  if (v === null || v < 0) return null
  return DAM_LEVELS.find(level => v <= level.upTo)
}

// ปริมาตรน้ำ ล้าน ลบ.ม. — "5.99" / "30.62" / "0.4" ทศนิยมไม่เกิน 2 ตำแหน่งตามต้นทาง
export function formatMcm(value) {
  const v = toNum(value)
  return v === null ? '–' : v.toLocaleString('th-TH', { maximumFractionDigits: 2 })
}

// เทียบปริมาตรกับเมื่อวาน (prev_dam_storage_mcm จาก RPC = ค่าที่เก่ากว่า 20 ชม.–3 วัน)
export function damTrend(current, previous) {
  const a = toNum(current)
  const b = toNum(previous)
  if (a === null || b === null) return null
  const diff = Math.round((a - b) * 100) / 100
  if (Math.abs(diff) < DAM_TREND_FLAT_MCM) return { dir: 'flat', diff: 0, label: 'ทรงตัว' }
  return diff > 0
    ? { dir: 'up', diff, label: `เพิ่ม ${formatMcm(diff)} ล้าน ลบ.ม.` }
    : { dir: 'down', diff, label: `ลด ${formatMcm(Math.abs(diff))} ล้าน ลบ.ม.` }
}

// ป้ายเตือนภัยของสถานีหนึ่ง — คืน null เมื่อไม่ต้องแสดง
// แสดงเฉพาะระดับ 1–3: ค่าอื่นของต้นทาง (0, 9, ติดลบ) เว็บของเขาเองแสดงเป็น "ปกติ" แต่ไม่มีเอกสาร
// อธิบาย 9 ที่สถานีครึ่งประเทศเป็นอยู่ จึงไม่แปลความให้ประชาชนวางใจว่า "ปกติ"
export function ewsAlert(station, now) {
  const level = toNum(station?.situation_level)
  if (level === null || !Number.isInteger(level) || level < 1 || level > 3) return null
  if (!station.recorded_at) return null
  return {
    level,
    text: station.situation_text || EWS_FALLBACK_TEXT[level],
    color: safeColor(station.situation_color),
    stale: isStale(station.recorded_at, now, EWS_FRESH_HOURS),
  }
}

// เรื่องที่ต้องขึ้นแถบเตือนบนสุดของหน้า — ใช้กติกาเดียวกับ Telegram (water-alert-notify)
//   ฝนหนักมาก: สถานีฝนของ อปท. ระดับ veryHeavy ตาม RAIN_LEVELS (กรมอุตุฯ) ที่ค่ายังเป็นปัจจุบัน
//   สสน.: ข้อความเตือนของอำเภอตัวเองที่ RPC คัดมาแล้ว (24 ชม. ล่าสุดของแต่ละสถานี) — แสดงตามต้นฉบับ
//   สถานีเตือนภัย ทน.: ระดับ "เตรียมพร้อม" ขึ้นไปที่สถานะยังเป็นปัจจุบัน (ปิดอยู่ ไม่มีแถวส่งมา)
export function buildAlerts({ rain = [], ews = [], warnings = [], now }) {
  const heavyRain = rain
    .filter(s => rainLevel(s.rain_24h_mm)?.key === 'veryHeavy' && s.recorded_at && !isStale(s.recorded_at, now, STATION_STALE_HOURS))
    .sort((a, b) => toNum(b.rain_24h_mm) - toNum(a.rain_24h_mm))
  const ewsActive = ews
    .map(s => ({ station: s, alert: ewsAlert(s, now) }))
    .filter(x => x.alert && !x.alert.stale && x.alert.level >= 2)
    .sort((a, b) => b.alert.level - a.alert.level || (toNum(a.station.distance_km) ?? 99) - (toNum(b.station.distance_km) ?? 99))
  // RPC ตัดที่ 24 ชม. แล้ว แต่เมื่อเน็ตขาดหน้าเว็บจะเก็บคำตอบเดิมไว้ จึงต้องตรวจซ้ำตามเวลาปัจจุบัน
  const official = (Array.isArray(warnings) ? warnings : []).filter(w => {
    if (typeof w?.message !== 'string' || !w.message.trim() || !w.issued_at) return false
    const age = toMillis(now) - new Date(w.issued_at).getTime()
    return Number.isFinite(age) && age >= 0 && age < 24 * 60 * 60 * 1000
  })
  return {
    heavyRain,
    warnings: official,
    ews: ewsActive,
    any: heavyRain.length > 0 || official.length > 0 || ewsActive.length > 0,
  }
}

export function isStale(iso, now, hours) {
  if (!iso) return true
  const at = new Date(iso).getTime()
  if (Number.isNaN(at)) return true
  return toMillis(now) - at > hours * 60 * 60 * 1000
}

function toMillis(now) {
  return now instanceof Date ? now.getTime() : Number(now)
}

function bangkokDay(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

// "10:00 น." ถ้าเป็นวันนี้ · "17 ก.ย. 22:00 น." ถ้าเป็นวันอื่น — ยึดเวลาไทยเสมอ เพราะเวลาที่สถานีวัด
// คือเวลาไทย คนเปิดดูจากเครื่องที่ตั้ง timezone อื่นต้องเห็นเลขเดียวกับบนเว็บของ สสน.
export function measuredAtText(iso, now) {
  if (!iso) return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const time = at.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ })
  if (bangkokDay(at) === bangkokDay(new Date(toMillis(now)))) return `${time} น.`
  const day = at.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: TZ })
  return `${day} ${time} น.`
}

// ข้อมูลรายวัน (อ่างเก็บน้ำ) ไม่มีเวลาวัด — "วันนี้" หรือ "18 ก.ย." ห้ามโชว์ "00:00 น." ให้เข้าใจผิด
export function dataDayText(iso, now) {
  if (!iso) return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  if (bangkokDay(at) === bangkokDay(new Date(toMillis(now)))) return 'วันนี้'
  return at.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: TZ })
}

// "ต.บ้านเวียง" ถ้าอยู่อำเภอเดียวกับสำนักงาน · "ต.น้ำรัด อ.หนองม่วงไข่" ถ้าอยู่นอกอำเภอ
// ตั้งใจโชว์อำเภอเฉพาะตอนต่างกัน — สถานีระดับน้ำที่ใกล้ที่สุดมักอยู่นอกอำเภอ ต้องเห็นชัดว่าไม่ได้วัดในพื้นที่
export function stationPlace(station, homeAmphoe) {
  const parts = []
  if (station?.tambon_name) parts.push(`ต.${station.tambon_name}`)
  if (station?.amphoe_name && station.amphoe_name !== homeAmphoe) parts.push(`อ.${station.amphoe_name}`)
  return parts.join(' ')
}

export function distanceText(km) {
  const v = toNum(km)
  return v === null ? '' : `ห่าง ${v.toLocaleString('th-TH', { maximumFractionDigits: 1 })} กม.`
}

export function mapUrl(lat, lon) {
  const a = toNum(lat)
  const b = toNum(lon)
  if (a === null || b === null || Math.abs(a) > 90 || Math.abs(b) > 180) return null
  return `https://www.google.com/maps/search/?api=1&query=${a},${b}`
}

// สีจากต้นทางใช้ได้เฉพาะรูปแบบ #RRGGBB — กันค่าแปลกหลุดเข้า style
export function safeColor(color, fallback = '#9ca3af') {
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : fallback
}

/* ───────── อินโฟกราฟิก ─────────
   ตัวเลขทั้งหมดในหมวดนี้เป็นแค่การ "วาดค่าที่ต้นทางส่งมา" ให้เทียบด้วยตาได้
   ห้ามคำนวณค่าใหม่ที่ต้นทางไม่ได้ให้ (เช่น เดาระดับตลิ่งจากระดับน้ำ) — ภาพต้องตรงกับตัวเลขบนการ์ดเสมอ */

// ความกว้างแท่ง (%) ของค่า value บนสเกล 0..max — กันค่าติดลบ/เกินสเกลไม่ให้ล้นกรอบ
export function barPercent(value, max) {
  const v = toNum(value)
  const m = toNum(max)
  if (v === null || m === null || m <= 0 || v <= 0) return 0
  return Math.min(100, (v / m) * 100)
}

// สเกลร่วมของแท่งเทียบฝน — ทุกสถานีใช้สเกลเดียวกันถึงจะเทียบกันได้
// เริ่มที่ 100 มม. เพื่อให้หมุด "ฝนหนักมาก" (90.1) อยู่ในแถบเสมอ วันที่ฝนแรงกว่านั้นค่อยขยายทีละ 10
export function rainBarMax(stations = []) {
  const top = stations.reduce((max, s) => Math.max(max, toNum(s?.rain_24h_mm) ?? 0), 0)
  return Math.max(100, Math.ceil(top / 10) * 10)
}

// หมุดเกณฑ์บนแท่งอ่างเก็บน้ำ — ขอบบนของแต่ละช่วงใน DAM_LEVELS ที่ยังอยู่ในแถบ (100% คือปลายแถบ ไม่ต้องขีด)
// อ่านจาก DAM_LEVELS จุดเดียว เปลี่ยนเกณฑ์ที่นั่นแล้วหมุดขยับตาม
export function damTicks() {
  return DAM_LEVELS.map(l => l.upTo).filter(v => Number.isFinite(v) && v < 100)
}

// เทียบน้ำไหลลงอ่างกับน้ำระบายในวันเดียวกัน — สเกลของการ์ดนี้เอง (อ่างคนละขนาดเทียบข้ามกันไม่ได้)
export function flowCompare(inflow, released) {
  const a = toNum(inflow)
  const b = toNum(released)
  if (a === null && b === null) return null
  const max = Math.max(a ?? 0, b ?? 0)
  const net = a !== null && b !== null ? Math.round((a - b) * 100) / 100 : null
  return {
    inflow: a,
    released: b,
    inflowPct: barPercent(a, max),
    releasedPct: barPercent(b, max),
    net,
    netLabel: net === null ? null
      : Math.abs(net) < DAM_TREND_FLAT_MCM ? 'เข้า-ออกพอๆ กัน'
      : net > 0 ? `เข้ามากกว่าออก ${formatMcm(net)} ล้าน ลบ.ม.`
      : `ออกมากกว่าเข้า ${formatMcm(Math.abs(net))} ล้าน ลบ.ม.`,
  }
}

// สัดส่วนน้ำในภาพตัดขวางลำน้ำ (0–1) จาก storage_percent = ความจุลำน้ำที่ต้นทางส่งมา
// ไม่มีค่านี้ = วาดภาพไม่ได้ ห้ามเดาจาก bank_diff_m เพราะไม่รู้ความลึกของลำน้ำ
export function channelFill(percent) {
  const v = toNum(percent)
  if (v === null || v < 0) return null
  return Math.min(1, v / 100)
}

// 3 ตัวเลขสรุปบนสุดของหน้า — ใช้เฉพาะสถานีที่ค่ายังเป็นปัจจุบัน หมวดไหนไม่มีข้อมูลก็ไม่ต้องขึ้นการ์ด
// อ่างเก็บน้ำรวมเป็นก้อนเดียวด้วยปริมาตรรวม ÷ ความจุรวม (ไม่ใช่เฉลี่ย % รายอ่าง ซึ่งให้น้ำหนัก
// อ่างเล็กเท่าอ่างใหญ่) · ระดับน้ำเลือกสถานีที่ "ใกล้ตลิ่งที่สุด" = bank_diff_m น้อยที่สุด
export function summaryStats({ rain = [], dams = [], levels = [], now }) {
  const fresh = (list, hours) => list.filter(s => s?.recorded_at && !isStale(s.recorded_at, now, hours))

  const rainRows = fresh(rain, STATION_STALE_HOURS).filter(s => toNum(s.rain_24h_mm) !== null)
  const topRain = rainRows.slice().sort((a, b) => toNum(b.rain_24h_mm) - toNum(a.rain_24h_mm))[0] ?? null

  const damRows = fresh(dams, DAM_STALE_HOURS)
    .filter(s => toNum(s.dam_storage_mcm) !== null && (toNum(s.dam_capacity_mcm) ?? 0) > 0)
  const storage = damRows.reduce((sum, s) => sum + toNum(s.dam_storage_mcm), 0)
  const capacity = damRows.reduce((sum, s) => sum + toNum(s.dam_capacity_mcm), 0)
  const damPercent = capacity > 0 ? (storage / capacity) * 100 : null

  const levelRows = fresh(levels, STATION_STALE_HOURS).filter(s => toNum(s.bank_diff_m) !== null)
  const nearest = levelRows.slice().sort((a, b) => toNum(a.bank_diff_m) - toNum(b.bank_diff_m))[0] ?? null

  return {
    rain: topRain ? { station: topRain, mm: toNum(topRain.rain_24h_mm), level: rainLevel(topRain.rain_24h_mm) } : null,
    dam: damPercent === null ? null
      : { percent: damPercent, count: damRows.length, storage, capacity, level: damLevel(damPercent) },
    bank: nearest ? { station: nearest, diff: toNum(nearest.bank_diff_m), text: bankText(nearest.bank_diff_m) } : null,
    any: Boolean(topRain) || damPercent !== null || Boolean(nearest),
  }
}
