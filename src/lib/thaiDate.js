export const MONTHS_TH = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']

export function thaiDate(dateStr) {
  const d = new Date(dateStr)
  return `${d.getDate()} ${MONTHS_TH[d.getMonth()]} พ.ศ. ${d.getFullYear() + 543}`
}

// แปลงค่าจาก <input type="date"> (YYYY-MM-DD) เป็นวันที่ไทยเต็ม "1 ตุลาคม พ.ศ. 2569"
// ห้ามส่งสตริงนี้เข้า new Date(str) ตรงๆ แล้ว format — "2026-10-01" ถูก parse เป็น UTC
// เที่ยงคืน ประเทศที่ offset ติดลบจะได้วันก่อนหน้า จึงแยกตัวเลขมาสร้าง Date ตามเวลาเครื่องเอง
// คืนค่าว่างเมื่อรูปแบบไม่ตรง เพื่อให้ช่องในแบบฟอร์มพิมพ์เป็นเส้นประให้เขียนเองได้
export function thaiDateFromDateInput(value) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return ''
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return `${date.getDate()} ${MONTHS_TH[date.getMonth()]} พ.ศ. ${date.getFullYear() + 543}`
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
