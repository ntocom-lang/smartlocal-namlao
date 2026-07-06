import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import {
  ArrowLeft, Calendar, Globe,
  Flag, Users, Trophy, AlertTriangle, CheckSquare, UserCheck, FileText,
} from 'lucide-react'

const STATUS_CFG = {
  planning:  { label: 'วางแผน',        bg: '#f3f4f6', text: '#374151' },
  active:    { label: 'ดำเนินการอยู่',  bg: '#d1fae5', text: '#065f46' },
  completed: { label: 'เสร็จสิ้น',      bg: '#dbeafe', text: '#1e40af' },
  suspended: { label: 'ระงับชั่วคราว',  bg: '#fef3c7', text: '#92400e' },
}

const UPDATE_TYPES = [
  { value: 'milestone',   label: 'เหตุการณ์สำคัญ',    Icon: Flag,          color: '#7c3aed', bg: '#ede9fe' },
  { value: 'meeting',     label: 'ประชุม',              Icon: Users,         color: '#0891b2', bg: '#e0f2fe' },
  { value: 'achievement', label: 'ความสำเร็จ',          Icon: Trophy,        color: '#d97706', bg: '#fef3c7' },
  { value: 'issue',       label: 'ปัญหา/อุปสรรค',      Icon: AlertTriangle, color: '#dc2626', bg: '#fee2e2' },
  { value: 'decision',    label: 'การตัดสินใจ',         Icon: CheckSquare,   color: '#059669', bg: '#d1fae5' },
  { value: 'personnel',   label: 'เปลี่ยนแปลงบุคลากร', Icon: UserCheck,     color: '#db2777', bg: '#fce7f3' },
  { value: 'other',       label: 'อื่นๆ',               Icon: FileText,      color: '#6b7280', bg: '#f3f4f6' },
]
function getTypeCfg(t) { return UPDATE_TYPES.find(u => u.value === t) ?? UPDATE_TYPES[UPDATE_TYPES.length - 1] }

function formatDateTH(dateStr) {
  if (!dateStr) return null
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
}

export default function OrgProjectDetailPage() {
  const { id }      = useParams()
  const { tenant }  = useTenant()
  const navigate    = useNavigate()
  const [project, setProject] = useState(null)
  const [updates, setUpdates] = useState([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!id) return
    Promise.all([
      supabase.from('org_projects').select('*').eq('id', id).eq('is_public', true).single(),
      supabase.from('org_project_updates').select('*').eq('project_id', id)
        .order('update_date', { ascending: false }).order('created_at', { ascending: false }),
    ]).then(([{ data: p, error: pe }, { data: u }]) => {
      if (pe || !p) { setNotFound(true); setLoading(false); return }
      setProject(p)
      setUpdates(u ?? [])
      setLoading(false)
    })
  }, [id])

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh] text-gray-400">
        กำลังโหลด...
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center text-gray-400">
        <p className="text-4xl mb-4">🔍</p>
        <p className="font-semibold text-gray-600">ไม่พบโครงการนี้</p>
        <button onClick={() => navigate('/projects')}
          className="mt-4 text-emerald-600 text-sm flex items-center gap-1 mx-auto hover:underline">
          <ArrowLeft size={14} /> กลับรายการโครงการ
        </button>
      </div>
    )
  }

  const s = STATUS_CFG[project.status] ?? STATUS_CFG.active

  return (
    <div className="max-w-3xl mx-auto pb-16">

      {/* Hero */}
      <div className="relative">
        {project.cover_image_url ? (
          <>
            <img src={project.cover_image_url} className="w-full h-64 md:h-80 object-cover" />
            <div className="absolute inset-0"
              style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.65) 100%)' }} />
          </>
        ) : (
          <div className="w-full h-48 md:h-64 flex items-center justify-center text-6xl"
            style={{ background: 'linear-gradient(135deg, #d1fae5 0%, #6ee7b7 100%)' }}>📋</div>
        )}
        <button onClick={() => navigate('/projects')}
          className={`absolute top-4 left-4 p-2 rounded-xl transition-colors flex items-center gap-1 text-sm font-semibold
            ${project.cover_image_url ? 'bg-black/30 text-white hover:bg-black/50' : 'bg-white/80 text-gray-700 hover:bg-white'}`}>
          <ArrowLeft size={16} /> กลับ
        </button>
        <div className={`absolute bottom-4 left-4 right-4 ${project.cover_image_url ? 'text-white' : 'text-gray-800'}`}>
          {project.category && (
            <span className="text-xs font-bold bg-white/20 backdrop-blur-sm px-2 py-0.5 rounded-full mb-2 inline-block">
              {project.category}
            </span>
          )}
          <h1 className="text-xl md:text-2xl font-bold leading-snug drop-shadow-sm">{project.title}</h1>
          {project.subtitle && <p className="text-sm opacity-80 mt-0.5 drop-shadow-sm">{project.subtitle}</p>}
        </div>
      </div>

      {/* Meta bar */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-100 bg-white">
        <span className="text-xs font-bold px-2.5 py-1 rounded-full"
          style={{ backgroundColor: s.bg, color: s.text }}>{s.label}</span>
        {(project.start_date || project.end_date) && (
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <Calendar size={12} />
            {formatDateTH(project.start_date) ?? 'ไม่ระบุ'}
            {' — '}
            {project.end_date ? formatDateTH(project.end_date) : 'ปัจจุบัน'}
          </span>
        )}
        <span className="flex items-center gap-1 text-xs text-gray-400 ml-auto">
          <Globe size={11} /> สาธารณะ
        </span>
      </div>

      <div className="px-4 space-y-8 mt-6">

        {/* Description / wiki */}
        {project.description && (
          <section>
            <h2 className="font-bold text-gray-700 text-base mb-3">เกี่ยวกับโครงการ</h2>
            <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{project.description}</p>
            </div>
          </section>
        )}

        {/* Timeline */}
        <section>
          <h2 className="font-bold text-gray-700 text-base mb-4">
            เรื่องราวโครงการ
            {updates.length > 0 && (
              <span className="ml-2 text-xs font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                {updates.length} รายการ
              </span>
            )}
          </h2>

          {updates.length === 0 ? (
            <p className="text-gray-400 text-sm">ยังไม่มีเรื่องราวที่บันทึกไว้</p>
          ) : (
            <div className="relative">
              {updates.map((upd, idx) => {
                const cfg  = getTypeCfg(upd.update_type)
                const Icon = cfg.Icon
                const d    = upd.update_date ? new Date(upd.update_date + 'T00:00:00') : null
                const dateStr = d ? d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' }) : ''
                return (
                  <div key={upd.id} className="flex gap-4 mb-6">
                    <div className="flex flex-col items-center shrink-0">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center shadow-sm"
                        style={{ backgroundColor: cfg.bg }}>
                        <Icon size={16} style={{ color: cfg.color }} />
                      </div>
                      {idx < updates.length - 1 && (
                        <div className="w-px flex-1 mt-2" style={{ backgroundColor: '#e5e7eb' }} />
                      )}
                    </div>
                    <div className="pb-2 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: cfg.color }}>{cfg.label}</span>
                        <span className="text-[10px] text-gray-400">{dateStr}</span>
                      </div>
                      <p className="font-semibold text-gray-800 text-sm">{upd.title}</p>
                      {upd.body && (
                        <p className="text-gray-600 text-sm mt-1 whitespace-pre-wrap leading-relaxed">{upd.body}</p>
                      )}
                      {upd.note && (
                        <p className="text-xs text-gray-400 mt-1 italic">{upd.note}</p>
                      )}
                      {upd.photos?.length > 0 && (
                        <div className="flex gap-2 mt-2 flex-wrap">
                          {upd.photos.map((url, i) => (
                            <a key={i} href={url} target="_blank" rel="noreferrer">
                              <img src={url} className="w-20 h-20 object-cover rounded-xl border border-gray-200 hover:opacity-90 transition-opacity" />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

      </div>
    </div>
  )
}
