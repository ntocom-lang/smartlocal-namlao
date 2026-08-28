import { useLocation, useNavigate } from 'react-router-dom'
import { useNotifications } from '../../../../contexts/NotificationsContext'
import { useAuth } from '../../../../contexts/AuthContext'
import { getNavItems } from '../navData'
import { useTenant } from '../../../../contexts/TenantContext'

export default function ServiceHubBottomNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const { unreadCount } = useNotifications()
  const { role } = useAuth()
  const { isModuleEnabled } = useTenant()

  if (location.pathname.startsWith('/admin') || location.pathname.startsWith('/staff')) return null

  const NAV_ITEMS = getNavItems(role, isModuleEnabled)

  return (
    <>
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 flex items-stretch justify-around bg-white border-t border-gray-100 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)', paddingTop: '6px' }}>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = item.href
            ? (location.pathname === item.href || (item.href !== '/' && location.pathname.startsWith(item.href)))
            : false
          return (
            <button key={item.label} onClick={() => navigate(item.href)}
              aria-label={item.label} aria-current={isActive ? 'page' : undefined}
              className="flex-1 flex flex-col items-center gap-0.5 py-1.5 transition-transform active:scale-90 relative">
              <div className="relative">
                <Icon size={20} className={isActive ? 'text-blue-600' : 'text-gray-400'} strokeWidth={isActive ? 2.5 : 1.8} />
                {item.href === '/notifications' && unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1 shadow-sm">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </div>
              <span className={`text-[11px] font-semibold leading-tight ${isActive ? 'text-blue-600' : 'text-gray-400'}`}>
                {item.label}
              </span>
            </button>
          )
        })}
      </div>
      <div className="lg:hidden" style={{ height: 'calc(4rem + max(env(safe-area-inset-bottom, 0px), 8px))' }} />
    </>
  )
}
