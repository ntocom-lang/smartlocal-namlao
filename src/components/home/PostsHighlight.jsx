import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Newspaper, Camera, CalendarDays, ChevronRight, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'

function fmtDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('th-TH', {
    day: 'numeric', month: 'short', year: '2-digit',
  })
}

function PostDetailModal({ post, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!post) return null
  const date = fmtDate(post.event_date ?? post.created_at?.slice(0, 10))

  return (
    <div className="fixed inset-0 z-50 flex flex-col md:items-center md:justify-center md:bg-black/60"
         onClick={onClose}>
      <div className="bg-white flex flex-col h-full md:h-auto md:max-h-[85vh] md:w-full md:max-w-lg md:rounded-2xl overflow-hidden shadow-2xl"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
          <span className="text-sm font-semibold text-gray-700">รายละเอียด</span>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100 transition-colors">
            <X size={18} className="text-gray-500" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {post.image_url && (
            <div className="aspect-video bg-gray-100 overflow-hidden shrink-0">
              <img src={post.image_url} alt={post.title}
                   className="w-full h-full object-cover"
                   style={{ objectPosition: post.image_position ?? '50% 50%' }} />
            </div>
          )}
          <div className="p-5">
            {date && (
              <p className="text-xs text-gray-400 flex items-center gap-1 mb-2">
                <CalendarDays size={12} /> {date}
              </p>
            )}
            <h2 className="text-lg font-bold text-gray-800 leading-snug mb-3">{post.title}</h2>
            {post.excerpt
              ? <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{post.excerpt}</p>
              : <p className="text-sm text-gray-400 italic">ไม่มีรายละเอียดเพิ่มเติม</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

function NewsCard({ post, onClick }) {
  const date = fmtDate(post.event_date ?? post.created_at?.slice(0, 10))
  return (
    <div onClick={onClick}
         className="overflow-hidden flex flex-col hover:-translate-y-0.5 transition-all cursor-pointer active:scale-[0.98]"
         style={{
           backgroundColor: 'var(--bg-card, #ffffff)',
           borderRadius: 'var(--radius-card, 1rem)',
           boxShadow: 'var(--shadow-card, 0 1px 2px 0 rgba(0,0,0,0.05))',
           border: 'var(--border-card, 1px solid #f3f4f6)',
           backdropFilter: 'var(--blur-card, none)'
         }}>
      <div className="aspect-4/3 bg-gray-100 overflow-hidden shrink-0">
        {post.image_url
          ? <img src={post.image_url} alt={post.title}
                 className="w-full h-full object-cover"
                 style={{ objectPosition: post.image_position ?? '50% 50%' }} />
          : <div className="w-full h-full flex items-center justify-center text-gray-300">
              <Newspaper size={32} strokeWidth={1.5} />
            </div>}
      </div>
      <div className="px-3 py-2">
        <p className="text-[13px] font-semibold text-gray-800 leading-snug line-clamp-2">{post.title}</p>
      </div>
    </div>
  )
}

function ActivityCard({ post, onClick }) {
  return (
    <div onClick={onClick}
         className="overflow-hidden flex flex-col hover:-translate-y-0.5 transition-all cursor-pointer active:scale-[0.98]"
         style={{
           backgroundColor: 'var(--bg-card, #ffffff)',
           borderRadius: 'var(--radius-card, 1rem)',
           boxShadow: 'var(--shadow-card, 0 1px 2px 0 rgba(0,0,0,0.05))',
           border: 'var(--border-card, 1px solid #f3f4f6)',
           backdropFilter: 'var(--blur-card, none)'
         }}>
      <div className="aspect-4/3 bg-gray-100 overflow-hidden shrink-0">
        {post.image_url
          ? <img src={post.image_url} alt={post.title}
                 className="w-full h-full object-cover"
                 style={{ objectPosition: post.image_position ?? '50% 50%' }} />
          : <div className="w-full h-full flex items-center justify-center text-gray-300">
              <Camera size={32} strokeWidth={1.5} />
            </div>}
      </div>
      <div className="px-3 py-2">
        <p className="text-[13px] font-semibold text-gray-800 leading-snug line-clamp-2">{post.title}</p>
      </div>
    </div>
  )
}

export default function PostsHighlight({ showOnDesktop = false }) {
  const { tenant } = useTenant()
  const [news, setNews]             = useState([])
  const [activities, setActivities] = useState([])
  const [selected, setSelected]     = useState(null)

  useEffect(() => {
    if (!tenant?.id) return

    supabase.from('posts')
      .select('id,title,excerpt,image_url,image_position,event_date,created_at')
      .eq('municipality_id', tenant.id)
      .eq('type', 'news')
      .eq('is_published', true)
      .order('event_date', { ascending: false, nullsFirst: false })
      .order('created_at',  { ascending: false })
      .limit(6)
      .then(({ data }) => setNews(data ?? []))

    supabase.from('posts')
      .select('id,title,excerpt,image_url,image_position,event_date,created_at')
      .eq('municipality_id', tenant.id)
      .eq('type', 'activity')
      .eq('is_published', true)
      .order('event_date', { ascending: false, nullsFirst: false })
      .order('created_at',  { ascending: false })
      .limit(8)
      .then(({ data }) => setActivities(data ?? []))
  }, [tenant?.id])

  const shortName = tenant?.short_name || tenant?.name || ''

  if (news.length === 0 && activities.length === 0) return null

  return (
    <>
      <div className="flex flex-col gap-2">

        {/* ข่าวสำคัญ */}
        {news.length > 0 && (
          <section className={showOnDesktop ? '' : 'md:hidden'}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-1 h-6 rounded-full shrink-0" style={{ backgroundColor: 'var(--color-primary)' }} />
                <div>
                  {shortName && <p className="text-[10px] text-gray-400 leading-none">{shortName} อัปเดต</p>}
                  <h2 className="text-base font-bold text-gray-800 leading-tight">ข่าวสาร</h2>
                </div>
              </div>
              {news.length > 2 && (
                <Link to="/news"
                      className="text-xs font-medium flex items-center gap-0.5 px-2 py-1 rounded-full hover:bg-gray-100 transition-colors"
                      style={{ color: 'var(--color-primary)' }}>
                  ดูทั้งหมด <ChevronRight size={13} />
                </Link>
              )}
            </div>
            <div className={`grid gap-3 ${showOnDesktop ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2 md:grid-cols-3'}`}>
              {news.slice(0, showOnDesktop ? 4 : 3).map((post, i) => (
                <div key={post.id} className={!showOnDesktop && i === 2 ? 'hidden md:block' : ''}>
                  <NewsCard post={post} onClick={() => setSelected(post)} />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* กิจกรรม */}
        {activities.length > 0 && (
          <section className={showOnDesktop ? '' : 'md:hidden'}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-1 h-6 rounded-full shrink-0" style={{ backgroundColor: 'var(--color-primary)' }} />
                <h2 className="text-base font-bold text-gray-800">กิจกรรม</h2>
              </div>
              {activities.length > 2 && (
                <Link to="/news?tab=activity"
                      className="text-xs font-medium flex items-center gap-0.5 px-2 py-1 rounded-full hover:bg-gray-100 transition-colors"
                      style={{ color: 'var(--color-primary)' }}>
                  ดูทั้งหมด <ChevronRight size={13} />
                </Link>
              )}
            </div>
            <div className={`grid gap-3 ${showOnDesktop ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2 md:grid-cols-3'}`}>
              {activities.slice(0, showOnDesktop ? 4 : 3).map((post, i) => (
                <div key={post.id} className={!showOnDesktop && i === 2 ? 'hidden md:block' : ''}>
                  <ActivityCard post={post} onClick={() => setSelected(post)} />
                </div>
              ))}
            </div>
          </section>
        )}

      </div>

      {selected && (
        <PostDetailModal post={selected} onClose={() => setSelected(null)} />
      )}
    </>
  )
}
