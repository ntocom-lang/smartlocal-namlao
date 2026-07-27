import { Link, useLocation } from 'react-router-dom'
import {
  Home, ClipboardList, FileText, CalendarDays, Newspaper,
  MapPin, Map, FileSearch, FolderOpen, Bell,
  Phone, AlertCircle, LogIn, LogOut, LayoutGrid,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useTenant } from '../../contexts/TenantContext'
import { useNotifications } from '../../contexts/NotificationsContext'
import { supabase } from '../../lib/supabase'

const NAV_GROUPS = [
  {
    label: 'บริการหลัก',
    items: [
      { label: 'หน้าแรก',          href: '/',            Icon: Home,          exact: true },
      { label: 'แจ้งเหตุ/แจ้งซ่อม', href: '/complaint',   Icon: ClipboardList },
      { label: 'สอบถามยอดชำระเรื่องนั้นๆ', href: '/doc-request', Icon: FileText },
      { label: 'ปฏิทินกิจกรรม',   href: '/events',      Icon: CalendarDays },
      { label: 'ข่าวสาร/ประกาศ',  href: '/news',        Icon: Newspaper },
      { label: 'แหล่งท่องเที่ยว', href: '/tourism',     Icon: MapPin },
      { label: 'แผนที่',           href: '/map',         Icon: Map },
    ],
  },
  {
    label: 'ของฉัน',
    items: [
      { label: 'คำร้องของฉัน',  href: '/my-complaints', Icon: FileSearch },
      { label: 'เอกสารของฉัน',  href: '/my-docs',       Icon: FolderOpen },
      { label: 'การแจ้งเตือน',  href: '/notifications', Icon: Bell, badge: true },
    ],
  },
  {
    label: 'ข้อมูลองค์กร',
    items: [
      { label: 'ติดต่อเรา',   href: '/contact',   Icon: Phone },
      { label: 'เหตุฉุกเฉิน', href: '/emergency', Icon: AlertCircle },
      { label: 'เมนูทั้งหมด', href: '/more',      Icon: LayoutGrid },
    ],
  },
]

// /technician ไม่อยู่ในนี้ตั้งใจ — ช่างใช้แถบข้างนี้บนจอ PC ด้วย (ดู App.jsx)
const HIDDEN_PATHS = ['/admin', '/staff']

const BG       = '#1a3a5c'
const BORDER   = '#12293f'
const ACTIVE   = 'rgba(255,255,255,0.15)'
const INACTIVE = 'rgba(255,255,255,0.6)'
const DIVIDER  = 'rgba(255,255,255,0.08)'
const LABEL    = 'rgba(255,255,255,0.35)'

export default function CitizenSidebar() {
  const location         = useLocation()
  const { session, displayName } = useAuth()
  const { tenant }       = useTenant()
  const { unreadCount }  = useNotifications()

  if (HIDDEN_PATHS.some(p => location.pathname.startsWith(p))) return null
  if (tenant?.ui_style === 'kledkaew') return null

  function isActive(href, exact) {
    return exact ? location.pathname === href : location.pathname.startsWith(href)
  }

  async function logout() { await supabase.auth.signOut() }

  return (
    <aside className="hidden md:flex flex-col w-56 shrink-0 shadow-lg self-start sticky top-0 max-h-screen overflow-y-auto"
      style={{ backgroundColor: BG, borderRight: `1px solid ${BORDER}` }}>

      {/* Brand */}
      <div className="px-4 py-4 border-b" style={{ borderColor: DIVIDER }}>
        <Link to="/" className="flex items-center w-full hover:opacity-80 transition-opacity">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold" style={{ color: 'rgba(147,197,253,0.85)' }}>ระบบบริการประชาชน</p>
          </div>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2.5 py-2 space-y-3">
        {NAV_GROUPS.map(group => (
          <div key={group.label}>
            <p className="px-3 mb-1 text-[9px] font-bold uppercase tracking-widest" style={{ color: LABEL }}>
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map(({ label, href, Icon, exact, badge }) => {
                const active = isActive(href, exact)
                return (
                  <Link key={href} to={href}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all"
                    style={active
                      ? { backgroundColor: ACTIVE, color: '#fff' }
                      : { color: INACTIVE }}>
                    <Icon size={15} strokeWidth={active ? 2.2 : 1.5} className="shrink-0" />
                    <span className="flex-1 truncate text-xs">{label}</span>
                    {badge && unreadCount > 0 && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white bg-amber-400">
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User block */}
      <div className="px-2.5 py-3 border-t space-y-1" style={{ borderColor: DIVIDER }}>
        {session ? (
          <>
            <div className="flex items-center gap-2.5 px-3 py-2">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                style={{ backgroundColor: 'rgba(255,255,255,0.18)', color: '#fff' }}>
                {(displayName || '?')[0].toUpperCase()}
              </div>
              <p className="text-xs font-semibold truncate text-white">{displayName || 'ผู้ใช้'}</p>
            </div>
            <button onClick={logout}
              className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors hover:bg-white/10"
              style={{ color: INACTIVE }}>
              <LogOut size={13} /> ออกจากระบบ
            </button>
          </>
        ) : (
          <Link to="/auth"
            className="flex items-center justify-center gap-2 w-full py-2 rounded-lg text-xs font-bold transition-colors hover:bg-white/10"
            style={{ color: '#fff', backgroundColor: ACTIVE }}>
            <LogIn size={13} /> เข้าสู่ระบบ
          </Link>
        )}
      </div>
    </aside>
  )
}
