// ล็อกตัวเลขสรุปเรื่องร้องเรียนรายเดือน (เฟส 2) — ตรรกะล้วนฝั่งหน้าจอ ไม่ import supabase/React เทสต์รันด้วย node ตรงๆ
//
// ฝั่งฐานข้อมูล (supabase/migrations/20261019140000_complaint_monthly_snapshots.sql):
//   complaint_monthly_snapshot_get(_municipality_id, _period_month)      → ชุดที่ล็อกล่าสุด หรือ null (ใครก็เรียกได้)
//   publish_complaint_monthly_snapshot(_municipality_id, _period_month, _note) → คำนวณใหม่ฝั่งฐานข้อมูลแล้วเก็บ (เฉพาะผู้มีสิทธิ์)
// หน้าจอไม่ส่งตัวเลขไปให้ฐานข้อมูล — สิ่งที่ถูกล็อกคือที่ฐานข้อมูลนับเอง ณ ตอนกด ฝั่งนี้มีหน้าที่แค่เลือกว่าจะโชว์ปุ่มให้ใคร
// และอธิบายผล (ตัวเลขสดต่างจากที่ล็อกตรงไหน)

// บทบาทที่ "เห็นปุ่มล็อก" — ต้องตรงกับ v_role IN (...) ในฟังก์ชัน publish ฝั่งฐานข้อมูล (เทสต์อ่านทั้งสองไฟล์มาเทียบ)
// superadmin ผ่านทุก อปท. ฝั่งฐานข้อมูลอยู่แล้ว · ปุ่มที่โชว์เกินสิทธิ์จริงจะถูกฐานข้อมูลปฏิเสธ (42501) ไม่ใช่ช่องโหว่ แต่เป็นปุ่มหลอก
export const LOCK_ROLES = ['admin', 'officer', 'staff']
export const canLockMonth = role => role === 'superadmin' || LOCK_ROLES.includes(role)

// ฟิลด์ของ complaint_stats_fy ที่ชุดที่ล็อกเก็บไว้ (ไม่มี this_month) พร้อมป้ายภาษาไทยที่ใช้อธิบายความต่าง
export const STAT_FIELDS = [
  { key: 'total', label: 'รับเรื่องทั้งหมด' },
  { key: 'resolved', label: 'เสร็จสิ้น' },
  { key: 'in_progress', label: 'กำลังดำเนินการ' },
  { key: 'open', label: 'รอรับ / รับเรื่องแล้ว' },
  { key: 'rejected', label: 'ยกเลิก / ไม่รับเรื่อง' },
  // complaint_stats_fy ใส่คีย์นี้เฉพาะเมื่อมีเรื่องขึ้นทะเบียนรอดำเนินการ (> 0) — ชุดที่ล็อกก่อนมีสถานะนี้ไม่มีคีย์ = null เท่ากับสดที่ไม่มีคีย์
  { key: 'parked', label: 'ขึ้นทะเบียนรอดำเนินการ' },
  { key: 'avg_days', label: 'ระยะเวลาเฉลี่ย (วัน)' },
]

const asNumber = value => (value === null || value === undefined || value === '' ? null : Number(value))

/**
 * ตัวเลขสดตอนนี้ต่างจากชุดที่ล็อกตรงไหนบ้าง — ใช้บอกเจ้าหน้าที่ก่อนตัดสินใจล็อกใหม่
 * (ฐานข้อมูลตัดสินเองว่า "เท่าเดิม" หรือไม่ตอนกด ฟังก์ชันนี้แค่ให้เห็นล่วงหน้า)
 * @returns {Array<{ key: string, label: string, locked: number | null, live: number | null }>}
 */
export function statsDifferences(locked, live) {
  if (!locked || !live) return []
  return STAT_FIELDS
    .map(({ key, label }) => ({ key, label, locked: asNumber(locked[key]), live: asNumber(live[key]) }))
    .filter(({ locked: before, live: after }) => before !== after)
}

/** ยอดรายหมวดจากชุดที่ล็อก → [{category, total}] (ตัดแถวผิดรูปทิ้ง ไม่ให้ชื่อหมวดแปลกปลอมหรือเลขติดลบเข้ากราฟ) */
export function categoryCountsOf(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.categories)) return []
  return snapshot.categories
    .filter(entry => entry && typeof entry.category === 'string' && entry.category && Number.isFinite(Number(entry.total)) && Number(entry.total) >= 0)
    .map(entry => ({ category: entry.category, total: Number(entry.total) }))
}

/** รายการย่อยของหมวดหนึ่งจากชุดที่ล็อก → [{issue_label, total}] หรือ null เมื่อไม่มี (รูปเดียวกับที่ฟังก์ชันสดคืน) */
export function issueRowsOf(snapshot, category) {
  const group = Array.isArray(snapshot?.issue_breakdown)
    ? snapshot.issue_breakdown.find(entry => entry?.category === category)
    : null
  return Array.isArray(group?.rows) ? group.rows : null
}

/**
 * ข้อความภาษาไทยจาก error ของการกดล็อก — ข้อความที่ฐานข้อมูลยกเอง (22023/40001) เป็นภาษาไทยและไม่มีข้อมูลบุคคลอยู่แล้ว
 * แสดงตรงๆ ได้ · error แบบอื่น (เครือข่าย, รูปแบบไม่คาดคิด) ไม่โชว์ข้อความดิบให้ผู้ใช้
 */
export function lockErrorText(error) {
  const code = error?.code
  const message = typeof error?.message === 'string' ? error.message : ''
  if (code === '42501') return 'ไม่มีสิทธิ์ล็อกตัวเลขของหน่วยงานนี้ (เฉพาะผู้ดูแลระบบและเจ้าหน้าที่)'
  if (code === '40001') return 'ข้อมูลเรื่องร้องเรียนกำลังเปลี่ยนระหว่างคำนวณ กรุณากดอีกครั้ง'
  // [฀-๿] = บล็อกอักษรไทย: ข้อความที่ไม่มีตัวอักษรไทยเลยไม่ใช่ข้อความที่ฟังก์ชันของเรายกขึ้น (ไม่แสดงดิบ)
  if (code === '22023' && /[฀-๿]/.test(message)) return message
  if (code === 'PGRST202' || code === '42883') return 'ระบบล็อกตัวเลขยังไม่พร้อมใช้งานบนฐานข้อมูลนี้'
  return 'ล็อกตัวเลขไม่สำเร็จ กรุณาลองอีกครั้ง'
}

/** เหตุผลที่ล็อกใหม่ต้องมีเนื้อหาพอ (ฐานข้อมูลบังคับแค่ไม่ว่าง — หน้าจอบังคับสั้นๆ ให้พอย้อนตรวจได้) */
export const MIN_NOTE_LENGTH = 5
export const MAX_NOTE_LENGTH = 500
export const noteIsValid = note => {
  const text = String(note ?? '').trim()
  return text.length >= MIN_NOTE_LENGTH && text.length <= MAX_NOTE_LENGTH
}
