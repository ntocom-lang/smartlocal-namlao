import { createClient } from '@supabase/supabase-js'
import { isNetworkAuthError } from './authErrors'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local')
}

// จับพารามิเตอร์ auth จาก URL ไว้ตั้งแต่ก่อนสร้าง client
//
// detectSessionInUrl ของ supabase-js ล้าง hash/query ทิ้งทันทีที่ประมวลผลเสร็จ หน้าไหนที่ mount
// ทีหลัง (ResetPasswordPage ถูก lazy-load) จึงอ่าน URL เดิมไม่ทันแล้ว ต้องเก็บไว้ตรงนี้ ซึ่งรันก่อน
// createClient เสมอ — ใช้แยกให้ออกว่า "ลิงก์รีเซ็ตรหัสผ่านหมดอายุ" กับ "OAuth ล้มเหลว" คนละเรื่องกัน
function readInitialAuthParams() {
  if (typeof window === 'undefined') return {}
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const query = new URLSearchParams(window.location.search)
  const pick = (key) => hash.get(key) ?? query.get(key)
  return {
    type: pick('type'),
    error: pick('error'),
    errorCode: pick('error_code'),
    errorDescription: pick('error_description'),
    hasCode: Boolean(query.get('code')),
    hasAccessToken: Boolean(hash.get('access_token')),
  }
}

export const initialAuthParams = readInitialAuthParams()

// ── "จำการเข้าสู่ระบบไว้บนเครื่องนี้" ────────────────────────────────────────────
//
// ของเดิมส่ง options: { persistSession: remember } เข้า signInWithPassword ซึ่ง auth-js ไม่เคยอ่าน
// (หยิบจาก options แค่ captchaToken ตัวเดียว ดู GoTrueClient ตรง /token?grant_type=password)
// ผลคือติ๊กหรือไม่ติ๊กก็เขียน session ลง localStorage เหมือนกันหมด — เจ้าหน้าที่ที่ไปใช้ PC กลาง
// ของสำนักงานเข้าใจว่าไม่ได้ให้จำ แต่บัญชีค้างอยู่บนเครื่องนั้นจริง
//
// persistSession เป็น option ระดับ createClient เปลี่ยนรายครั้งไม่ได้ จึงต้องคุมที่ชั้น storage แทน:
// ติ๊ก = localStorage (อยู่ข้ามการปิดเบราว์เซอร์) ไม่ติ๊ก = sessionStorage (หายเมื่อปิดแท็บ)
const REMEMBER_KEY = 'sl-auth-remember'

function safeStorage(kind) {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

// ไม่มีค่าที่บันทึกไว้ = ถือว่าจำ เพื่อไม่ให้ผู้ใช้เดิมที่ล็อกอินค้างอยู่ก่อนหน้านี้ถูกเด้งออกตอน
// อัปเดตโค้ด และเพื่อให้ OAuth (Google/LINE) ซึ่งไม่มีช่องติ๊กยังค้าง session ไว้ตามเดิม
// (ตรงกับกติกา 2026-08-29: ห้ามมีทางไหนพาผู้ใช้ออกจากระบบเองนอกจากผู้ใช้สั่ง)
function wantsPersistentSession() {
  try {
    return safeStorage('local')?.getItem(REMEMBER_KEY) !== '0'
  } catch {
    return true
  }
}

/**
 * ตั้งว่า session ที่กำลังจะถูกสร้างควรค้างบนเครื่องนี้ไหม — ต้องเรียก "ก่อน" signIn ทุกครั้ง
 * เพราะ storage adapter อ่านค่านี้ตอนเขียน session ลงเครื่อง
 */
export function setRememberSession(remember) {
  const local = safeStorage('local')
  if (!local) return
  try {
    if (remember) local.removeItem(REMEMBER_KEY)
    else local.setItem(REMEMBER_KEY, '0')
  } catch {
    // เครื่องที่ปิด storage ไว้ ปล่อยให้ใช้ค่า default (จำ) ไปตามเดิม
  }
}

// code-verifier ของ PKCE ต้องอยู่ localStorage เสมอ ห้ามตามค่า remember
// ผู้ใช้กด "ลืมรหัสผ่าน" ในแท็บหนึ่ง แล้วเปิดลิงก์จากอีเมลในแท็บ/หน้าต่างใหม่เสมอ ถ้า verifier
// ไปอยู่ใน sessionStorage (ผูกกับแท็บเดิม) แท็บใหม่จะหาไม่เจอ แล้วการรีเซ็ตรหัสผ่านพังทั้งฟีเจอร์
function isTabScopable(key) {
  return !String(key).includes('code-verifier')
}

const rememberAwareStorage = {
  getItem(key) {
    try {
      return safeStorage('session')?.getItem(key) ?? safeStorage('local')?.getItem(key) ?? null
    } catch {
      return null
    }
  },
  setItem(key, value) {
    try {
      const useSession = isTabScopable(key) && !wantsPersistentSession()
      const target = safeStorage(useSession ? 'session' : 'local')
      const other = safeStorage(useSession ? 'local' : 'session')
      target?.setItem(key, value)
      // กันของเก่าค้างอีกฝั่ง ไม่งั้น getItem จะหยิบ session เดิมที่ควรถูกทิ้งไปแล้วกลับมาใช้
      other?.removeItem(key)
    } catch {
      // เขียนไม่ได้ (โหมดส่วนตัว/โควตาเต็ม) ปล่อยให้ session อยู่แค่ในแรมของหน้านี้
    }
  },
  removeItem(key) {
    try {
      safeStorage('session')?.removeItem(key)
      safeStorage('local')?.removeItem(key)
    } catch {
      // ไม่มีอะไรให้ทำต่อ
    }
  },
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
//
// ⚠️ กติกาที่ตกลงไว้ (2026-08-29): ผู้ใช้ต้องออกจากระบบด้วยการกดปุ่มเองเท่านั้น ห้ามมีทางไหน
// พาออกอัตโนมัติ ยกเว้นทางเดียวคือ refresh token ตายจริงจนกู้ไม่ได้ ซึ่งไม่ใช่ทางเลือกของเรา
// (ไม่มี token = ยิง request อะไรก็ไม่ผ่าน RLS ทั้งหมด) ของเดิมพลาดตรงเหมาเอาว่า refreshSession()
// ล้ม = session ตาย ทั้งที่ auth-js แยก AuthRetryableFetchError (เน็ตหลุด/ชน timeout 25 วิ)
// ออกมาให้แล้ว — เจ้าหน้าที่ที่ใช้มือถือนอกสำนักงานสัญญาณตกจึงถูกไล่ออกทั้งที่ token ยังดีอยู่
const RETRY_DELAY_MS = 3000
let recovering = null
function recoverExpiredSession() {
  if (recovering) return recovering
  recovering = (async () => {
    // ลองสองรอบ ห่างกัน 3 วิ — รอบเดียวแยก "เซิร์ฟเวอร์สะอึกชั่วขณะ" ออกจาก "token ตายจริง"
    // ไม่ได้ และราคาของการตัดสินผิดฝั่งนี้คือไล่คนที่ยังล็อกอินถูกต้องออกจากระบบ
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      let failure
      try {
        const { data, error } = await supabase.auth.refreshSession()
        if (!error && data?.session) return
        failure = error ?? new Error('refreshSession คืนค่าโดยไม่มี session')
      } catch (err) {
        failure = err
      }

      // ปัญหาการเชื่อมต่อ = ยังสรุปไม่ได้ว่า session ตาย ห้ามพาออกเด็ดขาด ปล่อยให้ตัว
      // auto-refresh ของ SDK (หรือ 401 ครั้งถัดไป) ลองใหม่เองเมื่อสัญญาณกลับมา
      if (isNetworkAuthError(failure)) {
        console.warn('[auth] ต่ออายุ token ไม่สำเร็จเพราะการเชื่อมต่อ — คงสถานะล็อกอินไว้:', failure?.message ?? failure)
        return
      }

      if (attempt === 1) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
        continue
      }

      // ถึงตรงนี้คือเซิร์ฟเวอร์ปฏิเสธ refresh token สองรอบติด (ถูกเพิกถอน/หมดอายุ/สลับ
      // signing key) กู้เองไม่ได้แล้ว ต้องล็อกอินใหม่เท่านั้น — พาไปหน้า login พร้อมเหตุผล
      // ดีกว่าปล่อยให้หน้าเว็บดูปกติแต่ทุกอย่างโหลดไม่ขึ้นโดยผู้ใช้ไม่รู้ว่าเกิดอะไร
      console.error('[auth] refresh token ใช้ไม่ได้แล้ว ต้องเข้าสู่ระบบใหม่:', failure?.message ?? failure)
      purgeStoredAuthSession()
      if (isProtectedPath(window.location.pathname)) {
        window.location.href = '/admin/login?reason=expired'
      }
      return
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
  auth: { lock: noOpLock, storage: rememberAwareStorage },
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
// ของ Supabase สำหรับแอปที่ห่อด้วย native wrapper — แอป Capacitor ถูกเลิกใช้และลบไปแล้ว
// แต่โค้ดนี้ต้องอยู่ต่อ เพราะอาการเดียวกันเกิดกับเบราว์เซอร์บนมือถือทั่วไปด้วย (เคสจริงที่เจอ
// คือหน้าต่างเลือกไฟล์ของระบบเปิดคลุมจอ) ไม่ได้ผูกกับ native wrapper แต่อย่างใด
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
    // ต้องกวาดทั้งสองที่ — ตั้งแต่มี rememberAwareStorage แล้ว session ของคนที่ไม่ติ๊ก
    // "จำการเข้าสู่ระบบ" จะไปอยู่ sessionStorage ถ้าล้างแต่ localStorage การบังคับออกจากระบบ
    // จะไม่มีผลกับคนกลุ่มนั้นเลย
    const removed = []
    for (const store of [localStorage, sessionStorage]) {
      const keys = []
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i)
        if (key && /^sb-.+-auth-token/.test(key)) keys.push(key)
      }
      keys.forEach((key) => { store.removeItem(key); removed.push(key) })
    }
    return removed.length > 0
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
