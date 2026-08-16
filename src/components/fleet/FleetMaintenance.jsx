import { useState, useEffect } from 'react'
import { Plus, X, Wrench, AlertTriangle, FileText, Paperclip } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import {
  assetIdentifier,
  assetOptionLabel,
  meterLabel,
  meterUnitShort,
} from '../../lib/fleetAssets'
import {
  openFleetDocument,
  removeFleetDocument,
  uploadFleetDocument,
  validateFleetDocument,
} from '../../lib/fleetDocuments'

const inp = 'w-full px-3 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent'
const sel = inp + ' appearance-none'
const fmt  = n => (n ?? 0).toLocaleString('th-TH')
const fmtB = n => `฿${fmt(Math.round(n ?? 0))}`
const thDate = d => new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })

const TYPES = {
  routine:    { label: 'บำรุงรักษา',       color: '#3b82f6' },
  oil_change: { label: 'เปลี่ยนถ่ายน้ำมัน', color: '#f59e0b' },
  repair:     { label: 'ซ่อมแซม',          color: '#ef4444' },
  inspection: { label: 'ตรวจสภาพ',         color: '#8b5cf6' },
  tire:       { label: 'ยาง',              color: '#10b981' },
  battery:    { label: 'แบตเตอรี่',        color: '#06b6d4' },
  other:      { label: 'อื่นๆ',             color: '#9ca3af' },
}

const EMPTY = {
  vehicle_id: '', technician_id: '',
  service_date: new Date().toISOString().slice(0,10),
  maintenance_type: 'routine', other_type: '', description: '', cost: '',
  vendor: '', odometer: '', next_service_meter: '', next_service_date: '',
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
    <div className="bg-amber-50 border border-amber-200 rounded-xl md:rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 md:px-4 md:py-3 border-b border-amber-100">
        <AlertTriangle size={14} className="text-amber-500" />
        <span className="text-sm font-bold text-amber-700">ต้องซ่อมบำรุงเร็วๆ นี้</span>
      </div>
      {alerts.map(a => (
        <div key={a.id} className="flex justify-between items-center px-3 py-2 md:px-4 md:py-2.5 border-b border-amber-50 last:border-0">
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
  const [records,   setRecords]   = useState([])
  const [vehicles,  setVehicles]  = useState([])
  const [staffList, setStaffList] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [modal,     setModal]     = useState(false)
  const [form,      setForm]      = useState(EMPTY)
  const [receiptFile, setReceiptFile] = useState(null)
  const [saving,    setSaving]    = useState(false)
  const [filterType, setFilterType] = useState('all')
  const [dateFrom,   setDateFrom]   = useState('')
  const [dateTo,     setDateTo]     = useState('')

  const canWrite = isAdmin || isStaff

  useEffect(() => {
    if (!tenant?.id) return
    Promise.all([
      supabase.from('fleet_vehicles').select('id, name, license_plate, asset_code, asset_kind, meter_unit')
        .eq('municipality_id', tenant.id).order('name'),
      supabase.from('profiles').select('id, full_name')
        .eq('municipality_id', tenant.id).eq('fleet_role', 'fleet_staff').order('full_name'),
    ]).then(([{ data: v }, { data: s }]) => {
      setVehicles(v ?? [])
      setStaffList(s ?? [])
    })
  }, [tenant?.id])

  const SELECT_Q = '*, fleet_vehicles(name, license_plate, asset_code, asset_kind, meter_unit), technician:profiles!fleet_maintenance_technician_id_fkey(id,full_name)'

  function loadRecords() {
    if (!tenant?.id) return
    setLoading(true)
    let q = supabase.from('fleet_maintenance').select(SELECT_Q)
      .eq('municipality_id', tenant.id)
      .order('service_date', { ascending: false })
      .limit(100)
    if (filterType !== 'all') q = q.eq('maintenance_type', filterType)
    if (dateFrom) q = q.gte('service_date', dateFrom)
    if (dateTo)   q = q.lte('service_date', dateTo)
    q.then(({ data }) => setRecords(data ?? [])).finally(() => setLoading(false))
  }

  useEffect(() => {
    const timer = window.setTimeout(loadRecords, 0)
    return () => window.clearTimeout(timer)
    // loadRecords ใช้ค่าตัวกรองชุดเดียวกับ dependency ด้านล่าง
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id, filterType, dateFrom, dateTo])

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  function openModal() {
    setForm({ ...EMPTY, technician_id: user?.id ?? '' })
    setReceiptFile(null)
    setModal(true)
  }

  const selectedAsset = vehicles.find(asset => asset.id === form.vehicle_id)

  async function handleSave() {
    const needDesc = form.maintenance_type !== 'other' || !form.other_type.trim()
    if (!form.vehicle_id || (needDesc && !form.description)) return alert('กรุณากรอกข้อมูลที่จำเป็น')
    if (form.maintenance_type === 'other' && !form.other_type.trim()) return alert('กรุณาระบุประเภท')
    if (form.cost !== '' && Number(form.cost) < 0) return alert('ค่าใช้จ่ายต้องไม่ติดลบ')
    if (form.odometer !== '' && Number(form.odometer) < 0) return alert('ค่ามิเตอร์ต้องไม่ติดลบ')
    if (form.next_service_meter !== '' && Number(form.next_service_meter) < 0) return alert('มิเตอร์ซ่อมครั้งถัดไปต้องไม่ติดลบ')
    const fileError = validateFleetDocument(receiptFile)
    if (fileError) return alert(fileError)
    setSaving(true)
    const { data, error } = await supabase.from('fleet_maintenance').insert({
      municipality_id:   tenant.id,
      vehicle_id:        form.vehicle_id,
      technician_id:     form.technician_id || null,
      service_date:      form.service_date,
      maintenance_type:  form.maintenance_type,
      description:       form.maintenance_type === 'other' && form.other_type.trim()
                           ? form.description.trim()
                             ? `[${form.other_type.trim()}] ${form.description.trim()}`
                             : form.other_type.trim()
                           : form.description,
      cost:              parseFloat(form.cost) || 0,
      vendor:            form.vendor           || null,
      odometer:          form.odometer ? parseFloat(form.odometer) : null,
      next_service_km:   form.next_service_meter ? parseFloat(form.next_service_meter) : null,
      next_service_meter: form.next_service_meter ? parseFloat(form.next_service_meter) : null,
      next_service_date: form.next_service_date || null,
      created_by:        user?.id ?? null,
    }).select(SELECT_Q).single()
    if (!error) {
      let savedRecord = data
      let attachmentWarning = ''
      if (receiptFile) {
        try {
          const path = await uploadFleetDocument({
            tenantId: tenant.id,
            scope: 'maintenance',
            recordId: data.id,
            file: receiptFile,
          })
          const { data: updated, error: updateError } = await supabase.from('fleet_maintenance')
            .update({ receipt_url: path })
            .eq('id', data.id)
            .select(SELECT_Q)
            .single()
          if (updateError) {
            await removeFleetDocument(path).catch(() => {})
            throw updateError
          }
          savedRecord = updated
        } catch (uploadError) {
          attachmentWarning = 'บันทึกรายการแล้ว แต่แนบเอกสารไม่สำเร็จ: ' + uploadError.message
        }
      }
      setRecords(previous => [savedRecord, ...previous])
      setModal(false)
      setForm(EMPTY)
      setReceiptFile(null)
      if (attachmentWarning) alert(attachmentWarning)
    } else alert(error.message)
    setSaving(false)
  }

  async function handleDelete(r) {
    if (!confirm(`ลบรายการซ่อมบำรุง "${r.description}"?`)) return
    const { error } = await supabase.from('fleet_maintenance').delete().eq('id', r.id)
    if (!error) {
      setRecords(prev => prev.filter(x => x.id !== r.id))
      if (r.receipt_url) removeFleetDocument(r.receipt_url).catch(() => {})
    }
    else alert('ลบไม่สำเร็จ: ' + error.message)
  }

  async function handleOpenDocument(path) {
    try {
      await openFleetDocument(path)
    } catch (error) {
      alert('เปิดเอกสารไม่สำเร็จ: ' + error.message)
    }
  }

  const totalCost = records.reduce((s, r) => s + (r.cost ?? 0), 0)

  return (
    <div className="space-y-3 md:space-y-4">
      {/* Summary */}
      <div className="bg-white rounded-xl md:rounded-2xl border border-gray-100 shadow-sm p-3 md:p-4 flex items-center gap-2.5 md:gap-3">
        <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg md:rounded-xl flex items-center justify-center" style={{ backgroundColor: '#ef444418' }}>
          <Wrench size={18} className="text-red-500" />
        </div>
        <div>
          <p className="text-base md:text-lg font-black text-gray-800">{fmtB(totalCost)}</p>
          <p className="text-[11px] md:text-xs text-gray-500">ค่าซ่อมบำรุงรวม (100 รายการล่าสุด)</p>
        </div>
      </div>

      <DueSoonAlert records={records} />

      {/* Toolbar */}
      <div className="grid grid-cols-2 md:flex md:flex-wrap gap-2 items-center">
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className={`${canWrite ? '' : 'col-span-2'} order-1 md:order-none min-w-0 w-full md:w-auto text-xs border border-gray-200 rounded-xl px-3 py-2 bg-white text-gray-700 focus:outline-none appearance-none`}>
          <option value="all">ทุกประเภท</option>
          {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="order-3 md:order-none min-w-0 w-full md:w-auto text-[11px] md:text-xs border border-gray-200 rounded-xl px-2 md:px-3 py-2 bg-white text-gray-700 focus:outline-none" />
        <span className="hidden md:inline text-xs text-gray-400">–</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="order-4 md:order-none min-w-0 w-full md:w-auto text-[11px] md:text-xs border border-gray-200 rounded-xl px-2 md:px-3 py-2 bg-white text-gray-700 focus:outline-none" />
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(''); setDateTo('') }}
            className="order-5 md:order-none col-span-2 md:col-span-1 justify-self-end text-[11px] md:text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded-lg border border-gray-200">ล้าง</button>
        )}
        {canWrite && (
          <button onClick={openModal}
            className="order-2 md:order-none justify-center flex items-center gap-1.5 px-2 md:px-4 py-2 rounded-xl text-[11px] md:text-sm font-bold text-white md:ml-auto"
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
                  {[...['ที่','วันที่','ทรัพย์สิน','ประเภท','รายละเอียด','ค่าใช้จ่าย','อู่/ผู้รับจ้าง','ผู้รับผิดชอบ','ซ่อมถัดไป','เอกสาร'], ...(isAdmin ? [''] : [])].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-white font-bold text-[11px] border-r border-blue-900 last:border-r-0 whitespace-nowrap">{h}</th>
                  ))}
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
                        <p className="text-[10px] text-gray-400">{assetIdentifier(r.fleet_vehicles)}</p>
                      </td>
                      <td className="px-4 py-2.5 border-r border-gray-200">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: t.color + '18', color: t.color }}>
                          {t.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-700 text-xs max-w-[200px] border-r border-gray-200">{r.description}</td>
                      <td className="px-4 py-2.5 text-right font-bold text-gray-800 border-r border-gray-200">{fmtB(r.cost)}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs border-r border-gray-200">{r.vendor || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-600 text-xs border-r border-gray-200 whitespace-nowrap">
                        {r.technician?.full_name ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {r.next_service_date && <span className="text-blue-500 block">{thDate(r.next_service_date)}</span>}
                        {(r.next_service_meter ?? r.next_service_km) != null && (
                          <span className="text-gray-500 block">{fmt(r.next_service_meter ?? r.next_service_km)} {meterUnitShort(r.fleet_vehicles)}</span>
                        )}
                        {!r.next_service_date && (r.next_service_meter ?? r.next_service_km) == null && <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center border-r border-gray-200">
                        {r.receipt_url ? (
                          <button onClick={() => handleOpenDocument(r.receipt_url)} className="text-blue-600 hover:text-blue-800" title="เปิดเอกสาร">
                            <FileText size={15} />
                          </button>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-2.5 text-center">
                          <button onClick={() => handleDelete(r)}
                            className="text-xs font-bold px-3 py-1 rounded border border-red-400 text-red-500 hover:bg-red-500 hover:text-white transition-colors">
                            ลบ
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
                {!records.length && (
                  <tr><td colSpan={isAdmin ? 11 : 10} className="text-center py-10 text-gray-400 text-sm">ไม่พบรายการ</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-1.5">
            {records.map(r => {
              const t = TYPES[r.maintenance_type] ?? TYPES.other
              return (
                <div key={r.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                        <span className="text-sm font-bold text-gray-800">{r.fleet_vehicles?.name ?? '—'}</span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                              style={{ backgroundColor: t.color + '18', color: t.color }}>
                          {t.label}
                        </span>
                      </div>
                      <p className="text-[10px] text-gray-400">{assetIdentifier(r.fleet_vehicles)}</p>
                      <p className="text-[11px] text-gray-700 line-clamp-2">{r.description}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5 truncate">
                        {thDate(r.service_date)}{r.vendor ? ` · ${r.vendor}` : ''}
                      </p>
                      {r.technician?.full_name && (
                        <p className="text-[10px] text-gray-400 mt-0.5">👤 {r.technician.full_name}</p>
                      )}
                      {(r.next_service_date || (r.next_service_meter ?? r.next_service_km) != null) && (
                        <p className="text-[10px] text-blue-500 mt-0.5 truncate">
                          ซ่อมบำรุงครั้งถัดไป: {r.next_service_date ? thDate(r.next_service_date) : ''}
                          {r.next_service_date && (r.next_service_meter ?? r.next_service_km) != null ? ' หรือ ' : ''}
                          {(r.next_service_meter ?? r.next_service_km) != null
                            ? [fmt(r.next_service_meter ?? r.next_service_km), meterUnitShort(r.fleet_vehicles)].join(' ')
                            : ''}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-black text-gray-800">{fmtB(r.cost)}</p>
                      {r.receipt_url && (
                        <button onClick={() => handleOpenDocument(r.receipt_url)}
                          className="mt-2 ml-auto text-[10px] font-bold text-blue-600 flex items-center gap-1">
                          <FileText size={11} /> เอกสาร
                        </button>
                      )}
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
          <div className="relative bg-white rounded-t-3xl md:rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="shrink-0 bg-white px-4 py-3 md:px-5 md:pt-5 md:pb-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-800">บันทึกซ่อมบำรุง</h3>
              <button onClick={() => setModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={16} /></button>
            </div>
            <div className="overflow-y-auto p-4 md:p-5 space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">ยานพาหนะ/เครื่องยนต์ *</label>
                <select value={form.vehicle_id} onChange={set('vehicle_id')} className={sel}>
                  <option value="">— เลือกทรัพย์สิน —</option>
                  {vehicles.map(asset => <option key={asset.id} value={asset.id}>{assetOptionLabel(asset)}</option>)}
                </select>
              </div>

              {/* ผู้รับผิดชอบ */}
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">ผู้รับผิดชอบ (เจ้าหน้าที่)</label>
                <select value={form.technician_id} onChange={set('technician_id')} className={sel}>
                  <option value="">— ไม่ระบุ —</option>
                  {staffList.map(s => (
                    <option key={s.id} value={s.id}>{s.full_name}{s.id === user?.id ? ' (ฉัน)' : ''}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">วันที่ซ่อม *</label>
                <input type="date" value={form.service_date} onChange={set('service_date')} className={inp} />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 mb-2 block">ประเภท *</label>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(TYPES).map(([k, v]) => (
                    <button key={k} type="button"
                      onClick={() => setForm(f => ({ ...f, maintenance_type: k }))}
                      className="text-xs px-3 py-1.5 rounded-full font-semibold border transition-colors"
                      style={form.maintenance_type === k
                        ? { backgroundColor: v.color, color: '#fff', borderColor: 'transparent' }
                        : { backgroundColor: '#f9fafb', color: '#6b7280', borderColor: '#e5e7eb' }}>
                      {v.label}
                    </button>
                  ))}
                </div>
                {form.maintenance_type === 'other' && (
                  <input
                    type="text"
                    placeholder="ระบุประเภท..."
                    value={form.other_type}
                    onChange={set('other_type')}
                    className={`mt-2 ${inp}`}
                  />
                )}
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
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">อู่ / ผู้รับจ้าง (ภายนอก)</label>
                  <input value={form.vendor} onChange={set('vendor')} className={inp} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">{meterLabel(selectedAsset)}</label>
                  <input type="number" value={form.odometer} onChange={set('odometer')} className={inp} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">ซ่อมถัดไป ({meterUnitShort(selectedAsset)})</label>
                  <input type="number" value={form.next_service_meter} onChange={set('next_service_meter')} className={inp} />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">วันซ่อมถัดไป</label>
                  <input type="date" value={form.next_service_date} onChange={set('next_service_date')} className={inp} />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">ใบเสร็จ/เอกสารซ่อม (ถ้ามี)</label>
                <label className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-gray-300 bg-gray-50 cursor-pointer text-xs text-gray-600">
                  <Paperclip size={14} />
                  <span className="truncate">{receiptFile?.name || 'แนบ PDF หรือรูปภาพ'}</span>
                  <input type="file" className="hidden"
                    accept=".jpg,.jpeg,.png,.webp,.pdf,.csv,.xlsx"
                    onChange={event => setReceiptFile(event.target.files?.[0] ?? null)} />
                </label>
                <p className="text-[10px] text-gray-400 mt-1">Private Storage · ขนาดไม่เกิน 10 MB</p>
              </div>
              <button onClick={handleSave} disabled={saving}
                className="sticky bottom-0 z-10 w-full py-3 rounded-xl font-bold text-white text-sm disabled:opacity-50 shadow-lg"
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
