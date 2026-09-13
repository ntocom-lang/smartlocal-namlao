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
import { DEPARTMENT_COLORS } from '../src/lib/departmentColors.js'

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
    + '  buildFeeVerifiedMessage, documentTypeLabel, DEPARTMENT_COLOR_EMOJI,\n'
    + '  buildFleetTripWaitlistedMessage, buildFleetFuelCreatedMessage, buildFleetTripBumpedMessage,\n'
    + '  notificationSpecs, notificationMatchesResource, idempotencyKey, FLEET_MESSAGE_BUILDERS,\n}\n')
  // BOT_TOKEN ถูกอ่านตอน import module — ต้องมี Deno.env ก่อนโหลด
  globalThis.Deno = { env: { get: () => '' } }
  mod = await import(pathToFileURL(probe).href)
} finally {
  rmSync(work, { recursive: true, force: true })
}

const {
  buildComplaintCreatedMessage, buildComplaintStatusMessage,
  buildDocumentRequestCreatedMessage, buildDocumentRequestStatusMessage,
  buildFeeVerifiedMessage, documentTypeLabel, DEPARTMENT_COLOR_EMOJI,
  buildFleetTripWaitlistedMessage, buildFleetFuelCreatedMessage, buildFleetTripBumpedMessage,
  notificationSpecs, notificationMatchesResource, idempotencyKey, FLEET_MESSAGE_BUILDERS,
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
  department: { name: 'กองช่าง', color: 'blue' },
}
const complaint = {
  id: 'c0ffee00-1111-4222-8333-444455556666',
  ref_no: 'ES-69-0030',
  category: 'light',
  village: 'หมู่ 3 ซอยข้างวัด',
  status: 'in_progress',
  created_at: '2026-09-12T12:32:00Z',
  updated_at: '2026-09-12T16:13:00Z',   // 23:13 น. ตามเวลาไทย
  department: { name: 'กองช่าง', color: 'blue' },
  category_ref: { label: 'ไฟฟ้าสาธารณะ', emoji: '💡' },
}

// เส้นคั่นบรรทัดสุดท้าย = จุดสีกอง 1 ตัว + เส้นประบาง 12 ขีด (ไม่มีเส้นบน)
const rule = (dot) => `${dot}${'┈'.repeat(12)}`

const created = buildDocumentRequestCreatedMessage(request, null)
// บรรทัดแรก = อีโมจิประเภท + หัวเรื่อง / บรรทัดสุดท้าย = เส้นคั่นสีกอง (กองช่าง = 🔵)
assert.ok(created.startsWith('🚰 <b>มีคำขอเอกสารใหม่</b>\n'), created)
assert.ok(created.endsWith(`\n${rule('🔵')}`), created)
// อีโมจิอยู่หัวข้อความแล้ว บรรทัดเรื่องต้องเป็นชื่อล้วน ไม่ซ้ำอีโมจิ
assert.match(created, /^เรื่อง: ขออนุญาตใช้น้ำประปา$/m)
assert.match(created, /^ส่งถึง: กองช่าง$/m)
// วันที่ต้องเป็น พ.ศ. และเวลาต้องเป็นโซนไทย ไม่ใช่ UTC (12:32Z = 19:32 น.)
assert.match(created, /ยื่นเมื่อ: 12 ก\.ย\. 2569 19:32 น\./)
assert.match(created, /อ้างอิง: #a1b2c3d4/)

const permit = buildDocumentRequestCreatedMessage(
  { ...request, document_type: 'building_permit', fee_amount: 0 }, null,
  'มีคำขออนุญาตก่อสร้างใหม่',
)
assert.match(permit, /^🏗️ <b>มีคำขออนุญาตก่อสร้างใหม่<\/b>$/m)
assert.equal(/ค่าธรรมเนียม/.test(permit), false, 'ค่าธรรมเนียม 0 บาทต้องไม่ขึ้นบรรทัดเปล่า')

const docStatus = buildDocumentRequestStatusMessage(request, null)
assert.match(docStatus, /^🚰 <b>อัปเดตสถานะคำขอเอกสาร<\/b>$/m)
assert.match(docStatus, /สถานะ: <b>กำลังดำเนินการ<\/b>/)
assert.match(docStatus, /อัปเดตเมื่อ: 12 ก\.ย\. 2569 20:50 น\./)

const fee = buildFeeVerifiedMessage(request, null)
// ข้อยกเว้นเดียว: ใบค่าธรรมเนียมใช้ 💰 ไม่ใช่อีโมจิประเภทเอกสาร เพราะสาระคือเงิน
assert.match(fee, /^💰 <b>ตรวจสอบค่าธรรมเนียมแล้ว<\/b>$/m)
assert.match(fee, /จำนวนเงิน: <b>200\.00 บาท<\/b>/)
assert.match(fee, /ตรวจสอบเมื่อ: 12 ก\.ย\. 2569 21:10 น\./)

// คำขอใช้รถรอจัดสรรรถ — ระบบอนุมัติอัตโนมัติไม่ได้เพราะรถมีคิวอยู่แล้ว ผู้ดูแลต้องรู้ทันที
// ข้อมูลในกลุ่มต้องพอให้ตัดสินใจได้โดยไม่ต้องเปิดระบบก่อน: รถ, เวลาไป-กลับ, ปลายทาง, ผู้ขอ
const waitlisted = buildFleetTripWaitlistedMessage({
  id: 'b7e1c2d3-0000-4000-8000-000000000001',
  status: 'waitlisted',
  destination: '[TEST] ศาลากลางจังหวัดแพร่',
  planned_departure: '2026-09-15T01:30:00.000Z', // 08:30 น. ไทย
  planned_return: '2026-09-15T09:00:00.000Z', // 16:00 น. ไทย
  vehicle: { name: '[TEST] รถกองคลัง', license_plate: 'กข 1234 แพร่' },
  requester: { full_name: '[TEST] ผู้ขอใช้รถ' },
  department: { name: 'กองคลัง', color: 'yellow' },
  waitlist_reasons: ['vehicle_busy', 'driver_tight'],
}, { buffer: 30, max_duration: 43200, past_grace: 1440 })
assert.ok(waitlisted.startsWith('🚗 <b>คำขอใช้รถรอจัดสรรรถ</b>\n'), waitlisted)
// ผู้ดูแลต้องรู้ว่าจะแก้อะไร (เปลี่ยนรถ/คนขับ/เวลา) โดยไม่ต้องเปิดระบบก่อน
assert.match(waitlisted, /^เหตุผล: รถคันนี้มีคิวทับช่วงเวลา · คิวผู้ขับรถติดกันเกินไป \(ห่างไม่ถึง 30 นาที\)$/m)
// ตัวเลขในเหตุผลมาจากกติกาใน DB (นาที) — ต้องแปลงหน่วยให้คนอ่านรู้เรื่อง และห้ามโชว์ {placeholder} ดิบ
const ruleReasons = (rules) => buildFleetTripWaitlistedMessage(
  { waitlist_reasons: ['vehicle_tight', 'past_departure', 'long_duration'] }, rules,
).match(/^เหตุผล: (.*)$/m)?.[1]
assert.equal(ruleReasons({ buffer: 30, max_duration: 43200, past_grace: 1440 }),
  'คิวรถติดกับคิวอื่นเกินไป (ห่างไม่ถึง 30 นาที) · เวลาออกย้อนหลังเกิน 1 วัน · ขอใช้รถนานเกิน 30 วัน')
assert.equal(ruleReasons({ buffer: 90, max_duration: 4320, past_grace: 0 }),
  'คิวรถติดกับคิวอื่นเกินไป (ห่างไม่ถึง 90 นาที) · เวลาออกย้อนหลังเกิน 0 นาที · ขอใช้รถนานเกิน 3 วัน')
assert.equal(ruleReasons({ buffer: 120, max_duration: null, past_grace: 'x' }),
  'คิวรถติดกับคิวอื่นเกินไป (ห่างไม่ถึง 2 ชั่วโมง) · เวลาออกย้อนหลังเกิน เวลาที่กำหนด · ขอใช้รถนานเกิน เวลาที่กำหนด')
// อ่านกติกาจาก DB ไม่ได้ แจ้งเตือนต้องยังส่งได้ และไม่เดาตัวเลข
assert.equal(ruleReasons(null),
  'คิวรถติดกับคิวอื่นเกินไป (ห่างไม่ถึง เวลาที่กำหนด) · เวลาออกย้อนหลังเกิน เวลาที่กำหนด · ขอใช้รถนานเกิน เวลาที่กำหนด')
// รหัสที่ไม่รู้จักห้ามโผล่เป็นค่าดิบ และห้ามต่อข้อความจาก DB เข้า HTML ตรงๆ
const unknownReason = buildFleetTripWaitlistedMessage({ waitlist_reasons: ['<b>hack</b>'] })
assert.match(unknownReason, /^เหตุผล: เหตุผลอื่น$/m)
assert.ok(!unknownReason.includes('hack'), unknownReason)
// รายการเก่าที่ไม่มีเหตุผลเก็บไว้ ต้องยังมีบรรทัดบอกให้ผู้ดูแลจัดสรร
assert.match(buildFleetTripWaitlistedMessage({}), /ผู้ดูแลต้องจัดสรรรถก่อนอนุมัติ/)
assert.ok(waitlisted.endsWith(`\n${rule('🟡')}`), waitlisted)
assert.match(waitlisted, /^รถ: \[TEST\] รถกองคลัง \(กข 1234 แพร่\)$/m)
assert.match(waitlisted, /^ออก: 15 ก\.ย\. 2569 08:30 น\.$/m)
assert.match(waitlisted, /^กลับ: 15 ก\.ย\. 2569 16:00 น\.$/m)
assert.match(waitlisted, /^ปลายทาง: \[TEST\] ศาลากลางจังหวัดแพร่$/m)
assert.match(waitlisted, /^ผู้ขอ: \[TEST\] ผู้ขอใช้รถ$/m)
assert.match(waitlisted, /^กอง: กองคลัง$/m)
assert.match(waitlisted, /^อ้างอิง: #b7e1c2d3$/m)
// ปลายทางเป็นข้อความที่ผู้ขอพิมพ์เอง ต้อง escape ไม่งั้น HTML parse_mode ทำให้บอทส่งไม่ออก
assert.match(
  buildFleetTripWaitlistedMessage({ destination: '<i>x</i> & y' }),
  /ปลายทาง: &lt;i&gt;x&lt;\/i&gt; &amp; y/,
)

const complaintNew = buildComplaintCreatedMessage(complaint)
assert.ok(complaintNew.startsWith('💡 <b>มีคำร้องใหม่</b>\n'), complaintNew)
assert.ok(complaintNew.endsWith(`\n${rule('🔵')}`), complaintNew)
assert.match(complaintNew, /เลขที่: ES-69-0030/)
assert.match(complaintNew, /^ประเภท: ไฟฟ้าสาธารณะ$/m)
assert.match(complaintNew, /^ส่งถึง: กองช่าง$/m)
assert.match(complaintNew, /สถานที่: หมู่ 3 ซอยข้างวัด/)
assert.match(complaintNew, /แจ้งเมื่อ: 12 ก\.ย\. 2569 19:32 น\./)

const complaintStatus = buildComplaintStatusMessage(complaint)
assert.match(complaintStatus, /^💡 <b>อัปเดตสถานะคำร้อง<\/b>$/m)
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
// จุดสีรายกอง — อ่านจาก departments.color (แอดมินเลือกเอง/trigger เติมให้) ไม่ใช่ departments.code
// เคสจริงที่ทำให้ต้องเปลี่ยน: ตำหนักธรรม/ทุ่งแค้วสร้างกองเองทั้งหมด code เป็น dept_* ทุกกอง
// ผูกกับ code แล้วได้สีขาวเหมือนกันหมด
// ─────────────────────────────────────────────────────────────────────────────
for (const { key, emoji } of DEPARTMENT_COLORS) {
  const message = buildComplaintCreatedMessage({ ...complaint, department: { name: 'สำนักปลัด', color: key } })
  assert.ok(message.endsWith(`\n${rule(emoji)}`), `สี '${key}' ต้องได้เส้นคั่นล่างที่มีจุด ${emoji}:\n${message}`)
}
// กองที่ code เป็น dept_* แต่มีสีแล้ว ต้องได้สีนั้น (บั๊กเดิมคือได้สีขาวเพราะไปดู code)
assert.ok(
  buildComplaintCreatedMessage({ ...complaint, department: { name: 'กองช่าง', code: 'dept_mrf68120', color: 'blue' } })
    .endsWith(`\n${rule('🔵')}`),
)
// ไม่มีสี / คีย์แปลก / ยังไม่ผูกกอง ต้องได้สีกลาง ไม่ใช่ข้อความพัง และห้ามต่อค่าดิบจาก DB เข้าข้อความ
for (const department of [{ name: 'ไม่มีสี' }, { name: 'สีแปลก', color: '<b>pink</b>' }, null]) {
  const message = buildComplaintCreatedMessage({ ...complaint, department })
  assert.ok(message.endsWith(`\n${rule('⚪')}`), `กองที่ไม่มีสีที่ใช้ได้ต้องได้ ⚪: ${JSON.stringify(department)}`)
  assert.equal(message.includes('pink'), false, 'ห้ามต่อคีย์สีดิบเข้าข้อความ')
}

// ─────────────────────────────────────────────────────────────────────────────
// รายการคีย์สีต้องตรงกัน 3 ที่ — เพิ่มสีที่ใดที่หนึ่งแล้วลืมอีกที่ = แอดมินเลือกสีได้แต่บันทึกไม่ผ่าน CHECK
// หรือบันทึกได้แต่ Telegram ขึ้น ⚪
// ─────────────────────────────────────────────────────────────────────────────
assert.deepEqual(
  DEPARTMENT_COLOR_EMOJI,
  Object.fromEntries(DEPARTMENT_COLORS.map((c) => [c.key, c.emoji])),
  'DEPARTMENT_COLOR_EMOJI ใน notify-telegram ต้องตรงกับ DEPARTMENT_COLORS ใน src/lib/departmentColors.js',
)
const columnMigration = readFileSync(
  path.join(root, 'supabase/migrations/20260913100000_departments_color_column.sql'), 'utf8')
const checkKeys = [...(columnMigration.match(/color IN \(([^)]*)\)/)?.[1] ?? '').matchAll(/'([a-z]+)'/g)]
  .map((m) => m[1])
assert.deepEqual(checkKeys.sort(), DEPARTMENT_COLORS.map((c) => c.key).sort(),
  'CHECK departments_color_check ต้องมีคีย์ครบและตรงกับ DEPARTMENT_COLORS')
const triggerMigration = readFileSync(
  path.join(root, 'supabase/migrations/20260913100100_departments_color_default_trigger.sql'), 'utf8')
const paletteKeys = [...(triggerMigration.match(/unnest\(ARRAY\[([^\]]*)\]/)?.[1] ?? '').matchAll(/'([a-z]+)'/g)]
  .map((m) => m[1])
assert.deepEqual(paletteKeys.sort(), DEPARTMENT_COLORS.map((c) => c.key).sort(),
  'ลำดับสีสำรองใน department_default_color() ต้องมีคีย์ครบและตรงกับ DEPARTMENT_COLORS')

// ─────────────────────────────────────────────────────────────────────────────
// อีโมจิ/ชื่อหมวดคำร้อง — ต้องใช้ค่าของ อปท. นั้นจาก complaint_categories ก่อนค่าสำรองเสมอ
// (เคสจริง: น้ำเลาตั้ง road = "ซ่อมแซมถนน" 🛣️ / ตำหนักธรรมตั้ง light = ⚡ ไม่ใช่ 💡)
// ─────────────────────────────────────────────────────────────────────────────
const tenantNamed = buildComplaintCreatedMessage({
  ...complaint, category: 'road', category_ref: { label: 'ซ่อมแซมถนน', emoji: '🚧' },
})
assert.match(tenantNamed, /^🚧 <b>มีคำร้องใหม่<\/b>$/m)
assert.match(tenantNamed, /^ประเภท: ซ่อมแซมถนน$/m)
// คำร้องเก่าที่ category_id ยังว่าง (มีจริงในระบบ) ต้องตกมาที่ค่าสำรอง ไม่ใช่ขึ้นค่าดิบ
const legacy = buildComplaintCreatedMessage({ ...complaint, category: 'tree', category_ref: null })
assert.match(legacy, /^🌳 <b>มีคำร้องใหม่<\/b>$/m)
assert.match(legacy, /^ประเภท: ต้นไม้\/สวนสาธารณะ$/m)
// หมวดที่ไม่รู้จักเลย ต้องยังส่งออกได้ ไม่ใช่ข้อความพัง
const unknownCategory = buildComplaintCreatedMessage({ ...complaint, category: 'cat_zzz', category_ref: null })
assert.match(unknownCategory, /^📝 <b>มีคำร้องใหม่<\/b>$/m)
assert.match(unknownCategory, /^ประเภท: cat_zzz$/m)

// ─────────────────────────────────────────────────────────────────────────────
// ❌ ห้ามมีแฮชแท็กภาษาไทย — ของจริงในกลุ่ม Telegram ตัดแท็กที่สระบน/ล่างหรือวรรณยุกต์
// "#สำนักปลัด" ขึ้นเป็น "#สำน" + "ักปลัด" ธรรมดา แก้ฝั่งเราไม่ได้ จึงถอดแท็กชื่อกองออกทั้งหมด
// "#a1b2c3d4" ของบรรทัดอ้างอิงยังมีได้ เพราะเป็นอักษรอังกฤษกับตัวเลขล้วน Telegram ตัดถูก
// ─────────────────────────────────────────────────────────────────────────────
for (const message of [
  complaintNew, complaintStatus, created, docStatus, fee,
  buildComplaintCreatedMessage({ ...complaint, department: { name: 'สำนักปลัด', color: 'green' } }),
]) {
  assert.equal(/#[฀-๿]/u.test(message), false, `ห้ามมีแฮชแท็กภาษาไทย:\n${message}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// ยานพาหนะ — เจ้าของระบบขอแจ้งทุกขั้นของคำขอใช้รถ + รถเข้าซ่อม/ซ่อมเสร็จ + บันทึกซ่อมบำรุง (2569-09-13)
// ─────────────────────────────────────────────────────────────────────────────
const trip = {
  id: 'f1ee7000-1111-4222-8333-444455556666',
  status: 'approved',
  approval_method: 'auto',
  destination: 'ศาลากลางจังหวัด',
  planned_departure: '2026-09-15T01:30:00.000Z', // 08:30 น.
  planned_return: '2026-09-15T09:00:00.000Z',    // 16:00 น.
  started_at: '2026-09-15T01:45:00.000Z',        // 08:45 น.
  returned_at: '2026-09-15T08:20:00.000Z',       // 15:20 น.
  odometer_start: 12000,
  odometer_end: 12085,
  distance_km: 85,
  reject_reason: 'ติดประชุม <ด่วน>',
  vehicle: { name: '[TEST] รถกระบะ', license_plate: 'กข 1234', meter_unit: 'km' },
  driver: { full_name: '[TEST] คนขับ' },
  requester: { full_name: '[TEST] ผู้ขอ' },
  approver: { full_name: '[TEST] ผู้อนุมัติ' },
  department: { name: 'กองช่าง', color: 'blue' },
}
const B = FLEET_MESSAGE_BUILDERS
const tripAuto = B.fleet_trip_created(trip)
assert.ok(tripAuto.startsWith('✅ <b>อนุมัติคิวรถอัตโนมัติ</b>\n'), tripAuto)
for (const line of [/^รถ: \[TEST\] รถกระบะ \(กข 1234\)$/m, /^ผู้ขับ: \[TEST\] คนขับ$/m, /^ออก: 15 ก\.ย\. 2569 08:30 น\.$/m,
  /^กลับ: 15 ก\.ย\. 2569 16:00 น\.$/m, /^ปลายทาง: ศาลากลางจังหวัด$/m, /^ผู้ขอ: \[TEST\] ผู้ขอ$/m, /^กอง: กองช่าง$/m,
  /^อ้างอิง: #f1ee7000$/m]) {
  assert.match(tripAuto, line)
}
const tripPending = B.fleet_trip_created({ ...trip, status: 'pending', approval_method: null })
assert.ok(tripPending.startsWith('🚗 <b>คำขอใช้รถใหม่ รออนุมัติ</b>\n'), tripPending)
assert.match(tripPending, /^สถานะ: <b>รออนุมัติ<\/b>$/m)
const tripApproved = B.fleet_trip_approved({ ...trip, approval_method: 'manual' })
assert.ok(tripApproved.startsWith('✅ <b>อนุมัติคำขอใช้รถ</b>\n'), tripApproved)
assert.match(tripApproved, /^ผู้อนุมัติ: \[TEST\] ผู้อนุมัติ$/m)
const tripRejected = B.fleet_trip_rejected({ ...trip, status: 'rejected' })
assert.ok(tripRejected.startsWith('❌ <b>ไม่อนุมัติคำขอใช้รถ</b>\n'), tripRejected)
// เหตุผลพิมพ์เองโดยเจ้าหน้าที่ ต้อง escape ไม่งั้น HTML parse_mode ของ Telegram ปฏิเสธทั้งข้อความ
assert.match(tripRejected, /^เหตุผล: ติดประชุม &lt;ด่วน&gt;$/m)
assert.match(tripRejected, /^ผู้พิจารณา: \[TEST\] ผู้อนุมัติ$/m)
const tripCancelled = B.fleet_trip_cancelled({ ...trip, status: 'cancelled', reject_reason: null })
assert.ok(tripCancelled.startsWith('🚫 <b>ยกเลิกคำขอใช้รถ</b>\n'), tripCancelled)
assert.match(tripCancelled, /^เหตุผล: ไม่ระบุ$/m)
const tripDeparted = B.fleet_trip_departed({ ...trip, status: 'in_progress' })
assert.ok(tripDeparted.startsWith('🚙 <b>รถออกเดินทาง</b>\n'), tripDeparted)
assert.match(tripDeparted, /^ออกเมื่อ: 15 ก\.ย\. 2569 08:45 น\.$/m)
assert.match(tripDeparted, /^เลขไมล์ก่อนออก: 12,000 กม\.$/m)
const tripReturned = B.fleet_trip_returned({ ...trip, status: 'completed' })
assert.ok(tripReturned.startsWith('🏁 <b>คืนรถแล้ว</b>\n'), tripReturned)
assert.match(tripReturned, /^กลับเมื่อ: 15 ก\.ย\. 2569 15:20 น\.$/m)
assert.match(tripReturned, /^เลขไมล์หลังกลับ: 12,085 กม\.$/m)
assert.match(tripReturned, /^ระยะทาง: <b>85 กม\.<\/b>$/m)
// อุปกรณ์นับชั่วโมง + ไม่ได้กรอกเลขไมล์ ต้องไม่มีบรรทัดเลขไมล์/ระยะทางค้างว่าง
const equipmentReturned = B.fleet_trip_returned({
  ...trip, status: 'completed', odometer_end: null, distance_km: null, vehicle: { name: 'เครื่องสูบน้ำ', meter_unit: 'hour' },
})
assert.equal(/เลขไมล์|ระยะทาง/.test(equipmentReturned), false, equipmentReturned)
assert.match(equipmentReturned, /^รถ: เครื่องสูบน้ำ$/m)

const vehicleRow = {
  id: 'fee1c1e0-1111-4222-8333-444455556666', status: 'under_repair', updated_at: '2026-09-13T03:00:00Z',
  name: '[TEST] รถกระบะ', license_plate: 'กข 1234', department: { name: 'สำนักปลัด', color: 'green' },
}
const repairStarted = B.fleet_vehicle_repair_started(vehicleRow)
assert.ok(repairStarted.startsWith('🔧 <b>รถงดใช้งาน เข้าซ่อม</b>\n'), repairStarted)
assert.match(repairStarted, /^กองเจ้าของรถ: สำนักปลัด$/m)
assert.ok(repairStarted.endsWith(`\n${rule('🟢')}`), repairStarted)
const repairFinished = B.fleet_vehicle_repair_finished({ ...vehicleRow, status: 'active' })
assert.ok(repairFinished.startsWith('✅ <b>รถกลับมาใช้งานได้</b>\n'), repairFinished)
assert.equal(repairFinished.includes('รอจัดสรรรถ'), false, 'ซ่อมเสร็จแล้วต้องไม่บอกว่าคำขอจะรอจัดสรร')

const maintenance = {
  id: 'aa000000-1111-4222-8333-444455556666', service_date: '2026-09-13', maintenance_type: 'repair',
  description: 'เปลี่ยนผ้าเบรก', cost: 2500, vendor: 'อู่ช่างแดง', odometer: 12100,
  next_service_date: '2027-03-13', next_service_meter: 17100,
  vehicle: { name: '[TEST] รถกระบะ', license_plate: 'กข 1234', meter_unit: 'km', department: { name: 'กองคลัง', color: 'yellow' } },
}
const maintenanceMsg = B.fleet_maintenance_created(maintenance)
assert.ok(maintenanceMsg.startsWith('🛠️ <b>บันทึกซ่อมบำรุงใหม่</b>\n'), maintenanceMsg)
assert.match(maintenanceMsg, /^ประเภท: ซ่อมแซม$/m)
assert.match(maintenanceMsg, /^ค่าใช้จ่าย: <b>2,500\.00 บาท<\/b>$/m)
assert.match(maintenanceMsg, /^นัดครั้งถัดไป: .*2570 หรือ 17,100 กม\.$/m)
// สีกองมาจากกองเจ้าของรถ (fleet_maintenance ไม่มี department_id ของตัวเอง)
assert.ok(maintenanceMsg.endsWith(`\n${rule('🟡')}`), maintenanceMsg)
assert.equal(/ค่าใช้จ่าย/.test(B.fleet_maintenance_created({ ...maintenance, cost: 0 })), false, 'ค่าใช้จ่าย 0 บาทต้องไม่ขึ้น')
assert.match(B.fleet_maintenance_created({ ...maintenance, maintenance_type: 'zzz' }), /^ประเภท: อื่นๆ$/m)

const fuelMsg = buildFleetFuelCreatedMessage({
  id: 'bb000000-1111-4222-8333-444455556666', filled_at: '2026-09-13', liters: 40, price_per_liter: 30.5,
  total_cost: 1220, fuel_type: 'diesel', vehicle: maintenance.vehicle,
})
assert.ok(fuelMsg.startsWith('⛽ <b>บันทึกการเติมเชื้อเพลิงใหม่</b>\n'), fuelMsg)
assert.ok(fuelMsg.endsWith(`\n${rule('🟡')}`), fuelMsg)
const bumpedMsg = buildFleetTripBumpedMessage({ ...trip, status: 'cancelled' })

// ด่านสถานะจริงใน DB — client บอกชนิดมา แต่แถวไม่อยู่ในสถานะนั้นต้องไม่ส่ง
const match = (type, row) => notificationMatchesResource(type, row)
assert.equal(match('fleet_trip_created', { status: 'approved', approval_method: 'auto' }), true)
assert.equal(match('fleet_trip_created', { status: 'pending' }), true)
assert.equal(match('fleet_trip_created', { status: 'approved', approval_method: 'manual' }), false)
assert.equal(match('fleet_trip_created', { status: 'waitlisted' }), false, 'รอจัดสรรมีข้อความของตัวเองแล้ว')
assert.equal(match('fleet_trip_approved', { status: 'approved', approval_method: null }), true)
assert.equal(match('fleet_trip_approved', { status: 'approved', approval_method: 'auto' }), false, 'อนุมัติอัตโนมัติห้ามแจ้งซ้ำ 2 ใบ')
assert.equal(match('fleet_trip_approved', { status: 'pending' }), false)
assert.equal(match('fleet_trip_rejected', { status: 'rejected' }), true)
assert.equal(match('fleet_trip_rejected', { status: 'approved' }), false)
assert.equal(match('fleet_trip_cancelled', { status: 'cancelled' }), true)
assert.equal(match('fleet_trip_departed', { status: 'approved' }), false)
assert.equal(match('fleet_trip_departed', { status: 'in_progress' }), true)
assert.equal(match('fleet_trip_returned', { status: 'in_progress' }), false)
assert.equal(match('fleet_trip_returned', { status: 'completed' }), true)
assert.equal(match('fleet_vehicle_repair_started', { status: 'active' }), false)
assert.equal(match('fleet_vehicle_repair_started', { status: 'under_repair' }), true)
assert.equal(match('fleet_vehicle_repair_finished', { status: 'under_repair' }), false)
assert.equal(match('fleet_vehicle_repair_finished', { status: 'active' }), true)
// รถคันเดียวเข้าซ่อมได้หลายรอบ — คีย์กันซ้ำต้องเปลี่ยนตาม updated_at
assert.notEqual(
  idempotencyKey('fleet_vehicle_repair_started', vehicleRow),
  idempotencyKey('fleet_vehicle_repair_started', { ...vehicleRow, updated_at: '2026-10-01T00:00:00Z' }),
)

// ทุกชนิดที่หน้าเว็บยิงได้ต้องมีใน edge function และกลับกัน — ขาดฝั่งใดฝั่งหนึ่งแจ้งเตือนหายเงียบ
// (client ทิ้งชนิดที่ไม่อยู่ใน allowlist โดยไม่ log / edge function ตอบ 400)
{
  const clientTypes = [...readFileSync(path.join(root, 'src/lib/notifyTelegram.js'), 'utf8')
    .match(/ALLOWED_NOTIFICATION_TYPES = new Set\(\[([\s\S]*?)\]\)/)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]).sort()
  assert.deepEqual(clientTypes, Object.keys(notificationSpecs).sort(), 'allowlist ใน notifyTelegram.js ต้องตรงกับ notificationSpecs')
  for (const type of Object.keys(FLEET_MESSAGE_BUILDERS)) {
    assert.ok(notificationSpecs[type], `FLEET_MESSAGE_BUILDERS มีชนิด '${type}' ที่ไม่อยู่ใน notificationSpecs`)
  }
  // ป้ายประเภทซ่อมบำรุงคัดลอกมาจาก TYPES ใน FleetMaintenance.jsx
  const maintenanceSource = readFileSync(path.join(root, 'src/components/fleet/FleetMaintenance.jsx'), 'utf8')
  const clientMaintenance = Object.fromEntries([...maintenanceSource.match(/const TYPES = \{([\s\S]*?)\n\}/)[1]
    .matchAll(/(\w+):\s*\{\s*label:\s*'([^']+)'/g)].map((m) => [m[1], m[2]]))
  const edgeMaintenance = Object.fromEntries([...source.match(/const MAINTENANCE_TYPE_LABEL: Record<string, string> = \{([\s\S]*?)\n\}/)[1]
    .matchAll(/(\w+):\s*'([^']+)'/g)].map((m) => [m[1], m[2]]))
  assert.deepEqual(edgeMaintenance, clientMaintenance, 'ป้ายประเภทซ่อมบำรุงใน Telegram ต้องตรงกับ TYPES ใน FleetMaintenance.jsx')
}

// ─────────────────────────────────────────────────────────────────────────────
// เส้นคั่นบรรทัดสุดท้าย — Telegram ทำพื้นหลังหรือกรอบสีไม่ได้ (ตรวจกับ Bot API 10.3 แล้ว) จึงปิดท้ายข้อความ
// ด้วยจุดสีกอง + เส้นประ ห้ามมีข้อความอื่นปน จุดสีมีตัวเดียว (เจ้าของระบบขอให้สีกองเล็กที่สุด)
// และเส้นประห้ามเกิน 12 ขีด ไม่งั้นหักบนจอแคบ
// เจ้าของระบบขอเหลือเส้นเดียวไว้ล่างสุด (2569-09-13) เพราะบรรทัดบนมีอีโมจิประเภทอยู่แล้ว
// ─────────────────────────────────────────────────────────────────────────────
for (const message of [
  complaintNew, complaintStatus, created, permit, docStatus, fee, waitlisted,
  tripAuto, tripPending, tripApproved, tripRejected, tripCancelled, tripDeparted, tripReturned, equipmentReturned,
  repairStarted, repairFinished, maintenanceMsg, fuelMsg, bumpedMsg,
]) {
  assert.equal(message.includes('\n\n'), false, `ต้องไม่มีบรรทัดว่าง:\n${message}`)
  assert.equal(/: *$/m.test(message), false, `ต้องไม่มีหัวข้อที่ไม่มีค่าตามหลัง:\n${message}`)
  const lines = message.split('\n')
  const [heading] = lines
  const last = lines.at(-1)
  assert.match(heading, /^\S+ <b>[^<]+<\/b>$/u, `บรรทัดแรกต้องเป็นหัวข้อ ไม่ใช่เส้นคั่น: ${heading}`)
  assert.match(last, /^(?:🔴|🟠|🟡|🟢|🔵|🟣|🟤|⚫|⚪)┈{12}$/u, `บรรทัดสุดท้ายต้องเป็นจุดสี 1 ตัว + เส้นประ 12 ขีด: ${last}`)
  assert.equal(lines.filter((l) => l.includes('┈')).length, 1, `ต้องมีเส้นคั่นแค่บรรทัดสุดท้าย ห้ามมีเส้นบน:\n${message}`)
}
// ข้อมูลไม่ครบ ต้องไม่เหลือบรรทัดว่างก่อนเส้น และไม่มีเส้นบน
const sparse = buildDocumentRequestCreatedMessage({ id: 'x' }, null)
assert.equal(sparse.includes('\n\n'), false)
assert.ok(sparse.endsWith(`\n${rule('⚪')}`), sparse)
assert.equal(sparse.split('\n').filter((l) => l.includes('┈')).length, 1, sparse)

// HTML parse_mode ของ Telegram — ข้อความที่ประชาชนพิมพ์เองต้องถูก escape ไม่งั้นบอทส่งไม่ออก
const injected = buildComplaintCreatedMessage({ ...complaint, village: '<b>x</b> & y' })
assert.match(injected, /สถานที่: &lt;b&gt;x&lt;\/b&gt; &amp; y/)

// ─────────────────────────────────────────────────────────────────────────────
// เหตุผลที่คำขอใช้รถ "รอจัดสรรรถ" ต้องตรงกัน 3 ที่ — รหัสใน CHECK ของ DB, ป้ายบนหน้าจอ, ป้ายใน Telegram
// เพิ่มเหตุผลใหม่ที่ DB แล้วลืมแก้หน้าจอ ผู้ดูแลจะเห็นรหัสดิบ เช่น "vehicle_documents_expired"
// ─────────────────────────────────────────────────────────────────────────────
{
  const sliceBlock = (file, re) => {
    const match = readFileSync(path.join(root, file), 'utf8').match(re)
    assert.ok(match, `หา QUEUE_REASON_LABEL/รายการรหัสใน ${file} ไม่เจอ`)
    return match[1]
  }
  const labels = body => Object.fromEntries([...body.matchAll(/(\w+):\s*'([^']+)'/g)].map(m => [m[1], m[2]]))
  const clientLabels = labels(sliceBlock('src/components/fleet/FleetTrips.jsx', /const QUEUE_REASON_LABEL = \{([\s\S]*?)\n\}/))
  const edgeLabels = labels(sliceBlock('supabase/functions/notify-telegram/index.ts', /const QUEUE_REASON_LABEL: Record<string, string> = \{([\s\S]*?)\n\}/))
  const dbCodes = sliceBlock('supabase/migrations/20260913150000_fleet_trip_waitlist_reasons.sql', /ARRAY\[([\s\S]*?)\]::text\[\]/)
    .match(/'(\w+)'/g).map(s => s.slice(1, -1)).sort()
  assert.deepEqual(Object.keys(clientLabels).sort(), dbCodes, 'รหัสเหตุผลบนหน้าจอไม่ตรงกับ CHECK ใน DB')
  assert.deepEqual(Object.keys(edgeLabels).sort(), dbCodes, 'รหัสเหตุผลใน Telegram ไม่ตรงกับ CHECK ใน DB')
  assert.deepEqual(edgeLabels, clientLabels, 'ข้อความเหตุผลใน Telegram ไม่ตรงกับหน้าจอ')
}

console.log('✓ telegram-notification-message: ผ่านทุกข้อ')
