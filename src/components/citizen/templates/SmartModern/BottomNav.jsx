import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useNotifications } from '../../../../contexts/NotificationsContext'
import { useAuth } from '../../../../contexts/AuthContext'
import { NAV_CITIZEN, NAV_TECH } from '../navData'

export default function SmartModernBottomNav() {
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

  const NAV_ITEMS = role === 'technician' ? NAV_TECH : NAV_CITIZEN

  return (
    <>
      <div className="md:hidden fixed bottom-4 left-4 right-4 z-50 flex items-stretch justify-around px-2 py-2 shadow-xl bg-[#1c2434] rounded-[2rem] border border-white/10">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = item.href
            ? (location.pathname === item.href || (item.href !== '/' && location.pathname.startsWith(item.href)))
            : false

          return (
            <button
              key={item.label}
              onClick={() => navigate(item.href)}
              className="flex-1 flex flex-col items-center justify-center py-2 transition-all active:scale-95 relative rounded-2xl"
              style={{ backgroundColor: isActive ? 'var(--color-primary)' : 'transparent' }}
            >
              <div className="relative z-10 flex flex-col items-center gap-1">
                <Icon
                  size={20}
                  className={`transition-all ${isActive ? 'text-white' : 'text-gray-400'}`}
                  strokeWidth={isActive ? 2.5 : 1.5}
                />
                {item.href === '/notifications' && unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1 shadow-sm ring-1 ring-white/10">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
                {item.href === '/technician' && techNewCount > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1 shadow-sm ring-1 ring-white/10">
                    {techNewCount > 9 ? '9+' : techNewCount}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
      <div className="md:hidden" style={{ height: 'calc(5.5rem + max(env(safe-area-inset-bottom, 0px), 12px))' }} />
    </>
  )
}
