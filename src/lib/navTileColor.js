// สีกระเบื้องไอคอนของเมนูซ้าย (เจ้าของระบบอนุมัติแบบพรีเมียม 2569-11-16)
// รับสีเดิมของเมนู (ฟิลด์ color ใน staffNavGroups ชุดเดียวกับหน้าเมนูแบบไอคอน) แล้ว "เข้มให้เอง" จนไอคอนสีขาว
// บนกระเบื้องมี contrast ≥ 3:1 ตาม WCAG 1.4.11 (ส่วนประกอบที่ไม่ใช่ตัวอักษร) — คนเพิ่มเมนูใหม่ใส่สีอะไรก็ได้
// ไม่ต้องมานั่งไล่ค่าสีเอง เช่น #f59e0b (อำพัน) ขาวบนสีนี้ได้แค่ 2.1:1 → ระบบเข้มเป็นราว #b07208
// ไฟล์นี้เป็นฟังก์ชันล้วน (ไม่ import อะไร) เทสต์ด้วย node ได้ตรงๆ: tests/nav-usage.test.mjs

const HEX = /^#?([0-9a-f]{6})$/i
const FALLBACK = '#475569'

function toRgb(hex) {
  const m = HEX.exec(String(hex ?? '').trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [n >> 16, (n >> 8) & 255, n & 255]
}

const toHex = (rgb) => `#${rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`

// relative luminance ตามนิยาม WCAG 2.x
export function luminance(hex) {
  const rgb = toRgb(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export const contrastWithWhite = (hex) => 1.05 / (luminance(hex) + 0.05)

export function darken(hex, factor) {
  const rgb = toRgb(hex)
  return rgb ? toHex(rgb.map(v => v * factor)) : FALLBACK
}

// สีพื้นกระเบื้องที่ไอคอนขาวอ่านออก (≥ minRatio) · สีที่อ่านไม่ออก/ไม่ใช่ hex 6 หลัก = เทาหินชนวน
const cache = new Map()
export function tileColor(hex, minRatio = 3) {
  const key = `${hex}|${minRatio}`
  if (cache.has(key)) return cache.get(key)
  let c = toRgb(hex) ? toHex(toRgb(hex)) : FALLBACK
  for (let i = 0; i < 40 && contrastWithWhite(c) < minRatio; i++) c = darken(c, 0.94)
  cache.set(key, c)
  return c
}

// พื้นกระเบื้องแบบไล่เฉด (มุมซ้ายบนสว่าง → ขวาล่างเข้มลง 22%) — ปลายเข้มกว่าต้น contrast จึงไม่ต่ำกว่าจุดเริ่ม
export function tileGradient(hex) {
  const c = tileColor(hex)
  return `linear-gradient(135deg, ${c} 0%, ${darken(c, 0.78)} 100%)`
}

// แคปซูลไล่เฉดของเมนูที่เปิดอยู่ (เมนูซ้าย PC เจ้าหน้าที่) — ขาวบน #1d4ed8 = 6.7:1 · บน #0e6f8a = 5.7:1 (ผ่าน AA ตลอดเส้น)
export const NAV_ACTIVE_CAPSULE = Object.freeze({
  backgroundColor: '#1d4ed8',
  backgroundImage: 'linear-gradient(90deg, #1d4ed8 0%, #0e6f8a 100%)',
  boxShadow: '0 6px 16px -6px rgba(14, 111, 138, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.18)',
})

// ป้ายตัวเลขเรื่องค้าง: ปกติอำพัน · ตั้งแต่ 10 เรื่องเป็นแดง (เจ้าของระบบเลือก 2569-11-16) ไม่กะพริบ
export const NAV_BADGE_HOT_AT = 10
export const isHotBadge = (count) => Number(count) >= NAV_BADGE_HOT_AT
