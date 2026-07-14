import { useLocation } from 'react-router-dom'
import { useTenant } from '../../contexts/TenantContext'

export default function Footer() {
  const { tenant } = useTenant()
  const location = useLocation()

  if (location.pathname.startsWith('/staff') || location.pathname.startsWith('/admin')) return null

  return (
    <footer className="relative mt-6 text-white overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #0a1628 0%, #0f2a4a 25%, #0d3a6b 50%, #0a2d5c 75%, #0a1628 100%)',
      }}>

      {/* Aurora top bar */}
      <div className="absolute top-0 left-0 right-0 h-0.5"
        style={{ background: 'linear-gradient(90deg, transparent 0%, #38bdf8 20%, #818cf8 40%, #f472b6 55%, #fbbf24 70%, #38bdf8 85%, transparent 100%)', opacity: 0.85 }} />

      {/* Bloom effects */}
      <div className="absolute -top-10 left-1/4 w-64 h-64 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(56,189,248,0.12) 0%, transparent 70%)' }} />
      <div className="absolute -top-6 right-1/3 w-48 h-48 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(129,140,248,0.15) 0%, transparent 70%)' }} />
      <div className="absolute top-0 left-1/2 w-56 h-32 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse, rgba(251,191,36,0.08) 0%, transparent 70%)' }} />

      {/* Star particles */}
      {[
        { top: '20%', left: '8%', size: 2, opacity: 0.6 },
        { top: '60%', left: '15%', size: 1.5, opacity: 0.4 },
        { top: '30%', left: '88%', size: 2, opacity: 0.5 },
        { top: '70%', left: '92%', size: 1.5, opacity: 0.35 },
        { top: '50%', left: '5%', size: 1, opacity: 0.3 },
        { top: '25%', left: '75%', size: 2, opacity: 0.45 },
      ].map((s, i) => (
        <div key={i} className="absolute rounded-full pointer-events-none"
          style={{ top: s.top, left: s.left, width: s.size, height: s.size,
            backgroundColor: '#ffffff', opacity: s.opacity }} />
      ))}

      <div className="relative z-10 max-w-6xl mx-auto px-4 py-5 flex flex-col items-center gap-3">

        {/* Contact Info */}
        <div className="flex flex-col items-center gap-1 text-center mb-2">
          {tenant?.address && (
            <p className="text-[11px] text-white/90 font-medium">
              {tenant?.name} {tenant.address}
            </p>
          )}
          {(tenant?.phone || tenant?.website_url || tenant?.email) && (
            <p className="text-[10px] text-white/60 flex flex-wrap justify-center gap-x-2 gap-y-1">
              {tenant?.phone && <span>โทรศัพท์ / แฟกซ์ {tenant.phone}</span>}
              {tenant?.website_url && <span>เว็บไซต์ : {tenant.website_url.replace(/^https?:\/\//, '')}</span>}
              {tenant?.email && <span>อีเมลกลาง : {tenant.email}</span>}
            </p>
          )}
        </div>

        {/* Copyright */}
        <div className="flex flex-col items-center gap-1">
          <span className="text-xs font-medium" style={{ color: 'rgba(186,230,253,0.8)' }}>
            ©สงวนลิขสิทธิ์ 2026 โดย {tenant?.name}
          </span>
          {tenant?.developer_name && (
            <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {tenant.developer_name}
            </span>
          )}
        </div>
      </div>
    </footer>
  )
}
