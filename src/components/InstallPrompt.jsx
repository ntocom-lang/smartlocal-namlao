import { useEffect, useState } from 'react'
import { Download, X, UploadIcon, PlusSquare } from 'lucide-react'

const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent)
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true

function IOSGuide({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-4"
         onClick={onClose}>
      <div className="w-full max-w-sm bg-white rounded-3xl p-5 shadow-2xl"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <p className="font-bold text-gray-800 text-base">เพิ่มลงในหน้าจอหลัก</p>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-gray-100">
            <X size={18} className="text-gray-500" />
          </button>
        </div>
        <div className="space-y-3.5">
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-xs font-bold text-blue-600">1</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700">กดปุ่ม แชร์ ใน Safari</p>
              <p className="text-xs text-gray-400 mt-0.5">ปุ่มรูปกล่องมีลูกศรขึ้น ที่แถบด้านล่าง</p>
              <div className="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 rounded-lg">
                <UploadIcon size={14} className="text-blue-500" />
                <span className="text-xs text-gray-600 font-medium">Share</span>
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-xs font-bold text-blue-600">2</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700">เลือก "เพิ่มที่หน้าจอโฮม"</p>
              <p className="text-xs text-gray-400 mt-0.5">เลื่อนลงในเมนูที่ปรากฏขึ้น</p>
              <div className="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 rounded-lg">
                <PlusSquare size={14} className="text-gray-600" />
                <span className="text-xs text-gray-600 font-medium">Add to Home Screen</span>
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-xs font-bold text-blue-600">3</span>
            </div>
            <p className="text-sm font-semibold text-gray-700 mt-0.5">กด "เพิ่ม" มุมขวาบน</p>
          </div>
        </div>
        <button onClick={onClose}
          className="mt-5 w-full py-3 rounded-2xl font-bold text-sm text-white"
          style={{ background: 'var(--color-primary)' }}>
          เข้าใจแล้ว
        </button>
      </div>
    </div>
  )
}

export default function InstallPrompt() {
  const [prompt, setPrompt] = useState(null)
  const [visible, setVisible] = useState(false)
  const [iosMode, setIosMode] = useState(false)
  const [showGuide, setShowGuide] = useState(false)

  useEffect(() => {
    if (isStandalone()) return
    if (sessionStorage.getItem('pwa-dismissed')) return

    // iOS Safari ไม่มี beforeinstallprompt → แสดง instructions manual
    if (isIOS()) {
      setIosMode(true)
      setVisible(true)
      return
    }

    const handler = (e) => {
      e.preventDefault()
      setPrompt(e)
      setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  function dismiss() {
    sessionStorage.setItem('pwa-dismissed', '1')
    setVisible(false)
  }

  async function install() {
    if (!prompt) return
    prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === 'accepted') setVisible(false)
  }

  if (!visible) return null

  return (
    <>
      {showGuide && <IOSGuide onClose={() => setShowGuide(false)} />}
      <div className="md:hidden fixed bottom-20 left-4 right-4 z-50 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden"
           style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.15)' }}>
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
                 style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}>
              <Download size={22} className="text-white" />
            </div>
            <div>
              <p className="text-base font-bold text-gray-800">ติดตั้งแอปพลิเคชัน</p>
              <p className="text-xs text-gray-400">เข้าถึงได้รวดเร็วขึ้น ไม่ต้องเปิดเบราว์เซอร์</p>
            </div>
          </div>
          <button onClick={dismiss} className="shrink-0 p-1 text-gray-300 hover:text-gray-500">
            <X size={18} />
          </button>
        </div>
        <div className="px-4 pb-4 pt-2">
          {iosMode ? (
            <button onClick={() => setShowGuide(true)}
              className="w-full py-3.5 rounded-xl text-base font-bold text-white active:scale-95 transition-all"
              style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}>
              ดูวิธีเพิ่มในหน้าจอโฮม
            </button>
          ) : (
            <button onClick={install}
              className="w-full py-3.5 rounded-xl text-base font-bold text-white active:scale-95 transition-all"
              style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}>
              ติดตั้งเลย
            </button>
          )}
        </div>
      </div>
    </>
  )
}
