import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useTenant } from '../../../../contexts/TenantContext'
import { useAuth } from '../../../../contexts/AuthContext'
import { supabase } from '../../../../lib/supabase'
import PostsHighlight from '../../../../components/home/PostsHighlight'
import TourismSection from '../../../../components/home/TourismSection'
import BannerSlider from '../../../../components/home/BannerSlider'
import {
  ChevronRight, Briefcase, Wrench, Newspaper,
} from 'lucide-react'
import WeatherWidget from '../../../../components/home/WeatherWidget'
import ComplaintBand from '../../../../components/home/ComplaintBand'
import SmartCityBanner from '../../../../components/home/SmartCityBanner'

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
      <div className="px-3 sm:px-4 lg:px-6 pt-2 lg:pt-3 pb-4 max-w-[1440px] mx-auto">

        {/* Mobile: สภาพอากาศอยู่ก่อนแบนเนอร์ / Desktop: แบนเนอร์ซ้าย ข้อมูลเมืองขวา */}
        <div className="grid lg:grid-cols-12 gap-2 lg:gap-4">
          <div className="order-2 lg:order-1 lg:col-span-8 space-y-2">
            <BannerSlider />
            <SmartCityBanner />
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
        <div className="grid lg:grid-cols-12 gap-2 lg:gap-4 mt-2 lg:mt-3">
          <div className="lg:col-span-8 flex flex-col gap-2 lg:gap-3">
            {leftOrder.map(key => SECTION[key] ?? null)}
          </div>

          <aside className="hidden lg:flex lg:col-span-4 flex-col gap-3" aria-label="ภาพกิจกรรมและผลงาน">
            {RIGHT_SECTION.activities}
          </aside>
        </div>

        {/* Full-width sections — ข่าวสารและกิจกรรม */}
        <div className="mt-3">
          <PostsHighlight />
        </div>
      </div>

      <div className="px-3 sm:px-4 lg:px-6 pb-2 max-w-[1440px] mx-auto">
        <TourismSection />
      </div>

    </div>
  )
}
