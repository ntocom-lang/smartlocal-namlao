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
// (เจ้าของระบบสั่ง 2569-11-16: โทนนุ่มสบายตา — กระเบื้องในเมนูซ้ายเลิกใช้ตัวนี้แล้ว ใช้ softTileStyle() แทน · คงไว้เผื่อที่อื่นเรียก)
export function tileGradient(hex) {
  const c = tileColor(hex)
  return `linear-gradient(135deg, ${c} 0%, ${darken(c, 0.78)} 100%)`
}

// ===== กระเบื้องโทนนุ่ม (เจ้าของระบบสั่ง 2569-11-16: โทนนุ่มสบายตา — เดิมพื้นสีทึบ+ไอคอนขาว "สว่างไป บางคนแสบตา") =====
// พื้นโปร่ง 18% ของสีเดิม + ขอบ 1px 32% + ไอคอนเป็นสีอ่อนของสีเดิม · ใช้สีเดิมของเมนูตรงๆ (ไม่เข้มให้ผ่านขาวแบบ tileColor)
// hex ไม่ถูกต้อง = เทาหินชนวน FALLBACK
export function hexToRgba(hex, alpha) {
  const [r, g, b] = toRgb(hex) ?? toRgb(FALLBACK)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// ผสมสีเดิมกับขาวทีละขั้น (ขั้นละ 8%) จน relative luminance ≥ 0.5 — ไอคอนสีอ่อนที่ยังเห็นเป็นโทนเดียวกับสีเมนู
// สีที่สว่างพออยู่แล้วไม่ถูกเปลี่ยน
const tintCache = new Map()
export function tileTint(hex) {
  const key = String(hex)
  if (tintCache.has(key)) return tintCache.get(key)
  const base = toRgb(hex) ?? toRgb(FALLBACK)
  let c = toHex(base)
  for (let t = 0.08; t <= 1.0001 && luminance(c) < 0.5; t += 0.08) c = toHex(base.map(v => v + (255 - v) * t))
  tintCache.set(key, c)
  return c
}

export function softTileStyle(hex) {
  return { backgroundColor: hexToRgba(hex, 0.18), borderColor: hexToRgba(hex, 0.32), color: tileTint(hex) }
}

// ผสมสีโปร่งแสงบนพื้น → สีทึบที่ตาเห็นจริง (ใช้วัด contrast ในเทสต์ · ผลเป็น hex)
export function composite(fgHex, alpha, bgHex) {
  const fg = toRgb(fgHex) ?? toRgb(FALLBACK)
  const bg = toRgb(bgHex) ?? toRgb(FALLBACK)
  return toHex(fg.map((v, i) => v * alpha + bg[i] * (1 - alpha)))
}

// contrast ratio ของสองสีใดๆ (WCAG 2.x) — ลำดับสว่าง/เข้มไม่สำคัญ
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// แถบเมนูที่เปิดอยู่ (เมนูซ้าย PC เจ้าหน้าที่) — เจ้าของระบบสั่ง 2569-11-16: โทนนุ่มสบายตา (เดิมแคปซูลน้ำเงินทึบ + เงาฟ้า)
// ฟ้าโปร่ง→เขียวน้ำทะเลจาง + เส้นขอบใน 1px · ตัวขาวยังอ่านออก (วัดจริงใน tests/nav-usage.test.mjs)
export const NAV_ACTIVE_CAPSULE = Object.freeze({
  backgroundColor: 'rgba(96, 165, 250, 0.09)',
  backgroundImage: 'linear-gradient(90deg, rgba(96, 165, 250, 0.12) 0%, rgba(45, 212, 191, 0.04) 100%)',
  boxShadow: 'inset 0 0 0 1px rgba(147, 197, 253, 0.12)',
})

// แถบของเมนูแอดมิน (โทนคราม แยกจากฝั่งเจ้าหน้าที่ให้รู้ตัวว่าอยู่ในโหมดตั้งค่า · PR2 2569-11-16)
// เจ้าของระบบสั่ง 2569-11-16: โทนนุ่มสบายตา — ครามโปร่ง + เส้นขอบใน 1px (เดิมครามทึบ + เงา)
export const ADMIN_ACTIVE_CAPSULE = Object.freeze({
  backgroundColor: 'rgba(129, 140, 248, 0.08)',
  backgroundImage: 'linear-gradient(90deg, rgba(129, 140, 248, 0.12) 0%, rgba(99, 102, 241, 0.05) 100%)',
  boxShadow: 'inset 0 0 0 1px rgba(165, 180, 252, 0.15)',
})
// พื้นเมนูซ้าย/ลิ้นชักของแอดมิน (หินชนวนอมคราม · สีคงที่ทุก อปท. ไม่ตามสีธีมเว็บ)
export const ADMIN_NAV_BG = Object.freeze({
  backgroundColor: '#1a1f2c',
  backgroundImage: 'linear-gradient(180deg, #1e2433 0%, #151a26 100%)',
})

// ป้ายตัวเลขเรื่องค้าง: ปกติอำพัน · ตั้งแต่ 10 เรื่องเป็นแดง (เจ้าของระบบเลือก 2569-11-16) ไม่กะพริบ
// ป้ายตัวเลข (NavBadge) โทนนุ่ม 2569-11-16: สีอ่อนบนชั้นทึบ BADGE_BASE + สีโปร่งทับ — ชั้นทึบทำให้ contrast คงที่ไม่ว่าป้ายอยู่บนแผงหรือแถว active
export const BADGE_BASE = '#111c33'
export const BADGE_TONES = Object.freeze({
  normal: Object.freeze({ text: '#fcd34d', tint: 'rgba(251,191,36,0.18)', ring: 'rgba(251,191,36,0.38)', tintHex: '#fbbf24', alpha: 0.18 }),
  hot: Object.freeze({ text: '#fca5a5', tint: 'rgba(248,113,113,0.22)', ring: 'rgba(248,113,113,0.45)', tintHex: '#f87171', alpha: 0.22 }),
})
export const NAV_BADGE_HOT_AT = 10
export const isHotBadge = (count) => Number(count) >= NAV_BADGE_HOT_AT

// ===== เมนูซ้ายผู้พัฒนา (PR4 2569-11-16) — โทนเทอร์มินัล สีคงที่ทุก อปท. ไม่ตามสีธีมเว็บ =====
// พื้นเมนูซ้าย/ลิ้นชัก (กรมท่าเข้ม→เกือบดำ) — ขาวบน #1b2a4a = 14.2:1 · บน #0b1220 = 18.7:1 · ขาว 80% บน #1b2a4a ≈ 9:1
export const DEV_NAV_BG = Object.freeze({
  backgroundColor: '#121c33',
  backgroundImage: 'linear-gradient(180deg, #1b2a4a 0%, #0b1220 100%)',
})
// แถบฟ้า→ม่วงโปร่งของเมนูที่เปิดอยู่ — เจ้าของระบบสั่ง 2569-11-16: โทนนุ่มสบายตา (เดิมกรอบเรืองด้านนอก+พื้นทึบ) เอาแสงเรืองออกแล้ว
// ตัวขาวยังอ่านออก (วัดจริงใน tests/nav-usage.test.mjs)
export const DEV_ACTIVE_CAPSULE = Object.freeze({
  backgroundColor: 'rgba(56, 189, 248, 0.06)',
  backgroundImage: 'linear-gradient(90deg, rgba(56, 189, 248, 0.09) 0%, rgba(167, 139, 250, 0.09) 100%)',
  boxShadow: 'inset 0 0 0 1px rgba(125, 211, 252, 0.18)',
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
