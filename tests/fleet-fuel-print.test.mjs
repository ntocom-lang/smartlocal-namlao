import assert from 'node:assert/strict'
import { buildFleetFuelRecordHtml, fuelTypeLabel } from '../src/lib/fleetFuelPrint.js'

const record = {
  filled_at: '2026-08-31',
  liters: 40.5,
  price_per_liter: 32,
  total_cost: 1296,
  odometer: 20500,
  full_tank: true,
  fuel_type: 'diesel',
  fuel_station: '[TEST] ปั๊มจำลอง',
  receipt_no: 'R-001',
  notes: 'เติมระหว่างปฏิบัติงาน',
  efficiency_kml: 7.1,
  is_anomaly: false,
  fleet_vehicles: { name: '[TEST] รถกระบะ', license_plate: 'TEST 1234', meter_unit: 'km' },
  driver: { full_name: 'สมศักดิ์ คนขับ' },
  creator: { full_name: 'สมหมาย บันทึก' },
}

const html = buildFleetFuelRecordHtml({
  record,
  tenant: { name: 'เทศบาลตำบลทดสอบ' },
})

assert.match(html, /เทศบาลตำบลทดสอบ/)
assert.match(html, /บันทึกการเติมน้ำมันเชื้อเพลิง/)
assert.match(html, /31 สิงหาคม พ.ศ. 2569/)
assert.match(html, /TEST 1234/)
assert.match(html, /สมศักดิ์ คนขับ/)
assert.match(html, /สมหมาย บันทึก/)
assert.match(html, /ดีเซล/)
assert.match(html, /40\.500/)
assert.match(html, /1,296\.00/)
assert.match(html, /20,500/)
assert.match(html, /เต็มถัง/)
assert.match(html, /\[TEST\] ปั๊มจำลอง/)
assert.match(html, /R-001/)
assert.match(html, /ผู้ใช้รถ/)
assert.match(html, /ผู้บันทึก/)
assert.match(html, /หัวหน้ากอง/)
assert.ok(!html.includes('undefined') && !html.includes('NaN') && !html.includes('Invalid Date'))
assert.equal(fuelTypeLabel({ fuel_type: 'other', fuel_other_name: 'น้ำมันไฮดรอลิก' }), 'น้ำมันไฮดรอลิก')

const emptyDate = buildFleetFuelRecordHtml({
  record: { ...record, filled_at: '2026-08-31T00:00:00.000Z' },
  tenant: { name: 'เทศบาลตำบลทดสอบ' },
})
assert.ok(!emptyDate.includes('30 สิงหาคม'), 'วันที่เติมชนิด date ถูกเลื่อนเป็นวันก่อนเพราะตีความเป็น UTC')

// ── ช่องลงนามต้องใช้ของกลาง (src/lib/govSignBlock.js) ไม่ใช่โครงของใบนี้เอง ──────────
// ของเดิมจัดกึ่งกลาง "ของบล็อก" ทั้งเส้นและวงเล็บ วงเล็บจึงเยื้องไปทางซ้ายของเส้นครึ่งหนึ่ง
// ของคำว่า "ลงชื่อ" — อาการเดียวกับที่เจ้าของระบบจับได้จากใบยืมพัสดุที่พิมพ์ออกกระดาษ
assert.match(html, /class="sign-row"/, 'ช่องลงนามต้องมาจาก govSignRow() ของกลาง')
assert.match(html, /class="sign-axis"/)
// ช่องหัวหน้ากองไม่มีชื่อเสมอ (เซ็นสด) ต้องได้เส้นจุดในวงเล็บให้เขียนมือ ไม่ใช่วงเล็บเปล่า
assert.match(html, /\(\.{20,}\)/, 'ช่องที่ยังไม่มีชื่อต้องเป็นเส้นจุดในวงเล็บให้เขียนมือ')

console.log('fleet-fuel-print.test.mjs PASS')
