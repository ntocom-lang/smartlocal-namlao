import { useEffect, useState, useCallback } from 'react'
import { Copy, Check } from 'lucide-react'

/* ─── detect ─────────────────────────────────────────────── */
function detectEnv() {
  const ua = navigator.userAgent || ''
  const params  = new URLSearchParams(window.location.search)
  const isIOS     = /iPhone|iPad|iPod/i.test(ua)
  const isAndroid = /Android/i.test(ua)
  const isMobile  = isIOS || isAndroid

  const isLine      = /Line\//i.test(ua)
  const isFacebook  = /FBAN|FBAV|FBIOS|FB_IAB/i.test(ua)
  const isInstagram = /Instagram/i.test(ua)
  const isTwitter   = /Twitter\//i.test(ua)
  const isWeChat    = /MicroMessenger/i.test(ua)
  const isGSA       = /GSA\//i.test(ua) // Google app iOS
  // Android WebView (ครอบ apps ที่เปิด link ใน built-in browser)
  const isWebView   = isMobile && /; wv\)/i.test(ua)
  // fbclid บนมือถือ = คลิกจาก Facebook/Messenger เกือบ 100%
  const hasFbclid   = isMobile && params.has('fbclid')

  const isInApp = isLine || isFacebook || isInstagram || isTwitter ||
                  isWeChat || isGSA || isWebView || hasFbclid

  return { isInApp, isLine, isFacebook: isFacebook || hasFbclid, isInstagram, isIOS, isAndroid }
}

/* ─── redirect helpers ───────────────────────────────────── */
function redirectChromeiOS() {
  const url = window.location.href
  window.location.href = url
    .replace(/^https:\/\//, 'googlechromes://')
    .replace(/^http:\/\//, 'googlechrome://')
}

const CHROME_PKG = 'com.android.chrome'

// ส่งต่อออกจาก in-app browser ด้วย intent:// — pkg = null คือปล่อยให้ Android เลือก default browser
//
// ต้องเจาะจง Chrome เป็นตัวแรกเสมอ ไม่ใช่ default browser ของเครื่องอย่างที่โค้ดเดิมตั้งใจทำ:
// Mi / Vivo / Oppo / Samsung Browser ไม่มีคุกกี้ accounts.google.com ค้างอยู่ และมักบล็อกการเด้ง
// scheme line:// ผลคือทั้ง Google และ LINE ตกไปหน้าให้กรอกอีเมล+รหัสผ่าน ซึ่งประชาชนส่วนใหญ่
// จำรหัส Google ไม่ได้ และบัญชี LINE จำนวนมากไม่เคยตั้งรหัสผ่านไว้เลย → สมัครไม่จบสักราย
// Chrome บน Android ผูกกับบัญชีในเครื่องอยู่แล้ว จึงขึ้นหน้า "เลือกบัญชี" ให้เลย และเป็นตัวเดียว
// ในกลุ่มนี้ที่ยิง beforeinstallprompt → ปุ่ม "ติดตั้งแอป" กลับมาโผล่ด้วย
//
// ห้ามใส่ S.browser_fallback_url ชี้กลับ URL เดิมเป็นทางสำรอง: เครื่องที่ไม่มี Chrome จะโหลด URL
// นั้นใน webview เดิม (LINE) แล้ววนกลับเข้า gate ยิง intent ซ้ำไม่รู้จบ — ใช้ cascade ใน
// useEffect ไล่ทีละขั้นแทน
function redirectExternalAndroid(pkg = CHROME_PKG) {
  const withoutScheme = window.location.href.replace(/^https?:\/\//, '')
  const pkgPart = pkg ? `package=${pkg};` : ''
  window.location.href =
    `intent://${withoutScheme}#Intent;scheme=https;action=android.intent.action.VIEW;${pkgPart}end`
}

// LINE มีกลไกเปิดเบราว์เซอร์นอกของตัวเอง ใช้เป็นบันไดขั้นรองเมื่อ intent ที่ล็อก package ไม่ทำงาน
function redirectLineExternal() {
  const sep = window.location.search ? '&' : '?'
  window.location.replace(window.location.href + sep + 'openExternalBrowser=1')
}

/* ─── Gate ───────────────────────────────────────────────── */
export default function InAppBrowserGate({ children }) {
  const [blocked, setBlocked] = useState(false)
  const [env, setEnv] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const e = detectEnv()
    if (!e.isInApp) return

    // URL มี openExternalBrowser อยู่แล้ว → redirect ล้มเหลว (LINE เก่ามาก) → block ทันที
    if (new URLSearchParams(window.location.search).get('openExternalBrowser')) {
      setEnv(e)
      setBlocked(true)
      return
    }

    // ออกจากหน้านี้ไปแล้วหรือยัง — ใช้ตัดสินว่าขั้นก่อนหน้าของ cascade สำเร็จไปแล้วไหม
    // (เบราว์เซอร์ตัวใหม่เปิดทับ = webview เดิมถูกพักไว้หลังฉาก) ถ้าไม่เช็ค ผู้ใช้จะโดนเปิด
    // เบราว์เซอร์ซ้อนกันสองตัวในกรณีที่ขั้นแรกทำงานสำเร็จอยู่แล้ว
    // ไม่ผูกกับ blur: บน webview มันเด้งได้เองตอนคีย์บอร์ด/overlay โผล่ ถ้าเอามานับว่า
    // "ออกไปแล้ว" cascade จะหยุดกลางคันทั้งที่ผู้ใช้ยังอยู่หน้าเดิม แล้วค้างใน webview
    // โดยไม่มีหน้า gate ให้กดต่อ — visibilitychange/pagehide เพียงพอแล้วเมื่อมีแอปเปิดทับ
    let left = false
    const markLeft = () => { left = true }
    const onVisibility = () => { if (document.hidden) left = true }
    window.addEventListener('pagehide', markLeft)
    document.addEventListener('visibilitychange', onVisibility)
    const stillHere = () => !left && document.visibilityState === 'visible'

    const timers = []
    const showGateLater = (ms) =>
      timers.push(setTimeout(() => { if (stillHere()) { setEnv(e); setBlocked(true) } }, ms))

    if (e.isAndroid) {
      // ขั้น 1: ยิงเข้า Chrome ตรงๆ — ครอบ LINE บน Android ด้วย เพราะ openExternalBrowser ของ
      // LINE เปิด "default browser ของเครื่อง" ซึ่งคือต้นตอของปัญหา ไม่ใช่ทางแก้
      redirectExternalAndroid(CHROME_PKG)

      timers.push(setTimeout(() => {
        if (!stillHere()) return
        // ขั้น 2: เครื่องไม่มี Chrome (Huawei ที่ไม่มี GMS, เครื่องที่ปิด Chrome ไว้) หรือ webview
        // บล็อก intent ที่ล็อก package — ยอมได้ default browser ดีกว่าปล่อยให้ติดใน webview
        if (e.isLine) redirectLineExternal()
        else redirectExternalAndroid(null)
        // ขั้น 3: ไปต่อไม่ได้จริงๆ → โชว์ gate ให้ผู้ใช้กดเลือกเอง
        showGateLater(1400)
      }, 1200))
    } else if (e.isLine) {
      // iOS: LINE 10+ เปิด Safari ให้เองจากพารามิเตอร์นี้ (บน iOS ต้องเป็น Safari ไม่ใช่ Chrome
      // เพราะคุกกี้ของสองตัวแยกกัน และ Safari คือตัวที่มี session Google ค้างอยู่)
      // ถ้าถูก ignore หน้าจะ reload พร้อมพารามิเตอร์ แล้วไปเข้าเงื่อนไข openExternalBrowser ด้านบน
      redirectLineExternal()
      showGateLater(2000)
    } else {
      // iOS non-LINE in-app browser (Facebook, Instagram) — แสดง gate เลย
      setEnv(e)
      setBlocked(true)
    }

    return () => {
      timers.forEach(clearTimeout)
      window.removeEventListener('pagehide', markLeft)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const copyUrl = useCallback(() => {
    navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }, [])

  if (!blocked || !env) return children

  /* ─── full-screen block page ─────────────────────────── */
  const url = window.location.href

  return (
    <div className="fixed inset-0 z-99999 flex flex-col items-center justify-center bg-gray-50 px-6 overflow-y-auto py-8">
      {/* Icon */}
      <div className="w-20 h-20 rounded-3xl mb-5 flex items-center justify-center shadow-lg shrink-0"
           style={{ background: env.isLine
             ? 'linear-gradient(135deg, #00B900 0%, #008f00 100%)'
             : 'linear-gradient(135deg, var(--color-primary,#2563eb) 0%, var(--color-primary-dark,#1d4ed8) 100%)' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2}
             strokeLinecap="round" strokeLinejoin="round" className="w-10 h-10">
          <circle cx="12" cy="12" r="10"/>
          <line x1="2" y1="12" x2="22" y2="12"/>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
      </div>

      <h1 className="text-xl font-bold text-gray-800 text-center mb-2">
        กรุณาเปิดในเบราว์เซอร์
      </h1>
      <p className="text-sm text-gray-500 text-center leading-relaxed mb-4">
        {env.isLine ? (
          <>
            แอปนี้ไม่รองรับบราวเซอร์ใน LINE<br />
            กรุณาเปิดด้วย Chrome (Android) หรือ Safari (iPhone)<br />
            <span className="text-red-400 font-medium">เพื่อให้ สมัคร / เข้าสู่ระบบ ได้ปกติ</span>
          </>
        ) : (
          <>
            แอปนี้ไม่รองรับบราวเซอร์ภายในแอป<br />
            (Line / Facebook / Instagram)<br />
            กรุณาเปิดด้วย Chrome (Android) หรือ Safari (iPhone)
          </>
        )}
      </p>

      {/* LINE step-by-step instructions */}
      {env.isLine && (
        <div className="w-full max-w-xs bg-green-50 border border-green-200 rounded-2xl p-4 mb-4">
          <p className="text-xs font-bold text-green-700 text-center mb-3">วิธีเปิดจาก LINE (แนะนำ)</p>
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-green-500 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
              <p className="text-sm text-gray-700">แตะปุ่ม <strong>···</strong> (สามจุด) ที่ <strong>มุมขวาบน</strong> ของหน้าจอ</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-green-500 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">2</span>
              <p className="text-sm text-gray-700">แตะ <strong>&ldquo;เปิดด้วยเบราว์เซอร์ภายนอก&rdquo;</strong></p>
            </div>
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-amber-400 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">!</span>
              <p className="text-xs text-gray-500">ถ้าไม่มีตัวเลือกนั้น ให้ใช้ปุ่มด้านล่าง หรือคัดลอกลิงก์แล้วเปิดใน Chrome แทน</p>
            </div>
          </div>
        </div>
      )}

      <div className="w-full max-w-xs flex flex-col gap-3">
        {/* Chrome button */}
        <button
          onClick={env.isAndroid ? () => redirectExternalAndroid(CHROME_PKG) : redirectChromeiOS}
          className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl text-white font-bold text-base shadow-md active:scale-95 transition-all"
          style={{ background: 'linear-gradient(135deg, #4285F4 0%, #1a56db 100%)' }}
        >
          <svg width="22" height="22" viewBox="0 0 48 48" fill="none">
            <path d="M47.5 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h13.2c-.6 3-2.3 5.6-4.9 7.3v6h7.9c4.6-4.3 7.3-10.6 7.3-17.5z" fill="#fff"/>
            <path d="M24 48c6.6 0 12.2-2.2 16.2-5.9l-7.9-6c-2.2 1.5-5 2.3-8.3 2.3-6.4 0-11.8-4.3-13.7-10.1H2.1v6.2C6.1 42.7 14.5 48 24 48z" fill="#ffffffcc"/>
            <path d="M10.3 28.3c-.5-1.5-.8-3-.8-4.3s.3-2.8.8-4.3v-6.2H2.1C.8 16.2 0 19.9 0 24s.8 7.8 2.1 10.5l8.2-6.2z" fill="#ffffffaa"/>
            <path d="M24 9.5c3.6 0 6.8 1.2 9.3 3.6l6.9-6.9C36.2 2.3 30.6 0 24 0 14.5 0 6.1 5.3 2.1 13.5l8.2 6.2C12.2 13.8 17.6 9.5 24 9.5z" fill="#ffffffdd"/>
          </svg>
          เปิดใน Google Chrome
        </button>

        {/* เครื่องที่ไม่มี Chrome (Huawei ไม่มี GMS หรือผู้ใช้ปิด Chrome ไว้) ต้องมีทางออก
            จาก webview ให้เสมอ แม้เบราว์เซอร์ที่ได้จะไม่มี session Google ค้างอยู่ก็ตาม */}
        {env.isAndroid && (
          <button
            type="button"
            onClick={() => redirectExternalAndroid(null)}
            className="w-full py-3 rounded-2xl bg-white border-2 border-gray-200 text-gray-600 font-semibold text-sm active:scale-95 transition-all"
          >
            ไม่มี Chrome? เปิดในเบราว์เซอร์ของเครื่อง
          </button>
        )}

        {/* Safari (iOS only) */}
        {env.isIOS && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-white border-2 border-gray-200 text-gray-800 font-bold text-base shadow-sm active:scale-95 transition-all"
          >
            <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
              <circle cx="12" cy="12" r="10" stroke="#006FFF" strokeWidth="2"/>
              <path d="M16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z" fill="#006FFF"/>
              <circle cx="12" cy="12" r="1" fill="white"/>
            </svg>
            เปิดใน Safari
          </a>
        )}

        {/* Copy URL */}
        <div className="flex flex-col items-center gap-2 mt-2">
          <p className="text-xs text-gray-400">หรือคัดลอกลิงก์แล้วเปิดในบราวเซอร์เอง</p>
          <button
            onClick={copyUrl}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gray-100 text-gray-600 text-sm font-medium active:scale-95 transition-all"
          >
            {copied ? <Check size={15} className="text-green-500" /> : <Copy size={15} />}
            {copied ? 'คัดลอกแล้ว!' : 'คัดลอกลิงก์'}
          </button>
          <p className="text-[13px] text-gray-300 text-center break-all px-2 max-w-xs">{url}</p>
        </div>
      </div>
    </div>
  )
}
