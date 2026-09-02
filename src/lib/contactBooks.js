// สมุดเบอร์โทร — เบอร์ทั้งหมดอยู่ในตาราง emergency_contacts ตารางเดียว
// แต่แยกแสดงเป็น 2 หน้า เพราะ "โทรได้ตลอด 24 ชม." กับ "โทรได้เวลาราชการ" ปนกันไม่ได้
//
// ค่า key ต้องตรงกับ CHECK constraint ใน
// supabase/migrations/20260904110000_contacts_add_book.sql
// แก้ที่ใดที่หนึ่งแล้วต้องแก้อีกฝั่ง ไม่งั้น insert จาก UI จะโดน constraint ตีกลับ
//
// คนละแกนกับ EMERGENCY_CATEGORIES ใน emergencyCategories.js:
//   book     = อยู่หน้าไหน (สายด่วน / ทำเนียบ)
//   category = จัดกลุ่มอะไรภายในหน้านั้น (ราชการ / ผู้นำ / สาธารณูปโภค ...)
// ทั้งสองหน้าใช้ EMERGENCY_CATEGORIES ชุดเดียวกันจัดกลุ่มภายใน

export const CONTACT_BOOKS = [
  {
    key: 'urgent',
    label: 'สายด่วนฉุกเฉิน',
    subtitle: 'เหตุด่วนเหตุร้าย โทรได้ตลอด 24 ชั่วโมง',
    path: '/emergency',
    emoji: '🚨',
    color: '#dc2626',
    bg: '#fee2e2',
    gradient: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)',
  },
  {
    key: 'directory',
    label: 'ทำเนียบเบอร์โทรสำคัญ',
    // ไม่ใช้คำว่า "24 ชั่วโมง" โดยตั้งใจ — เบอร์ในสมุดนี้ส่วนใหญ่รับสายเฉพาะเวลาราชการ
    subtitle: 'หน่วยงานราชการ ผู้นำท้องถิ่น และเบอร์ติดต่อในพื้นที่',
    path: '/directory',
    emoji: '📒',
    color: '#1d4ed8',
    bg: '#dbeafe',
    gradient: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
  },
]

export const CONTACT_BOOK_MAP = Object.fromEntries(
  CONTACT_BOOKS.map((b) => [b.key, b])
)

// ค่าเพี้ยน/ค่าว่างต้องตกมาที่สายด่วน ไม่ใช่หายไปเฉยๆ — เบอร์ฉุกเฉินที่ข้อมูลผิดรูป
// แล้วไม่ขึ้นบนหน้าจอ อันตรายกว่าเบอร์ที่ขึ้นผิดหน้า
export const DEFAULT_CONTACT_BOOK = 'urgent'

export function bookOf(contact) {
  return CONTACT_BOOK_MAP[contact?.book] ? contact.book : DEFAULT_CONTACT_BOOK
}

// เดาสมุดจากหมวดที่แอดมินเลือกในฟอร์ม (แก้ทับได้เสมอ) — ตรรกะเดียวกับ backfill ใน
// supabase/migrations/20260904110100_contacts_backfill_book.sql
// 'other' ตกมาที่สายด่วนเพราะเดาไม่ได้ว่าเป็นเบอร์ด่วนหรือไม่
export function guessBook(category) {
  return category === 'government' || category === 'leader' ? 'directory' : 'urgent'
}
