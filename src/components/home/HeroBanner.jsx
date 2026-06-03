import { useRef, useState, useCallback } from 'react'
import { useTenant } from '../../contexts/TenantContext'
import { ArrowRight, CalendarDays, Phone } from 'lucide-react'
import oneStopHeader from '../../assets/E service gif2.gif'

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
      <div className="flex gap-2">
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
          className="flex snap-x snap-mandatory overflow-x-scroll gap-3"
          style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
        >
          {/* Slide 1 — ยื่นคำร้อง */}
          <a href="/complaint" className="snap-start shrink-0 rounded-2xl overflow-hidden shadow-md block cursor-pointer transition-transform active:scale-[0.98]"
               style={{ width: `${SLIDE_W * 100}%`, background: `linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)` }}>
            <img src={oneStopHeader} alt="One Stop Service"
                 className="w-full object-cover max-h-52" />
            <div className="px-5 py-4">
              <h2 className="text-white text-lg font-bold leading-snug mb-1">
                สะดวก รวดเร็ว ตลอด 24 ชั่วโมง
              </h2>
              <p className="text-white/80 text-xs leading-relaxed mb-4">
                ยื่นคำร้อง ติดตามสถานะ และรับบริการจาก{tenant?.name}
                ได้ทุกที่ทุกเวลา ไม่ต้องเดินทางมาที่สำนักงาน
              </p>
              <div className="inline-flex items-center gap-2 bg-white font-semibold text-sm px-5 py-2.5 rounded-xl shadow"
                 style={{ color: primaryColor }}>
                ยื่นคำร้องเลย <ArrowRight size={16} />
              </div>
            </div>
          </a>

          {/* Slide 2 — ปฏิทินกิจกรรม */}
          <a href="/events" className="snap-start shrink-0 rounded-2xl overflow-hidden shadow-md flex flex-col p-6 cursor-pointer transition-transform active:scale-[0.98]"
               style={{ width: `${SLIDE_W * 100}%`, background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}>
            <CalendarDays size={40} className="text-white/90 mb-4" />
            <h2 className="text-white text-xl font-bold leading-snug mb-2">
              ปฏิทินกิจกรรม
            </h2>
            <p className="text-white/80 text-sm leading-relaxed flex-1">
              ติดตามกิจกรรม งานประชุม และงานสำคัญของ{tenant?.name || 'เทศบาล'}ได้ในที่เดียว
            </p>
            <div className="mt-5 self-start inline-flex items-center gap-2 bg-white font-semibold text-sm px-5 py-2.5 rounded-xl shadow"
               style={{ color: '#d97706' }}>
              ดูกิจกรรมทั้งหมด <ArrowRight size={16} />
            </div>
          </a>

          {/* Slide 3 — สายด่วน */}
          <a href="/emergency" className="snap-start shrink-0 rounded-2xl overflow-hidden shadow-md flex flex-col p-6 cursor-pointer transition-transform active:scale-[0.98]"
               style={{ width: `${SLIDE_W * 100}%`, background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' }}>
            <Phone size={40} className="text-white/90 mb-4" />
            <h2 className="text-white text-xl font-bold leading-snug mb-2">
              สายด่วนฉุกเฉิน
            </h2>
            <p className="text-white/80 text-sm leading-relaxed flex-1">
              รวมเบอร์โทรศัพท์สายด่วนที่สำคัญ เพื่อให้คุณสามารถติดต่อหน่วยงานช่วยเหลือได้ทันท่วงทีในยามฉุกเฉินตลอด 24 ชั่วโมง
            </p>
            <div className="mt-5 self-start inline-flex items-center gap-2 bg-white font-semibold text-sm px-5 py-2.5 rounded-xl shadow"
               style={{ color: '#dc2626' }}>
              ดูสายด่วนทั้งหมด <ArrowRight size={16} />
            </div>
          </a>

          {/* trailing spacer */}
          <div className="shrink-0" style={{ width: `${(1 - SLIDE_W) * 100}%` }} />
        </div>
      </div>
    </div>
  )
}
