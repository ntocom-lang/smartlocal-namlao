import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

function detectLine() {
  const ua = navigator.userAgent
  return /Line\//i.test(ua)
}

function isAndroid() {
  return /Android/i.test(navigator.userAgent)
}

export default function LineBrowserBanner() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!detectLine()) return

    if (isAndroid()) {
      // ลอง redirect ไป Chrome ผ่าน intent://
      const { href } = window.location
      const withoutScheme = href.replace(/^https?:\/\//, '')
      window.location.href = `intent://${withoutScheme}#Intent;scheme=https;package=com.android.chrome;end`
      // ถ้า Chrome ไม่มี หรือ intent ไม่ทำงาน → fallback แสดง banner
      setTimeout(() => setShow(true), 2000)
    } else {
      // iOS — redirect ไม่ได้ แสดง banner แนะนำ
      setShow(true)
    }
  }, [])

  if (!show) return null

  return (
    <div
      className="fixed bottom-20 left-4 right-4 z-[9999] rounded-2xl shadow-2xl p-4 flex items-start gap-3"
      style={{ backgroundColor: '#06C755', color: '#fff' }}
    >
      {/* LINE icon */}
      <svg viewBox="0 0 24 24" className="w-7 h-7 shrink-0 mt-0.5" fill="white">
        <path d="M12 2C6.48 2 2 5.92 2 10.76c0 3.23 2.06 6.07 5.18 7.72-.18.65-.67 2.38-.77 2.75-.12.44.16.43.34.31.14-.09 2.22-1.47 3.12-2.07.69.1 1.4.15 2.13.15 5.52 0 10-3.92 10-8.76S17.52 2 12 2z"/>
      </svg>

      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm">เปิดในเบราว์เซอร์ภายนอก</p>
        <p className="text-xs mt-0.5 opacity-90">
          กดปุ่ม <strong>⋯</strong> มุมขวาบน → เลือก <strong>"เปิดใน browser ภายนอก"</strong>
        </p>
      </div>

      <button
        onClick={() => setShow(false)}
        className="shrink-0 opacity-80 hover:opacity-100 mt-0.5"
        aria-label="ปิด"
      >
        <X size={18} />
      </button>
    </div>
  )
}
