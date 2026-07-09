import { useNavigate } from 'react-router-dom'
import { LayoutDashboard, Briefcase, Star, MapPin, Siren, Globe, MessageCircle, Car } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useTenant } from '../../contexts/TenantContext'

function FacebookIcon({ size = 18, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         className={className}>
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  )
}

export default function ShortcutBand() {
  const navigate = useNavigate()
  const { role } = useAuth()
  const { tenant } = useTenant()

  const isAdmin = ['admin', 'superadmin', 'officer', 'viewer'].includes(role)
  const isStaff = ['staff', 'technician', 'council'].includes(role)

  const items = [
    isAdmin && {
      label: 'Admin',
      Icon: LayoutDashboard,
      action: () => navigate('/admin'),
    },
    (isStaff || isAdmin) && {
      label: 'Staff',
      Icon: Briefcase,
      action: () => navigate('/staff'),
    },
    {
      label: 'ประเมิน',
      Icon: Star,
      action: () => navigate('/satisfaction'),
    },
    {
      label: 'แผนที่',
      Icon: MapPin,
      action: () => navigate('/map'),
    },
    (isStaff || isAdmin) && {
      label: 'ยานพาหนะ',
      Icon: Car,
      action: () => navigate('/fleet'),
    },
    {
      label: 'เหตุฉุกเฉิน',
      Icon: Siren,
      action: () => navigate('/emergency'),
    },
    tenant?.line_oa_url && {
      label: 'Line OA',
      Icon: MessageCircle,
      action: () => window.open(tenant.line_oa_url, '_blank', 'noopener,noreferrer'),
    },
    tenant?.facebook_url && {
      label: 'Facebook',
      Icon: FacebookIcon,
      action: () => window.open(tenant.facebook_url, '_blank', 'noopener,noreferrer'),
    },
    tenant?.website_url && {
      label: 'เว็บไซต์',
      Icon: Globe,
      action: () => window.open(tenant.website_url, '_blank', 'noopener,noreferrer'),
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

      <div className="relative z-10 px-4 pt-3 pb-3">
        <p className="text-white/90 font-bold text-[11px] tracking-widest uppercase mb-2.5">
          🔗 ลิงก์ลัด
        </p>

        {/* Mobile: 2 rows */}
        <div className="md:hidden grid grid-rows-2 grid-flow-col gap-x-1 gap-y-2"
             style={{ gridTemplateColumns: `repeat(${Math.ceil(items.length / 2)}, 1fr)` }}>
          {items.map(({ label, Icon, action }) => (
            <button key={label} onClick={action}
                    className="flex flex-col items-center gap-1 active:scale-95 transition-transform">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-sm"
                   style={{ background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.35)' }}>
                <Icon size={18} className="text-white" />
              </div>
              <p className="text-white/80 text-[9px] font-semibold text-center w-full leading-tight">{label}</p>
            </button>
          ))}
        </div>

        {/* Desktop: 1 row */}
        <div className="hidden md:grid gap-1"
             style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
          {items.map(({ label, Icon, action }) => (
            <button key={label} onClick={action}
                    className="flex flex-col items-center gap-1 p-1.5 rounded-xl hover:bg-white/10 active:scale-95 transition-all">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shadow-sm"
                   style={{ background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.35)' }}>
                <Icon size={15} className="text-white" />
              </div>
              <p className="text-white/80 text-[9px] font-semibold text-center leading-tight">{label}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
