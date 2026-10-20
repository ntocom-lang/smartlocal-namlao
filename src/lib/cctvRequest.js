// คำขอภาพจากกล้องวงจรปิด (CCTV) — ค่าคงที่ กติกาตรวจข้อมูล และตัวคำนวณวันที่ภาพจะถูกบันทึกทับ
//
// ใช้ร่วมกัน 3 จุด: ฟอร์มประชาชน (CctvRequestWizard) · หน้าเจ้าหน้าที่ (CctvRequestInfo) ·
// หน้าตั้งค่าของแอดมิน (DocumentTypeAssignments) ส่วนด่านบังคับจริงอยู่ที่ฐานข้อมูล
// (guard_cctv_footage_request ใน 20261021100000) — ตัวเลขเพดานและรายการค่าที่ยอมรับต้องตรงกัน
// tests/cctv-request.test.mjs เทียบ SQL กับไฟล์นี้ให้ทุกครั้ง
//
// ⚠️ ภาพกล้องคือข้อมูลส่วนบุคคลของทุกคนที่อยู่ในภาพ ฐานทางกฎหมายที่เปิดเผยให้ผู้ขอและระเบียบการใช้ภาพ
// CCTV ของ อปท. ต้องยืนยันกับตัวบทฉบับปัจจุบันและ DPO ก่อนเปิดใช้จริง ไฟล์นี้ไม่ตัดสินแทน —
// ระบบเก็บแค่คำขอ ไม่รับ/ส่งไฟล์วิดีโอ และการตัดสินว่าจะให้ภาพแก่ใครเป็นดุลพินิจของเจ้าหน้าที่

export const CCTV_TYPE = 'cctv_footage_request'
export const CCTV_FORM_TYPE = 'cctv_footage_request'
export const CCTV_FORM_VERSION = 1

export const CCTV_INCIDENT_TYPES = [
  { value: 'property_lost',   label: 'ทรัพย์สินสูญหาย/ถูกลักทรัพย์' },
  { value: 'road_accident',   label: 'อุบัติเหตุทางถนน' },
  { value: 'assault',         label: 'ทะเลาะวิวาท/ทำร้ายร่างกาย' },
  { value: 'property_damage', label: 'ทรัพย์สินเสียหาย' },
  { value: 'other',           label: 'อื่นๆ' },
]

export const CCTV_REQUESTER_ROLES = [
  { value: 'victim',       label: 'ผู้เสียหาย/เจ้าของทรัพย์สิน' },
  { value: 'party',        label: 'คู่กรณี' },
  { value: 'investigator', label: 'พนักงานสอบสวน/หน่วยงานรัฐ' },
]

// ขอเท่าที่จำเป็น — ช่วงเวลาสั้นที่สุดที่ใช้ตรวจเหตุการณ์ได้ ลดจำนวนบุคคลอื่นที่ติดอยู่ในภาพ
// ⚠️ 180 นาทีเป็นสมมติฐานของผู้พัฒนา ไม่ใช่ตัวเลขตามระเบียบ — ปรับได้ถ้า อปท. ตัดสินนโยบายต่างจากนี้
export const CCTV_MAX_WINDOW_MINUTES = 180
export const CCTV_MAX_DESCRIPTION = 300
export const CCTV_MAX_LABEL = 120
export const CCTV_MAX_POLICE_REF = 50
// เหตุที่เกิดนานกว่านี้ไม่มีภาพที่ใช้ได้แน่นอน ปฏิเสธตั้งแต่ฟอร์มแทนให้เจ้าหน้าที่ปฏิเสธทีละใบ
export const CCTV_MAX_INCIDENT_AGE_DAYS = 365
export const CCTV_DAILY_LIMIT = 5

// ค่าตั้งของ อปท. — municipalities.fee_schedule._cctv_retention_days (กล้องเก็บภาพย้อนหลังกี่วัน)
// ไม่มีค่าเริ่มต้นโดยเจตนา: ถ้าแอดมินไม่ได้กรอก ระบบไม่โชว์ตัวเลขและไม่ขึ้นป้ายเร่ง
// ดีกว่าเดาตัวเลขแล้วทำให้ประชาชนมั่นใจเกินจริง หรือเจ้าหน้าที่ตกใจเกินจริง
export const CCTV_RETENTION_KEY = '_cctv_retention_days'
export const CCTV_RETENTION_MIN = 1
export const CCTV_RETENTION_MAX = 365
// ใกล้ถูกทับ = เหลือไม่เกินกี่วัน ถึงจะขึ้นป้ายเร่งให้เจ้าหน้าที่
export const CCTV_SOON_DAYS = 7

// ที่ว่างให้เจ้าหน้าที่เติมชื่อผู้รับภาพ — ขีดล่างล้วน หาเจอง่ายและไม่ปนกับข้อความทั่วไป
export const CCTV_HANDOVER_BLANK = '________'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/** วันนี้ตามปฏิทินไทย (YYYY-MM-DD) — ไม่ใช้เขตเวลาของเครื่อง เพราะด่านฝั่งฐานข้อมูลเทียบเวลาไทย */
export function cctvBangkokToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(now)
}

function dayNumber(value) {
  const match = DATE_RE.exec(String(value ?? ''))
  if (!match) return null
  const [, y, m, d] = match.map(Number)
  const ms = Date.UTC(y, m - 1, d)
  const check = new Date(ms)
  // กันวันที่ที่ JS ปัดให้เงียบๆ (เช่น 2026-02-31 → 3 มี.ค.)
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null
  return Math.round(ms / 86400000)
}

function addDays(value, days) {
  const n = dayNumber(value)
  if (n === null) return null
  return new Date((n + days) * 86400000).toISOString().slice(0, 10)
}

export function cctvTimeToMinutes(value) {
  const match = TIME_RE.exec(String(value ?? ''))
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

/** กล้องเก็บภาพย้อนหลังกี่วัน — จำนวนเต็ม 1–365 เท่านั้น ที่เหลือถือว่าไม่ได้ตั้ง (null) */
export function cctvRetentionDays(tenant) {
  const raw = tenant?.fee_schedule?.[CCTV_RETENTION_KEY]
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
  return Number.isInteger(n) && n >= CCTV_RETENTION_MIN && n <= CCTV_RETENTION_MAX ? n : null
}

/**
 * ภาพของเหตุวันนั้นจะถูกบันทึกทับเมื่อไร
 * - unknown      อปท. ไม่ได้ตั้งค่าเก็บภาพย้อนหลัง (หรือวันที่ไม่ถูกต้อง) → ไม่ตัดสินให้
 * - overwritten  เลยรอบเก็บภาพแล้ว (ภาพอาจไม่เหลือ — เจ้าหน้าที่ต้องไปตรวจที่เครื่องบันทึกจริง)
 * - soon         เหลือ ≤ CCTV_SOON_DAYS วัน ต้องเร่ง
 * - ok           ยังอยู่ในรอบ
 * ⚠️ เป็นการประมาณจากค่าที่ อปท. กรอก ไม่ใช่ข้อเท็จจริงจากเครื่องบันทึก — ข้อความที่แสดงต้องใช้คำว่า "อาจ"
 */
export function cctvOverwriteInfo({ incidentDate, retentionDays, today = cctvBangkokToday() }) {
  const days = Number.isInteger(retentionDays) ? retentionDays : null
  const incident = dayNumber(incidentDate)
  const now = dayNumber(today)
  if (days === null || days < 1 || incident === null || now === null) return { status: 'unknown', overwriteDate: null, daysLeft: null }
  const overwriteDate = addDays(incidentDate, days)
  const daysLeft = incident + days - now
  const status = daysLeft < 0 ? 'overwritten' : daysLeft <= CCTV_SOON_DAYS ? 'soon' : 'ok'
  return { status, overwriteDate, daysLeft }
}

/** ตรวจร่างแบบฟอร์ม → { ok, errors: { ชื่อช่อง: ข้อความไทย } } ข้อความต้องอ่านรู้เรื่องโดยไม่ต้องเห็นช่อง */
export function validateCctvDraft(draft, { today = cctvBangkokToday() } = {}) {
  const d = draft ?? {}
  const errors = {}
  const incidentValues = CCTV_INCIDENT_TYPES.map(t => t.value)
  const roleValues = CCTV_REQUESTER_ROLES.map(t => t.value)

  if (!incidentValues.includes(d.incident_type)) errors.incident_type = 'กรุณาเลือกประเภทเหตุ'

  const dayN = dayNumber(d.incident_date)
  const todayN = dayNumber(today)
  if (dayN === null) errors.incident_date = 'กรุณาระบุวันที่เกิดเหตุ'
  else if (todayN !== null && dayN > todayN) errors.incident_date = 'วันที่เกิดเหตุต้องไม่เกินวันนี้'
  else if (todayN !== null && todayN - dayN > CCTV_MAX_INCIDENT_AGE_DAYS) errors.incident_date = 'เหตุเกิดนานเกิน 1 ปี ไม่มีภาพให้ขอแล้ว'

  const from = cctvTimeToMinutes(d.time_from)
  const to = cctvTimeToMinutes(d.time_to)
  if (from === null) errors.time_from = 'กรุณาระบุเวลาเริ่มต้น'
  if (to === null) errors.time_to = 'กรุณาระบุเวลาสิ้นสุด'
  if (from !== null && to !== null) {
    if (to <= from) errors.time_to = 'เวลาสิ้นสุดต้องหลังเวลาเริ่มต้น (ขอได้ภายในวันเดียว)'
    else if (to - from > CCTV_MAX_WINDOW_MINUTES) errors.time_to = `ขอได้ไม่เกิน ${CCTV_MAX_WINDOW_MINUTES / 60} ชั่วโมงต่อคำขอ`
  }

  const label = String(d.camera_label ?? '').trim()
  if (!label) errors.camera_label = 'กรุณาระบุจุดกล้องหรือสถานที่เกิดเหตุ'
  else if (label.length > CCTV_MAX_LABEL) errors.camera_label = `ยาวเกิน ${CCTV_MAX_LABEL} ตัวอักษร`

  const description = String(d.description ?? '').trim()
  if (description.length > CCTV_MAX_DESCRIPTION) errors.description = `ยาวเกิน ${CCTV_MAX_DESCRIPTION} ตัวอักษร`
  if (d.incident_type === 'other' && !description) errors.description = 'เลือก "อื่นๆ" ต้องอธิบายเหตุการณ์สั้นๆ'

  if (!roleValues.includes(d.requester_role)) errors.requester_role = 'กรุณาเลือกฐานะของผู้ขอ'

  if (String(d.police_ref ?? '').trim().length > CCTV_MAX_POLICE_REF) errors.police_ref = `ยาวเกิน ${CCTV_MAX_POLICE_REF} ตัวอักษร`

  return { ok: Object.keys(errors).length === 0, errors }
}

/** แปลงร่างแบบฟอร์มเป็น permit_form_data ที่ฐานข้อมูลตรวจซ้ำ — คีย์ต้องตรงกับ guard_cctv_footage_request */
export function buildCctvFormData(draft) {
  const d = draft ?? {}
  const text = (v, max) => String(v ?? '').trim().slice(0, max)
  return {
    form_type: CCTV_FORM_TYPE,
    form_version: CCTV_FORM_VERSION,
    incident_type: d.incident_type,
    incident_date: d.incident_date,
    time_from: d.time_from,
    time_to: d.time_to,
    camera_id: d.camera_id ? String(d.camera_id) : null,
    camera_label: text(d.camera_label, CCTV_MAX_LABEL),
    description: text(d.description, CCTV_MAX_DESCRIPTION),
    requester_role: d.requester_role,
    police_ref: text(d.police_ref, CCTV_MAX_POLICE_REF),
  }
}

export function cctvIncidentLabel(value) {
  return CCTV_INCIDENT_TYPES.find(t => t.value === value)?.label ?? ''
}

export function cctvRoleLabel(value) {
  return CCTV_REQUESTER_ROLES.find(t => t.value === value)?.label ?? ''
}

/** ข้อความช่อง purpose ของ document_requests — ตารางเจ้าหน้าที่และ "เอกสารของฉัน" โชว์ช่องนี้ดิบๆ */
export function cctvPurposeText(draft) {
  const incident = cctvIncidentLabel(draft?.incident_type)
  return `ขอภาพกล้องวงจรปิด${incident ? ` · ${incident}` : ''}`.slice(0, 200)
}

/**
 * คำเตือนบนฟอร์มประชาชน — ไม่ปิดกั้นการยื่น (ภาพอาจยังอยู่แม้เลยรอบ) แต่ต้องบอกให้รู้ก่อนกดส่ง
 * tone: 'red' = ภาพอาจถูกทับแล้ว/ใกล้ถูกทับ · 'amber' = คำเตือนทั่วไป
 */
export function cctvCitizenRetentionNotice({ retentionDays, incidentDate, today = cctvBangkokToday() }) {
  if (!Number.isInteger(retentionDays)) {
    return { tone: 'amber', text: 'ภาพอาจถูกบันทึกทับตามรอบของกล้อง ควรยื่นให้เร็วที่สุด' }
  }
  const info = cctvOverwriteInfo({ incidentDate, retentionDays, today })
  if (info.status === 'overwritten') {
    return { tone: 'red', text: `เหตุเกิดเกิน ${retentionDays} วันแล้ว ภาพอาจถูกบันทึกทับไปแล้ว เจ้าหน้าที่จะตรวจที่เครื่องบันทึกให้ แต่ไม่รับประกันว่าจะมีภาพ` }
  }
  if (info.status === 'soon') {
    return { tone: 'red', text: `ภาพอาจถูกบันทึกทับภายใน ${info.daysLeft} วัน (กล้องของหน่วยงานนี้เก็บภาพย้อนหลังประมาณ ${retentionDays} วัน) รีบติดต่อเจ้าหน้าที่ด้วย` }
  }
  return { tone: 'amber', text: `กล้องของหน่วยงานนี้เก็บภาพย้อนหลังประมาณ ${retentionDays} วัน ถ้าเหตุเกิดนานกว่านั้นอาจไม่มีภาพ ควรยื่นให้เร็วที่สุด` }
}

/** ข้อความร่างบันทึกส่งมอบภาพ — ระบบเติมวันที่ เจ้าหน้าที่เติมชื่อผู้รับ */
export function cctvHandoverDraft(dateText) {
  return `ส่งมอบภาพให้ ${CCTV_HANDOVER_BLANK} เมื่อ ${dateText}`
}

/** เติมชื่อผู้รับแล้วหรือยัง — ยังมีที่ว่าง หรือบันทึกว่างเปล่า = ยัง */
export function isCctvHandoverFilled(note) {
  const text = String(note ?? '').trim()
  return text !== '' && !text.includes(CCTV_HANDOVER_BLANK)
}

/**
 * บันทึกที่ควรเขียนลงฐานข้อมูล — ตัดบรรทัดร่างที่ยังไม่ได้เติมชื่อออก
 * (กด "รับเรื่อง" หรือ "ปฏิเสธ" ระหว่างที่ร่างยังว่างอยู่ ต้องไม่เก็บ ________ ลงประวัติคำขอ)
 */
export function cctvNoteForSave(note) {
  return String(note ?? '')
    .split('\n')
    .filter(line => !line.includes(CCTV_HANDOVER_BLANK))
    .join('\n')
    .trim()
}

/** ข้อความผิดพลาดตอนยื่น — ข้อความจากด่านฐานข้อมูลเป็นภาษาไทยอยู่แล้ว ส่งต่อได้ */
export function cctvSubmitErrorText(error) {
  const message = String(error?.message ?? '')
  if (error?.code === 'PT429' || /ส่งถี่|ครบจำนวน/.test(message)) return message || 'ยื่นคำขอถี่เกินไป กรุณาลองใหม่พรุ่งนี้'
  if (error?.code === '42501') return message || 'ไม่มีสิทธิ์ยื่นคำขอนี้'
  return message ? `ส่งคำขอไม่สำเร็จ: ${message}` : 'ส่งคำขอไม่สำเร็จ กรุณาลองใหม่'
}
