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

// ── เบอร์โทร → อีเมลสำหรับล็อกอิน ─────────────────────────────────────────────
//
// ของเดิมใช้ `phone.replace(/\D/g, '')` ดิบๆ ทั้งตอนสมัครและตอนล็อกอิน แปลว่ารูปแบบที่ผู้ใช้
// พิมพ์กลายเป็นส่วนหนึ่งของ "ชื่อบัญชี" ไปด้วย — คนที่สมัครด้วย +66 81 234 5678 ได้บัญชี
// 66812345678@... แล้ววันหลังพิมพ์ 081-234-5678 ตอนล็อกอินจะกลายเป็นคนละบัญชี เข้าไม่ได้ถาวร
// และไม่มีข้อความไหนบอกได้ว่าทำไม (ระบบเห็นเป็นแค่ "ไม่มีบัญชีนี้")
//
// แปลงให้เหลือรูปแบบเดียวคือเลขในประเทศขึ้นต้น 0 เสมอ ก่อนเอาไปประกอบเป็นอีเมล
export function normalizeThaiPhone(input) {
  let digits = String(input ?? '').replace(/\D/g, '')
  if (!digits) return ''
  // 0066xxxxxxxxx / 66xxxxxxxxx = รูปแบบระหว่างประเทศ ตัดรหัสประเทศทิ้ง
  if (digits.startsWith('0066')) digits = digits.slice(4)
  else if (digits.startsWith('66') && digits.length >= 10) digits = digits.slice(2)
  // เบอร์ในประเทศขึ้นต้นด้วย 0 เสมอ (คนพิมพ์ตกหน้าบ่อย)
  if (!digits.startsWith('0')) digits = `0${digits}`
  return digits
}

export function phoneToLoginEmail(phone) {
  return `${normalizeThaiPhone(phone)}@${PHONE_EMAIL_DOMAIN}`
}

// ตรงข้ามกับ phoneToLoginEmail — คืนสิ่งที่ผู้ใช้ต้องพิมพ์จริงตอนล็อกอิน
//
// auth.users.email ของบัญชีเบอร์โทรเป็นอีเมลปลอมที่ระบบสร้างเอง ผู้ใช้ไม่เคยเห็นและพิมพ์ตามไม่ได้
// (หน้าล็อกอินแปลงเบอร์ให้เองอยู่แล้ว) ที่ไหนก็ตามที่เอาค่านี้ไปบอกผู้ใช้ ต้องถอดกลับเป็นเบอร์ก่อน
// kind = 'none' คือบัญชีที่ไม่มีอีเมลเลย (LINE ที่ channel ยังไม่ได้รับอนุมัติสิทธิ์ขอ email)
// ซึ่งล็อกอินด้วยรหัสผ่านไม่ได้เลยเพราะไม่มีชื่อผู้ใช้ให้พิมพ์ — ผู้เรียกต้องจัดการเคสนี้เสมอ
export function loginIdentifier(email) {
  const v = String(email ?? '').trim()
  if (!v) return { value: '', kind: 'none' }
  if (v.toLowerCase().endsWith(`@${PHONE_EMAIL_DOMAIN}`)) {
    return { value: v.slice(0, v.lastIndexOf('@')), kind: 'phone' }
  }
  return { value: v, kind: 'email' }
}
