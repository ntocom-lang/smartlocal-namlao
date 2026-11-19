// รับชำระเงิน · แจ้ง Telegram เมื่อบัญชีรับเงินเปลี่ยน (supabase/functions/payment-account-alert · ขั้น 1C / E4 PR2)
//   ชั้นแรก: ตรรกะล้วนของจริง (_shared/paymentAccountAlert.ts) — escape HTML · ข้อความครั้งแรก/เปลี่ยน · วันเวลาไทย · ป้ายผลส่ง · ผลรวมของรอบ · เทียบรหัสลับ
//   ชั้นสอง: อ่านซอร์ส edge function — ยืนยันตัว (x-cron-secret) ก่อนแตะฐาน · จองคิว → ส่ง → เขียนผลกลับครบทุกแถว · ไม่ลง chat id
// ไม่ใช้เน็ต ไม่ใช้บัญชี ไม่ส่งข้อความจริง
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// โซนเวลาเครื่องเป็นต่างประเทศ: โค้ดที่อ่านวันจากเวลาเครื่องแทนเวลาไทยจะพังในเคสข้ามวัน
process.env.TZ = 'America/Los_Angeles'
const A = await import('../supabase/functions/_shared/paymentAccountAlert.ts')

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const stripComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

let cases = 0
const test = (label, run) => { run(); cases += 1; console.log('PASS ' + label) }

const payload = (over = {}) => ({
  event_id: 42, attempt: 1, changed_at: '2026-11-16T03:05:00Z', municipality_name: 'เทศบาลตำบลตัวอย่าง', telegram_group_id: '-1001234567890',
  first_setup: false, actor_name: 'นางสาวสมหญิง ใจดี', actor_title: 'นักวิชาการเงินและบัญชี',
  fields: [{ field: 'promptpay_id', old: '0994000012345', new: '0994000099999' }, { field: 'payee_name', old: 'อบต.เดิม', new: 'อบต.ใหม่' }],
  dm_chat_ids: ['9001'], ...over,
})

// ── ข้อความ ───────────────────────────────────────────────────────────────────────────
test('escape HTML ของ Telegram: & < > ถูกแปลง · อักขระควบคุมกลายเป็นช่องว่าง · ตัดความยาว · null/undefined = ว่าง', () => {
  assert.equal(A.escapeHtmlText('<b>ร้าย</b> & "ok"'), '&lt;b&gt;ร้าย&lt;/b&gt; &amp; "ok"')
  assert.equal(A.escapeHtmlText('บรรทัด1\nบรรทัด2\u0000\u007f'), 'บรรทัด1 บรรทัด2  ')
  assert.equal(A.escapeHtmlText('x'.repeat(500)).length, 200)
  assert.equal(A.escapeHtmlText('x'.repeat(500), 10).length, 10)
  assert.equal(A.escapeHtmlText(null), '')
  assert.equal(A.escapeHtmlText(undefined), '')
  // ตัดความยาวก่อน escape — "&" ตัวสุดท้ายไม่ถูกตัดครึ่งกลาง entity
  assert.equal(A.escapeHtmlText('ab&', 3), 'ab&amp;')
})

test('ข้อความเปลี่ยนบัญชี: หัว ⚠️ + ช่องที่เปลี่ยนแบบ เดิม → ใหม่ + ผู้ทำ/เวลา + คำเตือนใบแจ้งชำระที่พิมพ์ไปแล้ว', () => {
  const text = A.buildAccountAlertMessage(payload())
  assert.match(text, /^⚠️ <b>บัญชีรับเงินถูกเปลี่ยน<\/b>/)
  assert.ok(text.includes('เทศบาลตำบลตัวอย่าง'))
  assert.ok(text.includes('• เลขพร้อมเพย์ของหน่วยงาน: 0994000012345 → <b>0994000099999</b>'))
  assert.ok(text.includes('• ชื่อบัญชี: อบต.เดิม → <b>อบต.ใหม่</b>'))
  assert.ok(text.includes('โดย นางสาวสมหญิง ใจดี (นักวิชาการเงินและบัญชี)'))
  assert.ok(text.includes('ถ้าไม่ได้สั่งเปลี่ยน ให้ตรวจที่เมนู "รับชำระเงิน" → ตั้งค่า ทันที'))
  assert.ok(text.includes('ใบแจ้งชำระที่พิมพ์ก่อนเวลานี้อาจมี QR ของบัญชีเดิม'))
})

test('ข้อความตั้งครั้งแรก: หัว 🔐 · แสดงเฉพาะค่าใหม่ (ไม่มีลูกศร) · ช่องที่เดิมเป็น null ก็ไม่มีลูกศร · ลบค่า = "(ลบออก)"', () => {
  const first = A.buildAccountAlertMessage(payload({ first_setup: true }))
  assert.match(first, /^🔐 <b>ตั้งบัญชีรับเงินครั้งแรก<\/b>/)
  assert.equal(first.includes('0994000012345'), false, 'ตั้งครั้งแรกไม่แสดงค่าเดิม')
  assert.equal(first.includes(' → <b>'), false, 'ไม่มีลูกศร เดิม → ใหม่ ในรายการช่อง')
  assert.ok(first.includes('• เลขพร้อมเพย์ของหน่วยงาน: <b>0994000099999</b>'))
  const added = A.buildAccountAlertMessage(payload({ fields: [{ field: 'bank_name', old: null, new: 'ธนาคารตัวอย่าง' }] }))
  assert.ok(added.includes('• ธนาคาร: <b>ธนาคารตัวอย่าง</b>'))
  const removed = A.buildAccountAlertMessage(payload({ fields: [{ field: 'biller_id', old: '099400001234501', new: null }] }))
  assert.ok(removed.includes('• รหัสผู้รับชำระ (Biller ID): 099400001234501 → <b>(ลบออก)</b>'))
  assert.ok(A.buildAccountAlertMessage(payload({ fields: [] })).includes('ไม่ระบุช่องที่เปลี่ยน'))
  assert.ok(A.buildAccountAlertMessage(payload({ fields: null })).includes('ไม่ระบุช่องที่เปลี่ยน'), 'fields ผิดรูปไม่ทำให้ข้อความล้ม')
})

test('ทุกค่าที่มาจากฐาน escape ก่อนเสมอ: ชื่อ อปท./ผู้ทำ/ตำแหน่ง/ค่าเดิม/ค่าใหม่/ชื่อช่องที่ไม่รู้จัก — แทรกแท็ก HTML ไม่ได้', () => {
  const evil = '<a href="x">คลิก</a> & <script>'
  const text = A.buildAccountAlertMessage(payload({
    municipality_name: evil, actor_name: evil, actor_title: evil,
    fields: [{ field: 'payee_name', old: evil, new: evil }, { field: evil, old: 'a', new: 'b' }],
  }))
  assert.equal(text.includes('<a href'), false)
  assert.equal(text.includes('<script>'), false)
  assert.ok(text.includes('&lt;a href="x"&gt;คลิก&lt;/a&gt; &amp; &lt;script&gt;'))
  // แท็กที่ระบบใส่เองมีแค่ <b> … </b> เท่านั้น
  const tags = [...text.matchAll(/<\/?([a-z]+)[^>]*>/gi)].map(m => m[1].toLowerCase())
  assert.deepEqual([...new Set(tags)], ['b'])
})

test('ไม่ใส่ chat id / token ในข้อความ และไม่ใส่ข้อมูลประชาชน (ผู้ทำไม่ระบุ = "ไม่ทราบชื่อ")', () => {
  const text = A.buildAccountAlertMessage(payload({ actor_name: null, actor_title: null }))
  assert.ok(text.includes('โดย ไม่ทราบชื่อ'))
  assert.equal(text.includes('-1001234567890'), false)
  assert.equal(text.includes('9001'), false)
})

test('วันเวลาไทย ไม่ขึ้นกับโซนเครื่อง: 03:05Z = 10:05 น. · ข้ามวัน 17:30Z = 00:30 น. วันถัดไป · ผิดรูป = ว่าง', () => {
  const a = A.formatBangkokDateTime('2026-11-16T03:05:00Z')
  assert.ok(a.includes('10:05') && a.endsWith(' น.'), a)
  assert.ok(A.formatBangkokDateTime('2026-11-15T17:30:00Z').includes('00:30'))
  assert.ok(A.formatBangkokDateTime('2026-11-15T17:30:00Z').includes('16'), 'ข้ามวันเป็นวันที่ 16 ตามเวลาไทย')
  assert.equal(A.formatBangkokDateTime('ไม่ใช่เวลา'), '')
  assert.ok(A.buildAccountAlertMessage(payload()).includes('เวลา ' + A.formatBangkokDateTime('2026-11-16T03:05:00Z')))
})

// ── ผลส่ง ─────────────────────────────────────────────────────────────────────────────
test('ป้ายผลส่งที่ลงคิว: "กลุ่ม ✓ · ส่วนตัว 2/3" (ไม่มี chat id)', () => {
  assert.equal(A.deliveryNote('sent', 2, 3), 'กลุ่ม ✓ · ส่วนตัว 2/3')
  assert.equal(A.deliveryNote('failed', 0, 1), 'กลุ่ม ✗ · ส่วนตัว 0/1')
  assert.equal(A.deliveryNote('none', 1, 1), 'ไม่มีกลุ่ม · ส่วนตัว 1/1')
  assert.doesNotMatch(A.deliveryNote('sent', 2, 3), /\d{4,}/)
})

test('ผลรวมของรอบ (outcome): ถึงอย่างน้อย 1 ที่ = sent · ไม่มีปลายทางเลย = skipped · มีปลายทางแต่ไม่ถึงสักที่ = failed (ลองใหม่)', () => {
  assert.equal(A.outcome('sent', 0, 0), 'sent')
  assert.equal(A.outcome('sent', 0, 3), 'sent', 'กลุ่มถึงแต่ DM ไม่ถึง = ยังนับว่าแจ้งแล้ว')
  assert.equal(A.outcome('failed', 1, 3), 'sent', 'กลุ่มล้มแต่ DM ถึงคนเดียว = sent')
  assert.equal(A.outcome('none', 2, 2), 'sent')
  assert.equal(A.outcome('none', 0, 0), 'skipped', 'ไม่มีกลุ่มและไม่มี DM = ข้าม ให้หน้าจอบอกให้ผูก Telegram')
  assert.equal(A.outcome('failed', 0, 0), 'failed', 'มีกลุ่มแต่ส่งไม่ถึง = ล้ม ลองใหม่')
  assert.equal(A.outcome('failed', 0, 2), 'failed')
  assert.equal(A.outcome('none', 0, 2), 'failed', 'ไม่มีกลุ่มแต่มี DM ส่งไม่ถึง = ล้ม ลองใหม่')
})

test('เทียบรหัสลับ safeEqual: ตรง/ไม่ตรง/ความยาวต่าง/ว่าง · ไม่ throw กับยูนิโค้ด', () => {
  assert.equal(A.safeEqual('secret-123', 'secret-123'), true)
  assert.equal(A.safeEqual('secret-123', 'secret-124'), false)
  assert.equal(A.safeEqual('secret', 'secret-longer'), false)
  assert.equal(A.safeEqual('', 'x'), false)
  assert.equal(A.safeEqual('', ''), true, 'ผู้เรียกต้องกันกรณี CRON_SECRET ว่างเอง (ซอร์สตอบ 500 ก่อน)')
  assert.equal(A.safeEqual('รหัสลับ', 'รหัสลับ'), true)
})

// ── ซอร์ส edge function ──────────────────────────────────────────────────────────────
const fn = stripComments(read('supabase/functions/payment-account-alert/index.ts'))
const at = needle => { const i = fn.indexOf(needle); assert.ok(i >= 0, `ไม่พบ ${needle}`); return i }

test('ยืนยันตัวก่อนแตะฐาน: POST เท่านั้น → ตั้งค่าครบ → CRON_SECRET ต้องมี → เทียบ x-cron-secret ด้วย safeEqual → ค่อยสร้าง client service_role', () => {
  assert.ok(at("req.method !== 'POST'") < at('CRON_SECRET is not configured'))
  assert.ok(at('CRON_SECRET is not configured') < at("'x-cron-secret'"))
  assert.ok(at("'x-cron-secret'") < at('createClient('))
  assert.ok(at('createClient(') < at("rpc('payment_alert_claim'"))
  assert.match(fn, /safeEqual\(req\.headers\.get\('x-cron-secret'\) \?\? '', CRON_SECRET\)/)
  assert.match(fn, /status: 401|, 401\)/, 'รหัสผิดตอบ 401')
  assert.ok(fn.includes('persistSession: false'))
})

test('ลำดับงาน: จองคิว → สร้างข้อความ → ส่งกลุ่ม → ส่ง DM → outcome → payment_alert_finish (ทุกแถวที่จองต้องถูกเขียนผลกลับ)', () => {
  assert.ok(at("rpc('payment_alert_claim'") < at('buildAccountAlertMessage(item)'))
  assert.ok(at('buildAccountAlertMessage(item)') < at('item.telegram_group_id'))
  assert.ok(at('item.telegram_group_id') < at('for (const chatId of dmIds)'))
  assert.ok(at('for (const chatId of dmIds)') < at('outcome(group, dmSent, dmIds.length)'))
  assert.ok(at('outcome(group, dmSent, dmIds.length)') < at("rpc('payment_alert_finish'"))
  // finish อยู่ในลูปของแต่ละแถว (ไม่ใช่นอกลูป — แถวหลังๆ จะไม่ถูกปิด)
  assert.ok(at('for (const item of items)') < at("rpc('payment_alert_finish'"))
  assert.match(fn, /p_event_id: item\.event_id/)
  assert.match(fn, /p_error: status === 'failed'/, 'ลงข้อความ error เฉพาะแถวที่ล้ม')
})

test('PDPA/ความลับ: chat id และ token ไม่ลง note/error/log · ไม่ console.log ข้อความ · ไม่ส่ง chat id กลับใน response', () => {
  assert.equal(/console\.(log|info|debug)/.test(fn), false, 'ห้าม log (ข้อความมีเลขบัญชีที่ปิดบางส่วน และ chat id)')
  const finishCall = fn.slice(at("rpc('payment_alert_finish'"))
  assert.equal(/chatId|chat_id|telegram_group_id/.test(finishCall.slice(0, finishCall.indexOf('if (finishError)'))), false, 'ผลที่ลงคิวไม่มี chat id')
  const response = fn.slice(fn.lastIndexOf('return json({ ok: summary.errors.length'))
  assert.equal(/chat|token/i.test(response), false)
  assert.equal(/BOT_TOKEN/.test(fn.replace(/const BOT_TOKEN[^\n]*\n/, '').replace(/!BOT_TOKEN/, '').replace(/, BOT_TOKEN\)/g, ')')), false, 'BOT_TOKEN ใช้แค่ตอนส่ง ไม่ถูกส่งต่อที่อื่น')
})

test('ซ้ำ chat id ใน DM ส่งครั้งเดียว · ไม่เคารพ dm_muted (กันแอบเปลี่ยนบัญชี) · ข้อความไม่ใช่ข้อความอิสระของผู้ใช้', () => {
  assert.match(fn, /\[\.\.\.new Set\(item\.dm_chat_ids\.map\(String\)\)\]/)
  assert.equal(/dm_muted/.test(fn), false)
  const shared = stripComments(read('supabase/functions/_shared/paymentAccountAlert.ts'))
  assert.equal(/\bfetch\(|Deno\./.test(shared), false, 'ตัวช่วยร่วมเป็นฟังก์ชันล้วน ไม่แตะเน็ต/Deno (เทสต์ด้วย node ได้)')
})

console.log(`\nok — ${cases} cases`)
