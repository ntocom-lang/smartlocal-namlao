import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useTenant } from '../../contexts/TenantContext'
import { canAccessStaffPortal } from '../../lib/portalAccess'
import PortalSwitcher from '../layout/PortalSwitcher'
import UserProfileBadge from '../layout/UserProfileBadge'
import AccountTabs from './AccountTabs'

export default function AccountPageLayout({ active, title, children, hasUnsavedChanges = false, busy = false }) {
  const { role } = useAuth()
  const { tenant } = useTenant()
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

  function guardNavigation(event) {
    const link = event.target.closest?.('a[href]')
    if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target === '_blank') return
    const destination = new URL(link.href, window.location.href)
    if (destination.href === window.location.href) return
    if (busy || (isDirty() && !window.confirm('มีข้อมูลที่ยังไม่ได้บันทึก ต้องการออกจากแท็บนี้และละทิ้งข้อมูลที่แก้ไขหรือไม่?'))) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  return (
    <div className="min-h-full bg-slate-50" data-account-page onClickCapture={guardNavigation}>
      <header className="text-white shadow-sm" style={{ background: 'linear-gradient(125deg, var(--color-primary-dark), var(--color-primary))' }}>
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-3 py-3 sm:px-6">
          <Link to={returnTo} aria-label="กลับหน้าก่อนหน้า" title="กลับหน้าก่อนหน้า" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><ArrowLeft size={22} aria-hidden="true" /></Link>
          <div className="min-w-0 flex-1"><h1 className="text-base font-bold leading-snug sm:text-lg">{title}</h1><p className="mt-1 truncate text-[11px] text-white/75">{tenant?.name || 'บัญชีของฉัน'}</p></div>
          <PortalSwitcher className="hidden lg:flex" />
          <UserProfileBadge compact className="md:hidden" />
          <UserProfileBadge className="hidden md:block" />
        </div>
      </header>
      <div className="mx-auto max-w-4xl px-3 pb-28 pt-4 sm:px-6 sm:pt-6">
        <AccountTabs active={active} />
        <div className="mt-5" data-account-content>{children}</div>
      </div>
    </div>
  )
}
