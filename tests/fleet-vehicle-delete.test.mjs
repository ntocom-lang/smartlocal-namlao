// ลบรถที่มีประวัติ: Super Admin ลบได้ (พิมพ์คำยืนยัน) · คนอื่นยังลบไม่ได้ — เจ้าของระบบสั่ง 2569-10-25 "Super Admin ลบได้ทุกอย่าง"
//   node tests/fleet-vehicle-delete.test.mjs   (หรือ npm run test:fleet:vehicle-delete)
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { VEHICLE_DELETE_CONFIRM_WORD, vehicleDeleteConfirmed, vehicleDeleteErrorText, vehicleDeletePlan } from '../src/lib/fleetVehicleDelete.js'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
let cases = 0
const test = async (label, run) => { await run(); cases++; console.log('PASS ' + label) }

await test('รถไม่มีประวัติ: ยืนยันธรรมดา ทุกบทบาท (เหมือนเดิม)', () => {
  for (const isSuperAdmin of [false, true]) assert.deepEqual(vehicleDeletePlan({ name: 'รถ', isSuperAdmin }), { kind: 'simple' })
})

await test('รถมีประวัติ + ไม่ใช่ Super Admin: ลบไม่ได้ ข้อความเดิม + บอกว่าเฉพาะ Super Admin (ผู้ดูแลยานพาหนะ/แอดมิน อปท. ไม่รวม)', () => {
  const plan = vehicleDeletePlan({ name: 'รถ', trips: 3, fuel: 2, maintenance: 1, isSuperAdmin: false })
  assert.equal(plan.kind, 'blocked')
  assert.ok(plan.message.includes('มีประวัติที่เกี่ยวข้อง 6 รายการ') && plan.message.includes('ปลดระวาง') && plan.message.includes('Super Admin'))
  // แม้มีเที่ยวที่ลงนามออนไลน์ก็ไม่เปิดทางให้คนอื่น
  assert.equal(vehicleDeletePlan({ name: 'รถ', trips: 1, signedTrips: 1 }).kind, 'blocked')
})

await test('รถมีประวัติ + Super Admin: ต้องพิมพ์คำยืนยัน · ข้อความบอกจำนวนแต่ละอย่างเฉพาะที่มี · เตือนเที่ยวที่ลงนามเฉพาะเมื่อมี', () => {
  const plan = vehicleDeletePlan({ name: 'รถกระบะ (กข 1234)', trips: 4, fuel: 0, maintenance: 2, signedTrips: 0, isSuperAdmin: true })
  assert.equal(plan.kind, 'typed')
  assert.equal(plan.word, VEHICLE_DELETE_CONFIRM_WORD)
  assert.ok(plan.prompt.includes('รถกระบะ (กข 1234)') && plan.prompt.includes('เที่ยวใช้รถ 4') && plan.prompt.includes('ซ่อมบำรุง 2'))
  assert.ok(!plan.prompt.includes('เติมน้ำมัน'), 'ไม่ต้องพูดถึงของที่ไม่มี')
  assert.ok(plan.prompt.includes(VEHICLE_DELETE_CONFIRM_WORD) && plan.prompt.includes('กู้คืนไม่ได้') && plan.prompt.includes('ปลดระวาง'))
  assert.ok(!plan.prompt.includes('ลงนามออนไลน์'), 'ไม่มีเที่ยวลงนาม = ไม่ต้องเตือนเรื่องลายเซ็น')
  const signed = vehicleDeletePlan({ name: 'รถ', trips: 5, signedTrips: 2, isSuperAdmin: true })
  assert.ok(signed.prompt.includes('ลงนามออนไลน์ 2 เที่ยว') && signed.prompt.includes('ไม่พบ') && signed.prompt.includes('เก็บหลักฐานลายเซ็น'))
})

await test('คำยืนยันต้องตรงทั้งคำ: ยกเลิกกล่อง/ว่าง/พิมพ์ไม่ครบ/คำใกล้เคียง = ไม่ลบ · ช่องว่างหัวท้ายยอมให้', () => {
  assert.equal(vehicleDeleteConfirmed(VEHICLE_DELETE_CONFIRM_WORD), true)
  assert.equal(vehicleDeleteConfirmed(`  ${VEHICLE_DELETE_CONFIRM_WORD}  `), true)
  for (const input of [null, undefined, '', ' ', 'ยืนยัน', 'ลบ', 'ใช่', 'ยืนยันลบรถ', 'yes', 'ยืนยัน ลบ']) {
    assert.equal(vehicleDeleteConfirmed(input), false, `ต้องไม่ผ่าน: ${JSON.stringify(input)}`)
  }
})

await test('ข้อความ error ตอนลบไม่สำเร็จ: ลายเซ็น/บันทึกอุบัติเหตุแปลเป็นไทยบอกทางไปต่อ · อย่างอื่นแสดงข้อความจริง', () => {
  assert.ok(vehicleDeleteErrorText({ message: 'ESIGN_TRIP_HAS_SIGNATURES: ทริปที่เคยมีลายเซ็นลบไม่ได้ ให้ยกเลิกแทน' }).includes('ผู้ดูแลระบบ'))
  const incident = vehicleDeleteErrorText({ code: '23503', message: 'update or delete on table "fleet_vehicles" violates foreign key constraint "fleet_incidents_vehicle_id_fkey" on table "fleet_incidents"' })
  assert.ok(incident.includes('บันทึกอุบัติเหตุ') && incident.includes('ลบบันทึกอุบัติเหตุของรถคันนี้ก่อน'))
  assert.equal(vehicleDeleteErrorText({ code: '23503', message: 'violates foreign key constraint on table "other"' }), 'ลบไม่สำเร็จ: violates foreign key constraint on table "other"')
  assert.equal(vehicleDeleteErrorText({ message: 'permission denied' }), 'ลบไม่สำเร็จ: permission denied')
  assert.equal(vehicleDeleteErrorText(null), 'ลบไม่สำเร็จ: ')
})

await test('ต่อสายหน้าจอ: เฉพาะ role superadmin (ไม่ใช่ isAdmin ที่รวมผู้ดูแลยานพาหนะ) · พิมพ์คำยืนยันก่อนลบ · บันทึก audit ว่า override', async () => {
  const page = await read('../src/pages/FleetPage.jsx')
  assert.ok(page.includes("isSuperAdmin: role === 'superadmin'"), 'ctx ต้องส่ง isSuperAdmin จาก role จริง')
  assert.ok(!/isSuperAdmin:\s*isAdmin|isSuperAdmin:\s*isSysAdmin/.test(page), 'ห้ามใช้ isAdmin/isSysAdmin แทน (รวมแอดมิน อปท. และผู้ดูแลยานพาหนะ)')
  const vehicles = await read('../src/components/fleet/FleetVehicles.jsx')
  assert.ok(vehicles.includes('isSuperAdmin = false }) {'), 'ค่าเริ่มต้นต้องเป็น false (ปิดไว้ก่อน)')
  const handler = vehicles.slice(vehicles.indexOf('async function handleDelete'), vehicles.indexOf('const filtered = vehicles.filter'))
  assert.ok(handler.includes('vehicleDeletePlan({') && handler.includes('isSuperAdmin })'))
  assert.ok(/plan\.kind === 'blocked'\) \{ alert\(plan\.message\); return \}/.test(handler), 'ไม่ใช่ Super Admin ต้องถูกกัน')
  assert.ok(handler.includes('vehicleDeleteConfirmed(window.prompt(plan.prompt))'), 'ต้องพิมพ์คำยืนยัน')
  assert.ok(handler.indexOf('plan.kind') < handler.indexOf(".from('fleet_vehicles').delete()"), 'ต้องตัดสินก่อนส่งคำสั่งลบ')
  assert.ok(handler.includes("override: 'superadmin'") && handler.includes('withHistory'), 'ต้องบันทึกใน audit ว่าลบพร้อมประวัติโดย Super Admin')
  assert.ok(handler.includes('vehicleDeleteErrorText(error)'))
  // ฐานข้อมูล: บันทึกอุบัติเหตุกันลบรถ (หลักฐาน) — ข้อความ error ที่แปลไว้ต้องตรงกับ FK จริง
  const incidents = await read('../supabase/migrations/20261018110000_fleet_incidents_tables.sql')
  assert.ok(/vehicle_id[^\n]*REFERENCES public\.fleet_vehicles\(id\) ON DELETE RESTRICT/.test(incidents), 'FK ของบันทึกอุบัติเหตุต้องยังเป็น RESTRICT ตามที่ข้อความ error อ้าง')
})

console.log(`\nผ่านทั้งหมด ${cases} กรณี`)
