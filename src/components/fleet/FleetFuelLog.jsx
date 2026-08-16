import { useState, useEffect } from 'react'
import { Plus, X, AlertTriangle, FileText, Paperclip } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import {
  FUEL_OPTIONS,
  assetIdentifier,
  assetOptionLabel,
  isVehicleAsset,
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
const fmt = n => (n ?? 0).toLocaleString('th-TH')
const fmtB = n => `฿${fmt(Math.round(n ?? 0))}`
const thDate = d => new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })

const EMPTY_FORM = {
  vehicle_id: '', driver_id: '',
  filled_at: new Date().toISOString().slice(0,10),
  odometer: '', liters: '', price_per_liter: '',
  fuel_type: 'diesel', fuel_other_name: '',
  full_tank: true, fuel_station: '', receipt_no: '', notes: '',
}

export default function FleetFuelLog({ tenant, isAdmin, isStaff }) {
  const { session } = useAuth()
  const user = session?.user
  const [records,   setRecords]   = useState([])
  const [vehicles,  setVehicles]  = useState([])
  const [staffList, setStaffList] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [modal,     setModal]     = useState(false)
  const [form,      setForm]      = useState(EMPTY_FORM)
  const [receiptFile, setReceiptFile] = useState(null)
  const [saving,    setSaving]    = useState(false)
  const [filterVeh, setFilterVeh] = useState('all')
  const [dateFrom,  setDateFrom]  = useState('')
  const [dateTo,    setDateTo]    = useState('')
  const [page, setPage] = useState(0)
  const PER_PAGE = 20

  const canWrite = isAdmin || isStaff

  useEffect(() => {
    if (!tenant?.id) return
    Promise.all([
      supabase.from('fleet_vehicles').select('id, name, license_plate, asset_code, asset_kind, meter_unit, tank_capacity, fuel_type')
        .eq('municipality_id', tenant.id).eq('status', 'active').order('name'),
      supabase.from('profiles').select('id, full_name')
        .eq('municipality_id', tenant.id).eq('fleet_role', 'fleet_staff').order('full_name'),
    ]).then(([{ data: v }, { data: s }]) => {
      setVehicles(v ?? [])
      setStaffList(s ?? [])
    })
  }, [tenant?.id])

  useEffect(() => {
    if (!tenant?.id) return
    let q = supabase.from('fleet_fuel_records')
      .select('*, fleet_vehicles(name, license_plate, asset_code, asset_kind, meter_unit), driver:profiles!fleet_fuel_records_driver_id_fkey(id,full_name)', { count: 'exact' })
      .eq('municipality_id', tenant.id)
      .order('filled_at', { ascending: false })
      .range(page * PER_PAGE, (page + 1) * PER_PAGE - 1)
    if (filterVeh !== 'all') q = q.eq('vehicle_id', filterVeh)
    if (dateFrom) q = q.gte('filled_at', dateFrom)
    if (dateTo)   q = q.lte('filled_at', dateTo)
    q.then(({ data }) => setRecords(data ?? [])).finally(() => setLoading(false))
  }, [tenant?.id, filterVeh, dateFrom, dateTo, page])

  const set = k => e => setForm(f => ({
    ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value
  }))

  const totalCost = form.liters && form.price_per_liter
    ? (parseFloat(form.liters) * parseFloat(form.price_per_liter)).toFixed(2) : null
  const selectedAsset = vehicles.find(asset => asset.id === form.vehicle_id)

  function openModal() {
    setForm({ ...EMPTY_FORM, driver_id: user?.id ?? '' })
    setReceiptFile(null)
    setModal(true)
  }

  async function handleSave() {
    const meter = Number(form.odometer)
    const liters = Number(form.liters)
    const pricePerLiter = form.price_per_liter === '' ? null : Number(form.price_per_liter)
    if (!form.vehicle_id || form.odometer === '' || form.liters === '')
      return alert('กรุณากรอกข้อมูลที่จำเป็น')
    if (form.fuel_type === 'other' && !form.fuel_other_name.trim())
      return alert('กรุณาระบุชนิดเชื้อเพลิง/ของเหลว')
    if (!Number.isFinite(meter) || meter < 0) return alert('ค่ามิเตอร์ต้องเป็น 0 หรือมากกว่า')
    if (!Number.isFinite(liters) || liters <= 0) return alert('ปริมาณเชื้อเพลิงต้องมากกว่า 0 ลิตร')
    if (pricePerLiter !== null && (!Number.isFinite(pricePerLiter) || pricePerLiter < 0))
      return alert('ราคาต่อลิตรต้องเป็น 0 หรือมากกว่า')
    if (isVehicleAsset(selectedAsset) && pricePerLiter === null)
      return alert('กรุณาระบุราคาต่อลิตรสำหรับยานพาหนะ')
    const fileError = validateFleetDocument(receiptFile)
    if (fileError) return alert(fileError)

    setSaving(true)
    const { data, error } = await supabase.from('fleet_fuel_records').insert({
      municipality_id: tenant.id,
      vehicle_id:      form.vehicle_id,
      driver_id:       form.driver_id || user?.id,
      filled_at:       form.filled_at,
      odometer:        meter,
      liters,
      price_per_liter: pricePerLiter,
      fuel_type:       form.fuel_type || selectedAsset?.fuel_type || null,
      fuel_other_name: form.fuel_type === 'other' ? form.fuel_other_name.trim() || null : null,
      full_tank:       form.full_tank,
      fuel_station:    form.fuel_station || null,
      receipt_no:      form.receipt_no   || null,
      notes:           form.notes        || null,
      created_by:      user?.id,
    }).select('*, fleet_vehicles(name, license_plate, asset_code, asset_kind, meter_unit), driver:profiles!fleet_fuel_records_driver_id_fkey(id,full_name)').single()
    if (!error) {
      let savedRecord = data
      let attachmentWarning = ''
      if (receiptFile) {
        try {
          const path = await uploadFleetDocument({
            tenantId: tenant.id,
            scope: 'fuel',
            recordId: data.id,
            file: receiptFile,
          })
          const { data: updated, error: updateError } = await supabase.from('fleet_fuel_records')
            .update({ receipt_url: path })
            .eq('id', data.id)
            .select('*, fleet_vehicles(name, license_plate, asset_code, asset_kind, meter_unit), driver:profiles!fleet_fuel_records_driver_id_fkey(id,full_name)')
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
      setRecords(prev => [savedRecord, ...prev])
      setModal(false)
      setForm(EMPTY_FORM)
      setReceiptFile(null)
      if (attachmentWarning) alert(attachmentWarning)
    } else alert(error.message)
    setSaving(false)
  }

  async function handleDelete(r) {
    if (!confirm(`ลบรายการเติมน้ำมัน ${thDate(r.filled_at)} — ${r.fleet_vehicles?.name} (${r.liters} ลิตร)?`)) return
    const { error } = await supabase.from('fleet_fuel_records').delete().eq('id', r.id)
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

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <select value={filterVeh} onChange={e => { setFilterVeh(e.target.value); setPage(0) }}
          className="text-xs border border-gray-200 rounded-xl px-3 py-2 bg-white text-gray-700 focus:outline-none">
          <option value="all">ทุกทรัพย์สิน</option>
          {vehicles.map(asset => <option key={asset.id} value={asset.id}>{assetOptionLabel(asset)}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0) }}
          className="text-xs border border-gray-200 rounded-xl px-3 py-2 bg-white text-gray-700 focus:outline-none" />
        <span className="text-xs text-gray-400">–</span>
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0) }}
          className="text-xs border border-gray-200 rounded-xl px-3 py-2 bg-white text-gray-700 focus:outline-none" />
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(''); setDateTo(''); setPage(0) }}
            className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded-lg border border-gray-200">ล้าง</button>
        )}
        {canWrite && (
          <button onClick={openModal}
            className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            <Plus size={15} /> บันทึกเชื้อเพลิง
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
                  {[...['ที่','วันที่','ทรัพย์สิน','ผู้เติม','เชื้อเพลิง','ลิตร','ราคา/ล.','รวม (฿)','ประสิทธิภาพ','มิเตอร์','ปั๊ม','เอกสาร'], ...(isAdmin ? [''] : [])].map((h, i) => (
                    <th key={i} className="px-4 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10 last:border-r-0 whitespace-nowrap">{h}</th>
                  ))}
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
                      <p className="text-[10px] text-gray-400">{assetIdentifier(r.fleet_vehicles)}</p>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 text-xs border-r border-gray-200 whitespace-nowrap">
                      {r.driver?.full_name ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 text-xs border-r border-gray-200">{FUEL_OPTIONS.find(item => item.value === r.fuel_type)?.label ?? r.fuel_other_name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right text-gray-700 text-sm font-semibold border-r border-gray-200">{r.liters}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600 text-xs border-r border-gray-200">{r.price_per_liter ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-gray-800 border-r border-gray-200">{r.total_cost == null ? '—' : fmtB(r.total_cost)}</td>
                    <td className="px-4 py-2.5 text-right text-xs border-r border-gray-200">
                      {r.efficiency_kml ? <span className="text-emerald-600 font-semibold">{r.efficiency_kml} กม./ล.</span> : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs border-r border-gray-200">{r.odometer == null ? '—' : [fmt(r.odometer), meterUnitShort(r.fleet_vehicles)].join(' ')}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs border-r border-gray-200">{r.fuel_station || '—'}</td>
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
                ))}
                {!records.length && (
                  <tr><td colSpan={isAdmin ? 13 : 12} className="text-center py-10 text-gray-400 text-sm">ยังไม่มีรายการเชื้อเพลิง</td></tr>
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
                      <span className="text-sm font-bold text-gray-800">{r.fleet_vehicles?.name ?? '—'}</span>
                      <span className="text-[10px] text-gray-400">{assetIdentifier(r.fleet_vehicles)}</span>
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
                      {thDate(r.filled_at)} · {r.liters} ลิตร{r.price_per_liter == null ? '' : ` @ ${r.price_per_liter} บ./ล.`}
                      {r.fuel_station ? ` · ${r.fuel_station}` : ''}
                    </p>
                    {r.driver?.full_name && (
                      <p className="text-[10px] text-gray-400 mt-0.5">👤 {r.driver.full_name}</p>
                    )}
                    {r.odometer != null && <p className="text-[10px] text-gray-400">มิเตอร์ {fmt(r.odometer)} {meterUnitShort(r.fleet_vehicles)}</p>}
                    {r.receipt_url && (
                      <button onClick={() => handleOpenDocument(r.receipt_url)}
                        className="mt-1 text-[10px] font-bold text-blue-600 flex items-center gap-1">
                        <FileText size={11} /> เปิดเอกสาร
                      </button>
                    )}
                  </div>
                  <div className="text-right shrink-0 flex flex-col items-end gap-1">
                    <p className="text-base font-black text-gray-800">{r.total_cost == null ? '—' : fmtB(r.total_cost)}</p>
                    {r.efficiency_kml && (
                      <p className="text-[10px] text-emerald-600 font-semibold">{r.efficiency_kml} กม./ล.</p>
                    )}
                    {isAdmin && (
                      <button onClick={() => handleDelete(r)}
                        className="text-[12px] font-bold px-2 py-0.5 rounded border border-red-300 text-red-400 hover:bg-red-400 hover:text-white transition-colors mt-1">
                        ลบ
                      </button>
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
              <h3 className="font-bold text-gray-800">บันทึกเชื้อเพลิง</h3>
              <button onClick={() => setModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">ยานพาหนะ/เครื่องยนต์ *</label>
                <select value={form.vehicle_id}
                  onChange={event => {
                    const asset = vehicles.find(item => item.id === event.target.value)
                    setForm(current => ({
                      ...current,
                      vehicle_id: event.target.value,
                      fuel_type: asset?.fuel_type || current.fuel_type,
                      full_tank: isVehicleAsset(asset),
                    }))
                  }}
                  className={sel}>
                  <option value="">— เลือกทรัพย์สิน —</option>
                  {vehicles.map(asset => (
                    <option key={asset.id} value={asset.id}>{assetOptionLabel(asset)}</option>
                  ))}
                </select>
              </div>

              {/* ผู้เติม — admin เปลี่ยนได้, staff เห็นแค่ตัวเอง */}
              {isAdmin && staffList.length > 0 ? (
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">ผู้เติม / ผู้ใช้รถ</label>
                  <select value={form.driver_id} onChange={set('driver_id')} className={sel}>
                    <option value="">— ไม่ระบุ —</option>
                    {staffList.map(s => (
                      <option key={s.id} value={s.id}>{s.full_name}{s.id === user?.id ? ' (ฉัน)' : ''}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="bg-gray-50 rounded-xl px-3 py-2 text-xs text-gray-500">
                  👤 ผู้เติม: <span className="font-semibold text-gray-700">
                    {staffList.find(s => s.id === user?.id)?.full_name ?? 'ฉัน'}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">วันที่ *</label>
                  <input type="date" value={form.filled_at} onChange={set('filled_at')} className={inp} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">{meterLabel(selectedAsset)} *</label>
                  <input type="number" value={form.odometer} onChange={set('odometer')} placeholder="50000" className={inp} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">ปริมาณ (ลิตร) *</label>
                  <input type="number" step="0.01" value={form.liters} onChange={set('liters')} placeholder="40.00" className={inp} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">ราคา/ลิตร {isVehicleAsset(selectedAsset) ? '*' : '(ถ้ามี)'}</label>
                  <input type="number" step="0.01" value={form.price_per_liter} onChange={set('price_per_liter')} placeholder="33.50" className={inp} />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">ประเภทเชื้อเพลิง/ของเหลว *</label>
                <select value={form.fuel_type} onChange={set('fuel_type')} className={sel}>
                  {FUEL_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
                {form.fuel_type === 'other' && (
                  <input value={form.fuel_other_name} onChange={set('fuel_other_name')}
                    placeholder="ระบุประเภทเชื้อเพลิง/ของเหลว" className={'mt-2 ' + inp} />
                )}
              </div>

              {totalCost && (
                <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 flex items-center justify-between">
                  <span className="text-xs text-amber-700 font-semibold">ยอดรวม</span>
                  <span className="text-lg font-black text-amber-700">{fmtB(parseFloat(totalCost))}</span>
                </div>
              )}

              {isVehicleAsset(selectedAsset) && <div className="flex items-center gap-2">
                <input type="checkbox" id="full_tank" checked={form.full_tank} onChange={set('full_tank')}
                  className="w-4 h-4 rounded accent-blue-500" />
                <label htmlFor="full_tank" className="text-sm text-gray-700">เติมเต็มถัง (คำนวณอัตราสิ้นเปลืองได้)</label>
              </div>}

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

              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">เอกสารประกอบ (ถ้ามี)</label>
                <label className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-gray-300 bg-gray-50 cursor-pointer text-xs text-gray-600">
                  <Paperclip size={14} />
                  <span className="truncate">{receiptFile?.name || 'แนบใบเสร็จ/เอกสาร PDF หรือรูปภาพ'}</span>
                  <input type="file" className="hidden"
                    accept=".jpg,.jpeg,.png,.webp,.pdf,.csv,.xlsx"
                    onChange={event => setReceiptFile(event.target.files?.[0] ?? null)} />
                </label>
                <p className="text-[10px] text-gray-400 mt-1">Private Storage · ขนาดไม่เกิน 10 MB</p>
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
