import { Link } from 'react-router-dom'
import { Bell, FileSignature, ShieldCheck, UserRound } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useNotifications } from '../../contexts/NotificationsContext'
import { canAccessStaffPortal } from '../../lib/portalAccess'

// เป็นการนำทางระหว่าง URL จึงใช้ nav/link + aria-current ไม่ใช้ ARIA tab ที่ต้องซ่อน panel
// ไม่ mount หน้าที่ไม่ได้เปิด: เข้าโปรไฟล์ต้องไม่อ่านคลังลายเซ็นหรือเปลี่ยนสถานะอ่านแจ้งเตือน
export default function AccountTabs({ active }) {
  const { role, profileLoading, profileError } = useAuth()
  const { unreadCount } = useNotifications()
  const tabs = [
    { id: 'account', label: 'ข้อมูล', to: '/profile', Icon: UserRound },
    ...(!profileLoading && !profileError && canAccessStaffPortal(role)
      ? [{ id: 'signatures', label: 'ลายเซ็นของฉัน', to: '/staff/my-signatures', Icon: FileSignature }] : []),
    { id: 'notifications', label: 'การแจ้งเตือน', to: '/profile/notifications', Icon: Bell },
    { id: 'security', label: 'ความปลอดภัย', to: '/profile?tab=security', Icon: ShieldCheck },
  ]
  return (
    <nav aria-label="แท็บบัญชีของฉัน" data-account-tabs className="grid grid-cols-2 gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm sm:flex sm:flex-wrap">
      {tabs.map(({ id, label, to, Icon }) => (
        <Link key={id} to={to} data-account-tab={id} state={id === 'signatures' ? { returnTo: '/profile' } : undefined}
          aria-current={active === id ? 'page' : undefined}
          style={active === id ? { color: 'var(--color-primary-dark)', background: 'color-mix(in srgb, var(--color-primary) 9%, white)' } : undefined}
          className={`relative flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-xl px-2 py-3 text-center text-xs font-semibold leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600 sm:flex-1 sm:px-4 sm:text-sm ${active === id ? '' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}>
          <Icon size={17} className="shrink-0" aria-hidden="true" />
          <span>{label}</span>
          {id === 'notifications' && unreadCount > 0 && <span aria-label={`${unreadCount} รายการยังไม่อ่าน`} className="rounded-full bg-slate-100 px-1.5 text-[10px] leading-5 text-slate-600">{unreadCount > 99 ? '99+' : unreadCount}</span>}
          {active === id && <span aria-hidden="true" className="absolute inset-x-3 bottom-0 h-0.5 rounded-full" style={{ background: 'var(--color-primary)' }} />}
        </Link>
      ))}
    </nav>
  )
}
