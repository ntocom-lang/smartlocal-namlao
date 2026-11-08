// ปฏิทินปีงบประมาณของเมนู "แผนพัฒนาท้องถิ่น" (แผนการดำเนินงาน)
//
// เดือนในฐานข้อมูล (local_op_plan_items.month_from / month_to) เก็บเป็น "เดือนที่ของปีงบ" 1–12
//   1 = ต.ค. … 3 = ธ.ค. · 4 = ม.ค. … 12 = ก.ย.   (ไม่ใช่เลขเดือนปฏิทิน — ดู COMMENT ใน migration 20261109100100)
// ไฟล์นี้แปลงไปมาระหว่างเดือนที่ของปีงบกับเดือน/ปีปฏิทิน และอ่านข้อความ "ระยะเวลา" ที่คนพิมพ์ในแผนกระดาษ
// คำนวณด้วยตัวเลข/สตริงล้วน ไม่อ่านโซนเวลาเครื่อง (เครื่องเจ้าหน้าที่ตั้งโซนเวลาอื่นได้)
import { FISCAL_MONTHS_TH, fiscalYearBounds } from './fiscalYear.js'

// ── แปลงเดือนปีงบ ↔ ปฏิทิน ──────────────────────────────────────────────────

const isFiscalMonth = m => Number.isInteger(m) && m >= 1 && m <= 12
const blank = v => v === null || v === undefined || v === ''

/**
 * เดือนที่ของปีงบ (1–12) + ปีงบ พ.ศ. → { month: 1–12 (ปฏิทิน), yearCE, yearBE }
 * เดือนที่ 1–3 (ต.ค.–ธ.ค.) อยู่ในปีปฏิทินที่ปีงบ "เริ่ม" · เดือนที่ 4–12 อยู่ในปีที่ปีงบ "สิ้นสุด"
 * ค่าที่ไม่ใช่เลข 1–12 คืน null
 */
export function fiscalMonthToCalendar(fiscalMonth, fiscalYearBE) {
  const fm = Number(fiscalMonth)
  const fy = Number(fiscalYearBE)
  if (!isFiscalMonth(fm) || !Number.isInteger(fy)) return null
  const { startCE, endCE } = fiscalYearBounds(fy)
  const inStartYear = fm <= 3
  const yearCE = inStartYear ? startCE : endCE
  return { month: inStartYear ? fm + 9 : fm - 3, yearCE, yearBE: yearCE + 543 }
}

/** เดือนปฏิทิน (1–12) → เดือนที่ของปีงบ (1–12) ; ค่าที่ไม่ใช่เลข 1–12 คืน null */
export function calendarToFiscalMonth(calendarMonth) {
  const cm = Number(calendarMonth)
  if (!isFiscalMonth(cm)) return null
  return cm >= 10 ? cm - 9 : cm + 3
}

/** ช่วงเดือนที่ของปีงบ → วันแรกของเดือนต้น และวันสุดท้ายของเดือนปลาย ('YYYY-MM-DD') */
export function fiscalMonthRange(fiscalYearBE, from, to) {
  const a = fiscalMonthToCalendar(from, fiscalYearBE)
  const b = fiscalMonthToCalendar(to, fiscalYearBE)
  if (!a || !b) return null
  const pad = n => String(n).padStart(2, '0')
  // Date.UTC(y, m, 0) = วันสุดท้ายของเดือน m (เดือนปฏิทิน 1–12) — ไม่ผ่านโซนเวลาเครื่อง
  const lastDay = new Date(Date.UTC(b.yearCE, b.month, 0)).getUTCDate()
  return { from: `${a.yearCE}-${pad(a.month)}-01`, to: `${b.yearCE}-${pad(b.month)}-${pad(lastDay)}` }
}

// ── ไตรมาส ───────────────────────────────────────────────────────────────

/** เดือนที่ของปีงบ → ไตรมาส 1–4 (1 = ต.ค.–ธ.ค.) · ค่าผิดคืน null */
export function quarterOfFiscalMonth(m) {
  const fm = Number(m)
  return isFiscalMonth(fm) ? Math.ceil(fm / 3) : null
}

/** ไตรมาสทั้งหมดที่ช่วงเดือนนี้แตะ เช่น (3, 4) → [1, 2] · ช่วงผิดคืน [] */
export function quartersOfSpan(from, to) {
  if (blank(from) || blank(to) || validateSpan(from, to) !== null) return []
  const a = quarterOfFiscalMonth(Number(from))
  const b = quarterOfFiscalMonth(Number(to))
  const out = []
  for (let q = a; q <= b; q++) out.push(q)
  return out
}

// ── ป้ายข้อความ ─────────────────────────────────────────────────────────────

/** 1 → 'ต.ค.' · ค่าผิดคืน '' */
export function fiscalMonthLabel(m) {
  const fm = Number(m)
  return isFiscalMonth(fm) ? FISCAL_MONTHS_TH[fm - 1].label : ''
}

/** (1, 3) → 'ต.ค.–ธ.ค.' · เดือนเดียว → 'ต.ค.' · ว่าง/ผิด → '' */
export function spanLabel(from, to) {
  if (blank(from) || blank(to) || validateSpan(from, to) !== null) return ''
  const a = fiscalMonthLabel(from)
  const b = fiscalMonthLabel(to)
  return Number(from) === Number(to) ? a : `${a}–${b}`
}

/**
 * ตรวจช่วงเดือนที่ของปีงบ — กติกาเดียวกับ CHECK local_op_plan_items_month_range:
 * ทั้งคู่ว่าง หรือทั้งคู่เป็น 1–12 และ to >= from · ผ่านคืน null ไม่ผ่านคืนข้อความไทย
 */
export function validateSpan(from, to) {
  if (blank(from) && blank(to)) return null
  if (blank(from) || blank(to)) return 'ต้องระบุเดือนเริ่มและเดือนสิ้นสุดทั้งคู่ (หรือเว้นว่างทั้งคู่)'
  const a = typeof from === 'string' && /^\d+$/.test(from.trim()) ? Number(from) : from
  const b = typeof to === 'string' && /^\d+$/.test(to.trim()) ? Number(to) : to
  if (!isFiscalMonth(a) || !isFiscalMonth(b)) return 'เดือนต้องเป็นเลข 1–12 (1 = ต.ค. … 12 = ก.ย.)'
  if (b < a) return 'เดือนสิ้นสุดต้องไม่ก่อนเดือนเริ่ม'
  return null
}

// ── อ่านข้อความระยะเวลา ──────────────────────────────────────────────────────

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙'
/** เลขไทย ๐–๙ → 0–9 */
export const toAsciiDigits = s => String(s ?? '').replace(/[๐-๙]/g, d => String(THAI_DIGITS.indexOf(d)))

// ชื่อเดือนปฏิทิน (index 0 = ม.ค.): ชื่อเต็ม + ชื่อย่อ "ไม่มีจุด" (เทียบหลังลบจุดออกจากข้อความ)
// กรกฎาคม มีสะกดผิดที่พบบ่อย (ฏ) ใส่ไว้ด้วย
const MONTH_FULL = [
  ['มกราคม'], ['กุมภาพันธ์'], ['มีนาคม'], ['เมษายน'], ['พฤษภาคม'], ['มิถุนายน'],
  ['กรกฎาคม', 'กรกฏาคม'], ['สิงหาคม'], ['กันยายน'], ['ตุลาคม'], ['พฤศจิกายน'], ['ธันวาคม'],
]
const MONTH_SHORT = ['มค', 'กพ', 'มีค', 'เมย', 'พค', 'มิย', 'กค', 'สค', 'กย', 'ตค', 'พย', 'ธค']
const MONTH_NAME_TO_CAL = new Map()
MONTH_FULL.forEach((names, i) => names.forEach(n => MONTH_NAME_TO_CAL.set(n, i + 1)))
MONTH_SHORT.forEach((n, i) => MONTH_NAME_TO_CAL.set(n, i + 1))
const MONTH_ALT = [...MONTH_NAME_TO_CAL.keys()].sort((a, b) => b.length - a.length).join('|')
const MONTH_TOKEN = new RegExp(`^(${MONTH_ALT})\\s*(\\d{4}|\\d{2})?$`)

/** ข้อความเดือนที่ล้างแล้ว: เลขไทย→อารบิก ลบจุด ยุบช่องว่าง ตัดหัวท้าย */
function cleanMonthText(s) {
  return toAsciiDigits(s).replace(/[.\u{200B}\u{200C}]|\u{200D}|\u{FEFF}/gu, '').replace(/\s+/g, ' ').trim()
}

/** ปีที่พิมพ์ในข้อความ → พ.ศ. : 2 หลัก = พ.ศ. 25xx · 4 หลัก ≥ 2400 = พ.ศ. · 1900–2200 = ค.ศ. · อื่นๆ null */
function yearTextToBE(y) {
  if (y === undefined || y === null || y === '') return undefined
  if (y.length === 2) return 2500 + Number(y)
  const n = Number(y)
  if (n >= 2400 && n <= 2700) return n
  if (n >= 1900 && n <= 2200) return n + 543
  return null
}

/**
 * อ่านเดือนเดียว 'ต.ค.' 'ตุลาคม' 'ต.ค.68' 'ตุลาคม 2568' (ทั้งข้อความต้องเป็นเดือนล้วน)
 * → { calendarMonth, fiscalMonth, yearBE (ถ้ามีปีกำกับ) } หรือ null
 */
export function parseMonthToken(text) {
  const m = MONTH_TOKEN.exec(cleanMonthText(text))
  if (!m) return null
  const calendarMonth = MONTH_NAME_TO_CAL.get(m[1])
  const yearBE = yearTextToBE(m[2])
  if (yearBE === null) return null
  return { calendarMonth, fiscalMonth: calendarToFiscalMonth(calendarMonth), ...(yearBE === undefined ? {} : { yearBE }) }
}

const DASH = /\s*(?:[-\u{2010}-\u{2015}\u{2212}~]|จนถึง|ถึง)\s*/gu
const QUARTER_RE = /^(?:ไตรมาส(?:ที่)?|q)\s*([1-4])(?:-(?:ไตรมาส(?:ที่)?|q)?\s*([1-4]))?$/i

/** ปีงบ (พ.ศ.) ของเดือนปฏิทิน + ปี พ.ศ. ที่พิมพ์ : ต.ค.–ธ.ค. ของปี Y อยู่ในปีงบ Y+1 */
const fiscalYearOfMonthYear = (calendarMonth, yearBE) => (calendarMonth >= 10 ? yearBE + 1 : yearBE)

/**
 * อ่านข้อความระยะเวลาที่คนพิมพ์ → { from, to } (เดือนที่ของปีงบ) หรือ null ถ้าอ่านไม่ได้/ช่วงย้อน
 * รองรับ 'ต.ค.68–มี.ค.69' · 'ต.ค. - ธ.ค.' · 'ตุลาคม 2568 - กันยายน 2569' · 'ไตรมาส 1' · 'ไตรมาส 1-2' ·
 *   'ไตรมาส ๒' · 'Q1-Q2' · เลขไทย · ขีดหลายแบบ (- – — − ~ ถึง)
 * ถ้ามีปีกำกับและส่ง options.fiscalYearBE มา แล้วเดือน/ปีไม่อยู่ในปีงบนั้น → คืน { from, to, warning }
 * (ยังคืนช่วงให้ ผู้ใช้ตัดสินเอง) · ไม่ส่ง fiscalYearBE → เตือนเฉพาะกรณีต้น-ปลายอยู่คนละปีงบ
 */
export function parseMonthSpan(text, { fiscalYearBE } = {}) {
  const t = cleanMonthText(text).toLowerCase().replace(DASH, '-')
  if (!t) return null

  const q = QUARTER_RE.exec(t)
  if (q) {
    const q1 = Number(q[1])
    const q2 = q[2] === undefined ? q1 : Number(q[2])
    if (q2 < q1) return null
    return { from: (q1 - 1) * 3 + 1, to: q2 * 3 }
  }

  const parts = t.split('-')
  if (parts.length > 2 || parts.some(p => p.trim() === '')) return null
  const tokens = parts.map(p => parseMonthToken(p))
  if (tokens.some(x => x === null)) return null

  const from = tokens[0].fiscalMonth
  const to = tokens[tokens.length - 1].fiscalMonth
  if (to < from) return null

  const warnings = []
  const fy = tokens.map(k => (k.yearBE === undefined ? undefined : fiscalYearOfMonthYear(k.calendarMonth, k.yearBE)))
  if (!blank(fiscalYearBE) && Number.isInteger(Number(fiscalYearBE))) {
    tokens.forEach((k, i) => {
      if (fy[i] !== undefined && fy[i] !== Number(fiscalYearBE)) {
        warnings.push(`${fiscalMonthLabel(k.fiscalMonth)} ${k.yearBE} ไม่อยู่ในปีงบประมาณ ${fiscalYearBE}`)
      }
    })
  } else if (fy.length === 2 && fy[0] !== undefined && fy[1] !== undefined && fy[0] !== fy[1]) {
    warnings.push('เดือนต้นและเดือนปลายอยู่คนละปีงบประมาณ')
  }
  return warnings.length ? { from, to, warning: warnings.join('; ') } : { from, to }
}
