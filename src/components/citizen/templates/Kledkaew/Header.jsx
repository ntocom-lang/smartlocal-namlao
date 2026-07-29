import { Link, useNavigate, useLocation } from 'react-router-dom'
import { Bell, User, Home, Newspaper, ClipboardList, LayoutGrid, CalendarDays, Luggage } from 'lucide-react'
import { useTenant } from '../../../../contexts/TenantContext'
import { useNotifications } from '../../../../contexts/NotificationsContext'
import { useAuth } from '../../../../contexts/AuthContext'

const PC_NAV = [
  { href: '/',           label: 'หน้าแรก',     Icon: Home,          exact: true },
  { href: '/news',       label: 'ข่าวสาร',      Icon: Newspaper },
  { href: '/events',     label: 'ปฏิทินกิจกรรม', Icon: CalendarDays },
  { href: '/complaint',  label: 'ร้องเรียน',    Icon: ClipboardList },
  { href: '/tourism',    label: 'ท่องเที่ยว',   Icon: Luggage },
  { href: '/more',       label: 'เมนูทั้งหมด',  Icon: LayoutGrid },
]

export default function Header() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const location = useLocation()
  const { unreadCount } = useNotifications()
  const { session, displayName, avatarUrl } = useAuth()

  const name = tenant?.name || ''
  let prefix = ''
  let mainName = name
  const prefixes = ['องค์การบริหารส่วนตำบล', 'เทศบาลตำบล', 'เทศบาลเมือง', 'เทศบาลนคร', 'องค์การบริหารส่วนจังหวัด']
  for (const p of prefixes) {
    if (name.startsWith(p)) {
      prefix = p
      mainName = name.substring(p.length).trim()
      break
    }
  }

  return (
    <header className="relative w-full text-white overflow-hidden pb-6"
            style={{ 
              background: 'linear-gradient(180deg, #047857 0%, #064e3b 100%)',
            }}>
      {/* Background illustration for the header */}
      <div className="absolute inset-0 opacity-40 pointer-events-none" style={{ backgroundImage: `url("${tenant?.header_image_url || 'https://images.unsplash.com/photo-1511497584788-876760111969?auto=format&fit=crop&q=80&w=1000'}")`, backgroundSize: 'cover', backgroundPosition: 'center' }}></div>
      <div className="absolute bottom-0 left-0 right-0 h-20 bg-linear-to-t from-[#064e3b] via-[#064e3b]/80 to-transparent pointer-events-none"></div>
      
      <div className="relative z-10 px-4 pt-3 pb-1 flex justify-between items-center max-w-6xl mx-auto">
        <button onClick={() => navigate('/profile')} className="p-1.5 text-white hover:bg-white/10 rounded-full transition-colors -ml-1">
          {session ? (
            <div className="w-8 h-8 rounded-full bg-emerald-700/50 border border-white/60 flex items-center justify-center font-bold text-white shadow-sm overflow-hidden">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <span className="text-sm">{displayName?.[0] ?? <User size={18} />}</span>
              )}
            </div>
          ) : (
            <div className="w-8 h-8 rounded-full bg-emerald-700/50 border border-white/60 flex items-center justify-center shadow-sm text-white">
              <User size={18} />
            </div>
          )}
        </button>
        
        <Link to="/" className="flex flex-col items-center">
          <div className="flex items-center gap-2">
            {tenant?.logo_url ? (
              <img src={tenant.logo_url} alt="Logo" className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-white/20 p-0.5 border-2 border-white/40 shadow-md" />
            ) : (
              <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-white/20 border-2 border-white/60 flex items-center justify-center font-bold shadow-md text-2xl md:text-3xl">
                {name?.[0] ?? '?'}
              </div>
            )}
          </div>
        </Link>
        
        <button onClick={() => navigate('/notifications')} className="relative p-2 text-white/90 hover:text-white transition-colors -mr-2">
          <Bell size={24} />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 min-w-4 h-4 bg-amber-400 text-amber-900 text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 border border-white shadow-sm">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-4 mt-2 flex flex-col items-center text-center">
        {/* Title */}
        <div className="drop-shadow-lg flex items-center justify-center flex-wrap gap-x-1.5 leading-tight">
          {prefix ? (
            <>
              <span className="text-xl md:text-2xl font-black text-white tracking-tight">{prefix}</span>
              <span className="text-xl md:text-2xl font-black text-amber-400 tracking-tight">{mainName}</span>
            </>
          ) : (
            <h1 className="text-xl md:text-2xl font-black text-white tracking-tight leading-tight text-balance">
              {name}
            </h1>
          )}
        </div>

        {/* Province */}
        {tenant?.province && (
          <p className="text-xs md:text-sm font-bold text-white drop-shadow-md mt-0.5 tracking-wide">
            {tenant.province.startsWith('จังหวัด') ? tenant.province : `จังหวัด${tenant.province}`}
          </p>
        )}

        {/* Banner and Mascot */}
        <div className="relative mt-3 mb-1 flex justify-center">
          <div className="bg-linear-to-r from-yellow-400 to-yellow-500 text-blue-900 px-6 py-1.5 rounded-full text-xs md:text-sm font-black shadow-lg border-2 border-yellow-300 relative z-10">
            วันนี้ให้ช่วยอะไรดีครับ ?
          </div>
        </div>
      </div>

      {/* PC-only nav strip */}
      <nav className="hidden md:flex items-center justify-center gap-1 relative z-10 pb-3 px-4 max-w-6xl mx-auto">
        {PC_NAV.map(({ href, label, Icon, exact }) => {
          const active = exact ? location.pathname === href : location.pathname.startsWith(href)
          return (
            <Link key={href} to={href}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-bold transition-all"
              style={active
                ? { backgroundColor: 'rgba(255,255,255,0.25)', color: '#fff' }
                : { color: 'rgba(255,255,255,0.7)' }}>
              <Icon size={15} />
              {label}
            </Link>
          )
        })}
      </nav>
    </header>
  )
}
