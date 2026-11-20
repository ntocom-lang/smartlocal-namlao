// ทะเบียนค่าธรรมเนียมขยะ (ขั้น 1B PR1) — ฟังก์ชันล้วน (ไม่ import supabase/React เทสต์ด้วย node ได้)
// ฐานข้อมูล: supabase/migrations/20261222100000_waste_fee_tables.sql + 20261222100100_waste_fee_rls_rpc.sql
// หน้าจอ: components/staff/waste-fee/* · ชั้นเรียกฐาน: wasteFeeApi.js
//
// หลักของโมดูลนี้ (ลอกโครงจาก licenceRegistry.js):
//   - ระบบ "คำนวณ/ตรวจ/จัดรูป/เตรียมให้" เจ้าหน้าที่ตรวจแล้วกดยืนยัน ไม่ตัดสินแทนคน
//   - ลดค่ากำจัดกึ่งหนึ่งเมื่อคัดแยก = ประโยชน์ของประชาชน ⇒ เจ้าหน้าที่ยืนยันรายบัญชีเท่านั้น (RPC wfee_set_sorting → ตาราง waste_fee_sorting_periods) ไม่ย้อนหลัง
//   - computeMonthly ต้องให้ผลเหมือน wfee_compute() ทุกกรณี (เทสต์ parity กับฐานใน tests/waste-fee-db.test.mjs) — คิดเป็นเศษสตางค์จำนวนเต็ม ไม่ใช้ทศนิยมลอยตัว
//   - ไม่มีช่อง/คอลัมน์เลขบัตรประชาชน (PDPA เก็บเท่าที่จำเป็น)
import { findHeaderRow } from './tabularImport.js'
import { normalizeHeader } from './spreadsheetRead.js'
import { analyzeContactNumber } from './contactImport.js'
import { addMonths, isIsoDate, parseImportDate, todayBangkok } from './licenceRegistry.js'

export const WASTE_FEE_MODULE_KEY = 'waste-fee'
export { todayBangkok }

// ── ประเภทสถานที่ (ตรงกับ src/pages/WasteCollectionRequestWizard.jsx และ CHECK ของ waste_fee_accounts.place_type) ──
export const PLACE_TYPES = Object.freeze([
  { value: 'house', label: 'บ้านพักอาศัย' },
  { value: 'shop', label: 'ร้านค้า/ร้านอาหาร' },
  { value: 'business', label: 'สถานประกอบการ/โรงงาน' },
  { value: 'agency', label: 'หน่วยงาน/สถานศึกษา' },
  { value: 'other', label: 'อื่นๆ' },
])
export const PLACE_TYPE_LABEL = Object.freeze(Object.fromEntries(PLACE_TYPES.map((p) => [p.value, p.label])))
export const placeTypeLabel = (value) => PLACE_TYPE_LABEL[value] ?? 'ไม่ระบุ'

// คำที่ผู้ใช้พิมพ์ในไฟล์ Excel → ประเภทสถานที่ (เทียบหลัง normalizeHeader: ตัดช่องว่าง/ขีด/วงเล็บ/จุด/ตัวพิมพ์)
const PLACE_ALIASES = {
  house: ['บ้านพักอาศัย', 'บ้าน', 'บ้านเรือน', 'ที่พักอาศัย', 'อาคารพักอาศัย', 'house'],
  shop: ['ร้านค้า/ร้านอาหาร', 'ร้านค้า', 'ร้านอาหาร', 'ร้าน', 'ตลาด', 'shop'],
  business: ['สถานประกอบการ/โรงงาน', 'สถานประกอบการ', 'โรงงาน', 'ประกอบการ', 'business'],
  agency: ['หน่วยงาน/สถานศึกษา', 'หน่วยงาน', 'สถานศึกษา', 'โรงเรียน', 'วัด', 'agency'],
  other: ['อื่นๆ', 'อื่น ๆ', 'อื่น', 'other'],
}
const PLACE_LOOKUP = new Map()
for (const [key, names] of Object.entries(PLACE_ALIASES)) for (const n of names) PLACE_LOOKUP.set(normalizeHeader(n), key)
/** ข้อความที่ผู้ใช้พิมพ์ → คีย์ประเภทสถานที่ · ไม่รู้จัก = null · ว่าง = null (ผู้เรียกตัดสินค่าเริ่มต้นเอง) */
export const matchPlaceType = (raw) => PLACE_LOOKUP.get(normalizeHeader(raw)) ?? null

// ── ปริมาณ (หน่วยละ 120 กก. · ข้อ ๑๐ ปัดเศษทีละกึ่งหน่วย) ───────────────────────────────────
export const UNIT_KG = 120
export const MAX_UNITS = 10000
export const SORTING_ADVANCE_MAX_MONTHS = 12

/** ปริมาณเป็นหน่วยต้องเป็นบวก ทีละ 0.5 และไม่เกิน 10,000 (ตรงกับ CHECK monthly_units) */
export function isValidUnits(units) {
  const n = Number(units)
  return Number.isFinite(n) && n > 0 && n <= MAX_UNITS && Number.isInteger(n * 2)
}

/**
 * กิโลกรัมต่อเดือน → จำนวนหน่วย (ตัวช่วยกรอก): ≤ 120 กก. = 1 หน่วย · เกินแล้วนับหน่วยละ 120 กก.
 * เศษที่เหลือไม่เกินกึ่งหน่วย (≤ 60 กก.) = 0.5 · เกินกึ่งหน่วย = 1 (ข้อ ๑๐ — ต้องยืนยันกับเทศบัญญัติของ อปท. นั้น)
 * คิดเป็นจำนวนเต็มหน่วยร้อยละกก. กันทศนิยมลอยตัว · ค่าที่ไม่ใช่ตัวเลขบวก / เกิน MAX_UNITS = null
 */
export function kgToUnits(kgPerMonth) {
  const kg = Number(typeof kgPerMonth === 'string' ? kgPerMonth.replace(/,/g, '').trim() : kgPerMonth)
  if (!Number.isFinite(kg) || kg <= 0) return null
  const hundredths = Math.round(kg * 100)
  const unit = UNIT_KG * 100
  if (hundredths <= unit) return 1
  const whole = Math.floor(hundredths / unit)
  const rest = hundredths - whole * unit
  const units = rest === 0 ? whole : rest <= unit / 2 ? whole + 0.5 : whole + 1
  return units > MAX_UNITS ? null : units
}

/** แสดงจำนวนหน่วย: 1 → "1", 1.5 → "1.5" */
export const fmtUnits = (units) => (Number.isFinite(Number(units)) ? String(Number(units)) : '—')

// ── เดือน/รุ่นอัตรา ──────────────────────────────────────────────────────────────────

/** ปัดวันที่เป็นวันที่ 1 ของเดือน (ISO) · รับ yyyy-mm-dd หรือ yyyy-mm · ผิดรูป = null */
export function monthStart(value) {
  const s = String(value ?? '').trim()
  if (/^\d{4}-\d{2}$/.test(s)) return isIsoDate(`${s}-01`) ? `${s}-01` : null
  if (!isIsoDate(s)) return null
  return `${s.slice(0, 7)}-01`
}

/** เดือนปัจจุบันตามเวลาไทย (วันที่ 1) */
export const currentMonthStart = (now = new Date()) => monthStart(todayBangkok(now))

/** เดือนแรกที่รุ่นอัตราเริ่มถูกใช้: มีผลวันที่ 1 = เดือนนั้น · มีผลกลางเดือน = เดือนถัดไป (ไม่คิดตามสัดส่วนวัน) */
export function firstMonthUsing(effectiveFrom) {
  const s = String(effectiveFrom ?? '').slice(0, 10)
  if (!isIsoDate(s)) return null
  return s.endsWith('-01') ? s : addMonths(`${s.slice(0, 7)}-01`, 1)
}

/** รุ่นอัตราที่ใช้กับเดือน month = effective_from ล่าสุดที่ ≤ วันที่ 1 ของเดือนนั้น (สมมติฐาน: ไม่คิดตามสัดส่วนวัน — ตรงกับ wfee_account_month) */
export function pickRateForMonth(rates, month) {
  const start = monthStart(month)
  if (!start) return null
  let best = null
  for (const r of rates ?? []) {
    if (!r?.effective_from || String(r.effective_from).slice(0, 10) > start) continue
    if (!best || String(r.effective_from) > String(best.effective_from)) best = r
  }
  return best
}

/** ป้ายสถานะของรุ่นอัตราเทียบกับวันนี้: 'current' = ใช้อยู่ตอนนี้ · 'pending' = รอมีผล · 'past' = ถูกแทนแล้ว */
export function rateState(rate, rates, now = new Date()) {
  const month = currentMonthStart(now)
  const current = pickRateForMonth(rates, month)
  if (current && current.id === rate.id) return 'current'
  return String(rate.effective_from).slice(0, 10) > month ? 'pending' : 'past'
}

// ── คำนวณยอดรายเดือน (ต้องเหมือน wfee_compute ทุกกรณี) ───────────────────────────────────

const toCents = (v) => Math.round(Number(v) * 100)
const centsToBaht = (c) => c / 100

/**
 * ยอดรายเดือนของอัตรา rate สำหรับปริมาณ units หน่วย (120 กก.) ตามโครงกฎกระทรวง ๒๕๖๗ — โครงเดียวกับ wfee_compute()
 *   basis = place_type: เหมาตามประเภทสถานที่ (place_type_rates[placeType]) ไม่มีส่วนลด
 *   basis = units: ≤ 1 หน่วย = อัตราเหมา (แม้ใช้แค่กึ่งหน่วย) · หน่วยที่ 1–30 ส่วนเกิน = unit_* · ส่วนเกิน 30 หน่วย = big_unit_*
 *                  sorting && rate.sorting_discount ⇒ ค่ากำจัดกึ่งหนึ่ง (ปัด 2 ตำแหน่ง)
 * @returns {{ ok: true, basis, collect, dispose, discount, total, ... } | { ok: false, error: string }}
 */
export function computeMonthly(rate, units, placeType, sorting) {
  if (!rate) return { ok: false, error: 'rate_not_found' }
  const u = Number(units)
  if (units === null || units === undefined || units === '' || !Number.isFinite(u) || u <= 0 || !Number.isInteger(u * 2)) {
    return { ok: false, error: 'bad_units' }
  }
  const meta = { basis: rate.basis, rate_id: rate.id, effective_from: rate.effective_from, ordinance_ref: rate.ordinance_ref, is_example: Boolean(rate.is_example) }

  if (rate.basis === 'place_type') {
    const rates = rate.place_type_rates && typeof rate.place_type_rates === 'object' ? rate.place_type_rates : {}
    if (!Object.prototype.hasOwnProperty.call(rates, placeType ?? '')) return { ok: false, error: 'no_rate_for_place_type', place_type: placeType ?? null }
    const amount = centsToBaht(toCents(rates[placeType])) // ฐานปัด 2 ตำแหน่ง (round(…, 2))
    return { ok: true, ...meta, place_type: placeType, sorting_applied: false, collect: amount, dispose: 0, discount: 0, total: amount }
  }

  // ทุกอย่างคิดเป็น "ครึ่งสตางค์" จำนวนเต็ม: ปริมาณทีละ 0.5 หน่วย × อัตราเป็นสตางค์ = ครึ่งสตางค์พอดี
  const t2h = Math.max(Math.min(u, 30) - 1, 0) * 2 // หน่วยส่วนเกิน 1–30 (นับเป็นครึ่งหน่วย)
  const t3h = Math.max(u - 30, 0) * 2 // หน่วยส่วนเกิน 30
  if (t2h > 0 && (rate.unit_collect === null || rate.unit_collect === undefined)) return { ok: false, error: 'no_unit_rate' }
  if (t3h > 0 && (rate.big_unit_collect === null || rate.big_unit_collect === undefined)) return { ok: false, error: 'no_big_unit_rate' }
  const c = (v) => (v === null || v === undefined ? 0 : toCents(v))
  const colHalf = toCents(rate.base_collect) * 2 + t2h * c(rate.unit_collect) + t3h * c(rate.big_unit_collect)
  const disHalf = toCents(rate.base_dispose) * 2 + t2h * c(rate.unit_dispose) + t3h * c(rate.big_unit_dispose)
  // round(x, 2) ของ Postgres = ปัดครึ่งขึ้น: ครึ่งสตางค์ → สตางค์ floor((h+1)/2)
  const toRounded = (h) => Math.floor((h + 1) / 2)
  // ลำดับเดียวกับ wfee_compute: ปัดค่าเก็บขน/ค่ากำจัดก่อน → ส่วนลด = round(ค่ากำจัดที่ปัดแล้ว / 2, 2)
  // → ยอดรวม = ผลบวกของรายการที่ปัดแล้ว (รายการย่อยบวกได้เท่ายอดรวมเสมอ — ผลตรวจ migration รอบ 1 ข้อ B5)
  const collectCents = toRounded(colHalf)
  const disposeCents = toRounded(disHalf)
  const discountCents = sorting && rate.sorting_discount ? Math.floor((disposeCents + 1) / 2) : 0
  return {
    ok: true, ...meta, units: u,
    tier2_units: t2h / 2, tier3_units: t3h / 2,
    sorting_applied: discountCents > 0,
    collect: centsToBaht(collectCents), dispose: centsToBaht(disposeCents), discount: centsToBaht(discountCents),
    total: centsToBaht(collectCents + disposeCents - discountCents),
  }
}

/** ตารางตัวอย่างยอดบนหน้าอัตรา: 1, 1.5, 5, 31 หน่วย (± คัดแยกเมื่อรุ่นอัตรามีหมวดลด) */
export const SAMPLE_UNITS = Object.freeze([1, 1.5, 5, 31])
export function sampleRows(rate, placeType = 'house') {
  if (!rate) return []
  if (rate.basis === 'place_type') {
    return Object.keys(rate.place_type_rates ?? {}).map((k) => ({ key: k, label: placeTypeLabel(k), plain: computeMonthly(rate, 1, k, false), sorted: null }))
  }
  return SAMPLE_UNITS.map((u) => ({
    key: String(u), label: `${fmtUnits(u)} หน่วย${u === 1 ? ' (ไม่เกิน 120 กก.)' : ''}`,
    plain: computeMonthly(rate, u, placeType, false),
    sorted: rate.sorting_discount ? computeMonthly(rate, u, placeType, true) : null,
  }))
}

/** ข้อความอธิบายผลคำนวณที่ผิดพลาด (ตรงกับ error ของ wfee_compute / wfee_account_month) */
export const COMPUTE_ERROR_TEXT = Object.freeze({
  rate_not_found: 'ไม่พบรุ่นอัตรา',
  bad_units: 'ปริมาณไม่ถูกต้อง (ต้องเป็นบวก ทีละครึ่งหน่วย)',
  no_rate_for_place_type: 'อัตรารุ่นนี้ไม่มีอัตราของประเภทสถานที่นี้',
  no_unit_rate: 'อัตรารุ่นนี้ไม่ได้ตั้งอัตราหน่วยส่วนเกิน แต่บัญชีมีปริมาณเกิน 1 หน่วย',
  no_big_unit_rate: 'อัตรารุ่นนี้ไม่ได้ตั้งอัตราส่วนเกิน 30 หน่วย แต่บัญชีมีปริมาณเกิน 30 หน่วย',
  no_rate_for_month: 'ยังไม่มีอัตราที่มีผลในเดือนนี้ — ตั้งที่แท็บ "อัตราค่าธรรมเนียม"',
  bad_month: 'เดือนไม่ถูกต้อง',
  account_not_found: 'ไม่พบบัญชี',
})
export const NOT_BILLABLE_TEXT = Object.freeze({
  before_service: 'ยังไม่ถึงเดือนเริ่มเก็บ',
  closed: 'เลิกเก็บแล้ว',
})

// ── ฟอร์ม ─────────────────────────────────────────────────────────────────────────────

const ACCOUNT_STATUS_LABEL = Object.freeze({ active: 'เก็บอยู่', closed: 'เลิกเก็บ' })
export const accountStatusLabel = (s) => ACCOUNT_STATUS_LABEL[s] ?? s

/** หมู่ที่พิมพ์เป็นตัวเลขล้วน (1 / ๑) → "หมู่ 1" ให้ตัวกรองไม่แตกเป็นสองกลุ่ม · อย่างอื่นคงตามที่พิมพ์ */
export function normalizeVillage(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  const ascii = s.replace(/[๐-๙]/g, (d) => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(d)))
  return /^\d{1,3}$/.test(ascii) ? `หมู่ ${Number(ascii)}` : s
}

const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v))
const textOrNull = (v) => (String(v ?? '').trim() || null)

/** ตรวจฟอร์มบัญชี (ข้อความไทยตัวแรกที่ผิด · ว่าง = ผ่าน) — ตรงกับ CHECK ของ waste_fee_accounts */
export function validateAccountForm(f) {
  if (!String(f.payer_name ?? '').trim()) return 'ต้องกรอกชื่อผู้ชำระ'
  if (String(f.payer_name).trim().length > 200) return 'ชื่อผู้ชำระยาวเกิน 200 ตัวอักษร'
  const no = String(f.account_no ?? '').trim()
  if (no.length > 40) return 'เลขทะเบียนยาวเกิน 40 ตัวอักษร'
  const phone = String(f.payer_phone ?? '').trim()
  if (phone && !/^[0-9+\- ]{6,20}$/.test(phone)) return 'เบอร์โทรไม่ถูกต้อง (ตัวเลข 6–20 หลัก ใช้ขีดหรือ + ได้)'
  if (!PLACE_TYPE_LABEL[f.place_type]) return 'ต้องเลือกประเภทสถานที่'
  const units = Number(f.monthly_units)
  if (!isValidUnits(units)) return 'ปริมาณต้องเป็นตัวเลขบวก ทีละครึ่งหน่วย (เช่น 1, 1.5, 2) ไม่เกิน 10,000 หน่วย'
  if (!monthStart(f.service_from)) return 'ต้องระบุเดือนแรกที่เก็บค่าธรรมเนียม'
  return ''
}

/** ฟอร์มบัญชี → แถวสำหรับ insert/update (ไม่ใส่ช่องคัดแยก/ปิดบัญชี — แก้ได้เฉพาะทาง RPC / แผ่นเลิกเก็บ) */
export function accountPayload(f) {
  return {
    account_no: textOrNull(f.account_no),
    payer_name: String(f.payer_name).trim(),
    payer_phone: textOrNull(f.payer_phone),
    house_no: textOrNull(f.house_no),
    village: textOrNull(normalizeVillage(f.village)),
    address: textOrNull(f.address),
    place_type: f.place_type,
    monthly_units: Number(f.monthly_units),
    service_from: monthStart(f.service_from),
    note: textOrNull(f.note),
  }
}

/** ตรวจแผ่นเลิกเก็บ: เดือนแรกที่ไม่เก็บต้องหลังเดือนเริ่มเก็บ (CHECK closed_from > service_from) + เหตุผลบังคับ */
export function validateClose({ closedFrom, reason, serviceFrom }) {
  const from = monthStart(closedFrom)
  if (!from) return 'ต้องระบุเดือนแรกที่ไม่เก็บแล้ว'
  if (serviceFrom && from <= monthStart(serviceFrom)) return 'เดือนที่เลิกเก็บต้องหลังเดือนที่เริ่มเก็บ'
  if (String(reason ?? '').trim().length < 3) return 'ต้องระบุเหตุผลที่เลิกเก็บ (อย่างน้อย 3 ตัวอักษร)'
  if (String(reason).trim().length > 1000) return 'เหตุผลยาวเกิน 1,000 ตัวอักษร'
  return ''
}

/**
 * ตรวจแผ่นยืนยันการคัดแยก (ตรงกับ wfee_set_sorting) — เหตุผล 3–1000 ตัวอักษรทั้งสองทาง
 *   เปิดลด: เดือนเริ่ม ≥ เดือนปัจจุบัน (ไม่ย้อนหลัง) ≤ +12 เดือน
 *   เลิกลด: เดือนแรกที่ไม่ลด ≥ เดือนถัดไป (เดือนนี้ยังได้ลด ไม่ตัดย้อน) ≤ +12 เดือน
 */
export function validateSorting({ on, from, note, now = new Date() }) {
  const text = String(note ?? '').trim()
  if (text.length < 3 || text.length > 1000) return 'ต้องระบุเหตุผล/หลักฐานการคัดแยก (3–1000 ตัวอักษร)'
  const start = monthStart(from)
  const current = currentMonthStart(now)
  if (!start) return on ? 'ต้องระบุเดือนที่เริ่มได้รับการลด' : 'ต้องระบุเดือนแรกที่ไม่ลดแล้ว'
  if (on && start < current) return 'เริ่มลดได้ตั้งแต่เดือนปัจจุบันเป็นต้นไป (ไม่ย้อนหลัง)'
  if (!on && start <= current) return 'เลิกลดได้ตั้งแต่เดือนถัดไปเป็นต้นไป (เดือนนี้ยังได้ลด ไม่ตัดย้อนหลัง)'
  if (start > addMonths(current, SORTING_ADVANCE_MAX_MONTHS)) return `ตั้งล่วงหน้าได้ไม่เกิน ${SORTING_ADVANCE_MAX_MONTHS} เดือน`
  return ''
}

/** ตรวจฟอร์มรุ่นอัตรา — ตรงกับ CHECK waste_fee_rates_units_shape / place_shape */
export function validateRateForm(f) {
  if (!isIsoDate(String(f.effective_from ?? ''))) return 'ต้องระบุวันที่เริ่มมีผล'
  const ref = String(f.ordinance_ref ?? '').trim()
  if (ref.length < 3) return 'ต้องอ้างข้อบัญญัติ/เทศบัญญัติที่ให้อำนาจ (ชื่อ + ปี + ข้อ) — ย้อนตรวจได้ว่ายอดมาจากไหน'
  if (ref.length > 300) return 'ข้อความอ้างข้อบัญญัติยาวเกิน 300 ตัวอักษร'
  const money = (v) => v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100000
  if (f.basis === 'place_type') {
    const filled = PLACE_TYPES.filter((p) => String(f.place_rates?.[p.value] ?? '').trim() !== '')
    if (filled.length === 0) return 'ต้องกรอกอัตราอย่างน้อย 1 ประเภทสถานที่'
    for (const p of filled) if (!money(f.place_rates[p.value])) return `อัตราของ "${p.label}" ต้องเป็นตัวเลข 0–100,000 บาท`
    return ''
  }
  if (f.basis !== 'units') return 'ต้องเลือกวิธีคิดอัตรา'
  if (!money(f.base_collect) || !money(f.base_dispose)) return 'ต้องกรอกอัตราเหมา (ไม่เกิน 120 กก.) ทั้งค่าเก็บขนและค่ากำจัด เป็นตัวเลข 0–100,000 บาท'
  const has = (k) => String(f[k] ?? '').trim() !== ''
  if (has('unit_collect') !== has('unit_dispose')) return 'อัตราส่วนเกิน 120–3,600 กก. ต้องกรอกทั้งค่าเก็บขนและค่ากำจัด (หรือเว้นว่างทั้งคู่)'
  if (has('big_unit_collect') !== has('big_unit_dispose')) return 'อัตราส่วนเกิน 3,600 กก. ต้องกรอกทั้งค่าเก็บขนและค่ากำจัด (หรือเว้นว่างทั้งคู่)'
  if (has('big_unit_collect') && !has('unit_collect')) return 'ถ้ามีอัตราส่วนเกิน 3,600 กก. ต้องมีอัตราส่วนเกิน 120–3,600 กก. ด้วย'
  for (const k of ['unit_collect', 'unit_dispose', 'big_unit_collect', 'big_unit_dispose']) if (has(k) && !money(f[k])) return 'อัตราต้องเป็นตัวเลข 0–100,000 บาท'
  return ''
}

/** ฟอร์มรุ่นอัตรา → แถวสำหรับ insert/update ของ waste_fee_rates (ช่องที่ไม่ใช้ตามวิธีคิดส่งเป็น null ให้ผ่าน CHECK) */
export function ratePayload(f) {
  const base = {
    effective_from: f.effective_from, // วันที่จริงตามข้อบัญญัติ — ไม่ปัดเป็นวันที่ 1 (รุ่นอัตราเลือกด้วย effective_from ≤ วันที่ 1 ของเดือน)
    ordinance_ref: String(f.ordinance_ref).trim(),
    basis: f.basis,
    note: textOrNull(f.note),
  }
  if (f.basis === 'place_type') {
    const rates = {}
    for (const p of PLACE_TYPES) if (String(f.place_rates?.[p.value] ?? '').trim() !== '') rates[p.value] = Number(f.place_rates[p.value])
    return { ...base, base_collect: null, base_dispose: null, unit_collect: null, unit_dispose: null, big_unit_collect: null, big_unit_dispose: null,
      place_type_rates: rates, sorting_discount: false }
  }
  return {
    ...base,
    base_collect: numOrNull(f.base_collect), base_dispose: numOrNull(f.base_dispose),
    unit_collect: numOrNull(f.unit_collect), unit_dispose: numOrNull(f.unit_dispose),
    big_unit_collect: numOrNull(f.big_unit_collect), big_unit_dispose: numOrNull(f.big_unit_dispose),
    place_type_rates: null, sorting_discount: Boolean(f.sorting_discount),
  }
}

// ── ค้นหา/กรอง ────────────────────────────────────────────────────────────────────────

/** ข้อความค้นหารวมช่องที่เจ้าหน้าที่ใช้หาบัญชี */
export function searchText(account) {
  return [account.payer_name, account.account_no, account.house_no, account.village, account.address, account.payer_phone, placeTypeLabel(account.place_type)]
    .filter(Boolean).join(' ').toLocaleLowerCase('th-TH')
}

/** สถานะบัญชีเทียบกับเดือนที่กำหนด: 'pending' = ยังไม่ถึงเดือนเริ่มเก็บ · 'closed' = เลิกเก็บแล้ว (ถึงเดือนเลิกแล้ว) · 'active' = เก็บอยู่ */
export function accountPhase(account, month) {
  const m = monthStart(month)
  if (account.status === 'closed' && account.closed_from && m && String(account.closed_from).slice(0, 10) <= m) return 'closed'
  if (m && String(account.service_from).slice(0, 10) > m) return 'pending'
  return 'active'
}

export const PHASE_FILTERS = Object.freeze([
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'active', label: 'เก็บอยู่', color: '#16a34a' },
  { id: 'pending', label: 'รอเริ่มเก็บ', color: '#d97706' },
  { id: 'closed', label: 'เลิกเก็บ', color: '#64748b' },
])

// ── ช่วงที่ได้ลดค่ากำจัด (waste_fee_sorting_periods) ─────────────────────────────────────
// starts_on = เดือนแรกที่ได้ลด · ends_on = เดือนแรกที่ "ไม่ลดแล้ว" (NULL = ยังลดอยู่) · เขียนผ่าน RPC wfee_set_sorting เท่านั้น

/** ช่วง period ครอบคลุมเดือน month ไหม (starts_on ≤ month และ month < ends_on หรือยังไม่มีกำหนดเลิก) */
export function periodCovers(period, month) {
  const m = monthStart(month)
  if (!period || !m) return false
  const from = String(period.starts_on).slice(0, 10)
  const to = period.ends_on ? String(period.ends_on).slice(0, 10) : null
  return from <= m && (to === null || m < to)
}

/** ได้ลดค่ากำจัดในเดือน month ไหม (จากช่วงของบัญชีนั้น) */
export const hasSortingIn = (periods, month) => (periods ?? []).some((p) => periodCovers(p, month))

/** ช่วงที่ยังมีผลหรือรอเริ่ม ณ เดือน month (ยังไม่ถูกปิดไปแล้ว) = ends_on ว่าง หรือ ends_on > month · ไม่มี = null */
export function livePeriod(periods, month) {
  const m = monthStart(month)
  return (periods ?? []).filter((p) => !p.ends_on || String(p.ends_on).slice(0, 10) > m)
    .sort((a, b) => String(b.starts_on).localeCompare(String(a.starts_on)))[0] ?? null
}

/** ข้อความผลของ wfee_set_sorting (op) */
export const SORTING_OP_TEXT = Object.freeze({
  start: 'บันทึกการลดค่ากำจัดแล้ว',
  reschedule: 'เปลี่ยนเดือนเริ่มลดแล้ว',
  cancel_stop: 'ยกเลิกกำหนดเลิกลดแล้ว — ยังได้ลดต่อ',
  stop: 'บันทึกกำหนดเลิกลดแล้ว',
  drop_unstarted: 'ยกเลิกการลดที่ยังไม่เริ่มแล้ว',
})
export const SORTING_NO_DISCOUNT_TEXT = 'รุ่นอัตราที่มีผลเดือนนั้นไม่มีหมวดลดค่ากำจัด — ส่วนลดยังไม่เกิดผลจนกว่ารุ่นอัตราจะมีหมวดนี้'

// ── นำเข้า Excel/CSV ─────────────────────────────────────────────────────────────────

export const IMPORT_BATCH_SIZE = 200
export const IMPORT_MAX_ROWS = 2000

// ⚠️ ห้ามมีคอลัมน์เลขบัตรประชาชน — ไม่จำเป็นต่อการแจ้งหนี้ (PDPA) · ไฟล์ที่มีคอลัมน์นี้ก็ไม่อ่านค่าเข้ามา
// "ปริมาณ" เปล่าๆ = หน่วย (ไม่ใช่ กก.) · ถ้ามีทั้งสองคอลัมน์ ช่อง "หน่วย" ที่กรอกไว้ชนะ
const HEADER_ALIASES = {
  account_no: ['เลขทะเบียน', 'เลขที่ทะเบียน', 'เลขที่บัญชี', 'รหัสผู้ชำระ', 'เลขที่', 'accountno'],
  payer_name: ['ชื่อผู้ชำระ', 'ผู้ชำระ', 'ชื่อ-สกุล', 'ชื่อสกุล', 'ชื่อ-นามสกุล', 'ชื่อผู้ใช้บริการ', 'ชื่อ', 'payername'],
  payer_phone: ['เบอร์โทร', 'เบอร์', 'โทรศัพท์', 'เบอร์โทรศัพท์', 'โทร', 'phone'],
  house_no: ['บ้านเลขที่', 'เลขที่บ้าน', 'houseno'],
  village: ['หมู่', 'หมู่ที่', 'หมู่บ้าน', 'village'],
  address: ['ที่อยู่', 'ที่ตั้ง', 'address'],
  place_type: ['ประเภทสถานที่', 'ประเภท', 'ประเภทผู้ชำระ', 'placetype'],
  units: ['ปริมาณ (หน่วย)', 'ปริมาณหน่วย', 'จำนวนหน่วย', 'หน่วย', 'ปริมาณ', 'units'],
  kg: ['ปริมาณ (กก.)', 'ปริมาณกก', 'ปริมาณขยะ (กก.)', 'กก.', 'กิโลกรัม', 'ปริมาณกิโลกรัม', 'ปริมาณขยะต่อเดือน', 'kg'],
  service_from: ['เดือนเริ่มเก็บ', 'เริ่มเก็บ', 'เดือนที่เริ่มเก็บ', 'วันเริ่มเก็บ', 'servicefrom'],
  note: ['หมายเหตุ', 'note'],
}

export const IMPORT_TEMPLATE_HEADERS = Object.freeze([
  'เลขทะเบียน', 'ชื่อผู้ชำระ', 'เบอร์โทร', 'บ้านเลขที่', 'หมู่', 'ที่อยู่', 'ประเภทสถานที่', 'ปริมาณ (หน่วย)', 'ปริมาณ (กก.)', 'เดือนเริ่มเก็บ', 'หมายเหตุ',
])
// แถวตัวอย่างในไฟล์แม่แบบ — ข้อมูลสมมติเท่านั้น (ห้ามใส่ชื่อ/เบอร์คนจริง) · ผู้ใช้ต้องลบแถวนี้ก่อนนำเข้า (หน้าจอบอกไว้)
export const IMPORT_TEMPLATE_SAMPLE = Object.freeze([
  'ตัวอย่าง-001', 'ผู้ชำระตัวอย่าง (ลบแถวนี้ก่อนนำเข้า)', '055-000000', '99/9', 'หมู่ 1', '', 'บ้านพักอาศัย', '1', '', '2026-12-01', '',
])

/** ไฟล์แม่แบบ CSV — ขึ้นต้นด้วย BOM UTF-8 ให้ Excel เปิดภาษาไทยไม่เพี้ยน */
export function buildImportTemplateCsv() {
  const csv = [IMPORT_TEMPLATE_HEADERS, IMPORT_TEMPLATE_SAMPLE]
    .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')
  return String.fromCharCode(0xfeff) + csv
}

/** แมปหัวคอลัมน์ → { key: columnIndex|-1 } */
export function mapImportHeaders(headers) {
  const normalized = (headers ?? []).map(normalizeHeader)
  const index = {}
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const set = aliases.map(normalizeHeader)
    index[key] = normalized.findIndex((h) => set.includes(h))
  }
  return index
}

/** แถวหัวตาราง = แถวใน 15 แถวแรกที่แมปคอลัมน์ได้มากสุด (ไฟล์จริงมักมีชื่อเรื่องอยู่ข้างบน) · ต้องแมปได้ ≥ 2 คอลัมน์ ไม่งั้น -1 */
export function locateHeaderRow(matrix) {
  const idx = findHeaderRow(matrix ?? [], (row) => {
    const map = mapImportHeaders(row)
    const n = Object.values(map).filter((i) => i >= 0).length
    return n >= 2 ? n : 0
  })
  return idx
}

/** เดือนเริ่มเก็บจากไฟล์: วันที่ (ISO/พ.ศ./ค.ศ./เลขวัน Excel) หรือ yyyy-mm หรือ mm/yyyy (ปี > 2400 = พ.ศ.) → ISO วันที่ 1 · null = ว่าง · undefined = อ่านไม่ได้ */
export function parseServiceMonth(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return null
  let m = /^(\d{4})-(\d{1,2})$/.exec(s)
  if (!m) { const k = /^(\d{1,2})[/.-](\d{4})$/.exec(s); if (k) m = [k[0], k[2], k[1]] }
  if (m) {
    let y = Number(m[1])
    if (y > 2400) y -= 543
    const iso = `${String(y).padStart(4, '0')}-${String(m[2]).padStart(2, '0')}-01`
    return isIsoDate(iso) ? iso : undefined
  }
  const d = parseImportDate(s)
  if (d === undefined) return undefined
  return d ? monthStart(d) : null
}

const cleanPhone = (raw) => {
  const text = String(raw ?? '').trim()
  if (!text) return { value: null }
  const a = analyzeContactNumber(text)
  if (!a.ok) return { error: 'เบอร์โทรไม่ถูกต้อง' }
  if (a.digits.length < 6) return { error: 'เบอร์โทรสั้นเกินไป (ต้อง 6 หลักขึ้นไป)' }
  const candidate = a.number
  if (/^[0-9+\- ]{6,20}$/.test(candidate)) return { value: candidate }
  return { value: a.digits, warning: a.key.includes('x') ? 'ตัดเลขต่อของเบอร์โทรออก' : null }
}

const parseQty = (raw) => {
  const s = String(raw ?? '').replace(/,/g, '').trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

/**
 * ตรวจแถวนำเข้าก่อนบันทึก (พรีวิว) — แถวผิดไม่ถูกนำเข้า ผู้ใช้เห็นเหตุผลรายแถว · คำเตือนไม่บล็อก
 * @param {unknown[][]} matrix แถวหัวตาราง + ข้อมูล (ผลจาก parseXlsx/parseDelimited) — หาแถวหัวเอง
 * @param {{ existing?: Array<{account_no?:string|null, house_no?:string|null, village?:string|null}>, defaultServiceFrom?: string }} ctx
 *   existing = บัญชีที่อยู่ในทะเบียนแล้ว (ตรวจซ้ำ) · defaultServiceFrom = เดือนเริ่มเก็บที่ใช้เมื่อแถวไม่ระบุ (ไม่ส่ง = บังคับให้ระบุในไฟล์)
 * @returns {{ rows: Array<{ line:number, status:'ready'|'invalid', errors:string[], warnings:string[], payload:object|null, label:string }>, missingHeaders: string[] }}
 *   line = เลขแถวในไฟล์ (แถวแรก = 1)
 */
export function parseImportRows(matrix, { existing = [], defaultServiceFrom } = {}) {
  const headerAt = locateHeaderRow(matrix)
  if (headerAt < 0) return { rows: [], missingHeaders: ['ชื่อผู้ชำระ'] }
  const idx = mapImportHeaders(matrix[headerAt])
  if (idx.payer_name < 0) return { rows: [], missingHeaders: ['ชื่อผู้ชำระ'] }
  const body = matrix.slice(headerAt + 1)
  const cell = (row, key) => (idx[key] >= 0 ? String(row[idx[key]] ?? '').trim() : '')
  const fallbackFrom = monthStart(defaultServiceFrom)

  const takenNo = new Set((existing ?? []).map((e) => String(e?.account_no ?? '').trim()).filter(Boolean))
  const houseKey = (house, village) => `${String(house ?? '').trim().toLocaleLowerCase('th-TH')}|${normalizeVillage(village).toLocaleLowerCase('th-TH')}`
  const takenHouse = new Set((existing ?? []).filter((e) => String(e?.house_no ?? '').trim()).map((e) => houseKey(e.house_no, e.village)))
  const noInFile = new Map() // เลขทะเบียน → แถวแรกในไฟล์
  const houseInFile = new Map()

  const rows = []
  body.slice(0, IMPORT_MAX_ROWS).forEach((row, i) => {
    if (!(row ?? []).some((v) => String(v ?? '').trim())) return // แถวว่างทั้งแถวข้ามเงียบ
    const line = headerAt + i + 2
    const errors = []
    const warnings = []

    const name = cell(row, 'payer_name')
    if (!name) errors.push('ไม่มีชื่อผู้ชำระ')
    else if (name.length > 200) errors.push('ชื่อผู้ชำระยาวเกิน 200 ตัวอักษร')

    const no = cell(row, 'account_no') || null
    if (no && no.length > 40) errors.push('เลขทะเบียนยาวเกิน 40 ตัวอักษร')
    if (no) {
      if (takenNo.has(no)) errors.push(`เลขทะเบียน ${no} ซ้ำกับที่มีในทะเบียนแล้ว`)
      else if (noInFile.has(no)) errors.push(`เลขทะเบียน ${no} ซ้ำกับแถว ${noInFile.get(no)} ในไฟล์`)
      else noInFile.set(no, line)
    }

    const phone = cleanPhone(cell(row, 'payer_phone'))
    if (phone.error) errors.push(phone.error)
    else if (phone.warning) warnings.push(phone.warning)

    const rawPlace = cell(row, 'place_type')
    let place = 'house'
    if (rawPlace) {
      place = matchPlaceType(rawPlace)
      if (!place) { errors.push(`ไม่รู้จักประเภทสถานที่ "${rawPlace}" (ใช้: ${PLACE_TYPES.map((p) => p.label).join(' / ')})`); place = 'house' }
    }

    // ปริมาณ: ช่อง "หน่วย" ที่กรอกไว้ชนะ · ไม่งั้นแปลงจาก กก. · ว่างทั้งคู่ = 1 หน่วย (ไม่เกิน 120 กก.)
    let units = 1
    const rawUnits = parseQty(cell(row, 'units'))
    const rawKg = parseQty(cell(row, 'kg'))
    if (rawUnits === undefined) errors.push('ปริมาณ (หน่วย) ต้องเป็นตัวเลข')
    else if (rawUnits !== null) {
      if (!isValidUnits(rawUnits)) errors.push('ปริมาณ (หน่วย) ต้องเป็นบวก ทีละครึ่งหน่วย (เช่น 1, 1.5, 2) — ถ้ามีเป็น กก. ให้กรอกที่ช่อง ปริมาณ (กก.) แทน')
      else units = rawUnits
    } else if (rawKg === undefined) errors.push('ปริมาณ (กก.) ต้องเป็นตัวเลข')
    else if (rawKg !== null) {
      const u = kgToUnits(rawKg)
      if (u === null) errors.push(`ปริมาณ (กก.) ต้องเป็นตัวเลขบวก ไม่เกิน ${(MAX_UNITS * UNIT_KG).toLocaleString('en-US')} กก.`)
      else units = u
    }

    let from = parseServiceMonth(cell(row, 'service_from'))
    if (from === undefined) { errors.push('เดือนเริ่มเก็บอ่านไม่ได้ (ใช้ วว/ดด/ปปปป หรือ ดด/ปปปป ได้ทั้ง พ.ศ. และ ค.ศ.)'); from = null }
    else if (from === null) {
      from = fallbackFrom
      if (!from) errors.push('ไม่มีเดือนเริ่มเก็บ')
    }

    const house = cell(row, 'house_no') || null
    const village = normalizeVillage(cell(row, 'village')) || null
    if (house && house.length > 50) errors.push('บ้านเลขที่ยาวเกิน 50 ตัวอักษร')
    if (village && village.length > 100) errors.push('หมู่ยาวเกิน 100 ตัวอักษร')
    const address = cell(row, 'address') || null
    if (address && address.length > 500) errors.push('ที่อยู่ยาวเกิน 500 ตัวอักษร')
    if (house) {
      const key = houseKey(house, village)
      if (takenHouse.has(key)) warnings.push(`บ้านเลขที่ ${house}${village ? ` ${village}` : ''} มีบัญชีอยู่ในทะเบียนแล้ว`)
      else if (houseInFile.has(key)) warnings.push(`บ้านเลขที่ ${house}${village ? ` ${village}` : ''} ซ้ำกับแถว ${houseInFile.get(key)} ในไฟล์`)
      else houseInFile.set(key, line)
    }
    const note = cell(row, 'note') || null
    if (note && note.length > 2000) errors.push('หมายเหตุยาวเกิน 2,000 ตัวอักษร')

    const ok = errors.length === 0
    rows.push({
      line, status: ok ? 'ready' : 'invalid', errors, warnings, label: name || '(ไม่มีชื่อ)',
      payload: ok ? {
        account_no: no, payer_name: name, payer_phone: phone.value ?? null, house_no: house, village, address,
        place_type: place, monthly_units: units, service_from: from, note,
      } : null,
    })
  })
  return { rows, missingHeaders: [] }
}

/** แบ่งก้อนละ size แถว */
export function chunk(list, size = IMPORT_BATCH_SIZE) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

// ── ประวัติ (waste_fee_events) ───────────────────────────────────────────────────────

export const EVENT_ACTION_LABEL = Object.freeze({
  insert: 'เพิ่มเข้าทะเบียน', update: 'แก้ไขข้อมูล', delete: 'ลบ', sorting: 'ยืนยัน/เลิกการคัดแยกขยะ (ลดค่ากำจัด)',
})

const FIELD_LABEL = Object.freeze({
  account_no: 'เลขทะเบียน', payer_name: 'ชื่อผู้ชำระ', payer_phone: 'เบอร์โทร', house_no: 'บ้านเลขที่', village: 'หมู่', address: 'ที่อยู่',
  place_type: 'ประเภทสถานที่', monthly_units: 'ปริมาณ (หน่วย)', service_from: 'เดือนเริ่มเก็บ', status: 'สถานะ', closed_from: 'เลิกเก็บตั้งแต่เดือน',
  closed_reason: 'เหตุผลที่เลิกเก็บ', note: 'หมายเหตุ',
  effective_from: 'วันเริ่มมีผล', ordinance_ref: 'อ้างข้อบัญญัติ', basis: 'วิธีคิดอัตรา', base_collect: 'ค่าเก็บขนเหมา', base_dispose: 'ค่ากำจัดเหมา',
  unit_collect: 'ค่าเก็บขนต่อหน่วยเกิน', unit_dispose: 'ค่ากำจัดต่อหน่วยเกิน', big_unit_collect: 'ค่าเก็บขนต่อหน่วยเกิน 30', big_unit_dispose: 'ค่ากำจัดต่อหน่วยเกิน 30',
  place_type_rates: 'อัตราตามประเภทสถานที่', sorting_discount: 'มีหมวดลดคัดแยก', is_example: 'แถวตัวอย่าง',
})
// ช่องที่ไม่แสดงในประวัติ (รหัสผู้ใช้/เวลาที่ระบบประทับ — ผู้ยืนยันดูจากตัวประวัติเอง)
const HIDDEN_FIELDS = new Set(['import_batch'])
export const EVENT_DATE_FIELDS = new Set(['service_from', 'closed_from', 'effective_from'])

/**
 * แปลง changes ของ waste_fee_events เป็นบรรทัดอ่านง่าย — update/sorting = [เดิม, ใหม่] · insert = ค่าที่บันทึก
 * formatValue(key, value) ให้หน้าจอแปลงวันที่เป็น พ.ศ. (ไม่ส่ง = แสดงค่าดิบ)
 */
export function describeEventChanges(action, changes, formatValue = (_k, v) => v) {
  const out = []
  if (!changes || typeof changes !== 'object') return out
  const show = (k, v) => {
    if (k === 'status') return accountStatusLabel(v)
    if (k === 'place_type') return placeTypeLabel(v)
    if (k === 'sorting_discount' || k === 'is_example') return v ? 'ใช่' : 'ไม่ใช่'
    if (k === 'basis') return v === 'units' ? 'ตามปริมาณขยะ (หน่วยละ 120 กก.)' : 'เหมาตามประเภทสถานที่'
    if (k === 'place_type_rates' && v && typeof v === 'object') return Object.entries(v).map(([p, n]) => `${placeTypeLabel(p)} ${n}`).join(', ')
    const f = formatValue(k, v)
    return f === null || f === undefined || f === '' ? '—' : String(f)
  }
  for (const [k, v] of Object.entries(changes)) {
    if (HIDDEN_FIELDS.has(k)) continue
    const label = FIELD_LABEL[k] ?? k
    // เบอร์โทร/ที่อยู่ ฐานข้อมูลไม่เก็บค่าในประวัติ (PDPA) เก็บแค่ว่ามีการแก้ ('changed')
    if (v === 'changed') { out.push(`${label}: มีการแก้ไข (ไม่บันทึกค่าลงประวัติ)`); continue }
    if (action === 'update' || action === 'sorting') {
      if (Array.isArray(v) && v.length === 2) { out.push(`${label}: ${show(k, v[0])} → ${show(k, v[1])}`); continue }
    }
    out.push(`${label}: ${show(k, v)}`)
  }
  return out
}
