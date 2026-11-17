// หมวดคำร้อง "สอบถาม/ติดต่อเจ้าหน้าที่" (inquiry) — ข้อ 1.3 แผนเทียบคู่แข่ง
//   node tests/inquiry-category.test.mjs        (npm run test:inquiry)
// ไม่ใช้เครือข่าย ไม่แตะข้อมูลจริง
//
// สิ่งที่ต้องไม่พัง: (1) รหัสหมวด/ป้าย/สี/ค่า requires_resolved_location ตรงกันทั้ง src/lib/inquiry.js · DEFAULT_SEED · ไฟล์ SQL
// (2) การ์ดบน /contact ไม่ขึ้นเมื่อหมวดไม่มีแถว/ปิด/เฉพาะผู้มีตำแหน่ง (3) หมวดอื่นไม่ถูกเปลี่ยนถ้อยคำสักตัวอักษร
// (4) ปุ่มโหลดค่าเริ่มต้น (upsert หลายแถว) ไม่ส่ง NULL เข้าคอลัมน์ NOT NULL (5) ถ้อยคำฝั่งผู้สอบถามไม่ใช่ "ร้องเรียน"
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import {
  INQUIRY_ANSWER_HEADING, INQUIRY_CARD, INQUIRY_CATEGORY, INQUIRY_DONE_DESC, INQUIRY_DONE_LABEL, INQUIRY_FORM,
  INQUIRY_FORM_TYPE, INQUIRY_LABEL, INQUIRY_LOGIN_GATE, INQUIRY_PDPA, INQUIRY_STAFF,
  inquiryFormPath, inquiryOr, isInquiryCategory, relabelInquirySteps, shouldShowInquiryCard,
} from '../src/lib/inquiry.js'
import { buildTrackSteps } from '../src/lib/complaintTrack.js'
import { STANDARD_CATEGORY_LABEL, categoryNameOf, printableCategoryLabel } from '../src/lib/complaintCategoryLabels.js'
import { canSubmitCategory } from '../src/lib/serviceAudience.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = async rel => (await readFile(path.join(root, rel), 'utf8')).replace(/\r\n/g, '\n')

let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}

const SQL_FILE = 'supabase/migrations/20261205100000_inquiry_standard_category.sql'

// ── 1) รหัสหมวดตรงกันทุกที่ ───────────────────────────────────────────────────────────────────
await test('รหัส inquiry ตรงกันทั้ง src/lib/inquiry.js · DEFAULT_SEED · ไฟล์ SQL · FORM_TYPE_CONFIG', async () => {
  assert.equal(INQUIRY_CATEGORY, 'inquiry')
  assert.equal(INQUIRY_FORM_TYPE, 'inquiry')

  const sql = await read(SQL_FILE)
  assert.ok(sql.includes(`'${INQUIRY_CATEGORY}',`), 'SQL ต้อง insert หมวดรหัส inquiry')
  assert.ok(sql.includes(`'${INQUIRY_LABEL}'`), 'ป้ายใน SQL ต้องตรง INQUIRY_LABEL')
  assert.match(sql, /'💬'/)
  assert.match(sql, /'#F1F5F9'/)
  assert.match(sql, /'#334155'/)
  // ลำดับค่าในแถวที่ insert: is_adhoc, requires_manual_intake, requires_resolved_location = false, false, false
  assert.match(sql, /false,\n\s+false,\n\s+false,\n\s+routed\.department_id/, 'is_adhoc / requires_manual_intake / requires_resolved_location ต้องเป็น false ทั้งสาม')

  const admin = await read('src/pages/AdminDashboard.jsx')
  const seedStart = admin.indexOf('const DEFAULT_SEED = [')
  const seed = admin.slice(seedStart, admin.indexOf('\n]\n', seedStart))
  const row = seed.split('\n').join(' ').match(/\{ value: 'inquiry',[^}]*\}/)
  assert.ok(row, 'DEFAULT_SEED ต้องมีหมวด inquiry')
  assert.ok(row[0].includes(`label: '${INQUIRY_LABEL}'`), 'ป้ายใน DEFAULT_SEED ต้องตรง')
  assert.ok(row[0].includes("emoji: '💬'"))
  assert.ok(row[0].includes("color: '#F1F5F9'"))
  assert.ok(row[0].includes("textColor: '#334155'"))
  assert.ok(row[0].includes('requires_resolved_location: false'), 'ไม่ใส่ false หมวดนี้จะปิดเรื่องไม่ได้ถ้าไม่ปักหมุด')
  assert.ok(row[0].includes('is_adhoc: false'))
  assert.ok(row[0].includes('requires_manual_intake: false'))
  // หมวดอื่นใน seed ต้องไม่ถูกแตะ: ไม่มีแถวอื่นที่เติมคอลัมน์เสริม
  const seedCode = seed.split('\n').filter(line => !line.trim().startsWith('//')).join('\n')
  assert.equal((seedCode.match(/requires_resolved_location/g) ?? []).length, 1, 'มีแค่แถว inquiry ที่เติมคอลัมน์เสริม')

  const form = await read('src/pages/CitizenForm.jsx')
  assert.match(form, new RegExp(`\\n  ${INQUIRY_FORM_TYPE}: \\{\\n    label: INQUIRY_LABEL,`), 'FORM_TYPE_CONFIG ต้องมีคีย์ตรงกับ INQUIRY_FORM_TYPE')
  assert.match(form, new RegExp(`categories: \\[\\n\\s+\\{ value: '${INQUIRY_CATEGORY}', label:`), 'หมวดเดียวคือ inquiry')
})

await test('ปุ่มโหลดค่าเริ่มต้น: ทุกแถวมีคีย์คอลัมน์เสริมครบ (supabase-js เติมคีย์ที่ขาดเป็น NULL → NOT NULL ล้มทั้งชุด)', async () => {
  const admin = await read('src/pages/AdminDashboard.jsx')
  assert.match(
    admin,
    /is_adhoc: false, requires_resolved_location: true,\r?\n\s+\.\.\.d, text_color: d\.textColor/,
    'ค่าตั้งต้นต้องมาก่อน ...d เพื่อให้แถว inquiry ทับด้วยของตัวเองได้',
  )
  // requires_manual_intake มาจาก SEED_MANUAL_INTAKE (#753) ทับท้ายสุดทุกแถว — ต้องไม่หลุดจากการ normalize
  assert.match(admin, /requires_manual_intake: SEED_MANUAL_INTAKE\.has\(d\.value\),\r?\n\s+\}\)\)/)
  // ค่าตั้งต้นต้องเท่ากับ DEFAULT ของคอลัมน์จริงใน migration
  assert.match(await read('supabase/migrations/20260827090000_add_complaint_category_is_adhoc.sql'), /is_adhoc boolean not null default false/)
  assert.match(await read('supabase/migrations/20260915100000_complaint_auto_receive_columns.sql'), /requires_manual_intake boolean NOT NULL DEFAULT false/)
  assert.match(await read('supabase/migrations/20260915110000_complaint_finish_columns.sql'), /requires_resolved_location boolean NOT NULL DEFAULT true/)
  assert.match(admin, /upsert\(rows, \{ onConflict: 'municipality_id,value' \}\)/)
})

// ── 2) ตัวช่วยล้วน ────────────────────────────────────────────────────────────────────────────
await test('isInquiryCategory รับเฉพาะรหัส inquiry เป๊ะ · inquiryOr คืนข้อความเดิมให้หมวดอื่นเสมอ', () => {
  assert.equal(isInquiryCategory('inquiry'), true)
  for (const other of ['grievance', 'corruption', 'other', 'Inquiry', 'inquiry ', '', null, undefined, 0])
    assert.equal(isInquiryCategory(other), false, String(other))
  assert.equal(inquiryOr('inquiry', 'ปกติ', 'สอบถาม'), 'สอบถาม')
  for (const other of ['grievance', 'road', '', null, undefined]) assert.equal(inquiryOr(other, 'ปกติ', 'สอบถาม'), 'ปกติ')
  assert.equal(inquiryFormPath(), '/request?form=inquiry')
})

await test('ลิงก์การ์ดชี้ route จริงของ CitizenForm และพารามิเตอร์ที่ฟอร์มอ่าน', async () => {
  const app = await read('src/App.jsx')
  assert.match(app, /<Route path="\/request" element=\{<CitizenForm \/>\} \/>/)
  const form = await read('src/pages/CitizenForm.jsx')
  assert.match(form, /searchParams\.get\('form'\)/)
  assert.ok(inquiryFormPath().startsWith('/request?form='))
})

// ── 3) การ์ดบน /contact ──────────────────────────────────────────────────────────────────────
await test('shouldShowInquiryCard: ขึ้นเมื่อมีแถว+เปิด+ยื่นได้เท่านั้น (ไม่มีแถว/ปิด/เฉพาะผู้มีตำแหน่ง/ยังไม่รู้ผล = ไม่ขึ้น)', () => {
  const open = { value: 'inquiry', is_active: true, submit_audience: 'public' }
  assert.equal(shouldShowInquiryCard(open, canSubmitCategory, null), true, 'ประชาชนที่ไม่ล็อกอินยื่นได้')
  assert.equal(shouldShowInquiryCard(open, canSubmitCategory, 'citizen'), true)
  assert.equal(shouldShowInquiryCard(null, canSubmitCategory, null), false, 'ยังไม่มีแถว/ยังโหลดไม่เสร็จ (useComplaintCategoryOpen จะคืน true ตรงนี้ — ห้ามใช้)')
  assert.equal(shouldShowInquiryCard(undefined, canSubmitCategory, null), false)
  assert.equal(shouldShowInquiryCard({ ...open, is_active: false }, canSubmitCategory, 'admin'), false, 'ปิดอยู่ = ไม่ขึ้นแม้เป็นผู้มีตำแหน่ง')
  assert.equal(shouldShowInquiryCard({ ...open, is_active: undefined }, canSubmitCategory, null), false)
  const officials = { ...open, submit_audience: 'officials' }
  assert.equal(shouldShowInquiryCard(officials, canSubmitCategory, null), false)
  assert.equal(shouldShowInquiryCard(officials, canSubmitCategory, 'citizen'), false)
  assert.equal(shouldShowInquiryCard(officials, canSubmitCategory, 'staff'), true)
  assert.equal(shouldShowInquiryCard({ ...open, value: 'grievance' }, canSubmitCategory, null), false, 'แถวของหมวดอื่นห้ามทำให้การ์ดขึ้น')
})

await test('ContactPage: ตรวจจากแถวจริงด้วยตัวเอง ไม่ใช้ useComplaintCategoryOpen · ไม่ทำให้ข้อมูลเดิมในหน้าหาย', async () => {
  const page = await read('src/pages/ContactPage.jsx')
  assert.ok(!/import[^\n]*useComplaintCategoryOpen/.test(page) && !page.includes('useComplaintCategoryOpen('), 'ห้ามเรียก hook ที่คืน true เมื่อไม่มีแถว')
  assert.match(page, /from\('complaint_categories'\)\.select\('value, is_active, submit_audience'\)/)
  assert.match(page, /\.eq\('value', INQUIRY_CATEGORY\)/)
  assert.match(page, /shouldShowInquiryCard\(inquiryRow, canSubmitCategory, role\)/)
  assert.match(page, /\{showInquiryCard && \(/)
  assert.match(page, /navigate\(inquiryFormPath\(\)\)/)
  for (const keep of ['ข้อมูลการติดต่อ', 'หมายเลขภายใน', 'แผนที่ตั้งหน่วยงาน']) assert.ok(page.includes(keep), keep)
})

// ── 4) หมวดอื่นต้องไม่ถูกเปลี่ยนป้าย ────────────────────────────────────────────────────────────
await test('buildTrackSteps: เฉพาะ inquiry ที่ขั้นสุดท้ายเป็น "ตอบแล้ว" — หมวดอื่น/ไม่มีหมวด/หมวดคล้ายชื่อ = "ดำเนินการแล้ว"', () => {
  // หน้า /t/ เรียก relabelInquirySteps(buildTrackSteps(data), data.category) — เทสต์ประกอบสองตัวเหมือนหน้าจริง
  const steps = complaint => relabelInquirySteps(buildTrackSteps(complaint), complaint.category)
  const finished = category => steps({ category, status: 'closed', created_at: '2026-11-01T01:00:00Z', closed_at: '2026-11-03T01:00:00Z' })
  const last = steps => steps[steps.length - 1]
  assert.equal(last(finished('inquiry')).label, INQUIRY_DONE_LABEL)
  assert.equal(last(finished('inquiry')).state, 'done')
  for (const other of ['grievance', 'corruption', 'road', 'other', 'inquiry_x', 'Inquiry', undefined, null])
    assert.equal(last(finished(other)).label, 'ดำเนินการแล้ว', String(other))
  // ขั้นอื่น/โครงขั้นไม่เปลี่ยน
  assert.deepEqual(finished('inquiry').map(s => s.label), ['รับเรื่องแล้ว', 'กำลังดำเนินการ', INQUIRY_DONE_LABEL])
  assert.deepEqual(finished('road').map(s => s.label), ['รับเรื่องแล้ว', 'กำลังดำเนินการ', 'ดำเนินการแล้ว'])
  // ยังไม่ปิดเรื่อง: ขั้นสุดท้ายของ inquiry ก็ยังเป็น todo ไม่ใช่ done
  const pending = steps({ category: 'inquiry', status: 'in_progress', created_at: '2026-11-01T01:00:00Z' })
  assert.equal(last(pending).state, 'todo')
  // ไม่ตอบ/ไม่ดำเนินการ/ขึ้นทะเบียนรอดำเนินการ ยังเป็นถ้อยคำเดิม (ไม่ใช่ขั้นปิดเรื่องปกติ)
  const rejected = steps({ category: 'inquiry', status: 'rejected', created_at: '2026-11-01T01:00:00Z' })
  assert.equal(last(rejected).label, 'ไม่สามารถดำเนินการได้')
  const parked = steps({ category: 'inquiry', status: 'parked', created_at: '2026-11-01T01:00:00Z' })
  assert.deepEqual(parked, buildTrackSteps({ category: 'inquiry', status: 'parked', created_at: '2026-11-01T01:00:00Z' }))
  // หมวดอื่นได้อาร์เรย์ตัวเดิมกลับมา (ไม่ clone ไม่แก้)
  const raw = buildTrackSteps({ category: 'road', status: 'closed', created_at: '2026-11-01T01:00:00Z' })
  assert.equal(relabelInquirySteps(raw, 'road'), raw)
  assert.equal(relabelInquirySteps(null, 'inquiry'), null)
  // buildTrackSteps ต้องไม่ถูกแตะ: ยังไม่รู้จักหมวด (relabel ทำที่หน้า /t/)
  assert.equal(last(buildTrackSteps({ category: 'inquiry', status: 'closed', created_at: '2026-11-01T01:00:00Z' })).label, 'ดำเนินการแล้ว')
})

await test('ชื่อมาตรฐานของหมวด inquiry ใน complaintCategoryLabels.js ตรงป้ายหลัก (ไม่ตกเป็นรหัสดิบบนใบพิมพ์/หน้าจอ)', () => {
  assert.equal(STANDARD_CATEGORY_LABEL.inquiry, INQUIRY_LABEL)
  assert.equal(printableCategoryLabel('inquiry', 'inquiry'), INQUIRY_LABEL)
  assert.equal(categoryNameOf({}, 'inquiry'), INQUIRY_LABEL)
})

await test('หน้าติดตาม /t/ · คำร้องของฉัน · กล่องปิดเรื่อง: เปลี่ยนถ้อยคำเฉพาะ inquiry หมวดอื่นคงข้อความเดิม', async () => {
  const track = await read('src/pages/TrackComplaint.jsx')
  assert.match(track, /isInquiryCategory\(data\.category\) \? INQUIRY_ANSWER_HEADING : 'บันทึกจากเจ้าหน้าที่'/)
  assert.match(track, /relabelInquirySteps\(buildTrackSteps\(data\), data\.category\)/)

  const mine = await read('src/pages/MyComplaints.jsx')
  assert.match(mine, /isInquiryCategory\(c\.category\) \? INQUIRY_ANSWER_HEADING : 'บันทึกจากเจ้าหน้าที่'/)
  assert.match(mine, /isInquiryCategory\(complaint\?\.category\) && \(STATUS_COMPAT\[status\] \?\? status\) === 'closed' \? INQUIRY_DONE_LABEL : s\.label/)
  assert.match(mine, /<StatusStepper status=\{c\.status\} category=\{c\.category\} \/>/)
  assert.match(mine, /: 'คำร้องนี้ดำเนินการแล้ว'/)
  // ตารางสถานะเดิมต้องอยู่ครบ ไม่ถูกแก้ตรงๆ
  assert.match(mine, /closed:\s+\{ label: 'ดำเนินการแล้ว', {2}bg: '#d1fae5'/)
  assert.match(mine, /closed:\s+\{ label: 'ดำเนินการแล้ว', {2}desc: 'ผู้รับผิดชอบดำเนินการแล้ว ถ้ายังไม่เรียบร้อยแจ้งกลับได้ภายใน 7 วัน' \}/)

  const dialog = await read('src/components/complaints/FinishComplaintDialog.jsx')
  assert.match(dialog, /const inquiry = isInquiryCategory\(complaint\?\.category\)/)
  assert.match(dialog, /: 'บันทึก "ดำเนินการแล้ว"'/)
  assert.match(dialog, /: 'บันทึกผลการดำเนินงาน \(ไม่บังคับ\)'/)
  assert.match(dialog, /: 'ยืนยันดำเนินการแล้ว'/)
  assert.match(dialog, /: 'ผู้ร้องจะได้รับแจ้งผล และแจ้งกลับได้ภายใน 7 วันถ้ายังไม่เรียบร้อย'/)
  // ซ่อนหมุดเฉพาะ inquiry ที่ DB ไม่บังคับหมุด — ถ้าบังคับต้องยังปักได้ ไม่งั้นปิดเรื่องไม่ได้
  assert.match(dialog, /const showPin = !\(inquiry && !requiresPin\)/)
  // ไม่เพิ่มช่องกรอก: ยังมี textarea ตัวเดียว (ช่องบันทึกผลเดิม)
  assert.equal((dialog.match(/<textarea/g) ?? []).length, 1)
})

// ── 5) ฟอร์มประชาชน ─────────────────────────────────────────────────────────────────────────
await test('CitizenForm: inquiry ไม่บังคับสถานที่ · ซ่อนสถานที่/แผนที่/รูป · ยังบังคับชื่อ เบอร์ รายละเอียด · หมวดอื่นคงเดิม', async () => {
  const form = await read('src/pages/CitizenForm.jsx')
  // validateVillage ไม่บังคับให้ inquiry เท่านั้น
  assert.match(form, /function validateVillage\(form\) \{\n[^\n]*\n\s+if \(isInquiryCategory\(form\.category\)\) return null\n\s+if \(!form\.village\.trim\(\)\) \{/)
  assert.match(form, /'กรุณากรอกสถานที่'/)
  assert.match(form, /'กรุณาเลือกสถานที่'/)
  // ซ่อน 3 ส่วน
  assert.equal((form.match(/\{!isInquiry && \(<>/g) ?? []).length, 2, 'ช่องสถานที่ 1 + แผนที่/รูป 1')
  const hiddenA = form.slice(form.indexOf('{!isInquiry && (<>'), form.indexOf('{/* Phone */}'))
  assert.ok(hiddenA.includes('OTHER_VILLAGE') && hiddenA.includes('required'), 'ช่องสถานที่อยู่ในส่วนที่ซ่อน')
  const hiddenB = form.slice(form.lastIndexOf('{!isInquiry && (<>'), form.indexOf('{/* Error */}'))
  assert.ok(hiddenB.includes('setShowMap(true)') && hiddenB.includes('handlePhotoPick'), 'แผนที่+รูปอยู่ในส่วนที่ซ่อน')
  // ชื่อ เบอร์ รายละเอียดยังบังคับ (ไม่อยู่ในส่วนที่ซ่อน และด่าน validate เดิมยังอยู่ทั้ง 2 จุด)
  assert.ok(!hiddenA.includes('form.phone') && !hiddenB.includes('form.phone'))
  assert.equal((form.match(/กรุณากรอกชื่อ-นามสกุล/g) ?? []).length, 2)
  assert.equal((form.match(/กรุณากรอกเบอร์โทรติดต่อ/g) ?? []).length, 2)
  assert.equal((form.match(/const detailErr = validateDetail\(form\)/g) ?? []).length, 2)
  assert.match(form, /<textarea value=\{form\.detail\} onChange=\{set\('detail'\)\} rows=\{2\} required maxLength=\{5000\}/)
  // หน้าทวนก่อนส่งไม่ขึ้นพิกัด/สถานที่/ปุ่มปักหมุดให้ inquiry
  assert.match(form, /summary=\{isInquiry \? \[/)
  assert.match(form, /\n\s+inquiry=\{isInquiry\}/, 'ต้องส่ง inquiry เข้าหน้าทวน (หน้าทวนซ่อนกล่องเตือนปักหมุดเอง)')
  // ปุ่มส่ง/ชื่อหน้า
  assert.equal(INQUIRY_FORM.submit, 'ส่งคำถาม')
  assert.equal(INQUIRY_FORM.placeholder, 'พิมพ์คำถามหรือเรื่องที่ต้องการติดต่อ...')
  assert.match(form, /if \(isInquiryCategory\(category\)\) \{\n\s+return \{ title: INQUIRY_FORM\.title, submit: INQUIRY_FORM\.submit \}/)
  // ถ้อยคำเดิมของหมวดอื่นต้องอยู่ครบ
  for (const keep of [
    "'ส่งเรื่องร้องเรียน/ร้องทุกข์'", "'ส่งเรื่องร้องทุกข์'", "'ส่งเรื่องแจ้งกลิ่นเหม็น'", "'ส่งคำร้อง'",
    "'ส่งคำร้องสำเร็จ!'", "'ติดตามสถานะคำร้อง'",
    'มีความจำเป็นต้องเก็บรวบรวมข้อมูลส่วนบุคคลของท่านเพื่อดำเนินการตามคำร้องที่ยื่นมา',
    'รายละเอียดคำร้องและประเภทปัญหา', 'ตำแหน่งที่ตั้ง (หากให้ความยินยอม)', 'ตรวจสอบและแก้ไขปัญหาตามคำร้อง',
    'ไม่ต้องเข้าสู่ระบบก็ยื่นได้ — กรอกชื่อและเบอร์ติดต่อเพื่อให้เจ้าหน้าที่ตามงานได้',
  ]) assert.ok(form.includes(keep), keep)
})

await test('p_form_type ที่ส่งเข้า rpc สำหรับ inquiry ต้องอยู่ในชุด CHECK ของ complaints.form_type (042) — ส่ง inquiry ตรงๆ = 23514 ทุกคำถาม', async () => {
  const ddl = await read('supabase/migrations/042_add_form_type_to_complaints.sql')
  const check = ddl.match(/CHECK \(form_type IN \(([^)]*)\)\)/)
  assert.ok(check, 'ไม่พบ CHECK ของ form_type ใน 042')
  const allowed = [...check[1].matchAll(/'([^']+)'/g)].map(m => m[1])
  assert.ok(allowed.includes('legacy'))
  assert.ok(!allowed.includes(INQUIRY_FORM_TYPE), 'ถ้าวันหนึ่ง CHECK รับ inquiry แล้ว ค่อยเลิกบังคับส่ง legacy ได้ — แก้เทสต์นี้พร้อมกัน')

  // ดึงนิพจน์ที่ส่งเข้า p_form_type จากซอร์สจริง แล้วคำนวณค่าด้วยอินพุตของ inquiry ทุกทาง
  const form = await read('src/pages/CitizenForm.jsx')
  const expr = form.match(/p_form_type:\s+(.+),\n/)?.[1]
  assert.ok(expr, 'ไม่พบ p_form_type ใน CitizenForm')
  const sent = (category, formType) => new Function('isInquiryCategory', 'INQUIRY_FORM_TYPE', 'form', 'formType', `return ${expr}`)(
    isInquiryCategory, INQUIRY_FORM_TYPE, { category }, formType)
  for (const [category, formType] of [['inquiry', 'inquiry'], ['inquiry', 'legacy'], ['inquiry', 'infrastructure'], ['other', 'inquiry']]) {
    assert.ok(allowed.includes(sent(category, formType)), `category=${category} form=${formType} ส่ง "${sent(category, formType)}" ซึ่งไม่อยู่ใน CHECK`)
  }
  assert.equal(sent('inquiry', 'inquiry'), 'legacy')
  // ฟอร์มอื่นส่งค่าเดิมเหมือนก่อนแก้
  assert.equal(sent('road', 'infrastructure'), 'infrastructure')
  assert.equal(sent('trash', 'environment'), 'environment')
  assert.equal(sent('water_supply', 'water_support'), 'water_support')
  assert.equal(sent('grievance', 'legacy'), 'legacy')
})

await test('ComplaintReviewSheet (เรนเดอร์จริง): inquiry ใช้ถ้อยคำสอบถาม · ค่าเริ่มต้นคงข้อความเดิมทุกตัวอักษร', async () => {
  const server = await createServer({
    root, configFile: false, logLevel: 'silent', appType: 'custom', esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, watch: null },
  })
  try {
    const { default: Sheet } = await server.ssrLoadModule('/src/components/complaints/ComplaintReviewSheet.jsx')
    const base = { summary: [{ label: 'ประเภท', value: 'x' }], detail: 'ขอสอบถามเรื่องเอกสาร', orgName: 'เทศบาลตำบลทดสอบ', submitLabel: 'ส่ง' }
    const normal = renderToStaticMarkup(createElement(Sheet, base))
    assert.ok(normal.includes('ข้อความคำร้องที่จะส่ง'))
    assert.ok(normal.includes('เก็บข้อมูลส่วนบุคคลเพื่อดำเนินการตามคำร้อง'))
    assert.ok(!normal.includes('คำถาม'))
    const inquiry = renderToStaticMarkup(createElement(Sheet, { ...base, inquiry: true }))
    assert.ok(inquiry.includes(INQUIRY_FORM.summaryHeading))
    assert.ok(inquiry.includes('เก็บข้อมูลส่วนบุคคลเพื่อ' + INQUIRY_FORM.consent))
    assert.ok(!inquiry.includes('คำร้อง'), 'หน้าทวนของ inquiry ต้องไม่มีคำว่าคำร้อง')
    // ยังไม่ปักหมุด: หมวดอื่นขึ้นกล่องเตือน · inquiry ไม่ขึ้น (คำถามไม่มีหน้างาน)
    const withPin = renderToStaticMarkup(createElement(Sheet, { ...base, onAddPin: () => {} }))
    assert.ok(withPin.includes('ปักหมุดตอนนี้'))
    assert.ok(!renderToStaticMarkup(createElement(Sheet, { ...base, onAddPin: () => {}, inquiry: true })).includes('ปักหมุด'))
    const empty = renderToStaticMarkup(createElement(Sheet, { ...base, detail: '  ', inquiry: true }))
    assert.ok(empty.includes(INQUIRY_FORM.emptyDetail))
  } finally {
    await server.close()
  }
})

// ── 6) ถ้อยคำฝั่งผู้สอบถาม ──────────────────────────────────────────────────────────────────
await test('ถ้อยคำฝั่งผู้สอบถามไม่ใช่ "ร้องเรียน/ร้องทุกข์/ดำเนินการแล้ว" และไม่อ้างมาตรา/ระเบียบ', () => {
  const asker = {
    ...INQUIRY_FORM, ...INQUIRY_CARD, ...INQUIRY_PDPA, INQUIRY_ANSWER_HEADING, INQUIRY_DONE_LABEL, INQUIRY_DONE_DESC,
    pdpaCollected: INQUIRY_PDPA.collected.join(' '), pdpaPurposes: INQUIRY_PDPA.purposes.join(' '),
  }
  for (const [key, text] of Object.entries(asker)) {
    if (typeof text !== 'string') continue
    assert.ok(!/ร้องเรียน|ร้องทุกข์|คำร้อง/.test(text), `${key}: ใช้คำว่าคำร้อง/ร้องเรียนไม่ได้ — "${text}"`)
    assert.ok(!/ดำเนินการแล้ว|แก้ไขแล้ว/.test(text), `${key}: "${text}"`)
    assert.ok(!/มาตรา|ระเบียบ|พ\.ร\.บ|พ\.ศ\./.test(text), `${key}: ห้ามเดาเลขมาตรา/ชื่อระเบียบ — "${text}"`)
  }
  assert.equal(INQUIRY_STAFF.answerLabel, 'คำตอบถึงผู้สอบถาม')
  assert.equal(INQUIRY_ANSWER_HEADING, 'คำตอบจากเจ้าหน้าที่')
  assert.ok(INQUIRY_STAFF.dialogHint.includes('หน้าติดตาม'))
  assert.ok(INQUIRY_STAFF.answerHint.includes('หน้าติดตาม'))
  assert.equal(INQUIRY_CARD.heading, 'ส่งคำถามถึงเจ้าหน้าที่')
  // เจ้าของเลือก 2569-11-17: ต้องล็อกอินก่อนส่ง (ผู้ไม่ล็อกอินอ่านคำตอบในระบบไม่ได้) — ไม่มีถ้อยคำสำหรับผู้เยี่ยมชมแล้ว
  assert.equal(INQUIRY_FORM.guestNotice, undefined)
  assert.equal(INQUIRY_FORM.successBodyGuest, undefined)
  assert.ok(INQUIRY_LOGIN_GATE.body.includes('เข้าสู่ระบบ') && INQUIRY_LOGIN_GATE.button.includes('เข้าสู่ระบบ'))
})

await test('ฟอร์มสอบถามบังคับล็อกอิน: หน้า gate เฉพาะ session===null + ด่านซ้ำใน handleSubmit', async () => {
  const src = await read('src/pages/CitizenForm.jsx')
  assert.ok(/if \(isInquiry && authSession === null\)/.test(src), 'ต้องแยกหน้า gate เฉพาะ authSession === null (undefined = กำลังโหลด ห้ามแวบ)')
  assert.ok(src.includes('data-inquiry-login-gate'))
  assert.ok(/state: \{ from: inquiryFormPath\(\) \}/.test(src), 'ต้องพากลับมาฟอร์มสอบถามหลังล็อกอิน')
  assert.ok(/isInquiryCategory\(form\.category\) && !isLoggedIn/.test(src), 'handleSubmit ต้องมีด่านซ้ำ')
  assert.ok(!src.includes('guestNotice') && !src.includes('successBodyGuest'))
})

await test('ไฟล์ inquiry.js เป็นฟังก์ชันล้วน ไม่ import supabase', async () => {
  const src = await read('src/lib/inquiry.js')
  assert.ok(!/^import /m.test(src), 'ไม่มี import ใดเลย')
})

console.log(`\nครบ ${cases} กลุ่ม`)
