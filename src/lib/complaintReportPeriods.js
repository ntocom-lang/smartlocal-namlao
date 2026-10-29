// ช่วงเวลารายวัน / รายสัปดาห์ / รายไตรมาส ของหน้า /reports/complaints (เจ้าของระบบสั่งเพิ่ม 2569-10-29)
//
// ทั้ง 3 ช่วงส่งเข้า RPC ชุด _fy เดิม (complaint_stats_fy / complaints_public_fy) ที่รับช่วงวันที่ใดก็ได้
// และนับตามเวลาไทยฝั่งฐานข้อมูลอยู่แล้ว — ไม่มี migration · from/to เป็น YYYY-MM-DD (ค.ศ.) to = วันสุดท้ายที่นับรวม
// ค่าในลิงก์ใช้ พ.ศ. แบบเดียวกับ ?m=2569-04 ของโหมดรายเดือน (complaintMonthlySummary.js)
//   ?q=2570-1        ไตรมาส 1 ปีงบประมาณ 2570 (ต.ค.–ธ.ค. 2569) — นับไตรมาสตามปีงบ ใช้ FISCAL_QUARTERS ชุดกลาง
//   ?w=2569-10-26    สัปดาห์ที่เริ่มวันจันทร์ 26 ต.ค. 2569 (จันทร์–อาทิตย์)
//   ?d=2569-10-28    วันเดียว
// ค่าที่ผิดรูปแบบ/เป็นอนาคต/ไกลเกินช่วงตัวเลือก คืน null → หน้าตกกลับโหมดปีงบ ไม่ใช่หน้าพัง
//
// ภาพ PNG / ข้อความสรุป / ใบ A4 ใช้ summarizeMonth ชุดเดียวกับรายเดือน (period มี kind กำกับ ถ้อยคำดู periodWords)
// ล็อกตัวเลข / Telegram เป็นของรายเดือนเท่านั้น ช่วงเหล่านี้ไม่มี
// ไฟล์นี้ต้องไม่ import supabase/React — เทสต์รันด้วย node ตรงๆ

import { FISCAL_QUARTERS, fiscalQuarterBounds } from './fiscalYear.js'
import { MONTHS_TH_FULL } from './complaintMonthlySummary.js'

const MONTHS_TH_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const WEEKDAYS_TH = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']
const WEEKDAYS_TH_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.']

// ตัวเลือกย้อนหลัง (ใช้ทั้งดรอปดาวน์และเพดานที่ parse ยอมรับ) — วันย้อนได้ราว 24 เดือนเท่ารายเดือน
export const DAY_OPTION_COUNT = 731
export const WEEK_OPTION_COUNT = 26
export const QUARTER_OPTION_COUNT = 8

// ชื่อพารามิเตอร์ในลิงก์ของแต่ละช่วง (รายเดือนคือ m อยู่ที่ complaintMonthlySummary.js)
export const PERIOD_PARAMS = { quarter: 'q', week: 'w', day: 'd' }

const DATE_PARAM = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const QUARTER_PARAM = /^(\d{4})-([1-4])$/

// วันที่ล้วน (ไม่มีเวลา) คำนวณบน UTC เสมอ — เครื่องเจ้าหน้าที่ตั้งโซนเวลาอื่นได้ (เทสต์ตั้ง TZ ต่างประเทศ)
const toUtc = iso => new Date(`${iso}T00:00:00Z`)
const isoOfUtc = d => d.toISOString().slice(0, 10)
export const addDays = (iso, n) => isoOfUtc(new Date(toUtc(iso).getTime() + n * 86_400_000))
const weekdayOf = iso => toUtc(iso).getUTCDay()

const bangkokDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
})

/** วันที่ตามเวลาไทย (YYYY-MM-DD ค.ศ.) ของเวลาใดๆ — ใช้ทั้ง "วันนี้" และวันที่ของ created_at */
export function bangkokIsoDate(value = new Date()) {
  return bangkokDateFormat.format(value instanceof Date ? value : new Date(value))
}

const beKeyOf = iso => `${Number(iso.slice(0, 4)) + 543}${iso.slice(4)}`
const parts = iso => ({ year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)), day: Number(iso.slice(8, 10)) })

/** 28 ต.ค. 2569 (withYear=false → 28 ต.ค.) */
export function thaiShortDate(iso, withYear = true) {
  const { year, month, day } = parts(iso)
  return `${day} ${MONTHS_TH_SHORT[month - 1]}${withYear ? ` ${year + 543}` : ''}`
}

/** ช่วงวันที่แบบย่อ ไม่พูดเดือน/ปีซ้ำ: "5 – 11 ต.ค. 2569" · "26 ต.ค. – 1 พ.ย. 2569" · "29 ธ.ค. 2568 – 4 ม.ค. 2569" */
export function thaiDateRange(from, to) {
  const a = parts(from)
  const b = parts(to)
  if (a.year !== b.year) return `${thaiShortDate(from)} – ${thaiShortDate(to)}`
  if (a.month !== b.month) return `${thaiShortDate(from, false)} – ${thaiShortDate(to)}`
  return `${a.day} – ${thaiShortDate(to)}`
}

// แปลงค่า พ.ศ. ในลิงก์ (2569-10-28) เป็นวันที่ ค.ศ. — วันที่ไม่มีจริง (31 เม.ย., 29 ก.พ. ปีปกติ) คืน null
function isoFromBeKey(raw) {
  const match = DATE_PARAM.exec(String(raw ?? ''))
  if (!match) return null
  const iso = `${Number(match[1]) - 543}-${match[2]}-${match[3]}`
  return isoOfUtc(toUtc(iso)) === iso ? iso : null
}

// ── รายวัน ───────────────────────────────────────────────────────────────

export function dayPeriod(iso) {
  const { year, month, day } = parts(iso)
  return {
    kind: 'day',
    key: beKeyOf(iso),
    from: iso,
    to: iso,
    label: `วันที่ ${day} ${MONTHS_TH_FULL[month - 1]} ${year + 543}`,
    rangeText: `วัน${WEEKDAYS_TH[weekdayOf(iso)]}`,
  }
}

/** วันแรกที่ย้อนไปเลือกได้ (ใช้เป็น min ของช่องเลือกวันที่) */
export function earliestDay(now = new Date()) {
  return addDays(bangkokIsoDate(now), -(DAY_OPTION_COUNT - 1))
}

export function parseDayParam(raw, now = new Date()) {
  const iso = isoFromBeKey(raw)
  if (!iso) return null
  if (iso > bangkokIsoDate(now) || iso < earliestDay(now)) return null
  return dayPeriod(iso)
}

/** เมื่อวาน — ค่าตั้งต้นเมื่อกดสลับมารายวัน (วันนี้ยังไม่จบ ตัวเลขยังไม่นิ่ง แบบเดียวกับ lastFullMonth) */
/** ค่าจากช่องเลือกวันที่ (YYYY-MM-DD ค.ศ.) → ค่าในลิงก์ (พ.ศ.) · ว่าง/ผิด/นอกช่วงคืน null (ไม่เปลี่ยนหน้า) */
export function dayParamFromInput(value, now = new Date()) {
  if (!DATE_PARAM.test(String(value ?? ''))) return null
  return parseDayParam(beKeyOf(value), now)?.key ?? null
}

export function lastFullDay(now = new Date()) {
  return dayPeriod(addDays(bangkokIsoDate(now), -1))
}

// ── รายสัปดาห์ (จันทร์–อาทิตย์) ─────────────────────────────────────────

/** วันจันทร์ของสัปดาห์ที่มีวันนี้ */
export function mondayOf(iso) {
  return addDays(iso, -((weekdayOf(iso) + 6) % 7))
}

export function weekPeriod(mondayIso) {
  const to = addDays(mondayIso, 6)
  const rangeText = thaiDateRange(mondayIso, to)
  return { kind: 'week', key: beKeyOf(mondayIso), from: mondayIso, to, label: `สัปดาห์ ${rangeText}`, rangeText }
}

/** ตัวเลือกสัปดาห์ เรียงใหม่→เก่า เริ่มที่สัปดาห์ปัจจุบัน */
export function recentWeekOptions(count = WEEK_OPTION_COUNT, now = new Date()) {
  const current = mondayOf(bangkokIsoDate(now))
  return Array.from({ length: count }, (_, i) => weekPeriod(addDays(current, -7 * i)))
}

export function parseWeekParam(raw, now = new Date()) {
  const iso = isoFromBeKey(raw)
  if (!iso || weekdayOf(iso) !== 1) return null // ต้องเป็นวันจันทร์ ไม่งั้นลิงก์เดียวกันได้ช่วงที่ไม่ตรงตัวเลือก
  const current = mondayOf(bangkokIsoDate(now))
  if (iso > current || iso < addDays(current, -7 * (WEEK_OPTION_COUNT - 1))) return null
  return weekPeriod(iso)
}

export function lastFullWeek(now = new Date()) {
  return recentWeekOptions(2, now)[1]
}

// ── รายไตรมาส (ตามปีงบประมาณ) ─────────────────────────────────────────

export function quarterPeriod(fiscalYearBE, quarter) {
  const { from, to } = fiscalQuarterBounds(fiscalYearBE, quarter)
  const short = FISCAL_QUARTERS[quarter - 1].short
  const calendarYearBE = Number(from.slice(0, 4)) + 543
  return {
    kind: 'quarter',
    key: `${fiscalYearBE}-${quarter}`,
    fiscalYearBE,
    quarter,
    from,
    to,
    label: `ไตรมาสที่ ${quarter} ปีงบประมาณ ${fiscalYearBE}`,
    rangeText: thaiDateRange(from, to),
    optionLabel: `ไตรมาส ${quarter}/${fiscalYearBE} (${short} ${calendarYearBE})`,
  }
}

// ไตรมาสปัจจุบันตามเวลาไทย เป็นเลขลำดับต่อเนื่อง (ปีงบ × 4 + ไตรมาส) ให้นับย้อนหลังข้ามปีงบได้ตรงๆ
function quarterIndexOf(now) {
  const { year, month } = parts(bangkokIsoDate(now))
  const fiscalYearBE = (month >= 10 ? year + 1 : year) + 543
  const quarter = month >= 10 ? 1 : Math.floor((month - 1) / 3) + 2
  return fiscalYearBE * 4 + (quarter - 1)
}

const quarterFromIndex = index => quarterPeriod(Math.floor(index / 4), (index % 4) + 1)

/** ตัวเลือกไตรมาส เรียงใหม่→เก่า เริ่มที่ไตรมาสปัจจุบัน */
export function recentQuarterOptions(count = QUARTER_OPTION_COUNT, now = new Date()) {
  const current = quarterIndexOf(now)
  return Array.from({ length: count }, (_, i) => quarterFromIndex(current - i))
}

export function parseQuarterParam(raw, now = new Date()) {
  const match = QUARTER_PARAM.exec(String(raw ?? ''))
  if (!match) return null
  const index = Number(match[1]) * 4 + (Number(match[2]) - 1)
  const current = quarterIndexOf(now)
  if (index > current || index < current - (QUARTER_OPTION_COUNT - 1)) return null
  return quarterFromIndex(index)
}

export function lastFullQuarter(now = new Date()) {
  return recentQuarterOptions(2, now)[1]
}

// ── ปีงบประมาณ (โหมดตั้งต้นของหน้า ใช้ ?fy= เดิม) ─────────────────────────
// ไม่มีพารามิเตอร์ใหม่ — ใช้แค่ให้ภาพ PNG / ข้อความสรุป / ใบ A4 ทำงานกับปีงบได้เหมือนช่วงอื่น (เจ้าของระบบสั่ง 2569-10-29)
// label ตรงกับ fiscalPeriodParts().main ที่หัวหน้าใช้อยู่ ("ปีงบประมาณ พ.ศ. 2570") — หัวหน้าเป็นถ้อยคำ ITA ห้ามให้สองที่ต่างกัน

export function fiscalYearPeriod(fiscalYearBE) {
  const fy = Number(fiscalYearBE)
  const from = `${fy - 544}-10-01`
  const to = `${fy - 543}-09-30`
  return { kind: 'fiscal', key: String(fy), fiscalYearBE: fy, from, to, label: `ปีงบประมาณ พ.ศ. ${fy}`, rangeText: thaiDateRange(from, to) }
}

// ── ใช้ร่วม ────────────────────────────────────────────────────────────

/** ช่วงที่ยังไม่จบ (มีวันนี้อยู่ในช่วง) — ตัวเลขยังขยับได้ หน้าเว็บต้องบอก */
export function isCurrentPeriod(period, now = new Date()) {
  const today = bangkokIsoDate(now)
  return period.from <= today && today <= period.to
}

/** อ่านช่วงจากลิงก์ — มีหลายค่าพร้อมกันยึดตามลำดับ ไตรมาส → สัปดาห์ → วัน */
export function parsePeriodParams(get, now = new Date()) {
  return parseQuarterParam(get(PERIOD_PARAMS.quarter), now)
    ?? parseWeekParam(get(PERIOD_PARAMS.week), now)
    ?? parseDayParam(get(PERIOD_PARAMS.day), now)
}

/**
 * กราฟแนวโน้มของช่วง — สัปดาห์ = รายวัน 7 จุด · ไตรมาส = รายสัปดาห์ (เริ่มวันจันทร์) · วันเดียวไม่มีกราฟ (คืน null)
 * ทุกช่องมีค่าแม้เป็น 0 (ไม่ข้าม ไม่งั้นเส้นกระโดดผิดสัดส่วนเวลา) · นับวันที่ตามเวลาไทย ไม่ใช่เวลาเครื่อง
 * ป้ายของสัปดาห์แรกในไตรมาสใช้วันแรกของไตรมาส (1 ต.ค.) ไม่ใช่วันจันทร์ที่อยู่ก่อนช่วง
 * @param {{ kind: string, from: string, to: string }} period
 * @param {Array<{ created_at: string }>} rows
 */
export function periodTrend(period, rows) {
  if (period.kind === 'day') return null
  const buckets = []
  if (period.kind === 'week') {
    for (let i = 0; i < 7; i++) {
      const iso = addDays(period.from, i)
      buckets.push({ key: iso, label: `${WEEKDAYS_TH_SHORT[weekdayOf(iso)]} ${parts(iso).day}`, count: 0 })
    }
  } else {
    for (let monday = mondayOf(period.from); monday <= period.to; monday = addDays(monday, 7)) {
      buckets.push({ key: monday, label: thaiShortDate(monday < period.from ? period.from : monday, false), count: 0 })
    }
  }
  const byKey = Object.fromEntries(buckets.map(b => [b.key, b]))
  for (const row of rows ?? []) {
    const iso = bangkokIsoDate(row.created_at)
    if (iso < period.from || iso > period.to) continue
    const bucket = byKey[period.kind === 'week' ? iso : mondayOf(iso)]
    if (bucket) bucket.count += 1
  }
  return buckets
}
