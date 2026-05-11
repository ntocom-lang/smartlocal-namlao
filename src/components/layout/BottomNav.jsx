import { useLocation, useNavigate } from 'react-router-dom'
import { Home, Newspaper, Search, Bell, LayoutGrid } from 'lucide-react'
import { useState } from 'react'

const NAV_ITEMS = [
  { label: 'หน้าแรก',   icon: Home,       href: '/' },
  { label: 'ข่าว',      icon: Newspaper,  href: '/news' },
  { label: 'ค้นหา',     icon: Search,     href: '/request' },
  { label: 'แจ้งเตือน', icon: Bell,       href: '/status' },
  { label: 'เมนูอื่น',  icon: LayoutGrid, href: null },
]

export default function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const [showMore, setShowMore] = useState(false)

  if (location.pathname.startsWith('/admin')) return null

  return (
    <>
      {/* More menu popup */}
      {showMore && (
        <div className="fixed inset-0 z-40" onClick={() => setShowMore(false)}>
          <div
            className="absolute bottom-20 left-4 right-4 bg-white rounded-2xl shadow-xl border border-gray-100 p-4 grid grid-cols-3 gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            {[
              { label: 'ตรวจสอบสถานะ', href: '/status' },
              { label: 'ยื่นคำร้อง',    href: '/request' },
              { label: 'ติดต่อเรา',     href: '/contact' },
              { label: 'เข้าสู่ระบบ',   href: '/auth' },
            ].map((item) => (
              <button
                key={item.href}
                onClick={() => { navigate(item.href); setShowMore(false) }}
                className="flex flex-col items-center gap-1 py-3 px-2 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <span className="text-xs text-gray-600 font-medium text-center leading-tight">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bottom bar — full width, rounded top */}
      <div
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around px-2 pt-2 pb-4 shadow-[0_-4px_20px_rgba(0,0,0,0.15)]"
        style={{
          background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)',
          borderRadius: '1.5rem 1.5rem 0 0',
        }}
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = item.href && location.pathname === item.href
          return (
            <button
              key={item.label}
              onClick={() => {
                if (item.href) { navigate(item.href); setShowMore(false) }
                else setShowMore((v) => !v)
              }}
              className="flex flex-col items-center gap-1 px-3 py-1 transition-transform active:scale-90"
            >
              <Icon size={18} className={isActive ? 'text-white' : 'text-white/75'} strokeWidth={isActive ? 2.5 : 1.8} />
              <span className={`text-[9px] font-medium ${isActive ? 'text-white' : 'text-white/75'}`}>
                {item.label}
              </span>
            </button>
          )
        })}
      </div>

      {/* Spacer */}
      <div className="md:hidden h-16" />
    </>
  )
}
