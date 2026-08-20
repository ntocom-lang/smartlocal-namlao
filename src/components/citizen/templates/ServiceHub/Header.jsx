import { Link, useNavigate } from 'react-router-dom'
import { Bell, User, LogIn, LayoutDashboard, Briefcase } from 'lucide-react'
import { useTenant } from '../../../../contexts/TenantContext'
import { useAuth } from '../../../../contexts/AuthContext'
import { useNotifications } from '../../../../contexts/NotificationsContext'

export default function ServiceHubHeader() {
  const { tenant } = useTenant()
  const { session, role, avatarUrl } = useAuth()
  const { unreadCount } = useNotifications()
  const navigate = useNavigate()
  const isAdmin = role === 'admin' || role === 'superadmin'

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

        {isAdmin && (
          <Link to="/admin" className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white/70 text-gray-800 hover:bg-white transition-colors">
            <LayoutDashboard size={13} /> แผงควบคุม Admin
          </Link>
        )}
        {session && (role === 'staff' || role === 'officer' || isAdmin) && (
          <Link to="/staff" className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white/70 text-gray-800 hover:bg-white transition-colors">
            <Briefcase size={13} /> สำหรับเจ้าหน้าที่
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

        {session ? (
          <Link to="/profile" className="shrink-0">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover border-2 border-white/80" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-white/70 border-2 border-white/80 flex items-center justify-center text-gray-700">
                <User size={16} />
              </div>
            )}
          </Link>
        ) : (
          <Link to="/auth" className="p-1.5 text-gray-700 hover:text-gray-900 transition-colors shrink-0" aria-label="เข้าสู่ระบบ">
            <LogIn size={20} />
          </Link>
        )}
      </div>
    </header>
  )
}
