// ประเมินความพึงพอใจรายเรื่องของคำขอ E-Service — ตรรกะหน้าเว็บ (src/lib/docRequestRating.js)
//   node tests/doc-request-rating.test.mjs        (npm run test:doc-rating)
// ฝั่งฐานข้อมูลตรวจแยกที่ tests/doc-request-rating-db.test.mjs (ต้องใช้ PGlite)
//
// สิ่งที่ต้องไม่พัง: (1) เด้งชวนเฉพาะ can_rate + ปิดภายใน 30 วันนับจาก server_now (2) finished_at ว่าง = ไม่เด้ง
// (3) ใบที่ปิดหน้าต่าง/ประเมินแล้วในเครื่อง (doneIds) ไม่เด้งซ้ำ (4) ทุก code ของ rate_document_request มีข้อความไทย
// ไม่โชว์ code อังกฤษ (5) ข้อมูล RPC เสียไม่ทำให้หน้าพัง
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  DOC_RATE_ERRORS, DOC_RATE_FALLBACK_ERROR, DOC_RATE_PROMPT_WINDOW_DAYS,
  docRateErrorMessage, findDocToPrompt, isDocRateSuccess, parseDocRatingData, ratingMapOf,
} from '../src/lib/docRequestRating.js'

const DAY = 24 * 60 * 60 * 1000
const NOW = '2026-11-17T05:00:00.000Z'
const NOW_MS = new Date(NOW).getTime()
const ago = days => new Date(NOW_MS - days * DAY).toISOString()
const item = (id, extra = {}) => ({ id, rating: null, can_rate: true, finished_at: ago(1), ...extra })

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}

test('ช่วงเด้งชวนคือ 30 วัน', () => {
  assert.equal(DOC_RATE_PROMPT_WINDOW_DAYS, 30)
})

test('findDocToPrompt: เลือกใบแรกที่ประเมินได้และปิดภายใน 30 วัน', () => {
  const items = [
    item('a', { can_rate: false, rating: 4 }),
    item('b', { finished_at: ago(2) }),
    item('c', { finished_at: ago(3) }),
  ]
  assert.equal(findDocToPrompt(items, NOW)?.id, 'b')
})

test('findDocToPrompt: ขอบ 30 วันพอดียังเด้ง เกินแม้นิดเดียวไม่เด้ง', () => {
  assert.equal(findDocToPrompt([item('x', { finished_at: ago(30) })], NOW)?.id, 'x')
  assert.equal(findDocToPrompt([item('x', { finished_at: new Date(NOW_MS - 30 * DAY - 1).toISOString() })], NOW), null)
  assert.equal(findDocToPrompt([item('x', { finished_at: ago(45) })], NOW), null)
})

test('findDocToPrompt: finished_at ว่าง/อ่านไม่ได้ = ไม่เด้ง (คำขอเก่าก่อนเริ่มเก็บเวลาปิด)', () => {
  assert.equal(findDocToPrompt([item('x', { finished_at: null })], NOW), null)
  assert.equal(findDocToPrompt([item('x', { finished_at: 'ไม่ใช่วันที่' })], NOW), null)
  assert.equal(findDocToPrompt([item('x', { finished_at: undefined })], NOW), null)
})

test('findDocToPrompt: ข้ามใบที่ can_rate เป็น false (ให้คะแนนแล้ว/เคาน์เตอร์/ถอนเอง)', () => {
  assert.equal(findDocToPrompt([item('x', { can_rate: false })], NOW), null)
  assert.equal(findDocToPrompt([item('x', { can_rate: undefined })], NOW), null)
})

test('findDocToPrompt: ข้ามใบใน doneIds (รับทั้ง Set และ array) แล้วไปใบถัดไป', () => {
  const items = [item('a'), item('b')]
  assert.equal(findDocToPrompt(items, NOW, new Set(['a']))?.id, 'b')
  assert.equal(findDocToPrompt(items, NOW, ['a'])?.id, 'b')
  assert.equal(findDocToPrompt(items, NOW, ['a', 'b']), null)
  assert.equal(findDocToPrompt(items, NOW)?.id, 'a')
})

test('findDocToPrompt: server_now อ่านไม่ได้ = ไม่เด้ง · ไม่มีรายการ/ข้อมูลเสีย = null ไม่โยน error', () => {
  assert.equal(findDocToPrompt([item('a')], null), null)
  assert.equal(findDocToPrompt([item('a')], 'ไม่ใช่วันที่'), null)
  assert.equal(findDocToPrompt([], NOW), null)
  assert.equal(findDocToPrompt(null, NOW), null)
  assert.equal(findDocToPrompt([null, undefined, item('a')], NOW)?.id, 'a')
})

test('findDocToPrompt: เวลาปิดเลย server_now เล็กน้อย (นาฬิกาคลาด) ยังเด้งได้', () => {
  assert.equal(findDocToPrompt([item('a', { finished_at: new Date(NOW_MS + 2000).toISOString() })], NOW)?.id, 'a')
})

test('ทุก code ของ rate_document_request มีข้อความไทย และไม่มี code อังกฤษหลุดไปหาผู้ใช้', () => {
  const codes = ['not_logged_in', 'invalid_rating', 'not_found', 'not_owner', 'not_finished', 'withdrawn', 'no_requester', 'counter', 'not_citizen']
  for (const code of codes) {
    const text = docRateErrorMessage(code)
    assert.ok(/[฀-๿]/.test(text), `${code} ต้องมีข้อความไทย`)
    assert.notEqual(text, DOC_RATE_FALLBACK_ERROR, `${code} ต้องมีข้อความเฉพาะ`)
    assert.ok(!text.includes(code), `${code} ห้ามโผล่ในข้อความ`)
  }
  assert.deepEqual(Object.keys(DOC_RATE_ERRORS).sort(), [...codes].sort(), 'already_rated ไม่อยู่ในตาราง error (นับเป็นสำเร็จ)')
})

test('code ที่ไม่รู้จัก/ว่าง/ชื่อใน prototype = ข้อความกลาง', () => {
  for (const code of ['อะไรก็ไม่รู้', '', null, undefined, 'toString', '__proto__', 'constructor', 42]) {
    assert.equal(docRateErrorMessage(code), DOC_RATE_FALLBACK_ERROR)
  }
})

test('isDocRateSuccess: ok หรือ already_rated = สำเร็จ · อย่างอื่น = ไม่สำเร็จ', () => {
  assert.equal(isDocRateSuccess({ ok: true }), true)
  assert.equal(isDocRateSuccess({ ok: false, code: 'already_rated' }), true)
  assert.equal(isDocRateSuccess({ ok: false, code: 'counter' }), false)
  assert.equal(isDocRateSuccess({ ok: false }), false)
  assert.equal(isDocRateSuccess(null), false)
  assert.equal(isDocRateSuccess(undefined), false)
})

test('parseDocRatingData: ทำให้ผลเสียเป็นรายการว่างเสมอ ไม่โยน error', () => {
  for (const bad of [null, undefined, 'x', 5, {}, { items: 'x' }, { items: null }]) {
    assert.deepEqual(parseDocRatingData(bad), { items: [], serverNow: null })
  }
  const parsed = parseDocRatingData({
    server_now: NOW,
    items: [
      { id: 'a', rating: 5, can_rate: false, finished_at: ago(1) },
      { id: 'b', rating: null, can_rate: true, finished_at: null },
      { id: '', rating: 3, can_rate: true },
      { rating: 3 },
      null,
      { id: 'c', rating: 9, can_rate: true, finished_at: ago(2) },
      { id: 'd', rating: 3, can_rate: true, finished_at: ago(2) },
    ],
  })
  assert.equal(parsed.serverNow, NOW)
  assert.deepEqual(parsed.items.map(i => i.id), ['a', 'b', 'c', 'd'])
  assert.deepEqual(parsed.items[1], { id: 'b', rating: null, can_rate: true, finished_at: null })
  // คะแนนนอกช่วง 1-5 ถือว่ายังไม่มีคะแนน · ให้คะแนนแล้วต้องไม่เป็น can_rate แม้ฐานส่งมาผิด
  assert.equal(parsed.items[2].rating, null)
  assert.equal(parsed.items[2].can_rate, true)
  assert.equal(parsed.items[3].rating, 3)
  assert.equal(parsed.items[3].can_rate, false)
})

test('ratingMapOf: Map id → {rating, can_rate} · ใบที่ไม่มีใน Map = ไม่แสดงส่วนประเมิน', () => {
  const map = ratingMapOf([item('a'), item('b', { rating: 4, can_rate: false })])
  assert.deepEqual(map.get('a'), { rating: null, can_rate: true })
  assert.deepEqual(map.get('b'), { rating: 4, can_rate: false })
  assert.equal(map.has('zzz'), false)
  assert.equal(ratingMapOf(null).size, 0)
  assert.equal(ratingMapOf([null, { rating: 3 }]).size, 0)
})

// ชื่อ RPC/พารามิเตอร์/code ในหน้าเว็บ = ในฐานข้อมูลจริง (อ่านจากไฟล์ migration)
const sql = await readFile(new URL('../supabase/migrations/20261204100100_doc_request_rating_functions.sql', import.meta.url), 'utf8')
const modal = await readFile(new URL('../src/components/SatisfactionModal.jsx', import.meta.url), 'utf8')
const page = await readFile(new URL('../src/pages/MyDocRequests.jsx', import.meta.url), 'utf8')
test('migration: rate_document_request / my_document_request_ratings ชื่อพารามิเตอร์ตรงกับที่หน้าเว็บส่ง', () => {
  assert.match(sql, /FUNCTION public\.rate_document_request\(\s*p_request_id uuid,\s*p_rating\s+integer,\s*p_comment\s+text/)
  assert.match(sql, /FUNCTION public\.my_document_request_ratings\(p_muni uuid\)/)
  assert.match(modal, /rpc\('rate_document_request',\s*\{\s*p_request_id:[^}]*p_rating:[^}]*p_comment:/s)
  assert.match(page, /rpc\('my_document_request_ratings',\s*\{\s*p_muni:/)
})
test('ทุก code ที่ rate_document_request / document_request_rating_block คืน อยู่ในตารางข้อความไทย', () => {
  const returned = new Set()
  for (const m of sql.matchAll(/'code',\s*'([a-z_]+)'/g)) returned.add(m[1])
  for (const m of sql.matchAll(/RETURN\s+'([a-z_]+)'\s*;/g)) returned.add(m[1])
  returned.delete('already_rated')
  assert.ok(returned.size >= 9, `พบ code ในฐาน ${returned.size} ตัว`)
  for (const code of returned) assert.ok(Object.hasOwn(DOC_RATE_ERRORS, code), `code ${code} ไม่มีข้อความไทย`)
})
test('หน้า MyDocRequests: ส่ง tenant.id เป็น p_muni และไม่ส่ง signatories/departmentName', () => {
  assert.match(page, /p_muni:\s*tenant\.id/)
  assert.ok(!/signatories|departmentName/.test(page.replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')), 'ฝั่งประชาชนห้ามส่งคีย์ผู้ลงนาม')
})

// ── ห้องผู้บริหาร / แท็บแอดมิน: ตัวแปลงคีย์ eservice ของ exec_summary_satisfaction ──
const { normalizeEserviceRating, eserviceRatingView, normalizeSatisfactionSummary, satisfactionView } = await import('../src/lib/executiveData.js')
test('eserviceRatingView: อัตราตอบใช้ตัวหาร rateable · เสร็จ/ไม่อนุมัติเฉลี่ยแยก · ใบประเมินไม่ได้แยกกลุ่ม', () => {
  const v = eserviceRatingView({
    finished: 6, completed: 5, rejected: 1, rateable: 3, low: 2, undated: 1,
    submitters: { citizen: 3, staff: 2, anonymous: 1 },
    rated: { completed: { cnt: 2, sum: 6 }, rejected: { cnt: 1, sum: 2 } },
    by_type: [{ t: 'residence_cert', finished: 5, rateable: 3, cnt: 3, sum: 8 }],
  })
  assert.equal(v.available, true)
  assert.equal(v.ratedCnt, 3)
  assert.equal(v.responseRate, 100)
  assert.equal(v.completedAvg, 3)
  assert.equal(v.rejectedAvg, 2)
  assert.deepEqual(v.notRateable.map((x) => [x.key, x.n]), [['staff', 2], ['anonymous', 1]])
  assert.deepEqual([v.byType[0].avg, v.byType[0].responseRate], [2.7, 100])
})
test('eserviceRatingView: ฐานเก่าไม่มีคีย์ eservice = ไม่พร้อม ตัวเลขศูนย์ ค่าเฉลี่ย/อัตราตอบเป็น null (ไม่ใช่ 0)', () => {
  const v = eserviceRatingView(null)
  assert.equal(v.available, false)
  assert.deepEqual([v.finished, v.ratedCnt, v.responseRate, v.completedAvg], [0, 0, null, null])
  assert.equal(normalizeEserviceRating({ rateable: -3 }).rateable, 0)
})
test('satisfactionView: ป้ายคะแนนต่ำ eservice เป็นภาษาไทย ไม่ใช่รหัส', () => {
  const v = satisfactionView(normalizeSatisfactionSummary({ low: { eservice: 2, general: 1 } }))
  assert.deepEqual(v.low.map((x) => x.label).sort(), ['คำขอ E-Service', 'แบบประเมินภาพรวม'].sort())
  assert.equal(v.eservice.available, false)
})

test('satisfactionView: มีคีย์ eservice แต่เป็น null = โหลดล้ม (eserviceFailed) · ไม่มีคีย์ = ฐานเก่า ไม่ขึ้นเตือน', () => {
  assert.equal(satisfactionView(normalizeSatisfactionSummary({ eservice: null })).eserviceFailed, true)
  assert.equal(satisfactionView(normalizeSatisfactionSummary({})).eserviceFailed, false)
  assert.equal(satisfactionView(normalizeSatisfactionSummary({ eservice: { finished: 1 } })).eserviceFailed, false)
})

console.log(`\n${cases} cases passed`)
