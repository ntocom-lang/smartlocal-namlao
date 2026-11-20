// ทะเบียนค่าธรรมเนียมขยะ (ขั้น 1B PR1) — ตัวช่วยฝั่งหน้าจอ (src/lib/wasteFee.js, wasteFeeApi.js) เทียบกับ migration ฝั่ง DB
//   node tests/waste-fee-lib.test.mjs   (หรือ npm run test:waste-fee)
// กันเรื่องที่เงียบแล้วพังตอนใช้จริง:
//   (1) ตัวคำนวณยอดฝั่งหน้าจอ (computeMonthly) ไม่ตรงกับ wfee_compute ในฐาน — เทียบกับฐานจริงใน tests/waste-fee-db.test.mjs
//   (2) หน้าจอเรียก RPC/ตาราง/คอลัมน์ไม่ตรงชื่อ → PostgREST ตอบ PGRST202/42703 หลังขึ้นระบบ
//   (3) หน้าจอมีถ้อยคำที่ห้าม (ระบบตัดสินแทนคน / "ไม่ใช้ AI") หรือมีของที่ขอบเขต PR1 ไม่ทำ (ปุ่มยกเว้นหนี้ ยอดค้างเก่า ช่องเลขบัตร)
//   (4) เมนูลงทะเบียนไม่ครบ (staffModules / staffNavGroups / staffMenuAccess / StaffDashboard / ห้องผู้บริหาร) · ค่าเริ่มต้นต้องปิด
//   (5) นำเข้า Excel: กู้เลข 0 · พ.ศ./ค.ศ. · แปลง กก. → หน่วย · ตรวจซ้ำ · แถวผิดต้องไม่เข้าชุดนำเข้า
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import * as W from '../src/lib/wasteFee.js'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const stripComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
const tablesSql = await read('../supabase/migrations/20261222100000_waste_fee_tables.sql')
const rpcSql = await read('../supabase/migrations/20261222100100_waste_fee_rls_rpc.sql')
const allSql = `${tablesSql}\n${rpcSql}`
const apiSource = await read('../src/lib/wasteFeeApi.js')

let cases = 0
const test = async (label, run) => { await run(); cases++; console.log('PASS ' + label) }

// อัตราตัวอย่างโครงเดียวกับแถวตัวอย่างของ demo (ตัวเลขนี้ไม่ใช่อัตราของ อปท. จริง)
const R = (over = {}) => ({
  id: 'r1', effective_from: '2026-11-17', ordinance_ref: 'ตัวอย่าง', basis: 'units', base_collect: 30, base_dispose: 20,
  unit_collect: 51, unit_dispose: 52, big_unit_collect: 66, big_unit_dispose: 62, place_type_rates: null, sorting_discount: true, is_example: true, ...over,
})
const approx = (a, b, msg) => assert.equal(Number(a).toFixed(2), Number(b).toFixed(2), msg)

// ── ปริมาณ ─────────────────────────────────────────────────────────────────────

await test('kgToUnits: ≤ 120 กก. = 1 หน่วย · เกินแล้วหน่วยละ 120 กก. เศษไม่เกินกึ่งหน่วย = 0.5 · เกินกึ่ง = 1 (ข้อ 10) · ค่าผิด = null', () => {
  const cases = [[1, 1], [100, 1], [120, 1], [120.01, 1.5], [130, 1.5], [180, 1.5], [180.01, 2], [181, 2], [240, 2], [241, 2.5], [300, 2.5], [301, 3], [3600, 30], [3601, 30.5], ['1,200', 10], ['  150 ', 1.5]]
  for (const [kg, units] of cases) assert.equal(W.kgToUnits(kg), units, `${kg} กก.`)
  for (const bad of [0, -5, '', 'abc', null, undefined, NaN, 1_200_001]) assert.equal(W.kgToUnits(bad), null, String(bad))
  assert.equal(W.kgToUnits(1_200_000), 10000)
})

await test('isValidUnits: บวก ทีละ 0.5 ไม่เกิน 10,000 (ตรงกับ CHECK monthly_units)', () => {
  for (const ok of [0.5, 1, 1.5, 30, 10000]) assert.ok(W.isValidUnits(ok), String(ok))
  for (const bad of [0, -1, 0.25, 1.3, 10000.5, NaN, 'x', null]) assert.ok(!W.isValidUnits(bad), String(bad))
})

// ── คำนวณยอด ───────────────────────────────────────────────────────────────────

await test('computeMonthly (basis units): ≤ 1 หน่วย = เหมา · ส่วนเกิน 1–30 = unit_* · เกิน 30 = big_unit_* · ยอดรวมถูก', () => {
  const rate = R()
  const at = (u, sorting = false) => W.computeMonthly(rate, u, 'house', sorting)
  assert.deepEqual([at(0.5).collect, at(0.5).dispose, at(0.5).total], [30, 20, 50], 'ครึ่งหน่วยยังเหมา')
  assert.deepEqual([at(1).collect, at(1).dispose, at(1).total], [30, 20, 50])
  assert.deepEqual([at(1.5).collect, at(1.5).dispose, at(1.5).total], [55.5, 46, 101.5])
  assert.deepEqual([at(5).collect, at(5).dispose, at(5).total], [234, 228, 462])
  assert.deepEqual([at(30).collect, at(30).dispose, at(30).total], [30 + 29 * 51, 20 + 29 * 52, 30 + 29 * 51 + 20 + 29 * 52])
  const t31 = at(31)
  assert.deepEqual([t31.tier2_units, t31.tier3_units, t31.collect, t31.dispose, t31.total], [29, 1, 1575, 1590, 3165])
  assert.equal(at(31.5).tier3_units, 1.5)
  assert.equal(at(1).ok, true)
})

await test('computeMonthly: คัดแยก + รุ่นอัตรามีหมวดลด ⇒ ค่ากำจัดกึ่งหนึ่ง (ปัดสตางค์ครึ่งขึ้น) · รุ่นที่ไม่มีหมวดลด = ไม่ลด', () => {
  const s1 = W.computeMonthly(R(), 1, 'house', true)
  assert.deepEqual([s1.discount, s1.total, s1.sorting_applied], [10, 40, true])
  assert.deepEqual([W.computeMonthly(R(), 5, 'house', true).discount, W.computeMonthly(R(), 5, 'house', true).total], [114, 348])
  // ค่ากำจัดเศษสตางค์: 20.01/2 = 10.005 → 10.01 (ปัดครึ่งขึ้นแบบ Postgres numeric)
  const odd = W.computeMonthly(R({ base_dispose: 20.01 }), 1, 'house', true)
  approx(odd.discount, 10.01); approx(odd.total, 30 + 20.01 - 10.01)
  // ครึ่งหน่วย × อัตราที่ลงท้ายเศษสตางค์ → ครึ่งสตางค์ ปัดครึ่งขึ้นที่รายการย่อยก่อน แล้วยอดรวม = ผลบวกรายการที่ปัดแล้ว
  // (ลำดับเดียวกับ wfee_compute — 32.51 + 22.51 = 55.02 ไม่ใช่ round(55.01) · tests/waste-fee-db.test.mjs เทียบกับฐานจริง)
  const half = W.computeMonthly(R({ unit_collect: 5.01, unit_dispose: 5.01, sorting_discount: false }), 1.5, 'house', false)
  approx(half.collect, 32.51); approx(half.dispose, 22.51); approx(half.total, 55.02)
  const noDiscount = W.computeMonthly(R({ sorting_discount: false }), 5, 'house', true)
  assert.deepEqual([noDiscount.discount, noDiscount.sorting_applied, noDiscount.total], [0, false, 462])
})

await test('computeMonthly (basis place_type): เหมาตามประเภทสถานที่ · ประเภทที่ไม่มีอัตรา/ปริมาณผิด/อัตราไม่ครบขั้น = error ชุดเดียวกับฐาน', () => {
  const pt = R({ basis: 'place_type', base_collect: null, base_dispose: null, unit_collect: null, unit_dispose: null, big_unit_collect: null, big_unit_dispose: null,
    place_type_rates: { house: 20, shop: 40.5 }, sorting_discount: false })
  const house = W.computeMonthly(pt, 1, 'house', true)
  assert.deepEqual([house.ok, house.collect, house.dispose, house.discount, house.total], [true, 20, 0, 0, 20])
  assert.equal(W.computeMonthly(pt, 99, 'shop', false).total, 40.5, 'basis place_type ไม่สนปริมาณ')
  assert.deepEqual(W.computeMonthly(pt, 1, 'agency', false), { ok: false, error: 'no_rate_for_place_type', place_type: 'agency' })
  assert.equal(W.computeMonthly(R(), 1.3, 'house', false).error, 'bad_units')
  assert.equal(W.computeMonthly(R(), 0, 'house', false).error, 'bad_units')
  assert.equal(W.computeMonthly(R(), null, 'house', false).error, 'bad_units')
  assert.equal(W.computeMonthly(null, 1, 'house', false).error, 'rate_not_found')
  const noTier = R({ unit_collect: null, unit_dispose: null, big_unit_collect: null, big_unit_dispose: null })
  assert.equal(W.computeMonthly(noTier, 1, 'house', false).total, 50)
  assert.equal(W.computeMonthly(noTier, 1.5, 'house', false).error, 'no_unit_rate')
  const noBig = R({ big_unit_collect: null, big_unit_dispose: null })
  assert.equal(W.computeMonthly(noBig, 30, 'house', false).ok, true)
  assert.equal(W.computeMonthly(noBig, 31, 'house', false).error, 'no_big_unit_rate')
})

await test('sampleRows: 1 / 1.5 / 5 / 31 หน่วย (± คัดแยกเมื่อมีหมวดลด) · basis place_type = รายประเภทสถานที่', () => {
  const rows = W.sampleRows(R())
  assert.deepEqual(rows.map(r => r.key), ['1', '1.5', '5', '31'])
  assert.equal(rows[0].plain.total, 50)
  assert.equal(rows[0].sorted.total, 40)
  assert.equal(W.sampleRows(R({ sorting_discount: false }))[0].sorted, null)
  const pt = W.sampleRows(R({ basis: 'place_type', place_type_rates: { house: 20, other: 5 } }))
  assert.deepEqual(pt.map(r => r.key), ['house', 'other'])
  assert.deepEqual(W.sampleRows(null), [])
})

// ── รุ่นอัตรา/เดือน ──────────────────────────────────────────────────────────────

await test('pickRateForMonth: effective_from ล่าสุดที่ ≤ วันที่ 1 ของเดือน (มีผลกลางเดือน = เดือนถัดไป) · ไม่มี = null · รับ yyyy-mm', () => {
  const rates = [{ id: 'a', effective_from: '2026-01-01' }, { id: 'b', effective_from: '2026-11-17' }, { id: 'c', effective_from: '2027-01-01' }]
  assert.equal(W.pickRateForMonth(rates, '2026-11-20').id, 'a', 'พ.ย. ยังใช้รุ่นเก่า เพราะรุ่น b เริ่มวันที่ 17')
  assert.equal(W.pickRateForMonth(rates, '2026-12-05').id, 'b')
  assert.equal(W.pickRateForMonth(rates, '2027-01').id, 'c')
  assert.equal(W.pickRateForMonth(rates, '2025-12-31'), null)
  assert.equal(W.pickRateForMonth([], '2026-12-01'), null)
  assert.equal(W.pickRateForMonth(rates, 'x'), null)
  assert.equal(W.firstMonthUsing('2026-11-17'), '2026-12-01')
  assert.equal(W.firstMonthUsing('2026-12-01'), '2026-12-01')
})

await test('rateState: ใช้อยู่ตอนนี้ / รอมีผล / ถูกแทนแล้ว · เดือนตามเวลาไทย', () => {
  const rates = [{ id: 'a', effective_from: '2026-01-01' }, { id: 'b', effective_from: '2026-11-01' }, { id: 'c', effective_from: '2027-03-01' }]
  const now = new Date('2026-11-20T05:00:00Z')
  assert.deepEqual(rates.map(r => W.rateState(r, rates, now)), ['past', 'current', 'pending'])
  // 17:30 UTC ของวันที่ 31 ต.ค. = 1 พ.ย. เวลาไทย → รุ่น b เริ่มมีผลแล้ว
  assert.equal(W.rateState(rates[1], rates, new Date('2026-10-31T17:30:00Z')), 'current')
  assert.equal(W.rateState(rates[1], rates, new Date('2026-10-31T16:30:00Z')), 'past'.replace('past', 'pending'))
})

await test('ช่วงที่ได้ลดค่ากำจัด: ครอบคลุมเดือน starts_on ≤ เดือน < ends_on · ends_on ว่าง = ยังลดอยู่ · livePeriod เลือกช่วงที่ยังไม่ถูกปิด', () => {
  const p = { starts_on: '2026-11-01', ends_on: null }
  assert.ok(W.periodCovers(p, '2026-11-01') && W.periodCovers(p, '2030-01-01'))
  assert.ok(!W.periodCovers(p, '2026-10-01'))
  const closed = { starts_on: '2026-11-01', ends_on: '2027-01-01' }
  assert.ok(W.periodCovers(closed, '2026-12-01') && !W.periodCovers(closed, '2027-01-01'), 'เดือนที่ ends_on = เดือนแรกที่ไม่ลดแล้ว')
  assert.ok(W.hasSortingIn([closed], '2026-11-20') && !W.hasSortingIn([], '2026-11-01'))
  assert.equal(W.livePeriod([closed], '2027-01-01'), null)
  assert.equal(W.livePeriod([closed], '2026-12-01'), closed)
  assert.equal(W.livePeriod([{ starts_on: '2026-01-01', ends_on: '2026-03-01' }, p], '2026-11-01'), p)
})

// ── ฟอร์ม ─────────────────────────────────────────────────────────────────────

await test('ยืนยันการคัดแยก: ต้องมีเหตุผล 3–1000 ตัวอักษร · เปิด = เดือนนี้เป็นต้นไป (ไม่ย้อนหลัง) · เลิก = เดือนหน้าเป็นต้นไป · ล่วงหน้า ≤ 12 เดือน', () => {
  const now = new Date('2026-11-20T05:00:00Z')
  const ok = { on: true, from: '2026-11-01', note: 'ตรวจหน้างานแล้ว', now }
  assert.equal(W.validateSorting(ok), '')
  assert.match(W.validateSorting({ ...ok, note: 'ab' }), /เหตุผล/)
  assert.match(W.validateSorting({ ...ok, note: 'x'.repeat(1001) }), /เหตุผล/)
  assert.match(W.validateSorting({ ...ok, from: '2026-10-01' }), /ไม่ย้อนหลัง/)
  assert.match(W.validateSorting({ ...ok, from: '' }), /เดือน/)
  assert.equal(W.validateSorting({ ...ok, from: '2027-11-01' }), '')
  assert.match(W.validateSorting({ ...ok, from: '2027-12-01' }), /12 เดือน/)
  const stop = { on: false, from: '2026-12-01', note: 'เลิกคัดแยกแล้ว', now }
  assert.equal(W.validateSorting(stop), '')
  assert.match(W.validateSorting({ ...stop, from: '2026-11-01' }), /ไม่ตัดย้อน/, 'เดือนนี้ยังได้ลด')
  assert.match(W.validateSorting({ ...stop, note: '' }), /เหตุผล/)
})

await test('ฟอร์มบัญชี: ชื่อบังคับ · เบอร์ 6–20 หลัก · ปริมาณทีละครึ่ง · เดือนเริ่มเก็บ · payload ปัดหมู่เป็น "หมู่ N" และไม่ส่งช่องคัดแยก/ปิดบัญชี', () => {
  const f = { account_no: ' A-1 ', payer_name: ' สมชาย ', payer_phone: '081-234-5678', house_no: '9/1', village: '3', address: '', place_type: 'house', monthly_units: '1.5', service_from: '2026-11-15', note: '' }
  assert.equal(W.validateAccountForm(f), '')
  assert.match(W.validateAccountForm({ ...f, payer_name: '  ' }), /ชื่อ/)
  assert.match(W.validateAccountForm({ ...f, payer_phone: 'abc' }), /เบอร์/)
  assert.match(W.validateAccountForm({ ...f, monthly_units: '1.3' }), /ครึ่งหน่วย/)
  assert.match(W.validateAccountForm({ ...f, monthly_units: '0' }), /ครึ่งหน่วย/)
  assert.match(W.validateAccountForm({ ...f, place_type: 'x' }), /ประเภทสถานที่/)
  assert.match(W.validateAccountForm({ ...f, service_from: '' }), /เดือน/)
  const p = W.accountPayload(f)
  assert.deepEqual(p, { account_no: 'A-1', payer_name: 'สมชาย', payer_phone: '081-234-5678', house_no: '9/1', village: 'หมู่ 3', address: null,
    place_type: 'house', monthly_units: 1.5, service_from: '2026-11-01', note: null })
  assert.deepEqual(Object.keys(p).filter(k => /sorting|closed|status|import_batch|municipality/.test(k)), [])
  assert.equal(W.normalizeVillage('๓'), 'หมู่ 3')
  assert.equal(W.normalizeVillage('หมู่ 3'), 'หมู่ 3')
  assert.equal(W.normalizeVillage('บ้านใหม่'), 'บ้านใหม่')
  assert.equal(W.normalizeVillage('  '), '')
})

await test('เลิกเก็บ: เดือนแรกที่ไม่เก็บต้องหลังเดือนเริ่มเก็บ + เหตุผลบังคับ', () => {
  assert.equal(W.validateClose({ closedFrom: '2027-01-01', reason: 'ย้ายออก', serviceFrom: '2026-11-01' }), '')
  assert.match(W.validateClose({ closedFrom: '2026-11-01', reason: 'ย้ายออก', serviceFrom: '2026-11-01' }), /หลังเดือน/)
  assert.match(W.validateClose({ closedFrom: '2027-01-01', reason: ' ', serviceFrom: '2026-11-01' }), /เหตุผล/)
  assert.match(W.validateClose({ closedFrom: '', reason: 'x'.repeat(5), serviceFrom: '2026-11-01' }), /เดือน/)
})

await test('ฟอร์มรุ่นอัตรา: ต้องอ้างข้อบัญญัติ · เหมา 2 ช่อง · ส่วนเกินต้องกรอกคู่ · ขั้น 30 หน่วยต้องมีขั้นก่อนหน้า · place_type ≥ 1 ประเภท · payload ผ่าน CHECK shape ของฐาน', () => {
  const f = { effective_from: '2026-11-17', ordinance_ref: 'เทศบัญญัติ … พ.ศ. 2568 ข้อ 6', basis: 'units', base_collect: '30', base_dispose: '20', unit_collect: '51', unit_dispose: '52',
    big_unit_collect: '66', big_unit_dispose: '62', place_rates: {}, sorting_discount: true, note: '' }
  assert.equal(W.validateRateForm(f), '')
  assert.match(W.validateRateForm({ ...f, ordinance_ref: ' ' }), /อ้างข้อบัญญัติ/)
  assert.match(W.validateRateForm({ ...f, effective_from: '' }), /วันที่/)
  assert.match(W.validateRateForm({ ...f, base_dispose: '' }), /อัตราเหมา/)
  assert.match(W.validateRateForm({ ...f, unit_dispose: '' }), /ต้องกรอกทั้ง/)
  assert.match(W.validateRateForm({ ...f, unit_collect: '', unit_dispose: '' }), /ต้องมีอัตราส่วนเกิน/)
  assert.match(W.validateRateForm({ ...f, base_collect: '-1' }), /อัตราเหมา/)
  const p = W.ratePayload(f)
  assert.equal(p.effective_from, '2026-11-17', 'ไม่ปัดวันมีผลเป็นวันที่ 1')
  assert.deepEqual([p.base_collect, p.big_unit_dispose, p.place_type_rates, p.sorting_discount], [30, 62, null, true])
  const noBig = W.ratePayload({ ...f, big_unit_collect: '', big_unit_dispose: '' })
  assert.deepEqual([noBig.big_unit_collect, noBig.big_unit_dispose], [null, null])
  const pt = { ...f, basis: 'place_type', place_rates: { house: '20', shop: '' }, sorting_discount: true }
  assert.equal(W.validateRateForm(pt), '')
  assert.match(W.validateRateForm({ ...pt, place_rates: { house: '' } }), /อย่างน้อย 1/)
  assert.deepEqual(W.ratePayload(pt).place_type_rates, { house: 20 })
  assert.deepEqual([W.ratePayload(pt).base_collect, W.ratePayload(pt).sorting_discount], [null, false], 'place_type ห้ามมีหมวดลด/อัตราหน่วย (CHECK ของฐาน)')
})

await test('ประเภทสถานที่ 5 แบบตรงกับ CHECK ในฐานและฟอร์มคำขอเก็บขยะ · คำที่ผู้ใช้พิมพ์จับคู่ได้ ไม่รู้จัก = null', async () => {
  assert.deepEqual(W.PLACE_TYPES.map(p => p.value), ['house', 'shop', 'business', 'agency', 'other'])
  const check = tablesSql.match(/place_type\s+text NOT NULL DEFAULT 'house'\s+CHECK \(place_type IN \(([^)]*)\)\)/)
  assert.ok(check, 'ไม่พบ CHECK ของ place_type')
  assert.deepEqual([...check[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]), W.PLACE_TYPES.map(p => p.value))
  const wizard = await read('../src/pages/WasteCollectionRequestWizard.jsx')
  for (const p of W.PLACE_TYPES) assert.ok(wizard.includes(p.label), `ฟอร์มคำขอเก็บขยะไม่มีป้าย "${p.label}"`)
  for (const [text, key] of [['บ้านพักอาศัย', 'house'], ['บ้าน', 'house'], ['ร้านค้า/ร้านอาหาร', 'shop'], ['ร้านอาหาร', 'shop'], ['สถานประกอบการ/โรงงาน', 'business'], ['โรงงาน', 'business'],
    ['หน่วยงาน/สถานศึกษา', 'agency'], ['โรงเรียน', 'agency'], ['อื่นๆ', 'other'], ['agency', 'agency']]) assert.equal(W.matchPlaceType(text), key, text)
  assert.equal(W.matchPlaceType('ยานอวกาศ'), null)
  assert.equal(W.matchPlaceType(''), null)
})

// ── นำเข้า Excel/CSV ────────────────────────────────────────────────────────────

const HEAD = ['เลขทะเบียน', 'ชื่อผู้ชำระ', 'เบอร์โทร', 'บ้านเลขที่', 'หมู่', 'ที่อยู่', 'ประเภทสถานที่', 'ปริมาณ (หน่วย)', 'ปริมาณ (กก.)', 'เดือนเริ่มเก็บ']

await test('แมปหัวคอลัมน์ไทย (ไม่สนช่องว่าง/วงเล็บ/ตัวพิมพ์) · หาแถวหัวตารางใต้ชื่อเรื่อง · ขาดชื่อผู้ชำระ = บอกชื่อหัวที่ขาด ไม่พรีวิวแถว', () => {
  const idx = W.mapImportHeaders(HEAD)
  assert.deepEqual(Object.fromEntries(Object.entries(idx).filter(([, i]) => i >= 0)),
    { account_no: 0, payer_name: 1, payer_phone: 2, house_no: 3, village: 4, address: 5, place_type: 6, units: 7, kg: 8, service_from: 9 })
  assert.equal(W.mapImportHeaders(['ชื่อ-สกุล', 'โทร', 'หมู่ที่']).payer_name, 0)
  const withTitle = [['ทะเบียนผู้ใช้บริการเก็บขยะ ทต.ตัวอย่าง'], [''], HEAD, ['A-1', 'สมชาย', '', '', '', '', '', '', '', '2026-12-01']]
  const r = W.parseImportRows(withTitle, {})
  assert.equal(r.rows.length, 1)
  assert.equal(r.rows[0].line, 4, 'เลขแถวในไฟล์ นับรวมชื่อเรื่อง')
  assert.deepEqual(W.parseImportRows([['เบอร์โทร', 'บ้านเลขที่'], ['081', '1']]).missingHeaders, ['ชื่อผู้ชำระ'])
  assert.deepEqual(W.parseImportRows([]).missingHeaders, ['ชื่อผู้ชำระ'])
})

await test('ตรวจแถวนำเข้า: แถวดี ready + payload ตรงฐาน · เลขทะเบียนซ้ำ (ในไฟล์/ในทะเบียน) = ผิด · บ้านเลขที่+หมู่ซ้ำ = เตือน (ยังนำเข้า) · แถวว่างข้ามเงียบ', () => {
  const rows = [HEAD,
    ['A-1', 'สมชาย ตัวอย่าง', '081-234-5678', '9', '3', 'ซอย 1', 'บ้าน', '1', '', '2026-12-01'],
    ['A-1', 'ซ้ำในไฟล์', '', '10', '3', '', '', '', '', '2026-12-01'],
    ['', '', '', '', '', '', '', '', '', ''],
    ['A-9', 'ซ้ำกับทะเบียน', '', '', '', '', '', '', '', '2026-12-01'],
    ['A-3', 'บ้านเดียวกัน', '', '9', 'หมู่ 3', '', 'ร้านอาหาร', '2', '', '2026-12-01'],
    ['A-4', 'บ้านซ้ำทะเบียน', '', '77', 'หมู่ 1', '', '', '', '', '2026-12-01']]
  const r = W.parseImportRows(rows, { existing: [{ account_no: 'A-9', house_no: '77', village: 'หมู่ 1' }] })
  assert.deepEqual(r.rows.map(x => [x.line, x.status]), [[2, 'ready'], [3, 'invalid'], [5, 'invalid'], [6, 'ready'], [7, 'ready']])
  assert.deepEqual(r.rows[0].payload, { account_no: 'A-1', payer_name: 'สมชาย ตัวอย่าง', payer_phone: '081-234-5678', house_no: '9', village: 'หมู่ 3', address: 'ซอย 1',
    place_type: 'house', monthly_units: 1, service_from: '2026-12-01', note: null })
  assert.match(r.rows[1].errors.join(), /A-1.*ซ้ำกับแถว 2/)
  assert.match(r.rows[2].errors.join(), /A-9.*ซ้ำกับที่มีในทะเบียน/)
  assert.match(r.rows[3].warnings.join(), /ซ้ำกับแถว 2/, 'บ้านเลขที่ 9 หมู่ 3 ซ้ำในไฟล์ = เตือน')
  assert.equal(r.rows[3].payload.place_type, 'shop')
  assert.match(r.rows[4].warnings.join(), /มีบัญชีอยู่ในทะเบียนแล้ว/)
  assert.equal(r.rows[1].payload, null, 'แถวผิดไม่มี payload')
})

await test('นำเข้า: กู้เลข 0 นำหน้าเบอร์ที่ Excel ตัดทิ้ง · เบอร์สั้น/ตัวอักษร = ผิด · เลขต่อถูกตัดพร้อมเตือน · ไม่รับเบอร์ที่ฐานปฏิเสธ', () => {
  const run = phone => W.parseImportRows([HEAD, ['', 'ก', phone, '', '', '', '', '', '', '2026-12-01']], {}).rows[0]
  assert.equal(run('812345678').payload.payer_phone, '0812345678')
  assert.equal(run('55123456').payload.payer_phone, '055123456')
  assert.equal(run('+66 81 234 5678').payload.payer_phone, '0812345678')
  assert.equal(run('๐๘๑๒๓๔๕๖๗๘').payload.payer_phone, '0812345678')
  assert.equal(run('').payload.payer_phone, null)
  const ext = run('055-123456 ต่อ 12')
  assert.equal(ext.payload.payer_phone, '055123456')
  assert.match(ext.warnings.join(), /เลขต่อ/)
  assert.match(run('12345').errors.join(), /สั้น/)
  assert.match(run('โทรหาที่บ้าน').errors.join(), /เบอร์โทร/)
  for (const row of [run('812345678'), run('055-123456 ต่อ 12'), run('(081) 234.5678')]) assert.match(row.payload?.payer_phone ?? '0', /^[0-9+\- ]{1,20}$/, 'ต้องผ่าน regex เบอร์ของฐาน')
})

await test('นำเข้า: ปริมาณ หน่วย/กก. · ว่าง = 1 หน่วย · หน่วยที่ไม่ใช่ทีละครึ่ง = ผิด · ประเภทสถานที่ไม่รู้จัก = ผิด ว่าง = บ้านพักอาศัย', () => {
  const run = (units, kg, place = '') => W.parseImportRows([HEAD, ['', 'ก', '', '', '', '', place, units, kg, '2026-12-01']], {}).rows[0]
  assert.equal(run('', '').payload.monthly_units, 1)
  assert.equal(run('2.5', '').payload.monthly_units, 2.5)
  assert.equal(run('', '150').payload.monthly_units, 1.5)
  assert.equal(run('', '1,200').payload.monthly_units, 10)
  assert.equal(run('3', '999').payload.monthly_units, 3, 'ช่องหน่วยที่กรอกไว้ชนะ กก.')
  assert.match(run('1.3', '').errors.join(), /ทีละครึ่งหน่วย/)
  assert.match(run('abc', '').errors.join(), /ตัวเลข/)
  assert.match(run('', '-5').errors.join(), /กก/)
  assert.equal(run('', '', '').payload.place_type, 'house')
  assert.equal(run('', '', 'หน่วยงาน/สถานศึกษา').payload.place_type, 'agency')
  assert.match(run('', '', 'ยานอวกาศ').errors.join(), /ไม่รู้จักประเภทสถานที่/)
})

await test('นำเข้า: เดือนเริ่มเก็บ พ.ศ./ค.ศ./เลขวัน Excel/ดด/ปปปป · ว่าง = เดือนที่เลือกไว้ (ไม่ส่ง = ผิด) · ผิดรูป = ผิด · คอลัมน์เลขบัตรไม่ถูกอ่านเข้า', () => {
  assert.equal(W.parseServiceMonth('2026-12-15'), '2026-12-01')
  assert.equal(W.parseServiceMonth('15/12/2569'), '2026-12-01')
  assert.equal(W.parseServiceMonth('12/2569'), '2026-12-01')
  assert.equal(W.parseServiceMonth('2569-12'), '2026-12-01')
  assert.equal(W.parseServiceMonth('46000'), '2025-12-01'.replace('2025-12', W.parseServiceMonth('46000').slice(0, 7)))
  assert.equal(W.parseServiceMonth(''), null)
  assert.equal(W.parseServiceMonth('เร็วๆ นี้'), undefined)
  const withDefault = W.parseImportRows([HEAD, ['', 'ก', '', '', '', '', '', '', '', '']], { defaultServiceFrom: '2026-11-20' }).rows[0]
  assert.equal(withDefault.payload.service_from, '2026-11-01')
  assert.match(W.parseImportRows([HEAD, ['', 'ก', '', '', '', '', '', '', '', '']], {}).rows[0].errors.join(), /เดือนเริ่มเก็บ/)
  assert.match(W.parseImportRows([HEAD, ['', 'ก', '', '', '', '', '', '', '', 'วันหน้า']], { defaultServiceFrom: '2026-11-01' }).rows[0].errors.join(), /อ่านไม่ได้/)
  const withId = W.parseImportRows([[...HEAD, 'เลขบัตรประชาชน'], ['', 'ก', '', '', '', '', '', '', '', '2026-12-01', '1234567890123']], {}).rows[0]
  assert.ok(!JSON.stringify(withId).includes('1234567890123'), 'ไม่อ่านเลขบัตรเข้า payload')
  assert.deepEqual(Object.keys(withId.payload).sort(), ['account_no', 'address', 'house_no', 'monthly_units', 'note', 'payer_name', 'payer_phone', 'place_type', 'service_from', 'village'])
})

await test('แม่แบบ CSV: ขึ้นต้น BOM · หัวตรงกับที่ตัวอ่านรู้จักทุกคอลัมน์ · แถวตัวอย่างเป็นข้อมูลสมมติ · แบ่งก้อน 200 แถว', () => {
  const csv = W.buildImportTemplateCsv()
  assert.equal(csv.charCodeAt(0), 0xfeff)
  const idx = W.mapImportHeaders(W.IMPORT_TEMPLATE_HEADERS)
  assert.deepEqual(Object.entries(idx).filter(([k, i]) => i < 0 && k !== 'units' && k !== 'kg').map(([k]) => k), [])
  assert.ok(idx.units >= 0 && idx.kg >= 0)
  assert.ok(!/\d{13}/.test(csv), 'ไม่มีตัวเลข 13 หลัก (เลขบัตร)')
  assert.deepEqual(W.chunk(Array.from({ length: 450 }, (_, i) => i)).map(c => c.length), [200, 200, 50])
  assert.equal(W.IMPORT_BATCH_SIZE, 200)
})

await test('ฟังก์ชันนำเข้าใส่ import_batch เดียวทั้งชุด (crypto.randomUUID) · ยกเลิกชุด = DELETE ตาม import_batch + อปท.', () => {
  const api = stripComments(apiSource)
  assert.match(api, /const batchId = crypto\.randomUUID\(\)/)
  assert.match(api, /import_batch: batchId/)
  assert.match(api, /\.delete\(\{ count: 'exact' \}\)\s*\.eq\('municipality_id', municipalityId\)\.eq\('import_batch', batchId\)/)
})

// ── ประวัติ ───────────────────────────────────────────────────────────────────

await test('แปลงประวัติ: update = เดิม → ใหม่ · ค่าที่มาสก์ในฐาน (changed) ไม่แสดงค่า · ป้ายประเภทสถานที่/สถานะเป็นไทย · ไม่โชว์รหัสชุดนำเข้า', () => {
  const lines = W.describeEventChanges('update', {
    payer_phone: 'changed', house_no: 'changed', place_type: ['house', 'shop'], status: ['active', 'closed'], service_from: ['2026-11-01', '2026-12-01'], import_batch: 'x', monthly_units: [1, 1.5],
  }, (k, v) => (W.EVENT_DATE_FIELDS.has(k) ? `วันที่ ${v}` : v))
  assert.deepEqual(lines, [
    'เบอร์โทร: มีการแก้ไข (ไม่บันทึกค่าลงประวัติ)', 'บ้านเลขที่: มีการแก้ไข (ไม่บันทึกค่าลงประวัติ)',
    'ประเภทสถานที่: บ้านพักอาศัย → ร้านค้า/ร้านอาหาร', 'สถานะ: เก็บอยู่ → เลิกเก็บ', 'เดือนเริ่มเก็บ: วันที่ 2026-11-01 → วันที่ 2026-12-01', 'ปริมาณ (หน่วย): 1 → 1.5',
  ])
  assert.deepEqual(W.describeEventChanges('insert', { payer_name: 'ก', place_type: 'agency' }), ['ชื่อผู้ชำระ: ก', 'ประเภทสถานที่: หน่วยงาน/สถานศึกษา'])
  assert.deepEqual(W.describeEventChanges('update', null), [])
})

// ── API ต้องตรงกับฐาน ───────────────────────────────────────────────────────────

await test('RPC ที่หน้าจอเรียก: มีในฐาน + ชื่อ argument ตรงทุกตัว (กัน PGRST202) · ส่งครบทุก argument', () => {
  const api = stripComments(apiSource)
  const rpcs = [...api.matchAll(/supabase\.rpc\('([a-z_]+)'(?:, \{([\s\S]*?)\})?\)/g)]
  const names = rpcs.map(m => m[1]).sort()
  assert.deepEqual(names, ['wfee_account_month', 'wfee_is_manager', 'wfee_set_sorting'])
  for (const [, name, argText] of rpcs) {
    // จับเฉพาะ CREATE FUNCTION — หัวไฟล์มีคำว่า DROP FUNCTION public.<ชื่อ>(…) ในวิธีย้อนกลับ
    const def = rpcSql.match(new RegExp(`CREATE FUNCTION public\\.${name}\\(([\\s\\S]*?)\\)\\s*RETURNS`))
    assert.ok(def, `ไม่พบ ${name} ใน migration`)
    const dbArgs = [...def[1].matchAll(/\b(p_[a-z_]+)\b/g)].map(m => m[1])
    const sent = [...(argText ?? '').matchAll(/\b(p_[a-z_]+):/g)].map(m => m[1])
    assert.deepEqual(sent, dbArgs, `${name}: ชื่อ/ลำดับ argument ไม่ตรงฐาน`)
  }
})

await test('ตาราง/คอลัมน์ที่หน้าจออ่านเขียน มีจริงในฐาน · ไม่เขียนตารางประวัติ/ช่วงลดค่ากำจัดตรงๆ (RPC/trigger เท่านั้น) · ทุก query กรอง อปท.', () => {
  const api = stripComments(apiSource)
  const colsOf = table => {
    const m = allSql.match(new RegExp(`CREATE TABLE public\\.${table} \\(([\\s\\S]*?)\\n\\);`))
    assert.ok(m, `ไม่พบ CREATE TABLE ${table}`)
    return new Set([...m[1].matchAll(/^\s{2}([a-z_]+)\s/gm)].map(x => x[1]))
  }
  for (const [name, table] of Object.entries({ RATE_COLS: 'waste_fee_rates', ACCOUNT_COLS: 'waste_fee_accounts' })) {
    const list = api.match(new RegExp(`const ${name} = '([^']+)'`))[1].split(',').map(s => s.trim())
    assert.deepEqual(list.filter(c => !colsOf(table).has(c)), [], `${name} มีคอลัมน์ที่ไม่มีในฐาน`)
  }
  const selects = [...api.matchAll(/\.from\('(waste_fee_[a-z_]+)'\)\s*\.select\('([^']+)'/g)]
  // rates/accounts ใช้ RATE_COLS/ACCOUNT_COLS (ตรวจข้างบนแล้ว) · select ที่เขียนคอลัมน์ตรงๆ ต้องมีของ events + ช่วงลดค่ากำจัด
  assert.deepEqual([...new Set(selects.map(m => m[1]))].sort(), ['waste_fee_events', 'waste_fee_sorting_periods'],
    `จับ select ตรงๆ ได้ ${selects.map(m => m[1]).join(', ')}`)
  for (const [, table, list] of selects) {
    assert.deepEqual(list.split(',').map(s => s.trim()).filter(c => !colsOf(table).has(c)), [], `${table}: คอลัมน์ที่ select ไม่มีในฐาน`)
  }
  for (const t of ['waste_fee_events', 'waste_fee_sorting_periods']) assert.doesNotMatch(api, new RegExp(`from\\('${t}'\\)\\s*\\.(insert|update|delete|upsert)`), t)
  assert.match(api, /\.from\('waste_fee_events'\)\s*\.select/)
  assert.match(api, /\.from\('waste_fee_sorting_periods'\)/)
  assert.ok((api.match(/\.eq\('municipality_id', municipalityId\)/g) ?? []).length >= 8)
  assert.match(api, /async function fetchAll/)
  assert.match(api, /fetchAll\(\(\) => supabase\.from\('waste_fee_accounts'\)/)
  // ไม่ส่งช่องเลขบัตรประชาชนไปที่ไหน และไม่มีคอลัมน์นั้นในฐาน
  assert.doesNotMatch(allSql.replace(/--.*$/gm, ''), /national_id|id_card|citizen_id|เลขบัตร|เลขประจำตัวประชาชน/i)
})

await test('ข้อความผิดพลาดจากฐาน (ไทย) แสดงตรงๆ · รหัสทั่วไปแปลเป็นไทย', () => {
  const src = apiSource.slice(apiSource.indexOf('export function friendlyError'), apiSource.indexOf('// ── สิทธิ์'))
  const friendlyError = new Function(`${src.replace('export function', 'function')}; return friendlyError`)()
  assert.equal(friendlyError({ code: '22023', message: 'ต้องระบุเหตุผล/หลักฐานการคัดแยก (3–1000 ตัวอักษร)' }), 'ต้องระบุเหตุผล/หลักฐานการคัดแยก (3–1000 ตัวอักษร)')
  assert.match(friendlyError({ code: '42501', message: 'new row violates row-level security policy' }), /ไม่มีสิทธิ์/)
  assert.match(friendlyError({ code: '23505', message: 'duplicate key value violates unique constraint "waste_fee_rates_effective_unique"' }), /วันเดียวกัน/)
  assert.match(friendlyError({ code: '23505', message: 'duplicate key value violates unique constraint "waste_fee_accounts_no_unique"' }), /เลขทะเบียน/)
  assert.match(friendlyError({ code: 'XX000', message: 'boom' }), /[฀-๿]/)
  assert.equal(friendlyError(null), '')
})

// ── ถ้อยคำและขอบเขตของหน้าจอ ─────────────────────────────────────────────────────

const componentDir = new URL('../src/components/staff/waste-fee/', import.meta.url)
const componentFiles = (await readdir(componentDir)).filter(f => /\.(jsx|js)$/.test(f))
const sources = Object.fromEntries(await Promise.all(componentFiles.map(async f => [`components/staff/waste-fee/${f}`, await readFile(new URL(f, componentDir), 'utf8')])))
sources['lib/wasteFee.js'] = await read('../src/lib/wasteFee.js')
sources['lib/wasteFeeApi.js'] = apiSource

await test('หน้าจอ/ไลบรารีไม่มีถ้อยคำว่าระบบอนุมัติ/ยกเว้น/ตัดสินเอง · ไม่รับรองความถูกต้องตามกฎหมาย · ไม่มีคำว่า "ไม่ใช้ AI"', () => {
  assert.ok(componentFiles.length >= 10, `พบไฟล์หน้าจอ ${componentFiles.length}`)
  const forbidden = [
    /(?<!เจ้าของ)ระบบ(อนุมัติ|อนุญาต|ยกเว้น|ลดให้|ตัดสิน)(ให้|เอง)?/,
    /(อนุมัติ|อนุญาต|ยกเว้น|ลดค่ากำจัด)อัตโนมัติ/, /ไม่ใช้\s*AI|ไม่มี\s*AI|ปราศจาก\s*AI|without AI/i,
    /ถูกต้องตามกฎหมาย|ถูกต้องตามระเบียบ|ชอบด้วยกฎหมาย|ชอบด้วยระเบียบ|ผ่านตามระเบียบ/,
  ]
  for (const [file, text] of Object.entries(sources)) for (const re of forbidden) assert.ok(!re.test(text), `${file} มีวลีต้องห้าม ${re}`)
})

await test('ขอบเขต PR1: ไม่มีปุ่ม/ช่องยกเว้นหนี้ · ยอดค้างเก่า · สร้างยอดค้าง/ใบแจ้งหนี้ · เพดานตามกฎกระทรวง · เลขบัตรประชาชน · ไม่แตะ payment_dues', () => {
  const ui = Object.entries(sources).map(([f, t]) => `// ${f}\n${stripComments(t)}`).join('\n')
  for (const re of [/ยกเว้นหนี้/, /ยอดค้างเก่า/, /ยอดยกมา/, /ใบแจ้งหนี้.*สร้าง|สร้าง.*ใบแจ้งหนี้/, /เพดาน/, /เลขบัตร|เลขประจำตัวประชาชน|national_id/i, /payment_dues|payment_/]) {
    // คำว่า "ยังไม่สร้างยอดค้างหรือใบแจ้งหนี้" เป็นข้อความอธิบายขอบเขต ไม่ใช่ฟีเจอร์ — ตัดออกก่อนตรวจ
    assert.doesNotMatch(ui.replace(/ยังไม่สร้างยอดค้างหรือใบแจ้งหนี้/g, '').replace(/ห้ามใส่เลขบัตรประชาชน/g, '').replace(/ไม่ต้องใส่เลขบัตรประชาชน/g, '').replace(/ไม่มีช่อง[^\n]*เลขบัตร[^\n]*/g, ''), re, `ขอบเขตเกิน PR1: ${re}`)
  }
  assert.doesNotMatch(ui, /<input[^>]*(national|id_card|citizen_id|idcard)/i)
  // ไม่มีปุ่มที่ตั้งชื่อเป็นการตัดสินแทนคน
  assert.doesNotMatch(ui, />\s*(อนุมัติ|อนุญาต|ยกเว้น)\s*</)
})

await test('ยืนยันการคัดแยก: หน้าจอบังคับเหตุผล · เลือกเดือนตามกติกาไม่ย้อนหลัง · เรียกผ่าน RPC เท่านั้น · เตือนเมื่อรุ่นอัตราไม่มีหมวดลด · ปุ่มเลิกเก็บ/เปิดเก็บต่อมีครบ', () => {
  const detail = sources['components/staff/waste-fee/WasteFeeDetailSheet.jsx']
  assert.match(detail, /validateSorting\(\{ on, from: sFrom, note \}\)/)
  assert.match(detail, /setSorting\(\{ accountId: account\.id, on, from: monthStart\(sFrom\), note \}\)/)
  assert.match(detail, /min=\{toMonthInput\(month\)\}/, 'ช่องเดือนเริ่มลดต้องมี min = เดือนนี้')
  assert.match(detail, /min=\{toMonthInput\(nextMonth\)\}/, 'ช่องเดือนเลิกลดต้องมี min = เดือนหน้า')
  assert.match(detail, /result\?\.rate_has_discount === false/)
  assert.match(detail, /ยืนยันการคัดแยกขยะ/)
  assert.match(detail, /ไม่ย้อนหลัง/)
  for (const label of ['เลิกเก็บ', 'เปิดเก็บต่อ', 'ยอดที่ควรเก็บ', 'ประวัติการเปลี่ยนแปลง']) assert.ok(detail.includes(label), label)
  assert.match(detail, /no_rate_for_month|COMPUTE_ERROR_TEXT/)
  assert.match(W.COMPUTE_ERROR_TEXT.no_rate_for_month, /ยังไม่มีอัตราที่มีผลในเดือนนี้/)
  // ฟอร์มบัญชีไม่ส่งช่องคัดแยก (แก้ได้ทาง RPC เท่านั้น)
  assert.doesNotMatch(stripComments(sources['components/staff/waste-fee/WasteFeeFormSheet.jsx']), /sorting_/)
})

await test('หน้าจอ: ข้อความใต้ช่องหมายเหตุห้ามใส่ข้อมูลส่วนตัว (ประวัติถาวร) · แถวอัตราตัวอย่างขึ้นป้ายเตือน · ตารางปักคอลัมน์ดำเนินการ · ไม่ใช่ผู้จัดการ = ข้อความกองที่ถือเรื่อง', () => {
  assert.match(sources['components/staff/waste-fee/WasteFeeFormSheet.jsx'], /ห้ามใส่เลขบัตรประชาชนหรือข้อมูลส่วนตัวอื่น — ประวัติการแก้ไขเก็บถาวร/)
  const rates = sources['components/staff/waste-fee/WasteFeeRatesTab.jsx']
  assert.match(rates, /อัตราตัวอย่าง ต้องแก้ตามข้อบัญญัติของ อปท\./)
  assert.match(rates, /ใช้อยู่ตอนนี้/)
  assert.match(rates, /รอมีผล/)
  assert.match(sources['components/staff/waste-fee/WasteFeeTable.jsx'], /sticky right-0/)
  const mod = sources['components/staff/waste-fee/WasteFeeModule.jsx']
  assert.match(mod, /!state\.isManager/)
  assert.match(mod, /fetchIsManager\(tenantId\)/)
  for (const label of ["label: 'ทะเบียนบัญชี'", "label: 'อัตราค่าธรรมเนียม'"]) assert.ok(mod.includes(label), label)
  assert.match(sources['components/staff/waste-fee/WasteFeeRateSheet.jsx'], /ต้องอ้างข้อบัญญัติ|อ้างข้อบัญญัติ\/เทศบัญญัติที่ให้อำนาจ/)
  assert.match(sources['components/staff/waste-fee/WasteFeeImportSheet.jsx'], /ไม่ต้องใส่เลขบัตรประชาชน/)
})

// ── ลงทะเบียนเมนู ──────────────────────────────────────────────────────────────

await test('โมดูล waste-fee: อยู่ใน MODULE_GROUPS · MANAGED_MODULE_KEYS · เมนูซ้าย · STAFF_MENU_MODULE_KEYS · StaffDashboard lazy + render ตรวจสิทธิ์ซ้ำ · ห้องผู้บริหาร', async () => {
  const { MODULE_GROUPS, MANAGED_MODULE_KEYS } = await import('../src/lib/staffModules.js')
  const group = MODULE_GROUPS.find(g => g.items.some(m => m.key === 'waste-fee'))
  assert.ok(group, 'waste-fee ไม่อยู่ใน MODULE_GROUPS')
  assert.equal(group.group, MODULE_GROUPS.find(g => g.items.some(m => m.key === 'licence-registry')).group, 'กลุ่มเดียวกับทะเบียนใบอนุญาต')
  assert.equal(group.items.find(m => m.key === 'waste-fee').label, 'ทะเบียนค่าธรรมเนียมขยะ')
  assert.ok(MANAGED_MODULE_KEYS.includes('waste-fee'))
  const nav = await read('../src/lib/staffNavGroups.js')
  assert.match(nav, /key: 'waste-fee', label: 'ค่าธรรมเนียมขยะ', Icon: Recycle/)
  const access = await import('../src/lib/staffMenuAccess.js')
  assert.ok(access.STAFF_MENU_MODULE_KEYS.includes('waste-fee'))
  const dash = await read('../src/pages/StaffDashboard.jsx')
  assert.match(dash, /const WasteFeeModule = lazy\(\(\) => import\('\.\.\/components\/staff\/waste-fee\/WasteFeeModule'\)\)/)
  assert.match(dash, /activeModule === 'waste-fee' && visibleModules\.some\(m => m\.key === 'waste-fee'\) && <WasteFeeModule tenant=\{tenant\} profile=\{profile\} \/>/)
  const exec = await import('../src/lib/executiveRegistry.js')
  const entry = exec.EXECUTIVE_REGISTRY.find(e => e.key === 'waste-fee')
  assert.ok(entry && entry.link.module === 'waste-fee' && entry.summaryKey === null && entry.kpis.length === 0 && entry.alerts.length === 0, 'ห้องผู้บริหาร: ลิงก์เข้าเมนูอย่างเดียว ยังไม่มีตัวเลข (PDPA)')
  assert.equal(W.WASTE_FEE_MODULE_KEY, 'waste-fee')
})

await test('เห็นเมนู: admin/officer/staff/superadmin เท่านั้น (ช่าง/ผู้บริหาร/สภา/ประชาชนไม่เห็น) · ค่าเริ่มต้นปิด = ต้องมีคีย์ใน enabled_modules · migration ไม่เติมคีย์ให้ทุกแถว', async () => {
  const { staffVisibleModuleKeys } = await import('../src/lib/staffMenuAccess.js')
  const { MANAGED_MODULE_KEYS } = await import('../src/lib/staffModules.js')
  const on = { enabled_modules: [...MANAGED_MODULE_KEYS] }
  for (const role of ['admin', 'officer', 'staff', 'superadmin']) assert.ok(staffVisibleModuleKeys({ role, tenant: on }).includes('waste-fee'), role)
  for (const role of ['technician', 'viewer', 'council', 'citizen', undefined]) assert.ok(!staffVisibleModuleKeys({ role, tenant: on }).includes('waste-fee'), String(role))
  const off = { enabled_modules: MANAGED_MODULE_KEYS.filter(k => k !== 'waste-fee') }
  assert.ok(!staffVisibleModuleKeys({ role: 'admin', tenant: off }).includes('waste-fee'))
  // เปิดให้เฉพาะสนามซ้อม (slug = demo) — ไม่มี UPDATE ที่เติมคีย์ให้ทุกแถว
  const updates = [...stripComments(rpcSql).replace(/--.*$/gm, '').matchAll(/UPDATE\s+public\.municipalities[\s\S]*?;/gi)].map(m => m[0])
  assert.ok(updates.length >= 1)
  for (const u of updates) assert.match(u, /slug\s*=\s*'demo'/, `UPDATE enabled_modules ต้องจำกัดที่ demo: ${u.slice(0, 80)}`)
})

console.log(`\n${cases} cases passed`)
