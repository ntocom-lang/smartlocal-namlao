import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { Copy, ExternalLink, X } from 'lucide-react'
import { appUrl } from '../lib/basename'
import { CHROME_PKG, browserHandoffUrl, detectBrowserEnvironment, openInAndroidBrowser, openLineExternalBrowser } from '../lib/externalBrowser'

const BrowserHelpContext = createContext(null)

// Provider และ hook อยู่คู่กันเพื่อใช้ wrapper เดิมของ App; ไม่มี side effect ตอน import
// eslint-disable-next-line react-refresh/only-export-components
export function useExternalBrowserHelp() {
  return useContext(BrowserHelpContext)
}

function BrowserHelpDialog({ help, onClose }) {
  const dialog = useRef(null)
  const [notice, setNotice] = useState('')
  const env = detectBrowserEnvironment()
  const url = browserHandoffUrl(help.url)
  const supportsDialog = typeof HTMLDialogElement !== 'undefined' && typeof HTMLDialogElement.prototype.showModal === 'function'

  useEffect(() => {
    if (supportsDialog) dialog.current?.showModal()
    else dialog.current?.querySelector('button')?.focus()
  }, [supportsDialog])

  function openBrowser(pkg) {
    setNotice('หากหน้านี้ยังอยู่ ให้ใช้เมนูเปิดด้วยเบราว์เซอร์ของแอป หรือคัดลอกลิงก์ด้านล่าง')
    try {
      if (env.isAndroid) openInAndroidBrowser(pkg, url)
      else if (env.isLine) openLineExternalBrowser(url)
    } catch {
      setNotice('เปิดเบราว์เซอร์ไม่สำเร็จ กรุณาคัดลอกลิงก์ด้านล่าง')
    }
  }

  async function copyUrl() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(url)
      setNotice('คัดลอกแล้ว เปิดเบราว์เซอร์แล้ววางลิงก์นี้ในช่องที่อยู่')
    } catch {
      setNotice('คัดลอกอัตโนมัติไม่ได้ แตะช่องลิงก์ค้างไว้แล้วเลือกคัดลอก')
    }
  }

  return (
    <>
    {!supportsDialog && <div className="fixed inset-0 z-99999 bg-black/50" />}
    <dialog ref={dialog} open={supportsDialog ? undefined : true} onCancel={onClose} onClose={onClose}
      role="dialog" aria-modal="true"
      style={supportsDialog ? undefined : { display: 'block', position: 'fixed', inset: 0, zIndex: 100000, height: 'fit-content', background: 'white' }}
      aria-labelledby="browser-help-title"
      className="m-auto w-[calc(100%-2rem)] max-w-sm max-h-[90dvh] overflow-y-auto rounded-3xl border-0 p-5 text-gray-800 shadow-2xl backdrop:bg-black/50">
      <div className="flex items-start justify-between gap-3 mb-3">
        <h2 id="browser-help-title" className="text-lg font-bold">{help.required ? 'เปิดเบราว์เซอร์เพื่อใช้บัญชีนี้' : 'เลือกเบราว์เซอร์สำหรับเข้าสู่ระบบ'}</h2>
        <button type="button" autoFocus onClick={onClose} aria-label="ปิดคำแนะนำ" className="p-2 rounded-lg hover:bg-gray-100"><X size={20} /></button>
      </div>
      <p className="text-sm leading-relaxed text-gray-600 mb-4">
        {help.required ? 'การเข้าสู่ระบบด้วยบัญชีนี้อาจใช้ไม่ได้ในเบราว์เซอร์ภายในแอป กรุณาเปิดหน้าเว็บนี้ในเบราว์เซอร์ก่อน แล้วกด Google หรือ LINE อีกครั้ง' : 'แต่ละเบราว์เซอร์จำบัญชีแยกกัน หากไม่เคยเข้าสู่ระบบ อาจต้องใส่รหัสผ่าน แม้ติดตั้งแอป Google หรือ LINE แล้ว'}
      </p>
      {env.isAndroid && (
        <button type="button" onClick={() => openBrowser(CHROME_PKG)} className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold mb-2">เปิดใน Chrome</button>
      )}
      {(env.isAndroid || env.isLine) && (
        <button type="button" onClick={() => openBrowser(null)} className="w-full py-3 rounded-xl border border-gray-300 font-semibold flex items-center justify-center gap-2">
          <ExternalLink size={17} /> เปิดในเบราว์เซอร์ของเครื่อง
        </button>
      )}
      <p className="text-xs leading-relaxed text-gray-500 mt-3">
        {env.isIOS ? 'หากใช้ LINE บน iPhone แนะนำให้เปิดลิงก์นี้ใน Safari หากปุ่มไม่เปิด ให้ใช้เมนูของแอปเลือกเปิดด้วยเบราว์เซอร์ หรือคัดลอกไปวางใน Safari' : 'หากไม่มี Chrome ให้เลือกเบราว์เซอร์ของเครื่อง หากปุ่มไม่เปิด ให้ใช้เมนูของแอปเลือกเปิดด้วยเบราว์เซอร์'}
      </p>
      <label className="block text-xs font-semibold mt-4 mb-1" htmlFor="browser-help-url">ลิงก์หน้าเข้าสู่ระบบ</label>
      <input id="browser-help-url" readOnly value={url} onFocus={(e) => e.target.select()} className="w-full min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-xs" />
      <button type="button" onClick={copyUrl} className="w-full py-3 text-blue-700 flex items-center justify-center gap-2"><Copy size={16} /> คัดลอกลิงก์</button>
      <p role="status" className="text-xs text-gray-600 leading-relaxed">{notice}</p>
      {help.onContinue && (
        <button type="button" onClick={() => { onClose(); help.onContinue() }} className="w-full mt-3 py-3 rounded-xl bg-gray-100 font-semibold">ใช้บัญชีนี้ในเบราว์เซอร์เดิม</button>
      )}
      <button type="button" onClick={onClose} className="w-full mt-3 py-3 rounded-xl border border-gray-200 text-sm font-semibold">กลับไปใช้เบอร์โทร / รหัสผ่าน</button>
    </dialog>
    </>
  )
}

// คง wrapper เดิมของ App ไว้ แต่เปิดคำแนะนำเฉพาะเมื่อผู้ใช้กด OAuth ที่ต้องย้าย browser
// ห้าม redirect on mount: callback และ session ต้องประมวลผลใน browser ที่เริ่ม login
// และการอ่านข้อมูล/สมัครด้วยเบอร์โทรต้องเข้าได้โดยไม่ถูก gate บังทั้งแอป
export default function InAppBrowserGate({ children }) {
  const [help, setHelp] = useState(null)
  const [hintDismissed, setHintDismissed] = useState(false)
  const env = detectBrowserEnvironment()
  // AuthPage มีปุ่มช่วยเหลือที่รักษา mode/หน้าที่จะกลับอยู่แล้ว
  const hasPageHelp = /\/(?:auth|reset-password)\/?$/.test(window.location.pathname)
  return (
    <BrowserHelpContext.Provider value={setHelp}>
      {children}
      {env.isInApp && !hasPageHelp && !hintDismissed && !help && (
        <aside aria-label="คำแนะนำเบราว์เซอร์" className="fixed bottom-20 left-3 right-3 z-50 mx-auto max-w-sm rounded-xl border border-blue-200 bg-white p-3 shadow-lg flex items-center gap-2">
          <button type="button" onClick={() => {
            // ทางเข้าของเจ้าหน้าที่มี OAuth แยกด้วย จึงคงทางช่วยเหลือไว้ทุกหน้า
            const path = /\/admin\/login\/?$/.test(window.location.pathname) ? '/admin/login' : '/auth'
            setHelp({ url: appUrl(path), required: true })
          }} className="flex-1 text-left text-sm text-blue-700 font-semibold">
            Google / LINE เข้าไม่ได้? เปิดในเบราว์เซอร์
          </button>
          <button type="button" onClick={() => setHintDismissed(true)} aria-label="ซ่อนคำแนะนำเบราว์เซอร์" className="p-2 text-gray-500"><X size={17} /></button>
        </aside>
      )}
      {help && <BrowserHelpDialog help={help} onClose={() => setHelp(null)} />}
    </BrowserHelpContext.Provider>
  )
}
