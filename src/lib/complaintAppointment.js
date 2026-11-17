// คำร้องแบบนัดหมาย + ตารางอัตราค่าบริการ (แสดงอย่างเดียว) + รูปในหน้า /t/ — ตัวช่วยฝั่งหน้าเว็บ
// กติกาจริงอยู่ที่ฐานข้อมูล: supabase/migrations/20261202100000_complaint_appointment_columns.sql
//                          และ 20261202100100_complaint_appointment_functions.sql
// ไฟล์นี้ใช้ร่วมกันทุกหน้า (ฟอร์มประชาชน · หน้าเจ้าหน้าที่ · /t/ · คำร้องของฉัน · ตั้งค่าหมวด) จึงต้องไม่ import
// supabase (เทสต์รันด้วย node ตรงๆ) — ส่วนที่ต้องรู้ URL ของ Supabase ให้หน้าเว็บส่งเข้ามาเอง

import { holidayName, isWorkingDay } from './workingDays.js'

// ───── ช่วงเวลานัด ─────
// ต้องตรงกับ CHECK complaints_appointment_slot_check ในฐานข้อมูล
export const APPOINTMENT_SLOTS = [
  { value: 'morning', label: 'ช่วงเช้า' },
  { value: 'afternoon', label: 'ช่วงบ่าย' },
  { value: 'allday', label: 'ทั้งวัน' },
]
export const DEFAULT_APPOINTMENT_SLOT = 'morning'

// ต้องตรงกับ complaints_appointment_note_check (≤ 300)
export const APPOINTMENT_NOTE_MAX = 300

// ฐานข้อมูลรับนัดล่วงหน้าได้ไม่เกิน 180 วัน (set_complaint_appointment) · ฟอร์มประชาชนจำกัดแคบกว่า (90 วัน)
export const STAFF_APPOINTMENT_MAX_DAYS = 180
export const CITIZEN_PREFERRED_MAX_DAYS = 90

export function appointmentSlotLabel(slot) {
  return APPOINTMENT_SLOTS.find((s) => s.value === slot)?.label ?? ''
}

// ป้ายในไทม์ไลน์ (complaint_timeline.status ที่ set_complaint_appointment เขียน)
export const APPOINTMENT_TIMELINE_LABELS = {
  appointment: 'นัดหมาย',
  appointment_cleared: 'ยกเลิกนัด',
}

export const APPOINTMENT_TIMELINE_COLORS = {
  appointment: '#0d9488',
  appointment_cleared: '#94a3b8',
}

// ───── วันที่ (เวลาไทยเสมอ ไม่พึ่ง timezone ของเครื่อง) ─────
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const MONTHS_SHORT_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

export function isDateOnly(value) {
  if (typeof value !== 'string' || !DATE_ONLY.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const probe = new Date(Date.UTC(y, m - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
}

/** วันนี้ตามเวลาไทย 'YYYY-MM-DD' */
export function bangkokToday(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
}

/** บวก/ลบวันจากสตริงวันที่ ไม่ผ่าน timezone ของเครื่อง */
export function addDaysToDateStr(value, days) {
  if (!isDateOnly(value)) return ''
  const [y, m, d] = value.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + days))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`
}

/** "5 ธ.ค. 2569" (พ.ศ.) — ค่าไม่ถูกต้อง = '' */
export function formatApptDate(value) {
  if (!isDateOnly(value)) return ''
  const [y, m, d] = value.split('-').map(Number)
  return `${d} ${MONTHS_SHORT_TH[m - 1]} ${y + 543}`
}

/** "5 ธ.ค." — ใช้ป้ายเล็กในรายการ */
export function formatApptDateShort(value) {
  if (!isDateOnly(value)) return ''
  const [, m, d] = value.split('-').map(Number)
  return `${d} ${MONTHS_SHORT_TH[m - 1]}`
}

/** "5 ธ.ค. 2569 ช่วงเช้า" */
export function appointmentText({ date, slot }) {
  const day = formatApptDate(date)
  if (!day) return ''
  const slotText = appointmentSlotLabel(slot)
  return slotText ? `${day} ${slotText}` : day
}

/** นัดหลังวันกำหนดเสร็จหรือไม่ — ไม่มีวันกำหนด = ไม่ตัดสิน (false) */
export function isAppointmentAfterDue(appointmentDate, dueDate) {
  const appt = String(appointmentDate ?? '').slice(0, 10)
  const due = String(dueDate ?? '').slice(0, 10)
  return isDateOnly(appt) && isDateOnly(due) && appt > due
}

/** ช่วงวันที่ที่ผู้แจ้งเลือกได้ในช่อง "วันที่สะดวก": พรุ่งนี้ → +90 วัน (เวลาไทย) */
export function preferredDateRange(now = new Date()) {
  const today = bangkokToday(now)
  return { min: addDaysToDateStr(today, 1), max: addDaysToDateStr(today, CITIZEN_PREFERRED_MAX_DAYS) }
}

/** ช่วงวันที่ที่เจ้าหน้าที่นัดได้: วันนี้ → +180 วัน (ตรงกับ RPC) */
export function staffAppointmentRange(now = new Date()) {
  const today = bangkokToday(now)
  return { min: today, max: addDaysToDateStr(today, STAFF_APPOINTMENT_MAX_DAYS) }
}

/**
 * คำเตือนอ่อนๆ เมื่อวันที่เลือกเป็นเสาร์-อาทิตย์/วันหยุดราชการ — ไม่บล็อก (เจ้าหน้าที่จะยืนยันวันนัดอีกครั้ง)
 * @returns {string} ข้อความ หรือ '' ถ้าเป็นวันทำการ/ค่าไม่ถูกต้อง
 */
export function offDayWarning(value) {
  if (!isDateOnly(value)) return ''
  if (isWorkingDay(value)) return ''
  const holiday = holidayName(value)
  return holiday
    ? `วันที่เลือกเป็นวันหยุดราชการ (${holiday}) เจ้าหน้าที่อาจเสนอวันอื่น`
    : 'วันที่เลือกเป็นวันเสาร์-อาทิตย์ เจ้าหน้าที่อาจเสนอวันอื่น'
}

/** อ่านวันที่สะดวกจาก extra_data — คืนเฉพาะค่ารูปแบบถูกต้อง ไม่เช่นนั้น '' */
export function readPreferredDate(extraData) {
  const value = extraData && typeof extraData === 'object' ? extraData.preferred_date : null
  return typeof value === 'string' && isDateOnly(value) ? value : ''
}

// ───── ตารางอัตราค่าบริการ ─────
// ต้องตรงกับ complaint_fee_rates_valid() ในฐานข้อมูล (≤ 20 แถว · item 1-120 · unit 1-40 · rate 0-1,000,000 · note ≤ 200)
export const FEE_LIMITS = { rows: 20, item: 120, unit: 40, rateMax: 1000000, note: 200, reference: 300 }

export const FEE_ADMIN_HINT = 'อัตราต้องตรงกับข้อบัญญัติหรือประกาศของหน่วยงาน'
export const FEE_PUBLIC_NOTICE = 'อัตราตามข้อบัญญัติ ยอดจริงตามที่เจ้าหน้าที่ประเมินหน้างาน ระบบนี้ยังไม่รับชำระเงิน'

export function blankFeeRow() {
  return { item: '', unit: '', rate: '', note: '' }
}

/** แถวจากฐานข้อมูล → แถวในฟอร์มแก้ไข (rate เป็นสตริงให้พิมพ์ได้) */
export function feeRowsToDraft(rates) {
  if (!Array.isArray(rates)) return []
  return rates.map((row) => ({
    item: String(row?.item ?? ''),
    unit: String(row?.unit ?? ''),
    rate: row?.rate === null || row?.rate === undefined ? '' : String(row.rate),
    note: String(row?.note ?? ''),
  }))
}

/**
 * ตรวจแถวในฟอร์มตามกติกาเดียวกับ SQL ก่อนบันทึก
 * - แถวว่างทั้งแถวถูกข้ามเงียบๆ
 * - rate คืนเป็น number เสมอ (ห้ามส่งสตริง — jsonb_typeof ต้องเป็น 'number')
 * @returns {{ ok: true, rows: Array<{item:string, unit:string, rate:number, note?:string}> } | { ok: false, error: string }}
 */
export function validateFeeRows(draftRows) {
  const rows = []
  const source = Array.isArray(draftRows) ? draftRows : []
  for (let i = 0; i < source.length; i++) {
    const raw = source[i] ?? {}
    const item = String(raw.item ?? '').trim()
    const unit = String(raw.unit ?? '').trim()
    const rateText = String(raw.rate ?? '').trim().replace(/,/g, '')
    const note = String(raw.note ?? '').trim()
    if (!item && !unit && !rateText && !note) continue
    const where = `แถวที่ ${i + 1}`
    if (!item) return { ok: false, error: `${where}: กรุณากรอกรายการ` }
    if (item.length > FEE_LIMITS.item) return { ok: false, error: `${where}: ชื่อรายการยาวได้ไม่เกิน ${FEE_LIMITS.item} ตัวอักษร` }
    if (!unit) return { ok: false, error: `${where}: กรุณากรอกหน่วย` }
    if (unit.length > FEE_LIMITS.unit) return { ok: false, error: `${where}: หน่วยยาวได้ไม่เกิน ${FEE_LIMITS.unit} ตัวอักษร` }
    if (!rateText) return { ok: false, error: `${where}: กรุณากรอกอัตรา (บาท)` }
    const rate = Number(rateText)
    if (!Number.isFinite(rate) || !/^\d+(\.\d+)?$/.test(rateText)) return { ok: false, error: `${where}: อัตราต้องเป็นตัวเลข` }
    if (rate < 0 || rate > FEE_LIMITS.rateMax) return { ok: false, error: `${where}: อัตราต้องอยู่ระหว่าง 0 ถึง ${FEE_LIMITS.rateMax.toLocaleString('th-TH')} บาท` }
    if (note.length > FEE_LIMITS.note) return { ok: false, error: `${where}: หมายเหตุยาวได้ไม่เกิน ${FEE_LIMITS.note} ตัวอักษร` }
    rows.push(note ? { item, unit, rate, note } : { item, unit, rate })
  }
  if (rows.length > FEE_LIMITS.rows) return { ok: false, error: `ใส่อัตราได้ไม่เกิน ${FEE_LIMITS.rows} แถว` }
  return { ok: true, rows }
}

/** ตรวจช่อง "อ้างอิงข้อบัญญัติ/ประกาศ" — คืนค่าที่ตัดช่องว่างแล้ว (ว่าง = null) */
export function validateFeeReference(value) {
  const text = String(value ?? '').trim()
  if (text.length > FEE_LIMITS.reference) return { ok: false, error: `อ้างอิงข้อบัญญัติ/ประกาศยาวได้ไม่เกิน ${FEE_LIMITS.reference} ตัวอักษร` }
  return { ok: true, value: text || null }
}

/** ข้อความเมื่อบันทึกอัตราไม่สำเร็จ — 23514 = CHECK ของฐานข้อมูลไม่ผ่าน */
export function feeSaveErrorMessage(error) {
  if (error?.code === '23514') return 'ตารางอัตราไม่ถูกต้องตามกติกาของระบบ (ไม่เกิน 20 แถว · รายการ/หน่วยห้ามว่าง · อัตราเป็นตัวเลข 0 ถึง 1,000,000) กรุณาตรวจแล้วลองใหม่'
  return `บันทึกอัตราไม่สำเร็จ: ${error?.message ?? 'ไม่ทราบสาเหตุ'}`
}

/** อัตราจากฐานข้อมูลสำหรับแสดงผล — กรองแถวที่รูปร่างผิดทิ้ง (ไม่พังหน้า) */
export function normalizeFeeRates(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((row) => row && typeof row === 'object' && typeof row.item === 'string' && typeof row.unit === 'string' && typeof row.rate === 'number' && Number.isFinite(row.rate))
    .slice(0, FEE_LIMITS.rows)
    .map((row) => ({ item: row.item, unit: row.unit, rate: row.rate, note: typeof row.note === 'string' ? row.note : '' }))
}

/** "1,200" / "50.5" — ไม่บังคับทศนิยม */
export function formatFeeRate(rate) {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return ''
  return rate.toLocaleString('th-TH', { maximumFractionDigits: 2 })
}

// ───── รูปในหน้า /t/ ─────
// ต้องตรงกับ complaint_categories_track_photos_check
export const TRACK_PHOTO_MODES = [
  { value: 'none', label: 'ไม่แสดง' },
  { value: 'after', label: 'เฉพาะรูปหลังดำเนินการ' },
  { value: 'both', label: 'รูปก่อนและหลัง' },
]
export const DEFAULT_TRACK_PHOTO_MODE = 'after'
export const TRACK_PHOTO_BOTH_WARNING = 'รูปที่ประชาชนส่งมาอาจมีหน้าคน ป้ายทะเบียน หรือบ้านเลขที่ ทุกคนที่มีลิงก์ติดตามเรื่องจะเห็น'
export const TRACK_PHOTO_LOCKED_NOTE = 'หมวดอ่อนไหว/เฉพาะกิจ ไม่แสดงรูปเสมอ'

// หมวดที่ฐานข้อมูลบังคับ none เสมอ (complaint_track_photos): เฉพาะกิจ · ต้องรับเรื่องเอง (อ่อนไหว) · หมวดทุจริต
// 'corruption' = ชุดเดียวกับ CONFIDENTIAL_COMPLAINT_CATEGORIES ของ notify-telegram/send-push — หน้าตั้งค่าล็อกตัวเลือกให้ตรงกัน
const CONFIDENTIAL_CATEGORY_VALUES = new Set(['corruption'])
export function trackPhotosLocked(category) {
  return Boolean(category?.is_adhoc || category?.requires_manual_intake || CONFIDENTIAL_CATEGORY_VALUES.has(String(category?.value ?? '')))
}

const DRIVE_ID = /^[A-Za-z0-9_-]{10,100}$/

/** URL รูปคำร้องผ่าน drive-file (ไม่ผ่าน /_img/ — รูปคำร้องประชาชนห้ามเข้าแคช edge) · id ไม่ถูกรูปแบบ = null */
export function trackPhotoUrl(supabaseBaseUrl, fileId) {
  if (typeof supabaseBaseUrl !== 'string' || !supabaseBaseUrl || typeof fileId !== 'string' || !DRIVE_ID.test(fileId)) return null
  return `${supabaseBaseUrl.replace(/\/+$/, '')}/functions/v1/drive-file?id=${encodeURIComponent(fileId)}`
}

/** รูปจาก get_complaint_by_track_token → { before: string[], after: string[] } เฉพาะ id ที่ถูกรูปแบบ */
export function normalizeTrackPhotos(raw) {
  const pick = (list) => (Array.isArray(list) ? list.filter((id) => typeof id === 'string' && DRIVE_ID.test(id)).slice(0, 4) : [])
  return { before: pick(raw?.before), after: pick(raw?.after) }
}
