// ทะเบียนผู้ลงนาม: ช่อง "เลือกจากบุคลากร" แยกกลุ่มตามกอง + แถวกองผู้บริหารแสดงแบบไม่บังคับ (เจ้าของระบบสั่ง 2569-10-24)
//   node tests/signatory-people-groups.test.mjs
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  departmentSlotMeta, EXECUTIVE_SLOT_EMPTY_LABEL, groupPeopleByDepartment, isExecutiveDepartment, NO_DEPARTMENT_LABEL,
} from '../src/lib/documentSignatories.js'

const departments = [
  { id: 'd-exec', name: 'คณะผู้บริหารท้องถิ่น' },
  { id: 'd-clerk', name: 'สำนักปลัด' },
  { id: 'd-fin', name: 'กองคลัง' },
  { id: 'd-eng', name: 'กองช่าง' },
]
const person = (id, deptId, deptName) => ({ id, full_name: `คน ${id}`, department_id: deptId, department: deptName ? { name: deptName } : null })
// ลำดับเข้าเรียงตามชื่อ (เหมือน query จริง) ปนกันหลายกอง
const people = [
  person('p1', 'd-fin', 'กองคลัง'),
  person('p2', 'd-clerk', 'สำนักปลัด'),
  person('p3', 'd-fin', 'กองคลัง'),
  person('p4', null, null),
  person('p5', 'd-exec', 'คณะผู้บริหารท้องถิ่น'),
  person('p6', 'd-old', 'กองที่ยุบแล้ว'),
  person('p7', 'd-clerk', 'สำนักปลัด'),
]
const ids = groups => groups.map(group => `${group.label}:${group.people.map(p => p.id).join(',')}`)

// 1) กองเรียงตามทะเบียนกอง · คนในกองคงลำดับเดิม · กองยุบแล้วต่อท้าย · ไม่มีกองอยู่ท้ายสุด · กองที่ไม่มีคนไม่โผล่
{
  const groups = groupPeopleByDepartment(people, departments)
  assert.deepEqual(ids(groups), [
    'คณะผู้บริหารท้องถิ่น:p5',
    'สำนักปลัด:p2,p7',
    'กองคลัง:p1,p3',
    'กองที่ยุบแล้ว:p6',
    `${NO_DEPARTMENT_LABEL}:p4`,
  ])
}

// 2) ทุกคนต้องอยู่ในกลุ่มเดียวเท่านั้น ไม่หาย ไม่ซ้ำ
{
  const groups = groupPeopleByDepartment(people, departments, 'd-fin')
  const all = groups.flatMap(group => group.people.map(p => p.id)).sort()
  assert.deepEqual(all, people.map(p => p.id).sort())
}

// 3) แถวหัวหน้ากองเริ่มที่กองของตัวเอง ที่เหลือคงลำดับเดิม
{
  const groups = groupPeopleByDepartment(people, departments, 'd-fin')
  assert.equal(groups[0].label, 'กองคลัง')
  assert.deepEqual(groups.slice(1).map(group => group.label),
    ['คณะผู้บริหารท้องถิ่น', 'สำนักปลัด', 'กองที่ยุบแล้ว', NO_DEPARTMENT_LABEL])
}

// 4) กองที่ขอให้ขึ้นก่อนแต่ไม่มีคนเลย → ไม่เปลี่ยนลำดับ (ไม่พัง)
{
  const groups = groupPeopleByDepartment(people, departments, 'd-eng')
  assert.deepEqual(groups.map(group => group.label), [
    'คณะผู้บริหารท้องถิ่น', 'สำนักปลัด', 'กองคลัง', 'กองที่ยุบแล้ว', NO_DEPARTMENT_LABEL,
  ])
}

// 5) ค่าว่าง/ไม่มีข้อมูล ไม่พัง
assert.deepEqual(groupPeopleByDepartment(null, null), [])
assert.deepEqual(groupPeopleByDepartment([], departments), [])
{
  // ไม่มีทะเบียนกองเลย (โหลดกองล้ม) คนทุกคนต้องยังเลือกได้
  const groups = groupPeopleByDepartment(people, [])
  assert.equal(groups.flatMap(group => group.people).length, people.length)
}

// 6) กองยุบแล้วที่ join ชื่อกองไม่มา → ใช้ป้ายกลาง ไม่ใช่ undefined
{
  const groups = groupPeopleByDepartment([{ id: 'x', full_name: 'คน x', department_id: 'd-gone', department: null }], departments)
  assert.equal(groups[0].label, NO_DEPARTMENT_LABEL)
}

// 7) หน้าจอใช้ตัวจัดกลุ่มนี้จริง และไม่เทรวมเป็นรายการเดียวอีก
{
  const source = await readFile(new URL('../src/components/admin/SignatorySettings.jsx', import.meta.url), 'utf8')
  assert.match(source, /groupPeopleByDepartment\(people, departments, slot\.departmentId\)/)
  assert.match(source, /<optgroup /)
  // ห้ามมี <option> ที่ map ตรงจาก people ทั้งก้อน (group.people.map ข้างใน optgroup ไม่นับ — ตัวอักษรหน้า people ต้องไม่ใช่ "." หรือตัวอักษร)
  assert.doesNotMatch(source, /[^.\w]people\.map\(\(person\) => \(\s*<option/)
}

// 8) กองผู้บริหาร: รหัส exec หรือชื่อมีคำว่า "ผู้บริหาร" (กองที่ผู้ดูแลสร้างเองมีรหัสสุ่ม — ทุ่งแค้วเคยหลุดตัวกรองเดิมที่ดูรหัสอย่างเดียว)
assert.equal(isExecutiveDepartment({ code: 'exec', name: 'ผู้บริหาร' }), true)
assert.equal(isExecutiveDepartment({ code: 'dept_mt5uixc4', name: 'คณะผู้บริหารท้องถิ่น' }), true)
assert.equal(isExecutiveDepartment({ code: 'exec', name: 'อะไรก็ได้' }), true)
assert.equal(isExecutiveDepartment({ code: 'finance', name: 'กองคลัง' }), false)
assert.equal(isExecutiveDepartment({ code: 'general', name: 'สำนักปลัด' }), false)
assert.equal(isExecutiveDepartment(null), false)

// 9) แถวหัวหน้ากองของกองผู้บริหาร: แสดงแบบ "ไม่บังคับ" (ไม่ถูกนับว่าขาด) พร้อมคำอธิบาย · กองปกติไม่ถูกแตะ (บังคับเหมือนเดิม)
{
  const exec = departmentSlotMeta({ code: 'dept_mt5uixc4', name: 'คณะผู้บริหารท้องถิ่น' })
  assert.equal(exec.optional, true)
  assert.equal(exec.emptyLabel, EXECUTIVE_SLOT_EMPTY_LABEL)
  assert.match(exec.hint, /ไม่บังคับ/)
  assert.match(exec.hint, /ผู้อำนวยการกอง/)
  assert.match(exec.hint, /นายก/)
  assert.deepEqual(departmentSlotMeta({ code: 'exec', name: 'ผู้บริหาร' }), exec)
  assert.deepEqual(departmentSlotMeta({ code: 'finance', name: 'กองคลัง' }), {})
  assert.deepEqual(departmentSlotMeta({ code: 'general', name: 'สำนักปลัด' }), {})
  assert.deepEqual(departmentSlotMeta(null), {})
}

// 10) หน้าจอ: ทุกกองมีแถว (ไม่ซ่อนกองไหน — ซ่อนแล้วผู้ดูแลแก้เองไม่ได้) · ใช้ departmentSlotMeta · ป้ายและตัวนับ "ขาด" ใช้ค่าไม่บังคับเดียวกัน
{
  const source = await readFile(new URL('../src/components/admin/SignatorySettings.jsx', import.meta.url), 'utf8')
  // รายการช่องอยู่ที่ buildSignatorySlots เพราะหน้าจัดการผู้ใช้และฟอร์มเจ้าหน้าที่ใช้ชุดเดียวกัน
  const lib = await readFile(new URL('../src/lib/documentSignatories.js', import.meta.url), 'utf8')
  assert.match(source, /buildSignatorySlots\(departments, assignments, draftRows\)/)
  assert.match(lib, /\.\.\.departmentSlotMeta\(department\)/)
  assert.doesNotMatch(lib, /\.\.\.\(departments \?\? \[\]\)\s*\.filter/)
  assert.doesNotMatch(lib, /department\.code !== 'exec'/)
  assert.match(source, /assignmentState\(assignment, slot\.optional, slot\.emptyLabel\)/)
  assert.match(source, /assignmentState\(assignmentMap\[slot\.key\], slot\.optional, slot\.emptyLabel\)\.ready/)
}

console.log('signatory-people-groups: ผ่านทั้งหมด')
