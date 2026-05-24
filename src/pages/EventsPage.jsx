import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CalendarDays, MapPin, Clock, Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import EventDetailModal from '../components/EventDetailModal'

const CATEGORY_COLOR = {
  'ประชุม': '#3b82f6', 'งานบุญ': '#f59e0b', 'ตลาดนัด': '#10b981',
  'กีฬา': '#ef4444', 'ฝึกอบรม': '#8b5cf6', 'อื่นๆ': '#6b7280',
}

export default function EventsPage() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [canEdit, setCanEdit] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return
      supabase.from('profiles').select('role').eq('id', data.session.user.id).single()
        .then(({ data: p }) => {
          const r = p?.role ?? ''
          setCanEdit(r === 'admin' || r === 'superadmin' || r === 'viewer')
        })
    })
  }, [])

  useEffect(() => {
    if (!tenant?.id) return
    const threeMonthsAgo = new Date()
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
    supabase
      .from('events')
      .select('*')
      .eq('municipality_id', tenant.id)
      .gte('event_date', threeMonthsAgo.toISOString().split('T')[0])
      .order('event_date', { ascending: true })
      .then(({ data }) => {
        setEvents(data ?? [])
        setLoading(false)
      })
  }, [tenant?.id])

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const grouped = events.reduce((acc, ev) => {
    const d = new Date(ev.event_date + 'T00:00:00')
    const key = d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long' })
    if (!acc[key]) acc[key] = []
    acc[key].push(ev)
    return acc
  }, {})

  return (
    <div className="max-w-2xl mx-auto px-4 pb-24">
      {selected && <EventDetailModal ev={selected} onClose={() => setSelected(null)} />}
      <div className="sticky top-0 z-30 bg-gray-50/95 dark:bg-transparent backdrop-blur-md pt-3 pb-2 -mx-4 px-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate(-1)}
              className="p-2 -ml-1 rounded-xl hover:bg-gray-200/60 text-gray-500 transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <h1 className="text-base font-bold text-gray-800 dark:text-slate-200">ปฏิทินกิจกรรมชุมชน</h1>
          </div>
          {canEdit && (
            <button
              onClick={() => navigate('/admin', { state: { page: 'events' } })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-bold text-white"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              <Plus size={15} /> เพิ่มกิจกรรม
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3 mt-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-gray-100 dark:bg-white/5 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <CalendarDays size={48} strokeWidth={1.2} className="mb-3" />
          <p className="text-sm">ยังไม่มีกิจกรรม</p>
        </div>
      ) : (
        <div className="mt-4 space-y-6">
          {Object.entries(grouped).map(([month, evs]) => (
            <div key={month}>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">{month}</p>
              <div className="space-y-2">
                {evs.map((ev) => {
                  const color = CATEGORY_COLOR[ev.category] ?? '#6b7280'
                  const d = new Date(ev.event_date + 'T00:00:00')
                  const isPast = d < today
                  return (
                    <button
                      key={ev.id}
                      onClick={() => setSelected(ev)}
                      className={`w-full text-left bg-white dark:bg-white/5 rounded-2xl border shadow-sm p-4 flex gap-4 active:scale-98 transition-transform ${isPast ? 'opacity-50 border-gray-100 dark:border-white/10' : 'border-gray-100 dark:border-white/10'}`}
                      style={!isPast ? { borderLeftColor: color, borderLeftWidth: 3 } : {}}
                    >
                      <div className="shrink-0 text-center w-12">
                        <p className="text-xs text-gray-400">{d.toLocaleDateString('th-TH', { weekday: 'short' })}</p>
                        <p className="text-2xl font-black leading-tight" style={{ color: isPast ? '#9ca3af' : color }}>
                          {d.getDate()}
                        </p>
                        <p className="text-xs text-gray-400">{d.toLocaleDateString('th-TH', { month: 'short' })}</p>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span
                            className="text-[11px] font-semibold px-2 py-0.5 rounded-full text-white"
                            style={{ backgroundColor: color }}
                          >
                            {ev.category}
                          </span>
                          {isPast && <span className="text-[11px] text-gray-400 font-medium">ผ่านไปแล้ว</span>}
                        </div>
                        <p className="text-sm font-bold text-gray-800 dark:text-slate-200 leading-tight">{ev.title}</p>
                        {!ev.is_all_day && ev.event_time && (
                          <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                            <Clock size={11} /> {ev.event_time.slice(0, 5)} น.
                            {ev.end_date && ev.end_date !== ev.event_date && (
                              <> – {new Date(ev.end_date + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}</>
                            )}
                          </p>
                        )}
                        {ev.location && (
                          <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                            <MapPin size={11} /> {ev.location}
                          </p>
                        )}
                        {ev.description && (
                          <p className="text-xs text-gray-400 mt-1.5 leading-relaxed line-clamp-2">{ev.description}</p>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
