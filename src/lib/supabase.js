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

// fetch ตัวนี้ถูกส่งต่อให้ทุก sub-client ของ supabase-js รวมถึง auth client ด้วย
// (createClient ส่ง settings.global.fetch เข้า _initSupabaseAuthClient) input จึงมาได้ทั้ง
// string / URL / Request ต้องดึง URL ออกมาให้ครบทุกแบบก่อนเอาไปเทียบ
function requestUrlOf(input) {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input?.url ?? ''
}

async function fetchWithAuthRecovery(input, init = {}) {
  const res = await fetchWithTimeout(input, init)
  // ห้ามแตะ endpoint ของ auth เอง (/auth/v1/*) — auth-js จัดการวงจร token ของตัวเองอยู่แล้ว
  // (refresh อัตโนมัติ, ตั้งใจข้าม 401/403 ตอน logout, มี deferred กัน refresh ซ้อน) การยิง
  // recoverExpiredSession() สวนเข้าไปตอน logout ตอบ 401 จะสร้าง session ใหม่ทับของที่เพิ่งลบ
  // ผู้ใช้เด้งกลับเข้าระบบทันทีหลังกดออก — และ noOpLock ด้านบนทำให้ไม่มี lock กันสองงานนี้ชนกัน
  // ตัวดักนี้มีไว้สำหรับ request ที่ผ่าน RLS (PostgREST/Storage/Functions) เท่านั้น
  const isAuthEndpoint = requestUrlOf(input).includes('/auth/v1/')
  if (!isAuthEndpoint && (res.status === 400 || res.status === 401)) {
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

// supabase-js เก็บ session ไว้ที่ key `sb-<project-ref>-auth-token` ใน localStorage และมี key
// พี่น้องที่ขึ้นต้นเหมือนกัน (เช่น -code-verifier ของ PKCE) กวาดด้วย prefix แทนการ hardcode
// ชื่อเต็ม เพื่อไม่ให้พังเงียบๆ ถ้า supabase-js เปลี่ยนรูปแบบ key ภายในวันหลัง
function purgeStoredAuthSession() {
  try {
    const keys = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key && /^sb-.+-auth-token/.test(key)) keys.push(key)
    }
    keys.forEach((key) => localStorage.removeItem(key))
    return keys.length > 0
  } catch {
    return false
  }
}

/**
 * ออกจากระบบให้สำเร็จเสมอ ไม่ว่า token จะอยู่ในสภาพไหน — ใช้แทน supabase.auth.signOut() ทุกจุด
 *
 * ทำไมเรียก signOut() ตรงๆ ไม่พอ: _signOut() ต้องอ่าน session ปัจจุบันก่อน ถ้า access token
 * หมดอายุ auth-js จะ _callRefreshToken() ให้อัตโนมัติ แล้วผลลัพธ์แตกออกเป็น 2 ทาง
 *   - refresh พลาดแบบ non-retryable (refresh token ถูกเพิกถอน) → _removeSession() ถูกเรียก
 *     session หายจริง ออกจากระบบได้ตามปกติ
 *   - refresh พลาดแบบ retryable (เน็ตหลุด, timeout 25s ของ fetchWithTimeout, server ไม่ตอบ)
 *     → auth-js "คืน error แล้วจบ" โดยยังไม่ลบ session (ดู GoTrueClient._signOut ที่เช็ค
 *     sessionError แล้ว return ก่อนถึงบรรทัด _removeSession()) ผู้ใช้กดออกกี่ครั้งก็วนกลับที่เดิม
 *     และเงียบสนิทเพราะทุก call site เดิมทิ้ง error ที่คืนมา
 * ส่ง scope: 'local' ก็ไม่ช่วย เพราะด่าน sessionError อยู่ก่อนบรรทัดที่ดู scope
 *
 * ทางออกเดียวที่เชื่อถือได้คือล้าง session ที่เก็บไว้เองแล้วบังคับโหลดหน้าใหม่ — ต้อง reload จริง
 * ไม่ใช่ navigate ของ router เพราะ GoTrueClient ยัง cache session ไว้ใน memory ของหน้าเดิม
 *
 * @param {string} redirectTo path ที่จะไปต่อ ใช้เฉพาะกรณีต้องบังคับล้าง (ปกติผู้เรียก navigate เอง)
 * @returns {Promise<{ ok: boolean, forced: boolean }>} forced = true คือหลุดมาทางล้าง storage เอง
 */
export async function signOutSafely(redirectTo = '/') {
  try {
    const { error } = await supabase.auth.signOut()
    if (!error) return { ok: true, forced: false }
    console.warn('[auth] signOut() คืน error, บังคับล้าง session ในเครื่อง:', error.message)
  } catch (err) {
    console.warn('[auth] signOut() โยน error, บังคับล้าง session ในเครื่อง:', err?.message ?? err)
  }

  purgeStoredAuthSession()
  window.location.assign(redirectTo)
  return { ok: true, forced: true }
}
