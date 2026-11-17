// จองคิวรับบริการ (ขั้น 1D · E2) — ฟังก์ชันล้วนของหน้าประชาชน + หน้าเจ้าหน้าที่ (ไม่ import supabase/React เทสต์ด้วย node ได้)
//
// ตัวตัดสินจริง (โควตา วันเปิด เวลาผ่านแล้ว) อยู่ที่ฐานข้อมูล: RPC book_queue_slot / queue_slot_availability
// ไฟล์นี้แค่ช่วยแสดงผล — รายการวันที่จองได้ที่คำนวณที่นี่ต้องตรงกับเงื่อนไขในฟังก์ชันนั้น
// (วันนี้ .. วันนี้ + book_ahead_days และ ISO weekday อยู่ใน open_weekdays) ไม่งั้นประชาชนกดแล้วเจอข้อความปฏิเสธ

export const QUEUE_BOOKING_MODULE_KEY = 'queue-booking'

// ISO weekday ตามคอลัมน์ queue_services.open_weekdays: 1 = จันทร์ … 7 = อาทิตย์ (ลำดับแสดงผลเริ่มจันทร์ — สัปดาห์ทำงาน)
export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]
const WEEKDAY_SHORT = { 1: 'จ.', 2: 'อ.', 3: 'พ.', 4: 'พฤ.', 5: 'ศ.', 6: 'ส.', 7: 'อา.' }
const WEEKDAY_LONG = { 1: 'จันทร์', 2: 'อังคาร', 3: 'พุธ', 4: 'พฤหัสบดี', 5: 'ศุกร์', 6: 'เสาร์', 7: 'อาทิตย์' }
const MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

export const weekdayShort = (n) => WEEKDAY_SHORT[n] ?? ''
export const weekdayLong = (n) => WEEKDAY_LONG[n] ?? ''

// สถานะของใบจอง (queue_bookings.status) — สีใช้ชุดเดียวกับป้ายสถานะของหน้าคำร้อง/คำขอ (ฟ้า/เขียว/แดง/เทา)
export const BOOKING_STATUS = {
  booked:    { label: 'รอรับบริการ', color: '#2563eb', bg: '#dbeafe' },
  arrived:   { label: 'มาแล้ว',      color: '#059669', bg: '#d1fae5' },
  no_show:   { label: 'ไม่มา',       color: '#b45309', bg: '#fef3c7' },
  cancelled: { label: 'ยกเลิก',      color: '#6b7280', bg: '#f3f4f6' },
}
export const bookingStatus = (status) => BOOKING_STATUS[status] ?? { label: String(status ?? ''), color: '#6b7280', bg: '#f3f4f6' }

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_PER_DAY = 86_400_000

function dayNumber(str) {
  const m = DATE_RE.exec(String(str ?? ''))
  return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / MS_PER_DAY) : null
}

function dateOfNumber(n) {
  const d = new Date(n * MS_PER_DAY)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** วันนี้ตามปฏิทินไทย (Asia/Bangkok) เป็น 'YYYY-MM-DD' — ไม่ขึ้นกับ timezone เครื่อง (ฐานข้อมูลตัดวันตามเวลาไทยเหมือนกัน) */
export function bangkokToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function addDaysStr(str, n) {
  const i = dayNumber(str)
  return i === null ? null : dateOfNumber(i + n)
}

/** ISO weekday ของวันที่ 'YYYY-MM-DD' (1 = จันทร์ … 7 = อาทิตย์) · รูปแบบผิด = null */
export function isoWeekday(str) {
  const i = dayNumber(str)
  if (i === null) return null
  return new Date(i * MS_PER_DAY).getUTCDay() || 7
}

/** "พฤ. 18 ธ.ค. 69" */
export function thaiShortDay(str) {
  const i = dayNumber(str)
  if (i === null) return ''
  const d = new Date(i * MS_PER_DAY)
  return `${WEEKDAY_SHORT[isoWeekday(str)]} ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${String(d.getUTCFullYear() + 543).slice(-2)}`
}

/** "วันพฤหัสบดีที่ 18 ธ.ค. 2569" */
export function thaiLongDay(str) {
  const i = dayNumber(str)
  if (i === null) return ''
  const d = new Date(i * MS_PER_DAY)
  return `วัน${WEEKDAY_LONG[isoWeekday(str)]}ที่ ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear() + 543}`
}

/**
 * วันที่จองได้ของบริการหนึ่ง: วันนี้ .. วันนี้ + book_ahead_days ที่ ISO weekday อยู่ใน open_weekdays
 * (ตรงกับเงื่อนไขของ queue_slot_availability/book_queue_slot) · ไม่ตัดวันหยุดราชการ — เจ้าหน้าที่ตั้งวันเปิดเองได้
 * @returns {string[]} 'YYYY-MM-DD' เรียงจากวันใกล้สุด
 */
export function bookableDates(service, today = bangkokToday()) {
  const start = dayNumber(today)
  const weekdays = Array.isArray(service?.open_weekdays) ? service.open_weekdays.map(Number) : []
  const ahead = Math.max(0, Math.min(180, Number(service?.book_ahead_days) || 0))
  if (start === null || weekdays.length === 0) return []
  const out = []
  for (let i = 0; i <= ahead; i += 1) {
    const dow = new Date((start + i) * MS_PER_DAY).getUTCDay() || 7
    if (weekdays.includes(dow)) out.push(dateOfNumber(start + i))
  }
  return out
}

/** 'HH:MM:SS' | 'HH:MM' → 'HH:MM' (ค่าผิดรูป = ข้อความว่าง) */
export function hhmm(time) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time ?? ''))
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''
}

function minutesOf(time) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time ?? ''))
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

function timeOfMinutes(total) {
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** ช่วงเวลาของช่องที่เริ่ม slotTime ยาว slotMinutes นาที เช่น '09:00–09:30' */
export function slotRange(slotTime, slotMinutes) {
  const start = minutesOf(slotTime)
  const len = Number(slotMinutes)
  if (start === null || !(len > 0)) return hhmm(slotTime)
  return `${timeOfMinutes(start)}–${timeOfMinutes(start + len)}`
}

/** ช่องเวลาทั้งหมดของวันเปิด (เริ่มเวลาเปิด เว้นทีละ slot_minutes จนช่องสุดท้ายจบไม่เกินเวลาปิด) — สูตรเดียวกับ queue_slot_availability */
export function slotStarts(service) {
  const start = minutesOf(service?.start_time)
  const end = minutesOf(service?.end_time)
  const len = Number(service?.slot_minutes)
  if (start === null || end === null || !(len > 0) || end <= start) return []
  const count = Math.floor((end - start) / len)
  return Array.from({ length: count }, (_, n) => timeOfMinutes(start + n * len))
}

/** จำนวนช่องต่อวัน + จำนวนคนที่รับได้ต่อวัน (ตัวอย่างบนฟอร์มตั้งค่าบริการ) */
export function slotsPerDay(service) {
  const slots = slotStarts(service).length
  return { slots, capacity: slots * (Number(service?.per_slot_quota) || 0) }
}

/** "จ.–ศ." / "จ. อ. พ." — สรุปวันเปิดสั้นๆ ให้อ่านบนการ์ด (วันติดกันตั้งแต่ 3 วันย่อเป็นช่วง) */
export function weekdaysText(weekdays) {
  const days = [...new Set((weekdays ?? []).map(Number))].filter((n) => n >= 1 && n <= 7).sort((a, b) => a - b)
  if (days.length === 0) return 'ยังไม่ได้ตั้งวันเปิด'
  const parts = []
  let from = days[0]
  let prev = days[0]
  const flush = () => {
    if (prev - from >= 2) parts.push(`${WEEKDAY_SHORT[from]}–${WEEKDAY_SHORT[prev]}`)
    else for (let n = from; n <= prev; n += 1) parts.push(WEEKDAY_SHORT[n])
  }
  for (let i = 1; i < days.length; i += 1) {
    if (days[i] === prev + 1) { prev = days[i]; continue }
    flush()
    from = days[i]
    prev = days[i]
  }
  flush()
  return parts.join(' ')
}

/** "จ.–ศ. 08:30–16:30 น." */
export function openingText(service) {
  return `${weekdaysText(service?.open_weekdays)} ${hhmm(service?.start_time)}–${hhmm(service?.end_time)} น.`
}

/** ใบจองที่ยังรอรับบริการและวันนัดยังไม่ผ่าน (วันนี้นับว่ายังไม่ผ่าน) = ยกเลิกเองได้ — ตรงกับเงื่อนไขของ cancel_queue_booking */
export function canCancelBooking(booking, today = bangkokToday()) {
  return booking?.status === 'booked' && String(booking.booking_date) >= today
}

/** สรุปจำนวนของรายการคิว (หัวหน้าจอเจ้าหน้าที่) */
export function summarizeBookings(rows) {
  const out = { total: 0, booked: 0, arrived: 0, no_show: 0, cancelled: 0 }
  for (const row of rows ?? []) {
    out.total += 1
    if (row?.status in out) out[row.status] += 1
  }
  return out
}

/** เรียงรายการคิว: เวลาก่อน แล้วเลขคิว */
export function sortBookings(rows) {
  return [...(rows ?? [])].sort((a, b) => String(a.slot_time).localeCompare(String(b.slot_time)) || (a.queue_no - b.queue_no))
}
