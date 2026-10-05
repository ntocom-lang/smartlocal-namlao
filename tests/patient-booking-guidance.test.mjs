import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { bookingPlanGuidance, bookingStage, staffNextAction, driverNext, driverSteps, driverProgress, joinCandidates, paginate, thaiDay, workspaceTruncated, WORKSPACE_ROW_LIMIT, loadPageSize, savePageSize } from '../src/lib/patientBooking.js'

const error = 'เวลารับ–ส่งอยู่นอกเวลาบริการ'
const plan = { date: '2026-09-21', settings_revision: 3, booking_ids: ['one'], blocks: [{ start: '2026-09-21T00:00:00Z', end: '2026-09-21T09:00:00Z' }] }
const workspace = { settings: { revision: 3, office_start: 510, office_end: 990, seats: 2 } }

test('explains appointment outside the configured window without treating travel outside it as an error', () => {
  const issue = bookingPlanGuidance('เวลานัดแพทย์อยู่นอกช่วงที่เปิดรับจอง', plan, workspace)
  assert.equal(issue.known, true)
  assert.match(issue.detail, /08:30–16:30/)
  assert.deepEqual(issue.fixes, ['call', 'amend', 'cancel'])
})

test('explains 07:00 pickup against actual 08:30 opening, independently of browser timezone', () => {
  const issue = bookingPlanGuidance(error, plan, workspace)
  assert.match(issue.detail, /เริ่มรับ 07:00 ก่อนเวลาเปิดบริการ 08:30/)
  assert.match(issue.detail, /08:30–16:30/)
  assert.doesNotMatch(issue.detail, /หลังเวลาปิด/)
  // นอกเวลาบริการ: โทรประสาน → แก้วันเวลาแล้วยืนยันต่อ หรือยกเลิกพร้อมเหตุผล
  assert.deepEqual(issue.fixes, ['call', 'amend', 'cancel'])
})
test('explains late return independently, including split trips', () => {
  const late = { ...plan, blocks: [{ start: '2026-09-21T02:00:00Z', end: '2026-09-21T04:00:00Z' }, { start: '2026-09-21T07:00:00Z', end: '2026-09-21T11:00:00Z' }] }
  const issue = bookingPlanGuidance(error, late, workspace)
  assert.match(issue.detail, /หลังเวลาปิดบริการ 16:30/)
  assert.doesNotMatch(issue.detail, /ก่อนเวลาเปิด/)
})
test('does not invent default settings or use stale revision', () => {
  assert.equal(bookingPlanGuidance(error, plan).detail, '')
  assert.match(bookingPlanGuidance(error, plan, { settings: { ...workspace.settings, revision: 4 } }).detail, /ค่าตั้งเปลี่ยน/)
  assert.doesNotMatch(bookingPlanGuidance(error, plan, { settings: { ...workspace.settings, revision: 4 } }).detail, /08:30/)
  assert.match(bookingPlanGuidance(error, plan, { settings: { ...workspace.settings, office_start: 480 } }).detail, /ก่อนเวลาเปิดบริการ 08:00/)
})
test('shows actual capacity; "confirm this request alone" only when the plan has several people', () => {
  const single = bookingPlanGuidance('ที่นั่งไม่พอรวมผู้ติดตามและผู้ช่วยแล้ว', { ...plan, seats: 4 }, workspace)
  assert.match(single.detail, /4 ที่นั่ง.*2 ที่นั่ง/)
  assert.deepEqual(single.fixes, ['call', 'cancel'])
  const group = bookingPlanGuidance('ที่นั่งไม่พอรวมผู้ติดตามและผู้ช่วยแล้ว', { ...plan, seats: 4, booking_ids: ['one', 'two'] }, workspace)
  assert.deepEqual(group.fixes, ['single', 'call', 'cancel'])
})
test('shows only overlapping active trips, not cancelled or touching boundaries', () => {
  const trip = (id, state, start, end) => ({ id, state, booking_ids: [id], plan: { route_label: id, pickup_at: start, blocks: [{ start, end }] } })
  const trips = [trip('CONFLICT', 'confirmed', '2026-09-21T01:00:00Z', '2026-09-21T02:00:00Z'), trip('CANCELLED', 'cancelled', '2026-09-21T01:00:00Z', '2026-09-21T02:00:00Z'), trip('TOUCHING', 'confirmed', '2026-09-21T09:00:00Z', '2026-09-21T10:00:00Z')]
  const issue = bookingPlanGuidance('ทับช่วงรถหรือคนขับของเที่ยวที่ยืนยันแล้ว', plan, { trips })
  assert.match(issue.detail, /CONFLICT/)
  assert.doesNotMatch(issue.detail, /CANCELLED|TOUCHING/)
  assert.match(issue.text, /รถไม่ว่าง/)
  assert.ok(issue.fixes.includes('cancel') && issue.fixes.includes('call'))
})
test('every current server plan error has a one-sentence reason and a fix button, unknown errors retain original message', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260919180000_patient_booking_minimal_setup.sql', import.meta.url), 'utf8')
  const update = readFileSync(new URL('../supabase/migrations/20260924154340_patient_booking_exact_appointment_hours.sql', import.meta.url), 'utf8')
  const errors = [...`${sql}\n${update}`.matchAll(/array_append\(errors,'([^']+)'\)/g)].map(m => m[1])
  assert.ok(errors.length >= 20)
  for (const message of errors) {
    const issue = bookingPlanGuidance(message, { ...plan, booking_ids: ['one', 'two'] }, workspace)
    assert.ok(issue.known, message)
    assert.ok(issue.text && issue.fixes.length > 0, message)
  }
  const unknown = bookingPlanGuidance('ข้อความใหม่จากระบบ', plan)
  assert.equal(unknown.known, false)
  assert.equal(unknown.text, 'ข้อความใหม่จากระบบ')
  assert.deepEqual(unknown.fixes, ['reload', 'call'])
})
test('every community scheduler error has guidance and uses its own current hours', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261003130100_patient_booking_community_scheduler_rpc.sql', import.meta.url), 'utf8')
  for (const [, message] of sql.matchAll(/array_append\(errors,'([^']+)'\)/g)) {
    assert.ok(bookingPlanGuidance(message, { ...plan, booking_ids: ['one', 'two'] }, workspace).known, message)
  }
  const community = { ...plan, service_type: 'community', community_rules_version: 2 }
  const rules = { window_start: 360, window_end: 1200, rules_version: 2 }
  const message = 'เวลาที่ต้องถึงอยู่นอกช่วงบริการชุมชน'
  assert.match(bookingPlanGuidance(message, community, { ...workspace, community_rules: rules }).detail, /06:00–20:00/)
  assert.equal(bookingPlanGuidance(message, community, workspace).detail, '')
  assert.match(bookingPlanGuidance(message, community, { ...workspace, community_rules: { ...rules, rules_version: 3 } }).detail, /กฎบริการชุมชนเปลี่ยน/)
})
test('join candidates retain legacy patient trips and exclude every community combination', () => {
  const p = { ...plan, route_id: 'a', return_mode: 'wait' }
  const t = { id: 'trip', state: 'confirmed', booking_ids: ['other'], plan: { ...p } }
  assert.deepEqual(joinCandidates(p, [t]), [t])
  assert.deepEqual(joinCandidates({ ...p, service_type: 'community' }, [t]), [])
  assert.deepEqual(joinCandidates(p, [{ ...t, plan: { ...t.plan, service_type: 'community' } }]), [])
})
test('inbox stage counts an incident under the step it happened in', () => {
  const booking = status => ({ status })
  assert.equal(bookingStage(booking('submitted'), null), 'submitted')
  assert.equal(bookingStage(booking('confirmed'), { state: 'confirmed' }), 'confirmed')
  assert.equal(bookingStage(booking('confirmed'), { state: 'hospital' }), 'running')
  assert.equal(bookingStage(booking('confirmed'), { state: 'issue', state_before_issue: 'outbound' }), 'running')
  assert.equal(bookingStage(booking('confirmed'), { state: 'issue', state_before_issue: 'confirmed' }), 'confirmed')
  assert.equal(bookingStage(booking('completed'), { state: 'completed' }), 'completed')
  assert.equal(bookingStage(booking('cancelled'), null), 'cancelled')
})
test('one next-step button per row, most urgent first', () => {
  const done = { state: 'completed', forward_letter_no: 'พร 1/1', odometer_end: 120, odometer_issue: false }
  assert.equal(staffNextAction({ status: 'submitted' }, null).id, 'confirm')
  assert.equal(staffNextAction({ status: 'confirmed', cancel_requested: true }, { state: 'issue' }).id, 'issue')
  assert.equal(staffNextAction({ status: 'confirmed', cancel_requested: true }, { state: 'confirmed' }).id, 'cancel')
  assert.equal(staffNextAction({ status: 'completed' }, { ...done, forward_letter_no: null }).id, 'docs')
  assert.equal(staffNextAction({ status: 'completed' }, { ...done, odometer_end: null }).id, 'docs')
  assert.equal(staffNextAction({ status: 'completed' }, done).id, 'view')
  // เลขหนังสือแยกรายคน (2569-10-02): คำขอที่มีเลขของตัวเองไม่ต้องรอเลขของเที่ยว · ไม่มีทั้งเลขของคำขอและของเที่ยว = ยังต้องบันทึกเอกสาร
  const noTripLetter = { ...done, forward_letter_no: null }
  assert.equal(staffNextAction({ status: 'completed', forward_letter_no: 'พร 2/2', forward_letter_date: '2026-10-02' }, noTripLetter).id, 'view')
  assert.equal(staffNextAction({ status: 'completed', forward_letter_no: null }, noTripLetter).id, 'docs')
  assert.equal(staffNextAction({ status: 'completed', forward_letter_no: 'พร 2/2' }, { ...noTripLetter, odometer_end: null }).id, 'docs', 'เลขไมล์ยังค้างอยู่ งานเอกสารต้องไม่หาย')
  assert.equal(staffNextAction({ status: 'confirmed' }, { state: 'outbound' }).id, 'view')
  assert.equal(staffNextAction({ status: 'cancelled' }, null).id, 'view')
  const ranks = ['issue', 'cancel', 'confirm', 'docs', 'view'].map(id => [
    staffNextAction({ status: 'confirmed' }, { state: 'issue' }), staffNextAction({ status: 'confirmed', cancel_requested: true }, { state: 'confirmed' }),
    staffNextAction({ status: 'submitted' }, null), staffNextAction({ status: 'completed' }, { ...done, forward_letter_no: null }), staffNextAction({ status: 'cancelled' }, null),
  ].find(a => a.id === id).rank)
  assert.deepEqual([...ranks].sort((x, y) => x - y), ranks)
})
test('driver: two actions for all modes, legacy states finish atomically', () => {
  for (const mode of ['wait', 'later', 'one_way']) {
    for (const state of ['outbound', 'hospital', 'returning']) {
      const trip = { state, plan: { return_mode: mode } }
      assert.equal(driverNext(trip), 'กลับแล้ว · จบงาน')
      assert.deepEqual(driverSteps(trip), [{ booking: null, action: 'trip_finish' }])
      assert.equal(driverProgress(trip), 1)
    }
  }
  assert.equal(driverNext({state:'confirmed'}), 'ออกรถ')
  assert.deepEqual(driverSteps({state:'confirmed'}), [{booking:null,action:'trip_next'}])
  for (const state of ['issue','completed','cancelled']) {
    assert.equal(driverNext({state}), '')
    assert.deepEqual(driverSteps({state}), [])
  }
  assert.equal(driverProgress({state:'completed'}), 2)
})

// แบ่งหน้ารายการเจ้าหน้าที่ (เจ้าของระบบสั่ง 2569-10-05): ตัดหน้าตามหน่วย กรอบเที่ยวเดียวกันเป็นหน่วยเดียว ไม่ถูกตัดคร่อม
const units = (...sizes) => sizes.map((size, id) => ({ id, size }))
const shape = r => ({ page: r.page, pages: r.pages, ids: r.units.map(u => u.id), from: r.from, to: r.to, total: r.total })
test('paginate: pages hold perPage rows, numbering is continuous and the page is clamped', () => {
  assert.deepEqual(shape(paginate(units(1, 1, 1, 1, 1), 2, 1)), { page: 1, pages: 3, ids: [0, 1], from: 1, to: 2, total: 5 })
  assert.deepEqual(shape(paginate(units(1, 1, 1, 1, 1), 2, 3)), { page: 3, pages: 3, ids: [4], from: 5, to: 5, total: 5 })
  assert.equal(paginate(units(1, 1, 1), 2, 99).page, 2, 'หน้าที่เกินช่วงถูกบีบเข้าหน้าสุดท้าย (รายการลดลงหลังบันทึก)')
  assert.equal(paginate(units(1, 1, 1), 2, 0).page, 1)
  assert.equal(paginate(units(1, 1, 1), 2, 'x').page, 1)
  assert.deepEqual(shape(paginate([], 20, 1)), { page: 1, pages: 1, ids: [], from: 0, to: 0, total: 0 })
})
test('paginate: a trip frame is never split across pages', () => {
  // กรอบ 4 คนตกที่ขอบหน้า: หน้าเกิน perPage ได้ แต่กรอบอยู่ครบในหน้าเดียวเสมอ
  const result = paginate(units(1, 4, 1, 1), 2, 1)
  assert.deepEqual(shape(result), { page: 1, pages: 2, ids: [0, 1], from: 1, to: 5, total: 7 })
  assert.deepEqual(shape(paginate(units(1, 4, 1, 1), 2, 2)).ids, [2, 3])
  for (let perPage = 1; perPage <= 8; perPage++) {
    const sizes = [3, 1, 4, 2, 1, 5, 1]
    const ids = Array.from({ length: paginate(units(...sizes), perPage, 1).pages }, (_, i) => paginate(units(...sizes), perPage, i + 1).units.map(u => u.id))
    assert.deepEqual(ids.flat(), sizes.map((_, i) => i), `ทุกหน่วยต้องอยู่หน้าเดียว ไม่ซ้ำ ไม่ตก (perPage ${perPage})`)
  }
})
test('paginate: all rows on one page for "all"; folded (size 0) units never open an empty page', () => {
  assert.deepEqual(shape(paginate(units(1, 1, 1, 1), 'all', 5)), { page: 1, pages: 1, ids: [0, 1, 2, 3], from: 1, to: 4, total: 4 })
  // ส่วนที่พับอยู่ (size 0) ตกท้ายหน้าสุดท้าย ไม่ได้หน้าใหม่ที่มีแต่หัวกลุ่ม
  assert.deepEqual(shape(paginate(units(1, 1, 0, 0), 2, 1)), { page: 1, pages: 1, ids: [0, 1, 2, 3], from: 1, to: 2, total: 2 })
  assert.deepEqual(shape(paginate(units(1, 1, 1, 0), 2, 2)), { page: 2, pages: 2, ids: [2, 3], from: 3, to: 3, total: 3 })
  assert.deepEqual(shape(paginate(units(0, 0), 2, 1)), { page: 1, pages: 1, ids: [0, 1], from: 0, to: 0, total: 0 })
})
test('workspace cap: the staff page warns when the database sent its maximum', () => {
  const rows = n => Array.from({ length: n }, (_, i) => ({ id: i }))
  assert.equal(WORKSPACE_ROW_LIMIT, 1000, 'ต้องตรงกับ LIMIT 1000 ใน patient_booking_workspace_v2')
  assert.equal(workspaceTruncated({ bookings: rows(999), trips: rows(10) }), false)
  assert.equal(workspaceTruncated({ bookings: rows(1000), trips: [] }), true)
  assert.equal(workspaceTruncated({ bookings: [], trips: rows(1000) }), true)
  assert.equal(workspaceTruncated(null), false)
  assert.equal(workspaceTruncated({}), false)
})
test('thaiDay keeps Bangkok calendar day (shared formatter must not change results)', () => {
  assert.equal(thaiDay('2026-10-04T18:00:00Z'), '2026-10-05', '18:00 UTC = 01:00 วันถัดไปที่กรุงเทพ')
  assert.equal(thaiDay('2026-10-04T16:59:59Z'), '2026-10-04')
  assert.equal(thaiDay(Date.UTC(2026, 0, 1, 17, 0, 0)), '2026-01-02')
  assert.match(thaiDay(), /^\d{4}-\d{2}-\d{2}$/)
})
test('page size preference: remembered per device, junk and missing storage fall back to 20', () => {
  assert.equal(loadPageSize(), 20, 'ไม่มี localStorage (โหมดส่วนตัว/เซิร์ฟเวอร์) ต้องใช้ค่าตั้งต้นไม่พัง')
  assert.doesNotThrow(() => savePageSize(50))
  const store = new Map()
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) }
  try {
    assert.equal(loadPageSize(), 20)
    savePageSize(50); assert.equal(loadPageSize(), 50)
    savePageSize('all'); assert.equal(loadPageSize(), 'all')
    savePageSize(10); assert.equal(loadPageSize(), 10)
    for (const junk of ['7', 'abc', '', '0', '-1']) { store.set('ptb-staff-page-size', junk); assert.equal(loadPageSize(), 20, `ค่าเพี้ยน ${JSON.stringify(junk)} ต้องใช้ค่าตั้งต้น`) }
  } finally { delete globalThis.localStorage }
})
