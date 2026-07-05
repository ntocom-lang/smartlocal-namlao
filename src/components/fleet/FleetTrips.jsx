import { useState, useEffect, useRef } from 'react'
import { Plus, X, Check, Ban } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

const inp = 'w-full px-3 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent'
const sel = inp + ' appearance-none'
const thDate = d => new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })

const STATUS = {
  draft:     { label: 'ร่าง',         color: '#9ca3af' },
  pending:   { label: 'รออนุมัติ',    color: '#f59e0b' },
  approved:  { label: 'อนุมัติแล้ว',  color: '#10b981' },
  rejected:  { label: 'ไม่อนุมัติ',   color: '#ef4444' },
  completed: { label: 'เสร็จสิ้น',   color: '#6366f1' },
}

const EMPTY = {
  vehicle_id: '', department_id: '', driver_id: '', trip_date: new Date().toISOString().slice(0,10),
  depart_time: '', return_time: '', odometer_start: '', odometer_end: '',
  destination: '', purpose: '', passengers: '1', notes: '',
}

export default function FleetTrips({ tenant, fleetInfo, depts, isAdmin, isStaff }) {
  const { session } = useAuth()
  const user = session?.user
  const [trips,    setTrips]    = useState([])
  const [vehicles, setVehicles] = useState([])
  const [staffList, setStaffList] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [modal,    setModal]    = useState(false)
  const [rejectId, setRejectId] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [form,     setForm]     = useState(EMPTY)
  const [saving,   setSaving]   = useState(false)
  const [filterStatus, setFilterStatus] = useState('all')

  const canWrite = isAdmin || isStaff
  const filterRef = useRef(filterStatus)
  useEffect(() => { filterRef.current = filterStatus }, [filterStatus])

  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('fleet_vehicles').select('id, name, license_plate')
      .eq('municipality_id', tenant.id).eq('status', 'active').order('name')
      .then(({ data }) => setVehicles(data ?? []))
    supabase.from('profiles').select('id, full_name')
      .eq('municipality_id', tenant.id).not('fleet_role', 'is', null).order('full_name')
      .then(({ data }) => setStaffList(data ?? []))
  }, [tenant?.id])

  useEffect(() => {
    if (!tenant?.id) return
    setLoading(true)
    let q = supabase.from('fleet_trips')
      .select('*, fleet_vehicles(name, license_plate), fleet_departments(name), driver:profiles!fleet_trips_driver_id_fkey(full_name), approver:profiles!fleet_trips_approved_by_fkey(full_name)')
      .eq('municipality_id', tenant.id)
      .order('trip_date', { ascending: false })
      .limit(50)
    if (filterStatus !== 'all') q = q.eq('status', filterStatus)
    q.then(({ data }) => setTrips(data ?? [])).finally(() => setLoading(false))
  }, [tenant?.id, filterStatus])

  /* ── Realtime ── */
  useEffect(() => {
    if (!tenant?.id) return
    const SELECT = '*, fleet_vehicles(name, license_plate), fleet_departments(name), driver:profiles!fleet_trips_driver_id_fkey(full_name), approver:profiles!fleet_trips_approved_by_fkey(full_name)'
    const channel = supabase.channel(`fleet-trips-${tenant.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'fleet_trips' },
        async ({ new: row }) => {
          if (row.municipality_id !== tenant.id) return
          const { data } = await supabase.from('fleet_trips').select(SELECT).eq('id', row.id).single()
          if (!data) return
          setTrips(prev => {
            if (prev.find(t => t.id === data.id)) return prev
            if (filterRef.current !== 'all' && data.status !== filterRef.current) return prev
            return [data, ...prev]
          })
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'fleet_trips' },
        async ({ new: row }) => {
          if (row.municipality_id !== tenant.id) return
          const { data } = await supabase.from('fleet_trips').select(SELECT).eq('id', row.id).single()
          if (!data) return
          setTrips(prev => prev.map(t => t.id === data.id ? data : t))
        })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [tenant?.id])

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  async function handleSave() {
    if (!form.vehicle_id || !form.destination || !form.purpose || !form.odometer_start)
      return alert('กรุณากรอกข้อมูลที่จำเป็น')
    setSaving(true)
    const { data, error } = await supabase.from('fleet_trips').insert({
      municipality_id: tenant.id,
      vehicle_id:      form.vehicle_id,
      driver_id:       form.driver_id || user.id,
      department_id:   form.department_id || fleetInfo?.fleet_department_id || null,
      trip_date:       form.trip_date,
      depart_time:     form.depart_time  || null,
      return_time:     form.return_time  || null,
      odometer_start:  parseFloat(form.odometer_start),
      odometer_end:    form.odometer_end ? parseFloat(form.odometer_end) : null,
      destination:     form.destination,
      purpose:         form.purpose,
      passengers:      parseInt(form.passengers) || 1,
      notes:           form.notes || null,
      status:          isAdmin ? 'approved' : 'pending',
      created_by:      user.id,
    }).select('*, fleet_vehicles(name, license_plate), fleet_departments(name)').single()
    if (!error) { setTrips(prev => [data, ...prev]); setModal(false); setForm(EMPTY) }
    else alert(error.message)
    setSaving(false)
  }

  async function handleApprove(id) {
    const { data, error } = await supabase.from('fleet_trips')
      .update({ status: 'approved', approved_by: user.id, approved_at: new Date().toISOString() })
      .eq('id', id).select('*, fleet_vehicles(name, license_plate), fleet_departments(name)').single()
    if (!error) setTrips(prev => prev.map(t => t.id === id ? data : t))
    else alert(error.message)
  }

  async function handleReject() {
    if (!rejectReason) return alert('กรุณาระบุเหตุผล')
    const { data, error } = await supabase.from('fleet_trips')
      .update({ status: 'rejected', reject_reason: rejectReason })
      .eq('id', rejectId).select('*, fleet_vehicles(name, license_plate), fleet_departments(name)').single()
    if (!error) { setTrips(prev => prev.map(t => t.id === rejectId ? data : t)); setRejectId(null); setRejectReason('') }
    else alert(error.message)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex gap-1 flex-wrap">
          {['all', ...Object.keys(STATUS)].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className="text-xs px-3 py-1.5 rounded-full font-semibold transition-colors border"
              style={filterStatus === s
                ? { backgroundColor: s === 'all' ? '#1e40af' : STATUS[s]?.color, color: '#fff', borderColor: 'transparent' }
                : { backgroundColor: '#f9fafb', color: '#6b7280', borderColor: '#e5e7eb' }}>
              {s === 'all' ? 'ทั้งหมด' : STATUS[s]?.label}
            </button>
          ))}
        </div>
        {canWrite && (
          <button onClick={() => { setForm({ ...EMPTY, driver_id: user?.id ?? '' }); setModal(true) }}
            className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            <Plus size={15} /> บันทึกการเดินทาง
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-4 border-gray-200 rounded-full animate-spin"
               style={{ borderTopColor: 'var(--color-primary)' }} />
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto border border-gray-300 shadow-sm" style={{ borderRadius: 4 }}>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr style={{ backgroundColor: '#1a3a5c' }}>
                  <th className="px-4 py-2.5 text-left text-white font-bold text-[11px] border-r border-blue-900">ที่</th>
                  <th className="px-4 py-2.5 text-left text-white font-bold text-[11px] border-r border-blue-900">วันที่</th>
                  <th className="px-4 py-2.5 text-left text-white font-bold text-[11px] border-r border-blue-900">ยานพาหนะ</th>
                  <th className="px-4 py-2.5 text-left text-white font-bold text-[11px] border-r border-blue-900">ปลายทาง</th>
                  <th className="px-4 py-2.5 text-left text-white font-bold text-[11px] border-r border-blue-900">วัตถุประสงค์</th>
                  <th className="px-4 py-2.5 text-left text-white font-bold text-[11px] border-r border-blue-900">ผู้ขับ</th>
                  <th className="px-4 py-2.5 text-left text-white font-bold text-[11px] border-r border-blue-900">กอง</th>
                  <th className="px-4 py-2.5 text-center text-white font-bold text-[11px]">สถานะ</th>
                  {isAdmin && <th className="px-4 py-2.5 text-center text-white font-bold text-[11px]">ดำเนินการ</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {trips.map((t, idx) => (
                  <tr key={t.id}
                    style={{ backgroundColor: idx % 2 === 0 ? '#fff' : '#f5f8fc' }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = '#dbeafe'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = idx % 2 === 0 ? '#fff' : '#f5f8fc'}>
                    <td className="px-4 py-2.5 text-gray-400 text-xs border-r border-gray-200">{idx + 1}</td>
                    <td className="px-4 py-2.5 text-gray-600 text-xs border-r border-gray-200 whitespace-nowrap">{thDate(t.trip_date)}</td>
                    <td className="px-4 py-2.5 border-r border-gray-200">
                      <p className="font-semibold text-gray-800 text-sm">{t.fleet_vehicles?.name ?? '—'}</p>
                      <p className="text-[10px] text-gray-400">{t.fleet_vehicles?.license_plate}</p>
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-gray-800 text-sm border-r border-gray-200">{t.destination}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs max-w-[200px] truncate border-r border-gray-200">{t.purpose}</td>
                    <td className="px-4 py-2.5 text-gray-600 text-xs border-r border-gray-200 whitespace-nowrap">{t.driver?.full_name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs border-r border-gray-200">{t.fleet_departments?.name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-center border-r border-gray-200">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: STATUS[t.status]?.color + '18', color: STATUS[t.status]?.color }}>
                        {STATUS[t.status]?.label}
                      </span>
                    </td>
                    {isAdmin && t.status === 'pending' && (
                      <td className="px-4 py-2.5 text-center">
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => handleApprove(t.id)}
                            className="text-xs font-bold px-2 py-1 rounded border border-emerald-600 text-emerald-600 hover:bg-emerald-600 hover:text-white transition-colors">
                            อนุมัติ
                          </button>
                          <button onClick={() => setRejectId(t.id)}
                            className="text-xs font-bold px-2 py-1 rounded border border-red-500 text-red-500 hover:bg-red-500 hover:text-white transition-colors">
                            ไม่อนุมัติ
                          </button>
                        </div>
                      </td>
                    )}
                    {isAdmin && t.status !== 'pending' && <td className="px-4 py-2.5"></td>}
                  </tr>
                ))}
                {!trips.length && (
                  <tr><td colSpan={isAdmin ? 9 : 8} className="text-center py-10 text-gray-400 text-sm">ไม่พบรายการ</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-2">
            {trips.map(t => (
              <div key={t.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-bold text-gray-800">{t.destination}</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: STATUS[t.status]?.color + '18', color: STATUS[t.status]?.color }}>
                        {STATUS[t.status]?.label}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">{thDate(t.trip_date)} · {t.fleet_vehicles?.name ?? '—'}</p>
                    <p className="text-xs text-gray-500">{t.purpose}</p>
                    <div className="flex items-center gap-2 flex-wrap mt-0.5">
                      {t.driver?.full_name && (
                        <p className="text-[10px] text-blue-600 font-semibold">👤 {t.driver.full_name}</p>
                      )}
                      {t.fleet_departments && <p className="text-[10px] text-gray-400">{t.fleet_departments.name}</p>}
                      {t.distance_km && <p className="text-[10px] text-gray-400">{t.distance_km} กม.</p>}
                    </div>
                    {t.reject_reason && <p className="text-[10px] text-red-500 mt-1">เหตุผล: {t.reject_reason}</p>}
                  </div>
                  {isAdmin && t.status === 'pending' && (
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={() => handleApprove(t.id)}
                        className="p-2 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors">
                        <Check size={14} />
                      </button>
                      <button onClick={() => setRejectId(t.id)}
                        className="p-2 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors">
                        <Ban size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {!trips.length && <div className="text-center py-12 text-gray-400 text-sm">ไม่พบรายการ</div>}
          </div>
        </>
      )}

      {/* Add Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setModal(false)} />
          <div className="relative bg-white rounded-t-3xl md:rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-white px-5 pt-5 pb-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-800">บันทึกการเดินทาง</h3>
              <button onClick={() => setModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-3">
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
                    <option key={s.id} value={s.id}>
                      {s.full_name}{s.id === user?.id ? ' (ฉัน)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">วันที่ *</label>
                  <input type="date" value={form.trip_date} onChange={set('trip_date')} className={inp} />
                </div>
                {isAdmin && depts.length > 0 && (
                  <div>
                    <label className="text-xs font-semibold text-gray-600 mb-1 block">กอง</label>
                    <select value={form.department_id} onChange={set('department_id')} className={sel}>
                      <option value="">— ไม่ระบุ —</option>
                      {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">เวลาออก</label>
                  <input type="time" value={form.depart_time} onChange={set('depart_time')} className={inp} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">เวลากลับ</label>
                  <input type="time" value={form.return_time} onChange={set('return_time')} className={inp} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">เลขไมล์ออก *</label>
                  <input type="number" value={form.odometer_start} onChange={set('odometer_start')} placeholder="50000" className={inp} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">เลขไมล์กลับ</label>
                  <input type="number" value={form.odometer_end} onChange={set('odometer_end')} placeholder="50250" className={inp} />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">ปลายทาง *</label>
                <input value={form.destination} onChange={set('destination')} placeholder="อำเภอ / จังหวัด" className={inp} />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">วัตถุประสงค์ *</label>
                <input value={form.purpose} onChange={set('purpose')} placeholder="ประชุม / ส่งเอกสาร / ตรวจงาน" className={inp} />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">จำนวนผู้โดยสาร</label>
                <input type="number" value={form.passengers} onChange={set('passengers')} min={1} max={20} className={inp} />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">หมายเหตุ</label>
                <textarea value={form.notes} onChange={set('notes')} rows={2} className={inp} />
              </div>
              {!isAdmin && (
                <p className="text-[11px] text-amber-600 bg-amber-50 rounded-xl px-3 py-2">
                  การเดินทางจะถูกส่งให้ผู้ดูแลระบบอนุมัติ
                </p>
              )}
              <button onClick={handleSave} disabled={saving}
                className="w-full py-3 rounded-xl font-bold text-white text-sm disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                {saving ? 'กำลังบันทึก...' : isAdmin ? 'บันทึก (อนุมัติทันที)' : 'ส่งขออนุมัติ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject reason modal */}
      {rejectId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setRejectId(null)} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm mx-4 p-5 shadow-2xl">
            <h3 className="font-bold text-gray-800 mb-3">ระบุเหตุผลที่ไม่อนุมัติ</h3>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)}
              rows={3} placeholder="เหตุผล..." className={inp + ' resize-none'} />
            <div className="flex gap-2 mt-4">
              <button onClick={() => setRejectId(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 text-gray-600">
                ยกเลิก
              </button>
              <button onClick={handleReject}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-red-500 text-white">
                ยืนยันไม่อนุมัติ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
