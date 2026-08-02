import { useState, useEffect, useRef, useMemo } from 'react'
import { Loader2, Plus, X, Pencil, Trash2, ChevronLeft, ChevronRight, Paperclip, CalendarDays, Tag, Users, Check, ChevronUp, Link2, CheckCheck, Image, FileText, Sparkles, Clock, MapPin, List } from 'lucide-react'
import { supabase, supabaseUrl } from '../../lib/supabase'
import { notifyTelegram } from '../../lib/notifyTelegram'
import { logAction } from '../../lib/auditLog'
import { extractEventFromFile } from '../../lib/geminiChat'

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = ['00', '15', '30', '45']

function daysUntil(dateStr) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(dateStr + 'T00:00:00')
  const diff = Math.round((d - today) / 86400000)
  if (diff === 0) return 'วันนี้'
  if (diff === 1) return 'พรุ่งนี้'
  if (diff < 0) return `${Math.abs(diff)} วันที่แล้ว`
  return `อีก ${diff} วัน`
}

function TimeSelect({ value, onChange, required }) {
  const [h, m] = value ? value.split(':') : ['', '']
  const isCustomM = !!m && !MINUTES.includes(m)
  const [customMode, setCustomMode] = useState(false)
  const showCustom = customMode || isCustomM

  const set = (nh, nm) => {
    if (!nh) return onChange('')
    onChange(`${nh}:${nm || '00'}`)
  }

  return (
    <div className="flex items-center gap-1">
      <select value={h || ''} onChange={e => set(e.target.value, m)} required={required}
        className="flex-1 px-2 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400">
        <option value="">ชม.</option>
        {HOURS.map(v => <option key={v} value={v}>{v}</option>)}
      </select>
      <span className="text-gray-400 text-sm font-bold">:</span>
      {showCustom ? (
        <div className="flex items-center gap-1 flex-1">
          <input
            type="number" min="0" max="59"
            value={m || ''}
            onChange={e => {
              const n = Number(e.target.value)
              if (e.target.value === '' || (n >= 0 && n <= 59))
                set(h || '08', String(n).padStart(2, '0'))
            }}
            placeholder="00"
            className="w-full px-2 py-2.5 rounded-xl border border-blue-300 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400"
          />
          <button type="button" title="กลับ"
            onClick={() => { setCustomMode(false); set(h || '08', '00') }}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none px-0.5">↩</button>
        </div>
      ) : (
        <select value={m || ''}
          onChange={e => {
            if (e.target.value === '__custom__') { setCustomMode(true); return }
            set(h || '08', e.target.value)
          }}
          required={required}
          className="flex-1 px-2 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400">
          <option value="">นาที</option>
          {MINUTES.map(v => <option key={v} value={v}>{v}</option>)}
          <option value="__custom__">ระบุ...</option>
        </select>
      )}
    </div>
  )
}

const EVENTS_CATEGORIES = ['ประชาสัมพันธ์', 'ประชุม', 'กำหนดการ', 'อบรม', 'อื่นๆ']
const EVENTS_CATEGORY_COLOR = {
  'ประชาสัมพันธ์': '#10b981', 'ประชุม': '#3b82f6', 'กำหนดการ': '#f97316',
  'อบรม': '#8b5cf6', 'อื่นๆ': '#6b7280',
}
const AUDIENCE_OPTIONS = [
  { value: 'public',     label: 'ประชาชน',                 color: '#10b981' },
  { value: 'staff',      label: 'เจ้าหน้าที่',              color: '#3b82f6' },
  { value: 'management', label: 'ผู้บริหาร',                color: '#8b5cf6' },
  { value: 'council',    label: 'สภาเทศบาล',               color: '#f59e0b' },
]
const EVENT_MANAGER_ROLES = ['superadmin', 'admin', 'viewer', 'council', 'officer', 'staff', 'technician', 'kamnan']
const EMPTY_EVENT_FORM = { title: '', description: '', event_date: '', event_time: '', end_time: '', end_date: '', location: '', category: '', customCategory: '', is_all_day: false, audiences: [], attachment_urls: [], attachment_files: [] }

// backward-compat: event เก่าเก็บไฟล์แนบเดียวใน attachment_url, ของใหม่เก็บหลายไฟล์ใน attachment_urls
function eventAttachments(ev) {
  if (ev.attachment_urls?.length > 0) return ev.attachment_urls
  return ev.attachment_url ? [ev.attachment_url] : []
}

// บุคลากรภายในเทศบาลเดียวกันเห็นรายละเอียดปฏิทินร่วมกัน ส่วน citizen เห็นเฉพาะรายการ public
function audienceFilter(role) {
  if (EVENT_MANAGER_ROLES.includes(role)) return null
  return ['public']
}
function canViewEventDetail(ev, role, currentUserId) {
  if (currentUserId && ev.created_by === currentUserId) return true
  const allowed = audienceFilter(role)
  return allowed === null || (ev.audiences ?? []).some(a => allowed.includes(a))
}

function EventCard({ ev, onEdit, onDelete, onView, deleting }) {
  const [confirmDel, setConfirmDel] = useState(false)
  const color = EVENTS_CATEGORY_COLOR[ev.category] ?? '#6b7280'
  const days = ev.event_date ? daysUntil(ev.event_date) : null
  const daysColor = days === 'วันนี้' ? '#ef4444' : days?.includes('ที่แล้ว') ? '#9ca3af' : days === 'พรุ่งนี้' ? '#f97316' : '#3b82f6'
  const d = ev.event_date ? new Date(ev.event_date + 'T00:00:00') : null
  const hasEndDate = ev.end_date && ev.end_date !== ev.event_date
  const dEnd = hasEndDate ? new Date(ev.end_date + 'T00:00:00') : null
  const fmtDate = (dt) => dt.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short' })
  const dateStr = !d
    ? 'ยังไม่ระบุวันที่'
    : hasEndDate
    ? `${fmtDate(d)} – ${fmtDate(dEnd)}`
    : d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })

  return (
    <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex gap-3${onView ? ' cursor-pointer hover:border-blue-200 active:scale-[0.99] transition-all' : ''}`}
      onClick={onView ? () => onView(ev) : undefined}>
      <div className="w-1 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold text-white"
                style={{ backgroundColor: color }}>
                {ev.category}
              </span>
              {(ev.audiences ?? []).map(v => {
                const aud = AUDIENCE_OPTIONS.find(a => a.value === v)
                return aud ? (
                  <span key={v} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border"
                    style={{ color: aud.color, borderColor: aud.color, backgroundColor: aud.color + '18' }}>
                    {v !== 'public' ? '🔒 ' : '👥 '}{aud.label}
                  </span>
                ) : null
              })}
              {days && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold text-white"
                  style={{ backgroundColor: daysColor }}>
                  {days}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-bold text-gray-800 leading-tight">{ev.title}</p>
              {eventAttachments(ev).length > 0 && <Paperclip size={12} className="text-gray-400 shrink-0" />}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              {dateStr}
              {!ev.is_all_day && ev.event_time
                ? ` · ${ev.event_time.slice(0, 5)}${ev.end_time ? ` – ${ev.end_time.slice(0, 5)}` : ''} น.`
                : ''}
            </p>
            {ev.location && <p className="text-xs text-gray-400 mt-0.5">📍 {ev.location}</p>}
            {ev.creator?.full_name && (
              <p className="text-xs text-gray-400 mt-0.5">✍️ {ev.creator.full_name}</p>
            )}
            {ev.description && (
              <p className="text-xs text-gray-500 mt-1 leading-relaxed line-clamp-2">{ev.description}</p>
            )}
          </div>
          {onEdit && (
            <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => onEdit(ev)}
                className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400 transition-colors">
                <Pencil size={14} />
              </button>
              {confirmDel ? (
                <div className="flex gap-1">
                  <button onClick={() => { onDelete(ev.id); setConfirmDel(false) }} disabled={deleting === ev.id}
                    className="px-2 py-1 rounded-lg bg-red-500 text-white text-xs font-bold">
                    {deleting === ev.id ? '...' : 'ลบ'}
                  </button>
                  <button onClick={() => setConfirmDel(false)}
                    className="px-2 py-1 rounded-lg bg-gray-100 text-gray-600 text-xs">
                    ยกเลิก
                  </button>
                </div>
              ) : (
                <button onClick={() => setConfirmDel(true)}
                  className="p-1.5 rounded-xl hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function AdminCalendarView({ events, onSelectEvent, onEdit, onDelete, canManage, openAdd }) {
  const todayRef = useMemo(() => {
    const t = new Date()
    t.setHours(0, 0, 0, 0)
    return t
  }, [])

  const [calYear, setCalYear]   = useState(todayRef.getFullYear())
  const [calMonth, setCalMonth] = useState(todayRef.getMonth())
  const [selectedDay, setSelectedDay] = useState(todayRef.getDate())

  const eventMap = useMemo(() => {
    const map = {}
    events.forEach(ev => {
      if (!ev.event_date) return
      if (!map[ev.event_date]) map[ev.event_date] = []
      map[ev.event_date].push(ev)
    })
    return map
  }, [events])

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

  const AUDIENCE_COLOR = {
    public:     '#10b981',
    staff:      '#3b82f6',
    management: '#8b5cf6',
    council:    '#f59e0b',
  }
  const AUDIENCE_LABEL = {
    public:     'ประชาชน',
    staff:      'เจ้าหน้าที่',
    management: 'ผู้บริหาร',
    council:    'สภาเทศบาล',
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 space-y-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={prevMonth}
          className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors"
        >
          <ChevronLeft size={20} />
        </button>
        <p className="text-base font-bold text-gray-800">{monthName}</p>
        <button
          type="button"
          onClick={nextMonth}
          className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 mb-1">
        {['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map((label, i) => (
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
      <div className="grid grid-cols-7 gap-px bg-gray-100 rounded-2xl overflow-hidden border border-gray-100">
        {cells.map((day, idx) => {
          if (!day) {
            return (
              <div
                key={idx}
                className="bg-gray-50 min-h-12"
              />
            )
          }
          const key       = dayKey(day)
          const dayEvs    = eventMap[key] ?? []
          const dow       = (firstDow + day - 1) % 7
          const isToday   = calYear === todayRef.getFullYear() && calMonth === todayRef.getMonth() && day === todayRef.getDate()
          const isSelected = day === selectedDay

          return (
            <button
              key={idx}
              type="button"
              onClick={() => setSelectedDay(day === selectedDay ? null : day)}
              className={`min-h-12 p-1 flex flex-col items-center transition-colors ${
                isSelected
                  ? 'bg-blue-50'
                  : 'bg-white hover:bg-gray-50'
              }`}
            >
              <span
                className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full mb-0.5 ${
                  isToday
                    ? 'bg-red-500 text-white'
                    : isSelected
                    ? 'text-blue-600 font-extrabold'
                    : dow === 0
                    ? 'text-red-400'
                    : dow === 6
                    ? 'text-blue-400'
                    : 'text-gray-700'
                }`}
              >
                {day}
              </span>
              <div className="flex flex-wrap justify-center gap-px max-w-full">
                {dayEvs.slice(0, 3).map((ev, i) => (
                  <span
                    key={i}
                    className="w-2 h-2 rounded-full shadow-xs"
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
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1 px-1">
        {Object.entries(AUDIENCE_COLOR).map(([key, color]) => (
          <div key={key} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
            <span className="text-[11px] text-gray-500">
              {AUDIENCE_LABEL[key] ?? key}
            </span>
          </div>
        ))}
      </div>

      {/* Selected-day events list */}
      {selectedDay && (
        <div className="mt-4 pt-3 border-t border-gray-100">
          <div className="flex items-center justify-between mb-3 px-1">
            <p className="text-xs font-bold text-gray-600">
              {new Date(calYear, calMonth, selectedDay).toLocaleDateString('th-TH', {
                weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
              })}
            </p>
            {canManage && (
              <button
                type="button"
                onClick={openAdd}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1"
              >
                <Plus size={13} /> เพิ่มกิจกรรมวันนี้
              </button>
            )}
          </div>
          {selectedEvents.length === 0 ? (
            <div className="flex flex-col items-center py-6 text-gray-400">
              <CalendarDays size={28} strokeWidth={1.2} className="mb-1 text-gray-300" />
              <p className="text-xs">ไม่มีกิจกรรมในวันนี้</p>
            </div>
          ) : (
            <div className="space-y-2">
              {selectedEvents.map(ev => {
                const color = EVENTS_CATEGORY_COLOR[ev.category] ?? '#6b7280'
                return (
                  <div
                    key={ev.id}
                    className="w-full text-left bg-white rounded-xl border border-gray-200 shadow-xs p-3.5 flex items-start justify-between gap-3"
                    style={{ borderLeftColor: color, borderLeftWidth: 3 }}
                  >
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onSelectEvent(ev)}>
                      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
                          style={{ backgroundColor: color }}
                        >
                          {ev.category}
                        </span>
                        {(ev.audiences ?? []).map(v => {
                          const audColor = AUDIENCE_COLOR[v] ?? '#6b7280'
                          return (
                            <span key={v}
                              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                              style={{ backgroundColor: audColor + '20', color: audColor }}
                            >
                              {v !== 'public' && '🔒 '}{AUDIENCE_LABEL[v] ?? v}
                            </span>
                          )
                        })}
                      </div>
                      <p className="text-sm font-bold text-gray-800 leading-tight">{ev.title}</p>
                      {!ev.is_all_day && ev.event_time && (
                        <p className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                          <Clock size={11} />
                          {ev.event_time.slice(0, 5)}{ev.end_time ? ` – ${ev.end_time.slice(0, 5)}` : ''} น.
                        </p>
                      )}
                      {ev.location && (
                        <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                          <MapPin size={11} /> {ev.location}
                        </p>
                      )}
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-1 shrink-0 pt-0.5">
                        <button
                          type="button"
                          onClick={() => onEdit(ev)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          title="แก้ไข"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(ev.id)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="ลบ"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
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

export default function EventsManager({ tenant, currentUserRole = 'staff', autoEditEventId, onAutoEditHandled, autoCreateSignal = 0, autoCreateAudience = null, onAutoCreateHandled }) {
  const canManage = EVENT_MANAGER_ROLES.includes(currentUserRole)
  const orgLabel = tenant?.org_type === 'อบต.' ? 'อบต.' : 'เทศบาล'
  const LOCATION_PRESETS = ['ห้องประชุมสภา', `ห้องประชุม${orgLabel}`, `โดมหลัง${orgLabel}`]
  const [currentUserId, setCurrentUserId] = useState(null)
  const [currentUserScope, setCurrentUserScope] = useState(null)
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [confirmDelId, setConfirmDelId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [extracting, setExtracting] = useState(false)
  const MAX_ATTACHMENTS = 10
  const [form, setForm] = useState(EMPTY_EVENT_FORM)
  const [multiDay, setMultiDay] = useState(false)
  const [locationCustom, setLocationCustom] = useState(false)
  const [viewMode, setViewMode] = useState('list') // 'list' | 'calendar'
  const [filterMonth, setFilterMonth] = useState('all')
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterAudience, setFilterAudience] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('upcoming')
  const [openSheet, setOpenSheet] = useState(null) // 'month' | 'category' | 'audience'
  const [pageSize, setPageSize] = useState(10)
  const [currentPage, setCurrentPage] = useState(1)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const [calToken, setCalToken] = useState(null)
  const [copied, setCopied] = useState(false)
  const [viewingEvent, setViewingEvent] = useState(null)
  const topRef = useRef(null)
  const formErrorRef = useRef(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setCurrentPage(1), 0)
    return () => window.clearTimeout(timer)
  }, [activeTab, searchQuery, filterMonth, filterCategory, filterAudience, pageSize])
  useEffect(() => { fetchEvents() }, [tenant?.id, currentUserRole])

  useEffect(() => {
    if (!autoCreateSignal) return undefined
    const timer = window.setTimeout(() => {
      const today = new Date().toISOString().split('T')[0]
      const audienceAllowed = AUDIENCE_OPTIONS.some(option => option.value === autoCreateAudience)
        && !(currentUserRole === 'council' && autoCreateAudience === 'management')
      setForm({ ...EMPTY_EVENT_FORM, event_date: today, audiences: audienceAllowed ? [autoCreateAudience] : [] })
      setMultiDay(false)
      setLocationCustom(false)
      setEditingEvent(null)
      setFormError('')
      setShowForm(true)
      onAutoCreateHandled?.()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [autoCreateAudience, autoCreateSignal, currentUserRole, onAutoCreateHandled])

  // เปิดฟอร์มแก้ไขอัตโนมัติ ถ้ามากดปุ่ม "แก้ไข" จากหน้ารายละเอียดกิจกรรมฝั่งประชาชน (/events)
  useEffect(() => {
    if (!autoEditEventId || events.length === 0) return
    const match = events.find(e => e.id === autoEditEventId)
    if (match) openEdit(match)
    onAutoEditHandled?.()
  }, [autoEditEventId, events])

  useEffect(() => {
    if (!tenant?.id || !['admin', 'superadmin'].includes(currentUserRole)) return
    supabase.from('municipalities').select('calendar_token').eq('id', tenant.id).single()
      .then(({ data }) => setCalToken(data?.calendar_token ?? null))
  }, [tenant?.id, currentUserRole])

  useEffect(() => {
    const scroller = topRef.current?.closest('[class*="overflow-y-auto"]')
    if (!scroller) return
    const onScroll = () => setShowScrollTop(scroller.scrollTop > 250)
    scroller.addEventListener('scroll', onScroll)
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [])

  async function fetchEvents() {
    if (!tenant?.id) return
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    const userId = user?.id
    setCurrentUserId(userId ?? null)
    if (userId) {
      const { data: scope } = await supabase
        .from('profiles')
        .select('department_id, is_dept_head')
        .eq('id', userId)
        .maybeSingle()
      setCurrentUserScope(scope ?? null)
    } else {
      setCurrentUserScope(null)
    }

    let query = supabase
      .from('events')
      .select('*, creator:profiles!events_created_by_fkey(full_name)')
      .eq('municipality_id', tenant.id)
      .order('event_date', { ascending: true })

    // บุคลากรภายในเห็นปฏิทินทั้งหมดของเทศบาลเดียวกัน
    // เจ้าของแก้ไข/ลบของตนเองได้ หัวหน้ากองแก้ไขงานในกอง และ Admin/SuperAdmin จัดการตามขอบเขตเดิม
    const { data } = await query
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
    setLoading(false)
  }

  function openAdd() {
    const today = new Date().toISOString().split('T')[0]
    setForm({ ...EMPTY_EVENT_FORM, event_date: today })
    setMultiDay(false)
    setLocationCustom(false)
    setEditingEvent(null)
    setShowForm(true)
  }

  function openEdit(ev) {
    const hasMultiDay = !!(ev.end_date && ev.end_date !== ev.event_date)
    setLocationCustom(!!ev.location && !LOCATION_PRESETS.includes(ev.location))
    setForm({
      title: ev.title, description: ev.description ?? '', event_date: ev.event_date,
      event_time: ev.event_time ?? '', end_date: ev.end_date ?? '', location: ev.location ?? '',
      category: EVENTS_CATEGORIES.includes(ev.category ?? '') ? ev.category : 'อื่นๆ',
      customCategory: EVENTS_CATEGORIES.includes(ev.category ?? '') ? '' : (ev.category ?? ''),
      is_all_day: false,
      audiences: ev.audiences?.length ? ev.audiences : ['public'],
      attachment_urls: ev.attachment_urls?.length > 0 ? ev.attachment_urls : (ev.attachment_url ? [ev.attachment_url] : []),
      attachment_files: [], end_time: ev.end_time ?? '',
    })
    setMultiDay(hasMultiDay)
    setEditingEvent(ev)
    setShowForm(true)
  }

  // อัปโหลดไฟล์แนบแยกเป็นขั้นหลังบันทึกกิจกรรมเสร็จแล้ว (ไม่บล็อกการบันทึกข้อมูลหลัก)
  // เหมือนแพตเทิร์นที่ CitizenForm.jsx ใช้กับรูปแนบคำร้อง — ถ้าอัปโหลดมีปัญหา
  // กิจกรรมก็ยังถูกบันทึกอยู่ ไม่หายไปพร้อมกัน
  async function uploadEventAttachments(eventId, files, existingUrls) {
    if (!files?.length || !eventId) return
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) throw new Error('ไม่พบข้อมูลการเข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่')
      const newUrls = []
      for (const file of files) {
        if (file.size > 20 * 1024 * 1024) throw new Error(`ไฟล์ "${file.name}" ใหญ่เกินไป (สูงสุด 20 MB)`)
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const path = `${tenant.id}/${user.id}/${Date.now()}_${safeName}`
        const contentType = file.type || (/\.pdf$/i.test(file.name ?? '') ? 'application/pdf' : 'application/octet-stream')

        const { error: uploadError } = await supabase.storage
          .from('event-attachments')
          .upload(path, file, { contentType })
        if (uploadError) throw new Error(uploadError.message)

        const { data: { publicUrl } } = supabase.storage.from('event-attachments').getPublicUrl(path)
        newUrls.push(publicUrl)
      }

      const allUrls = [...existingUrls, ...newUrls]
      const { error: updErr } = await supabase.from('events')
        .update({ attachment_urls: allUrls, attachment_url: allUrls[0] ?? null })
        .eq('id', eventId)
      if (updErr) throw new Error(updErr.message)
      fetchEvents()
    } catch (err) {
      console.error('uploadEventAttachments error:', err)
      alert('บันทึกกิจกรรมสำเร็จ แต่แนบไฟล์ไม่สำเร็จ: ' + (err?.message ?? 'เกิดข้อผิดพลาด') + '\n\nเปิดแก้ไขกิจกรรมนี้แล้วลองแนบไฟล์ใหม่อีกครั้ง')
    }
  }

  async function handleAIExtract() {
    const file = form.attachment_files[0]
    if (!file || extracting) return
    setExtracting(true)
    setFormError('')
    try {
      const categories = [...EVENTS_CATEGORIES]
      const result = await extractEventFromFile(file, categories, form.event_date || new Date().toISOString().split('T')[0])
      setForm((p) => ({
        ...p,
        title: result.title || p.title,
        description: result.description || p.description,
        location: result.location || p.location,
        category: EVENTS_CATEGORIES.includes(result.category) ? result.category : 'อื่นๆ',
        customCategory: EVENTS_CATEGORIES.includes(result.category) ? '' : (result.category || p.customCategory),
        event_date: result.event_date || p.event_date,
        event_time: result.event_time || p.event_time,
        end_time: result.end_time || p.end_time,
        end_date: result.end_date || p.end_date,
      }))
      if (result.end_date && result.end_date !== (form.event_date || result.event_date)) setMultiDay(true)
    } catch (err) {
      console.error('AI extract error:', err)
      setFormError('ให้ AI ช่วยกรอกไม่สำเร็จ: ' + (err?.message ?? 'เกิดข้อผิดพลาด'))
    } finally {
      setExtracting(false)
    }
  }

  async function handleSave() {
    if (!canManage) { setFormError('บัญชีนี้ไม่มีสิทธิ์เพิ่มกิจกรรมในปฏิทิน'); return }
    if (!form.title.trim()) { setFormError('กรุณากรอกชื่อกิจกรรม'); return }
    if (!form.event_date) { setFormError('กรุณาระบุวันที่กิจกรรม'); return }
    if (!form.category) { setFormError('กรุณาเลือกประเภทกิจกรรม'); return }
    if (form.category === 'อื่นๆ' && !form.customCategory.trim()) { setFormError('กรุณาระบุประเภทกิจกรรม'); return }
    if (!form.audiences.length) { setFormError('กรุณาเลือกกลุ่มเป้าหมายอย่างน้อย 1 กลุ่ม'); return }
    setFormError('')
    setSaving(true)
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) throw new Error('ไม่พบข้อมูลการเข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่')

      const { data: writerProfile, error: profileError } = await supabase
        .from('profiles')
        .select('role, municipality_id, department_id, is_dept_head')
        .eq('id', user.id)
        .single()
      if (profileError || !writerProfile) throw new Error('ไม่พบข้อมูลสิทธิ์ของบัญชี กรุณาติดต่อผู้ดูแลระบบ')
      if (!EVENT_MANAGER_ROLES.includes(writerProfile.role)) {
        throw new Error('บัญชีนี้ไม่มีสิทธิ์เพิ่มกิจกรรมในปฏิทิน')
      }
      if (writerProfile.role !== 'superadmin' && writerProfile.municipality_id !== tenant?.id) {
        throw new Error('บัญชียังไม่ได้ผูกกับเทศบาลนี้ กรุณาให้ผู้ดูแลระบบตรวจข้อมูลหน่วยงานของบัญชี')
      }
      const payload = {
        municipality_id: tenant.id, title: form.title.trim(),
        description: form.description.trim() || null, event_date: form.event_date,
        event_time: form.event_time || null,
        end_time: form.end_time || null,
        end_date: form.end_date || null, location: form.location.trim() || null,
        category: form.category === 'อื่นๆ' ? (form.customCategory.trim() || 'อื่นๆ') : form.category,
        is_all_day: false, audiences: form.audiences,
        attachment_urls: form.attachment_urls, attachment_url: form.attachment_urls[0] ?? null,
        updated_at: new Date().toISOString(),
      }
      let eventId = editingEvent?.id ?? null
      if (editingEvent) {
        const { data: updData, error: updErr } = await supabase.from('events').update(payload).eq('id', editingEvent.id).select('id')
        if (updErr) throw new Error('บันทึกไม่สำเร็จ: ' + updErr.message)
        if (!updData || updData.length === 0) {
          throw new Error('บันทึกไม่สำเร็จ: แก้ไขได้เฉพาะกิจกรรมของตนเอง กิจกรรมในกองที่ตนเป็นหัวหน้ากอง หรือบัญชี Admin/SuperAdmin')
        }
      } else {
        const { data: insData, error: insErr } = await supabase.from('events')
          .insert({ ...payload, created_by: user.id, department_id: writerProfile.department_id ?? null }).select('id').single()
        if (insErr) throw new Error('บันทึกไม่สำเร็จ: ' + insErr.message)
        eventId = insData?.id ?? null
        const dateStr = payload.event_date
          ? new Date(payload.event_date + 'T00:00:00').toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
          : ''
        const timeStr = payload.event_time
          ? `⏰ ${payload.event_time.slice(0, 5)}${payload.end_time ? ` – ${payload.end_time.slice(0, 5)}` : ''} น.`
          : ''
        const audLabel = payload.audiences.map(v => AUDIENCE_OPTIONS.find(a => a.value === v)?.label ?? v).join(', ')
        notifyTelegram(
          tenant.telegram_group_id,
          `📅 <b>กิจกรรมใหม่</b> [${audLabel}]\n<b>${payload.title}</b>${dateStr ? `\n📆 ${dateStr}` : ''}${timeStr ? `\n${timeStr}` : ''}${payload.location ? `\n📍 ${payload.location}` : ''}${payload.description ? `\n📝 ${payload.description.slice(0, 120)}` : ''}`
        )
      }

      setShowForm(false)
      fetchEvents()
      if (form.attachment_files.length > 0 && eventId) uploadEventAttachments(eventId, form.attachment_files, form.attachment_urls)
    } catch (e) {
      const msg = e?.message ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'
      setFormError(msg)
      setTimeout(() => formErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    setDeleting(id)
    const ev = events.find(e => e.id === id)
    await logAction({
      action: 'delete', resourceType: 'event',
      resourceId: id,
      resourceLabel: ev?.title,
      municipalityId: tenant.id,
      metadata: { event_date: ev?.event_date, category: ev?.category, audiences: ev?.audiences },
    })
    const { error } = await supabase.from('events').delete().eq('id', id)
    setDeleting(null)
    if (!error) {
      setEvents((prev) => prev.filter((e) => e.id !== id))
    }
  }

  let filteredEvents = events
  if (filterMonth !== 'all') filteredEvents = filteredEvents.filter(e => e.event_date?.startsWith(filterMonth))
  if (filterCategory !== 'all') filteredEvents = filteredEvents.filter(e => e.category === filterCategory)
  if (filterAudience !== 'all') filteredEvents = filteredEvents.filter(e => e.audiences?.includes(filterAudience))
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase()
    filteredEvents = filteredEvents.filter(e => e.title.toLowerCase().includes(q) || (e.description && e.description.toLowerCase().includes(q)))
  }

  const matchSearch = (e) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.trim().toLowerCase()
    return e.title.toLowerCase().includes(q) || (e.description ?? '').toLowerCase().includes(q)
  }

  // counts excluding each respective filter so numbers reflect the other active filters
  const eventsForMonthCount = events
    .filter(e => filterCategory === 'all' || e.category === filterCategory)
    .filter(e => filterAudience === 'all' || e.audiences?.includes(filterAudience))
    .filter(matchSearch)
  const monthCounts = eventsForMonthCount.reduce((acc, e) => {
    const ym = e.event_date?.slice(0, 7)
    if (!ym) return acc
    acc[ym] = (acc[ym] || 0) + 1
    return acc
  }, {})

  const eventsForCatCount = events
    .filter(e => filterMonth === 'all' || e.event_date?.startsWith(filterMonth))
    .filter(e => filterAudience === 'all' || e.audiences?.includes(filterAudience))
    .filter(matchSearch)
  const categoryCounts = Object.fromEntries(
    EVENTS_CATEGORIES.map(cat => [cat, eventsForCatCount.filter(e => e.category === cat).length])
  )

  const eventsForAudienceCount = events
    .filter(e => filterMonth === 'all' || e.event_date?.startsWith(filterMonth))
    .filter(e => filterCategory === 'all' || e.category === filterCategory)
    .filter(matchSearch)
  const audienceCounts = Object.fromEntries(
    AUDIENCE_OPTIONS.map(opt => [opt.value, eventsForAudienceCount.filter(e => e.audiences?.includes(opt.value)).length])
  )

  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const upcoming = filteredEvents.filter((e) => e.event_date && new Date(e.event_date + 'T00:00:00') >= now)
  const past = filteredEvents.filter((e) => !e.event_date || new Date(e.event_date + 'T00:00:00') < now)
  const currentList = activeTab === 'upcoming' ? upcoming : [...past].reverse()
  const totalItems = currentList.length
  const totalPages = pageSize === 'all' ? 1 : Math.ceil(totalItems / pageSize)
  const paginatedList = pageSize === 'all' ? currentList : currentList.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  function scrollToTop() {
    const scroller = topRef.current?.closest('[class*="overflow-y-auto"]')
    scroller?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const icsUrl = calToken
    ? `${supabaseUrl}/functions/v1/calendar-ics?token=${calToken}`
    : null

  function copyIcsUrl() {
    if (!icsUrl) return
    navigator.clipboard.writeText(icsUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  return (
    <div className="space-y-4" ref={topRef}>
      {showScrollTop && (
        <button onClick={scrollToTop}
          className="fixed bottom-20 right-4 z-50 md:bottom-8 md:right-8 w-11 h-11 rounded-full bg-white shadow-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 active:scale-95 transition-all">
          <ChevronUp size={20} />
        </button>
      )}
      {/* Mobile header */}
      <div className="md:hidden flex items-center justify-between gap-2">
        <h2 className="font-bold text-gray-700 shrink-0">ปฏิทินกิจกรรม</h2>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <button
            type="button"
            onClick={() => setViewMode(v => v === 'list' ? 'calendar' : 'list')}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold border transition-all active:scale-95 shadow-xs"
            style={viewMode === 'calendar'
              ? { backgroundColor: '#3b82f6', color: '#ffffff', borderColor: '#2563eb' }
              : { backgroundColor: '#eff6ff', color: '#1d4ed8', borderColor: '#bfdbfe' }
            }
          >
            {viewMode === 'list' ? (
              <><CalendarDays size={13} /> ตาราง</>
            ) : (
              <><List size={13} /> รายการ</>
            )}
          </button>
          {icsUrl && (
            <button onClick={copyIcsUrl}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold border border-gray-200 text-gray-600 bg-white">
              {copied ? <CheckCheck size={13} className="text-green-500" /> : <Link2 size={13} />}
              {copied ? 'คัดลอก!' : 'Subscribe'}
            </button>
          )}
          {canManage && (
            <button onClick={openAdd}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white shadow-xs"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              <Plus size={14} /> เพิ่มกิจกรรมในปฏิทิน
            </button>
          )}
        </div>
      </div>

      {/* PC title bar */}
      <div className="hidden md:flex items-center justify-between px-5 py-2.5 border border-gray-200"
        style={{ backgroundColor: '#1a3a5c' }}>
        <h2 className="text-[13px] font-bold text-white tracking-wide">ปฏิทินกิจกรรม</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setViewMode(v => v === 'list' ? 'calendar' : 'list')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold border transition-colors hover:bg-white/20"
            style={{ backgroundColor: 'rgba(255,255,255,0.18)', color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}
          >
            {viewMode === 'list' ? (
              <><CalendarDays size={13} /> ตาราง</>
            ) : (
              <><List size={13} /> รายการ</>
            )}
          </button>
          <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded"
            style={{ backgroundColor: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.9)' }}>
            {upcoming.length} รายการ
          </span>
          {canManage && (
            <button onClick={openAdd}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold border transition-colors hover:bg-white/20"
              style={{ backgroundColor: 'rgba(255,255,255,0.12)', color: '#fff', borderColor: 'rgba(255,255,255,0.3)' }}>
              <Plus size={13} /> เพิ่มกิจกรรมในปฏิทิน
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl md:rounded-none border border-gray-100 md:border-gray-200 shadow-sm p-4 md:bg-[#f5f8fc] space-y-3">
        {/* Search — always visible */}
        <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          placeholder="ค้นหาชื่อหรือรายละเอียดกิจกรรม..."
          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200" />

        {/* Mobile: chip buttons + inline dropdown */}
        {(() => {
          const hasFilter = filterMonth !== 'all' || filterCategory !== 'all' || filterAudience !== 'all' || !!searchQuery
          const monthLabel = filterMonth === 'all'
            ? 'เดือน'
            : new Date(Number(filterMonth.split('-')[0]), Number(filterMonth.split('-')[1]) - 1, 1)
                .toLocaleDateString('th-TH', { month: 'short' })
          const catLabel = filterCategory === 'all' ? 'ประเภท' : filterCategory
          const audLabel = filterAudience === 'all' ? 'กลุ่ม' : (AUDIENCE_OPTIONS.find(a => a.value === filterAudience)?.label ?? filterAudience)

          const chipDefs = [
            { key: 'month',    Icon: CalendarDays, label: monthLabel, active: filterMonth !== 'all',    color: '#f97316' },
            { key: 'category', Icon: Tag,          label: catLabel,   active: filterCategory !== 'all', color: '#3b82f6' },
            { key: 'audience', Icon: Users,        label: audLabel,   active: filterAudience !== 'all', color: '#10b981' },
          ]
          const monthOpts = [
            { value: 'all', label: 'ทั้งหมด', count: eventsForMonthCount.length },
            ...Array.from(new Set(events.filter(e => e.event_date).map(e => e.event_date.slice(0, 7)))).sort().reverse().map(ym => {
              const [y, m] = ym.split('-')
              const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })
              return { value: ym, label, count: monthCounts[ym] ?? 0 }
            })
          ]
          const catOpts  = [
            { value: 'all', label: 'ทั้งหมด', count: eventsForCatCount.length },
            ...EVENTS_CATEGORIES.map(cat => ({ value: cat, label: cat, count: categoryCounts[cat] ?? 0 }))
          ]
          const audOpts  = [
            { value: 'all', label: 'ทั้งหมด', count: eventsForAudienceCount.length },
            ...AUDIENCE_OPTIONS
              .filter(opt => currentUserRole === 'council' ? opt.value !== 'management' : true)
              .map(opt => ({ value: opt.value, label: opt.label, count: audienceCounts[opt.value] ?? 0 }))
          ]
          const dropdownMap = {
            month:    { options: monthOpts, current: filterMonth,    onChange: setFilterMonth },
            category: { options: catOpts,   current: filterCategory, onChange: setFilterCategory },
            audience: { options: audOpts,   current: filterAudience, onChange: setFilterAudience },
          }

          return (
            <div className="md:hidden relative">
              <div className="flex gap-2">
                {chipDefs.map(({ key, Icon, label, active, color }) => (
                  <button key={key}
                    onClick={() => setOpenSheet(openSheet === key ? null : key)}
                    className="flex-1 flex flex-col items-center gap-1.5 py-3 rounded-2xl border transition-all"
                    style={active || openSheet === key
                      ? { backgroundColor: color + '15', borderColor: color }
                      : { backgroundColor: '#f9fafb', borderColor: '#e5e7eb' }}>
                    <Icon size={20} style={{ color: active || openSheet === key ? color : '#94a3b8' }} />
                    <span className="text-[11px] font-semibold truncate max-w-[72px] text-center leading-tight"
                      style={{ color: active || openSheet === key ? color : '#64748b' }}>{label}</span>
                  </button>
                ))}
                <button
                  onClick={() => { setSearchQuery(''); setFilterMonth('all'); setFilterCategory('all'); setFilterAudience('all'); setOpenSheet(null) }}
                  className="flex flex-col items-center gap-1.5 py-3 px-3 rounded-2xl border transition-all"
                  style={hasFilter
                    ? { backgroundColor: '#fee2e2', borderColor: '#ef4444' }
                    : { backgroundColor: '#f9fafb', borderColor: '#e5e7eb', opacity: 0.4, pointerEvents: 'none' }}>
                  <X size={20} style={{ color: hasFilter ? '#ef4444' : '#94a3b8' }} />
                  <span className="text-[13px] font-semibold" style={{ color: hasFilter ? '#ef4444' : '#94a3b8' }}>ล้าง</span>
                </button>
              </div>

              {openSheet && dropdownMap[openSheet] && (() => {
                const { options, current, onChange } = dropdownMap[openSheet]
                return (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpenSheet(null)} />
                    <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-xl border border-gray-100 z-50 overflow-hidden">
                      {options.map(opt => (
                        <button key={opt.value}
                          onClick={() => { onChange(opt.value); setOpenSheet(null) }}
                          className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 active:bg-gray-100 transition-colors border-b border-gray-50 last:border-0">
                          <span className={`text-sm ${current === opt.value ? 'font-bold text-blue-600' : 'text-gray-700'}`}>
                            {opt.label}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-gray-400">({opt.count})</span>
                            {current === opt.value && <Check size={14} className="text-blue-500 shrink-0" />}
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )
              })()}
            </div>
          )
        })()}

        {/* Desktop: select dropdowns */}
        <div className="hidden md:flex flex-wrap gap-3 items-center">
          <div className="min-w-[140px]">
            <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200">
              <option value="all">ทุกเดือน ({eventsForMonthCount.length})</option>
              {Array.from(new Set(events.filter(e => e.event_date).map(e => e.event_date.slice(0, 7)))).sort().reverse().map(ym => {
                const [y, m] = ym.split('-')
                const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })
                return <option key={ym} value={ym}>{label} ({monthCounts[ym] ?? 0})</option>
              })}
            </select>
          </div>
          <div className="min-w-[140px]">
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200">
              <option value="all">ทุกประเภท ({eventsForCatCount.length})</option>
              {EVENTS_CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{cat} ({categoryCounts[cat] ?? 0})</option>
              ))}
            </select>
          </div>
          <div className="min-w-[140px]">
            <select value={filterAudience} onChange={e => setFilterAudience(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200">
              <option value="all">ทุกกลุ่มเป้าหมาย ({eventsForAudienceCount.length})</option>
              {AUDIENCE_OPTIONS.filter(opt => currentUserRole === 'council' ? opt.value !== 'management' : true).map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label} ({audienceCounts[opt.value] ?? 0})</option>
              ))}
            </select>
          </div>
          {(searchQuery || filterMonth !== 'all' || filterCategory !== 'all' || filterAudience !== 'all') && (
            <button onClick={() => { setSearchQuery(''); setFilterMonth('all'); setFilterCategory('all'); setFilterAudience('all') }}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-500 bg-gray-100 hover:bg-gray-200 transition-colors">
              <X size={16} /> ล้าง
            </button>
          )}
        </div>
      </div>


      {viewingEvent && (() => {
        const ev = viewingEvent
        const color = EVENTS_CATEGORY_COLOR[ev.category] ?? '#6b7280'
        const days = ev.event_date ? daysUntil(ev.event_date) : null
        const daysColor = days === 'วันนี้' ? '#ef4444' : days?.includes('ที่แล้ว') ? '#9ca3af' : days === 'พรุ่งนี้' ? '#f97316' : '#3b82f6'
        const d = ev.event_date ? new Date(ev.event_date + 'T00:00:00') : null
        const dEnd = ev.end_date && ev.end_date !== ev.event_date ? new Date(ev.end_date + 'T00:00:00') : null
        const fmtDate = (dt) => dt.toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
            onClick={() => setViewingEvent(null)}>
            <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden"
              onClick={e => e.stopPropagation()}>
              {/* Header bar */}
              <div className="h-1.5 w-full" style={{ backgroundColor: color }} />
              <div className="px-6 pt-5 pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold text-white"
                        style={{ backgroundColor: color }}>{ev.category}</span>
                      {(ev.audiences ?? []).map(v => {
                        const aud = AUDIENCE_OPTIONS.find(a => a.value === v)
                        return aud ? (
                          <span key={v} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border"
                            style={{ color: aud.color, borderColor: aud.color, backgroundColor: aud.color + '18' }}>
                            {v !== 'public' ? '🔒 ' : '👥 '}{aud.label}
                          </span>
                        ) : null
                      })}
                      {days && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold text-white"
                          style={{ backgroundColor: daysColor }}>
                          {days}
                        </span>
                      )}
                    </div>
                    <h3 className="text-base font-bold text-gray-900 leading-snug">{ev.title}</h3>
                  </div>
                  <button onClick={() => setViewingEvent(null)}
                    className="p-1.5 rounded-xl hover:bg-gray-100 shrink-0 mt-0.5">
                    <X size={17} className="text-gray-400" />
                  </button>
                </div>

                <div className="mt-4 space-y-2.5">
                  {/* Date */}
                  <div className="flex items-start gap-2.5 text-sm text-gray-700">
                    <span className="text-base shrink-0">📅</span>
                    <div>
                      <p>{d ? fmtDate(d) : 'ยังไม่ระบุวันที่'}</p>
                      {dEnd && <p className="text-gray-500 text-xs mt-0.5">ถึง {fmtDate(dEnd)}</p>}
                    </div>
                  </div>
                  {/* Time */}
                  {ev.event_time && (
                    <div className="flex items-center gap-2.5 text-sm text-gray-700">
                      <span className="text-base shrink-0">⏰</span>
                      <span>{ev.event_time.slice(0, 5)}{ev.end_time ? ` – ${ev.end_time.slice(0, 5)}` : ''} น.</span>
                    </div>
                  )}
                  {/* Location */}
                  {ev.location && (
                    <div className="flex items-start gap-2.5 text-sm text-gray-700">
                      <span className="text-base shrink-0">📍</span>
                      <span>{ev.location}</span>
                    </div>
                  )}
                  {/* Description */}
                  {ev.description && (
                    <div className="flex items-start gap-2.5 text-sm text-gray-700">
                      <span className="text-base shrink-0">📝</span>
                      <p className="leading-relaxed whitespace-pre-wrap">{ev.description}</p>
                    </div>
                  )}
                  {/* Attachment */}
                  {eventAttachments(ev).length > 0 && (
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="text-base shrink-0">📎</span>
                      {eventAttachments(ev).map((url, i) => (
                        <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:underline font-medium">
                          ดูไฟล์แนบ{eventAttachments(ev).length > 1 ? ` ${i + 1}` : ''}
                        </a>
                      ))}
                    </div>
                  )}
                  {/* Creator */}
                  {ev.creator?.full_name && (
                    <div className="flex items-center gap-2.5 text-sm text-gray-500">
                      <span className="text-base shrink-0">✍️</span>
                      <span>{ev.creator.full_name}</span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                {canManage && (['admin', 'superadmin'].includes(currentUserRole) || ev.created_by === currentUserId) && (
                  <div className="flex gap-2 mt-5 pt-4 border-t border-gray-100">
                    <button onClick={() => { setViewingEvent(null); openEdit(ev) }}
                      className="flex-1 py-2.5 rounded-xl border border-blue-300 text-blue-600 text-sm font-bold hover:bg-blue-50 transition-colors">
                      แก้ไข
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 px-4 pb-4 md:p-6">
          <div className="w-full max-w-md md:max-w-2xl bg-white rounded-t-3xl md:rounded-2xl shadow-2xl flex flex-col max-h-[90vh] md:max-h-[88vh] overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <h3 className="font-bold text-gray-800">{editingEvent ? 'แก้ไขกิจกรรมในปฏิทิน' : 'เพิ่มกิจกรรมในปฏิทิน'}</h3>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-xl hover:bg-gray-100">
                <X size={18} className="text-gray-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <div className="px-6 py-4 space-y-4">
                {formError && (
                  <div ref={formErrorRef} className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                    <span className="text-red-500 font-bold text-sm shrink-0">⚠️</span>
                    <p className="text-sm text-red-600 font-medium">{formError}</p>
                  </div>
                )}
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">ชื่อกิจกรรม *</label>
                  <input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                    placeholder="เช่น ประชุมสภา อบต."
                    className="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-gray-500">{multiDay ? 'วันที่เริ่ม *' : 'วันที่ *'}</label>
                    <button type="button"
                      onClick={() => { setMultiDay(v => !v); if (multiDay) setForm(p => ({ ...p, end_date: '' })) }}
                      className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-colors ${multiDay ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                      {multiDay ? '✓ หลายวัน' : '+ หลายวัน'}
                    </button>
                  </div>
                  <input type="date" value={form.event_date} onChange={(e) => setForm((p) => ({ ...p, event_date: e.target.value }))}
                    className="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400" />
                  {multiDay && (
                    <div className="mt-2">
                      <label className="text-xs font-semibold text-gray-500 mb-1 block">ถึงวันที่</label>
                      <input type="date" value={form.end_date} min={form.event_date} onChange={(e) => setForm((p) => ({ ...p, end_date: e.target.value }))}
                        className="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400" />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 font-semibold mb-1 block">เริ่ม</label>
                    <TimeSelect value={form.event_time} onChange={v => setForm(p => ({ ...p, event_time: v }))} />
                  </div>
                  <span className="text-gray-400 text-sm mt-5">–</span>
                  <div className="flex-1">
                    <label className="text-xs text-gray-400 mb-1 block">สิ้นสุด</label>
                    <TimeSelect value={form.end_time} onChange={v => setForm(p => ({ ...p, end_time: v }))} />
                  </div>
                </div>
                <div className="md:grid md:grid-cols-2 md:gap-6 space-y-4 md:space-y-0">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">ประเภทกิจกรรม</label>
                    <div className="flex flex-wrap gap-2">
                      {EVENTS_CATEGORIES.map((cat) => (
                        <button key={cat} onClick={() => setForm((p) => ({ ...p, category: cat, customCategory: '' }))}
                          className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors"
                          style={form.category === cat
                            ? { backgroundColor: EVENTS_CATEGORY_COLOR[cat], color: 'white' }
                            : { backgroundColor: '#f3f4f6', color: '#374151' }}>
                          {cat}
                        </button>
                      ))}
                    </div>
                    {form.category === 'อื่นๆ' && (
                      <input
                        type="text"
                        value={form.customCategory}
                        onChange={e => setForm(p => ({ ...p, customCategory: e.target.value }))}
                        placeholder="ระบุประเภทกิจกรรม..."
                        className="mt-2 w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
                        autoFocus
                      />
                    )}
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">กลุ่มเป้าหมาย (เลือกได้หลายกลุ่ม)</label>
                    <div className="grid grid-cols-2 gap-2">
                      {AUDIENCE_OPTIONS.filter(opt => currentUserRole === 'council' ? opt.value !== 'management' : true).map((opt) => {
                        const selected = form.audiences.includes(opt.value)
                        return (
                          <button key={opt.value} type="button" onClick={() => setForm((p) => {
                            const next = selected ? p.audiences.filter(v => v !== opt.value) : [...p.audiences, opt.value]
                            return { ...p, audiences: next.length ? next : p.audiences }
                          })}
                            className="px-3 py-2 rounded-xl text-xs font-semibold text-left transition-colors border"
                            style={selected
                              ? { backgroundColor: opt.color, color: 'white', borderColor: opt.color }
                              : { backgroundColor: 'white', color: '#374151', borderColor: '#e5e7eb' }}>
                            {opt.value !== 'public' && '🔒 '}{opt.label}{selected && ' ✓'}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
                <div className="md:grid md:grid-cols-2 md:gap-6 space-y-4 md:space-y-0">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">สถานที่</label>
                    <div className="grid grid-cols-2 gap-2">
                      {LOCATION_PRESETS.map((loc) => (
                        <button key={loc} type="button" onClick={() => { setLocationCustom(false); setForm((p) => ({ ...p, location: loc })) }}
                          className="px-3 py-2 rounded-xl text-xs font-semibold text-left transition-colors border"
                          style={!locationCustom && form.location === loc
                            ? { backgroundColor: 'var(--color-primary)', color: 'white', borderColor: 'var(--color-primary)' }
                            : { backgroundColor: 'white', color: '#374151', borderColor: '#e5e7eb' }}>
                          {loc}
                        </button>
                      ))}
                      <button type="button" onClick={() => { setLocationCustom(true); setForm((p) => ({ ...p, location: '' })) }}
                        className="px-3 py-2 rounded-xl text-xs font-semibold text-left transition-colors border"
                        style={locationCustom
                          ? { backgroundColor: 'var(--color-primary)', color: 'white', borderColor: 'var(--color-primary)' }
                          : { backgroundColor: 'white', color: '#374151', borderColor: '#e5e7eb' }}>
                        อื่นๆ (ระบุ)
                      </button>
                    </div>
                    {locationCustom && (
                      <input value={form.location} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))}
                        placeholder="ระบุสถานที่..."
                        className="mt-2 w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400"
                        autoFocus />
                    )}
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">รายละเอียด</label>
                    <textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                      placeholder="รายละเอียดเพิ่มเติม..." rows={3}
                      className="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400 resize-none" />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-gray-500 block">เอกสารแนบ</label>
                    <span className="text-[11px] text-gray-400">{form.attachment_urls.length + form.attachment_files.length}/{MAX_ATTACHMENTS}</span>
                  </div>
                  {(form.attachment_urls.length > 0 || form.attachment_files.length > 0) && (
                    <div className="space-y-1.5 mb-2">
                      {form.attachment_urls.map((url, i) => (
                        <div key={url} className="flex items-center gap-2 px-3 py-2.5 bg-blue-50 border border-blue-100 rounded-xl">
                          <Paperclip size={14} className="text-blue-500 shrink-0" />
                          <a href={url} target="_blank" rel="noopener noreferrer"
                            className="flex-1 text-xs text-blue-600 font-medium truncate hover:underline">ดูไฟล์แนบเดิม {form.attachment_urls.length > 1 ? i + 1 : ''}</a>
                          <button type="button" onClick={() => setForm((p) => ({ ...p, attachment_urls: p.attachment_urls.filter((u) => u !== url) }))}
                            className="p-1 rounded-lg hover:bg-blue-100 text-red-400 transition-colors"><X size={13} /></button>
                        </div>
                      ))}
                      {form.attachment_files.map((file, i) => (
                        <div key={`${file.name}-${i}`} className="flex items-center gap-2 px-3 py-2.5 bg-green-50 border border-green-100 rounded-xl">
                          <Paperclip size={14} className="text-green-500 shrink-0" />
                          <span className="flex-1 text-xs text-green-700 font-medium truncate">{file.name}</span>
                          <button type="button" onClick={() => setForm((p) => ({ ...p, attachment_files: p.attachment_files.filter((_, idx) => idx !== i) }))}
                            className="p-1 rounded-lg hover:bg-green-100 text-red-400 transition-colors"><X size={13} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                  {form.attachment_files.length > 0 && (
                    <div className="mb-2">
                      <button type="button" onClick={handleAIExtract} disabled={extracting}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-60"
                        style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
                        {extracting
                          ? <><Loader2 size={15} className="animate-spin" /> กำลังอ่านไฟล์... (อาจใช้เวลาถึง 2 นาที)</>
                          : <><Sparkles size={15} /> ให้ AI ช่วยกรอก</>}
                      </button>
                    </div>
                  )}
                  {form.attachment_urls.length + form.attachment_files.length < MAX_ATTACHMENTS && (
                    <div className="flex gap-2">
                      <label className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border-2 border-dashed border-gray-200 cursor-pointer hover:border-blue-300 hover:bg-blue-50/50 transition-colors">
                        <Image size={15} className="text-gray-400 shrink-0" />
                        <span className="text-xs text-gray-400">แนบรูปภาพ</span>
                        <input type="file" accept="image/*" className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) setForm((p) => ({ ...p, attachment_files: [...p.attachment_files, file] }))
                            e.target.value = ''
                          }} />
                      </label>
                      <label className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border-2 border-dashed border-gray-200 cursor-pointer hover:border-blue-300 hover:bg-blue-50/50 transition-colors">
                        <FileText size={15} className="text-gray-400 shrink-0" />
                        <span className="text-xs text-gray-400">แนบไฟล์ (PDF)</span>
                        <input type="file" accept="application/pdf" className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) setForm((p) => ({ ...p, attachment_files: [...p.attachment_files, file] }))
                            e.target.value = ''
                          }} />
                      </label>
                    </div>
                  )}
                  <p className="text-[11px] text-gray-400 mt-1">รวมกันได้สูงสุด {MAX_ATTACHMENTS} ไฟล์ (ไฟล์ละไม่เกิน 20 MB)</p>
                </div>
              </div>
            </div>
            <div className="border-t border-gray-100 shrink-0">
              <div className="px-6 py-4 flex gap-3">
                <button onClick={() => setShowForm(false)} disabled={saving}
                  className="flex-1 py-3 rounded-2xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                  ยกเลิก
                </button>
                <button onClick={handleSave} disabled={saving || !form.title.trim() || !form.event_date}
                  className="flex-1 py-3 rounded-2xl text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ backgroundColor: 'var(--color-primary)' }}>
                  {saving ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>{form.attachment_files.length > 0 ? 'กำลังอัปโหลด...' : 'กำลังบันทึก...'}</span>
                    </>
                  ) : (
                    'บันทึก'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10 text-gray-400">
          <Loader2 size={24} className="animate-spin" />
        </div>
      ) : viewMode === 'calendar' ? (
        <AdminCalendarView
          events={filteredEvents}
          onSelectEvent={setViewingEvent}
          onEdit={openEdit}
          onDelete={handleDelete}
          canManage={canManage}
          openAdd={openAdd}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center justify-between w-full sm:w-auto gap-2">
              <div className="flex bg-gray-100 p-1 rounded-xl w-fit">
                <button onClick={() => setActiveTab('upcoming')}
                  className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${activeTab === 'upcoming' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  กิจกรรมที่จะมาถึง ({upcoming.length})
                </button>
                <button onClick={() => setActiveTab('past')}
                  className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${activeTab === 'past' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  กิจกรรมที่ผ่านมา ({past.length})
                </button>
              </div>
            </div>
            {paginatedList.length > 0 && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <span>แสดง</span>
                <select value={pageSize} onChange={(e) => setPageSize(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-200">
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value="all">ทั้งหมด</option>
                </select>
                <span>รายการ</span>
              </div>
            )}
          </div>
          <div>
            {paginatedList.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-400 text-sm">
                {activeTab === 'upcoming' ? 'ยังไม่มีกิจกรรม กด "เพิ่มกิจกรรมในปฏิทิน" เพื่อเริ่มต้น' : 'ยังไม่มีกิจกรรมที่ผ่านมา'}
              </div>
            ) : (
              <>
                {/* Mobile cards */}
                <div className={`md:hidden space-y-2 ${activeTab === 'past' ? 'opacity-80' : ''}`}>
                  {paginatedList.map((ev) => {
                    const isAdminManager = ['admin', 'superadmin'].includes(currentUserRole)
                    const isDepartmentHeadForEvent = !!currentUserScope?.is_dept_head && !!currentUserScope?.department_id && ev.department_id === currentUserScope.department_id
                    const canEditRow = isAdminManager || ev.created_by === currentUserId || isDepartmentHeadForEvent
                    const canDeleteRow = isAdminManager || ev.created_by === currentUserId || isDepartmentHeadForEvent
                    return (
                      <EventCard key={ev.id} ev={ev}
                        onEdit={canManage && canEditRow ? openEdit : null}
                        onDelete={canManage && canDeleteRow ? handleDelete : null}
                        onView={canViewEventDetail(ev, currentUserRole, currentUserId) ? setViewingEvent : null}
                        deleting={deleting} />
                    )
                  })}
                </div>

                {/* PC table */}
                <div className={`hidden md:block overflow-x-auto border border-gray-200 ${activeTab === 'past' ? 'opacity-75' : ''}`}>
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr style={{ backgroundColor: '#2c5282' }}>
                        <th className="px-3 py-2.5 text-center text-[11px] font-bold text-white border-r border-white/10 w-10">ที่</th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">ชื่อกิจกรรม</th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">ประเภท</th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">วันที่/เวลา</th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">สถานที่</th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">กลุ่มเป้าหมาย</th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">ผู้เพิ่ม</th>
                        <th className="px-3 py-2.5 text-center text-[11px] font-bold text-white border-r border-white/10 w-12">ไฟล์</th>
                        {canManage && <th className="px-3 py-2.5 text-center text-[11px] font-bold text-white">จัดการ</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {paginatedList.map((ev, i) => {
                        const color = EVENTS_CATEGORY_COLOR[ev.category] ?? '#6b7280'
                        const d = ev.event_date ? new Date(ev.event_date + 'T00:00:00') : null
                        const dateStr = d ? d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : 'ยังไม่ระบุ'
                        const timeStr = ev.event_time ? ev.event_time.slice(0, 5) + (ev.end_time ? `–${ev.end_time.slice(0, 5)}` : '') + ' น.' : '—'
                        const isAdminManager = ['admin', 'superadmin'].includes(currentUserRole)
                        const isDepartmentHeadForEvent = !!currentUserScope?.is_dept_head && !!currentUserScope?.department_id && ev.department_id === currentUserScope.department_id
                        const canEditRow = isAdminManager || ev.created_by === currentUserId || isDepartmentHeadForEvent
                        const canDeleteRow = isAdminManager || ev.created_by === currentUserId || isDepartmentHeadForEvent
                        const canView = canViewEventDetail(ev, currentUserRole, currentUserId)
                        return (
                          <tr key={ev.id}
                            className="transition-colors"
                            style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#f5f8fc' }}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#dbeafe'}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = i % 2 === 0 ? '#fff' : '#f5f8fc'}>
                            <td className="px-3 py-2 text-center text-xs text-gray-400 border-r border-gray-200">{i + 1}</td>
                            <td className="px-3 py-2 border-r border-gray-200">
                              {canView ? (
                                <button type="button" onClick={() => setViewingEvent(ev)}
                                  className="text-left group w-full">
                                  <p className="font-semibold text-blue-700 text-xs leading-snug group-hover:underline">{ev.title}</p>
                                  {ev.description && <p className="text-[11px] text-gray-400 truncate max-w-[220px]">{ev.description}</p>}
                                </button>
                              ) : (
                                <div className="text-left w-full">
                                  <p className="font-semibold text-gray-500 text-xs leading-snug">{ev.title}</p>
                                  {ev.description && <p className="text-[11px] text-gray-400 truncate max-w-[220px]">{ev.description}</p>}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 border-r border-gray-200">
                              <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold text-white"
                                style={{ backgroundColor: color }}>{ev.category}</span>
                            </td>
                            <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap border-r border-gray-200">
                              <p>{dateStr}</p>
                              <p className="text-[11px] text-gray-400">{timeStr}</p>
                            </td>
                            <td className="px-3 py-2 text-xs text-gray-500 border-r border-gray-200">{ev.location || '—'}</td>
                            <td className="px-3 py-2 border-r border-gray-200">
                              <div className="flex flex-wrap gap-1">
                                {(ev.audiences ?? []).map(v => {
                                  const aud = AUDIENCE_OPTIONS.find(a => a.value === v)
                                  return aud ? (
                                    <span key={v} className="inline-flex px-2 py-0.5 rounded text-[10px] font-semibold border"
                                      style={{ color: aud.color, borderColor: aud.color, backgroundColor: aud.color + '15' }}>
                                      {aud.label}
                                    </span>
                                  ) : null
                                })}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-xs text-gray-600 border-r border-gray-200 whitespace-nowrap">
                              {ev.creator?.full_name ?? <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-3 py-2 text-center border-r border-gray-200">
                              {eventAttachments(ev).length > 0
                                ? <a href={eventAttachments(ev)[0]} target="_blank" rel="noopener noreferrer"
                                    title={`เปิดไฟล์แนบ${eventAttachments(ev).length > 1 ? ` (${eventAttachments(ev).length} ไฟล์)` : ''}`}
                                    className="relative inline-flex items-center justify-center w-7 h-7 rounded-lg bg-blue-50 hover:bg-blue-100 transition-colors">
                                    <Paperclip size={13} className="text-blue-500" />
                                    {eventAttachments(ev).length > 1 && (
                                      <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-blue-500 text-white text-[9px] font-bold flex items-center justify-center">
                                        {eventAttachments(ev).length}
                                      </span>
                                    )}
                                  </a>
                                : <span className="text-gray-300 text-xs">—</span>}
                            </td>
                            {canManage && (
                              <td className="px-3 py-2 text-center" onClick={e => e.stopPropagation()}>
                                {canEditRow ? (
                                  <div className="flex items-center justify-center gap-1.5">
                                    {confirmDelId === ev.id ? (
                                      <>
                                        <button onClick={() => { handleDelete(ev.id); setConfirmDelId(null) }} disabled={deleting === ev.id}
                                          className="px-2.5 py-1 rounded bg-red-500 text-white text-[13px] font-bold disabled:opacity-40">
                                          {deleting === ev.id ? '...' : 'ยืนยัน'}
                                        </button>
                                        <button onClick={() => setConfirmDelId(null)}
                                          className="px-2.5 py-1 rounded bg-gray-100 text-gray-600 text-[13px] font-semibold hover:bg-gray-200">
                                          ยกเลิก
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        <button onClick={() => openEdit(ev)}
                                          className="px-2.5 py-1 rounded border border-blue-400 text-blue-600 text-[13px] font-bold hover:bg-blue-600 hover:text-white transition-colors">
                                          แก้ไข
                                        </button>
                                        {canDeleteRow && (
                                          <button onClick={() => setConfirmDelId(ev.id)}
                                            className="px-2.5 py-1 rounded border border-red-300 text-red-500 text-[13px] font-bold hover:bg-red-500 hover:text-white transition-colors">
                                            ลบ
                                          </button>
                                        )}
                                      </>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-[11px] text-gray-300">—</span>
                                )}
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {pageSize !== 'all' && totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 pt-3">
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                  className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 transition-colors">
                  <ChevronLeft size={16} />
                </button>
                <span className="text-sm font-medium text-gray-700">หน้า {currentPage} / {totalPages}</span>
                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                  className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 transition-colors">
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
