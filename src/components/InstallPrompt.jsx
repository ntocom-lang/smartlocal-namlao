import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'

export default function InstallPrompt() {
  const [prompt, setPrompt] = useState(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // ถ้าเปิดผ่านแอปที่ติดตั้งแล้ว หรือ dismiss ไปแล้ว ไม่ต้องแสดง
    if (window.matchMedia('(display-mode: standalone)').matches) return
    if (sessionStorage.getItem('pwa-dismissed')) return

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
    <div className="md:hidden fixed bottom-20 left-4 right-4 z-50 flex items-center gap-3 bg-white rounded-2xl shadow-xl border border-gray-100 px-4 py-3">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
           style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}>
        <Download size={18} className="text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800">ติดตั้งแอปพลิเคชัน</p>
        <p className="text-xs text-gray-400">เข้าถึงได้รวดเร็วขึ้น ไม่ต้องเปิดเบราว์เซอร์</p>
      </div>
      <button onClick={install}
        className="shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold text-white"
        style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}>
        ติดตั้ง
      </button>
      <button onClick={dismiss} className="shrink-0 text-gray-300 hover:text-gray-500">
        <X size={16} />
      </button>
    </div>
  )
}
