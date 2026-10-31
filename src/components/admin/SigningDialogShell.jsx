import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, X } from 'lucide-react'

// กรอบกล่องของงานตั้งผู้ลงนาม (แก้รายช่อง / ยืนยันการตั้ง) — มือถือเป็นแผ่นล่าง จอใหญ่เป็นกล่องกลางจอ
// เรนเดอร์ที่ body: ถ้าซ้อนอยู่ในหน้าแอดมิน แถบเมนูล่างของมือถือจะบังปุ่มยืนยัน (เคยเจอกับกล่องลงนามทริป)
// ปุ่มยืนยันอยู่ใน footer ที่ไม่เลื่อนตามเนื้อหา รายการยาวแค่ไหนก็ยังเห็นปุ่ม
// layout="page": ฟอร์มเจ้าหน้าที่เต็มกรอบหน้าจัดการผู้ใช้แทนรายชื่อ (เจ้าของระบบสั่ง 2569-10-31)
// ไม่ล็อกการเลื่อนหน้า ไม่ขังโฟกัส เพราะเป็นหน้า ไม่ใช่กล่องลอย แต่ Esc ยังใช้ย้อนกลับได้เหมือนเดิม
export default function SigningDialogShell({
  title, subtitle, closeDisabled = false, onClose, footer, children, testId,
  backLabel = null, headerExtra = null, layout = 'dialog',
}) {
  const dialogRef = useRef(null)
  const closeRef = useRef({ onClose, closeDisabled })
  useEffect(() => { closeRef.current = { onClose, closeDisabled } }, [onClose, closeDisabled])
  const isPage = layout === 'page'

  useEffect(() => {
    const opener = document.activeElement
    dialogRef.current?.focus({ preventScroll: true })
    const onKey = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (!closeRef.current.closeDisabled) closeRef.current.onClose()
      }
      if (event.key === 'Tab' && !isPage) {
        const items = [...dialogRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), summary')]
        if (!items.length) return
        const first = items[0]
        const last = items[items.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    if (!isPage) document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      if (!isPage) document.body.style.overflow = ''
      // หน้าแอดมินคืนตำแหน่งเลื่อนของรายชื่อเอง ห้ามให้การคืนโฟกัสดึงหน้าไปที่แถวอื่น
      opener?.focus?.({ preventScroll: true })
    }
  }, [isPage])

  const header = (
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
  )

  if (isPage) {
    // ไม่ใส่ overflow-hidden ที่กรอบ ไม่งั้นแถบปุ่มบันทึกติดล่างจอ (sticky) ไม่ทำงาน
    // มือถือ: แถบปุ่มต้องลอยเหนือแถบเมนูล่างของแผงควบคุม หน้าแอดมินวัดความสูงจริงไว้ที่ --admin-bottom-nav-h
    return (
      <section ref={dialogRef} tabIndex={-1} aria-labelledby="signing-dialog-title" data-testid={testId} data-shell-layout="page"
        className="rounded-[24px] border border-slate-200/80 bg-white shadow-lg shadow-slate-200/60 outline-none">
        {header}
        {headerExtra}
        <div className="px-4 py-4 md:px-5">{children}</div>
        <div className="sticky bottom-[var(--admin-bottom-nav-h,0px)] z-10 rounded-b-[24px] border-t border-slate-100 bg-white/95 px-4 py-3 backdrop-blur-sm md:bottom-0 md:px-5">
          {footer}
        </div>
      </section>
    )
  }

  return createPortal(
    <div className={`fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm md:items-center md:p-4`} data-testid={testId}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="signing-dialog-title"
        className={`flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl outline-none md:max-w-2xl md:rounded-3xl`}>
        {header}
        {headerExtra}
        <div className="flex-1 overflow-y-auto px-4 py-4 md:px-5">{children}</div>
        <div className="border-t border-slate-100 px-4 pb-6 pt-3 md:px-5 md:pb-4">{footer}</div>
      </div>
    </div>,
    document.body,
  )
}
