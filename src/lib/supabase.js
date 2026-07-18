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

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithTimeout },
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
