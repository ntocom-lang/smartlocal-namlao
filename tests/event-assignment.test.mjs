// ตรรกะหน้าจอของ "มอบหมายผู้ไปแทน" — node --test tests/event-assignment.test.mjs
// ไม่ใช้เน็ต ไม่แตะฐานข้อมูล · ด่านจริงอยู่ที่ RPC (ทดสอบแยกใน tests/event-assignments-db.test.mjs)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  MAX_ASSIGNEES, ASSIGNMENT_TASKS, taskLabel, groupCandidates, defaultTaskForCategory, defaultOnBehalfOf,
  onBehalfChoices, assignmentSummary, isAssignedTo, canAssignEvent, assignmentFormFromEvent, toAssigneePayload,
  assignmentKey, validateAssignment, assignmentRecordedLine, EMPTY_ASSIGNMENT,
} from '../src/lib/eventAssignment.js'
import { getOrgTerms } from '../src/lib/orgTerms.js'

const MUNI = getOrgTerms('เทศบาลตำบล')
const SAO = getOrgTerms('อบต.')

test('ค่าในหน้าจอตรงกับด่านในฐานข้อมูล (กันหลุดกันคนละที่)', async () => {
  const table = await readFile(new URL('../supabase/migrations/20261001120000_event_assignments_table.sql', import.meta.url), 'utf8')
  const rpc = await readFile(new URL('../supabase/migrations/20261001120100_event_assignments_rpc.sql', import.meta.url), 'utf8')
  const check = table.match(/event_assignments_task_chk\s+CHECK \(task IN \(([^)]*)\)\)/)
  assert.ok(check, 'หา CHECK ของ task ไม่เจอ')
  assert.deepEqual(check[1].split(',').map((s) => s.trim().replace(/'/g, '')), ASSIGNMENT_TASKS.map((t) => t.value))
  assert.ok(rpc.includes(`IF v_count > ${MAX_ASSIGNEES} THEN`), 'จำนวนสูงสุดไม่ตรงกับ set_event_assignments')
})

test('ระบบเดาภารกิจจากประเภทกิจกรรม', () => {
  assert.equal(defaultTaskForCategory('ประชุม'), 'attend')
  assert.equal(defaultTaskForCategory('อบรม'), 'attend')
  assert.equal(defaultTaskForCategory('ประชาสัมพันธ์'), 'preside')
  assert.equal(defaultTaskForCategory('กำหนดการ'), 'preside')
  assert.equal(defaultTaskForCategory(undefined), 'preside')
  assert.equal(taskLabel('attend'), 'ไปประชุมแทน')
  assert.equal(taskLabel('ไม่มี'), '')
})

test('แทนใคร: ค่าเริ่มต้นตามกลุ่มเป้าหมายและประเภท อปท.', () => {
  assert.equal(defaultOnBehalfOf(['management'], MUNI), 'นายกเทศมนตรี')
  assert.equal(defaultOnBehalfOf(['public', 'management'], SAO), 'นายก อบต.')
  assert.equal(defaultOnBehalfOf(['council'], MUNI), 'ประธานสภาเทศบาล')
  assert.equal(defaultOnBehalfOf(['management', 'council'], MUNI), 'นายกเทศมนตรี', 'มีกลุ่มผู้บริหารให้แทนนายกก่อน')
  assert.equal(defaultOnBehalfOf(['staff'], MUNI), '')
  assert.equal(defaultOnBehalfOf(null, MUNI), '')
  assert.deepEqual(onBehalfChoices(MUNI), ['นายกเทศมนตรี', 'ปลัดเทศบาล', 'ประธานสภาเทศบาล'])
  assert.deepEqual(onBehalfChoices(SAO), ['นายก อบต.', 'ปลัด อบต.', 'ประธานสภา อบต.'])
  assert.deepEqual(onBehalfChoices(null), [])
})

test('ข้อความสรุปการมอบหมาย', () => {
  assert.equal(assignmentSummary([]), '')
  assert.equal(assignmentSummary(null), '')
  assert.equal(assignmentSummary([{ name: 'นายเอ', title: 'รองนายกเทศมนตรี', task: 'attend', on_behalf_of: 'นายกเทศมนตรี' }]),
    'นายเอ (รองนายกเทศมนตรี) — ไปประชุมแทนนายกเทศมนตรี')
  assert.equal(assignmentSummary([
    { name: 'นายเอ', title: 'รองนายกเทศมนตรี', task: 'preside', on_behalf_of: 'นายกเทศมนตรี' },
    { name: 'นายบี', title: null, task: 'preside', on_behalf_of: 'นายกเทศมนตรี' },
  ]), 'นายเอ (รองนายกเทศมนตรี), นายบี — เป็นประธาน/เปิดงานแทนนายกเทศมนตรี')
  assert.equal(assignmentSummary([{ name: 'นายเอ', task: 'join', on_behalf_of: null }]), 'นายเอ — ร่วมงานแทน')
  assert.equal(assignmentSummary([{ name: '  ', task: 'join' }]), '', 'แถวไม่มีชื่อไม่นับ')
})

test('ป้าย "คุณได้รับมอบหมาย"', () => {
  const ev = { assignments: [{ profile_id: 'u1', name: 'นายเอ' }, { profile_id: null, name: 'นายบี' }] }
  assert.equal(isAssignedTo(ev, 'u1'), true)
  assert.equal(isAssignedTo(ev, 'u2'), false)
  assert.equal(isAssignedTo(ev, null), false, 'ยังไม่รู้ตัวผู้ใช้ต้องไม่ขึ้นป้าย (คนพิมพ์ชื่อเองมี profile_id เป็น null)')
  assert.equal(isAssignedTo({ assignments: [] }, 'u1'), false)
  assert.equal(isAssignedTo({}, 'u1'), false)
})

test('ใครเห็นปุ่ม "มอบหมายผู้ไปแทน" — ตรงกับด่านใน set_event_assignments', () => {
  const mgmt = { created_by: 'creator', department_id: 'd1', audiences: ['management'] }
  const staffOnly = { created_by: 'creator', department_id: 'd1', audiences: ['staff'] }
  assert.equal(canAssignEvent(mgmt, 'admin', 'x', null), true)
  assert.equal(canAssignEvent(mgmt, 'superadmin', 'x', null), true)
  assert.equal(canAssignEvent(staffOnly, 'staff', 'creator', null), true, 'คนสร้าง')
  assert.equal(canAssignEvent(staffOnly, 'staff', 'other', { is_dept_head: true, department_id: 'd1' }), true, 'หัวหน้ากองของกิจกรรม')
  assert.equal(canAssignEvent(staffOnly, 'staff', 'other', { is_dept_head: true, department_id: 'd2' }), false, 'หัวหน้ากองอื่น')
  assert.equal(canAssignEvent(staffOnly, 'staff', 'other', { is_dept_head: false, department_id: 'd1' }), false, 'คนในกองแต่ไม่ใช่หัวหน้า')
  assert.equal(canAssignEvent(mgmt, 'viewer', 'mayor', null), true, 'ผู้บริหารบนกิจกรรมกลุ่มผู้บริหาร')
  assert.equal(canAssignEvent({ ...mgmt, audiences: ['public', 'management'] }, 'viewer', 'mayor', null), true)
  assert.equal(canAssignEvent(staffOnly, 'viewer', 'mayor', null), false, 'ผู้บริหารบนกิจกรรมที่ไม่มีกลุ่มผู้บริหาร')
  assert.equal(canAssignEvent(mgmt, 'council', 'chair', null), false)
  assert.equal(canAssignEvent({ ...mgmt, created_by: 'chair' }, 'council', 'chair', null), true, 'สภาที่สร้างกิจกรรมเอง')
  assert.equal(canAssignEvent(mgmt, 'citizen', 'creator', null), false, 'ประชาชนไม่ได้แม้ id ตรง')
  assert.equal(canAssignEvent(mgmt, null, null, null), false)
  assert.equal(canAssignEvent(null, 'admin', 'x', null), false)
})

test('แปลงค่าระหว่างกิจกรรม ฟอร์ม และพารามิเตอร์ RPC', () => {
  const ev = { assignments: [
    { profile_id: 'u1', name: 'นายเอ', title: 'รองนายก', task: 'attend', on_behalf_of: 'นายกเทศมนตรี' },
    { profile_id: null, name: 'นายบี', title: null, task: 'attend', on_behalf_of: 'นายกเทศมนตรี' },
  ] }
  const form = assignmentFormFromEvent(ev)
  assert.deepEqual(form, {
    assignees: [{ profile_id: 'u1', name: 'นายเอ', title: 'รองนายก' }, { profile_id: null, name: 'นายบี', title: '' }],
    task: 'attend', onBehalfOf: 'นายกเทศมนตรี',
  })
  assert.deepEqual(assignmentFormFromEvent({}), EMPTY_ASSIGNMENT)
  assert.deepEqual(toAssigneePayload(form.assignees), [{ profile_id: 'u1' }, { name: 'นายบี', title: null }],
    'คนมีบัญชีส่งแค่ id — ชื่อ/ตำแหน่งให้เซิร์ฟเวอร์เติมเอง')
  assert.deepEqual(toAssigneePayload([{ name: '  นายซี ', title: ' ผู้ใหญ่บ้าน ' }]), [{ name: 'นายซี', title: 'ผู้ใหญ่บ้าน' }])
})

test('ตัวเทียบการเปลี่ยนแปลง — ไม่เปลี่ยนก็ไม่ต้องเรียก RPC', () => {
  const base = { assignees: [{ profile_id: 'u1' }], task: 'attend', onBehalfOf: 'นายกเทศมนตรี' }
  assert.equal(assignmentKey(base), assignmentKey({ ...base, assignees: [{ profile_id: 'u1', name: 'ชื่อเปลี่ยนก็ไม่นับ' }] }))
  assert.equal(assignmentKey(base), assignmentKey({ ...base, onBehalfOf: ' นายกเทศมนตรี ' }))
  assert.notEqual(assignmentKey(base), assignmentKey({ ...base, task: 'preside' }))
  assert.notEqual(assignmentKey(base), assignmentKey({ ...base, onBehalfOf: 'ปลัดเทศบาล' }))
  assert.notEqual(assignmentKey(base), assignmentKey({ ...base, assignees: [{ profile_id: 'u2' }] }))
  assert.equal(assignmentKey(EMPTY_ASSIGNMENT), '[]')
  assert.equal(assignmentKey({ assignees: [], task: 'attend', onBehalfOf: 'นายก' }), '[]', 'ไม่มีคนแล้วภารกิจไม่มีความหมาย')
  assert.equal(assignmentKey(undefined), '[]')
})

test('ตรวจก่อนบันทึก', () => {
  assert.equal(validateAssignment(EMPTY_ASSIGNMENT), '')
  assert.equal(validateAssignment({ assignees: [{ profile_id: 'u1' }], task: 'attend', onBehalfOf: '' }), '')
  assert.match(validateAssignment({ assignees: [{ profile_id: 'u1' }], task: '', onBehalfOf: '' }), /เลือกภารกิจ/)
  assert.match(validateAssignment({ assignees: [{ name: '  ' }], task: 'attend' }), /พิมพ์ชื่อ/)
  assert.match(validateAssignment({ assignees: [{ name: 'ก'.repeat(121) }], task: 'attend' }), /พิมพ์ชื่อ/)
  assert.match(validateAssignment({ assignees: [{ name: 'นายเอ', title: 'ต'.repeat(121) }], task: 'attend' }), /ตำแหน่งยาวเกิน/)
  assert.match(validateAssignment({ assignees: [{ profile_id: 'u1' }], task: 'attend', onBehalfOf: 'น'.repeat(121) }), /ยาวเกิน/)
  assert.match(validateAssignment({ assignees: [{ profile_id: 'u1' }, { profile_id: 'u1' }], task: 'attend' }), /ซ้ำ/)
  assert.match(validateAssignment({ assignees: Array.from({ length: MAX_ASSIGNEES + 1 }, (_, i) => ({ name: `คน ${i}` })), task: 'attend' }), /สูงสุด/)
})

test('จัดกลุ่มรายชื่อผู้ที่มอบหมายได้', () => {
  const rows = [
    { profile_id: 'a', full_name: 'นายก', group_key: 'executive' },
    { profile_id: 'b', full_name: 'ผอ.', group_key: 'admin' },
    { profile_id: 'c', full_name: 'ประธานสภา', group_key: 'council' },
    { profile_id: 'd', full_name: 'จนท.', group_key: 'staff' },
    { profile_id: 'e', full_name: 'ไม่รู้กลุ่ม', group_key: 'อื่นๆ' },
  ]
  const groups = groupCandidates(rows, 'สภาเทศบาล')
  assert.deepEqual(groups.map((g) => g.label), ['ผู้บริหาร', 'ปลัดและหัวหน้าส่วนราชการ', 'สภาเทศบาล', 'เจ้าหน้าที่'])
  assert.deepEqual(groups.at(-1).members.map((m) => m.profile_id), ['d', 'e'], 'กลุ่มที่ไม่รู้จักตกไปเจ้าหน้าที่')
  assert.deepEqual(groupCandidates([], 'สภา'), [], 'กลุ่มว่างไม่ต้องแสดง')
  assert.equal(groupCandidates([rows[2]]).at(0).label, 'สภา', 'ไม่ส่งคำเรียกสภามาใช้ค่าเริ่มต้น')
})

test('บรรทัด "บันทึกโดย … เมื่อ …"', () => {
  assert.equal(assignmentRecordedLine([]), '')
  assert.equal(assignmentRecordedLine([{ name: 'นายเอ' }]), '')
  assert.equal(assignmentRecordedLine([{ name: 'นายเอ', assigned_by_name: 'TEST ธุรการ' }]), 'บันทึกโดย TEST ธุรการ')
  const line = assignmentRecordedLine([{ name: 'นายเอ', assigned_by_name: 'TEST ธุรการ', assigned_at: '2026-10-01T03:30:00Z' }])
  assert.match(line, /^บันทึกโดย TEST ธุรการ เมื่อ .+ น\.$/)
  assert.equal(assignmentRecordedLine([{ name: 'นายเอ', assigned_at: 'ไม่ใช่วันที่' }]), '')
})
