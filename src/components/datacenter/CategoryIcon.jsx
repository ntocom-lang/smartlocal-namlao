import { isIconImage } from '../../lib/dataCenterGroupIcon'

// ไอคอนของกลุ่มหลัก/ประเภทย่อย 1 ตัว — ค่าที่ได้จาก resolveGroupEmoji()/resolveEntryEmoji() เป็นได้
// ทั้งอิโมจิ (ข้อความ) และรูปที่แอดมินแนบเอง (data URL) จึงต้องผ่านตัวนี้ทุกจุดที่แสดงผล ไม่งั้นหน้าที่
// ยัง render เป็น {emoji} ตรงๆ จะโชว์สตริง "data:image/png;base64,..." ยาวเหยียดแทนรูป
//
// ขนาดรูปผูกกับ font-size ของที่ที่มันไปวาง เพื่อให้ไอคอนรูปกับอิโมจิสูงเท่ากันเสมอ โดยที่จุดเรียกใช้
// ไม่ต้องส่งขนาดมาเอง — การ์ดกลุ่มที่เป็น text-2xl ได้รูปใหญ่ ส่วนแถวตาราง text-xs ได้รูปเล็กตามกัน
//
// ทำไมเป็น 1.15em ไม่ใช่ 1em: glyph อิโมจิของฟอนต์ระบบ (Segoe UI Emoji / Noto Color Emoji / Apple
// Color Emoji) วาดล้นกล่อง em ออกมาราว 15% ถ้าตั้งรูปไว้ 1em เป๊ะ รูปที่แนบจะดูเล็กกว่าอิโมจิข้างๆ
// อย่างเห็นได้ชัดทั้งที่ตัวเลข font-size เท่ากัน — 1.15em คือขนาดที่ "ตาเห็นว่าเท่ากัน" จริง
export default function CategoryIcon({ value, alt = '', className = '' }) {
  if (!value) return null
  if (!isIconImage(value)) return <span className={`leading-none ${className}`}>{value}</span>
  return (
    <img src={value} alt={alt} loading="lazy" draggable={false}
      className={`inline-block w-[1.15em] h-[1.15em] object-contain align-[-0.2em] shrink-0 ${className}`} />
  )
}
