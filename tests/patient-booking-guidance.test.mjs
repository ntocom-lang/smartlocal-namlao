import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { bookingPlanGuidance } from '../src/lib/patientBooking.js'

const error = 'เวลารับ–ส่งอยู่นอกเวลาบริการ'
const plan = { date: '2026-09-21', settings_revision: 3, booking_ids: ['one'], blocks: [{ start: '2026-09-21T00:00:00Z', end: '2026-09-21T09:00:00Z' }] }
const workspace = { settings: { revision: 3, office_start: 510, office_end: 990, seats: 2 } }

test('explains 07:00 pickup against actual 08:30 opening, independently of browser timezone', () => {
  const issue = bookingPlanGuidance(error, plan, workspace)
  assert.match(issue.detail, /เริ่มรับ 07:00 ก่อนเวลาเปิดบริการ 08:30/)
  assert.match(issue.detail, /08:30–16:30/)
  assert.doesNotMatch(issue.detail, /หลังเวลาปิด/)
  assert.match(issue.advice, /ตั้งค่า/)
  assert.match(issue.advice, /แก้ข้อมูลหลังประสาน/)
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
test('shows actual capacity including companions and helper', () => {
  const issue = bookingPlanGuidance('ที่นั่งไม่พอรวมผู้ติดตามและผู้ช่วยแล้ว', { ...plan, seats: 4 }, workspace)
  assert.match(issue.detail, /4 ที่นั่ง.*2 ที่นั่ง/)
  assert.match(issue.advice, /ไม่เพิ่มจำนวนที่นั่ง/)
})
test('shows only overlapping active trips, not cancelled or touching boundaries', () => {
  const trip = (id, state, start, end) => ({ id, state, booking_ids: [id], plan: { route_label: id, pickup_at: start, blocks: [{ start, end }] } })
  const trips = [trip('CONFLICT', 'confirmed', '2026-09-21T01:00:00Z', '2026-09-21T02:00:00Z'), trip('CANCELLED', 'cancelled', '2026-09-21T01:00:00Z', '2026-09-21T02:00:00Z'), trip('TOUCHING', 'confirmed', '2026-09-21T09:00:00Z', '2026-09-21T10:00:00Z')]
  const issue = bookingPlanGuidance('ทับช่วงรถหรือคนขับของเที่ยวที่ยืนยันแล้ว', plan, { trips })
  assert.match(issue.detail, /CONFLICT/)
  assert.doesNotMatch(issue.detail, /CANCELLED|TOUCHING/)
})
test('every current server plan error has specific advice, unknown errors retain original message', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260919180000_patient_booking_minimal_setup.sql', import.meta.url), 'utf8')
  const errors = [...sql.matchAll(/array_append\(errors,'([^']+)'\)/g)].map(m => m[1])
  assert.ok(errors.length >= 20)
  for (const message of errors) assert.doesNotMatch(bookingPlanGuidance(message, plan, workspace).advice, /หากยังพบข้อความนี้/, message)
  const unknown = bookingPlanGuidance('ข้อความใหม่จากระบบ', plan)
  assert.equal(unknown.message, 'ข้อความใหม่จากระบบ')
  assert.match(unknown.advice, /แจ้งผู้ดูแล/)
})
