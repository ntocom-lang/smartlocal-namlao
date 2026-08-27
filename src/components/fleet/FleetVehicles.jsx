import { useState, useEffect } from 'react'
import { Plus, X, Pencil, AlertTriangle, Upload, Car, Tag } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import FleetImportModal from './FleetImportModal'
import FleetVehicleDetail from './FleetVehicleDetail'
import FleetEmptyState from './FleetEmptyState'
import { logAction } from '../../lib/auditLog'
import {
  ASSET_KIND_LABEL,
  ASSET_KIND_OPTIONS,
  FUEL_LABEL,
  FUEL_OPTIONS,
  METER_UNIT_OPTIONS,
  assetEmoji,
  assetIdentifier,
  isVehicleAsset,
  meterUnitShort,
} from '../../lib/fleetAssets'

const DEFAULT_VEHICLE_TYPES = [
  { value:'car', label:'รถยนต์' }, { value:'pickup', label:'รถกระบะ' }, { value:'truck', label:'รถบรรทุก' },
  { value:'van', label:'รถตู้' }, { value:'excavator', label:'รถขุด' }, { value:'backhoe', label:'แบคโฮ' },
  { value:'pump', label:'เครื่องสูบน้ำ' }, { value:'generator', label:'เครื่องยนต์' },
  { value:'motorcycle', label:'มอเตอร์ไซค์' }, { value:'other', label:'อื่นๆ' },
]
const STATUS_TH = { active:'ใช้งานได้', inactive:'ปลดประจำการ', under_repair:'กำลังซ่อม', retired:'ปลดระวาง' }
const STATUS_CLR = { active:'#10b981', inactive:'#9ca3af', under_repair:'#f59e0b', retired:'#6b7280' }

const inp = 'w-full px-3 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent'
const sel = inp + ' appearance-none'

const EMPTY = {
  name:'', asset_kind:'vehicle', license_plate:'', asset_code:'', meter_unit:'km',
  vehicle_type:'car', brand:'', model:'', manufacture_year:'',
  fuel_type:'diesel', tank_capacity:'', odometer_initial:'', is_pool:false, status:'active',
  department_id:'', notes:'',
  insurance_expiry:'', act_expiry:'', registration_expiry:'', inspection_expiry:'',
}

function daysTo(dateStr) {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000)
}

/* ── จัดการประเภทรถ/เครื่องยนต์ — ย้ายมาจากหน้าตั้งค่าแอดมิน มาไว้ตรงนี้แทน
   เพื่อให้ fleet_admin (ไม่จำเป็นต้องเป็นแอดมินเทศบาลเต็มสิทธิ์) เพิ่ม/แก้เองได้เลย
   โดยไม่ต้องขอสิทธิ์เข้าหน้าแอดมิน (RLS ยังคุมอยู่: fleet_vehicle_types เขียนได้เฉพาะ
   fleet_is_manager() = role admin หรือ fleet_role fleet_admin เท่านั้น) ── */
function VehicleTypeManagerModal({ tenant, types, setTypes, onClose }) {
  const [form,   setForm]   = useState({ label: '' })
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState(null)

  async function handleSave() {
    if (!form.label.trim()) return alert('กรุณากรอกชื่อประเภท')
    setSaving(true)
    if (editId) {
      const { data, error } = await supabase.from('fleet_vehicle_types')
        .update({ label: form.label.trim() }).eq('id', editId).select().single()
      if (!error) {
        setTypes(prev => prev.map(t => t.id === editId ? data : t))
        setEditId(null)
        setForm({ label: '' })
      } else {
        alert('บันทึกไม่สำเร็จ: ' + error.message)
      }
    } else {
      const { data, error } = await supabase.from('fleet_vehicle_types').insert({
        municipality_id: tenant.id,
        value: 'vt_' + Date.now().toString(36),
        label: form.label.trim(),
        sort_order: types.length,
      }).select().single()
      if (!error) {
        setTypes(prev => [...prev, data])
        setForm({ label: '' })
      } else {
        alert('เพิ่มไม่สำเร็จ: ' + error.message)
      }
    }
    setSaving(false)
  }

  async function handleDelete(id) {
    if (!confirm('ลบประเภทนี้?')) return
    const { error } = await supabase.from('fleet_vehicle_types').delete().eq('id', id)
    if (!error) setTypes(prev => prev.filter(t => t.id !== id))
    else alert('ลบไม่สำเร็จ: ' + error.message)
  }

  async function seedDefaults() {
    const label = types.length === 0 ? 'เพิ่มประเภทมาตรฐานทั้งหมด?' : 'เพิ่มประเภทมาตรฐานที่ยังไม่มี?'
    if (!confirm(label)) return
    setSaving(true)
    const rows = DEFAULT_VEHICLE_TYPES.map((t, i) => ({
      municipality_id: tenant.id, value: t.value, label: t.label, sort_order: types.length + i,
    }))
    const { data, error } = await supabase.from('fleet_vehicle_types')
      .upsert(rows, { onConflict: 'municipality_id,value' }).select().order('sort_order')
    if (!error && data) {
      setTypes(prev => {
        const merged = [...prev]
        data.forEach(d => {
          const idx = merged.findIndex(t => t.id === d.id)
          if (idx >= 0) merged[idx] = d
          else merged.push(d)
        })
        return merged.sort((a, b) => a.sort_order - b.sort_order)
      })
    } else if (error) {
      alert(error.message)
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-t-3xl md:rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="shrink-0 px-5 pt-5 pb-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800">จัดการประเภทรถ/เครื่องยนต์</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16} /></button>
        </div>
        <div className="overflow-y-auto p-4 space-y-4">
          <div className="bg-gray-50 rounded-2xl border border-gray-100 p-4 space-y-3">
            <p className="text-sm font-bold text-gray-700">{editId ? 'แก้ไขประเภท' : 'เพิ่มประเภทใหม่'}</p>
            <div>
              <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                placeholder="เช่น รถกระบะ, รถตู้" className={inp}
                onKeyDown={e => e.key === 'Enter' && handleSave()} />
            </div>
            <div className="flex gap-2">
              {editId && (
                <button onClick={() => { setEditId(null); setForm({ label: '' }) }}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 text-gray-600">
                  ยกเลิก
                </button>
              )}
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                {saving ? 'กำลังบันทึก...' : editId ? 'อัปเดต' : 'เพิ่มประเภท'}
              </button>
              {!editId && (
                <button onClick={seedDefaults} disabled={saving}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 text-gray-600 hover:bg-white disabled:opacity-50">
                  {types.length === 0 ? '+ ค่าเริ่มต้น' : '+ มาตรฐาน'}
                </button>
              )}
            </div>
          </div>

          {types.length === 0 && (
            <FleetEmptyState icon={Tag} title="ยังไม่มีประเภท" hint={<>กด <strong className="text-gray-500">+ ค่าเริ่มต้น</strong> เพื่อเพิ่มทั้งหมด</>} />
          )}

          <div className="space-y-2">
            {types.map(t => (
              <div key={t.id ?? t.value} className={`flex items-center justify-between bg-white rounded-xl border px-4 py-3 transition-colors ${
                editId === t.id ? 'border-blue-300 bg-blue-50/40' : 'border-gray-100'
              }`}>
                <p className="text-sm font-semibold text-gray-800">{t.label}</p>
                {t.id && (
                  <div className="flex gap-1">
                    <button onClick={() => { setEditId(t.id); setForm({ label: t.label }) }}
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><Pencil size={13} /></button>
                    <button onClick={() => handleDelete(t.id)}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400"><X size={13} /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ทะเบียนครุภัณฑ์เป็นข้อมูลตั้งต้นของทั้งโมดูล การแก้ประเภทรถ/กอง/สถานะ
// เปลี่ยนผลลัพธ์ของรายงานย้อนหลังทั้งหมด จึงต้องเหลือร่องรอยว่าใครแก้อะไร
const auditSnapshot = v => v ? {
  name: v.name, license_plate: v.license_plate, asset_code: v.asset_code,
  asset_kind: v.asset_kind, vehicle_type: v.vehicle_type, status: v.status,
  department_id: v.department_id, is_pool: v.is_pool,
  meter_unit: v.meter_unit, tank_capacity: v.tank_capacity, fuel_type: v.fuel_type,
} : null

export default function FleetVehicles({ tenant, depts, isAdmin }) {
  const [vehicles,     setVehicles]     = useState([])
  // เก็บเฉพาะแถวจริงจากฐานข้อมูล (มี id เสมอ) — ใช้เป็นแหล่งข้อมูลตรงให้โมดัล "จัดการประเภท"
  // ส่วนดรอปดาวน์เพิ่ม/แก้ไขทรัพย์สินค่อยไป fallback เป็นชุดมาตรฐานเองตอนแสดงผล (ดู typeOptions)
  const [vehicleTypes, setVehicleTypes] = useState([])
  const typeOptions = vehicleTypes.length ? vehicleTypes : DEFAULT_VEHICLE_TYPES
  const [loading,      setLoading]      = useState(true)
  const [modal,        setModal]        = useState(null)
  const [form,         setForm]         = useState(EMPTY)
  const [saving,       setSaving]       = useState(false)
  const [filterDept,   setFilterDept]   = useState('all')
  const [filterStatus, setFilterStatus] = useState('active')
  const [filterKind,   setFilterKind]   = useState('all')
  const [importOpen,   setImportOpen]   = useState(false)
  const [detailVeh,    setDetailVeh]    = useState(null)
  const [typesOpen,    setTypesOpen]    = useState(false)

  useEffect(() => {
    if (!tenant?.id) return
    Promise.all([
      supabase.from('fleet_vehicles').select('*, departments(name,short_name)')
        .eq('municipality_id', tenant.id).order('name'),
      supabase.from('fleet_vehicle_types').select('id,value,label,sort_order')
        .eq('municipality_id', tenant.id).order('sort_order'),
    ]).then(([{ data: v }, { data: t }]) => {
      setVehicles(v ?? [])
      setVehicleTypes(t ?? [])
    }).finally(() => setLoading(false))
  }, [tenant?.id])

  /* ── Realtime ── */
  useEffect(() => {
    if (!tenant?.id) return
    const SELECT = '*, departments(name,short_name)'
    const channel = supabase.channel(`fleet-vehicles-${tenant.id}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'fleet_vehicles' },
        async ({ new: row }) => {
          if (row.municipality_id !== tenant.id) return
          const { data } = await supabase.from('fleet_vehicles').select(SELECT).eq('id', row.id).single()
          if (data) setVehicles(prev => {
            const next = prev.some(item => item.id === data.id)
              ? prev.map(item => item.id === data.id ? data : item)
              : [...prev, data]
            return next.sort((a, b) => a.name.localeCompare(b.name, 'th'))
          })
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'fleet_vehicles' },
        async ({ new: row }) => {
          if (row.municipality_id !== tenant.id) return
          const { data } = await supabase.from('fleet_vehicles').select(SELECT).eq('id', row.id).single()
          if (data) setVehicles(prev => prev.map(v => v.id === data.id ? data : v))
        })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [tenant?.id])

  function openAdd() { setForm({ ...EMPTY, department_id: depts[0]?.id ?? '' }); setModal('add') }
  function openEdit(v) {
    setForm({
      name: v.name, asset_kind: v.asset_kind ?? 'vehicle',
      license_plate: v.license_plate ?? '', asset_code: v.asset_code ?? '',
      meter_unit: v.meter_unit ?? 'km', vehicle_type: v.vehicle_type,
      brand: v.brand ?? '', model: v.model ?? '', manufacture_year: v.manufacture_year ?? '',
      fuel_type: v.fuel_type, tank_capacity: v.tank_capacity ?? '', odometer_initial: v.odometer_initial ?? '',
      is_pool: v.is_pool, status: v.status, department_id: v.department_id ?? '',
      notes: v.notes ?? '',
      insurance_expiry: v.insurance_expiry ?? '', act_expiry: v.act_expiry ?? '',
      registration_expiry: v.registration_expiry ?? '', inspection_expiry: v.inspection_expiry ?? '',
    })
    setModal(v)
  }

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  async function handleSave() {
    if (!form.name.trim()) return alert('กรุณากรอกชื่อทรัพย์สิน')
    if (form.asset_kind === 'vehicle' && !form.license_plate.trim()) return alert('ยานพาหนะต้องมีทะเบียนรถ')
    if (form.asset_kind !== 'vehicle' && !form.asset_code.trim()) return alert('เครื่องยนต์/ครุภัณฑ์ต้องมีรหัสครุภัณฑ์')
    if (form.tank_capacity !== '' && Number(form.tank_capacity) <= 0) return alert('ความจุถังต้องมากกว่า 0')
    if (form.odometer_initial !== '' && Number(form.odometer_initial) < 0) return alert('ค่ามิเตอร์เริ่มต้นต้องไม่ติดลบ')
    setSaving(true)
    const payload = {
      ...form,
      name: form.name.trim(),
      license_plate: form.asset_kind === 'vehicle' ? form.license_plate.trim() : null,
      asset_code: form.asset_code.trim() || null,
      municipality_id: tenant.id,
      manufacture_year: form.manufacture_year || null,
      tank_capacity:    form.tank_capacity    || null,
      odometer_initial: Number(form.odometer_initial) || 0,
      department_id:    form.department_id    || null,
      insurance_expiry:    form.insurance_expiry    || null,
      act_expiry:          form.act_expiry          || null,
      registration_expiry: form.registration_expiry || null,
      inspection_expiry:   form.inspection_expiry   || null,
    }
    if (modal === 'add') {
      const { data, error } = await supabase.from('fleet_vehicles').insert(payload)
        .select('*, departments(name,short_name)').single()
      if (!error) {
        setVehicles(prev => [...prev, data].sort((a,b) => a.name.localeCompare(b.name, 'th')))
        logAction({
          action: 'create', resourceType: 'fleet_vehicle', resourceId: data.id,
          resourceLabel: `${data.name} (${assetIdentifier(data)})`,
          municipalityId: tenant.id, metadata: { after: auditSnapshot(data) },
        })
        setModal(null)
      } else alert(error.message)
    } else {
      const { data, error } = await supabase.from('fleet_vehicles').update(payload)
        .eq('id', modal.id).select('*, departments(name,short_name)').single()
      if (!error) {
        const before = vehicles.find(v => v.id === modal.id)
        setVehicles(prev => prev.map(v => v.id === modal.id ? data : v))
        logAction({
          action: 'update', resourceType: 'fleet_vehicle', resourceId: data.id,
          resourceLabel: `${data.name} (${assetIdentifier(data)})`,
          municipalityId: tenant.id,
          metadata: { before: auditSnapshot(before), after: auditSnapshot(data) },
        })
        setModal(null)
      } else alert(error.message)
    }
    setSaving(false)
  }

  async function handleDelete(v) {
    const [{ count: fuelCount }, { count: tripCount }, { count: maintenanceCount }] = await Promise.all([
      supabase.from('fleet_fuel_records').select('id', { count: 'exact', head: true }).eq('vehicle_id', v.id),
      supabase.from('fleet_trips').select('id', { count: 'exact', head: true }).eq('vehicle_id', v.id),
      supabase.from('fleet_maintenance').select('id', { count: 'exact', head: true }).eq('vehicle_id', v.id),
    ])
    const historyCount = (fuelCount ?? 0) + (tripCount ?? 0) + (maintenanceCount ?? 0)
    if (historyCount > 0) {
      alert(`ไม่สามารถลบได้ เพราะมีประวัติที่เกี่ยวข้อง ${historyCount} รายการ\nให้แก้ไขสถานะเป็น “ปลดระวาง” เพื่อรักษาประวัติราชการ`)
      return
    }
    if (!confirm(`ลบ "${v.name}" (${assetIdentifier(v)})?`)) return
    const { error } = await supabase.from('fleet_vehicles').delete().eq('id', v.id)
    if (!error) {
      setVehicles(prev => prev.filter(x => x.id !== v.id))
      logAction({
        action: 'delete', resourceType: 'fleet_vehicle', resourceId: v.id,
        resourceLabel: `${v.name} (${assetIdentifier(v)})`,
        municipalityId: tenant.id, metadata: { deleted: auditSnapshot(v) },
      })
    }
    else alert('ลบไม่สำเร็จ: ' + error.message)
  }

  const filtered = vehicles.filter(v => {
    if (filterKind !== 'all' && (v.asset_kind ?? 'vehicle') !== filterKind) return false
    if (filterDept !== 'all' && v.department_id !== filterDept && !(filterDept === 'pool' && v.is_pool)) return false
    if (filterStatus !== 'all' && v.status !== filterStatus) return false
    return true
  })

  return (
    <div className="space-y-3 md:space-y-4">
      {/* Toolbar */}
      <div className="grid grid-cols-3 md:flex md:flex-wrap gap-2 items-center">
        <select value={filterDept} onChange={e => setFilterDept(e.target.value)}
          className="w-full md:w-auto min-w-0 md:min-w-35 text-xs border border-gray-200 rounded-xl px-2 md:px-3 py-2 md:py-2.5 bg-gray-50 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200 truncate">
          <option value="all">ทุกกอง</option>
          <option value="pool">รถกลาง</option>
          {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="w-full md:w-auto min-w-0 md:min-w-35 text-xs border border-gray-200 rounded-xl px-2 md:px-3 py-2 md:py-2.5 bg-gray-50 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200 truncate">
          <option value="all">ทุกสถานะ</option>
          {Object.entries(STATUS_TH).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filterKind} onChange={e => setFilterKind(e.target.value)}
          className="w-full md:w-auto min-w-0 md:min-w-35 text-xs border border-gray-200 rounded-xl px-2 md:px-3 py-2 md:py-2.5 bg-gray-50 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200 truncate">
          <option value="all">ทุกชนิด</option>
          {ASSET_KIND_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        {isAdmin && (
          <div className="col-span-3 grid grid-cols-3 gap-2 md:ml-auto md:flex md:items-center">
            <button onClick={() => setImportOpen(true)}
              className="justify-center flex items-center gap-1.5 px-2 md:px-3 py-2 rounded-xl text-[11px] md:text-xs font-bold border border-emerald-200 text-emerald-700 bg-emerald-50">
              <Upload size={14} /> นำเข้า CSV/XLSX
            </button>
            <button onClick={() => setTypesOpen(true)}
              className="justify-center flex items-center gap-1.5 px-2 md:px-3 py-2 rounded-xl text-[11px] md:text-xs font-bold border border-gray-200 text-gray-600 bg-gray-50">
              <Tag size={14} /> ประเภทรถ
            </button>
            <button onClick={openAdd}
              className="justify-center flex items-center gap-1.5 px-2 md:px-4 py-2 rounded-xl text-[11px] md:text-sm font-bold text-white"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              <Plus size={15} /> เพิ่มทรัพย์สิน
            </button>
          </div>
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
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold text-white w-8 border-r border-white/10">ที่</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">ชื่อ / รหัส</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">ทะเบียน / รหัสครุภัณฑ์</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">ประเภท</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">กอง</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">เชื้อเพลิง</th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-bold text-white border-r border-white/10">สถานะ</th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-bold text-white border-r border-white/10">เอกสาร</th>
                  {isAdmin && <th className="px-4 py-2.5 text-center text-[11px] font-bold text-white">จัดการ</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filtered.map((v, idx) => {
                  const expiries = [
                    { label:'ประกัน',    days: daysTo(v.insurance_expiry) },
                    { label:'พรบ.',      days: daysTo(v.act_expiry) },
                    { label:'ทะเบียน',  days: daysTo(v.registration_expiry) },
                    { label:'ตรวจสภาพ', days: daysTo(v.inspection_expiry) },
                  ].filter(e => e.days !== null && e.days <= 60)
                  return (
                    <tr key={v.id}
                      style={{ backgroundColor: idx % 2 === 0 ? '#fff' : '#f5f8fc' }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = '#dbeafe'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = idx % 2 === 0 ? '#fff' : '#f5f8fc'}>
                      <td className="px-4 py-2.5 text-gray-400 text-xs border-r border-gray-200">{idx + 1}</td>
                      <td className="px-4 py-2.5 border-r border-gray-200">
                        <button onClick={() => setDetailVeh(v)}
                          className="flex items-center gap-1.5 hover:underline decoration-dotted underline-offset-2"
                          title="ดูสถิติการใช้งาน">
                          <span className="font-semibold text-gray-800 text-sm">{v.name}</span>
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">{ASSET_KIND_LABEL[v.asset_kind ?? 'vehicle']}</span>
                          {v.is_pool && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600">ส่วนกลาง</span>}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-gray-600 text-xs border-r border-gray-200 whitespace-nowrap">{assetIdentifier(v)}</td>
                      <td className="px-4 py-2.5 text-gray-600 text-xs border-r border-gray-200">{typeOptions.find(t => t.value === v.vehicle_type)?.label ?? v.vehicle_type}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs border-r border-gray-200">{v.departments?.name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs border-r border-gray-200">{FUEL_LABEL[v.fuel_type] ?? v.fuel_type}</td>
                      <td className="px-4 py-2.5 text-center border-r border-gray-200">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: STATUS_CLR[v.status] + '18', color: STATUS_CLR[v.status] }}>
                          {STATUS_TH[v.status]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center border-r border-gray-200">
                        {expiries.length > 0 ? (
                          <span className="flex items-center justify-center gap-0.5 text-[10px] font-bold text-red-500">
                            <AlertTriangle size={10} /> {expiries.length} รายการ
                          </span>
                        ) : <span className="text-[10px] text-gray-300">—</span>}
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-2.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => openEdit(v)}
                              className="text-xs font-bold px-3 py-1 rounded border border-blue-600 text-blue-700 hover:bg-blue-600 hover:text-white transition-colors">
                              แก้ไข
                            </button>
                            <button onClick={() => handleDelete(v)}
                              className="text-xs font-bold px-3 py-1 rounded border border-red-400 text-red-500 hover:bg-red-500 hover:text-white transition-colors">
                              ลบ
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
                {!filtered.length && (
                  <tr><td colSpan={isAdmin ? 9 : 8}>
                    <FleetEmptyState icon={Car} title="ไม่พบทรัพย์สิน" hint="ลองปรับตัวกรอง หรือเพิ่มทรัพย์สินใหม่" />
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden grid grid-cols-1 gap-2">
            {filtered.map(v => {
              const expiries = [
                { label:'ประกัน',    days: daysTo(v.insurance_expiry) },
                { label:'พรบ.',      days: daysTo(v.act_expiry) },
                { label:'ทะเบียน',  days: daysTo(v.registration_expiry) },
                { label:'ตรวจสภาพ', days: daysTo(v.inspection_expiry) },
              ].filter(e => e.days !== null && e.days <= 60)

              return (
                <div key={v.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-3">
                  <div className="flex items-start gap-2.5">
                    <button onClick={() => setDetailVeh(v)}
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-xl bg-gray-50 shrink-0"
                      title="ดูสถิติการใช้งาน">
                      {assetEmoji(v)}
                    </button>
                    <button onClick={() => setDetailVeh(v)} className="flex-1 min-w-0 text-left">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h3 className="text-sm font-bold text-gray-800 truncate hover:underline decoration-dotted underline-offset-2">{v.name}</h3>
                        {v.is_pool && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600">
                            ส่วนกลาง
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-500 mt-0.5 truncate">{assetIdentifier(v)} · {FUEL_LABEL[v.fuel_type] ?? v.fuel_type} · มิเตอร์ {meterUnitShort(v)}</p>
                      {v.departments && (
                        <p className="text-[10px] text-gray-400 mt-0.5">{v.departments.name}</p>
                      )}
                    </button>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <span className="text-[10px] font-bold px-2 py-1 rounded-full"
                            style={{ backgroundColor: STATUS_CLR[v.status] + '18', color: STATUS_CLR[v.status] }}>
                        {STATUS_TH[v.status]}
                      </span>
                      {isAdmin && (
                        <>
                          <button onClick={() => openEdit(v)}
                            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => handleDelete(v)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors">
                            <X size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {expiries.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {expiries.map(e => (
                        <span key={e.label}
                              className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                e.days < 0 ? 'bg-red-100 text-red-600'
                                : e.days <= 15 ? 'bg-orange-100 text-orange-600'
                                : 'bg-amber-100 text-amber-600'
                              }`}>
                          <AlertTriangle size={9} />
                          {e.label} {e.days < 0 ? `เกิน ${Math.abs(e.days)} วัน` : `อีก ${e.days} วัน`}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
            {!filtered.length && (
              <FleetEmptyState icon={Car} title="ไม่พบทรัพย์สิน" hint="ลองปรับตัวกรอง หรือเพิ่มทรัพย์สินใหม่" />
            )}
          </div>
        </>
      )}

      {/* Modal Add/Edit */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setModal(null)} />
          <div className="relative bg-white rounded-t-3xl md:rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="shrink-0 bg-white px-4 py-3 md:px-5 md:pt-5 md:pb-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-800">{modal === 'add' ? 'เพิ่มยานพาหนะ/เครื่องยนต์' : 'แก้ไขข้อมูล'}</h3>
              <button onClick={() => setModal(null)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
                <X size={16} />
              </button>
            </div>
            <div className="overflow-y-auto p-4 md:p-5 space-y-3 md:space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">ชื่อ / รหัส *</label>
                  <input value={form.name} onChange={set('name')} placeholder="เช่น รถกระบะ กข-1234" className={inp} />
                </div>
                {form.asset_kind === 'vehicle' && (
                  <div>
                    <label className="text-xs font-semibold text-gray-600 mb-1 block">ทะเบียน *</label>
                    <input value={form.license_plate} onChange={set('license_plate')} placeholder="กข 1234" className={inp} />
                  </div>
                )}
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">
                    รหัสครุภัณฑ์ {form.asset_kind === 'vehicle' ? '(ถ้ามี)' : '*'}
                  </label>
                  <input value={form.asset_code} onChange={set('asset_code')} placeholder="เช่น 420-01-0001" className={inp} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">ประเภท</label>
                  <select value={form.vehicle_type} onChange={set('vehicle_type')} className={sel}>
                    {typeOptions.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">ยี่ห้อ</label>
                  <input value={form.brand} onChange={set('brand')} placeholder="Toyota" className={inp} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">รุ่น</label>
                  <input value={form.model} onChange={set('model')} placeholder="Hilux Revo" className={inp} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">เชื้อเพลิง</label>
                  <select value={form.fuel_type} onChange={set('fuel_type')} className={sel}>
                    {FUEL_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">ความจุถัง (ลิตร)</label>
                  <input type="number" value={form.tank_capacity} onChange={set('tank_capacity')} placeholder="60" className={inp} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">ค่ามิเตอร์เริ่มต้น ({meterUnitShort(form)})</label>
                  <input type="number" value={form.odometer_initial} onChange={set('odometer_initial')} placeholder="0" className={inp} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">หน่วยมิเตอร์</label>
                  <select value={form.meter_unit} onChange={set('meter_unit')} className={sel}>
                    {METER_UNIT_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">กอง/หน่วยงาน</label>
                  <select value={form.department_id} onChange={set('department_id')} className={sel}>
                    <option value="">— ไม่ระบุ —</option>
                    {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">สถานะ</label>
                  <select value={form.status} onChange={set('status')} className={sel}>
                    {Object.entries(STATUS_TH).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="col-span-2 flex items-center gap-2">
                  <input type="checkbox" id="is_pool" checked={form.is_pool} onChange={set('is_pool')}
                    className="w-4 h-4 rounded accent-blue-500" />
                  <label htmlFor="is_pool" className="text-sm text-gray-700">ทรัพย์สินส่วนกลาง (ทุกกองใช้ร่วมกันได้)</label>
                </div>
              </div>

              {isVehicleAsset(form) && <div className="border-t border-gray-100 pt-4 space-y-3">
                <p className="text-xs font-bold text-gray-600">📄 เอกสารสำคัญ</p>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">วันหมดอายุเอกสาร</label>
                  <input type="date"
                    value={form.insurance_expiry}
                    onChange={e => {
                      const v = e.target.value
                      setForm(f => ({ ...f, insurance_expiry: v, act_expiry: v, registration_expiry: v, inspection_expiry: v }))
                    }}
                    className={inp} />
                  <p className="text-[10px] text-gray-400 mt-1">ครอบคลุม: ประกันภัย · พรบ. · ทะเบียน · ตรวจสภาพ</p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">อื่นๆ / หมายเหตุ</label>
                  <input value={form.notes} onChange={set('notes')}
                    placeholder="เช่น ใบอนุญาตพิเศษ, เอกสารเพิ่มเติม..."
                    className={inp} />
                </div>
              </div>}

              <button onClick={handleSave} disabled={saving}
                className="sticky bottom-0 z-10 w-full py-3 rounded-xl font-bold text-white text-sm disabled:opacity-50 shadow-lg"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                {saving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
      {importOpen && (
        <FleetImportModal
          tenant={tenant}
          depts={depts}
          existingAssets={vehicles}
          onClose={() => setImportOpen(false)}
          onImported={items => setVehicles(previous => {
            const merged = new Map(previous.map(item => [item.id, item]))
            items.forEach(item => merged.set(item.id, item))
            return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name, 'th'))
          })}
        />
      )}
      {detailVeh && (
        <FleetVehicleDetail vehicle={detailVeh} tenant={tenant} onClose={() => setDetailVeh(null)} />
      )}
      {typesOpen && (
        <VehicleTypeManagerModal tenant={tenant} types={vehicleTypes} setTypes={setVehicleTypes} onClose={() => setTypesOpen(false)} />
      )}
    </div>
  )
}
