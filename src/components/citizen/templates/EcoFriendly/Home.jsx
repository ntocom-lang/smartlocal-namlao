import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useTenant } from '../../../../contexts/TenantContext'
import { useAuth } from '../../../../contexts/AuthContext'
import { supabase } from '../../../../lib/supabase'
import PostsHighlight from '../../../../components/home/PostsHighlight'
import TourismSection from '../../../../components/home/TourismSection'
import BannerSlider from '../../../../components/home/BannerSlider'
import {
  ChevronRight, Briefcase, Wrench, Newspaper, Map, Megaphone,
} from 'lucide-react'
import WeatherWidget from '../../../../components/home/WeatherWidget'
import ComplaintBand from '../../../../components/home/ComplaintBand'

const MARQUEE_TEXT = 'บริการประชาชนออนไลน์ ตลอด 24 ชั่วโมง เพื่อใช้เป็นช่องทางในการติดตามข่าวสาร แจ้งเรื่องร้องเรียน และรับบริการต่างๆ ได้อย่างสะดวก รวดเร็ว และเข้าถึงได้ทุกที่ทุกเวลา'

const marqueeStyle = `
@keyframes citizen-marquee {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
.citizen-marquee-track {
  animation: citizen-marquee 40s linear infinite;
}
.citizen-marquee-track:hover {
  animation-play-state: paused;
}
@media (prefers-reduced-motion: reduce) {
  .citizen-marquee-track {
    animation: none;
    transform: none;
  }
  .citizen-marquee-repeat {
    display: none;
  }
}`

// ── section order per layout ──────────────────────────────────────────
const LAYOUT_ORDER = {
  classic:       ['eservice', 'complaint'],
  modern:        ['eservice', 'complaint'],
  service_first: ['eservice', 'complaint'],
  news_first:    ['eservice', 'complaint'],
}
const BASE_DOC_TYPES = [
  { value: 'waste_collection', label: 'ค่าธรรมเนียมขยะ',            emoji: '🗑️' },
  { value: 'tax_notice',       label: 'ค่าธรรมเนียม/ภาษี', emoji: '🏛️' },
  { value: 'building_permit',  label: 'ขออนุญาตก่อสร้างบ้าน',       emoji: '🏗️' },
]

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
  const safeIdx = idx % posts.length
  const post = posts[safeIdx]

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
                  width: i === safeIdx ? 16 : 6, height: 6,
                  backgroundColor: i === safeIdx ? 'white' : 'rgba(255,255,255,0.5)',
                }} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function MarqueeBar() {
  return (
    <section className="flex items-center overflow-hidden rounded-xl shadow-md"
      style={{ background: 'linear-gradient(90deg, #38bdf8 0%, #34d399 50%, #fbbf24 100%)', height: 44 }}
      aria-label="ข้อมูลประชาสัมพันธ์">
      <div className="shrink-0 flex items-center justify-center px-4 h-full bg-black/10 border-r border-white/20">
        <Megaphone size={18} className="text-white" />
      </div>
      <div className="flex-1 overflow-hidden ml-3">
        <div className="citizen-marquee-track whitespace-nowrap text-white text-sm font-bold inline-block drop-shadow-sm">
          <span className="inline-block pr-12">{MARQUEE_TEXT}</span>
          <span className="citizen-marquee-repeat inline-block pr-12" aria-hidden="true">{MARQUEE_TEXT}</span>
        </div>
      </div>
    </section>
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

        <div className="grid lg:hidden gap-2 pb-1"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(docTypes.length, 3))}, minmax(0, 1fr))` }}>
          {docTypes.slice(0, 3).map(({ value, label, emoji }) => (
            <Link key={value} to={`/doc-request?type=${value}`}
              className="flex flex-col items-center gap-1.5 active:scale-95 transition-transform group">
              <div className="w-[52px] h-[52px] rounded-2xl flex items-center justify-center shadow-md bg-white/20 border border-white/30 backdrop-blur-sm group-hover:bg-white/30 transition-colors"
                style={{ fontSize: 26, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                {emoji}
              </div>
              <p className="text-white/95 text-[13px] font-semibold text-center leading-tight w-full drop-shadow-sm line-clamp-2">{label}</p>
            </Link>
          ))}
        </div>

        <div className="hidden lg:grid gap-4 pb-0"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(docTypes.length, 6))}, minmax(0, 1fr))` }}>
          {docTypes.slice(0, 6).map(({ value, label, emoji }) => (
            <Link key={value} to={`/doc-request?type=${value}`}
              className="flex flex-col items-center gap-1.5 active:scale-95 transition-transform group">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-md bg-white/20 border border-white/30 backdrop-blur-sm group-hover:bg-white/30 transition-colors"
                style={{ fontSize: 26, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                {emoji}
              </div>
              <p className="text-white/95 text-sm font-semibold text-center leading-tight w-full drop-shadow-sm line-clamp-2">{label}</p>
            </Link>
          ))}
        </div>
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

  const topDocTypes = docTypes

  // ── section map ──────────────────────────────────────────────────
  const SECTION = {
    eservice:  <EServiceBlock key="eservice" docTypes={topDocTypes} />,
    complaint: <ComplaintBand key="complaint" />,
  }

  const RIGHT_SECTION = {
    weather:    <WeatherWidget key="weather" />,
    news:       <NewsSlider key="news" posts={sidebarNews} label="ข่าวสาร/ประกาศ" />,
    activities: <NewsSlider key="activities" posts={sidebarActivities} label="ภาพกิจกรรม/ผลงาน" href="/news?tab=activity" />,
  }

  const leftOrder  = LAYOUT_ORDER[layout]  || LAYOUT_ORDER.classic
  return (
    <div className="bg-gray-50">
      <style>{marqueeStyle}</style>
      <div className="px-3 sm:px-4 lg:px-6 pt-3 pb-4 max-w-[1440px] mx-auto">

        {/* Role shortcuts (mobile only) */}
        {isStaff && (
          <Link to="/staff"
            className="lg:hidden flex items-center gap-3 rounded-2xl px-4 py-3 shadow-md mb-2 transition-all hover:shadow-lg hover:-translate-y-0.5"
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
            className="lg:hidden flex items-center gap-3 rounded-2xl px-4 py-3 shadow-md mb-2 transition-all hover:shadow-lg hover:-translate-y-0.5"
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
        {/* Mobile: สภาพอากาศอยู่ก่อนแบนเนอร์ / Desktop: แบนเนอร์ซ้าย ข้อมูลเมืองขวา */}
        <div className="grid lg:grid-cols-12 gap-3 lg:gap-4">
          <div className="order-2 lg:order-1 lg:col-span-8">
            <BannerSlider />
          </div>
          <aside className="order-1 lg:order-2 lg:col-span-4 flex flex-col gap-3"
            aria-label="คุณภาพอากาศ พยากรณ์อากาศ และข่าวสาร">
            {RIGHT_SECTION.weather}
            <div className="hidden lg:block">
              {RIGHT_SECTION.news}
            </div>
          </aside>
        </div>

        {/* บริการประชาชนและข้อมูลประกอบ */}
        <div className="grid lg:grid-cols-12 gap-3 lg:gap-4 mt-3">
          <div className="lg:col-span-8 flex flex-col gap-3">
            {leftOrder.map(key => SECTION[key] ?? null)}
          </div>

          <aside className="hidden lg:flex lg:col-span-4 flex-col gap-3" aria-label="ภาพกิจกรรมและผลงาน">
            {RIGHT_SECTION.activities}
          </aside>
        </div>

        <div className="mt-3">
          <MarqueeBar />
        </div>

        {/* Full-width sections — ข่าวสารและกิจกรรม */}
        <div className="mt-3">
          <PostsHighlight />
        </div>
      </div>

      <div className="px-3 sm:px-4 lg:px-6 pb-2 max-w-[1440px] mx-auto">
        <TourismSection />
      </div>

      <div className="lg:hidden px-3 sm:px-4 pb-6 max-w-[1440px] mx-auto">
        <Link to="/map"
          className="flex items-center gap-3 rounded-2xl px-4 py-3.5 shadow-md transition-all hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.99]"
          style={{ background: 'linear-gradient(135deg, #2563eb 0%, #0891b2 100%)' }}>
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
            <Map size={20} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm sm:text-base">แผนที่ข้อมูลดิจิทัล</p>
            <p className="text-white/75 text-xs sm:text-sm">ดูคำร้อง โครงการ ร้านค้าบนแผนที่</p>
          </div>
          <ChevronRight size={20} className="text-white/70 shrink-0" />
        </Link>
      </div>
    </div>
  )
}
