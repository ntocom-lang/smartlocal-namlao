// แยก "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" ออกจาก "ข้อมูลเข้าสู่ระบบไม่ถูกต้อง"
//
// supabase-js ไม่ได้ reject เมื่อ fetch ล้ม แต่ดักไว้เองแล้วคืนเป็น { error } ชนิด
// AuthRetryableFetchError (ดู auth-js/lib/errors.js) การเช็คแค่ `if (error)` แล้วขึ้นข้อความ
// "อีเมลหรือรหัสผ่านไม่ถูกต้อง" จึงโกหกผู้ใช้เมื่อจริงๆ แล้วเน็ตหลุดหรือเซิร์ฟเวอร์ไม่ตอบ —
// เจ้าหน้าที่จะพิมพ์รหัสซ้ำแล้วซ้ำอีกโดยไม่รู้ว่าปัญหาไม่ได้อยู่ที่รหัส
// (ยืนยันด้วยการทดสอบจริง: ทำให้ /auth/v1/token ค้างจน fetchWithTimeout abort ที่ 25 วิ
//  แล้วหน้า login ขึ้นข้อความว่ารหัสผ่านผิด)
export function isNetworkAuthError(error) {
  if (!error) return false
  if (error.name === 'AuthRetryableFetchError') return true
  // เผื่อกรณีที่หลุดมาเป็น exception ดิบก่อนที่ auth-js จะห่อ
  if (error.name === 'AbortError' || error.name === 'TypeError') return true
  return /failed to fetch|networkerror|load failed|aborted/i.test(error.message ?? '')
}
