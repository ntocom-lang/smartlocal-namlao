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

/**
 * ต้องปักหมุดก่อนกด "ดำเนินการแล้ว" หรือไม่
 * ไม่รู้ธงของหมวด (ยังโหลดไม่เสร็จ/หมวดถูกลบ) = ขอหมุดไว้ก่อน — ปักเกินไม่เสียหาย แต่ไม่ปักแล้ว DB ปฏิเสธ
 */
export function requiresResolvedPin(categoryMeta, category) {
  const flag = categoryMeta?.[category]?.requires_resolved_location
  return flag === undefined ? true : !!flag
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
