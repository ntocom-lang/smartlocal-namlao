// "ใช้บ่อย" + ค้นหาเมนู + จำสถานะพับกลุ่ม ของเมนูซ้ายเจ้าหน้าที่ (PC + ลิ้นชักมือถือ)
// ข้อมูลทั้งหมดอยู่ใน localStorage ของเครื่องนี้เท่านั้น — ไม่ส่งขึ้นฐานข้อมูล ไม่มี SQL
//  - นับเองจากการกดเมนูจริง ไม่ต้องตั้งค่า · แยกตามรหัสผู้ใช้ (เครื่อง อปท. ใช้ร่วมหลายคน)
//  - ทุกการอ่าน/เขียนห่อ try/catch: private mode / ถูกบล็อก / โควตาเต็ม = แค่ไม่มีหมวด "ใช้บ่อย" ไม่ทำให้เมนูพัง

const USAGE_PREFIX = 'smartlocal:nav-usage:'
export const NAV_COLLAPSED_KEY = 'smartlocal:nav-collapsed'
export const NAV_COLLAPSED_EVENT = 'smartlocal:nav-collapsed-change'

// ทางเข้าระดับบนสุด ไม่ใช่ "เมนูที่เลือกใช้" — ไม่นับ (จะครองอันดับ 1 ตลอดและไม่ช่วยใครหาเมนู)
export const NAV_USAGE_IGNORED_KEYS = Object.freeze(['home', 'executive-room'])

function defaultStorage() {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

export const navUsageStorageKey = (userId) => `${USAGE_PREFIX}${userId}`

function readUsage(userId, storage) {
  try {
    const raw = storage.getItem(navUsageStorageKey(userId))
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch { return {} }
}

// บันทึกการกดเมนูหนึ่งครั้ง · ไม่มี userId / คีย์ที่ไม่นับ / storage ใช้ไม่ได้ = ไม่ทำอะไร
export function recordNavUse(userId, key, { storage = defaultStorage(), now = Date.now() } = {}) {
  if (!userId || !key || NAV_USAGE_IGNORED_KEYS.includes(key) || !storage) return false
  try {
    const usage = readUsage(userId, storage)
    const prev = usage[key]
    usage[key] = { n: (Number(prev?.n) || 0) + 1, t: now }
    storage.setItem(navUsageStorageKey(userId), JSON.stringify(usage))
    return true
  } catch { return false }
}

// คีย์ที่กดบ่อยสุด (n มากก่อน เท่ากันใช้กดล่าสุดก่อน) เฉพาะที่ยังอยู่ใน availableKeys (สิทธิ์เปลี่ยน/โมดูลถูกปิด = ตัดทิ้ง)
// ยังไม่ถึง minUses = ไม่นับ · ไม่มีข้อมูลพอ = คืน [] (ผู้เรียกไม่แสดงหมวด ไม่ใช่หมวดว่าง)
export function topNavKeys(userId, availableKeys, { limit = 4, minUses = 3, storage = defaultStorage() } = {}) {
  if (!userId || !storage) return []
  const available = new Set(availableKeys)
  const usage = readUsage(userId, storage)
  return Object.entries(usage)
    .filter(([key, v]) => available.has(key) && !NAV_USAGE_IGNORED_KEYS.includes(key) && Number(v?.n) >= minUses)
    .sort(([, a], [, b]) => (Number(b.n) - Number(a.n)) || ((Number(b.t) || 0) - (Number(a.t) || 0)))
    .slice(0, limit)
    .map(([key]) => key)
}

// ── ค้นหาเมนู ──────────────────────────────────────────────────────────────────────────
// ค้นเฉพาะรายการใน groups ที่ผู้เรียกกรองสิทธิ์มาแล้ว (ไม่สร้างเมนูหลอก) · ไม่สนตัวพิมพ์ · ตัดช่องว่างหัวท้าย
// แยกคำด้วยช่องว่างแล้วต้องเจอ "ทุกคำ" ในข้อความรวม label + ชื่อกลุ่ม + desc (ภาษาไทยไม่มีตัวพิมพ์ ใช้ includes ตรงๆ)
// คืน [{ item, group }] ตามลำดับเมนู · คีย์ซ้ำข้ามกลุ่มนับครั้งเดียว
const norm = (v) => String(v ?? '').normalize('NFC').toLowerCase()

// ชื่อที่แสดงในเมนูซ้าย (เจ้าของระบบสั่ง 2569-11-16: ชื่อเมนูบรรทัดเดียว) — ชื่อยาวมีฟิลด์ navLabel แบบสั้น (staffNavGroups.js)
// ทุกที่ที่วาดชื่อในเมนูซ้าย/ลิ้นชักเจ้าหน้าที่ต้องเรียกสองตัวนี้ ห้ามเขียน `?? label` เอง · title/aria/โหมดย่อ/หัวหน้าโมดูลใช้ label/group เต็ม
export const navText = (item) => item?.navLabel ?? item?.label
export const groupNavText = (g) => g?.navLabel ?? g?.group

export function searchNavItems(groups, query) {
  const tokens = norm(query).trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) return []
  const seen = new Set()
  const out = []
  for (const g of groups ?? []) {
    const { group, items } = g
    for (const item of items ?? []) {
      if (!item || seen.has(item.key)) continue
      // ค้นเจอทั้งชื่อเต็มและชื่อสั้น (พิมพ์ "เชื้อเพลิง" ต้องเจอยานพาหนะ แม้เมนูแสดงแค่ "ยานพาหนะ")
      const hay = norm(`${item.label} ${item.navLabel ?? ''} ${group} ${groupNavText(g) ?? ''} ${item.desc ?? ''}`)
      if (tokens.every((t) => hay.includes(t))) { seen.add(item.key); out.push({ item, group }) }
    }
  }
  return out
}

// ── สถานะพับกลุ่ม (ชุดชื่อกลุ่มที่พับ) ───────────────────────────────────────────────────
export function readCollapsedGroups(storage = defaultStorage()) {
  try {
    const parsed = JSON.parse(storage?.getItem(NAV_COLLAPSED_KEY) ?? '[]')
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [])
  } catch { return new Set() }
}

export function setGroupCollapsed(label, collapsed, storage = defaultStorage()) {
  const set = readCollapsedGroups(storage)
  if (collapsed) set.add(label)
  else set.delete(label)
  try { storage?.setItem(NAV_COLLAPSED_KEY, JSON.stringify([...set])) } catch { /* จำไม่ได้ก็แค่ไม่จำ */ }
  // แจ้งตัวอื่นในหน้าเดียวกัน (เมนูซ้าย PC กับลิ้นชักมือถือเป็นคนละอินสแตนซ์)
  try { if (typeof window !== 'undefined') window.dispatchEvent(new Event(NAV_COLLAPSED_EVENT)) } catch { /* ไม่มี window */ }
}

// ── ย่อเมนูซ้ายเหลือแต่ไอคอน (เจ้าของระบบอนุมัติ 2569-11-16) ──────────────────────────────
// จำต่อเครื่อง (ไม่ต่อผู้ใช้ ไม่ขึ้นฐานข้อมูล) · ค่าเริ่มต้น false = เมนูเต็ม · ข้อมูลเสีย/storage ใช้ไม่ได้ = เมนูเต็ม
export const NAV_RAIL_KEY = 'smartlocal:nav-rail'
export const NAV_RAIL_EVENT = 'smartlocal:nav-rail-change'

export function readNavRail(storage = defaultStorage()) {
  try { return storage?.getItem(NAV_RAIL_KEY) === '1' } catch { return false }
}

export function setNavRail(on, storage = defaultStorage()) {
  try { storage?.setItem(NAV_RAIL_KEY, on ? '1' : '0') } catch { /* จำไม่ได้ก็แค่ไม่จำ */ }
  // แจ้งตัวอื่นในหน้าเดียวกัน (เมนูซ้ายอาจถูกวาดมากกว่าหนึ่งที่)
  try { if (typeof window !== 'undefined') window.dispatchEvent(new Event(NAV_RAIL_EVENT)) } catch { /* ไม่มี window */ }
}

// ยอดรวมป้ายตัวเลขของเมนูย่อยทั้งกลุ่ม — ใช้ร่วมหัวกลุ่มโหมดเต็ม (CollapsibleNavGroup) กับโหมดย่อ (StaffNavRail) ห้ามเขียนซ้ำ
// นับเฉพาะค่าที่เป็นตัวเลขจำกัดและ > 0 (ไม่ใช่ตัวเลข/ติดลบ/ศูนย์ = ไม่นับ)
export function groupBadgeTotal(items, badges) {
  let total = 0
  for (const item of items ?? []) {
    const n = Number(badges?.[item?.key])
    if (Number.isFinite(n) && n > 0) total += n
  }
  return total
}

// พับ/กางหลายกลุ่มพร้อมกัน (ปุ่ม "ปิดทั้งหมด/เปิดทั้งหมด") — อ่านเซ็ตครั้งเดียว เขียนครั้งเดียว ยิงอีเวนต์ครั้งเดียว
// ไม่แตะกลุ่มที่ไม่อยู่ใน labels (เช่น กลุ่มที่ถูกกรองสิทธิ์ออกจากเมนูของผู้ใช้นี้)
export function setGroupsCollapsed(labels, collapsed, storage = defaultStorage()) {
  const set = readCollapsedGroups(storage)
  for (const label of Array.isArray(labels) ? labels : []) {
    if (typeof label !== 'string') continue
    if (collapsed) set.add(label)
    else set.delete(label)
  }
  try { storage?.setItem(NAV_COLLAPSED_KEY, JSON.stringify([...set])) } catch { /* จำไม่ได้ก็แค่ไม่จำ */ }
  try { if (typeof window !== 'undefined') window.dispatchEvent(new Event(NAV_COLLAPSED_EVENT)) } catch { /* ไม่มี window */ }
}
