import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTenant } from '../../../../contexts/TenantContext'
import { useAuth } from '../../../../contexts/AuthContext'
import { supabase } from '../../../../lib/supabase'
import PostsHighlight from '../../../../components/home/PostsHighlight'
import TourismSection from '../../../../components/home/TourismSection'
import BannerSlider from '../../../../components/home/BannerSlider'
import { Info, ChevronRight, Briefcase, Megaphone, LayoutDashboard, Wrench, Newspaper, CalendarDays, ChevronLeft, Home, User, FileCheck, Landmark, Trash2, FileText, Lightbulb, Hospital, Route, Bug, Droplets, Map } from 'lucide-react'
import WeatherWidget from '../../../../components/home/WeatherWidget'
import StaffSection from '../../../../components/home/StaffSection'
import ComplaintBand from '../../../../components/home/ComplaintBand'
import ShortcutBand from '../../../../components/home/ShortcutBand'

const MARQUEE_TEXT = 'เรียน และรับบริการต่างๆได้อย่างสะดวก รวดเร็ว และเข้าถึงได้ทุกที่ทุกเวลา บริการประชาชนออนไลน์ ตลอด 24 ชั่วโมง เพื่อใช้เป็นช่องทางในการติดตามข่าวสาร แจ้งเรื่องร้องเรียน และรับบริการต่างๆได้อย่างสะดวก รวดเร็ว และเข้าถึงได้ทุกที่ทุกเวลา'

const marqueeStyle = `
@keyframes marquee {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}`

const DAY_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']
const AUD_COLOR = {
  public: '#10b981', staff: '#3b82f6', management: '#8b5cf6', council: '#f59e0b',
}
const AUD_LABEL = { public: 'ประชาชน', staff: 'เจ้าหน้าที่', management: 'ผู้บริหาร', council: 'สภาเทศบาล' }

// ── section order per layout ──────────────────────────────────────────
const LAYOUT_ORDER = {
  classic:       ['banner', 'staff', 'eservice', 'marquee', 'complaint', 'shortcut'],
  modern:        ['shortcut', 'banner', 'staff', 'eservice', 'complaint'],
  service_first: ['eservice', 'complaint', 'banner', 'staff', 'shortcut'],
  news_first:    ['banner', 'staff', 'complaint', 'shortcut', 'eservice'],
}
const LAYOUT_RIGHT = {
  classic:       ['weather', 'news', 'activities', 'calendar'],
  modern:        ['calendar', 'news', 'weather'],
  service_first: ['weather', 'calendar', 'activities'],
  news_first:    ['news', 'activities', 'calendar', 'weather'],
}

const BASE_DOC_TYPES = [
  { value: 'waste_collection', label: 'ชำระค่าธรรมเนียมขยะ',            emoji: '🗑️' },
  { value: 'residence_cert',   label: 'ใบรับรองการอยู่อาศัย',           emoji: '🏠' },
  { value: 'tax_notice',       label: 'ชำระภาษีที่ดินและสิ่งปลูกสร้าง', emoji: '🏛️' },
  { value: 'personal_cert',    label: 'หนังสือรับรองบุคคล',              emoji: '👤' },
  { value: 'conduct_cert',     label: 'หนังสือรับรองความประพฤติ',        emoji: '✅' },
  { value: 'other',            label: 'คำขออื่นๆ',                       emoji: '📝' },
]

// ── sub-components ────────────────────────────────────────────────────

function MiniCalendar({ events }) {
  const navigate  = useNavigate()
  const todayRef  = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d }, [])
  const [calYear,  setCalYear]  = useState(todayRef.getFullYear())
  const [calMonth, setCalMonth] = useState(todayRef.getMonth())

  const eventMap = useMemo(() => {
    const map = {}
    events.forEach(ev => {
      if (!map[ev.event_date]) map[ev.event_date] = []
      map[ev.event_date].push(ev)
    })
    return map
  }, [events])

  const firstDow  = new Date(calYear, calMonth, 1).getDay()
  const totalDays = new Date(calYear, calMonth + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= totalDays; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const prevMonth = () => calMonth === 0
    ? (setCalMonth(11), setCalYear(y => y - 1))
    : setCalMonth(m => m - 1)
  const nextMonth = () => calMonth === 11
    ? (setCalMonth(0), setCalYear(y => y + 1))
    : setCalMonth(m => m + 1)

  const dayKey = d =>
    `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`

  const monthName = new Date(calYear, calMonth, 1)
    .toLocaleDateString('th-TH', { year: 'numeric', month: 'long' })

  return (
    <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CalendarDays size={14} style={{ color: 'var(--color-primary)' }} className="shrink-0" />
          <p className="text-xs font-bold text-gray-700">ปฏิทินกิจกรรม</p>
        </div>
        <Link to="/events" className="text-[13px] font-medium flex items-center gap-0.5 hover:underline"
          style={{ color: 'var(--color-primary)' }}>
          ทั้งหมด <ChevronRight size={11} />
        </Link>
      </div>
      <div className="flex items-center justify-between mb-2">
        <button onClick={prevMonth} className="p-1 rounded-lg hover:bg-gray-100 transition-colors text-gray-400">
          <ChevronLeft size={14} />
        </button>
        <p className="text-xs font-bold text-gray-700">{monthName}</p>
        <button onClick={nextMonth} className="p-1 rounded-lg hover:bg-gray-100 transition-colors text-gray-400">
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="grid grid-cols-7 mb-0.5">
        {DAY_TH.map((d, i) => (
          <div key={d} className={`text-center text-[10px] font-bold py-0.5 ${
            i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-400'
          }`}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-gray-100 rounded-xl overflow-hidden border border-gray-100">
        {cells.map((day, i) => {
          if (!day) return <div key={i} className="bg-gray-50 min-h-9" />
          const key    = dayKey(day)
          const evs    = eventMap[key] ?? []
          const dow    = (firstDow + day - 1) % 7
          const isToday = calYear === todayRef.getFullYear()
            && calMonth === todayRef.getMonth()
            && day === todayRef.getDate()
          return (
            <button key={i} onClick={() => navigate('/events')}
              className="min-h-9 px-0.5 pt-1 pb-0.5 flex flex-col items-center bg-white hover:bg-gray-50 transition-colors">
              <span className={`text-[13px] font-bold w-5 h-5 flex items-center justify-center rounded-full mb-0.5 ${
                isToday ? 'bg-red-500 text-white'
                  : dow === 0 ? 'text-red-400'
                  : dow === 6 ? 'text-blue-400'
                  : 'text-gray-700'
              }`}>{day}</span>
              <div className="flex flex-wrap justify-center gap-px">
                {evs.slice(0, 3).map((ev, j) => (
                  <span key={j} className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: AUD_COLOR[ev.audiences?.[0]] ?? '#6b7280' }} />
                ))}
              </div>
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2.5">
        {Object.entries(AUD_LABEL).map(([k, v]) => (
          <div key={k} className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: AUD_COLOR[k] }} />
            <span className="text-[10px] text-gray-400">{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function NewsSlider({ posts, label = 'ข่าวสาร', href = '/news' }) {
  const [idx, setIdx] = useState(0)
  const [paused, setPaused] = useState(false)

  const next = useCallback(() => setIdx(i => (i + 1) % posts.length), [posts.length])

  useEffect(() => {
    if (posts.length < 2 || paused) return
    const t = setInterval(next, 4500)
    return () => clearInterval(t)
  }, [next, paused, posts.length])

  if (!posts.length) return null
  const post = posts[idx]

  return (
    <div className="overflow-hidden"
      style={{
        backgroundColor: 'var(--bg-card, #ffffff)',
        borderRadius: 'var(--radius-card, 1rem)',
        boxShadow: 'var(--shadow-card, 0 1px 2px 0 rgba(0,0,0,0.05))',
        border: 'var(--border-card, 1px solid #f3f4f6)',
        backdropFilter: 'var(--blur-card, none)'
      }}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
        <div className="flex items-center gap-2">
          <Newspaper size={14} className="shrink-0" style={{ color: 'var(--color-primary)' }} />
          <p className="text-xs font-bold text-gray-700">{label}</p>
        </div>
        <Link to={href}
          className="text-[13px] font-medium flex items-center gap-0.5 hover:underline"
          style={{ color: 'var(--color-primary)' }}>
          ทั้งหมด <ChevronRight size={11} />
        </Link>
      </div>
      <div className="relative aspect-video bg-gray-100 cursor-pointer overflow-hidden"
        onClick={() => next()}>
        {post.image_url
          ? <img key={post.id} src={post.image_url} alt={post.title}
              className="w-full h-full object-cover transition-opacity duration-500"
              style={{ objectPosition: post.image_position ?? '50% 50%' }} />
          : <div className="w-full h-full flex items-center justify-center">
              <Newspaper size={36} className="text-gray-300" strokeWidth={1.5} />
            </div>}
        {posts.length > 1 && (
          <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">
            {posts.map((_, i) => (
              <button key={i} onClick={e => { e.stopPropagation(); setIdx(i) }}
                className="rounded-full transition-all"
                style={{
                  width: i === idx ? 16 : 6, height: 6,
                  backgroundColor: i === idx ? 'white' : 'rgba(255,255,255,0.5)',
                }} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── E-Service block (layout-aware) ────────────────────────────────────
function EServiceBlock({ docTypes }) {
  return (
    <div className="rounded-2xl shadow-xl border-none px-4 pt-3 pb-4 relative overflow-hidden"
         style={{ background: 'linear-gradient(135deg, #0284c7 0%, #0ea5e9 50%, #7dd3fc 100%)' }}>
      {/* decorative glows */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-white opacity-10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>
      <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-white opacity-10 rounded-full blur-2xl pointer-events-none"></div>
      
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-3">
          <p className="text-white font-extrabold text-[15px] md:text-base tracking-wide uppercase flex items-center gap-1.5 drop-shadow-sm">
            ✦ E-SERVICE ✦ <span className="text-white/90">งานบริการประชาชน</span>
          </p>
          <Link to="/doc-request" className="flex items-center gap-0.5 text-white/90 text-[13px] font-semibold hover:text-white transition-colors">
            ทั้งหมด <ChevronRight size={13} />
          </Link>
        </div>

        <div className="grid grid-cols-4 gap-2 md:grid-cols-6 md:gap-4 pb-1 md:pb-0">
          {docTypes.map(({ value, label, emoji }, i) => (
            <Link key={value} to={`/doc-request?type=${value}`}
              className={`${i >= 4 ? 'hidden md:flex' : 'flex'} flex-col items-center gap-1.5 active:scale-95 transition-transform group`}>
              <div className="w-[52px] h-[52px] md:w-14 md:h-14 rounded-2xl flex items-center justify-center shadow-md bg-white/20 border border-white/30 backdrop-blur-sm group-hover:bg-white/30 transition-colors"
                style={{ fontSize: 26, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                {emoji}
              </div>
              <p className="text-white/95 text-[13px] md:text-[13px] font-semibold text-center leading-tight w-full drop-shadow-sm line-clamp-2">{label}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Marquee (CleanMinimal Custom) ─────────────────────────────────────
function MarqueeBar() {
  return (
    <div className="flex items-center overflow-hidden rounded-xl shadow-md"
      style={{ background: 'linear-gradient(90deg, #38bdf8 0%, #34d399 50%, #fbbf24 100%)', height: 44 }}>
      <div className="shrink-0 flex items-center justify-center px-4 h-full bg-black/10 backdrop-blur-sm border-r border-white/20">
        <Megaphone size={18} className="text-white" />
      </div>
      <div className="flex-1 overflow-hidden ml-3 relative">
        <span className="whitespace-nowrap text-white text-[14px] font-bold inline-block drop-shadow-sm"
          style={{ animation: 'marquee 40s linear infinite' }}>
          {MARQUEE_TEXT}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{MARQUEE_TEXT}
        </span>
      </div>
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────
export default function HomePage() {
  const { tenant } = useTenant()
  const { role }   = useAuth()
  const layout = tenant?.layout_theme || 'classic'

  const isStaff           = role === 'staff'
  const isTechnician      = role === 'technician'

  const docTypes = useMemo(() => {
    const extras = (tenant?.fee_schedule?._custom_types || []).map(t => ({
      value: t.value, label: t.label, emoji: t.emoji || '📋',
    }))
    return [...BASE_DOC_TYPES, ...extras]
  }, [tenant])

  const [calEvents, setCalEvents] = useState([])
  useEffect(() => {
    if (!tenant?.id) return
    const threeMonthsAgo = new Date()
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 1)
    const threeMonthsAhead = new Date()
    threeMonthsAhead.setMonth(threeMonthsAhead.getMonth() + 2)
    supabase.rpc('get_event_dots', {
      p_municipality_id: tenant.id,
      p_from: threeMonthsAgo.toISOString().split('T')[0],
      p_to: threeMonthsAhead.toISOString().split('T')[0],
    }).then(({ data }) => setCalEvents(data ?? []))
  }, [tenant?.id])

  const [sidebarNews, setSidebarNews] = useState([])
  const [sidebarActivities, setSidebarActivities] = useState([])
  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('posts')
      .select('id,title,excerpt,image_url,image_position,event_date,created_at')
      .eq('municipality_id', tenant.id).eq('type', 'news').eq('is_published', true)
      .order('event_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }).limit(5)
      .then(({ data }) => setSidebarNews(data ?? []))
    supabase.from('posts')
      .select('id,title,excerpt,image_url,image_position,event_date,created_at')
      .eq('municipality_id', tenant.id).eq('type', 'activity').eq('is_published', true)
      .order('event_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }).limit(5)
      .then(({ data }) => setSidebarActivities(data ?? []))
  }, [tenant?.id])

  const [docCounts, setDocCounts] = useState({})
  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('document_requests').select('document_type')
      .eq('municipality_id', tenant.id)
      .order('created_at', { ascending: false }).limit(300)
      .then(({ data }) => {
        const c = {}
        ;(data ?? []).forEach(r => { c[r.document_type] = (c[r.document_type] ?? 0) + 1 })
        setDocCounts(c)
      })
  }, [tenant?.id])

  const topDocTypes = useMemo(() => docTypes, [docTypes])

  // ── section map ──────────────────────────────────────────────────
  const SECTION = {
    banner:    <BannerSlider key="banner" />,
    staff:     <StaffSection key="staff" />,
    eservice:  <EServiceBlock key="eservice" docTypes={topDocTypes} />,
    marquee:   <MarqueeBar key="marquee" />,
    complaint: <ComplaintBand key="complaint" />,
    shortcut:  <ShortcutBand key="shortcut" />,
  }

  const RIGHT_SECTION = {
    weather:    <WeatherWidget key="weather" />,
    news:       <NewsSlider key="news" posts={sidebarNews} />,
    activities: <NewsSlider key="activities" posts={sidebarActivities} label="กิจกรรม" href="/news?tab=activity" />,
    calendar:   <MiniCalendar key="calendar" events={calEvents} />,
  }

  const leftOrder  = LAYOUT_ORDER[layout]  || LAYOUT_ORDER.classic
  const rightOrder = LAYOUT_RIGHT[layout]  || LAYOUT_RIGHT.classic

  return (
    <div className="bg-gray-50">
      <style>{marqueeStyle}</style>

      <div className="px-4 md:px-6 pt-2 pb-4 max-w-6xl mx-auto">

        {/* Mobile weather */}
        {layout !== 'news_first' && (
          <div className="md:hidden mb-3">
            <WeatherWidget />
          </div>
        )}

        {/* Role shortcuts (mobile only) */}
        {isStaff && (
          <Link to="/staff"
            className="md:hidden flex items-center gap-3 rounded-2xl px-4 py-3.5 shadow-md mb-2 transition-all hover:shadow-lg hover:-translate-y-0.5"
            style={{ background: 'linear-gradient(135deg, #0369a1 0%, #0ea5e9 100%)' }}>
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
              <Briefcase size={18} className="text-white" />
            </div>
            <div className="flex-1">
              <p className="text-white font-bold text-sm">ระบบเจ้าหน้าที่</p>
              <p className="text-white/70 text-xs">กล่องงาน เอกสาร อนุมัติ รายงาน</p>
            </div>
            <ChevronRight size={18} className="text-white/60" />
          </Link>
        )}
        {isTechnician && (
          <Link to="/technician"
            className="md:hidden flex items-center gap-3 rounded-2xl px-4 py-3.5 shadow-md mb-2 transition-all hover:shadow-lg hover:-translate-y-0.5"
            style={{ background: 'linear-gradient(135deg, #065f46 0%, #10b981 100%)' }}>
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
              <Wrench size={18} className="text-white" />
            </div>
            <div className="flex-1">
              <p className="text-white font-bold text-sm">งานซ่อมของฉัน</p>
              <p className="text-white/70 text-xs">คิวงาน สถานะ อัปเดต</p>
            </div>
            <ChevronRight size={18} className="text-white/60" />
          </Link>
        )}
        <Link to="/map"
          className="md:hidden flex items-center gap-3 rounded-2xl px-4 py-3.5 shadow-md mb-2 transition-all hover:shadow-lg hover:-translate-y-0.5"
          style={{ background: 'linear-gradient(135deg, #2563eb 0%, #0891b2 100%)' }}>
          <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
            <Map size={18} className="text-white" />
          </div>
          <div className="flex-1">
            <p className="text-white font-bold text-sm">แผนที่ข้อมูลดิจิทัล</p>
            <p className="text-white/70 text-xs">ดูคำร้อง โครงการ ร้านค้าบนแผนที่</p>
          </div>
          <ChevronRight size={18} className="text-white/60" />
        </Link>
        {!role && (
          <div className="md:hidden flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800 mb-2">
            <Info size={16} className="shrink-0 mt-0.5" />
            <p>สมัครสมาชิกเพื่อติดตามสถานะคำร้องของท่าน และรับการแจ้งเตือนทันที</p>
          </div>
        )}
        {/* ── Main 2-col grid ─────────────────────────────────────── */}
        <div className="md:grid md:grid-cols-3 md:gap-6">

          {/* Left col */}
          <div className="md:col-span-2 flex flex-col gap-2 md:gap-3">
            {leftOrder.map(key => SECTION[key] ?? null)}
          </div>

          {/* Right col (desktop) */}
          <div className="hidden md:flex flex-col gap-3">
            {rightOrder.map(key => RIGHT_SECTION[key] ?? null)}
          </div>
        </div>

        {/* Right col (mobile) — แสดงหลัง main sections, ข้าม weather ที่โชว์บน top อยู่แล้ว */}
        <div className="md:hidden flex flex-col gap-2 mt-2">
          {rightOrder
            .filter(key => layout === 'news_first' || key !== 'weather')
            .filter(key => key !== 'news' && key !== 'activities' && key !== 'calendar') // ซ่อนบนมือถือเพื่อไม่ให้ซ้ำกับ PostsHighlight และซ่อนปฏิทิน
            .map(key => RIGHT_SECTION[key] ?? null)}
        </div>

        {/* Full-width sections — ข่าวสารและกิจกรรม */}
        <div className="mt-3">
          <PostsHighlight />
        </div>
      </div>

      <div className="px-4 md:px-6 pb-2 max-w-6xl mx-auto">
        <TourismSection />
      </div>
    </div>
  )
}
