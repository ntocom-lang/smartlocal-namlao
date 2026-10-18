// ตรวจวัดมลพิษ (ระเบียบ มท. ยานพาหนะ อปท. พ.ศ. ๒๕๖๙ ข้อ ๒๐) — ตัวตัดสินใกล้/เกินกำหนด
// รันด้วย: npm run test:fleet:emission — ไม่แตะฐานข้อมูล
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { classifyEmission, emissionDueText, EMISSION_SOON_KM, EMISSION_TYPE } from '../src/lib/fleetEmission.js'
import { MAINTENANCE_TYPE_LABEL } from '../src/lib/fleetForm6Print.js'

const TODAY = '2026-10-17'
const row = (patch) => ({
  last_check_date: '2026-05-01', last_check_meter: 50000, due_date: '2026-11-01', due_meter: 65000,
  current_meter: 55000, ...patch,
})

// ยังไม่เคยบันทึก
assert.equal(classifyEmission({ last_check_date: null }, TODAY).state, 'never')
// ยังไม่ถึงทั้งสองเกณฑ์
assert.deepEqual(classifyEmission(row({ due_date: '2027-01-01' }), TODAY), { state: 'ok', daysLeft: 76, kmLeft: 10000 })
// "แล้วแต่อย่างใดถึงก่อน": วันยังเหลือมาก แต่กิโลเมตรใกล้ครบ → ใกล้กำหนด
assert.equal(classifyEmission(row({ due_date: '2027-01-01', current_meter: 64500 }), TODAY).state, 'soon')
// กิโลเมตรเกินแล้ว แม้วันยังไม่ถึง → เกินกำหนด
assert.equal(classifyEmission(row({ due_date: '2027-01-01', current_meter: 65001 }), TODAY).state, 'overdue')
// วันใกล้ครบ (15 วัน) แม้กิโลเมตรเหลือเยอะ
assert.equal(classifyEmission(row(), TODAY).state, 'soon')
// วันเกินแล้ว
assert.equal(classifyEmission(row({ due_date: '2026-10-01' }), TODAY).state, 'overdue')
// รถวัดเป็นชั่วโมง/ตรวจครั้งก่อนไม่ได้จดเลขไมล์ → ใช้แค่เกณฑ์วัน
assert.deepEqual(classifyEmission(row({ due_meter: null, due_date: '2027-01-01' }), TODAY), { state: 'ok', daysLeft: 76, kmLeft: null })

assert.equal(emissionDueText(classifyEmission(row({ due_date: '2026-10-01', current_meter: 66000 }), TODAY)), 'เกิน 16 วัน / เกิน 1,000 กม.')
assert.equal(emissionDueText({ state: 'never' }), 'ยังไม่มีบันทึกการตรวจ')

// ประเภทซ่อมบำรุงต้องมีป้ายทุกที่ที่แสดง (หน้าซ่อมบำรุง / รายงาน / แบบ 6) ไม่งั้นขึ้นรหัสดิบ "emission"
assert.equal(MAINTENANCE_TYPE_LABEL[EMISSION_TYPE], 'ตรวจวัดมลพิษ')
for (const file of ['src/components/fleet/FleetMaintenance.jsx', 'src/components/fleet/FleetReport.jsx']) {
  assert.ok(/emission\s*:/.test(readFileSync(file, 'utf8')), `${file} ไม่มีป้ายประเภท emission`)
}

// เกณฑ์เตือนกิโลเมตรของ Telegram (edge function) ต้องตรงกับหน้าจอ
const edge = readFileSync('supabase/functions/fleet-doc-expiry-notify/index.ts', 'utf8')
const edgeSoonKm = Number(edge.match(/const EMISSION_SOON_KM = (\d+)/)?.[1])
assert.equal(edgeSoonKm, EMISSION_SOON_KM, 'EMISSION_SOON_KM ใน edge function ไม่ตรงกับ src/lib/fleetEmission.js')
assert.ok(edge.includes("rpc('fleet_emission_status'"), 'edge function ต้องใช้ RPC ตัวเดียวกับหน้าจอ')

console.log('fleet emission assertions passed')
