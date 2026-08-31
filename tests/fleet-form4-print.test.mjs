import assert from 'node:assert/strict'
import { buildFleetForm4Html, form4VehicleTitle, paginateForm4Trips } from '../src/lib/fleetForm4Print.js'

const vehicle = {
  name: 'รถตู้บรรทุกส่วนบุคคล',
  license_plate: 'บร 2521 แพร่',
}

const trip = {
  id: 'a',
  started_at: '2026-08-31T01:00:00.000Z', // 08:00 น. ไทย
  returned_at: '2026-08-31T10:30:00.000Z', // 17:30 น. ไทย
  odometer_start: 20000,
  odometer_end: 20128,
  distance_km: 128,
  destination: '[TEST] จุดจำลอง',
  notes: 'ตรวจงาน',
  backdated_reason: 'เหตุจำลอง',
  requester: { full_name: 'สมชาย ผู้ใช้รถ' },
  driver: { full_name: 'สมศักดิ์ คนขับ' },
  purpose: 'ห้ามโผล่ในแบบ 4',
  planned_departure: '2026-09-01T00:00:00.000Z',
  planned_return: '2026-09-01T12:00:00.000Z',
}

const html = buildFleetForm4Html({
  vehicle, trips: [trip], periodLabel: 'ประจำเดือน สิงหาคม พ.ศ. 2569',
})

assert.equal(form4VehicleTitle(vehicle), 'บันทึกการใช้รถตู้บรรทุกส่วนบุคคล')
assert.match(html, /แบบ 4/)
assert.match(html, /บันทึกการใช้รถตู้บรรทุกส่วนบุคคล/)
assert.match(html, /หมายเลขทะเบียน บร 2521 แพร่/)
assert.match(html, /ประจำเดือน สิงหาคม พ.ศ. 2569/)
assert.match(html, /A4 landscape/)
for (const header of [
  'ลำดับที่', 'ออกเดินทาง', 'ผู้ใช้รถ', 'สถานที่ไป',
  'เมื่อรถออก', 'กลับถึงสำนักงาน', 'กลับถึง', 'หน่วยงาน/',
  'รวม', 'พนักงานขับรถ', 'หมายเหตุ', 'วันที่', 'เวลา',
]) {
  assert.ok(html.includes(header), `หัวตารางไม่มี "${header}"`)
}

assert.match(html, /สมชาย ผู้ใช้รถ/)
assert.match(html, /สมศักดิ์ คนขับ/)
assert.match(html, /\[TEST\] จุดจำลอง/)
assert.match(html, /20,000/)
assert.match(html, /20,128/)
assert.match(html, />128</)
assert.match(html, /class="total"/)
assert.match(html, /รวมระยะทางทั้งสิ้น/)
assert.match(html, /กิโลเมตร/)
assert.match(html, /ตรวจงาน/)
assert.match(html, /ย้อนหลัง: เหตุจำลอง/)
assert.match(html, /2569/)
assert.ok(!html.includes('ห้ามโผล่ในแบบ 4'), 'วัตถุประสงค์ไม่ใช่ช่องของแบบ 4')
assert.ok(!html.includes('1/9/2569') && !html.includes('1/9/2026'),
  'แบบ 4 ต้องใช้เวลาออก/กลับจริง ไม่ใช่เวลาตามคำขอ')
assert.ok(!html.includes('undefined') && !html.includes('NaN') && !html.includes('Invalid Date'))

const blank = buildFleetForm4Html({ vehicle, trips: [] })
assert.equal((blank.match(/<section class="sheet">/g) || []).length, 1)
assert.equal((html.match(/<section class="sheet">/g) || []).length, 1)
assert.equal((blank.match(/<tbody>/g) || []).length, 1)
assert.equal((blank.match(/<tr[\s>]/g) || []).length, 24) // หัว 2 แถว + ว่าง 21 + รวม 1
assert.match(html, /thead \{ display: table-row-group; \}/)
assert.match(html, /page-break-inside: avoid/)

const many = Array.from({ length: 21 }, (_, i) => ({ ...trip, id: String(i + 1), destination: `จุด ${i + 1}` }))
const paged = paginateForm4Trips(many, 20)
assert.equal(paged.length, 2)
assert.equal(paged[0].filter(r => r.trip).length, 20)
assert.equal(paged[1].filter(r => r.trip).length, 1)
assert.equal(paged[1][0].seq, 21)
assert.ok(!paged[0].some(r => r.total), 'หน้าไม่สุดท้ายต้องไม่มีแถวรวม')
assert.equal(paged[1][19].total, true)

const summed = buildFleetForm4Html({
  vehicle,
  trips: [trip, { ...trip, id: 'b', distance_km: 52, odometer_start: 20128, odometer_end: 20180 }],
})
assert.match(summed, />180</)
assert.equal((summed.match(/<section class="sheet">/g) || []).length, 1)

const fullPage = paginateForm4Trips(Array.from({ length: 20 }, (_, i) => ({ ...trip, id: String(i + 1) })), 20)
assert.equal(fullPage.length, 2)
assert.equal(fullPage[0].filter(r => r.trip).length, 20)
assert.equal(fullPage[1].filter(r => r.trip).length, 0)
assert.equal(fullPage[1][19].total, true)

const nameHtml = buildFleetForm4Html({
  vehicle: { name: 'กระบะกองช่าง', license_plate: 'กท 1' },
  trips: [],
})
assert.match(nameHtml, /บันทึกการใช้รถ กระบะกองช่าง/)

const dateOnly = buildFleetForm4Html({
  vehicle,
  trips: [{
    id: 'legacy',
    trip_date: '2026-08-31',
    depart_time: '08:15:00',
    return_time: '16:40:00',
    destination: 'แพร่',
    odometer_start: 10,
    odometer_end: 20,
    requester: { full_name: 'นาย ก' },
    driver: { full_name: 'นาย ข' },
  }],
})
assert.match(dateOnly, /08:15/)
assert.match(dateOnly, /16:40/)
assert.ok(!dateOnly.includes('30/8/2569'), 'วันที่อย่างเดียวถูกเลื่อนเป็นวันก่อนเพราะตีความเป็น UTC')

console.log('fleet-form4-print.test.mjs PASS')
