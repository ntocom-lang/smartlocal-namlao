import { Link, useNavigate } from 'react-router-dom'
import { Menu, Bell } from 'lucide-react'
import { useTenant } from '../../../../contexts/TenantContext'
import { useNotifications } from '../../../../contexts/NotificationsContext'

export default function Header() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const { unreadCount } = useNotifications()

  return (
    <header className="relative w-full text-white overflow-hidden pb-14"
            style={{ 
              background: 'linear-gradient(180deg, #0ea5e9 0%, #005ce6 100%)',
            }}>
      {/* Background illustration for the header */}
      <div className="absolute inset-0 opacity-40 pointer-events-none" style={{ backgroundImage: 'url("https://images.unsplash.com/photo-1542259009477-d625272157b7?auto=format&fit=crop&q=80&w=1000")', backgroundSize: 'cover', backgroundPosition: 'center' }}></div>
      <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-[#004080] to-transparent pointer-events-none"></div>
      
      <div className="relative z-10 px-4 pt-3 pb-2 flex justify-between items-center max-w-6xl mx-auto">
        <button className="p-2 text-white/90 hover:text-white transition-colors">
          <Menu size={28} />
        </button>
        
        <Link to="/" className="flex flex-col items-center">
          <div className="flex items-center gap-2">
            {tenant?.logo_url ? (
              <img src={tenant.logo_url} alt="Logo" className="w-12 h-12 rounded-full bg-white/20 p-0.5 border-2 border-white/40 shadow-md" />
            ) : (
              <div className="w-12 h-12 rounded-full bg-white/20 border-2 border-white/60 flex items-center justify-center font-bold shadow-md text-xl">
                {tenant?.name?.[0] ?? '?'}
              </div>
            )}
          </div>
        </Link>
        
        <button onClick={() => navigate('/notifications')} className="relative p-2 text-white/90 hover:text-white transition-colors">
          <Bell size={26} />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 min-w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 border border-white shadow-sm">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-6 mt-4 flex justify-between items-end">
        <div className="flex-1 pb-2">
          <h1 className="text-2xl md:text-3xl font-black drop-shadow-md tracking-tight">{tenant?.name}</h1>
          <p className="text-sm md:text-base font-bold drop-shadow-md mt-0.5">จังหวัดเพชรบูรณ์</p>
          <div className="mt-4 bg-gradient-to-r from-yellow-400 to-yellow-500 text-blue-900 px-4 py-2 rounded-xl text-sm font-black shadow-lg inline-block border-2 border-yellow-300">
            วันนี้ให้ น้องไดโน ช่วยอะไรดีครับ ?
          </div>
        </div>
        <div className="w-28 h-32 shrink-0 mr-2 drop-shadow-2xl relative animate-bounce" style={{ animationDuration: '3s' }}>
            <img src="https://cdn3d.iconscout.com/3d/premium/thumb/dinosaur-4996120-4159702.png" alt="Mascot" className="w-full h-full object-contain" />
        </div>
      </div>
    </header>
  )
}
