import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, X } from 'lucide-react'

// กรอบกล่องของงานตั้งผู้ลงนาม (แก้รายช่อง / ยืนยันการตั้ง) และฟอร์มเจ้าหน้าที่ — มือถือเป็นแผ่นล่าง จอใหญ่เป็นกล่องกลางจอ
// ฟอร์มเจ้าหน้าที่เคยเป็นแผงชิดขวา เจ้าของระบบสั่งให้อยู่กลางจอ (2569-10-31) จึงเหลือแบบเดียว
// เรนเดอร์ที่ body: ถ้าซ้อนอยู่ในหน้าแอดมิน แถบเมนูล่างของมือถือจะบังปุ่มยืนยัน (เคยเจอกับกล่องลงนามทริป)
// ปุ่มยืนยันอยู่ใน footer ที่ไม่เลื่อนตามเนื้อหา รายการยาวแค่ไหนก็ยังเห็นปุ่ม
export default function SigningDialogShell({
  title, subtitle, closeDisabled = false, onClose, footer, children, testId,
  backLabel = null, headerExtra = null,
}) {
  const dialogRef = useRef(null)
  const closeRef = useRef({ onClose, closeDisabled })
  useEffect(() => { closeRef.current = { onClose, closeDisabled } }, [onClose, closeDisabled])

  useEffect(() => {
    const opener = document.activeElement
    dialogRef.current?.focus()
    const onKey = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (!closeRef.current.closeDisabled) closeRef.current.onClose()
      }
      if (event.key === 'Tab') {
        const items = [...dialogRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), summary')]
        if (!items.length) return
        const first = items[0]
        const last = items[items.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      opener?.focus?.()
    }
  }, [])

  return createPortal(
    <div className={`fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm md:items-center md:p-4`} data-testid={testId}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="signing-dialog-title"
        className={`flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl outline-none md:max-w-2xl md:rounded-3xl`}>
        <div className="flex items-start gap-2 border-b border-slate-100 px-4 py-3 md:px-5">
          {backLabel && (
            <button type="button" onClick={onClose} disabled={closeDisabled}
              className="flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-1.5 text-sm font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40">
              <ChevronLeft size={16} /> {backLabel}
            </button>
          )}
          <div className="min-w-0 flex-1 py-1.5">
            <h2 id="signing-dialog-title" className="text-base font-extrabold text-slate-800">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs leading-5 text-slate-500">{subtitle}</p>}
          </div>
          {!backLabel && (
            <button type="button" onClick={onClose} disabled={closeDisabled} aria-label="ปิด"
              className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 disabled:opacity-40">
              <X size={19} />
            </button>
          )}
        </div>
        {headerExtra}
        <div className="flex-1 overflow-y-auto px-4 py-4 md:px-5">{children}</div>
        <div className="border-t border-slate-100 px-4 pb-6 pt-3 md:px-5 md:pb-4">{footer}</div>
      </div>
    </div>,
    document.body,
  )
}
