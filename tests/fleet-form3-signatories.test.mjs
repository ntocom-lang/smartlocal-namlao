import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  buildFleetTripRequestHtml,
  resolveDeptHead,
  resolveOrderAuthority,
} from '../src/lib/fleetTripPrint.js'
import {
  defaultVehicleAuthority, organizationSignatories, pickSignatory, signatoryName, signatoryTitle,
} from '../src/lib/documentSignatories.js'

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
    signatory_role: 'custom', department_id: null, custom_label: 'ผู้รับมอบอำนาจสั่งใช้รถ',
    is_vehicle_order_default: true,
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

// ── แถวที่แอดมินสร้างเอง: มีได้หลายแถว ต้องแยกกันด้วยชื่อแถว ────────────────────────
const customA = { signatory_role: 'custom', department_id: null, custom_label: 'รองนายก (สั่งใช้รถ)',
  manual_name: 'สมชิด รองนายก ก.', title_override: 'รองนายกเทศมนตรี', effective_from: '2026-01-01', effective_to: null, profile: null }
const customB = { signatory_role: 'custom', department_id: null, custom_label: 'รองนายก (งานช่าง)',
  manual_name: 'สมทรง รองนายก ข.', title_override: 'รองนายกเทศมนตรี', effective_from: '2026-01-01', effective_to: null, profile: null }
const withCustom = [...registry, customA, customB]
assert.equal(signatoryName(pickSignatory(withCustom, { role: 'custom', customLabel: 'รองนายก (สั่งใช้รถ)' })), 'สมชิด รองนายก ก.')
assert.equal(signatoryName(pickSignatory(withCustom, { role: 'custom', customLabel: 'รองนายก (งานช่าง)' })), 'สมทรง รองนายก ข.')
// ไม่ระบุชื่อแถว = ไม่ควรได้แถว custom แถวใดเลย ไม่งั้นเอกสารจะหยิบผิดคนโดยไม่มีใครรู้
assert.equal(pickSignatory(withCustom, { role: 'custom' }), null)
// บทบาทของระบบต้องไม่ถูกแถว custom แย่งไป
assert.equal(signatoryName(pickSignatory(withCustom, { role: 'mayor' })), 'สมนึก นายกฯ')
// organizationSignatories = ทุกแถวที่ไม่ผูกกับกอง (นายก ปลัด ผู้รับมอบอำนาจ + custom)
// หัวหน้ากองต้องไม่หลุดเข้ามา เพราะไม่ใช่ผู้มีอำนาจสั่งใช้รถ
const orgRows = organizationSignatories(withCustom)
assert.ok(orgRows.every(r => r.signatory_role !== 'department_head'))
assert.equal(orgRows.filter(r => r.signatory_role === 'custom').length, 3)

// ── เครื่องหมาย "ผู้มีอำนาจสั่งใช้รถโดยปริยาย" ───────────────────────────────────
assert.equal(signatoryName(defaultVehicleAuthority(withCustom)), 'สมชิด รองนายกฯ')
// ไม่มีแถวไหนติ๊ก = ไม่มีค่าตั้งต้น (ฝั่ง UI จะถอยไปใช้นายก)
assert.equal(defaultVehicleAuthority(registry.filter(r => !r.is_vehicle_order_default)), null)
assert.equal(defaultVehicleAuthority([]), null)
// แถวที่ติ๊กแต่หมดอายุแล้วต้องไม่ถูกหยิบ ไม่งั้นใบจะขึ้นชื่อคนที่พ้นตำแหน่ง
assert.equal(defaultVehicleAuthority([{ ...customA, is_vehicle_order_default: true, effective_to: '2026-02-01' }]), null)

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
// ค่าตั้งต้นมาจากแถวที่ติ๊กไว้ ไม่ใช่บทบาทตายตัว
const delegated = defaultVehicleAuthority(registry)
assert.equal(signatoryName(delegated), 'สมชิด รองนายกฯ')
const delegatedAuthority = resolveOrderAuthority(delegated, tenant, 'custom')
assert.equal(delegatedAuthority.name, 'สมชิด รองนายกฯ')
assert.equal(delegatedAuthority.title, 'รองนายกเทศมนตรี ปฏิบัติราชการแทนนายกเทศมนตรี')
// ห้ามถอยไปใช้ "นายกเทศมนตรี..." ของ tenant เด็ดขาด — ผู้รับมอบอำนาจไม่ใช่นายก
// การพิมพ์ตำแหน่งนายกใต้ชื่อรองนายกคือการระบุผู้ลงนามผิดตัวในเอกสารราชการ
assert.equal(
  resolveOrderAuthority({ manual_name: 'สมชิด รองนายกฯ' }, tenant, 'custom').title,
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
assert.equal((tripsSource.match(/\.\.\.authorityDefault\(\)/g) ?? []).length, 2)
// เปลี่ยนผู้ขอแล้วหัวหน้ากองต้องเปลี่ยนตาม ไม่ค้างชื่อหัวหน้าของคนก่อนหน้า
assert.ok(tripsSource.includes('const deptHead = deptHeadDefault(picked?.department_id)'))
// ต้องอ่าน department_id ของโปรไฟล์ตัวเองมาด้วย ไม่งั้น default ของฟอร์มใหม่จะว่างเสมอ
assert.ok(tripsSource.includes('id,full_name,job_title,department_id,position:positions(name)'))
// กองที่ยังไม่มีผู้ลงนามห้ามถูก preselect — <select> จะถือค่าที่ไม่มี option แล้วโชว์ช่องว่าง
assert.ok(tripsSource.includes("return pickSignatory(signatories, { role: 'department_head', departmentId }) ? departmentId : ''"))
// ไม่มีแถวไหนติ๊กไว้ = ถอยไปใช้นายก และถ้าไม่มีนายกด้วยก็ไม่ preselect อะไรเลย
assert.ok(tripsSource.includes("order_authority_role: pickSignatory(signatories, { role: 'mayor' }) ? 'mayor' : ''"))
// ตั้งผู้รับมอบอำนาจไว้ = ต้องเป็นค่าตั้งต้น ไม่งั้นเจ้าหน้าที่ต้องจำสลับเองทุกใบ
assert.ok(tripsSource.includes('const marked = defaultVehicleAuthority(signatories)'))
// ตัวเลือกต้องมาจากทะเบียนจริง ไม่ใช่รายการบทบาทตายตัวในโค้ด (แอดมินเพิ่มแถวเองได้แล้ว)
assert.ok(tripsSource.includes('organizationSignatories(signatories)'))
// เก็บคู่ (role, label) เพราะบทบาท custom มีได้หลายแถว role อย่างเดียวชี้ไม่ถูกว่าแถวไหน
assert.equal((tripsSource.match(/order_authority_label: form\.order_authority_role === CUSTOM_ROLE/g) ?? []).length, 3)
assert.ok(tripsSource.includes('pickSignatory(signatories, { role: authorityRole, customLabel: authorityLabel })'))
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

// ── migration แถวที่แอดมินสร้างเอง ────────────────────────────────────────────────
const customMigration = await readFile(
  new URL('../supabase/migrations/20260904140000_signatory_custom_rows.sql', import.meta.url), 'utf8',
)
assert.ok(customMigration.includes("signatory_role IN ('department_head', 'clerk', 'mayor', 'vehicle_authority', 'custom')"))
// custom เป็นผู้ลงนามระดับหน่วยงาน ต้องอยู่ฝั่ง department_id IS NULL
assert.ok(customMigration.includes("(signatory_role IN ('clerk', 'mayor', 'vehicle_authority', 'custom') AND department_id IS NULL)"))
// ชื่อแถวเป็นตัวระบุแถว: custom ต้องมี บทบาทอื่นต้องไม่มี
assert.ok(customMigration.includes('document_signatories_custom_label_check'))
// unique index ต้องรวม custom_label ไม่งั้น custom มีได้แถวเดียวทั้ง อปท. ซึ่งผิดวัตถุประสงค์
assert.ok(customMigration.includes("coalesce(custom_label, '')"))
// v3 เป็นฟังก์ชันใหม่ ไม่ใช่การเติมพารามิเตอร์ให้ v2 (กัน PostgREST เลือก overload ผิด)
assert.ok(customMigration.includes('CREATE OR REPLACE FUNCTION public.set_document_signatory_v3('))
assert.ok(customMigration.includes('CREATE OR REPLACE FUNCTION public.clear_document_signatory_v2('))
// ปิดแถวเดิมต้องเจาะจงถึง label ไม่งั้นสร้างแถว custom ใหม่จะไปปิดแถว custom อื่นทิ้ง
assert.ok(customMigration.includes('AND custom_label IS NOT DISTINCT FROM v_custom_label'))
for (const mustKeep of [
  "RAISE EXCEPTION 'ไม่มีสิทธิ์กำหนดผู้ลงนาม'",
  'INSERT INTO public.document_signatories',
  'INSERT INTO public.audit_logs',
  'RETURN v_result;',
]) {
  assert.ok(customMigration.includes(mustKeep), 'v3 ขาดส่วน: ' + mustKeep)
}

// การถอนสิทธิ์ RPC เก่าต้องอยู่คนละไฟล์กับที่สร้างเวอร์ชันใหม่ เพราะ migration ถูก apply
// ก่อน deploy โค้ดเสมอ ถ้า revoke พร้อมกัน โค้ดที่รันอยู่บน production จะเรียกตัวเก่าไม่ได้
// ระหว่างรอ deploy (เกิดจริงแล้ว 2026-09-02 — ดูไฟล์ regrant)
const regrantMigration = await readFile(
  new URL('../supabase/migrations/20260904160000_regrant_legacy_signatory_rpcs.sql', import.meta.url), 'utf8',
)
assert.ok(regrantMigration.includes('GRANT EXECUTE ON FUNCTION public.set_document_signatory_v2('))
assert.ok(regrantMigration.includes('GRANT EXECUTE ON FUNCTION public.clear_document_signatory(uuid, text, uuid)'))

// UI: ต้องเรียก RPC เวอร์ชันที่รองรับชื่อแถว และมีทางเพิ่มแถวเอง
const settingsSource = await readFile(
  new URL('../src/components/admin/SignatorySettings.jsx', import.meta.url), 'utf8',
)
// v3 ถูกแทนด้วย v4 แล้ว (รองรับเครื่องหมายค่าตั้งต้น) ต้องไม่มีใครเรียกตัวเก่าอีก
assert.ok(!settingsSource.includes("supabase.rpc('set_document_signatory_v3'"))
assert.ok(settingsSource.includes("supabase.rpc('clear_document_signatory_v2'"))
assert.ok(settingsSource.includes('function addCustomRow()'))
// คีย์แถวต้องรวมชื่อแถว ไม่งั้นทุกแถวที่สร้างเองจะแสดงค่าของแถวเดียวกันหมด
assert.ok(settingsSource.includes('function assignmentKey(role, departmentId = null, customLabel = null)'))
assert.ok(settingsSource.includes('p_custom_label: slot.customLabel ?? null'))

// ── migration เครื่องหมายค่าตั้งต้น + ปลดระวางบทบาทสำเร็จรูป ──────────────────────
const flagMigration = await readFile(
  new URL('../supabase/migrations/20260904180000_signatory_vehicle_default_flag.sql', import.meta.url), 'utf8',
)
assert.ok(flagMigration.includes('ADD COLUMN IF NOT EXISTS is_vehicle_order_default boolean NOT NULL DEFAULT false'))
// ติ๊กได้แถวเดียวต่อ อปท. — ถ้ามีสองแถวระบบเลือกไม่ถูกว่าใครเป็นค่าตั้งต้น
assert.ok(flagMigration.includes('document_signatories_one_vehicle_default_idx'))
assert.ok(flagMigration.includes('WHERE is_vehicle_order_default AND is_active'))
// หัวหน้ากองติ๊กไม่ได้ กันทั้งที่ตารางและใน RPC
assert.ok(flagMigration.includes("CHECK (NOT is_vehicle_order_default OR signatory_role <> 'department_head')"))
assert.ok(flagMigration.includes("IF p_is_vehicle_order_default AND p_signatory_role = 'department_head' THEN"))
// ต้องปลดเครื่องหมายของแถวเดิมก่อน INSERT ไม่งั้นชน unique index
assert.ok(flagMigration.includes('SET is_vehicle_order_default = false'))
assert.ok(flagMigration.indexOf('SET is_vehicle_order_default = false')
  < flagMigration.indexOf('INSERT INTO public.document_signatories ('))
// v4 เป็นฟังก์ชันใหม่ ไม่แตะ v3 เพื่อให้โค้ดที่ยังไม่ deploy ใช้ตัวเดิมได้ระหว่างรอ
assert.ok(flagMigration.includes('CREATE OR REPLACE FUNCTION public.set_document_signatory_v4('))
assert.ok(!flagMigration.includes('REVOKE EXECUTE ON FUNCTION public.set_document_signatory_v3'))

const retireMigration = await readFile(
  new URL('../supabase/migrations/20260904190000_retire_vehicle_authority_role.sql', import.meta.url), 'utf8',
)
// แถวเก่าต้องถูกแปลงเป็นแถวที่สร้างเอง ไม่ใช่ลบทิ้ง — ข้อมูลที่ อปท. ตั้งไว้ต้องไม่หายเงียบ
assert.ok(retireMigration.includes("SET signatory_role = 'custom'"))
// ทริปเก่าที่ชี้บทบาทนี้ต้องถูกย้ายด้วย ไม่งั้นพิมพ์แล้ว resolve ไม่เจอ
assert.ok(retireMigration.includes('UPDATE public.fleet_trips'))
assert.ok(retireMigration.includes("signatory_role IN ('department_head', 'clerk', 'mayor', 'custom')"))
// การถอน/ถอดต้องอยู่ไฟล์ที่ apply หลัง deploy เท่านั้น
assert.ok(retireMigration.includes('REVOKE EXECUTE ON FUNCTION public.set_document_signatory_v3'))

assert.ok(settingsSource.includes("supabase.rpc('set_document_signatory_v4'"))
assert.ok(settingsSource.includes('p_is_vehicle_order_default: vehicleDefault'))
// ช่องติ๊กต้องไม่ขึ้นบนแถวหัวหน้ากอง
assert.ok(settingsSource.includes('{!slot.departmentId && ('))
// แถวสำเร็จรูปถูกถอดออกจากรายการแล้ว
assert.ok(!settingsSource.includes("role: 'vehicle_authority'"))

console.log('fleet form 3 signatory assertions passed')
