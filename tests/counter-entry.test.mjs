// คำขอที่เจ้าหน้าที่กรอกแทนที่เคาน์เตอร์ — แสดงชื่อผู้กรอก (src/lib/counterEntry.js)
//
// เจ้าของระบบถาม 2569-11-05 "ถ้ามาทำที่เคาน์เตอร์ จะดูตรงไหนว่าเจ้าหน้าที่คนไหนเขียนให้"
// รหัสผู้กรอกเก็บอยู่ที่ permit_form_data.signed_by.entered_by_staff_id มาตลอดแต่ไม่มีหน้าจอไหนอ่านไปแสดง
//
// รันด้วย: npm run test:counter-entry

import assert from 'node:assert/strict'
import { counterEntryLabel, counterEntryStaffId, fetchCounterEntryStaff } from '../src/lib/counterEntry.js'

const STAFF_ID = '3f9c2a10-7b1d-4c55-9a52-0d6e8a4b7c21'

// ── ตัวตัดสินว่าเป็นคำขอที่กรอกที่เคาน์เตอร์ ──────────────────────────────────────
const counterReq = { permit_form_data: { signed_by: { channel: 'counter', entered_by_staff_id: STAFF_ID } } }
assert.equal(counterEntryStaffId(counterReq), STAFF_ID, 'คำขอที่กรอกที่เคาน์เตอร์ต้องได้รหัสผู้กรอก')
assert.equal(counterEntryStaffId({ permit_form_data: { signed_by: { entered_by_staff_id: `  ${STAFF_ID} ` } } }), STAFF_ID,
  'ตัดช่องว่างรอบรหัส')

const online = { permit_form_data: { signed_by: { channel: 'online', user_id: 'u1', entered_by_staff_id: null } } }
assert.equal(counterEntryStaffId(online), null, 'ผู้ขอยื่นออนไลน์เอง (entered_by_staff_id = null) ต้องไม่ขึ้นว่ากรอกแทน')

// คำขอเก่าก่อนมี signed_by — ห้ามเดาว่ากรอกที่เคาน์เตอร์ (ไม่มีหลักฐาน)
for (const req of [null, undefined, {}, { permit_form_data: null }, { permit_form_data: {} },
  { permit_form_data: { signed_by: {} } }, { permit_form_data: { signed_by: { entered_by_staff_id: '' } } },
  { permit_form_data: { signed_by: { entered_by_staff_id: '   ' } } }, { permit_form_data: { signed_by: { entered_by_staff_id: 42 } } }]) {
  assert.equal(counterEntryStaffId(req), null, `ต้องไม่ถือเป็นกรอกแทน: ${JSON.stringify(req)}`)
}

// ── ข้อความแสดงผล ───────────────────────────────────────────────────────────────
assert.equal(counterEntryLabel(undefined, STAFF_ID), 'กำลังโหลดชื่อ…')
assert.equal(counterEntryLabel({ name: 'นางสาวสุดา ใจดี', department: 'สำนักปลัด' }, STAFF_ID), 'นางสาวสุดา ใจดี · สำนักปลัด')
assert.equal(counterEntryLabel({ name: 'นางสาวสุดา ใจดี', department: null }, STAFF_ID), 'นางสาวสุดา ใจดี', 'ไม่มีกอง = ไม่มีจุดห้อย')
// หาไม่เจอ (ย้าย/ปิดบัญชี หรือสิทธิ์อ่านไม่ถึง) ต้องบอกตรงๆ พร้อมรหัสสั้นให้ค้นต่อ ไม่ใช่เว้นว่างจนดูเหมือนไม่มีผู้กรอก
assert.equal(counterEntryLabel(null, STAFF_ID), 'ไม่พบชื่อเจ้าหน้าที่ (รหัส 3F9C2A10)')
assert.equal(counterEntryLabel({ name: '  ', department: 'สำนักปลัด' }, STAFF_ID), 'ไม่พบชื่อเจ้าหน้าที่ (รหัส 3F9C2A10)',
  'ชื่อว่างเท่ากับหาไม่เจอ')

// ── ตัวดึงชื่อ (ใช้ client ปลอม ไม่แตะฐานข้อมูลจริง) ─────────────────────────────────
function fakeClient(tables, calls = []) {
  return {
    from(table) {
      const query = { table, filters: {} }
      const chain = {
        select() { return chain },
        eq(column, value) { query.filters[column] = value; return chain },
        async maybeSingle() {
          calls.push({ table, filters: { ...query.filters } })
          const result = tables[table]
          if (result instanceof Error) throw result
          return result ?? { data: null, error: null }
        },
      }
      return chain
    },
  }
}

{
  const calls = []
  const staff = await fetchCounterEntryStaff(fakeClient({
    profiles: { data: { full_name: 'นางสาวสุดา ใจดี', email: 's@example.org', department_id: 'd1' }, error: null },
    departments: { data: { name: 'สำนักปลัด' }, error: null },
  }, calls), STAFF_ID)
  assert.deepEqual(staff, { name: 'นางสาวสุดา ใจดี', department: 'สำนักปลัด' })
  assert.deepEqual(calls[0], { table: 'profiles', filters: { id: STAFF_ID } }, 'ค้นด้วยรหัสผู้กรอกเท่านั้น ไม่ดึงทั้งทะเบียน')
  assert.deepEqual(calls[1], { table: 'departments', filters: { id: 'd1' } })
}
// ไม่มีชื่อเต็ม ใช้อีเมลแทน · ไม่มีกอง ไม่ยิง query กอง
{
  const calls = []
  const staff = await fetchCounterEntryStaff(fakeClient({
    profiles: { data: { full_name: null, email: 's@example.org', department_id: null }, error: null },
  }, calls), STAFF_ID)
  assert.deepEqual(staff, { name: 's@example.org', department: null })
  assert.equal(calls.length, 1, 'ไม่มี department_id ต้องไม่ยิง query กองต่อ')
}
// หาไม่เจอ / error / ไม่มีรหัส / client พัง → null ไม่ throw (ต้องไม่ทำให้แผ่นรายละเอียดทั้งแผ่นพัง)
assert.equal(await fetchCounterEntryStaff(fakeClient({ profiles: { data: null, error: null } }), STAFF_ID), null)
assert.equal(await fetchCounterEntryStaff(fakeClient({ profiles: { data: null, error: { message: 'denied' } } }), STAFF_ID), null)
assert.equal(await fetchCounterEntryStaff(fakeClient({ profiles: new Error('network') }), STAFF_ID), null)
assert.equal(await fetchCounterEntryStaff(fakeClient({}), null), null)
// กองอ่านไม่ได้ ชื่อยังต้องแสดง
assert.deepEqual(await fetchCounterEntryStaff(fakeClient({
  profiles: { data: { full_name: 'นายสมชาย', email: null, department_id: 'd9' }, error: null },
  departments: { data: null, error: { message: 'denied' } },
}), STAFF_ID), { name: 'นายสมชาย', department: null })

console.log('PASS counter-entry: รหัสผู้กรอกแทน/ข้อความแสดง/ตัวดึงชื่อ')
