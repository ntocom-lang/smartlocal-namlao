// เทสต์ตัวนับถอยหลังกิจกรรม (src/lib/eventCountdown.js) — รันด้วย: node tests/event-countdown-lib.test.mjs
import assert from 'node:assert/strict'
import { eventCountdown, todayInBangkok } from '../src/lib/eventCountdown.js'

// เวลาไทย = UTC+7 · ใช้ ISO ที่มี Z เสมอ เทสต์จึงไม่ขึ้นกับ timezone เครื่องที่รัน
const at = (iso) => new Date(iso)

// ── todayInBangkok: ข้ามเที่ยงคืนไทย/UTC ──
assert.equal(todayInBangkok(at('2026-11-19T16:59:59Z')), '2026-11-19') // 23:59:59 ไทย
assert.equal(todayInBangkok(at('2026-11-19T17:00:00Z')), '2026-11-20') // 00:00:00 ไทย (UTC ยังเป็นวันที่ 19)
assert.equal(todayInBangkok(at('2026-12-31T17:00:00Z')), '2027-01-01') // ข้ามปี

// ── กิจกรรมวันเดียว ──
const one = { event_date: '2026-11-20', end_date: null }
assert.deepEqual(eventCountdown(one, at('2026-11-14T05:00:00Z')),
  { kind: 'upcoming', days: 6, label: 'อีก 6 วัน', canReview: false })
assert.deepEqual(eventCountdown(one, at('2026-11-19T05:00:00Z')),
  { kind: 'upcoming', days: 1, label: 'พรุ่งนี้', canReview: false })
// 16:59 UTC วันที่ 19 = 23:59 ไทยวันที่ 19 → ยัง "พรุ่งนี้"
assert.equal(eventCountdown(one, at('2026-11-19T16:59:59Z')).label, 'พรุ่งนี้')
assert.equal(eventCountdown(one, at('2026-11-19T16:59:59Z')).canReview, false)
// 17:00 UTC วันที่ 19 = 00:00 ไทยวันที่ 20 → "วันนี้" และให้ดาวได้ (ตรงกติกา RPC)
assert.deepEqual(eventCountdown(one, at('2026-11-19T17:00:00Z')),
  { kind: 'today', days: 0, label: 'วันนี้', canReview: true })
assert.deepEqual(eventCountdown(one, at('2026-11-20T16:59:59Z')),
  { kind: 'today', days: 0, label: 'วันนี้', canReview: true })
// ข้ามเที่ยงคืนไทยของวันที่ 20 → จบแล้ว แต่ยังให้ดาวได้ (event_date <= วันนี้)
assert.deepEqual(eventCountdown(one, at('2026-11-20T17:00:00Z')),
  { kind: 'ended', days: 1, label: 'จบแล้ว', canReview: true })

// ── end_date เท่า event_date / น้อยกว่า = วันเดียว ──
assert.equal(eventCountdown({ event_date: '2026-11-20', end_date: '2026-11-20' }, at('2026-11-20T03:00:00Z')).kind, 'today')
assert.equal(eventCountdown({ event_date: '2026-11-20', end_date: '2026-11-18' }, at('2026-11-20T03:00:00Z')).kind, 'today')
assert.equal(eventCountdown({ event_date: '2026-11-20', end_date: '2026-11-18' }, at('2026-11-21T03:00:00Z')).kind, 'ended')

// ── หลายวัน 3 วัน (2–4 ธ.ค.) ──
const multi = { event_date: '2026-12-02', end_date: '2026-12-04' }
assert.equal(eventCountdown(multi, at('2026-12-01T05:00:00Z')).label, 'พรุ่งนี้')
assert.deepEqual(eventCountdown(multi, at('2026-12-02T05:00:00Z')),
  { kind: 'ongoing', days: 2, label: 'กำลังจัด วันที่ 1/3', canReview: true }) // วันแรกของงานหลายวัน = กำลังจัด
assert.deepEqual(eventCountdown(multi, at('2026-12-03T05:00:00Z')),
  { kind: 'ongoing', days: 1, label: 'กำลังจัด วันที่ 2/3', canReview: true })
assert.deepEqual(eventCountdown(multi, at('2026-12-04T16:59:00Z')),
  { kind: 'ongoing', days: 0, label: 'กำลังจัด วันที่ 3/3', canReview: true })
assert.deepEqual(eventCountdown(multi, at('2026-12-04T17:00:00Z')),
  { kind: 'ended', days: 1, label: 'จบแล้ว', canReview: true })

// ── ข้ามเดือน/ข้ามปี ──
const crossMonth = { event_date: '2026-11-29', end_date: '2026-12-02' } // 4 วัน
assert.equal(eventCountdown(crossMonth, at('2026-11-30T05:00:00Z')).label, 'กำลังจัด วันที่ 2/4')
assert.equal(eventCountdown(crossMonth, at('2026-12-01T05:00:00Z')).label, 'กำลังจัด วันที่ 3/4')
assert.equal(eventCountdown(crossMonth, at('2026-12-02T05:00:00Z')).label, 'กำลังจัด วันที่ 4/4')
assert.equal(eventCountdown({ event_date: '2027-01-02', end_date: null }, at('2026-12-28T05:00:00Z')).label, 'อีก 5 วัน')
assert.equal(eventCountdown({ event_date: '2026-03-01', end_date: null }, at('2026-02-27T05:00:00Z')).label, 'อีก 2 วัน') // ก.พ. 28 วัน
assert.equal(eventCountdown({ event_date: '2028-03-01', end_date: null }, at('2028-02-27T05:00:00Z')).label, 'อีก 3 วัน') // ปีอธิกสุรทิน

// ── canReview: ไม่ให้ก่อนวันเริ่ม ──
assert.equal(eventCountdown({ event_date: '2026-11-21' }, at('2026-11-20T10:00:00Z')).canReview, false)
assert.equal(eventCountdown({ event_date: '2026-11-20' }, at('2026-11-20T10:00:00Z')).canReview, true)

// ── ค่าเสีย: ไม่ throw ไม่ขึ้นป้าย ไม่ให้ดาว ──
for (const bad of [null, undefined, {}, { event_date: null }, { event_date: '' }, { event_date: 'abc' }]) {
  const r = eventCountdown(bad, at('2026-11-20T05:00:00Z'))
  assert.equal(r.kind, 'unknown')
  assert.equal(r.label, '')
  assert.equal(r.canReview, false)
}
// ค่าจากฐานข้อมูลบางทีมี timestamp ต่อท้าย — ใช้ 10 ตัวแรก
assert.equal(eventCountdown({ event_date: '2026-11-20T00:00:00+00:00' }, at('2026-11-20T05:00:00Z')).kind, 'today')

console.log('event-countdown-lib: ผ่านทุกข้อ')
