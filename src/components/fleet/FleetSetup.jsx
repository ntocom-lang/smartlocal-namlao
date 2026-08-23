import { useState, useEffect } from 'react'
import { Plus, X, Check, Building2, Users, SearchX, Wallet, Car } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import FleetEmptyState from './FleetEmptyState'
import { fiscalYearOf, FISCAL_MONTHS_TH } from '../../lib/fiscalYear'
import { adminUpdateUser } from '../../lib/adminUpdateUser'

const inp = 'w-full px-3 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent'

const ROLES = {
  fleet_admin:  'ผู้ดูแลระบบ (เต็มสิทธิ์)',
  fleet_staff:  'เจ้าหน้าที่ (บันทึก/ดูข้อมูลกองตัวเอง)',
  fleet_viewer: 'ผู้ดูรายงาน (อ่านอย่างเดียว)',
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

/* ── งบประมาณ ──────────────────────────────────────────── */
function BudgetTab({ tenant, depts }) {
  const year  = fiscalYearOf()
  const [budgets,  setBudgets]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [editCell, setEditCell] = useState(null) // { dept_id, month }
  const [val, setVal] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('fleet_budgets').select('*')
      .eq('municipality_id', tenant.id).eq('fiscal_year', year)
      .then(({ data }) => setBudgets(data ?? []))
      .finally(() => setLoading(false))
  }, [tenant?.id])

  function getAmt(deptId, month) {
    return budgets.find(b => b.department_id === deptId && b.month === month)?.budget_amount ?? ''
  }

  async function handleSave(deptId, month) {
    setSaving(true)
    const existing = budgets.find(b => b.department_id === deptId && b.month === month)
    const amount   = parseFloat(val) || 0
    if (existing) {
      const { data, error } = await supabase.from('fleet_budgets')
        .update({ budget_amount: amount }).eq('id', existing.id).select().single()
      if (!error) setBudgets(prev => prev.map(b => b.id === existing.id ? data : b))
      else alert(error.message)
    } else {
      const { data, error } = await supabase.from('fleet_budgets').insert({
        municipality_id: tenant.id, department_id: deptId,
        fiscal_year: year, month, budget_amount: amount,
      }).select().single()
      if (!error) setBudgets(prev => [...prev, data])
      else alert(error.message)
    }
    setSaving(false)
    setEditCell(null)
    setVal('')
  }

  if (loading) return <div className="flex justify-center py-8"><div className="w-5 h-5 border-4 border-gray-200 rounded-full animate-spin" style={{ borderTopColor: 'var(--color-primary)' }} /></div>

  if (depts.length === 0) return (
    <FleetEmptyState icon={Building2} title="ยังไม่มีกอง" hint="ตั้งค่ากอง/หน่วยงานก่อนเริ่มใช้งาน" />
  )

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">งบประมาณน้ำมันต่อกอง ปีงบประมาณ {year} — ต.ค. {year - 544} ถึง ก.ย. {year - 543} (บาท/เดือน)</p>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-xs min-w-150">
          <thead>
            <tr className="text-gray-400 border-b border-gray-100">
              <th className="text-left py-2 px-2 font-semibold">กอง</th>
              {FISCAL_MONTHS_TH.map(({ label }, i) => <th key={i} className="text-center py-2 px-1 font-semibold">{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {depts.map(d => (
              <tr key={d.id} className="border-b border-gray-50">
                <td className="py-2 px-2 font-semibold text-gray-700 whitespace-nowrap">{d.short_name || d.name}</td>
                {FISCAL_MONTHS_TH.map(({ month: m }) => {
                  const isEditing = editCell?.dept_id === d.id && editCell?.month === m
                  const amt = getAmt(d.id, m)
                  return (
                    <td key={m} className="py-1 px-0.5 text-center">
                      {isEditing ? (
                        <div className="flex items-center gap-0.5">
                          <input autoFocus value={val} onChange={e => setVal(e.target.value)}
                            type="number" min="0"
                            className="w-14 px-1 py-1 text-xs text-gray-900 bg-white border border-blue-300 rounded-lg focus:outline-none"
                            onKeyDown={e => { if (e.key === 'Enter') handleSave(d.id, m); if (e.key === 'Escape') { setEditCell(null); setVal('') } }} />
                          <button onClick={() => handleSave(d.id, m)} disabled={saving}
                            className="w-5 h-5 flex items-center justify-center rounded-md bg-blue-500 text-white disabled:opacity-50 shrink-0">
                            <Check size={10} strokeWidth={3} />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => { setEditCell({ dept_id: d.id, month: m }); setVal(amt?.toString() ?? '') }}
                          className="w-full text-center py-1 rounded-lg hover:bg-blue-50 text-gray-600 transition-colors">
                          {amt ? Number(amt).toLocaleString('th-TH') : <span className="text-gray-300">—</span>}
                        </button>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-gray-400">คลิกที่ช่องเพื่อแก้ไข · กด ✓ หรือ Enter เพื่อบันทึก · Esc เพื่อยกเลิก</p>
    </div>
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

  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('profiles').select('id, full_name, email, fleet_role, department_id')
      .eq('municipality_id', tenant.id).not('fleet_role', 'is', null).order('full_name')
      .then(({ data }) => setUsers(data ?? []))
      .finally(() => setLoading(false))
  }, [tenant?.id])

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
      setUsers(prev => prev.filter(u => u.id !== user.id))
    } else {
      alert('ลบไม่สำเร็จ: ' + error.message)
    }
    setSaving(null)
  }

  async function update(id, field, value) {
    setSaving(id + field)
    const { error } = await adminUpdateUser(id, { [field]: value || null })
    if (!error) {
      setUsers(prev => prev.map(u => u.id === id ? { ...u, [field]: value || null } : u))
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
          </div>
        ))}
      </div>

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
