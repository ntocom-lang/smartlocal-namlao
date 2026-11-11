// ห้องผู้บริหาร E3-3 "สรุปเช้า + แจ้งคะแนนต่ำ" (supabase/functions/exec-digest-notify)
//   ชั้นแรก: ตรรกะล้วนของจริง (_shared/execDigest.ts) — ข้อความครบ/ว่าง/truncated/sensitive · escape HTML · ≤ 4096 ตัว ·
//            คะแนนต่ำ ≤ 10 บรรทัด + "และอีก N" · ป้ายสถานะตรงกับหน้าเว็บ · กุญแจกันส่งซ้ำไม่มีข้อมูลส่วนบุคคล
//   ชั้นสอง: อ่านซอร์ส edge function — cron secret ก่อนทำอะไร · ลำดับ claim → ส่ง → ack · heartbeat เฉพาะรอบเต็ม ·
//            ignore_working_day ใช้ได้เฉพาะคู่ only_slug · ไม่อ่านตารางเรื่องเอง (PDPA)
// ไม่ใช้เน็ต ไม่ใช้บัญชี ไม่ส่งข้อความจริง
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// โซนเวลาเครื่องเป็นต่างประเทศ: โค้ดที่อ่านวันจากเวลาเครื่องแทนเวลาไทยจะพังในเคสข้ามวัน
process.env.TZ = 'America/Los_Angeles'
const D = await import('../supabase/functions/_shared/execDigest.ts')
const H = await import('../src/lib/execFollowNudgeHelpers.js')

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

// รูปผลของ exec_digest_for (ดูหัวไฟล์ migration 20261118100100) — ไม่มีชื่อคน
const raw = (over = {}) => ({
  ok: true,
  as_of: '2026-11-11',
  municipality_id: id(1),
  window: { from: '2026-11-10', to: '2026-11-11' },
  new: { complaints: 3, requests: 2 },
  overdue: {
    total: 12, truncated: false, sensitive: 2, over5: 3,
    top: [
      { k: 'complaint', ref: 'CR-6911-0042', cat: 'road', cat_label: 'ถนนชำรุด', dept: 'กองช่าง', due: '2026-10-28', wd: 9 },
      { k: 'document_request', ref: 'A1B2C3D4', cat: 'water_supply_request', cat_label: null, dept: null, due: '2026-10-30', wd: 7 },
    ],
  },
  esign: { count: 2, over_2wd: 1, oldest_at: '2026-11-05T03:00:00Z' },
  follows: {
    active: 4,
    items: [
      { k: 'complaint', id: id(11), ref: 'CR-0001', state: 'changed', from: 'received', to: 'in_progress' },
      { k: 'complaint', id: id(12), ref: 'CR-0002', state: 'done', from: 'in_progress', to: 'closed' },
      { k: 'document_request', id: id(13), ref: 'DOC-3', state: 'done', from: 'processing', to: 'completed' },
      { k: 'complaint', id: id(14), ref: 'CR-0003', state: 'gone', from: 'received', to: null },
    ],
    more: 0,
  },
  events: { items: [{ title: 'ประชุมสภา', event_date: '2026-11-11', end_date: null, event_time: '09:00:00' },
    { title: 'ตรวจโครงการ', event_date: '2026-11-11', end_date: null, event_time: null }], more: 0 },
  ack: [],
  ...over,
})
const digest = (over) => D.readDigest(raw(over))
const msg = (over, tenantName = 'เทศบาลตำบลสาธิต') => D.buildDigestMessage({ digest: digest(over), tenantName })
const lines = (text) => text.split('\n')

// ── readDigest / isEmptyDigest ──────────────────────────────────────────────

test('readDigest: ok:false / ไม่ใช่ object / ไม่มี as_of → null (ข้าม ไม่ส่ง)', () => {
  assert.equal(D.readDigest({ ok: false, reason: 'not_eligible' }), null)
  assert.equal(D.readDigest(null), null)
  assert.equal(D.readDigest('x'), null)
  assert.equal(D.readDigest({ ok: true }), null)
})

test('readDigest: ช่องหาย/ผิดชนิด ไม่พัง — ได้ค่าตั้งต้น 0 / ว่าง', () => {
  const d = D.readDigest({ ok: true, as_of: '2026-11-11', follows: null, events: 'x', overdue: [] })
  assert.equal(d.newComplaints, 0)
  assert.equal(d.esign.count, 0)
  assert.deepEqual(d.follows.items, [])
  assert.deepEqual(d.events.items, [])
  assert.equal(d.overdue.total, 0)
  assert.equal(d.windowFrom, '2026-11-11')
})

test('isEmptyDigest: ทุกหมวดว่าง = ว่าง · หมวดใดหมวดหนึ่งมีของ = ไม่ว่าง (รวม sensitive อย่างเดียว / กิจกรรมอย่างเดียว)', () => {
  const empty = {
    new: { complaints: 0, requests: 0 }, esign: { count: 0, over_2wd: 0 },
    overdue: { total: 0, sensitive: 0, over5: 0, top: [] },
    follows: { items: [], more: 0 }, events: { items: [], more: 0 },
  }
  assert.equal(D.isEmptyDigest(digest(empty)), true)
  assert.equal(D.isEmptyDigest(digest({ ...empty, new: { complaints: 1, requests: 0 } })), false)
  assert.equal(D.isEmptyDigest(digest({ ...empty, new: { complaints: 0, requests: 1 } })), false)
  assert.equal(D.isEmptyDigest(digest({ ...empty, esign: { count: 1, over_2wd: 0 } })), false)
  assert.equal(D.isEmptyDigest(digest({ ...empty, overdue: { total: 1, sensitive: 0, over5: 0, top: [] } })), false)
  assert.equal(D.isEmptyDigest(digest({ ...empty, overdue: { total: 0, sensitive: 1, over5: 0, top: [] } })), false)
  assert.equal(D.isEmptyDigest(digest({ ...empty, follows: { items: [{ k: 'complaint', ref: 'X', state: 'gone' }], more: 0 } })), false)
  assert.equal(D.isEmptyDigest(digest({ ...empty, events: { items: [{ title: 'ประชุม', event_time: null }], more: 0 } })), false)
})

// ── ข้อความสรุปเช้า ─────────────────────────────────────────────────────────

test('สรุปเช้าครบทุกหมวด: หัว + วันที่ไทย พ.ศ. + เรื่องใหม่ + ลงนาม + เลยกำหนด + ติดตาม + กำหนดการ + ท้าย', () => {
  const text = msg()
  assert.match(text, /^☀️ <b>สรุปเช้า เทศบาลตำบลสาธิต<\/b>\n11 พ\.ย\. 2569\n/)
  assert.match(text, /เรื่องใหม่ \(ตั้งแต่ 10 พ\.ย\. 2569\): คำร้อง 3 · คำขอ 2/)
  assert.match(text, /รอท่านลงนาม 2 ใบ/)
  assert.match(text, /<b>⚠️ ถึงคิวท่านเกิน 2 วันทำการ 1 ใบ<\/b>/)
  assert.match(text, /เลยกำหนด 12 เรื่อง \(หมวดคุ้มครองผู้ร้อง 2 เรื่อง — แสดงเป็นยอดรวม\)/)
  assert.match(text, /<b>🔴 เลยกำหนดเกิน 5 วันทำการ 3 เรื่อง<\/b>/)
  assert.match(text, /เรื่องที่ท่านติดตาม/)
  assert.match(text, /กำหนดการวันนี้/)
  assert.ok(text.endsWith('ดูรายละเอียดที่เมนู ห้องผู้บริหาร · ปิดรับสรุปเช้าได้ที่ ตั้งค่าแจ้งเตือน'))
})

test('แถวเลยกำหนดเกิน 5 วันทำการ: คำร้องใช้ชื่อหมวด · คำขอใช้ชื่อประเภทจากทะเบียน · กองว่าง = "ไม่ระบุกอง" · มี "เลย N วันทำการ"', () => {
  const text = msg()
  assert.match(text, /• CR-6911-0042 ถนนชำรุด · กองช่าง · เลย 9 วันทำการ/)
  assert.match(text, /• A1B2C3D4 ขออนุญาตใช้น้ำประปา · ไม่ระบุกอง · เลย 7 วันทำการ/)
  // over5 3 แต่ top 2 แถว → บอกว่ายังมีอีก ไม่ทำให้เข้าใจว่าครบ
  assert.match(text, /และอีก 1 เรื่อง/)
})

test('ประเภทคำขอที่ อปท. เพิ่มเอง (fee_schedule._custom_types) ใช้ชื่อที่ตั้งไว้ · ไม่รู้จัก = แสดงรหัสตามที่ได้', () => {
  const d = digest({ overdue: { total: 1, sensitive: 0, over5: 1, top: [
    { k: 'document_request', ref: 'ZZ', cat: 'my_custom', cat_label: null, dept: 'กองช่าง', due: '2026-10-01', wd: 8 }] } })
  const fee = { _custom_types: [{ value: 'my_custom', label: 'ขอใช้ห้องประชุม' }] }
  assert.match(D.buildDigestMessage({ digest: d, tenantName: 'x', feeSchedule: fee }), /• ZZ ขอใช้ห้องประชุม · กองช่าง/)
  assert.match(D.buildDigestMessage({ digest: d, tenantName: 'x' }), /• ZZ my_custom · กองช่าง/)
})

test('ลงนาม: count=0 ไม่แสดงเลย · over_2wd=0 ไม่มีบรรทัดเด่น', () => {
  assert.doesNotMatch(msg({ esign: { count: 0, over_2wd: 0 } }), /ลงนาม/)
  const t = msg({ esign: { count: 3, over_2wd: 0 } })
  assert.match(t, /รอท่านลงนาม 3 ใบ/)
  assert.doesNotMatch(t, /เกิน 2 วันทำการ/)
})

test('เลยกำหนด truncated: เขียน "อย่างน้อย" ทั้งยอดรวมและยอดเกิน 5 วัน · over5=0 ไม่มีบรรทัดเด่นและไม่มีแถว', () => {
  const t = msg({ overdue: { total: 300, truncated: true, sensitive: 0, over5: 40, top: [] } })
  assert.match(t, /เลยกำหนด อย่างน้อย 300 เรื่อง/)
  assert.match(t, /<b>🔴 เลยกำหนดเกิน 5 วันทำการ อย่างน้อย 40 เรื่อง<\/b>/)
  assert.doesNotMatch(t, /\(หมวดคุ้มครองผู้ร้อง/)
  const calm = msg({ overdue: { total: 4, truncated: false, sensitive: 0, over5: 0, top: [] } })
  assert.match(calm, /เลยกำหนด 4 เรื่อง/)
  assert.doesNotMatch(calm, /🔴/)
})

test('หมวดคุ้มครองผู้ร้อง (sensitive): ขึ้นเป็นยอดรวมอย่างเดียว ไม่มีเลขที่/ชื่อ · total=0 แต่ sensitive>0 ก็ยังแจ้ง', () => {
  const t = msg({ overdue: { total: 0, truncated: false, sensitive: 3, over5: 0, top: [] } })
  assert.match(t, /เลยกำหนด 0 เรื่อง \(หมวดคุ้มครองผู้ร้อง 3 เรื่อง — แสดงเป็นยอดรวม\)/)
})

test('เรื่องที่ติดตาม: changed/done/gone + ป้ายสถานะตามหน้าเว็บ + "และอีก N เรื่อง"', () => {
  const t = msg({ follows: { active: 9, more: 5, items: raw().follows.items } })
  assert.match(t, /• <b>CR-0001<\/b> รับเรื่องแล้ว → กำลังดำเนินการ/)
  assert.match(t, /• <b>CR-0002<\/b> ดำเนินการแล้ว \(เลิกติดตามให้แล้ว\)/)
  assert.match(t, /• <b>DOC-3<\/b> เสร็จสิ้น \(เลิกติดตามให้แล้ว\)/)
  assert.match(t, /• <b>CR-0003<\/b> ไม่พบเรื่องนี้แล้ว \(เลิกติดตามให้แล้ว\)/)
  assert.match(t, /และอีก 5 เรื่อง/)
})

test('เรื่องที่ติดตามว่าง = ไม่มีหัวข้อ · กำหนดการว่าง = ไม่มีหัวข้อ', () => {
  const t = msg({ follows: { active: 0, items: [], more: 0 }, events: { items: [], more: 0 } })
  assert.doesNotMatch(t, /เรื่องที่ท่านติดตาม/)
  assert.doesNotMatch(t, /กำหนดการวันนี้/)
})

test('เรื่องติดตามที่ยังไม่เคยแจ้งสถานะ (from ว่าง): แสดงสถานะปัจจุบัน ไม่เดาสถานะเดิม', () => {
  const t = msg({ follows: { active: 1, more: 0, items: [{ k: 'complaint', ref: 'CR-9', state: 'changed', from: null, to: 'received' }] } })
  assert.match(t, /• <b>CR-9<\/b> สถานะตอนนี้ รับเรื่องแล้ว/)
})

test('กำหนดการ: HH:MM หรือ "ทั้งวัน" (event_time null) · ตัดวินาที · more', () => {
  const t = msg({ events: { items: raw().events.items, more: 2 } })
  assert.match(t, /• 09:00 ประชุมสภา/)
  assert.match(t, /• ทั้งวัน ตรวจโครงการ/)
  assert.match(t, /และอีก 2 รายการ/)
  assert.equal(D.eventTimeLabel('13:45:00'), '13:45')
  assert.equal(D.eventTimeLabel(''), 'ทั้งวัน')
  assert.equal(D.eventTimeLabel('ทั้งวัน'), 'ทั้งวัน')
})

test('ชื่อกิจกรรม/ชื่อ อปท./เลขที่ ที่มีแท็ก HTML ถูก escape — <b> ไม่ทะลุไปเป็นแท็กจริง', () => {
  const t = msg({
    events: { items: [{ title: '<b>ประชุม</b> & <script>x</script>', event_time: '09:00' }], more: 0 },
    follows: { active: 1, more: 0, items: [{ k: 'complaint', ref: '<i>CR</i>', state: 'gone' }] },
  }, 'อบต.<u>ทดสอบ</u>')
  assert.match(t, /• 09:00 &lt;b&gt;ประชุม&lt;\/b&gt; &amp; &lt;script&gt;x&lt;\/script&gt;/)
  assert.match(t, /&lt;i&gt;CR&lt;\/i&gt;/)
  assert.match(t, /อบต\.&lt;u&gt;ทดสอบ&lt;\/u&gt;/)
  // แท็กที่เหลือในข้อความต้องเป็นของเราเท่านั้น (<b> ปิดครบคู่)
  const open = (t.match(/<b>/g) ?? []).length
  const close = (t.match(/<\/b>/g) ?? []).length
  assert.equal(open, close)
  assert.doesNotMatch(t.replace(/<\/?b>/g, ''), /[<>]/)
})

test('ยาวเกิน 4096: ลดบรรทัดรายการ (กิจกรรม → ติดตาม → เลยกำหนด) ไม่ตัดกลางแท็ก · แท็ก <b> ยังปิดครบคู่', () => {
  const longTitle = 'ก'.repeat(120)
  const events = Array.from({ length: 8 }, (_, i) => ({ title: longTitle + i, event_time: '09:00' }))
  const follows = Array.from({ length: 20 }, (_, i) => ({ k: 'complaint', ref: 'CR-' + 'X'.repeat(30) + i, state: 'changed', from: 'received', to: 'in_progress' }))
  const top = Array.from({ length: 5 }, (_, i) => ({ k: 'complaint', ref: 'R'.repeat(40), cat: 'c', cat_label: 'ห'.repeat(80), dept: 'ก'.repeat(80), wd: 9 + i }))
  const overBudget = D.buildDigestMessage({
    digest: digest({ events: { items: events, more: 3 }, follows: { active: 20, items: follows, more: 4 }, overdue: { total: 99, truncated: false, sensitive: 1, over5: 20, top } }),
    tenantName: 'ท'.repeat(300),
  })
  assert.ok(overBudget.length <= D.TELEGRAM_MAX, `ยาว ${overBudget.length}`)
  assert.ok((overBudget.match(/• 09:00/g) ?? []).length < 8, 'ต้องมีการลดบรรทัดกิจกรรมจริง (ไม่ใช่ข้อมูลสั้นอยู่แล้ว)')
  assert.equal((overBudget.match(/<b>/g) ?? []).length, (overBudget.match(/<\/b>/g) ?? []).length)
  // ส่วนหัว/ท้ายคงอยู่ ยังบอกว่ามีรายการที่ไม่ได้แสดง
  assert.match(overBudget, /^☀️ <b>สรุปเช้า /)
  assert.match(overBudget, /ปิดรับสรุปเช้าได้ที่ ตั้งค่าแจ้งเตือน$/)
  assert.match(overBudget, /และอีก \d+ (เรื่อง|รายการ)/)
  // ข้อความปกติไม่ถูกลดอะไร
  assert.ok(msg().length < D.TELEGRAM_MAX)
  assert.match(msg(), /ตรวจโครงการ/)
})

test('ข้อความสรุปเช้าไม่มีข้อมูลส่วนบุคคลของผู้ร้อง: ไม่มีช่อง ชื่อ/เบอร์/ที่อยู่ ในสัญญาข้อมูล และไม่ปรากฏในข้อความ', () => {
  const dirty = raw()
  dirty.overdue.top[0].requester_name = 'สมชาย ทดสอบปลอม'
  dirty.overdue.top[0].phone = '0812345678'
  dirty.follows.items[0].detail = 'รายละเอียดลับ'
  const t = D.buildDigestMessage({ digest: D.readDigest(dirty), tenantName: 'x' })
  for (const secret of ['สมชาย', '0812345678', 'รายละเอียดลับ']) assert.ok(!t.includes(secret), secret)
})

// ── ป้ายสถานะตรงกับหน้าเว็บ ─────────────────────────────────────────────────

test('statusLabel (edge) ตรงกับ itemStatusLabel (หน้าเว็บ) ทุกสถานะ ทั้งคำร้องและคำขอ · สถานะแปลก/ว่างก็ตรงกัน', () => {
  const complaint = ['new', 'pending', 'received', 'in_progress', 'parked', 'done', 'closed', 'rejected', 'weird_status', '', null, undefined]
  const request = ['pending', 'processing', 'completed', 'rejected', 'weird_status', '', null, undefined]
  for (const s of complaint) assert.equal(D.statusLabel('complaint', s), H.itemStatusLabel('complaint', s), `complaint:${s}`)
  for (const s of request) assert.equal(D.statusLabel('document_request', s), H.itemStatusLabel('document_request', s), `document_request:${s}`)
  assert.equal(D.statusLabel('complaint', 'parked'), 'ขึ้นทะเบียนรอดำเนินการ')
})

// ── แจ้งคะแนนต่ำ ────────────────────────────────────────────────────────────

const lowRow = (n, over = {}) => ({
  municipality_id: id(1), rating_id: id(100 + n), rating: 1, source: 'verified', rated_at: '2026-11-11T07:05:00Z',
  sensitive: false, ref: `CR-00${n}`, cat_label: 'ถนนชำรุด', dept: 'กองช่าง', ...over,
})
const lowMsg = (rows, tenantName = 'เทศบาลตำบลสาธิต') =>
  D.buildLowRatingMessage({ ratings: D.readLowRatings(rows).map((x) => x.value), tenantName })

test('คะแนนต่ำ: หัวมีจำนวน+ชื่อ อปท. · แต่ละบรรทัด ⭐ คะแนน เลขที่ หมวด กอง ที่มา เวลาไทย · ท้ายบอกวิธีปิดรับ', () => {
  const t = lowMsg([lowRow(1, { rating: 2, source: 'proxy' })])
  assert.match(t, /^⚠️ <b>คะแนนความพึงพอใจต่ำ 1 รายการ — เทศบาลตำบลสาธิต<\/b>\n/)
  // 07:05 UTC = 14:05 น. เวลาไทย
  assert.match(t, /• ⭐2\/5 CR-001 ถนนชำรุด · กองช่าง · สท\. บันทึกแทน · 14:05 น\. 11 พ\.ย\. 2569/)
  assert.ok(t.endsWith('ปิดรับการแจ้งนี้ได้ที่ ตั้งค่าแจ้งเตือน'))
})

test('ที่มาของคะแนนครบ 4 แบบ ตามถ้อยคำที่เจ้าของระบบกำหนด · กองว่าง = "ไม่ระบุกอง"', () => {
  assert.equal(D.RATING_SOURCE_LABEL.proxy, 'สท. บันทึกแทน')
  assert.equal(D.RATING_SOURCE_LABEL.verified, 'ผู้ยื่นประเมินเอง')
  assert.equal(D.RATING_SOURCE_LABEL.via_link, 'ผู้ถือลิงก์ติดตามเรื่อง')
  assert.equal(D.RATING_SOURCE_LABEL.linked_anon, 'ไม่ได้ล็อกอิน')
  const t = lowMsg([lowRow(1, { source: 'via_link', dept: null })])
  assert.match(t, /ไม่ระบุกอง · ผู้ถือลิงก์ติดตามเรื่อง/)
})

test('คะแนนต่ำหมวดอ่อนไหว: ไม่มีเลขที่/หมวด/ที่มา/เวลา มีแค่คะแนน + กอง', () => {
  const t = lowMsg([lowRow(1, { sensitive: true, ref: null, cat_label: null, rating: 1, dept: 'สำนักปลัด' })])
  assert.match(t, /• ⭐1\/5 เรื่องหมวดคุ้มครองผู้ร้อง · สำนักปลัด/)
  assert.doesNotMatch(t, /CR-|ถนน|ผู้ยื่นประเมินเอง|น\./)
})

test('ค่า sensitive ที่ไม่ใช่ boolean = ถือว่าอ่อนไหว (ไม่ปล่อยเลขที่ออกไป) · แถวที่ id ไม่ใช่ uuid ถูกทิ้ง', () => {
  const rows = D.readLowRatings([lowRow(1, { sensitive: null, ref: 'CR-SECRET' }), lowRow(2, { rating_id: 'x' }), lowRow(3, { municipality_id: null })])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].value.sensitive, true)
  assert.doesNotMatch(D.lowRatingLine(rows[0].value), /CR-SECRET/)
})

test('คะแนนต่ำเกิน 10 รายการ: แสดง 10 บรรทัด + "และอีก N รายการ — ดูที่ห้องผู้บริหาร" · หัวบอกจำนวนทั้งหมด', () => {
  const rows = Array.from({ length: 13 }, (_, i) => lowRow(i + 1))
  const t = lowMsg(rows)
  assert.match(t, /คะแนนความพึงพอใจต่ำ 13 รายการ/)
  assert.equal(lines(t).filter((l) => l.startsWith('• ⭐')).length, 10)
  assert.match(t, /และอีก 3 รายการ — ดูที่ห้องผู้บริหาร/)
  const exactly10 = lowMsg(rows.slice(0, 10))
  assert.doesNotMatch(exactly10, /และอีก/)
  assert.ok(t.length <= D.TELEGRAM_MAX)
})

test('คะแนนต่ำ: escape ชื่อหมวด/กอง ที่มีแท็ก HTML · ไม่มีช่องความเห็นในข้อความ', () => {
  const t = lowMsg([lowRow(1, { cat_label: '<b>x</b>', dept: 'a&b', comment: 'ความเห็นลับ' })])
  assert.match(t, /&lt;b&gt;x&lt;\/b&gt; · a&amp;b/)
  assert.ok(!t.includes('ความเห็นลับ'))
})

test('thaiDateTime: อ่านเป็นเวลาไทยข้ามวัน (17:30 UTC = 00:30 วันถัดไปตามเวลาไทย) · อ่านไม่ได้ = "-"', () => {
  assert.equal(D.thaiDateTime('2026-11-10T17:30:00Z'), '00:30 น. 11 พ.ย. 2569')
  assert.equal(D.thaiDateTime('ไม่ใช่เวลา'), '-')
})

// ── กุญแจกันส่งซ้ำ ──────────────────────────────────────────────────────────

test('idempotency key: รูปแบบตามที่ตกลง และมีแต่ uuid/วันที่ (ไม่มี chat_id/ชื่อ)', () => {
  assert.equal(D.digestKey('2026-11-11', id(5)), `exec_digest:2026-11-11:${id(5)}`)
  assert.equal(D.lowRatingKey(id(7), id(5)), `exec_low_rating:${id(7)}:${id(5)}`)
  assert.equal(D.DIGEST_NOTIFICATION_TYPE, 'exec_digest')
  assert.equal(D.LOW_RATING_NOTIFICATION_TYPE, 'exec_low_rating')
  assert.equal(D.DIGEST_JOB, 'exec-digest-notify')
  assert.equal(D.LOW_RATING_JOB, 'exec-low-rating-alert')
})

// ── ซอร์ส edge function ─────────────────────────────────────────────────────

const src = stripComments(read('supabase/functions/exec-digest-notify/index.ts'))
const header = read('supabase/functions/exec-digest-notify/index.ts').split('\n').slice(0, 5).join('\n')

test('หัวไฟล์บอกวิธี deploy แบบ --no-verify-jwt + ให้ deploy จาก master', () => {
  assert.match(header, /functions deploy exec-digest-notify --no-verify-jwt --project-ref umxssfahtuprnztlytdd/)
  assert.match(header, /--no-verify-jwt/)
  assert.match(header, /master/)
})

test('POST เท่านั้น · cron secret (safeEqual) ตรวจก่อนอ่าน body/ทำงานใดๆ · ไม่ผ่าน = 401', () => {
  assert.match(src, /req\.method !== 'POST'\) return json\(\{ ok: false, error: 'method not allowed' \}, 405\)/)
  assert.match(src, /safeEqual\(req\.headers\.get\('x-cron-secret'\) \?\? '', CRON_SECRET\)/)
  assert.match(src, /error: 'unauthorized' \}, 401/)
  const auth = src.indexOf("safeEqual(req.headers.get('x-cron-secret')")
  assert.ok(auth > 0)
  assert.ok(auth < src.indexOf('req.json()'), 'ต้องตรวจ secret ก่อนอ่าน body')
  assert.ok(auth < src.indexOf('createClient('), 'ต้องตรวจ secret ก่อนสร้าง client')
})

test('body: mode บังคับ · only_slug ผ่าน validSlug · only_user เป็น uuid · ignore_working_day ใช้ได้เฉพาะคู่ only_slug', () => {
  assert.match(src, /mode !== 'digest' && mode !== 'low_rating'\) return json\(\{ ok: false, error: 'invalid mode' \}, 400\)/)
  assert.match(src, /validSlug\(body\.only_slug\)/)
  assert.match(src, /isUuid\(body\.only_user\)/)
  assert.match(src, /ignoreWorkingDay && !onlySlug\) return json\(\{ ok: false, error: 'ignore_working_day requires only_slug' \}, 400\)/)
})

test('ข้ามวันหยุดทุกรอบ ยกเว้นระบุ ignore_working_day · สรุปเช้า: ข้ามก่อนเรียก exec_digest_for', () => {
  assert.match(src, /!r\.is_working_day && !opt\.ignoreWorkingDay\) \{ summary\.holiday \+= 1; continue \}/)
  const holiday = src.indexOf('summary.holiday += 1')
  assert.ok(holiday > 0 && holiday < src.indexOf("rpc('exec_digest_for'"))
})

test('สรุปเช้า: ลำดับ ว่าง→ข้าม → dry_run คืน preview → claim → ส่ง → ack · ack เฉพาะหลังส่งสำเร็จ', () => {
  const empty = src.indexOf('isEmptyDigest(digest)')
  const dry = src.indexOf('if (opt.dryRun) { previews.push')
  const claim = src.indexOf('await claim(admin, {', dry)
  const send = src.indexOf('sendTelegramMessage(', claim)
  const ack = src.indexOf("rpc('exec_digest_ack'")
  assert.ok(empty > 0 && dry > empty && claim > dry && send > claim && ack > send, 'ลำดับผิด')
  // ส่งไม่สำเร็จต้อง continue ก่อนถึง ack
  const between = src.slice(send, ack)
  assert.match(between, /if \(!result\.ok\) \{[\s\S]*?continue\s*\}/)
  // ack ล้มไม่ throw (นับ error) — ข้อความไปถึงแล้ว
  assert.match(src, /if \(ackError\) \{[\s\S]*?summary\.errors\.push/)
})

test('claim: channel telegram_dm · ชน 23505 แล้วพลิกเฉพาะแถว failed กลับ pending ด้วยคำสั่งเดียว (กันสองรอบแย่งกัน)', () => {
  assert.match(src, /const CHANNEL = 'telegram_dm'/)
  assert.match(src, /error\.code !== '23505'/)
  assert.match(src, /\.update\(\{ status: 'pending'[\s\S]*?\.eq\('status', 'failed'\)\s*\.select\('id'\)/)
  assert.match(src, /resource_type: row\.notification_type === DIGEST_NOTIFICATION_TYPE \? 'profile' : 'satisfaction_rating'/)
})

test('ผลส่ง: อัปเดต sent/failed + attempt_count/sent_at/provider_message_id/last_error ผ่าน cleanText · 403 ลบลิงก์ตาม user+chat', () => {
  assert.match(src, /status: result\.ok \? 'sent' : 'failed'/)
  for (const col of ['attempt_count', 'sent_at', 'provider_message_id', 'last_error']) assert.match(src, new RegExp(col))
  assert.match(src, /cleanText\(result\.error, 300\)/)
  assert.match(src, /result\.status !== 403/)
  assert.match(src, /from\('telegram_user_links'\)\.delete\(\)\.eq\('user_id', r\.user_id\)\.eq\('chat_id', r\.chat_id\)/)
})

test('คะแนนต่ำ: ย้อน 7 วัน · ผู้รับหมวด exec_alert · จองทีละคะแนนแล้วส่งฉบับเดียว · อัปเดตทุกแถวที่จองพร้อมกัน', () => {
  assert.match(src, /LOW_RATING_LOOKBACK_MS = 7 \* 24 \* 60 \* 60 \* 1000/)
  assert.match(src, /loadRecipients\(admin, 'exec_alert', opt\)/)
  assert.match(src, /loadRecipients\(admin, 'exec_digest', opt\)/)
  assert.match(src, /finishClaims\(admin, r\.municipality_id, mine\.map\(\(m\) => m\.key\), result\)/)
  assert.match(src, /\.in\('idempotency_key', keys\)/)
  const claims = src.indexOf('lowRatingKey(p.ratingId, r.user_id)')
  const send = src.indexOf('sendTelegramMessage(', claims)
  assert.ok(claims > 0 && send > claims)
})

test('heartbeat: เฉพาะรอบเต็ม (ไม่ dry_run ไม่ only_slug ไม่ only_user) · job ตามโหมด · มี error/ส่งพลาด = ลง last_error ไม่ลง ok', () => {
  assert.match(src, /const fullRun = !dryRun && !onlySlug && !onlyUser/)
  assert.match(src, /mode === 'digest' \? DIGEST_JOB : LOW_RATING_JOB/)
  assert.match(src, /problems\.length === 0 \? \{ ok: true \} : \{ ok: false, error: problems\.join/)
  assert.equal((src.match(/if \(fullRun\)/g) ?? []).length, 2, 'ทั้งทางปกติและทาง throw ต้องลงสมุดเฉพาะ fullRun')
})

test('ตอบ json รูปตามสัญญา: ok/mode/dry_run/summary + previews เฉพาะ dry_run · summary มีครบทุกช่อง', () => {
  assert.match(src, /json\(\{ ok: true, mode, dry_run: dryRun, summary, \.\.\.\(dryRun \? \{ previews \} : \{\}\) \}\)/)
  for (const k of ['recipients', 'sent', 'failed', 'alreadySent', 'empty', 'notEligible', 'holiday', 'errors']) {
    assert.match(src, new RegExp(`\\b${k}\\b`))
  }
})

test('PDPA: ไม่อ่านตารางเรื่อง/คะแนนเอง · ไม่ใส่ chat_id ใน key/last_error/log · ไม่ log ข้อความ', () => {
  assert.doesNotMatch(src, /from\('complaints'\)|from\('document_requests'\)|from\('satisfaction_ratings'\)|from\('profiles'\)/)
  assert.doesNotMatch(src, /idempotency_key: [^\n]*chat_id/)
  assert.doesNotMatch(src, /console\.(log|error)\([^)]*(chat_id|text)\b/)
})

test('ไม่ลืม: หัว notify-telegram ไม่ถูกแตะ (ฟังก์ชันนี้ไม่ import มัน) · ใช้ helper ร่วมแทนคัดลอก', () => {
  assert.doesNotMatch(src, /notify-telegram/)
  assert.match(src, /from '\.\.\/_shared\/localPlanMonthlyReminder\.ts'/)
  assert.match(src, /from '\.\.\/_shared\/execNudge\.ts'/)
  assert.match(src, /from '\.\.\/_shared\/telegram\.ts'/)
})

console.log(`\n${cases} cases passed`)
