// base path ของแอปสำหรับ deployment แต่ละแบบ — ย้ายออกมาจาก App.jsx เพราะมีที่อื่นต้องใช้
// ประกอบ URL ที่ต้องกลับมาที่แอปตัวเองให้ถูกที่ (QR ล็อกอินข้ามเครื่อง, OAuth redirectTo)
// ไม่ใช่แค่ตั้ง basename ให้ router อย่างเดียวเหมือนเดิม
//
// ต้องสอดคล้องกับ detectTenantSlug() ใน TenantContext.jsx เสมอ: ที่ไหนที่ slug มาจาก hostname
// ที่นั่น basename ต้องเป็น '' และที่ไหนที่ slug มาจาก path ที่นั่น basename ต้องเป็น '/{slug}'
// ถ้าสองอย่างนี้ไม่ตรงกัน จะได้ URL ที่หลุด tenant แล้วแอปจะขึ้น "ไม่พบรหัสหน่วยงาน"

// ลำดับต้องตรงกับ detectTenantSlug() ใน TenantContext.jsx: hostname มาก่อน env var
// เสมอ (ดูเหตุผลเต็มที่นั่น — ของเดิมเช็ค env var ก่อนแล้ว minifier ลบตรรกะ hostname
// ทิ้งจนทุก อปท. กลายเป็นน้ำเลา) ที่นี่ไม่ได้ทำให้ผลลัพธ์เพี้ยนเหมือนที่โน่น เพราะ
// custom domain คืน '' อยู่แล้วทั้งสองทาง แต่ต้องเรียงให้เหมือนกันไว้ ไม่งั้นวันหน้า
// แก้ที่เดียวแล้วสองไฟล์นี้จะตีความ hostname คนละแบบ
export function computeBasename() {
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

  // build ที่ปักหมุด อปท. ไว้ (dev server) ไม่มี path ให้ตีความ
  if (import.meta.env.VITE_TENANT_SLUG) return ''

  // Path mode: /namlao/... → basename = '/namlao' (เฉพาะ deployment กลางแบบ path-based เท่านั้น)
  const segment = pathname.split('/').filter(Boolean)[0]
  return segment ? `/${segment}` : ''
}

// computed once at module load — must NOT be recomputed later (path เปลี่ยนตอน navigate
// จะทำให้ path-mode คำนวณ basename ใหม่ผิด)
export const BASENAME = computeBasename()

// เครื่องตัวเอง/วง LAN ตอนพัฒนา — ไม่มี https ให้เปลี่ยนไป และ Supabase ก็ไม่รับ URL เหล่านี้อยู่แล้ว
// จึงปล่อยตามเดิม ไม่ให้ลิงก์ที่ใช้ทดสอบบนมือถือในวงเดียวกันเสีย
function isLocalHostname(hostname) {
  return hostname === 'localhost' || hostname === '[::1]' || hostname.endsWith('.local') || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)
}

/**
 * บังคับ https กับ URL ของ "โดเมนจริง" — ใช้กับ URL ที่จะส่งให้ Supabase เป็น redirectTo เสมอ
 *
 * ทำไม: Redirect URLs ของ Supabase อนุญาตเฉพาะ https:// ถ้าส่ง http://thungkaew.rk-networks.com/ ไป
 * มันไม่ error แต่ "ถอยไปใช้ Site URL" ซึ่งคือ smartlocal-namlao.vercel.app ผู้ใช้ทุ่งแค้วที่เปิดเว็บ
 * แบบ http:// แล้วกดเข้าด้วย LINE/Google จึงถูกส่งไปลงจอดที่เว็บน้ำเลา (เหตุการณ์จริง 2026-10-02
 * ตรวจ allow-list ด้วย GET /auth/v1/verify กับ token ปลอม: https ผ่านทุกโดเมน http ถูกเปลี่ยนไป Site URL)
 *
 * เป็นชั้นป้องกันที่สองต่อจาก worker/httpsRedirect.js (ที่บังคับ https ตั้งแต่เปิดหน้า) — ชั้นนี้ไม่ขึ้นกับ
 * ว่า Worker เห็น request.url เป็น http หรือไม่ และกันกรณีหน้าที่โหลดค้างมาก่อน Worker redirect ด้วย
 */
export function toHttps(url) {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' || isLocalHostname(u.hostname)) return url
    u.protocol = 'https:'
    u.port = '' // พอร์ต http แบบกำหนดเองไม่มีความหมายบน https ของโดเมนจริง
    return u.href
  } catch {
    return url
  }
}

// URL เต็มที่กลับมาที่แอปตัวเองได้ถูกที่ทุก deployment mode
// เช่น appUrl('/device-login?code=abc') → https://host/namlao/device-login?code=abc
// ผ่าน toHttps เสมอ — มีผู้ใช้ส่งไปเป็น redirectTo ของ OAuth/รีเซ็ตรหัสผ่าน (เหตุผลที่ toHttps)
export function appUrl(path = '/') {
  const suffix = path.startsWith('/') ? path : `/${path}`
  return toHttps(`${window.location.origin}${BASENAME}${suffix}`)
}
