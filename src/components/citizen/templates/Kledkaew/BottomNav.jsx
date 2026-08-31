import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../../contexts/AuthContext'
import { getNavItems } from '../navData'
import { useTenant } from '../../../../contexts/TenantContext'

export default function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const { role } = useAuth()
  const { isModuleEnabled } = useTenant()

  if (location.pathname.startsWith('/admin') || location.pathname.startsWith('/staff')) return null

  const NAV_ITEMS = getNavItems(role, isModuleEnabled)
  const centerHref = role === 'technician'
    ? '/technician'
    : ['staff', 'officer', 'council', 'admin', 'superadmin', 'viewer'].includes(role)
      ? '/staff'
      : '/complaint'

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden"
         style={{
           background: 'linear-gradient(180deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)',
           borderTopLeftRadius: '20px',
           borderTopRightRadius: '20px',
           boxShadow: '0 -4px 10px rgba(0,0,0,0.1)',
           paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)',
         }}>
      {/* Wave overlay background */}
      <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 1440 320\'%3E%3Cpath fill=\'%23ffffff\' fill-opacity=\'1\' d=\'M0,160L48,170.7C96,181,192,203,288,208C384,213,480,203,576,170.7C672,139,768,85,864,80C960,75,1056,117,1152,149.3C1248,181,1344,203,1392,213.3L1440,224L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z\'%3E%3C/path%3E%3C/svg%3E")', backgroundSize: 'cover', backgroundPosition: 'bottom' }}></div>

      <div className="flex justify-around items-end h-[60px] px-2 relative z-10 pb-1.5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = item.href
            ? (location.pathname === item.href || (item.href !== '/' && location.pathname.startsWith(item.href)))
            : false
          const isCenter = item.href === centerHref

          if (isCenter) {
            return (
              <button key={item.label} onClick={() => navigate(item.href)}
                aria-label={item.label} aria-current={isActive ? 'page' : undefined}
                className="relative -top-5 flex flex-col items-center justify-center w-16 h-16 shadow-xl transition-transform active:scale-95 shrink-0"
                style={{
                  background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 55%, white) 0%, var(--color-primary) 100%)',
                  borderRadius: '50% 50% 50% 0',
                  transform: 'rotate(-45deg)',
                  border: '3px solid rgba(255,255,255,0.3)',
                  boxShadow: '0 10px 25px -5px color-mix(in srgb, var(--color-primary) 55%, transparent)'
                }}>
                <div style={{ transform: 'rotate(45deg)' }} className="flex flex-col items-center mt-1">
                  <Icon size={22} className="text-white drop-shadow-md" strokeWidth={2.5} />
                  <span className="text-[10px] text-white font-black mt-0.5 drop-shadow-md leading-none whitespace-nowrap">{item.label}</span>
                </div>
              </button>
            )
          }

          return (
            <button key={item.label} onClick={() => navigate(item.href)}
              aria-label={item.label} aria-current={isActive ? 'page' : undefined}
              className={`flex flex-col items-center gap-1 p-2 transition-colors ${isActive ? 'text-white drop-shadow-md font-bold' : 'text-white/70 hover:text-white'}`}>
              <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
              <span className="text-[12px] font-bold tracking-wide leading-none">{item.label}</span>
            </button>
          )
        })}
      </div>
      </div>
      <div
        className="md:hidden shrink-0"
        style={{ height: 'calc(60px + max(env(safe-area-inset-bottom, 0px), 8px))' }}
        aria-hidden="true"
      />
    </>
  )
}
