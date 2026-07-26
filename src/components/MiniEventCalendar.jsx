import { useState, useEffect, useMemo } from 'react'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'

const DAY_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']

const AUDIENCE_COLOR = {
  public:     '#10b981',
  staff:      '#3b82f6',
  management: '#8b5cf6',
  council:    '#f59e0b',
}

const AUDIENCE_LABEL = {
  public:     'ประชาชน',
  staff:      'เจ้าหน้าที่',
  management: 'สภาเทศบาล',
  council:    'สภาเทศบาล',
}

export default function MiniEventCalendar() {
  const { tenant } = useTenant()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [calYear, setCalYear]   = useState(today.getFullYear())
  const [calMonth, setCalMonth] = useState(today.getMonth())
  const [selectedDay, setSelectedDay] = useState(today.getDate())
  const [events, setEvents] = useState([])
  const [dotEvents, setDotEvents] = useState([])

  useEffect(() => {
    if (!tenant?.id) return
    // ดึงกิจกรรม 3 เดือนย้อนหลัง ถึง 3 เดือนข้างหน้า — เห็นเฉพาะที่ตัวเองมีสิทธิ์ (RLS)
    // ใช้กับรายการรายละเอียดของวันที่เลือกเท่านั้น
    const from = new Date(calYear, calMonth - 1, 1).toISOString().split('T')[0]
    const to   = new Date(calYear, calMonth + 2, 0).toISOString().split('T')[0]
    supabase.from('events')
      .select('id, title, event_date, event_time, is_all_day, location, audiences, category')
      .eq('municipality_id', tenant.id)
      .gte('event_date', from)
      .lte('event_date', to)
      .order('event_date', { ascending: true })
      .then(({ data }) => setEvents(data ?? []))
      .catch(() => {})

    // จุดในตารางเดือน — ดึงผ่าน RPC สาธารณะ (วันที่ + กลุ่มเป้าหมายเท่านั้น ไม่มีเนื้อหา)
    // ให้เห็นได้ทุกกลุ่มไม่ว่าจะมีสิทธิ์ดูรายละเอียดหรือไม่
    supabase.rpc('get_event_dots', { p_municipality_id: tenant.id, p_from: from, p_to: to })
      .then(({ data }) => setDotEvents(data ?? []))
      .catch(() => {})
  }, [tenant?.id, calYear, calMonth])

  const eventMap = useMemo(() => {
    const map = {}
    events.forEach(ev => {
      if (!map[ev.event_date]) map[ev.event_date] = []
      map[ev.event_date].push(ev)
    })
    return map
  }, [events])

  const dotMap = useMemo(() => {
    const map = {}
    dotEvents.forEach(ev => {
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

  const dayKey = d =>
    `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

  const selectedEvents = selectedDay ? (eventMap[dayKey(selectedDay)] ?? []) : []

  const monthName = new Date(calYear, calMonth, 1)
    .toLocaleDateString('th-TH', { year: 'numeric', month: 'long' })

  function prevMonth() {
    setSelectedDay(null)
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1) }
    else setCalMonth(m => m - 1)
  }
  function nextMonth() {
    setSelectedDay(null)
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1) }
    else setCalMonth(m => m + 1)
  }

  return (
    <div className="bg-white rounded-[24px] shadow-sm border border-gray-100 p-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth} className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors">
          <ChevronLeft size={18} />
        </button>
        <p className="text-sm font-bold text-gray-800">{monthName}</p>
        <button onClick={nextMonth} className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors">
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_TH.map((label, i) => (
          <div key={label} className={`text-center text-xs font-semibold py-1 ${
            i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-400'
          }`}>
            {label}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-px bg-gray-100 rounded-2xl overflow-hidden border border-gray-100">
        {cells.map((day, idx) => {
          if (!day) return <div key={idx} className="bg-gray-50 min-h-[52px]" />

          const key        = dayKey(day)
          const dayEvs     = dotMap[key] ?? []
          const dow        = (firstDow + day - 1) % 7
          const isToday    = calYear === today.getFullYear() && calMonth === today.getMonth() && day === today.getDate()
          const isSelected = day === selectedDay

          return (
            <button key={idx}
              onClick={() => setSelectedDay(day === selectedDay ? null : day)}
              className={`min-h-[52px] p-1 flex flex-col items-center transition-colors ${
                isSelected ? 'bg-blue-50' : 'bg-white hover:bg-gray-50'
              }`}>
              <span className={`text-xs font-bold w-7 h-7 flex items-center justify-center rounded-full mb-0.5 ${
                isToday    ? 'bg-red-500 text-white'
                : isSelected ? 'text-blue-600'
                : dow === 0 ? 'text-red-400'
                : dow === 6 ? 'text-blue-400'
                : 'text-gray-700'
              }`}>
                {day}
              </span>
              <div className="flex flex-wrap justify-center gap-px max-w-full">
                {dayEvs.slice(0, 3).map((ev, i) => (
                  <span key={i} className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: AUDIENCE_COLOR[ev.audiences?.[0]] ?? '#6b7280' }} />
                ))}
                {dayEvs.length > 3 && (
                  <span className="text-[8px] text-gray-400 font-semibold">+{dayEvs.length - 3}</span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5 px-1">
        {Object.entries(AUDIENCE_COLOR).filter(([k]) => k !== 'council').map(([key, color]) => (
          <div key={key} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
            <span className="text-[11px] text-gray-400">{AUDIENCE_LABEL[key]}</span>
          </div>
        ))}
      </div>

      {/* Selected-day events */}
      {selectedDay && (
        <div className="mt-4">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">
            {new Date(calYear, calMonth, selectedDay).toLocaleDateString('th-TH', {
              weekday: 'long', day: 'numeric', month: 'long',
            })}
          </p>
          {selectedEvents.length === 0 ? (
            <div className="flex items-center gap-2 py-4 justify-center text-gray-300">
              <CalendarDays size={20} strokeWidth={1.2} />
              <p className="text-sm">ไม่มีกิจกรรม</p>
            </div>
          ) : (
            <div className="space-y-2">
              {selectedEvents.map(ev => {
                const audColor = AUDIENCE_COLOR[ev.audiences?.[0]] ?? '#6b7280'
                return (
                  <div key={ev.id}
                    className="bg-gray-50 rounded-xl p-3 border-l-4"
                    style={{ borderLeftColor: audColor }}>
                    <p className="text-sm font-bold text-gray-800 leading-tight">{ev.title}</p>
                    {ev.event_time && !ev.is_all_day && (
                      <p className="text-xs text-gray-500 mt-0.5">⏰ {ev.event_time.slice(0, 5)} น.</p>
                    )}
                    {ev.location && (
                      <p className="text-xs text-gray-500 mt-0.5">📍 {ev.location}</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
