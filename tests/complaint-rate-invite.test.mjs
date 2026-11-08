// ชวนผู้ยื่นประเมินความพึงพอใจจากหน้าแรกเจ้าหน้าที่ — ตรรกะหน้าเว็บ (src/lib/complaintRateInvite.js)
//   node tests/complaint-rate-invite.test.mjs        (npm run test:rate-invite)
// ฝั่งฐานข้อมูลตรวจแยกที่ tests/complaint-rate-invite-db.test.mjs (ต้องใช้ PGlite)
//
// สิ่งที่ต้องไม่พัง: (1) ส่งลิงก์ไปแล้วไม่ถึง 3 วัน = ซ่อน (ไม่ทวง) ครบ 3 วันแล้วยังไม่มีคะแนน = ขึ้นพร้อมข้อความเตือน
// (2) นับวันตามเวลาไทยเสมอ ไม่ขึ้นกับ timezone เครื่อง (3) storage พัง/JSON เสีย ไม่ทำให้หน้าแรกพัง
// (4) ชื่อ RPC/พารามิเตอร์/code ในหน้าเว็บ = ในฐานข้อมูลจริง
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  COMMENT_MAX, FOLLOW_UP_AFTER_DAYS, INVITE_RATE_ERRORS, INVITE_RATE_FALLBACK_ERROR, INVITE_WINDOW_DAYS, RATING_OPTIONS,
  SHARE_NOTICE_SENT, canShareRow, cleanComment, inviteErrorMessage, inviteRowLines, inviteRowNote, inviteStorageKey,
  inviteSummaryText, isRateSuccess, parseInviteData, PROXY_COMMENT_WARNING, RATE_ALREADY_TEXT, rateOutcome, readInviteStamps,
  recordInviteSent, referenceNowMs, thaiDaysBetween,
  visibleInviteRows,
} from '../src/lib/complaintRateInvite.js'

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000
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

// ที่เก็บปลอมแบบ localStorage
const fakeStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)) },
  }
}
const brokenStorage = () => ({
  getItem() { throw new Error('SecurityError') },
  setItem() { throw new Error('QuotaExceededError') },
})

const T = 'tenant-1'
const P = 'profile-1'
const KEY = inviteStorageKey(T, P)
// 2026-11-09 12:00 เวลาไทย (05:00Z)
const NOW = Date.parse('2026-11-09T05:00:00Z')
const item = (id, extra = {}) => ({ id, ref_no: `ES-69-${id}`, category_label: 'ไฟฟ้าสาธารณะ', village: 'หมู่ 3', closed_at: new Date(NOW - 1 * DAY).toISOString(), track_token: 'a'.repeat(32), ...extra })

test('หน้ายิ้ม 5 ระดับ: ค่า 5→1 ครบ ชุดเดียวกับ SatisfactionModal', () => {
  assert.deepEqual(RATING_OPTIONS.map(o => [o.value, o.emoji, o.label]), [
    [5, '😄', 'ยอดเยี่ยม'], [4, '😊', 'ดี'], [3, '😐', 'พอสมควร'], [2, '😢', 'แย่'], [1, '😡', 'แย่มาก'],
  ])
})

test('ค่าคงที่ตรงกับฐานข้อมูล: 30 วัน / เตือนซ้ำหลัง 3 วัน / ความเห็นไม่เกิน 500', () => {
  assert.equal(INVITE_WINDOW_DAYS, 30)
  assert.equal(FOLLOW_UP_AFTER_DAYS, 3)
  assert.equal(COMMENT_MAX, 500)
})

test('visibleInviteRows: ไม่เคยส่งลิงก์ = แสดง (followUp=false)', () => {
  const rows = visibleInviteRows([item('a'), item('b')], {}, NOW)
  assert.deepEqual(rows.map(r => [r.id, r.followUp, r.sentDays]), [['a', false, null], ['b', false, null]])
})

test('visibleInviteRows: ส่งลิงก์ไป 2.9 วัน = ซ่อน · ครบ 3 วันพอดี = แสดงพร้อม followUp', () => {
  const at = ms => ({ a: new Date(ms).toISOString() })
  assert.equal(visibleInviteRows([item('a')], at(NOW - 2.9 * DAY), NOW).length, 0)
  assert.equal(visibleInviteRows([item('a')], at(NOW - (3 * DAY - 1)), NOW).length, 0, 'ขาด 1 มิลลิวินาทียังซ่อน')
  const [row] = visibleInviteRows([item('a')], at(NOW - 3 * DAY), NOW)
  assert.equal(row.followUp, true)
  assert.equal(row.sentDays, 3)
  assert.equal(visibleInviteRows([item('a')], at(NOW), NOW).length, 0, 'เพิ่งส่ง = ซ่อน')
})

test('visibleInviteRows: ตราเวลาในอนาคต (นาฬิกาเครื่องถูกแก้ย้อน) = ซ่อน ไม่ขึ้นทวง', () => {
  assert.equal(visibleInviteRows([item('a')], { a: new Date(NOW + 5 * DAY).toISOString() }, NOW).length, 0)
})

test('visibleInviteRows: ตราเวลาเสีย/ของเรื่องอื่น ไม่กระทบ · ข้อมูลเสียไม่โยน error', () => {
  const rows = visibleInviteRows([item('a'), item('b')], { a: 'ไม่ใช่วันที่', zzz: new Date(NOW).toISOString() }, NOW)
  assert.deepEqual(rows.map(r => r.id), ['a', 'b'], 'ตราที่อ่านไม่ได้ = ถือว่ายังไม่เคยส่ง')
  assert.deepEqual(visibleInviteRows(null, null, NOW), [])
  assert.deepEqual(visibleInviteRows([null, {}, { id: 5 }, item('ok')], undefined, NOW).map(r => r.id), ['ok'])
})

test('visibleInviteRows: ส่งลิงก์นานกว่า 3 วัน นับ N ตามวันปฏิทินไทย ไม่ต่ำกว่า 3', () => {
  const sent = new Date(NOW - 5 * DAY - 2 * HOUR).toISOString()
  assert.equal(visibleInviteRows([item('a')], { a: sent }, NOW)[0].sentDays, 5)
})

test('thaiDaysBetween: นับข้ามเที่ยงคืนเวลาไทย ไม่ใช่เที่ยงคืนของเครื่อง · ไม่ติดลบ · ค่าเสีย = null', () => {
  // 23:30 ไทย วันที่ 1 → 00:30 ไทย วันที่ 2 = ห่าง 1 ชม. แต่ข้ามวัน 1 วัน
  const late = Date.parse('2026-11-01T16:30:00Z') // 23:30 น. ไทย
  const early = Date.parse('2026-11-01T17:30:00Z') // 00:30 น. ไทย วันถัดไป
  inEveryZone(zone => {
    assert.equal(thaiDaysBetween(late, early), 1, zone)
    assert.equal(thaiDaysBetween(early, late), 0, `${zone} ย้อนเวลา = 0 ไม่ติดลบ`)
    assert.equal(thaiDaysBetween('2026-11-01T00:00:00+07:00', '2026-11-04T23:59:00+07:00'), 3, zone)
    assert.equal(thaiDaysBetween('2026-11-01T00:00:00+07:00', '2026-11-03T23:59:59+07:00'), 2, zone)
  })
  assert.equal(thaiDaysBetween(null, NOW), null)
  assert.equal(thaiDaysBetween('xx', NOW), null)
})

test('inviteRowNote: ข้อความใต้แถวครบ 3 แบบ + บันทึกแทนได้เฉพาะ สท.', () => {
  const closed = days => item('a', { closed_at: new Date(NOW - days * DAY).toISOString() })
  const plain = (row, canProxy = false) => inviteRowNote(row, { canProxy, nowMs: NOW })
  assert.equal(plain({ ...closed(1), followUp: false }), 'ดำเนินการแล้ว')
  assert.equal(plain({ ...closed(2), followUp: false }), 'ดำเนินการแล้ว', 'ปิด 2 วัน ยังไม่ถึงเกณฑ์')
  assert.equal(plain({ ...closed(3), followUp: false }), 'ดำเนินการแล้ว 3 วัน ยังไม่มีผู้ประเมิน')
  assert.equal(plain({ ...closed(12), followUp: false }), 'ดำเนินการแล้ว 12 วัน ยังไม่มีผู้ประเมิน')
  assert.equal(plain({ ...closed(12), followUp: true, sentDays: 4 }), 'ส่งลิงก์ไปแล้ว 4 วัน ชาวบ้านยังไม่ได้ประเมิน')
  assert.equal(plain({ ...closed(12), followUp: true, sentDays: 4 }, true), 'ส่งลิงก์ไปแล้ว 4 วัน ชาวบ้านยังไม่ได้ประเมิน · บันทึกแทนได้')
  assert.equal(plain({ ...closed(1), followUp: true }, false), 'ส่งลิงก์ไปแล้ว 3 วัน ชาวบ้านยังไม่ได้ประเมิน', 'ไม่มี sentDays = ใช้ขั้นต่ำ 3')
  assert.equal(plain({ closed_at: null, followUp: false }), 'ดำเนินการแล้ว', 'ไม่มีวันปิด = ไม่เดา')
  assert.equal(plain({ closed_at: 'เสีย', followUp: false }), 'ดำเนินการแล้ว')
  assert.equal(plain(null), 'ดำเนินการแล้ว')
})

test('inviteRowNote: นับวันปิดเรื่องตามเวลาไทยเทียบ server_now — ไม่ขึ้นกับ timezone/นาฬิกาเครื่อง', () => {
  // ปิด 23:30 ไทยวันที่ 6 → server_now 00:30 ไทยวันที่ 9: ห่างแค่ 25 ชม. แต่ข้าม 3 วันปฏิทิน
  const row = { closed_at: '2026-11-06T16:30:00Z', followUp: false }
  const serverNow = '2026-11-08T17:30:00Z'
  inEveryZone(zone => {
    assert.equal(inviteRowNote(row, { serverNow, nowMs: 0 }), 'ดำเนินการแล้ว 3 วัน ยังไม่มีผู้ประเมิน', zone)
    // นาฬิกาเครื่องเพี้ยนไปไกล (ปี 1970) ต้องไม่ทำให้ผิด เมื่อมี server_now
    assert.equal(inviteRowNote(row, { serverNow, nowMs: Date.parse('1970-01-01T00:00:00Z') }), 'ดำเนินการแล้ว 3 วัน ยังไม่มีผู้ประเมิน', zone)
    // ไม่มี server_now → ใช้เวลาเครื่องที่ส่งเข้ามา
    assert.equal(inviteRowNote(row, { serverNow: null, nowMs: Date.parse(serverNow) }), 'ดำเนินการแล้ว 3 วัน ยังไม่มีผู้ประเมิน', zone)
    assert.equal(inviteRowNote(row, { serverNow: 'เสีย', nowMs: Date.parse(serverNow) }), 'ดำเนินการแล้ว 3 วัน ยังไม่มีผู้ประเมิน', zone)
  })
})

test('referenceNowMs: ใช้ server_now ถ้าอ่านได้ ไม่งั้นใช้ค่าสำรอง', () => {
  assert.equal(referenceNowMs('2026-11-09T05:00:00Z', 1), NOW)
  assert.equal(referenceNowMs(null, 7), 7)
  assert.equal(referenceNowMs('เสีย', 7), 7)
  assert.equal(referenceNowMs('', 7), 7)
})

test('inviteRowLines / canShareRow / inviteSummaryText', () => {
  assert.deepEqual(inviteRowLines(item('x')), { title: 'ES-69-x', detail: 'ไฟฟ้าสาธารณะ · หมู่ 3' })
  assert.deepEqual(inviteRowLines({ ref_no: ' ', category_label: null, village: '' }), { title: 'เรื่องที่ยื่นไว้', detail: '' })
  assert.deepEqual(inviteRowLines(null), { title: 'เรื่องที่ยื่นไว้', detail: '' })
  assert.equal(canShareRow(item('x')), true)
  assert.equal(canShareRow(item('x', { track_token: 'ABC' })), false)
  assert.equal(canShareRow(item('x', { track_token: null })), false)
  assert.equal(canShareRow(null), false)
  assert.equal(inviteSummaryText(3), 'เรื่องที่คุณแจ้ง ดำเนินการแล้ว รอประเมิน 3 เรื่อง')
})

test('parseInviteData: ข้อมูลเสีย/ว่าง = ไม่มีรายการ ไม่โยน error', () => {
  assert.deepEqual(parseInviteData(null), { items: [], canProxy: false, serverNow: null })
  assert.deepEqual(parseInviteData({ items: 'x' }), { items: [], canProxy: false, serverNow: null })
  const parsed = parseInviteData({ items: [item('a'), null, { ref_no: 'ไม่มี id' }, { id: '' }], can_proxy: true, server_now: '2026-11-09T05:00:00Z' })
  assert.deepEqual(parsed.items.map(i => i.id), ['a'])
  assert.equal(parsed.canProxy, true)
  assert.equal(parsed.serverNow, '2026-11-09T05:00:00Z')
  assert.equal(parseInviteData({ items: [], can_proxy: 'true' }).canProxy, false, 'ต้องเป็น true จริงเท่านั้น')
})

test('storage: เขียนแล้วอ่านกลับ · แยกตามหน่วยงาน+บัญชี · เขียนซ้ำเรื่องเดิม = ตราใหม่ทับ', () => {
  const storage = fakeStorage()
  assert.equal(recordInviteSent(storage, T, P, 'c1', NOW), true)
  assert.deepEqual(readInviteStamps(storage, T, P, NOW), { c1: new Date(NOW).toISOString() })
  assert.deepEqual(readInviteStamps(storage, T, 'other', NOW), {})
  assert.deepEqual(readInviteStamps(storage, 'other', P, NOW), {})
  assert.equal(recordInviteSent(storage, T, P, 'c2', NOW + HOUR), true)
  assert.equal(recordInviteSent(storage, T, P, 'c1', NOW + 2 * HOUR), true)
  assert.deepEqual(readInviteStamps(storage, T, P, NOW + 2 * HOUR), {
    c1: new Date(NOW + 2 * HOUR).toISOString(), c2: new Date(NOW + HOUR).toISOString(),
  })
  assert.deepEqual([...storage.data.keys()], [KEY])
})

test('storage: ตัดรายการเก่ากว่า 30 วันทิ้งทั้งตอนอ่านและตอนเขียน (30 วันพอดียังอยู่)', () => {
  const stamp = ms => new Date(ms).toISOString()
  const storage = fakeStorage({
    [KEY]: JSON.stringify({ old: stamp(NOW - 30 * DAY - 1), edge: stamp(NOW - 30 * DAY), fresh: stamp(NOW - DAY), future: stamp(NOW + DAY) }),
  })
  assert.deepEqual(Object.keys(readInviteStamps(storage, T, P, NOW)).sort(), ['edge', 'fresh', 'future'], 'ตอนอ่าน')
  assert.ok(JSON.parse(storage.data.get(KEY)).old, 'อ่านอย่างเดียวไม่เขียนทับ')
  recordInviteSent(storage, T, P, 'new', NOW)
  assert.deepEqual(Object.keys(JSON.parse(storage.data.get(KEY))).sort(), ['edge', 'fresh', 'future', 'new'], 'ตอนเขียน ของเก่าหายจากที่เก็บ')
})

test('storage: โยน error / JSON เสีย / รูปแบบผิด = ไม่พัง คืนค่าว่าง', () => {
  assert.deepEqual(readInviteStamps(brokenStorage(), T, P, NOW), {})
  assert.equal(recordInviteSent(brokenStorage(), T, P, 'c1', NOW), false)
  for (const bad of ['{ไม่ใช่ json', 'null', '[]', '"text"', '123', '{"a":123,"b":null,"c":"ไม่ใช่วัน"}']) {
    assert.deepEqual(readInviteStamps(fakeStorage({ [KEY]: bad }), T, P, NOW), {}, bad)
  }
  // JSON เสียแล้วเขียนใหม่ได้ (ทับของเสีย)
  const storage = fakeStorage({ [KEY]: '{เสีย' })
  assert.equal(recordInviteSent(storage, T, P, 'c1', NOW), true)
  assert.deepEqual(Object.keys(readInviteStamps(storage, T, P, NOW)), ['c1'])
  // ไม่มี storage / ไม่มี tenant / ไม่มีบัญชี / id ผิดรูป
  assert.deepEqual(readInviteStamps(null, T, P, NOW), {})
  assert.deepEqual(readInviteStamps(fakeStorage(), null, P, NOW), {})
  assert.deepEqual(readInviteStamps(fakeStorage(), T, undefined, NOW), {})
  assert.equal(recordInviteSent(null, T, P, 'c1', NOW), false)
  assert.equal(recordInviteSent(fakeStorage(), T, null, 'c1', NOW), false)
  assert.equal(recordInviteSent(fakeStorage(), T, P, '', NOW), false)
  assert.equal(recordInviteSent(fakeStorage(), T, P, 'x'.repeat(65), NOW), false)
  assert.equal(recordInviteSent(fakeStorage(), T, P, 123, NOW), false)
})

test('storage: ที่เก็บเต็มทีละมากๆ ถูกจำกัดจำนวน (ไม่บวมไม่จบ) และเก็บรายการใหม่สุดไว้', () => {
  const storage = fakeStorage()
  for (let i = 0; i < 130; i++) recordInviteSent(storage, T, P, `c${i}`, NOW + i * 1000)
  const kept = readInviteStamps(storage, T, P, NOW + 130 * 1000)
  assert.equal(Object.keys(kept).length, 100)
  assert.ok(kept.c129 && !kept.c0)
})

test('ครบวงจร: ส่งลิงก์ → ซ่อน 3 วัน → ขึ้นเตือนพร้อมจำนวนวัน (ผ่านที่เก็บจริง)', () => {
  const storage = fakeStorage()
  const items = [item('a'), item('b')]
  recordInviteSent(storage, T, P, 'a', NOW)
  const at = ms => visibleInviteRows(items, readInviteStamps(storage, T, P, ms), ms)
  assert.deepEqual(at(NOW + 1 * DAY).map(r => r.id), ['b'])
  assert.deepEqual(at(NOW + 2.9 * DAY).map(r => r.id), ['b'])
  const later = at(NOW + 3 * DAY)
  assert.deepEqual(later.map(r => [r.id, r.followUp, r.sentDays]), [['a', true, 3], ['b', false, null]])
  assert.equal(inviteRowNote(later[0], { canProxy: true, nowMs: NOW + 3 * DAY }), 'ส่งลิงก์ไปแล้ว 3 วัน ชาวบ้านยังไม่ได้ประเมิน · บันทึกแทนได้')
})

test('ผลส่งคะแนน: already_rated = สำเร็จ · ความผิดพลาดมีข้อความไทยครบทุก code ของ RPC', () => {
  assert.equal(isRateSuccess({ ok: true }), true)
  assert.equal(isRateSuccess({ ok: false, code: 'already_rated' }), true)
  for (const bad of [null, undefined, {}, { ok: false }, { ok: false, code: 'not_owner' }, { ok: 'true' }]) assert.equal(isRateSuccess(bad), false, JSON.stringify(bad))
  for (const code of ['invalid_rating', 'not_found', 'not_closed', 'not_rateable', 'not_owner', 'not_council', 'expired', 'self_rated']) {
    assert.ok(INVITE_RATE_ERRORS[code], code)
    assert.equal(inviteErrorMessage(code), INVITE_RATE_ERRORS[code])
  }
  assert.equal(inviteErrorMessage('อะไรก็ไม่รู้'), INVITE_RATE_FALLBACK_ERROR)
  assert.equal(inviteErrorMessage(undefined), INVITE_RATE_FALLBACK_ERROR)
  assert.ok(!('already_rated' in INVITE_RATE_ERRORS), 'already_rated ไม่ใช่ข้อผิดพลาด')
})

test('self_rated ไม่ถือว่าสำเร็จ (สท. ประเมินเองไปแล้ว คะแนนบันทึกแทนไม่ถูกบันทึก) · expired ก็ไม่ใช่', () => {
  assert.equal(isRateSuccess({ ok: false, code: 'self_rated' }), false)
  assert.equal(isRateSuccess({ ok: false, code: 'expired' }), false)
  assert.equal(rateOutcome({ ok: false, code: 'self_rated' }), 'error')
  assert.equal(rateOutcome({ ok: false, code: 'expired' }), 'error')
})

test('rateOutcome: ok / already (เรื่องนี้มีผู้ประเมินแล้ว ไม่ขึ้นขอบคุณ) / error', () => {
  assert.equal(rateOutcome({ ok: true, verified: false, proxy: true }), 'ok')
  assert.equal(rateOutcome({ ok: false, code: 'already_rated' }), 'already')
  for (const bad of [null, undefined, {}, { ok: false }, { ok: 'true' }, { ok: false, code: 'not_owner' }]) assert.equal(rateOutcome(bad), 'error', JSON.stringify(bad))
  assert.equal(RATE_ALREADY_TEXT, 'เรื่องนี้มีผู้ประเมินแล้ว')
  assert.equal(PROXY_COMMENT_WARNING, 'ไม่ต้องใส่ชื่อหรือเบอร์โทรของชาวบ้าน')
})

test('cleanComment: ตัดช่องว่าง · ว่าง = null · ไม่เกิน 500 ตัวอักษรจริง (ไม่ตัดกลางอีโมจิ)', () => {
  assert.equal(cleanComment('  ขอบคุณ  '), 'ขอบคุณ')
  for (const empty of ['', '   ', '\n\t', null, undefined, 5]) assert.equal(cleanComment(empty), null)
  assert.equal(cleanComment('ก'.repeat(600)).length, 500)
  const emoji = cleanComment('😄'.repeat(600))
  assert.equal([...emoji].length, 500)
  assert.ok(!emoji.includes('�') && !/[\uD800-\uDBFF]$/.test(emoji), 'ห้ามตัดคู่ surrogate')
})

test('ข้อความหลังส่งลิงก์ตรงตามที่เจ้าของระบบกำหนด', () => {
  assert.equal(SHARE_NOTICE_SENT, 'ส่งแล้ว — ถ้าชาวบ้านยังไม่ประเมินใน 3 วัน ระบบจะเตือนอีกครั้ง')
})

// หน้าเว็บ ↔ ฐานข้อมูล: ชื่อ RPC / พารามิเตอร์ / code / จำนวนวัน ต้องตรงกัน (เปลี่ยนฝั่งเดียวแล้วเทสต์นี้ต้องล้ม)
const migration = await readFile(new URL('../supabase/migrations/20261111100100_complaint_rate_invite_functions.sql', import.meta.url), 'utf8')
const component = await readFile(new URL('../src/components/staff/ComplaintRateInvite.jsx', import.meta.url), 'utf8')
const dashboard = await readFile(new URL('../src/components/staff/StaffOperationalDashboard.jsx', import.meta.url), 'utf8')

test('หน้าเว็บเรียก RPC และพารามิเตอร์ตรงกับ migration', () => {
  assert.match(migration, /FUNCTION public\.my_complaints_to_rate\(p_muni uuid\)/)
  assert.match(migration, /FUNCTION public\.rate_complaint_on_behalf\(\s*p_complaint_id uuid,\s*p_rating\s+int,\s*p_comment\s+text/)
  assert.match(dashboard, /rpc: 'my_complaints_to_rate', tenantId, profileId/)
  assert.ok(!/my_complaints_to_rate'[^}]*args/.test(dashboard), 'ต้องไม่ส่ง args — useHomeRpc ส่ง p_muni ให้เอง')
  assert.match(component, /'rate_complaint_on_behalf' : 'rate_complaint'/)
  for (const param of ['p_complaint_id', 'p_rating', 'p_comment']) assert.match(component, new RegExp(param))
})

test('code ผลลัพธ์ที่ฐานข้อมูลคืนมา มีข้อความในหน้าเว็บครบ (ยกเว้น already_rated ที่ถือว่าสำเร็จ)', () => {
  const dbCodes = [...new Set([...migration.matchAll(/'code', '([a-z_]+)'/g)].map(m => m[1]))]
  assert.ok(dbCodes.length >= 7, `พบ code ในฐานข้อมูล ${dbCodes.join(',')}`)
  for (const code of dbCodes) {
    if (code === 'already_rated') assert.equal(isRateSuccess({ ok: false, code }), true)
    else assert.ok(INVITE_RATE_ERRORS[code], `ไม่มีข้อความสำหรับ code ${code}`)
  }
  assert.match(migration, /interval '30 days'/)
})

test('ส่วน "ต้องทำตอนนี้": ผูกเข้า hasTodo / todoState / nothingShownYet · error ไม่บล็อกไฟเขียว', () => {
  assert.match(dashboard, /rateRpc\.status === 'loading' \? 'loading' : null/, 'badgeStatuses ใส่เฉพาะ loading')
  assert.ok(!/rateRpc\.status === 'error'/.test(dashboard) && !/\['loading', 'error'\]\.includes\(rateRpc/.test(dashboard), 'ห้ามใส่ error เข้า badgeStatuses')
  assert.match(dashboard, /rateRows\.length\]/, 'badgeCounts')
  assert.match(dashboard, /esignShown \|\| rateShown/, 'hasTodo')
  assert.match(dashboard, /!esignShown && !rateShown/, 'nothingShownYet')
  assert.ok(dashboard.indexOf('<MyPendingSignatures') < dashboard.indexOf('<ComplaintRateInvite'), 'วางต่อจาก MyPendingSignatures')
})

test('หน้าจอ: already_rated ไม่ขึ้นขอบคุณ · คำเตือนไม่ใส่ชื่อ/เบอร์ ขึ้นตอนบันทึกแทน · คำเตือนผู้บันทึกแทนครบ', () => {
  assert.match(component, /outcome === 'already'/)
  assert.match(component, /RATE_ALREADY_TEXT/)
  assert.ok(!/isRateSuccess/.test(component), 'หน้าจอต้องแยก ok/already ด้วย rateOutcome')
  assert.match(component, /data-rate-invite-comment-warning/)
  assert.match(component, /เลือกตามที่ชาวบ้านตอบ ไม่ใช่ความเห็นของคุณ — ระบบบันทึกว่าคุณเป็นผู้บันทึกแทน/)
})

test('ปุ่มสำคัญสูงอย่างน้อย 44px และไม่ใช้ modal บังจอ', () => {
  assert.ok(!/fixed inset-0|role="dialog"/.test(component), 'ห้ามมี modal')
  const buttons = [...component.matchAll(/<button[\s\S]*?className="([^"]*)"/g)].map(m => m[1])
  assert.ok(buttons.length >= 6)
  for (const cls of buttons) assert.match(cls, /min-h-\[44px\]|min-h-16/, `ปุ่มไม่ได้กำหนดความสูงขั้นต่ำ: ${cls}`)
})

console.log(`\nครบ ${cases} กลุ่ม`)
