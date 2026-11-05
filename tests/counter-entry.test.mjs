// คำขอที่เจ้าหน้าที่กรอกแทนที่เคาน์เตอร์ — แสดงชื่อผู้กรอก (src/lib/counterEntry.js)
//
// เจ้าของระบบถาม 2569-11-05 "ถ้ามาทำที่เคาน์เตอร์ จะดูตรงไหนว่าเจ้าหน้าที่คนไหนเขียนให้"
// รหัสผู้กรอกมี 2 ชั้น: created_by_uid ที่ฐานข้อมูลประทับเอง (เชื่อได้) และ permit_form_data.signed_by.entered_by_staff_id
// ที่เบราว์เซอร์เขียนมา (ใช้เฉพาะแถวเก่า + ต้องบอกว่ายังไม่ยืนยัน) — migration 20261105110000/20261105110100
//
// รันด้วย: npm run test:counter-entry

import assert from 'node:assert/strict'
import { counterEntryLabel, counterEntryNote, counterEntryOf, fetchCounterEntryStaff } from '../src/lib/counterEntry.js'

const STAFF_ID = '3f9c2a10-7b1d-4c55-9a52-0d6e8a4b7c21'

// ── ตัวตัดสินว่าเป็นคำขอที่กรอกที่เคาน์เตอร์ ──────────────────────────────────────
const OTHER_ID = '9a8b7c6d-1111-4222-8333-444455556666'
const CITIZEN_ID = 'c1c1c1c1-2222-4333-8444-555566667777'
const claim = id => ({ signed_by: { channel: 'counter', entered_by_staff_id: id } })

// ชั้นที่ 1: ฐานข้อมูลประทับแล้ว = ยืนยัน
assert.deepEqual(counterEntryOf({ created_by_uid: STAFF_ID, user_id: null, permit_form_data: claim(STAFF_ID) }),
  { staffId: STAFF_ID, verified: true, mismatch: false }, 'ประทับแล้ว + ฟอร์มอ้างตรงกัน = ยืนยัน ไม่มีเตือน')
assert.deepEqual(counterEntryOf({ created_by_uid: STAFF_ID, user_id: null }),
  { staffId: STAFF_ID, verified: true, mismatch: false }, 'ไม่มี signed_by เลยก็ได้ — เจ้าหน้าที่สร้างคำขอเองผ่านปุ่ม "สร้างคำขอ"')
// ฟอร์มอ้างคนอื่น แต่ฐานประทับอีกคน → เชื่อฐาน + เตือน (ปลอมฟอร์มก่อนส่ง)
assert.deepEqual(counterEntryOf({ created_by_uid: STAFF_ID, user_id: null, permit_form_data: claim(OTHER_ID) }),
  { staffId: STAFF_ID, verified: true, mismatch: true }, 'ฟอร์มอ้างอีกคน ต้องเชื่อบัญชีที่ฐานประทับและเตือน')
// ผู้ขอยื่นเอง (บัญชีที่กดบันทึก = เจ้าของคำขอ) ไม่ใช่กรอกแทน — แม้ฟอร์มจะอ้างอะไรมา
assert.equal(counterEntryOf({ created_by_uid: CITIZEN_ID, user_id: CITIZEN_ID }), null, 'ประชาชนยื่นเอง ต้องไม่ขึ้นกรอกแทน')
assert.equal(counterEntryOf({ created_by_uid: CITIZEN_ID, user_id: CITIZEN_ID, permit_form_data: claim(OTHER_ID) }), null,
  'ฐานบอกว่าเจ้าของคำขอกดบันทึกเอง ชนะค่าที่ฟอร์มอ้าง')
// เจ้าหน้าที่กรอกแทนประชาชนที่มีบัญชี (user_id เป็นของประชาชน แต่บัญชีที่กดบันทึกเป็นเจ้าหน้าที่)
assert.deepEqual(counterEntryOf({ created_by_uid: STAFF_ID, user_id: CITIZEN_ID }),
  { staffId: STAFF_ID, verified: true, mismatch: false })

// ชั้นที่ 2: แถวเก่า (created_by_uid ว่าง) ใช้ค่าที่ฟอร์มอ้าง และต้องติดป้ายว่ายังไม่ยืนยัน
assert.deepEqual(counterEntryOf({ created_by_uid: null, permit_form_data: claim(STAFF_ID) }),
  { staffId: STAFF_ID, verified: false, mismatch: false }, 'แถวเก่า = ค่าที่ฟอร์มอ้าง ยังไม่ยืนยัน')
assert.deepEqual(counterEntryOf({ permit_form_data: claim(`  ${STAFF_ID} `) }),
  { staffId: STAFF_ID, verified: false, mismatch: false }, 'ฐานยังไม่มีคอลัมน์ (undefined) ก็ใช้ชั้นที่ 2 · ตัดช่องว่างรอบรหัส')

// ไม่มีหลักฐานเลย → ห้ามเดาว่ากรอกที่เคาน์เตอร์
const online = { permit_form_data: { signed_by: { channel: 'online', user_id: 'u1', entered_by_staff_id: null } } }
assert.equal(counterEntryOf(online), null, 'ผู้ขอยื่นออนไลน์เอง (entered_by_staff_id = null) ต้องไม่ขึ้นว่ากรอกแทน')
for (const req of [null, undefined, {}, { permit_form_data: null }, { permit_form_data: {} }, { created_by_uid: null },
  { created_by_uid: '' }, { created_by_uid: '   ' }, { created_by_uid: 7 },
  { permit_form_data: { signed_by: {} } }, { permit_form_data: { signed_by: { entered_by_staff_id: '' } } },
  { permit_form_data: { signed_by: { entered_by_staff_id: '   ' } } }, { permit_form_data: { signed_by: { entered_by_staff_id: 42 } } }]) {
  assert.equal(counterEntryOf(req), null, `ต้องไม่ถือเป็นกรอกแทน: ${JSON.stringify(req)}`)
}

// ── บรรทัดบอกระดับความเชื่อถือ ───────────────────────────────────────────────────
assert.equal(counterEntryNote(null), '')
assert.equal(counterEntryNote({ staffId: STAFF_ID, verified: true, mismatch: false }), 'ที่เคาน์เตอร์ · ระบบประทับจากบัญชีที่กดบันทึกจริง')
assert.match(counterEntryNote({ staffId: STAFF_ID, verified: false, mismatch: false }), /ยังไม่ได้ยืนยันโดยระบบ/,
  'แถวเก่าต้องไม่ดูเหมือนฐานข้อมูลยืนยันแล้ว')
assert.match(counterEntryNote({ staffId: STAFF_ID, verified: true, mismatch: true }), /ฟอร์มอ้างชื่ออีกคน/)

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
