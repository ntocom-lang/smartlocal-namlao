import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local')
}

const FETCH_TIMEOUT_MS = 25_000

// กัน request ค้างตลอดไป (เช่น ระหว่าง auth token refresh) — ถ้า client ตัวเดียวนี้ค้าง
// จะไปบล็อกทุกหน้าทั้งแอปที่ใช้ client เดียวกัน จึงต้องมี ceiling กลางไว้เสมอ
function fetchWithTimeout(input, init = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  if (init.signal) {
    if (init.signal.aborted) controller.abort()
    else init.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

// กัน navigator.locks ค้างแบบไม่มี timeout ในตัว SDK (บั๊กที่รู้จักของ
// supabase-js บนมือถือ — เช่น ตอนหน้าต่างเลือกไฟล์ของระบบเปิดคลุมหน้าเว็บ
// ทำให้ lock ค้างไม่ถูกปล่อย แล้ว request ที่ต้องใช้ token ทุกตัวค้างตามไปด้วย
// ไม่มี error ไม่มี timeout เอง) ปิดการใช้ lock นี้ตามคำแนะนำทางการของ Supabase
async function noOpLock(_name, _acquireTimeout, fn) {
  return await fn()
}

function isProtectedPath(path) {
  return (path.startsWith('/admin') && path !== '/admin/login')
    || path.startsWith('/staff')
    || path.startsWith('/technician')
}

// เกิดเคส production จริง: ตัว auto-refresh token ของ supabase-js เอง (background
// timer) ค้างเงียบๆ หลัง refresh ครั้งก่อนพลาด (บั๊กที่รู้จักของ supabase-js —
// ไม่ reschedule ตัวเองหลัง error) ผลคือ access token หมดอายุแล้วไม่มีใครต่ออายุ
// ให้อีกเลย ทุก request ที่ต้องใช้สิทธิ์ล็อกอิน (storage sign, query ที่ผ่าน RLS
// ฯลฯ) พังไปเรื่อยๆ ด้วย 400/401 ต่อเนื่องเป็นสิบนาที หน้าเว็บยังดูปกติ ไม่เด้งไป
// login ให้เห็นเลย ผู้ใช้ไม่รู้ว่าต้องล็อกอินใหม่ — ต้องดักจับเองจาก response แล้ว
// บังคับ refresh หรือ sign-out ทันทีที่เจอสัญญาณว่า token ใช้ไม่ได้แล้ว
// เช็คจากข้อความ error แทน status code ล้วนๆ เพราะ 400 เฉยๆ ใช้กับ validation
// error ปกติทั่วแอปด้วย (เช่น insert ผิด constraint) ไม่ควร sign-out มั่ว
let recovering = null
function recoverExpiredSession() {
  if (recovering) return recovering
  recovering = (async () => {
    try {
      const { data, error } = await supabase.auth.refreshSession()
      if (error || !data?.session) throw error ?? new Error('no session after refresh')
    } catch {
      await supabase.auth.signOut()
      if (isProtectedPath(window.location.pathname)) window.location.href = '/admin/login'
    }
  })()
  return recovering.finally(() => { recovering = null })
}

async function fetchWithAuthRecovery(input, init = {}) {
  const res = await fetchWithTimeout(input, init)
  if (res.status === 400 || res.status === 401) {
    res.clone().text().then((body) => {
      if (/jwt|token.{0,20}expired|expired.{0,20}token|invalid.{0,20}token/i.test(body)) {
        recoverExpiredSession()
      }
    }).catch(() => {})
  }
  return res
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithAuthRecovery },
  auth: { lock: noOpLock },
})

supabase.auth.onAuthStateChange((event) => {
  if (event === 'TOKEN_REFRESHED') return
  if (event === 'SIGNED_OUT' && isProtectedPath(window.location.pathname)) {
    window.location.href = '/admin/login'
  }
})

// บังคับรีสตาร์ทตัวต่ออายุ token เองตอนเพจกลับมาแสดงผล — กันเคสที่มือถือ
// ซ่อนเพจชั่วคราว (เช่น หน้าต่างเลือกไฟล์ของระบบเปิดคลุมจอ) แล้วตัวต่ออายุ token
// อัตโนมัติในตัว SDK ไม่ฟื้นตัวเอง ทำให้ request ที่ต้องใช้สิทธิ์ล็อกอินทุกตัว
// (ไม่ใช่แค่ตอนอัปโหลดไฟล์) ค้างตลอดไปหลังจากนั้น — วิธีนี้เป็นคำแนะนำทางการ
// ของ Supabase สำหรับแอปที่ห่อด้วย native wrapper (แอปนี้ใช้ Capacitor)
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') supabase.auth.startAutoRefresh()
    else supabase.auth.stopAutoRefresh()
  })
}
