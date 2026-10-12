// Pure-logic test สำหรับ src/lib/staffHomeSummary.js — ตรรกะ "งานของฉัน/กองของฉัน" บนหน้าแรกเจ้าหน้าที่
// ไม่ใช้ฐานข้อมูล ไม่ใช้เบราว์เซอร์
//
// จุดที่ต้องกันที่สุดคือ todoState(): ถ้าตัดสินผิดจะขึ้น "ไม่มีงานค้าง" ทั้งที่ยังมีงานเลยกำหนด (ไฟเขียวปลอม)
import assert from 'node:assert/strict'
import {
  bucketComplaintDue, groupMyEvents, normalizeWorkload, shortTime, todoState,
} from '../src/lib/staffHomeSummary.js'

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}

// วันที่ในเคสเลือกช่วงกลาง ก.ย. 2569 ที่ไม่มีวันหยุดนักขัตฤกษ์ (วันที่ 13 ต.ค. เป็นวันหยุด จึงไม่ใช้) — ผลลัพธ์ "วันทำการถัดไป"
// มาจาก addWorkingDays ตัวเดียวกับที่ทุกหน้าใช้ ถ้าตารางวันหยุดในช่วงนี้เปลี่ยน เทสต์นี้จะบอกเอง

test('จัดกลุ่ม: เลยกำหนด / ใกล้ครบ (ภายใน 1 วันทำการ) / ภายหลัง / ไม่มีกำหนด', () => {
  // วันพุธ 2026-09-16 (วันทำการ) → วันทำการถัดไป = พฤหัส 09-17
  const today = '2026-09-16'
  const rows = [
    { due: '2026-09-15', n: 2 },   // เมื่อวาน → เลยกำหนด
    { due: '2026-09-16', n: 1 },   // วันนี้ → ใกล้ครบ
    { due: '2026-09-17', n: 3 },   // วันทำการถัดไป → ใกล้ครบ
    { due: '2026-09-18', n: 4 },   // ศุกร์ → ยังไม่ใกล้
    { due: null, n: 5 },           // ไม่มีกำหนด
  ]
  assert.deepEqual(bucketComplaintDue(rows, today), { overdue: 2, soon: 4, later: 4, noDue: 5, open: 15 })
})

test('เปิดวันศุกร์: "ภายใน 1 วันทำการ" ข้ามเสาร์-อาทิตย์ไปถึงจันทร์', () => {
  const today = '2026-09-18' // ศุกร์
  const rows = [{ due: '2026-09-21', n: 1 }, { due: '2026-09-22', n: 1 }]
  const b = bucketComplaintDue(rows, today)
  assert.equal(b.soon, 1, 'จันทร์ถัดไปคือวันทำการถัดไป')
  assert.equal(b.later, 1)
})

test('เปิดวันเสาร์: งานที่ครบวันศุกร์ยังนับว่าเลยกำหนด (ไม่ถูกกลืนเป็น "ครบวันนี้")', () => {
  const today = '2026-09-19' // เสาร์
  const b = bucketComplaintDue([{ due: '2026-09-18', n: 2 }, { due: '2026-09-21', n: 1 }], today)
  assert.equal(b.overdue, 2)
  assert.equal(b.soon, 1, 'จันทร์ = วันทำการถัดไปจากวันเสาร์')
})

test('ข้อมูลผิดรูป: n ติดลบ/ไม่ใช่ตัวเลข/แถวว่าง/วันที่ว่าง ไม่ทำให้พังและไม่ถูกนับ', () => {
  const b = bucketComplaintDue([{ due: '2026-09-15', n: -3 }, { due: '2026-09-15', n: 'x' }, null, { n: 2 }, { due: '2026-09-15', n: 0 }], '2026-09-16')
  assert.deepEqual(b, { overdue: 0, soon: 0, later: 0, noDue: 2, open: 2 })
  assert.deepEqual(bucketComplaintDue(null, '2026-09-16'), { overdue: 0, soon: 0, later: 0, noDue: 0, open: 0 })
  assert.deepEqual(bucketComplaintDue([{ due: '2026-09-15', n: 1 }], null), { overdue: 0, soon: 0, later: 0, noDue: 0, open: 0 },
    'ไม่รู้ว่าวันนี้คือวันไหนต้องไม่เดา')
})

test('due ที่มาเป็น timestamp ยาว ตัดเหลือวันที่ก่อนเทียบ', () => {
  assert.equal(bucketComplaintDue([{ due: '2026-09-15T00:00:00+00:00', n: 1 }], '2026-09-16').overdue, 1)
})

test('shortTime ตัดวินาทีออก และไม่เดาเวลาที่ไม่มี', () => {
  assert.equal(shortTime('09:30:00'), '09:30')
  assert.equal(shortTime('00:00'), '00:00')
  assert.equal(shortTime(null), null)
  assert.equal(shortTime(''), null)
  assert.equal(shortTime('ทั้งวัน'), null)
})

test('กิจกรรม: แยกวันนี้/พรุ่งนี้ · งานหลายวันที่กำลังจัดอยู่นับเป็นวันนี้และบอกว่า "ต่อเนื่อง"', () => {
  const today = '2026-09-16'
  const g = groupMyEvents([
    { id: 'a', title: 'ประชุม', date: '2026-09-16', time: '09:00:00', end_date: null, location: 'ห้องประชุม', task: 'attend' },
    { id: 'b', title: 'พิธีเปิด', date: '2026-09-17', time: null, end_date: null, location: null, task: 'preside' },
    { id: 'c', title: 'งานกาชาด', date: '2026-09-14', time: '08:00:00', end_date: '2026-09-18', location: null, task: 'join' },
  ], today)
  assert.deepEqual(g.today.map(e => e.id), ['a', 'c'])
  assert.deepEqual(g.tomorrow.map(e => e.id), ['b'])
  assert.equal(g.today[0].time, '09:00')
  assert.equal(g.today[0].task, 'ไปประชุมแทน')
  assert.equal(g.today[1].ongoing, true)
  assert.equal(g.today[0].ongoing, false)
})

test('กิจกรรม: ข้อมูลผิดรูป (ไม่มีชื่อ/ไม่มีวันที่/end_date ก่อนวันเริ่ม) ไม่พัง', () => {
  const g = groupMyEvents([
    null, { id: 'x', date: '2026-09-16' }, { id: 'y', title: 'ไม่มีวัน' },
    { id: 'z', title: 'วันจบผิด', date: '2026-09-16', end_date: '2026-09-01', task: '???' },
  ], '2026-09-16')
  assert.deepEqual(g.today.map(e => e.id), ['z'])
  assert.equal(g.today[0].task, null, 'ภารกิจที่ไม่รู้จักต้องไม่แสดงข้อความมั่ว')
  assert.deepEqual(groupMyEvents(undefined, '2026-09-16'), { today: [], tomorrow: [] })
})

test('ภาระรายคน: ปรับค่าผิดรูปเป็น 0 ชื่อว่างเป็น null และรวมยอด', () => {
  const w = normalizeWorkload({
    department_name: ' กองช่าง ', unassigned: '3',
    members: [
      { id: 'u1', name: '  ', open: 2, unstarted: 1, overdue: 1 },
      { id: 'u2', name: 'สมศรี', open: -4, unstarted: 'x', overdue: null },
      { name: 'ไม่มี id', open: 9 },
    ],
  })
  assert.equal(w.departmentName, 'กองช่าง')
  assert.equal(w.unassigned, 3)
  assert.equal(w.members.length, 2, 'แถวที่ไม่มี id ถูกตัด')
  assert.equal(w.members[0].name, null)
  assert.deepEqual(w.members[1], { id: 'u2', name: 'สมศรี', open: 0, unstarted: 0, overdue: 0 })
  assert.deepEqual(w.totals, { open: 2, overdue: 1 })
  assert.deepEqual(normalizeWorkload(null), { departmentName: null, unassigned: 0, members: [], totals: { open: 0, overdue: 0 } })
})

// ── todoState: ห้ามขึ้น "ไม่มีงาน" เมื่อยังไม่รู้ครบ ──
const calm = { open: 0, overdue: 0, soon: 0 }
test('todoState: ทุกแหล่งโหลดแล้วและเป็น 0 จริง = clear', () => {
  assert.equal(todoState({ badgeStatuses: ['ok', 'ok'], badgeCounts: [0, 0], summaryStatus: 'ok', due: calm }), 'clear')
})

test('todoState: แหล่งใดยังโหลดอยู่ = loading (ไม่ใช่ clear)', () => {
  assert.equal(todoState({ badgeStatuses: ['ok', 'loading'], badgeCounts: [0, 0], summaryStatus: 'ok', due: calm }), 'loading')
  assert.equal(todoState({ badgeStatuses: ['ok'], badgeCounts: [0], summaryStatus: 'loading', due: calm }), 'loading')
})

test('todoState: แหล่งใดพัง = error แม้แหล่งอื่นเป็น 0 — ไฟเขียวปลอมต้องไม่เกิด', () => {
  assert.equal(todoState({ badgeStatuses: ['ok', 'error'], badgeCounts: [0, 0], summaryStatus: 'ok', due: calm }), 'error')
  assert.equal(todoState({ badgeStatuses: ['ok'], badgeCounts: [0], summaryStatus: 'error', due: calm }), 'error')
  assert.equal(todoState({ badgeStatuses: ['loading'], badgeCounts: [0], summaryStatus: 'error', due: calm }), 'error', 'error ชนะ loading')
})

test('todoState: มีเลข badge หรือมีงานเลยกำหนด/ใกล้ครบ = pending', () => {
  assert.equal(todoState({ badgeStatuses: ['ok'], badgeCounts: [2], summaryStatus: 'ok', due: calm }), 'pending')
  assert.equal(todoState({ badgeStatuses: ['ok'], badgeCounts: [0], summaryStatus: 'ok', due: { ...calm, open: 3, overdue: 1 } }), 'pending')
  assert.equal(todoState({ badgeStatuses: ['ok'], badgeCounts: [0], summaryStatus: 'ok', due: { ...calm, open: 3, soon: 2 } }), 'pending')
})

test('todoState: ไม่มีงานเร่งแต่ยังถือคำร้องอยู่ = holding (บอกตรงๆ ไม่ใช่ "ไม่มีงาน")', () => {
  assert.equal(todoState({ badgeStatuses: ['ok'], badgeCounts: [0], summaryStatus: 'ok', due: { ...calm, open: 4 } }), 'holding')
})

test('todoState: บัญชีที่ไม่ได้ใช้สรุป (summaryStatus ว่าง) ตัดสินจาก badge อย่างเดียว', () => {
  assert.equal(todoState({ badgeStatuses: ['ok'], badgeCounts: [0], summaryStatus: null, due: calm }), 'clear')
  assert.equal(todoState({ badgeStatuses: ['loading'], badgeCounts: [0], summaryStatus: null, due: calm }), 'loading')
})

console.log(`\n${cases} cases passed`)
