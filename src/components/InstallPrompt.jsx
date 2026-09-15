import { useEffect, useRef, useState } from 'react'
import { useInstallPrompt } from '../hooks/useInstallPrompt'
import { Download, X, UploadIcon, PlusSquare } from 'lucide-react'
import { appUrl } from '../lib/basename'
import { detectBrowserEnvironment, isAndroidNonChrome, openInAndroidBrowser } from '../lib/externalBrowser'

function InstallDialog({ children, onClose }) {
  const panel = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    const element = panel.current
    element.focus()
    function keydown(event) {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      if (event.key !== 'Tab') return
      const items = [...element.querySelectorAll('button:not(:disabled), input, a[href], summary')]
        .filter(item => item.getClientRects().length)
      const first = items[0]
      const last = items.at(-1)
      if (!first) { event.preventDefault(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === element)) {
        event.preventDefault(); first.focus()
      }
    }
    element.addEventListener('keydown', keydown)
    return () => {
      element.removeEventListener('keydown', keydown)
      if (previous?.isConnected) previous.focus()
    }
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-4" onClick={onClose}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="วิธีติดตั้งแอป"
        className="flex w-full max-w-sm max-h-[85dvh] flex-col rounded-3xl bg-white p-5 shadow-xl outline-none"
        onClick={event => event.stopPropagation()}>
        <h2 className="shrink-0 font-bold text-gray-800">ติดตั้งแอปบนมือถือ</h2>
        <div className="min-h-0 overflow-y-auto">{children}</div>
        <button type="button" className="mt-4 min-h-11 w-full shrink-0 rounded-xl bg-gray-100 py-3 font-semibold text-gray-800" onClick={onClose}>ปิด</button>
      </div>
    </div>
  )
}

export function AndroidGuide({ onClose }) {
  const { mode, install, promptFailed } = useInstallPrompt()
  const [handoffAttempted, setHandoffAttempted] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')
  const env = detectBrowserEnvironment()
  const offerChrome = env.isAndroid && (env.isInApp || isAndroidNonChrome())
  // ส่งเฉพาะหน้าแรกของ tenant ไม่พา callback, token หรือข้อมูลคำร้องไปอีกเบราว์เซอร์
  const homeUrl = appUrl('/')
  const ready = mode === 'ready'
  const installing = mode === 'installing'

  async function handleInstall() {
    const result = await install()
    if (result === 'accepted' || result === 'dismissed') onClose()
  }
  function openChrome() {
    setHandoffAttempted(true)
    try { openInAndroidBrowser(undefined, homeUrl) } catch { /* ทางสำรองแสดงอยู่ในกล่องเดิม */ }
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(homeUrl)
      setCopyStatus('คัดลอกแล้ว เปิด Chrome แล้ววางลิงก์ได้เลย')
    } catch { setCopyStatus('คัดลอกอัตโนมัติไม่ได้ แตะช่องลิงก์ค้างไว้แล้วเลือกคัดลอก') }
  }
  if (mode === 'installed') return null
  return (
    <InstallDialog onClose={onClose}>
        <p role="status" className="mt-3 text-sm text-gray-600">
          {installing ? 'กำลังเปิดหน้าติดตั้ง กรุณายืนยันในหน้าของเบราว์เซอร์'
            : ready ? 'พร้อมติดตั้งแล้ว กดปุ่มด้านล่างเพื่อยืนยัน'
              : promptFailed ? 'เปิดหน้าติดตั้งไม่สำเร็จ ใช้เมนูเบราว์เซอร์ด้านล่างได้'
                : 'ยังเรียกหน้าติดตั้งจากปุ่มนี้ไม่ได้ หากเบราว์เซอร์พร้อม ปุ่มติดตั้งจะแสดงที่นี่ หรือใช้เมนูด้านล่างได้เลย'}
        </p>
        {(ready || installing) && <button type="button" disabled={installing} onClick={handleInstall}
          className="mt-4 min-h-11 w-full rounded-xl bg-blue-700 px-4 py-3 font-semibold text-white disabled:opacity-60">
          {installing ? 'กำลังเปิดหน้าติดตั้ง…' : 'ติดตั้งแอป'}
        </button>}
        {!ready && !installing && <>
        {offerChrome && <button type="button" onClick={openChrome}
          className="mt-4 min-h-11 w-full rounded-xl bg-blue-700 px-4 py-3 font-semibold text-white">เปิดใน Chrome</button>}
        <details open={!offerChrome} className="mt-3 text-gray-700">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">วิธีเพิ่มจากเมนูเบราว์เซอร์</summary>
        <ol className="list-decimal pl-5 mt-3 space-y-3 text-sm text-gray-600">
          <li>เปิดเมนูของเบราว์เซอร์ รูปสามจุดหรือสามขีด</li>
          <li>หาเมนู “ติดตั้งแอป” หรือ “เพิ่มไปที่หน้าจอโฮม” ชื่อเมนูอาจต่างกันตามเบราว์เซอร์</li>
          <li>กดยืนยัน แล้วดูไอคอนที่หน้าจอโฮม</li>
        </ol>
        <p className="mt-3 text-sm text-gray-500">หากติดตั้งไว้แล้ว ให้เปิดจากไอคอนบนหน้าจอโฮม</p>
        </details>
        {handoffAttempted && <div className="mt-3 space-y-2 text-sm text-gray-600">
          <p role="status">{copyStatus || 'หาก Chrome ไม่เปิด ให้คัดลอกลิงก์ไปเปิดในเบราว์เซอร์ที่ใช้ประจำ'}</p>
          <input aria-label="ลิงก์หน้าแรกสำหรับติดตั้ง" readOnly value={homeUrl}
            onFocus={event => event.target.select()} className="min-h-11 w-full min-w-0 rounded-lg border p-2" />
          <button type="button" onClick={copyLink} className="min-h-11 w-full rounded-xl border px-3 py-2 font-semibold">คัดลอกลิงก์</button>
        </div>}
        </>}
    </InstallDialog>
  )
}

export function IOSGuide({ onClose }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 px-4 pb-4"
         onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="วิธีติดตั้งแอปบน iPhone" className="w-full max-w-sm max-h-[85dvh] overflow-y-auto bg-white rounded-3xl p-5 shadow-2xl"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <p className="font-bold text-gray-800 text-base">เพิ่มลงในหน้าจอหลัก</p>
          <button onClick={onClose} aria-label="ปิด" className="min-h-11 min-w-11 flex items-center justify-center rounded-xl hover:bg-gray-100">
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
              <p className="text-xs text-gray-500 mt-0.5">หากเปิดจากแอปอื่น ให้เปิดลิงก์นี้ใน Safari ก่อน แล้วหาปุ่มรูปกล่องมีลูกศรขึ้นในแถบเครื่องมือหรือเมนู</p>
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
        disabled={mode === 'installing'}
        onClick={handleInstall}
        aria-label={iosMode ? 'ดูวิธีติดตั้งแอป' : 'ติดตั้งแอป'}
        className="md:hidden fixed bottom-20 left-3 z-[60] min-h-11 inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[11px] font-bold text-white shadow-lg motion-safe:animate-pulse active:scale-95 transition-transform disabled:opacity-60"
        style={{
          background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)',
          boxShadow: '0 4px 14px rgba(var(--color-primary-rgb), 0.32)',
        }}
      >
        {iosMode ? <PlusSquare size={15} aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
        <span>{mode === 'installing' ? 'กำลังเปิดหน้าติดตั้ง…' : 'ติดตั้งแอป'}</span>
      </button>
    </>
  )
}
