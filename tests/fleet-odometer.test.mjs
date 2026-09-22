// เลขไมล์ที่พิมพ์ผิดต้องถูกจับได้ตั้งแต่ตอนบันทึก ไม่ใช่ให้ระบบเติมต่อจนผิดทั้งชุด
//
// เคสจริง เทศบาลตำบลน้ำเลา 15 ก.ย. 2569 (รถตู้ 1 คัน)
//   เลขออก 278,706 · เลขกลับพิมพ์เป็น 287,715 (ที่ถูก 278,715) → ระยะทาง 9,009 กม. ในทริป 34 นาที
//   ไม่มีอะไรเตือน แล้วระบบเติมเลขออกอัตโนมัติพาทริปถัดไปอีก 3 รายการผิดตาม
//   ทริปถัดไปได้เลขออก 287,715 ถ้าคนขับพิมพ์เลขหน้าปัดจริง 278,723 ตอนกลับ ระบบเดิมบล็อกทิ้ง

import assert from 'node:assert/strict'
import {
  FLEET_TRIP_KM_CONFIRM,
  checkTripOdometer,
  isImplausibleTripDistance,
} from '../src/lib/fleetOdometer.js'

const EMPTY = { distance: null, backwards: false, implausible: false, suggestedEnd: null, suggestedStart: null }

/* ── 1. เคสจริง: เลขกลับสลับหลัก ── */
const real = checkTripOdometer(278706, 287715)
assert.equal(real.distance, 9009)
assert.equal(real.implausible, true, 'ระยะ 9,009 กม. ต้องถูกจับ')
assert.equal(real.backwards, false)
assert.equal(real.suggestedEnd, 278715, 'ต้องเสนอเลขที่ตั้งใจพิมพ์ (3 หลักท้ายเดิม หลักพันตามเลขออก)')
assert.equal(real.suggestedStart, null)

/* ── 2. เคสจริงทริปถัดไป: เลขออกผิดเพราะระบบเติมต่อ คนขับพิมพ์เลขหน้าปัดจริงตอนกลับ ── */
const inherited = checkTripOdometer(287715, 278723)
assert.equal(inherited.backwards, true, 'ต้องบอกว่าถอยหลัง ไม่ใช่เงียบ')
assert.equal(inherited.implausible, false)
assert.equal(inherited.suggestedStart, 278715, 'ต้องเสนอเลขออกที่น่าจะถูก (ถือเลขหน้าปัดตอนกลับเป็นหลัก)')
assert.equal(inherited.suggestedEnd, null)

/* ── 3. วิ่งข้ามหลักพัน — ค่าที่เสนอต้องเลื่อนตามทิศ ไม่ใช่กระโดดผิดฝั่ง ── */
assert.equal(checkTripOdometer(278990, 287012).suggestedEnd, 279012)
assert.equal(checkTripOdometer(288990, 279005).suggestedStart, 278990)

/* ── 4. ทริปไกลจริง — เตือน แต่ห้ามเสนอเลขที่เท่ากับที่พิมพ์มาเอง ── */
const longTrip = checkTripOdometer(278706, 279306)
assert.equal(longTrip.distance, 600)
assert.equal(longTrip.implausible, true, 'เกินเกณฑ์ต้องให้ยืนยันเสมอ')
assert.equal(longTrip.suggestedEnd, null, 'เดาแล้วได้เลขเดิม = ไม่มีอะไรให้เสนอ')

/* ── 5. พิมพ์เกิน/ขาดหลัก — เดาไม่ได้ว่าหลักไหนเกินมา ห้ามเสนอมั่ว ── */
const extraDigit = checkTripOdometer(278706, 2787150)
assert.equal(extraDigit.implausible, true)
assert.equal(extraDigit.suggestedEnd, null)
const missingDigit = checkTripOdometer(278706, 27871)
assert.equal(missingDigit.backwards, true)
assert.equal(missingDigit.suggestedStart, null)

/* ── 6. ทริปปกติ — ไม่เตือนอะไรเลย ── */
for (const [start, end] of [[278706, 278715], [278706, 278706], [278706, 278706 + FLEET_TRIP_KM_CONFIRM]]) {
  const ok = checkTripOdometer(start, end)
  assert.equal(ok.implausible, false, `${start} → ${end} ต้องไม่เตือน`)
  assert.equal(ok.backwards, false)
  assert.equal(ok.suggestedEnd, null)
  assert.equal(ok.suggestedStart, null)
}

/* ── 7. ยังกรอกไม่ครบ / ค่าว่างจากฟอร์ม — ไม่ตัดสินอะไร ── */
for (const [start, end] of [['', ''], [278706, ''], [null, 278715], ['abc', 278715]]) {
  assert.deepEqual(checkTripOdometer(start, end), EMPTY)
}

/* ── 8. ค่าจาก input เป็นสตริง + ทศนิยมตามคอลัมน์ numeric(10,2) ── */
const fromInput = checkTripOdometer('278706.5', '287715.5')
assert.equal(fromInput.distance, 9009)
assert.equal(fromInput.suggestedEnd, 278715.5)

/* ── 9. ป้ายในประวัติ ── */
assert.equal(isImplausibleTripDistance('9009.00'), true)
assert.equal(isImplausibleTripDistance(FLEET_TRIP_KM_CONFIRM), false, 'เท่ากับเกณฑ์พอดียังไม่นับ')
assert.equal(isImplausibleTripDistance(null), false)

console.log('fleet-odometer: ผ่านทุกข้อ')
