// หมวดสายด่วนฉุกเฉิน — ใช้ร่วมกันระหว่างหน้าประชาชน (EmergencyPage) กับหลังบ้าน (AdminDashboard)
// ค่า key ต้องตรงกับ CHECK constraint ใน supabase/migrations/20260904100000_emergency_contacts_add_category.sql
// และคีย์เวิร์ดใน guessCategory() ต้องตรงกับ backfill ใน 20260904100100_emergency_contacts_backfill_category.sql
// แก้ที่ใดที่หนึ่งแล้วต้องแก้อีกฝั่งด้วย ไม่งั้นของเก่ากับของใหม่จะจัดกลุ่มคนละแบบ

export const EMERGENCY_CATEGORIES = [
  { key: 'emergency',  label: 'เหตุด่วนเหตุร้าย', emoji: '🆘', color: '#dc2626', bg: '#fee2e2' },
  { key: 'health',     label: 'สาธารณสุข',        emoji: '🏥', color: '#0284c7', bg: '#e0f2fe' },
  { key: 'utility',    label: 'สาธารณูปโภค',      emoji: '⚡', color: '#d97706', bg: '#fef3c7' },
  { key: 'government', label: 'หน่วยงานราชการ',   emoji: '🏛️', color: '#1d4ed8', bg: '#dbeafe' },
  { key: 'leader',     label: 'ผู้นำท้องถิ่น',     emoji: '👤', color: '#7c3aed', bg: '#ede9fe' },
  { key: 'other',      label: 'อื่น ๆ',            emoji: '📞', color: '#4b5563', bg: '#f3f4f6' },
]

export const EMERGENCY_CATEGORY_MAP = Object.fromEntries(
  EMERGENCY_CATEGORIES.map((c) => [c.key, c])
)

export const DEFAULT_EMERGENCY_CATEGORY = 'other'

// ข้อมูลจากแอดมินอาจเป็นค่าเก่า/ค่าว่าง/ค่าที่ไม่รู้จัก — ตกไปหมวด "อื่น ๆ" แทนที่จะหายไปจากหน้าจอ
export function emergencyCategoryOf(contact) {
  return EMERGENCY_CATEGORY_MAP[contact?.category] ? contact.category : DEFAULT_EMERGENCY_CATEGORY
}

// เดาหมวดจากชื่อ ใช้ตอนแอดมินพิมพ์ชื่อในฟอร์ม (แก้ทับได้เสมอ) — แนวเดียวกับ guessEmoji()
// ลำดับสำคัญ: ต้องจับ "นายก/กำนัน/ผู้ใหญ่บ้าน" ก่อนคำว่า "องค์การบริหารส่วนตำบล/เทศบาล"
// ไม่งั้น "นายกองค์การบริหารส่วนตำบลทุ่งแค้ว" จะตกไปหมวดหน่วยงานราชการ
export function guessCategory(label) {
  const t = String(label || '')
  if (/ตำรวจ|สภ\.|police|กู้ภัย|กู้ชีพ|EMS|ฉุกเฉิน|เจ็บป่วย|ดับเพลิง|ไฟไหม้|มูลนิธิ|ภัยพิบัติ|สายด่วน 191|1669/i.test(t)) return 'emergency'
  if (/โรงพยาบาล|รพ\.|สาธารณสุข|อนามัย|คลินิก|แพทย์|พยาบาล|อสม/.test(t)) return 'health'
  if (/ไฟฟ้า|ประปา|สิ่งปฏิกูล|สูบส้วม|ขยะ|แก๊ส|โทรศัพท์|อินเทอร์เน็ต|ไฟกิ่ง|โคมไฟ/.test(t)) return 'utility'
  if (/นายก|กำนัน|ผู้ใหญ่บ้าน|ผู้ช่วยผู้ใหญ่|สารวัตรกำนัน|สมาชิกสภา|ส\.อบต|ปลัด/.test(t)) return 'leader'
  if (/อบต|อบจ|เทศบาล|องค์การบริหารส่วน|อำเภอ|จังหวัด|ที่ว่าการ|ภาครัฐ|ราชการ|สำนักงาน|ศูนย์ดำรงธรรม|ที่ทำการ/.test(t)) return 'government'
  return DEFAULT_EMERGENCY_CATEGORY
}
