import { useEffect } from 'react'
import { Bell, X } from 'lucide-react'

// ป๊อปอัปเมื่อมีรายการใหม่เข้ากระดิ่งระหว่างเปิดระบบอยู่ — มือถือขึ้นบนจอ (ไม่ชนแถบเมนูล่าง) · คอมขึ้นมุมขวาล่าง
const AUTO_CLOSE_MS = 8000

function NotificationToast({ toast, onOpen, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), AUTO_CLOSE_MS)
    return () => clearTimeout(timer)
  }, [toast.id, onDismiss])

  return (
    <div data-notification-toast className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-lg">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-700">
        <Bell size={18} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold leading-6 text-slate-800">{toast.title}</p>
        <p className="text-xs leading-5 text-slate-500">{toast.body}</p>
        {toast.href && (
          <button type="button" onClick={() => onOpen(toast)}
            className="mt-2 inline-flex min-h-11 items-center rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">
            เปิดดู
          </button>
        )}
      </div>
      <button type="button" aria-label="ปิดการแจ้งเตือนนี้" onClick={() => onDismiss(toast.id)}
        className="-mr-1 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  )
}

export default function NotificationToasts({ toasts, onOpen, onDismiss }) {
  // กล่อง aria-live ต้องอยู่ก่อนข้อความมา โปรแกรมอ่านหน้าจอจึงอ่านให้ — ว่างเปล่าก็คงไว้ (กดทะลุได้)
  return (
    <div aria-live="polite" role="region" aria-label="การแจ้งเตือนใหม่" data-notification-toasts
      className="pointer-events-none fixed inset-x-0 top-0 z-[75] flex flex-col items-center gap-2 px-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] sm:inset-x-auto sm:top-auto sm:bottom-4 sm:right-4 sm:items-end sm:px-0 sm:pt-0">
      {toasts.map((toast) => (
        <NotificationToast key={toast.id} toast={toast} onOpen={onOpen} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
