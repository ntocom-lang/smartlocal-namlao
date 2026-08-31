import { Link, useNavigate } from 'react-router-dom'
import { Phone, LogIn, LogOut, Bell, User } from 'lucide-react'
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
      <div className="hidden md:flex text-gray-600 text-xs py-1.5 px-4 justify-end items-center gap-3 bg-gray-50 border-b border-gray-200">
        <Phone size={11} className="text-gray-400" />
        <span className="font-semibold tracking-wide">{tenant?.name}</span>
        <span className="text-gray-300">|</span>
        <span className="text-gray-500">{tenant?.system_subtitle || '✦ E-Service ✦ งานบริการประชาชน'}</span>
        <span className="text-gray-300">|</span>
        <a href="/manual-citizen.html" target="_blank" rel="noopener noreferrer"
          className="text-[var(--color-primary)] hover:underline transition-colors">
          📋 คู่มือการใช้งาน
        </a>
      </div>

      {/* Main header */}
      <div className="bg-white px-4 py-3 relative border-b border-gray-100">
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
            <h1 className="font-bold text-sm md:text-base leading-tight text-gray-800">
              {tenant?.name}
            </h1>
            <p className="text-gray-500 text-[10px] md:text-xs line-clamp-1 mt-0.5">{tenant?.system_subtitle || '✦ E-Service ✦ งานบริการประชาชน'}</p>
          </div>

          {session ? (
            <div className="hidden md:flex items-center gap-2">
              <UserProfileBadge tone="onLight" />
              <PortalSwitcher className="flex" tone="onLight" />
              <button onClick={logout}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors border border-slate-200">
                <LogOut size={13} /> ออกจากระบบ
              </button>
            </div>
          ) : (
            <Link to="/auth"
              className="hidden md:flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold border border-[var(--color-primary)] text-[var(--color-primary)] hover:bg-[var(--color-primary)] hover:text-white transition-colors">
              <LogIn size={13} /> เข้าสู่ระบบ
            </Link>
          )}

          {/* Mobile: 2-column layout — icons left, avatar right */}
          <div className="md:hidden flex items-center gap-1">
            {/* Bell */}
            <button onClick={() => navigate('/notifications')} aria-label="การแจ้งเตือน"
              className="relative p-2 text-gray-400 hover:text-[var(--color-primary)] transition-colors">
              <Bell size={20} />
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
                    className="w-10 h-10 rounded-full object-cover border border-gray-200"
                  />
                )}
                <div className={`w-10 h-10 rounded-full bg-gray-100 border border-gray-200 ${avatarUrl ? 'hidden' : 'flex'} items-center justify-center text-[var(--color-primary)] text-sm font-bold`}>
                  {(displayName || session.user?.email || '?')[0].toUpperCase()}
                </div>
              </Link>
            ) : (
              <Link to="/auth" className="p-2 text-gray-400 hover:text-[var(--color-primary)] transition-colors">
                <User size={22} />
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
