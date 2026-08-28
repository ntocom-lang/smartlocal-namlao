// base path ของแอปสำหรับ deployment แต่ละแบบ — ย้ายออกมาจาก App.jsx เพราะมีที่อื่นต้องใช้
// ประกอบ URL ที่ต้องกลับมาที่แอปตัวเองให้ถูกที่ (QR ล็อกอินข้ามเครื่อง, OAuth redirectTo)
// ไม่ใช่แค่ตั้ง basename ให้ router อย่างเดียวเหมือนเดิม
//
// ต้องสอดคล้องกับ detectTenantSlug() ใน TenantContext.jsx เสมอ: ที่ไหนที่ slug มาจาก hostname
// ที่นั่น basename ต้องเป็น '' และที่ไหนที่ slug มาจาก path ที่นั่น basename ต้องเป็น '/{slug}'
// ถ้าสองอย่างนี้ไม่ตรงกัน จะได้ URL ที่หลุด tenant แล้วแอปจะขึ้น "ไม่พบรหัสหน่วยงาน"

export function computeBasename() {
  if (import.meta.env.VITE_TENANT_SLUG) return ''

  const { hostname, pathname } = window.location

  if (!hostname.endsWith('.vercel.app') && hostname !== 'localhost' && !hostname.match(/^\d/)) {
    return ''
  }

  // smartlocal-{slug}.vercel.app = deployment เฉพาะ อปท. เดียว (เหมือน custom domain) — slug มาจาก
  // hostname เองอยู่แล้ว (ดู detectTenantSlug ใน TenantContext.jsx ที่เช็คแพทเทิร์นเดียวกันนี้) ไม่ใช่
  // path-mode ห้ามเอา path แรกไปตั้งเป็น basename ไม่งั้นเข้าหน้าอื่นที่ไม่ใช่ "/" ตรงๆ (เช่น /auth,
  // /reports) จะพังทันที เพราะ path นั้นเองจะถูกเข้าใจผิดว่าเป็น basename ทำให้ลิงก์ทุกอันเพี้ยน
  // (บั๊กจริงที่เจอ: เข้า /auth ตรงๆ แล้วกลายเป็นหน้าแรกซ้อนอยู่ใต้ /auth/auth, /auth/complaint ฯลฯ)
  if (/^smartlocal-.+$/.test(hostname.split('.')[0])) return ''

  // Path mode: /namlao/... → basename = '/namlao' (เฉพาะ deployment กลางแบบ path-based เท่านั้น)
  const segment = pathname.split('/').filter(Boolean)[0]
  return segment ? `/${segment}` : ''
}

// computed once at module load — must NOT be recomputed later (path เปลี่ยนตอน navigate
// จะทำให้ path-mode คำนวณ basename ใหม่ผิด)
export const BASENAME = computeBasename()

// URL เต็มที่กลับมาที่แอปตัวเองได้ถูกที่ทุก deployment mode
// เช่น appUrl('/device-login?code=abc') → https://host/namlao/device-login?code=abc
export function appUrl(path = '/') {
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${window.location.origin}${BASENAME}${suffix}`
}
