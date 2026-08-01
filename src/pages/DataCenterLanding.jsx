import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Users2, MapPin } from 'lucide-react'
import { useTenant } from '../contexts/TenantContext'

// silhouette ตึก/ต้นไม้ ง่ายๆ ด้วย SVG ล้วน ไม่พึ่งไฟล์รูปภายนอก
function CitySkyline() {
  const buildings = [
    { x: 0,   w: 60,  h: 140, c: '#5b8bab' }, { x: 62,  w: 40, h: 100, c: '#6f9db8' },
    { x: 104, w: 55,  h: 170, c: '#4d7c99' }, { x: 161, w: 45, h: 120, c: '#6f9db8' },
    { x: 208, w: 70,  h: 200, c: '#3f6a85' }, { x: 280, w: 40, h: 90,  c: '#6f9db8' },
    { x: 322, w: 55,  h: 150, c: '#5b8bab' }, { x: 379, w: 65, h: 230, c: '#e08a8a' },
    { x: 446, w: 40,  h: 110, c: '#4d7c99' }, { x: 488, w: 60, h: 180, c: '#3f6a85' },
    { x: 550, w: 45,  h: 130, c: '#6f9db8' }, { x: 597, w: 55, h: 160, c: '#5b8bab' },
  ]
  return (
    <svg viewBox="0 0 652 240" preserveAspectRatio="none" className="w-full h-40 sm:h-56" style={{ display: 'block' }}>
      {buildings.map((b, i) => (
        <g key={i}>
          <rect x={b.x} y={240 - b.h} width={b.w} height={b.h} fill={b.c} />
          {Array.from({ length: Math.floor(b.h / 22) }).map((_, r) => (
            <rect key={r} x={b.x + 6} y={240 - b.h + 10 + r * 22} width={b.w - 12} height={4} fill="rgba(255,255,255,0.35)" />
          ))}
        </g>
      ))}
      {[40, 250, 460, 600].map((x, i) => (
        <g key={i} transform={`translate(${x},170)`}>
          <path d="M20 70 L0 30 L14 30 L0 5 L14 5 L20 -15 L26 5 L40 5 L26 30 L40 30 Z" fill="#4a9d5f" />
          <rect x="16" y="65" width="8" height="15" fill="#6b4a2f" />
        </g>
      ))}
      <path d="M0 240 Q 80 200 160 235 T 320 232 T 480 236 T 652 220 L652 240 Z" fill="#7cb87a" opacity="0.9" />
    </svg>
  )
}

export default function DataCenterLanding() {
  const navigate = useNavigate()
  const { tenant } = useTenant()

  return (
    <div className="min-h-screen flex flex-col justify-between overflow-hidden relative"
      style={{ background: 'linear-gradient(180deg, #1e88c7 0%, #2196d8 45%, #4db8e8 100%)' }}>
      <button onClick={() => navigate(-1)} aria-label="ย้อนกลับ"
        className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors border border-white/20 text-white">
        <ArrowLeft size={15} />
      </button>
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-16">
        <div className="w-16 h-16 rounded-full bg-white/15 border-2 border-white/30 flex items-center justify-center mb-5 overflow-hidden">
          {tenant?.logo_url
            ? <img src={tenant.logo_url} alt="โลโก้" className="w-full h-full object-contain p-1.5" />
            : <MapPin size={26} className="text-white" />}
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-wide">
          {tenant?.name ?? 'เทศบาล'} GIS Portal
        </h1>
        <p className="text-white/85 text-sm mt-3 max-w-md">
          ระบบสารสนเทศภูมิศาสตร์เพื่อบูรณาการข้อมูล
        </p>
        <p className="text-white/85 text-sm">
          {tenant?.name ?? ''}
        </p>

        <div className="flex flex-col gap-3 mt-8 w-full max-w-xs">
          <button onClick={() => navigate('/data-center/staff')}
            className="w-full py-3 rounded-xl font-bold text-sm text-white shadow-lg active:scale-95 transition-all"
            style={{ backgroundColor: '#1e293b' }}>
            เข้าสู่ระบบสำหรับเจ้าหน้าที่
          </button>
          <button onClick={() => navigate('/data-center/public')}
            className="w-full py-3 rounded-xl font-bold text-sm text-white shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2"
            style={{ backgroundColor: '#0d9488' }}>
            <Users2 size={16} /> สำหรับประชาชน
          </button>
        </div>
      </div>
      <CitySkyline />
    </div>
  )
}
