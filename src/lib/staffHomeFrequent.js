// ทางลัด "ใช้บ่อย" บนหน้าแรกเจ้าหน้าที่ — ระบบเรียงให้เองจากโมดูลที่บัญชีนี้เปิดจริงบนเครื่องนี้
// ไม่มีช่องให้กรอก ไม่มีปุ่มให้ตั้งค่า (ตามหลัก "ช่วยงาน ไม่เพิ่มงาน")
//
// เก็บใน localStorage เท่านั้น ไม่ลงฐานข้อมูล: ไม่มีข้อมูลส่วนบุคคล ไม่กินโควตา Supabase ไม่ต้อง migration
// ข้อเสียที่ยอมรับ: แยกตามเครื่อง (เปลี่ยนเครื่อง = เริ่มนับใหม่) จึงต้องมีค่าเริ่มต้นรองรับเสมอ
//
// นับแบบ "ลดค่าตามเวลา" (ครึ่งชีวิต 30 วัน) ไม่ใช่นับสะสม เพื่อให้ทางลัดตามพฤติกรรมช่วงนี้
// คนที่เปลี่ยนงาน/ย้ายกองแล้วไม่ต้องรอให้ยอดเก่าถูกแซง
// รูปแบบที่เก็บ: { [moduleKey]: { s: คะแนนที่ลดค่าแล้ว ณ เวลา t, t: เวลาที่เปิดล่าสุด (ms) } }

const PREFIX = 'sl:staff-freq:v1'
const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000
const MAX_ENTRIES = 40
const MAX_KEY_LEN = 60
// หน้าที่ไม่ใช่ "งาน" — นับแล้วจะติดอันดับหนึ่งตลอด ทั้งที่ไม่ใช่ทางลัดที่มีประโยชน์
const NEVER_RECORD = new Set(['home', 'menu'])

export function frequentStorageKey(tenantId, profileId) {
  return `${PREFIX}:${tenantId}:${profileId}`
}

/** localStorage ที่ปลอดภัย — คืน null เมื่อเบราว์เซอร์ปิด/บล็อก storage (โหมดส่วนตัว ฯลฯ) */
export function safeLocalStorage() {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}

export function decayedScore(entry, now = Date.now()) {
  if (!entry || !(entry.s > 0) || !(entry.t > 0)) return 0
  return entry.s * Math.pow(0.5, Math.max(0, now - entry.t) / HALF_LIFE_MS)
}

function sanitize(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [key, entry] of Object.entries(raw)) {
    if (key.length === 0 || key.length > MAX_KEY_LEN) continue
    const s = Number(entry?.s)
    const t = Number(entry?.t)
    if (Number.isFinite(s) && s > 0 && Number.isFinite(t) && t > 0) out[key] = { s, t }
  }
  return out
}

export function readUsage(storage, tenantId, profileId) {
  if (!storage || !tenantId || !profileId) return {}
  try {
    const text = storage.getItem(frequentStorageKey(tenantId, profileId))
    return text ? sanitize(JSON.parse(text)) : {}
  } catch {
    return {}
  }
}

/** บันทึกว่าเปิดโมดูล moduleKey 1 ครั้ง · พังเงียบๆ ได้ (storage เต็ม/ถูกปิด) เพราะเป็นแค่ความสะดวก */
export function recordUsage(storage, tenantId, profileId, moduleKey, now = Date.now()) {
  if (!storage || !tenantId || !profileId) return
  if (typeof moduleKey !== 'string' || !moduleKey || moduleKey.length > MAX_KEY_LEN || NEVER_RECORD.has(moduleKey)) return
  try {
    const usage = readUsage(storage, tenantId, profileId)
    usage[moduleKey] = { s: decayedScore(usage[moduleKey], now) + 1, t: now }
    const kept = Object.entries(usage)
      .sort((a, b) => decayedScore(b[1], now) - decayedScore(a[1], now))
      .slice(0, MAX_ENTRIES)
    storage.setItem(frequentStorageKey(tenantId, profileId), JSON.stringify(Object.fromEntries(kept)))
  } catch {
    /* ไม่บันทึกก็แค่ทางลัดไม่อัปเดต */
  }
}

/**
 * เลือกทางลัดที่จะโชว์ (คืนเป็นลิสต์ key เรียงแล้ว)
 *  - allowedKeys: โมดูลที่บัญชีนี้เห็นจริง (ผ่านสิทธิ์ + โมดูลที่ อปท. เปิดแล้ว) — ห้ามโชว์ทางลัดไปหน้าที่เข้าไม่ได้
 *  - exclude: key ที่ไม่ต้องการซ้ำ (เช่นมีการ์ด "งานค้าง" ของมันขึ้นอยู่แล้ว)
 *  - defaults: ใช้เติมเมื่อประวัติยังน้อย (คนใหม่/เครื่องใหม่) เพื่อให้ช่องนี้ไม่ว่างและไม่ต้องรอสะสม
 *  - minScore: ต้องเปิดอย่างน้อย ~2 ครั้งในช่วงที่ผ่านมาจึงนับว่า "ใช้บ่อย" (เปิดครั้งเดียวไม่ใช่นิสัย)
 */
export function pickShortcuts(usage, { allowedKeys, exclude = [], defaults = [], limit = 4, minScore = 1.5, now = Date.now() }) {
  const allowed = new Set(allowedKeys)
  const skip = new Set(exclude)
  const ranked = Object.entries(usage ?? {})
    .filter(([key]) => allowed.has(key) && !skip.has(key))
    .map(([key, entry]) => ({ key, score: decayedScore(entry, now), t: entry.t }))
    .filter(row => row.score >= minScore)
    .sort((a, b) => b.score - a.score || b.t - a.t)
    .map(row => row.key)
  const chosen = ranked.slice(0, limit)
  for (const key of defaults) {
    if (chosen.length >= limit) break
    if (allowed.has(key) && !skip.has(key) && !chosen.includes(key)) chosen.push(key)
  }
  return chosen
}
