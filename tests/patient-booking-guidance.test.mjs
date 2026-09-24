import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { bookingPlanGuidance, bookingStage, staffNextAction, driverNext, driverSteps, driverProgress } from '../src/lib/patientBooking.js'

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
  assert.equal(staffNextAction({ status: 'confirmed' }, { state: 'outbound' }).id, 'view')
  assert.equal(staffNextAction({ status: 'cancelled' }, null).id, 'view')
  const ranks = ['issue', 'cancel', 'confirm', 'docs', 'view'].map(id => [
    staffNextAction({ status: 'confirmed' }, { state: 'issue' }), staffNextAction({ status: 'confirmed', cancel_requested: true }, { state: 'confirmed' }),
    staffNextAction({ status: 'submitted' }, null), staffNextAction({ status: 'completed' }, { ...done, forward_letter_no: null }), staffNextAction({ status: 'cancelled' }, null),
  ].find(a => a.id === id).rank)
  assert.deepEqual([...ranks].sort((x, y) => x - y), ranks)
})
test('driver: round trip is 4 big presses, one-way is 2, each press fires the old commands in order', () => {
  const trip = (state, mode = 'wait') => ({ id: 'T', state, plan: { return_mode: mode } })
  const rider = (id, step, status = 'confirmed') => ({ id, trip_id: 'T', status, passenger_step: step })
  const two = [rider('A', 0), rider('B', 0), rider('X', 0, 'cancelled')]
  const presses = ['confirmed', 'outbound', 'hospital', 'returning'].map(state => driverNext(trip(state), two))
  assert.deepEqual(presses, ['ออกรถไปรับ', 'ส่งถึงโรงพยาบาลแล้ว', 'ออกไปรับกลับ', 'ส่งถึงบ้านแล้ว · จบงาน'])
  assert.equal(driverNext(trip('outbound', 'one_way'), two), 'ส่งถึงโรงพยาบาลแล้ว · จบงาน')
  assert.equal(driverNext(trip('issue'), two), '')
  assert.equal(driverNext(trip('completed'), two), '')
  // ส่งถึงโรงพยาบาล = ทุกคน 0→1→2 (ข้ามคนที่ถูกนำออกแล้ว) แล้วเดินเที่ยว
  assert.deepEqual(driverSteps(trip('outbound'), two).map(s => `${s.booking || 'trip'}:${s.action}`),
    ['A:passenger_next', 'A:passenger_next', 'B:passenger_next', 'B:passenger_next', 'trip:trip_next'])
  assert.deepEqual(driverSteps(trip('returning'), [rider('A', 2)]).map(s => s.booking || 'trip'), ['A', 'A', 'trip'])
  assert.deepEqual(driverSteps(trip('confirmed'), two).map(s => s.action), ['trip_next'])
  assert.deepEqual(driverSteps(trip('hospital'), two).map(s => s.action), ['trip_next'])
})
test('driver: pressing again after a dropped connection continues from where it stopped', () => {
  const trip = { id: 'T', state: 'outbound', plan: { return_mode: 'wait' } }
  // A บันทึกไปแล้ว 1 ขั้น B ครบแล้ว — เหลือ A อีก 1 ขั้นกับเดินเที่ยว ไม่ยิงซ้ำของที่บันทึกแล้ว
  const steps = driverSteps(trip, [{ id: 'A', trip_id: 'T', status: 'confirmed', passenger_step: 1 }, { id: 'B', trip_id: 'T', status: 'confirmed', passenger_step: 2 }])
  assert.deepEqual(steps.map(s => s.booking || 'trip'), ['A', 'trip'])
  // ไม่เหลือผู้เดินทาง: จบเที่ยวได้เลย ไม่ต้องออกไปรับใคร
  assert.equal(driverNext({ ...trip, state: 'hospital' }, []), 'จบเที่ยว · ไม่มีผู้เดินทางแล้ว')
  assert.deepEqual(driverSteps({ ...trip, state: 'hospital' }, []).map(s => s.action), ['trip_next', 'trip_next'])
})
test('driver step bar counts finished steps', () => {
  assert.deepEqual(['confirmed', 'outbound', 'hospital', 'returning', 'completed'].map(state => driverProgress({ state, plan: { return_mode: 'later' } })), [0, 1, 2, 3, 4])
  assert.equal(driverProgress({ state: 'completed', plan: { return_mode: 'one_way' } }), 2)
})
