import { useNavigate } from 'react-router-dom'
import { useTenant } from '../../contexts/TenantContext'
import { MapPinned, ChevronRight } from 'lucide-react'

// แบนเนอร์ "[ชื่อ อปท.] SMART CITY" — ภาพตึกเป็น SVG ที่วาดเองล้วนๆ (ไม่ใช้ภาพจากที่ไหน ไม่มีปัญหาลิขสิทธิ์)
// เนื้อหา/ลิงก์ทั้งหมดชี้ไปที่ระบบ GIS ของเราเองที่มีจริง (/data-center) ไม่มีเมนูหลอกที่ไม่มีระบบรองรับ

// วาดตึกแบบ isometric 3 หน้า (หน้าตรง/ด้านข้าง/หลังคา) ให้ดูมีมิติ 3D แทนสี่เหลี่ยมแบนๆ เดิม
const DEPTH = 9 // ระยะเยื้องของด้านข้าง/หลังคา ยิ่งมากยิ่งดูหนา
const BASE_Y = 92
function building(x, w, h) {
  const topY = BASE_Y - h
  return {
    front: `${x},${BASE_Y} ${x + w},${BASE_Y} ${x + w},${topY} ${x},${topY}`,
    roof: `${x},${topY} ${x + w},${topY} ${x + w + DEPTH},${topY - DEPTH} ${x + DEPTH},${topY - DEPTH}`,
    side: `${x + w},${topY} ${x + w + DEPTH},${topY - DEPTH} ${x + w + DEPTH},${BASE_Y - DEPTH} ${x + w},${BASE_Y}`,
  }
}
const PALETTES = [
  { front: '#1e3a8a', roof: '#4f74e8', side: '#0e1f52' },
  { front: '#1d4ed8', roof: '#6690f2', side: '#12309e' },
  { front: '#2563eb', roof: '#7ba2f7', side: '#173f9e' },
]
const BUILDINGS = [
  { x: 2,   w: 26, h: 40 }, { x: 30,  w: 20, h: 62 }, { x: 52,  w: 24, h: 34 },
  { x: 78,  w: 22, h: 74 }, { x: 102, w: 18, h: 50 }, { x: 122, w: 26, h: 30 },
  { x: 150, w: 22, h: 80 }, { x: 174, w: 20, h: 46 }, { x: 196, w: 24, h: 64 },
  { x: 222, w: 18, h: 38 }, { x: 242, w: 26, h: 70 }, { x: 270, w: 20, h: 48 },
  { x: 292, w: 24, h: 58 }, { x: 318, w: 18, h: 36 },
].map((b, i) => ({ ...b, ...building(b.x, b.w, b.h), palette: PALETTES[i % PALETTES.length] }))

export default function SmartCityBanner() {
  const { tenant } = useTenant()
  const navigate = useNavigate()

  return (
    <button onClick={() => navigate('/data-center')}
      className="w-full text-left relative rounded-2xl overflow-hidden shadow-lg active:scale-[0.98] transition-transform"
      style={{ background: 'linear-gradient(180deg, #0b1a3a 0%, #14285c 55%, #1c3a7a 100%)' }}>
      {/* เส้นกริดพื้นหลังแบบ tech/GIS */}
      <div className="absolute inset-0 opacity-20"
        style={{ backgroundImage: 'linear-gradient(rgba(96,165,250,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(96,165,250,0.5) 1px, transparent 1px)', backgroundSize: '24px 24px' }} />

      {/* skyline SVG วาดเอง แบบ isometric 3 หน้า ให้ดูเป็นตึก 3 มิติ */}
      <svg viewBox="0 0 400 100" preserveAspectRatio="none" className="absolute bottom-0 left-0 w-full h-[76px] sm:h-[100px]" style={{ opacity: 0.9 }}>
        {BUILDINGS.map((b, i) => (
          <g key={i}>
            <polygon points={b.side} fill={b.palette.side} />
            <polygon points={b.front} fill={b.palette.front} />
            <polygon points={b.roof} fill={b.palette.roof} />
          </g>
        ))}
      </svg>

      <div className="relative z-10 px-4 pt-4 pb-3 sm:px-6 sm:pt-6 sm:pb-4">
        <p className="text-cyan-300/80 text-[10px] sm:text-xs font-bold tracking-widest uppercase mb-1">
          ระบบสารสนเทศภูมิศาสตร์เพื่อประชาชน
        </p>
        <h3 className="text-white font-black text-lg sm:text-2xl leading-tight mb-0.5">
          {tenant?.name?.replace(/^(องค์การบริหารส่วนตำบล|เทศบาลตำบล|เทศบาลเมือง|เทศบาลนคร|เทศบาล)/, '').trim() || tenant?.name}
        </h3>
        <p className="text-cyan-100 font-extrabold text-2xl sm:text-3xl tracking-wide mb-2" style={{ letterSpacing: '0.08em' }}>
          SMART CITY
        </p>
        <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-bold text-white/90">
          <MapPinned size={13} className="text-cyan-300" />
          <span>ดูแผนที่ GIS &amp; ข้อมูลเปิดของ อปท.</span>
          <ChevronRight size={13} />
        </div>
      </div>
    </button>
  )
}
