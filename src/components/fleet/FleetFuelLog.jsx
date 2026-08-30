import { useState, useEffect } from 'react'
import { Plus, X, AlertTriangle, FileText, Paperclip, Pencil, Fuel } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import FleetEmptyState from './FleetEmptyState'
import { logAction } from '../../lib/auditLog'
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

// snapshot เฉพาะฟิลด์ที่มีผลต่อการตรวจสอบการเบิกจ่าย ไม่ยัดทั้งแถวลง audit log
// จุดสำคัญคือกรณี "ลบ" — ถ้าไม่เก็บค่าไว้ ตัวเลขที่ถูกลบจะสืบกลับไม่ได้เลย
const auditSnapshot = r => r ? {
  filled_at: r.filled_at, vehicle_id: r.vehicle_id, odometer: r.odometer,
  liters: r.liters, price_per_liter: r.price_per_liter, total_cost: r.total_cost,
  full_tank: r.full_tank, fuel_station: r.fuel_station, receipt_no: r.receipt_no,
  is_anomaly: r.is_anomaly, anomaly_reason: r.anomaly_reason,
} : null

const auditLabel = r => [
  r?.fleet_vehicles?.name ?? 'ไม่ระบุรถ',
  `${r?.liters ?? '?'} ล.`,
  `฿${Math.round(r?.total_cost ?? 0).toLocaleString('th-TH')}`,
].join(' — ')

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
  const [editingId, setEditingId] = useState(null)
  const [form,      setForm]      = useState(EMPTY_FORM)
  const [receiptFile, setReceiptFile] = useState(null)
  const [saving,    setSaving]    = useState(false)
  const [filterVeh, setFilterVeh] = useState('all')
  const [dateFrom,  setDateFrom]  = useState('')
  const [dateTo,    setDateTo]    = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [totalCount, setTotalCount] = useState(0)

  const canWrite = isAdmin || isStaff

  const SELECT_Q = '*, fleet_vehicles(name, license_plate, asset_code, asset_kind, meter_unit), ' +
    'driver:profiles!fleet_fuel_records_driver_id_fkey(id,full_name), ' +
    'editor:profiles!fleet_fuel_records_updated_by_fkey(id,full_name)'

  useEffect(() => {
    if (!tenant?.id) return
    Promise.all([
      supabase.from('fleet_vehicles').select('id, name, license_plate, asset_code, asset_kind, meter_unit, tank_capacity, fuel_type')
        .eq('municipality_id', tenant.id).eq('status', 'active').order('name'),
      supabase.from('profiles').select('id, full_name')
        .eq('municipality_id', tenant.id).not('fleet_role', 'is', null).order('full_name'),
    ]).then(([{ data: v }, { data: s }]) => {
      setVehicles(v ?? [])
      setStaffList(s ?? [])
    })
  }, [tenant?.id])

  function loadRecords() {
    if (!tenant?.id) return
    setLoading(true)
    let q = supabase.from('fleet_fuel_records')
      .select(SELECT_Q, { count: 'exact' })
      .eq('municipality_id', tenant.id)
      .order('filled_at', { ascending: false })
    if (filterVeh !== 'all') q = q.eq('vehicle_id', filterVeh)
    if (dateFrom) q = q.gte('filled_at', dateFrom)
    if (dateTo)   q = q.lte('filled_at', dateTo)
    if (pageSize !== 'all') q = q.range(page * pageSize, (page + 1) * pageSize - 1)
    q.then(({ data, count }) => { setRecords(data ?? []); setTotalCount(count ?? 0) }).finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!tenant?.id) return
    // setState เรียกผ่าน queueMicrotask กันเข้าเงื่อนไข effect เรียก setState ตรงๆ ในตัว effect
    queueMicrotask(loadRecords)
    // SELECT_Q/loadRecords เป็นค่าคงที่ต่อ render ไม่ต้องอยู่ใน dependency array
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id, filterVeh, dateFrom, dateTo, page, pageSize])

  const set = k => e => setForm(f => ({
    ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value
  }))

  const totalCost = form.liters && form.price_per_liter
    ? (parseFloat(form.liters) * parseFloat(form.price_per_liter)).toFixed(2) : null
  const selectedAsset = vehicles.find(asset => asset.id === form.vehicle_id)

  function openModal() {
    setEditingId(null)
    setForm({ ...EMPTY_FORM, driver_id: user?.id ?? '' })
    setReceiptFile(null)
    setModal(true)
  }

  function openEditModal(r) {
    setEditingId(r.id)
    setForm({
      vehicle_id: r.vehicle_id ?? '',
      driver_id: r.driver_id ?? '',
      filled_at: r.filled_at ?? new Date().toISOString().slice(0,10),
      odometer: r.odometer ?? '',
      liters: r.liters ?? '',
      price_per_liter: r.price_per_liter ?? '',
      fuel_type: r.fuel_type ?? 'diesel',
      fuel_other_name: r.fuel_other_name ?? '',
      full_tank: r.full_tank ?? true,
      fuel_station: r.fuel_station ?? '',
      receipt_no: r.receipt_no ?? '',
      notes: r.notes ?? '',
    })
    setReceiptFile(null)
    setModal(true)
  }

  function closeModal() {
    setModal(false)
    setEditingId(null)
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

    // เตือนเมื่อค่ามิเตอร์ไม่เดินหน้าจากการเติมครั้งก่อนของรถคันเดียวกัน
    // ไม่บล็อกแข็ง เพราะกรณีเปลี่ยนเรือนไมล์ใหม่มีจริง ถ้าบล็อกเจ้าหน้าที่จะเลี่ยงด้วยการกรอกเลขมั่วให้ผ่าน
    // ซึ่งแย่กว่า — ฝั่ง DB จะติดธง is_anomaly ให้อีกชั้นไม่ว่าผู้ใช้จะยืนยันหรือไม่
    let prevQuery = supabase.from('fleet_fuel_records')
      .select('filled_at, odometer')
      .eq('municipality_id', tenant.id)
      .eq('vehicle_id', form.vehicle_id)
      .lte('filled_at', form.filled_at)
      .order('filled_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
    if (editingId) prevQuery = prevQuery.neq('id', editingId)
    const { data: prevRows, error: prevErr } = await prevQuery
    if (prevErr) console.warn('[FleetFuelLog] ตรวจมิเตอร์ครั้งก่อนไม่สำเร็จ:', prevErr.message)
    const prev = prevRows?.[0]
    if (prev && meter <= Number(prev.odometer)) {
      const unit = meterUnitShort(selectedAsset)
      const headline = meter < Number(prev.odometer)
        ? `ค่ามิเตอร์ที่กรอก (${fmt(meter)} ${unit}) น้อยกว่าการเติมครั้งก่อนเมื่อ ${thDate(prev.filled_at)} (${fmt(Number(prev.odometer))} ${unit})`
        : `ค่ามิเตอร์เท่ากับการเติมครั้งก่อนเมื่อ ${thDate(prev.filled_at)} (${fmt(Number(prev.odometer))} ${unit})`
      if (!confirm(headline + '\n\nกรอกตัวเลขผิดหรือไม่?\nถ้าเปลี่ยนเรือนไมล์ใหม่จริง กด OK เพื่อบันทึกต่อ ระบบจะทำเครื่องหมาย "ผิดปกติ" ไว้ให้ผู้ตรวจสอบ')) return
    }

    setSaving(true)
    const beforeRecord = editingId ? records.find(x => x.id === editingId) : null
    const oldReceiptUrl = beforeRecord?.receipt_url ?? null
    const recordId = editingId ?? crypto.randomUUID()

    // อัปโหลดเอกสารก่อน insert/update เสมอ แล้วใส่ receipt_url ไปในคำสั่งเดียวกัน
    // (เดิมทำ insert ก่อนแล้วค่อย update receipt_url ทีหลัง — ทำให้ระเบียนที่เพิ่งสร้างใหม่โดนนับเป็น "แก้ไข" ผิดๆ จาก trigger updated_at)
    let receiptPath = null
    let attachmentWarning = ''
    if (receiptFile) {
      try {
        receiptPath = await uploadFleetDocument({ tenantId: tenant.id, scope: 'fuel', recordId, file: receiptFile })
      } catch (uploadError) {
        attachmentWarning = 'แนบเอกสารไม่สำเร็จ: ' + uploadError.message + ' — บันทึกรายการต่อโดยไม่มีเอกสารแนบ'
      }
    }

    const payload = {
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
      ...(receiptPath ? { receipt_url: receiptPath } : {}),
    }
    // updated_at/updated_by ไม่ต้องส่งเอง — ตั้งอัตโนมัติจาก trigger ฝั่ง DB (trg_fleet_fuel_records_updated_at) เพื่อกันปลอมแปลงร่องรอยแก้ไข
    const query = editingId
      ? supabase.from('fleet_fuel_records').update(payload).eq('id', editingId)
      : supabase.from('fleet_fuel_records').insert({ id: recordId, ...payload, municipality_id: tenant.id, created_by: user?.id })
    const { data, error } = await query.select(SELECT_Q).single()
    if (!error) {
      // แนบไฟล์ใหม่แทนที่เอกสารเดิมสำเร็จแล้ว (กรณีแก้ไข) — ลบไฟล์เก่าทิ้งกันขยะค้าง storage
      if (receiptPath && oldReceiptUrl && oldReceiptUrl !== receiptPath) removeFleetDocument(oldReceiptUrl).catch(() => {})
      // โหลดใหม่แทนการแทรก/แก้ state เอง เพื่อให้ตัวนับ "(x–y จาก N)" กับปุ่มเปลี่ยนหน้าไม่ค้าง
      // ค่าเก่า (totalCount มาจาก count:'exact' คนละ query กับตาราง) และให้แถวใหม่เข้าลำดับ
      // ตามวันที่จริง ไม่ใช่ไปแปะหัวตารางเสมอ — แนวเดียวกับ FleetMaintenance
      loadRecords()
      logAction({
        action: editingId ? 'update' : 'create',
        resourceType: 'fleet_fuel', resourceId: recordId, resourceLabel: auditLabel(data),
        municipalityId: tenant.id,
        metadata: editingId
          ? { before: auditSnapshot(beforeRecord), after: auditSnapshot(data) }
          : { after: auditSnapshot(data) },
      })
      closeModal()
      setForm(EMPTY_FORM)
      setReceiptFile(null)
      if (attachmentWarning) alert(attachmentWarning)
    } else {
      // insert/update ล้มเหลว แต่ไฟล์อัปโหลดไปแล้ว (ถ้ามี) ต้องลบทิ้งกันขยะค้าง storage
      if (receiptPath) removeFleetDocument(receiptPath).catch(() => {})
      alert(error.message)
    }
    setSaving(false)
  }

  async function handleDelete(r) {
    if (!confirm(`ลบรายการเติมน้ำมัน ${thDate(r.filled_at)} — ${r.fleet_vehicles?.name} (${r.liters} ลิตร)?`)) return
    const { error } = await supabase.from('fleet_fuel_records').delete().eq('id', r.id)
    if (!error) {
      logAction({
        action: 'delete', resourceType: 'fleet_fuel', resourceId: r.id, resourceLabel: auditLabel(r),
        municipalityId: tenant.id, metadata: { deleted: auditSnapshot(r) },
      })
      loadRecords()   // เช่นเดียวกับตอนบันทึก — ตัวนับกับหน้าที่แสดงต้องมาจาก query เดียวกันเสมอ
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
    <div className="space-y-3 md:space-y-4">
      {/* Toolbar */}
      <div className="grid grid-cols-2 md:flex md:flex-wrap gap-2 items-center">
        <select value={filterVeh} onChange={e => { setFilterVeh(e.target.value); setPage(0) }}
          className={`${canWrite ? '' : 'col-span-2'} order-1 md:order-none min-w-0 w-full md:w-auto text-xs border border-gray-200 rounded-xl px-3 py-2 bg-white text-gray-700 focus:outline-none`}>
          <option value="all">ทุกทรัพย์สิน</option>
          {vehicles.map(asset => <option key={asset.id} value={asset.id}>{assetOptionLabel(asset)}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0) }}
          className="order-3 md:order-none min-w-0 w-full md:w-auto text-[11px] md:text-xs border border-gray-200 rounded-xl px-2 md:px-3 py-2 bg-white text-gray-700 focus:outline-none" />
        <span className="hidden md:inline text-xs text-gray-400">–</span>
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0) }}
          className="order-4 md:order-none min-w-0 w-full md:w-auto text-[11px] md:text-xs border border-gray-200 rounded-xl px-2 md:px-3 py-2 bg-white text-gray-700 focus:outline-none" />
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(''); setDateTo(''); setPage(0) }}
            className="order-5 md:order-none col-span-2 md:col-span-1 justify-self-end text-[11px] md:text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded-lg border border-gray-200">ล้าง</button>
        )}
        {canWrite && (
          <button onClick={openModal}
            className="order-2 md:order-none justify-center md:ml-auto flex items-center gap-1.5 px-2 md:px-4 py-2 rounded-xl text-[11px] md:text-sm font-bold text-white"
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
            <table className="w-full text-sm border-collapse table-fixed">
              <thead>
                <tr style={{ backgroundColor: '#1a3a5c' }}>
                  {[...['ที่','วันที่','ทรัพย์สิน','ผู้ใช้รถ','จำนวน','รวม (฿)','มิเตอร์','ปั๊ม/เอกสาร'], ...(canWrite ? ['จัดการ'] : [])].map((h, i) => (
                    <th key={i} className="px-2 py-2 text-left text-[11px] font-bold text-white whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {records.map((r, idx) => (
                  <tr key={r.id}
                    style={{ backgroundColor: idx % 2 === 0 ? '#fff' : '#f5f8fc' }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = '#dbeafe'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = idx % 2 === 0 ? '#fff' : '#f5f8fc'}>
                    <td className="px-2 py-2 text-gray-400 text-xs">{idx + 1}</td>
                    <td className="px-2 py-2 text-gray-600 text-xs whitespace-nowrap">{thDate(r.filled_at)}</td>
                    <td className="px-2 py-2 truncate">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="font-semibold text-gray-800 text-sm truncate">{r.fleet_vehicles?.name ?? '—'}</span>
                        {r.is_anomaly && <span title={r.anomaly_reason ?? undefined} className="flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 shrink-0"><AlertTriangle size={8} />ผิดปกติ</span>}
                        {!r.full_tank && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 shrink-0">ไม่เต็ม</span>}
                      </div>
                      <p className="text-[10px] text-gray-400 truncate">
                        {assetIdentifier(r.fleet_vehicles)} · {FUEL_OPTIONS.find(item => item.value === r.fuel_type)?.label ?? r.fuel_other_name ?? '—'}
                      </p>
                      {r.anomaly_reason && (
                        <p className="text-[9px] text-red-500 truncate" title={r.anomaly_reason}>⚠ {r.anomaly_reason}</p>
                      )}
                      {r.updated_by && (
                        <p className="text-[9px] text-amber-500 truncate">แก้ไข {thDate(r.updated_at)}{r.editor?.full_name ? ` · ${r.editor.full_name}` : ''}</p>
                      )}
                    </td>
                    <td className="px-2 py-2 text-gray-600 text-xs truncate">
                      {r.driver?.full_name ?? '—'}
                    </td>
                    <td className="px-2 py-2 text-right text-gray-600 text-xs">
                      {r.liters} ล. {r.price_per_liter != null ? `× ฿${r.price_per_liter}` : ''}
                    </td>
                    <td className="px-2 py-2 text-right font-bold text-gray-800 whitespace-nowrap">{r.total_cost == null ? '—' : fmtB(r.total_cost)}</td>
                    <td className="px-2 py-2 text-gray-500 text-xs">
                      {r.odometer == null ? '—' : [fmt(r.odometer), meterUnitShort(r.fleet_vehicles)].join(' ')}
                      {r.efficiency_kml != null && (
                        <span className="block text-[10px] text-emerald-600 font-semibold">{r.efficiency_kml} กม./ล.</span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-gray-500 text-xs truncate">{r.fuel_station || '—'}</span>
                        {r.receipt_url && (
                          <button onClick={() => handleOpenDocument(r.receipt_url)} className="text-blue-600 hover:text-blue-800 shrink-0" title="เปิดเอกสาร">
                            <FileText size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                    {canWrite && (
                      <td className="px-2 py-2 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button onClick={() => openEditModal(r)}
                            className="text-xs font-bold px-2.5 py-1 rounded border border-blue-400 text-blue-500 hover:bg-blue-500 hover:text-white transition-colors">
                            แก้ไข
                          </button>
                          {isAdmin && (
                            <button onClick={() => handleDelete(r)}
                              className="text-xs font-bold px-2.5 py-1 rounded border border-red-400 text-red-500 hover:bg-red-500 hover:text-white transition-colors">
                              ลบ
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {!records.length && (
                  <tr><td colSpan={canWrite ? 9 : 8}>
                    <FleetEmptyState icon={Fuel} title="ยังไม่มีรายการเชื้อเพลิง" />
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-1.5">
            {records.map(r => (
              <div key={r.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-bold text-gray-800">{r.fleet_vehicles?.name ?? '—'}</span>
                      <span className="text-[10px] text-gray-400">{assetIdentifier(r.fleet_vehicles)}</span>
                      {r.is_anomaly && (
                        <span title={r.anomaly_reason ?? undefined}
                              className="flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">
                          <AlertTriangle size={9} /> ผิดปกติ
                        </span>
                      )}
                      {!r.full_tank && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">เติมไม่เต็ม</span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-500 mt-0.5 truncate">
                      {thDate(r.filled_at)} · {r.liters} ลิตร{r.price_per_liter == null ? '' : ` @ ${r.price_per_liter} บ./ล.`}
                      {r.fuel_station ? ` · ${r.fuel_station}` : ''}
                    </p>
                    {r.anomaly_reason && (
                      <p className="text-[10px] text-red-500 mt-0.5 leading-relaxed">⚠ {r.anomaly_reason}</p>
                    )}
                    {(r.driver?.full_name || r.odometer != null) && (
                      <p className="text-[10px] text-gray-400 mt-0.5 truncate">
                        {r.driver?.full_name ? `👤 ${r.driver.full_name}` : ''}
                        {r.driver?.full_name && r.odometer != null ? ' · ' : ''}
                        {r.odometer != null ? `มิเตอร์ ${fmt(r.odometer)} ${meterUnitShort(r.fleet_vehicles)}` : ''}
                      </p>
                    )}
                    {r.receipt_url && (
                      <button onClick={() => handleOpenDocument(r.receipt_url)}
                        className="mt-0.5 text-[10px] font-bold text-blue-600 flex items-center gap-1">
                        <FileText size={11} /> เปิดเอกสาร
                      </button>
                    )}
                    {r.updated_by && (
                      <p className="text-[9px] text-amber-500 mt-0.5">แก้ไข {thDate(r.updated_at)}{r.editor?.full_name ? ` · ${r.editor.full_name}` : ''}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0 flex flex-col items-end gap-1">
                    <p className="text-base font-black text-gray-800">{r.total_cost == null ? '—' : fmtB(r.total_cost)}</p>
                    {r.efficiency_kml != null && (
                      <p className="text-[10px] text-emerald-600 font-semibold">{r.efficiency_kml} กม./ล.</p>
                    )}
                    {canWrite && (
                      <div className="flex items-center gap-1 mt-1">
                        <button onClick={() => openEditModal(r)}
                          className="text-[12px] font-bold px-2 py-0.5 rounded border border-blue-300 text-blue-400 hover:bg-blue-400 hover:text-white transition-colors">
                          แก้ไข
                        </button>
                        {isAdmin && (
                          <button onClick={() => handleDelete(r)}
                            className="text-[12px] font-bold px-2 py-0.5 rounded border border-red-300 text-red-400 hover:bg-red-400 hover:text-white transition-colors">
                            ลบ
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {!records.length && <FleetEmptyState icon={Fuel} title="ยังไม่มีรายการเติมน้ำมัน" />}
          </div>
        </>
      )}

      {/* Pagination */}
      {totalCount > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-1 py-2 text-xs text-gray-500">
          <div className="flex items-center gap-2">
            <span>แสดง</span>
            <select value={pageSize}
              onChange={e => { setPageSize(e.target.value === 'all' ? 'all' : Number(e.target.value)); setPage(0) }}
              className="bg-white border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-200">
              {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
              <option value="all">ทั้งหมด</option>
            </select>
            <span>รายการ</span>
            <span className="text-gray-400">
              ({pageSize === 'all' ? 1 : page * pageSize + 1}–{pageSize === 'all' ? totalCount : Math.min((page + 1) * pageSize, totalCount)} จาก {totalCount})
            </span>
          </div>
          {pageSize !== 'all' && totalCount > pageSize && (
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white font-semibold disabled:opacity-40">ก่อนหน้า</button>
              <span>หน้า {page + 1} / {Math.max(1, Math.ceil(totalCount / pageSize))}</span>
              <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * pageSize >= totalCount}
                className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white font-semibold disabled:opacity-40">ถัดไป</button>
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={closeModal} />
          <div className="relative bg-white rounded-t-3xl md:rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="shrink-0 bg-white px-4 py-3 md:px-5 md:pt-5 md:pb-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-800 flex items-center gap-1.5">
                {editingId && <Pencil size={14} className="text-blue-500" />}
                {editingId ? 'แก้ไขรายการเชื้อเพลิง' : 'บันทึกเชื้อเพลิง'}
              </h3>
              <button onClick={closeModal} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
                <X size={16} />
              </button>
            </div>
            <div className="overflow-y-auto p-4 md:p-5 space-y-3">
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

              {/* ผู้ใช้รถ (คนเติม/ขับ ณ ตอนนั้น) — เปลี่ยนเป็นเพื่อนร่วมงานคนอื่นได้ เผื่อกรอกแทนกรณีฝากทำให้ */}
              {staffList.length > 0 ? (
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">ผู้ใช้รถ</label>
                  <select value={form.driver_id} onChange={set('driver_id')} className={sel}>
                    <option value="">— ไม่ระบุ —</option>
                    {staffList.map(s => (
                      <option key={s.id} value={s.id}>{s.full_name}{s.id === user?.id ? ' (ฉัน)' : ''}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="bg-gray-50 rounded-xl px-3 py-2 text-xs text-gray-500">
                  👤 ผู้ใช้รถ: <span className="font-semibold text-gray-700">ฉัน</span>
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
                className="sticky bottom-0 z-10 w-full py-3 rounded-xl font-bold text-white text-sm disabled:opacity-50 shadow-lg"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                {saving ? 'กำลังบันทึก...' : (editingId ? 'บันทึกการแก้ไข' : 'บันทึก')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
