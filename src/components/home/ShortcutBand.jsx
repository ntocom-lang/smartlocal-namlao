import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

function FacebookSVGIcon({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M16.5 2H14C11.8 2 10 3.8 10 6v2H7v3h3v9h3v-9h2.5l.5-3H13V6c0-.6.4-1 1-1h2.5V2z"
        fill="white"
      />
    </svg>
  )
}

function LineOAIcon({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M8 2 Q1 2 1 9 L1 44 Q1 49 5 52 L28 63 L51 52 Q55 49 55 44 L55 9 Q55 2 48 2 Z"
        fill="white"
      />
      <text x="15" y="46" fontFamily="Arial Black, Arial, sans-serif" fontWeight="900" fontSize="30" fill="#06C755">L</text>
    </svg>
  )
}

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

  const isAdmin = ['admin', 'superadmin', 'officer', 'viewer'].includes(role)
  const isStaff = ['staff', 'technician', 'council'].includes(role)

  const items = [
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
    {
      label: 'แผนที่',
      emoji: '🗺️',
      color: '#059669',
      action: () => navigate('/map'),
    },
    // เอา ยานพาหนะ/เหตุฉุกเฉิน/Line OA/Facebook/เว็บไซต์ ออกไปก่อนตามคำขอ (2026-07-27)
    // ยังไม่ลบ logic ทิ้งทั้งหมด เผื่อเอากลับมาใช้ทีหลัง — แค่ไม่ใส่เข้า items array
  ].filter(Boolean)

  return (
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
  )
}
