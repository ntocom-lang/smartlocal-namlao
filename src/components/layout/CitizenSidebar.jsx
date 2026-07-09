import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  Home, ClipboardList, FileText, CalendarDays, Newspaper,
  MapPin, Map, FileSearch, FolderOpen, Bell,
  Phone, AlertCircle, LogIn, LogOut, UserCircle2,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useTenant } from '../../contexts/TenantContext'
import { useNotifications } from '../../contexts/NotificationsContext'
import { supabase } from '../../lib/supabase'

const NAV_GROUPS = [
  {
    label: 'บริการหลัก',
    items: [
      { label: 'หน้าแรก',          href: '/',             Icon: Home,          exact: true },
      { label: 'แจ้งเหตุ/แจ้งซ่อม', href: '/complaint',    Icon: ClipboardList },
      { label: 'บริการออนไลน์',     href: '/doc-request',  Icon: FileText },
      { label: 'ปฏิทินกิจกรรม',    href: '/events',       Icon: CalendarDays },
      { label: 'ข่าวสาร/ประกาศ',   href: '/news',         Icon: Newspaper },
      { label: 'แหล่งท่องเที่ยว',  href: '/tourism',      Icon: MapPin },
      { label: 'แผนที่',            href: '/map',          Icon: Map },
    ],
  },
  {
    label: 'ของฉัน',
    items: [
      { label: 'คำร้องของฉัน',   href: '/my-complaints', Icon: FileSearch },
      { label: 'เอกสารของฉัน',   href: '/my-docs',       Icon: FolderOpen },
      { label: 'การแจ้งเตือน',   href: '/notifications', Icon: Bell, badge: true },
    ],
  },
  {
    label: 'ข้อมูลองค์กร',
    items: [
      { label: 'ติดต่อเรา',    href: '/contact',   Icon: Phone },
      { label: 'เหตุฉุกเฉิน', href: '/emergency', Icon: AlertCircle },
    ],
  },
]

const HIDDEN_PATHS = ['/admin', '/staff', '/technician']

export default function CitizenSidebar() {
  const location  = useLocation()
  const navigate  = useNavigate()
  const { session, displayName } = useAuth()
  const { tenant } = useTenant()
  const { unreadCount } = useNotifications()

  if (HIDDEN_PATHS.some(p => location.pathname.startsWith(p))) return null

  function isActive(href, exact) {
    return exact ? location.pathname === href : location.pathname.startsWith(href)
  }

  async function logout() {
    await supabase.auth.signOut()
  }

  return (
    <aside className="hidden md:flex flex-col w-56 shrink-0 bg-white border-r border-gray-200 sticky top-0 h-screen overflow-y-auto">

      {/* Org branding */}
      {tenant && (
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-gray-100">
          {tenant.logo_url ? (
            <img src={tenant.logo_url} alt="" className="w-9 h-9 rounded-full object-contain shrink-0" />
          ) : (
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              {tenant.name?.[0] ?? '?'}
            </div>
          )}
          <p className="text-xs font-bold text-gray-700 leading-snug line-clamp-2">{tenant.name}</p>
        </div>
      )}

      {/* Nav groups */}
      <nav className="flex-1 py-3 px-2 space-y-4">
        {NAV_GROUPS.map(group => (
          <div key={group.label}>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-2 mb-1">
              {group.label}
            </p>
            {group.items.map(({ label, href, Icon, exact, badge }) => {
              const active = isActive(href, exact)
              return (
                <Link key={href} to={href}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors relative ${
                    active
                      ? 'font-semibold text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                  style={active ? { backgroundColor: 'var(--color-primary)' } : {}}>
                  <Icon size={15} className="shrink-0" />
                  <span className="truncate">{label}</span>
                  {badge && unreadCount > 0 && (
                    <span className="ml-auto min-w-5 h-5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* User block */}
      <div className="border-t border-gray-100 p-3">
        {session ? (
          <div className="space-y-1">
            <Link to="/profile"
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-gray-600 hover:bg-gray-100 transition-colors truncate">
              <UserCircle2 size={15} className="shrink-0" />
              <span className="truncate text-xs">{displayName || 'โปรไฟล์'}</span>
            </Link>
            <button onClick={logout}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
              <LogOut size={14} className="shrink-0" />
              <span className="text-xs">ออกจากระบบ</span>
            </button>
          </div>
        ) : (
          <Link to="/auth"
            className="flex items-center justify-center gap-2 w-full py-2 rounded-xl text-sm font-semibold text-white transition-colors"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            <LogIn size={14} />
            เข้าสู่ระบบ
          </Link>
        )}
      </div>
    </aside>
  )
}
