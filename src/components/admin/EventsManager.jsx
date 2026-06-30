import { useState, useEffect, useRef } from 'react'
import { Loader2, Plus, X, Pencil, Trash2, ChevronLeft, ChevronRight, Paperclip, CalendarDays, Tag, Users, Check, ChevronUp } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { notifyTelegram } from '../../lib/notifyTelegram'
import { compressImage } from '../../lib/imageUtils'
import { logAction } from '../../lib/auditLog'

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = ['00', '15', '30', '45']

function TimeSelect({ value, onChange, required }) {
  const [h, m] = value ? value.split(':') : ['', '']
  const set = (nh, nm) => onChange(nh && nm !== undefined ? `${nh}:${nm ?? '00'}` : '')
  return (
    <div className="flex items-center gap-1">
      <select value={h ?? ''} onChange={e => set(e.target.value, m ?? '00')} required={required}
        className="flex-1 px-2 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400">
        <option value="">ชม.</option>
        {HOURS.map(v => <option key={v} value={v}>{v}</option>)}
      </select>
      <span className="text-gray-400 text-sm font-bold">:</span>
      <select value={m ?? ''} onChange={e => set(h ?? '08', e.target.value)} required={required}
        className="flex-1 px-2 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400">
        <option value="">นาที</option>
        {MINUTES.map(v => <option key={v} value={v}>{v}</option>)}
      </select>
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
  { value: 'staff',      label: 'เทศบาล (เจ้าหน้าที่)',    color: '#3b82f6' },
  { value: 'management', label: 'ผู้บริหาร',                color: '#8b5cf6' },
  { value: 'council',    label: 'สภาเทศบาล',               color: '#f59e0b' },
]

function EventCard({ ev, onEdit, onDelete, deleting }) {
  const [confirmDel, setConfirmDel] = useState(false)
  const color = EVENTS_CATEGORY_COLOR[ev.category] ?? '#6b7280'
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
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex gap-3">
      <div className="w-1 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold text-white"
                style={{ backgroundColor: color }}>
                {ev.category}
              </span>
              {ev.audience && (() => {
                const aud = AUDIENCE_OPTIONS.find(a => a.value === ev.audience)
                return aud ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border"
                    style={{ color: aud.color, borderColor: aud.color, backgroundColor: aud.color + '18' }}>
                    {ev.audience !== 'public' ? '🔒 ' : '👥 '}{aud.label}
                  </span>
                ) : null
              })()}
            </div>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-bold text-gray-800 leading-tight">{ev.title}</p>
              {ev.attachment_url && <Paperclip size={12} className="text-gray-400 shrink-0" />}
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
            <div className="flex items-center gap-1.5 shrink-0">
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

export default function EventsManager({ tenant, currentUserRole = 'staff' }) {
  const canManage = ['admin', 'superadmin', 'staff', 'officer', 'council'].includes(currentUserRole)
  const [currentUserId, setCurrentUserId] = useState(null)
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const emptyForm = { title: '', description: '', event_date: '', event_time: '', end_time: '', end_date: '', location: '', category: 'ประชุม', customCategory: '', is_all_day: false, audience: 'public', attachment_url: '', attachment_file: null }
  const [form, setForm] = useState(emptyForm)
  const [multiDay, setMultiDay] = useState(false)
  const [filterMonth, setFilterMonth] = useState('all')
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterAudience, setFilterAudience] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('upcoming')
  const [openSheet, setOpenSheet] = useState(null) // 'month' | 'category' | 'audience'
  const [pageSize, setPageSize] = useState(10)
  const [currentPage, setCurrentPage] = useState(1)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const topRef = useRef(null)

  useEffect(() => { setCurrentPage(1) }, [activeTab, searchQuery, filterMonth, filterCategory, filterAudience, pageSize])
  useEffect(() => { fetchEvents() }, [tenant.id, currentUserRole])

  useEffect(() => {
    const scroller = topRef.current?.closest('[class*="overflow-y-auto"]')
    if (!scroller) return
    const onScroll = () => setShowScrollTop(scroller.scrollTop > 250)
    scroller.addEventListener('scroll', onScroll)
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [])

  async function fetchEvents() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    const userId = user?.id
    setCurrentUserId(userId ?? null)

    let query = supabase
      .from('events')
      .select('*, creator:profiles!events_created_by_fkey(full_name)')
      .eq('municipality_id', tenant.id)
      .order('event_date', { ascending: true })

    // staff/officer/technician → เห็นทุก event เพื่อป้องกันสร้างซ้ำ
    //   แต่ edit/delete ได้เฉพาะ event ที่ตัวเองสร้าง (ดูในส่วน render)
    // council → เห็นเฉพาะ public + council
    // admin, superadmin → ไม่ filter
    if (currentUserRole === 'council') {
      if (userId) query = query.or(`audience.in.(public,council),created_by.eq.${userId}`)
      else query = query.in('audience', ['public', 'council'])
    }
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
    setForm({ ...emptyForm, event_date: today })
    setMultiDay(false)
    setEditingEvent(null)
    setShowForm(true)
  }

  function openEdit(ev) {
    const hasMultiDay = !!(ev.end_date && ev.end_date !== ev.event_date)
    setForm({
      title: ev.title, description: ev.description ?? '', event_date: ev.event_date,
      event_time: ev.event_time ?? '', end_date: ev.end_date ?? '', location: ev.location ?? '',
      category: EVENTS_CATEGORIES.includes(ev.category ?? '') ? ev.category : 'อื่นๆ',
      customCategory: EVENTS_CATEGORIES.includes(ev.category ?? '') ? '' : (ev.category ?? ''),
      is_all_day: false,
      audience: ev.audience ?? 'public', attachment_url: ev.attachment_url ?? '',
      attachment_file: null, end_time: ev.end_time ?? '',
    })
    setMultiDay(hasMultiDay)
    setEditingEvent(ev)
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.title.trim()) { setFormError('กรุณากรอกชื่อกิจกรรม'); return }
    if (!form.event_date) { setFormError('กรุณาระบุวันที่กิจกรรม'); return }
    setFormError('')
    setSaving(true)
    let attachmentUrl = form.attachment_url || null
    if (form.attachment_file) {
      const file = form.attachment_file
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${tenant.id}/${Date.now()}_${safeName}`
      const toUpload = await compressImage(file, 1200)
      const { error: upErr } = await supabase.storage.from('event-attachments').upload(path, toUpload, { upsert: false })
      if (upErr) { setSaving(false); setFormError('อัปโหลดไฟล์ไม่สำเร็จ: ' + upErr.message); return }
      const { data: { publicUrl } } = supabase.storage.from('event-attachments').getPublicUrl(path)
      attachmentUrl = publicUrl
    }
    const payload = {
      municipality_id: tenant.id, title: form.title.trim(),
      description: form.description.trim() || null, event_date: form.event_date,
      event_time: form.event_time || null,
      end_time: form.end_time || null,
      end_date: form.end_date || null, location: form.location.trim() || null,
      category: form.category === 'อื่นๆ' ? (form.customCategory.trim() || 'อื่นๆ') : form.category,
      is_all_day: false, audience: form.audience,
      attachment_url: attachmentUrl, updated_at: new Date().toISOString(),
    }
    if (editingEvent) {
      const { error: updErr } = await supabase.from('events').update(payload).eq('id', editingEvent.id)
      if (updErr) { setSaving(false); setFormError('บันทึกไม่สำเร็จ: ' + updErr.message); return }
    } else {
      const { data: { user } } = await supabase.auth.getUser()
      const { error: insErr } = await supabase.from('events').insert({ ...payload, created_by: user?.id ?? null })
      if (insErr) { setSaving(false); setFormError('บันทึกไม่สำเร็จ: ' + insErr.message); return }
      const dateStr = payload.event_date
        ? new Date(payload.event_date + 'T00:00:00').toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
        : ''
      const timeStr = payload.event_time
        ? `⏰ ${payload.event_time.slice(0, 5)}${payload.end_time ? ` – ${payload.end_time.slice(0, 5)}` : ''} น.`
        : ''
      const audLabel = AUDIENCE_OPTIONS.find(a => a.value === payload.audience)?.label ?? payload.audience
      notifyTelegram(
        tenant.telegram_group_id,
        `📅 <b>กิจกรรมใหม่</b> [${audLabel}]\n<b>${payload.title}</b>${dateStr ? `\n📆 ${dateStr}` : ''}${timeStr ? `\n${timeStr}` : ''}${payload.location ? `\n📍 ${payload.location}` : ''}${payload.description ? `\n📝 ${payload.description.slice(0, 120)}` : ''}`
      )
    }
    setSaving(false)
    setShowForm(false)
    fetchEvents()
  }

  async function handleDelete(id) {
    setDeleting(id)
    const ev = events.find(e => e.id === id)
    await logAction({
      action: 'delete', resourceType: 'event',
      resourceId: id,
      resourceLabel: ev?.title,
      municipalityId: tenant.id,
      metadata: { event_date: ev?.event_date, category: ev?.category, audience: ev?.audience },
    })
    const { error } = await supabase.from('events').delete().eq('id', id)
    setDeleting(null)
    if (!error) {
      setEvents((prev) => prev.filter((e) => e.id !== id))
    }
  }

  let filteredEvents = events
  if (filterMonth !== 'all') filteredEvents = filteredEvents.filter(e => e.event_date.startsWith(filterMonth))
  if (filterCategory !== 'all') filteredEvents = filteredEvents.filter(e => e.category === filterCategory)
  if (filterAudience !== 'all') filteredEvents = filteredEvents.filter(e => e.audience === filterAudience)
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
    .filter(e => filterAudience === 'all' || e.audience === filterAudience)
    .filter(matchSearch)
  const monthCounts = eventsForMonthCount.reduce((acc, e) => {
    const ym = e.event_date.slice(0, 7)
    acc[ym] = (acc[ym] || 0) + 1
    return acc
  }, {})

  const eventsForCatCount = events
    .filter(e => filterMonth === 'all' || e.event_date.startsWith(filterMonth))
    .filter(e => filterAudience === 'all' || e.audience === filterAudience)
    .filter(matchSearch)
  const categoryCounts = Object.fromEntries(
    EVENTS_CATEGORIES.map(cat => [cat, eventsForCatCount.filter(e => e.category === cat).length])
  )

  const eventsForAudienceCount = events
    .filter(e => filterMonth === 'all' || e.event_date.startsWith(filterMonth))
    .filter(e => filterCategory === 'all' || e.category === filterCategory)
    .filter(matchSearch)
  const audienceCounts = Object.fromEntries(
    AUDIENCE_OPTIONS.map(opt => [opt.value, eventsForAudienceCount.filter(e => e.audience === opt.value).length])
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

  return (
    <div className="space-y-4" ref={topRef}>
      {showScrollTop && (
        <button onClick={scrollToTop}
          className="fixed bottom-20 right-4 z-50 md:bottom-8 md:right-8 w-11 h-11 rounded-full bg-white shadow-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 active:scale-95 transition-all">
          <ChevronUp size={20} />
        </button>
      )}
      {/* Mobile header */}
      <div className="md:hidden flex items-center justify-between">
        <h2 className="font-bold text-gray-700">ปฏิทินกิจกรรม</h2>
        {canManage && (
          <button onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            <Plus size={16} /> เพิ่มกิจกรรม
          </button>
        )}
      </div>

      {/* PC title bar */}
      <div className="hidden md:flex items-center justify-between px-5 py-2.5 border border-gray-200"
        style={{ backgroundColor: '#1a3a5c' }}>
        <h2 className="text-[13px] font-bold text-white tracking-wide">ปฏิทินกิจกรรม</h2>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded"
            style={{ backgroundColor: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.9)' }}>
            {filteredEvents.length} รายการ
          </span>
          {canManage && (
            <button onClick={openAdd}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold border transition-colors hover:bg-white/20"
              style={{ backgroundColor: 'rgba(255,255,255,0.12)', color: '#fff', borderColor: 'rgba(255,255,255,0.3)' }}>
              <Plus size={13} /> เพิ่มกิจกรรม
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
            ...Array.from(new Set(events.map(e => e.event_date.slice(0, 7)))).sort().reverse().map(ym => {
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
                  <span className="text-[11px] font-semibold" style={{ color: hasFilter ? '#ef4444' : '#94a3b8' }}>ล้าง</span>
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
              {Array.from(new Set(events.map(e => e.event_date.slice(0, 7)))).sort().reverse().map(ym => {
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


      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 px-4 pb-4 md:p-6">
          <div className="w-full max-w-md md:max-w-2xl bg-white rounded-t-3xl md:rounded-2xl shadow-2xl flex flex-col max-h-[90vh] md:max-h-[88vh] overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <h3 className="font-bold text-gray-800">{editingEvent ? 'แก้ไขกิจกรรม' : 'เพิ่มกิจกรรม'}</h3>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-xl hover:bg-gray-100">
                <X size={18} className="text-gray-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <div className="px-6 py-4 space-y-4">
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
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">กลุ่มเป้าหมาย</label>
                    <div className="grid grid-cols-2 gap-2">
                      {AUDIENCE_OPTIONS.filter(opt => currentUserRole === 'council' ? opt.value !== 'management' : true).map((opt) => (
                        <button key={opt.value} onClick={() => setForm((p) => ({ ...p, audience: opt.value }))}
                          className="px-3 py-2 rounded-xl text-xs font-semibold text-left transition-colors border"
                          style={form.audience === opt.value
                            ? { backgroundColor: opt.color, color: 'white', borderColor: opt.color }
                            : { backgroundColor: 'white', color: '#374151', borderColor: '#e5e7eb' }}>
                          {opt.value !== 'public' && '🔒 '}{opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="md:grid md:grid-cols-2 md:gap-6 space-y-4 md:space-y-0">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">สถานที่</label>
                    <input value={form.location} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))}
                      placeholder="เช่น ห้องประชุมสภา"
                      className="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">รายละเอียด</label>
                    <textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                      placeholder="รายละเอียดเพิ่มเติม..." rows={3}
                      className="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400 resize-none" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1.5 block">เอกสารแนบ</label>
                  {form.attachment_url && !form.attachment_file ? (
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-blue-50 border border-blue-100 rounded-xl">
                      <Paperclip size={14} className="text-blue-500 shrink-0" />
                      <a href={form.attachment_url} target="_blank" rel="noopener noreferrer"
                        className="flex-1 text-xs text-blue-600 font-medium truncate hover:underline">ดูไฟล์แนบปัจจุบัน</a>
                      <button type="button" onClick={() => setForm((p) => ({ ...p, attachment_url: '' }))}
                        className="p-1 rounded-lg hover:bg-blue-100 text-red-400 transition-colors"><X size={13} /></button>
                    </div>
                  ) : form.attachment_file ? (
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-green-50 border border-green-100 rounded-xl">
                      <Paperclip size={14} className="text-green-500 shrink-0" />
                      <span className="flex-1 text-xs text-green-700 font-medium truncate">{form.attachment_file.name}</span>
                      <button type="button" onClick={() => setForm((p) => ({ ...p, attachment_file: null }))}
                        className="p-1 rounded-lg hover:bg-green-100 text-red-400 transition-colors"><X size={13} /></button>
                    </div>
                  ) : (
                    <label className="flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 border-dashed border-gray-200 cursor-pointer hover:border-blue-300 hover:bg-blue-50/50 transition-colors">
                      <Paperclip size={15} className="text-gray-400 shrink-0" />
                      <span className="text-sm text-gray-400">แนบ PDF หรือรูปภาพ (สูงสุด 20 MB)</span>
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
                        onChange={(e) => setForm((p) => ({ ...p, attachment_file: e.target.files?.[0] ?? null }))} />
                    </label>
                  )}
                </div>
                {formError && <p className="text-xs text-red-500">{formError}</p>}
              </div>
            </div>
            <div className="border-t border-gray-100 shrink-0">
              <div className="px-6 py-4 flex gap-3">
                <button onClick={() => setShowForm(false)}
                  className="flex-1 py-3 rounded-2xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                  ยกเลิก
                </button>
                <button onClick={handleSave} disabled={saving || !form.title.trim() || !form.event_date}
                  className="flex-1 py-3 rounded-2xl text-sm font-bold text-white disabled:opacity-50"
                  style={{ backgroundColor: 'var(--color-primary)' }}>
                  {saving ? 'กำลังบันทึก...' : 'บันทึก'}
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
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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
                {activeTab === 'upcoming' ? 'ยังไม่มีกิจกรรม กด "เพิ่มกิจกรรม" เพื่อเริ่มต้น' : 'ยังไม่มีกิจกรรมที่ผ่านมา'}
              </div>
            ) : (
              <>
                {/* Mobile cards */}
                <div className={`md:hidden space-y-2 ${activeTab === 'past' ? 'opacity-80' : ''}`}>
                  {paginatedList.map((ev) => {
                    const isOwner = ['admin', 'superadmin'].includes(currentUserRole) || ev.created_by === currentUserId
                    return (
                      <EventCard key={ev.id} ev={ev}
                        onEdit={canManage && isOwner ? openEdit : null}
                        onDelete={canManage && isOwner ? handleDelete : null}
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
                        {canManage && <th className="px-3 py-2.5 text-center text-[11px] font-bold text-white">จัดการ</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {paginatedList.map((ev, i) => {
                        const color = EVENTS_CATEGORY_COLOR[ev.category] ?? '#6b7280'
                        const d = ev.event_date ? new Date(ev.event_date + 'T00:00:00') : null
                        const dateStr = d ? d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : 'ยังไม่ระบุ'
                        const timeStr = ev.event_time ? ev.event_time.slice(0, 5) + (ev.end_time ? `–${ev.end_time.slice(0, 5)}` : '') + ' น.' : '—'
                        const aud = AUDIENCE_OPTIONS.find(a => a.value === ev.audience)
                        const isOwner = ['admin', 'superadmin'].includes(currentUserRole) || ev.created_by === currentUserId
                        return (
                          <tr key={ev.id}
                            className="transition-colors"
                            style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#f5f8fc' }}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#dbeafe'}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = i % 2 === 0 ? '#fff' : '#f5f8fc'}>
                            <td className="px-3 py-2 text-center text-xs text-gray-400 border-r border-gray-200">{i + 1}</td>
                            <td className="px-3 py-2 border-r border-gray-200">
                              <p className="font-semibold text-gray-800 text-xs leading-snug">{ev.title}</p>
                              {ev.description && <p className="text-[11px] text-gray-400 truncate max-w-[220px]">{ev.description}</p>}
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
                              {aud && (
                                <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-semibold border"
                                  style={{ color: aud.color, borderColor: aud.color, backgroundColor: aud.color + '15' }}>
                                  {aud.label}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-xs text-gray-600 border-r border-gray-200 whitespace-nowrap">
                              {ev.creator?.full_name ?? <span className="text-gray-300">—</span>}
                            </td>
                            {canManage && (
                              <td className="px-3 py-2 text-center" onClick={e => e.stopPropagation()}>
                                {isOwner ? (
                                  <div className="flex items-center justify-center gap-1.5">
                                    <button onClick={() => openEdit(ev)}
                                      className="px-2.5 py-1 rounded border border-blue-400 text-blue-600 text-[11px] font-bold hover:bg-blue-600 hover:text-white transition-colors">
                                      แก้ไข
                                    </button>
                                    <button onClick={() => handleDelete(ev.id)} disabled={deleting === ev.id}
                                      className="px-2.5 py-1 rounded border border-red-300 text-red-500 text-[11px] font-bold hover:bg-red-500 hover:text-white transition-colors disabled:opacity-40">
                                      ลบ
                                    </button>
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
