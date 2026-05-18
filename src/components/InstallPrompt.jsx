import { useEffect, useState } from 'react'
import { Download, X, Share } from 'lucide-react'

const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent)
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true

export default function InstallPrompt() {
  const [prompt, setPrompt] = useState(null)
  const [visible, setVisible] = useState(false)
  const [iosMode, setIosMode] = useState(false)

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
          <div className="bg-blue-50 rounded-xl px-4 py-3 flex items-start gap-2">
            <Share size={16} className="text-blue-500 mt-0.5 shrink-0" />
            <p className="text-xs text-blue-700 leading-relaxed">
              กดปุ่ม <strong>แชร์</strong> ด้านล่าง แล้วเลือก{' '}
              <strong>"เพิ่มลงในหน้าจอโฮม"</strong>
            </p>
          </div>
        ) : (
          <button onClick={install}
            className="w-full py-3.5 rounded-xl text-base font-bold text-white active:scale-95 transition-all"
            style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}>
            ติดตั้งเลย
          </button>
        )}
      </div>
    </div>
  )
}
