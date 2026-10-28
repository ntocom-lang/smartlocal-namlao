// แคชค่าสถานการณ์น้ำ–ฝนรอบล่าสุดที่ดึงสำเร็จ เก็บในเครื่องผู้ชม (localStorage)
//
// ใช้ "หลังจากดึงค่าใหม่ไม่สำเร็จเท่านั้น" — ห้ามเอาขึ้นจอระหว่างรอระบบตอบ ไม่งั้นคนเห็นตัวเลขเก่า
// วาบหนึ่งก่อนค่าจริงมา (เช่น ฝน 0 มม. ทั้งที่ตอนนี้ตก) และห้ามใช้เป็นค่าจริงเงียบๆ: หน้าต้องบอกว่า
// เป็นค่าที่เก็บไว้ในเครื่อง พร้อมเวลาของข้อมูลเอง
//
// อายุที่นับคือ "เวลาของข้อมูล" (synced_at / fetchedAt) ไม่ใช่เวลาที่เครื่องนี้บันทึก — บันทึกวันนี้
// แต่เป็นค่าของเมื่อวานก็ยังนับเป็นของเมื่อวาน · เกิน WATER_CACHE_MAX_AGE_MS ทิ้ง ไม่แสดง
// (ฝนสะสม 24 ชม. ที่เก่ากว่าหนึ่งวันไม่มีความหมาย และอ่านผิดเป็นสถานการณ์ปัจจุบันได้)
//
// ข้อมูลเป็นค่าสาธารณะชุดเดียวกับที่หน้าแสดงอยู่แล้ว ไม่มีข้อมูลส่วนบุคคล · localStorage ใช้ไม่ได้
// (โหมดส่วนตัว/เต็ม/ถูกบล็อก) ต้องไม่ทำให้หน้าพัง — ทุกจุดครอบ try/catch แล้วถือว่าไม่มีแคช
export const WATER_CACHE_MAX_AGE_MS = 24 * 3_600_000
const VERSION = 1
// กันเก็บของใหญ่ผิดปกติ (ปกติ 30 สถานีราว 20–40 KB) · localStorage โควตาราว 5 MB ต่อ origin ที่ใช้ร่วมกับทั้งแอป
const MAX_CHARS = 400_000
// นาฬิกาเครื่องผู้ชมเดินเร็วกว่าเวลาข้อมูลได้เล็กน้อย — เกินนี้ถือว่าผิดปกติ ไม่ใช้
const CLOCK_SKEW_MS = 5 * 60_000

export const situationCacheKey = tenantId => `sl_water_situation_v${VERSION}:${tenantId}`
export const hydroCacheKey = code => `sl_water_hydro_v${VERSION}:${code}`

export function browserStorage() {
  try { return globalThis.localStorage ?? null } catch { return null }
}

const timeOf = value => {
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function write(storage, key, id, value, dataAt, now) {
  try {
    if (!storage || dataAt === null) return false
    const raw = JSON.stringify({ v: VERSION, id, savedAt: now, dataAt, value })
    if (raw.length > MAX_CHARS) return false
    storage.setItem(key, raw)
    return true
  } catch { return false }
}

function read(storage, key, id, now) {
  try {
    const raw = storage?.getItem(key)
    if (!raw || raw.length > MAX_CHARS) return null
    const entry = JSON.parse(raw)
    if (!entry || entry.v !== VERSION || entry.id !== id) return null
    const dataAt = Number(entry.dataAt)
    if (!Number.isFinite(dataAt) || dataAt > now + CLOCK_SKEW_MS || now - dataAt > WATER_CACHE_MAX_AGE_MS) return null
    return { dataAt, value: entry.value }
  } catch { return null }
}

// ค่าสถานีของ อปท. (ผลของ get_public_water_situation) · ไม่มี synced_at = ระบบยังไม่เคยดึงสำเร็จ ไม่มีอะไรให้เก็บ
export function saveSituationCache(storage, tenantId, data, now = Date.now()) {
  if (!tenantId || !Array.isArray(data?.stations)) return false
  return write(storage, situationCacheKey(tenantId), tenantId, data, timeOf(data.synced_at), now)
}

export function readSituationCache(storage, tenantId, now = Date.now()) {
  if (!tenantId) return null
  const hit = read(storage, situationCacheKey(tenantId), tenantId, now)
  if (!hit || !Array.isArray(hit.value?.stations) || timeOf(hit.value.synced_at) !== hit.dataAt) return null
  return hit
}

// รายงานระดับน้ำรายชั่วโมง (/api/hydro-hourly) · รอบที่ต้นทางล่มแล้ว Worker ส่งค่าเก่ากลับมา (refreshFailed)
// ไม่เขียนทับ — ไม่งั้นแคชจะถูกต่ออายุด้วยค่าเดิมซ้ำๆ
export function saveHydroCache(storage, code, report, now = Date.now()) {
  if (!code || report?.station !== code || !Array.isArray(report.points) || report.refreshFailed) return false
  const { station, points, fetchedAt } = report
  return write(storage, hydroCacheKey(code), code, { station, points, fetchedAt }, timeOf(fetchedAt), now)
}

export function readHydroCache(storage, code, now = Date.now()) {
  if (!code) return null
  const hit = read(storage, hydroCacheKey(code), code, now)
  if (!hit || hit.value?.station !== code || !Array.isArray(hit.value.points) || timeOf(hit.value.fetchedAt) !== hit.dataAt) return null
  return hit
}
