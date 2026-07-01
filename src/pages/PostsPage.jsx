import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Newspaper, Camera, CalendarDays, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'

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

const TABS = [
  { key: 'news',     label: 'ข่าวสาร',  Icon: Newspaper },
  { key: 'activity', label: 'กิจกรรม', Icon: Camera },
]

export default function PostsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { tenant } = useTenant()
  const [tab, setTab]         = useState(() => searchParams.get('tab') === 'activity' ? 'activity' : 'news')
  const [posts, setPosts]     = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    if (!tenant?.id) return
    setLoading(true)
    setPosts([])
    supabase.from('posts')
      .select('id,title,excerpt,image_url,image_position,event_date,created_at')
      .eq('municipality_id', tenant.id)
      .eq('type', tab)
      .eq('is_published', true)
      .order('event_date', { ascending: false, nullsFirst: false })
      .order('created_at',  { ascending: false })
      .limit(50)
      .then(({ data }) => { setPosts(data ?? []); setLoading(false) })
  }, [tenant?.id, tab])

  const isActivity = tab === 'activity'

  return (
    <div className="min-h-screen pb-28 md:pb-8" style={{ backgroundColor: '#eef2f7' }}>

      {/* Mobile header */}
      <div className="md:hidden sticky top-0 z-30 px-4 pt-3 pb-2 bg-gray-50/95 backdrop-blur-md border-b border-gray-100/80">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(-1)}
                  className="p-2 -ml-1 rounded-xl hover:bg-gray-200/60 text-gray-500 transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-base font-bold text-gray-800">ข่าวสาร / กิจกรรม</h1>
        </div>
      </div>

      {/* PC header */}
      <div className="hidden md:block max-w-4xl mx-auto px-4 pt-8 pb-2">
        <h1 className="text-2xl font-bold text-gray-800">ข่าวสาร / กิจกรรม</h1>
      </div>

      {/* Tabs */}
      <div className="bg-gray-50/95 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-4xl mx-auto px-4 flex gap-0">
          {TABS.map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)}
                    className={`px-5 py-3 text-sm font-semibold border-b-2 transition-colors ${
                      tab === key
                        ? 'border-[color:var(--color-primary)] text-[color:var(--color-primary)]'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-4">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-gray-200 rounded-full animate-spin"
                 style={{ borderTopColor: 'var(--color-primary)' }} />
          </div>
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-gray-400 gap-3">
            {isActivity ? <Camera size={48} strokeWidth={1} /> : <Newspaper size={48} strokeWidth={1} />}
            <p className="text-sm">ยังไม่มี{isActivity ? 'กิจกรรม' : 'ข่าวสาร'}</p>
          </div>
        ) : (
          <div className={`grid gap-3 ${isActivity ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2 md:grid-cols-3'}`}>
            {posts.map(post => {
              const date = fmtDate(post.event_date ?? post.created_at?.slice(0, 10))
              return (
                <div key={post.id} onClick={() => setSelected(post)}
                     className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col cursor-pointer hover:shadow-md transition-shadow active:scale-[0.98]">
                  <div className="aspect-4/3 bg-gray-100 overflow-hidden shrink-0">
                    {post.image_url
                      ? <img src={post.image_url} alt={post.title}
                             className="w-full h-full object-cover"
                             style={{ objectPosition: post.image_position ?? '50% 50%' }} />
                      : <div className="w-full h-full flex items-center justify-center text-gray-300">
                          {isActivity ? <Camera size={28} strokeWidth={1.5} /> : <Newspaper size={28} strokeWidth={1.5} />}
                        </div>}
                  </div>
                  <div className="p-3 flex flex-col gap-1 flex-1">
                    <p className="text-[13px] font-semibold text-gray-800 leading-snug line-clamp-2">{post.title}</p>
                    {!isActivity && post.excerpt && (
                      <p className="text-[11px] text-gray-500 line-clamp-2 leading-relaxed">{post.excerpt}</p>
                    )}
                    {date && (
                      <p className="text-[11px] text-gray-400 mt-auto flex items-center gap-1 pt-1">
                        <CalendarDays size={10} /> {date}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {selected && <PostDetailModal post={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
