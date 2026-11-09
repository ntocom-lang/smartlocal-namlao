// รายงานอัตราตอบแบบประเมินความพึงพอใจคำร้อง รายเดือน
//   ตรรกะ: src/lib/complaintRatingResponseRate.js · ใบพิมพ์: src/lib/ratingResponseRatePrint.js
//   node tests/complaint-rating-response-rate.test.mjs        (npm run test:rating-response-rate)
//
// สิ่งที่ต้องไม่พัง: (1) นับ "เรื่อง" ไม่ซ้ำ ไม่ใช่นับแถวคะแนน (2) เสียงผู้รับบริการตัวจริงไม่ปนคะแนนที่ สท./เลขอ้างอิงกดแทน
// (3) ตัวหารตัดหมวดเฉพาะกิจ/เรื่องที่ยังไม่ปิด (4) เดือนคิดตามเวลาไทย ไม่ขึ้นกับ timezone เครื่อง
// (5) ratingSource เดิมของหน้า "สรุปคะแนน" ไม่เปลี่ยนพฤติกรรม (6) ใบพิมพ์ใช้ govDocStyle และ escape ชื่อ อปท.
// ข้อมูลทั้งหมดเป็นข้อมูลสมมติ ไม่แตะฐานข้อมูล
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  STAFF_ROLES, buildMonthlyResponseRate, cellText, monthLabelOf, ratingSource, responseRateCsv, submitterGroup, thaiDateTimeText, thaiIsoDate,
} from '../src/lib/complaintRatingResponseRate.js'
import { GOV_FONT_STACK } from '../src/lib/govDocStyle.js'
import { buildRatingResponseRateHtml } from '../src/lib/ratingResponseRatePrint.js'

const ZONES = ['Asia/Bangkok', 'UTC', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Europe/London']
const ORIGINAL_TZ = process.env.TZ

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}
// รันซ้ำทุก timezone — เครื่องนี้ตั้งเวลาไทย ถ้ารันโซนเดียวจะผ่านลวงแม้ตรรกะผูกกับ timezone เครื่อง
const inEveryZone = run => {
  try {
    for (const zone of ZONES) {
      process.env.TZ = zone
      run(zone)
    }
  } finally {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ
    else process.env.TZ = ORIGINAL_TZ
  }
}

// ── ข้อมูลสมมติ ─────────────────────────────────────────────────────────────
const NOW = '2026-11-20T05:00:00Z' // 20 พ.ย. 2026 เวลาไทย = พ.ย. 2569
const roleById = new Map([
  ['u-cit', 'citizen'], ['u-cit2', 'citizen'], ['u-council', 'council'], ['u-staff', 'officer'], ['u-odd', 'weird_role'],
])
let seq = 0
const complaint = (over = {}) => ({
  id: `c${++seq}`, status: 'closed', closed_at: '2026-10-15T03:00:00Z', category: 'road', user_id: 'u-cit', rating: null, ...over,
})
const rating = (complaintId, over = {}) => ({
  complaint_id: complaintId, rating: 5, is_verified: false, via_link: false, rated_by_proxy: false, created_at: '2026-10-20T03:00:00Z', ...over,
})
const run = (complaints, ratings = [], extra = {}) => buildMonthlyResponseRate({ complaints, ratings, roleById, now: NOW, ...extra })
const month = (result, label) => result.months.find(m => m.label === label)

// ── ratingSource (ย้ายมาจาก AdminDashboard — พฤติกรรมเดิมต้องครบ 5 กรณี + ลำดับ proxy) ──────────
test('ratingSource: 5 ที่มา + proxy ชนะ via_link/verified', () => {
  assert.equal(ratingSource({ rated_by_proxy: true, complaint_id: 'x', is_verified: false, via_link: false }), 'proxy')
  assert.equal(ratingSource({ rated_by_proxy: false, complaint_id: null, is_verified: false, via_link: false }), 'general')
  assert.equal(ratingSource({ rated_by_proxy: false, complaint_id: 'x', is_verified: true, via_link: false }), 'verified')
  assert.equal(ratingSource({ rated_by_proxy: false, complaint_id: 'x', is_verified: false, via_link: true }), 'via_link')
  assert.equal(ratingSource({ rated_by_proxy: false, complaint_id: 'x', is_verified: false, via_link: false }), 'linked_anon')
  // ลำดับตรวจเดิม: proxy ก่อน general/verified/via_link
  assert.equal(ratingSource({ rated_by_proxy: true, complaint_id: null, is_verified: true, via_link: true }), 'proxy')
  assert.equal(ratingSource({ rated_by_proxy: false, complaint_id: 'x', is_verified: true, via_link: true }), 'verified')
  assert.equal(ratingSource({ complaint_id: 'x' }), 'linked_anon', 'ฟิลด์ขาด = ถือเป็นเลขอ้างอิง (ต่ำสุด) ไม่ใช่ verified')
})

test('AdminDashboard ใช้ ratingSource จาก lib (ไม่มีสำเนาที่สอง) และสลับมุมมองโดยไม่แตะ handlePrint เดิม', () => {
  const dash = readFileSync(new URL('../src/pages/AdminDashboard.jsx', import.meta.url), 'utf8')
  assert.match(dash, /import \{ ratingSource \} from '\.\.\/lib\/complaintRatingResponseRate'/)
  assert.equal((dash.match(/function ratingSource\(/g) ?? []).length, 0, 'ต้องไม่นิยาม ratingSource ซ้ำใน AdminDashboard')
  assert.match(dash, /function SatisfactionSummary\(\{ tenant \}\)/)
  assert.match(dash, /function SatisfactionAdmin\(\{ tenant \}\)/)
  assert.match(dash, /<RatingResponseRateReport tenant=\{tenant\} \/>/)
  assert.match(dash, /<SatisfactionAdmin tenant=\{tenant\} \/>/)
})

// ── submitterGroup ──────────────────────────────────────────────────────────
test('submitterGroup: council / citizen / anonymous / staff / unknown (Map และ object)', () => {
  assert.equal(submitterGroup({ user_id: 'u-council' }, roleById), 'council')
  assert.equal(submitterGroup({ user_id: 'u-cit' }, roleById), 'citizen')
  assert.equal(submitterGroup({ user_id: null }, roleById), 'anonymous')
  assert.equal(submitterGroup({ user_id: '' }, roleById), 'anonymous')
  assert.equal(submitterGroup({ user_id: 'u-staff' }, roleById), 'staff')
  assert.equal(submitterGroup({ user_id: 'u-missing' }, roleById), 'unknown', 'ไม่พบ profile = unknown ไม่ใช่ citizen')
  assert.equal(submitterGroup({ user_id: 'u-odd' }, roleById), 'unknown', 'บทบาทที่ไม่รู้จัก = unknown')
  assert.equal(submitterGroup({ user_id: 'u-x' }, null), 'unknown')
  assert.equal(submitterGroup({ user_id: 'u-council' }, { 'u-council': 'council' }), 'council')
  for (const role of ['superadmin', 'admin', 'officer', 'viewer', 'staff', 'technician']) {
    assert.ok(STAFF_ROLES.includes(role))
    assert.equal(submitterGroup({ user_id: 'u' }, { u: role }), 'staff', role)
  }
})

// ── ตัวหาร ──────────────────────────────────────────────────────────────────
test('ตัวหาร: นับเฉพาะ closed/completed ที่มี closed_at · ตัดหมวดเฉพาะกิจ · เรื่องยังไม่ปิดไม่นับ', () => {
  const cs = [
    complaint(), complaint({ status: 'completed' }),
    complaint({ status: 'pending' }), complaint({ status: 'in_progress' }),
    complaint({ closed_at: null }),
    complaint({ category: 'odor-adhoc' }),
  ]
  const r = run(cs, [], { adhocValues: ['odor-adhoc'] })
  assert.equal(r.total.closed, 2)
  assert.equal(month(r, 'ต.ค. 2569').closed, 2)
})

test('ตัวหาร: adhocValues รับได้ทั้ง array และ Set · category ว่างไม่ถูกตัด', () => {
  const cs = [complaint({ category: 'x' }), complaint({ category: null })]
  assert.equal(run(cs, [], { adhocValues: new Set(['x']) }).total.closed, 1)
  assert.equal(run(cs, [], { adhocValues: ['x'] }).total.closed, 1)
  assert.equal(run(cs, [], { adhocValues: [] }).total.closed, 2)
})

test('ตัวหารแยกตามผู้ยื่น รวมกันได้เท่า closed', () => {
  const cs = [
    complaint({ user_id: 'u-council' }), complaint({ user_id: 'u-cit' }), complaint({ user_id: 'u-cit2' }),
    complaint({ user_id: null }), complaint({ user_id: 'u-staff' }), complaint({ user_id: 'u-nobody' }),
  ]
  const m = month(run(cs), 'ต.ค. 2569')
  assert.deepEqual(m.submitters, { council: 1, citizen: 2, anonymous: 1, staff: 1, unknown: 1 })
  assert.equal(Object.values(m.submitters).reduce((a, b) => a + b, 0), m.closed)
})

// ── การนับเรื่อง / genuine ─────────────────────────────────────────────────
test('นับ "เรื่อง" ไม่ซ้ำ: เรื่องเดียวมี verified + via_link = anyRated 1 ไม่ใช่ 2', () => {
  const c = complaint()
  const r = run([c], [rating(c.id, { is_verified: true, rating: 5 }), rating(c.id, { via_link: true, rating: 3 })])
  const m = month(r, 'ต.ค. 2569')
  assert.equal(m.verified.n, 1)
  assert.equal(m.via_link.n, 1)
  assert.equal(m.anyRated.n, 1)
  assert.equal(m.anyRated.pct, 100)
  assert.equal(m.genuine.n, 1, 'มีทั้ง verified(ประชาชน) และ via_link ก็ยังเป็น 1 เรื่อง')
  assert.equal(m.genuine.avg, 4, 'เฉลี่ยจากแถวคะแนนของช่องตัวจริง (5 และ 3)')
})

test('คะแนนหลายแถวช่องเดียวกันของเรื่องเดียว นับเป็น 1 เรื่อง แต่เฉลี่ยจากทุกแถว', () => {
  const c = complaint()
  const m = month(run([c], [rating(c.id, { via_link: true, rating: 5 }), rating(c.id, { via_link: true, rating: 1 })]), 'ต.ค. 2569')
  assert.equal(m.via_link.n, 1)
  assert.equal(m.via_link.avg, 3)
})

test('genuine = via_link หรือ (verified ของ citizen) · ไม่นับ proxy / linked_anon / verified ของ council/staff/unknown/anonymous', () => {
  const cases2 = [
    { who: 'u-cit', over: { is_verified: true }, genuine: 1, key: 'citizen verified' },
    { who: 'u-council', over: { is_verified: true }, genuine: 0, key: 'council verified' },
    { who: 'u-staff', over: { is_verified: true }, genuine: 0, key: 'staff verified' },
    { who: 'u-nobody', over: { is_verified: true }, genuine: 0, key: 'unknown verified' },
    { who: null, over: { is_verified: true }, genuine: 0, key: 'anonymous verified' },
    { who: 'u-cit', over: { rated_by_proxy: true }, genuine: 0, key: 'proxy' },
    { who: 'u-cit', over: { rated_by_proxy: true, is_verified: true }, genuine: 0, key: 'proxy+verified' },
    { who: 'u-cit', over: {}, genuine: 0, key: 'linked_anon' },
    { who: 'u-cit', over: { via_link: true }, genuine: 1, key: 'via_link' },
    { who: 'u-council', over: { via_link: true }, genuine: 1, key: 'via_link ของเรื่องที่ สท. ยื่น (ชาวบ้านตัวจริงถือลิงก์)' },
  ]
  for (const k of cases2) {
    const c = complaint({ user_id: k.who })
    const m = month(run([c], [rating(c.id, k.over)]), 'ต.ค. 2569')
    assert.equal(m.genuine.n, k.genuine, k.key)
    assert.equal(m.anyRated.n, 1, `${k.key}: ต้องนับเป็นมีคะแนน`)
  }
})

test('แยกช่องตามที่มา: proxy / linked_anon ไม่ไปปนช่องอื่น', () => {
  const [a, b, c, d] = [complaint(), complaint(), complaint(), complaint()]
  const m = month(run([a, b, c, d], [
    rating(a.id, { is_verified: true }), rating(b.id, { via_link: true }), rating(c.id, { rated_by_proxy: true }), rating(d.id, {}),
  ]), 'ต.ค. 2569')
  assert.deepEqual([m.verified.n, m.via_link.n, m.proxy.n, m.linked_anon.n, m.anyRated.n, m.genuine.n], [1, 1, 1, 1, 4, 2])
  assert.equal(m.closed, 4)
  assert.equal(m.verified.pct, 25)
})

test('คะแนนที่ชี้ไปเรื่องนอกตัวหาร (ยังไม่ปิด / เฉพาะกิจ / ไม่มีในชุดข้อมูล) ไม่นับ', () => {
  const open = complaint({ status: 'pending' })
  const adhoc = complaint({ category: 'adhoc' })
  const ok = complaint()
  const r = run([open, adhoc, ok], [
    rating(open.id, { via_link: true }), rating(adhoc.id, { via_link: true }), rating('ghost', { via_link: true }), rating(ok.id, { via_link: true }),
  ], { adhocValues: ['adhoc'] })
  assert.equal(r.total.via_link.n, 1)
  assert.equal(r.total.anyRated.n, 1)
  assert.equal(r.total.closed, 1)
})

test('legacy: complaints.rating โดยไม่มีแถว verified ใน ratings → นับเป็น verified · มีแถว verified แล้วไม่นับซ้ำ', () => {
  const legacy = complaint({ rating: 4 })
  const both = complaint({ rating: 5 })
  const viaOnly = complaint({ rating: 2 })
  const r = run([legacy, both, viaOnly], [
    rating(both.id, { is_verified: true, rating: 3 }),
    rating(viaOnly.id, { via_link: true, rating: 5 }), // ไม่มีแถว verified → legacy 2 ยังนับเป็น verified
  ])
  const m = month(r, 'ต.ค. 2569')
  assert.equal(m.verified.n, 3)
  // legacy 4, both ใช้แถว ratings 3 (ไม่ใช้ 5), viaOnly legacy 2 → (4+3+2)/3
  assert.equal(m.verified.avg, 3)
  assert.equal(m.via_link.n, 1)
  assert.equal(m.anyRated.n, 3, 'ไม่นับซ้ำ')
})

test('legacy: คะแนน proxy ไม่ถือเป็นแถว verified → legacy ยังนับ · ของนอกตัวหารไม่นับ', () => {
  const c = complaint({ rating: 5 })
  const open = complaint({ status: 'pending', rating: 5 })
  const r = run([c, open], [rating(c.id, { rated_by_proxy: true })])
  assert.equal(r.total.verified.n, 1)
  assert.equal(r.total.proxy.n, 1)
  assert.equal(r.total.closed, 1)
})

// ── เวลาไทย / ช่วงเดือน ─────────────────────────────────────────────────────
test('เดือนตามเวลาไทย: 2026-10-31T18:30:00Z → พ.ย. 2569 · 16:59:59Z → ต.ค. 2569 (ทุก timezone เครื่อง)', () => {
  inEveryZone(zone => {
    const a = complaint({ closed_at: '2026-10-31T18:30:00Z' })
    const b = complaint({ closed_at: '2026-10-31T16:59:59Z' })
    const c = complaint({ closed_at: '2026-12-31T17:00:00Z' }) // 1 ม.ค. 2027 เวลาไทย
    const r = buildMonthlyResponseRate({ complaints: [a, b, c], ratings: [], roleById, now: '2027-01-10T03:00:00Z' })
    assert.equal(month(r, 'พ.ย. 2569').closed, 1, zone)
    assert.equal(month(r, 'ต.ค. 2569').closed, 1, zone)
    assert.equal(month(r, 'ม.ค. 2570').closed, 1, zone)
    assert.equal(month(r, 'ธ.ค. 2569').closed, 0, zone)
  })
})

test('ช่วงเดือน: เดือนแรกที่มีเรื่องปิด → เดือนปัจจุบัน · เดือนว่างได้แถว 0 ไม่ใช่หาย', () => {
  const r = run([complaint({ closed_at: '2026-08-10T03:00:00Z' }), complaint({ closed_at: '2026-10-10T03:00:00Z' })])
  assert.deepEqual(r.months.map(m => m.label), ['ส.ค. 2569', 'ก.ย. 2569', 'ต.ค. 2569', 'พ.ย. 2569'])
  assert.equal(month(r, 'ก.ย. 2569').closed, 0)
  assert.equal(month(r, 'พ.ย. 2569').closed, 0)
  assert.equal(r.firstMonthLabel, 'ส.ค. 2569')
  assert.equal(r.total.closed, 2)
})

test('ช่วงเดือนข้ามปี + เดือนปิดล้ำหน้า now ยังมีแถว', () => {
  const r = run([complaint({ closed_at: '2025-12-20T03:00:00Z' }), complaint({ closed_at: '2027-01-05T03:00:00Z' })])
  assert.equal(r.months[0].label, 'ธ.ค. 2568')
  assert.equal(r.months.at(-1).label, 'ม.ค. 2570')
  assert.equal(r.months.length, 14)
})

test('ไม่มีเรื่องปิดเลย → ไม่มีแถวเดือน ไม่ throw', () => {
  const r = run([complaint({ status: 'pending' })])
  assert.deepEqual(r.months, [])
  assert.equal(r.total.closed, 0)
  assert.equal(cellText(r.total.verified), '–')
  assert.deepEqual(buildMonthlyResponseRate({}).months, [])
})

test('หารศูนย์: closed = 0 → pct เป็น null และแสดง "–" · closed > 0 แสดง n (xx.x%)', () => {
  const r = run([complaint({ closed_at: '2026-09-10T03:00:00Z' })])
  const empty = month(r, 'ต.ค. 2569')
  assert.equal(empty.closed, 0)
  assert.equal(empty.verified.pct, null)
  assert.equal(empty.anyRated.pct, null)
  assert.equal(cellText(empty.verified), '–')
  const c = complaint()
  const m = month(run([c, complaint(), complaint()], [rating(c.id, { via_link: true })]), 'ต.ค. 2569')
  assert.equal(cellText(m.via_link), '1 (33.3%)')
  assert.equal(cellText(m.proxy), '0 (0.0%)')
})

test('ประเมินภาพรวม (ไม่ผูกคำร้อง): นับต่อเดือนตาม created_at เวลาไทย ไม่คิดร้อยละ ไม่ปนกับช่องผูกคำร้อง', () => {
  const c = complaint()
  const r = run([c], [
    rating(null, { created_at: '2026-10-31T18:30:00Z', rating: 4 }), // พ.ย. ตามเวลาไทย
    rating(null, { created_at: '2026-10-20T03:00:00Z', rating: 2 }),
    rating(null, { created_at: '2026-10-21T03:00:00Z', rating: 4 }),
    rating(c.id, { via_link: true }),
  ])
  assert.equal(month(r, 'ต.ค. 2569').general.n, 2)
  assert.equal(month(r, 'ต.ค. 2569').general.avg, 3)
  assert.equal(month(r, 'พ.ย. 2569').general.n, 1)
  assert.equal(r.total.general.n, 3)
  assert.equal(r.total.anyRated.n, 1, 'ภาพรวมไม่นับเป็นเรื่องที่มีคะแนน')
  assert.equal('pct' in month(r, 'ต.ค. 2569').general, false)
})

test('แถวรวม = ผลบวกของทุกเดือน (closed / ช่องคะแนน / ภาพรวม)', () => {
  const cs = [
    complaint({ closed_at: '2026-08-10T03:00:00Z' }), complaint({ closed_at: '2026-09-10T03:00:00Z', user_id: 'u-council' }),
    complaint({ closed_at: '2026-10-10T03:00:00Z' }), complaint({ closed_at: '2026-10-11T03:00:00Z' }),
  ]
  const rs = [
    rating(cs[0].id, { via_link: true }), rating(cs[1].id, { is_verified: true }), rating(cs[2].id, { is_verified: true }),
    rating(null, { created_at: '2026-08-05T03:00:00Z' }),
  ]
  const r = run(cs, rs)
  const sum = key => r.months.reduce((n, m) => n + m[key].n, 0)
  assert.equal(r.total.closed, r.months.reduce((n, m) => n + m.closed, 0))
  for (const key of ['verified', 'via_link', 'proxy', 'linked_anon', 'anyRated', 'genuine']) assert.equal(r.total[key].n, sum(key), key)
  assert.equal(r.total.genuine.n, 2, 'via_link ของเรื่องแรก + verified ประชาชนของเรื่องที่ 3 (verified ของ สท. ไม่นับ)')
  assert.equal(r.total.general.n, 1)
  assert.equal(r.total.verified.pct, 50)
})

test('monthLabelOf / วันที่ไทย', () => {
  assert.equal(monthLabelOf(2026 * 12 + 9), 'ต.ค. 2569')
  assert.equal(monthLabelOf(2026 * 12 + 10), 'พ.ย. 2569')
  assert.equal(monthLabelOf(2027 * 12), 'ม.ค. 2570')
  inEveryZone(zone => {
    const ms = Date.parse('2026-10-31T18:30:00Z')
    assert.equal(thaiIsoDate(ms), '2026-11-01', zone)
    assert.equal(thaiDateTimeText(ms), '1/11/2569 01:30', zone)
  })
})

// ── CSV ─────────────────────────────────────────────────────────────────────
test('CSV: ขึ้นต้น BOM · หัวคอลัมน์ไทย · escape , " ขึ้นบรรทัด · มีแถวรวม · เดือนเรียงเก่า→ใหม่', () => {
  const c = complaint()
  const result = run([c, complaint({ closed_at: '2026-09-10T03:00:00Z' })], [rating(c.id, { via_link: true, rating: 4 })])
  const csv = responseRateCsv(result, { orgName: 'เทศบาล "สาธิต", อำเภอ\nสมมติ', asOfText: '20/11/2569 12:00 น.' })
  assert.equal(csv.charCodeAt(0), 0xFEFF)
  assert.ok(csv.includes('"เทศบาล ""สาธิต"", อำเภอ\nสมมติ"'), 'ชื่อที่มี , " ขึ้นบรรทัด ต้องถูกครอบและ escape')
  assert.ok(csv.includes('ข้อมูล ณ วันที่ 20/11/2569 12:00 น.'))
  assert.ok(csv.includes('เดือนที่ปิดเรื่อง,ปิดแล้ว (เรื่อง)'))
  const lines = csv.split('\r\n')
  assert.ok(lines.findIndex(l => l.startsWith('ก.ย. 2569,')) < lines.findIndex(l => l.startsWith('ต.ค. 2569,')))
  const oct = lines.find(l => l.startsWith('ต.ค. 2569,'))
  assert.ok(oct.startsWith('ต.ค. 2569,1,'), oct)
  assert.ok(lines.some(l => l.startsWith('รวม,2,')), 'ต้องมีแถวรวม')
  // ช่อง % ที่หารศูนย์ไม่ได้ต้องว่าง ไม่ใช่ NaN/Infinity
  assert.ok(!/NaN|Infinity|null|undefined/.test(csv))
  const sep = responseRateCsv({ months: [], total: run([]).total })
  assert.equal(sep.charCodeAt(0), 0xFEFF)
})

// ── ใบพิมพ์ ─────────────────────────────────────────────────────────────────
test('ใบพิมพ์: ใช้ govDocStyle (A4 landscape + ฟอนต์กลาง) ไม่เขียน font-family/@page margin เอง', () => {
  const source = readFileSync(new URL('../src/lib/ratingResponseRatePrint.js', import.meta.url), 'utf8')
  assert.equal(/font-family/.test(source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), false, 'ห้ามเขียน font-family เองในไฟล์ใบพิมพ์')
  assert.equal(/@page\s*\{[^}]*margin\s*:\s*\d/.test(source), false, 'ห้ามเขียน @page margin เอง')
  assert.match(source, /govPageCss\(\{ size: 'A4 landscape'/)
  assert.match(source, /govDocFontIdentityCss\(\)/)
  assert.match(source, /GOV_FONT_LINK/)
  assert.ok(!/govDocFontCss\(/.test(source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'ใบนี้ใช้ identity (คุมขนาดตารางเอง) ไม่ใช่ govDocFontCss')
  // เหตุผลของข้อยกเว้นขนาดตัวอักษรต้องเขียนกำกับที่จุดเรียก
  assert.match(source, /ข้อยกเว้นเรื่อง "ขนาดตัวอักษร"/)

  const html = buildRatingResponseRateHtml({ result: run([complaint()]), tenant: { name: 'เทศบาลตำบลสาธิต' }, asOfText: '20/11/2569 12:00' })
  assert.ok(html.includes('@page { size: A4 landscape;'))
  assert.ok(html.includes(GOV_FONT_STACK), 'ต้องได้ฟอนต์กลาง THSarabunPSK')
  assert.ok(html.includes('font-size-adjust: 0.45'))
  assert.ok(html.includes('thead { display: table-header-group; }'), 'หัวตารางต้องซ้ำทุกหน้า')
  assert.ok(html.includes('รายงานอัตราการตอบแบบประเมินความพึงพอใจ เรื่องร้องเรียน/ร้องทุกข์ รายเดือน'))
  assert.ok(html.includes('เทศบาลตำบลสาธิต'))
  assert.ok(html.includes('ข้อมูล ณ วันที่ 20/11/2569 12:00 น.'))
  assert.ok(html.includes('นับตามเดือนที่ปิดเรื่อง'), 'ต้องมีหมายเหตุนิยามท้ายใบ')
  assert.ok(!/sign-line|govSignRow|staff-sign/.test(html), 'ใบนี้ไม่มีช่องลงนาม')
})

test('ใบพิมพ์: escape ชื่อ อปท. ที่มี < > " \' &', () => {
  const evil = '<script>alert(1)</script> "x" \'y\' & <img src=x onerror=alert(2)>'
  const html = buildRatingResponseRateHtml({ result: run([complaint()]), tenant: { name: evil }, asOfText: '<b>1</b>' })
  assert.equal(/<script/i.test(html), false, 'มี <script จากข้อมูลหลุดออกมา')
  assert.equal(/<img/i.test(html), false)
  assert.equal(/<b>1<\/b>/.test(html), false)
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &quot;x&quot; &#039;y&#039; &amp; &lt;img'))
})

test('ใบพิมพ์: 20 เดือนครบทุกแถว ล่าสุดอยู่บน แถวรวมท้ายตาราง · ไม่มีข้อมูล = ข้อความว่าง', () => {
  const cs = []
  for (let i = 0; i < 20; i++) {
    const d = new Date(Date.UTC(2025, 3 + i, 15, 3)) // เม.ย. 2025 เป็นต้นไป
    cs.push(complaint({ closed_at: d.toISOString() }))
  }
  const result = buildMonthlyResponseRate({ complaints: cs, ratings: [], roleById, now: '2026-11-20T05:00:00Z' })
  const html = buildRatingResponseRateHtml({ result, tenant: { name: 'ทต.สมมติ' } })
  const rows = [...html.matchAll(/<td class="mon">([^<]*)<\/td>/g)].map(m => m[1])
  assert.equal(rows.length, result.months.length + 1)
  assert.equal(rows[0], result.months.at(-1).label, 'เดือนล่าสุดอยู่บนสุด')
  assert.equal(rows.at(-1), 'รวมทั้งหมด')
  assert.ok(result.months.length >= 20)
  const none = buildRatingResponseRateHtml({ result: { months: [], total: run([]).total }, tenant: { name: 'ทต.สมมติ' } })
  assert.ok(none.includes('ยังไม่มีคำร้องที่ปิดแล้ว'))
})

test('หน้าจอ: component ไม่ select คอลัมน์ข้อมูลส่วนบุคคล · แบ่งหน้า .range · profiles แบ่งชุด ≤200', () => {
  const src = readFileSync(new URL('../src/components/admin/RatingResponseRateReport.jsx', import.meta.url), 'utf8')
  assert.ok(src.includes(".select('id, status, closed_at, category, user_id, rating')"))
  assert.ok(src.includes(".select('id, complaint_id, rating, is_verified, via_link, rated_by_proxy, created_at')"))
  assert.ok(src.includes(".select('id, role')"))
  assert.ok(src.includes(".select('value, is_adhoc')"))
  assert.equal(/select\('\*'\)/.test(src), false, 'ห้าม select *')
  assert.equal(/full_name|phone|address|description|email/.test(src.replace(/\/\/.*$/gm, '')), false, 'ห้ามแตะคอลัมน์ข้อมูลส่วนบุคคล')
  assert.match(src, /\.range\(from, from \+ PAGE - 1\)/)
  assert.match(src, /const PAGE = 1000/)
  assert.match(src, /const ID_CHUNK = 200/)
  assert.match(src, /overflow-x-auto/)
  assert.match(src, /ดาวน์โหลด CSV/)
  assert.match(src, /อัตราตอบประเมินคำร้อง_\$\{tenant\?\.slug \?\? tenant\?\.id\}_\$\{thaiIsoDate\(data\.loadedAt\)\}\.csv/)
})

console.log(`\nครบ ${cases} กลุ่ม`)
