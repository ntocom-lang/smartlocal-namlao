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

// แคปซูลของเมนูแอดมิน (โทนคราม แยกจากฝั่งเจ้าหน้าที่ให้รู้ตัวว่าอยู่ในโหมดตั้งค่า · PR2 2569-11-16)
// ขาวบน #4338ca = 7.9:1 · บน #3730a3 = 9.6:1
export const ADMIN_ACTIVE_CAPSULE = Object.freeze({
  backgroundColor: '#4338ca',
  backgroundImage: 'linear-gradient(90deg, #4338ca 0%, #3730a3 100%)',
  boxShadow: '0 6px 16px -6px rgba(67, 56, 202, 0.9), inset 0 1px 0 rgba(255, 255, 255, 0.16)',
})
// พื้นเมนูซ้าย/ลิ้นชักของแอดมิน (หินชนวนอมคราม · สีคงที่ทุก อปท. ไม่ตามสีธีมเว็บ)
export const ADMIN_NAV_BG = Object.freeze({
  backgroundColor: '#1a1f2c',
  backgroundImage: 'linear-gradient(180deg, #1e2433 0%, #151a26 100%)',
})

// ป้ายตัวเลขเรื่องค้าง: ปกติอำพัน · ตั้งแต่ 10 เรื่องเป็นแดง (เจ้าของระบบเลือก 2569-11-16) ไม่กะพริบ
export const NAV_BADGE_HOT_AT = 10
export const isHotBadge = (count) => Number(count) >= NAV_BADGE_HOT_AT

// ===== เมนูซ้ายผู้พัฒนา (PR4 2569-11-16) — โทนเทอร์มินัล สีคงที่ทุก อปท. ไม่ตามสีธีมเว็บ =====
// พื้นเมนูซ้าย/ลิ้นชัก (กรมท่าเข้ม→เกือบดำ) — ขาวบน #1b2a4a = 14.2:1 · บน #0b1220 = 18.7:1 · ขาว 80% บน #1b2a4a ≈ 9:1
export const DEV_NAV_BG = Object.freeze({
  backgroundColor: '#121c33',
  backgroundImage: 'linear-gradient(180deg, #1b2a4a 0%, #0b1220 100%)',
})
// กรอบเรืองฟ้า→ม่วงของเมนูที่เปิดอยู่ — ขาวบน #0c3a5e = 11.8:1 · บน #2e1065 = 15.2:1 (ผ่าน AA ตลอดเส้น)
export const DEV_ACTIVE_CAPSULE = Object.freeze({
  backgroundColor: '#0c3a5e',
  backgroundImage: 'linear-gradient(90deg, #0c3a5e 0%, #2e1065 100%)',
  boxShadow: 'inset 0 0 0 1px rgba(125, 211, 252, 0.6), 0 0 16px -4px rgba(167, 139, 250, 0.75)',
})
// สีกระเบื้องที่ล็อกไว้ (ม่วง/คราม/ฟ้า) — ชุดสีสุ่มด้านล่างต้องไม่ซ้ำโทนเหล่านี้ ไม่งั้นแยกที่ปรึกษา AI/จัดการโมดูล/ทั้งหมดไม่ออก
export const DEV_ADVISOR_COLOR = '#7c3aed' // ที่ปรึกษา AI (ม่วง)
export const DEV_MANAGER_COLOR = '#4f46e5' // จัดการโมดูล (คราม)
export const DEV_ALL_COLOR = '#0284c7'     // รายการ "ทั้งหมด" (ฟ้า)
export const DEV_TILE_PALETTE = Object.freeze([
  '#14b8a6', '#22c55e', '#f59e0b', '#f43f5e', '#ec4899',
  '#84cc16', '#f97316', '#06b6d4', '#eab308', '#10b981',
])
// สีประจำ "ส่วนของระบบ" จากชื่อ (ผู้พัฒนาเพิ่มส่วนใหม่ได้เอง จึงกำหนดสีรายตัวล่วงหน้าไม่ได้) — hash ข้อความแบบคงที่
// ชื่อเดิมได้สีเดิมทุกครั้ง/ทุกเครื่อง · ข้อเสีย: เปลี่ยนชื่อส่วนแล้วสีเปลี่ยนตาม และสองชื่ออาจชนสีกันได้ (palette มี 10 สี)
export function colorFromName(name, palette = DEV_TILE_PALETTE) {
  if (typeof name !== 'string' || !name || !palette.length) return palette[0]
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}
