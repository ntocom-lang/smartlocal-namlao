import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Phone, LogIn, LogOut, UserCircle2, User, LayoutDashboard, Bell, Briefcase } from 'lucide-react'
import { useTenant } from '../../../../contexts/TenantContext'
import { useAuth } from '../../../../contexts/AuthContext'
import { supabase } from '../../../../lib/supabase'
import { useNotifications } from '../../../../contexts/NotificationsContext'

const NAV_CITIZEN = [
  { label: 'หน้าแรก',       href: '/' },
  { label: 'แจ้งเหตุ/แจ้งซ่อม', href: '/complaint' },
  { label: 'คำร้องของฉัน',  href: '/my-complaints' },
  { label: 'ปฏิทินกิจกรรม', href: '/events' },
  { label: 'การแจ้งเตือน',  href: '/notifications' },
  { label: 'เมนูอื่นๆ',     href: '/more' },
]

const NAV_TECH = [
  { label: 'หน้าแรก',          href: '/' },
  { label: 'งานของฉัน',        href: '/technician' },
  { label: 'คำร้องของฉัน',     href: '/my-complaints' },
  { label: 'ปฏิทินกิจกรรม',   href: '/events' },
  { label: 'การแจ้งเตือน',     href: '/notifications' },
  { label: 'เมนูอื่นๆ',        href: '/more' },
]

export default function Header() {
  const { tenant } = useTenant()
  const location = useLocation()
  const navigate = useNavigate()
  const { unreadCount } = useNotifications()
  const { session, role, displayName, avatarUrl } = useAuth()

  async function logout() {
    await supabase.auth.signOut()
  }
  const isAdmin = role === 'admin' || role === 'superadmin'

  return (
    <header className="shadow-xl" style={tenant?.header_image_url ? { position: 'relative', zIndex: 2 } : {}}>
      {/* Top strip — hidden on mobile */}
      <div className="hidden md:flex text-gray-600 text-xs py-1.5 px-4 justify-end items-center gap-3 bg-gray-50 border-b border-gray-200">
        <Phone size={11} className="text-gray-400" />
        <span className="font-semibold tracking-wide">{tenant?.name}</span>
        <span className="text-gray-300">|</span>
        <span className="text-gray-500">{tenant?.system_subtitle || '✦ E-Service ✦ งานบริการประชาชน'}</span>
        <span className="text-gray-300">|</span>
        <a href="/manual-citizen.html" target="_blank" rel="noopener noreferrer"
          className="text-[var(--color-primary)] hover:underline transition-colors">
          📋 คู่มือการใช้งาน
        </a>
      </div>

      {/* Main header */}
      <div className="bg-white px-4 py-3 relative border-b border-gray-100">
        <div className="max-w-6xl mx-auto flex items-center gap-3 relative z-10">
          {/* Logo circle — always home */}
          <Link to={role === 'technician' ? '/technician' : '/'} className="shrink-0">
            {tenant?.logo_url ? (
              <img src={tenant.logo_url} alt="โลโก้"
                className="w-14 h-14 md:w-18 md:h-18 rounded-full object-contain bg-white/10 p-0.5 border border-white/20 shadow-inner hover:opacity-85 transition-opacity" />
            ) : (
              <div className="w-14 h-14 md:w-18 md:h-18 rounded-full border-2 border-white/40 bg-white/20 flex items-center justify-center text-xl md:text-2xl font-bold hover:bg-white/30 transition-colors">
                {tenant?.name?.[0] ?? '?'}
              </div>
            )}
          </Link>

          {/* Name block */}
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            <h1 className="font-bold text-sm md:text-base leading-tight text-gray-800">
              {tenant?.name}
            </h1>
            <p className="text-gray-500 text-[10px] md:text-xs line-clamp-1 mt-0.5">{tenant?.system_subtitle || '✦ E-Service ✦ งานบริการประชาชน'}</p>
          </div>

          {/* Desktop nav — technician เท่านั้น (citizen ใช้ CitizenSidebar แทน) */}
          {role === 'technician' && (
            <nav className="hidden md:flex items-center gap-0.5">
              {NAV_TECH.map((l) => {
                const isActive = l.href === '/'
                  ? location.pathname === '/'
                  : location.pathname.startsWith(l.href)
                return (
                  <Link key={l.href} to={l.href}
                    className={`relative px-3 py-2 rounded-lg text-sm transition-colors font-medium ${
                      isActive
                        ? 'text-white bg-white/20'
                        : 'text-white/80 hover:text-white hover:bg-white/12'
                    }`}>
                    {l.label}
                    {l.href === '/notifications' && unreadCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-3.5 h-3.5 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center px-0.5">
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    )}
                  </Link>
                )
              })}
            </nav>
          )}
          {role === 'viewer' && (
            <Link to="/admin"
              className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-colors hover:opacity-90"
              style={{ backgroundColor: 'white', color: 'var(--color-primary)' }}>
              <LayoutDashboard size={13} /> รายงาน
            </Link>
          )}

          {session ? (
            <div className="hidden md:flex items-center gap-2">
              {(isAdmin || role === 'staff' || role === 'officer') && (
                <Link to="/staff"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-colors hover:opacity-90"
                  style={{ backgroundColor: 'rgba(255,255,255,0.18)', color: 'white' }}>
                  <Briefcase size={14} /> สำหรับเจ้าหน้าที่
                </Link>
              )}
              {isAdmin && (
                <Link to="/admin"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-colors hover:opacity-90"
                  style={{ backgroundColor: 'white', color: 'var(--color-primary)' }}>
                  <LayoutDashboard size={14} /> แผงควบคุม Admin
                </Link>
              )}
              <Link to="/profile" className="text-gray-600 text-xs flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                <UserCircle2 size={15} /> {displayName}
              </Link>
              <button onClick={logout}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors">
                <LogOut size={14} /> ออก
              </button>
            </div>
          ) : (
            <Link to="/auth"
              className="hidden md:flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs border border-[var(--color-primary)] text-[var(--color-primary)] hover:bg-[var(--color-primary)] hover:text-white transition-colors font-medium">
              <LogIn size={14} /> เข้าสู่ระบบ
            </Link>
          )}

          {/* Mobile: 2-column layout — icons left, avatar right */}
          <div className="md:hidden flex items-center gap-1">
            {/* Bell */}
            <button onClick={() => navigate('/notifications')} aria-label="การแจ้งเตือน"
              className="relative p-2 text-gray-400 hover:text-[var(--color-primary)] transition-colors">
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-3.5 h-3.5 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center px-0.5 shadow-sm">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {/* ขวา: Avatar */}
            {session ? (
              <Link to="/profile" className="p-1 shrink-0">
                {avatarUrl && (
                  <img
                    src={avatarUrl}
                    alt=""
                    onError={(e) => { e.currentTarget.style.display = 'none'; if (e.currentTarget.nextElementSibling) e.currentTarget.nextElementSibling.style.display = 'flex'; }}
                    className="w-10 h-10 rounded-full object-cover border border-gray-200"
                  />
                )}
                <div className={`w-10 h-10 rounded-full bg-gray-100 border border-gray-200 ${avatarUrl ? 'hidden' : 'flex'} items-center justify-center text-[var(--color-primary)] text-sm font-bold`}>
                  {(displayName || session.user?.email || '?')[0].toUpperCase()}
                </div>
              </Link>
            ) : (
              <Link to="/auth" className="p-2 text-gray-400 hover:text-[var(--color-primary)] transition-colors">
                <User size={22} />
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
