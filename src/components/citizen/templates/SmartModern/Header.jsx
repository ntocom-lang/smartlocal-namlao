import { Link, useNavigate } from 'react-router-dom'
import { Phone, LogIn, LogOut, Bell } from 'lucide-react'
import { useTenant } from '../../../../contexts/TenantContext'
import { useAuth } from '../../../../contexts/AuthContext'
import { signOutSafely } from '../../../../lib/supabase'
import { useNotifications } from '../../../../contexts/NotificationsContext'
import PortalSwitcher from '../../../layout/PortalSwitcher'
import UserProfileBadge from '../../../layout/UserProfileBadge'

export default function Header() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const { unreadCount } = useNotifications()
  const { session, role, displayName, avatarUrl } = useAuth()

  async function logout() {
    await signOutSafely('/')
    navigate('/')
  }
  return (
    <header className="shadow-xl" style={tenant?.header_image_url ? { position: 'relative', zIndex: 2 } : {}}>
      {/* Top strip — hidden on mobile */}
      <div className="hidden md:flex text-gray-300 text-xs py-1.5 px-4 justify-end items-center gap-3 bg-[#0a0f18] border-b border-gray-800">
        <Phone size={11} className="text-[var(--color-primary)]" />
        <span className="font-semibold tracking-wide text-gray-200">{tenant?.name}</span>
        <span className="text-gray-700">|</span>
        <span className="text-gray-400">{tenant?.system_subtitle || '✦ E-Service ✦ งานบริการประชาชน'}</span>
        <span className="text-gray-700">|</span>
        <a href="/manual-citizen.html" target="_blank" rel="noopener noreferrer"
          className="text-[var(--color-primary)] hover:text-white transition-colors">
          📋 คู่มือการใช้งาน
        </a>
      </div>

      {/* Main header */}
      <div className="text-white px-4 py-3 relative bg-[#131b2c] border-b border-gray-800">
        <div className="max-w-6xl mx-auto flex items-center gap-3 relative z-10">
          {/* Logo circle — always home */}
          <Link to={role === 'technician' ? '/technician' : '/'} className="shrink-0">
            {tenant?.logo_url ? (
              <img src={tenant.logo_url} alt="โลโก้"
                className="w-14 h-14 md:w-18 md:h-18 rounded-full object-contain bg-white/10 p-0.5 border border-white/20 shadow-inner hover:opacity-85 transition-opacity" />
            ) : (
              <div className="w-14 h-14 md:w-18 md:h-18 rounded-full border-2 border-white/40 bg-white/20 flex items-center justify-center text-xl md:text-2xl font-bold hover:bg-white/30 transition-colors">
                {tenant?.name?.[0] ?? '?'}
              </div>
            )}
          </Link>

          {/* Name block */}
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            <h1 className="font-bold text-sm md:text-base leading-tight drop-shadow">
              {tenant?.name}
            </h1>
            <p className="text-white/80 text-[10px] md:text-xs line-clamp-1 mt-0.5 drop-shadow">{tenant?.system_subtitle || '✦ E-Service ✦ งานบริการประชาชน'}</p>
          </div>

          {session ? (
            <div className="hidden md:flex items-center gap-2">
              <UserProfileBadge tone="onDark" />
              <PortalSwitcher className="flex" />
              <button onClick={logout}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-white/10 hover:bg-white/20 transition-colors border border-white/20">
                <LogOut size={13} /> ออกจากระบบ
              </button>
            </div>
          ) : (
            <Link to="/auth"
              className="hidden md:flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold bg-white/20 hover:bg-white/30 text-white transition-colors border border-white/20">
              <LogIn size={13} /> เข้าสู่ระบบ
            </Link>
          )}

          {/* Mobile: 2-column layout — icons left, avatar right */}
          <div className="md:hidden flex items-center gap-1">
            {/* Bell */}
            <button onClick={() => navigate('/notifications')} aria-label="การแจ้งเตือน"
              className="relative p-2 text-white/85 hover:text-white transition-colors">
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-3.5 h-3.5 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center px-0.5 shadow-sm">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {/* ขวา: Avatar */}
            {session ? (
              <Link to="/profile" className="p-1 shrink-0">
                {avatarUrl && (
                  <img
                    src={avatarUrl}
                    alt=""
                    onError={(e) => { e.currentTarget.style.display = 'none'; if (e.currentTarget.nextElementSibling) e.currentTarget.nextElementSibling.style.display = 'flex'; }}
                    className="w-10 h-10 rounded-full object-cover border-2 border-white/60"
                  />
                )}
                <div className={`w-10 h-10 rounded-full bg-white/20 border-2 border-white/60 ${avatarUrl ? 'hidden' : 'flex'} items-center justify-center text-white text-sm font-bold`}>
                  {(displayName || session.user?.email || '?')[0].toUpperCase()}
                </div>
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
