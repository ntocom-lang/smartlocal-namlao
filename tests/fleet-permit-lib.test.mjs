// โหมดขั้นตอนขอใช้รถ (P1) — ตัวช่วยฝั่งหน้าจอ (src/lib/fleetPermit.js, fleetPermitApi.js) เทียบกับ migration ฝั่ง DB
//   node tests/fleet-permit-lib.test.mjs   (หรือ npm run test:fleet:permit)
// กันเรื่องที่เงียบแล้วพังตอนใช้จริง: (1) DB เพิ่มรหัสผลลัพธ์/เหตุสำรองใหม่แต่หน้าจอไม่มีข้อความ ผู้ใช้เห็นรหัสดิบ
// (2) หน้าจอเรียก RPC ไม่ครบ/ชื่อ argument ไม่ตรง → PostgREST ตอบ PGRST202 (3) ปุ่มออกรถปิดผิดเงื่อนไข (อปท. โหมด queue ออกรถไม่ได้)
// (4) ข้อความหน้าจอ/คู่มือรับรองว่า "ถูกต้องตามระเบียบ/กฎหมาย" ซึ่งระบบไม่มีหน้าที่รับรอง
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  PERMIT_BASIS_LABEL, PERMIT_FALLBACK_REASON, PERMIT_INFO_MAX_IDS, PERMIT_MESSAGES, PERMIT_MODE_OPTIONS, PERMIT_PAPER_MAX_BACKDATE_DAYS,
  PERMIT_STATE_LABEL, PERMIT_TRIP_EXCEPTIONS, chunkIds, permitApproverText, permitAuthorizedLines, permitBadge, permitBasisOptions,
  permitActingTitle, permitBlocksDepart, permitDepartHint, permitFallbackText, permitInfoIds, permitInfoMap, permitMessage, permitPrintAuthority,
  permitSignedOnRange, permitWaitingLines,
  PERMIT_POSITION_CAR_REF, POSITION_CAR_REASON_MAX, POSITION_CAR_REASON_MIN, positionCarNotice, positionCarReasonError, positionCarText,
} from '../src/lib/fleetPermit.js'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const tablesSql = await read('../supabase/migrations/20261121100000_fleet_permit_tables.sql')
// P3 เขียนทับ approver/state/record_paper_permit และเพิ่มรหัส/เหตุสำรองใหม่ — อ่านต่อกันให้ครอบทั้งสองชุด
const p1FunctionsSql = await read('../supabase/migrations/20261121100100_fleet_permit_functions.sql')
const p3ColumnsSql = await read('../supabase/migrations/20261123100000_fleet_position_car_columns.sql')
const p3FunctionsSql = await read('../supabase/migrations/20261123100100_fleet_position_car_functions.sql')
// ส่วน 9 ของ P3 เป็นฟังก์ชันชุดลงนามออนไลน์ (esign_my_pending — รหัสของมันแปลที่ esign.js) ตัดออกก่อนไล่รหัสของขั้นตอนขอใช้รถ
const p3EsignStart = p3FunctionsSql.indexOf('-- ── 9)')
assert.ok(p3EsignStart > 0, 'ไม่พบหัวส่วน 9 (esign_my_pending) ใน migration P3')
const functionsSql = [p1FunctionsSql, p3FunctionsSql.slice(0, p3EsignStart)].join('\n')
const apiSource = await read('../src/lib/fleetPermitApi.js')

let cases = 0
const test = async (label, run) => { await run(); cases++; console.log('PASS ' + label) }

const regulation = (over = {}) => ({
  trip_id: 't1', permit_mode: 'regulation', state: 'waiting',
  approver: { kind: 'authority', name: 'นายสมชาย ใจดี', title: 'นายกเทศมนตรี', registry_id: 'r1', role: 'mayor', fallback_reason: null },
  can_record: true, can_void: false, ...over,
})

await test('ทุกรหัสผลลัพธ์ (code) ที่ฟังก์ชัน DB คืนได้ มีข้อความภาษาไทยในหน้าจอ', () => {
  const codes = new Set([...functionsSql.matchAll(/'code',\s*'([a-z_]+)'/g)].map(match => match[1]))
  assert.ok(codes.size >= 14, `อ่านรหัสจาก migration ได้น้อยผิดปกติ (${codes.size})`)
  const missing = [...codes].filter(code => !PERMIT_MESSAGES[code])
  assert.deepEqual(missing, [], `รหัสที่ยังไม่มีข้อความ: ${missing.join(', ')}`)
  for (const [code, text] of Object.entries(PERMIT_MESSAGES)) {
    assert.ok(text.trim().length > 8, `ข้อความของ ${code} ว่าง/สั้นเกิน`)
    assert.match(text, /[฀-๿]/, `ข้อความของ ${code} ไม่ใช่ภาษาไทย`)
  }
})

await test('ทุกเหตุสำรอง (fallback_reason) ที่ DB ใช้ มีข้อความไทย และไม่มีข้อความเกินจาก DB', () => {
  const reasons = new Set([...functionsSql.matchAll(/v_fallback\s*:=\s*'([a-z_]+)'/g)].map(match => match[1]))
  assert.ok(reasons.size >= 4, `อ่านเหตุสำรองได้น้อยผิดปกติ (${reasons.size})`)
  assert.deepEqual(Object.keys(PERMIT_FALLBACK_REASON).sort(), [...reasons].sort())
  for (const reason of reasons) assert.ok(permitFallbackText(reason).length > 10, reason)
  assert.equal(permitFallbackText(null), '')
  assert.equal(permitFallbackText('รหัสที่ยังไม่รู้จัก'), '')
  // self_request ต้องบอกตรงๆ ว่า ผอ.กองเป็นผู้ขอเอง (ข้อความที่เจ้าของสั่ง)
  assert.match(PERMIT_FALLBACK_REASON.self_request, /ผอ\.กองเป็นผู้ขอเอง/)
})

await test('ทุก error ที่ trigger โยน (FLEET_PERMIT_…) มีข้อความไทย', () => {
  const raised = new Set([...functionsSql.matchAll(/RAISE EXCEPTION\s+'(FLEET_(?:PERMIT|POSITION|HOLDER)_[A-Z_]+):/g)].map(match => match[1]))
  assert.ok(raised.has('FLEET_PERMIT_REQUIRED') && raised.has('FLEET_PERMIT_APPEND_ONLY'), [...raised].join(','))
  for (const code of raised) {
    assert.ok(PERMIT_TRIP_EXCEPTIONS[code]?.length > 20, `${code} ไม่มีข้อความ`)
    assert.match(PERMIT_TRIP_EXCEPTIONS[code], /[฀-๿]/)
  }
  assert.deepEqual(Object.keys(PERMIT_TRIP_EXCEPTIONS).sort(), [...raised].sort())
})

await test('permitMessage: รหัสไม่รู้จักไม่คืนรหัสดิบ · ใช้ message ของระบบเมื่อไม่มีรหัส · delegation_not_applicable แนบเหตุสำรอง', () => {
  assert.equal(permitMessage({ ok: false, code: 'bad_mode' }), PERMIT_MESSAGES.bad_mode)
  assert.equal(permitMessage('already_voided'), PERMIT_MESSAGES.already_voided)
  assert.equal(permitMessage({ ok: false, code: 'รหัสใหม่ที่ยังไม่มี', message: 'network down' }), 'network down')
  assert.equal(permitMessage({ ok: false, code: 'xyz' }), PERMIT_MESSAGES.error)
  assert.equal(permitMessage(null), PERMIT_MESSAGES.error)
  const text = permitMessage({ ok: false, code: 'delegation_not_applicable', fallback_reason: 'self_request' })
  assert.ok(text.startsWith(PERMIT_MESSAGES.delegation_not_applicable) && text.includes(PERMIT_FALLBACK_REASON.self_request), text)
})

await test('permitBlocksDepart: ปิดเฉพาะ regulation ที่ยังไม่ authorized · ว่าง/queue/ยังโหลด = ไม่บล็อก (DB เป็นด่านจริง)', () => {
  assert.equal(permitBlocksDepart(null), false)
  assert.equal(permitBlocksDepart(undefined), false)
  assert.equal(permitBlocksDepart({}), false)
  assert.equal(permitBlocksDepart({ permit_mode: 'queue', state: 'not_required' }), false)
  assert.equal(permitBlocksDepart(regulation({ state: 'waiting' })), true)
  assert.equal(permitBlocksDepart(regulation({ state: 'returned' })), true)
  assert.equal(permitBlocksDepart(regulation({ state: 'authorized', via: 'paper' })), false)
  assert.equal(permitBlocksDepart(regulation({ state: undefined })), true)
  // อปท. queue ต้องไม่ถูกบล็อกแม้ state แปลก ๆ
  assert.equal(permitBlocksDepart({ permit_mode: 'queue', state: 'waiting' }), false)
})

await test('ป้ายสถานะ: ตรงตามเจ้าของสั่ง (รออนุญาต / อนุญาตแล้ว / ถูกส่งคืนผู้ขอ) · queue ไม่มีป้าย', () => {
  assert.deepEqual(PERMIT_STATE_LABEL, {
    waiting: 'รออนุญาต', authorized: 'อนุญาตแล้ว', returned: 'ถูกส่งคืนผู้ขอ', modified: 'แก้คำขอหลังอนุญาต',
    reason_required: 'ต้องระบุเหตุผล (รถประจำตำแหน่ง)', mayor_required: 'ต้องให้นายกอนุญาต',
  })
  // modified (แก้เนื้อหาคำขอหลังบันทึกใบกระดาษ) = ยังออกรถไม่ได้ และบอกเหตุชัด
  assert.equal(permitBlocksDepart(regulation({ state: 'modified' })), true)
  assert.match(permitDepartHint(regulation({ state: 'modified' })), /ขออนุญาตใหม่/)
  assert.equal(permitBadge(regulation({ state: 'waiting' })).label, 'รออนุญาต')
  assert.equal(permitBadge(regulation({ state: 'authorized' })).label, 'อนุญาตแล้ว')
  assert.equal(permitBadge(regulation({ state: 'returned' })).label, 'ถูกส่งคืนผู้ขอ')
  assert.equal(permitBadge({ permit_mode: 'queue', state: 'not_required' }), null)
  assert.equal(permitBadge(null), null)
  assert.equal(permitBadge(regulation({ state: 'ไม่รู้จัก' })), null)
})

await test('ข้อความรออนุญาต: บอกชื่อ+ฐานะผู้อนุญาต · ยังไม่ตั้งผู้ลงนาม = บอกตรงๆ ไม่แต่งชื่อ · เหตุสำรองขึ้นเมื่อมี', () => {
  const info = regulation()
  assert.equal(permitDepartHint(info), 'รออนุญาตจาก นายสมชาย ใจดี')
  assert.equal(permitApproverText(info.approver), 'นายสมชาย ใจดี (นายกเทศมนตรี)')
  assert.deepEqual(permitWaitingLines(info), ['รออนุญาตจาก นายสมชาย ใจดี (นายกเทศมนตรี)'])
  // ยังไม่ตั้งผู้ลงนาม
  const empty = regulation({ approver: { kind: 'authority', name: null, title: 'นายก (ผู้บริหารท้องถิ่น)', registry_id: null, fallback_reason: null } })
  assert.match(permitApproverText(empty.approver), /ยังไม่ได้ตั้งผู้ลงนามในทะเบียน/)
  assert.equal(permitDepartHint(empty), 'รออนุญาตจาก นายก (ผู้บริหารท้องถิ่น)')
  // ผอ.กองที่ได้รับมอบ
  const delegated = regulation({
    approver: { kind: 'delegated_dept_head', name: 'นางสาวสุดา ตั้งใจ', title: 'ผู้อำนวยการกองช่าง', registry_id: 'r2', delegation_ref: 'คำสั่ง ทต. ที่ 12/2569', delegation_date: '2026-11-03', fallback_reason: null },
  })
  const lines = permitWaitingLines(delegated)
  assert.match(lines[0], /รออนุญาตจาก นางสาวสุดา ตั้งใจ \(ผู้อำนวยการกองช่าง\) ในฐานะผู้ได้รับมอบหมาย/)
  assert.match(lines[1], /คำสั่ง ทต\. ที่ 12\/2569 ลงวันที่ 3 พฤศจิกายน พ\.ศ\. 2569/)
  // กลับไปผู้มีอำนาจเพราะ ผอ.กองขอเอง
  const fallback = regulation({ approver: { ...info.approver, fallback_reason: 'self_request' } })
  assert.ok(permitWaitingLines(fallback).includes(PERMIT_FALLBACK_REASON.self_request))
  // ส่งคืนผู้ขอ
  assert.match(permitDepartHint(regulation({ state: 'returned' })), /ถูกส่งคืนผู้ขอ/)
  // อนุญาตแล้ว/queue ไม่มีบรรทัดรอ
  assert.deepEqual(permitWaitingLines(regulation({ state: 'authorized', via: 'paper' })), [])
  assert.deepEqual(permitWaitingLines({ permit_mode: 'queue', state: 'not_required' }), [])
  assert.equal(permitDepartHint(regulation({ state: 'authorized' })), '')
})

await test('ข้อความอนุญาตแล้ว: ออนไลน์/ใบกระดาษ ใคร วันที่ ผู้บันทึก · ผู้ได้รับมอบแสดงเลขที่คำสั่ง', () => {
  const online = permitAuthorizedLines(regulation({
    state: 'authorized', via: 'esign', slot: 'authority', signer_name: 'นายสมชาย ใจดี', signer_title: 'นายกเทศมนตรี', signed_at: '2026-11-12T03:00:00Z',
  }))
  assert.match(online[0], /^ลงนามออนไลน์ โดย นายสมชาย ใจดี \(นายกเทศมนตรี\) เมื่อ 12 พฤศจิกายน พ\.ศ\. 2569/)
  const paper = permitAuthorizedLines(regulation({
    state: 'authorized', via: 'paper', basis: 'authority', signer_name: 'นายสมชาย ใจดี', signer_title: 'นายกเทศมนตรี',
    signed_on: '2026-11-10', recorded_by_name: 'ผู้ดูแลรถ ก', recorded_at: '2026-11-12T03:00:00Z',
  }))
  assert.match(paper[0], /^ใบกระดาษ ผู้อนุญาต นายสมชาย ใจดี \(นายกเทศมนตรี\) ลงนามวันที่ 10 พฤศจิกายน พ\.ศ\. 2569$/)
  assert.match(paper[1], /^บันทึกโดย ผู้ดูแลรถ ก เมื่อ /)
  assert.equal(paper.length, 2, 'basis authority ไม่มีบรรทัดคำสั่งมอบหมาย')
  const delegated = permitAuthorizedLines(regulation({
    state: 'authorized', via: 'paper', basis: 'delegated_dept_head', signer_name: 'นางสาวสุดา ตั้งใจ', signer_title: 'ผอ.กองช่าง',
    signed_on: '2026-11-10', delegation_ref: 'คำสั่ง ทต. ที่ 12/2569', delegation_date: '2026-11-03', recorded_by_name: 'ผู้ดูแลรถ ก', recorded_at: '2026-11-12T03:00:00Z',
  }))
  assert.match(delegated[2], new RegExp(`${PERMIT_BASIS_LABEL.delegated_dept_head.replace(/[()]/g, '\\$&')}.*คำสั่ง ทต\\. ที่ 12/2569.*3 พฤศจิกายน พ\\.ศ\\. 2569`))
  const sk1 = permitAuthorizedLines(regulation({ state: 'authorized', via: 'esign', slot: 'sk1', signer_name: 'ก', signer_title: 'ข', signed_at: '2026-11-12T03:00:00Z' }))
  assert.match(sk1[0], /สก\.๑/)
  assert.deepEqual(permitAuthorizedLines(regulation({ state: 'waiting' })), [])
})

await test('ตัวเลือกผู้อนุญาตในกล่องบันทึก: delegated โผล่เฉพาะ approver.kind = delegated_dept_head · กรณีมอบไม่เดาชื่อผู้มีอำนาจ', () => {
  const plain = permitBasisOptions(regulation())
  assert.deepEqual(plain.map(option => option.key), ['authority'])
  assert.match(plain[0].who, /นายสมชาย ใจดี/)
  const delegated = permitBasisOptions(regulation({
    approver: { kind: 'delegated_dept_head', name: 'นางสาวสุดา ตั้งใจ', title: 'ผอ.กองช่าง', registry_id: 'r2', fallback_reason: null },
  }))
  assert.deepEqual(delegated.map(option => option.key), ['authority', 'delegated_dept_head'])
  assert.equal(delegated[0].who, 'ผู้มีอำนาจสั่งใช้ตามแบบ ๓')
  assert.ok(!delegated[0].who.includes('สุดา'), 'ห้ามเอาชื่อ ผอ.กองไปใส่ตัวเลือกผู้มีอำนาจ')
  assert.match(delegated[1].who, /นางสาวสุดา ตั้งใจ/)
  assert.deepEqual(permitBasisOptions(null).map(option => option.key), ['authority'])
})

await test('permitInfoIds: เฉพาะใบ regulation ที่ยังไม่จบ · queue/ไม่มีคอลัมน์ = ไม่ยิง RPC · chunkIds ก้อนละไม่เกิน 300', () => {
  const trips = [
    { id: 'a', permit_mode: 'regulation', status: 'pending' },
    { id: 'b', permit_mode: 'regulation', status: 'waitlisted' },
    { id: 'c', permit_mode: 'regulation', status: 'approved' },
    { id: 'd', permit_mode: 'regulation', status: 'in_progress' },
    { id: 'e', permit_mode: 'regulation', status: 'completed' },
    { id: 'f', permit_mode: 'regulation', status: 'cancelled' },
    { id: 'g', permit_mode: 'queue', status: 'approved' },
    { id: 'h', status: 'approved' },
    { id: 'a', permit_mode: 'regulation', status: 'pending' },
  ]
  assert.deepEqual(permitInfoIds(trips), ['a', 'b', 'c', 'd'])
  assert.deepEqual(permitInfoIds(trips.filter(trip => trip.permit_mode !== 'regulation')), [])
  assert.deepEqual(permitInfoIds(null), [])
  const many = Array.from({ length: 650 }, (_, index) => `id${index}`)
  const chunks = chunkIds(many)
  assert.deepEqual(chunks.map(chunk => chunk.length), [300, 300, 50])
  assert.equal(PERMIT_INFO_MAX_IDS, 300)
  assert.match(functionsSql, /cardinality\(p_trip_ids\) > 300/, 'เพดาน 300 ของ DB เปลี่ยนแล้ว — ปรับ PERMIT_INFO_MAX_IDS')
  assert.deepEqual(chunkIds([]), [])
})

await test('ช่วงวันที่ลงนามใบกระดาษ: ไม่เกินวันนี้ ย้อนหลัง 60 วัน (ข้ามเดือน/ข้ามปีถูก)', () => {
  assert.deepEqual(permitSignedOnRange('2026-11-12'), { min: '2026-09-13', max: '2026-11-12' })
  assert.deepEqual(permitSignedOnRange('2027-01-10'), { min: '2026-11-11', max: '2027-01-10' })
  assert.deepEqual(permitSignedOnRange('x'), { min: '', max: '' })
})

await test('permitInfoMap: รวมหลายก้อน · ก้อนที่ล้มเหลวข้าม ไม่พังทั้งหน้า', () => {
  const map = permitInfoMap([
    { ok: true, items: [{ trip_id: 'a', permit_mode: 'regulation', state: 'waiting' }] },
    { ok: false, code: 'too_many' },
    { ok: true, items: [{ trip_id: 'b', permit_mode: 'queue', state: 'not_required' }] },
    null,
  ])
  assert.deepEqual([...map.keys()], ['a', 'b'])
  assert.equal(permitBlocksDepart(map.get('a')), true)
  assert.equal(permitBlocksDepart(map.get('b')), false)
  assert.equal(permitBlocksDepart(map.get('ไม่มี')), false)
  assert.equal(permitInfoMap(undefined).size, 0)
})

await test('wrapper เรียก RPC ครบทุก argument ตามชื่อใน DB (ไม่ขาด ไม่เกิน) — กัน PGRST202', () => {
  const dbFunctions = new Map()
  for (const match of functionsSql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(([^)]*)\)/g)) {
    const params = match[2].split(',').map(part => part.trim().split(/\s+/)[0]).filter(Boolean)
    dbFunctions.set(match[1], params)
  }
  const calls = [...apiSource.matchAll(/callPermit\('(\w+)',\s*\{([^}]*)\}/g)]
  const called = calls.map(call => call[1]).sort()
  assert.deepEqual(called, [
    'fleet_permit_settings_get', 'fleet_permit_settings_set', 'fleet_position_car_check', 'fleet_record_paper_permit', 'fleet_trip_permit_info',
    'fleet_void_paper_permit',
  ])
  for (const call of calls) {
    const sent = [...call[2].matchAll(/(p_\w+)\s*:/g)].map(match => match[1]).sort()
    const expected = dbFunctions.get(call[1])
    assert.ok(expected, `ไม่พบฟังก์ชัน ${call[1]} ใน migration`)
    assert.ok(expected.length > 0, call[1])
    assert.deepEqual(sent, [...expected].sort(), `${call[1]}: argument ที่ส่งไม่ตรงกับที่ DB ประกาศ`)
  }
  // ผลต้องผ่าน callPermit เท่านั้น (ห้ามเรียก supabase.rpc ตรง — ไม่งั้นข้ามการแปลง PT429/error)
  assert.equal([...apiSource.matchAll(/supabase\.rpc\(/g)].length, 1)
  // GRANT ให้ authenticated ครบทั้ง 5 ตัวที่หน้าจอเรียก
  for (const name of called) assert.match(functionsSql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(`), `${name} ไม่ได้ GRANT`)
})

await test('ตัวเลขที่หน้าจอยึดจาก DB ตรงกับ SQL (ย้อนหลังวันที่ลงนาม · ความยาวเหตุผล · ชื่อโหมด)', () => {
  assert.match(functionsSql, new RegExp(`p_signed_on < v_today - ${PERMIT_PAPER_MAX_BACKDATE_DAYS}\\b`))
  assert.match(functionsSql, /char_length\(v_reason\) < 3 OR char_length\(v_reason\) > 500/)
  assert.deepEqual(PERMIT_MODE_OPTIONS.map(option => option.key), ['queue', 'regulation'])
  assert.match(tablesSql, /permit_mode IN \('queue', 'regulation'\)/)
  // API ส่งวันที่ว่างเป็น null ไม่ใช่ '' (date cast error)
  assert.match(apiSource, /const orNull = value => \(String\(value \?\? ''\)\.trim\(\) \|\| null\)/)
  // P3: ความยาวเหตุผล ว.๕ ตรงกับ CHECK ของคอลัมน์
  assert.match(p3ColumnsSql, new RegExp(`char_length\\(btrim\\(position_car_reason\\)\\) BETWEEN ${POSITION_CAR_REASON_MIN} AND ${POSITION_CAR_REASON_MAX}`))
})

await test('P3 ว.๕: ป้าย/ข้อความ reason_required · mayor_required บล็อกออกรถและบอกสิ่งที่ต้องแก้', () => {
  const car = { vehicle_id: 'v1', license_plate: 'กข 1', name: 'รถปลัด', position_name: 'ปลัด อบต.' }
  for (const state of ['reason_required', 'mayor_required']) {
    const info = regulation({ state, position_car: car })
    assert.equal(permitBlocksDepart(info), true, state)
    assert.equal(permitBadge(info).label, PERMIT_STATE_LABEL[state])
    assert.match(permitDepartHint(info), /รถประจำตำแหน่ง/)
    assert.ok(permitWaitingLines(info).some(line => line.includes('ทะเบียน กข 1') && line.includes(PERMIT_POSITION_CAR_REF)), state)
  }
  assert.match(permitDepartHint(regulation({ state: 'mayor_required' })), /นายก/)
  // fallback position_car_holder: ไม่มีตัวเลือก "ผอ.ที่ได้รับมอบ" (DB คืน kind='authority')
  const holder = regulation({ approver: { kind: 'authority', role: 'mayor', name: 'นายสมชาย ใจดี', title: 'นายก', registry_id: 'r1', fallback_reason: 'position_car_holder' } })
  assert.deepEqual(permitBasisOptions(holder).map(option => option.key), ['authority'])
  assert.ok(permitWaitingLines(holder).includes(PERMIT_FALLBACK_REASON.position_car_holder))
  assert.match(permitMessage({ ok: false, code: 'reason_required' }), /เหตุผลความจำเป็น/)
  assert.match(permitMessage({ ok: false, code: 'mayor_required' }), /นายก/)
})

await test('P3 ว.๕: ข้อความในฟอร์ม + ตรวจเหตุผลตรงกับ DB', () => {
  const car = { license_plate: 'กข 1', position_name: 'ปลัด อบต.' }
  assert.equal(positionCarText(car), 'ทะเบียน กข 1 (ตำแหน่ง ปลัด อบต.)')
  assert.equal(positionCarText(null), '')
  assert.equal(positionCarNotice(null), '')
  assert.match(positionCarNotice(car), /^ท่านมีรถประจำตำแหน่ง ทะเบียน กข 1/)
  assert.match(positionCarNotice(car, { self: false }), /^ผู้ขอมีรถประจำตำแหน่ง/)
  assert.match(positionCarNotice(car), /นายก/)
  assert.doesNotMatch(positionCarNotice(car, { requesterIsMayor: true }), /เป็นผู้อนุญาต/)
  assert.notEqual(positionCarReasonError(''), '')
  assert.notEqual(positionCarReasonError('    '), '')
  assert.notEqual(positionCarReasonError('สั้น'), '')
  assert.equal(positionCarReasonError('  รถเข้าซ่อมตามนัด  '), '')
  assert.notEqual(positionCarReasonError('ก'.repeat(POSITION_CAR_REASON_MAX + 1)), '')
  assert.equal(positionCarReasonError('ก'.repeat(POSITION_CAR_REASON_MAX)), '')
})

await test('ข้อความหน้าจอ/คู่มือไม่รับรองว่า "ถูกต้องตามระเบียบ/กฎหมาย" · โหมดบังคับอ้างข้อ ๑๒ ของระเบียบ มท. ๒๕๖๙ ตามที่เจ้าของกำหนด', async () => {
  const forbidden = /ถูกต้องตามระเบียบ|ถูกต้องตามกฎหมาย|ชอบด้วยกฎหมาย|ชอบด้วยระเบียบ|ผ่านตามระเบียบ/
  const sources = {
    'src/lib/fleetPermit.js': await read('../src/lib/fleetPermit.js'),
    'src/components/fleet/FleetPermitDialog.jsx': await read('../src/components/fleet/FleetPermitDialog.jsx'),
    'src/components/admin/FleetPermitSettings.jsx': await read('../src/components/admin/FleetPermitSettings.jsx'),
    'src/components/fleet/FleetTrips.jsx': await read('../src/components/fleet/FleetTrips.jsx'),
  }
  const manual = await read('../public/manual-staff.html')
  const start = manual.indexOf('<!-- ═══════════════════ 11.7')
  const end = manual.indexOf('<!-- ═══════════════════ 12 ')
  assert.ok(start > 0 && end > start, 'ไม่พบหัวข้อ 11.7 ในคู่มือ')
  sources['public/manual-staff.html (11.7)'] = manual.slice(start, end)
  for (const [file, text] of Object.entries(sources)) assert.ok(!forbidden.test(text), `${file} มีวลีที่รับรองความถูกต้อง`)
  const regulation = PERMIT_MODE_OPTIONS.find(option => option.key === 'regulation')
  assert.ok(regulation.detail.includes('บังคับให้ได้รับอนุญาตก่อนออกรถ ตามข้อ ๑๒ ของระเบียบ มท. ว่าด้วยการใช้และรักษายานพาหนะของ อปท. พ.ศ. ๒๕๖๙'))
  assert.match(PERMIT_MODE_OPTIONS.find(option => option.key === 'queue').detail, /ระบบไม่ได้ตรวจ/)
})

await test('หน้าจอต่อสายครบ: FleetTrips ใช้ lib/api/dialog · แท็บใหม่ใน DocumentSigningSettings · queue ไม่ยิง RPC', async () => {
  const trips = await read('../src/components/fleet/FleetTrips.jsx')
  assert.match(trips, /from '..\/..\/lib\/fleetPermit'/)
  assert.match(trips, /from '..\/..\/lib\/fleetPermitApi'/)
  assert.match(trips, /import FleetPermitDialog from '.\/FleetPermitDialog'/)
  assert.match(trips, /\.\.\.PERMIT_TRIP_EXCEPTIONS/, 'tripErrorMessage ต้องแปล FLEET_PERMIT_REQUIRED')
  assert.match(trips, /permitInfoIds\(trips\)/, 'ต้องกรองเฉพาะใบ regulation ก่อนเรียก RPC')
  assert.match(trips, /permitBlocksDepart\(/)
  const signing = await read('../src/components/admin/DocumentSigningSettings.jsx')
  assert.match(signing, /key: 'permit'/)
  assert.match(signing, /label: 'ขั้นตอนขอใช้รถ'/)
  assert.match(signing, /<FleetPermitSettings tenant=\{tenant\}/)
  const dialog = await read('../src/components/fleet/FleetPermitDialog.jsx')
  assert.match(dialog, /createPortal\(/, 'dialog ที่เปิดจากกล่อง fixed ต้อง portal ไป body')
  assert.match(dialog, /stopPropagation\(\)/, 'Esc ต้องไม่ลอยไปปิดกล่องรายละเอียด')
  assert.match(dialog, /useId\(\)/)
})

// ── P2: ผอ.กองที่ได้รับมอบลงนามช่องอนุญาต (ข้อ ๑๒ ว.๔) ────────────────────────────────────────────────
const DELEGATED_APPROVER = {
  kind: 'delegated_dept_head', registry_id: 'r2', name: 'นางสาวสุดา ตั้งใจ', title: 'ผู้อำนวยการกองช่าง',
  acting_title: 'ผู้อำนวยการกองช่าง ปฏิบัติราชการแทนนายกเทศมนตรีตำบลสาธิต', delegation_ref: 'คำสั่ง ทต. ที่ 12/2569', delegation_date: '2026-11-03', fallback_reason: null,
}

await test('permitActingTitle ประกอบฐานะเหมือน fleet_permit_acting_title ใน DB (ไม่มีเว้นวรรคหลังคำว่าแทน · ว่าง = คำกลางเดียวกับ DB)', async () => {
  assert.equal(permitActingTitle('ผู้อำนวยการกองช่าง', 'นายกเทศมนตรีตำบลสาธิต'), 'ผู้อำนวยการกองช่าง ปฏิบัติราชการแทนนายกเทศมนตรีตำบลสาธิต')
  assert.equal(permitActingTitle('', ''), 'ผู้อำนวยการสำนัก/กอง ปฏิบัติราชการแทนผู้บริหารท้องถิ่น')
  assert.equal(permitActingTitle('  ผอ.กองคลัง  ', '  นายก อบต.  '), 'ผอ.กองคลัง ปฏิบัติราชการแทนนายก อบต.')
  // คำกลางและรูปแบบต้องตรงกับฝั่ง DB ตัวอักษรต่อตัวอักษร ไม่งั้นใบเซ็นสดกับใบลงนามออนไลน์ (signed_as) พิมพ์คนละข้อความ
  const sql = await read('../supabase/migrations/20261122100000_fleet_permit_delegated_esign.sql')
  assert.match(sql, /'ผู้อำนวยการสำนัก\/กอง'\)\s*\n\s*\|\| ' ปฏิบัติราชการแทน'/)
  assert.match(sql, /'ผู้บริหารท้องถิ่น'/)
})

await test('permitApproverText: ผู้ได้รับมอบแสดงฐานะเต็ม acting_title · ไม่มี acting_title = ตำแหน่งเปล่าเหมือนเดิม', () => {
  assert.equal(permitApproverText(DELEGATED_APPROVER), 'นางสาวสุดา ตั้งใจ (ผู้อำนวยการกองช่าง ปฏิบัติราชการแทนนายกเทศมนตรีตำบลสาธิต)')
  assert.equal(permitApproverText({ ...DELEGATED_APPROVER, acting_title: undefined }), 'นางสาวสุดา ตั้งใจ (ผู้อำนวยการกองช่าง)')
  assert.equal(permitApproverText({ kind: 'authority', name: 'นายสมชาย ใจดี', title: 'นายกเทศมนตรี', registry_id: 'r1' }), 'นายสมชาย ใจดี (นายกเทศมนตรี)')
  assert.ok(permitBasisOptions(regulation({ approver: DELEGATED_APPROVER })).some(option => option.key === 'delegated_dept_head' && option.who.includes('ปฏิบัติราชการแทน')))
})

await test('permitPrintAuthority: เฉพาะใบที่ ผอ.ได้รับมอบ → { name, title ฐานะปฏิบัติราชการแทน } · นอกนั้น null (ใบเดิมทุกไบต์)', () => {
  const mayorTitle = 'นายกเทศมนตรีตำบลสาธิต'
  const expected = { name: 'นางสาวสุดา ตั้งใจ', title: 'ผู้อำนวยการกองช่าง ปฏิบัติราชการแทนนายกเทศมนตรีตำบลสาธิต' }
  // ยังรออนุญาต: ใช้ acting_title จาก DB
  assert.deepEqual(permitPrintAuthority({ info: regulation({ approver: DELEGATED_APPROVER }), mayorTitle }), expected)
  // DB เก่าที่ไม่ส่ง acting_title: ประกอบเองจาก title + ตำแหน่งนายก
  assert.deepEqual(permitPrintAuthority({ info: regulation({ approver: { ...DELEGATED_APPROVER, acting_title: undefined } }), mayorTitle }), expected)
  // ถูกส่งคืน/แก้หลังอนุญาต = ยังไม่ได้รับอนุญาต ยังเป็นใบของ ผอ.
  assert.deepEqual(permitPrintAuthority({ info: regulation({ state: 'returned', approver: DELEGATED_APPROVER }), mayorTitle }), expected)
  assert.deepEqual(permitPrintAuthority({ info: regulation({ state: 'modified', approver: DELEGATED_APPROVER }), mayorTitle }), expected)
  // อนุญาตแล้วด้วยใบกระดาษในฐานะผู้ได้รับมอบ: ชื่อ/ตำแหน่งจากบันทึก + ตำแหน่งนายกจากทะเบียน
  const paper = { permit_mode: 'regulation', state: 'authorized', via: 'paper', basis: 'delegated_dept_head', signer_name: 'นางสาวสุดา ตั้งใจ', signer_title: 'ผู้อำนวยการกองช่าง', approver: DELEGATED_APPROVER }
  assert.deepEqual(permitPrintAuthority({ info: paper, mayorTitle }), expected)
  assert.equal(permitPrintAuthority({ info: paper, mayorTitle: '' }).title, 'ผู้อำนวยการกองช่าง ปฏิบัติราชการแทนผู้บริหารท้องถิ่น')
  assert.equal(permitPrintAuthority({ info: { ...paper, signer_name: ' ' }, mayorTitle }), null, 'ไม่มีชื่อผู้ลงนามในบันทึก = ไม่เดา')
  // อนุญาตแล้วด้วยฐาน authority (ผู้มีอำนาจตามแบบ ๓) ทั้งที่ approver ของใบยังเป็น ผอ.ได้ · ลงนามออนไลน์ = ใช้ signedAs ในใบ → ไม่แตะ orderAuthority
  assert.equal(permitPrintAuthority({ info: { ...paper, basis: 'authority' }, mayorTitle }), null)
  assert.equal(permitPrintAuthority({ info: { ...paper, via: 'esign', basis: undefined }, mayorTitle }), null)
  // ใบเดิม: queue / ไม่มีข้อมูล / ผู้อนุญาตเป็นนายก / ไม่มีชื่อ ผอ.ในทะเบียน
  assert.equal(permitPrintAuthority({ info: { permit_mode: 'queue', state: 'not_required' }, mayorTitle }), null)
  assert.equal(permitPrintAuthority({ info: null, mayorTitle }), null)
  assert.equal(permitPrintAuthority(), null)
  assert.equal(permitPrintAuthority({ info: regulation(), mayorTitle }), null)
  assert.equal(permitPrintAuthority({ info: regulation({ approver: { ...DELEGATED_APPROVER, registry_id: null, name: null } }), mayorTitle }), null)
})

await test('กล่องลงนาม SignTripDialog: ลงช่อง ผอ.แล้วถาม esign_trip_status → ขั้นที่ 2 ลงช่องผู้มีอำนาจด้วยรหัสเดิม · กดยืนยันเอง · onSigned ครั้งเดียวตอนจบ', async () => {
  const dialog = await read('../src/components/esign/SignTripDialog.jsx')
  assert.match(dialog, /getTripEsignStatus/)
  assert.match(dialog, /slot === 'dept_head'/, 'ถามขั้นที่ 2 เฉพาะหลังลงช่อง ผอ.สำนัก/กอง')
  assert.match(dialog, /next\?\.can_sign === true/, 'ต้องเป็นช่องผู้มีอำนาจที่ DB บอกว่าลงได้ (can_sign) เท่านั้น')
  assert.match(dialog, /slot: 'authority', pin, decision: 'approve'/, 'ขั้นที่ 2 ลงช่อง authority ด้วย decision approve')
  // ห้ามลงช่อง authority อัตโนมัติ: signFleetTrip ช่อง authority เรียกจาก handleSignAuthority (ปุ่มกด) เท่านั้น
  assert.equal([...dialog.matchAll(/signFleetTrip\(/g)].length, 2, 'signFleetTrip ต้องมี 2 จุด: ช่องแรกกับปุ่มขั้นที่ 2')
  const stage1 = dialog.slice(dialog.indexOf('async function handleSign()'), dialog.indexOf('async function handleSignAuthority()'))
  assert.ok(!/slot: 'authority'/.test(stage1), 'ช่องแรกห้ามลงช่อง authority ต่อเองโดยไม่ผ่านปุ่มยืนยัน')
  assert.match(dialog, /data-sign-stage2-submit/)
  assert.match(dialog, /data-sign-stage2-later/)
  // รหัสล้างทุกทางออก: ลงเสร็จ / ปิด (ไว้ทีหลัง) / error
  const stage2 = dialog.slice(dialog.indexOf('async function handleSignAuthority()'))
  assert.ok(/setPin\(''\)\s*\n\s*setError\(esignFailureText\(result\)\)/.test(stage2), 'error ขั้นที่ 2 ต้องล้างรหัส')
  assert.ok(/setPin\(''\)\s*\n\s*onSigned\(\{ \.\.\.result/.test(stage2), 'ลงเสร็จต้องล้างรหัสก่อนแจ้งผู้เรียก')
  assert.match(dialog, /function handleClose\(\) \{\s*\n\s*if \(stage2\) \{\s*\n\s*setPin\(''\)\s*\n\s*onSigned\(stage2\.first\)/, 'ปิดกล่องในขั้นที่ 2 = ล้างรหัส + แจ้งผลช่องแรก ให้รายการรีเฟรช')
  // ผู้เรียกทั้งสามปิดกล่องเองใน onSigned — ถ้า onSigned ถูกเรียกก่อนขั้นที่ 2 กล่องจะปิดก่อน
  for (const file of ['../src/components/esign/TripEsignPanel.jsx', '../src/components/esign/MyPendingSignatures.jsx', '../src/components/staff/executive/ExecSimpleSign.jsx']) {
    const caller = await read(file)
    assert.match(caller, /onSigned=\{/, `${file} ไม่ได้ส่ง onSigned ให้กล่องลงนาม`)
  }
  assert.ok(!/ถูกต้องตามระเบียบ|ถูกต้องตามกฎหมาย|ชอบด้วยกฎหมาย|ชอบด้วยระเบียบ|ผ่านตามระเบียบ/.test(dialog), 'ข้อความกล่องลงนามรับรองความถูกต้องทางระเบียบไม่ได้')
})

console.log(`\nผ่านทั้งหมด ${cases} กรณี`)
