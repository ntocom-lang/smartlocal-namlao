import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowLeft, Menu } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { canAccessStaffPortal } from '../../lib/portalAccess'
import Header from '../layout/Header'
import CitizenSidebar from '../layout/CitizenSidebar'
import AccountTabs from './AccountTabs'

export default function AccountPageLayout({ active, title, children, hasUnsavedChanges = false, busy = false }) {
  const { role } = useAuth()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const closeDrawer = useCallback(() => setDrawerOpen(false), [])
  const { state, pathname } = useLocation()
  const defaultReturn = ['admin', 'superadmin'].includes(role) ? '/admin' : role === 'technician' ? '/technician' : canAccessStaffPortal(role) ? '/staff' : '/'
  const returnTo = state?.returnTo !== pathname && ['/', '/staff', '/admin', '/technician', '/profile', '/data-center/staff'].includes(state?.returnTo)
    ? state.returnTo : defaultReturn
  const isDirty = () => typeof hasUnsavedChanges === 'function' ? hasUnsavedChanges() : hasUnsavedChanges

  useEffect(() => {
    const preventUnload = event => {
      if (busy || (typeof hasUnsavedChanges === 'function' ? hasUnsavedChanges() : hasUnsavedChanges)) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', preventUnload)
    return () => window.removeEventListener('beforeunload', preventUnload)
  }, [hasUnsavedChanges, busy])

  function allowNavigation(href) {
    if (new URL(href, window.location.href).href === window.location.href) return true
    return !busy && (!isDirty() || window.confirm('มีข้อมูลที่ยังไม่ได้บันทึก ต้องการออกจากแท็บนี้และละทิ้งข้อมูลที่แก้ไขหรือไม่?'))
  }

  function guardNavigation(event) {
    const link = event.target.closest?.('a[href]')
    // กระดิ่งของ Header เดิมใช้ button + navigate แทน Link จึงต้องป้องกันก่อน handler ของมันทำงานด้วย
    const bell = event.target.closest?.('[data-account-site-header] button[aria-label^="การแจ้งเตือน"]')
    if ((!link && !bell) || event.button !== 0) return
    if (link && (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target === '_blank')) return
    if (!allowNavigation(link?.href || '/notifications')) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50" data-account-page onClickCapture={guardNavigation}>
      {/* ใช้โลโก้ ชื่อหน่วยงาน และเมนูบัญชีจาก Header ของธีมเดิม ไม่สร้างหัวอีกชุด */}
      <div className="shrink-0 [&_button]:min-h-11 [&_button]:min-w-11" data-account-site-header><Header /></div>
      <div className="flex min-h-0 flex-1">
        <CitizenSidebar showOnAccount drawerOpen={drawerOpen} onDrawerClose={closeDrawer} onBeforeNavigate={allowNavigation} />
        <section aria-label={title} data-account-scroll className="min-w-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto max-w-4xl px-3 pb-28 pt-4 sm:px-6 sm:pt-6 md:[&_[data-account-tabs]]:grid md:[&_[data-account-tabs]]:grid-cols-2 lg:[&_[data-account-tabs]]:flex">
            <div className="mb-4 flex items-center gap-2">
              <button type="button" onClick={event => { event.currentTarget.focus(); setDrawerOpen(true) }} aria-label="เปิดเมนูหลัก" aria-expanded={drawerOpen} aria-controls="portal-drawer" data-account-nav-toggle
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 md:hidden"><Menu size={21} aria-hidden="true" /></button>
              <Link to={returnTo} aria-label="กลับหน้าก่อนหน้า" title="กลับหน้าก่อนหน้า" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"><ArrowLeft size={21} aria-hidden="true" /></Link>
              <h1 className="min-w-0 text-base font-bold leading-snug text-slate-800 sm:text-lg">{title}</h1>
            </div>
            <AccountTabs active={active} />
            <div className="mt-5" data-account-content>{children}</div>
          </div>
        </section>
      </div>
    </div>
  )
}
