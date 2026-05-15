import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Home, ClipboardList, FileSearch, Bell, LayoutGrid, Wrench } from 'lucide-react'
import { useNotifications } from '../../contexts/NotificationsContext'
import { supabase } from '../../lib/supabase'

const NAV_CITIZEN = [
  { label: 'หน้าแรก',      icon: Home,          href: '/' },
  { label: 'ยื่นคำร้อง',   icon: ClipboardList, href: '/complaint' },
  { label: 'คำร้องของฉัน', icon: FileSearch,    href: '/my-complaints' },
  { label: 'แจ้งเตือน',    icon: Bell,          href: '/notifications' },
  { label: 'เมนูอื่นๆ',    icon: LayoutGrid,    href: '/more' },
]

const NAV_TECH = [
  { label: 'หน้าแรก',      icon: Home,          href: '/' },
  { label: 'งานของฉัน',    icon: Wrench,        href: '/technician' },
  { label: 'คำร้องของฉัน', icon: FileSearch,    href: '/my-complaints' },
  { label: 'แจ้งเตือน',    icon: Bell,          href: '/notifications' },
  { label: 'เมนูอื่นๆ',    icon: LayoutGrid,    href: '/more' },
]

export default function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const { unreadCount } = useNotifications()
  const [role, setRole] = useState(() => localStorage.getItem('sl_role') ?? null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { localStorage.removeItem('sl_role'); setRole(null); return }
      supabase.from('profiles').select('role').eq('id', data.session.user.id).single()
        .then(({ data: p }) => {
          const r = p?.role ?? 'citizen'
          localStorage.setItem('sl_role', r)
          setRole(r)
        })
    })
  }, [])

  if (location.pathname.startsWith('/admin')) return null

  const NAV_ITEMS = role === 'technician' ? NAV_TECH : NAV_CITIZEN

  return (
    <>
      {/* Bottom bar */}
      <div
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-stretch justify-around px-1 shadow-[0_-1px_0_rgba(0,0,0,0.08),0_-4px_24px_rgba(0,0,0,0.12)]"
        style={{
          background: 'linear-gradient(160deg, var(--color-primary-dark) 0%, var(--color-primary) 100%)',
          borderRadius: '1.25rem 1.25rem 0 0',
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)',
          paddingTop: '6px',
        }}
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = item.href
            ? (location.pathname === item.href || (item.href !== '/' && location.pathname.startsWith(item.href)))
            : false

          return (
            <button
              key={item.label}
              onClick={() => navigate(item.href)}
              className="flex-1 flex flex-col items-center gap-0.5 py-1.5 transition-transform active:scale-90 relative"
            >
              {isActive && (
                <span className="absolute inset-x-2 top-0.5 h-8 rounded-xl bg-white/20 pointer-events-none" />
              )}

              <div className="relative z-10">
                <Icon
                  size={20}
                  className={`transition-all ${isActive ? 'text-white' : 'text-white/55'}`}
                  strokeWidth={isActive ? 2.5 : 1.8}
                />
                {item.href === '/notifications' && unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1 shadow-sm ring-1 ring-white/30">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </div>

              <span className={`relative z-10 text-[9px] font-medium transition-all ${isActive ? 'text-white' : 'text-white/55'}`}>
                {item.label}
              </span>
            </button>
          )
        })}
      </div>

      <div className="md:hidden" style={{ height: 'calc(4rem + max(env(safe-area-inset-bottom, 0px), 12px))' }} />
    </>
  )
}
