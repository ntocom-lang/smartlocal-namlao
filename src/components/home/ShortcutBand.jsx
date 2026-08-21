import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import SmartCityBanner from './SmartCityBanner'

function IconBox({ item, sizeCls, iconSizeMd }) {
  const bg = item.bgColor ?? 'rgba(255,255,255,0.92)'
  const border = item.bgColor ? 'none' : `1.5px solid ${item.color}55`
  return (
    <div className={`${sizeCls} flex items-center justify-center overflow-hidden`}
         style={{ backgroundColor: bg, border, boxShadow: '0 2px 8px rgba(0,0,0,0.15)', borderRadius: 'var(--radius-btn, 1rem)' }}>
      {item.render
        ? item.render(iconSizeMd)
        : item.emoji
        ? <span className="leading-none select-none" style={{ fontSize: iconSizeMd }}>{item.emoji}</span>
        : null}
    </div>
  )
}

export default function ShortcutBand() {
  const navigate = useNavigate()
  const { role } = useAuth()

  const isAdmin = ['admin', 'superadmin', 'viewer'].includes(role)
  const isStaff = ['staff', 'officer', 'technician', 'council'].includes(role)

  const items = [
    {
      label: 'ศูนย์ข้อมูล',
      emoji: '📊',
      color: '#06b6d4',
      action: () => navigate('/data-center'),
    },
    isAdmin && {
      label: 'Admin',
      emoji: '🛡️',
      color: '#7c3aed',
      action: () => navigate('/admin'),
    },
    (isStaff || isAdmin) && {
      label: 'เจ้าหน้าที่',
      emoji: '💼',
      color: '#2563eb',
      action: () => navigate('/staff'),
    },
    {
      label: 'ประเมิน',
      emoji: '⭐',
      color: '#d97706',
      action: () => navigate('/satisfaction'),
    },
  ].filter(Boolean)

  return (
    <div className="space-y-3">
      {/* 📊 ศูนย์ข้อมูลดิจิทัล / GIS Banner */}
      <SmartCityBanner />

      <div className="rounded-2xl overflow-hidden shadow-xl relative"
           style={{ background: 'linear-gradient(135deg, #0369a1 0%, #0ea5e9 50%, #7dd3fc 100%)' }}>
        <div className="absolute -top-6 -right-6 w-32 h-32 rounded-full pointer-events-none"
             style={{ background: 'radial-gradient(circle, rgba(186,230,253,0.5) 0%, transparent 70%)' }} />
        <div className="absolute -bottom-8 -left-4 w-36 h-36 rounded-full pointer-events-none"
             style={{ background: 'radial-gradient(circle, rgba(14,165,233,0.35) 0%, transparent 70%)' }} />

        <div className="relative z-10 px-3 pt-2 pb-2.5">
          <p className="text-white/90 font-bold text-[13px] tracking-widest uppercase mb-1.5">
            🔗 ลิงก์ลัด
          </p>

          {/* Mobile: 4 คอลัมน์ต่อแถว */}
          <div className="md:hidden grid grid-cols-4 gap-y-1.5 gap-x-1">
            {items.map((item) => (
              <button key={item.label} onClick={item.action}
                      className="flex flex-col items-center gap-0.5 active:scale-95 transition-transform">
                <IconBox item={item} sizeCls="w-9 h-9" iconSizeMd="1.1rem" />
                <p className="text-white/90 text-[11px] font-semibold text-center w-full leading-tight drop-shadow line-clamp-1">{item.label}</p>
              </button>
            ))}
          </div>

          {/* Desktop: 1 row */}
          <div className="hidden md:grid gap-1"
               style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
            {items.map((item) => (
              <button key={item.label} onClick={item.action}
                      className="flex flex-col items-center gap-1 p-1.5 rounded-xl hover:bg-white/10 active:scale-95 transition-all">
                <IconBox item={item} sizeCls="w-10 h-10" iconSizeMd="1.25rem" />
                <p className="text-white/90 text-[12px] font-semibold text-center leading-tight drop-shadow">{item.label}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
