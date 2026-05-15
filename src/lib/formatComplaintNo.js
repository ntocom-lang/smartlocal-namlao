/**
 * แปลงเลขลำดับคำร้องเป็นรหัสในรูปแบบ {ปี พ.ศ. 2 หลัก}{เดือน 2 หลัก}{ลำดับ 3 หลัก}
 * เช่น complaintNumber=1, date=2026-05-13 → "6905001"
 *
 * @param {number|null|undefined} num - เลขลำดับจาก DB
 * @param {string|Date} [date]        - วันที่สร้างคำร้อง (ใช้วันปัจจุบันถ้าไม่ระบุ)
 * @returns {string} รหัสคำร้อง เช่น "6905001" หรือ "—" ถ้าไม่มีเลข
 */
export function fmtNo(num, date) {
  if (!num) return '—'
  const d = date ? new Date(date) : new Date()
  const beYear = d.getFullYear() + 543
  const yy = String(beYear).slice(-2)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const seq = String(num).padStart(3, '0')
  return `${yy}${mm}${seq}`
}
