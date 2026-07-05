import { useState, useEffect } from 'react'
import { Plus, X, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

const inp = 'w-full px-3 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent'
const sel = inp + ' appearance-none'
const fmt = n => (n ?? 0).toLocaleString('th-TH')
const fmtB = n => `฿${fmt(Math.round(n ?? 0))}`
const thDate = d => new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })

const EMPTY_FORM = {
  vehicle_id: '', filled_at: new Date().toISOString().slice(0,10),
  odometer: '', liters: '', price_per_liter: '',
  full_tank: true, fuel_station: '', receipt_no: '', notes: '',
}

export default function FleetFuelLog({ tenant, fleetInfo, depts, isAdmin, isStaff }) {
  const { session } = useAuth()
  const user = session?.user
  const [records,  setRecords]  = useState([])
  const [vehicles, setVehicles] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [modal,    setModal]    = useState(false)
  const [form,     setForm]     = useState(EMPTY_FORM)
  const [saving,   setSaving]   = useState(false)
  const [filterVeh, setFilterVeh] = useState('all')
  const [page, setPage] = useState(0)
  const PER_PAGE = 20

  const canWrite = isAdmin || isStaff

  useEffect(() => {
    if (!tenant?.id) return
    Promise.all([
      supabase.from('fleet_vehicles').select('id, name, license_plate, tank_capacity, fuel_type')
        .eq('municipality_id', tenant.id).eq('status', 'active').order('name'),
    ]).then(([{ data: v }]) => setVehicles(v ?? []))
  }, [tenant?.id])

  useEffect(() => {
    if (!tenant?.id) return
    setLoading(true)
    let q = supabase.from('fleet_fuel_records')
      .select('*, fleet_vehicles(name, license_plate)', { count: 'exact' })
      .eq('municipality_id', tenant.id)
      .order('filled_at', { ascending: false })
      .range(page * PER_PAGE, (page + 1) * PER_PAGE - 1)
    if (filterVeh !== 'all') q = q.eq('vehicle_id', filterVeh)
    q.then(({ data }) => setRecords(data ?? [])).finally(() => setLoading(false))
  }, [tenant?.id, filterVeh, page])

  const set = k => e => setForm(f => ({
    ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value
  }))

  const totalCost = form.liters && form.price_per_liter
    ? (parseFloat(form.liters) * parseFloat(form.price_per_liter)).toFixed(2) : null

  async function handleSave() {
    if (!form.vehicle_id || !form.odometer || !form.liters || !form.price_per_liter)
      return alert('กรุณากรอกข้อมูลที่จำเป็น')
    setSaving(true)
    const { data, error } = await supabase.from('fleet_fuel_records').insert({
      municipality_id: tenant.id,
      vehicle_id:      form.vehicle_id,
      driver_id:       user.id,
      filled_at:       form.filled_at,
      odometer:        parseFloat(form.odometer),
      liters:          parseFloat(form.liters),
      price_per_liter: parseFloat(form.price_per_liter),
      full_tank:       form.full_tank,
      fuel_station:    form.fuel_station || null,
      receipt_no:      form.receipt_no   || null,
      notes:           form.notes        || null,
      created_by:      user.id,
    }).select('*, fleet_vehicles(name, license_plate)').single()
    if (!error) {
      setRecords(prev => [data, ...prev])
      setModal(false)
      setForm(EMPTY_FORM)
    } else alert(error.message)
    setSaving(false)
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <select value={filterVeh} onChange={e => { setFilterVeh(e.target.value); setPage(0) }}
          className="text-xs border border-gray-200 rounded-xl px-3 py-2 bg-white text-gray-700 focus:outline-none">
          <option value="all">ทุกคัน</option>
          {vehicles.map(v => <option key={v.id} value={v.id}>{v.name} ({v.license_plate})</option>)}
        </select>
        {canWrite && (
          <button onClick={() => { setForm(EMPTY_FORM); setModal(true) }}
            className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            <Plus size={15} /> บันทึกเติมน้ำมัน
          </button>
        )}
      </div>

      {/* Records */}
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
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold text-white w-8 border-r border-white/10">ที่</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">วันที่</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">ยานพาหนะ</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-bold text-white border-r border-white/10">ลิตร</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-bold text-white border-r border-white/10">ราคา/ล.</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-bold text-white border-r border-white/10">รวม (฿)</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-bold text-white border-r border-white/10">กม./ล.</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">เลขไมล์</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold text-white">ปั๊ม</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {records.map((r, idx) => (
                  <tr key={r.id}
                    style={{ backgroundColor: idx % 2 === 0 ? '#fff' : '#f5f8fc' }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = '#dbeafe'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = idx % 2 === 0 ? '#fff' : '#f5f8fc'}>
                    <td className="px-4 py-2.5 text-gray-400 text-xs border-r border-gray-200">{idx + 1}</td>
                    <td className="px-4 py-2.5 text-gray-600 text-xs border-r border-gray-200 whitespace-nowrap">{thDate(r.filled_at)}</td>
                    <td className="px-4 py-2.5 border-r border-gray-200">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-gray-800 text-sm">{r.fleet_vehicles?.name ?? '—'}</span>
                        {r.is_anomaly && <span className="flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600"><AlertTriangle size={8} />ผิดปกติ</span>}
                        {!r.full_tank && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">ไม่เต็ม</span>}
                      </div>
                      <p className="text-[10px] text-gray-400">{r.fleet_vehicles?.license_plate}</p>
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-700 text-sm font-semibold border-r border-gray-200">{r.liters}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600 text-xs border-r border-gray-200">{r.price_per_liter}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-gray-800 border-r border-gray-200">{fmtB(r.total_cost)}</td>
                    <td className="px-4 py-2.5 text-right text-xs border-r border-gray-200">
                      {r.efficiency_kml ? <span className="text-emerald-600 font-semibold">{r.efficiency_kml}</span> : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs border-r border-gray-200">{r.odometer ? fmt(r.odometer) : '—'}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{r.fuel_station || '—'}</td>
                  </tr>
                ))}
                {!records.length && (
                  <tr><td colSpan={9} className="text-center py-10 text-gray-400 text-sm">ยังไม่มีรายการเติมน้ำมัน</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-2">
            {records.map(r => (
              <div key={r.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-gray-800">
                        {r.fleet_vehicles?.name ?? '—'}
                      </span>
                      <span className="text-[10px] text-gray-400">{r.fleet_vehicles?.license_plate}</span>
                      {r.is_anomaly && (
                        <span className="flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">
                          <AlertTriangle size={9} /> ผิดปกติ
                        </span>
                      )}
                      {!r.full_tank && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">เติมไม่เต็ม</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {thDate(r.filled_at)} · {r.liters} ลิตร @ {r.price_per_liter} บ./ล.
                      {r.fuel_station ? ` · ${r.fuel_station}` : ''}
                    </p>
                    {r.odometer && <p className="text-[10px] text-gray-400 mt-0.5">มิเตอร์ {fmt(r.odometer)} กม.</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-base font-black text-gray-800">{fmtB(r.total_cost)}</p>
                    {r.efficiency_kml && (
                      <p className="text-[10px] text-emerald-600 font-semibold">{r.efficiency_kml} กม./ล.</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {!records.length && (
              <div className="text-center py-12 text-gray-400 text-sm">ยังไม่มีรายการเติมน้ำมัน</div>
            )}
          </div>
        </>
      )}

      {/* Pagination */}
      {records.length === PER_PAGE && (
        <button onClick={() => setPage(p => p + 1)}
          className="w-full py-2.5 text-sm font-semibold text-gray-500 bg-white border border-gray-200 rounded-xl hover:bg-gray-50">
          โหลดเพิ่มเติม
        </button>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setModal(false)} />
          <div className="relative bg-white rounded-t-3xl md:rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-white px-5 pt-5 pb-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-800">บันทึกเติมน้ำมัน</h3>
              <button onClick={() => setModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">ยานพาหนะ *</label>
                <select value={form.vehicle_id} onChange={set('vehicle_id')} className={sel}>
                  <option value="">— เลือกรถ —</option>
                  {vehicles.map(v => (
                    <option key={v.id} value={v.id}>{v.name} ({v.license_plate})</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">วันที่ *</label>
                  <input type="date" value={form.filled_at} onChange={set('filled_at')} className={inp} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">เลขไมล์ (กม.) *</label>
                  <input type="number" value={form.odometer} onChange={set('odometer')} placeholder="50000" className={inp} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">ปริมาณ (ลิตร) *</label>
                  <input type="number" step="0.01" value={form.liters} onChange={set('liters')} placeholder="40.00" className={inp} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">ราคา/ลิตร *</label>
                  <input type="number" step="0.01" value={form.price_per_liter} onChange={set('price_per_liter')} placeholder="33.50" className={inp} />
                </div>
              </div>

              {totalCost && (
                <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 flex items-center justify-between">
                  <span className="text-xs text-amber-700 font-semibold">ยอดรวม</span>
                  <span className="text-lg font-black text-amber-700">{fmtB(parseFloat(totalCost))}</span>
                </div>
              )}

              <div className="flex items-center gap-2">
                <input type="checkbox" id="full_tank" checked={form.full_tank} onChange={set('full_tank')}
                  className="w-4 h-4 rounded accent-blue-500" />
                <label htmlFor="full_tank" className="text-sm text-gray-700">เติมเต็มถัง (คำนวณอัตราสิ้นเปลืองได้)</label>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">ปั๊ม / สถานี</label>
                <input value={form.fuel_station} onChange={set('fuel_station')} placeholder="ปตท. / เชลล์" className={inp} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">เลขที่ใบเสร็จ</label>
                  <input value={form.receipt_no} onChange={set('receipt_no')} className={inp} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">หมายเหตุ</label>
                  <input value={form.notes} onChange={set('notes')} className={inp} />
                </div>
              </div>

              <button onClick={handleSave} disabled={saving}
                className="w-full py-3 rounded-xl font-bold text-white text-sm disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                {saving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
