import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useNotifications } from '../../../../contexts/NotificationsContext'
import { useAuth } from '../../../../contexts/AuthContext'
import { getNavItems } from '../navData'

export default function CleanMinimalBottomNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const { unreadCount } = useNotifications()
  const { role } = useAuth()
  const [techNewCount, setTechNewCount] = useState(
    () => parseInt(localStorage.getItem('sl_tech_new') ?? '0', 10)
  )

  useEffect(() => {
    const handler = (e) => setTechNewCount(e.detail)
    window.addEventListener('tech-badge-update', handler)
    return () => window.removeEventListener('tech-badge-update', handler)
  }, [])

  if (location.pathname.startsWith('/admin') || location.pathname.startsWith('/staff')) return null

  const NAV_ITEMS = getNavItems(role)

  return (
    <>
      <div
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-stretch justify-around px-1 shadow-[0_-4px_24px_rgba(0,0,0,0.06)] bg-white"
        style={{
          borderTop: '1px solid #f3f4f6',
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
              className="flex-1 flex flex-col items-center gap-1 py-1.5 transition-transform active:scale-95 relative"
            >
              <div className="relative z-10">
                <Icon
                  size={22}
                  className={`transition-all ${isActive ? 'text-[var(--color-primary)]' : 'text-gray-400'}`}
                  strokeWidth={isActive ? 2.5 : 1.5}
                />
                {item.href === '/notifications' && unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1 shadow-sm ring-1 ring-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
                {item.href === '/technician' && techNewCount > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1 shadow-sm ring-1 ring-white">
                    {techNewCount > 9 ? '9+' : techNewCount}
                  </span>
                )}
              </div>
              <span className={`relative z-10 text-[13px] font-medium transition-all ${isActive ? 'text-[var(--color-primary)] font-bold' : 'text-gray-400'}`}>
                {item.label}
              </span>
            </button>
          )
        })}
      </div>
      <div className="md:hidden" style={{ height: 'calc(4.5rem + max(env(safe-area-inset-bottom, 0px), 12px))' }} />
    </>
  )
}
