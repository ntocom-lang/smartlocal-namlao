// เทสต์การส่งผู้ใช้ออกไปเบราว์เซอร์ที่ล็อกอิน Google/LINE ได้จริง
// รันด้วย: node tests/external-browser.test.mjs
//
// ทำไมต้องมี: ทั้ง regex คัดยี่ห้อเบราว์เซอร์และรูปแบบสตริง intent:// พังแบบเงียบสนิท —
// ไม่มี error ไม่มีหน้าจอแดง มีแต่ผู้ใช้ที่สมัครไม่ได้แล้วเลิกใช้ไปเฉยๆ ยี่ห้อใหม่ออกทุกปี
// UA เปลี่ยนได้ตลอด เคสในนี้จึงคัดจาก UA จริงของเครื่องที่ขายในไทย
import assert from 'node:assert/strict'
import {
  CHROME_PKG, isAndroidNonChrome, openInAndroidBrowser, openLineExternalBrowser,
} from '../src/lib/externalBrowser.js'

function setUA(userAgent) {
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent }, configurable: true })
}

// คืนฟังก์ชันอ่านค่า URL ที่โค้ดสั่งให้เบราว์เซอร์ไป (ทั้ง href = ... และ replace())
function stubWindow(href) {
  const url = new URL(href)
  let target = null
  const location = {
    get href() { return href },
    set href(v) { target = v },
    get search() { return url.search },
    replace(v) { target = v },
  }
  Object.defineProperty(globalThis, 'window', { value: { location }, configurable: true })
  return () => target
}

// ── คัดเบราว์เซอร์: true = ต้องชวนผู้ใช้ย้ายไป Chrome ───────────────────────────
const UA_CASES = [
  ['Chrome Android', 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36', false],
  ['Samsung Internet', 'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-A125F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36', true],
  ['Mi Browser', 'Mozilla/5.0 (Linux; U; Android 12; en-us; Redmi Note 11) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/106.0.0.0 Mobile Safari/537.36 XiaoMi/MiuiBrowser/17.9.10', true],
  ['Vivo Browser', 'Mozilla/5.0 (Linux; Android 12; V2111) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Mobile Safari/537.36 VivoBrowser/10.5.0.0', true],
  ['Oppo HeyTap', 'Mozilla/5.0 (Linux; Android 12; CPH2325) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36 HeyTapBrowser/45.9.4.1', true],
  ['Huawei Browser', 'Mozilla/5.0 (Linux; Android 10; ELS-NX9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.5060.129 HuaweiBrowser/13.0.5.303 Mobile Safari/537.36', true],
  ['Firefox Android', 'Mozilla/5.0 (Android 13; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0', true],
  ['Edge Android', 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 EdgA/120.0.2210.126', true],
  // webview เป็นงานของ InAppBrowserGate ซึ่งเด้งออกให้เองอยู่แล้ว ห้ามถามซ้อน
  ['LINE webview', 'Mozilla/5.0 (Linux; Android 13; SM-A536E Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 Line/14.2.0', false],
  ['iPhone Safari', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', false],
  ['Windows Chrome', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', false],
]

for (const [name, ua, expected] of UA_CASES) {
  setUA(ua)
  assert.equal(isAndroidNonChrome(), expected, `คัดเบราว์เซอร์ผิดที่ ${name}`)
}

// ── สตริง intent:// ต้องถูกอักขระทุกตัว ผิดตัวเดียว Android เงียบไม่ทำอะไรเลย ────
let read = stubWindow('https://namlao.rk-networks.com/auth?from=qr')
openInAndroidBrowser()
assert.equal(
  read(),
  'intent://namlao.rk-networks.com/auth?from=qr#Intent;scheme=https;action=android.intent.action.VIEW;package=com.android.chrome;end',
)
assert.equal(CHROME_PKG, 'com.android.chrome')

// pkg = null → ไม่ล็อกยี่ห้อ ปล่อยให้ระบบเลือก (ทางสำรองของเครื่องที่ไม่มี Chrome)
read = stubWindow('https://namlao.rk-networks.com/auth')
openInAndroidBrowser(null)
assert.equal(
  read(),
  'intent://namlao.rk-networks.com/auth#Intent;scheme=https;action=android.intent.action.VIEW;end',
)
assert.ok(!read().includes('package='), 'ทางสำรองต้องไม่ล็อก package')

// ห้ามมี browser_fallback_url เด็ดขาด — เครื่องที่ไม่มี Chrome จะโหลด URL เดิมกลับเข้า
// webview เดิมแล้ววนยิง intent ซ้ำไม่รู้จบ
read = stubWindow('https://namlao.rk-networks.com/')
openInAndroidBrowser()
assert.ok(!read().includes('browser_fallback_url'))

// ── ทางลัดของ LINE: ต่อพารามิเตอร์ให้ถูกทั้งกรณีมีและไม่มี query เดิม ──────────
read = stubWindow('https://namlao.rk-networks.com/auth')
openLineExternalBrowser()
assert.equal(read(), 'https://namlao.rk-networks.com/auth?openExternalBrowser=1')

read = stubWindow('https://namlao.rk-networks.com/auth?from=qr')
openLineExternalBrowser()
assert.equal(read(), 'https://namlao.rk-networks.com/auth?from=qr&openExternalBrowser=1')

console.log('✅ external-browser: ผ่านทั้งหมด')
