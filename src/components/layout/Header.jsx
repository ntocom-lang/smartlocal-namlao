import { useState, useEffect } from 'react'
import { Menu, X, Phone, Sun, Moon, LogIn, LogOut, UserCircle2 } from 'lucide-react'
import { useTenant } from '../../contexts/TenantContext'
import { useTheme } from '../../contexts/ThemeContext'
import { supabase } from '../../lib/supabase'

const NAV_LINKS = [
  { label: 'หน้าแรก',        href: '/' },
  { label: 'ยื่นคำร้อง',     href: '/request' },
  { label: 'ตรวจสอบสถานะ',  href: '/status' },
  { label: 'ข่าวสาร',        href: '/news' },
  { label: 'ติดต่อเรา',      href: '/contact' },
]

export default function Header() {
  const { tenant } = useTenant()
  const { theme, toggle } = useTheme()
  const [open, setOpen] = useState(false)
  const [session, setSession] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  async function logout() {
    await supabase.auth.signOut()
  }

  const displayName = session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')[0] || ''

  return (
    <header className="sticky top-0 z-50 shadow-md">
      {/* Top strip */}
      <div className="text-white text-xs py-1 px-4 flex justify-end items-center gap-3"
           style={{ backgroundColor: 'var(--color-primary-dark)' }}>
        <Phone size={11} />
        <span>E-Service</span>
        <span className="opacity-40">|</span>
        <span>ระบบยื่นคำร้องออนไลน์ ตลอด 24 ชม.</span>
      </div>

      {/* Main header */}
      <div className="text-white px-4 py-3"
           style={{ background: `linear-gradient(90deg, var(--color-primary-dark) 0%, var(--color-primary) 100%)` }}>
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          {/* Logo circle */}
          {tenant?.logo_url ? (
            <img
              src={tenant.logo_url}
              alt="โลโก้"
              className="w-14 h-14 shrink-0 rounded-full object-contain"
            />
          ) : (
            <div className="w-14 h-14 rounded-full border-2 border-white/40 shrink-0 bg-white/20
                            flex items-center justify-center text-2xl font-bold">
              {tenant?.name?.[0] ?? '?'}
            </div>
          )}

          {/* Name block */}
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-lg md:text-xl leading-tight truncate">
              {tenant?.name}
            </h1>
            <p className="text-white/70 text-xs">ระบบยื่นคำร้องออนไลน์ · {tenant?.province}</p>
          </div>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-0.5">
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href}
                 className="px-3 py-2 rounded-lg text-sm text-white/85 hover:text-white hover:bg-white/15 transition-colors">
                {l.label}
              </a>
            ))}
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
              <span className="text-white/80 text-xs flex items-center gap-1">
                <UserCircle2 size={15} /> {displayName}
              </span>
              <button onClick={logout}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-white/80 hover:text-white hover:bg-white/15 transition-colors">
                <LogOut size={14} /> ออก
              </button>
            </div>
          ) : (
            <a href="/auth"
              className="hidden md:flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-white/20 hover:bg-white/30 text-white transition-colors font-medium">
              <LogIn size={14} /> เข้าสู่ระบบ
            </a>
          )}

          {/* Mobile menu button */}
          <button onClick={() => setOpen(!open)} className="md:hidden p-1 text-white">
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div className="md:hidden text-white divide-y divide-white/10"
             style={{ backgroundColor: 'var(--color-primary-dark)' }}>
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)}
               className="block px-5 py-3 text-sm hover:bg-white/10">
              {l.label}
            </a>
          ))}
          {session ? (
            <button onClick={() => { logout(); setOpen(false) }}
              className="block w-full text-left px-5 py-3 text-sm hover:bg-white/10 text-white/80">
              ออกจากระบบ ({displayName})
            </button>
          ) : (
            <a href="/auth" onClick={() => setOpen(false)}
               className="block px-5 py-3 text-sm hover:bg-white/10 font-medium">
              เข้าสู่ระบบ / สมัครสมาชิก
            </a>
          )}
        </div>
      )}
    </header>
  )
}
