import { useState, useEffect } from 'react'
import { Plus, X, Users, SearchX, Wallet, Car } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import FleetEmptyState from './FleetEmptyState'
import BudgetTab from './FleetBudget'
import { adminUpdateUser } from '../../lib/adminUpdateUser'
import { logAction } from '../../lib/auditLog'

const ROLES = {
  fleet_admin:  'ผู้ดูแลระบบ (เต็มสิทธิ์)',
  fleet_staff:  'เจ้าหน้าที่ (บันทึก/ดูข้อมูลกองตัวเอง)',
  fleet_viewer: 'ผู้ดูรายงาน (อ่านอย่างเดียว)',
}

const DRIVER_STATUS = {
  active:    'ปฏิบัติงาน',
  suspended: 'พักใช้ชั่วคราว',
  inactive:  'ไม่ใช้งาน',
}

// เทียบเป็นสตริงตามเวลาไทย — license_expires_on เป็น date ไม่ใช่ timestamptz
function isLicenseExpired(driver) {
  if (!driver?.license_expires_on) return false
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())
  return driver.license_expires_on < today
}

function Tab({ id, active, label, Icon, onClick }) {
  return (
    <button onClick={() => onClick(id)}
      className={`flex items-center gap-1.5 px-4 py-2 text-sm font-bold rounded-xl transition-colors ${
        active ? 'text-white shadow-sm' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
      }`}
      style={active ? { backgroundColor: 'var(--color-primary)' } : {}}>
      <Icon size={14} />
      {label}
    </button>
  )
}

/* ── สิทธิ์ผู้ใช้ ──────────────────────────────────────── */
function UsersTab({ tenant, depts }) {
  const [users,    setUsers]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(null)
  const [showPick, setShowPick] = useState(false)
  const [allProfiles, setAllProfiles] = useState([])
  const [search, setSearch]     = useState('')
  const [filterRole, setFilterRole] = useState('all')
  const [filterDept, setFilterDept] = useState('all')
  // ทะเบียนพนักงานขับรถ — คีย์ด้วย profile_id เพื่อเช็คสถานะรายแถวได้ในครั้งเดียว
  const [drivers, setDrivers] = useState({})
  const [driverEdit, setDriverEdit] = useState(null)   // { profile, form }

  useEffect(() => {
    if (!tenant?.id) return
    Promise.all([
      supabase.from('profiles').select('id, full_name, email, fleet_role, department_id')
        .eq('municipality_id', tenant.id).not('fleet_role', 'is', null).order('full_name'),
      supabase.from('fleet_drivers')
        .select('id, profile_id, license_no, license_type, license_issued_on, license_expires_on, status, note')
        .eq('municipality_id', tenant.id),
    ]).then(([{ data: profileRows }, { data: driverRows }]) => {
      setUsers(profileRows ?? [])
      setDrivers(Object.fromEntries((driverRows ?? []).map(d => [d.profile_id, d])))
    }).finally(() => setLoading(false))
  }, [tenant?.id])

  // เป็นพนักงานขับรถ = คุณสมบัติ ไม่ใช่ระดับสิทธิ์ จึงเก็บแยกตาราง ไม่ยัดเป็นค่าใน fleet_role
  // (คนขับต้องบันทึกออก-กลับ/เติมน้ำมันได้ด้วย = ต้องมี fleet_staff อยู่แล้ว)
  async function toggleDriver(u) {
    setSaving(u.id + 'driver')
    const existing = drivers[u.id]
    if (existing) {
      const { error } = await supabase.from('fleet_drivers').delete().eq('id', existing.id)
      if (error) { alert('ถอดออกจากทะเบียนไม่สำเร็จ: ' + error.message); setSaving(null); return }
      setDrivers(prev => { const next = { ...prev }; delete next[u.id]; return next })
      logAction({
        action: 'revoke', resourceType: 'fleet_driver', resourceId: u.id,
        resourceLabel: u.full_name ?? u.email ?? u.id, municipalityId: tenant.id,
        metadata: { before: { is_driver: true }, after: { is_driver: false } },
      })
    } else {
      const { data, error } = await supabase.from('fleet_drivers')
        .insert({ municipality_id: tenant.id, profile_id: u.id })
        .select('id, profile_id, license_no, license_type, license_issued_on, license_expires_on, status, note')
        .single()
      if (error) { alert('เพิ่มเข้าทะเบียนไม่สำเร็จ: ' + error.message); setSaving(null); return }
      setDrivers(prev => ({ ...prev, [u.id]: data }))
      logAction({
        action: 'grant', resourceType: 'fleet_driver', resourceId: u.id,
        resourceLabel: u.full_name ?? u.email ?? u.id, municipalityId: tenant.id,
        metadata: { before: { is_driver: false }, after: { is_driver: true } },
      })
    }
    setSaving(null)
  }

  async function saveDriverDetail() {
    const { profile, form } = driverEdit
    const row = drivers[profile.id]
    if (!row) return
    const payload = {
      license_no:         form.license_no.trim() || null,
      license_type:       form.license_type.trim() || null,
      license_issued_on:  form.license_issued_on || null,
      license_expires_on: form.license_expires_on || null,
      status:             form.status,
      note:               form.note.trim() || null,
    }
    if (payload.license_issued_on && payload.license_expires_on
        && payload.license_expires_on < payload.license_issued_on)
      return alert('วันหมดอายุต้องไม่ก่อนวันออกใบขับขี่')
    setSaving(profile.id + 'driver')
    const { error } = await supabase.from('fleet_drivers').update(payload).eq('id', row.id)
    setSaving(null)
    if (error) return alert('บันทึกไม่สำเร็จ: ' + error.message)
    setDrivers(prev => ({ ...prev, [profile.id]: { ...row, ...payload } }))
    // ไม่บันทึกเลขใบขับขี่ลง audit log — เป็นข้อมูลส่วนบุคคล บันทึกแค่ว่ามีการแก้ไข
    logAction({
      action: 'update', resourceType: 'fleet_driver', resourceId: profile.id,
      resourceLabel: profile.full_name ?? profile.email ?? profile.id, municipalityId: tenant.id,
      metadata: { fields: Object.keys(payload).filter(k => k !== 'license_no'), status: payload.status },
    })
    setDriverEdit(null)
  }

  async function openPicker() {
    // ต้องกรอง role ตัด 'citizen' ออก ไม่งั้นจะดึงประชาชนทั่วไปทุกคนที่สมัครไว้มาปนในลิสต์
    // เสี่ยงให้แอดมินกดเพิ่มสิทธิ์ยานพาหนะให้ประชาชนโดยไม่ตั้งใจ
    const { data } = await supabase.from('profiles').select('id, full_name, email')
      .eq('municipality_id', tenant.id).is('fleet_role', null).neq('role', 'citizen').order('full_name')
    setAllProfiles(data ?? [])
    setSearch('')
    setShowPick(true)
  }

  async function addUser(profile) {
    // fleet_role/department_id เป็นฟิลด์ privileged แก้ตรงผ่าน .update() ไม่ได้แล้ว
    // (ตั้งแต่ trg_guard_profile_privileged_update) ต้องผ่าน RPC admin_update_user เท่านั้น
    const { error } = await adminUpdateUser(profile.id, { fleet_role: 'fleet_staff' })
    if (!error) {
      const added = { ...profile, fleet_role: 'fleet_staff', department_id: null }
      setUsers(prev => [...prev, added].sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? '', 'th')))
      // การให้สิทธิ์ใช้รถราชการคือการมอบอำนาจ ต้องรู้ว่าใครให้ใครเมื่อไร
      // (admin_update_user ไม่ได้เขียน audit log ฝั่ง DB — ตรวจแล้ว)
      logAction({
        action: 'grant', resourceType: 'fleet_user', resourceId: profile.id,
        resourceLabel: profile.full_name ?? profile.email ?? profile.id,
        municipalityId: tenant.id,
        metadata: { before: { fleet_role: null }, after: { fleet_role: 'fleet_staff' } },
      })
      setAllProfiles(prev => prev.filter(p => p.id !== profile.id))
    } else {
      alert('เพิ่มผู้ใช้ไม่สำเร็จ: ' + error.message)
    }
  }

  async function removeUser(user) {
    if (!confirm(`ยืนยันลบ "${user.full_name}" ออกจากระบบยานพาหนะ?`)) return
    setSaving(user.id)
    const { error } = await adminUpdateUser(user.id, { fleet_role: null, department_id: null })
    if (!error) {
      // ถอดออกจากระบบยานพาหนะแล้วต้องหลุดจากทะเบียนคนขับด้วย ไม่งั้นชื่อยังค้างใน dropdown
      // ทั้งที่คนนั้นไม่มีสิทธิ์แตะระบบแล้ว (fleet_role = null ไม่ได้ลบแถว fleet_drivers ให้)
      if (drivers[user.id]) {
        await supabase.from('fleet_drivers').delete().eq('id', drivers[user.id].id)
        setDrivers(prev => { const next = { ...prev }; delete next[user.id]; return next })
      }
      setUsers(prev => prev.filter(u => u.id !== user.id))
      logAction({
        action: 'revoke', resourceType: 'fleet_user', resourceId: user.id,
        resourceLabel: user.full_name ?? user.email ?? user.id,
        municipalityId: tenant.id,
        metadata: { before: { fleet_role: user.fleet_role, department_id: user.department_id },
                    after: { fleet_role: null, department_id: null } },
      })
    } else {
      alert('ลบไม่สำเร็จ: ' + error.message)
    }
    setSaving(null)
  }

  async function update(id, field, value) {
    setSaving(id + field)
    const target = users.find(u => u.id === id)
    const { error } = await adminUpdateUser(id, { [field]: value || null })
    if (!error) {
      setUsers(prev => prev.map(u => u.id === id ? { ...u, [field]: value || null } : u))
      // ลดสิทธิ์เป็นผู้ดูรายงาน = อ่านอย่างเดียว บันทึกออก-กลับไม่ได้ จึงเป็นคนขับต่อไม่ได้
      // ถ้าปล่อยแถวไว้ ชื่อจะยังขึ้นใน dropdown แล้วผู้ขอจะเลือกคนที่กดอะไรไม่ได้เลย
      if (field === 'fleet_role' && value === 'fleet_viewer' && drivers[id]) {
        await supabase.from('fleet_drivers').delete().eq('id', drivers[id].id)
        setDrivers(prev => { const next = { ...prev }; delete next[id]; return next })
        logAction({
          action: 'revoke', resourceType: 'fleet_driver', resourceId: id,
          resourceLabel: target?.full_name ?? target?.email ?? id, municipalityId: tenant.id,
          metadata: { reason: 'downgraded_to_fleet_viewer' },
        })
      }
      logAction({
        action: 'update', resourceType: 'fleet_user', resourceId: id,
        resourceLabel: target?.full_name ?? target?.email ?? id,
        municipalityId: tenant.id,
        metadata: { field, before: target?.[field] ?? null, after: value || null },
      })
    } else {
      alert('บันทึกไม่สำเร็จ: ' + error.message)
    }
    setSaving(null)
  }

  const filtered = allProfiles.filter(p =>
    !search || (p.full_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (p.email ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const visibleUsers = users.filter(u => {
    if (filterRole !== 'all' && u.fleet_role !== filterRole) return false
    if (filterDept !== 'all') {
      if (filterDept === 'none' && u.department_id) return false
      if (filterDept !== 'none' && u.department_id !== filterDept) return false
    }
    return true
  })

  if (loading) return <div className="flex justify-center py-8"><div className="w-5 h-5 border-4 border-gray-200 rounded-full animate-spin" style={{ borderTopColor: 'var(--color-primary)' }} /></div>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">ผู้ใช้ที่มีสิทธิ์เข้าระบบยานพาหนะ {users.length} คน</p>
        <button onClick={openPicker}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white"
          style={{ backgroundColor: 'var(--color-primary)' }}>
          <Plus size={13} /> เพิ่มผู้ใช้
        </button>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
          className="text-xs border border-gray-200 rounded-xl px-3 py-2 bg-white text-gray-700 focus:outline-none appearance-none">
          <option value="all">ทุกสิทธิ์ ({users.length})</option>
          {Object.entries(ROLES).map(([k, v]) => {
            const cnt = users.filter(u => u.fleet_role === k).length
            return <option key={k} value={k}>{v.split(' ')[0]} ({cnt})</option>
          })}
        </select>
        <select value={filterDept} onChange={e => setFilterDept(e.target.value)}
          className="text-xs border border-gray-200 rounded-xl px-3 py-2 bg-white text-gray-700 focus:outline-none appearance-none">
          <option value="all">ทุกกอง ({users.length})</option>
          <option value="none">ไม่ระบุกอง ({users.filter(u => !u.department_id).length})</option>
          {depts.map(d => {
            const cnt = users.filter(u => u.department_id === d.id).length
            return <option key={d.id} value={d.id}>{d.name} ({cnt})</option>
          })}
        </select>
        {(filterRole !== 'all' || filterDept !== 'all') && (
          <button onClick={() => { setFilterRole('all'); setFilterDept('all') }}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 px-2 py-2 rounded-xl hover:bg-gray-100 transition-colors">
            <X size={12} /> ล้าง
          </button>
        )}
      </div>

      {users.length === 0 && (
        <FleetEmptyState icon={Users} title="ยังไม่มีผู้ใช้" hint={<>กด <strong className="text-gray-500">เพิ่มผู้ใช้</strong> เพื่อเริ่มต้น</>} />
      )}
      {users.length > 0 && visibleUsers.length === 0 && (
        <FleetEmptyState icon={SearchX} title="ไม่มีผู้ใช้ตามเงื่อนไขที่เลือก" />
      )}

      <div className="space-y-2">
        {visibleUsers.map(u => (
          <div key={u.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-sm font-bold shrink-0">
                {u.full_name?.[0] ?? '?'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800 truncate">{u.full_name ?? '(ไม่มีชื่อ)'}</p>
                <p className="text-[10px] text-gray-400 truncate">{u.email ?? '—'}</p>
              </div>
              <button onClick={() => removeUser(u)} disabled={saving === u.id} title="ลบออกจากระบบยานพาหนะ"
                className="p-1.5 rounded-lg border border-gray-200 hover:bg-red-50 hover:border-red-200 text-gray-400 hover:text-red-500 transition-colors shrink-0 disabled:opacity-50">
                {saving === u.id
                  ? <div className="w-3.5 h-3.5 border-2 border-red-300 border-t-transparent rounded-full animate-spin" />
                  : <X size={14} />}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-semibold text-gray-500 mb-1 block">สิทธิ์</label>
                <select value={u.fleet_role ?? ''} onChange={e => update(u.id, 'fleet_role', e.target.value)}
                  disabled={saving === u.id + 'fleet_role'}
                  className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-lg bg-white text-gray-900 focus:outline-none appearance-none disabled:opacity-60">
                  {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-gray-500 mb-1 block">กอง</label>
                <select value={u.department_id ?? ''} onChange={e => update(u.id, 'department_id', e.target.value)}
                  disabled={saving === u.id + 'department_id'}
                  className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-lg bg-white text-gray-900 focus:outline-none appearance-none disabled:opacity-60">
                  <option value="">— ไม่ระบุ —</option>
                  {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>

            {/* พนักงานขับรถ = คุณสมบัติ คนละแกนกับ "สิทธิ์" ด้านบน
                ผู้ดูรายงานอ่านอย่างเดียว บันทึกออก-กลับไม่ได้ จึงเป็นคนขับไม่ได้ */}
            <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                <input type="checkbox" checked={!!drivers[u.id]}
                  onChange={() => toggleDriver(u)}
                  disabled={saving === u.id + 'driver' || u.fleet_role === 'fleet_viewer'}
                  className="w-4 h-4 rounded border-gray-300 disabled:opacity-40" />
                <span className={u.fleet_role === 'fleet_viewer' ? 'text-gray-300' : 'font-semibold'}>
                  พนักงานขับรถ
                </span>
                {drivers[u.id]?.status && drivers[u.id].status !== 'active' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 font-semibold">
                    {drivers[u.id].status === 'suspended' ? 'พักใช้' : 'ไม่ใช้งาน'}
                  </span>
                )}
                {isLicenseExpired(drivers[u.id]) && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 font-semibold">
                    ใบขับขี่หมดอายุ
                  </span>
                )}
              </label>
              {drivers[u.id] && (
                <button
                  onClick={() => setDriverEdit({
                    profile: u,
                    form: {
                      license_no:         drivers[u.id].license_no ?? '',
                      license_type:       drivers[u.id].license_type ?? '',
                      license_issued_on:  drivers[u.id].license_issued_on ?? '',
                      license_expires_on: drivers[u.id].license_expires_on ?? '',
                      status:             drivers[u.id].status ?? 'active',
                      note:               drivers[u.id].note ?? '',
                    },
                  })}
                  className="text-[11px] font-semibold text-gray-500 hover:text-gray-700 underline shrink-0">
                  ใบขับขี่
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* รายละเอียดใบขับขี่ — ⚠️ PDPA: เลขใบขับขี่เห็นได้เฉพาะผู้ดูแลระบบยานพาหนะ
          (RLS ของ fleet_drivers อนุญาตเฉพาะ fleet_is_manager ส่วน dropdown ฝั่งเจ้าหน้าที่
          อ่านผ่าน view fleet_drivers_directory ที่ไม่มีคอลัมน์นี้) */}
      {driverEdit && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDriverEdit(null)} />
          <div className="relative bg-white rounded-t-3xl md:rounded-2xl w-full max-w-sm flex flex-col shadow-2xl">
            <div className="px-5 pt-5 pb-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-800 text-sm truncate">
                ใบขับขี่ — {driverEdit.profile.full_name ?? '(ไม่มีชื่อ)'}
              </h3>
              <button onClick={() => setDriverEdit(null)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16} /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-semibold text-gray-500 mb-1 block">เลขที่ใบขับขี่</label>
                  <input value={driverEdit.form.license_no} maxLength={40}
                    onChange={e => setDriverEdit(s => ({ ...s, form: { ...s.form, license_no: e.target.value } }))}
                    className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-lg text-gray-900 focus:outline-none" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-gray-500 mb-1 block">ชนิด</label>
                  <input value={driverEdit.form.license_type} maxLength={40} placeholder="เช่น ท.2"
                    onChange={e => setDriverEdit(s => ({ ...s, form: { ...s.form, license_type: e.target.value } }))}
                    className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-lg text-gray-900 focus:outline-none" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-gray-500 mb-1 block">วันออกใบ</label>
                  <input type="date" value={driverEdit.form.license_issued_on}
                    onChange={e => setDriverEdit(s => ({ ...s, form: { ...s.form, license_issued_on: e.target.value } }))}
                    className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-lg text-gray-900 focus:outline-none" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-gray-500 mb-1 block">วันหมดอายุ</label>
                  <input type="date" value={driverEdit.form.license_expires_on}
                    onChange={e => setDriverEdit(s => ({ ...s, form: { ...s.form, license_expires_on: e.target.value } }))}
                    className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-lg text-gray-900 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-gray-500 mb-1 block">สถานะ</label>
                <select value={driverEdit.form.status}
                  onChange={e => setDriverEdit(s => ({ ...s, form: { ...s.form, status: e.target.value } }))}
                  className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-lg bg-white text-gray-900 focus:outline-none appearance-none">
                  {Object.entries(DRIVER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <p className="mt-1 text-[10px] text-gray-400">เฉพาะสถานะ &quot;ปฏิบัติงาน&quot; เท่านั้นที่ขึ้นในช่องเลือกผู้ขับรถ</p>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-gray-500 mb-1 block">หมายเหตุ</label>
                <textarea value={driverEdit.form.note} rows={2} maxLength={500}
                  onChange={e => setDriverEdit(s => ({ ...s, form: { ...s.form, note: e.target.value } }))}
                  className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-lg text-gray-900 focus:outline-none" />
              </div>
            </div>
            <div className="px-5 pb-5">
              <button onClick={saveDriverDetail} disabled={saving === driverEdit.profile.id + 'driver'}
                className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                {saving === driverEdit.profile.id + 'driver' ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pick user modal */}
      {showPick && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowPick(false)} />
          <div className="relative bg-white rounded-t-3xl md:rounded-2xl w-full max-w-md max-h-[75vh] flex flex-col shadow-2xl">
            <div className="px-5 pt-5 pb-3 border-b border-gray-100 flex items-center justify-between shrink-0">
              <h3 className="font-bold text-gray-800">เลือกผู้ใช้ที่จะเพิ่ม</h3>
              <button onClick={() => setShowPick(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16} /></button>
            </div>
            <div className="px-5 py-3 shrink-0">
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="ค้นหาชื่อหรืออีเมล..."
                className="w-full px-3 py-2 text-sm text-gray-900 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none" />
            </div>
            <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-1">
              {filtered.length === 0 && (
                <p className="text-center text-sm text-gray-400 py-6">
                  {allProfiles.length === 0 ? 'ผู้ใช้ทุกคนมีสิทธิ์ระบบยานพาหนะแล้ว' : 'ไม่พบผู้ใช้'}
                </p>
              )}
              {filtered.map(p => (
                <button key={p.id} onClick={() => addUser(p)}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-blue-50 transition-colors text-left">
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 text-sm font-bold shrink-0">
                    {p.full_name?.[0] ?? '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{p.full_name ?? '(ไม่มีชื่อ)'}</p>
                    <p className="text-[10px] text-gray-400 truncate">{p.email ?? '—'}</p>
                  </div>
                  <Plus size={14} className="text-blue-400 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Main ──────────────────────────────────────────────── */
export default function FleetSetup({ tenant, depts: initDepts }) {
  const [depts, setDepts] = useState(initDepts ?? [])
  const [activeTab, setActiveTab] = useState('budget')

  useEffect(() => {
    if (initDepts !== undefined || !tenant?.id) return
    supabase.from('departments').select('id, code, name, short_name')
      .eq('municipality_id', tenant.id).eq('is_active', true).order('sort_order')
      .then(({ data }) => setDepts(data ?? []))
  }, [tenant?.id])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5 bg-sky-50 border border-sky-100 rounded-2xl px-4 py-3">
        <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center shrink-0 shadow-sm">
          <Car size={17} style={{ color: 'var(--color-primary)' }} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-800">ตั้งค่าระบบยานพาหนะ</p>
          <p className="text-[11px] text-gray-500">
            งบประมาณและสิทธิ์ผู้ใช้ — จัดการรายชื่อกอง/หน่วยงานได้ที่เมนู "ตั้งค่าระบบ" → "กอง/หน่วยงาน"
            ส่วนประเภทรถ/เครื่องยนต์ย้ายไปจัดการที่ระบบยานพาหนะ แท็บ "รถและเครื่องยนต์" แล้ว (ผู้มีสิทธิ์ fleet_admin เพิ่มเองได้เลย)
          </p>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        <Tab id="budget" active={activeTab === 'budget'} label="งบประมาณ"    Icon={Wallet} onClick={setActiveTab} />
        <Tab id="users"  active={activeTab === 'users'}  label="สิทธิ์ผู้ใช้"  Icon={Users}  onClick={setActiveTab} />
      </div>

      {activeTab === 'budget' && <BudgetTab tenant={tenant} depts={depts} />}
      {activeTab === 'users'  && <UsersTab  tenant={tenant} depts={depts} />}
    </div>
  )
}
