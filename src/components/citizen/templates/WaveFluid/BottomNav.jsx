import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useNotifications } from '../../../../contexts/NotificationsContext'
import { useAuth } from '../../../../contexts/AuthContext'
import { NAV_CITIZEN, NAV_TECH } from '../navData'

export default function WaveFluidBottomNav() {
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
      <div
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-stretch justify-around px-2 shadow-[0_-4px_24px_rgba(0,0,0,0.15)]"
        style={{
          backgroundColor: 'var(--color-primary-dark)',
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)',
          paddingTop: '8px',
        }}
      >
        {NAV_ITEMS.map((item, index) => {
          const Icon = item.icon
          const isActive = item.href
            ? (location.pathname === item.href || (item.href !== '/' && location.pathname.startsWith(item.href)))
            : false
          const isCenter = index === 2

          return (
            <button
              key={item.label}
              onClick={() => navigate(item.href)}
              className={`flex-1 flex flex-col items-center justify-center transition-transform active:scale-95 relative ${isCenter ? '-mt-6' : ''}`}
            >
              {isCenter ? (
                <div className="w-14 h-14 rounded-full bg-yellow-400 flex flex-col items-center justify-center shadow-lg border-4 border-white z-20">
                  <Icon size={24} className="text-[var(--color-primary-dark)]" strokeWidth={2.5} />
                </div>
              ) : (
                <div className="relative z-10 flex flex-col items-center gap-1">
                  <Icon
                    size={22}
                    className={`transition-all ${isActive ? 'text-white' : 'text-white/60'}`}
                    strokeWidth={isActive ? 2.5 : 1.5}
                  />
                  <span className={`text-[13px] font-medium transition-all ${isActive ? 'text-white font-bold' : 'text-white/60'}`}>
                    {item.label}
                  </span>
                </div>
              )}
              {/* Badges */}
              {!isCenter && item.href === '/notifications' && unreadCount > 0 && (
                <span className="absolute top-0 right-2 min-w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1 shadow-sm ring-1 ring-white/30">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
              {!isCenter && item.href === '/technician' && techNewCount > 0 && (
                <span className="absolute top-0 right-2 min-w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1 shadow-sm ring-1 ring-white/30">
                  {techNewCount > 9 ? '9+' : techNewCount}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <div className="md:hidden" style={{ height: 'calc(5rem + max(env(safe-area-inset-bottom, 0px), 12px))' }} />
    </>
  )
}
