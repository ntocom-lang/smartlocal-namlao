// เมนู "การลงนามเอกสาร" (รวม ผู้ลงนามเอกสาร + ลงนามออนไลน์) + เสนอผู้ลงนามจากการแต่งตั้ง — เจ้าของระบบอนุมัติ 2569-10-30
// npm run test:signing-menu
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import {
  appointedSignatorySlots, appointmentSuggestion, buildSignatorySlots, isActingSignatory, newlyAppointedSlots, personSigningRows, signatoryChangeFor,
  signatorySlotKey, signatorySlotLabel, signatorySuggestionState, SUGGESTABLE_KINDS,
} from '../src/lib/documentSignatories.js'
import {
  canClearDepartmentHead, canOfferOfficerRole, defaultDepartmentHead, defaultHeadPositionName, departmentFromPositionName, isDepartmentHeadPosition,
  isExecutivePosition, positionSearchKey, positionTraitsFromName, prettyPositionName, proposedDepartmentName, proposedRoleForAppointment, recommendedRoleForPosition,
} from '../src/lib/personnelStructure.js'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
let passed = 0
const check = async (name, fn) => {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

const person = (id, extra = {}) => ({ id, full_name: `[TEST] ${id}`, department_id: null, is_dept_head: false, position: null, ...extra })
const MAYOR = person('mayor', { position: { name: 'นายกเทศมนตรีตำบลทดสอบ' } })
const DEPUTY_MAYOR = person('deputy', { position: { name: 'รองนายกเทศมนตรี' } })
const CLERK = person('clerk', { position: { name: 'ปลัดเทศบาล / ปลัดองค์การบริหารส่วนตำบล' } })
const DEPUTY_CLERK = person('deputy-clerk', { position: { name: 'รองปลัดเทศบาล' } })
const FIN_HEAD = person('fin-head', { department_id: 'finance', is_dept_head: true, position: { name: 'ผู้อำนวยการกองคลัง' } })
const FIN_STAFF = person('fin-staff', { department_id: 'finance', position: { name: 'นักวิชาการเงินและบัญชี' } })
const people = [MAYOR, DEPUTY_MAYOR, CLERK, DEPUTY_CLERK, FIN_HEAD, FIN_STAFF]

await check('กฎการแต่งตั้ง: นายก/ปลัดดูคำขึ้นต้นของตำแหน่ง · กองดูตำแหน่งหัวหน้าหน่วยงาน ไม่ดูติ๊ก · รอง/ผู้ช่วยไม่นับ', () => {
  assert.deepEqual(appointedSignatorySlots(MAYOR), [{ role: 'mayor', departmentId: null }])
  assert.deepEqual(appointedSignatorySlots(CLERK), [{ role: 'clerk', departmentId: null }])
  assert.deepEqual(appointedSignatorySlots(FIN_HEAD), [{ role: 'department_head', departmentId: 'finance' }])
  for (const other of [DEPUTY_MAYOR, DEPUTY_CLERK, FIN_STAFF, person('x'), null]) {
    assert.deepEqual(appointedSignatorySlots(other), [], `${other?.id} ต้องไม่ถูกเสนอเป็นผู้ลงนาม`)
  }
  assert.deepEqual(appointedSignatorySlots(person('pm', { position: { name: 'นายกรัฐมนตรี' } })), [], 'นายกรัฐมนตรีไม่ใช่นายก อปท.')
  assert.deepEqual(appointedSignatorySlots({ id: 'u', position_name: ' ปลัดองค์การบริหารส่วนตำบลทุ่งแค้ว' }),
    [{ role: 'clerk', departmentId: null }], 'ผู้ใช้จาก get_users_with_email มี position_name แทน position.name')
  assert.deepEqual(appointedSignatorySlots(person('h', { is_dept_head: true, position: { name: 'ผู้อำนวยการกองคลัง' } })), [], 'ถือตำแหน่งหัวหน้าแต่ไม่มีกอง = ไม่รู้ว่าช่องไหน')
  assert.deepEqual(appointedSignatorySlots(person('t', { department_id: 'finance', is_dept_head: true, position: { name: 'นักวิชาการเงินและบัญชี' } })), [],
    'เจ้าของระบบสั่งแยก: ติ๊กหัวหน้าอย่างเดียวไม่ได้ทำให้เป็นผู้ลงนาม')
})

await check('เสนอชื่อเมื่อเจอคนเดียวเท่านั้น · หลายคน/ไม่เจอ = ไม่เดา · แถวที่แอดมินสร้างเองไม่เสนอ', () => {
  assert.equal(appointmentSuggestion({ role: 'mayor', departmentId: null }, people).person, MAYOR)
  assert.equal(appointmentSuggestion({ role: 'clerk', departmentId: null }, people).person, CLERK)
  assert.equal(appointmentSuggestion({ role: 'department_head', departmentId: 'finance' }, people).person, FIN_HEAD)
  assert.deepEqual(appointmentSuggestion({ role: 'department_head', departmentId: 'works' }, people), { status: 'none' })
  const twoHeads = [...people, person('fin-head-2', { department_id: 'finance', is_dept_head: true, position: { name: 'ผู้อำนวยการกองคลัง' } })]
  const many = appointmentSuggestion({ role: 'department_head', departmentId: 'finance' }, twoHeads)
  assert.equal(many.status, 'many')
  assert.equal(many.count, 2)
  assert.deepEqual(many.people.map(item => item.id), ['fin-head', 'fin-head-2'], 'เจอหลายคนต้องบอกรายชื่อให้เลือก ไม่ใช่แค่จำนวน')
  assert.deepEqual(appointmentSuggestion({ role: 'custom', departmentId: null, customLabel: 'รองนายก' }, people), { status: 'none' })
  assert.deepEqual(appointmentSuggestion(null, people), { status: 'none' })
})

await check('หัวหน้าตัวจริง: ไม่นับรอง/ผู้ช่วย · ตำแหน่งที่สร้างเองดูจากชื่อ · แบบมาตรฐานดูจากหมวด', () => {
  for (const head of ['ผู้อำนวยการกองคลัง', 'ผู้อำนวยการ กองช่าง', 'ผู้อำนวยการสำนักการคลัง', 'หัวหน้าสำนักปลัด', 'หัวหน้าหน่วยตรวจสอบภายใน']) {
    assert.equal(isDepartmentHeadPosition({ name: head, category: 'operating_staff' }), true, `${head} ต้องนับเป็นหัวหน้า`)
  }
  for (const other of ['รองผู้อำนวยการกองคลัง', 'รองผู้อำนวยการสำนักการช่าง', 'ผู้ช่วยผู้อำนวยการกองคลัง',
    'หัวหน้าฝ่ายบริหารงานทั่วไป', 'ผู้อำนวยการโรงเรียน', 'นักวิชาการเงินและบัญชี', 'ปลัดเทศบาล', '']) {
    assert.equal(isDepartmentHeadPosition({ name: other, category: 'operating_staff' }), false, `${other} ต้องไม่นับเป็นหัวหน้า`)
  }
  assert.equal(isDepartmentHeadPosition({ name: 'นักบริหารงานคลัง ระดับต้น', category: 'dept_head' }), true, 'แบบตำแหน่งมาตรฐานเชื่อหมวด')
  assert.equal(isDepartmentHeadPosition({ name: 'รองผู้อำนวยการกองคลัง', category: 'dept_head' }), false, 'รองไม่นับแม้หมวดเป็นหัวหน้า')
  assert.equal(isDepartmentHeadPosition(null), false)
  assert.equal(recommendedRoleForPosition({ name: 'ผู้อำนวยการกองคลัง', role: 'staff' }), 'officer', 'ตำแหน่งที่สร้างจากปุ่มเพิ่มบุคลากรมี role staff เสมอ')
  assert.equal(recommendedRoleForPosition({ name: 'นักวิชาการ', role: 'viewer' }), 'viewer')
  assert.equal(recommendedRoleForPosition(null), null)
  for (const role of ['citizen', 'staff', 'technician', null]) assert.equal(canOfferOfficerRole(role), true)
  for (const role of ['viewer', 'council', 'officer', 'admin', 'superadmin']) assert.equal(canOfferOfficerRole(role), false, `${role} ต้องไม่ถูกเสนอให้เปลี่ยนสายงาน`)
  assert.equal(canClearDepartmentHead({ id: 'a', role: 'staff' }, 'me', 'admin'), true)
  assert.equal(canClearDepartmentHead({ id: 'a', role: 'admin' }, 'me', 'admin'), false, 'แอดมินแก้แอดมินด้วยกันไม่ได้ (DB ปฏิเสธ)')
  assert.equal(canClearDepartmentHead({ id: 'a', role: 'admin' }, 'me', 'superadmin'), true)
  assert.equal(canClearDepartmentHead({ id: 'me', role: 'staff' }, 'me', 'admin'), false, 'แก้บัญชีตัวเองไม่ได้ (DB ปฏิเสธ)')
  assert.equal(canClearDepartmentHead({ id: 'a', role: 'superadmin' }, 'me', 'superadmin'), false)
})

await check('เสนอผู้ลงนามจากตำแหน่งเท่านั้น · ติ๊กหัวหน้าอย่างเดียวไม่ถูกเสนอ · ติ๊กใช้ตัดสินเมื่อมีผู้ถือตำแหน่งหลายคน · รองไม่ถูกเสนอ', () => {
  const finance = { role: 'department_head', departmentId: 'finance' }
  const holder = person('holder', { department_id: 'finance', position: { name: 'ผู้อำนวยการกองคลัง', category: 'dept_head' } })
  const deputy = person('deputy-fin', { department_id: 'finance', position: { name: 'รองผู้อำนวยการกองคลัง', category: 'dept_head' } })
  assert.equal(appointmentSuggestion(finance, [holder, deputy, FIN_STAFF]).person, holder, 'ไม่มีใครติ๊ก ใช้คนถือตำแหน่งหัวหน้า')
  const tickedStaff = person('acting', { department_id: 'finance', is_dept_head: true, position: { name: 'นักวิชาการเงินและบัญชี' } })
  assert.equal(appointmentSuggestion(finance, [holder, tickedStaff]).person, holder, 'ติ๊กหัวหน้าไม่แย่งช่องลงนามจากคนถือตำแหน่ง')
  assert.deepEqual(appointmentSuggestion(finance, [tickedStaff, FIN_STAFF]), { status: 'none' }, 'ติ๊กหัวหน้าอย่างเดียวต้องไม่ถูกเสนอเป็นผู้ลงนาม')
  assert.deepEqual(appointmentSuggestion(finance, [deputy, FIN_STAFF]), { status: 'none' }, 'มีแต่รองต้องไม่เดา')
  const secondHolder = person('holder-2', { department_id: 'finance', position: { name: 'ผู้อำนวยการกองคลัง' } })
  assert.equal(appointmentSuggestion(finance, [holder, secondHolder]).status, 'many')
  const tickedHolder = { ...holder, is_dept_head: true }
  assert.equal(appointmentSuggestion(finance, [tickedHolder, secondHolder]).person, tickedHolder, 'ถือตำแหน่งหลายคน ติ๊กไว้คนเดียวใช้คนนั้น')
  assert.deepEqual(appointedSignatorySlots(holder), [finance], 'แท็บการแต่งตั้งต้องเห็นตรงกับหน้าลงนาม')
  assert.deepEqual(appointedSignatorySlots({ position_name: 'ผู้อำนวยการกองคลัง', department_id: 'finance' }), [finance],
    'ผู้ใช้จาก get_users_with_email มีแค่ position_name ต้องได้ผลเท่ากัน')
})

await check('ช่องที่ต้องถามตอนบันทึกการแต่งตั้ง: เฉพาะที่ตำแหน่งเพิ่งเปลี่ยนมาหาคนนี้ — แก้ข้อมูลอื่นไม่ทับผู้แทน · ไม่ดูติ๊กหัวหน้า', () => {
  const before = person('u', { department_id: 'finance', position: { name: 'นักวิชาการเงินและบัญชี' } })
  const asHead = person('u', { department_id: 'finance', position: { name: 'ผู้อำนวยการกองคลัง' } })
  const financeSlot = [{ role: 'department_head', departmentId: 'finance' }]
  assert.deepEqual(newlyAppointedSlots(before, asHead, [], 'u'), financeSlot)
  assert.deepEqual(newlyAppointedSlots(asHead, asHead, [], 'u'), [], 'แก้เบอร์โทรเฉยๆ ต้องไม่ถาม')
  assert.deepEqual(newlyAppointedSlots(before, asHead, [{ signatory_role: 'department_head', department_id: 'finance', profile_id: 'u' }], 'u'), [],
    'เป็นผู้ลงนามช่องนี้อยู่แล้วต้องไม่ถาม')
  assert.deepEqual(newlyAppointedSlots(before, asHead, [{ signatory_role: 'department_head', department_id: 'finance', profile_id: 'other' }], 'u'),
    financeSlot, 'ช่องเป็นคนอื่นต้องถาม')
  assert.deepEqual(newlyAppointedSlots(before, { ...before, is_dept_head: true }, [], 'u'), [], 'ติ๊กหัวหน้าอย่างเดียวต้องไม่ถามเรื่องลงนาม')
  assert.deepEqual(newlyAppointedSlots(before, { ...asHead, is_dept_head: false }, [], 'u'), financeSlot, 'เอาติ๊กหัวหน้าออก ก็ยังถามเรื่องลงนามตามตำแหน่ง')
  assert.deepEqual(newlyAppointedSlots({ ...asHead, is_dept_head: true }, { ...asHead, is_dept_head: false }, [], 'u'), [], 'แก้แค่ติ๊กหัวหน้าต้องไม่ถาม')
  const moved = { ...asHead, department_id: 'works', position: { name: 'ผู้อำนวยการกองช่าง' } }
  assert.deepEqual(newlyAppointedSlots(asHead, moved, [], 'u'), [{ role: 'department_head', departmentId: 'works' }], 'ย้ายไปเป็นหัวหน้ากองใหม่ต้องถาม')
  assert.deepEqual(newlyAppointedSlots(before, { ...before, position: { name: 'ปลัดเทศบาล' } }, [], 'u'), [{ role: 'clerk', departmentId: null }])
  const byCategory = { name: 'นักบริหารงานคลัง ระดับต้น', category: 'dept_head' }
  assert.deepEqual(newlyAppointedSlots({ ...before, position: byCategory }, { ...before, position: byCategory }, [], 'u'), [], 'ตำแหน่งที่รู้จากหมวด แก้ข้อมูลอื่นต้องไม่ถาม')
})

await check('รายการเปลี่ยนในกล่องยืนยัน: ชื่อเดิม → ใหม่ · ติ๊กให้เฉพาะช่องว่าง/กรอกชื่อเอง · คงเครื่องหมายรถ', () => {
  const slot = { role: 'clerk', departmentId: null, label: 'ปลัด' }
  const clerk = { id: 'c', full_name: ' นาย ข ใจดี ', position: { name: 'ปลัดเทศบาล' } }
  const empty = signatoryChangeFor(slot, undefined, clerk)
  assert.equal(empty.key, signatorySlotKey(slot))
  assert.equal(empty.current, null)
  assert.equal(empty.person.name, 'นาย ข ใจดี')
  assert.equal(empty.person.title, 'ปลัดเทศบาล')
  assert.equal(empty.defaultChecked, true, 'ช่องว่างติ๊กให้')
  assert.equal(empty.vehicleDefault, false)
  const manual = signatoryChangeFor(slot, { manual_name: 'นายข ใจดี', title_override: 'ปลัดเทศบาล', is_vehicle_order_default: true }, clerk)
  assert.equal(manual.defaultChecked, true, 'กรอกชื่อเองติ๊กให้')
  assert.equal(manual.sameName, true, 'ชื่อตรงกันเมื่อไม่นับช่องว่าง = คนเดิม ผูกบัญชีเฉยๆ')
  assert.equal(manual.current.manual, true)
  assert.equal(manual.vehicleDefault, true, 'ต้องคงเครื่องหมายผู้มีอำนาจสั่งใช้รถ ไม่งั้นหายไปกับการเปลี่ยนคน')
  const noTitle = signatoryChangeFor(slot, { manual_name: 'ข ใจดี', title_override: 'ปลัดเทศบาล' }, clerk)
  assert.equal(noTitle.sameName, true, 'พิมพ์ไว้ไม่มีคำนำหน้า ก็ต้องนับเป็นคนเดียวกับบัญชี')
  assert.equal(noTitle.defaultChecked, true)
  const typedOther = signatoryChangeFor(slot, { manual_name: 'นางสาว ง สมมติ', title_override: 'ปลัดเทศบาล' }, clerk)
  assert.equal(typedOther.sameName, false)
  assert.equal(typedOther.defaultChecked, false, 'ชื่อที่พิมพ์ไว้เป็นคนละคน ต้องไม่ติ๊กให้ ไม่งั้นกดทีเดียวชื่อคนจริงบนเอกสารเปลี่ยน')
  const other = signatoryChangeFor(slot, { profile_id: 'x', profile: { full_name: 'นาย ค' } }, clerk)
  assert.equal(other.defaultChecked, false, 'เลือกบัญชีคนอื่นไว้ อาจตั้งใจ ต้องไม่ติ๊กให้')
  assert.equal(other.current.name, 'นาย ค')
  assert.equal(other.sameName, false)
  const manualActing = signatoryChangeFor(slot, { manual_name: 'นาย ข ใจดี', title_override: 'ปลัด รักษาราชการแทน' }, clerk)
  assert.equal(manualActing.defaultChecked, false, 'ผู้แทนที่กรอกชื่อเองก็ต้องไม่ติ๊กให้')
  assert.equal(signatoryChangeFor(slot, undefined, { ...clerk, job_title: 'ปลัดเทศบาล ระดับกลาง' }).person.title, 'ปลัดเทศบาล ระดับกลาง',
    'ต้องแสดงตำแหน่งตามลำดับเดียวกับที่ใบพิมพ์ใช้')
  const custom = { role: 'custom', departmentId: null, customLabel: 'รองนายก' }
  assert.equal(signatorySlotKey(custom), 'custom:organization:รองนายก')
  assert.equal(signatorySlotLabel(custom, []), 'รองนายก')
  assert.equal(signatorySlotLabel({ role: 'department_head', departmentId: 'x' }, [{ id: 'x', name: 'ตรวจสอบภายใน' }]), 'ตรวจสอบภายใน', 'ห้ามเติมคำว่าหัวหน้า')
  assert.equal(signatorySlotLabel({ role: 'department_head', departmentId: 'gone' }, []), 'กองที่ปิดใช้แล้ว')
})

await check('เทียบทะเบียนกับการแต่งตั้ง: ตรง/ว่าง/กรอกชื่อเอง/คนอื่น/รักษาราชการแทน', () => {
  const one = appointmentSuggestion({ role: 'clerk', departmentId: null }, people)
  assert.equal(signatorySuggestionState({ profile_id: 'clerk' }, one).kind, 'match')
  assert.equal(signatorySuggestionState(undefined, one).kind, 'empty')
  assert.equal(signatorySuggestionState({ profile_id: null, manual_name: 'ข. สมมติ' }, one).kind, 'manual')
  assert.equal(signatorySuggestionState({ profile_id: 'someone-else' }, one).kind, 'differs')
  assert.equal(signatorySuggestionState({ profile_id: 'someone-else', title_override: 'ปลัด รักษาราชการแทน' }, one).kind, 'acting')
  assert.equal(signatorySuggestionState({ profile_id: 'clerk', title_override: 'ปลัด ปฏิบัติราชการแทน' }, one).kind, 'match',
    'คนเดียวกับการแต่งตั้ง = ตรง แม้พิมพ์คำว่าแทน')
  assert.equal(signatorySuggestionState(undefined, { status: 'many', count: 3 }).kind, 'ambiguous')
  assert.equal(signatorySuggestionState(undefined, { status: 'none' }).kind, 'none')
  assert.deepEqual(SUGGESTABLE_KINDS, ['empty', 'manual', 'differs'], 'ตัวนับ "เสนอชื่อ … ช่อง" ต้องไม่นับช่องที่ตรง/รักษาราชการแทน')
  assert.equal(isActingSignatory({ title_override: 'ผู้อำนวยการกองช่าง' }), false)
  assert.equal(isActingSignatory(null), false)
})

await check('หน้าผู้ลงนาม: ระบบเตรียมชื่อ แต่ไม่บันทึกเอง — ทุกปุ่มเปิดกล่องยืนยันก่อน ห้ามเรียกบันทึกตรงจากตาราง', async () => {
  const source = await read('src/components/admin/SignatorySettings.jsx')
  assert.match(source, /is_dept_head,position:positions\(name,category\)/, 'ต้องดึงข้อมูลการแต่งตั้งมาด้วย')
  // ในกล่องแก้รายช่อง: "เลือกคนนี้" แค่เติมฟอร์ม ต้องกดบันทึกเอง
  const apply = /function applySuggestion\(\) \{([\s\S]*?)\n {2}\}/.exec(source)
  assert.ok(apply, 'ไม่พบ applySuggestion')
  assert.doesNotMatch(apply[1], /rpc|save\(|saveSignatory|supabase/, 'ปุ่มเสนอชื่อห้ามบันทึกแทนผู้ดูแล')
  assert.match(apply[1], /setProfileId\(suggested\.person\.id\)/)
  assert.match(source, /suggestion=\{suggestions\[slot\.key\]\}/)
  // ในตาราง: ปุ่มรวมและปุ่มรายช่องเปิดกล่องยืนยันชุดเดียวกัน ไม่บันทึกเอง
  assert.match(source, /onApplyAll=\{\(\) => setApplying\(changes\)\}/)
  assert.match(source, /onApply=\{\(\) => setApplying\(\[changeByKey\[slot\.key\]\]\)\}/)
  assert.match(source, /ตรวจและใช้ชื่อตามการแต่งตั้ง \(\{actionableCount\} ช่อง\)/)
  assert.match(source, /changes\.filter\(\(change\) => change\.defaultChecked\)/, 'แถบบนสุดนับเฉพาะช่องที่ระบบติ๊กให้ ไม่เตือนค้างเรื่องช่องที่ตั้งใจตั้งคนอื่นไว้')
  assert.doesNotMatch(source, /applySignatoryChanges/, 'ตารางห้ามเรียกตัวบันทึกตรง ต้องผ่าน SignatoryApplyDialog')
  assert.doesNotMatch(source, /supabase\.rpc\(/, 'การบันทึกทุกจุดต้องผ่าน signatoryApi.js')
  const dialog = await read('src/components/admin/SignatoryApplyDialog.jsx')
  assert.match(dialog, /applySignatoryChanges\(municipalityId, pending\)/, 'กล่องยืนยันเท่านั้นที่บันทึก และเฉพาะช่องที่ติ๊ก')
  assert.match(dialog, /SIGNING_EFFECT_TEXT/, 'ต้องบอกผลต่อเรื่องค้าง/เรื่องที่เสร็จแล้วก่อนกดยืนยัน')
  const api = await read('src/lib/signatoryApi.js')
  assert.match(api, /vehicleDefault: change\.vehicleDefault/, 'ต้องคงเครื่องหมายผู้มีอำนาจสั่งใช้รถของแถวเดิม')
})

await check('ทุกกรณีของแถวต้องบอกว่าทำอะไรต่อ ไม่ปล่อยให้ต้องถาม', async () => {
  const source = await read('src/components/admin/SignatorySettings.jsx')
  for (const kind of ['match', 'acting', 'ambiguous', 'none', 'offer']) {
    assert.match(source, new RegExp(`data-signatory-suggestion="${kind}"`), `แถวสถานะ ${kind} ต้องมีข้อความกำกับ`)
  }
  assert.match(source, /data-signatory-next-step/, 'บนสุดต้องบอกขั้นต่อไป')
  assert.match(source, /ตั้งครบแล้ว ไม่ต้องทำอะไรเพิ่ม/, 'ทำครบแล้วต้องบอกว่าจบ')
  assert.match(source, /เลือกผู้ลงนามก่อนจึงบันทึกได้/, 'ปุ่มที่กดไม่ได้ต้องบอกเหตุผลบนจอ มือถือไม่มี tooltip')
  assert.match(source, /ยังไม่มีอะไรเปลี่ยน/, 'ปุ่มที่กดไม่ได้ต้องบอกเหตุผลบนจอ')
  assert.doesNotMatch(source, /text-\[(9|10|11)px\]/, 'ตัวอักษรเล็กกว่า 12px อ่านยากบนจอเจ้าหน้าที่')
})

await check('ฟอร์มเจ้าหน้าที่หน้าเดียว: ตำแหน่งพิมพ์เพิ่มได้ · ผู้ลงนามแยกจากหัวหน้า · ย้ายกองแล้วติ๊กไม่หาย · ทุกอย่างผ่านปุ่มบันทึก', async () => {
  const dashboard = await read('src/pages/AdminDashboard.jsx')
  const form = await read('src/components/admin/PersonSetupForm.jsx')
  assert.match(dashboard, /<PersonSetupForm\b/)
  assert.match(dashboard, /adminAppointUser\(user\.id, effectivePayload, user\.department_id \?\? null\)/, 'ต้องใช้ตัวบันทึกที่ติ๊กซ้ำหลังย้ายกอง')
  assert.match(dashboard, /\.select\('department_id,position_id,is_dept_head'\)/, 'หน้าจอต้องแสดงค่าจริงจากฐานข้อมูล ไม่ใช่ค่าที่ส่งไป')
  assert.doesNotMatch(dashboard, /function UserDetailPage|function AppointmentTab|function PermissionsTab|USER_DETAIL_TABS/, 'หน้ารายละเอียด 4 แท็บรวมเป็นฟอร์มเดียวแล้ว')
  assert.doesNotMatch(dashboard, /function signingSlotLabel/, 'ใช้ signatorySlotLabel ตัวกลาง')
  assert.match(form, /defaultDepartmentHead\(/, 'ค่าเริ่มต้นของติ๊กหัวหน้ามาจากกติกากลาง')
  assert.match(form, /proposedRoleForAppointment\(/)
  assert.match(form, /personSigningRows\(/)
  assert.match(form, /<OtherHeadsChoices otherHeads=\{otherHeads\}/, 'หัวหน้าคนเดิมต้องอยู่กับเรื่องการแต่งตั้ง ไม่อยู่ในกรอบการลงนาม')
  assert.match(form, /ไม่เกี่ยวกับการลงนามเอกสาร/, 'ต้องบอกบนหน้าจอว่าสองเรื่องนี้แยกกัน')
  assert.doesNotMatch(form, /is_dept_head: isHead,?\s*\n\s*\}\),\s*\[person\?\.id/, 'ช่องลงนามต้องไม่รู้จักติ๊กหัวหน้า')
  assert.match(form, /createDepartment\(supabase, tenant\.id/)
  assert.match(form, /createPosition\(supabase, tenant\.id/)
  // ระบบเตรียมให้ แต่บันทึกเมื่อกดปุ่มเท่านั้น
  assert.match(form, /async function save\(next = false\)/)
  const beforeSave = form.slice(0, form.indexOf('async function save(next = false)'))
  assert.doesNotMatch(beforeSave.slice(beforeSave.indexOf('function chooseAccount')), /finishAppointment\(|saveUserEdits\(|createDepartment\(|createPosition\(/, 'เลือกค่าในฟอร์มห้ามเขียนฐานข้อมูล')
  const update = await read('src/lib/adminUpdateUser.js')
  assert.match(update, /adminUpdateUser\(userId, \{ is_dept_head: true \}\)/)
  // ถ้า trigger เลิกล้างติ๊กเมื่อไร ตัวบันทึก 2 รอบหมดความจำเป็น ต้องกลับมาทบทวน
  const trigger = await read('supabase/migrations/20261024210000_position_department_move.sql')
  assert.match(trigger, /NEW\.department_id IS DISTINCT FROM OLD\.department_id THEN\s+NEW\.is_dept_head := false/)
})

await check('กติกาฟอร์ม: พิมพ์ ผอ. เจอของเดิม · กองจากชื่อตำแหน่ง · หมวดและสิทธิ์ของตำแหน่งใหม่ไม่เคยเป็นแอดมิน', () => {
  assert.equal(positionSearchKey('ผอ.กองคลัง'), positionSearchKey('ผู้อำนวยการกองคลัง'))
  assert.equal(positionSearchKey('ผู้อำนวยการ  กองคลัง'), positionSearchKey('ผู้อำนวยการกองคลัง'), 'ช่องว่างต้องไม่ทำให้ได้ตำแหน่งซ้ำ')
  assert.equal(prettyPositionName(' ผอ. กองคลัง '), 'ผู้อำนวยการกองคลัง')
  assert.equal(prettyPositionName('นัก  วิชาการ'), 'นัก วิชาการ')
  const departments = [{ id: 'f', name: 'กองคลัง' }, { id: 'p', name: 'สำนักปลัด' }, { id: 'a', name: 'หน่วยตรวจสอบภายใน' }]
  assert.equal(departmentFromPositionName('ผู้อำนวยการกองคลัง', departments), 'f')
  assert.equal(departmentFromPositionName('หัวหน้าสำนักปลัด', departments), 'p')
  assert.equal(departmentFromPositionName('นักวิชาการเงิน', departments), null)
  assert.equal(proposedDepartmentName('ผู้อำนวยการกองสาธารณสุข'), 'กองสาธารณสุข')
  assert.equal(proposedDepartmentName('หัวหน้าหน่วยตรวจสอบภายใน'), 'หน่วยตรวจสอบภายใน')
  assert.equal(proposedDepartmentName('รองผู้อำนวยการกองสาธารณสุข'), '', 'รองไม่ใช่หัวหน้า ไม่เสนอเพิ่มกอง')
  assert.equal(proposedDepartmentName('นักวิชาการสาธารณสุข'), '')
  assert.equal(defaultHeadPositionName({ name: 'กองคลัง' }), 'ผู้อำนวยการกองคลัง')
  assert.equal(defaultHeadPositionName({ name: 'สำนักปลัด' }), 'หัวหน้าสำนักปลัด')
  assert.equal(defaultHeadPositionName({ name: 'หน่วยตรวจสอบภายใน' }), 'หัวหน้าหน่วยตรวจสอบภายใน')
  assert.equal(defaultHeadPositionName({ name: 'ตรวจสอบภายใน' }), '', 'ชื่อกองไม่บอกระดับ ต้องไม่เดา')
  const cases = [
    ['นายกเทศมนตรีตำบลทดสอบ', 'political_exec', 'viewer'], ['รองนายกเทศมนตรี', 'political_exec', 'viewer'],
    ['ปลัดเทศบาล', 'top_admin', 'officer'], ['รองปลัดเทศบาล', 'top_admin', 'officer'],
    ['สมาชิกสภา', 'council', 'council'], ['ผู้อำนวยการกองคลัง', 'dept_head', 'officer'],
    ['นายช่างโยธา', 'field_technician', 'technician'], ['เจ้าพนักงานธุรการ', 'operating_staff', 'staff'], ['นายกรัฐมนตรี', 'operating_staff', 'staff'],
  ]
  for (const [name, category, role] of cases) assert.deepEqual(positionTraitsFromName(name), { category, role }, name)
  assert.equal(isExecutivePosition({ name: 'ปลัดเทศบาล' }), true)
  assert.equal(isExecutivePosition({ name: 'ธุรการ', category: 'operating_staff' }), false)
})

await check('กติกาฟอร์ม: ติ๊กหัวหน้าเริ่มต้น — ไม่เปลี่ยนอะไรคงเดิม · ตำแหน่งหัวหน้าติ๊กให้ · ออกจากหัวหน้าเอาออก · ย้ายกองไม่พกสถานะเดิม', () => {
  const head = { id: 'h', name: 'ผู้อำนวยการกองคลัง' }
  const staff = { id: 's', name: 'ธุรการ' }
  const on = { department_id: 'f', is_dept_head: true }
  const off = { department_id: 'f', is_dept_head: false }
  assert.equal(defaultDepartmentHead({ person: off, previousPosition: head, position: head, departmentId: 'f' }), false, 'ถือตำแหน่งหัวหน้าแต่ไม่ได้ติ๊ก แก้เบอร์โทรต้องไม่ติ๊กให้')
  assert.equal(defaultDepartmentHead({ person: on, previousPosition: staff, position: staff, departmentId: 'f' }), true, 'ติ๊กไว้เอง แก้เบอร์โทรต้องไม่เอาออก')
  assert.equal(defaultDepartmentHead({ person: off, previousPosition: staff, position: head, departmentId: 'f' }), true)
  assert.equal(defaultDepartmentHead({ person: on, previousPosition: head, position: staff, departmentId: 'f' }), false)
  assert.equal(defaultDepartmentHead({ person: on, previousPosition: staff, position: { id: 't', name: 'นักวิชาการ' }, departmentId: 'f' }), true, 'ตำแหน่งธรรมดาทั้งคู่คงค่าเดิม')
  assert.equal(defaultDepartmentHead({ person: on, previousPosition: staff, position: staff, departmentId: 'w' }), false, 'ย้ายกองต้องไม่พกสถานะหัวหน้าไป')
  assert.equal(defaultDepartmentHead({ person: on, previousPosition: null, position: null, departmentId: 'f' }), true, 'ยังไม่มีตำแหน่ง แก้ข้อมูลอื่นต้องไม่เอาติ๊กออก')
  assert.equal(defaultDepartmentHead({ person: on, previousPosition: staff, position: staff, departmentId: '' }), false)
})

await check('กติกาฟอร์ม: สิทธิ์เสนอเพิ่มตามตำแหน่ง ไม่ลดเอง ไม่แตะแอดมิน · ไม่เปลี่ยนการแต่งตั้ง = สิทธิ์ไม่ขยับ', () => {
  const propose = (currentRole, position, asHead = false, appointmentChanged = true) => proposedRoleForAppointment({ currentRole, position, asHead, appointmentChanged })
  const plain = { name: 'ธุรการ', category: 'operating_staff', role: 'staff' }
  assert.equal(propose('citizen', plain), 'staff')
  assert.equal(propose('staff', plain, true), 'officer')
  assert.equal(propose('technician', plain, true), 'officer')
  assert.equal(propose('officer', plain), 'officer', 'พ้นหัวหน้าต้องไม่ลดสิทธิ์เอง ฟอร์มเตือนแทน')
  assert.equal(propose('viewer', plain, true), 'viewer', 'คนละสายงาน ระบบไม่เปลี่ยนให้')
  assert.equal(propose('admin', plain, true), 'admin')
  assert.equal(propose('superadmin', plain, true), 'superadmin')
  assert.equal(propose('citizen', { name: 'นายกเทศมนตรี', category: 'political_exec', role: 'viewer' }), 'viewer')
  assert.equal(propose('staff', { name: 'ปลัดเทศบาล', category: 'top_admin', role: 'admin' }), 'staff', 'ไม่เคยเสนอแอดมิน')
  assert.equal(propose('staff', plain, true, false), 'staff', 'ข้อมูลเก่าที่ติ๊กหัวหน้าไว้แต่สิทธิ์เจ้าหน้าที่ แก้เบอร์โทรต้องไม่ยกสิทธิ์')
  assert.equal(propose('citizen', null), 'citizen', 'บัญชีประชาชนแก้ข้อมูลโดยไม่แต่งตั้ง ต้องยังเป็นประชาชน')
})

await check('กติกาฟอร์ม: แถวลงนาม — ถืออยู่ติ๊กไว้ · ตำแหน่งเพิ่งเปลี่ยนติ๊กให้ · ไม่เปลี่ยนไม่ติ๊ก · ผู้แทนไม่ทับ · เลือกเองเตือนเมื่อไม่ตรง', () => {
  const departments = [{ id: 'finance', name: 'กองคลัง' }]
  const row = (signatory_role, department_id, profile_id, extra = {}) => ({ signatory_role, department_id, custom_label: null, profile_id, ...extra })
  const clerical = person('u', { department_id: 'finance', position: { name: 'ธุรการ' } })
  const asHead = person('u', { department_id: 'finance', position: { name: 'ผู้อำนวยการกองคลัง' } })
  const rowsFor = (before, after, rows = [], options = {}) => personSigningRows({
    personId: 'u', before, after, rows, slots: buildSignatorySlots(departments, rows, options.drafts ?? []), ...options,
  })
  const financeKey = 'department_head:finance:'

  assert.deepEqual(rowsFor(clerical, clerical), [], 'ตำแหน่งธรรมดาไม่มีแถว')
  const fresh = rowsFor(clerical, asHead)
  assert.equal(fresh[0].key, financeKey)
  assert.equal(fresh[0].checked, true, 'ตำแหน่งเพิ่งเปลี่ยนมา ติ๊กให้')
  assert.equal(fresh[0].matches, true)
  const unchanged = rowsFor(asHead, asHead)
  assert.equal(unchanged[0].checked, false, 'ไม่ได้เปลี่ยนตำแหน่ง แก้เบอร์โทรต้องไม่ตั้งผู้ลงนาม')
  assert.equal(unchanged[0].proposed, true)
  const acting = [row('department_head', 'finance', 'x', { title_override: 'นาย ก รักษาราชการแทน' })]
  assert.deepEqual(rowsFor(asHead, asHead, acting), [], 'ตั้งผู้แทนไว้ถือว่าตั้งใจ ไม่ขึ้น')
  assert.equal(rowsFor(clerical, asHead, acting)[0].checked, false, 'เพิ่งแต่งตั้งแต่ตั้งผู้แทนไว้ ขึ้นให้เห็นแต่ไม่ติ๊กให้')
  const held = [row('department_head', 'finance', 'u')]
  const moved = rowsFor(asHead, clerical, held)
  assert.equal(moved[0].held, true)
  assert.equal(moved[0].checked, true, 'ระบบต้องไม่เอาชื่อออกเอง')
  assert.equal(moved[0].matches, false, 'ตำแหน่งใหม่ไม่ตรงช่อง ต้องเตือน')
  assert.equal(rowsFor(asHead, clerical, held, { choices: { [financeKey]: false } })[0].checked, false)
  const picked = rowsFor(clerical, clerical, [], { extraKeys: ['clerk:organization:'] })
  assert.equal(picked[0].slot.role, 'clerk')
  assert.equal(picked[0].checked, true)
  assert.equal(picked[0].matches, false, 'ตำแหน่งอื่นเลือกช่องปลัดเองได้ แต่ต้องเตือน')
  const custom = rowsFor(clerical, clerical, [], { drafts: ['รองปลัด'], extraKeys: ['custom:organization:รองปลัด'] })
  assert.equal(custom[0].matches, true, 'ช่องที่สร้างเองไม่มีตำแหน่งตายตัว ไม่ต้องเตือน')
  const asTicked = rowsFor({ ...clerical, is_dept_head: false }, { ...clerical, is_dept_head: true })
  assert.deepEqual(asTicked, [], 'ติ๊กหัวหน้าอย่างเดียวต้องไม่มีแถวลงนาม')
})

await check('รายการช่องลงนามชุดเดียว: นายก ปลัด ทุกกอง และช่องที่สร้างเอง · กองผู้บริหารไม่บังคับ', () => {
  const slots = buildSignatorySlots(
    [{ id: 'f', name: 'กองคลัง' }, { id: 'e', code: 'exec', name: 'คณะผู้บริหาร' }],
    [{ signatory_role: 'custom', custom_label: 'รองนายก' }],
    ['ฉบับร่าง'],
  )
  assert.deepEqual(slots.map(slot => slot.label), ['นายก', 'ปลัด', 'กองคลัง', 'คณะผู้บริหาร', 'รองนายก', 'ฉบับร่าง'])
  assert.deepEqual(slots.filter(slot => !slot.optional).map(slot => slot.label), ['นายก', 'ปลัด', 'กองคลัง'])
})

await check('เมนูแอดมิน: เหลือ "จัดการผู้ใช้และการแต่งตั้ง" + "การลงนามเอกสาร" · คีย์เก่ายังเปิดหน้าเดียวกันคนละแท็บ', async () => {
  const dashboard = await read('src/pages/AdminDashboard.jsx')
  const menuGroups = dashboard.slice(dashboard.indexOf('function getAdminMenuGroups'), dashboard.indexOf('// ─── SatisfactionAdmin'))
  assert.match(menuGroups, /key: 'signing', label: 'การลงนามเอกสาร'/)
  assert.doesNotMatch(menuGroups, /key: 'signatories'|key: 'esign'/, 'ห้ามมีเมนูผู้ลงนาม/ลงนามออนไลน์แยกกลับมา')
  assert.ok(menuGroups.indexOf("key: 'users'") < menuGroups.indexOf("key: 'signing'"), 'ผู้ใช้ต้องมาก่อน (ระบบเสนอชื่อจากการแต่งตั้ง)')
  assert.doesNotMatch(dashboard, /setActivePage\('signatories'\)|setActivePage\('esign'\)/, 'การ์ด/ทางลัดต้องชี้ไปเมนูใหม่')
  assert.doesNotMatch(dashboard, /label: 'ผู้ลงนามเอกสาร'|label: 'ลงนามออนไลน์'/)
  assert.match(dashboard, /activePage === 'signing' \|\| activePage === 'signatories' \|\| activePage === 'esign'/)
  assert.match(dashboard, /initialTab=\{activePage === 'esign' \? 'esign' : 'signatories'\}/)
  assert.match(dashboard, /onOpenSigning=\{\(\) => setActivePage\('signing'\)\}/)
  // หน้ารายชื่อบอกช่องผู้ลงนามที่ขาดและใครลงนามช่องไหน กดเข้าฟอร์มเดียวกัน
  assert.match(dashboard, /<SigningStatusBar depts=\{depts\} registry=\{registry\}/)
  assert.match(dashboard, /signingLabelsByPerson/)
})

await check('หน้ารวม: 2 แท็บ ใช้หน้าตั้งค่าเดิมทั้งคู่ · ปุ่มในแท็บลงนามออนไลน์สลับกลับแท็บผู้ลงนาม (ไม่เปิดเมนูอื่น)', async () => {
  const page = await read('src/components/admin/DocumentSigningSettings.jsx')
  assert.match(page, /<SignatorySettings tenant=\{tenant\} onOpenUsers=\{onOpenUsers\} \/>/)
  assert.match(page, /<EsignSettings tenant=\{tenant\} onOpenSignatories=\{\(\) => setTab\('signatories'\)\} \/>/)
  assert.match(page, /role="tablist"/)
  assert.match(page, /aria-selected=\{active\}/)
  assert.match(page, /min-h-11/, 'ปุ่มแท็บบนมือถือต้องสูงอย่างน้อย 44px')
  assert.match(page, /จัดการผู้ใช้และการแต่งตั้ง/, 'ต้องบอกว่าเรื่องคน/กอง/สิทธิ์อยู่อีกเมนู')
})

await check('ข้อความที่ชี้ทางทั้ง src + คู่มือ + DOMAIN ไม่อ้างเมนูเก่าแล้ว', async () => {
  const stale = /เมนู[ ]?[“"]ผู้ลงนามเอกสาร|&gt; ผู้ลงนามเอกสาร|> ผู้ลงนามเอกสาร|ไปหน้า “ผู้ลงนามเอกสาร”|ทะเบียนผู้ลงนามเอกสาร/
  const sources = (await readdir(new URL('../src/', import.meta.url), { recursive: true }))
    .filter((name) => /\.(jsx?|mjs)$/.test(name)).map((name) => `src/${name.replace(/\\/g, '/')}`)
  assert.ok(sources.length > 100, `อ่านไฟล์ใน src ได้น้อยผิดปกติ (${sources.length})`)
  for (const path of [...sources, 'docs/ai/DOMAIN.md', 'public/manual-admin.html', 'public/manual-staff.html']) {
    assert.doesNotMatch(await read(path), stale, `${path} ยังชี้เมนูเก่า`)
  }
  for (const path of ['src/components/esign/SignTripDialog.jsx', 'src/components/profile/MyEsignSection.jsx']) {
    assert.doesNotMatch(await read(path), /เมนู ผู้ดูแล → ลงนามออนไลน์/, `${path} ยังชี้เมนูลงนามออนไลน์เดิม`)
  }
})

console.log(`admin-signing-menu: ผ่าน ${passed} ชุด`)
