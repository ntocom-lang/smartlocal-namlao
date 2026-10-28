import { Link, useNavigate } from 'react-router-dom'
import { Bell, LogIn } from 'lucide-react'
import { useTenant } from '../../../../contexts/TenantContext'
import { useAuth } from '../../../../contexts/AuthContext'
import { useNotifications } from '../../../../contexts/NotificationsContext'
import PortalSwitcher from '../../../layout/PortalSwitcher'
import UserProfileBadge from '../../../layout/UserProfileBadge'

export default function ServiceHubHeader() {
  const { tenant } = useTenant()
  const { session } = useAuth()
  const { unreadCount } = useNotifications()
  const navigate = useNavigate()

  // สีพื้นหลังฟ้าอมเขียวคงที่ตัวนี้ตั้งใจไม่ผูกกับ --color-primary ของแต่ละ อปท. — เป็นเอกลักษณ์ของธีมนี้
  // โดยเฉพาะ (ตามภาพต้นแบบ) ต่างจากธีมอื่นที่ให้ header ไล่สีตาม theme_color ที่แอดมินตั้งเอง
  return (
    <header className="sticky top-0 z-30 shadow-sm" style={{ backgroundColor: '#99e5e0' }}>
      <div className="max-w-[1440px] mx-auto flex items-center gap-2.5 px-3 py-2">
        <Link to="/" className="shrink-0">
          {tenant?.logo_url ? (
            <img src={tenant.logo_url} alt="โลโก้" className="w-10 h-10 rounded-full object-contain bg-white/60 p-0.5" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-white/60 flex items-center justify-center font-bold text-gray-700">
              {tenant?.name?.[0] ?? '?'}
            </div>
          )}
        </Link>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-800 text-sm leading-tight truncate">{tenant?.name}</p>
          <p className="text-[10px] text-gray-600 truncate">{tenant?.system_subtitle || 'ระบบบริการอิเล็กทรอนิกส์'}</p>
        </div>

        {session ? (
          <div className="hidden lg:flex items-center gap-2">
            <PortalSwitcher className="flex" tone="onLight" />
            <UserProfileBadge tone="onLight" />
          </div>
        ) : (
          <Link to="/auth"
            className="hidden lg:flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold bg-white/60 hover:bg-white/90 text-slate-800 transition-colors border border-white/80">
            <LogIn size={13} /> เข้าสู่ระบบ
          </Link>
        )}

        <button onClick={() => navigate('/notifications')} aria-label="การแจ้งเตือน"
          className="relative p-1.5 text-gray-700 hover:text-gray-900 transition-colors shrink-0">
          <Bell size={20} />
          {unreadCount > 0 && (
            <span className="absolute top-0.5 right-0.5 min-w-3.5 h-3.5 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center px-0.5">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        {/* เมนูบัญชีบนมือถือ */}
        {session ? (
          <UserProfileBadge compact tone="onLight" className="lg:hidden" />
        ) : (
          <Link to="/auth" className="lg:hidden p-1.5 text-gray-700 hover:text-gray-900 transition-colors shrink-0" aria-label="เข้าสู่ระบบ">
            <LogIn size={20} />
          </Link>
        )}
      </div>
    </header>
  )
}
