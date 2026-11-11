// Pure-logic test สำหรับ src/lib/staffHomeSummary.js — ตรรกะ "งานของฉัน/กองของฉัน" บนหน้าแรกเจ้าหน้าที่
// ไม่ใช้ฐานข้อมูล ไม่ใช้เบราว์เซอร์
//
// จุดที่ต้องกันที่สุดคือ todoState(): ถ้าตัดสินผิดจะขึ้น "ไม่มีงานค้าง" ทั้งที่ยังมีงานเลยกำหนด (ไฟเขียวปลอม)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DUE_WORK_KEYS, bucketComplaintDue, dueWorkCount, dueWorkHint, groupMyEvents, normalizeWorkload, shortTime, todoState,
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

// ── งานที่ "ถึงกำหนด" ของแผนพัฒนา/โครงการก่อสร้าง (การ์ด "ต้องทำตอนนี้" + ป้ายเมนู) ──────────────────

test('dueWorkCount: เฉพาะสถานะ ok ถึงมีเลข · loading/error = 0 (ไม่ใช้เลขเก่า) · ค่าผิดรูป = 0', () => {
  assert.deepEqual(DUE_WORK_KEYS, ['local-plan', 'projects'])
  assert.equal(dueWorkCount('local-plan', { status: 'ok', notStarted: 3, pastEnd: 2 }), 5)
  assert.equal(dueWorkCount('projects', { status: 'ok', awaitingInspection: 2, overdue: 1, total: 3 }), 3)
  assert.equal(dueWorkCount('projects', { status: 'ok', awaitingInspection: 2, overdue: 1 }), 3, 'ไม่ส่ง total ก็บวกให้เอง')
  for (const key of DUE_WORK_KEYS) {
    for (const status of ['loading', 'error', undefined]) assert.equal(dueWorkCount(key, { status, notStarted: 9, pastEnd: 9, total: 9 }), 0, `${key} ${status}`)
    assert.equal(dueWorkCount(key, undefined), 0)
    assert.equal(dueWorkCount(key, { status: 'ok', notStarted: -4, pastEnd: 'x', total: NaN, awaitingInspection: null, overdue: -1 }), 0)
  }
  assert.equal(dueWorkCount('infra', { status: 'ok', total: 5 }), 0, 'คีย์อื่นไม่ใช่เลขชุดนี้')
})

test('dueWorkHint: ตัดส่วนที่เป็น 0 · แผนพัฒนาบอกเดือนที่นับถึง · ไม่ใช้คำว่า "ระเบียบ" (เดือนในแผนเป็นกำหนดที่ อปท. ตั้งเอง)', () => {
  const plan = { status: 'ok', notStarted: 3, pastEnd: 2, monthLabel: 'ตุลาคม 2569' }
  assert.equal(dueWorkHint('local-plan', plan),
    'ถึงเดือนเริ่มตามแผนดำเนินงานแล้วยังไม่บันทึกผล 3 · เลยเดือนสิ้นสุดยังไม่ปิดผล 2 (นับถึงสิ้นตุลาคม 2569)')
  assert.equal(dueWorkHint('local-plan', { ...plan, pastEnd: 0 }), 'ถึงเดือนเริ่มตามแผนดำเนินงานแล้วยังไม่บันทึกผล 3 (นับถึงสิ้นตุลาคม 2569)')
  assert.equal(dueWorkHint('local-plan', { ...plan, notStarted: 0 }), 'เลยเดือนสิ้นสุดยังไม่ปิดผล 2 (นับถึงสิ้นตุลาคม 2569)')
  assert.doesNotMatch(dueWorkHint('local-plan', plan), /ระเบียบ/)
  assert.equal(dueWorkHint('projects', { status: 'ok', awaitingInspection: 2, overdue: 1 }), 'งวดรอตรวจรับ 2 · เลยกำหนด 1')
  assert.equal(dueWorkHint('projects', { status: 'ok', awaitingInspection: 0, overdue: 4 }), 'เลยกำหนด 4')
  assert.equal(dueWorkHint('projects', { status: 'ok', awaitingInspection: 5, overdue: 0 }), 'งวดรอตรวจรับ 5')
  assert.equal(dueWorkHint('projects', undefined), '')
})

test('todoState: การ์ดถึงกำหนดยังโหลด = loading · พัง = error · มีเลข = pending (ไฟเขียวไม่ขึ้นก่อนรู้ครบ)', () => {
  assert.equal(todoState({ badgeStatuses: ['ok', 'loading'], badgeCounts: [0, 0], summaryStatus: null, due: calm }), 'loading')
  assert.equal(todoState({ badgeStatuses: ['ok', 'error'], badgeCounts: [0, 0], summaryStatus: null, due: calm }), 'error')
  assert.equal(todoState({ badgeStatuses: ['ok', 'ok'], badgeCounts: [0, dueWorkCount('projects', { status: 'ok', total: 2 })], summaryStatus: null, due: calm }), 'pending')
  assert.equal(todoState({ badgeStatuses: ['ok', 'ok'], badgeCounts: [0, dueWorkCount('projects', { status: 'ok', total: 0 })], summaryStatus: null, due: calm }), 'clear')
})

// ซอร์ส: ป้ายเมนูทุกจุด (ซ้าย/ลิ้นชัก/แท็บเมนูมือถือ) ได้เลขชุดเดียวกับการ์ด · ส่วน "งานที่เปิดอยู่" ยังนับ "ยังไม่ปิด" ตามเดิม
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const stripComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const dashboardPage = stripComments(read('src/pages/StaffDashboard.jsx'))
const homeCard = stripComments(read('src/components/staff/StaffOperationalDashboard.jsx'))

test('StaffDashboard: ป้ายเมนูซ้าย/ลิ้นชัก/กริดแท็บเมนูใช้ชุด menuWorkCounts (เลขถึงกำหนดทับเลขยังไม่ปิด) · สถานะผิดพลาดของสองคีย์ทับของเดิม', () => {
  assert.match(dashboardPage, /const menuWorkCounts = \{ \.\.\.departmentWorkCounts, \.\.\.dueBadgeCounts \}/)
  assert.match(dashboardPage, /const drawerBadges = \{ \.\.\.menuWorkCounts,/)
  assert.match(dashboardPage, /openWorkCounts=\{menuWorkCounts\}/)
  assert.doesNotMatch(dashboardPage, /openWorkCounts=\{departmentWorkCounts\}/)
  assert.match(dashboardPage, /badges=\{drawerBadges\}/)
  assert.match(dashboardPage, /const homeWorkStatus = \{ \.\.\.workStatus, \.\.\.dueStatuses \}/)
  assert.match(dashboardPage, /Object\.entries\(homeWorkStatus\)/)
  assert.match(dashboardPage, /workStatus=\{homeWorkStatus\}/)
  assert.match(dashboardPage, /dueWork=\{dueWorkState\}/)
})

test('StaffDashboard: "งานที่เปิดอยู่" ยังรับ departmentWorkCounts ตามเดิม (นับ ยังไม่ปิด 3 คีย์) · ดึงเลขถึงกำหนดแบบหน่วง ≥5 นาที + ออกจากโมดูลของมันเอง', () => {
  assert.match(dashboardPage, /counts: departmentWorkCounts, errors: departmentWorkErrors/)
  assert.match(dashboardPage, /DEPARTMENT_WORK_SOURCES = \[[\s\S]*?key: 'local-plan', table: 'local_dev_plans'[\s\S]*?key: 'projects', table: 'civil_projects'/)
  assert.match(dashboardPage, /const DUE_WORK_MIN_GAP_MS = 5 \* 60_000/)
  assert.match(dashboardPage, /Date\.now\(\) - track\.doneAt < DUE_WORK_MIN_GAP_MS/)
  assert.match(dashboardPage, /DUE_WORK_KEYS\.includes\(track\.module\) && track\.module !== activeModule/)
  // พลาด = error ทุกคีย์ ไม่ตกเป็น 0 · รอบที่พลาดไม่ตั้งเวลา
  assert.match(dashboardPage, /value && !value\.error \? \{ status: 'ok', \.\.\.value \} : \{ status: 'error' \}/)
  assert.match(dashboardPage, /keys\.map\(key => \[key, \{ status: 'error' \}\]\)/)
  assert.match(dashboardPage, /every\(item => item\.status === 'ok'\)\) track\.doneAt = Date\.now\(\)/)
})

test('หน้าแรก: การ์ด "ต้องทำตอนนี้" มี local-plan + projects · "งานที่เปิดอยู่" ยังมีครบ 3 คีย์ · ไม่ใช้คำว่า "ตามระเบียบ/ผิดระเบียบ" ในข้อความแผนพัฒนา', () => {
  assert.match(homeCard, /const WORK_CARDS = \[[\s\S]*?key: 'local-plan', hint: \(\{ due \}\) => dueWorkHint\('local-plan', due\)[\s\S]*?key: 'projects', hint: \(\{ due \}\) => dueWorkHint\('projects', due\)/)
  assert.match(homeCard, /const OPEN_WORK_CARDS = \[\s*\{ key: 'local-plan'[\s\S]*?\{ key: 'infra'[\s\S]*?\{ key: 'projects'/)
  assert.match(homeCard, /count: Number\(openWork\.counts\?\.\[card\.key\]\) \|\| 0/)
  assert.match(homeCard, /const cardBadges = \{ \.\.\.menuBadges\(\{ pendingCount, newComplaintCount, patientWorkCount \}\), \.\.\.dueBadges \}/)
  const hints = read('src/lib/staffHomeSummary.js')
  assert.doesNotMatch(hints.slice(hints.indexOf('export function dueWorkHint')), /ตามระเบียบ|ผิดระเบียบ/)
})

console.log(`\n${cases} cases passed`)
