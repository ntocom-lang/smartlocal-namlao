// เปิดหน้าเว็บของระบบก่อนเริ่ม OAuth; ห้ามย้าย callback/token ไปอีกเบราว์เซอร์
export const CHROME_PKG = 'com.android.chrome'

const OEM_BROWSERS = /SamsungBrowser\/|MiuiBrowser\/|HeyTapBrowser\/|OppoBrowser\/|VivoBrowser\/|HuaweiBrowser\/|UCBrowser\/|MQQBrowser\/|EdgA\/|OPR\/|YaBrowser\//i

export function detectBrowserEnvironment(ua = navigator.userAgent || '') {
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
  const isAndroid = /Android/i.test(ua)
  const isLine = /Line\//i.test(ua)
  // fbclid เป็นเพียง tracking parameter: Safari/Chrome ที่เปิดลิงก์จาก Facebook ก็มีได้
  const isInApp = isLine || /FBAN|FBAV|FBIOS|FB_IAB|Instagram|Twitter\/|MicroMessenger|GSA\/|; wv\)/i.test(ua)
  return { isIOS, isAndroid, isLine, isInApp }
}

// ใช้เพื่อเสนอทางเลือกเท่านั้น UA บอกไม่ได้ว่ามี Google/LINE session อยู่หรือไม่
export function isAndroidNonChrome() {
  const ua = navigator.userAgent || ''
  const env = detectBrowserEnvironment(ua)
  if (!env.isAndroid || env.isInApp) return false
  return !/Chrome\//i.test(ua) || OEM_BROWSERS.test(ua)
}

const AUTH_PARAMS = /^(?:code|state|nonce|token|token_hash|access_token|refresh_token|id_token|provider_token|provider_refresh_token|code_verifier|code_challenge|code_challenge_method|error|error_code|error_description|expires_in|expires_at|token_type|type|openExternalBrowser|openInAppBrowser)$/i

export function browserHandoffUrl(href = window.location.href) {
  const url = new URL(href)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('ลิงก์สำหรับเปิดเบราว์เซอร์ไม่ถูกต้อง')
  }
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) {
    if (AUTH_PARAMS.test(key)) url.searchParams.delete(key)
  }
  return url.href
}

// รับเฉพาะ path ภายในแอป; next จาก URL ต้องไม่พาออกนอกเว็บหรือพ่วงข้อมูล OAuth
export function authReturnPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || /^\/[/\\]/.test(value) || value.includes('\\') || [...value].some((c) => c.charCodeAt(0) <= 32)) return '/'
  try {
    const decoded = decodeURIComponent(value)
    if (/^\/[/\\]/.test(decoded) || decoded.includes('\\') || [...decoded].some((c) => c.charCodeAt(0) < 32)) return '/'
    const url = new URL(value, 'https://app.invalid')
    if (url.origin !== 'https://app.invalid') return '/'
    const normalized = decodeURIComponent(url.pathname)
    if (/^\/[/\\]/.test(normalized) || normalized.includes('\\') || [...normalized].some((c) => c.charCodeAt(0) < 32)) return '/'
    // ทางเข้าคำขอขยะส่งชนิดเอกสารกลับมาด้วย ต้องคงไว้หลัง login
    const docType = url.searchParams.get('type')
    const query = url.pathname === '/doc-request' && /^[a-z][a-z0-9_]{0,63}$/.test(docType ?? '')
      ? `?type=${docType}` : ''
    return url.pathname + query // ไม่ส่ง query อื่น/hash หรือข้อมูลฟอร์ม
  } catch { return '/' }
}

// ต้องเรียกจากการแตะของผู้ใช้ และไม่มี fallback URL ที่วนกลับเข้า WebView
export function openInAndroidBrowser(pkg = CHROME_PKG, href = window.location.href) {
  if (pkg !== null && pkg !== CHROME_PKG) throw new Error('ไม่รองรับเบราว์เซอร์นี้')
  const url = new URL(browserHandoffUrl(href))
  const pkgPart = pkg ? `package=${pkg};` : ''
  window.location.href = `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${url.protocol.slice(0, -1)};action=android.intent.action.VIEW;${pkgPart}end`
}

// LINE เปิด default browser ของเครื่อง ไม่รับประกันว่าเป็น Chrome หรือ Safari
export function openLineExternalBrowser(href = window.location.href) {
  const url = new URL(browserHandoffUrl(href))
  url.searchParams.set('openExternalBrowser', '1')
  if (url.href === window.location.href) return false
  window.location.assign ? window.location.assign(url.href) : window.location.replace(url.href)
  return true
}
