import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  buildFleetTripRequestHtml,
  resolveDeptHead,
  resolveOrderAuthority,
} from '../src/lib/fleetTripPrint.js'
import { pickSignatory, signatoryName, signatoryTitle } from '../src/lib/documentSignatories.js'

const tenant = { name: 'เทศบาลตำบลสาธิต', province: 'แพร่' }

const trip = {
  id: 't1',
  status: 'approved',
  created_at: '2026-09-01T02:00:00.000Z',
  planned_departure: '2026-09-01T02:00:00.000Z',
  planned_return: '2026-09-01T09:00:00.000Z',
  destination: 'ศาลากลางจังหวัด',
  destination_locality: 'อำเภอเมืองแพร่',
  destination_province: 'แพร่',
  purpose: 'ประชุม',
  passengers: 2,
  requester: { full_name: 'สมชาย ผู้ขอ' },
  driver: { full_name: 'สมศักดิ์ คนขับ' },
  vehicle: { license_plate: 'กข 1234 แพร่' },
}

// ── ทะเบียนผู้ลงนามจำลอง (รูปแบบเดียวกับที่ SIGNATORY_REGISTRY_SELECT คืนมา) ──────
const DEPT_EDU = '11111111-1111-1111-1111-111111111111'
const DEPT_CIVIL = '22222222-2222-2222-2222-222222222222'
const registry = [
  {
    signatory_role: 'mayor', department_id: null,
    manual_name: null, title_override: null,
    effective_from: '2026-01-01', effective_to: null,
    profile: { full_name: 'สมนึก นายกฯ', job_title: null, position: { name: 'นายกเทศมนตรี' } },
  },
  {
    signatory_role: 'clerk', department_id: null,
    manual_name: 'สมหญิง ปลัดฯ', title_override: 'ปลัดเทศบาล รักษาราชการแทนนายกเทศมนตรี',
    effective_from: '2026-01-01', effective_to: null,
    profile: null,
  },
  {
    signatory_role: 'department_head', department_id: DEPT_EDU,
    manual_name: null, title_override: null,
    effective_from: '2026-01-01', effective_to: null,
    profile: { full_name: 'สมปอง ผอ.กองการศึกษา', job_title: 'ผู้อำนวยการกองการศึกษา', position: null },
  },
  {
    signatory_role: 'vehicle_authority', department_id: null,
    manual_name: null, title_override: 'รองนายกเทศมนตรี ปฏิบัติราชการแทนนายกเทศมนตรี',
    effective_from: '2026-01-01', effective_to: null,
    profile: { full_name: 'สมชิด รองนายกฯ', job_title: 'รองนายกเทศมนตรี', position: null },
  },
  // แถวหมดอายุแล้ว ต้องไม่ถูกเลือกมาพิมพ์
  {
    signatory_role: 'department_head', department_id: DEPT_CIVIL,
    manual_name: 'สมคิด คนเก่า', title_override: null,
    effective_from: '2026-01-01', effective_to: '2026-02-01',
    profile: null,
  },
]

// ── pickSignatory: ต้องแยกบทบาท/กอง และตัดแถวที่หมดอายุออก ────────────────────────
assert.equal(signatoryName(pickSignatory(registry, { role: 'mayor' })), 'สมนึก นายกฯ')
assert.equal(signatoryName(pickSignatory(registry, { role: 'clerk' })), 'สมหญิง ปลัดฯ')
assert.equal(
  signatoryName(pickSignatory(registry, { role: 'department_head', departmentId: DEPT_EDU })),
  'สมปอง ผอ.กองการศึกษา',
)
// นายก/ปลัดเก็บ department_id เป็น NULL — ห้ามหลุดมาตอบตอนถามหาหัวหน้ากอง
assert.equal(pickSignatory(registry, { role: 'department_head' }), null)
// แถวที่ effective_to ผ่านไปแล้วต้องไม่ถูกหยิบ ไม่งั้นใบจะพิมพ์ชื่อคนที่พ้นตำแหน่ง
assert.equal(pickSignatory(registry, { role: 'department_head', departmentId: DEPT_CIVIL }), null)
assert.equal(signatoryTitle(pickSignatory(registry, { role: 'clerk' })), 'ปลัดเทศบาล รักษาราชการแทนนายกเทศมนตรี')

// ── ค่าปริยาย: ไม่เลือกอะไรเลย = นายก และหัวหน้ากองตามกองของทริป ─────────────────
const defaultHtml = buildFleetTripRequestHtml({
  trip, tenant,
  orderAuthority: resolveOrderAuthority(pickSignatory(registry, { role: 'mayor' }), tenant, 'mayor'),
  deptHead: resolveDeptHead(pickSignatory(registry, { role: 'department_head', departmentId: DEPT_EDU })),
})
assert.ok(defaultHtml.includes('สมนึก นายกฯ'))
assert.ok(defaultHtml.includes('สมปอง ผอ.กองการศึกษา'))
assert.ok(defaultHtml.includes('ผู้อำนวยการกอง/หัวหน้ากอง'))

// ── เลือกปลัดเป็นผู้มีอำนาจสั่งใช้รถ ───────────────────────────────────────────────
const clerkAuthority = resolveOrderAuthority(pickSignatory(registry, { role: 'clerk' }), tenant, 'clerk')
assert.equal(clerkAuthority.name, 'สมหญิง ปลัดฯ')
assert.equal(clerkAuthority.title, 'ปลัดเทศบาล รักษาราชการแทนนายกเทศมนตรี')

// ปลัดที่ยังไม่ได้ตั้งชื่อตำแหน่งต้องเว้นว่าง ห้ามถอยไปใช้ "นายกเทศมนตรี..." ของ tenant
// ซึ่งจะทำให้เอกสารระบุตำแหน่งผู้ลงนามผิดตัว
const bareClerk = resolveOrderAuthority(
  { manual_name: 'สมหญิง ปลัดฯ', title_override: null, profile: null }, tenant, 'clerk',
)
assert.equal(bareClerk.title, '')
// ส่วนนายกยังถอยไปใช้ชื่อตำแหน่งตามประเภทหน่วยงานได้เหมือนเดิม
const bareMayor = resolveOrderAuthority(
  { manual_name: 'สมนึก นายกฯ', title_override: null, profile: null }, tenant, 'mayor',
)
assert.equal(bareMayor.title, 'นายกเทศมนตรีตำบลสาธิต')
// ไม่ส่ง role มาต้องประพฤติเหมือนเดิมทุกประการ (ทริปเก่าที่ order_authority_role เป็น NULL)
assert.deepEqual(resolveOrderAuthority({ manual_name: 'สมนึก นายกฯ' }, tenant), bareMayor)

// ── กรณีนายกมอบอำนาจให้ผู้อื่นสั่งใช้รถ (เช่น รองนายก) ─────────────────────────────
const delegated = pickSignatory(registry, { role: 'vehicle_authority' })
assert.equal(signatoryName(delegated), 'สมชิด รองนายกฯ')
const delegatedAuthority = resolveOrderAuthority(delegated, tenant, 'vehicle_authority')
assert.equal(delegatedAuthority.name, 'สมชิด รองนายกฯ')
assert.equal(delegatedAuthority.title, 'รองนายกเทศมนตรี ปฏิบัติราชการแทนนายกเทศมนตรี')
// ห้ามถอยไปใช้ "นายกเทศมนตรี..." ของ tenant เด็ดขาด — ผู้รับมอบอำนาจไม่ใช่นายก
// การพิมพ์ตำแหน่งนายกใต้ชื่อรองนายกคือการระบุผู้ลงนามผิดตัวในเอกสารราชการ
assert.equal(
  resolveOrderAuthority({ manual_name: 'สมชิด รองนายกฯ' }, tenant, 'vehicle_authority').title,
  '',
)
// แถวมอบอำนาจต้องไม่ปนกับนายก/ปลัด — ทั้งสามเป็นคนละแถวในทะเบียน
assert.notEqual(signatoryName(pickSignatory(registry, { role: 'mayor' })), signatoryName(delegated))
const delegatedHtml = buildFleetTripRequestHtml({
  trip, tenant, orderAuthority: delegatedAuthority, deptHead: resolveDeptHead(null),
})
assert.ok(delegatedHtml.includes('สมชิด รองนายกฯ'))
assert.ok(!delegatedHtml.includes('สมนึก นายกฯ'))

// ── ยังไม่ได้ตั้งผู้ลงนาม = เว้นช่องให้เซ็นสด ห้ามเดาชื่อ ────────────────────────────
assert.equal(resolveDeptHead(null).name, '')
const blankHtml = buildFleetTripRequestHtml({
  trip, tenant, orderAuthority: resolveOrderAuthority(null, tenant), deptHead: resolveDeptHead(null),
})
assert.ok(blankHtml.includes('ผู้อำนวยการกอง/หัวหน้ากอง'))
assert.ok(!blankHtml.includes('สมปอง'))
// เรียกแบบไม่ส่ง deptHead เลยต้องไม่พังและได้ผลเท่ากับส่ง null
assert.equal(
  buildFleetTripRequestHtml({ trip, tenant, orderAuthority: resolveOrderAuthority(null, tenant) }),
  blankHtml,
)

// ── ช่องหัวหน้ากองพิมพ์เฉพาะชื่อ ไม่เพิ่มบรรทัดตำแหน่ง (ใบต้องจบใน 1 หน้า A4) ────────
assert.equal(Object.keys(resolveDeptHead(registry[2])).join(','), 'name')
const titleLines = (html) => (html.match(/class="signature-title"/g) ?? []).length
// มีบรรทัดตำแหน่งได้บล็อกเดียวคือผู้มีอำนาจสั่งใช้รถ
assert.equal(titleLines(defaultHtml), 1)

// ── UI/DB: ค่าที่เลือกต้องถูกส่งลงคอลัมน์จริง และค่าว่างต้องกลายเป็น NULL ───────────
const tripsSource = await readFile(new URL('../src/components/fleet/FleetTrips.jsx', import.meta.url), 'utf8')
assert.ok(tripsSource.includes('dept_head_department_id: form.dept_head_department_id || null'))
assert.ok(tripsSource.includes('order_authority_role: form.order_authority_role || null'))
// ไม่ได้เลือกหัวหน้ากอง = ใช้กองที่รับผิดชอบทริป
assert.ok(tripsSource.includes('t.dept_head_department_id || t.department_id'))
assert.ok(tripsSource.includes("t.order_authority_role || 'mayor'"))
// เส้นทางแทรกคิวฉุกเฉินสร้างทริปผ่าน RPC ที่ไม่รับ 2 ฟิลด์นี้ ต้องเขียนตามหลังเสมอ
// ไม่งั้นค่าที่เจ้าหน้าที่เลือกจะหายเงียบจนกว่าจะพิมพ์ใบออกมาแล้วเจอชื่อผิด
assert.ok(tripsSource.includes('const signatoryChoice = {'))
assert.ok(tripsSource.includes('.update(signatoryChoice)'))

// ── ค่าเริ่มต้นต้องเป็นค่าจริง ไม่ใช่ปล่อยว่างให้เจ้าหน้าที่เดาเอง ──────────────────
// เปิดฟอร์มใหม่ = หัวหน้ากองของผู้ขอ + นายก (ทั้งสองฟอร์ม: ขออนุญาต และบันทึกย้อนหลัง)
assert.equal(
  (tripsSource.match(/dept_head_department_id: deptHeadDefault\(/g) ?? []).length, 2,
)
assert.equal((tripsSource.match(/order_authority_role: authorityDefault\(\)/g) ?? []).length, 2)
// เปลี่ยนผู้ขอแล้วหัวหน้ากองต้องเปลี่ยนตาม ไม่ค้างชื่อหัวหน้าของคนก่อนหน้า
assert.ok(tripsSource.includes('const deptHead = deptHeadDefault(picked?.department_id)'))
// ต้องอ่าน department_id ของโปรไฟล์ตัวเองมาด้วย ไม่งั้น default ของฟอร์มใหม่จะว่างเสมอ
assert.ok(tripsSource.includes('id,full_name,job_title,department_id,position:positions(name)'))
// กองที่ยังไม่มีผู้ลงนามห้ามถูก preselect — <select> จะถือค่าที่ไม่มี option แล้วโชว์ช่องว่าง
assert.ok(tripsSource.includes("return pickSignatory(signatories, { role: 'department_head', departmentId }) ? departmentId : ''"))
assert.ok(tripsSource.includes("return pickSignatory(signatories, { role: 'mayor' }) ? 'mayor' : ''"))
// ตั้งผู้รับมอบอำนาจไว้ = ต้องเป็นค่าตั้งต้น ไม่งั้นเจ้าหน้าที่ต้องจำสลับเองทุกใบ
assert.ok(tripsSource.includes("if (pickSignatory(signatories, { role: 'vehicle_authority' })) return 'vehicle_authority'"))
assert.ok(tripsSource.includes("{ role: 'vehicle_authority', label: 'ผู้รับมอบอำนาจ',"))
// กล่องผู้ลงนามอยู่ล่างสุดของทั้งสองฟอร์ม (บรรทัดสุดท้ายก่อนปิด Modal)
assert.equal((tripsSource.match(/ {10}\{signatoryFields\}\r?\n {8}<\/Modal>/g) ?? []).length, 2)

const migrationSource = await readFile(
  new URL('../supabase/migrations/20260904120000_fleet_trip_form3_signatories.sql', import.meta.url), 'utf8',
)
assert.match(migrationSource, /ADD COLUMN IF NOT EXISTS dept_head_department_id uuid/)
assert.match(migrationSource, /ADD COLUMN IF NOT EXISTS order_authority_role text/)
// กองถูกยุบต้องถอยไปใช้ค่าปริยาย ไม่ใช่บล็อกการลบกองหรือชี้กองที่ไม่มีอยู่
assert.ok(migrationSource.includes('ON DELETE SET NULL'))
// ห้ามตั้ง DEFAULT ให้คอลัมน์ใหม่ — ทริปเก่าต้องเป็น NULL เพื่อให้ fallback เดิมทำงาน
assert.ok(!/ADD COLUMN IF NOT EXISTS (dept_head_department_id|order_authority_role)[^,;]*DEFAULT/.test(migrationSource))

// ── migration บทบาทผู้รับมอบอำนาจ ───────────────────────────────────────────────
const roleMigration = await readFile(
  new URL('../supabase/migrations/20260904130000_signatory_vehicle_authority_role.sql', import.meta.url), 'utf8',
)
// จำกัด 3 บทบาทนี้เท่านั้น — กันระบุผู้ไม่มีอำนาจสั่งใช้รถลงในเอกสาร
assert.ok(roleMigration.includes("order_authority_role IN ('mayor', 'clerk', 'vehicle_authority')"))
assert.ok(roleMigration.includes("signatory_role IN ('department_head', 'clerk', 'mayor', 'vehicle_authority')"))
// บทบาทใหม่เป็นระดับหน่วยงาน ต้องอยู่ฝั่ง department_id IS NULL ของ CHECK ขอบเขต
// ถ้าลืมข้อนี้ ทุกการบันทึกบทบาทใหม่จะโดนปัดตกด้วย 23514 ที่อ่านไม่ออกว่าเกิดจากอะไร
assert.ok(roleMigration.includes("(signatory_role IN ('clerk', 'mayor', 'vehicle_authority') AND department_id IS NULL)"))
// RPC ต้องรับบทบาทใหม่ทั้งตอนตรวจชื่อบทบาทและตอนตรวจขอบเขตกอง
assert.ok(roleMigration.includes("IF p_signatory_role NOT IN ('department_head', 'clerk', 'mayor', 'vehicle_authority') THEN"))
assert.ok(roleMigration.includes("OR (p_signatory_role IN ('clerk', 'mayor', 'vehicle_authority') AND p_department_id IS NOT NULL)"))
// CREATE OR REPLACE ต้องยกฟังก์ชันมาครบ ห้ามเหลือโครงเปล่า — เคยทำ profiles พังทั้งระบบมาแล้ว
for (const mustKeep of [
  "RAISE EXCEPTION 'ไม่มีสิทธิ์กำหนดผู้ลงนาม'",
  'UPDATE public.document_signatories',
  'INSERT INTO public.document_signatories',
  'INSERT INTO public.audit_logs',
  'RETURN v_result;',
]) {
  assert.ok(roleMigration.includes(mustKeep), 'RPC ขาดส่วน: ' + mustKeep)
}
// CHECK เดิมไม่มีชื่อ ต้องค้นจากนิยามจริง ห้าม DROP CONSTRAINT ด้วยชื่อที่เดาเอา
assert.ok(roleMigration.includes('FROM pg_constraint'))
assert.ok(!/DROP CONSTRAINT IF EXISTS document_signatories_check\d*/.test(roleMigration))
// ห้ามแตะ constraint อื่นที่ไม่เกี่ยวกับบทบาท (identity/ความยาวชื่อ) — pattern ต้องอิง signatory_role
assert.ok(roleMigration.includes("LIKE '%signatory_role%department_head%'"))

console.log('fleet form 3 signatory assertions passed')
