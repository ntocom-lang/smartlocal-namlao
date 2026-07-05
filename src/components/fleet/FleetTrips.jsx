import { useState, useEffect } from 'react'
import { Plus, Calendar, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

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

const SELECT = `*, vehicle:fleet_vehicles(id,name,license_plate), driver:profiles!fleet_trips_driver_id_fkey(id,full_name), approver:profiles!fleet_trips_approved_by_fkey(full_name)`

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

  /* ── Load ── */
  useEffect(() => {
    if (!tenant?.id) return
    Promise.all([
      supabase.from('fleet_trips').select(SELECT)
        .eq('municipality_id', tenant.id)
        .order('created_at', { ascending: false })
        .limit(300),
      supabase.from('profiles').select('id,full_name,fleet_department_id')
        .eq('municipality_id', tenant.id)
        .not('fleet_role', 'is', null),
      supabase.from('fleet_vehicles').select('id,name,license_plate')
        .eq('municipality_id', tenant.id).eq('status', 'active').order('name'),
    ]).then(([{ data: t }, { data: s }, { data: v }]) => {
      setTrips(t ?? [])
      setStaffList(s ?? [])
      setVehicles(v ?? [])
    }).finally(() => setLoading(false))
  }, [tenant?.id])

  /* ── Realtime ── */
  useEffect(() => {
    if (!tenant?.id) return
    const ch = supabase.channel(`fleet-trips-${tenant.id}`)
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
      department_id: fleetInfo?.fleet_department_id ?? '',
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
      department_id: fleetInfo?.fleet_department_id ?? '',
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
      department_id: form.department_id || null,
      planned_departure: form.planned_departure,
      planned_return: form.planned_return,
      destination: form.destination,
      purpose: form.purpose,
      status: 'pending',
    })
    setSaving(false)
    if (error) return alert(error.message)
    setModal(null)
  }

  /* ── Submit direct entry ── */
  async function submitDirect() {
    if (!form.vehicle_id || !form.started_at || !form.destination || !form.purpose)
      return alert('กรุณากรอกข้อมูลให้ครบ')
    setSaving(true)
    const { error } = await supabase.from('fleet_trips').insert({
      municipality_id: tenant.id,
      vehicle_id: form.vehicle_id,
      driver_id: form.driver_id || user?.id,
      department_id: form.department_id || null,
      started_at: form.started_at,
      returned_at: form.returned_at || null,
      odometer_start: form.odometer_start ? Number(form.odometer_start) : null,
      odometer_end: form.odometer_end ? Number(form.odometer_end) : null,
      destination: form.destination,
      purpose: form.purpose,
      notes: form.notes || null,
      status: 'completed',
    })
    setSaving(false)
    if (error) return alert(error.message)
    setModal(null)
  }

  /* ── Admin approve/reject ── */
  async function handleApprove(t) {
    if (!confirm(`อนุมัติการจองรถ "${t.vehicle?.name}" ให้ ${t.driver?.full_name}?`)) return
    await supabase.from('fleet_trips').update({ status: 'approved', approved_by: user?.id }).eq('id', t.id)
  }
  async function handleReject(t) {
    if (!confirm(`ปฏิเสธการจองรถ "${t.vehicle?.name}"?`)) return
    await supabase.from('fleet_trips').update({ status: 'rejected' }).eq('id', t.id)
  }

  /* ── Depart / Return ── */
  async function submitDepart() {
    if (!form.started_at) return alert('กรุณาระบุเวลาออก')
    setSaving(true)
    const { error } = await supabase.from('fleet_trips').update({
      status: 'in_progress',
      started_at: form.started_at,
      odometer_start: form.odometer_start ? Number(form.odometer_start) : null,
    }).eq('id', selTrip.id)
    setSaving(false)
    if (error) return alert(error.message)
    setModal(null); setSelTrip(null)
  }

  async function submitReturn() {
    if (!form.returned_at) return alert('กรุณาระบุเวลากลับ')
    setSaving(true)
    const { error } = await supabase.from('fleet_trips').update({
      status: 'completed',
      returned_at: form.returned_at,
      odometer_end: form.odometer_end ? Number(form.odometer_end) : null,
      notes: form.notes || null,
    }).eq('id', selTrip.id)
    setSaving(false)
    if (error) return alert(error.message)
    setModal(null); setSelTrip(null)
  }

  /* ── Derived ── */
  const active  = trips.filter(t => ['pending', 'approved', 'in_progress'].includes(t.status))
  const history = trips.filter(t => ['completed', 'rejected', 'cancelled'].includes(t.status))
  const isOwner = t => t.driver_id === user?.id

  /* ── Trip Card (mobile) ── */
  function TripCard({ t }) {
    const clr = STATUS_CLR[t.status]
    const canApprove = t.status === 'pending' && isAdmin
    const canDepart  = t.status === 'approved' && (isOwner(t) || isAdmin)
    const canReturn  = t.status === 'in_progress' && (isOwner(t) || isAdmin)
    const dist = t.odometer_start && t.odometer_end ? t.odometer_end - t.odometer_start : null
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-2">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: clr + '18', color: clr }}>
                {STATUS_LABEL[t.status]}
              </span>
              {t.planned_departure && (
                <span className="text-[10px] font-semibold bg-blue-50 text-blue-500 px-2 py-0.5 rounded-full">
                  📅 จอง
                </span>
              )}
            </div>
            <h3 className="text-sm font-bold text-gray-800 mt-1">
              {t.vehicle?.name} · {t.vehicle?.license_plate}
            </h3>
            <p className="text-xs text-gray-600">📍 {t.destination} — {t.purpose}</p>
          </div>
        </div>
        <div className="text-[11px] text-gray-500 space-y-0.5 border-t border-gray-50 pt-2">
          <div>👤 {t.driver?.full_name}{t.department_id ? ` · ${depts.find(d => d.id === t.department_id)?.short_name ?? ''}` : ''}</div>
          {t.planned_departure && <div>📅 วางแผน: {fmtDT(t.planned_departure)} – {fmtDT(t.planned_return)}</div>}
          {t.started_at && (
            <div>🚀 ออก: {fmtDT(t.started_at)}{t.odometer_start ? ` (${Number(t.odometer_start).toLocaleString()} กม.)` : ''}</div>
          )}
          {t.returned_at && (
            <div>🏁 กลับ: {fmtDT(t.returned_at)}{t.odometer_end ? ` (${Number(t.odometer_end).toLocaleString()} กม.)` : ''}</div>
          )}
          {dist != null && <div className="font-semibold text-gray-700">📏 ระยะทาง: {dist.toLocaleString()} กม.</div>}
        </div>
        {(canApprove || canDepart || canReturn) && (
          <div className="flex gap-2 pt-1">
            {canApprove && <>
              <button onClick={() => handleApprove(t)}
                className="flex-1 py-2 rounded-xl text-xs font-bold text-white bg-green-500">
                ✓ อนุมัติ
              </button>
              <button onClick={() => handleReject(t)}
                className="flex-1 py-2 rounded-xl text-xs font-bold text-red-500 border border-red-200 bg-red-50">
                ✕ ปฏิเสธ
              </button>
            </>}
            {canDepart && (
              <button onClick={() => {
                setSelTrip(t)
                setForm({ started_at: toLocalDT(new Date()), odometer_start: '' })
                setModal('depart')
              }} className="flex-1 py-2 rounded-xl text-xs font-bold text-white"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                🚀 บันทึกออกเดินทาง
              </button>
            )}
            {canReturn && (
              <button onClick={() => {
                setSelTrip(t)
                setForm({ returned_at: toLocalDT(new Date()), odometer_end: '', notes: '' })
                setModal('return')
              }} className="flex-1 py-2 rounded-xl text-xs font-bold text-white bg-green-600">
                🏁 บันทึกกลับถึง
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  /* ── Trip Row (desktop) ── */
  function TripRow({ t, idx }) {
    const clr = STATUS_CLR[t.status]
    const canApprove = t.status === 'pending' && isAdmin
    const canDepart  = t.status === 'approved' && (isOwner(t) || isAdmin)
    const canReturn  = t.status === 'in_progress' && (isOwner(t) || isAdmin)
    const dateStr = t.planned_departure ? fmtDate(t.planned_departure) : fmtDate(t.started_at)
    const dist = t.odometer_start && t.odometer_end ? t.odometer_end - t.odometer_start : null
    return (
      <tr style={{ backgroundColor: idx % 2 === 0 ? '#fff' : '#f5f8fc' }}
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
                className="px-2 py-1 rounded-lg bg-green-500 text-white text-[10px] font-bold">อนุมัติ</button>
              <button onClick={() => handleReject(t)}
                className="px-2 py-1 rounded-lg border border-red-200 text-red-500 text-[10px] font-bold">ปฏิเสธ</button>
            </>}
            {canDepart && (
              <button onClick={() => {
                setSelTrip(t)
                setForm({ started_at: toLocalDT(new Date()), odometer_start: '' })
                setModal('depart')
              }} className="px-2 py-1 rounded-lg text-white text-[10px] font-bold whitespace-nowrap"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                🚀 ออก
              </button>
            )}
            {canReturn && (
              <button onClick={() => {
                setSelTrip(t)
                setForm({ returned_at: toLocalDT(new Date()), odometer_end: '', notes: '' })
                setModal('return')
              }} className="px-2 py-1 rounded-lg bg-green-600 text-white text-[10px] font-bold whitespace-nowrap">
                🏁 กลับ
              </button>
            )}
          </div>
        </td>
      </tr>
    )
  }

  /* ── Table wrapper ── */
  function TripsTable({ rows }) {
    return (
      <div className="hidden md:block overflow-x-auto rounded-xl border border-gray-300 shadow-sm">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr style={{ backgroundColor: '#1a3a5c' }}>
              {['ที่', 'วันที่', 'ยานพาหนะ', 'ปลายทาง', 'วัตถุประสงค์', 'ผู้ขับ', 'ระยะทาง', 'สถานะ', 'ดำเนินการ'].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-xs font-bold text-white border-r border-white/10 last:border-r-0 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => <TripRow key={t.id} t={t} idx={i} />)}
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
    <div className="space-y-5">

      {/* ── Action buttons ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={openReserve}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold border-2 text-blue-600 border-blue-300 bg-blue-50 hover:bg-blue-100 transition-colors">
          <Calendar size={13} /> จองรถ
        </button>
        <button onClick={openDirect}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-white transition-colors"
          style={{ backgroundColor: 'var(--color-primary)' }}>
          <Plus size={13} /> บันทึกทีหลัง
        </button>
      </div>

      {/* ── Active trips ── */}
      {active.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">
            กำลังดำเนินการ <span className="text-blue-500 normal-case">({active.length})</span>
          </p>
          <TripsTable rows={active} />
          <div className="md:hidden space-y-2">
            {active.map(t => <TripCard key={t.id} t={t} />)}
          </div>
        </div>
      )}

      {/* ── History ── */}
      <div className="space-y-2">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">
          ประวัติการเดินทาง <span className="text-gray-400 normal-case">({history.length})</span>
        </p>
        {history.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-8">ยังไม่มีรายการ</p>
        ) : <>
          <TripsTable rows={history} />
          <div className="md:hidden space-y-2">
            {history.map(t => <TripCard key={t.id} t={t} />)}
          </div>
        </>}
      </div>

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
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.name} ({v.license_plate})</option>)}
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
            <label className="text-xs font-semibold text-gray-600 mb-1 block">ผู้ขับ / ผู้ใช้รถ</label>
            <select value={form.driver_id} onChange={set('driver_id')} className={sel}>
              {staffList.map(s => (
                <option key={s.id} value={s.id}>{s.full_name}{s.id === user?.id ? ' (ฉัน)' : ''}</option>
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
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.name} ({v.license_plate})</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">ผู้ขับ / ผู้ใช้รถ</label>
            <select value={form.driver_id} onChange={set('driver_id')} className={sel}>
              {staffList.map(s => (
                <option key={s.id} value={s.id}>{s.full_name}{s.id === user?.id ? ' (ฉัน)' : ''}</option>
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
              {selTrip.vehicle?.name} · {selTrip.vehicle?.license_plate}
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
              {selTrip.vehicle?.name} · {selTrip.vehicle?.license_plate}
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
