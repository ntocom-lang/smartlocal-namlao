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

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithTimeout },
  auth: { lock: noOpLock },
})

supabase.auth.onAuthStateChange((event) => {
  if (event === 'TOKEN_REFRESHED') return
  if (event === 'SIGNED_OUT') {
    const path = window.location.pathname
    if (path.startsWith('/admin') && path !== '/admin/login') {
      window.location.href = '/admin/login'
    }
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
