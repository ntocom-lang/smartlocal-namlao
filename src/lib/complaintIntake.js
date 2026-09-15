// ระบบรับเรื่องคำร้องเอง — ตัวช่วยฝั่งหน้าเว็บ (กติกาจริงอยู่ที่ DB: 20260915100100_complaint_auto_receive.sql)
//
// DB ตั้ง status='received' ให้เองตอนยื่นเมื่อมีกอง+ผู้รับผิดชอบครบและหมวดไม่ได้ตั้ง
// requires_manual_intake ใบที่ยังค้าง pending จึงเป็น "ข้อยกเว้น" ที่แอดมินต้องลงมือ
// ไฟล์นี้ตอบว่า "ทำไมใบนี้ตกมาที่แอดมิน" เพื่อให้แอดมินรู้ว่าต้องแก้ที่ต้นเหตุ (ตั้งผู้รับผิดชอบหมวด)
// หรือแค่รับเรื่องใบนั้น ไม่ต้องเปิดดูทีละใบ
//
// ⚠️ ไฟล์นี้ต้องไม่ import supabase — เทสต์รันด้วย node ตรงๆ

export const RETURN_REASON_MIN = 5
export const RETURN_REASON_MAX = 500

// ต้องตรงกับเงื่อนไขใน return_complaint_to_intake()
export const RETURNABLE_STATUSES = ['received', 'in_progress']

const WAITING_STATUSES = new Set(['pending', 'new'])

/**
 * เหตุผลที่คำร้องค้างคิวแอดมิน หรือ null ถ้าไม่ได้ค้าง / ระบุไม่ได้ (ใบเก่าก่อนเปิดระบบรับเรื่องเอง)
 * @param {object} complaint แถวคำร้อง (ต้องมี status, category, assigned_to, department_id, extra_data)
 * @param {Record<string, {is_adhoc?: boolean, requires_manual_intake?: boolean}>} categoryMeta ธงรายหมวด key = value
 * @returns {{ kind: 'returned'|'manual'|'no_department'|'unassigned', text: string } | null}
 */
export function complaintIntakeReason(complaint, categoryMeta = {}) {
  if (!complaint || !WAITING_STATUSES.has(complaint.status)) return null

  const meta = categoryMeta?.[complaint.category] ?? {}
  // หมวดเฉพาะกิจไม่ใช้ขั้นตอนรับเรื่องเลย (status ค้าง pending ตลอดโดยเจตนา)
  if (meta.is_adhoc) return null

  const returnedReason = typeof complaint.extra_data?.returned_reason === 'string'
    ? complaint.extra_data.returned_reason.trim()
    : ''
  if (complaint.extra_data?.returned_at) {
    return {
      kind: 'returned',
      text: returnedReason ? `ผู้รับผิดชอบส่งคืน: ${returnedReason}` : 'ผู้รับผิดชอบส่งคืน',
    }
  }
  if (meta.requires_manual_intake) {
    return { kind: 'manual', text: 'หมวดนี้ต้องให้แอดมินรับเรื่องเอง' }
  }
  if (!complaint.department_id) {
    return { kind: 'no_department', text: 'หมวดนี้ยังไม่ได้ตั้งกองรับผิดชอบ' }
  }
  if (!complaint.assigned_to) {
    return { kind: 'unassigned', text: 'หมวดนี้ยังไม่ได้ตั้งผู้รับผิดชอบ' }
  }
  return null
}

/** ตรวจเหตุผลการส่งคืนก่อนเรียก RPC — คืนข้อความ error หรือ '' ถ้าผ่าน */
export function validateReturnReason(reason) {
  const length = String(reason ?? '').trim().length
  if (length < RETURN_REASON_MIN) return `กรุณาระบุเหตุผลอย่างน้อย ${RETURN_REASON_MIN} ตัวอักษร`
  if (length > RETURN_REASON_MAX) return `เหตุผลยาวได้ไม่เกิน ${RETURN_REASON_MAX} ตัวอักษร`
  return ''
}

/** ผู้ใช้คนนี้กดส่งคืนคำร้องนี้ได้หรือไม่ (DB ตรวจซ้ำอีกชั้น) */
export function canReturnComplaint(complaint, userId, categoryMeta = {}) {
  if (!complaint || !userId) return false
  if (complaint.assigned_to !== userId) return false
  if (categoryMeta?.[complaint.category]?.is_adhoc) return false
  return RETURNABLE_STATUSES.includes(complaint.status)
}
