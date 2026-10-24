// กติกาขั้นตอนคำร้องฝั่งหน้าเว็บ (กติกาจริงอยู่ที่ DB: 20260915110100_complaint_finish_by_assignee.sql)
//
// เจ้าของระบบตัดขั้น "ปิดเรื่องแล้ว" (แอดมินตรวจรับ) ออก 2569-09-15 — สถานะสุดท้ายคือ "ดำเนินการแล้ว"
// ซึ่งผู้รับผิดชอบกดเอง ในฐานข้อมูลใช้ค่า 'closed' เดิม ('completed' = ค่า legacy ของตัวเดียวกัน)
// ส่วน 'done' คือขั้นเก่า "รอแอดมินปิด" ที่ยังค้างอยู่ในข้อมูลเก่า แสดงเป็น "ดำเนินการแล้ว" เหมือนกัน
// แต่ผู้รับผิดชอบยังกด "ดำเนินการแล้ว" ซ้ำได้เพื่อบันทึกหมุดและปิดให้ครบ
//
// ⚠️ ไฟล์นี้ต้องไม่ import supabase — เทสต์รันด้วย node ตรงๆ

export const REOPEN_WINDOW_DAYS = 7
export const REOPEN_LIMIT = 1
export const REOPEN_REASON_MIN = 5
export const REOPEN_REASON_MAX = 500

export const FINISHED_STATUSES = ['closed', 'completed']
export const FINISHABLE_STATUSES = ['received', 'in_progress', 'done']

const DAY_MS = 24 * 60 * 60 * 1000

/** สถานะที่แสดงเป็น "ดำเนินการแล้ว" (รวม 'done' ขั้นเก่า) */
export function isFinishedLike(status) {
  return FINISHED_STATUSES.includes(status) || status === 'done'
}

/**
 * ผู้ใช้คนนี้เป็น "ผู้ทำงาน" ของคำร้องนี้หรือไม่ — ต้องตรงกับ complaint_worker_can_act()
 * @param {{ departmentScoped?: boolean }} [opts] departmentScoped = รายการนี้กรองมาเฉพาะกองของผู้ใช้แล้ว
 *   (หน้าเจ้าหน้าที่ของหัวหน้ากอง) — หน้าเว็บไม่รู้ว่าคำร้องอยู่กองเดียวกับ officer ไหม จึงให้ผู้เรียกยืนยัน
 *   DB ตรวจกองซ้ำอีกชั้นเสมอ
 */
export function isComplaintWorker(complaint, userId, role, opts = {}) {
  if (!complaint || !userId) return false
  if (role === 'admin' || role === 'superadmin') return true
  if (role === 'officer' && opts.departmentScoped) return true
  return complaint.assigned_to === userId
}

export function canStartWork(complaint, userId, role, categoryMeta = {}, opts = {}) {
  if (categoryMeta?.[complaint?.category]?.is_adhoc) return false
  return isComplaintWorker(complaint, userId, role, opts) && complaint.status === 'received'
}

export function canFinishWork(complaint, userId, role, categoryMeta = {}, opts = {}) {
  if (categoryMeta?.[complaint?.category]?.is_adhoc) return false
  return isComplaintWorker(complaint, userId, role, opts) && FINISHABLE_STATUSES.includes(complaint.status)
}

// ───── สถานะ "ขึ้นทะเบียนรอดำเนินการ" (parked) ─────
// เรื่องที่รับไว้แล้วแต่ อปท. ยังไม่พร้อมดำเนินการ (เช่น ซ่อมถนนเกษตรที่ยังไม่มีงบ/ยังไม่บรรจุแผน)
// เก็บรูป/พิกัดไว้เป็นข้อมูลความต้องการ ไม่นับเป็นงานค้างหรือเกินกำหนด ไม่ใช่ "ดำเนินการแล้ว" และไม่ใช่ "ปฏิเสธ"
// กติกาจริงอยู่ที่ DB: 20261025100100_complaint_parked_functions.sql (ฝั่งนี้แค่ซ่อนปุ่มให้ตรง — DB ตรวจซ้ำเสมอ)
export const PARKED_STATUS = 'parked'
export const PARKED_LABEL = 'ขึ้นทะเบียนรอดำเนินการ'
// พักได้เฉพาะเรื่องที่รับเรื่องแล้ว — เรื่องใหม่ต้องผ่านขั้นรับเรื่อง/มอบหมายก่อน
export const PARKABLE_STATUSES = ['received', 'in_progress']
// เฉพาะ role ที่ตัดสินใจจัดคิวงานได้ — ผู้รับผิดชอบทั่วไป (staff/technician) ไม่มีสิทธิ์
export const PARK_ROLES = ['admin', 'superadmin', 'officer']
export const PARK_NOTE_MAX = 500
export const PARK_BULK_MAX = 200
// รหัส/ป้ายต้องตรง park_complaints() และ CHECK complaints_parked_reason_check (tests/complaint-parked.test.mjs เทียบให้)
export const PARK_REASONS = [
  { code: 'plan',      label: 'รอบรรจุในแผนพัฒนาท้องถิ่น' },
  { code: 'budget',    label: 'รองบประมาณ' },
  { code: 'authority', label: 'รอตรวจสอบอำนาจหน้าที่/สิทธิ์ในที่ดิน' },
  { code: 'season',    label: 'รอช่วงฤดูกาลที่เหมาะสม' },
  { code: 'other',     label: 'เหตุผลอื่น' },
]
// ผู้ร้องเห็นข้อความนี้ — ไม่บอกเหตุผลภายใน ไม่สัญญากำหนดเวลา ไม่เรียกว่า "ปฏิเสธ"
export const PARKED_PUBLIC_NOTE = 'ขึ้นทะเบียนความต้องการไว้แล้ว ยังไม่มีกำหนดดำเนินการ จะแจ้งให้ทราบเมื่อมีความคืบหน้า'

// ผล skipped จาก park_complaints() → ข้อความไทย
export const PARK_SKIP_MESSAGES = {
  forbidden: 'ไม่มีสิทธิ์จัดการเรื่องนี้',
  adhoc: 'หมวดเฉพาะกิจใช้ขั้นตอนนี้ไม่ได้',
  category_not_allowed: 'หมวดนี้ยังไม่เปิดให้ขึ้นทะเบียนรอดำเนินการ',
  bad_status: 'ขึ้นทะเบียนได้เฉพาะเรื่องที่รับเรื่องแล้วหรือกำลังดำเนินการ',
  already_parked: 'อยู่ในทะเบียนอยู่แล้ว',
}

export function isParked(status) {
  return status === PARKED_STATUS
}

export function parkReasonLabel(code) {
  return PARK_REASONS.find((reason) => reason.code === code)?.label ?? ''
}

/**
 * ผู้ใช้คนนี้พักเรื่องนี้ได้หรือไม่ — ต้องตรงกับ park_complaints()
 * หมวดยังโหลดธงไม่เสร็จ/ไม่รู้ธง = ไม่แสดงปุ่ม (ต่างจาก requiresResolvedPin: พักเรื่องผิดหมวดเสียหายกว่าซ่อนปุ่มเกิน)
 */
export function canParkWork(complaint, userId, role, categoryMeta = {}, opts = {}) {
  if (!complaint || !PARK_ROLES.includes(role)) return false
  const meta = categoryMeta?.[complaint.category]
  if (meta?.is_adhoc || meta?.allow_parking !== true) return false
  return isComplaintWorker(complaint, userId, role, opts) && PARKABLE_STATUSES.includes(complaint.status)
}

/** นำกลับเข้าคิวงานได้หรือไม่ — ต้องตรง unpark_complaint() (ไม่ต้องดูธงหมวด: ปิดธงทีหลังก็ต้องดึงเรื่องกลับได้) */
export function canUnparkWork(complaint, userId, role, opts = {}) {
  if (!complaint || !PARK_ROLES.includes(role)) return false
  return isComplaintWorker(complaint, userId, role, opts) && isParked(complaint.status)
}

/** @returns {string} ข้อความผิดพลาดภาษาไทย หรือ '' ถ้าใช้ได้ */
export function validateParkInput({ reason, note } = {}) {
  if (!PARK_REASONS.some((item) => item.code === reason)) return 'กรุณาเลือกเหตุผล'
  const text = String(note ?? '').trim()
  if (reason === 'other' && !text) return 'เลือก "เหตุผลอื่น" ต้องระบุรายละเอียด'
  if (text.length > PARK_NOTE_MAX) return `หมายเหตุยาวได้ไม่เกิน ${PARK_NOTE_MAX} ตัวอักษร`
  return ''
}

/**
 * ผลจาก park_complaints() → สรุปให้เจ้าหน้าที่อ่าน
 * @param {{ parked?: number, skipped?: Array<{ id: string, code: string }> } | null} result
 * @returns {{ parked: number, skippedCount: number, lines: string[] }} lines = เหตุผลที่ข้าม รวมจำนวนต่อรหัส
 */
export function summarizeParkResult(result) {
  const skipped = Array.isArray(result?.skipped) ? result.skipped : []
  const byCode = new Map()
  for (const item of skipped) byCode.set(item?.code, (byCode.get(item?.code) ?? 0) + 1)
  const lines = [...byCode.entries()].map(([code, count]) => `${PARK_SKIP_MESSAGES[code] ?? 'ข้ามเรื่องที่ทำรายการไม่ได้'} (${count} เรื่อง)`)
  return { parked: Number(result?.parked) || 0, skippedCount: skipped.length, lines }
}

/**
 * ต้องปักหมุดก่อนกด "ดำเนินการแล้ว" หรือไม่
 * ไม่รู้ธงของหมวด (ยังโหลดไม่เสร็จ/หมวดถูกลบ) = ขอหมุดไว้ก่อน — ปักเกินไม่เสียหาย แต่ไม่ปักแล้ว DB ปฏิเสธ
 */
export function requiresResolvedPin(categoryMeta, category) {
  const flag = categoryMeta?.[category]?.requires_resolved_location
  return flag === undefined ? true : !!flag
}

/**
 * พิกัดที่ใช้เป็นหมุดจุดที่ดำเนินการได้ — ต้องตรงกับ CHECK complaints_resolved_location_check
 * (lat ±90, lng ±180, ไม่ใช่ 0,0) ใช้ไม่ได้คืน null เพื่อไม่ส่งหมุดที่ DB จะปฏิเสธ
 */
export function toPin(lat, lng) {
  if (lat == null || lng == null || lat === '' || lng === '') return null
  const la = Number(lat)
  const ln = Number(lng)
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null
  if (la < -90 || la > 90 || ln < -180 || ln > 180 || (la === 0 && ln === 0)) return null
  return { lat: la, lng: ln }
}

// แผนที่คืนพิกัดกึ่งกลางที่คลาดเศษทศนิยมได้แม้ไม่ได้เลื่อน — ห่างไม่ถึง ~1 เมตรถือเป็นจุดเดียวกัน
const SAME_PIN_EPS = 0.00001

export function isSamePin(a, b) {
  if (!a || !b) return false
  return Math.abs(a.lat - b.lat) < SAME_PIN_EPS && Math.abs(a.lng - b.lng) < SAME_PIN_EPS
}

/**
 * หมุดเริ่มต้นของกล่อง "ดำเนินการแล้ว"
 * เจ้าของระบบกำหนด 2569-09-29: ผู้ร้องปักหมุดมาแล้วใช้เป็นจุดที่ดำเนินการได้เลย ย้ายเฉพาะเมื่อผิดที่
 * — หมุดทั้งสองฝั่งเลือกบนแผนที่ (ไม่ใช่ GPS) ใครอยู่ที่ไหนก็ปักจุดไหนได้ การบังคับปักซ้ำจึงไม่ได้พิสูจน์อะไรเพิ่ม
 * หมวดที่ไม่บังคับหมุด (ภาษี/ร้องทุกข์ ฯลฯ) ไม่เติมให้ เพราะเรื่องไม่มีจุดทำงานบนแผนที่
 * ภายหลังรู้ได้ว่าผู้รับผิดชอบย้ายหมุดหรือไม่ โดยเทียบ resolved_latitude/longitude กับ latitude/longitude
 */
export function initialResolvedPin(complaint, requiresPin) {
  if (!requiresPin) return null
  return toPin(complaint?.latitude, complaint?.longitude)
}

/**
 * ผู้ร้องเปิดเรื่องกลับได้หรือไม่ — ต้องตรงกับ reopen_complaint()
 * @returns {{ allowed: boolean, reason: string, daysLeft: number }}
 */
export function reopenState(complaint, userId, now = Date.now()) {
  const no = (reason) => ({ allowed: false, reason, daysLeft: 0 })
  if (!complaint || !userId || complaint.user_id !== userId) return no('not_owner')
  if (!FINISHED_STATUSES.includes(complaint.status) || !complaint.closed_at) return no('not_finished')
  const closedAt = new Date(complaint.closed_at).getTime()
  if (Number.isNaN(closedAt)) return no('not_finished')
  const count = Number(complaint.extra_data?.reopen_count ?? 0)
  if (count >= REOPEN_LIMIT) return no('limit')
  const left = closedAt + REOPEN_WINDOW_DAYS * DAY_MS - now
  if (left <= 0) return no('expired')
  return { allowed: true, reason: '', daysLeft: Math.ceil(left / DAY_MS) }
}

export function validateReopenReason(reason) {
  const length = String(reason ?? '').trim().length
  if (length < REOPEN_REASON_MIN) return `กรุณาระบุเหตุผลอย่างน้อย ${REOPEN_REASON_MIN} ตัวอักษร`
  if (length > REOPEN_REASON_MAX) return `เหตุผลยาวได้ไม่เกิน ${REOPEN_REASON_MAX} ตัวอักษร`
  return ''
}
