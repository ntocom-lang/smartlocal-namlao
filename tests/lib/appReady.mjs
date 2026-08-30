// ── ตัวรอ "แอปตัดสินสิทธิ์เสร็จแล้ว" สำหรับ E2E ทุกชุด ─────────────────────────────
//
// ของเดิมทุกชุดใช้ `await page.waitForTimeout(1200)` แล้วอ่าน location.pathname ทันที ซึ่งผิด
// ทั้งสองทาง เพราะ RequireAuth ใน src/App.jsx คืน null (จอว่าง ไม่ redirect) ตลอดช่วงที่
// session/role/tenant ยังโหลดไม่เสร็จ:
//
//   false FAIL — role มาช้ากว่า 1.2 วิ ตอนที่วัด pathname ยังเป็น route ต้องห้ามอยู่ ทั้งที่อีก
//                ครึ่งวินาทีถัดมาแอปเด้งออกถูกต้อง (เจอจริง 2026-08-30: demo-council /admin
//                FAIL ตอนรันครบ 17 บัญชี แต่ PASS ทุกครั้งที่รันเดี่ยว)
//   false PASS — อันตรายกว่า: จอว่างเพราะ role ยังไม่มา แต่ pathname ตรงกับ route ที่ต้องเข้าได้
//                assertion จึงผ่านทั้งที่ไม่มีอะไรเรนเดอร์เลย (วัดได้จริง: cold start บนสนามซ้อม
//                body ว่างเปล่าต่อเนื่องเกิน 8 วินาที) ถ้าวันหนึ่งสิทธิ์พังจริงจะรายงานว่าผ่าน
//
// สัญญาณที่เชื่อได้คือ response ของ PostgREST ที่อ่าน public.profiles — เป็นจุดเดียวที่
// AuthContext ใช้ set role (ดู fetchProfile ใน src/lib/profileFetch.js) ยิงครั้งเดียวตอน boot
// หลังจากนั้นการเปลี่ยนหน้าเป็น synchronous ทั้งหมด
//
// เงื่อนไขที่ถือว่า settle = (รู้ผลสิทธิ์แล้ว หรืออยู่หน้า login) และ (มีเนื้อหาเรนเดอร์จริง)
// และ (pathname นิ่งมาแล้วอย่างน้อย STABLE_MS) ครบเวลาแล้วยังไม่เข้าเงื่อนไข = BLOCKED
// ห้ามปล่อยผ่านเป็น PASS เด็ดขาด

export class BlockedError extends Error {}

const PROFILE_REST_PATTERN = /\/rest\/v1\/profiles(\?|$)/
const SIGNED_OUT_PATHS = ['/auth', '/admin/login']
const PROFILE_ERROR_TEXT = 'ตรวจสอบสิทธิ์การเข้าใช้งานไม่สำเร็จ'
const MIN_RENDERED_CHARS = 40
const STABLE_MS = 500
const SETTLE_TIMEOUT_MS = 20_000
const POLL_MS = 150

export function pathnameOf(page) {
  return new URL(page.url()).pathname
}

/** เริ่มดักจังหวะที่ role ถูก resolve — ต้องเรียกก่อน page.goto() ครั้งแรกเสมอ */
export function trackProfileResolution(page) {
  const state = { resolvedAt: 0 }
  page.on('response', (response) => {
    // เก็บแค่ "เวลา" ไม่แตะ body ของ response เพราะเป็นข้อมูลโปรไฟล์ผู้ใช้ (PDPA)
    if (PROFILE_REST_PATTERN.test(response.url())) state.resolvedAt = Date.now()
  })
  return state
}

/**
 * รอจนหน้าจอนิ่งและมีเนื้อหาจริง คืน snapshot { path, chars }
 * authState = ผลจาก trackProfileResolution() ถ้าไม่ส่งมาจะข้ามเงื่อนไข "รู้ผลสิทธิ์แล้ว"
 */
export async function waitForSettled(page, authState, { timeout = SETTLE_TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeout
  let lastPath = null
  let stableSince = Date.now()
  let snapshot = { path: pathnameOf(page), chars: 0 }

  while (Date.now() < deadline) {
    snapshot = await page.evaluate((errorText) => {
      const text = document.body?.innerText ?? ''
      // เช็คแค่ "มีคีย์ session อยู่ไหม" ไม่อ่านค่า token ออกมาเด็ดขาด
      let hasStoredSession = false
      try {
        hasStoredSession = Object.keys(localStorage).some((key) => /^sb-.+-auth-token$/.test(key))
      } catch {
        hasStoredSession = true // อ่าน storage ไม่ได้ = เดาว่ายังต้องรอผลสิทธิ์ ปลอดภัยกว่า
      }
      return {
        path: location.pathname,
        chars: text.trim().length,
        profileError: text.includes(errorText),
        hasStoredSession,
      }
    }, PROFILE_ERROR_TEXT)

    if (snapshot.profileError) throw new BlockedError('อ่านโปรไฟล์/สิทธิ์ไม่สำเร็จ (หน้าแสดงปุ่มลองใหม่)')

    if (snapshot.path !== lastPath) {
      lastPath = snapshot.path
      stableSince = Date.now()
    }

    // ไม่มี session ค้างในเครื่อง = ไม่มีการอ่าน profiles ให้รอตั้งแต่ต้น (เช่น Chrome Profile ที่
    // session หมดอายุ) ของเดิมรอ 20 วินาทีแล้วค่อย BLOCKED ทั้งที่ตอบได้ทันทีว่า "ยังไม่ล็อกอิน"
    const signedOut = SIGNED_OUT_PATHS.includes(snapshot.path) || !snapshot.hasStoredSession
    const authKnown = !authState || signedOut || authState.resolvedAt > 0
    if (authKnown && snapshot.chars >= MIN_RENDERED_CHARS && Date.now() - stableSince >= STABLE_MS) {
      return snapshot
    }
    await page.waitForTimeout(POLL_MS)
  }

  throw new BlockedError(
    `แอปไม่พร้อมตรวจภายใน ${Math.round(timeout / 1000)} วินาที `
    + `(path=${snapshot.path}, เนื้อหา ${snapshot.chars} ตัวอักษร) — ไม่นับเป็นผ่าน`,
  )
}

/** เปลี่ยนหน้าแบบ client-side (ไม่ reload ทั้งแอป) แล้วรอจน settle คืน pathname สุดท้ายจริง */
export async function navigateClientSide(page, authState, route) {
  await page.evaluate((nextRoute) => {
    window.history.pushState({}, '', nextRoute)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, route)
  const { path } = await waitForSettled(page, authState)
  return path
}
