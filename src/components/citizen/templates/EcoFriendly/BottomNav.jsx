import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useNotifications } from '../../../../contexts/NotificationsContext'
import { useAuth } from '../../../../contexts/AuthContext'
import { getNavItems } from '../navData'

export default function EcoFriendlyBottomNav() {
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
        className="lg:hidden fixed bottom-0 left-0 right-0 z-50 flex items-stretch justify-around px-1 shadow-[0_-1px_0_rgba(0,0,0,0.08),0_-4px_24px_rgba(0,0,0,0.12)]"
        style={{
          background: 'linear-gradient(160deg, var(--color-primary-dark) 0%, var(--color-primary) 100%)',
          borderRadius: 'var(--radius-card, 1.25rem) var(--radius-card, 1.25rem) 0 0',
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)',
          paddingTop: '6px',
        }}
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isAI = item.href === '/chatbot'
          const isActive = item.href
            ? (location.pathname === item.href || (item.href !== '/' && location.pathname.startsWith(item.href)))
            : false

          return (
            <button
              key={item.label}
              onClick={() => navigate(item.href)}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 transition-transform active:scale-90 relative ${isAI ? 'z-20' : ''}`}
            >
              {isActive && !isAI && (
                <span className="absolute inset-x-2 top-0.5 h-8 rounded-xl bg-white/20 pointer-events-none" />
              )}

              <div className={`relative z-10 ${isAI ? '-mt-3 mb-0.5' : ''}`}>
                {isAI && (
                  <>
                    <span className="absolute -inset-2 rounded-2xl bg-linear-to-br from-cyan-300 via-blue-500 to-violet-500 opacity-70 blur-md motion-safe:animate-pulse pointer-events-none" />
                    <span className="absolute -top-1.5 -right-1.5 z-20 h-4 min-w-4 px-1 rounded-full bg-linear-to-r from-amber-200 to-yellow-400 text-[9px] leading-4 font-black text-amber-950 shadow-[0_2px_8px_rgba(250,204,21,0.65)] ring-1 ring-white/80 pointer-events-none">
                      ✦
                    </span>
                  </>
                )}
                <span
                  className={isAI
                    ? `relative flex h-11 w-11 items-center justify-center rounded-2xl bg-linear-to-br from-cyan-300 via-blue-500 to-violet-600 text-white ring-2 ring-white/90 shadow-[0_8px_22px_rgba(67,56,202,0.55),inset_0_1px_0_rgba(255,255,255,0.55)] transition-all ${isActive ? 'scale-110 rotate-3' : 'hover:scale-105'}`
                    : ''}
                >
                  <Icon
                    size={isAI ? 25 : 20}
                    className={`transition-all ${isAI || isActive ? 'text-white' : 'text-white/55'}`}
                    strokeWidth={isAI || isActive ? 2.5 : 1.8}
                  />
                </span>
                {item.href === '/notifications' && unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1 shadow-sm ring-1 ring-white/30">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
                {item.href === '/technician' && techNewCount > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1 shadow-sm ring-1 ring-white/30">
                    {techNewCount > 9 ? '9+' : techNewCount}
                  </span>
                )}
              </div>

              <span className={`relative z-10 min-h-7 flex items-center justify-center text-center leading-tight transition-all ${isAI ? '-mt-0.5 text-[11px] font-black text-white drop-shadow-[0_2px_5px_rgba(15,23,42,0.65)]' : `text-[11px] font-semibold ${isActive ? 'text-white' : 'text-white/70'}`}`}>
                {item.label}
              </span>
            </button>
          )
        })}
      </div>
      <div className="lg:hidden" style={{ height: 'calc(4rem + max(env(safe-area-inset-bottom, 0px), 12px))' }} />
    </>
  )
}
