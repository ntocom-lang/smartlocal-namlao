export const MONTHS_TH = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']

export function thaiDate(dateStr) {
  const d = new Date(dateStr)
  return `${d.getDate()} ${MONTHS_TH[d.getMonth()]} พ.ศ. ${d.getFullYear() + 543}`
}

// แปลง Date เป็นสตริง YYYY-MM-DD ตาม "วันตามปฏิทินของเครื่องผู้ใช้" — ใช้แทน
// toISOString().split('T')[0] ทุกจุดที่ค่านั้นจะถูกเทียบกับคอลัมน์ชนิด date ของ Postgres
// (events.event_date, complaints.due_date, civil_projects.start_date, infrastructure_works.work_date)
//
// ทำไม toISOString() ผิด: มันแปลงเป็น UTC ก่อนเสมอ ส่วนคอลัมน์ date เก็บ "วันตามปฏิทินไทย"
// ที่ไม่มี timezone ติดมาด้วย ไทยอยู่ UTC+7 จึงเพี้ยน 2 แบบ
//   1) new Date() ช่วง 00:00–06:59 น. → toISOString() ได้วันของ "เมื่อวาน" (ผิด 7 ชม.ต่อวัน)
//   2) new Date(ปี, เดือน, วัน) คือเที่ยงคืนตามเวลาเครื่อง → UTC ถอยไปวันก่อนหน้า "เสมอ"
//      (ปฏิทินกิจกรรมดึงช่วงวันที่ผิดไป 1 วันตลอดเวลา ไม่ใช่แค่ตอนเช้ามืด)
//
// ยึดตาม timezone ของเครื่องโดยตั้งใจ ไม่ hardcode Asia/Bangkok เพราะความหมายที่ต้องการคือ
// "วันนี้ของคนที่กำลังมองหน้าจออยู่" และค่าที่เอาไปเทียบ (calYear/calMonth ในปฏิทิน) ก็มาจาก
// เวลาเครื่องเหมือนกัน ต้องอยู่บนฐานเดียวกันถึงจะไม่เพี้ยน
export function toDateStr(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// วันนี้ในรูปแบบ YYYY-MM-DD ตามปฏิทินของเครื่องผู้ใช้
export function todayStr() {
  return toDateStr(new Date())
}
