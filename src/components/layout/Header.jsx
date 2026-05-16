import { useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Phone, Sun, Moon, LogIn, LogOut, UserCircle2, User, LayoutDashboard, Bell } from 'lucide-react'
import { useTenant } from '../../contexts/TenantContext'
import { useTheme } from '../../contexts/ThemeContext'
import { supabase } from '../../lib/supabase'
import { useNotifications } from '../../contexts/NotificationsContext'

const NAV_LINKS = [
  { label: 'หน้าแรก',       href: '/' },
  { label: 'ยื่นคำร้อง',    href: '/complaint' },
  { label: 'คำร้องของฉัน',  href: '/my-complaints' },
  { label: 'โปรไฟล์',       href: '/profile' },
]

export default function Header() {
  const { tenant } = useTenant()
  const { theme, toggle } = useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const { unreadCount } = useNotifications()
  const [session, setSession] = useState(null)
  const [role, setRole] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (!s) setRole(null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    supabase.from('profiles').select('role').eq('id', session.user.id).maybeSingle()
      .then(({ data }) => setRole(data?.role ?? 'citizen'))
  }, [session])

  async function logout() {
    await supabase.auth.signOut()
  }

  const displayName = session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')[0] || ''
  const isAdmin = role === 'admin' || role === 'superadmin'

  return (
    <header className="sticky top-0 z-50 shadow-md">
      {/* Top strip — hidden on mobile */}
      <div className="hidden md:flex text-white text-xs py-1 px-4 justify-end items-center gap-3"
           style={{ backgroundColor: 'var(--color-primary-dark)' }}>
        <Phone size={11} />
        <span>E-Service</span>
        <span className="opacity-40">|</span>
        <span>ระบบยื่นคำร้องออนไลน์ ตลอด 24 ชม.</span>
      </div>

      {/* Main header */}
      <div className="text-white px-4 py-3"
           style={{ background: `linear-gradient(90deg, var(--color-primary-dark) 0%, var(--color-primary) 100%)` }}>
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          {/* Logo circle — always home */}
          <Link to={role === 'technician' ? '/technician' : '/'} className="shrink-0">
            {tenant?.logo_url ? (
              <img src={tenant.logo_url} alt="โลโก้"
                className="w-10 h-10 md:w-14 md:h-14 rounded-full object-contain hover:opacity-85 transition-opacity" />
            ) : (
              <div className="w-10 h-10 md:w-14 md:h-14 rounded-full border-2 border-white/40 bg-white/20
                              flex items-center justify-center text-xl font-bold hover:bg-white/30 transition-colors">
                {tenant?.name?.[0] ?? '?'}
              </div>
            )}
          </Link>

          {/* Name block */}
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-sm md:text-xl leading-tight line-clamp-2">
              {tenant?.name}
            </h1>
            <p className="text-white/70 text-[11px] md:text-xs hidden sm:block">ระบบยื่นคำร้องออนไลน์ · {tenant?.province}</p>
          </div>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-0.5">
            {NAV_LINKS.map((l) => {
              const isActive = location.pathname === l.href ||
                (l.href !== '/' && location.pathname.startsWith(l.href))
              return (
                <Link key={l.href} to={l.href}
                   className={`px-3 py-2 rounded-lg text-sm transition-colors font-medium ${
                     isActive
                       ? 'text-white bg-white/20'
                       : 'text-white/80 hover:text-white hover:bg-white/12'
                   }`}>
                  {l.label}
                </Link>
              )
            })}
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
              <Link to="/profile" className="p-1">
                {session.user?.user_metadata?.avatar_url ? (
                  <img
                    src={session.user.user_metadata.avatar_url}
                    alt="avatar"
                    className="w-8 h-8 rounded-full object-cover border-2 border-white/60"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-white/20 border-2 border-white/60 flex items-center justify-center text-white text-xs font-bold">
                    {(session.user?.user_metadata?.full_name || session.user?.email || '?')[0].toUpperCase()}
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
