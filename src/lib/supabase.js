import { createClient, AuthRetryableFetchError } from '@supabase/supabase-js'
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

// ── "จำการเข้าสู่ระบบ" = จำเสมอ ทุกทางเข้า ไม่มีโหมด "ไม่จำ" ─────────────────────────────────
//
// เจ้าของระบบสั่ง (2026-10-02): "ให้จำการเข้าสู่ระบบทุกอย่างได้เลย ถ้าจะออกก็ให้เขากดออกเอง"
// ผู้ใช้กลุ่มหลักคือผู้สูงอายุที่จำรหัสผ่านไม่ได้ (และ Google/LINE ไม่มีรหัสผ่านให้กรอกด้วยซ้ำ)
// หลุดครั้งเดียวคือเข้าไม่ได้อีกเลย session จึงอยู่ใน localStorage ที่เดียวเสมอ (ค่าเริ่มต้นของ
// supabase-js) ข้ามการปิดเบราว์เซอร์ และจะหายก็ต่อเมื่อผู้ใช้กดออกจากระบบเอง (signOutSafely) หรือ
// เซิร์ฟเวอร์ยืนยันว่า refresh token ตายจริงเท่านั้น
//
// ประวัติ (ไว้กันคนต่อไปเอากลับมา): เคยมีช่องติ๊ก "จำการเข้าสู่ระบบไว้บนเครื่องนี้" ที่เก็บ session ไว้
// sessionStorage เมื่อไม่ติ๊ก ทดสอบกับ SDK จริงพบว่ากลไกนั้นพา session ที่ผู้ใช้เลือกจำไว้หลุดได้เอง
// (ล็อกอินแบบไม่ติ๊กที่ล้มเหลว + ต่ออายุ token = session ย้ายไป sessionStorage แล้วหายเมื่อปิดแท็บ)
// และค่า "ไม่จำ" ค้างถาวรไปกระทบทางที่ไม่มีช่องติ๊ก จึงเลิกมีโหมดนี้ทั้งระบบ แทนที่จะอุดทีละช่อง
const LEGACY_REMEMBER_KEYS = ['sl-auth-remember', 'sl-auth-oauth-remember'] // ค่าของกลไกเก่า ไม่ใช้แล้ว

function safeStorage(kind) {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

function expiresAtOf(raw) {
  try {
    const at = JSON.parse(raw)?.expires_at
    return Number.isFinite(at) ? at : 0
  } catch {
    return 0
  }
}

// ย้าย session ที่เคยถูกเก็บไว้ sessionStorage (คนที่เคยไม่ติ๊กจำ) มาไว้ localStorage ให้ "จำ" เหมือนทุกคน
// ไม่งั้นพวกเขาจะหลุดเมื่อปิดแท็บ ทั้งที่กติกาตอนนี้คือห้ามหลุดเอง และห้ามทิ้งไว้ใน sessionStorage
// เพราะ SDK อ่านที่เดียว (localStorage) จะมองไม่เห็น session นั้นแล้วพาไปหน้าเข้าสู่ระบบ
// ถ้ามีทั้งสองที่ ให้เอาตัวที่หมดอายุทีหลัง (ใหม่กว่า) — ต้องรันก่อน createClient เสมอ
function migrateLegacyStorage() {
  const local = safeStorage('local')
  const session = safeStorage('session')
  try {
    LEGACY_REMEMBER_KEYS.forEach((key) => local?.removeItem(key))
    if (!local || !session) return
    const keys = []
    for (let i = 0; i < session.length; i += 1) {
      const key = session.key(i)
      if (key && /^sb-.+-auth-token$/.test(key)) keys.push(key)
    }
    keys.forEach((key) => {
      const moving = session.getItem(key)
      if (moving !== null && expiresAtOf(moving) >= expiresAtOf(local.getItem(key))) local.setItem(key, moving)
      session.removeItem(key)
    })
  } catch {
    // ย้ายไม่ได้ (storage เต็ม/ถูกปิด) ปล่อยไว้ที่เดิม ไม่ทำให้แอปพัง
  }
}

migrateLegacyStorage()

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

// ── กันไม่ให้ SDK ลบ session ทิ้งเองตอนเซิร์ฟเวอร์สะอึก ─────────────────────────────────
//
// กติกา (2026-10-02): คนที่ติ๊ก "จำการเข้าสู่ระบบไว้บนเครื่องนี้" ต้องค้างตลอดไป ห้ามหลุดเอง
// ยกเว้นผู้ใช้กดออกเอง หรือเซิร์ฟเวอร์ยืนยันชัดว่า refresh token ตายจริง
//
// ปัญหา: auth-js (2.105.4 ดู GoTrueClient._callRefreshToken กับ _recoverAndRefresh) ลบ session ออก
// จากเครื่องแล้วประกาศ SIGNED_OUT ทันทีที่ขอ refresh แล้วได้ error ที่ "ไม่ใช่ retryable" ส่วนที่ถูกนับ
// ว่า retryable มีแค่ fetch ล้ม กับ status 502/503/504/520-524/530 (lib/fetch.js NETWORK_ERROR_CODES)
// ดังนั้น
//   • 500 unexpected_failure — เช่น ฐานข้อมูลแผนฟรีโหลดหนัก
//   • 429 over_request_rate_limit — เพดานของ /token คือ 150 ครั้ง/5 นาที ต่อ IP นับรวมทั้ง
//     password, refresh token, ID token, PKCE (ตามเอกสาร Supabase) ทั้งสำนักงานหรือวง wifi ของงาน
//     ที่ออก IP เดียวกันใช้โควตาร่วมกัน
// ถูกอ่านเป็น "refresh token ตายแล้ว" ผู้ใช้โดนพาออกจากระบบทั้งที่ token ยังดี 100%
// (ทดสอบกับเซิร์ฟเวอร์ปลอมแล้ว: ก่อนแก้ ทั้งสองกรณีลบ session + ยิง SIGNED_OUT ทันที)
//
// แก้ที่ชั้น fetch: ถ้าความล้มเหลวเป็นแบบชั่วคราว ให้ throw เหมือน fetch ล้ม — auth-js จะห่อเป็น
// AuthRetryableFetchError (fetch.js _handleRequest) = เก็บ session ไว้ รอรอบ auto-refresh ถัดไป
//
// ⚠️ 429 มีสองความหมายในเอกสารเดียวกัน แยกด้วย status ไม่ได้ ต้องอ่านรหัสใน body:
//   over_request_rate_limit      = ชั่วคราว → เก็บ session
//   refresh_token_already_used   = ตายจริง (ใช้ซ้ำเกิน reuse interval 10 วิ → เซิร์ฟเวอร์เพิกถอน
//                                  ทั้ง session) → ปล่อยให้ SDK จัดการตามเดิม
// body มีสองรูปทรงตามเวอร์ชัน API: {code:'xxx'} (2024-01-01+) หรือ {error_code:'xxx'}
// ส่วน 4xx อื่นๆ ที่ไม่ใช่ 429 ไม่แตะเลย (404 refresh_token_not_found, 401 session_expired,
// 403 user_banned, 400 invalid_grant ฯลฯ คือเซิร์ฟเวอร์ตัดสินแล้วว่าตาย ถูกเพิกถอนโดยผู้ดูแล/ระบบ)
const REFRESH_TOKEN_DEAD_CODE = 'refresh_token_already_used'

// พักการยิง refresh หลังเจอความล้มเหลวชั่วคราว — auth-js ลองซ้ำเองด้วย backoff 200ms→12.8s ได้ถึง
// 8 ครั้งต่อรอบ (วัดจริงกับ 503: 8 request ใน 25 วินาที) แล้วรอบถัดไปอีก 30 วินาที ถ้า 429 ยังเป็น
// ตัวยิงซ้ำเองก็ยิ่งกินโควตา IP เดียวกันของคนอื่นทั้งสำนักงาน ให้ยิงจริงแค่ครั้งแรก ที่เหลือโยน
// error ทิ้งในเครื่องโดยไม่ออกเน็ต (ตัวนับ SDK ยังทำงานตามปกติ แค่ไม่มีทราฟฟิก)
const REFRESH_COOLDOWN_MS = 60_000
let refreshCooldownUntil = 0

function isRefreshTokenRequest(url) {
  return url.includes('/auth/v1/token') && url.includes('grant_type=refresh_token')
}

async function isTransientRefreshFailure(res) {
  if (res.status >= 500) return true
  if (res.status !== 429) return false
  try {
    const body = await res.clone().json()
    const code = typeof body?.code === 'string' ? body.code : body?.error_code
    return code !== REFRESH_TOKEN_DEAD_CODE
  } catch {
    // 429 ที่ body ไม่ใช่ JSON = ตัวจำกัดอัตราของ proxy/CDN ด้านหน้า ไม่ใช่คำตัดสินของ GoTrue
    return true
  }
}

async function fetchWithAuthRecovery(input, init = {}) {
  const url = requestUrlOf(input)
  const isRefresh = isRefreshTokenRequest(url)

  if (isRefresh && Date.now() < refreshCooldownUntil) {
    throw new TypeError('Failed to fetch (refresh paused: server failed a moment ago)')
  }

  const res = await fetchWithTimeout(input, init)

  if (isRefresh && !res.ok && await isTransientRefreshFailure(res)) {
    refreshCooldownUntil = Date.now() + REFRESH_COOLDOWN_MS
    console.warn(`[auth] ต่ออายุ token ไม่สำเร็จชั่วคราว (HTTP ${res.status}) — คงสถานะล็อกอินไว้ ลองใหม่ภายหลัง`)
    throw new TypeError(`Failed to fetch (refresh deferred: HTTP ${res.status} is transient)`)
  }

  // ห้ามแตะ endpoint ของ auth เอง (/auth/v1/*) — auth-js จัดการวงจร token ของตัวเองอยู่แล้ว
  // (refresh อัตโนมัติ, ตั้งใจข้าม 401/403 ตอน logout, มี deferred กัน refresh ซ้อน) การยิง
  // recoverExpiredSession() สวนเข้าไปตอน logout ตอบ 401 จะสร้าง session ใหม่ทับของที่เพิ่งลบ
  // ผู้ใช้เด้งกลับเข้าระบบทันทีหลังกดออก — และ noOpLock ด้านบนทำให้ไม่มี lock กันสองงานนี้ชนกัน
  // ตัวดักนี้มีไว้สำหรับ request ที่ผ่าน RLS (PostgREST/Storage/Functions) เท่านั้น
  const isAuthEndpoint = url.includes('/auth/v1/')
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
  // ไม่ส่ง storage = ใช้ localStorage ของ SDK เอง (ถ้าเบราว์เซอร์ปิด storage SDK ถอยไปใช้แรมให้เอง)
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
// ของ Supabase สำหรับแอปที่ห่อด้วย native wrapper — แอป Capacitor ถูกเลิกใช้และลบไปแล้ว
// แต่โค้ดนี้ต้องอยู่ต่อ เพราะอาการเดียวกันเกิดกับเบราว์เซอร์บนมือถือทั่วไปด้วย (เคสจริงที่เจอ
// คือหน้าต่างเลือกไฟล์ของระบบเปิดคลุมจอ) ไม่ได้ผูกกับ native wrapper แต่อย่างใด
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') supabase.auth.startAutoRefresh()
    else supabase.auth.stopAutoRefresh()
  })
}

// ── อ่าน session ที่ค้างในเครื่อง โดยไม่ผ่านเครือข่าย ─────────────────────────────────────
//
// ใช้เฉพาะตอนที่ getSession() ตอบ "ไม่มี session" เพราะ refresh สะดุดชั่วคราว ทั้งที่ session ยังอยู่
// ในเครื่องครบ (ดู getSessionResilient ข้างล่าง) access token ในนี้อาจหมดอายุแล้ว — ห้ามเอาไปแนบ
// request เอง ให้ใช้ยืนยันแค่ "ใครล็อกอินอยู่" ส่วน token จริงให้ SDK ต่ออายุให้เอง
// key ตรงกับ /^sb-.+-auth-token$/ เท่านั้น ไม่รวม -code-verifier ของ PKCE และ -user
export function readStoredSession() {
  try {
    for (const store of [safeStorage('session'), safeStorage('local')]) {
      if (!store) continue
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i)
        if (!key || !/^sb-.+-auth-token$/.test(key)) continue
        const parsed = JSON.parse(store.getItem(key))
        if (parsed?.access_token && parsed?.refresh_token && parsed?.user) return parsed
      }
    }
  } catch {
    // ค่าในเครื่องเสียหรืออ่านไม่ได้ ถือว่าไม่มี session
  }
  return null
}

// ── ไม่ให้ทุกคำขอค้างตามตัวต่ออายุ token ─────────────────────────────────────────────────
//
// supabase-js ทุก request (REST/RPC/Storage/Functions) เรียก auth.getSession() เพื่อเอา token ก่อนส่ง
// (SupabaseClient._getAccessToken) และเมื่อ access token หมดอายุ getSession() จะรอให้ refresh จบ —
// พอ refresh ล้มชั่วคราว auth-js ลองซ้ำเองด้วย backoff รวม ~25 วินาที ทุก request ในแอปค้างตามไปหมด
// รวมถึงโหลดข้อมูลหน่วยงานที่ TenantContext ยอมรอแค่ 12 วินาทีแล้วขึ้น "ไม่สามารถเชื่อมต่อระบบได้"
// (พบตอนทดสอบบนเบราว์เซอร์จริง: หลังแก้ให้ session รอด แอปทั้งหน้าล่มแทนที่จะถูกเตะ ซึ่งแย่พอกัน)
//
// ทางแก้: ถ้า token ใกล้หมด/หมดอายุแล้ว ให้รอ refresh ได้ไม่เกิน TOKEN_WAIT_MS และเลิกรอทันทีที่
// fetchWithAuthRecovery เริ่มพักการยิง (แปลว่าเซิร์ฟเวอร์เพิ่งล้ม) แล้วปล่อย request ไปต่อ
//   • token ยังใช้ได้อีกเกิน TOKEN_USABLE_MIN_MS → ส่งด้วย token เดิม สิทธิ์ผู้ใช้ไม่หาย
//   • หมดอายุแล้ว → ส่งแบบไม่มี token (ข้อมูลสาธารณะโหลดได้ ส่วนที่ต้องล็อกอินจะไม่ผ่าน RLS)
// ตัวต่ออายุอัตโนมัติของ SDK ยังลองต่อเองตามรอบ พอสำเร็จ request ถัดไปก็ได้ token ใหม่เอง
// ช่วงที่ refresh ปกติ (ตอบภายในไม่กี่วินาที) ไม่มีอะไรเปลี่ยน — ผลลัพธ์จริงของ SDK มาก่อนเสมอ
//
// ⚠️ ผูกกับรายละเอียดภายในของ supabase-js ที่ _getAccessToken เรียก this.auth.getSession() ถ้า SDK
// เปลี่ยนวิธีนี้ในอนาคต ตัวกันค้างจะไม่ทำงานแต่ไม่มีอะไรพัง (กลับไปรอเหมือนเดิม)
const SDK_EXPIRY_MARGIN_MS = 90_000 // auth-js constants.EXPIRY_MARGIN_MS = 3 tick × 30 วิ
const TOKEN_WAIT_MS = 5000
const TOKEN_USABLE_MIN_MS = 5000
const TOKEN_POLL_MS = 250

const sdkGetSession = supabase.auth.getSession.bind(supabase.auth)

supabase.auth.getSession = async function getSessionWithoutStalling() {
  const stored = readStoredSession()
  const msLeft = stored?.expires_at ? stored.expires_at * 1000 - Date.now() : null
  // ไม่มี session หรือ token ยังสด = เส้นทางปกติของ SDK ไม่ต้องยุ่ง
  if (msLeft === null || msLeft >= SDK_EXPIRY_MARGIN_MS) return sdkGetSession()

  const withoutRefresh = () => (msLeft > TOKEN_USABLE_MIN_MS
    ? { data: { session: stored }, error: null }
    : { data: { session: null }, error: new AuthRetryableFetchError('Token refresh is not available right now', 0) })

  if (Date.now() < refreshCooldownUntil) return withoutRefresh()

  let settled = null
  sdkGetSession().then(
    (result) => { settled = result },
    (err) => { settled = { data: { session: null }, error: err } },
  )
  const startedAt = Date.now()
  while (!settled && Date.now() - startedAt < TOKEN_WAIT_MS && Date.now() >= refreshCooldownUntil) {
    await new Promise((resolve) => setTimeout(resolve, TOKEN_POLL_MS))
  }
  return settled ?? withoutRefresh()
}

/**
 * แทน supabase.auth.getSession() ในจุดที่ "ไม่มี session = พาไปหน้าเข้าสู่ระบบ"
 *
 * ปัญหา: ถ้า access token หมดอายุแล้วตอนเปิดแอป (มือถือพักไว้เกิน 1 ชั่วโมง) แล้วต่ออายุไม่ทันเพราะ
 * สัญญาณแย่/เซิร์ฟเวอร์สะดุด auth-js คืน { session: null, error } ทั้งที่ session ยังอยู่ในเครื่อง
 * (GoTrueClient.__loadSession) หน้าที่เห็น null แล้ว navigate ไป /auth จึงพาผู้ใช้ออกจากระบบทั้งที่
 * ยังล็อกอินอยู่ — คนที่จำรหัสผ่านไม่ได้จะเข้าไม่ได้อีกเลย
 *
 * ทางแก้: ถ้าล้มเพราะการเชื่อมต่อให้คืน session ที่ค้างในเครื่องไปก่อน แล้วปล่อยให้ตัวต่ออายุ
 * อัตโนมัติของ SDK ลองต่อเอง (สำเร็จ → TOKEN_REFRESHED, ตายจริง → SIGNED_OUT)
 * ถ้าเซิร์ฟเวอร์ยืนยันว่าตายจริง SDK ลบ session ออกจากเครื่องไปแล้ว readStoredSession จึงได้ null
 * และคืนผล "ไม่มี session" ตามเดิม
 */
export async function getSessionResilient() {
  let result
  try {
    result = await supabase.auth.getSession()
  } catch (err) {
    result = { data: { session: null }, error: err }
  }

  if (result?.data?.session) return result
  if (isNetworkAuthError(result?.error)) {
    const stored = readStoredSession()
    if (stored) return { data: { session: stored }, error: null }
  }
  return result
}

// supabase-js เก็บ session ไว้ที่ key `sb-<project-ref>-auth-token` ใน localStorage และมี key
// พี่น้องที่ขึ้นต้นเหมือนกัน (เช่น -code-verifier ของ PKCE) กวาดด้วย prefix แทนการ hardcode
// ชื่อเต็ม เพื่อไม่ให้พังเงียบๆ ถ้า supabase-js เปลี่ยนรูปแบบ key ภายในวันหลัง
function purgeStoredAuthSession() {
  try {
    // กวาด sessionStorage ด้วยเผื่อมีแท็บเก่าที่ยังรันโค้ดรุ่นก่อน (ซึ่งเก็บ session ที่นั่นเมื่อไม่ติ๊กจำ)
    // เขียนทิ้งไว้ — ไม่งั้นการบังคับออกจากระบบจะไม่มีผลกับ session นั้น
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
    // scope 'local' = เพิกถอนเฉพาะ session ของเครื่องนี้ ห้ามปล่อยเป็นค่าเริ่มต้นของ SDK
    // (auth-js GoTrueClient.signOut: options = { scope: 'global' }) เพราะ global เตะ "ทุกเครื่อง"
    // ของบัญชีนั้นออกด้วย — ผู้สูงอายุที่ติ๊กจำไว้บนมือถือตัวเอง แล้วลูกหลานไปกดออกบนเครื่องอื่นของ
    // บัญชีเดียวกัน (หรือเจ้าหน้าที่กดออกจาก PC สำนักงาน) จะถูกเตะจากมือถือไปด้วยโดยไม่มีใครบนมือถือ
    // เครื่องนั้นสั่ง ซึ่งขัดกับกติกาที่ว่าห้ามหลุดเองนอกจากเจ้าของเครื่องสั่ง
    // local ยังเรียกเซิร์ฟเวอร์ให้เพิกถอน session นี้จริง (GoTrueClient._signOut → admin.signOut
    // ด้วย scope นั้น) ไม่ใช่แค่ลบในเครื่อง; ถ้าต้องการเตะเครื่องอื่นให้ใช้ ActiveSessions แทน
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (!error) {
      // SDK ล้างเฉพาะ localStorage — สำเนาที่แท็บเก่า (รันโค้ดรุ่นที่มีช่องติ๊ก) เขียนทิ้งไว้ใน
      // sessionStorage ต้องล้างด้วย ไม่งั้นการย้ายของเก่าตอนโหลดหน้าถัดไปจะปลุก session นั้นกลับมา
      // ผู้ใช้ที่กดออกแล้วจะกลับมาล็อกอินเองโดยไม่ได้สั่ง ขัดกับ "ถ้าจะออกให้เขากดออกเอง"
      purgeStoredAuthSession()
      return { ok: true, forced: false }
    }
    console.warn('[auth] signOut() คืน error, บังคับล้าง session ในเครื่อง:', error.message)
  } catch (err) {
    console.warn('[auth] signOut() โยน error, บังคับล้าง session ในเครื่อง:', err?.message ?? err)
  }

  purgeStoredAuthSession()
  window.location.assign(redirectTo)
  return { ok: true, forced: true }
}
