// การนับ "วันทำการของราชการ" สำหรับ SLA คำร้อง — ตัดเสาร์/อาทิตย์ และวันหยุดนักขัตฤกษ์
//
// ทำไมต้องมีไฟล์นี้: ระบบเดิมนับวันแบบปฏิทินล้วน (หาร 86400000) ทำให้คำร้องที่ยื่นก่อน
// วันหยุดยาวถูกนับว่า "เกินกำหนด" ทั้งที่สำนักงานยังไม่ได้เปิดทำการเลยแม้แต่วันเดียว
//
// ตารางวันหยุดมี 2 ชั้น:
//   1. ชั้น static ในไฟล์นี้ — baseline ที่ทำงานได้เสมอแม้ query ล้มเหลว (เน็ตหลุด/RLS พัง)
//   2. ตาราง public_holidays ใน DB — แอดมินแก้เองได้ผ่านหน้า "วันหยุดราชการ"
//      โหลดผ่าน loadHolidays() ตอนบูตแอป (เรียกจาก TenantContext) แล้วทับชั้น static
//
// ⚠️ ชั้น static ครอบคลุมแค่ พ.ศ. 2568–2569 ปีถัดไปต้องให้แอดมินกรอกใน DB (หรือเติมในไฟล์นี้)
//    ปีที่ไม่มีข้อมูลทั้งสองชั้น จะถอยไปนับแบบ "ตัดเฉพาะเสาร์-อาทิตย์" พร้อม console.warn
//    ไม่คำนวณผิดเงียบๆ และหน้าแอดมินจะขึ้นแถบเตือนให้เห็นด้วยตา (ดู missingHolidayYears())

// ─── ตารางวันหยุดราชการ ───────────────────────────────────────────────────────
// ที่มา: มติ ครม. / ประกาศสำนักนายกรัฐมนตรี (ตรวจทานกับหนังสือเวียนของหน่วยงานก่อนใช้จริง)
// หมายเหตุที่ตั้งใจ ไม่ใช่ตกหล่น:
//   - 1 พ.ค. วันแรงงานแห่งชาติ ไม่ใช่วันหยุดราชการ (เป็นวันหยุดภาคเอกชน/ธนาคาร) จึงไม่ใส่
//   - วันพืชมงคล เป็นวันหยุดราชการ แต่ไม่ใช่วันหยุดธนาคาร จึงใส่ไว้
//     ถ้าหน่วยงานไม่ได้หยุดวันนี้จริง ให้ลบบรรทัดนั้นออก
//   - วันหยุดตามประเพณีท้องถิ่นที่ อปท. ประกาศเอง ยังไม่รองรับ ต้องเติมเองในตารางนี้
const HOLIDAYS_BY_YEAR = {
  // พ.ศ. 2568
  2025: [
    ['2025-01-01', 'วันขึ้นปีใหม่'],
    ['2025-02-12', 'วันมาฆบูชา'],
    ['2025-04-06', 'วันจักรี'],
    ['2025-04-07', 'ชดเชยวันจักรี'],
    ['2025-04-13', 'วันสงกรานต์'],
    ['2025-04-14', 'วันสงกรานต์'],
    ['2025-04-15', 'วันสงกรานต์'],
    ['2025-04-16', 'ชดเชยวันสงกรานต์'],
    ['2025-05-04', 'วันฉัตรมงคล'],
    ['2025-05-05', 'ชดเชยวันฉัตรมงคล'],
    ['2025-05-09', 'วันพืชมงคล'],
    ['2025-05-11', 'วันวิสาขบูชา'],
    ['2025-05-12', 'ชดเชยวันวิสาขบูชา'],
    ['2025-06-02', 'วันหยุดราชการกรณีพิเศษ (มติ ครม.)'],
    ['2025-06-03', 'วันเฉลิมพระชนมพรรษาสมเด็จพระนางเจ้าฯ พระบรมราชินี'],
    ['2025-07-10', 'วันอาสาฬหบูชา'],
    ['2025-07-11', 'วันเข้าพรรษา'],
    ['2025-07-28', 'วันเฉลิมพระชนมพรรษาพระบาทสมเด็จพระเจ้าอยู่หัว'],
    ['2025-08-11', 'วันหยุดราชการกรณีพิเศษ (มติ ครม.)'],
    ['2025-08-12', 'วันเฉลิมพระชนมพรรษาสมเด็จพระบรมราชชนนีพันปีหลวง / วันแม่แห่งชาติ'],
    ['2025-10-13', 'วันนวมินทรมหาราช'],
    ['2025-10-23', 'วันปิยมหาราช'],
    ['2025-12-05', 'วันคล้ายวันพระบรมราชสมภพ ร.9 / วันพ่อแห่งชาติ'],
    ['2025-12-10', 'วันรัฐธรรมนูญ'],
    ['2025-12-31', 'วันสิ้นปี'],
  ],
  // พ.ศ. 2569
  2026: [
    ['2026-01-01', 'วันขึ้นปีใหม่'],
    ['2026-01-02', 'วันหยุดราชการกรณีพิเศษ (มติ ครม.)'],
    ['2026-03-03', 'วันมาฆบูชา'],
    ['2026-04-06', 'วันจักรี'],
    ['2026-04-13', 'วันสงกรานต์'],
    ['2026-04-14', 'วันสงกรานต์'],
    ['2026-04-15', 'วันสงกรานต์'],
    ['2026-05-04', 'วันฉัตรมงคล'],
    ['2026-05-13', 'วันพืชมงคล'],
    ['2026-05-31', 'วันวิสาขบูชา'],
    ['2026-06-01', 'ชดเชยวันวิสาขบูชา'],
    ['2026-06-03', 'วันเฉลิมพระชนมพรรษาสมเด็จพระนางเจ้าฯ พระบรมราชินี'],
    ['2026-07-28', 'วันเฉลิมพระชนมพรรษาพระบาทสมเด็จพระเจ้าอยู่หัว'],
    ['2026-07-29', 'วันอาสาฬหบูชา'],
    ['2026-07-30', 'วันเข้าพรรษา'],
    ['2026-08-12', 'วันเฉลิมพระชนมพรรษาสมเด็จพระบรมราชชนนีพันปีหลวง / วันแม่แห่งชาติ'],
    ['2026-10-13', 'วันนวมินทรมหาราช'],
    ['2026-10-23', 'วันปิยมหาราช'],
    ['2026-12-05', 'วันคล้ายวันพระบรมราชสมภพ ร.9 / วันพ่อแห่งชาติ'],
    ['2026-12-07', 'ชดเชยวันคล้ายวันพระบรมราชสมภพ ร.9'],
    ['2026-12-10', 'วันรัฐธรรมนูญ'],
    ['2026-12-31', 'วันสิ้นปี'],
  ],
}

// ปีที่ชั้น static ครอบคลุม (ค.ศ.)
const STATIC_YEARS = Object.keys(HOLIDAYS_BY_YEAR).map(Number).sort((a, b) => a - b)

const STATIC_HOLIDAYS = new Map()
for (const rows of Object.values(HOLIDAYS_BY_YEAR)) {
  for (const [dateStr, name] of rows) STATIC_HOLIDAYS.set(dateStr, name)
}

// ── สถานะที่คำนวณใหม่ได้ทุกครั้งที่แถวจาก DB เปลี่ยน ─────────────────────────
// HOLIDAY_NAMES / WEEKDAY_HOLIDAY_INDEXES / coveredYears ถูกสร้างใหม่ทั้งชุดใน rebuild()
// ห้ามใครถือ reference ของ 3 ตัวนี้ค้างไว้ข้ามการ rebuild
let HOLIDAY_NAMES = new Map()
let WEEKDAY_HOLIDAY_INDEXES = []
let coveredYears = []
let dbRows = []
const warnedYears = new Set()

// ─── แกนกลาง: แปลงวันเป็น "ลำดับวันนับจาก 1970-01-01" ──────────────────────────
// ยึด "วันตามปฏิทินของเครื่องผู้ใช้" เหมือน toDateStr() ใน thaiDate.js
// (ห้ามใช้ getTime()/86400000 ตรงๆ เพราะ timestamp มี timezone ติดมา จะเพี้ยนข้ามวัน)
const MS_PER_DAY = 86400000

function dayIndexOf(value) {
  if (value === null || value === undefined || value === '') return null
  let y, m, d
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    // คอลัมน์ชนิด date ของ Postgres (เช่น complaints.due_date) — อ่านตัวเลขตรงๆ
    // ห้ามโยนเข้า new Date() เพราะ 'YYYY-MM-DD' ล้วนจะถูกตีความเป็น UTC แล้วเลื่อนวัน
    y = +value.slice(0, 4); m = +value.slice(5, 7); d = +value.slice(8, 10)
  } else {
    const dt = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(dt.getTime())) return null
    y = dt.getFullYear(); m = dt.getMonth() + 1; d = dt.getDate()
  }
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY)
}

function dateStrOfIndex(index) {
  const dt = new Date(index * MS_PER_DAY)
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// 1970-01-01 ตรงกับวันพฤหัสบดี → dow = (index + 4) % 7 โดย 0 = อาทิตย์
function dowOfIndex(index) { return ((index + 4) % 7 + 7) % 7 }
function isWeekendIndex(index) { const dow = dowOfIndex(index); return dow === 0 || dow === 6 }

// ── การรวมสองชั้นเข้าด้วยกัน ─────────────────────────────────────────────────
// ลำดับการทับ: static → แถว global ของ DB → แถวของ อปท. นั้น (อันหลังชนะเสมอ)
// แถวที่ is_working_day = true คือ "ยกเลิกวันหยุด" จึงลบออกจาก Map แทนที่จะเพิ่ม
function rebuild() {
  const merged = new Map(STATIC_HOLIDAYS)
  const years = new Set(STATIC_YEARS)

  const ordered = [...dbRows].sort(
    (a, b) => (a.municipality_id ? 1 : 0) - (b.municipality_id ? 1 : 0)
  )
  for (const row of ordered) {
    const dateStr = typeof row?.holiday_date === 'string' ? row.holiday_date.slice(0, 10) : null
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue
    years.add(+dateStr.slice(0, 4))
    if (row.is_working_day) merged.delete(dateStr)
    else merged.set(dateStr, row.name || 'วันหยุด')
  }

  HOLIDAY_NAMES = merged
  coveredYears = [...years].sort((a, b) => a - b)
  // รายการ dayIndex ของวันหยุดที่ "ตรงกับวันจันทร์-ศุกร์" เท่านั้น เรียงจากน้อยไปมาก
  // (วันหยุดที่ตรงเสาร์/อาทิตย์ไม่ต้องหักซ้ำ เพราะถูกตัดออกจากสูตรวันธรรมดาไปแล้ว)
  WEEKDAY_HOLIDAY_INDEXES = [...merged.keys()]
    .map(dayIndexOf)
    .filter((i) => i !== null && !isWeekendIndex(i))
    .sort((a, b) => a - b)
  warnedYears.clear()
}

/**
 * ป้อนแถวจากตาราง public_holidays (เรียกจาก loadHolidays ใน src/lib/holidaysSource.js)
 * แทนที่แถว DB ชุดเดิมทั้งหมด ไม่ใช่การเพิ่มสะสม
 */
export function setHolidayRows(rows) {
  dbRows = Array.isArray(rows) ? rows : []
  rebuild()
}

/** ปีที่มีข้อมูลวันหยุด (static ∪ DB) เรียงจากน้อยไปมาก */
export function holidayYearsCovered() { return [...coveredYears] }

/**
 * ปีในช่วงที่ยังไม่มีข้อมูลวันหยุดเลย — ใช้ขึ้นแถบเตือนในหน้าแอดมิน
 * ค่าเริ่มต้นคือปีนี้ถึงปีหน้า เพราะเป็นช่วงที่ SLA คำร้องที่ยังไม่ปิดจะไปตกถึง
 */
export function missingHolidayYears(fromYear = new Date().getFullYear(), toYear = fromYear + 1) {
  const have = new Set(coveredYears)
  const missing = []
  for (let y = fromYear; y <= toYear; y++) if (!have.has(y)) missing.push(y)
  return missing
}

/**
 * วันหยุดของปีนั้นทั้งหมดหลังรวมสองชั้นแล้ว — ใช้แสดงในหน้าแอดมิน
 * source: 'static' = มาจากตารางในโค้ด (แก้ไม่ได้จากหน้าจอ) | 'db' = แถวในตาราง public_holidays
 */
export function holidaysOfYear(year) {
  const prefix = `${year}-`
  return [...HOLIDAY_NAMES.entries()]
    .filter(([dateStr]) => dateStr.startsWith(prefix))
    .map(([date, name]) => ({
      date,
      name,
      source: dbRows.some(r => String(r.holiday_date).slice(0, 10) === date) ? 'db' : 'static',
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// จำนวนวันหยุดวันธรรมดาที่ index <= n (binary search — ไม่วนทีละวัน)
function weekdayHolidaysUpTo(n) {
  let lo = 0, hi = WEEKDAY_HOLIDAY_INDEXES.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (WEEKDAY_HOLIDAY_INDEXES[mid] <= n) lo = mid + 1
    else hi = mid
  }
  return lo
}

// จำนวนวันจันทร์-ศุกร์ในช่วง [0, n] — สูตรสัปดาห์ละ 5 วัน + เศษไม่เกิน 6 วัน
function weekdaysUpTo(n) {
  const total = n + 1
  const fullWeeks = Math.floor(total / 7)
  let count = fullWeeks * 5
  const start = fullWeeks * 7
  for (let i = start; i < total; i++) if (!isWeekendIndex(i)) count++
  return count
}

// จำนวนวันทำการสะสมในช่วง [1970-01-01, n] — ใช้เป็น "เลขลำดับวันทำการ"
function businessOrdinal(n) { return weekdaysUpTo(n) - weekdayHolidaysUpTo(n) }

// ─── การเตือนเมื่อปีนั้นไม่มีในตารางวันหยุด ────────────────────────────────────
// เตือนปีละครั้งต่อการ rebuild หนึ่งรอบ (rebuild() ล้าง set นี้) ไม่งั้นรายงานที่วนคำร้อง
// หลายพันเรื่องจะยิง console.warn ท่วมจนหาอย่างอื่นไม่เจอ
function warnUncoveredRange(fromIndex, toIndex) {
  const lo = Math.min(fromIndex, toIndex), hi = Math.max(fromIndex, toIndex)
  const fromYear = new Date(lo * MS_PER_DAY).getUTCFullYear()
  const toYear = new Date(hi * MS_PER_DAY).getUTCFullYear()
  for (let y = fromYear; y <= toYear; y++) {
    if (coveredYears.includes(y)) continue
    if (warnedYears.has(y)) continue
    warnedYears.add(y)
    console.warn(
      `[workingDays] ยังไม่มีตารางวันหยุดราชการของปี ค.ศ. ${y} (พ.ศ. ${y + 543}) — ` +
      'ช่วงวันที่คาบเกี่ยวปีนี้จะนับโดยตัดเฉพาะเสาร์-อาทิตย์ ' +
      'ให้แอดมินเพิ่มวันหยุดของปีนั้นที่หน้า ตั้งค่า → วันหยุดราชการ'
    )
  }
}

// ─── API สาธารณะ ──────────────────────────────────────────────────────────────

/** ชื่อวันหยุดของวันที่กำหนด หรือ null ถ้าไม่ใช่วันหยุดนักขัตฤกษ์ */
export function holidayName(value) {
  const index = dayIndexOf(value)
  return index === null ? null : (HOLIDAY_NAMES.get(dateStrOfIndex(index)) || null)
}

/** วันนั้นเป็นวันทำการของราชการหรือไม่ (ไม่ใช่เสาร์/อาทิตย์ และไม่ใช่วันหยุดนักขัตฤกษ์) */
export function isWorkingDay(value) {
  const index = dayIndexOf(value)
  if (index === null) return false
  return !isWeekendIndex(index) && !HOLIDAY_NAMES.has(dateStrOfIndex(index))
}

/**
 * บวก n วันทำการจากวันที่ตั้งต้น คืนค่าเป็น 'YYYY-MM-DD' ตามปฏิทินของเครื่องผู้ใช้
 * ใช้ตั้ง complaints.due_date — ผลลัพธ์เป็นวันทำการเสมอ
 */
export function addWorkingDays(value, n) {
  const start = dayIndexOf(value)
  if (start === null) return null
  let index = start
  let added = 0
  // กันลูปไม่รู้จบถ้าตารางวันหยุดถูกกรอกผิดจนไม่เหลือวันทำการ
  const limit = Math.abs(n) * 7 + 400
  let steps = 0
  while (added < Math.abs(n) && steps < limit) {
    index += n >= 0 ? 1 : -1
    steps++
    if (!isWeekendIndex(index) && !HOLIDAY_NAMES.has(dateStrOfIndex(index))) added++
  }
  warnUncoveredRange(start, index)
  return dateStrOfIndex(index)
}

/**
 * จำนวนวันทำการระหว่างสองวัน นับแบบไม่รวมวันตั้งต้น รวมวันปลายทาง
 * สอดคล้องกับ addWorkingDays: workingDaysBetween(d, addWorkingDays(d, 15)) === 15
 * คืนค่าติดลบได้เมื่อ to อยู่ก่อน from
 */
export function workingDaysBetween(from, to) {
  const a = dayIndexOf(from), b = dayIndexOf(to)
  if (a === null || b === null) return null
  warnUncoveredRange(a, b)
  return businessOrdinal(b) - businessOrdinal(a)
}

/**
 * เหลืออีกกี่วันทำการจึงจะถึงกำหนด — ค่าติดลบคือเกินกำหนดมาแล้วกี่วันทำการ
 * 0 = ครบกำหนดวันนี้
 */
export function workingDaysLeft(dueDate, from = new Date()) {
  return workingDaysBetween(from, dueDate)
}

/**
 * อายุงานเป็นวันทำการนับจากวันที่กำหนดถึงวันนี้ (ไม่ติดลบ)
 * ใช้กับ "ค้างมาแล้ว N วันทำการ"
 */
export function workingDaysSince(value, to = new Date()) {
  const days = workingDaysBetween(value, to)
  return days === null ? 0 : Math.max(0, days)
}

// สร้างตารางชั้นแรกทันทีที่โมดูลถูกโหลด — ทุกฟังก์ชันข้างบนต้องใช้ได้ก่อน loadHolidays()
// จะยิง query เสร็จ ไม่งั้นหน้าจอเฟรมแรกจะนับวันผิดหรือพัง
rebuild()
