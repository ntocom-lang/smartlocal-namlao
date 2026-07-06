import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { Calendar, ChevronRight, Search } from 'lucide-react'

const STATUS_CFG = {
  planning:  { label: 'วางแผน',        bg: '#f3f4f6', text: '#374151' },
  active:    { label: 'ดำเนินการอยู่',  bg: '#d1fae5', text: '#065f46' },
  completed: { label: 'เสร็จสิ้น',      bg: '#dbeafe', text: '#1e40af' },
  suspended: { label: 'ระงับชั่วคราว',  bg: '#fef3c7', text: '#92400e' },
}

export default function OrgProjectsPage() {
  const { tenant } = useTenant()
  const navigate   = useNavigate()
  const [projects, setProjects] = useState([])
  const [loading, setLoading]   = useState(true)
  const [filterStatus, setFilterStatus] = useState('all')
  const [search, setSearch]     = useState('')

  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('org_projects')
      .select('id, title, subtitle, category, status, start_date, end_date, cover_image_url')
      .eq('municipality_id', tenant.id)
      .eq('is_public', true)
      .order('sort_order').order('created_at', { ascending: false })
      .then(({ data }) => { setProjects(data ?? []); setLoading(false) })
  }, [tenant?.id])

  const filtered = projects.filter(p => {
    const matchStatus = filterStatus === 'all' || p.status === filterStatus
    const q = search.toLowerCase()
    const matchSearch = !q || p.title.toLowerCase().includes(q) || (p.category ?? '').toLowerCase().includes(q)
    return matchStatus && matchSearch
  })

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">โครงการขององค์กร</h1>
        <p className="text-gray-500 text-sm mt-1">เรื่องราวและความคืบหน้าโครงการต่างๆ</p>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-400"
            placeholder="ค้นหาโครงการ..." />
        </div>
        <div className="flex gap-1 flex-wrap">
          {[['all', 'ทั้งหมด'], ...Object.entries(STATUS_CFG).map(([k, v]) => [k, v.label])].map(([k, label]) => (
            <button key={k} onClick={() => setFilterStatus(k)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${filterStatus === k ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-gray-400">กำลังโหลด...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">📋</p>
          <p className="font-semibold">ไม่พบโครงการ</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map(p => {
            const s = STATUS_CFG[p.status] ?? STATUS_CFG.active
            const d = p.start_date ? new Date(p.start_date + 'T00:00:00').toLocaleDateString('th-TH', { year: 'numeric', month: 'short' }) : null
            return (
              <button key={p.id} onClick={() => navigate(`/projects/${p.id}`)}
                className="w-full text-left rounded-2xl overflow-hidden border border-gray-200 hover:border-emerald-300 hover:shadow-lg transition-all group bg-white">
                {p.cover_image_url ? (
                  <img src={p.cover_image_url} className="w-full h-40 object-cover group-hover:brightness-95 transition-all" />
                ) : (
                  <div className="w-full h-40 flex items-center justify-center text-4xl"
                    style={{ background: 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)' }}>📋</div>
                )}
                <div className="p-4">
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: s.bg, color: s.text }}>{s.label}</span>
                  <p className="font-bold text-gray-800 mt-2 leading-snug line-clamp-2">{p.title}</p>
                  {p.subtitle && <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{p.subtitle}</p>}
                  <div className="flex items-center justify-between mt-3 text-[10px] text-gray-400">
                    <span>{p.category || '—'}</span>
                    {d && <span className="flex items-center gap-1"><Calendar size={10} />{d}</span>}
                  </div>
                  <p className="text-xs text-emerald-600 mt-2 flex items-center gap-0.5 font-semibold">
                    ดูเรื่องราว <ChevronRight size={12} />
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
