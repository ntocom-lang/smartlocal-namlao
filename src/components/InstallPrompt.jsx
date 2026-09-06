import { useState } from 'react'
import { useInstallPrompt } from '../hooks/useInstallPrompt'
import { Download, X, UploadIcon, PlusSquare } from 'lucide-react'

export function AndroidGuide({ onClose }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="วิธีติดตั้งแอป" className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="font-bold text-gray-800">เพิ่มแอปลงหน้าจอโฮม</h2>
        <ol className="list-decimal pl-5 mt-3 space-y-3 text-sm text-gray-600">
          <li>เปิดเมนูของเบราว์เซอร์ รูปสามจุดหรือสามขีด</li>
          <li>หาเมนู “ติดตั้งแอป” หรือ “เพิ่มไปที่หน้าจอโฮม” ชื่อเมนูอาจต่างกันตามเบราว์เซอร์</li>
          <li>กดยืนยัน แล้วดูไอคอนที่หน้าจอโฮม</li>
        </ol>
        <p className="mt-3 text-xs text-gray-500">หากไม่พบเมนูนี้ เบราว์เซอร์อาจไม่รองรับ ลองเปิดลิงก์ใน Chrome แล้วตรวจเมนูอีกครั้ง</p>
        <button type="button" className="mt-4 w-full rounded-xl bg-gray-100 py-3 font-semibold" onClick={onClose}>เข้าใจแล้ว</button>
      </div>
    </div>
  )
}

export function IOSGuide({ onClose }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 px-4 pb-4"
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
  const { mode, install } = useInstallPrompt()
  const iosMode = mode === 'manual-ios'
  const [showGuide, setShowGuide] = useState(false)

  async function handleInstall() {
    if (await install() === 'guide') setShowGuide(true)
  }

  if (mode === 'installed' || mode === 'hidden') return null

  return (
    <>
      {showGuide && (iosMode ? <IOSGuide onClose={() => setShowGuide(false)} /> : <AndroidGuide onClose={() => setShowGuide(false)} />)}
      <button
        type="button"
        onClick={handleInstall}
        aria-label={iosMode ? 'ดูวิธีติดตั้งแอป' : 'ติดตั้งแอป'}
        className="md:hidden fixed bottom-20 left-3 z-[60] inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[11px] font-bold text-white shadow-lg motion-safe:animate-pulse active:scale-95 transition-transform"
        style={{
          background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)',
          boxShadow: '0 4px 14px rgba(var(--color-primary-rgb), 0.32)',
        }}
      >
        {iosMode ? <PlusSquare size={15} aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
        <span>ติดตั้งแอป</span>
      </button>
    </>
  )
}
