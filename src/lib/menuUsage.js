// ─── นับความถี่การเข้าเมนู เพื่อจัดอันดับ "เมนูที่ใช้บ่อย" ในหน้า More (MorePage.jsx) ───
//
// เก็บแค่ path -> จำนวนครั้งที่เคยเปิด ไว้ใน localStorage ของเครื่อง/เบราว์เซอร์นั้นๆ เท่านั้น ไม่ส่งขึ้น
// server เลย — ไม่มีประเด็น PDPA เพราะไม่ผูกกับตัวบุคคลข้ามอุปกรณ์ แลกกับข้อจำกัดคือถ้าเปลี่ยนเครื่อง/
// ล้างข้อมูลเว็บไซต์จะเริ่มนับใหม่ (per-device ไม่ใช่ per-account จริง — ถ้าจะทำ per-account ข้ามอุปกรณ์
// ต้องมีตาราง DB + เขียนทุกครั้งที่เปลี่ยนหน้า ซึ่งเพิ่ม cost/complexity ไม่คุ้มกับของเดโม/ประชาชนทั่วไป)
//
// รายการ path ที่นับ ต้องตรงกับ path จริงของแต่ละเมนูใน QUICK_MENU_CATALOG (MorePage.jsx) — เผื่อเพิ่ม/
// ลดเมนูที่ให้ขึ้นเป็น "ใช้บ่อย" ได้ ให้แก้ทั้งสองที่ให้ตรงกัน
export const TRACKABLE_PATHS = [
  '/emergency', '/complaint', '/doc-request', '/my-complaints',
  '/events', '/tourism', '/data-center',
  '/my-docs', '/weather', '/contact', '/notifications',
]

const STORAGE_KEY = 'sl_menu_usage_v1'

function readCounts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

// เรียกทุกครั้งที่ route เปลี่ยน (ดู AppShell ใน App.jsx) — นับเฉพาะ path ที่อยู่ใน TRACKABLE_PATHS
// เท่านั้น กันหน้าที่ไม่เกี่ยวข้อง (เช่น /admin, /auth) ไปปนอันดับ
export function recordVisit(pathname) {
  if (!TRACKABLE_PATHS.includes(pathname)) return
  try {
    const counts = readCounts()
    counts[pathname] = (counts[pathname] || 0) + 1
    localStorage.setItem(STORAGE_KEY, JSON.stringify(counts))
  } catch {
    // localStorage เต็ม/ถูกบล็อก — ไม่ใช่ฟีเจอร์จำเป็น ปล่อยผ่านเงียบๆ
  }
}

// คืน path เรียงจากเข้าบ่อยที่สุด -> น้อยที่สุด เฉพาะที่เคยมีการเข้าจริง (count > 0)
export function getRankedPaths() {
  const counts = readCounts()
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([path]) => path)
}
