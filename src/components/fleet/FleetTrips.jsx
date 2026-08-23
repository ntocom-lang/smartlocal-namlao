import { useState, useEffect } from 'react'
import { Plus, Calendar, X, ChevronLeft, ChevronRight, Route, History } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { assetIdentifier, assetOptionLabel } from '../../lib/fleetAssets'
import FleetEmptyState from './FleetEmptyState'

const STATUS_LABEL = {
  pending:     'รอการอนุมัติ',
  approved:    'อนุมัติแล้ว',
  in_progress: 'กำลังเดินทาง',
  completed:   'เสร็จสิ้น',
  rejected:    'ปฏิเสธ',
  cancelled:   'ยกเลิก',
}
const STATUS_CLR = {
  pending:     '#f59e0b',
  approved:    '#3b82f6',
  in_progress: '#8b5cf6',
  completed:   '#10b981',
  rejected:    '#ef4444',
  cancelled:   '#9ca3af',
}

const inp = 'w-full px-3 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent'
const sel = inp + ' appearance-none'

const SELECT = `*, vehicle:fleet_vehicles(id,name,license_plate,asset_code,asset_kind,meter_unit), driver:profiles!fleet_trips_driver_id_fkey(id,full_name), approver:profiles!fleet_trips_approved_by_fkey(full_name), departments(name,short_name)`

function userOptionLabel(profile, currentUserId) {
  const name = profile.full_name?.trim() || profile.email?.trim() || `ผู้ใช้ ${profile.id.slice(0, 8)}`
  return `${name}${profile.id === currentUserId ? ' (ฉัน)' : ''}`
}

function toLocalDT(date) {
  const d = new Date(date)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function fmtDT(str) {
  if (!str) return '—'
  return new Date(str).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })
}

function fmtDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('th-TH', { dateStyle: 'short' })
}

const EMPTY_RESERVE = {
  vehicle_id: '', driver_id: '', department_id: '',
  planned_departure: '', planned_return: '',
  destination: '', purpose: '',
}
const EMPTY_DIRECT = {
  vehicle_id: '', driver_id: '', department_id: '',
  started_at: '', returned_at: '',
  odometer_start: '', odometer_end: '',
  destination: '', purpose: '', notes: '',
}

/* ── Modal shell ──────────────────────────────────────── */
function Modal({ title, onClose, onSave, saveLabel = 'บันทึก', saving, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-black text-gray-800">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16} /></button>
        </div>
        <div className="overflow-y-auto p-5 space-y-4 flex-1">{children}</div>
        <div className="px-5 pb-5 pt-2 border-t border-gray-100">
          <button onClick={onSave} disabled={saving}
            className="w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            {saving ? 'กำลังบันทึก...' : saveLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Booking Calendar ────────────────────────────────────── */
const DOW_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']
const MONTH_TH = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']

function BookingCalendar({ trips, onClose }) {
  const now = new Date()
  const [yr, setYr] = useState(now.getFullYear())
  const [mo, setMo] = useState(now.getMonth()) // 0-indexed
  const [selDay, setSelDay] = useState(null)  // { day, bookings }

  function prevMonth() { setSelDay(null); if (mo === 0) { setMo(11); setYr(y => y - 1) } else setMo(m => m - 1) }
  function nextMonth() { setSelDay(null); if (mo === 11) { setMo(0); setYr(y => y + 1) } else setMo(m => m + 1) }

  const firstDow = new Date(yr, mo, 1).getDay()   // 0=Sun
  const daysInMonth = new Date(yr, mo + 1, 0).getDate()

  // all trips that have a date range (active or history)
  const relevant = trips.filter(t =>
    ['pending', 'approved', 'in_progress'].includes(t.status) ||
    (t.status === 'completed' && t.planned_departure)
  )

  function getDay(day) {
    const date = new Date(yr, mo, day)
    const dateStr = date.toISOString().slice(0, 10)
    return relevant.filter(t => {
      const start = t.planned_departure
        ? new Date(t.planned_departure).toISOString().slice(0, 10)
        : t.trip_date
      const end = t.planned_return
        ? new Date(t.planned_return).toISOString().slice(0, 10)
        : start
      return dateStr >= start && dateStr <= end
    })
  }

  const today = now.toISOString().slice(0, 10)
  // build grid cells: blanks + days
  const cells = Array(firstDow).fill(null).concat(
    Array.from({ length: daysInMonth }, (_, i) => i + 1)
  )
  // pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <button onClick={prevMonth}
              className="w-7 h-7 rounded-full hover:bg-gray-100 flex items-center justify-center">
              <ChevronLeft size={16} />
            </button>
            <h2 className="text-sm font-black text-gray-800 min-w-[130px] text-center">
              {MONTH_TH[mo]} {yr + 543}
            </h2>
            <button onClick={nextMonth}
              className="w-7 h-7 rounded-full hover:bg-gray-100 flex items-center justify-center">
              <ChevronRight size={16} />
            </button>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400">
            <X size={16} />
          </button>
        </div>

        {/* Legend */}
        <div className="flex gap-3 px-5 py-2 border-b border-gray-50 text-[10px]">
          {[['pending','#f59e0b','รอการอนุมัติ'],['approved','#3b82f6','อนุมัติแล้ว'],['in_progress','#8b5cf6','กำลังเดินทาง']].map(([,clr,lbl]) => (
            <div key={lbl} className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: clr }} />
              <span className="text-gray-500">{lbl}</span>
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="overflow-y-auto p-4">
          {/* Day-of-week header */}
          <div className="grid grid-cols-7 mb-1">
            {DOW_TH.map(d => (
              <div key={d} className="text-center text-[10px] font-bold text-gray-400 py-1">{d}</div>
            ))}
          </div>

          {/* Cells */}
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, idx) => {
              if (!day) return <div key={`blank-${idx}`} />
              const bookings = getDay(day)
              const cellDate = `${yr}-${String(mo + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
              const isToday = cellDate === today
              const isSel = selDay?.day === day
              const hasBook = bookings.length > 0
              return (
                <div key={day}
                  onClick={() => hasBook && setSelDay(isSel ? null : { day, bookings })}
                  className="rounded-xl p-1 min-h-[52px] flex flex-col transition-all"
                  style={{
                    background: isSel ? '#fffbeb' : isToday ? '#eff6ff' : '#f9fafb',
                    border: isSel ? '2px solid #d97706' : isToday ? '1.5px solid #3b82f6' : '1px solid #f3f4f6',
                    cursor: hasBook ? 'pointer' : 'default',
                  }}>
                  <span className="text-[10px] font-bold mb-0.5 self-end pr-0.5"
                        style={{ color: isSel ? '#b45309' : isToday ? '#3b82f6' : '#6b7280' }}>
                    {day}
                  </span>
                  <div className="space-y-0.5">
                    {bookings.map(t => (
                      <div key={t.id}
                        className="text-[9px] font-semibold px-1 py-0.5 rounded leading-tight truncate"
                        style={{ backgroundColor: STATUS_CLR[t.status] + '22', color: STATUS_CLR[t.status] }}>
                        {t.vehicle?.name || '—'}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Day detail panel */}
          {selDay && (
            <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50 p-3 space-y-2">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-black text-blue-700">
                  📅 {selDay.day} {MONTH_TH[mo]} {yr + 543} — {selDay.bookings.length} รายการ
                </p>
                <button onClick={() => setSelDay(null)}
                  className="text-blue-300 hover:text-blue-500 text-xs">✕</button>
              </div>
              {selDay.bookings.map(t => (
                <div key={t.id} className="bg-white rounded-xl p-3 shadow-sm space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-black text-gray-800">
                      {t.vehicle?.name} · {t.vehicle?.license_plate}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: STATUS_CLR[t.status] + '20', color: STATUS_CLR[t.status] }}>
                      {STATUS_LABEL[t.status]}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-600">📍 {t.destination} — {t.purpose}</p>
                  <p className="text-[11px] text-gray-500">👤 {t.driver?.full_name}</p>
                  {t.planned_departure && (
                    <p className="text-[10px] text-gray-400">
                      {new Date(t.planned_departure).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'})}
                      {' → '}
                      {t.planned_return ? new Date(t.planned_return).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'}) : '—'}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Summary for month */}
          {relevant.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-6">ไม่มีรายการจองในเดือนนี้</p>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Main ──────────────────────────────────────────────── */
export default function FleetTrips({ tenant, fleetInfo, depts, isAdmin }) {
  const { session } = useAuth()
  const user = session?.user

  const [trips,     setTrips]     = useState([])
  const [staffList, setStaffList] = useState([])
  const [vehicles,  setVehicles]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [modal,     setModal]     = useState(null) // 'reserve'|'direct'|'depart'|'return'
  const [selTrip,   setSelTrip]   = useState(null)
  const [form,      setForm]      = useState({})
  const [saving,    setSaving]    = useState(false)
  const [conflict,  setConflict]  = useState(false)
  const [showCal,   setShowCal]   = useState(false)
  const [historyPage, setHistoryPage] = useState(0)
  const [historyPageSize, setHistoryPageSize] = useState(20)

  /* ── Load ── */
  function loadTrips() {
    if (!tenant?.id) return
    supabase.from('fleet_trips').select(SELECT)
      .eq('municipality_id', tenant.id)
      .order('created_at', { ascending: false })
      .limit(300)
      .then(({ data, error }) => {
        if (error) console.error('fleet_trips SELECT error:', error)
        setTrips(data ?? [])
      })
  }

  useEffect(() => {
    if (!tenant?.id) return
    Promise.all([
      supabase.from('fleet_trips').select(SELECT)
        .eq('municipality_id', tenant.id)
        .order('created_at', { ascending: false })
        .limit(300),
      supabase.from('profiles').select('id,full_name,email,department_id')
        .eq('municipality_id', tenant.id)
        .not('fleet_role', 'is', null)
        .order('full_name'),
      supabase.from('fleet_vehicles').select('id,name,license_plate,asset_code,asset_kind,meter_unit')
        .eq('municipality_id', tenant.id).eq('asset_kind', 'vehicle')
        .eq('status', 'active').order('name'),
    ]).then(([{ data: t, error: te }, { data: s }, { data: v }]) => {
      if (te) console.error('fleet_trips load error:', te)
      setTrips(t ?? [])
      setStaffList(s ?? [])
      setVehicles(v ?? [])
    }).finally(() => setLoading(false))
  }, [tenant?.id])

  /* ── Realtime ── */
  useEffect(() => {
    if (!tenant?.id) return
    const ch = supabase.channel(`fleet-trips-${tenant.id}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fleet_trips' },
        async ({ eventType, new: row, old }) => {
          if (eventType === 'DELETE') return setTrips(p => p.filter(t => t.id !== old.id))
          if (row.municipality_id !== tenant.id) return
          const { data } = await supabase.from('fleet_trips').select(SELECT).eq('id', row.id).single()
          if (!data) return
          setTrips(p => p.find(t => t.id === data.id)
            ? p.map(t => t.id === data.id ? data : t)
            : [data, ...p])
        }).subscribe()
    return () => supabase.removeChannel(ch)
  }, [tenant?.id])

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  /* ── Conflict check ── */
  async function checkConflict(vehicleId, from, to) {
    const { data: busy } = await supabase.from('fleet_trips')
      .select('id').eq('vehicle_id', vehicleId).eq('status', 'in_progress').limit(1)
    if (busy?.length) return true
    const { data: overlap } = await supabase.from('fleet_trips')
      .select('id').eq('vehicle_id', vehicleId)
      .in('status', ['pending', 'approved'])
      .lt('planned_departure', to).gt('planned_return', from)
    return (overlap?.length ?? 0) > 0
  }

  /* ── Open modals ── */
  function openReserve() {
    const dep = new Date(Date.now() + 3600000)
    const ret = new Date(Date.now() + 7200000)
    setForm({
      ...EMPTY_RESERVE,
      driver_id: user?.id ?? '',
      department_id: fleetInfo?.department_id ?? '',
      planned_departure: toLocalDT(dep),
      planned_return: toLocalDT(ret),
    })
    setConflict(false)
    setModal('reserve')
  }

  function openDirect() {
    setForm({
      ...EMPTY_DIRECT,
      driver_id: user?.id ?? '',
      department_id: fleetInfo?.department_id ?? '',
      started_at: toLocalDT(new Date()),
    })
    setModal('direct')
  }

  /* ── Submit reservation ── */
  async function submitReserve() {
    if (!form.vehicle_id || !form.planned_departure || !form.planned_return || !form.destination || !form.purpose)
      return alert('กรุณากรอกข้อมูลให้ครบ')
    if (new Date(form.planned_return) <= new Date(form.planned_departure))
      return alert('เวลากลับต้องหลังเวลาออก')
    const has = await checkConflict(form.vehicle_id, form.planned_departure, form.planned_return)
    if (has) { setConflict(true); return }
    setSaving(true)
    const { error } = await supabase.from('fleet_trips').insert({
      municipality_id: tenant.id,
      vehicle_id: form.vehicle_id,
      driver_id: form.driver_id || user?.id,
      created_by: user?.id,
      department_id: form.department_id || null,
      trip_date: form.planned_departure.slice(0, 10),
      planned_departure: form.planned_departure,
      planned_return: form.planned_return,
      destination: form.destination,
      purpose: form.purpose,
      status: 'pending',
    })
    setSaving(false)
    if (error) return alert(error.message)
    setModal(null)
    loadTrips()
  }

  /* ── Submit direct entry ── */
  async function submitDirect() {
    if (!form.vehicle_id || !form.started_at || !form.destination || !form.purpose)
      return alert('กรุณากรอกข้อมูลให้ครบ')
    if (form.returned_at && new Date(form.returned_at) < new Date(form.started_at))
      return alert('เวลากลับต้องไม่ก่อนเวลาออก')
    const startMeter = form.odometer_start === '' ? null : Number(form.odometer_start)
    const endMeter = form.odometer_end === '' ? null : Number(form.odometer_end)
    if (startMeter !== null && (!Number.isFinite(startMeter) || startMeter < 0))
      return alert('เลขไมล์ก่อนออกต้องเป็น 0 หรือมากกว่า')
    if (endMeter !== null && (!Number.isFinite(endMeter) || endMeter < 0))
      return alert('เลขไมล์หลังกลับต้องเป็น 0 หรือมากกว่า')
    if (startMeter !== null && endMeter !== null && endMeter < startMeter)
      return alert('เลขไมล์หลังกลับต้องไม่น้อยกว่าเลขไมล์ก่อนออก')
    setSaving(true)
    const { error } = await supabase.from('fleet_trips').insert({
      municipality_id: tenant.id,
      vehicle_id: form.vehicle_id,
      driver_id: form.driver_id || user?.id,
      created_by: user?.id,
      department_id: form.department_id || null,
      trip_date: form.started_at.slice(0, 10),
      started_at: form.started_at,
      returned_at: form.returned_at || null,
      odometer_start: startMeter,
      odometer_end: endMeter,
      destination: form.destination,
      purpose: form.purpose,
      notes: form.notes || null,
      status: 'completed',
    })
    setSaving(false)
    if (error) return alert(error.message)
    setModal(null)
    loadTrips()
  }

  /* ── Admin approve/reject ── */
  async function handleApprove(t) {
    if (!confirm(`อนุมัติการจองรถ "${t.vehicle?.name}" ให้ ${t.driver?.full_name}?`)) return
    const { error } = await supabase.from('fleet_trips').update({ status: 'approved', approved_by: user?.id }).eq('id', t.id)
    if (error) return alert('อนุมัติไม่สำเร็จ: ' + error.message)
    loadTrips()
  }
  async function handleReject(t) {
    if (!confirm(`ปฏิเสธการจองรถ "${t.vehicle?.name}"?`)) return
    const { error } = await supabase.from('fleet_trips').update({ status: 'rejected' }).eq('id', t.id)
    if (error) return alert('ปฏิเสธไม่สำเร็จ: ' + error.message)
    loadTrips()
  }

  /* ── Depart / Return ── */
  async function submitDepart() {
    if (!form.started_at) return alert('กรุณาระบุเวลาออก')
    const startMeter = form.odometer_start === '' ? null : Number(form.odometer_start)
    if (startMeter !== null && (!Number.isFinite(startMeter) || startMeter < 0))
      return alert('เลขไมล์ก่อนออกต้องเป็น 0 หรือมากกว่า')
    setSaving(true)
    const { error } = await supabase.from('fleet_trips').update({
      status: 'in_progress',
      started_at: form.started_at,
      odometer_start: startMeter,
    }).eq('id', selTrip.id)
    setSaving(false)
    if (error) return alert(error.message)
    setModal(null); setSelTrip(null)
    loadTrips()
  }

  async function submitReturn() {
    if (!form.returned_at) return alert('กรุณาระบุเวลากลับ')
    if (selTrip.started_at && new Date(form.returned_at) < new Date(selTrip.started_at))
      return alert('เวลากลับต้องไม่ก่อนเวลาออก')
    const endMeter = form.odometer_end === '' ? null : Number(form.odometer_end)
    if (endMeter !== null && (!Number.isFinite(endMeter) || endMeter < 0))
      return alert('เลขไมล์หลังกลับต้องเป็น 0 หรือมากกว่า')
    if (selTrip.odometer_start != null && endMeter !== null && endMeter < Number(selTrip.odometer_start))
      return alert('เลขไมล์หลังกลับต้องไม่น้อยกว่าเลขไมล์ก่อนออก')
    setSaving(true)
    const { error } = await supabase.from('fleet_trips').update({
      status: 'completed',
      returned_at: form.returned_at,
      odometer_end: endMeter,
      notes: form.notes || null,
    }).eq('id', selTrip.id)
    setSaving(false)
    if (error) return alert(error.message)
    setModal(null); setSelTrip(null)
    loadTrips()
  }

  async function handleDelete(t) {
    if (!confirm(`ลบรายการ "${t.vehicle?.name}" วันที่ ${t.planned_departure ? new Date(t.planned_departure).toLocaleDateString('th-TH') : '—'}?`)) return
    const { error } = await supabase.from('fleet_trips').delete().eq('id', t.id)
    if (!error) setTrips(prev => prev.filter(x => x.id !== t.id))
    else alert('ลบไม่สำเร็จ: ' + error.message)
  }

  /* ── Derived ── */
  const active  = trips.filter(t => ['pending', 'approved', 'in_progress'].includes(t.status))
  const history = trips.filter(t => ['completed', 'rejected', 'cancelled'].includes(t.status))
  const isOwner = t => t.driver_id === user?.id

  // แบ่งหน้าฝั่ง client เพราะ trips ถูกดันเข้ามาจาก realtime subscription (postgres_changes) ตรงๆ
  // แบ่งหน้าแบบ server-range จะชนกับ logic prepend ของ realtime ยุ่งยากเกินจำเป็น — ข้อมูลต้นทางยัง
  // จำกัดที่ .limit(300) เหมือนเดิม (ไม่ใช่ไม่จำกัดจริง) แค่เพิ่ม UI แบ่งหน้าคลุมของที่โหลดมาแล้ว
  const historyTotalPages = historyPageSize === 'all' ? 1 : Math.max(1, Math.ceil(history.length / historyPageSize))
  const historyCurrentPage = Math.min(historyPage, historyTotalPages - 1)
  const pagedHistory = historyPageSize === 'all'
    ? history
    : history.slice(historyCurrentPage * historyPageSize, (historyCurrentPage + 1) * historyPageSize)

  /* ── Trip Card (mobile) ── */
  function renderTripCard(t) {
    const clr = STATUS_CLR[t.status]
    const canApprove = t.status === 'pending' && isAdmin
    const canDepart  = t.status === 'approved' && (isOwner(t) || isAdmin)
    const canReturn  = t.status === 'in_progress' && (isOwner(t) || isAdmin)
    const dist = t.distance_km ?? null
    return (
      <div key={t.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 space-y-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="flex-1 min-w-0 truncate text-[13px] font-black text-gray-800">
            {t.vehicle?.name} <span className="font-semibold text-gray-400">· {assetIdentifier(t.vehicle)}</span>
          </h3>
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: clr + '18', color: clr }}>
              {STATUS_LABEL[t.status]}
            </span>
            {t.planned_departure && (
              <span className="text-[9px] font-semibold bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded-full">จอง</span>
            )}
          </div>
        </div>
        <p className="truncate text-[11px] text-gray-600" title={`${t.destination} — ${t.purpose}`}>
          📍 {t.destination} — {t.purpose}
        </p>
        <div className="border-t border-gray-100 pt-1.5 text-[10px] leading-4 text-gray-500">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">👤 {t.driver?.full_name}{t.departments?.short_name ? ` · ${t.departments.short_name}` : ''}</span>
            {dist != null && <span className="shrink-0 font-bold text-gray-700">📏 {dist.toLocaleString()} กม.</span>}
          </div>
          {t.planned_departure && <div>🗓 {fmtDT(t.planned_departure)} – {fmtDT(t.planned_return)}</div>}
          {t.started_at && <div>🚀 {fmtDT(t.started_at)}{t.odometer_start ? ` · ${Number(t.odometer_start).toLocaleString()} กม.` : ''}</div>}
          {t.returned_at && <div>🏁 {fmtDT(t.returned_at)}{t.odometer_end ? ` · ${Number(t.odometer_end).toLocaleString()} กม.` : ''}</div>}
        </div>
        {(canApprove || canDepart || canReturn || isAdmin) && (
          <div className="flex gap-1.5 pt-0.5">
            {canApprove && <>
              <button onClick={() => handleApprove(t)}
                className="flex-1 py-1.5 rounded-lg text-[11px] font-bold text-white bg-green-500">
                ✓ อนุมัติ
              </button>
              <button onClick={() => handleReject(t)}
                className="flex-1 py-1.5 rounded-lg text-[11px] font-bold text-red-500 border border-red-200 bg-red-50">
                ✕ ปฏิเสธ
              </button>
            </>}
            {isAdmin && (
              <button onClick={() => handleDelete(t)}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-red-500 border border-red-200 bg-red-50 hover:bg-red-500 hover:text-white transition-colors">
                ลบ
              </button>
            )}
            {canDepart && (
              <button onClick={() => {
                setSelTrip(t)
                setForm({ started_at: toLocalDT(new Date()), odometer_start: '' })
                setModal('depart')
              }} className="flex-1 py-1.5 rounded-lg text-[11px] font-bold text-white"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                🚀 ออกเดินทาง
              </button>
            )}
            {canReturn && (
              <button onClick={() => {
                setSelTrip(t)
                setForm({ returned_at: toLocalDT(new Date()), odometer_end: '', notes: '' })
                setModal('return')
              }} className="flex-1 py-1.5 rounded-lg text-[11px] font-bold text-white bg-green-600">
                🏁 กลับถึง
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  /* ── Trip Row (desktop) ── */
  function renderTripRow(t, idx) {
    const clr = STATUS_CLR[t.status]
    const canApprove = t.status === 'pending' && isAdmin
    const canDepart  = t.status === 'approved' && (isOwner(t) || isAdmin)
    const canReturn  = t.status === 'in_progress' && (isOwner(t) || isAdmin)
    const dateStr = t.planned_departure ? fmtDate(t.planned_departure) : fmtDate(t.trip_date || t.started_at)
    const dist = t.distance_km ?? null
    return (
      <tr key={t.id} style={{ backgroundColor: idx % 2 === 0 ? '#fff' : '#f5f8fc' }}
          className="hover:bg-blue-50 transition-colors">
        <td className="px-3 py-2.5 text-center text-xs text-gray-400 border-r border-gray-200">{idx + 1}</td>
        <td className="px-4 py-2.5 text-xs border-r border-gray-200">
          <div className="font-semibold text-gray-700">{dateStr}</div>
          {t.planned_departure && <div className="text-[10px] text-blue-400">📅 จอง</div>}
        </td>
        <td className="px-4 py-2.5 text-xs font-semibold text-gray-700 border-r border-gray-200 whitespace-nowrap">
          {t.vehicle?.name}
        </td>
        <td className="px-4 py-2.5 text-xs text-gray-600 border-r border-gray-200">{t.destination}</td>
        <td className="px-4 py-2.5 text-xs text-gray-500 border-r border-gray-200">{t.purpose}</td>
        <td className="px-4 py-2.5 text-xs text-gray-600 border-r border-gray-200 whitespace-nowrap">
          {t.driver?.full_name}
        </td>
        <td className="px-4 py-2.5 text-xs text-gray-500 border-r border-gray-200 text-right whitespace-nowrap">
          {dist != null ? `${dist.toLocaleString()} กม.` : '—'}
        </td>
        <td className="px-4 py-2.5 text-xs border-r border-gray-200">
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap"
                style={{ backgroundColor: clr + '18', color: clr }}>
            {STATUS_LABEL[t.status]}
          </span>
        </td>
        <td className="px-3 py-2.5 text-xs">
          <div className="flex gap-1 justify-center flex-wrap">
            {canApprove && <>
              <button onClick={() => handleApprove(t)}
                className="px-2 py-1 rounded-lg bg-green-500 text-white text-[12px] font-bold">อนุมัติ</button>
              <button onClick={() => handleReject(t)}
                className="px-2 py-1 rounded-lg border border-red-200 text-red-500 text-[12px] font-bold">ปฏิเสธ</button>
            </>}
            {canDepart && (
              <button onClick={() => {
                setSelTrip(t)
                setForm({ started_at: toLocalDT(new Date()), odometer_start: '' })
                setModal('depart')
              }} className="px-2 py-1 rounded-lg text-white text-[12px] font-bold whitespace-nowrap"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                🚀 ออก
              </button>
            )}
            {canReturn && (
              <button onClick={() => {
                setSelTrip(t)
                setForm({ returned_at: toLocalDT(new Date()), odometer_end: '', notes: '' })
                setModal('return')
              }} className="px-2 py-1 rounded-lg bg-green-600 text-white text-[12px] font-bold whitespace-nowrap">
                🏁 กลับ
              </button>
            )}
            {isAdmin && (
              <button onClick={() => handleDelete(t)}
                className="px-2 py-1 rounded-lg border border-red-300 text-red-400 hover:bg-red-400 hover:text-white text-[12px] font-bold transition-colors">
                ลบ
              </button>
            )}
          </div>
        </td>
      </tr>
    )
  }

  /* ── Table wrapper ── */
  function renderTripsTable(rows) {
    return (
      <div className="hidden md:block overflow-x-auto rounded-xl border border-gray-300 shadow-sm">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr style={{ backgroundColor: '#1a3a5c' }}>
              {['ที่', 'วันที่', 'ยานพาหนะ', 'ปลายทาง', 'วัตถุประสงค์', 'ผู้ใช้รถ', 'ระยะทาง', 'สถานะ', 'ดำเนินการ'].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-xs font-bold text-white border-r border-white/10 last:border-r-0 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => renderTripRow(t, i))}
          </tbody>
        </table>
      </div>
    )
  }

  if (loading) return (
    <div className="flex justify-center py-8">
      <div className="w-5 h-5 border-4 border-gray-200 rounded-full animate-spin"
           style={{ borderTopColor: 'var(--color-primary)' }} />
    </div>
  )

  return (
    <div className="space-y-3 md:space-y-5">

      {/* ── Action buttons ── */}
      <div className="flex items-center gap-1.5 md:gap-2 flex-nowrap md:flex-wrap">
        <button onClick={openReserve}
          className="flex items-center gap-1.5 px-3 py-2 md:px-4 md:py-2.5 rounded-lg md:rounded-xl text-[11px] md:text-xs font-bold border-2 text-blue-600 border-blue-300 bg-blue-50 hover:bg-blue-100 transition-colors">
          <Calendar size={13} /> จองรถ
        </button>
        <button onClick={openDirect}
          className="flex items-center gap-1.5 px-3 py-2 md:px-4 md:py-2.5 rounded-lg md:rounded-xl text-[11px] md:text-xs font-bold text-white transition-colors"
          style={{ backgroundColor: 'var(--color-primary)' }}>
          <Plus size={13} /> บันทึกการเดินทาง
        </button>
        <button onClick={() => setShowCal(true)} aria-label="เปิดปฏิทินการจอง"
          className="md:hidden ml-auto flex items-center gap-1 px-2.5 py-2 rounded-lg text-[11px] font-bold text-blue-600 bg-blue-50">
          <Calendar size={13} /> ปฏิทิน
        </button>
      </div>

      {/* ── Active trips ── */}
      <div className="space-y-1.5 md:space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] md:text-xs font-bold text-gray-500 uppercase tracking-wide">
            การจองและการเดินทาง{active.length > 0 && <span className="text-blue-500 normal-case ml-1">({active.length})</span>}
          </p>
          <button onClick={() => setShowCal(true)}
            className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[13px] font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors">
            <Calendar size={13} /> ปฏิทินการจอง
          </button>
        </div>
        {active.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
            <FleetEmptyState icon={Route} title="ยังไม่มีรายการจองหรือการเดินทางที่ดำเนินการอยู่"
              hint={<>กด <strong className="text-gray-500">จองรถ</strong> เพื่อส่งคำขอ</>} />
          </div>
        ) : <>
          {renderTripsTable(active)}
          <div className="md:hidden space-y-1.5">
            {active.map(renderTripCard)}
          </div>
        </>}
      </div>

      {/* ── History ── */}
      <div className="space-y-1.5 md:space-y-2">
        <p className="text-[11px] md:text-xs font-bold text-gray-500 uppercase tracking-wide">
          ประวัติการเดินทาง <span className="text-gray-400 normal-case">({history.length})</span>
        </p>
        {history.length === 0 ? (
          <FleetEmptyState icon={History} title="ยังไม่มีประวัติการเดินทาง" />
        ) : <>
          {renderTripsTable(pagedHistory)}
          <div className="md:hidden space-y-1.5">
            {pagedHistory.map(renderTripCard)}
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-1 py-2 text-xs text-gray-500">
            <div className="flex items-center gap-2">
              <span>แสดง</span>
              <select value={historyPageSize}
                onChange={e => { setHistoryPageSize(e.target.value === 'all' ? 'all' : Number(e.target.value)); setHistoryPage(0) }}
                className="bg-white border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-200">
                {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
                <option value="all">ทั้งหมด</option>
              </select>
              <span>รายการ</span>
              <span className="text-gray-400">
                ({historyPageSize === 'all' ? 1 : historyCurrentPage * historyPageSize + 1}–{historyPageSize === 'all' ? history.length : Math.min((historyCurrentPage + 1) * historyPageSize, history.length)} จาก {history.length})
              </span>
            </div>
            {historyPageSize !== 'all' && history.length > historyPageSize && (
              <div className="flex items-center gap-2">
                <button onClick={() => setHistoryPage(p => Math.max(0, p - 1))} disabled={historyCurrentPage === 0}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white font-semibold disabled:opacity-40">ก่อนหน้า</button>
                <span>หน้า {historyCurrentPage + 1} / {historyTotalPages}</span>
                <button onClick={() => setHistoryPage(p => p + 1)} disabled={historyCurrentPage >= historyTotalPages - 1}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white font-semibold disabled:opacity-40">ถัดไป</button>
              </div>
            )}
          </div>
        </>}
      </div>

      {showCal && <BookingCalendar trips={trips} onClose={() => setShowCal(false)} />}

      {/* ═══ MODALS ═══ */}

      {/* จองรถ */}
      {modal === 'reserve' && (
        <Modal title="📅 จองรถ" onClose={() => setModal(null)} onSave={submitReserve}
               saveLabel="ส่งคำขอจอง" saving={saving}>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">ยานพาหนะ *</label>
            <select value={form.vehicle_id}
              onChange={e => { set('vehicle_id')(e); setConflict(false) }} className={sel}>
              <option value="">— เลือกรถ —</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{assetOptionLabel(v)}</option>)}
            </select>
          </div>
          {conflict && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-600 font-semibold">
              ⚠️ รถคันนี้ถูกจองในช่วงเวลาดังกล่าวแล้ว — กรุณาเปลี่ยนเวลาหรือเลือกรถคันอื่น
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">วันเวลาออก *</label>
              <input type="datetime-local" value={form.planned_departure}
                onChange={e => { set('planned_departure')(e); setConflict(false) }} className={inp} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">กลับโดยประมาณ *</label>
              <input type="datetime-local" value={form.planned_return}
                onChange={e => { set('planned_return')(e); setConflict(false) }} className={inp} />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">ผู้ใช้รถ</label>
            <select value={form.driver_id} onChange={set('driver_id')} className={sel}>
              {staffList.map(s => (
                <option key={s.id} value={s.id}>{userOptionLabel(s, user?.id)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">กอง/หน่วยงาน</label>
            <select value={form.department_id} onChange={set('department_id')} className={sel}>
              <option value="">ทุกกอง</option>
              {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">ปลายทาง *</label>
            <input value={form.destination} onChange={set('destination')}
              placeholder="เช่น อำเภอเมือง" className={inp} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">วัตถุประสงค์ *</label>
            <input value={form.purpose} onChange={set('purpose')}
              placeholder="เช่น ประชุมราชการ" className={inp} />
          </div>
        </Modal>
      )}

      {/* บันทึกทีหลัง */}
      {modal === 'direct' && (
        <Modal title="📝 บันทึกการเดินทาง" onClose={() => setModal(null)} onSave={submitDirect}
               saveLabel="บันทึก" saving={saving}>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">ยานพาหนะ *</label>
            <select value={form.vehicle_id} onChange={set('vehicle_id')} className={sel}>
              <option value="">— เลือกรถ —</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{assetOptionLabel(v)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">ผู้ใช้รถ</label>
            <select value={form.driver_id} onChange={set('driver_id')} className={sel}>
              {staffList.map(s => (
                <option key={s.id} value={s.id}>{userOptionLabel(s, user?.id)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">กอง/หน่วยงาน</label>
            <select value={form.department_id} onChange={set('department_id')} className={sel}>
              <option value="">ทุกกอง</option>
              {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">ปลายทาง *</label>
            <input value={form.destination} onChange={set('destination')}
              placeholder="เช่น อำเภอเมือง" className={inp} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">วัตถุประสงค์ *</label>
            <input value={form.purpose} onChange={set('purpose')}
              placeholder="เช่น ประชุมราชการ" className={inp} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">วันเวลาออก *</label>
              <input type="datetime-local" value={form.started_at} onChange={set('started_at')} className={inp} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">วันเวลากลับ</label>
              <input type="datetime-local" value={form.returned_at} onChange={set('returned_at')} className={inp} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">เลขไมล์ก่อน (กม.)</label>
              <input type="number" value={form.odometer_start} onChange={set('odometer_start')}
                placeholder="0" className={inp} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">เลขไมล์หลัง (กม.)</label>
              <input type="number" value={form.odometer_end} onChange={set('odometer_end')}
                placeholder="0" className={inp} />
            </div>
          </div>
          {form.odometer_start && form.odometer_end && Number(form.odometer_end) > Number(form.odometer_start) && (
            <div className="bg-gray-50 rounded-xl p-2.5 text-xs text-center font-bold text-gray-700">
              📏 ระยะทาง: {(Number(form.odometer_end) - Number(form.odometer_start)).toLocaleString()} กม.
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">หมายเหตุ</label>
            <input value={form.notes} onChange={set('notes')} className={inp} />
          </div>
        </Modal>
      )}

      {/* บันทึกออกเดินทาง */}
      {modal === 'depart' && selTrip && (
        <Modal title="🚀 บันทึกออกเดินทาง"
               onClose={() => { setModal(null); setSelTrip(null) }}
               onSave={submitDepart} saveLabel="ยืนยันออกเดินทาง" saving={saving}>
          <div className="bg-blue-50 rounded-xl p-3">
            <p className="text-sm font-bold text-gray-800">
              {selTrip.vehicle?.name} · {assetIdentifier(selTrip.vehicle)}
            </p>
            <p className="text-xs text-gray-600">{selTrip.destination} — {selTrip.purpose}</p>
            <p className="text-xs text-blue-500 mt-1">👤 {selTrip.driver?.full_name}</p>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">เวลาออกจริง *</label>
            <input type="datetime-local" value={form.started_at} onChange={set('started_at')} className={inp} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">เลขไมล์ก่อนออก (กม.)</label>
            <input type="number" value={form.odometer_start} onChange={set('odometer_start')}
              placeholder="เช่น 12345" className={inp} />
          </div>
        </Modal>
      )}

      {/* บันทึกกลับถึง */}
      {modal === 'return' && selTrip && (
        <Modal title="🏁 บันทึกกลับถึง"
               onClose={() => { setModal(null); setSelTrip(null) }}
               onSave={submitReturn} saveLabel="ยืนยันกลับถึง" saving={saving}>
          <div className="bg-green-50 rounded-xl p-3">
            <p className="text-sm font-bold text-gray-800">
              {selTrip.vehicle?.name} · {assetIdentifier(selTrip.vehicle)}
            </p>
            <p className="text-xs text-gray-600">{selTrip.destination} — {selTrip.purpose}</p>
            {selTrip.odometer_start && (
              <p className="text-xs text-green-600 mt-1">
                เลขไมล์ก่อนออก: {Number(selTrip.odometer_start).toLocaleString()} กม.
              </p>
            )}
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">เวลากลับจริง *</label>
            <input type="datetime-local" value={form.returned_at} onChange={set('returned_at')} className={inp} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">เลขไมล์หลังกลับ (กม.)</label>
            <input type="number" value={form.odometer_end} onChange={set('odometer_end')}
              placeholder="เช่น 12400" className={inp} />
          </div>
          {selTrip.odometer_start && form.odometer_end && Number(form.odometer_end) > Number(selTrip.odometer_start) && (
            <div className="bg-gray-50 rounded-xl p-2.5 text-sm text-center font-bold text-gray-700">
              📏 ระยะทาง: {(Number(form.odometer_end) - Number(selTrip.odometer_start)).toLocaleString()} กม.
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">หมายเหตุ</label>
            <input value={form.notes} onChange={set('notes')} className={inp} />
          </div>
        </Modal>
      )}

    </div>
  )
}
