// ประกอบ path โฟลเดอร์บน Google Drive ให้เจ้าหน้าที่เปิดหาไฟล์เองได้
//
// ที่มา: ทุกโมดูล (คำร้อง ท่องเที่ยว ข่าวสาร ศูนย์ข้อมูล งานช่าง บุคลากร ทะเบียนพาณิชย์) ใช้ bucket
// 'complaint-attachments' ร่วมกันเพราะยืม bucket เดิมของ Supabase Storage มาต่อ ป้ายโฟลเดอร์ฝั่ง
// Edge Function จึงขึ้นว่า "คำร้อง" หมดทุกอัน และชั้นล่างสุดตั้งชื่อด้วย uuid ผลคือเปิด Drive แล้ว
// แยกไม่ออกว่าไฟล์ไหนเป็นเรื่องอะไร (ผู้ใช้รายงาน 10 ก.ย. 2569)
//
// โครงสร้างปลายทาง: <slug อปท.> / <ปี พ.ศ.> / <โมดูล> / <เดือน หรือ ชื่อรายการ> / <เรื่อง> / <ไฟล์>
// ตัวอย่าง: namlao / 2569 / คำร้อง / 09-กันยายน / ไฟฟ้าสาธารณะ / ES-69-0133 / ES-69-0133-1.jpg
//
// สองชั้นแรก (slug + ปี พ.ศ.) Edge Function เติมให้เองจาก server time ห้ามส่งมาซ้ำ
//
// ⚠️ PDPA: ห้ามใส่ชื่อ-นามสกุล เบอร์โทร หรือที่อยู่ของประชาชนลงในชื่อโฟลเดอร์เด็ดขาด
// ชื่อโฟลเดอร์บน Drive ค้นเจอง่ายกว่าข้อมูลในระบบมาก ใช้ได้แค่เลขที่คำร้อง หมวด และเดือน

export const DRIVE_MODULES = {
  complaints: 'คำร้อง',
  tourism: 'ท่องเที่ยว',
  posts: 'ข่าวสาร',
  dataCenter: 'ศูนย์ข้อมูล',
  infra: 'งานช่าง',
  staff: 'บุคลากร',
  business: 'ทะเบียนพาณิชย์',
  events: 'กิจกรรม',
  documents: 'เอกสารหน่วยงาน',
}

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
]

/**
 * ชื่อโฟลเดอร์เดือนแบบ "09-กันยายน" — เลขนำหน้าเพื่อให้ Drive เรียงตามลำดับเดือนจริง
 * ไม่ใช่เรียงตามอักษรไทย (กันยายน จะมาก่อน มกราคม ถ้าไม่มีเลข)
 * @param {Date|string} [date] - ไม่ส่งมาก็ใช้เวลาปัจจุบัน
 */
export function driveMonthFolder(date) {
  const d = date ? new Date(date) : new Date()
  const m = Number.isNaN(d.getTime()) ? new Date().getMonth() : d.getMonth()
  return `${String(m + 1).padStart(2, '0')}-${THAI_MONTHS[m]}`
}

/**
 * ประกอบ path จาก segment ที่ให้มา ตัด segment ว่างทิ้ง และแทน '/' ในแต่ละ segment ด้วย '-'
 * เพื่อไม่ให้ค่าที่ผู้ใช้กรอก (เช่นชื่อสถานที่ที่มี /) แตกเป็นโฟลเดอร์เกินที่ตั้งใจ
 * @param {...(string|null|undefined)} segments
 */
export function driveFolderPath(...segments) {
  return segments
    .filter(s => typeof s === 'string' && s.trim())
    .map(s => s.trim().replace(/\//g, '-'))
    .join('/')
}

/**
 * โฟลเดอร์ของคำร้องหนึ่งเรื่อง: คำร้อง / 09-กันยายน / <หมวด> / <เลขที่>
 * @param {{ refNo?: string, categoryLabel?: string, createdAt?: Date|string }} complaint
 */
export function complaintFolderPath({ refNo, categoryLabel, createdAt } = {}) {
  return driveFolderPath(
    DRIVE_MODULES.complaints,
    driveMonthFolder(createdAt),
    categoryLabel || 'ไม่ระบุหมวด',
    refNo || 'ไม่มีเลขที่',
  )
}

/**
 * ชื่อไฟล์ที่อ่านออกเวลาดาวน์โหลดหลายไฟล์มารวมกัน เช่น ES-69-0133-1.jpg / ES-69-0133-ผลงาน-2.jpg
 * @param {{ refNo?: string, kind?: 'photo'|'work', index?: number, ext?: string }} opts
 */
export function complaintFileName({ refNo, kind = 'photo', index = 1, ext = 'jpg' } = {}) {
  const base = refNo || `ไม่มีเลขที่-${Date.now()}`
  const part = kind === 'work' ? 'ผลงาน-' : ''
  return `${base}-${part}${index}.${ext}`
}
