// ทะเบียนคุมยานพาหนะส่วนกลาง (เอกสารแนบท้ายคำสั่ง อปท. — เจ้าของระบบสั่งเพิ่ม 2026-10-20)
// ตรวจเนื้อหา/การจัดกลุ่ม (ไม่ต้องเปิดเบราว์เซอร์) + เลย์เอาต์ตอนพิมพ์จริง (เปิด Chrome วัดจาก DOM/PDF)
// รันด้วย: npm run test:fleet:custodian — ไม่ล็อกอิน ไม่แตะฐานข้อมูล
// ข้อมูลทดสอบเป็นชื่อสมมติทั้งหมด ไม่ใช้ชื่อเจ้าหน้าที่จริงจากต้นฉบับ
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import {
  NAME_KEEP_MM, UNASSIGNED_GROUP_KEY, buildFleetCustodianRegisterHtml, custodianChoicesForDepartment, custodianSuggestions,
  estimateTextWidthMm, groupCustodianRegister, groupTitleText, isCustodianRegisterVehicle, orgShortName, staffPosition,
} from '../src/lib/fleetCustodianRegisterPrint.js'

// ── ชื่อย่อหน่วยงานท้ายหัวกลุ่ม ────────────────────────────────────────────────────
assert.equal(orgShortName('องค์การบริหารส่วนตำบลทุ่งแค้ว'), 'อบต.ทุ่งแค้ว')
assert.equal(orgShortName('เทศบาลตำบลน้ำเลา'), 'ทต.น้ำเลา')
assert.equal(orgShortName('เทศบาลเมืองสาธิต'), 'ทม.สาธิต')
assert.equal(orgShortName('เทศบาลสาธิต'), 'เทศบาลสาธิต', 'ไม่รู้ระดับเทศบาล = ใช้ชื่อเต็ม ไม่เดาตัวย่อ')
assert.equal(orgShortName(''), '')

// ── รถที่อยู่ในทะเบียน ──────────────────────────────────────────────────────────
const central = { asset_kind: 'vehicle', regulation_category: 'central', status: 'active' }
assert.equal(isCustodianRegisterVehicle(central), true)
assert.equal(isCustodianRegisterVehicle({ ...central, regulation_category: undefined }), true, 'ไม่ระบุประเภท = ส่วนกลาง (ค่าปริยายของระบบ)')
assert.equal(isCustodianRegisterVehicle({ ...central, status: 'under_repair' }), true, 'รถกำลังซ่อมยังอยู่ในความดูแล')
assert.equal(isCustodianRegisterVehicle({ ...central, regulation_category: 'position' }), false, 'รถประจำตำแหน่งอยู่แบบ 1 ไม่ใช่ทะเบียนนี้')
assert.equal(isCustodianRegisterVehicle({ ...central, status: 'inactive' }), false, 'ปลดประจำการ')
assert.equal(isCustodianRegisterVehicle({ ...central, status: 'retired' }), false, 'ปลดระวาง')
assert.equal(isCustodianRegisterVehicle({ ...central, disposed_date: '2026-01-01' }), false, 'จำหน่ายแล้ว')
assert.equal(isCustodianRegisterVehicle({ ...central, asset_kind: 'engine' }), false, 'เครื่องยนต์/ครุภัณฑ์ไม่ใช่ยานพาหนะ')

// ── จัดกลุ่ม: ตาม sort_order ของกอง · เรียงเลขครุภัณฑ์แบบตัวเลข · ยังไม่ระบุไว้ท้ายสุด · ไม่มีรถหาย ─────
const departments = [
  { id: 'd-eng', name: 'กองช่าง', sort_order: 3 },
  { id: 'd-clerk', name: 'สำนักปลัด', sort_order: 1 },
  { id: 'd-soc', name: 'กองสวัสดิการสังคม', sort_order: 5 },
]
const v = (id, extra) => ({ id, name: `รถ ${id}`, license_plate: `กก ${id}`, asset_kind: 'vehicle', regulation_category: 'central', status: 'active', ...extra })
const sample = [
  v('c10', { asset_code: '001 49 0010', custodian_department_id: 'd-clerk' }),
  v('c2', { asset_code: '001 49 0002', custodian_department_id: 'd-clerk' }),
  v('c-nocode', { custodian_department_id: 'd-clerk' }),
  v('e1', { asset_code: '024 39 0001', custodian_department_id: 'd-eng' }),
  v('s1', { asset_code: '024 63 0003', custodian_department_id: 'd-soc' }),
  v('none', { asset_code: '999 99 0001' }),
  v('orphan', { asset_code: '999 99 0002', custodian_department_id: 'd-from-another-municipality' }),
  v('pos', { regulation_category: 'position', custodian_department_id: 'd-clerk' }),
  v('gone', { status: 'retired', custodian_department_id: 'd-clerk' }),
]
const groups = groupCustodianRegister(sample, departments)
assert.deepEqual(groups.map(group => group.key), ['d-clerk', 'd-eng', 'd-soc', UNASSIGNED_GROUP_KEY],
  'กลุ่มต้องเรียงตาม sort_order ของกอง และกลุ่มยังไม่ระบุอยู่ท้ายสุด')
assert.deepEqual(groups[0].vehicles.map(x => x.id), ['c2', 'c10', 'c-nocode'],
  'เรียงเลขครุภัณฑ์แบบตัวเลข (0002 ก่อน 0010) คันที่ไม่มีเลขไว้ท้ายกลุ่ม')
assert.deepEqual(groups[3].vehicles.map(x => x.id), ['none', 'orphan'],
  'รถที่ไม่ระบุกอง และรถที่ id กองไม่อยู่ในรายชื่อกองของ อปท. นี้ ต้องตกกลุ่มยังไม่ระบุ ไม่หายจากทะเบียน')
const inRegister = sample.filter(isCustodianRegisterVehicle).length
assert.equal(groups.reduce((sum, group) => sum + group.vehicles.length, 0), inRegister, 'ทุกคันที่อยู่ในทะเบียนต้องมีแถว')
assert.deepEqual(groupCustodianRegister([], departments), [], 'ไม่มีรถ = ไม่มีกลุ่ม')

// ── autocomplete ผู้รับผิดชอบ: ชื่อซ้ำใช้ตำแหน่งแรกที่ไม่ว่าง ──────────────────────────
assert.deepEqual(custodianSuggestions([
  { custodian_name: ' นายสมชาย  ใจดี ', custodian_position: '' },
  { custodian_name: 'นายสมชาย ใจดี', custodian_position: 'พนักงานขับรถยนต์' },
  { custodian_name: 'นายสมชาย ใจดี', custodian_position: 'ตำแหน่งอื่น' },
  { custodian_name: '', custodian_position: 'ไม่มีชื่อ' },
  { custodian_name: null },
]), [{ name: 'นายสมชาย ใจดี', position: 'พนักงานขับรถยนต์' }])

// ── ชื่อผู้รับผิดชอบเลือกจากเจ้าหน้าที่ของหน่วยงาน + ตำแหน่งตามชื่อ (เจ้าของระบบสั่ง 2026-10-22) ──
// ข้อมูลทดสอบสมมติทั้งหมด
// ตำแหน่ง: job_title ก่อน แล้วตกไปตาราง positions (ลำดับเดียวกับแบบ 3) — ข้อมูลจริงมีแต่ positions เป็นหลัก
assert.equal(staffPosition({ job_title: ' ช่างโยธา ', position: { name: 'ผู้ช่วยนายช่างโยธา' } }), 'ช่างโยธา')
assert.equal(staffPosition({ job_title: '', position: { name: 'ผู้ช่วยนายช่างโยธา' } }), 'ผู้ช่วยนายช่างโยธา')
assert.equal(staffPosition({ job_title: null, position: null }), '')
assert.equal(staffPosition(undefined), '')
const people = [
  { id: '1', full_name: 'นายสมหมาย รักดี', role: 'staff', department_id: 'd-eng', job_title: null, position: { name: 'ผู้ช่วยนายช่างโยธา' } },
  { id: '2', full_name: 'นางสาวใจดี มีสุข', role: 'officer', department_id: 'd-eng', job_title: 'นายช่างโยธาชำนาญงาน', position: { name: 'อื่น' } },
  { id: '3', full_name: 'นายสมชาย ใจดี', role: 'staff', department_id: 'd-clerk', position: { name: 'พนักงานขับรถยนต์' } },
  { id: '4', full_name: 'นายประชาชน ทดสอบ', role: 'citizen', department_id: 'd-eng', position: null },
  { id: '5', full_name: '   ', role: 'staff', department_id: 'd-eng', position: { name: 'ไม่มีชื่อ' } },
  { id: '6', full_name: 'นายไม่มีตำแหน่ง ทดสอบ', role: 'staff', department_id: 'd-eng', job_title: '', position: null },
  { id: '7', full_name: 'นายสมหมาย รักดี', role: 'staff', department_id: 'd-eng', position: { name: 'ซ้ำชื่อ' } },
]
const driverVehicles = [
  { custodian_department_id: 'd-eng', custodian_name: 'นายพนักงาน ขับรถ', custodian_position: 'พนักงานขับรถยนต์' },
  { custodian_department_id: 'd-eng', custodian_name: 'นายไม่มีตำแหน่ง ทดสอบ', custodian_position: 'ช่างไฟฟ้า' },
  { custodian_department_id: 'd-clerk', custodian_name: 'นายคนอื่นกอง ทดสอบ', custodian_position: 'ไม่ควรโผล่ในกองช่าง' },
  { custodian_department_id: 'd-eng', custodian_name: '', custodian_position: 'ไม่มีชื่อ' },
]
const engChoices = custodianChoicesForDepartment({ staff: people, vehicles: driverVehicles, departmentId: 'd-eng' })
assert.deepEqual(engChoices.staff.map(c => c.name), ['นางสาวใจดี มีสุข', 'นายไม่มีตำแหน่ง ทดสอบ', 'นายสมหมาย รักดี'],
  'เจ้าหน้าที่ของกองช่างเท่านั้น: ไม่มีคนกองอื่น/ประชาชน/ชื่อว่าง และชื่อซ้ำเหลือคนเดียว เรียงตามชื่อ')
assert.equal(engChoices.staff.find(c => c.name === 'นางสาวใจดี มีสุข').position, 'นายช่างโยธาชำนาญงาน', 'ตำแหน่งตามชื่อที่เลือก (job_title ก่อน)')
assert.equal(engChoices.staff.find(c => c.name === 'นายสมหมาย รักดี').position, 'ผู้ช่วยนายช่างโยธา', 'ตกไปตำแหน่งจากตาราง positions')
assert.equal(engChoices.staff.find(c => c.name === 'นายไม่มีตำแหน่ง ทดสอบ').position, 'ช่างไฟฟ้า',
  'ตำแหน่งในโปรไฟล์ว่าง ยืมจากที่เคยกรอกเป็นผู้รับผิดชอบรถคันอื่น')
assert.deepEqual(engChoices.recent, [{ name: 'นายพนักงาน ขับรถ', position: 'พนักงานขับรถยนต์' }],
  'คนที่เคยกรอกแต่ไม่มีบัญชี (เช่น พนักงานขับรถ) อยู่กลุ่ม recent เฉพาะกองเดียวกัน และไม่ซ้ำกับคนในระบบ')
assert.equal([...engChoices.staff, ...engChoices.recent].some(c => c.name.includes('ประชาชน')), false, 'ประชาชนห้ามเข้ารายการ')
assert.equal([...engChoices.staff, ...engChoices.recent].some(c => c.name.includes('คนอื่นกอง')), false, 'คนกองอื่นห้ามโผล่')
// ประชาชนต้องไม่เข้ารายการ แม้ถูกตั้งกองมาโดยผิดพลาด (role = citizen) — ข้อมูลทดสอบข้อ 4 ตั้งกองช่างไว้เพื่อพิสูจน์ข้อนี้
const clerkChoices = custodianChoicesForDepartment({ staff: people, vehicles: driverVehicles, departmentId: 'd-clerk' })
assert.deepEqual(clerkChoices.staff, [{ name: 'นายสมชาย ใจดี', position: 'พนักงานขับรถยนต์' }])
assert.deepEqual(clerkChoices.recent.map(c => c.name), ['นายคนอื่นกอง ทดสอบ'])
// ยังไม่เลือกหน่วยงาน/ไม่มีข้อมูล = รายการว่าง ฟอร์มกลับไปพิมพ์ชื่อเองเหมือนเดิม ไม่พัง
assert.deepEqual(custodianChoicesForDepartment({ staff: people, vehicles: driverVehicles, departmentId: '' }), { staff: [], recent: [] })
assert.deepEqual(custodianChoicesForDepartment({ departmentId: 'd-eng' }), { staff: [], recent: [] })
assert.deepEqual(custodianChoicesForDepartment(undefined), { staff: [], recent: [] })
// ตัวฟอร์ม: โหลดเฉพาะผู้ดูแล, กรองประชาชนใน query, เลือกชื่อแล้วตำแหน่งตามชื่อ, เลือกหน่วยงานใหม่ล้างชื่อที่เลือกจากรายการเดิม
const picker = readFileSync('src/components/fleet/FleetVehicles.jsx', 'utf8')
assert.ok(/from\('profiles'\)\.select\('id,full_name,role,department_id,job_title,position:positions\(name\)'\)/.test(picker),
  'ต้องดึงโปรไฟล์พร้อมกอง/ตำแหน่ง (job_title + positions)')
assert.ok(picker.includes(".neq('role', 'citizen')") && picker.includes(".not('department_id', 'is', null)"),
  'query ต้องตัดประชาชนและคนที่ไม่มีกอง')
assert.ok(picker.includes('if (!tenant?.id || !isAdmin) return'), 'โหลดรายชื่อเฉพาะผู้ดูแล (คนที่แก้ฟอร์มได้)')
assert.ok(picker.includes('custodian_position: choice?.position ??'), 'เลือกชื่อแล้วตำแหน่งต้องขึ้นตามชื่อที่เลือก')
assert.ok(picker.includes('onChange={setCustodianDepartment}') && picker.includes('onChange={pickCustodian}'), 'ช่องหน่วยงานและช่องชื่อต้องต่อกับตัวจัดการใหม่')
assert.ok(picker.includes('อื่นๆ (พิมพ์ชื่อเอง)'), 'ต้องมีทางเลือกพิมพ์ชื่อเอง (ผู้ได้รับมอบหมายไม่จำเป็นต้องมีบัญชี)')

// ── หัวกลุ่มตรงต้นฉบับ: "ในครอบครองของ…" + "หัวหน้าหน่วยงานผู้ครอบครองยานพาหนะส่วนกลางได้แก่ …" ──
assert.equal(
  groupTitleText({ department: { name: 'สำนักปลัด' }, orgName: 'องค์การบริหารส่วนตำบลทุ่งแค้ว' }),
  'ยานพาหนะส่วนกลาง ที่อยู่ในครอบครองของสำนักปลัด อบต.ทุ่งแค้ว (หัวหน้าหน่วยงานผู้ครอบครองยานพาหนะส่วนกลางได้แก่ หัวหน้าสำนักปลัด)')
assert.ok(groupTitleText({ department: { name: 'กองช่าง' }, orgName: 'องค์การบริหารส่วนตำบลทุ่งแค้ว' })
  .endsWith('ได้แก่ ผู้อำนวยการกองช่าง)'))
assert.equal(groupTitleText({ department: null, orgName: 'อบต.' }), 'ยานพาหนะส่วนกลาง ที่ยังไม่ได้ระบุหน่วยงานผู้ครอบครอง')

// ── ชื่อรถอยู่บรรทัดเดียว ไม่แยกคำ (เจ้าของระบบสั่ง 2026-10-20 จากใบน้ำเลาจริง) ───────────────
// "รถยนต์นั่งส่วนบุคคลไม่เกิน 7 คน" เคยตกบรรทัด "…ไม่เกิน 7 / คน" เพราะช่องชื่อรถกว้างแค่ 22%
const OWNER_NAME = 'รถยนต์นั่งส่วนบุคคลไม่เกิน 7 คน'
assert.ok(estimateTextWidthMm(OWNER_NAME) <= NAME_KEEP_MM, 'ชื่อรถจากใบจริงต้องเข้าเกณฑ์ไม่ตัดบรรทัด')
assert.equal(estimateTextWidthMm('รถยนต์'), estimateTextWidthMm('รถยนต์๎'), 'วรรณยุกต์/สระบนล่างไม่กินที่')
assert.ok(estimateTextWidthMm('Mitsubishi Triton Double Cab 4x4 Hi-Rider') > NAME_KEEP_MM,
  'ชื่ออังกฤษยาว (กว้างกว่าไทยต่อตัว) ต้องไม่ถูกบังคับบรรทัดเดียวจนล้นช่อง')
assert.equal(estimateTextWidthMm(''), 0)

// ── HTML: หัวตารางตามต้นฉบับ + escape + ลำดับเริ่ม 1 ใหม่ทุกกลุ่ม + เส้นประเลขคำสั่ง ──────────
const tenant = { name: 'องค์การบริหารส่วนตำบลทุ่งแค้ว', district: 'อำเภอหนองม่วงไข่', province: 'แพร่' }
const named = [
  v('a1', { name: '<b>รถบรรทุก (ดีเซล)</b>', asset_code: '001 49 0001', custodian_department_id: 'd-clerk',
    custodian_name: 'นายสมชาย ใจดี', custodian_position: 'พนักงานขับรถยนต์' }),
  v('a2', { name: 'รถบรรทุกขยะ', asset_code: '011 66 0002', custodian_department_id: 'd-clerk', custodian_name: 'นายสมชาย ใจดี' }),
  v('b1', { name: 'รถจักรยานยนต์', asset_code: '024 39 0001', custodian_department_id: 'd-eng' }),
]
const html = buildFleetCustodianRegisterHtml({ vehicles: named, departments, tenant, asOf: '2026-10-20' })
for (const text of ['ทะเบียนคุมยานพาหนะส่วนกลาง',
  'องค์การบริหารส่วนตำบลทุ่งแค้ว อำเภอหนองม่วงไข่ จังหวัดแพร่', 'ข้อมูล ณ วันที่ 20/10/2569', 'A4 landscape',
  'ที่อยู่ในครอบครองของ<span class="keep">สำนักปลัด</span> <span class="keep">อบต.ทุ่งแค้ว</span>',
  'ได้แก่ <span class="keep">หัวหน้าสำนักปลัด</span>)', 'ได้แก่ <span class="keep">ผู้อำนวยการกองช่าง</span>)',
  '<span class="keep">นายสมชาย ใจดี</span> <span class="keep">ตำแหน่ง พนักงานขับรถยนต์</span>',
  '<td class="left"><span class="keep">รถบรรทุกขยะ</span></td>']) {
  assert.ok(html.includes(text), `ทะเบียนต้องมี "${text}"`)
}
assert.ok(html.includes('&lt;b&gt;รถบรรทุก') && !html.includes('<b>รถบรรทุก'), 'ข้อความจากผู้ใช้ต้อง escape')
const registerStart = html.indexOf('<table class="register">')
const thead = html.slice(html.indexOf('<thead>', registerStart), html.indexOf('</thead>', registerStart))
const order = ['ลำดับ', 'หมายเลขพัสดุ', 'ประเภทรถ', 'เลขทะเบียนรถ', 'ผู้รับผิดชอบควบคุม/ดูแลยานพาหนะส่วนกลาง'].map(text => thead.indexOf(text))
assert.ok(order.every(index => index >= 0), 'หัวตารางไม่ครบตามต้นฉบับ')
assert.deepEqual([...order].sort((a, b) => a - b), order, 'ลำดับคอลัมน์ต้องตรงต้นฉบับ')
// ลำดับเริ่ม 1 ใหม่ทุกกลุ่ม (สำนักปลัด 2 คัน → 1,2 · กองช่าง 1 คัน → 1)
const numbers = [...html.matchAll(/<tr class="vehicle">\s*<td>(\d+)<\/td>/g)].map(match => Number(match[1]))
assert.deepEqual(numbers, [1, 2, 1])
// ตัวใบไม่อ้างเลขข้อของระเบียบ (ที่มาทางระเบียบของเอกสารนี้ยังไม่ยืนยัน)
assert.equal(/ข้อ\s*[0-9๐-๙]/.test(html), false, 'ห้ามอ้างเลขข้อของระเบียบบนใบนี้')
// เจ้าของระบบสั่งเอาบรรทัด "เอกสารแนบท้ายคำสั่ง… ที่ … ลงวันที่ …" ออกก่อน (2026-10-20) — หัวใบเริ่มที่ชื่อทะเบียนเลย
assert.equal(html.includes('เอกสารแนบท้ายคำสั่ง') || html.includes('ลงวันที่') || html.includes('class="fill"'), false,
  'บรรทัดเลขที่/ลงวันที่ของคำสั่งต้องไม่อยู่บนใบ (เจ้าของระบบสั่งเอาออก)')
assert.ok(html.indexOf('<h1>') > 0 && html.indexOf('<h1>') < html.indexOf('<p class="place">') && html.indexOf('<p class="place">') < html.indexOf('<table class="register">'),
  'หัวใบต้องเป็นชื่อทะเบียน แล้วชื่อหน่วยงาน แล้วตาราง')
// หัวกลุ่มห้ามค้างท้ายหน้า + หัวตารางซ้ำทุกหน้า + ไม่ตัดแถวกลางคัน
assert.ok(/tr\.group\s*\{[^}]*break-after:\s*avoid/.test(html), 'หัวกลุ่มต้องไม่ค้างท้ายหน้า')
assert.ok(html.includes('thead { display: table-header-group; }') && /tr\s*\{[^}]*break-inside:\s*avoid/.test(html))
// ขอบบน/ล่างต้องซ้ำทุกหน้า (เดิม padding อยู่แค่หน้าแรก หน้า 2 หัวตารางชิดขอบกระดาษตรงรูเจาะแฟ้ม)
assert.ok(/<thead><tr><td class="space-top"><\/td><\/tr><\/thead>\s*<tfoot><tr><td class="space-bottom"><\/td><\/tr><\/tfoot>/.test(html),
  'ต้องมีแถวเว้นระยะบน/ล่างใน thead/tfoot ของตารางห่อนอก เพื่อให้ทุกหน้ามีขอบ')
assert.ok(html.includes('td.space-top { height: 3cm; }') && html.includes('td.space-bottom { height: 1cm; }'),
  'ขอบบน/ล่างต้องเป็นค่าแนวนอนตามมาตรฐาน govPagePadding (3cm / 1cm)')
// ไม่มีรถ → แถว "ไม่มี" ไม่ใช่ตารางเปล่า
assert.ok(buildFleetCustodianRegisterHtml({ vehicles: [], departments, tenant }).includes('— ไม่มียานพาหนะส่วนกลาง —'))

// ── หน้าจอ/ฐานข้อมูลต้องส่งครบทุกช่องที่ใบพิมพ์ใช้ ────────────────────────────────────
const report = readFileSync('src/components/fleet/FleetReport.jsx', 'utf8')
assert.ok(report.includes('printCustodianRegister') && report.includes('buildFleetCustodianRegisterHtml'), 'แท็บรายงานต้องมีปุ่มพิมพ์ทะเบียนคุม')
for (const column of ['asset_code', 'license_plate', 'status', 'regulation_category', 'disposed_date', 'custodian_department_id',
  'custodian_name', 'custodian_position']) {
  assert.ok(report.includes(column), `FleetReport ต้องดึง ${column} ไปพิมพ์ทะเบียนคุม`)
}
const custodianQuery = report.slice(report.indexOf('async function printCustodianRegister'), report.indexOf('async function openMemoDialog'))
assert.equal(custodianQuery.includes('departments('), false,
  'ห้ามฝัง departments(...) ใน fleet_vehicles — หน่วยงานผู้ครอบครองไม่มี FK ต้องดึงรายชื่อกองแยก')
assert.ok(custodianQuery.includes(".from('departments')"), 'ต้องดึงรายชื่อกองแยกเพื่อจับคู่ id')
const vehiclesForm = readFileSync('src/components/fleet/FleetVehicles.jsx', 'utf8')
for (const column of ['custodian_department_id', 'custodian_name', 'custodian_position']) {
  assert.ok(new RegExp(`value=\\{form\\.${column}\\}`).test(vehiclesForm), `ฟอร์มรถต้องมีช่องกรอก ${column}`)
  assert.ok(new RegExp(`${column}:\\s*form\\.${column}[^\\n]*\\|\\| null`).test(vehiclesForm), `${column} ที่ว่างต้องบันทึกเป็น null ไม่ใช่สตริงว่าง`)
  assert.ok(vehiclesForm.includes(`${column}: v.${column}`), `${column} ต้องอยู่ใน audit snapshot`)
}
const migration = readFileSync('supabase/migrations/20261020180000_fleet_vehicle_custodian.sql', 'utf8')
const migrationSql = migration.split('\n').filter(line => !line.trim().startsWith('--')).join('\n')
assert.ok(/ADD COLUMN IF NOT EXISTS custodian_department_id uuid,/.test(migrationSql), 'ต้องเป็น uuid ไม่บังคับ')
assert.equal(/custodian_department_id[^,;]*(REFERENCES|NOT NULL)/i.test(migrationSql), false,
  'ห้ามมี FK/NOT NULL — FK ที่สองไป departments ทำให้ PostgREST ตอบ PGRST201 กับคำขอที่ฝัง departments(...) ทั้งระบบ')
assert.equal(/FOREIGN KEY/i.test(migrationSql), false)

// ── เลย์เอาต์ตอนพิมพ์จริง (A4 แนวนอน 14pt) ───────────────────────────────────────
const MM = 96 / 25.4
const pdfPageCount = buffer => (buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
const longPerson = { custodian_name: 'นายวีระวัฒน์ วังแก้ว', custodian_position: 'นักป้องกันและบรรเทาสาธารณภัยชำนาญการ' }
const worst = (count, prefix) => Array.from({ length: count }, (_, i) => v(`${prefix}${i}`, {
  name: 'รถบรรทุกน้ำอเนกประสงค์ ขนาดใหญ่', license_plate: 'กลพ 7870 แพร่', asset_code: `001-52-${String(i + 1).padStart(4, '0')}`,
  custodian_department_id: prefix, ...longPerson,
}))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const open = async (vehicles) => {
    const page = await browser.newPage({ viewport: { width: Math.round(297 * MM), height: Math.round(210 * MM) } })
    await page.setContent(buildFleetCustodianRegisterHtml({
      vehicles, departments: [{ id: 'd-clerk', name: 'สำนักปลัด', sort_order: 1 }, { id: 'd-soc', name: 'กองสวัสดิการสังคม', sort_order: 2 }],
      tenant, asOf: '2026-10-20',
    }), { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    await page.emulateMedia({ media: 'print' })
    await page.waitForTimeout(300)
    return page
  }

  // ค่ายาวสุดที่เป็นไปได้ต่อช่อง (ทุกคันชื่อยาว + ตำแหน่งยาวสุดในต้นฉบับ 38 ตัวอักษร) — วัดว่าไม่ล้นช่อง/เส้นตาราง
  // ชื่อ + "ตำแหน่ง …" ยาวสุดกว้างกว่าช่อง (~134 มม. ที่ 14pt) จึงตัดเป็น 2 บรรทัดระหว่างชื่อกับตำแหน่ง ซึ่งยอมรับได้
  // แต่ต้องไม่เกิน 2 บรรทัดและไม่ล้นเส้นขวา
  const worstPage = await open([
    ...worst(5, 'd-clerk').map(x => ({ ...x, custodian_department_id: 'd-clerk' })),
    ...worst(3, 'd-soc').map(x => ({ ...x, custodian_department_id: 'd-soc' })),
    v('plain', { asset_code: '024 63 0003', name: 'รถจักรยานยนต์ Honda Wave 125i', custodian_department_id: 'd-soc' }),
    // เลขครุภัณฑ์/ทะเบียนยาวผิดปกติ (ข้อมูลทดสอบจริงบนสนามซ้อมมีเลข 25 ตัวอักษร) ต้องตัดบรรทัด ไม่ล้นทับช่องข้างๆ
    v('longcode', { asset_code: 'TEST-ASSET-20260830051222', license_plate: 'TEST 20260830051222 แพร่', custodian_department_id: 'd-soc' }),
    // ชื่อรถจากใบจริง (บรรทัดเดียว) + ชื่ออังกฤษยาว (ตัดบรรทัดได้ แต่ห้ามล้นทับช่องข้างๆ)
    v('ownername', { name: OWNER_NAME, asset_code: '001-66-003', license_plate: 'กธ 3393 แพร่', custodian_department_id: 'd-soc' }),
    v('longname', { name: 'Mitsubishi Triton Double Cab 4x4 Hi-Rider Plus', custodian_department_id: 'd-soc' }),
  ])
  try {
    const measured = await worstPage.evaluate(() => {
      const mm = 96 / 25.4
      const lineCount = cell => {
        const range = document.createRange()
        range.selectNodeContents(cell)
        return new Set([...range.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.top))).size
      }
      const rows = [...document.querySelectorAll('tr.vehicle')]
      const col = index => rows.map(row => row.children[index])
      return {
        tableWidth: document.querySelector('table.register').getBoundingClientRect().width / mm,
        overflowingHeaders: [...document.querySelectorAll('th')].filter(th => th.scrollWidth > th.clientWidth + 1).map(th => th.textContent.trim()),
        headerLines: Math.max(...[...document.querySelectorAll('th')].map(lineCount)),
        // ข้อมูลปกติ (เลขครุภัณฑ์ ≤13 ตัว ทะเบียน ≤14 ตัว) ต้องจบบรรทัดเดียว — แถวทดสอบข้อมูลยาวผิดปกติยกเว้น
        codeLines: Math.max(...col(1).filter(td => td.textContent.trim().length <= 13).map(lineCount)),
        plateLines: Math.max(...col(3).filter(td => td.textContent.trim().length <= 14).map(lineCount)),
        cellOverflow: [...document.querySelectorAll('table.register td')].filter(td => td.scrollWidth > td.clientWidth + 1).length,
        personLines: Math.max(...col(4).map(lineCount)),
        keepOverflow: rows.flatMap(row => [...row.querySelectorAll('.keep')]
          .filter(span => span.getBoundingClientRect().right > span.closest('td').getBoundingClientRect().right - 1)).length,
        // ช่องชื่อรถที่ห่อ .keep (ชื่อเข้าเกณฑ์) ต้องจบบรรทัดเดียวทุกช่อง
        keepNameLines: Math.max(...col(2).filter(td => td.querySelector('.keep')).map(lineCount)),
        keepNameCells: col(2).filter(td => td.querySelector('.keep')).length,
        ownerNameLines: lineCount(col(2).find(td => td.textContent.trim() === 'รถยนต์นั่งส่วนบุคคลไม่เกิน 7 คน')),
        groupRows: document.querySelectorAll('tr.group').length,
        vehicleRows: rows.length,
        titleSplit: [...document.querySelectorAll('tr.group .keep')].filter(span => {
          const range = document.createRange()
          range.selectNodeContents(span)
          return new Set([...range.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.top))).size > 1
        }).length,
      }
    })
    assert.ok(measured.tableWidth <= 257.5, `ตารางกว้างเกินพื้นที่พิมพ์: ${measured.tableWidth.toFixed(1)} มม.`)
    assert.deepEqual(measured.overflowingHeaders, [], 'หัวตารางล้นเส้นตาราง')
    assert.ok(measured.headerLines <= 2, `หัวตารางสูงเกิน 2 บรรทัด (${measured.headerLines})`)
    assert.equal(measured.codeLines, 1, 'เลขครุภัณฑ์ต้องจบบรรทัดเดียว')
    assert.equal(measured.plateLines, 1, 'ทะเบียนต้องจบบรรทัดเดียว')
    assert.ok(measured.personLines <= 2, `ชื่อ + ตำแหน่งยาวสุดควรไม่เกิน 2 บรรทัด (${measured.personLines})`)
    assert.equal(measured.keepOverflow, 0, 'ชื่อ/ตำแหน่ง/เลขล้นเส้นขวาของช่อง')
    assert.equal(measured.cellOverflow, 0, 'ข้อมูลยาวผิดปกติต้องตัดบรรทัด ไม่ล้นทับช่องข้างๆ')
    assert.equal(measured.groupRows, 2)
    assert.equal(measured.titleSplit, 0, 'ชื่อหน่วยงาน/ตำแหน่งหัวหน้าในหัวกลุ่มห้ามถูกตัดกลางคำ')
    assert.equal(measured.vehicleRows, 12)
    assert.ok(measured.keepNameCells >= 1, 'ต้องมีช่องชื่อรถที่บังคับบรรทัดเดียวอย่างน้อย 1 ช่อง (กันเทสต์ผ่านเพราะไม่มีอะไรให้วัด)')
    assert.equal(measured.keepNameLines, 1, 'ชื่อรถที่เข้าเกณฑ์ต้องจบบรรทัดเดียว')
    assert.equal(measured.ownerNameLines, 1, `"${OWNER_NAME}" ต้องอยู่บรรทัดเดียว ไม่แยก "คน" ลงบรรทัดถัดไป`)
    console.log(`fleet custodian register assertions passed (ตาราง ${measured.tableWidth.toFixed(1)} มม., ชื่อ+ตำแหน่งสูงสุด ${measured.personLines} บรรทัด)`)
  } finally {
    await worstPage.close()
  }

  // ค่าประมาณความกว้างต้อง "ไม่ต่ำกว่า" ความกว้างจริงของเบราว์เซอร์ — ประมาณต่ำไป = ชื่อที่ว่าเข้าเกณฑ์ล้นช่องจริง
  const calibration = await open([])
  try {
    const samples = [OWNER_NAME, 'รถยนต์นั่งส่วนบุคคล', 'รถบรรทุกน้ำอเนกประสงค์', 'รถยนต์บรรทุกส่วนกลางขนาดใหญ่พิเศษ 6 ล้อ',
      'รถจักรยานยนต์ Honda Wave 125i', 'Mitsubishi Triton Double Cab', 'TOYOTA HILUX REVO 2.4 4WD', 'รถกระเช้าไฟฟ้า 81-7417', 'ผู้ช่วยนายช่างโยธา']
    const widths = await calibration.evaluate(list => list.map(text => {
      const span = document.createElement('span')
      span.style.cssText = 'white-space:nowrap;position:absolute'
      span.textContent = text
      document.querySelector('.place').appendChild(span)
      const width = span.getBoundingClientRect().width / (96 / 25.4)
      span.remove()
      return width
    }), samples)
    samples.forEach((text, index) => {
      assert.ok(estimateTextWidthMm(text) >= widths[index],
        `ค่าประมาณ ${estimateTextWidthMm(text).toFixed(1)} มม. ต่ำกว่าความกว้างจริง ${widths[index].toFixed(1)} มม. ของ "${text}"`)
    })
    // ชื่อที่เข้าเกณฑ์ต้องพอดีช่อง (กว้างเนื้อหาช่องชื่อรถ ~ 27% ของ 257 มม. หักขอบ)
    const available = await calibration.evaluate(() => {
      const col = document.querySelector('col.c-name')
      return col ? col.getBoundingClientRect().width / (96 / 25.4) : 0
    })
    assert.ok(NAME_KEEP_MM <= available - 1.6, `NAME_KEEP_MM ${NAME_KEEP_MM} มม. มากกว่าความกว้างเนื้อหาของช่องชื่อรถ ${(available - 1.6).toFixed(1)} มม.`)
  } finally {
    await calibration.close()
  }

  // ขนาดและข้อมูลแบบต้นฉบับ (9 คัน 3 กลุ่ม ตำแหน่งส่วนใหญ่สั้น มีตำแหน่งยาว 1 คัน) ต้องจบ 1 แผ่น
  const person = (name, position) => ({ custodian_name: name, custodian_position: position })
  const original = await open([
    v('o1', { name: 'รถยนต์บรรทุก (ดีเซล)', asset_code: '001 49 0001', license_plate: 'กค 3307 แพร่', custodian_department_id: 'd-clerk', ...person('นายสมชาย ใจดี', 'พนักงานขับรถยนต์') }),
    v('o2', { name: 'รถบรรทุก (ดีเซล)', asset_code: '001 66 0002', license_plate: 'กธ 738 แพร่', custodian_department_id: 'd-clerk', ...person('นายสมชาย ใจดี', 'พนักงานขับรถยนต์') }),
    v('o3', { name: 'รถบรรทุกน้ำอเนกประสงค์', asset_code: '003 58 0001', license_plate: 'บพ 5534 แพร่', custodian_department_id: 'd-clerk', ...longPerson }),
    v('o4', { name: 'รถบรรทุกขยะมูลฝอย', asset_code: '011 47 0001', license_plate: 'บพ 7985 แพร่', custodian_department_id: 'd-clerk', ...person('นายสมชาย ใจดี', 'พนักงานขับรถยนต์') }),
    v('o5', { name: 'รถบรรทุกขยะ', asset_code: '011 66 0002', license_plate: '81-8381', custodian_department_id: 'd-clerk', ...person('นายสมชาย ใจดี', 'พนักงานขับรถยนต์') }),
    v('o6', { name: 'รถจักรยานยนต์ ฮอนด้า', asset_code: '024 39 0001', license_plate: 'กรต 856 แพร่', custodian_department_id: 'd-soc', ...person('นายสมหมาย รักดี', 'ผู้ช่วยนายช่างโยธา') }),
    v('o7', { name: 'รถจักรยานยนต์ Honda Wave', asset_code: '024 58 0002', license_plate: '1กค 9040 แพร่', custodian_department_id: 'd-soc', ...person('นายสมหมาย รักดี', 'ผู้ช่วยนายช่างโยธา') }),
    v('o8', { name: 'รถจักรยานยนต์ Honda Wave 110i', asset_code: '024 64 0004', license_plate: '1กฎ 5411 แพร่', custodian_department_id: 'd-soc', ...person('นายสมหมาย รักดี', 'ผู้ช่วยนายช่างโยธา') }),
    v('o9', { name: 'รถจักรยานยนต์ Honda Wave 125i', asset_code: '024 63 0003', license_plate: '1กญ 1029 แพร่', custodian_department_id: 'd-soc', ...person('นางสมศรี ขยันงาน', 'นักพัฒนาชุมชนชำนาญการ') }),
  ])
  try {
    const pdf = await original.pdf({ preferCSSPageSize: true, printBackground: true })
    assert.equal(pdfPageCount(pdf), 1, `ทะเบียนขนาดต้นฉบับ (9 คัน) ต้องจบ 1 แผ่น แต่ได้ ${pdfPageCount(pdf)}`)
  } finally {
    await original.close()
  }

  // ทะเบียนยาวต้องไหลข้ามหน้า (หัวตารางซ้ำ) และแถวไม่หาย
  const long = await open([
    ...worst(18, 'd-clerk').map(x => ({ ...x, custodian_department_id: 'd-clerk' })),
    ...worst(12, 'd-soc').map(x => ({ ...x, custodian_department_id: 'd-soc' })),
  ])
  try {
    const pdf = await long.pdf({ preferCSSPageSize: true, printBackground: true })
    assert.ok(pdfPageCount(pdf) >= 2, 'ทะเบียน 30 คันต้องไหลไปหน้าถัดไป')
    assert.equal(await long.locator('tr.vehicle').count(), 30, 'ไหลข้ามหน้าแล้วแถวต้องไม่หาย')
  } finally {
    await long.close()
  }
} finally {
  await browser.close()
}
