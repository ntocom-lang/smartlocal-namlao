import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CalendarDays, MapPin, Clock, Plus, List, ChevronLeft, ChevronRight, History } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import EventDetailModal from '../components/EventDetailModal'
import { toDateStr } from '../lib/thaiDate'

const CATEGORY_COLOR = {
  'ประชาสัมพันธ์': '#10b981', 'ประชุม': '#3b82f6', 'กำหนดการ': '#f97316',
  'อบรม': '#8b5cf6', 'อื่นๆ': '#6b7280',
}

const AUDIENCE_LABEL = {
  public:     'ประชาชน',
  staff:      'เจ้าหน้าที่',
  management: 'ผู้บริหาร',
  council:    'สภาเทศบาล',
}

const AUDIENCE_COLOR = {
  public:     '#10b981',
  staff:      '#3b82f6',
  management: '#8b5cf6',
  council:    '#f59e0b',
}

const DAY_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']

function audienceFilter(role) {
  if (role === 'admin' || role === 'superadmin' || role === 'viewer') return null
  if (role === 'council') return ['public', 'council']
  if (role === 'staff' || role === 'technician' || role === 'officer') return ['public', 'staff']
  return ['public']
}

// ทุกคนเห็นกิจกรรมในรายการ/ปฏิทินได้หมด (เช็ควันว่างของกลุ่มอื่นได้) แต่กดดูรายละเอียดเต็มได้เฉพาะคนมีสิทธิ์
function canViewEventDetail(ev, role) {
  const allowed = audienceFilter(role)
  return allowed === null || (ev.audiences ?? []).some(a => allowed.includes(a))
}

function CalendarView({ events, dotEvents, onSelectEvent, role }) {
  const todayRef = new Date()
  todayRef.setHours(0, 0, 0, 0)

  const [calYear, setCalYear]   = useState(todayRef.getFullYear())
  const [calMonth, setCalMonth] = useState(todayRef.getMonth())
  const [selectedDay, setSelectedDay] = useState(todayRef.getDate())

  const eventMap = useMemo(() => {
    const map = {}
    events.forEach(ev => {
      if (!map[ev.event_date]) map[ev.event_date] = []
      map[ev.event_date].push(ev)
    })
    return map
  }, [events])

  // จุดในตารางเดือนมาจาก dotEvents (วันที่ + กลุ่มเป้าหมายเท่านั้น ไม่มีเนื้อหา) ที่ทุกคน
  // เห็นได้หมดไม่ว่าจะมีสิทธิ์ดูรายละเอียดหรือไม่ — ต่างจาก eventMap ด้านบนที่ใช้กับ
  // รายการรายละเอียดด้านล่าง ซึ่งยังกรองตามสิทธิ์ตามปกติ
  const dotMap = useMemo(() => {
    const map = {}
    ;(dotEvents ?? []).forEach(ev => {
      if (!map[ev.event_date]) map[ev.event_date] = []
      map[ev.event_date].push(ev)
    })
    return map
  }, [dotEvents])

  const firstDow  = new Date(calYear, calMonth, 1).getDay()
  const totalDays = new Date(calYear, calMonth + 1, 0).getDate()

  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= totalDays; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const prevMonth = () => {
    setSelectedDay(null)
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1) }
    else setCalMonth(m => m - 1)
  }
  const nextMonth = () => {
    setSelectedDay(null)
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1) }
    else setCalMonth(m => m + 1)
  }

  const dayKey = (d) =>
    `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

  const selectedEvents = selectedDay ? (eventMap[dayKey(selectedDay)] ?? []) : []

  const monthName = new Date(calYear, calMonth, 1)
    .toLocaleDateString('th-TH', { year: 'numeric', month: 'long' })

  return (
    <div className="mt-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={prevMonth}
          className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500 transition-colors"
        >
          <ChevronLeft size={20} />
        </button>
        <p className="text-sm font-bold text-gray-800 dark:text-slate-200">{monthName}</p>
        <button
          onClick={nextMonth}
          className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500 transition-colors"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_TH.map((label, i) => (
          <div
            key={label}
            className={`text-center text-xs font-semibold py-1 ${
              i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-400'
            }`}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-px bg-gray-100 dark:bg-white/10 rounded-2xl overflow-hidden border border-gray-100 dark:border-white/10">
        {cells.map((day, idx) => {
          if (!day) {
            return (
              <div
                key={idx}
                className="bg-gray-50 dark:bg-gray-900/60 min-h-13"
              />
            )
          }
          const key       = dayKey(day)
          const dayEvs    = dotMap[key] ?? []
          const dow       = (firstDow + day - 1) % 7
          const isToday   = calYear === todayRef.getFullYear() && calMonth === todayRef.getMonth() && day === todayRef.getDate()
          const isSelected = day === selectedDay

          return (
            <button
              key={idx}
              onClick={() => setSelectedDay(day === selectedDay ? null : day)}
              className={`min-h-13 p-1 flex flex-col items-center transition-colors ${
                isSelected
                  ? 'bg-blue-50 dark:bg-blue-900/30'
                  : 'bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-white/5'
              }`}
            >
              <span
                className={`text-xs font-bold w-7 h-7 flex items-center justify-center rounded-full mb-0.5 ${
                  isToday
                    ? 'bg-red-500 text-white'
                    : isSelected
                    ? 'text-blue-600 dark:text-blue-400'
                    : dow === 0
                    ? 'text-red-400'
                    : dow === 6
                    ? 'text-blue-400'
                    : 'text-gray-700 dark:text-slate-300'
                }`}
              >
                {day}
              </span>
              <div className="flex flex-wrap justify-center gap-px max-w-full">
                {dayEvs.slice(0, 3).map((ev, i) => (
                  <span
                    key={i}
                    className="w-2 h-2 rounded-full shadow-sm"
                    style={{ backgroundColor: AUDIENCE_COLOR[ev.audiences?.[0]] ?? '#6b7280' }}
                  />
                ))}
                {dayEvs.length > 3 && (
                  <span className="text-[9px] text-gray-400 leading-none font-semibold">
                    +{dayEvs.length - 3}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 px-1">
        {Object.entries(AUDIENCE_COLOR).map(([key, color]) => (
          <div key={key} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
            <span className="text-[11px] text-gray-400">
              {AUDIENCE_LABEL[key] ?? key}
            </span>
          </div>
        ))}
      </div>

      {/* Selected-day events */}
      {selectedDay && (
        <div className="mt-5">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">
            {new Date(calYear, calMonth, selectedDay).toLocaleDateString('th-TH', {
              weekday: 'long', day: 'numeric', month: 'long',
            })}
          </p>
          {selectedEvents.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-gray-300">
              <CalendarDays size={32} strokeWidth={1.2} className="mb-2" />
              <p className="text-sm">ไม่มีกิจกรรม</p>
            </div>
          ) : (
            <div className="space-y-2">
              {selectedEvents.map(ev => {
                const color    = CATEGORY_COLOR[ev.category] ?? '#6b7280'
                const canView  = canViewEventDetail(ev, role)
                return (
                  <button
                    key={ev.id}
                    onClick={canView ? () => onSelectEvent(ev) : undefined}
                    className={`w-full text-left bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-4 flex gap-3 transition-transform${canView ? ' active:scale-98' : ' cursor-default opacity-70'}`}
                    style={{ borderLeftColor: color, borderLeftWidth: 3 }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                        <span
                          className="text-[11px] font-semibold px-2 py-0.5 rounded-full text-white"
                          style={{ backgroundColor: color }}
                        >
                          {ev.category}
                        </span>
                        {(ev.audiences ?? []).map(v => {
                          const audColor = AUDIENCE_COLOR[v] ?? '#6b7280'
                          return (
                            <span key={v}
                              className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                              style={{ backgroundColor: audColor + '20', color: audColor }}
                            >
                              {v !== 'public' && '🔒 '}{AUDIENCE_LABEL[v] ?? v}
                            </span>
                          )
                        })}
                      </div>
                      <p className="text-sm font-bold text-gray-800 dark:text-slate-200 leading-tight">
                        {ev.title}
                      </p>
                      {!ev.is_all_day && ev.event_time && (
                        <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                          <Clock size={11} />
                          {ev.event_time.slice(0, 5)}
                          {ev.end_time ? ` – ${ev.end_time.slice(0, 5)}` : ''} น.
                        </p>
                      )}
                      {canView && ev.location && (
                        <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                          <MapPin size={11} /> {ev.location}
                        </p>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function EventsPage() {
  const { tenant } = useTenant()
  const navigate   = useNavigate()
  const [events, setEvents]   = useState([])
  const [dotEvents, setDotEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [role, setRole]       = useState(null)
  const [selected, setSelected] = useState(null)
  const [canEdit, setCanEdit] = useState(false)
  const [view, setView]       = useState(() => (typeof window !== 'undefined' && window.innerWidth < 768 ? 'calendar' : 'list'))
  const [selectedAudience, setSelectedAudience] = useState(null) // null = ทั้งหมด
  const [activeTab, setActiveTab] = useState('upcoming') // 'upcoming' | 'past'

  function handleSelectEvent(ev) {
    if (canViewEventDetail(ev, role)) setSelected(ev)
  }

  useEffect(() => {
    document.querySelector('main')?.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return
      supabase.from('profiles').select('role').eq('id', data.session.user.id).single()
        .then(({ data: p }) => {
          const r = p?.role ?? ''
          setRole(r)
          setCanEdit(r === 'admin' || r === 'superadmin' || r === 'officer' || r === 'council' || r === 'viewer' || r === 'staff')
        })
    })
  }, [])

  useEffect(() => {
    if (!tenant?.id) return
    const threeMonthsAgo = new Date()
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
    let query = supabase
      .from('events')
      .select('*, creator:profiles!events_created_by_fkey(full_name)')
      .eq('municipality_id', tenant.id)
      .gte('event_date', toDateStr(threeMonthsAgo))
      .order('event_date', { ascending: true })

    // ทุกคนดึงกิจกรรมมาแสดงในรายการ/ปฏิทินได้หมด (เช็ควันว่างของกลุ่มอื่นได้)
    // กดดูรายละเอียดเต็มได้เฉพาะคนมีสิทธิ์ตาม audience — ดู canViewEventDetail
    query.then(({ data }) => {
      const sorted = (data ?? []).sort((a, b) => {
        if (a.event_date < b.event_date) return -1
        if (a.event_date > b.event_date) return 1
        const ta = a.event_time ?? '99:99'
        const tb = b.event_time ?? '99:99'
        if (ta < tb) return -1
        if (ta > tb) return 1
        return new Date(a.created_at) - new Date(b.created_at)
      })
      setEvents(sorted)
    })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [tenant?.id, role])

  // จุดปฏิทิน (วันที่ + กลุ่มเป้าหมายเท่านั้น ไม่มีชื่อ/สถานที่/รายละเอียด) — ดึงผ่าน RPC
  // ที่เปิดให้ทุกคนเรียกได้โดยไม่ต้องมีสิทธิ์ตาม audience เพื่อให้เห็นว่า "มีกิจกรรมวันไหนบ้าง"
  // ได้ครบทุกกลุ่ม ส่วนรายละเอียดจริงยังกรองตามสิทธิ์ปกติผ่าน `events` ด้านบน
  useEffect(() => {
    if (!tenant?.id) return
    const from = new Date()
    from.setMonth(from.getMonth() - 3)
    const to = new Date()
    to.setMonth(to.getMonth() + 12)
    supabase.rpc('get_event_dots', {
      p_municipality_id: tenant.id,
      p_from: toDateStr(from),
      p_to: toDateStr(to),
    }).then(({ data }) => setDotEvents(data ?? []))
      .catch(() => {})
  }, [tenant?.id])

  function goToAddEvent() {
    navigate('/staff', { state: { module: 'events' } })
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // ตัวกรอง "กลุ่ม" ให้เลือกได้ทุกกลุ่มเสมอ (ดูแค่ว่าวันไหนไม่ว่างได้ แม้ดูรายละเอียดไม่ได้)
  const allAudienceKeys = Object.keys(AUDIENCE_LABEL)

  // กรองตาม chip ที่เลือก
  const filteredEvents = selectedAudience
    ? events.filter(ev => ev.audiences?.includes(selectedAudience))
    : events

  const filteredDotEvents = selectedAudience
    ? dotEvents.filter(ev => ev.audiences?.includes(selectedAudience))
    : dotEvents

  const upcomingEvents = useMemo(() => {
    return filteredEvents.filter(ev => {
      const d = new Date(ev.event_date + 'T00:00:00')
      return d >= today
    })
  }, [filteredEvents, today])

  const pastEvents = useMemo(() => {
    return filteredEvents.filter(ev => {
      const d = new Date(ev.event_date + 'T00:00:00')
      return d < today
    })
  }, [filteredEvents, today])

  const sortedPastEvents = useMemo(() => {
    return [...pastEvents].sort((a, b) => new Date(b.event_date) - new Date(a.event_date))
  }, [pastEvents])

  const listEvents = activeTab === 'upcoming' ? upcomingEvents : sortedPastEvents

  const grouped = listEvents.reduce((acc, ev) => {
    const d   = new Date(ev.event_date + 'T00:00:00')
    const key = d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long' })
    if (!acc[key]) acc[key] = []
    acc[key].push(ev)
    return acc
  }, {})

  const tabSwitcher = (
    <div className="flex bg-gray-100 dark:bg-white/10 rounded-2xl p-1">
      <button
        onClick={() => setActiveTab('upcoming')}
        className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all duration-200 flex items-center justify-center gap-1.5 ${
          activeTab === 'upcoming'
            ? 'bg-white dark:bg-white/20 shadow-sm'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-slate-200'
        }`}
        style={activeTab === 'upcoming' ? { color: 'var(--color-primary)' } : {}}
      >
        <CalendarDays size={14} />
        กิจกรรมเร็วๆ นี้ ({upcomingEvents.length})
      </button>
      <button
        onClick={() => setActiveTab('past')}
        className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all duration-200 flex items-center justify-center gap-1.5 ${
          activeTab === 'past'
            ? 'bg-white dark:bg-white/20 shadow-sm'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-slate-200'
        }`}
        style={activeTab === 'past' ? { color: 'var(--color-primary)' } : {}}
      >
        <History size={14} />
        กิจกรรมที่ผ่านมา ({pastEvents.length})
      </button>
    </div>
  )

  const eventList = listEvents.length === 0 ? (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
      <CalendarDays size={40} strokeWidth={1.2} className="mb-3" />
      <p className="text-sm">
        {selectedAudience
          ? `ไม่มีกิจกรรมสำหรับ "${AUDIENCE_LABEL[selectedAudience]}"`
          : activeTab === 'past' ? 'ไม่มีกิจกรรมที่ผ่านมาแล้ว' : 'ยังไม่มีกิจกรรมเร็วๆ นี้'}
      </p>
      {selectedAudience && (
        <button onClick={() => setSelectedAudience(null)} className="mt-2 text-xs text-blue-500 underline">
          ดูทั้งหมด
        </button>
      )}
    </div>
  ) : (
    <div className="space-y-6">
      {Object.entries(grouped).map(([month, evs]) => (
        <div key={month}>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">{month}</p>
          <div className="space-y-2">
            {evs.map((ev) => {
              const color       = CATEGORY_COLOR[ev.category] ?? '#6b7280'
              const d           = new Date(ev.event_date + 'T00:00:00')
              const isPast      = d < today
              const diffDays    = Math.round((d - today) / (1000 * 60 * 60 * 24))
              const hasEndDate  = ev.end_date && ev.end_date !== ev.event_date
              const dEnd        = hasEndDate ? new Date(ev.end_date + 'T00:00:00') : null
              const sameMonth   = dEnd && d.getMonth() === dEnd.getMonth()
              const canView     = canViewEventDetail(ev, role)
              return (
                <button
                  key={ev.id}
                  onClick={canView ? () => handleSelectEvent(ev) : undefined}
                  className={`w-full text-left bg-white dark:bg-white/5 rounded-2xl border shadow-sm p-4 flex gap-4 transition-transform ${
                    canView ? 'active:scale-98' : 'cursor-default'
                  } ${
                    isPast || !canView
                      ? 'opacity-50 border-gray-100 dark:border-white/10'
                      : 'border-gray-100 dark:border-white/10'
                  }`}
                  style={!isPast ? { borderLeftColor: color, borderLeftWidth: 3 } : {}}
                >
                  <div className="shrink-0 text-center w-12">
                    <p className="text-xs text-gray-400">{d.toLocaleDateString('th-TH', { weekday: 'short' })}</p>
                    {hasEndDate ? (
                      <p className="text-base font-black leading-tight" style={{ color: isPast ? '#9ca3af' : color }}>
                        {d.getDate()}–{dEnd.getDate()}
                      </p>
                    ) : (
                      <p className="text-2xl font-black leading-tight" style={{ color: isPast ? '#9ca3af' : color }}>
                        {d.getDate()}
                      </p>
                    )}
                    <p className="text-xs text-gray-400">
                      {hasEndDate && !sameMonth
                        ? `${d.toLocaleDateString('th-TH', { month: 'short' })}–${dEnd.toLocaleDateString('th-TH', { month: 'short' })}`
                        : d.toLocaleDateString('th-TH', { month: 'short' })}
                    </p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                      <span
                        className="text-[11px] font-semibold px-2 py-0.5 rounded-full text-white"
                        style={{ backgroundColor: color }}
                      >
                        {ev.category}
                      </span>
                      {(ev.audiences ?? []).map(v => {
                        const audColor = AUDIENCE_COLOR[v] ?? '#6b7280'
                        return (
                          <span key={v}
                            className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: audColor + '20', color: audColor }}
                          >
                            {v !== 'public' && '🔒 '}{AUDIENCE_LABEL[v] ?? v}
                          </span>
                        )
                      })}
                      {isPast ? (
                        <span className="text-[11px] text-gray-400 font-medium">ผ่านไปแล้ว</span>
                      ) : (
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                          diffDays === 0 ? 'bg-red-50 text-red-600 dark:bg-red-500/20 dark:text-red-400' :
                          diffDays <= 3 ? 'bg-orange-50 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400' :
                          'bg-blue-50 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400'
                        }`}>
                          {diffDays === 0 ? 'วันนี้' : diffDays === 1 ? 'พรุ่งนี้' : `อีก ${diffDays} วัน`}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-bold text-gray-800 dark:text-slate-200 leading-tight">{ev.title}</p>
                    {!ev.is_all_day && ev.event_time && (
                      <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                        <Clock size={11} />
                        {ev.event_time.slice(0, 5)}{ev.end_time ? ` – ${ev.end_time.slice(0, 5)}` : ''} น.
                      </p>
                    )}
                    {hasEndDate && (
                      <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                        <span>📅</span>
                        {d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} – {dEnd.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                        {` (${Math.round((dEnd - d) / 86400000) + 1} วัน)`}
                      </p>
                    )}
                    {canView && ev.location && (
                      <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                        <MapPin size={11} /> {ev.location}
                      </p>
                    )}
                    {canView && ev.description && (
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
  )

  return (
    <div className="max-w-6xl mx-auto px-4 pb-24 md:pb-8">
      {selected && <EventDetailModal ev={selected} onClose={() => setSelected(null)} canEdit={canEdit} />}

      {/* Mobile sticky header */}
      <div className="md:hidden sticky top-0 z-30 bg-gray-50/95 dark:bg-transparent backdrop-blur-md pt-3 pb-2 -mx-4 px-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate(-1)}
              className="p-2 -ml-1 rounded-xl hover:bg-gray-200/60 text-gray-500 transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <h1 className="text-base font-bold text-gray-800 dark:text-slate-200">ปฏิทินกิจกรรม</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setView(view === 'list' ? 'calendar' : 'list')}
              className="flex items-center justify-center gap-1.5 w-[92px] h-[36px] bg-linear-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white rounded-xl shadow-md shadow-blue-500/20 transition-all active:scale-95"
              title={view === 'list' ? 'มุมมองปฏิทิน' : 'มุมมองรายการ'}
            >
              {view === 'list' ? (
                <><CalendarDays size={16} /><span className="text-sm font-bold">ตาราง</span></>
              ) : (
                <><List size={16} /><span className="text-sm font-bold">รายการ</span></>
              )}
            </button>
            {canEdit && (
              <button
                onClick={goToAddEvent}
                className="flex items-center justify-center gap-1.5 w-[92px] h-[36px] rounded-xl text-sm font-bold text-white transition-all active:scale-95 shadow-sm"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                <Plus size={16} /> เพิ่ม
              </button>
            )}
          </div>
        </div>
      </div>

      {/* PC header */}
      <div className="hidden md:flex items-center justify-between pt-6 pb-4 border-b border-gray-100 dark:border-white/10 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-2xl shrink-0"
               style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #4f46e5 100%)' }}>
            📅
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-200">ปฏิทินกิจกรรม</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">กิจกรรมและงานสำคัญของหน่วยงาน</p>
          </div>
        </div>
        {canEdit && (
          <button
            onClick={goToAddEvent}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold text-white shadow-sm transition-all hover:opacity-90"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            <Plus size={16} /> เพิ่มกิจกรรมในปฏิทิน
          </button>
        )}
      </div>

      {/* Audience filter chips */}
      {!loading && (
        <div className="flex flex-wrap gap-2 mt-3 pb-1">
          <button
            onClick={() => setSelectedAudience(null)}
            className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
              selectedAudience === null
                ? 'bg-gray-700 text-white border-gray-700 dark:bg-slate-200 dark:text-gray-900 dark:border-slate-200'
                : 'bg-white dark:bg-white/5 text-gray-500 border-gray-200 dark:border-white/10 hover:border-gray-400'
            }`}
          >
            ทั้งหมด
          </button>
          {allAudienceKeys.map(key => (
            <button
              key={key}
              onClick={() => setSelectedAudience(selectedAudience === key ? null : key)}
              className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                selectedAudience === key
                  ? 'text-white border-transparent'
                  : 'bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 hover:border-gray-400'
              }`}
              style={selectedAudience === key
                ? { backgroundColor: AUDIENCE_COLOR[key] }
                : { color: AUDIENCE_COLOR[key] }
              }
            >
              {AUDIENCE_LABEL[key]}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="space-y-3 mt-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-gray-100 dark:bg-white/5 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <div className="md:grid md:grid-cols-[1fr_1.3fr] md:gap-8 md:mt-4">

            {/* Calendar column */}
            <div className={view === 'calendar' ? 'mt-0' : 'hidden md:block'}>
              {filteredEvents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-300">
                  <CalendarDays size={40} strokeWidth={1.2} className="mb-3" />
                  <p className="text-sm">ยังไม่มีกิจกรรม</p>
                </div>
              ) : (
                <CalendarView events={filteredEvents} dotEvents={filteredDotEvents} onSelectEvent={handleSelectEvent} role={role} />
              )}
            </div>

            {/* List / Table column */}
            <div className="mt-4 md:mt-0">
              <div className="mb-4">{tabSwitcher}</div>
              {eventList}
            </div>

          </div>
        </>
      )}
    </div>
  )
}
