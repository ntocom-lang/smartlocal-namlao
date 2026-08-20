import { useNavigate } from 'react-router-dom'
import { Database, ChevronRight, Sparkles, MapPin, BarChart2 } from 'lucide-react'

// variant="dark" (ค่าเริ่มต้น) = โทนน้ำเงินคราม/คราม เดิม ใช้กับ 6 ธีมเดิมทั้งหมดไม่เปลี่ยนแปลง
// variant="violet" = โทนม่วง-ฟูเชีย ใช้เฉพาะ thungkaew-Theme (ServiceHub) เพราะหน้านั้นมีองค์ประกอบสีน้ำเงิน/
// คราม (e-Service, สถิติร้องเรียน) เยอะอยู่แล้ว ถ้าใช้โทนเดิมจะกลืนกันจนแยกไม่ออกว่าเป็นคนละส่วน
const VARIANTS = {
  dark: {
    bg: 'linear-gradient(135deg, #090d16 0%, #0f172a 40%, #1e1b4b 75%, #312e81 100%)',
    border: 'border-cyan-400/40', hoverShadow: 'hover:shadow-cyan-500/20',
    glow1: 'bg-cyan-500/20 group-hover:bg-cyan-400/30', glow2: 'bg-indigo-500/20',
    iconBox: 'from-cyan-400 via-blue-500 to-indigo-600', iconShadow: 'shadow-cyan-500/40',
    dot: 'bg-cyan-400', badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-400/40',
    badgeIcon: 'text-cyan-300', subtext: 'text-cyan-100/70', subIcon: 'text-cyan-400',
    cta: 'from-cyan-400 to-blue-500 group-hover:from-cyan-300 group-hover:to-blue-400', ctaShadow: 'shadow-cyan-400/25',
  },
  violet: {
    bg: 'linear-gradient(135deg, #1e0f36 0%, #3b0764 40%, #581c87 75%, #86198f 100%)',
    border: 'border-fuchsia-400/40', hoverShadow: 'hover:shadow-fuchsia-500/20',
    glow1: 'bg-fuchsia-500/20 group-hover:bg-fuchsia-400/30', glow2: 'bg-purple-500/20',
    iconBox: 'from-fuchsia-400 via-purple-500 to-violet-600', iconShadow: 'shadow-fuchsia-500/40',
    dot: 'bg-fuchsia-400', badge: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-400/40',
    badgeIcon: 'text-fuchsia-300', subtext: 'text-fuchsia-100/70', subIcon: 'text-fuchsia-400',
    cta: 'from-fuchsia-400 to-purple-500 group-hover:from-fuchsia-300 group-hover:to-purple-400', ctaShadow: 'shadow-fuchsia-400/25',
  },
}

export default function DataCenterBanner({ variant = 'dark' }) {
  const navigate = useNavigate()
  const v = VARIANTS[variant] ?? VARIANTS.dark

  return (
    <div
      onClick={() => navigate('/data-center')}
      className={`w-full rounded-2xl p-3 md:p-4 cursor-pointer relative overflow-hidden group shadow-lg border transition-all duration-300 active:scale-[0.98] ${v.border} ${v.hoverShadow}`}
      style={{ background: v.bg }}
    >
      {/* Background Animated Ambient Lights */}
      <div className={`absolute -top-10 -right-10 w-32 h-32 rounded-full blur-xl pointer-events-none transition-all duration-500 ${v.glow1}`} />
      <div className={`absolute -bottom-10 -left-10 w-32 h-32 rounded-full blur-xl pointer-events-none ${v.glow2}`} />

      {/* Shimmer Light Reflection Sweep */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-all duration-1000 ease-in-out pointer-events-none" />

      <div className="relative z-10 flex items-center justify-between gap-3">
        {/* Left Icon Box with Glow */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative shrink-0">
            <div className={`w-11 h-11 md:w-12 md:h-12 rounded-xl bg-gradient-to-br flex items-center justify-center text-white shadow-md group-hover:scale-105 transition-transform duration-300 ${v.iconBox} ${v.iconShadow}`}>
              <Database size={22} className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]" />
            </div>
            {/* Glowing dot badge */}
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${v.dot}`} />
              <span className={`relative inline-flex rounded-full h-3 w-3 border border-slate-900 ${v.dot}`} />
            </span>
          </div>

          {/* Text Content */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold border tracking-wider uppercase shrink-0 ${v.badge}`}>
                <Sparkles size={9} className={`animate-spin-slow ${v.badgeIcon}`} /> OPEN DATA & GIS
              </span>
            </div>
            <h3 className="text-white font-bold text-sm md:text-base leading-tight truncate flex items-center gap-1.5 drop-shadow-sm">
              ศูนย์ข้อมูลดิจิทัล
            </h3>
            <p className={`text-[11px] md:text-xs truncate mt-0.5 flex items-center gap-2 ${v.subtext}`}>
              <span className="inline-flex items-center gap-0.5"><MapPin size={10} className={v.subIcon} /> แผนที่ GIS</span>
              <span className="inline-flex items-center gap-0.5"><BarChart2 size={10} className={v.subIcon} /> สถิติเปิด</span>
            </p>
          </div>
        </div>

        {/* Right CTA Button */}
        <div className={`flex items-center gap-1 px-3 py-1.5 rounded-full bg-gradient-to-r text-slate-950 font-bold text-xs shadow-md transition-all shrink-0 ${v.cta} ${v.ctaShadow}`}>
          <span>เข้าชม</span>
          <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
        </div>
      </div>
    </div>
  )
}
