import { useState } from 'react'

// OpenMoji (openmoji.org, CC BY-SA 4.0, ฟรี) ให้ภาพไอคอนแบบแบน สีสันสด หน้าตาเหมือนกันทุกอุปกรณ์/
// เบราว์เซอร์ — ต่างจาก emoji ตัวอักษรปกติที่แต่ละ OS render ไม่เหมือนกันเลย (Windows/Mac/Android)
// ใช้ผ่าน jsDelivr CDN สาธารณะ ไม่ต้องดาวน์โหลดเก็บเอง — เดิมมี logic นี้ซ้ำกันในหลายไฟล์ (ComplaintBand,
// ComplaintCategory, AdminDashboard ฯลฯ) ต่างคนต่างเรียก native emoji กันคนละที่ ทำให้หมวดหมู่เดียวกัน
// หน้าตาไม่เหมือนกันเลยระหว่างหน้า ย้ายมารวมไว้ที่นี่ที่เดียว ให้ทุกหน้าที่โชว์ไอคอนหมวดหมู่เรียกจากจุดนี้แทน
//
// OpenMoji มีชุดเส้นขาวดำ (black) แยกจากชุดสี (color) โดยเป็น dataset เดียวกัน (ชื่อไฟล์/codepoint เหมือนกัน
// ทุกตัว) แค่คนละโฟลเดอร์บน CDN — ใช้ทำตัวเลือก "รูปแบบไอคอน" (category_icon_style ของ อปท.) ได้เลยโดย
// ไม่ต้องหาไอคอนชุดใหม่หรือมีต้นทุนเพิ่ม
export function emojiToOpenmojiUrl(emoji, style = 'color') {
  const codepoints = Array.from(emoji)
    .map(c => c.codePointAt(0).toString(16).toUpperCase())
    .filter(cp => cp !== 'FE0F') // ตัด variation selector ออก — OpenMoji ไม่ใช้ในชื่อไฟล์
  const folder = style === 'outline' ? 'black' : 'color'
  return `https://cdn.jsdelivr.net/npm/openmoji@latest/${folder}/svg/${codepoints.join('-')}.svg`
}

// emoji = ค่าจากคอลัมน์ complaint_categories.emoji — ปกติเป็นตัวอักษร emoji เดียว แต่แอดมินพิมพ์เป็น URL
// รูปเองได้ด้วยผ่านช่อง "พิมพ์เอง" ใน EmojiPickerModal (AdminDashboard.jsx) จึงต้องตรวจก่อนว่าเป็น URL
// รูปอยู่แล้วหรือเป็น emoji ตัวอักษรที่ต้องแปลงเป็น OpenMoji — ถ้าโหลดรูปไม่ได้ (เน็ตหลุด/CDN ล่ม/URL เสีย)
// จะ fallback กลับไปแสดง emoji ตัวอักษรธรรมดาแทนอัตโนมัติ
// style: 'color' (ค่าเริ่มต้น) | 'outline' | 'native' (emoji ตัวอักษรธรรมดา ไม่โหลดรูปเลย)
function isImageUrl(v) {
  return typeof v === 'string' && (v.startsWith('http') || v.startsWith('data:'))
}

export function CategoryIcon({ emoji, size = 24, className = '', style = 'color' }) {
  const [failed, setFailed] = useState(false)
  const useNative = style === 'native' && !isImageUrl(emoji) // URL ที่แอดมินตั้งเองยังต้องโชว์รูปเสมอ
  const src = emoji && !useNative ? (isImageUrl(emoji) ? emoji : emojiToOpenmojiUrl(emoji, style)) : null
  if (!src || failed) {
    return <span className={`leading-none select-none ${className}`} style={{ fontSize: size }}>{isImageUrl(emoji) ? '📋' : (emoji || '📋')}</span>
  }
  return (
    <img src={src} alt="" draggable={false} className={className}
      style={{ width: size, height: size, objectFit: 'contain' }}
      onError={() => setFailed(true)} />
  )
}
