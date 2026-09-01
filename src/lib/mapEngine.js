import { useSyncExternalStore } from 'react'

// ตัวเลือก map engine ของทั้งระบบ เก็บใน localStorage = ผูกกับ "เบราว์เซอร์" ไม่ใช่ "อปท."
// จงใจในเฟสนี้ เพราะยังเป็นของทดลอง (ดูหน้า /map-demo) แอดมินสลับดูเองได้โดยไม่กระทบประชาชน
// ถ้าจะทำให้เป็นค่าระดับ อปท. จริง ต้องเพิ่มคอลัมน์ municipalities.map_engine + column-level
// GRANT + ใส่ในลิสต์ select ของ TenantContext ก่อน ไม่งั้นค่าที่อ่านได้จะเป็น undefined เสมอ
const STORAGE_KEY = 'smartlocal_map_engine'
const DEFAULT_ENGINE = 'leaflet'
const VALID_ENGINES = ['leaflet', 'google']

// เผื่อ localStorage เข้าถึงไม่ได้ (Safari private mode, cookie ถูกบล็อก) — โยน DOMException
// ตอน get/set ไม่ใช่แค่คืน null ถ้าไม่ดักไว้ แผนที่ทุกจอจะพังทั้งหน้า
function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return VALID_ENGINES.includes(raw) ? raw : null
  } catch {
    return null
  }
}

const listeners = new Set()

export function getMapEngine() {
  return readStored() || DEFAULT_ENGINE
}

export function setMapEngine(engine) {
  if (!VALID_ENGINES.includes(engine)) return
  try {
    localStorage.setItem(STORAGE_KEY, engine)
  } catch {
    // เขียนไม่ได้ก็ยังให้ UI ของแท็บนี้เปลี่ยนตาม แค่ไม่ถูกจำข้ามการ refresh
  }
  listeners.forEach(fn => fn())
}

function subscribe(onChange) {
  listeners.add(onChange)
  // แท็บอื่นสลับ engine ให้แท็บนี้ตามด้วย (storage event ไม่ยิงในแท็บที่เป็นคนเขียนเอง)
  const onStorage = e => { if (e.key === STORAGE_KEY) onChange() }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onStorage)
  }
}

/**
 * คืน engine ที่ใช้อยู่ และ re-render เมื่อมีการสลับ (ในแท็บนี้หรือแท็บอื่น)
 * getServerSnapshot คืนค่าเริ่มต้นเสมอ กัน hydration mismatch ตอน prerender
 */
export function useMapEngine() {
  return useSyncExternalStore(subscribe, getMapEngine, () => DEFAULT_ENGINE)
}
