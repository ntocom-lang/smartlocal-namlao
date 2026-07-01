import { useEffect, useState } from 'react'
import { ArrowRight, Newspaper, Camera, CalendarDays } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'

function fmtDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
}

function NewsCard({ post }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col hover:shadow-md transition-shadow cursor-pointer">
      <div className="aspect-4/3 bg-gray-100 overflow-hidden shrink-0">
        {post.image_url
          ? <img src={post.image_url} alt={post.title} className="w-full h-full object-cover"
              style={{ objectPosition: post.image_position ?? '50% 50%' }} />
          : <div className="w-full h-full flex items-center justify-center text-gray-300">
              <Newspaper size={32} strokeWidth={1.5} />
            </div>}
      </div>
      <div className="p-3 flex flex-col gap-1.5 flex-1">
        <p className="text-[13px] font-semibold text-gray-800 leading-snug line-clamp-2">{post.title}</p>
        {post.excerpt && (
          <p className="text-[11px] text-gray-500 line-clamp-2 leading-relaxed">{post.excerpt}</p>
        )}
        <p className="text-[11px] text-gray-400 mt-auto flex items-center gap-1">
          <CalendarDays size={11} />
          {fmtDate(post.event_date ?? post.created_at?.slice(0, 10))}
        </p>
      </div>
    </div>
  )
}

function ActivityCard({ post }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow cursor-pointer">
      <div className="aspect-4/3 bg-gray-100 overflow-hidden">
        {post.image_url
          ? <img src={post.image_url} alt={post.title} className="w-full h-full object-cover"
              style={{ objectPosition: post.image_position ?? '50% 50%' }} />
          : <div className="w-full h-full flex items-center justify-center text-gray-300">
              <Camera size={28} strokeWidth={1.5} />
            </div>}
      </div>
      <div className="px-3 py-2.5">
        <p className="text-[12px] font-semibold text-gray-800 leading-snug line-clamp-2">{post.title}</p>
        <p className="text-[11px] text-gray-400 mt-1 flex items-center gap-1">
          <CalendarDays size={10} />
          {fmtDate(post.event_date ?? post.created_at?.slice(0, 10))}
        </p>
      </div>
    </div>
  )
}

export default function PostsHighlight() {
  const { tenant } = useTenant()
  const [news, setNews] = useState([])
  const [activities, setActivities] = useState([])

  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('posts')
      .select('id,title,excerpt,image_url,image_position,event_date,created_at')
      .eq('municipality_id', tenant.id)
      .eq('type', 'news')
      .eq('is_published', true)
      .order('created_at', { ascending: false })
      .limit(6)
      .then(({ data }) => setNews(data ?? []))

    supabase.from('posts')
      .select('id,title,image_url,image_position,event_date,created_at')
      .eq('municipality_id', tenant.id)
      .eq('type', 'activity')
      .eq('is_published', true)
      .order('created_at', { ascending: false })
      .limit(8)
      .then(({ data }) => setActivities(data ?? []))
  }, [tenant?.id])

  const shortName = tenant?.short_name || tenant?.name || ''

  if (news.length === 0 && activities.length === 0) return null

  return (
    <div className="flex flex-col gap-6">

      {/* ข่าวสำคัญ */}
      {news.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-1 h-6 rounded-full shrink-0" style={{ backgroundColor: 'var(--color-primary)' }} />
              <div>
                <p className="text-[10px] text-gray-400 leading-none">{shortName} อัปเดต</p>
                <h2 className="text-base font-bold text-gray-800 leading-tight">ข่าวสำคัญ</h2>
              </div>
            </div>
            <button className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-xl transition-colors hover:opacity-80"
              style={{ color: 'var(--color-primary)' }}>
              ดูทั้งหมด <ArrowRight size={13} />
            </button>
          </div>
          {/* mobile: 2 col (2 items), PC: 3 col (3 items) */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {news.slice(0, 3).map((post, i) => (
              <div key={post.id} className={i === 2 ? 'hidden md:block' : ''}>
                <NewsCard post={post} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ภาพกิจกรรม */}
      {activities.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-1 h-6 rounded-full shrink-0" style={{ backgroundColor: 'var(--color-primary)' }} />
              <h2 className="text-base font-bold text-gray-800">ภาพกิจกรรม</h2>
            </div>
            <button className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-xl transition-colors hover:opacity-80"
              style={{ color: 'var(--color-primary)' }}>
              ดูทั้งหมด <ArrowRight size={13} />
            </button>
          </div>
          {/* mobile: 2 col (4 items), PC: 4 col (4 items) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {activities.slice(0, 4).map(post => (
              <ActivityCard key={post.id} post={post} />
            ))}
          </div>
        </section>
      )}

    </div>
  )
}
