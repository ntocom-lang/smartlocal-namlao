import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Phone, Sun, Moon, LogIn, LogOut, UserCircle2, User, LayoutDashboard, Bell, Briefcase } from 'lucide-react'
import { useTenant } from '../../contexts/TenantContext'
import { useAuth } from '../../contexts/AuthContext'
import { useTheme } from '../../contexts/ThemeContext'
import { supabase } from '../../lib/supabase'
import { useNotifications } from '../../contexts/NotificationsContext'

const NAV_CITIZEN = [
  { label: 'หน้าแรก',       href: '/' },
  { label: 'ร้องเรียน/ร้องทุกข์', href: '/complaint' },
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
  const { theme, toggle } = useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const { unreadCount } = useNotifications()
  const { session, role, displayName } = useAuth()

  async function logout() {
    await supabase.auth.signOut()
  }
  const isAdmin = role === 'admin' || role === 'superadmin' || role === 'officer'
  const isStaff = role === 'staff' || role === 'technician'

  if (location.pathname.startsWith('/staff')) return null

  return (
    <header className="shadow-md" style={tenant?.header_image_url ? { position: 'relative', zIndex: 2 } : {}}>
      {/* Top strip — hidden on mobile */}
      <div className="hidden md:flex text-white text-xs py-1 px-4 justify-end items-center gap-3"
           style={{ backgroundColor: 'var(--color-primary-dark)' }}>
        <Phone size={11} />
        <span className="font-semibold tracking-wide">{tenant?.name}</span>
        <span className="opacity-40">|</span>
        <span className="opacity-80">ระบบศูนย์รวมข้อมูลดิจิทัลเพื่อการพัฒนาอย่างยั่งยืน</span>
        <span className="opacity-40">|</span>
        <a href="/manual-citizen.html" target="_blank" rel="noopener noreferrer"
          className="opacity-80 hover:opacity-100 transition-opacity underline underline-offset-2">
          📋 คู่มือการใช้งาน
        </a>
      </div>

      {/* Main header */}
      {/* เมื่อมีรูป header → nav โปร่งใส, รูปอยู่ใน hero zone ใน HomePage แทน */}
      <div className="text-white px-4 relative overflow-visible"
           style={tenant?.header_image_url && location.pathname === '/'
             ? { background: 'transparent', paddingTop: 14, paddingBottom: 24 }
             : { background: `linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 55%, color-mix(in srgb, var(--color-primary) 70%, #60a5fa) 100%)`, paddingTop: 12, paddingBottom: 24 }
           }>
        {/* Decorative shapes (only when no image) */}
        {!tenant?.header_image_url && <>
          <div className="absolute -top-8 -right-8 w-36 h-36 rounded-full bg-white/10 pointer-events-none" />
          <div className="absolute -bottom-10 right-20 w-28 h-28 rounded-full bg-white/8 pointer-events-none" />
          <div className="absolute top-1 left-1/3 w-20 h-20 rounded-full bg-white/5 pointer-events-none" />
          <div className="absolute -top-4 right-1/3 w-14 h-14 rounded-full bg-white/10 pointer-events-none" />
        </>}
        <div className="max-w-6xl mx-auto flex items-center gap-3 relative z-10">
          {/* Logo circle — always home */}
          <Link to={role === 'technician' ? '/technician' : '/'} className="shrink-0">
            {tenant?.logo_url ? (
              <img src={tenant.logo_url} alt="โลโก้"
                className="w-10 h-10 md:w-14 md:h-14 rounded-full object-contain hover:opacity-85 transition-opacity" />
            ) : (
              <div className="w-10 h-10 md:w-14 md:h-14 rounded-full border-2 border-white/40 bg-white/20 flex items-center justify-center text-xl font-bold hover:bg-white/30 transition-colors">
                {tenant?.name?.[0] ?? '?'}
              </div>
            )}
          </Link>

          {/* Name block */}
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            <h1 className="font-bold text-sm md:text-base leading-tight drop-shadow">
              {tenant?.name}
            </h1>
            <p className="text-white/80 text-[10px] md:text-xs line-clamp-1 mt-0.5 drop-shadow">ระบบศูนย์รวมข้อมูลดิจิทัลเพื่อการพัฒนาอย่างยั่งยืน</p>
          </div>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-0.5">
            {(role === 'technician' ? NAV_TECH : NAV_CITIZEN).map((l) => {
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

            {role === 'viewer' && (
              <Link to="/admin"
                className="ml-1 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-colors hover:opacity-90"
                style={{ backgroundColor: 'white', color: 'var(--color-primary)' }}>
                <LayoutDashboard size={13} /> รายงาน
              </Link>
            )}
            {role === 'council' && (
              <Link to="/admin"
                className="ml-1 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-colors hover:opacity-90"
                style={{ backgroundColor: 'white', color: 'var(--color-primary)' }}>
                <LayoutDashboard size={13} /> กิจกรรม
              </Link>
            )}
          </nav>

          {/* Theme toggle */}
          <button
            onClick={toggle}
            aria-label="สลับธีม"
            className="p-2 rounded-lg text-white/80 hover:text-white hover:bg-white/15 transition-colors"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {/* Auth */}
          {session ? (
            <div className="hidden md:flex items-center gap-2">
              {isAdmin && (
                <Link to="/admin"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-colors hover:opacity-90"
                  style={{ backgroundColor: 'white', color: 'var(--color-primary)' }}>
                  <LayoutDashboard size={14} /> แผงควบคุม Admin
                </Link>
              )}
              {role === 'council' && (
                <Link to="/admin"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-colors hover:opacity-90"
                  style={{ backgroundColor: 'white', color: 'var(--color-primary)' }}>
                  <LayoutDashboard size={14} /> ปฏิทินกิจกรรม
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
              className="hidden md:flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-white/20 hover:bg-white/30 text-white transition-colors font-medium">
              <LogIn size={14} /> เข้าสู่ระบบ
            </Link>
          )}

          {/* Mobile: Bell + Auth icon */}
          <div className="md:hidden flex items-center gap-1">
            <button
              onClick={() => navigate('/notifications')}
              aria-label="การแจ้งเตือน"
              className="relative p-2 text-white/85 hover:text-white transition-colors">
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-3.5 h-3.5 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center px-0.5 shadow-sm">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            {session ? (
              <div className="relative p-1" style={{ paddingBottom: (isAdmin || isStaff) ? 20 : 4 }}>
                <Link to="/profile">
                  {(session.user?.user_metadata?.avatar_url || session.user?.user_metadata?.picture) ? (
                    <img
                      src={session.user.user_metadata.avatar_url || session.user.user_metadata.picture}
                      alt="avatar"
                      className="w-8 h-8 rounded-full object-cover border-2 border-white/60"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-white/20 border-2 border-white/60 flex items-center justify-center text-white text-xs font-bold">
                      {(displayName || session.user?.email || '?')[0].toUpperCase()}
                    </div>
                  )}
                </Link>
                {(isAdmin || isStaff) && (
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 flex gap-1">
                    {isStaff && (
                      <Link to="/staff" aria-label="ระบบเจ้าหน้าที่"
                        className="w-7 h-4 rounded bg-white/25 hover:bg-white/40 flex items-center justify-center transition-colors">
                        <Briefcase size={10} className="text-white" />
                      </Link>
                    )}
                    {isAdmin && (
                      <Link to="/admin" aria-label="แผงควบคุม Admin"
                        className="w-7 h-4 rounded bg-white/25 hover:bg-white/40 flex items-center justify-center transition-colors">
                        <LayoutDashboard size={10} className="text-white" />
                      </Link>
                    )}
                  </div>
                )}
              </div>
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
