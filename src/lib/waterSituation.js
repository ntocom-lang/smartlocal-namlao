// ตัวช่วยของหน้า "สถานการณ์น้ำ-ฝน" (src/pages/WaterSituationPage.jsx) — ฟังก์ชันล้วน ทดสอบได้ใน node
// (tests/water-situation.test.mjs)
//
// ข้อมูลมาจาก get_public_water_situation() ซึ่ง Edge Function thaiwater-sync ดึงจากคลังข้อมูลน้ำ
// แห่งชาติ (ThaiWater, สสน.) มาเก็บทุกชั่วโมง — ไฟล์นี้แค่จัดรูปแบบการแสดงผล ไม่ประเมินสถานการณ์เอง
// ป้ายสถานการณ์น้ำ (น้ำปกติ/น้ำมาก/…) มากับข้อมูลจากต้นทางแล้ว ห้ามเขียนเกณฑ์ซ้ำที่นี่

const TZ = 'Asia/Bangkok'

// ข้อมูลถือว่า "ไม่เป็นปัจจุบัน" เมื่อเก่ากว่านี้
// สถานี: บางหน่วยงานส่งค่าช้ากว่าเวลาวัดราว 1.5 ชม. + ระบบดึงชั่วโมงละครั้ง ปกติจึงเก่าได้ถึง ~2.5 ชม.
// ระบบ: ดึงทุกชั่วโมง พลาดรอบเดียวยังไม่เตือน พลาด 2 รอบติดค่อยเตือน
export const STATION_STALE_HOURS = 3
export const SYNC_STALE_HOURS = 2

// ระดับน้ำต่างกันน้อยกว่านี้ถือว่าทรงตัว — ค่าวัดแกว่งระดับเซนติเมตรเป็นปกติ
export const TREND_FLAT_M = 0.02

// เกณฑ์ปริมาณฝนของกรมอุตุนิยมวิทยา (https://www.tmd.go.th/info/เกณฑ์อากาศ ตรวจ 2569-09-18)
//   ฝนเล็กน้อย 0.1–10.0 · ฝนปานกลาง 10.1–35.0 · ฝนหนัก 35.1–90.0 · ฝนหนักมาก 90.1 มม. ขึ้นไป
// ต่ำกว่า 0.1 มม. ไม่อยู่ในเกณฑ์ จึงแสดงว่า "ไม่มีฝน"
// ค่าของสถานีเป็นฝนสะสม 24 ชั่วโมงล่าสุด ไม่ใช่ช่วง 07.00–07.00 น. แบบรายงานประจำวันของกรมอุตุฯ
// ใช้เกณฑ์นี้เป็นแนวเทียบให้อ่านตัวเลขง่ายขึ้น ไม่ใช่การประกาศสภาพอากาศ
export const RAIN_LEVELS = [
  { key: 'none',      label: 'ไม่มีฝน',     below: 0.1,      chip: 'bg-gray-100 text-gray-500' },
  { key: 'light',     label: 'ฝนเล็กน้อย',  upTo: 10.0,      chip: 'bg-sky-50 text-sky-700' },
  { key: 'moderate',  label: 'ฝนปานกลาง',  upTo: 35.0,      chip: 'bg-blue-100 text-blue-800' },
  { key: 'heavy',     label: 'ฝนหนัก',      upTo: 90.0,      chip: 'bg-amber-100 text-amber-800' },
  { key: 'veryHeavy', label: 'ฝนหนักมาก',   upTo: Infinity,  chip: 'bg-rose-100 text-rose-700' },
]

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
