import { Link, useLocation } from 'react-router-dom'
import { Home, Newspaper, Search, MapPin, Menu } from 'lucide-react'

export default function BottomNav() {
  const location = useLocation()

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden"
         style={{
           background: 'linear-gradient(180deg, #059669 0%, #064e3b 100%)',
           borderTopLeftRadius: '20px',
           borderTopRightRadius: '20px',
           boxShadow: '0 -4px 10px rgba(0,0,0,0.1)'
         }}>
      {/* Wave overlay background */}
      <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 1440 320\'%3E%3Cpath fill=\'%23ffffff\' fill-opacity=\'1\' d=\'M0,160L48,170.7C96,181,192,203,288,208C384,213,480,203,576,170.7C672,139,768,85,864,80C960,75,1056,117,1152,149.3C1248,181,1344,203,1392,213.3L1440,224L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z\'%3E%3C/path%3E%3C/svg%3E")', backgroundSize: 'cover', backgroundPosition: 'bottom' }}></div>

      <div className="flex justify-around items-end h-[60px] px-2 relative z-10 pb-1.5">
        <Link to="/" className={`flex flex-col items-center gap-1 p-2 ${location.pathname === '/' ? 'text-white drop-shadow-md' : 'text-emerald-200 hover:text-white'}`}>
          <Home size={22} strokeWidth={location.pathname === '/' ? 2.5 : 2} />
          <span className="text-[12px] font-bold tracking-wide">หน้าแรก</span>
        </Link>
        <Link to="/news" className={`flex flex-col items-center gap-1 p-2 ${location.pathname.startsWith('/news') ? 'text-white drop-shadow-md' : 'text-emerald-200 hover:text-white'}`}>
          <Newspaper size={22} strokeWidth={location.pathname.startsWith('/news') ? 2.5 : 2} />
          <span className="text-[12px] font-bold tracking-wide">ข่าว</span>
        </Link>

        {/* Center Teardrop Button */}
        <Link to="/search" className="relative -top-5 flex flex-col items-center justify-center w-16 h-16 shadow-xl transition-transform active:scale-95"
              style={{
                background: 'linear-gradient(135deg, #6ee7b7 0%, #059669 100%)',
                borderRadius: '50% 50% 50% 0',
                transform: 'rotate(-45deg)',
                border: '3px solid rgba(255,255,255,0.3)',
                boxShadow: '0 10px 25px -5px rgba(5, 150, 105, 0.6)'
              }}>
          <div style={{ transform: 'rotate(45deg)' }} className="flex flex-col items-center mt-1">
            <Search size={22} className="text-white drop-shadow-md" strokeWidth={2.5} />
            <span className="text-[11px] text-white font-black mt-0.5 drop-shadow-md">ค้นหา</span>
          </div>
        </Link>

        <a href="https://www.google.com/maps" target="_blank" rel="noopener noreferrer" className="flex flex-col items-center gap-1 p-2 text-emerald-200 hover:text-white">
          <MapPin size={22} strokeWidth={2} />
          <span className="text-[12px] font-bold tracking-wide">ใกล้ฉัน</span>
        </a>
        <Link to="/more" className={`flex flex-col items-center gap-1 p-2 ${location.pathname === '/more' ? 'text-white drop-shadow-md' : 'text-emerald-200 hover:text-white'}`}>
          <Menu size={22} strokeWidth={location.pathname === '/more' ? 2.5 : 2} />
          <span className="text-[12px] font-bold tracking-wide">เมนูอื่น</span>
        </Link>
      </div>
    </div>
  )
}
