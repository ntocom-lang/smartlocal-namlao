import { useState, useEffect } from 'react'
import { Plus, X, Pencil, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const inp = 'w-full px-3 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent'

const ROLES = {
  fleet_admin:  'ผู้ดูแลระบบ (เต็มสิทธิ์)',
  fleet_staff:  'เจ้าหน้าที่ (บันทึก/ดูข้อมูลกองตัวเอง)',
  fleet_viewer: 'ผู้ดูรายงาน (อ่านอย่างเดียว)',
}

const MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
                 'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']

function Tab({ id, active, label, onClick }) {
  return (
    <button onClick={() => onClick(id)}
      className={`px-4 py-2 text-sm font-bold rounded-xl transition-colors ${
        active ? 'text-white' : 'bg-gray-100 text-gray-500'
      }`}
      style={active ? { backgroundColor: 'var(--color-primary)' } : {}}>
      {label}
    </button>
  )
}

/* ── กอง/หน่วยงาน ─────────────────────────────────────── */
function DeptTab({ tenant, depts, setDepts }) {
  const [form, setForm]     = useState({ name: '', short_name: '' })
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(null)

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  async function handleSave() {
    if (!form.name.trim()) return alert('กรุณากรอกชื่อกอง')
    setSaving(true)
    if (editId) {
      const { data, error } = await supabase.from('fleet_departments')
        .update({ name: form.name.trim(), short_name: form.short_name.trim() || null })
        .eq('id', editId).select().single()
      if (!error) {
        setDepts(prev => prev.map(d => d.id === editId ? data : d))
        cancelEdit()
      } else {
        alert('บันทึกไม่สำเร็จ: ' + error.message)
      }
    } else {
      const code = 'dept_' + Date.now().toString(36)
      const { data, error } = await supabase.from('fleet_departments').insert({
        municipality_id: tenant.id, name: form.name.trim(),
        short_name: form.short_name.trim() || null, code,
        sort_order: depts.length,
      }).select().single()
      if (!error) {
        setDepts(prev => [...prev, data])
        setForm({ name: '', short_name: '' })
      } else {
        alert('เพิ่มไม่สำเร็จ: ' + error.message)
      }
    }
    setSaving(false)
  }

  async function handleDelete(d) {
    if (!confirm(`ลบกอง "${d.name}"?\n\nยานพาหนะที่ผูกกับกองนี้จะยังคงอยู่ แต่ไม่มีกองกำกับ`)) return
    setDeleting(d.id)
    const { error } = await supabase.from('fleet_departments').delete().eq('id', d.id)
    if (!error) {
      setDepts(prev => prev.filter(x => x.id !== d.id))
      if (editId === d.id) cancelEdit()
    } else {
      alert('ลบไม่สำเร็จ: ' + error.message)
    }
    setDeleting(null)
  }

  function startEdit(d) {
    setEditId(d.id)
    setForm({ name: d.name, short_name: d.short_name ?? '' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditId(null)
    setForm({ name: '', short_name: '' })
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <p className="text-sm font-bold text-gray-700">{editId ? 'แก้ไขกอง' : 'เพิ่มกอง/หน่วยงาน'}</p>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="text-xs font-semibold text-gray-600 mb-1 block">ชื่อกอง *</label>
            <input value={form.name} onChange={set('name')} placeholder="กองช่าง" className={inp}
              onKeyDown={e => e.key === 'Enter' && handleSave()} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">ชื่อย่อ</label>
            <input value={form.short_name} onChange={set('short_name')} placeholder="กช." className={inp}
              onKeyDown={e => e.key === 'Enter' && handleSave()} />
          </div>
        </div>
        <div className="flex gap-2">
          {editId && (
            <button onClick={cancelEdit}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 text-gray-600">
              ยกเลิก
            </button>
          )}
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            {saving ? 'กำลังบันทึก...' : editId ? 'อัปเดต' : 'เพิ่มกอง'}
          </button>
        </div>
      </div>

      {depts.length === 0 && (
        <p className="text-center text-sm text-gray-400 py-6">ยังไม่มีกอง กรอกชื่อกองด้านบนแล้วกด "เพิ่มกอง"</p>
      )}

      <div className="space-y-2">
        {depts.map(d => (
          <div key={d.id} className={`flex items-center justify-between bg-white rounded-xl border px-4 py-3 transition-colors ${
            editId === d.id ? 'border-blue-300 bg-blue-50/40' : 'border-gray-100'
          }`}>
            <div>
              <p className="text-sm font-semibold text-gray-800">{d.name}</p>
              {(d.short_name || d.code) && (
                <p className="text-[10px] text-gray-400">{d.short_name ? `${d.short_name} · ` : ''}{d.code}</p>
              )}
            </div>
            <div className="flex gap-1">
              <button onClick={() => startEdit(d)} disabled={!!deleting}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
                <Pencil size={13} />
              </button>
              <button onClick={() => handleDelete(d)} disabled={!!deleting}
                className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors">
                {deleting === d.id
                  ? <div className="w-3 h-3 border-2 border-red-300 border-t-transparent rounded-full animate-spin" />
                  : <X size={13} />}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── งบประมาณ ──────────────────────────────────────────── */
function BudgetTab({ tenant, depts }) {
  const year  = new Date().getFullYear() + 543
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
    <p className="text-center text-sm text-gray-400 py-10">ยังไม่มีกอง ตั้งค่ากอง/หน่วยงานก่อน</p>
  )

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">งบประมาณน้ำมันต่อกอง ปีงบประมาณ {year} (บาท/เดือน)</p>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-xs min-w-[600px]">
          <thead>
            <tr className="text-gray-400 border-b border-gray-100">
              <th className="text-left py-2 px-2 font-semibold">กอง</th>
              {MONTHS.map((m, i) => <th key={i} className="text-center py-2 px-1 font-semibold">{m}</th>)}
            </tr>
          </thead>
          <tbody>
            {depts.map(d => (
              <tr key={d.id} className="border-b border-gray-50">
                <td className="py-2 px-2 font-semibold text-gray-700 whitespace-nowrap">{d.short_name || d.name}</td>
                {MONTHS.map((_, i) => {
                  const m = i + 1
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
    supabase.from('profiles').select('id, full_name, email, fleet_role, fleet_department_id')
      .eq('municipality_id', tenant.id).not('fleet_role', 'is', null).order('full_name')
      .then(({ data }) => setUsers(data ?? []))
      .finally(() => setLoading(false))
  }, [tenant?.id])

  async function openPicker() {
    const { data } = await supabase.from('profiles').select('id, full_name, email')
      .eq('municipality_id', tenant.id).is('fleet_role', null).order('full_name')
    setAllProfiles(data ?? [])
    setSearch('')
    setShowPick(true)
  }

  async function addUser(profile) {
    const { data, error } = await supabase.from('profiles')
      .update({ fleet_role: 'fleet_staff' }).eq('id', profile.id)
      .select('id, full_name, email, fleet_role, fleet_department_id').single()
    if (!error) {
      setUsers(prev => [...prev, data].sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? '', 'th')))
      setAllProfiles(prev => prev.filter(p => p.id !== profile.id))
    } else {
      alert('เพิ่มผู้ใช้ไม่สำเร็จ: ' + error.message)
    }
  }

  async function removeUser(user) {
    if (!confirm(`ยืนยันลบ "${user.full_name}" ออกจากระบบยานพาหนะ?`)) return
    setSaving(user.id)
    const { error } = await supabase.from('profiles')
      .update({ fleet_role: null, fleet_department_id: null }).eq('id', user.id)
    if (!error) {
      setUsers(prev => prev.filter(u => u.id !== user.id))
    } else {
      alert('ลบไม่สำเร็จ: ' + error.message)
    }
    setSaving(null)
  }

  async function update(id, field, value) {
    setSaving(id + field)
    const { error } = await supabase.from('profiles').update({ [field]: value || null }).eq('id', id)
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
      if (filterDept === 'none' && u.fleet_department_id) return false
      if (filterDept !== 'none' && u.fleet_department_id !== filterDept) return false
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
          <option value="none">ไม่ระบุกอง ({users.filter(u => !u.fleet_department_id).length})</option>
          {depts.map(d => {
            const cnt = users.filter(u => u.fleet_department_id === d.id).length
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
        <div className="text-center py-10 text-gray-400 text-sm">ยังไม่มีผู้ใช้ กด "เพิ่มผู้ใช้" เพื่อเริ่มต้น</div>
      )}
      {users.length > 0 && visibleUsers.length === 0 && (
        <div className="text-center py-6 text-gray-400 text-sm">ไม่มีผู้ใช้ตามเงื่อนไขที่เลือก</div>
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
              <button onClick={() => removeUser(u)} disabled={saving === u.id}
                className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors shrink-0">
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
                <select value={u.fleet_department_id ?? ''} onChange={e => update(u.id, 'fleet_department_id', e.target.value)}
                  disabled={saving === u.id + 'fleet_department_id'}
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
              <button onClick={() => setShowPick(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={16} /></button>
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

/* ── ประเภทยานพาหนะ ────────────────────────────────────── */
const DEFAULT_TYPES = [
  { value: 'car', label: 'รถยนต์' }, { value: 'pickup', label: 'รถกระบะ' },
  { value: 'truck', label: 'รถบรรทุก' }, { value: 'van', label: 'รถตู้' },
  { value: 'excavator', label: 'รถขุด' }, { value: 'backhoe', label: 'แบคโฮ' },
  { value: 'pump', label: 'เครื่องสูบน้ำ' }, { value: 'generator', label: 'เครื่องยนต์' },
  { value: 'motorcycle', label: 'มอเตอร์ไซค์' }, { value: 'other', label: 'อื่นๆ' },
]

function VehicleTypesTab({ tenant }) {
  const [types,   setTypes]   = useState([])
  const [loading, setLoading] = useState(true)
  const [form,    setForm]    = useState({ label: '' })
  const [saving,  setSaving]  = useState(false)
  const [editId,  setEditId]  = useState(null)

  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('fleet_vehicle_types').select('*')
      .eq('municipality_id', tenant.id).order('sort_order')
      .then(({ data }) => setTypes(data ?? []))
      .finally(() => setLoading(false))
  }, [tenant?.id])

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
    const rows = DEFAULT_TYPES.map((t, i) => ({
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

  if (loading) return <div className="flex justify-center py-8"><div className="w-5 h-5 border-4 border-gray-200 rounded-full animate-spin" style={{ borderTopColor: 'var(--color-primary)' }} /></div>

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <p className="text-sm font-bold text-gray-700">{editId ? 'แก้ไขประเภท' : 'เพิ่มประเภทยานพาหนะ'}</p>
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">ชื่อประเภท *</label>
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
              className="px-4 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              {types.length === 0 ? '+ ค่าเริ่มต้น' : '+ มาตรฐาน'}
            </button>
          )}
        </div>
      </div>

      {types.length === 0 && (
        <p className="text-center text-sm text-gray-400 py-6">ยังไม่มีประเภท กด "+ ค่าเริ่มต้น" เพื่อเพิ่มทั้งหมด</p>
      )}

      <div className="space-y-2">
        {types.map(t => (
          <div key={t.id} className={`flex items-center justify-between bg-white rounded-xl border px-4 py-3 transition-colors ${
            editId === t.id ? 'border-blue-300 bg-blue-50/40' : 'border-gray-100'
          }`}>
            <p className="text-sm font-semibold text-gray-800">{t.label}</p>
            <div className="flex gap-1">
              <button onClick={() => { setEditId(t.id); setForm({ label: t.label }) }}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><Pencil size={13} /></button>
              <button onClick={() => handleDelete(t.id)}
                className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400"><X size={13} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Main ──────────────────────────────────────────────── */
export default function FleetSetup({ tenant, depts: initDepts, setDepts: setParentDepts }) {
  const [depts, setDepts] = useState(initDepts ?? [])
  const [activeTab, setActiveTab] = useState('dept')

  useEffect(() => {
    if (initDepts !== undefined || !tenant?.id) return
    supabase.from('fleet_departments').select('id, code, name, short_name')
      .eq('municipality_id', tenant.id).eq('is_active', true).order('sort_order')
      .then(({ data }) => setDepts(data ?? []))
  }, [tenant?.id])

  function updateDepts(fn) {
    setDepts(fn)
    if (setParentDepts) setParentDepts(fn)
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <Tab id="dept"   active={activeTab === 'dept'}   label="กอง/หน่วยงาน" onClick={setActiveTab} />
        <Tab id="budget" active={activeTab === 'budget'} label="งบประมาณ"     onClick={setActiveTab} />
        <Tab id="types"  active={activeTab === 'types'}  label="ประเภทรถ"      onClick={setActiveTab} />
        <Tab id="users"  active={activeTab === 'users'}  label="สิทธิ์ผู้ใช้"   onClick={setActiveTab} />
      </div>

      {activeTab === 'dept'   && <DeptTab        tenant={tenant} depts={depts} setDepts={updateDepts} />}
      {activeTab === 'budget' && <BudgetTab       tenant={tenant} depts={depts} />}
      {activeTab === 'types'  && <VehicleTypesTab tenant={tenant} />}
      {activeTab === 'users'  && <UsersTab        tenant={tenant} depts={depts} />}
    </div>
  )
}
