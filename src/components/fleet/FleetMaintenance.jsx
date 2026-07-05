import { useState, useEffect } from 'react'
import { Plus, X, Wrench, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

const inp = 'w-full px-3 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent'
const sel = inp + ' appearance-none'
const fmt  = n => (n ?? 0).toLocaleString('th-TH')
const fmtB = n => `฿${fmt(Math.round(n ?? 0))}`
const thDate = d => new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })

const TYPES = {
  routine:    { label: 'บำรุงรักษา',   color: '#3b82f6' },
  oil_change: { label: 'เปลี่ยนถ่ายน้ำมัน', color: '#f59e0b' },
  repair:     { label: 'ซ่อมแซม',      color: '#ef4444' },
  inspection: { label: 'ตรวจสภาพ',    color: '#8b5cf6' },
  tire:       { label: 'ยาง',          color: '#10b981' },
  battery:    { label: 'แบตเตอรี่',   color: '#06b6d4' },
  other:      { label: 'อื่นๆ',         color: '#9ca3af' },
}

const EMPTY = {
  vehicle_id: '', service_date: new Date().toISOString().slice(0,10),
  maintenance_type: 'routine', description: '', cost: '',
  vendor: '', odometer: '', next_service_km: '', next_service_date: '', notes: '',
}

function DueSoonAlert({ records }) {
  const today = new Date()
  const alerts = records.filter(r => {
    if (!r.next_service_date) return false
    const d = Math.ceil((new Date(r.next_service_date) - today) / 86400000)
    return d <= 30
  }).map(r => ({
    ...r,
    days: Math.ceil((new Date(r.next_service_date) - today) / 86400000)
  }))
  if (!alerts.length) return null
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-amber-100">
        <AlertTriangle size={14} className="text-amber-500" />
        <span className="text-sm font-bold text-amber-700">ต้องซ่อมบำรุงเร็วๆ นี้</span>
      </div>
      {alerts.map(a => (
        <div key={a.id} className="flex justify-between items-center px-4 py-2.5 border-b border-amber-50 last:border-0">
          <div>
            <p className="text-xs font-semibold text-amber-800">{a.fleet_vehicles?.name}</p>
            <p className="text-[10px] text-amber-600">{a.description}</p>
          </div>
          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
            a.days < 0 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
          }`}>
            {a.days < 0 ? `เกิน ${Math.abs(a.days)} วัน` : `อีก ${a.days} วัน`}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function FleetMaintenance({ tenant, isAdmin, isStaff }) {
  const { session } = useAuth()
  const user = session?.user
  const [records,  setRecords]  = useState([])
  const [vehicles, setVehicles] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [modal,    setModal]    = useState(false)
  const [form,     setForm]     = useState(EMPTY)
  const [saving,   setSaving]   = useState(false)
  const [filterType, setFilterType] = useState('all')

  const canWrite = isAdmin || isStaff

  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('fleet_vehicles').select('id, name, license_plate')
      .eq('municipality_id', tenant.id).order('name')
      .then(({ data }) => setVehicles(data ?? []))
  }, [tenant?.id])

  useEffect(() => {
    if (!tenant?.id) return
    setLoading(true)
    let q = supabase.from('fleet_maintenance')
      .select('*, fleet_vehicles(name, license_plate)')
      .eq('municipality_id', tenant.id)
      .order('service_date', { ascending: false })
      .limit(50)
    if (filterType !== 'all') q = q.eq('maintenance_type', filterType)
    q.then(({ data }) => setRecords(data ?? [])).finally(() => setLoading(false))
  }, [tenant?.id, filterType])

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  async function handleSave() {
    if (!form.vehicle_id || !form.description) return alert('กรุณากรอกข้อมูลที่จำเป็น')
    setSaving(true)
    const { data, error } = await supabase.from('fleet_maintenance').insert({
      municipality_id:  tenant.id,
      vehicle_id:       form.vehicle_id,
      service_date:     form.service_date,
      maintenance_type: form.maintenance_type,
      description:      form.description,
      cost:             parseFloat(form.cost) || 0,
      vendor:           form.vendor           || null,
      odometer:         form.odometer ? parseFloat(form.odometer) : null,
      next_service_km:  form.next_service_km  ? parseFloat(form.next_service_km) : null,
      next_service_date:form.next_service_date || null,
      notes:            form.notes            || null,
      created_by:       user.id,
    }).select('*, fleet_vehicles(name, license_plate)').single()
    if (!error) { setRecords(prev => [data, ...prev]); setModal(false); setForm(EMPTY) }
    else alert(error.message)
    setSaving(false)
  }

  const totalCost = records.reduce((s, r) => s + (r.cost ?? 0), 0)

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#ef444418' }}>
          <Wrench size={18} className="text-red-500" />
        </div>
        <div>
          <p className="text-lg font-black text-gray-800">{fmtB(totalCost)}</p>
          <p className="text-xs text-gray-500">ค่าซ่อมบำรุงรวม (50 รายการล่าสุด)</p>
        </div>
      </div>

      <DueSoonAlert records={records} />

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex gap-1 flex-wrap">
          <button onClick={() => setFilterType('all')}
            className={`text-xs px-3 py-1.5 rounded-full font-semibold border transition-colors ${
              filterType === 'all' ? 'bg-gray-800 text-white border-transparent' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>
            ทั้งหมด
          </button>
          {Object.entries(TYPES).map(([k, v]) => (
            <button key={k} onClick={() => setFilterType(k)}
              className="text-xs px-3 py-1.5 rounded-full font-semibold border transition-colors"
              style={filterType === k
                ? { backgroundColor: v.color, color: '#fff', borderColor: 'transparent' }
                : { backgroundColor: '#f9fafb', color: '#6b7280', borderColor: '#e5e7eb' }}>
              {v.label}
            </button>
          ))}
        </div>
        {canWrite && (
          <button onClick={() => { setForm(EMPTY); setModal(true) }}
            className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            <Plus size={15} /> บันทึกซ่อมบำรุง
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
                  <th className="px-4 py-2.5 text-left text-white font-bold text-[11px] border-r border-blue-900">ที่</th>
                  <th className="px-4 py-2.5 text-left text-white font-bold text-[11px] border-r border-blue-900">วันที่</th>
                  <th className="px-4 py-2.5 text-left text-white font-bold text-[11px] border-r border-blue-900">ยานพาหนะ</th>
                  <th className="px-4 py-2.5 text-left text-white font-bold text-[11px] border-r border-blue-900">ประเภท</th>
                  <th className="px-4 py-2.5 text-left text-white font-bold text-[11px] border-r border-blue-900">รายละเอียด</th>
                  <th className="px-4 py-2.5 text-right text-white font-bold text-[11px] border-r border-blue-900">ค่าใช้จ่าย</th>
                  <th className="px-4 py-2.5 text-left text-white font-bold text-[11px] border-r border-blue-900">อู่/ผู้รับจ้าง</th>
                  <th className="px-4 py-2.5 text-left text-white font-bold text-[11px]">ซ่อมถัดไป</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {records.map((r, idx) => {
                  const t = TYPES[r.maintenance_type] ?? TYPES.other
                  return (
                    <tr key={r.id}
                      style={{ backgroundColor: idx % 2 === 0 ? '#fff' : '#f5f8fc' }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = '#dbeafe'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = idx % 2 === 0 ? '#fff' : '#f5f8fc'}>
                      <td className="px-4 py-2.5 text-gray-400 text-xs border-r border-gray-200">{idx + 1}</td>
                      <td className="px-4 py-2.5 text-gray-600 text-xs border-r border-gray-200 whitespace-nowrap">{thDate(r.service_date)}</td>
                      <td className="px-4 py-2.5 border-r border-gray-200">
                        <p className="font-semibold text-gray-800 text-sm">{r.fleet_vehicles?.name ?? '—'}</p>
                        <p className="text-[10px] text-gray-400">{r.fleet_vehicles?.license_plate}</p>
                      </td>
                      <td className="px-4 py-2.5 border-r border-gray-200">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: t.color + '18', color: t.color }}>
                          {t.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-700 text-xs max-w-[240px] border-r border-gray-200">{r.description}</td>
                      <td className="px-4 py-2.5 text-right font-bold text-gray-800 border-r border-gray-200">{fmtB(r.cost)}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs border-r border-gray-200">{r.vendor || '—'}</td>
                      <td className="px-4 py-2.5 text-xs">
                        {r.next_service_date
                          ? <span className="text-blue-500">{thDate(r.next_service_date)}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  )
                })}
                {!records.length && (
                  <tr><td colSpan={8} className="text-center py-10 text-gray-400 text-sm">ไม่พบรายการ</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-2">
            {records.map(r => {
              const t = TYPES[r.maintenance_type] ?? TYPES.other
              return (
                <div key={r.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-sm font-bold text-gray-800">{r.fleet_vehicles?.name ?? '—'}</span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                              style={{ backgroundColor: t.color + '18', color: t.color }}>
                          {t.label}
                        </span>
                      </div>
                      <p className="text-xs text-gray-700">{r.description}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{thDate(r.service_date)}{r.vendor ? ` · ${r.vendor}` : ''}</p>
                      {r.next_service_date && (
                        <p className="text-[10px] text-blue-500 mt-1">
                          ซ่อมบำรุงครั้งถัดไป: {thDate(r.next_service_date)}
                          {r.next_service_km ? ` หรือ ${r.next_service_km.toLocaleString('th-TH')} กม.` : ''}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-black text-gray-800">{fmtB(r.cost)}</p>
                    </div>
                  </div>
                </div>
              )
            })}
            {!records.length && <div className="text-center py-12 text-gray-400 text-sm">ไม่พบรายการ</div>}
          </div>
        </>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setModal(false)} />
          <div className="relative bg-white rounded-t-3xl md:rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-white px-5 pt-5 pb-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-800">บันทึกซ่อมบำรุง</h3>
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">วันที่ซ่อม *</label>
                  <input type="date" value={form.service_date} onChange={set('service_date')} className={inp} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">ประเภท *</label>
                  <select value={form.maintenance_type} onChange={set('maintenance_type')} className={sel}>
                    {Object.entries(TYPES).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">รายละเอียด *</label>
                <textarea value={form.description} onChange={set('description')} rows={2} className={inp} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">ค่าใช้จ่าย (บาท)</label>
                  <input type="number" step="0.01" value={form.cost} onChange={set('cost')} placeholder="0" className={inp} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">อู่ / ผู้รับจ้าง</label>
                  <input value={form.vendor} onChange={set('vendor')} className={inp} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">เลขไมล์ (กม.)</label>
                  <input type="number" value={form.odometer} onChange={set('odometer')} className={inp} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">ซ่อมถัดไป (กม.)</label>
                  <input type="number" value={form.next_service_km} onChange={set('next_service_km')} className={inp} />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">วันซ่อมถัดไป</label>
                  <input type="date" value={form.next_service_date} onChange={set('next_service_date')} className={inp} />
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
