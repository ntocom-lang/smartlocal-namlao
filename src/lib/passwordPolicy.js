// เกณฑ์รหัสผ่านของระบบ — ต้องมีที่เดียว
//
// เดิมเลข 6 ถูกเขียนซ้ำอยู่ 3 ที่ (หน้าสมัคร, หน้าตั้งรหัสผ่านใหม่, supabase/config.toml) ทั้งใน
// เงื่อนไขตรวจและใน placeholder ที่บอกผู้ใช้ พอจะขยับเกณฑ์ทีต้องไล่แก้ให้ครบทุกจุดเอง ซึ่งพลาดง่าย
// และเวลาพลาดจะกลายเป็น "หน้าจอบอกอย่าง ระบบตรวจอีกอย่าง"
//
// 8 ตัวเป็นเกณฑ์ขั้นต่ำที่ใช้กันเป็นมาตรฐานทั่วไป (NIST SP 800-63B แนะนำขั้นต่ำ 8 สำหรับรหัสผ่าน
// ที่ผู้ใช้ตั้งเอง และไม่แนะนำให้บังคับผสมตัวพิมพ์ใหญ่/อักขระพิเศษ เพราะได้รหัสที่เดาง่ายพอกัน
// แต่ผู้ใช้จำไม่ได้จนไปจดใส่กระดาษแปะจอแทน)
//
// ⚠️ ต้องตั้งค่าฝั่งเซิร์ฟเวอร์ให้ตรงกันด้วย: Supabase Dashboard → Authentication → Policies →
// Minimum password length ไม่งั้นด่านนี้เป็นแค่ฝั่งหน้าจอ ซึ่งข้ามได้ด้วยการยิง API ตรง
export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_BYTES = 72

/**
 * ตรวจรหัสผ่านที่ผู้ใช้ตั้งใหม่ — คืนข้อความ error ภาษาไทย หรือ '' เมื่อผ่าน
 * @param {string} password
 */
export function validateNewPassword(password) {
  const value = String(password ?? '')
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `รหัสผ่านต้องมีอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`
  }
  // Supabase Auth เก็บรหัสผ่านด้วย bcrypt ซึ่งรับข้อมูลได้สูงสุด 72 bytes ไม่ใช่ 72 ตัวอักษร
  // ภาษาไทยหนึ่งตัวใช้หลาย bytes จึงต้องตรวจ UTF-8 bytes เพื่อให้ frontend ตรงกับ backend
  if (new TextEncoder().encode(value).length > MAX_PASSWORD_BYTES) {
    return `รหัสผ่านยาวเกินไป (สูงสุด ${MAX_PASSWORD_BYTES} bytes)`
  }
  return ''
}

// ข้อความสำหรับ placeholder ให้ตรงกับเงื่อนไขที่ตรวจจริงเสมอ
export const PASSWORD_HINT = `อย่างน้อย ${MIN_PASSWORD_LENGTH} ตัว`
