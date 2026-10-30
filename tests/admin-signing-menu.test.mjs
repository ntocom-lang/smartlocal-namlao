// เมนู "การลงนามเอกสาร" (รวม ผู้ลงนามเอกสาร + ลงนามออนไลน์) + เสนอผู้ลงนามจากการแต่งตั้ง — เจ้าของระบบอนุมัติ 2569-10-30
// npm run test:signing-menu
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import {
  appointedSignatorySlots, appointmentSuggestion, isActingSignatory, signatorySuggestionState, SUGGESTABLE_KINDS,
} from '../src/lib/documentSignatories.js'

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

await check('กฎการแต่งตั้ง: นายก/ปลัดดูคำขึ้นต้นของตำแหน่ง · หัวหน้ากองดูติ๊ก "เป็นหัวหน้ากอง" · รอง/ผู้ช่วยไม่นับ', () => {
  assert.deepEqual(appointedSignatorySlots(MAYOR), [{ role: 'mayor', departmentId: null }])
  assert.deepEqual(appointedSignatorySlots(CLERK), [{ role: 'clerk', departmentId: null }])
  assert.deepEqual(appointedSignatorySlots(FIN_HEAD), [{ role: 'department_head', departmentId: 'finance' }])
  for (const other of [DEPUTY_MAYOR, DEPUTY_CLERK, FIN_STAFF, person('x'), null]) {
    assert.deepEqual(appointedSignatorySlots(other), [], `${other?.id} ต้องไม่ถูกเสนอเป็นผู้ลงนาม`)
  }
  assert.deepEqual(appointedSignatorySlots(person('pm', { position: { name: 'นายกรัฐมนตรี' } })), [], 'นายกรัฐมนตรีไม่ใช่นายก อปท.')
  assert.deepEqual(appointedSignatorySlots({ id: 'u', position_name: ' ปลัดองค์การบริหารส่วนตำบลทุ่งแค้ว' }),
    [{ role: 'clerk', departmentId: null }], 'ผู้ใช้จาก get_users_with_email มี position_name แทน position.name')
  assert.deepEqual(appointedSignatorySlots(person('h', { is_dept_head: true })), [], 'ติ๊กหัวหน้าแต่ไม่มีกอง = ไม่รู้ว่าช่องไหน')
})

await check('เสนอชื่อเมื่อเจอคนเดียวเท่านั้น · หลายคน/ไม่เจอ = ไม่เดา · แถวที่แอดมินสร้างเองไม่เสนอ', () => {
  assert.equal(appointmentSuggestion({ role: 'mayor', departmentId: null }, people).person, MAYOR)
  assert.equal(appointmentSuggestion({ role: 'clerk', departmentId: null }, people).person, CLERK)
  assert.equal(appointmentSuggestion({ role: 'department_head', departmentId: 'finance' }, people).person, FIN_HEAD)
  assert.deepEqual(appointmentSuggestion({ role: 'department_head', departmentId: 'works' }, people), { status: 'none' })
  const twoHeads = [...people, person('fin-head-2', { department_id: 'finance', is_dept_head: true })]
  assert.deepEqual(appointmentSuggestion({ role: 'department_head', departmentId: 'finance' }, twoHeads), { status: 'many', count: 2 })
  assert.deepEqual(appointmentSuggestion({ role: 'custom', departmentId: null, customLabel: 'รองนายก' }, people), { status: 'none' })
  assert.deepEqual(appointmentSuggestion(null, people), { status: 'none' })
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

await check('หน้าผู้ลงนาม: เสนอชื่อแล้วไม่บันทึกเอง — ปุ่ม "ใช้ชื่อนี้" แค่เติมฟอร์ม ต้องกดบันทึก (set_document_signatory_v4) เอง', async () => {
  const source = await read('src/components/admin/SignatorySettings.jsx')
  assert.match(source, /is_dept_head,position:positions\(name,category\)/, 'ต้องดึงข้อมูลการแต่งตั้งมาด้วย')
  const apply = /function applySuggestion\(\) \{([\s\S]*?)\n {2}\}/.exec(source)
  assert.ok(apply, 'ไม่พบ applySuggestion')
  assert.doesNotMatch(apply[1], /rpc|save\(|supabase/, 'ปุ่มเสนอชื่อห้ามบันทึกแทนผู้ดูแล')
  assert.match(apply[1], /setProfileId\(suggested\.person\.id\)/)
  assert.match(source, /suggestion=\{suggestions\[slot\.key\]\}/)
  assert.match(source, /เสนอชื่อตามการแต่งตั้ง \{suggestionCount\} ช่อง/)
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
  // แท็บการแต่งตั้งรายคนบอกว่าเป็นผู้ลงนามช่องไหน และเตือนเมื่อทะเบียนไม่ตรงกับการแต่งตั้ง
  assert.match(dashboard, /<SigningRoleNote user=\{user\}/)
  assert.match(dashboard, /appointedSignatorySlots\(user\)/)
})

await check('หน้ารวม: 2 แท็บ ใช้หน้าตั้งค่าเดิมทั้งคู่ · ปุ่มในแท็บลงนามออนไลน์สลับกลับแท็บผู้ลงนาม (ไม่เปิดเมนูอื่น)', async () => {
  const page = await read('src/components/admin/DocumentSigningSettings.jsx')
  assert.match(page, /<SignatorySettings tenant=\{tenant\} \/>/)
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
  for (const path of [...sources, 'docs/ai/DOMAIN.md', 'public/manual-admin.html']) {
    assert.doesNotMatch(await read(path), stale, `${path} ยังชี้เมนูเก่า`)
  }
})

console.log(`admin-signing-menu: ผ่าน ${passed} ชุด`)
