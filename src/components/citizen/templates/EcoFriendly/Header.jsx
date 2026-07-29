import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Phone, LogIn, LogOut, UserCircle2, User, LayoutDashboard, Bell, Briefcase } from 'lucide-react'
import { useTenant } from '../../../../contexts/TenantContext'
import { useAuth } from '../../../../contexts/AuthContext'
import { supabase } from '../../../../lib/supabase'
import { useNotifications } from '../../../../contexts/NotificationsContext'

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
  const isAdmin = role === 'admin' || role === 'superadmin' || role === 'officer'

  return (
    <header className="shadow-xl" style={tenant?.header_image_url ? { position: 'relative', zIndex: 2 } : {}}>
      {/* Top strip — hidden on mobile */}
      <div className="hidden lg:flex text-white text-xs py-1.5 px-4 justify-end items-center gap-3"
           style={{ background: 'linear-gradient(90deg, #0a1628 0%, #0f2044 50%, #0a1628 100%)', borderBottom: '1px solid rgba(99,179,237,0.15)' }}>
        <Phone size={11} className="text-sky-300/70" />
        <span className="font-semibold tracking-wide text-sky-100">{tenant?.name}</span>
        <span className="text-white/20">|</span>
        <span className="text-white/60">{tenant?.system_subtitle || '✦ E-Service ✦ งานบริการประชาชน'}</span>
        <span className="text-white/20">|</span>
        <a href="/manual-citizen.html" target="_blank" rel="noopener noreferrer"
          className="text-sky-300/80 hover:text-sky-200 transition-colors underline underline-offset-2">
          📋 คู่มือการใช้งาน
        </a>
      </div>

      {/* Main header */}
      <div className="text-white px-4 relative overflow-hidden"
           style={{
             background: `linear-gradient(135deg, #0a1628 0%, #0f2a4a 20%, var(--color-primary-dark) 40%, var(--color-primary) 65%, color-mix(in srgb, var(--color-primary) 55%, #38bdf8) 85%, #7dd3fc 100%)`,
             paddingTop: 12, paddingBottom: 24,
           }}>
        {/* Aurora glow top edge */}
        <div className="absolute top-0 left-0 right-0 h-0.5 pointer-events-none"
          style={{ background: 'linear-gradient(90deg, transparent 0%, #38bdf8 20%, #818cf8 40%, #f472b6 55%, #fbbf24 70%, #38bdf8 85%, transparent 100%)', opacity: 0.7 }} />
        {/* Light bloom left */}
        <div className="absolute -top-10 -left-10 w-56 h-56 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(56,189,248,0.18) 0%, transparent 70%)' }} />
        {/* Light bloom right */}
        <div className="absolute -top-6 -right-6 w-64 h-64 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(129,140,248,0.2) 0%, transparent 70%)' }} />
        {/* Gold bloom center-right */}
        <div className="absolute top-0 right-1/3 w-48 h-32 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse, rgba(251,191,36,0.1) 0%, transparent 70%)' }} />
        {/* Orbs */}
        <div className="absolute -bottom-8 right-32 w-24 h-24 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(99,179,237,0.15) 0%, transparent 70%)' }} />
        <div className="absolute top-2 left-1/4 w-16 h-16 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.06) 0%, transparent 70%)' }} />
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
            <h1 className="font-bold text-sm md:text-base leading-tight drop-shadow">
              {tenant?.name}
            </h1>
            <p className="text-white/80 text-[10px] md:text-xs line-clamp-1 mt-0.5 drop-shadow">{tenant?.system_subtitle || '✦ E-Service ✦ งานบริการประชาชน'}</p>
          </div>

          {/* Desktop nav — technician เท่านั้น (citizen ใช้ CitizenSidebar แทน) */}
          {role === 'technician' && (
            <nav className="hidden lg:flex items-center gap-0.5">
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
              className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-colors hover:opacity-90"
              style={{ backgroundColor: 'white', color: 'var(--color-primary)' }}>
              <LayoutDashboard size={13} /> รายงาน
            </Link>
          )}

          {session ? (
            <div className="hidden lg:flex items-center gap-2">
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
              <Link to="/profile" className="text-white/80 text-xs flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-white/12 transition-colors">
                <UserCircle2 size={15} /> {displayName}
              </Link>
              <button onClick={logout}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-white/80 hover:text-white hover:bg-white/15 transition-colors">
                <LogOut size={14} /> ออก
              </button>
            </div>
          ) : (
            <Link to="/auth"
              className="hidden lg:flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-white/20 hover:bg-white/30 text-white transition-colors font-medium">
              <LogIn size={14} /> เข้าสู่ระบบ
            </Link>
          )}

          {/* Mobile: 2-column layout — icons left, avatar right */}
          <div className="lg:hidden flex items-center gap-1">
            {/* Bell */}
            <button onClick={() => navigate('/notifications')} aria-label="การแจ้งเตือน"
              className="relative p-2 text-white/85 hover:text-white transition-colors">
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-3.5 h-3.5 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center px-0.5 shadow-sm">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {/* ขวา: Avatar */}
            {session ? (
              <Link to="/profile" className="p-1 shrink-0">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt="avatar"
                    className="w-10 h-10 rounded-full object-cover border-2 border-white/60"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-white/20 border-2 border-white/60 flex items-center justify-center text-white text-sm font-bold">
                    {(displayName || session.user?.email || '?')[0].toUpperCase()}
                  </div>
                )}
              </Link>
            ) : (
              <Link to="/auth" className="p-2 text-white/85 hover:text-white transition-colors">
                <User size={20} />
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
