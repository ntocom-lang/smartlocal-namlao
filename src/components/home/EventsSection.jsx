import { useEffect, useState } from 'react'
import { ArrowRight, MapPin } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import EventDetailModal from '../EventDetailModal'

const CATEGORY_COLOR = {
  'ประชาสัมพันธ์': '#10b981', 'ประชุม': '#3b82f6', 'กำหนดการ': '#f97316',
  'อบรม': '#8b5cf6', 'อื่นๆ': '#6b7280',
}

function daysUntil(dateStr) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(dateStr + 'T00:00:00')
  const diff = Math.round((d - today) / 86400000)
  if (diff === 0) return 'วันนี้'
  if (diff === 1) return 'พรุ่งนี้'
  return `อีก ${diff} วัน`
}

function audienceFilter(role) {
  if (role === 'admin' || role === 'superadmin' || role === 'viewer') return null
  if (role === 'council')    return ['public', 'council']
  if (role === 'staff' || role === 'technician' || role === 'officer') return ['public', 'staff']
  return ['public']
}

export default function EventsSection() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [role, setRole] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return
      supabase.from('profiles').select('role').eq('id', data.session.user.id).single()
        .then(({ data: p }) => setRole(p?.role ?? null))
    })
  }, [])

  useEffect(() => {
    if (!tenant?.id) return
    const today = new Date().toISOString().split('T')[0]
    let query = supabase
      .from('events')
      .select('*')
      .eq('municipality_id', tenant.id)
      .gte('event_date', today)
      .order('event_date', { ascending: true })
      .limit(3)

    const allowed = audienceFilter(role)
    if (allowed !== null) query = query.overlaps('audiences', allowed)

    query.then(({ data }) => {
      setEvents(data ?? [])
      setLoading(false)
    })
  }, [tenant?.id, role])

  if (!loading && events.length === 0) return null

  return (
    <section>
      {selected && <EventDetailModal ev={selected} onClose={() => setSelected(null)} />}

      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-1 h-6 rounded-full" style={{ backgroundColor: 'var(--color-primary)' }} />
          <h2 className="text-base font-bold text-gray-700 dark:text-slate-200">กิจกรรมที่จะมาถึง</h2>
        </div>
        <button
          onClick={() => navigate('/events')}
          className="flex items-center gap-1 text-sm font-medium hover:underline"
          style={{ color: 'var(--color-primary)' }}
        >
          ดูทั้งหมด <ArrowRight size={14} />
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-gray-100 dark:bg-white/5 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((ev) => {
            const color = CATEGORY_COLOR[ev.category] ?? '#6b7280'
            const days = daysUntil(ev.event_date)
            const isToday = days === 'วันนี้'
            const d = new Date(ev.event_date + 'T00:00:00')
            return (
              <button
                key={ev.id}
                onClick={() => setSelected(ev)}
                className="w-full text-left bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-3.5 flex items-center gap-3 active:scale-98 transition-transform"
              >
                <div
                  className="shrink-0 w-12 h-12 rounded-2xl flex flex-col items-center justify-center text-white"
                  style={{ backgroundColor: isToday ? '#ef4444' : color }}
                >
                  <span className="text-[11px] font-bold leading-none">
                    {d.toLocaleDateString('th-TH', { month: 'short' })}
                  </span>
                  <span className="text-lg font-black leading-tight">{d.getDate()}</span>
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-800 dark:text-slate-200 leading-tight line-clamp-2">
                    {ev.title}
                  </p>
                  {ev.location && (
                    <span className="text-xs text-gray-400 flex items-center gap-1 mt-0.5 truncate">
                      <MapPin size={11} /> {ev.location}
                    </span>
                  )}
                </div>

                <div className="shrink-0">
                  <span
                    className="text-xs font-bold px-2.5 py-1 rounded-full"
                    style={{
                      backgroundColor: isToday ? '#fef2f2' : '#f3f4f6',
                      color: isToday ? '#ef4444' : '#6b7280',
                    }}
                  >
                    {days}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
