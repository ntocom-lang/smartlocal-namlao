import { useState, useEffect } from 'react'
import { Plus, X, Car, Pencil, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const TYPES  = ['car','pickup','truck','van','excavator','backhoe','pump','generator','motorcycle','other']
const TYPE_TH = { car:'รถยนต์', pickup:'รถกระบะ', truck:'รถบรรทุก', van:'รถตู้', excavator:'รถขุด',
                  backhoe:'แบคโฮ', pump:'เครื่องสูบน้ำ', generator:'เครื่องยนต์', motorcycle:'มอเตอร์ไซค์', other:'อื่นๆ' }
const FUELS  = ['diesel','gasoline','gas_lpg','electric','other']
const FUEL_TH = { diesel:'ดีเซล', gasoline:'เบนซิน', gas_lpg:'แก๊ส LPG', electric:'ไฟฟ้า', other:'อื่นๆ' }
const STATUS_TH = { active:'ใช้งานได้', inactive:'ปลดประจำการ', under_repair:'กำลังซ่อม', retired:'ปลดระวาง' }
const STATUS_CLR = { active:'#10b981', inactive:'#9ca3af', under_repair:'#f59e0b', retired:'#6b7280' }

const inp = 'w-full px-3 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent'
const sel = inp + ' appearance-none'

const EMPTY = {
  name:'', license_plate:'', vehicle_type:'car', brand:'', model:'', manufacture_year:'',
  fuel_type:'diesel', tank_capacity:'', odometer_initial:'', is_pool:false, status:'active',
  department_id:'', notes:'',
  insurance_expiry:'', act_expiry:'', registration_expiry:'', inspection_expiry:'',
}

function daysTo(dateStr) {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000)
}

export default function FleetVehicles({ tenant, depts, isAdmin }) {
  const [vehicles, setVehicles] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [modal,    setModal]    = useState(null) // null | 'add' | vehicle obj
  const [form,     setForm]     = useState(EMPTY)
  const [saving,   setSaving]   = useState(false)
  const [filterDept, setFilterDept] = useState('all')
  const [filterStatus, setFilterStatus] = useState('active')

  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('fleet_vehicles').select('*, fleet_departments(name,short_name)')
      .eq('municipality_id', tenant.id).order('name')
      .then(({ data }) => setVehicles(data ?? []))
      .finally(() => setLoading(false))
  }, [tenant?.id])

  function openAdd() { setForm({ ...EMPTY, department_id: depts[0]?.id ?? '' }); setModal('add') }
  function openEdit(v) {
    setForm({
      name: v.name, license_plate: v.license_plate, vehicle_type: v.vehicle_type,
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
    if (!form.name || !form.license_plate) return alert('กรุณากรอกชื่อและทะเบียน')
    setSaving(true)
    const payload = {
      ...form,
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
        .select('*, fleet_departments(name,short_name)').single()
      if (!error) setVehicles(prev => [...prev, data].sort((a,b) => a.name.localeCompare(b.name, 'th')))
      else alert(error.message)
    } else {
      const { data, error } = await supabase.from('fleet_vehicles').update(payload)
        .eq('id', modal.id).select('*, fleet_departments(name,short_name)').single()
      if (!error) setVehicles(prev => prev.map(v => v.id === modal.id ? data : v))
      else alert(error.message)
    }
    setSaving(false)
    setModal(null)
  }

  const filtered = vehicles.filter(v => {
    if (filterDept !== 'all' && v.department_id !== filterDept && !(filterDept === 'pool' && v.is_pool)) return false
    if (filterStatus !== 'all' && v.status !== filterStatus) return false
    return true
  })

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <select value={filterDept} onChange={e => setFilterDept(e.target.value)}
          className="text-xs border border-gray-200 rounded-xl px-3 py-2 bg-white text-gray-700 focus:outline-none">
          <option value="all">ทุกกอง</option>
          <option value="pool">รถกลาง</option>
          {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="text-xs border border-gray-200 rounded-xl px-3 py-2 bg-white text-gray-700 focus:outline-none">
          <option value="all">ทุกสถานะ</option>
          {Object.entries(STATUS_TH).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {isAdmin && (
          <button onClick={openAdd}
            className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            <Plus size={15} /> เพิ่มยานพาหนะ
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-4 border-gray-200 rounded-full animate-spin"
               style={{ borderTopColor: 'var(--color-primary)' }} />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map(v => {
            const expiries = [
              { label:'ประกัน', days: daysTo(v.insurance_expiry) },
              { label:'พรบ.',   days: daysTo(v.act_expiry) },
              { label:'ทะเบียน',days: daysTo(v.registration_expiry) },
              { label:'ตรวจสภาพ',days: daysTo(v.inspection_expiry) },
            ].filter(e => e.days !== null && e.days <= 60)

            return (
              <div key={v.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl bg-gray-50 shrink-0">
                    {v.vehicle_type === 'car'        ? '🚗'
                     : v.vehicle_type === 'pickup'   ? '🛻'
                     : v.vehicle_type === 'truck'    ? '🚚'
                     : v.vehicle_type === 'excavator'? '🚜'
                     : v.vehicle_type === 'pump'     ? '⚙️'
                     : v.vehicle_type === 'motorcycle'? '🏍️'
                     : '🚙'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-bold text-gray-800 truncate">{v.name}</h3>
                      {v.is_pool && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600">
                          รถกลาง
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{v.license_plate} · {FUEL_TH[v.fuel_type]}</p>
                    {v.fleet_departments && (
                      <p className="text-[10px] text-gray-400 mt-0.5">{v.fleet_departments.name}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-bold px-2 py-1 rounded-full"
                          style={{ backgroundColor: STATUS_CLR[v.status] + '18', color: STATUS_CLR[v.status] }}>
                      {STATUS_TH[v.status]}
                    </span>
                    {isAdmin && (
                      <button onClick={() => openEdit(v)}
                              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
                        <Pencil size={13} />
                      </button>
                    )}
                  </div>
                </div>

                {expiries.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
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
            <div className="col-span-2 text-center py-12 text-gray-400 text-sm">ไม่พบยานพาหนะ</div>
          )}
        </div>
      )}

      {/* Modal Add/Edit */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setModal(null)} />
          <div className="relative bg-white rounded-t-3xl md:rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-white px-5 pt-5 pb-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-800">{modal === 'add' ? 'เพิ่มยานพาหนะ' : 'แก้ไขข้อมูล'}</h3>
              <button onClick={() => setModal(null)} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">ชื่อ / รหัส *</label>
                  <input value={form.name} onChange={set('name')} placeholder="เช่น รถกระบะ กข-1234" className={inp} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">ทะเบียน *</label>
                  <input value={form.license_plate} onChange={set('license_plate')} placeholder="กข 1234" className={inp} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">ประเภท</label>
                  <select value={form.vehicle_type} onChange={set('vehicle_type')} className={sel}>
                    {TYPES.map(t => <option key={t} value={t}>{TYPE_TH[t]}</option>)}
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
                    {FUELS.map(f => <option key={f} value={f}>{FUEL_TH[f]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">ความจุถัง (ลิตร)</label>
                  <input type="number" value={form.tank_capacity} onChange={set('tank_capacity')} placeholder="60" className={inp} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">เลขไมล์เริ่มต้น (กม.)</label>
                  <input type="number" value={form.odometer_initial} onChange={set('odometer_initial')} placeholder="0" className={inp} />
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
                  <label htmlFor="is_pool" className="text-sm text-gray-700">รถกลาง (ทุกกองใช้ร่วมกันได้)</label>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-bold text-gray-600 mb-3">📄 เอกสารสำคัญ</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label:'ประกันภัยหมดอายุ', key:'insurance_expiry' },
                    { label:'พรบ. หมดอายุ',     key:'act_expiry' },
                    { label:'ทะเบียนหมดอายุ',   key:'registration_expiry' },
                    { label:'ตรวจสภาพหมดอายุ', key:'inspection_expiry' },
                  ].map(({ label, key }) => (
                    <div key={key}>
                      <label className="text-xs font-semibold text-gray-600 mb-1 block">{label}</label>
                      <input type="date" value={form[key]} onChange={set(key)} className={inp} />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">หมายเหตุ</label>
                <textarea value={form.notes} onChange={set('notes')} rows={2} className={inp} />
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
