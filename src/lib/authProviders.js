// ช่องทางเชื่อมต่อบัญชี (auth.identities.provider) — ใช้ร่วมกันระหว่างหน้า login กับหน้าจัดการผู้ใช้
// เพื่อไม่ให้ label/โดเมนของบัญชีเบอร์โทรถูกก๊อปไปนิยามซ้ำคนละที่แล้วเพี้ยนกันภายหลัง

// สมัครด้วยเบอร์โทรถูกแปลงเป็นอีเมลปลอม <digits>@phone.smartlocal.app ก่อนส่งเข้า Supabase Auth
// (ดู phoneToEmail ใน AuthPage.jsx) provider ที่บันทึกจริงจึงเป็น 'email' เหมือนคนที่สมัครด้วยอีเมล
export const PHONE_EMAIL_DOMAIN = 'phone.smartlocal.app'

export const PROVIDER_BADGE = {
  email:         { label: 'อีเมล/รหัสผ่าน', short: 'อีเมล',    bg: '#f3f4f6', color: '#374151', icon: '✉️' },
  phone:         { label: 'เบอร์โทร',       short: 'เบอร์โทร', bg: '#e0f2fe', color: '#075985', icon: '📱' },
  google:        { label: 'Google',          short: 'Google',   bg: '#fef9c3', color: '#854d0e', icon: '🔵' },
  'custom:line': { label: 'LINE',            short: 'LINE',     bg: '#dcfce7', color: '#166534', icon: '💚' },
}

// ลำดับคงที่ของ chip ต่อแถว — RPC get_users_with_email คืน providers จาก ARRAY(SELECT DISTINCT ...)
// ซึ่งไม่การันตีลำดับ ถ้าไม่เรียงเอง badge จะสลับตำแหน่งไปมาระหว่างแถวจนตารางอ่านยาก
const PROVIDER_ORDER = ['google', 'custom:line', 'phone', 'email']

export function providerLabel(key) {
  return PROVIDER_BADGE[key] ?? { label: key, short: key, bg: '#f3f4f6', color: '#374151', icon: '🔗' }
}

// คืน key ที่พร้อมแสดงผล: แยก 'email' ของบัญชีเบอร์โทรออกเป็น 'phone' ตามอีเมล login ที่ใช้จริง
export function accountProviders(user) {
  const isPhoneLogin = (user?.email || '').toLowerCase().endsWith(`@${PHONE_EMAIL_DOMAIN}`)
  const keys = (user?.providers ?? []).map((p) => (p === 'email' && isPhoneLogin ? 'phone' : p))
  return [...new Set(keys)].sort((a, b) => {
    const ia = PROVIDER_ORDER.indexOf(a)
    const ib = PROVIDER_ORDER.indexOf(b)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })
}
