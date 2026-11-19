import { useState, useEffect } from 'react'
import { glyphNameFor, hasGlyphIcon } from './categoryGlyphNames'

// re-export ให้หน้าอื่นเรียกจากจุดเดียวกับ CategoryIcon — ใช้ตัดสินใจเรื่องกล่องพื้นหลังในโหมด 'glyph'
// (isPlainGlyph อยู่ที่ categoryGlyphNames.js ไม่ re-export ที่นี่ — ไฟล์นี้เป็นไฟล์คอมโพเนนต์ ส่งออกฟังก์ชันล้วนเพิ่มจะชน react-refresh)
export { hasGlyphIcon }

// โหลดตัวไอคอน Phosphor แบบ lazy ครั้งเดียวต่อแอป (cache ระดับโมดูล) — เฉพาะ อปท. ที่ใช้ 'glyph' เท่านั้นที่ต้องดึง chunk นี้
let glyphIconsCache = null
let glyphIconsPromise = null
function loadGlyphIcons() {
  if (!glyphIconsPromise) {
    glyphIconsPromise = import('./categoryGlyphIcons')
      .then(m => (glyphIconsCache = m.GLYPH_ICONS))
      .catch(() => { glyphIconsPromise = null; return null }) // โหลดไม่ได้ (เน็ตหลุด) ให้ลองใหม่ครั้งหน้า ไม่ค้างเป็น null ถาวร
  }
  return glyphIconsPromise
}

// คืนตารางไอคอนเมื่อพร้อม · null ระหว่างรอ · 'failed' เมื่อโหลดไม่สำเร็จ (ผู้เรียกตกไปใช้ภาพสีแทน ไม่ให้ไอคอนหาย)
function useGlyphIcons(enabled) {
  const [state, setState] = useState(glyphIconsCache)
  useEffect(() => {
    if (!enabled || glyphIconsCache) return undefined
    let alive = true
    loadGlyphIcons().then(m => { if (alive) setState(m || 'failed') })
    return () => { alive = false }
  }, [enabled])
  return enabled ? (glyphIconsCache || state) : null
}

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
//        | 'glyph' (ไอคอนทึบสีเดียว Phosphor "fill" สีตาม prop color — ค่าเริ่มต้นสีประจำ อปท.)
//          emoji ที่ไม่มีไอคอนทึบ → ใช้ภาพ OpenMoji ชุดสีเหมือน style 'color' · emoji ที่เป็น URL รูป → รูปเหมือนเดิม
function isImageUrl(v) {
  return typeof v === 'string' && (v.startsWith('http') || v.startsWith('data:'))
}

export function CategoryIcon({ emoji, size = 24, className = '', style = 'color', color = 'var(--color-primary)' }) {
  const [failed, setFailed] = useState(false)
  // emoji ว่างในโหมด glyph ให้เป็น 📋 เหมือนที่โหมดอื่นแสดงอยู่แล้ว (ไม่ปล่อยช่องว่าง)
  const glyphName = style === 'glyph' && !isImageUrl(emoji) ? glyphNameFor(emoji || '📋') : null
  const glyphIcons = useGlyphIcons(!!glyphName)
  if (glyphName && glyphIcons !== 'failed') {
    const Icon = glyphIcons?.[glyphName]
    // ระหว่างรอ chunk ไอคอน (ครั้งแรกของ session เท่านั้น) กันที่ไว้เท่าขนาดจริง เลย์เอาต์ไม่กระตุก
    if (!Icon) return <span aria-hidden="true" className={className} style={{ display: 'inline-block', width: size, height: size }} />
    // สีผ่าน CSS color + currentColor ไม่ใส่ var(...) ลงแอตทริบิวต์ fill ตรงๆ — ทำงานชัวร์ทุกเบราว์เซอร์
    return <Icon size={size} weight="fill" color="currentColor" aria-hidden="true" className={className} style={{ color, flexShrink: 0 }} />
  }
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
