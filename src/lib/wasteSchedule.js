// ตัวคำนวณ "วันเก็บขยะ" จากกฎที่เจ้าหน้าที่ตั้งไว้ครั้งเดียว — logic ล้วน ไม่ผูก supabase/React
// (รันเทสต์นอกเบราว์เซอร์ได้: node tests/waste-schedule.test.mjs)
//
// หลักการที่เจ้าของระบบกำหนด (2569-09-14): ระบบต้องช่วยงาน ไม่เพิ่มงานให้เจ้าหน้าที่
//   - เจ้าหน้าที่ตั้ง "กฎ" ครั้งเดียว (ทุกวันพฤหัส / พุธที่ 2 ของทุกเดือน) ไม่ต้องกรอกวันที่รายเดือน
//   - วันหยุดราชการ: แต่ละกฎตั้ง holiday_policy ไว้ครั้งเดียว ระบบเลื่อน/งดให้เองทุกปี
//     โดยอ่านวันหยุดจากตัวเดียวกับที่นับ SLA (workingDays.js ← ตาราง public_holidays)
//   - ข้อยกเว้น (รถเสีย เลื่อนวัน) กดเฉพาะตอนมีเหตุจริง และชนะ holiday_policy เสมอ
//
// วันที่ทั้งไฟล์เป็นสตริง 'YYYY-MM-DD' และคิดเลขบนแกน UTC ล้วน — ห้าม new Date('YYYY-MM-DD')
// แล้วอ่าน getDate() เพราะสตริงแบบนี้ถูกตีความเป็น UTC แล้ววันเลื่อนตาม timezone เครื่อง
import { holidayName, isWorkingDay } from './workingDays.js'

export const WASTE_TYPES = {
  general:   { key: 'general',   label: 'ขยะทั่วไป',  emoji: '🗑️', color: '#15803d', bg: '#dcfce7' },
  hazardous: { key: 'hazardous', label: 'ขยะอันตราย', emoji: '☣️', color: '#b45309', bg: '#fef3c7' },
}

export const WEEKDAYS_TH = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']
const WEEKDAYS_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.']
const MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

export const HOLIDAY_POLICIES = {
  collect:          { label: 'เก็บตามปกติ',          short: 'ตรงวันหยุดราชการ เก็บตามปกติ' },
  skip:             { label: 'งดเก็บรอบนั้น',        short: 'ตรงวันหยุดราชการ งดเก็บ' },
  next_working_day: { label: 'เลื่อนไปวันทำการถัดไป', short: 'ตรงวันหยุดราชการ เลื่อนไปวันทำการถัดไป' },
}

export const NTH_LABELS = { 1: 'ที่ 1', 2: 'ที่ 2', 3: 'ที่ 3', 4: 'ที่ 4', '-1': 'สุดท้าย' }

const MS_PER_DAY = 86_400_000
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

// ─── วันที่ ───────────────────────────────────────────────────────────────────

export function dayIndex(str) {
  const m = DATE_RE.exec(String(str ?? ''))
  if (!m) return null
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / MS_PER_DAY)
}

export function dateOfIndex(index) {
  const d = new Date(index * MS_PER_DAY)
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${d.getUTCFullYear()}-${mm}-${dd}`
}

export function addDays(str, n) {
  const i = dayIndex(str)
  return i === null ? null : dateOfIndex(i + n)
}

function partsOf(str) {
  const d = new Date(dayIndex(str) * MS_PER_DAY)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate(), wd: d.getUTCDay() }
}

export function weekdayOf(str) {
  return partsOf(str).wd
}

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
}

// "พฤ. 18 ก.ย. 69" — การ์ดบนมือถือพื้นที่แคบ
export function thaiShortDate(str) {
  if (dayIndex(str) === null) return ''
  const { y, m, day, wd } = partsOf(str)
  return `${WEEKDAYS_SHORT[wd]} ${day} ${MONTHS_SHORT[m]} ${String(y + 543).slice(-2)}`
}

// "วันพฤหัสบดีที่ 18 ก.ย. 2569"
export function thaiLongDate(str) {
  if (dayIndex(str) === null) return ''
  const { y, m, day, wd } = partsOf(str)
  return `วัน${WEEKDAYS_TH[wd]}ที่ ${day} ${MONTHS_SHORT[m]} ${y + 543}`
}

// ─── หมู่ ─────────────────────────────────────────────────────────────────────

// profiles.address_moo เป็นข้อความอิสระ ("3", "หมู่ 3", "ม.3") — ดึงเลขตัวแรกออกมา
export function parseMooNo(text) {
  const m = /\d{1,2}/.exec(String(text ?? ''))
  if (!m) return null
  const n = Number(m[0])
  return n >= 1 && n <= 99 ? n : null
}

export function villageLabel(mooNo, villages = []) {
  if (!mooNo) return 'ทุกหมู่'
  const v = villages.find(x => Number(x.moo_no) === Number(mooNo))
  return v?.name ? `หมู่ ${mooNo} ${v.name}` : `หมู่ ${mooNo}`
}

export function mooListText(mooNos) {
  const list = [...new Set((mooNos ?? []).map(Number))].sort((a, b) => a - b)
  if (list.length === 0) return 'ทุกหมู่'
  return `หมู่ ${list.join(', ')}`
}

function coversMoo(mooNos, mooNo) {
  if (!mooNos || mooNos.length === 0) return true
  if (!mooNo) return true
  return mooNos.map(Number).includes(Number(mooNo))
}

// ─── กฎ ───────────────────────────────────────────────────────────────────────

function joinThai(items) {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(' ')} และ${items[items.length - 1]}`
}

// ข้อความกฎแบบไม่มีวันที่ — ใช้บนใบประกาศ จึงไม่ต้องพิมพ์ใหม่เมื่อเดือนเปลี่ยน
export function describeRule(schedule) {
  const days = [...(schedule?.weekdays ?? [])].map(Number).sort((a, b) => a - b)
  if (days.length === 0) return ''
  if (schedule.rule === 'monthly') {
    const nth = Number(schedule.nth)
    const wd = WEEKDAYS_TH[days[0]]
    return nth === -1 ? `วัน${wd}สุดท้ายของทุกเดือน` : `วัน${wd}ที่ ${nth} ของทุกเดือน`
  }
  const every = Number(schedule.interval_weeks) === 2 ? 'ทุก 2 สัปดาห์ ' : 'ทุก'
  if (days.length === 7) return Number(schedule.interval_weeks) === 2 ? 'ทุกวัน สัปดาห์เว้นสัปดาห์' : 'ทุกวัน'
  return `${every}วัน${joinThai(days.map(d => WEEKDAYS_TH[d]))}`
}

export function timeText(schedule) {
  const from = schedule?.time_from?.slice(0, 5)
  const to = schedule?.time_to?.slice(0, 5)
  if (from && to) return `${from}–${to} น.`
  if (from) return `ตั้งแต่ ${from} น.`
  if (to) return `ก่อน ${to} น.`
  return ''
}

// ตรวจกฎก่อนบันทึก — ข้อความภาษาไทยให้เจ้าหน้าที่แก้ได้ทันที (DB มี CHECK ชุดเดียวกันกันไว้อีกชั้น)
export function validateSchedule(s) {
  const errors = []
  if (!WASTE_TYPES[s?.waste_type]) errors.push('เลือกประเภทขยะ')
  const days = s?.weekdays ?? []
  if (days.length === 0) errors.push('เลือกวันที่ออกเก็บอย่างน้อย 1 วัน')
  if (s?.rule === 'monthly') {
    if (days.length !== 1) errors.push('รอบรายเดือนเลือกได้วันเดียว')
    if (!(String(s?.nth) in NTH_LABELS)) errors.push('เลือกว่าเป็นสัปดาห์ที่เท่าไรของเดือน')
  } else if (s?.rule !== 'weekly') {
    errors.push('เลือกรูปแบบรอบ')
  }
  if (!HOLIDAY_POLICIES[s?.holiday_policy]) errors.push('เลือกว่าถ้าตรงวันหยุดราชการจะทำอย่างไร')
  if (s?.time_from && s?.time_to && s.time_to <= s.time_from) errors.push('เวลาสิ้นสุดต้องหลังเวลาเริ่ม')
  if (dayIndex(s?.starts_on) === null) errors.push('ระบุวันที่เริ่มใช้รอบนี้')
  if (s?.ends_on && dayIndex(s.ends_on) < dayIndex(s.starts_on)) errors.push('วันสิ้นสุดต้องไม่ก่อนวันเริ่ม')
  return errors
}

export function ruleOccursOn(schedule, str) {
  const idx = dayIndex(str)
  const start = dayIndex(schedule?.starts_on)
  if (idx === null || start === null || idx < start) return false
  const end = dayIndex(schedule.ends_on)
  if (end !== null && idx > end) return false

  const { y, m, day, wd } = partsOf(str)
  const days = (schedule.weekdays ?? []).map(Number)
  if (!days.includes(wd)) return false

  if (schedule.rule === 'monthly') {
    const nth = Number(schedule.nth)
    if (nth === -1) return day + 7 > daysInMonth(y, m)
    return Math.ceil(day / 7) === nth
  }

  if (Number(schedule.interval_weeks) === 2) {
    // นับสัปดาห์จากวันอาทิตย์ของสัปดาห์ที่เริ่มใช้กฎ — สัปดาห์แรกคือสัปดาห์ที่เก็บ
    const weekStart = start - weekdayOf(schedule.starts_on)
    return Math.floor((idx - weekStart) / 7) % 2 === 0
  }
  return true
}

function nextWorkingDayAfter(str, workingDayFn) {
  for (let i = 1; i <= 14; i++) {
    const candidate = addDays(str, i)
    if (workingDayFn(candidate)) return candidate
  }
  return addDays(str, 1)
}

function findException(exceptions, dateStr, schedule, mooNo) {
  return (exceptions ?? []).find(e =>
    e.on_date === dateStr
    && (!e.waste_type || e.waste_type === schedule.waste_type)
    && coversMoo(e.moo_nos, mooNo)
    // ข้อยกเว้นเฉพาะบางหมู่ ต้องมีหมู่ซ้อนกับกฎจริง ไม่งั้นกฎของหมู่อื่นโดนงดไปด้วย
    && (!e.moo_nos?.length || !schedule.moo_nos?.length
      || e.moo_nos.map(Number).some(n => schedule.moo_nos.map(Number).includes(n))),
  )
}

/**
 * รายการรอบเก็บในช่วงวันที่ — คำนวณสดทุกครั้ง ไม่มีอะไรเก็บลงฐานข้อมูล
 *
 * @param {object}   p
 * @param {object[]} p.schedules   กฎที่เปิดใช้ (จาก get_public_waste_schedule หรือตารางตรง)
 * @param {object[]} p.exceptions  ข้อยกเว้น
 * @param {number?}  p.mooNo       หมู่ที่สนใจ (null = ทุกหมู่ ใช้ในหน้าเจ้าหน้าที่)
 * @param {string}   p.from        'YYYY-MM-DD'
 * @param {number}   p.days        จำนวนวันนับจาก from (รวม from)
 * @param {Function} p.holidayFn   (date) → ชื่อวันหยุด | null  — ฉีดเข้ามาได้เพื่อเทสต์
 * @param {Function} p.workingDayFn (date) → boolean
 * @returns {{date, originalDate, waste_type, status, reason, auto, holiday, schedule, exceptionMoo}[]}
 *   status: 'normal' | 'moved' | 'cancelled'
 *   auto:   true เมื่อระบบเลื่อน/งดเองจาก holiday_policy (ไม่ใช่เจ้าหน้าที่กด)
 */
export function computeCollections({
  schedules = [], exceptions = [], mooNo = null, from, days = 60,
  holidayFn = holidayName, workingDayFn = isWorkingDay,
}) {
  const fromIdx = dayIndex(from)
  if (fromIdx === null) return []
  const toIdx = fromIdx + days - 1
  // มองย้อนหลังด้วย — รอบของต้นเดือนที่ถูกเลื่อนมาอยู่ในช่วงที่ดูต้องไม่หาย
  const LOOKBACK = 31
  const out = []

  const applicable = schedules.filter(s => coversMoo(s.moo_nos, mooNo))

  for (let idx = fromIdx - LOOKBACK; idx <= toIdx; idx++) {
    const date = dateOfIndex(idx)
    for (const schedule of applicable) {
      if (!ruleOccursOn(schedule, date)) continue

      const item = {
        date, originalDate: date, waste_type: schedule.waste_type,
        status: 'normal', reason: null, auto: false, holiday: null,
        schedule, exceptionMoo: null,
      }

      const ex = findException(exceptions, date, schedule, mooNo)
      const holiday = holidayFn(date)

      if (ex) {
        item.reason = ex.reason || null
        item.exceptionMoo = ex.moo_nos?.length ? ex.moo_nos : null
        if (ex.action === 'cancel') item.status = 'cancelled'
        else { item.status = 'moved'; item.date = ex.new_date }
      } else if (holiday) {
        item.holiday = holiday
        if (schedule.holiday_policy === 'skip') {
          item.status = 'cancelled'; item.auto = true; item.reason = `ตรง${holiday}`
        } else if (schedule.holiday_policy === 'next_working_day') {
          item.status = 'moved'; item.auto = true; item.reason = `ตรง${holiday}`
          item.date = nextWorkingDayAfter(date, workingDayFn)
        }
      }

      const shownIdx = dayIndex(item.status === 'cancelled' ? item.originalDate : item.date)
      if (shownIdx >= fromIdx && shownIdx <= toIdx) out.push(item)
    }
  }

  return out.sort((a, b) =>
    a.date.localeCompare(b.date) || a.waste_type.localeCompare(b.waste_type))
}

// รอบถัดไปที่ "รถมาจริง" ของประเภทนี้ — ข้ามรายการที่งดไปแล้ว
export function nextCollection(items, wasteType, today) {
  return items.find(i => i.waste_type === wasteType && i.status !== 'cancelled' && i.date >= today) ?? null
}

// ข้อความตั้งต้นของคำร้อง "รถไม่มาเก็บ" — ผู้ร้องไม่ต้องพิมพ์เอง เจ้าหน้าที่ไม่ต้องโทรถามกลับ
export function missedPickupDetail({ item, mooNo, villages }) {
  const type = WASTE_TYPES[item?.waste_type]?.label ?? 'ขยะ'
  const when = item ? thaiLongDate(item.date) : ''
  const where = mooNo ? villageLabel(mooNo, villages) : ''
  return [`รถเก็บ${type}ไม่มาเก็บตามรอบ`, when, where].filter(Boolean).join(' ')
}
