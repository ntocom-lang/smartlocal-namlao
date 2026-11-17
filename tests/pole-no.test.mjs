// เทสต์เลขเสาไฟ: helper + จุดต่อสายในฟอร์ม/หน้าเจ้าหน้าที่/ใบพิมพ์ (ตรวจจากซอร์ส)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cleanPoleNo, getPoleNo, POLE_NO_MAX_LENGTH } from '../src/lib/poleNo.js'

assert.equal(cleanPoleNo('  ศก-12  '), 'ศก-12')
assert.equal(cleanPoleNo('A\n\tB'), 'A B')
assert.equal(cleanPoleNo(''), '')
assert.equal(cleanPoleNo(null), '')
assert.equal(cleanPoleNo(123), '')
assert.equal(cleanPoleNo('x'.repeat(100)).length, POLE_NO_MAX_LENGTH)

assert.equal(getPoleNo({ category: 'light', extra_data: { pole_no: 'ศก-12' } }), 'ศก-12')
assert.equal(getPoleNo({ category: 'light', extra_data: null }), '')
assert.equal(getPoleNo({ category: 'light' }), '')
assert.equal(getPoleNo({ category: 'road', extra_data: { pole_no: 'ศก-12' } }), '')

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const form = read('src/pages/CitizenForm.jsx')
assert.match(form, /pole_no:\s*''/, 'ฟอร์มต้องมี state pole_no')
assert.match(form, /category === 'light'[\s\S]{0,200}pole_no|POLE_NO_CATEGORY/, 'buildExtraData ต้องส่ง pole_no ของหมวด light')
assert.match(form, /name="pole_no"|data-pole-no/, 'ฟอร์มต้องมีช่องเลขเสา')
assert.match(read('src/components/admin/ComplaintsManager.jsx'), /getPoleNo\(/, 'หน้าเจ้าหน้าที่ต้องแสดงเลขเสา')
assert.match(read('src/lib/councilFormPrint.js'), /getPoleNo\(/, 'ใบคำร้องพิมพ์ต้องแสดงเลขเสา')

console.log('pole-no: ผ่านทั้งหมด')
