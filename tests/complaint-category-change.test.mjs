// ตัวช่วยฝั่งหน้าเว็บของการแก้ประเภทคำร้อง (src/lib/complaintCategoryChange.js) — ต้องตรงกับ 20261211100000
// รัน: node tests/complaint-category-change.test.mjs

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  ADMIN_ONLY_CATEGORY, CHANGE_CATEGORY_LOCKED_STATUSES, canChangeComplaintCategory, categoryChangeChoices,
  describeCategoryChange, rerouteConfirmText,
} from '../src/lib/complaintCategoryChange.js'

const me = 'u-me'
const base = { id: 'c1', status: 'received', category: 'water_supply', assigned_to: 'u-other' }
const meta = { odor: { is_adhoc: true }, water_supply: {} }

// ── สิทธิ์เห็นปุ่ม ──
assert.equal(canChangeComplaintCategory(base, me, 'admin', meta), true)
assert.equal(canChangeComplaintCategory(base, me, 'superadmin', meta), true)
assert.equal(canChangeComplaintCategory(base, me, 'officer', meta), false, 'หัวหน้ากองที่ไม่ได้กรองเฉพาะกอง และไม่ใช่ผู้รับผิดชอบ')
assert.equal(canChangeComplaintCategory(base, me, 'officer', meta, { departmentScoped: true }), true)
assert.equal(canChangeComplaintCategory({ ...base, assigned_to: me }, me, 'officer', meta), true)
assert.equal(canChangeComplaintCategory({ ...base, assigned_to: me }, me, 'staff', meta), false, 'staff ใช้ปุ่มส่งคืนแอดมิน')
assert.equal(canChangeComplaintCategory({ ...base, assigned_to: me }, me, 'technician', meta), false)
for (const status of CHANGE_CATEGORY_LOCKED_STATUSES) {
  assert.equal(canChangeComplaintCategory({ ...base, status }, me, 'admin', meta), false, `สถานะ ${status} ต้องล็อก`)
}
for (const status of ['pending', 'new', 'received', 'in_progress', 'parked']) {
  assert.equal(canChangeComplaintCategory({ ...base, status }, me, 'admin', meta), true, `สถานะ ${status} ต้องแก้ได้`)
}
assert.equal(canChangeComplaintCategory({ ...base, category: 'odor' }, me, 'admin', meta), false, 'เฉพาะกิจแก้ไม่ได้')
assert.equal(canChangeComplaintCategory({ ...base, category: ADMIN_ONLY_CATEGORY }, me, 'officer', meta, { departmentScoped: true }), false)
assert.equal(canChangeComplaintCategory({ ...base, category: ADMIN_ONLY_CATEGORY }, me, 'admin', meta), true)
assert.equal(canChangeComplaintCategory(null, me, 'admin', meta), false)
console.log('PASS สิทธิ์เห็นปุ่มแก้ประเภทตรงกับ change_complaint_category()')

// ── ตัวเลือกประเภทปลายทาง ──
const cats = [
  { value: 'water_supply', label: 'สนับสนุนน้ำอุปโภค', department_id: 'd-eng', is_active: true },
  { value: 'tree', label: 'ต้นไม้', department_id: 'd-clerk', is_active: true },
  { value: 'tree', label: 'ต้นไม้ (ซ้ำ)', department_id: 'd-eng', is_active: false },
  { value: 'road', label: 'ถนนชำรุด', department_id: 'd-eng', is_active: true },
  { value: 'old', label: 'เลิกใช้', department_id: 'd-eng', is_active: false },
  { value: 'nodept', label: 'ไม่มีกอง', department_id: null, is_active: true },
  { value: 'odor', label: 'กลิ่น', department_id: 'd-clerk', is_active: true, is_adhoc: true },
  { value: 'corruption', label: 'แจ้งการทุจริต', department_id: 'd-clerk', is_active: true },
]
const depts = [{ id: 'd-eng', name: 'กองช่าง' }, { id: 'd-clerk', name: 'สำนักปลัด' }]
const adminChoices = categoryChangeChoices(cats, depts, 'water_supply', 'admin')
assert.deepEqual(adminChoices.map((c) => c.value).sort(), ['corruption', 'road', 'tree'])
assert.equal(adminChoices.find((c) => c.value === 'tree').departmentName, 'สำนักปลัด')
assert.equal(adminChoices.find((c) => c.value === 'tree').label, 'ต้นไม้', 'แถวซ้ำที่ปิดใช้ต้องไม่ทับแถวที่เปิดอยู่')
const officerChoices = categoryChangeChoices(cats, depts, 'water_supply', 'officer')
assert.equal(officerChoices.some((c) => c.value === 'corruption'), false)
console.log('PASS ตัวเลือกประเภท: ตัดประเภทเดิม/ปิดใช้/ไม่มีกอง/เฉพาะกิจ · หัวหน้ากองไม่เห็นแจ้งการทุจริต')

// ── ข้อความ ──
assert.equal(describeCategoryChange({ department: 'สำนักปลัด', department_changed: true, assigned_to: 'x' }), 'แก้ประเภทแล้ว · ย้ายไปสำนักปลัด')
assert.match(describeCategoryChange({ department: 'สำนักปลัด', department_changed: true, assigned_to: null }), /รอแอดมินรับเรื่อง/)
assert.equal(rerouteConfirmText({ count: 0, department: 'สำนักปลัด' }, 'น้ำ'), '')
assert.equal(rerouteConfirmText(null, 'น้ำ'), '')
const q = rerouteConfirmText({ count: 3, department: 'สำนักปลัด' }, 'สนับสนุนน้ำอุปโภค')
assert.match(q, /3 เรื่อง/)
assert.match(q, /ย้ายไปสำนักปลัด/)
assert.match(q, /เสร็จ\/ปฏิเสธแล้วไม่ย้าย/)
console.log('PASS ข้อความผลลัพธ์และคำถามย้ายเรื่องค้าง')

// ── รายการสถานะล็อกต้องตรงกับ SQL ──
const sql = await readFile(new URL('../supabase/migrations/20261211100000_complaint_change_category.sql', import.meta.url), 'utf8')
const locked = sql.match(/IF v_c\.status IN \(([^)]*)\) THEN/)
assert.ok(locked, 'หาเงื่อนไขสถานะล็อกใน SQL ไม่เจอ')
const sqlStatuses = locked[1].split(',').map((s) => s.trim().replace(/'/g, '')).sort()
assert.deepEqual(sqlStatuses, [...CHANGE_CATEGORY_LOCKED_STATUSES].sort())
assert.ok(sql.includes(`'${ADMIN_ONLY_CATEGORY}' IN (v_c.category, v_cat)`), 'ล็อกแจ้งการทุจริตใน SQL ต้องใช้รหัสเดียวกัน')
console.log('PASS สถานะล็อก/หมวดเฉพาะแอดมิน ตรงกับ SQL')
console.log('ALL PASS complaint-category-change')
