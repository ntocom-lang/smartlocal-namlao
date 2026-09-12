// เทสต์ข้อความแจ้งเตือน Telegram ของ supabase/functions/notify-telegram/index.ts
// รันด้วย: node tests/telegram-notification-message.test.mjs
//
// ที่มา: เดิมคำขอเอกสารทั้ง 4 ชนิดส่งข้อความตายตัวบรรทัดเดียวเหมือนกันหมด
// ("📄 มีคำขอเอกสารใหม่ / กรุณาเข้าสู่ระบบ SmartLocal เพื่อดูรายละเอียดตามสิทธิ์")
// ผู้ดูแลที่เห็นในกลุ่มแยกไม่ออกว่าใบไหนเรื่องอะไร ของที่ไหน เมื่อไร ต้องไล่เปิดระบบทุกครั้ง
//
// เทสต์นี้คุม 2 เรื่องที่พังเงียบได้:
// (1) ตัวแปลชื่อประเภทเอกสารใน edge function คัดลอกมาจาก src/lib/documentTypes.js — เพิ่ม
//     ประเภทใหม่ฝั่ง client แล้วลืมแก้ฝั่ง edge function ข้อความจะขึ้นค่าดิบ 'dog_vaccine'
// (2) ⚠️ PDPA — ข้อความออกไปอยู่บนเซิร์ฟเวอร์ Telegram ลบย้อนหลังไม่ได้และไม่ผ่านการควบคุม
//     สิทธิ์ของระบบ ห้ามมีชื่อ/เบอร์/ที่อยู่/เลขบัตรของประชาชนหลุดเข้าไปเด็ดขาด
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { BASE_DOCUMENT_TYPES } from '../src/lib/documentTypes.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const edgeFnPath = path.join(root, 'supabase/functions/notify-telegram/index.ts')
const source = readFileSync(edgeFnPath, 'utf8')

// ─────────────────────────────────────────────────────────────────────────────
// (2) ด่าน PDPA — ตรวจที่ตัวไฟล์ ไม่ใช่ที่ผลลัพธ์ เพราะคอลัมน์ที่ไม่ได้ select มาก็เอามาใส่
// ข้อความไม่ได้อยู่แล้ว ถ้ามีชื่อคอลัมน์พวกนี้โผล่ในไฟล์แปลว่ามีคนกำลังจะดึงมันออกไป
// ─────────────────────────────────────────────────────────────────────────────
const FORBIDDEN_COLUMNS = [
  'requester_name', 'requester_phone', 'requester_address', 'requester_id_card',
  'reporter_name', 'staff_notes', 'permit_form_data',
]
// ตัดคอมเมนต์ออกก่อนตรวจ — คอมเมนต์กติกา PDPA ในไฟล์เองก็เอ่ยชื่อคอลัมน์พวกนี้
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
for (const column of FORBIDDEN_COLUMNS) {
  assert.equal(
    code.includes(column), false,
    `⚠️ PDPA: notify-telegram ห้ามแตะคอลัมน์ข้อมูลส่วนบุคคล '${column}' — ` +
    'ข้อความที่ส่งเข้ากลุ่ม Telegram ลบย้อนหลังไม่ได้ ให้เข้าไปดูในระบบตามสิทธิ์แทน',
  )
}

// ห้ามมีลิงก์เข้าระบบท้ายข้อความ — เจ้าของระบบเห็นของจริงในกลุ่มแล้วสั่งถอดออก 2569-09-12
// จะเพิ่มกลับต้องถามก่อน ไม่ใช่เพิ่มเองเพราะคิดว่ามีประโยชน์
// (ตัดบรรทัด import ออกก่อน — ตัว import ของ Deno เองเป็น URL https)
assert.equal(
  /rk-networks\.com|https?:\/\//.test(code.replace(/^import .*$/gm, '')), false,
  'ข้อความแจ้งเตือน Telegram ต้องไม่มีลิงก์เข้าระบบ — เจ้าของระบบสั่งถอดออกแล้ว',
)

// ─────────────────────────────────────────────────────────────────────────────
// โหลด edge function มารันใน Node: แทน import ฝั่ง Deno ด้วย stub แล้วให้ Node strip type เอง
// (type stripping เป็นค่าเริ่มต้นตั้งแต่ Node 22.18/23.6 — ไม่ต้องพึ่ง esbuild/tsc)
// ⚠️ ห้ามใส่ enum/namespace/parameter property ลง index.ts ไม่งั้น Node strip ไม่ผ่าน
// ─────────────────────────────────────────────────────────────────────────────
const work = mkdtempSync(path.join(tmpdir(), 'notify-telegram-'))
let mod
try {
  const stubbed = source
    .replace(/^import \{ serve \}.*$/m, 'const serve = () => {}')
    .replace(/^import \{ createClient \}.*$/m, 'const createClient = () => ({})')
    .replace(/^import \{ sendTelegramMessage.*$/m,
      'const sendTelegramMessage = async () => ({ ok: true, attempts: 1 })\n'
      + 'type TelegramSendResult = { ok: boolean; attempts: number; error?: string; messageId?: unknown }')
  const probe = path.join(work, 'probe.mts')
  writeFileSync(probe, `${stubbed}\nexport {\n`
    + '  buildComplaintCreatedMessage, buildComplaintStatusMessage,\n'
    + '  buildDocumentRequestCreatedMessage, buildDocumentRequestStatusMessage,\n'
    + '  buildFeeVerifiedMessage, documentTypeLabel,\n}\n')
  // BOT_TOKEN ถูกอ่านตอน import module — ต้องมี Deno.env ก่อนโหลด
  globalThis.Deno = { env: { get: () => '' } }
  mod = await import(pathToFileURL(probe).href)
} finally {
  rmSync(work, { recursive: true, force: true })
}

const {
  buildComplaintCreatedMessage, buildComplaintStatusMessage,
  buildDocumentRequestCreatedMessage, buildDocumentRequestStatusMessage,
  buildFeeVerifiedMessage, documentTypeLabel,
} = mod

// ─────────────────────────────────────────────────────────────────────────────
// (1) ชื่อประเภทเอกสารต้องตรงกับ src/lib/documentTypes.js ทุกตัว ทุกคำ รวมอีโมจินำหน้า
// ─────────────────────────────────────────────────────────────────────────────
for (const { value, label } of BASE_DOCUMENT_TYPES) {
  assert.equal(
    documentTypeLabel(value, null), label,
    `ชื่อประเภท '${value}' ใน notify-telegram ไม่ตรงกับ BASE_DOCUMENT_TYPES — แก้ที่ DOCUMENT_TYPE_LABEL`,
  )
}
// ประเภทเก่าที่ถอดออกจากลิสต์ยื่นใหม่แล้ว แต่คำขอเก่ายังอยู่ในระบบและยังเปลี่ยนสถานะได้
assert.match(documentTypeLabel('residence_cert', null), /ใบรับรองการอยู่อาศัย/)
assert.match(documentTypeLabel('personal_cert', null), /หนังสือรับรองบุคคล/)
// ประเภทที่ อปท. เพิ่มเองผ่านแท็บ "ประเภทคำขอเอกสาร"
assert.equal(
  documentTypeLabel('dog_vaccine', { _custom_types: [{ value: 'dog_vaccine', label: 'ขอรับวัคซีนสุนัข', emoji: '🐕' }] }),
  '🐕 ขอรับวัคซีนสุนัข',
)
assert.equal(documentTypeLabel('dog_vaccine', { _custom_types: [{ value: 'dog_vaccine', label: 'ขอรับวัคซีนสุนัข' }] }),
  '📋 ขอรับวัคซีนสุนัข')
// ประเภทที่ไม่รู้จักต้องไม่ขึ้นค่าดิบให้ผู้ดูแลงง และต้องไม่ทำข้อความพัง
assert.equal(documentTypeLabel(null, null), '📋 ไม่ระบุประเภท')

// ─────────────────────────────────────────────────────────────────────────────
// เนื้อข้อความ — ต้องตอบได้ว่า "เรื่องอะไร ที่ไหน เมื่อไร" โดยไม่ต้องเปิดระบบก่อน
// ─────────────────────────────────────────────────────────────────────────────
const request = {
  id: 'a1b2c3d4-1111-4222-8333-444455556666',
  document_type: 'water_supply_request',
  status: 'processing',
  created_at: '2026-09-12T12:32:00Z',   // 19:32 น. ตามเวลาไทย
  updated_at: '2026-09-12T13:50:00Z',
  payment_verified_at: '2026-09-12T14:10:00Z',
  fee_amount: 200,
  department: { name: 'กองช่าง', code: 'engineering' },
}
const complaint = {
  id: 'c0ffee00-1111-4222-8333-444455556666',
  ref_no: 'ES-69-0030',
  category: 'light',
  village: 'หมู่ 3 ซอยข้างวัด',
  status: 'in_progress',
  created_at: '2026-09-12T12:32:00Z',
  updated_at: '2026-09-12T16:13:00Z',   // 23:13 น. ตามเวลาไทย
  department: { name: 'กองช่าง', code: 'engineering' },
  category_ref: { label: 'ไฟฟ้าสาธารณะ', emoji: '💡' },
}

const created = buildDocumentRequestCreatedMessage(request, null)
// บรรทัดแรก = แถบสีกอง + อีโมจิประเภท + หัวเรื่อง (กองช่าง = 🟦)
assert.match(created, /^🟦 🚰 <b>มีคำขอเอกสารใหม่<\/b>$/m)
// อีโมจิอยู่หัวข้อความแล้ว บรรทัดเรื่องต้องเป็นชื่อล้วน ไม่ซ้ำอีโมจิ
assert.match(created, /^เรื่อง: ขออนุญาตใช้น้ำประปา$/m)
assert.match(created, /^ส่งถึง: กองช่าง #กองช่าง$/m)
// วันที่ต้องเป็น พ.ศ. และเวลาต้องเป็นโซนไทย ไม่ใช่ UTC (12:32Z = 19:32 น.)
assert.match(created, /ยื่นเมื่อ: 12 ก\.ย\. 2569 19:32 น\./)
assert.match(created, /อ้างอิง: #a1b2c3d4/)

const permit = buildDocumentRequestCreatedMessage(
  { ...request, document_type: 'building_permit', fee_amount: 0 }, null,
  'มีคำขออนุญาตก่อสร้างใหม่',
)
assert.match(permit, /^🟦 🏗️ <b>มีคำขออนุญาตก่อสร้างใหม่<\/b>$/m)
assert.equal(/ค่าธรรมเนียม/.test(permit), false, 'ค่าธรรมเนียม 0 บาทต้องไม่ขึ้นบรรทัดเปล่า')

const docStatus = buildDocumentRequestStatusMessage(request, null)
assert.match(docStatus, /^🟦 🚰 <b>อัปเดตสถานะคำขอเอกสาร<\/b>$/m)
assert.match(docStatus, /สถานะ: <b>กำลังดำเนินการ<\/b>/)
assert.match(docStatus, /อัปเดตเมื่อ: 12 ก\.ย\. 2569 20:50 น\./)

const fee = buildFeeVerifiedMessage(request, null)
// ข้อยกเว้นเดียว: ใบค่าธรรมเนียมใช้ 💰 ไม่ใช่อีโมจิประเภทเอกสาร เพราะสาระคือเงิน
assert.match(fee, /^🟦 💰 <b>ตรวจสอบค่าธรรมเนียมแล้ว<\/b>$/m)
assert.match(fee, /จำนวนเงิน: <b>200\.00 บาท<\/b>/)
assert.match(fee, /ตรวจสอบเมื่อ: 12 ก\.ย\. 2569 21:10 น\./)

const complaintNew = buildComplaintCreatedMessage(complaint)
assert.match(complaintNew, /^🟦 💡 <b>มีคำร้องใหม่<\/b>$/m)
assert.match(complaintNew, /เลขที่: ES-69-0030/)
assert.match(complaintNew, /^ประเภท: ไฟฟ้าสาธารณะ$/m)
assert.match(complaintNew, /^ส่งถึง: กองช่าง #กองช่าง$/m)
assert.match(complaintNew, /สถานที่: หมู่ 3 ซอยข้างวัด/)
assert.match(complaintNew, /แจ้งเมื่อ: 12 ก\.ย\. 2569 19:32 น\./)

const complaintStatus = buildComplaintStatusMessage(complaint)
assert.match(complaintStatus, /^🟦 💡 <b>อัปเดตสถานะคำร้อง<\/b>$/m)
assert.match(complaintStatus, /สถานะ: <b>กำลังดำเนินการ<\/b>/)
assert.match(complaintStatus, /อัปเดตเมื่อ: 12 ก\.ย\. 2569 23:13 น\./)

// ─────────────────────────────────────────────────────────────────────────────
// ข้อมูลไม่ครบต้องไม่ทำให้ข้อความพังหรือเหลือบรรทัดเปล่า (คำร้องเก่าก่อนมี ref_no/department_id)
// ─────────────────────────────────────────────────────────────────────────────
for (const message of [
  buildComplaintCreatedMessage({ id: 'x', category: 'odor' }),
  buildDocumentRequestCreatedMessage({ id: 'x' }, null),
  buildDocumentRequestStatusMessage({ id: 'x' }, null),
]) {
  assert.equal(message.includes('\n\n'), false, 'ต้องไม่มีบรรทัดว่างคั่น')
  assert.equal(message.trim(), message)
  assert.equal(/: *$/m.test(message), false, 'ต้องไม่มีหัวข้อที่ไม่มีค่าตามหลัง')
}

// ─────────────────────────────────────────────────────────────────────────────
// แถบสีรายกอง — ผูกกับ departments.code ไม่ใช่ชื่อ (อปท. เปลี่ยนชื่อกองได้ code คงที่)
// ─────────────────────────────────────────────────────────────────────────────
const COLOR_BY_CODE = {
  exec: '🟥', general: '🟩', finance: '🟨', engineering: '🟦', education: '🟪', health: '🟧',
}
for (const [code, square] of Object.entries(COLOR_BY_CODE)) {
  const message = buildComplaintCreatedMessage({ ...complaint, department: { name: 'กองใดกองหนึ่ง', code } })
  assert.ok(message.startsWith(`${square} `), `กอง code '${code}' ต้องขึ้นต้นด้วย ${square}`)
}
// กองที่ อปท. สร้างเอง (code ขึ้นต้น dept_) และรายการที่ยังไม่มีกอง ต้องได้สีกลาง ไม่ใช่พัง
for (const department of [{ name: 'ตรวจสอบภายใน', code: 'dept_mrrhejo0' }, { name: 'ไม่มี code' }, null]) {
  assert.ok(
    buildComplaintCreatedMessage({ ...complaint, department }).startsWith('⬜ '),
    `กองที่ไม่มีสีประจำต้องได้ ⬜: ${JSON.stringify(department)}`,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// อีโมจิ/ชื่อหมวดคำร้อง — ต้องใช้ค่าของ อปท. นั้นจาก complaint_categories ก่อนค่าสำรองเสมอ
// (เคสจริง: น้ำเลาตั้ง road = "ซ่อมแซมถนน" 🛣️ / ตำหนักธรรมตั้ง light = ⚡ ไม่ใช่ 💡)
// ─────────────────────────────────────────────────────────────────────────────
const tenantNamed = buildComplaintCreatedMessage({
  ...complaint, category: 'road', category_ref: { label: 'ซ่อมแซมถนน', emoji: '🚧' },
})
assert.match(tenantNamed, /^🟦 🚧 <b>มีคำร้องใหม่<\/b>$/m)
assert.match(tenantNamed, /^ประเภท: ซ่อมแซมถนน$/m)
// คำร้องเก่าที่ category_id ยังว่าง (มีจริงในระบบ) ต้องตกมาที่ค่าสำรอง ไม่ใช่ขึ้นค่าดิบ
const legacy = buildComplaintCreatedMessage({ ...complaint, category: 'tree', category_ref: null })
assert.match(legacy, /^🟦 🌳 <b>มีคำร้องใหม่<\/b>$/m)
assert.match(legacy, /^ประเภท: ต้นไม้\/สวนสาธารณะ$/m)
// หมวดที่ไม่รู้จักเลย ต้องยังส่งออกได้ ไม่ใช่ข้อความพัง
const unknownCategory = buildComplaintCreatedMessage({ ...complaint, category: 'cat_zzz', category_ref: null })
assert.match(unknownCategory, /^🟦 📝 <b>มีคำร้องใหม่<\/b>$/m)
assert.match(unknownCategory, /^ประเภท: cat_zzz$/m)

// ─────────────────────────────────────────────────────────────────────────────
// แฮชแท็กชื่อกอง — Telegram ตัดแท็กทันทีที่เจออักขระที่ไม่ใช่ตัวอักษร/ตัวเลข/ขีดล่าง
// ชื่อกองที่มีเว้นวรรค จุด หรือวงเล็บ ต้องถูกตัดอักขระพวกนั้นทิ้งก่อน ไม่ใช่ปล่อยให้แท็กขาดกลางคัน
// ─────────────────────────────────────────────────────────────────────────────
const hashtagOf = (name) => {
  const line = buildComplaintCreatedMessage({ ...complaint, department: { name, code: 'general' } })
    .split('\n').find((l) => l.startsWith('ส่งถึง: '))
  return line?.match(/#\S+/)?.[0] ?? ''
}
assert.equal(hashtagOf('กองช่าง'), '#กองช่าง')
assert.equal(hashtagOf('กองการศึกษา ศาสนาและวัฒนธรรม'), '#กองการศึกษาศาสนาและวัฒนธรรม')
assert.equal(hashtagOf('กองช่าง (สาขา 2)'), '#กองช่างสาขา2')
assert.equal(hashtagOf('สำนัก/ปลัด'), '#สำนักปลัด')
// ชื่อกองที่เหลือแต่อักขระพิเศษ ต้องไม่ออกมาเป็น '#' โดดๆ
assert.equal(
  /#/.test(buildComplaintCreatedMessage({ ...complaint, department: { name: '- / -', code: 'general' } })),
  false,
)

// HTML parse_mode ของ Telegram — ข้อความที่ประชาชนพิมพ์เองต้องถูก escape ไม่งั้นบอทส่งไม่ออก
const injected = buildComplaintCreatedMessage({ ...complaint, village: '<b>x</b> & y' })
assert.match(injected, /สถานที่: &lt;b&gt;x&lt;\/b&gt; &amp; y/)

console.log('✓ telegram-notification-message: ผ่านทุกข้อ')
