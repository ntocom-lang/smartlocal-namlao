// สีไอคอนของ "เมนูแบบไอคอน" (src/components/common/MenuTileGrid.jsx)
//
// ไอคอนในเมนูเป็นสีขาวบนพื้นสีประจำเมนู — แต่สีประจำเมนูเดิมหลายสีอ่อนเกินไปสำหรับไอคอนขาว
// (ส้ม #f59e0b ตัดกับขาวแค่ 2.1:1 เหลือง/เขียวมิ้นต์ก็ใกล้เคียง) WCAG 2.1 ข้อ 1.4.11 กำหนดให้ส่วนที่ต้อง
// ใช้เข้าใจ (ไอคอนที่ไม่มีข้อความกำกับในตัว) ตัดกับพื้นอย่างน้อย 3:1
//
// จึงคำนวณเฉดเองที่นี่ ไม่ใช้ CSS color-mix: WebView ของแอป Android รุ่นเก่าไม่รองรับแล้วจะตกไปเป็น
// สีเดิมที่ตัดกันไม่พอ โดยไม่มีอะไรฟ้อง — ฟังก์ชันล้วน ไม่แตะ DOM จึงเทสต์ด้วย node ตรงๆ ได้
// (tests/menu-tile-color.test.mjs)

export const MIN_ICON_CONTRAST = 3
// เผื่อไว้เหนือเกณฑ์: ปลายไล่เฉดฝั่งสว่างต้องไม่ต่ำกว่า 3:1 แม้ปัดเศษแล้ว
const TARGET_CONTRAST = 3.4
const FALLBACK_HEX = '#475569'

export function parseHex(hex) {
  if (typeof hex !== 'string') return null
  const m = hex.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map(c => c + c).join('') : m[1]
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
}

function toHex(rgb) {
  return `#${rgb.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`
}

// weight = น้ำหนักของสี b (0 = a ล้วน, 1 = b ล้วน)
function mix(a, b, weight) {
  return a.map((v, i) => v + (b[i] - v) * weight)
}

// ความสว่างสัมพัทธ์ตามนิยาม WCAG 2.x
export function luminance(rgb) {
  const [r, g, b] = rgb.map(v => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastWithWhite(rgb) {
  return 1.05 / (luminance(rgb) + 0.05)
}

// คืนเฉดที่ใช้วาดไอคอน: base (ปลายสว่างของไล่เฉด) กับ bottom (ปลายเข้ม) · base ผ่าน 3:1 กับขาวเสมอ
// สีที่เข้มพออยู่แล้วคงเดิม — ปรับเฉพาะสีที่อ่อนเกิน ไม่ย้อมทุกสีให้หม่นเหมือนกันหมด
export function tileShades(hex) {
  let rgb = parseHex(hex) ?? parseHex(FALLBACK_HEX)
  for (let i = 0; i < 30 && contrastWithWhite(rgb) < TARGET_CONTRAST; i += 1) {
    rgb = mix(rgb, [0, 0, 0], 0.06)
  }
  return { base: toHex(rgb), bottom: toHex(mix(rgb, [0, 0, 0], 0.24)), rgb }
}

// style ของกล่องไอคอน — ไล่เฉด + เงาเรืองสีเดียวกับไอคอน + ขอบบนสว่างบางๆ ให้ดูนูน
export function tileIconStyle(hex) {
  const { base, bottom, rgb } = tileShades(hex)
  const [r, g, b] = rgb.map(Math.round)
  return {
    background: `linear-gradient(150deg, ${base} 0%, ${bottom} 100%)`,
    boxShadow: `0 6px 14px -5px rgba(${r}, ${g}, ${b}, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.28)`,
  }
}
