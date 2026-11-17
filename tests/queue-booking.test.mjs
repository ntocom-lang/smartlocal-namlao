// จองคิวรับบริการ — เทสต์ฟังก์ชันล้วน (src/lib/queueBooking.js) + การลงทะเบียนโมดูลทุกจุด
// ไม่ต่อเน็ต/ฐานข้อมูล · รันด้วย: node tests/queue-booking.test.mjs  (ส่วนฐานข้อมูลอยู่ที่ tests/queue-booking-db.test.mjs)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  QUEUE_BOOKING_MODULE_KEY, addDaysStr, bangkokToday, bookableDates, bookingStatus, canCancelBooking, hhmm,
  isoWeekday, openingText, slotRange, slotStarts, slotsPerDay, sortBookings, summarizeBookings,
  thaiLongDay, thaiShortDay, weekdaysText,
} from '../src/lib/queueBooking.js'
import { MANAGED_MODULE_KEYS, MODULE_GROUPS, moduleForPath } from '../src/lib/staffModules.js'
import { EXECUTIVE_REGISTRY } from '../src/lib/executiveRegistry.js'
import { STAFF_MENU_MODULE_KEYS } from '../src/lib/staffMenuAccess.js'
import { PAGE_CATALOG } from '../src/lib/siteOpenStats.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}

// ── ปฏิทินอ้างอิง (ยืนยันก่อนใช้ ไม่งั้นเทสต์ผ่านเพราะเข้าใจวันผิดกันทั้งคู่) ──
assert.equal(isoWeekday('2026-12-28'), 1) // จันทร์
assert.equal(isoWeekday('2026-12-27'), 7) // อาทิตย์ (ISO = 7 ไม่ใช่ 0)
assert.equal(isoWeekday('2027-01-01'), 5) // ศุกร์
assert.equal(isoWeekday('ไม่ใช่วันที่'), null)

const svc = (over = {}) => ({
  open_weekdays: [1, 2, 3, 4, 5], start_time: '08:30:00', end_time: '16:30:00', slot_minutes: 30, per_slot_quota: 3, book_ahead_days: 30, ...over,
})

test('คีย์โมดูล = queue-booking', () => {
  assert.equal(QUEUE_BOOKING_MODULE_KEY, 'queue-booking')
})

test('วันนี้ตามเวลาไทย: ข้ามเที่ยงคืนไทย (17:00Z) เป็นวันใหม่ ไม่ขึ้นกับ timezone เครื่อง', () => {
  assert.equal(bangkokToday(new Date('2026-12-31T16:59:00Z')), '2026-12-31')
  assert.equal(bangkokToday(new Date('2026-12-31T17:00:00Z')), '2027-01-01')
  assert.equal(bangkokToday(new Date('2026-02-28T17:30:00Z')), '2026-03-01')
})

test('addDaysStr ข้ามเดือน/ปี/ปีอธิกสุรทิน', () => {
  assert.equal(addDaysStr('2026-12-31', 1), '2027-01-01')
  assert.equal(addDaysStr('2028-02-28', 1), '2028-02-29')
  assert.equal(addDaysStr('2027-03-01', -1), '2027-02-28')
  assert.equal(addDaysStr('x', 1), null)
})

test('วันที่จองได้: ข้ามเดือน/ปี และตัดวันหยุดสุดสัปดาห์ (จันทร์–ศุกร์)', () => {
  const dates = bookableDates(svc({ book_ahead_days: 10 }), '2026-12-28')
  assert.deepEqual(dates, ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07'])
})

test('วันที่จองได้: วันนี้นับด้วย · เปิดเฉพาะวันอาทิตย์ (ISO 7) · วันปิดไม่โผล่', () => {
  const sundays = bookableDates(svc({ open_weekdays: [7], book_ahead_days: 14 }), '2026-12-27')
  assert.deepEqual(sundays, ['2026-12-27', '2027-01-03', '2027-01-10'])
  // วันนี้เป็นวันปิด → ไม่ขึ้น แต่วันเปิดถัดไปยังขึ้น
  assert.deepEqual(bookableDates(svc({ open_weekdays: [1], book_ahead_days: 7 }), '2026-12-27'), ['2026-12-28'])
  // จองล่วงหน้า 0 วัน = วันนี้วันเดียว (ถ้าเปิด)
  assert.deepEqual(bookableDates(svc({ book_ahead_days: 0 }), '2026-12-28'), ['2026-12-28'])
  assert.deepEqual(bookableDates(svc({ book_ahead_days: 0 }), '2026-12-27'), [])
})

test('วันที่จองได้: ข้อมูลผิดรูป/ไม่ตั้งวันเปิด = ไม่มีวัน (ไม่พัง) · เพดาน 180 วัน', () => {
  assert.deepEqual(bookableDates(svc({ open_weekdays: [] }), '2026-12-28'), [])
  assert.deepEqual(bookableDates(null, '2026-12-28'), [])
  assert.deepEqual(bookableDates(svc(), 'ไม่ใช่วันที่'), [])
  assert.equal(bookableDates(svc({ open_weekdays: [1, 2, 3, 4, 5, 6, 7], book_ahead_days: 999 }), '2026-12-28').length, 181)
})

test('ช่องเวลา: 08:30–16:30 ช่องละ 30 นาที = 16 ช่อง เริ่ม 08:30 ช่องสุดท้าย 16:00', () => {
  const starts = slotStarts(svc())
  assert.equal(starts.length, 16)
  assert.equal(starts[0], '08:30')
  assert.equal(starts[15], '16:00')
})

test('ช่องเวลา: ช่องสุดท้ายต้องจบไม่เกินเวลาปิด (45 นาที → 10 ช่อง) · ช่วงสั้นกว่าช่อง/ค่าผิด = 0 ช่อง', () => {
  const starts = slotStarts(svc({ slot_minutes: 45 }))
  assert.equal(starts.length, 10)
  assert.equal(starts[9], '15:15')
  assert.equal(slotRange(starts[9], 45), '15:15–16:00')
  assert.deepEqual(slotStarts(svc({ start_time: '09:00', end_time: '09:20' })), [])
  assert.deepEqual(slotStarts(svc({ end_time: '08:30' })), [])
  assert.deepEqual(slotStarts(svc({ slot_minutes: 0 })), [])
  assert.deepEqual(slotStarts(null), [])
})

test('ช่วงเวลา HH:MM–HH:MM จาก slot_minutes (ข้ามชั่วโมง) + ฟอร์แมต hhmm จาก HH:MM:SS', () => {
  assert.equal(slotRange('09:00:00', 30), '09:00–09:30')
  assert.equal(slotRange('09:45:00', 30), '09:45–10:15')
  assert.equal(slotRange('08:30', 60), '08:30–09:30')
  assert.equal(slotRange('09:00:00', undefined), '09:00') // ไม่รู้ความยาว = แสดงเวลาเริ่มอย่างเดียว
  assert.equal(hhmm('08:30:00'), '08:30')
  assert.equal(hhmm('8:05'), '08:05')
  assert.equal(hhmm(null), '')
})

test('จำนวนช่อง/ความจุต่อวัน (ตัวอย่างบนฟอร์มตั้งค่า)', () => {
  assert.deepEqual(slotsPerDay(svc()), { slots: 16, capacity: 48 })
  assert.deepEqual(slotsPerDay(svc({ per_slot_quota: 1, slot_minutes: 60 })), { slots: 8, capacity: 8 })
  assert.deepEqual(slotsPerDay(svc({ end_time: '08:30' })), { slots: 0, capacity: 0 })
})

test('สรุปวันเปิดและเวลาเปิดบนการ์ด', () => {
  assert.equal(weekdaysText([1, 2, 3, 4, 5]), 'จ.–ศ.')
  assert.equal(weekdaysText([1, 3]), 'จ. พ.')
  assert.equal(weekdaysText([1, 2, 3, 5, 6, 7]), 'จ.–พ. ศ.–อา.')
  assert.equal(weekdaysText([7]), 'อา.')
  assert.equal(weekdaysText([]), 'ยังไม่ได้ตั้งวันเปิด')
  assert.equal(openingText(svc()), 'จ.–ศ. 08:30–16:30 น.')
})

test('ป้ายวันที่ไทย (พ.ศ.) ข้ามปี', () => {
  assert.equal(thaiShortDay('2027-01-01'), 'ศ. 1 ม.ค. 70')
  assert.equal(thaiLongDay('2026-12-27'), 'วันอาทิตย์ที่ 27 ธ.ค. 2569')
  assert.equal(thaiLongDay('xx'), '')
})

test('ป้ายสถานะ 4 แบบ + ค่าที่ไม่รู้จักไม่พัง', () => {
  for (const k of ['booked', 'arrived', 'no_show', 'cancelled']) {
    const s = bookingStatus(k)
    assert.ok(s.label && s.color && s.bg, k)
  }
  assert.equal(bookingStatus('booked').label, 'รอรับบริการ')
  assert.equal(bookingStatus('arrived').label, 'มาแล้ว')
  assert.equal(bookingStatus('no_show').label, 'ไม่มา')
  assert.equal(bookingStatus('cancelled').label, 'ยกเลิก')
  assert.equal(bookingStatus('weird').label, 'weird')
})

test('ยกเลิกเองได้เฉพาะ booked ที่วันนัดยังไม่ผ่าน (วันนี้นับว่ายังไม่ผ่าน) — ตรงกับ cancel_queue_booking', () => {
  const today = '2026-12-28'
  assert.equal(canCancelBooking({ status: 'booked', booking_date: '2026-12-28' }, today), true)
  assert.equal(canCancelBooking({ status: 'booked', booking_date: '2027-01-02' }, today), true)
  assert.equal(canCancelBooking({ status: 'booked', booking_date: '2026-12-27' }, today), false)
  assert.equal(canCancelBooking({ status: 'arrived', booking_date: '2027-01-02' }, today), false)
  assert.equal(canCancelBooking({ status: 'cancelled', booking_date: '2027-01-02' }, today), false)
  assert.equal(canCancelBooking(null, today), false)
})

test('สรุปจำนวนคิวและเรียงเวลา→เลขคิว', () => {
  const rows = [
    { slot_time: '09:30:00', queue_no: 3, status: 'booked' },
    { slot_time: '09:00:00', queue_no: 2, status: 'arrived' },
    { slot_time: '09:00:00', queue_no: 1, status: 'cancelled' },
    { slot_time: '10:00:00', queue_no: 4, status: 'no_show' },
  ]
  assert.deepEqual(summarizeBookings(rows), { total: 4, booked: 1, arrived: 1, no_show: 1, cancelled: 1 })
  assert.deepEqual(summarizeBookings(null), { total: 0, booked: 0, arrived: 0, no_show: 0, cancelled: 0 })
  assert.deepEqual(sortBookings(rows).map(r => r.queue_no), [1, 2, 3, 4])
})

// ── การลงทะเบียนโมดูลทุกจุด (กันลืมจุดใดจุดหนึ่ง) ─────────────────────────────────────────

test('MODULE_GROUPS: อยู่ในกลุ่ม "งานบริการประชาชน" และเป็นคีย์ที่ตั้งค่าได้ (MANAGED_MODULE_KEYS)', () => {
  const group = MODULE_GROUPS.find((g) => g.items.some((i) => i.key === QUEUE_BOOKING_MODULE_KEY))
  assert.ok(group, 'ไม่พบ queue-booking ใน MODULE_GROUPS')
  assert.equal(group.group, 'งานบริการประชาชน')
  assert.ok(MANAGED_MODULE_KEYS.includes(QUEUE_BOOKING_MODULE_KEY))
})

test('route /queue-booking ถูกคุมด้วยโมดูล queue-booking (ModuleGuard) และมีชื่อหน้าในสถิติเข้าชม', () => {
  assert.equal(moduleForPath('/queue-booking'), QUEUE_BOOKING_MODULE_KEY)
  assert.ok(PAGE_CATALOG.some((p) => p.path === '/queue-booking' && p.key === 'queue-booking'))
  const app = read('src/App.jsx')
  assert.match(app, /<Route path="\/queue-booking" element=\{<QueueBooking \/>\}/)
  assert.match(app, /lazyWithRetry\(\(\) => import\('\.\/pages\/QueueBooking'\)\)/)
})

test('STANDALONE_GROUPS (staffNavGroups.js): เมนู queue-booking อยู่ในกลุ่ม งานบริการประชาชน ใช้ไอคอน CalendarClock และไม่ใช่เมนูลิงก์ภายนอก', () => {
  const src = read('src/lib/staffNavGroups.js')
  const block = src.slice(src.indexOf('export const STANDALONE_GROUPS = ['), src.indexOf('export const MODULES = ['))
  const groupStart = block.indexOf("group: 'งานบริการประชาชน'")
  const nextGroup = block.indexOf('group:', groupStart + 10)
  const serviceGroup = block.slice(groupStart, nextGroup)
  const line = serviceGroup.split(/\r?\n/).find((l) => l.includes("key: 'queue-booking'"))
  assert.ok(line, 'ไม่พบ queue-booking ในกลุ่มงานบริการประชาชน')
  assert.match(line, /Icon: CalendarClock/)
  assert.doesNotMatch(line, /externalUrl|newTab/)
  assert.ok(STAFF_MENU_MODULE_KEYS.includes(QUEUE_BOOKING_MODULE_KEY))
})

test('ห้องผู้บริหาร: ลงทะเบียน queue-booking (service · ไม่มี kpi/alert เพราะยังไม่มี RPC สรุป)', () => {
  const entry = EXECUTIVE_REGISTRY.find((e) => e.key === QUEUE_BOOKING_MODULE_KEY)
  assert.ok(entry, 'ไม่พบ queue-booking ใน EXECUTIVE_REGISTRY')
  assert.equal(entry.kind, 'module')
  assert.equal(entry.label, 'จองคิวรับบริการ')
  assert.equal(entry.icon, 'CalendarClock')
  assert.deepEqual(entry.zones, ['service'])
  assert.equal(entry.isCitizenService, true)
  assert.deepEqual(entry.docTypes, [])
  assert.equal(entry.summaryKey, null)
  assert.deepEqual(entry.link, { module: QUEUE_BOOKING_MODULE_KEY })
  assert.deepEqual([entry.kpis, entry.alerts, entry.reports], [[], [], []])
})

test('หน้าเจ้าหน้าที่: StaffDashboard render QueueBookingStaff เมื่อ activeModule = queue-booking (lazy import)', () => {
  const src = read('src/pages/StaffDashboard.jsx')
  assert.match(src, /const QueueBookingStaff = lazy\(\(\) => import\('\.\.\/components\/staff\/QueueBookingStaff'\)\)/)
  assert.match(src, /activeModule === 'queue-booking'[^\n]*<QueueBookingStaff /)
})

test('หน้าเจ้าหน้าที่/ประชาชนเขียนผ่าน RPC เท่านั้น: ไม่มี insert/update/delete ตรงบน queue_bookings', () => {
  for (const rel of ['src/components/staff/QueueBookingStaff.jsx', 'src/pages/QueueBooking.jsx']) {
    const src = read(rel)
    assert.doesNotMatch(src, /from\('queue_bookings'\)\s*\.(insert|update|delete|upsert)/, rel)
  }
  const staff = read('src/components/staff/QueueBookingStaff.jsx')
  assert.match(staff, /rpc\('mark_queue_booking'/)
  const citizen = read('src/pages/QueueBooking.jsx')
  for (const fn of ['book_queue_slot', 'cancel_queue_booking', 'queue_slot_availability']) assert.match(citizen, new RegExp(`rpc\\('${fn}'`))
})

test('ฟอร์มตั้งค่าบริการส่งเฉพาะคอลัมน์ที่ GRANT ไว้ (ไม่ส่ง id/created_by/created_at/updated_at และไม่ส่ง municipality_id ตอน UPDATE)', () => {
  const src = read('src/components/staff/QueueBookingStaff.jsx')
  const payload = src.slice(src.indexOf('const payload = {'), src.indexOf('let err'))
  for (const col of ['id', 'created_by', 'created_at', 'updated_at', 'municipality_id']) assert.doesNotMatch(payload, new RegExp(`(^|[\\s{,])${col}:`, 'm'), `payload ต้องไม่มี ${col}`)
  assert.match(payload, /department_id:/, 'ต้องอ่านได้ว่า regex ไม่ได้ลวง (department_id ยังอยู่ใน payload)')
  assert.match(src, /insert\(\{ \.\.\.payload, municipality_id: tenantId \}\)/)
  assert.match(src, /update\(payload\)\.eq\('id', form\.id\)/)
  assert.doesNotMatch(src, /queue_services'\)\s*\.delete/, 'แอดมินไม่มีปุ่มลบ ใช้ปิดบริการ (is_active)')
})

console.log(`\nok — ${cases} cases`)
