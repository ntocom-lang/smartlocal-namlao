import { useNavigate } from 'react-router-dom'
import { LayoutDashboard, Briefcase, Star, MapPin } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'

export default function ShortcutBand() {
  const navigate = useNavigate()
  const { role } = useAuth()

  const isAdmin = ['admin', 'superadmin', 'officer', 'viewer'].includes(role)
  const isStaff = ['staff', 'technician', 'council'].includes(role)

  const items = [
    isAdmin && {
      label: 'Admin',
      Icon: LayoutDashboard,
      color: '#1d4ed8',
      action: () => navigate('/admin'),
    },
    (isStaff || isAdmin) && {
      label: 'Staff',
      Icon: Briefcase,
      color: '#0369a1',
      action: () => navigate('/staff'),
    },
    {
      label: 'ประเมิน',
      Icon: Star,
      color: '#d97706',
      action: () => navigate('/satisfaction'),
    },
    {
      label: 'แผนที่',
      Icon: MapPin,
      color: '#059669',
      action: () => navigate('/map'),
    },
  ].filter(Boolean)

  return (
    <div className="rounded-2xl overflow-hidden shadow-xl relative"
         style={{ background: 'linear-gradient(135deg, #0369a1 0%, #0ea5e9 50%, #7dd3fc 100%)' }}>
      {/* decorative glows */}
      <div className="absolute -top-6 -right-6 w-32 h-32 rounded-full pointer-events-none"
           style={{ background: 'radial-gradient(circle, rgba(186,230,253,0.5) 0%, transparent 70%)' }} />
      <div className="absolute -bottom-8 -left-4 w-36 h-36 rounded-full pointer-events-none"
           style={{ background: 'radial-gradient(circle, rgba(14,165,233,0.35) 0%, transparent 70%)' }} />

      <div className="relative z-10 px-4 py-3 flex items-center gap-4">
        <div className="flex gap-3 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {items.map(({ label, Icon, action }) => (
            <button key={label} onClick={action}
                    className="flex flex-col items-center gap-1 shrink-0 active:scale-95 transition-transform">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-sm"
                   style={{ background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.35)' }}>
                <Icon size={18} className="text-white" />
              </div>
              <p className="text-white/80 text-[9px] font-semibold text-center w-12 leading-tight">{label}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
