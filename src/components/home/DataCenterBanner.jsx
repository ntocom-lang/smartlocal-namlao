import { useNavigate } from 'react-router-dom'
import { Database, ChevronRight, Sparkles, MapPin, BarChart2 } from 'lucide-react'

export default function DataCenterBanner() {
  const navigate = useNavigate()

  return (
    <div
      onClick={() => navigate('/data-center')}
      className="w-full rounded-2xl p-3 md:p-4 cursor-pointer relative overflow-hidden group shadow-lg hover:shadow-cyan-500/20 border border-cyan-400/40 transition-all duration-300 active:scale-[0.98]"
      style={{
        background: 'linear-gradient(135deg, #090d16 0%, #0f172a 40%, #1e1b4b 75%, #312e81 100%)',
      }}
    >
      {/* Background Animated Ambient Lights */}
      <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-cyan-500/20 blur-xl pointer-events-none group-hover:bg-cyan-400/30 transition-all duration-500" />
      <div className="absolute -bottom-10 -left-10 w-32 h-32 rounded-full bg-indigo-500/20 blur-xl pointer-events-none" />

      {/* Shimmer Light Reflection Sweep */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-all duration-1000 ease-in-out pointer-events-none" />

      <div className="relative z-10 flex items-center justify-between gap-3">
        {/* Left Icon Box with Cyan Glow */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative shrink-0">
            <div className="w-11 h-11 md:w-12 md:h-12 rounded-xl bg-gradient-to-br from-cyan-400 via-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-cyan-500/40 group-hover:scale-105 transition-transform duration-300">
              <Database size={22} className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]" />
            </div>
            {/* Glowing dot badge */}
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-400 border border-slate-900" />
            </span>
          </div>

          {/* Text Content */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 tracking-wider uppercase shrink-0">
                <Sparkles size={9} className="text-cyan-300 animate-spin-slow" /> OPEN DATA & GIS
              </span>
            </div>
            <h3 className="text-white font-bold text-sm md:text-base leading-tight truncate flex items-center gap-1.5 drop-shadow-sm">
              ศูนย์ข้อมูลดิจิทัล
            </h3>
            <p className="text-cyan-100/70 text-[11px] md:text-xs truncate mt-0.5 flex items-center gap-2">
              <span className="inline-flex items-center gap-0.5"><MapPin size={10} className="text-cyan-400" /> แผนที่ GIS</span>
              <span className="inline-flex items-center gap-0.5"><BarChart2 size={10} className="text-cyan-400" /> สถิติเปิด</span>
            </p>
          </div>
        </div>

        {/* Right CTA Button */}
        <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 text-slate-950 font-bold text-xs shadow-md shadow-cyan-400/25 group-hover:from-cyan-300 group-hover:to-blue-400 transition-all shrink-0">
          <span>เข้าชม</span>
          <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
        </div>
      </div>
    </div>
  )
}
