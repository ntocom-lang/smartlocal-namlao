// Isolated, synthetic content: document boundaries and service report semantics.
import assert from 'node:assert/strict'
import { buildCommunityRequestFormHtml, buildCommunityForwardLetterHtml } from '../src/lib/communityTransportPrint.js'
import { buildBookingRequestFormHtml, buildBookingForwardLetterHtml, buildTripMonthReportHtml } from '../src/lib/patientTransportPrint.js'
import { communityVehicleBlocks, communityTimeChoices, servicePeriodReport, serviceReportSummary, suggestGroups } from '../src/lib/patientBooking.js'

const tenant = { name: '[TEST] องค์การบริหารส่วนตำบลทดสอบ', org_type: 'อบต.', address: '[TEST] ที่ทำการ' }
const booking = { id: 'community-1', service_type: 'community', status: 'confirmed', trip_id: 'trip-1',
  group_label: '[TEST] กลุ่มชุมชน <script>alert(1)</script>', party_size: 7, purpose_code: 'activity-1', purpose_label: '[TEST] กิจกรรมชุมชน',
  route_label: '[TEST] ศูนย์ชุมชน', requester_name: '[TEST] ผู้ติดต่อ', phone: '0800000001', pickup: '[TEST] บ้านเลขที่ 99',
  appointment_at: '2026-10-04T07:00:00+07:00', return_mode: 'one_way', return_at: null, entry_channel: 'staff',
  patient_name: null, relation: null, companions: 0, share: false }
const trip = { id: 'trip-1', state: 'confirmed', plan: { service_type: 'community' } }
const args = { tenant, booking, trip, partner: { name: '[TEST] กองทุน' }, mayor: { name: '[TEST] ผู้มีอำนาจ', title: 'นายกองค์การบริหารส่วนตำบล' } }
for (const html of [buildCommunityRequestFormHtml(args), buildCommunityForwardLetterHtml(args)]) {
  assert(html.includes('ร่างเอกสารบริการชุมชน'))
  assert(html.includes('7 คน'))
  assert(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
  assert(!html.includes('<script>'))
  assert(!html.includes('sign-signed"'))
  assert(!html.includes('ใบคำขอรับสวัสดิการ'))
  assert(!html.includes('ค่าธรรมเนียม'))
}
assert.throws(() => buildCommunityForwardLetterHtml({ ...args, booking: { ...booking, status: 'submitted' } }), /หลังยืนยัน/)
assert.throws(() => buildCommunityForwardLetterHtml({ ...args, trip: { ...trip, id: 'other' } }), /หลังยืนยัน/)
assert.throws(() => buildCommunityRequestFormHtml({ ...args, booking: { ...booking, service_type: 'patient' } }), /เฉพาะคำขอชุมชน/)
for (const builder of [buildBookingRequestFormHtml, buildBookingForwardLetterHtml]) assert.throws(() => builder(args), /ชุมชน/)

// Boarding time must scale with the whole party; a split return may use two free windows.
const info = { buffer_minutes: 10, boarding_minutes: 2,
  community: { window_start: 360, window_end: 1200, places: [{ id: 'place', minutes: 45 }] } }
const form = { service_type: 'community', route_id: 'place', party_size: 7, time: '07:00', return_mode: 'later', back: '19:00' }
assert.deepEqual(communityVehicleBlocks(form, info), [{ start: 351, end: 479 }, { start: 1085, end: 1209 }])
const day = { date: '2026-10-04', status: 'open', community_free: [
  { start: '2026-10-04T05:51:00+07:00', end: '2026-10-04T07:59:00+07:00' },
  { start: '2026-10-04T18:05:00+07:00', end: '2026-10-04T20:09:00+07:00' },
] }
assert(communityTimeChoices(form, info, day).includes('07:00'))
assert(!communityTimeChoices({ ...form, return_mode: 'wait' }, info, day).includes('07:00'))
assert(!communityTimeChoices({ ...form, party_size: 8 }, info, day).includes('07:00'))
assert.equal(suggestGroups([{ ...booking, status: 'submitted', share: true, mobility: 'walk' }, { ...booking, id: 'community-2', status: 'submitted', share: true, mobility: 'walk' }], { seats: 15 }).length, 2)

const from = '2026-10-01', to = '2026-10-31'
const rows = [{ trip_id: 'patient', date: '2026-10-04', service_type: 'patient', state: 'completed', request_count: 2, people: 3, companions: 1, distance: 80, route_label: '[TEST] โรงพยาบาล' },
  { trip_id: 'community', date: '2026-10-04', service_type: 'community', state: 'completed', request_count: 1, people: 7, companions: 0, distance: null, route_label: '[TEST] ศูนย์ชุมชน' }]
const calls = []
const report = await servicePeriodReport(async (name, data) => {
  calls.push({ name, data })
  return name.endsWith('_v2') ? { from, to, service_type: null, trips: rows } : { from, to, trips: [{ trip_id: 'patient', letter_no: 'ทส 001/1, ทส 001/2', distance: 999 }] }
}, from, to)
assert.equal(report.trips[0].letter_no, 'ทส 001/1, ทส 001/2')
assert.equal(report.trips[0].distance, 80)
assert.equal(report.trips[1].distance, null)
assert.deepEqual([serviceReportSummary(report.trips).people, serviceReportSummary(report.trips).requests, serviceReportSummary(report.trips).distance], [10, 3, 80])
// เลขไมล์เหมาเป็นวัน: รายงานเรียกเลขไมล์รายวันช่วงเดียวกันด้วย (ตัวจำลองนี้ไม่ส่ง days → ใช้ระยะรายเที่ยวเดิม)
assert.deepEqual(calls.map(c => c.name).sort(), ['patient_booking_odometer_days', 'patient_booking_period_report', 'patient_booking_period_report_v2'])
assert.equal(report.days, null)
await assert.rejects(servicePeriodReport(async () => ({ from: '2026-09-01', to, trips: [] }), from, to), /ไม่ตรง/)
let communityCalls = 0
await servicePeriodReport(async () => { communityCalls++; return { from, to, service_type: 'community', trips: [rows[1]] } }, from, to, 'community')
assert.equal(communityCalls, 2, 'บริการชุมชนไม่ดึงเลขหนังสือผู้ป่วย แต่ยังดึงเลขไมล์รายวัน')
const printed = buildTripMonthReportHtml({ tenant, report, period: { from, to, label: '[TEST] ช่วงวันที่' } })
assert(printed.includes('ชุมชน'));assert(printed.includes('10'));assert(printed.includes('ทส 001/1'))
assert(!printed.includes('999'))
const missing = buildTripMonthReportHtml({ tenant, period: { from, to, label: '[TEST] ช่วงวันที่' }, report: { from, to, service_type: 'community', trips: [rows[1]] } })
assert(missing.includes('ยังไม่ครบ'))
console.log('PASS community documents: escaped content, draft/authority boundaries, independent patient templates; shared vehicle blocks; v2 people/request/distance totals and historical letter metadata')
