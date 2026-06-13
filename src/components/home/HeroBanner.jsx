import { useRef, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useTenant } from '../../contexts/TenantContext'
import { ArrowRight, CalendarDays, Phone } from 'lucide-react'


const SLIDE_W = 0.9
const GAP = 12

const TABS = [
  { label: 'ยื่นคำร้อง' },
  { label: 'ปฏิทินกิจกรรม' },
  { label: 'สายด่วน' },
]

export default function HeroBanner() {
  const { tenant } = useTenant()
  const scrollRef = useRef(null)
  const [active, setActive] = useState(0)

  const scrollTo = useCallback((i) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ left: (el.offsetWidth * SLIDE_W + GAP) * i, behavior: 'smooth' })
    setActive(i)
  }, [])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    setActive(Math.round(el.scrollLeft / (el.offsetWidth * SLIDE_W + GAP)))
  }

  const primaryColor = 'var(--color-primary)'

  return (
    <div className="flex flex-col gap-2">
      {/* Tab selector */}
      <div className="flex md:hidden gap-2">
        {TABS.map((tab, i) => (
          <button
            key={i}
            onClick={() => scrollTo(i)}
            className="flex-1 text-xs font-semibold py-1.5 rounded-lg transition-all duration-200 active:scale-95"
            style={
              i === active
                ? { backgroundColor: primaryColor, color: '#fff' }
                : { backgroundColor: '#f1f5f9', color: '#64748b' }
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Carousel */}
      <div className="overflow-hidden rounded-2xl">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex md:grid md:grid-cols-3 md:grid-rows-2 md:gap-4 md:overflow-visible snap-x snap-mandatory overflow-x-scroll gap-3"
          style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
        >
          {/* Slide 1 — ยื่นคำร้อง */}
          <Link to="/complaint" className="snap-start shrink-0 rounded-2xl overflow-hidden shadow-md cursor-pointer transition-transform active:scale-[0.98] bg-white border border-gray-100 flex flex-col w-[90%] md:w-full md:h-full md:col-span-2 md:row-span-2">
            <div className="bg-white p-5 md:p-8 pb-0 flex items-center justify-center gap-4 md:gap-8 flex-1 min-h-[160px] md:min-h-[250px]">
              {tenant?.logo_url ? (
                <img src={tenant.logo_url} alt="โลโก้หน่วยงาน" className="w-20 h-20 md:w-32 md:h-32 object-contain shrink-0 drop-shadow-md" />
              ) : (
                <div className="w-20 h-20 md:w-32 md:h-32 rounded-full flex items-center justify-center shrink-0 shadow-inner" style={{ backgroundColor: 'var(--color-primary-dark)', color: 'white', fontSize: '2rem', fontWeight: 'bold' }}>
                  {tenant?.name?.[0] ?? '?'}
                </div>
              )}
              <div className="flex flex-col justify-center">
                <h1 className="text-2xl md:text-4xl font-extrabold text-gray-800 tracking-tight leading-tight mb-1 md:mb-2" style={{ color: 'var(--color-primary-dark)' }}>
                  E-Service
                </h1>
                <p className="text-xs md:text-sm text-gray-500 font-medium leading-relaxed">
                  ระบบยื่นคำร้องออนไลน์ ตลอด 24 ชั่วโมง
                </p>
              </div>
            </div>
            <div className="px-5 py-4">
              <div className="flex items-center justify-center gap-2 text-white font-bold text-sm px-5 py-3 rounded-xl shadow-sm transition-opacity hover:opacity-90 w-full"
                 style={{ background: `linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)` }}>
                ยื่นคำร้องเลย <ArrowRight size={18} />
              </div>
            </div>
          </Link>

          {/* Slide 2 — ปฏิทินกิจกรรม */}
          <Link to="/events" className="snap-start shrink-0 rounded-2xl overflow-hidden shadow-md flex flex-col p-5 md:p-6 cursor-pointer transition-transform active:scale-[0.98] w-[90%] md:w-full md:h-full md:col-span-1 md:row-span-1 justify-center"
               style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}>
            <div className="flex items-center gap-3 mb-2 md:mb-3">
               <CalendarDays size={32} className="text-white/90 shrink-0" />
               <h2 className="text-white text-lg md:text-xl font-bold leading-snug">
                 ปฏิทินกิจกรรม
               </h2>
            </div>
            <p className="text-white/80 text-xs md:text-sm leading-relaxed mb-4 md:mb-5 line-clamp-2 md:line-clamp-3">
              ติดตามกิจกรรม งานประชุม และงานสำคัญของ{tenant?.name || 'เทศบาล'}ได้ในที่เดียว
            </p>
            <div className="inline-flex items-center gap-2 bg-white font-semibold text-sm px-4 py-2 md:px-5 md:py-2.5 rounded-xl shadow self-start mt-auto"
               style={{ color: '#d97706' }}>
              ดูกิจกรรมทั้งหมด <ArrowRight size={16} />
            </div>
          </Link>

          {/* Slide 3 — สายด่วน */}
          <Link to="/emergency" className="snap-start shrink-0 rounded-2xl overflow-hidden shadow-md flex flex-col p-5 md:p-6 cursor-pointer transition-transform active:scale-[0.98] w-[90%] md:w-full md:h-full md:col-span-1 md:row-span-1 justify-center"
               style={{ background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' }}>
            <div className="flex items-center gap-3 mb-2 md:mb-3">
               <Phone size={32} className="text-white/90 shrink-0" />
               <h2 className="text-white text-lg md:text-xl font-bold leading-snug">
                 สายด่วนฉุกเฉิน
               </h2>
            </div>
            <p className="text-white/80 text-xs md:text-sm leading-relaxed mb-4 md:mb-5 line-clamp-2 md:line-clamp-3">
              รวมเบอร์โทรศัพท์สายด่วนที่สำคัญ เพื่อให้คุณสามารถติดต่อหน่วยงานช่วยเหลือได้ทันท่วงทีในยามฉุกเฉินตลอด 24 ชั่วโมง
            </p>
            <div className="inline-flex items-center gap-2 bg-white font-semibold text-sm px-4 py-2 md:px-5 md:py-2.5 rounded-xl shadow self-start mt-auto"
               style={{ color: '#dc2626' }}>
              ดูสายด่วนทั้งหมด <ArrowRight size={16} />
            </div>
          </Link>

          {/* trailing spacer */}
          <div className="shrink-0 md:hidden" style={{ width: `${(1 - SLIDE_W) * 100}%` }} />
        </div>
      </div>
    </div>
  )
}
