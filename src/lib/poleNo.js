// เลขเสาไฟ (หมวด "ไฟฟ้าสาธารณะ" = category 'light') — เก็บเป็นคีย์ pole_no ใน complaints.extra_data
// ไม่ต้องแก้ฐานข้อมูล: submit_citizen_complaint_v4 ตรวจ extra_data แค่ "ค่าเป็น scalar, ไม่เกิน 500 ตัวอักษร,
// ไม่มีคีย์ของเจ้าหน้าที่" (whitelist 4 คีย์ใช้เฉพาะหมวด odor) ที่นี่จำกัดเองที่ 40 ตัวอักษร
// ช่องนี้ไม่บังคับ — ไม่กรอก = ทำงานเหมือนเดิมทุกอย่าง · ไม่ใช่ข้อมูลส่วนบุคคล (เลขที่ติดบนเสา)

export const POLE_NO_CATEGORY = 'light'
export const POLE_NO_MAX_LENGTH = 40

/** ตัดช่องว่าง/ตัวควบคุม + จำกัดความยาว — คืน '' ถ้าไม่มีค่า */
export function cleanPoleNo(value) {
  if (typeof value !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, POLE_NO_MAX_LENGTH)
}

/** อ่านเลขเสาจากแถวคำร้อง — คืน '' ถ้าไม่ใช่หมวดไฟฟ้าหรือไม่มีค่า */
export function getPoleNo(complaint) {
  if (complaint?.category !== POLE_NO_CATEGORY) return ''
  return cleanPoleNo(complaint?.extra_data?.pole_no)
}
