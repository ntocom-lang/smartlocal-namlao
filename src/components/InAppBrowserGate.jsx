import { useEffect, useState, useCallback } from 'react'
import { Copy, Check } from 'lucide-react'

/* ─── detect ─────────────────────────────────────────────── */
function detectEnv() {
  const ua = navigator.userAgent || ''
  const isLine     = /Line\//i.test(ua)
  const isFacebook = /FBAN|FBAV/i.test(ua)
  const isInstagram = /Instagram/i.test(ua)
  const isTwitter  = /Twitter\//i.test(ua)
  const isWeChat   = /MicroMessenger/i.test(ua)
  const isGSA      = /GSA\//i.test(ua) // Google app iOS
  const isInApp    = isLine || isFacebook || isInstagram || isTwitter || isWeChat || isGSA
  const isIOS      = /iPhone|iPad|iPod/i.test(ua)
  const isAndroid  = /Android/i.test(ua)
  return { isInApp, isLine, isFacebook, isInstagram, isIOS, isAndroid }
}

/* ─── redirect helpers ───────────────────────────────────── */
function redirectChromeiOS() {
  const url = window.location.href
  window.location.href = url
    .replace(/^https:\/\//, 'googlechromes://')
    .replace(/^http:\/\//, 'googlechrome://')
}

function redirectChromeAndroid() {
  const url = window.location.href
  const withoutScheme = url.replace(/^https?:\/\//, '')
  window.location.href = `intent://${withoutScheme}#Intent;scheme=https;package=com.android.chrome;end`
}

/* ─── Gate ───────────────────────────────────────────────── */
export default function InAppBrowserGate({ children }) {
  const [blocked, setBlocked] = useState(false)
  const [env, setEnv] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const e = detectEnv()
    if (!e.isInApp) return

    // ถ้า URL มี openExternalBrowser อยู่แล้ว → Line พยายาม redirect แล้วแต่ล้มเหลว → block
    const params = new URLSearchParams(window.location.search)
    if (params.get('openExternalBrowser')) {
      setEnv(e)
      setBlocked(true)
      return
    }

    // Line: ใช้ query param ให้เปิดใน browser ภายนอกอัตโนมัติ
    if (e.isLine) {
      const sep = window.location.search ? '&' : '?'
      window.location.replace(window.location.href + sep + 'openExternalBrowser=1')
      // ถ้า replace ทำงาน → page จะออกจาก Line ไป Safari/Chrome เลย
      // ถ้าไม่ได้ผลภายใน 1.5s → แสดง block screen
      setTimeout(() => { setEnv(e); setBlocked(true) }, 1500)
      return
    }

    // Facebook / Instagram / อื่นๆ: ลอง Chrome ก่อน
    if (e.isAndroid) {
      redirectChromeAndroid()
      setTimeout(() => { setEnv(e); setBlocked(true) }, 2000)
    } else {
      // iOS: แสดง block screen เลย (Chrome scheme กด manual ดีกว่า auto เพราะ iOS ถาม confirm)
      setEnv(e)
      setBlocked(true)
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
    <div className="fixed inset-0 z-99999 flex flex-col items-center justify-center bg-gray-50 px-6">
      {/* Icon */}
      <div className="w-20 h-20 rounded-3xl mb-6 flex items-center justify-center shadow-lg"
           style={{ background: 'linear-gradient(135deg, var(--color-primary,#2563eb) 0%, var(--color-primary-dark,#1d4ed8) 100%)' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2}
             strokeLinecap="round" strokeLinejoin="round" className="w-10 h-10">
          <circle cx="12" cy="12" r="10"/>
          <line x1="2" y1="12" x2="22" y2="12"/>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
      </div>

      <h1 className="text-xl font-bold text-gray-800 text-center mb-2">
        กรุณาเปิดในบราวเซอร์
      </h1>
      <p className="text-sm text-gray-500 text-center leading-relaxed mb-8">
        แอปนี้ไม่รองรับบราวเซอร์ภายในแอป<br />
        (Line / Facebook / Instagram)<br />
        กรุณาเปิดด้วยบราวเซอร์หลักของเครื่อง
      </p>

      <div className="w-full max-w-xs flex flex-col gap-3">
        {/* Chrome button */}
        <button
          onClick={env.isAndroid ? redirectChromeAndroid : redirectChromeiOS}
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
          <p className="text-[11px] text-gray-300 text-center break-all px-2 max-w-xs">{url}</p>
        </div>
      </div>
    </div>
  )
}
