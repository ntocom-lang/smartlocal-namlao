// ที่ปรึกษา AI เฉพาะ Super Admin — ตรรกะล้วนของ Edge Function (supabase/functions/_shared/advisorCore.ts) + ด่านในซอร์ส
//   npm run test:advisor:core
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const Core = await import('../supabase/functions/_shared/advisorCore.ts')
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
let passed = 0
const check = async (name, fn) => { await fn(); passed++; console.log(`  ✓ ${name}`) }

await check('ปิดบังเลขบัตรประชาชน 13 หลัก ทั้งติดกันและคั่นขีด/เว้นวรรค', () => {
  for (const id of ['1234567890123', '1-2345-67890-12-3', '1 2345 67890 12 3']) {
    const r = Core.maskPersonalData(`ผู้ร้อง ${id} มาติดต่อ`)
    assert.equal(r.text, 'ผู้ร้อง [เลขบัตรประชาชน] มาติดต่อ', id)
    assert.equal(r.masked, 1)
  }
})

await check('ปิดบังเบอร์โทรมือถือ/บ้าน/+66', () => {
  for (const phone of ['0812345678', '081-234-5678', '081 234 5678', '054-123456', '054123456', '+66 81 234 5678', '+66812345678']) {
    const r = Core.maskPersonalData(`โทร ${phone} ด่วน`)
    assert.equal(r.text, 'โทร [เบอร์โทร] ด่วน', phone)
  }
})

await check('ไม่ปิดบังตัวเลขทั่วไป (งบประมาณ ปี พ.ศ. เลขข้อ เวลา)', () => {
  const text = 'งบ 1,500,000 บาท ปี 2569 ข้อ 165 ภายใน 30 วัน เวลา 08.30 น. รหัส 12345 ยอด 4500000'
  const r = Core.maskPersonalData(text)
  assert.equal(r.text, text)
  assert.equal(r.masked, 0)
})

await check('ตัวเลขที่ยาวกว่า 13 หลักไม่ถูกตัดครึ่ง', () => {
  const r = Core.maskPersonalData('เลขอ้างอิง 12345678901234567')
  assert.equal(r.masked, 0)
})

await check('นับจำนวนจุดที่ปิดบังรวมทุกชนิด', () => {
  const r = Core.maskPersonalData('บัตร 3100500123456 โทร 0899999999 และ 0811111111')
  assert.equal(r.masked, 3)
  assert.ok(!/\d{9,}/.test(r.text))
})

await check('ตรวจคำขอ: conversation_id ต้องเป็น uuid · ข้อความ 1–8000 ตัว · ตัดช่องว่างหัวท้าย', () => {
  const cid = '00000000-0000-4000-8000-000000000001'
  assert.deepEqual(Core.validateRequest({ conversation_id: cid, message: '  สวัสดี  ' }), { ok: true, conversationId: cid, message: 'สวัสดี' })
  assert.equal(Core.validateRequest({ conversation_id: 'x', message: 'a' }).ok, false)
  assert.equal(Core.validateRequest({ conversation_id: cid, message: '   ' }).ok, false)
  assert.equal(Core.validateRequest({ conversation_id: cid, message: 5 }).ok, false)
  assert.equal(Core.validateRequest({ conversation_id: cid, message: 'ก'.repeat(8001) }).ok, false)
  assert.equal(Core.validateRequest({ conversation_id: cid, message: 'ก'.repeat(8000) }).ok, true)
  assert.equal(Core.validateRequest(null).ok, false)
})

await check('เที่ยงคืนเวลาไทยเป็น UTC (ข้ามวันที่ 17:00Z)', () => {
  assert.equal(Core.bangkokDayStartIso(new Date('2026-11-08T18:30:00Z')), '2026-11-08T17:00:00.000Z')
  assert.equal(Core.bangkokDayStartIso(new Date('2026-11-08T16:59:59Z')), '2026-11-07T17:00:00.000Z')
  assert.equal(Core.bangkokDayStartIso(new Date('2026-12-31T17:00:00Z')), '2026-12-31T17:00:00.000Z')
  assert.equal(Core.thaiDateLabel(new Date('2026-11-08T03:00:00Z')), '8 พฤศจิกายน พ.ศ. 2569')
})

await check('ประวัติ → contents สลับ user/model เสมอ และเริ่มด้วย user', () => {
  const c = Core.buildContents([
    { role: 'model', content: 'ตอบค้างจากประวัติที่ถูกตัด' },
    { role: 'user', content: 'ถาม 1' },
    { role: 'user', content: 'ถาม 1 ซ้ำ' },
    { role: 'model', content: 'ตอบ 1' },
  ], 'ถาม 2')
  assert.deepEqual(c.map(t => t.role), ['user', 'model', 'user'])
  assert.equal(c[0].parts[0].text, 'ถาม 1\n\nถาม 1 ซ้ำ')
  assert.equal(c[2].parts[0].text, 'ถาม 2')
  assert.deepEqual(Core.buildContents([], 'แรก'), [{ role: 'user', parts: [{ text: 'แรก' }] }])
})

await check('อ่านคำตอบ: ตัด part ความคิด (thought) · ว่าง/ถูกบล็อก = ไม่สำเร็จพร้อมเหตุผล', () => {
  const ok = Core.extractReply({ candidates: [{ content: { parts: [{ text: 'คิด...', thought: true }, { text: 'คำตอบ ' }, { text: 'จริง' }] } }] })
  assert.deepEqual(ok, { ok: true, text: 'คำตอบ จริง' })
  const empty = Core.extractReply({ candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] })
  assert.equal(empty.ok, false); assert.match(empty.reason, /SAFETY/)
  const blocked = Core.extractReply({ promptFeedback: { blockReason: 'OTHER' } })
  assert.equal(blocked.ok, false); assert.match(blocked.reason, /OTHER/)
  assert.equal(Core.extractReply(null).ok, false)
})

await check('ชื่อโมเดลตรงกับ CHECK ของฐานข้อมูล', async () => {
  for (const m of ['gemini-3.5-flash', 'gemini-2.5-pro']) assert.ok(Core.MODEL_PATTERN.test(m), m)
  for (const m of ['', 'Gemini', '../x', 'a b', 'x:generateContent?key=']) assert.ok(!Core.MODEL_PATTERN.test(m), m)
  const sql = await read('supabase/migrations/20261109120000_superadmin_advisor_tables.sql')
  assert.ok(sql.includes(`model ~ '${Core.MODEL_PATTERN.source}'`), 'regex ใน migration ต้องตรงกับ MODEL_PATTERN')
})

await check('Edge Function: ตรวจ superadmin ก่อนเรียก Google · key อยู่ใน header · ไม่ log เนื้อข้อความ', async () => {
  const src = await read('supabase/functions/superadmin-advisor/index.ts')
  const roleGate = src.indexOf("caller?.role !== 'superadmin'")
  assert.ok(roleGate > 0, 'ต้องตรวจ role superadmin')
  assert.ok(roleGate < src.indexOf('callGemini(settings.model'), 'ตรวจสิทธิ์ต้องมาก่อนเรียก Google')
  assert.ok(src.indexOf('auth.getUser()') < roleGate, 'ต้องยืนยัน token ด้วย auth.getUser ก่อน')
  assert.ok(src.includes("'x-goog-api-key'"), 'ส่ง key ทาง header')
  assert.ok(!/\?key=/.test(src), 'ห้ามต่อ key ท้าย URL')
  assert.ok(src.indexOf('maskPersonalData(') < src.indexOf('callGemini(settings.model'), 'ปิดบังข้อมูลก่อนส่ง')
  assert.ok(!/console\.(log|error)\([^)]*(input\.message|safeText|reply\.text)/.test(src), 'ห้าม log เนื้อข้อความ')
  assert.ok(src.includes(".eq('user_id', callerId)"), 'ประวัติต้องเป็นของผู้เรียกเท่านั้น')
})

await check('บอทเก่าใน repo เป็น stub 410 ไม่เรียก Google และไม่อ่าน GEMINI_API_KEY', async () => {
  for (const f of ['gemini-chat', 'gemini-extract-event']) {
    const src = await read(`supabase/functions/${f}/index.ts`)
    assert.ok(src.includes('status: 410'), f)
    assert.ok(!src.includes('generativelanguage.googleapis.com'), f)
    assert.ok(!src.includes("Deno.env.get('GEMINI_API_KEY')"), f)
  }
})

console.log(`\nsuperadmin-advisor-core: ผ่าน ${passed} ข้อ`)
