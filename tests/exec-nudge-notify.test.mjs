// ห้องผู้บริหาร E3-2 "ส่งให้กองเร่งรัด" (supabase/functions/exec-nudge-notify)
//   ชั้นแรก: ตรรกะล้วนของจริง (_shared/execNudge.ts) — ด่านไม่ส่ง · ข้อความไม่มีข้อมูลส่วนบุคคล · วันที่ไทย · ป้ายผล
//   ชั้นสอง: อ่านซอร์ส edge function — ลำดับ ยืนยันตัว → จองแถว → payload → ส่ง → เขียนผลกลับเฉพาะแถว sending
// ไม่ใช้เน็ต ไม่ใช้บัญชี ไม่ส่งข้อความจริง
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// โซนเวลาเครื่องเป็นต่างประเทศ: โค้ดที่อ่านวันจากเวลาเครื่องแทนเวลาไทยจะพังในเคสข้ามวัน
process.env.TZ = 'America/Los_Angeles'
const N = await import('../supabase/functions/_shared/execNudge.ts')
const { BASE_DOCUMENT_TYPES } = await import('../src/lib/documentTypes.js')

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const stripComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}

const payload = (over = {}) => ({
  sendable: true,
  nudge: {
    id: '11111111-1111-4111-8111-111111111111', municipality_id: '22222222-2222-4222-8222-222222222222',
    item_kind: 'complaint', item_id: '33333333-3333-4333-8333-333333333333', item_ref: 'CR-6911-0042',
    delivery: 'sending', nudged_by: '44444444-4444-4444-8444-444444444444',
    requested_by: '44444444-4444-4444-8444-444444444444', nudged_by_position: 'นายกเทศมนตรี',
    nudged_at: '2026-11-11T03:00:00Z', attempt_count: 1,
  },
  item: { ref: 'CR-6911-0042', status: 'received', due: '2026-11-05', created: '2026-10-29', cat: 'road', cat_label: 'ถนนชำรุด' },
  department: { id: '55555555-5555-4555-8555-555555555555', name: 'กองช่าง', short_name: null },
  heads: ['66666666-6666-4666-8666-666666666666'],
  requester_is_head: false,
  ...over,
})

// ── ด่านไม่ส่ง ─────────────────────────────────────────────────────────────

await test('sendable=false / item=null / payload=null → ไม่ส่ง (ด่านชั้นสองของเรื่องอ่อนไหว)', () => {
  assert.match(N.skipReason(payload({ sendable: false, item: null })), /ไม่ส่ง/)
  assert.match(N.skipReason(payload({ item: null })), /ไม่ส่ง/)
  assert.match(N.skipReason(null), /ไม่ส่ง/)
  // sendable ต้องเป็น true จริงเท่านั้น ค่าแปลกปลอม (string/1) = ไม่ส่ง
  assert.match(N.skipReason(payload({ sendable: 'true' })), /ไม่ส่ง/)
})

await test('ผู้สั่งเป็นหัวหน้ากองนั้นเอง → ไม่ส่ง ไม่ตกไปกลุ่ม · ปกติ → ไปต่อ', () => {
  assert.match(N.skipReason(payload({ requester_is_head: true })), /หัวหน้าของกอง/)
  assert.equal(N.skipReason(payload()), null)
})

// ── ข้อความ ───────────────────────────────────────────────────────────────

const now = new Date('2026-11-11T03:00:00Z') // 11 พ.ย. 2569 10:00 น. เวลาไทย

await test('ข้อความ DM: ตำแหน่งผู้เร่ง + กอง + เลขที่ + หมวด + กำหนด (เลยมา 6 วัน) · ไม่มีบรรทัด "ถึง:"', () => {
  const text = N.buildNudgeMessage({ payload: payload(), audience: 'dm', tenantName: 'เทศบาลตำบลสาธิต', feeSchedule: null, now })
  assert.match(text, /นายกเทศมนตรี ขอให้ <b>กองช่าง<\/b> เร่งรัด/)
  assert.match(text, /คำร้อง เลขที่ <b>CR-6911-0042<\/b>/)
  assert.match(text, /หมวด: ถนนชำรุด/)
  assert.match(text, /สถานะ: รับเรื่องแล้ว/)
  assert.match(text, /เลยมา 6 วัน/)
  assert.doesNotMatch(text, /ถึง:/)
  assert.match(text, /เทศบาลตำบลสาธิต/)
})

await test('ข้อความกลุ่ม: มีบรรทัด "ถึง: หัวหน้ากอง..." พร้อมเหตุที่ตกมากลุ่ม', () => {
  const text = N.buildNudgeMessage({
    payload: payload(), audience: 'group', tenantName: 'x', feeSchedule: null, now,
    groupReason: N.groupReason(1, 0),
  })
  assert.match(text, /ถึง: หัวหน้ากองช่าง — หัวหน้ากองยังไม่ได้เชื่อม Telegram ส่วนตัว/)
})

await test('ข้อความ escape HTML ทุกช่องที่มาจากฐานข้อมูล (หมวด/ตำแหน่ง/ชื่อหน่วยงาน)', () => {
  const p = payload({ item: { ...payload().item, cat_label: '<b>x</b>&' } })
  p.nudge.nudged_by_position = 'รองนายก<script>'
  const text = N.buildNudgeMessage({ payload: p, audience: 'dm', tenantName: 'อบต.<i>', feeSchedule: null, now })
  assert.match(text, /&lt;b&gt;x&lt;\/b&gt;&amp;/)
  assert.match(text, /รองนายก&lt;script&gt;/)
  assert.match(text, /อบต\.&lt;i&gt;/)
  assert.doesNotMatch(text, /<script>|<i>/)
})

await test('PDPA: ข้อความประกอบจากฟิลด์ payload เท่านั้น — ช่องแปลกปลอมใน item (ชื่อ/เบอร์/รายละเอียด) ไม่หลุดเข้าข้อความ', () => {
  const p = payload({
    item: { ...payload().item, reporter_name: 'นายทดสอบ ลับมาก', phone: '0812345678', description: 'บ้านเลขที่ 99' },
  })
  const text = N.buildNudgeMessage({ payload: p, audience: 'group', tenantName: 'x', feeSchedule: null, now, groupReason: 'r' })
  assert.doesNotMatch(text, /ทดสอบ ลับมาก|0812345678|บ้านเลขที่ 99/)
})

await test('คำขอ E-Service: ชื่อประเภทจากรายการกลาง · ประเภทที่ อปท. เพิ่มเองอ่านจาก fee_schedule · สถานะชุดคำขอ', () => {
  const doc = payload({ item: { ...payload().item, cat: 'water_supply_request', cat_label: null, status: 'processing' } })
  doc.nudge.item_kind = 'document_request'
  const text = N.buildNudgeMessage({ payload: doc, audience: 'dm', tenantName: 'x', feeSchedule: null, now })
  assert.match(text, /คำขอ E-Service เลขที่/)
  assert.match(text, /ประเภท: ขออนุญาตใช้น้ำประปา/)
  assert.match(text, /สถานะ: กำลังดำเนินการ/)
  const custom = { _custom_types: [{ value: 'custom_x', label: 'ขอใช้สนามกีฬา', emoji: '⚽' }] }
  assert.equal(N.documentTypeLabel('custom_x', custom), 'ขอใช้สนามกีฬา')
  assert.equal(N.documentTypeLabel('unknown_key', custom), 'unknown_key')
})

await test('ชื่อประเภทคำขอตรงกับ BASE_DOCUMENT_TYPES ทุกตัว (ตัดอีโมจินำหน้า) — เพิ่มประเภทแล้วลืมแก้ edge = ล้ม', () => {
  for (const t of BASE_DOCUMENT_TYPES) {
    const plain = t.label.replace(/^\S+\s+/, '')
    assert.equal(N.DOCUMENT_TYPE_LABEL[t.value], plain, `ประเภท ${t.value}`)
  }
})

await test('วันเลยกำหนดนับตามเวลาไทย: 11 พ.ย. 06:30 ไทย (10 พ.ย. UTC) − due 10 พ.ย. = 1 วัน', () => {
  assert.equal(N.daysOverdue('2026-11-10', new Date('2026-11-10T23:30:00Z')), 1)
  assert.equal(N.daysOverdue('2026-11-10', new Date('2026-11-10T16:59:00Z')), 0)
  assert.equal(N.daysOverdue('bad', now), null)
  assert.equal(N.thaiDate('2026-11-05'), '5 พ.ย. 2569')
  assert.equal(N.thaiDate(null), '-')
})

// ── ป้ายผล ────────────────────────────────────────────────────────────────

await test('ป้ายผล: dm บอกจำนวนคน · group บอกเหตุ 3 แบบ · ยาวไม่เกิน 300', () => {
  assert.match(N.deliveryNote({ delivery: 'dm', dmSent: 1, headsTotal: 1 }), /ส่วนตัว 1 คน$/)
  assert.match(N.deliveryNote({ delivery: 'dm', dmSent: 1, headsTotal: 2 }), /จาก 2 คน/)
  assert.match(N.deliveryNote({ delivery: 'group', headsTotal: 0 }), /ยังไม่ได้กำหนดหัวหน้ากอง/)
  assert.match(N.deliveryNote({ delivery: 'group', headsTotal: 1, linkedHeads: 0 }), /ยังไม่ได้เชื่อม Telegram/)
  assert.match(N.deliveryNote({ delivery: 'group', headsTotal: 1, linkedHeads: 1, dmFailed: 1 }), /ส่งส่วนตัวไม่สำเร็จ 1 คน/)
  assert.ok(N.deliveryNote({ delivery: 'none', reason: 'ก'.repeat(500) }).length <= 300)
})

// ── ซอร์ส edge function ───────────────────────────────────────────────────

const src = stripComments(read('supabase/functions/exec-nudge-notify/index.ts'))

await test('ยืนยันตัวจาก JWT ก่อนแตะฐานข้อมูล และไม่รับผู้เรียกที่ไม่มีบัญชี', () => {
  const auth = src.indexOf('auth.getUser()')
  const claim = src.indexOf(".update({ delivery: 'sending' })")
  assert.ok(auth > 0 && claim > auth, 'ต้อง getUser ก่อนจองแถว')
  assert.match(src, /if \(!isUuid\(userId\)\) return json\(\{ ok: false, error: 'unauthorized' \}, 401\)/)
})

await test('จองแถว: pending → sending เฉพาะแถวที่ผู้เรียกเป็นผู้กดล่าสุด แล้วจึงอ่าน payload/ส่ง', () => {
  assert.match(src, /\.eq\('delivery', 'pending'\)\s*\.or\(mine\)/)
  assert.match(src, /last_retry_by\.eq\.\$\{userId\},and\(last_retry_by\.is\.null,nudged_by\.eq\.\$\{userId\}\)/)
  const claim = src.indexOf(".update({ delivery: 'sending' })")
  const rpc = src.indexOf("rpc('exec_nudge_payload'")
  assert.ok(claim > 0 && rpc > claim, 'ต้องจองแถวก่อนอ่าน payload')
})

await test('เขียนผลกลับเฉพาะแถวที่ยังเป็น sending (ไม่ทับรอบกดซ้ำ) และทุกทางออกหลังจองต้องเขียนผล', () => {
  assert.match(src, /\.eq\('id', nudgeId\)\s*\.eq\('delivery', 'sending'\)/)
  assert.match(src, /catch \(e\)[\s\S]*?delivery: 'failed'[\s\S]*?await finish\(admin, nudgeId, outcome\)/)
})

await test('ไม่เคารพ dm_muted (ผอ.กองปิดรับเร่งรัดไม่ได้) และไม่อ่านตารางเรื่องเอง (PDPA)', () => {
  assert.doesNotMatch(src, /dm_muted/)
  assert.doesNotMatch(src, /from\('complaints'\)|from\('document_requests'\)/)
})

await test('skipReason ตรวจก่อนอ่านหน่วยงาน/ส่ง — sendable=false ต้องไม่ไปถึง sendTelegramMessage', () => {
  const skip = src.indexOf('skipReason(payload)')
  const send = src.indexOf('sendTelegramMessage(')
  assert.ok(skip > 0 && send > skip)
})

console.log(`\n${cases} cases passed`)
