import { useState, useEffect } from 'react'
import { Plus, X, Pencil, Users, Wallet, Building2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const inp = 'w-full px-3 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent'
const sel = inp + ' appearance-none'

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
  const [form, setForm]   = useState({ name: '', short_name: '' })
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  async function handleSave() {
    if (!form.name) return alert('กรุณากรอกชื่อกอง')
    setSaving(true)
    if (editId) {
      const { data, error } = await supabase.from('fleet_departments')
        .update({ name: form.name, short_name: form.short_name || null })
        .eq('id', editId).select().single()
      if (!error) setDepts(prev => prev.map(d => d.id === editId ? data : d))
      else alert(error.message)
    } else {
      const code = 'dept_' + Date.now().toString(36)
      const { data, error } = await supabase.from('fleet_departments').insert({
        municipality_id: tenant.id, name: form.name,
        short_name: form.short_name || null, code,
        sort_order: depts.length,
      }).select().single()
      if (!error) setDepts(prev => [...prev, data])
      else alert(error.message)
    }
    setSaving(false); setEditId(null); setForm({ name: '', short_name: '' })
  }

  function startEdit(d) {
    setEditId(d.id); setForm({ name: d.name, short_name: d.short_name ?? '' })
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <p className="text-sm font-bold text-gray-700">{editId ? 'แก้ไขกอง' : 'เพิ่มกอง/หน่วยงาน'}</p>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="text-xs font-semibold text-gray-600 mb-1 block">ชื่อกอง *</label>
            <input value={form.name} onChange={set('name')} placeholder="กองช่าง" className={inp} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">ชื่อย่อ</label>
            <input value={form.short_name} onChange={set('short_name')} placeholder="กช." className={inp} />
          </div>
        </div>
        <div className="flex gap-2">
          {editId && (
            <button onClick={() => { setEditId(null); setForm({ name: '', short_name: '', code: '' }) }}
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

      <div className="space-y-2">
        {depts.map((d, i) => (
          <div key={d.id} className="flex items-center justify-between bg-white rounded-xl border border-gray-100 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-gray-800">{d.name}</p>
              <p className="text-[10px] text-gray-400">{d.short_name ? `${d.short_name} · ` : ''}{d.code}</p>
            </div>
            <button onClick={() => startEdit(d)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
              <Pencil size={13} />
            </button>
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
    } else {
      const { data, error } = await supabase.from('fleet_budgets').insert({
        municipality_id: tenant.id, department_id: deptId,
        fiscal_year: year, month, budget_amount: amount,
      }).select().single()
      if (!error) setBudgets(prev => [...prev, data])
      else alert(error.message)
    }
    setSaving(false); setEditCell(null); setVal('')
  }

  if (loading) return <div className="flex justify-center py-8"><div className="w-5 h-5 border-4 border-gray-200 rounded-full animate-spin" style={{ borderTopColor: 'var(--color-primary)' }} /></div>

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
                            type="number" className="w-16 px-1 py-1 text-xs text-gray-900 bg-white border border-blue-300 rounded-lg focus:outline-none"
                            onKeyDown={e => { if (e.key === 'Enter') handleSave(d.id, m); if (e.key === 'Escape') setEditCell(null) }} />
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
      <p className="text-[10px] text-gray-400">คลิกที่ช่องเพื่อแก้ไข · Enter เพื่อบันทึก · Esc เพื่อยกเลิก</p>
    </div>
  )
}

/* ── สิทธิ์ผู้ใช้ ──────────────────────────────────────── */
function UsersTab({ tenant, depts }) {
  const [users,   setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(null)

  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('profiles').select('id, full_name, email, fleet_role, fleet_department_id')
      .eq('municipality_id', tenant.id).order('full_name')
      .then(({ data }) => setUsers(data ?? []))
      .finally(() => setLoading(false))
  }, [tenant?.id])

  async function update(id, field, value) {
    setSaving(id + field)
    await supabase.from('profiles').update({ [field]: value || null }).eq('id', id)
    setUsers(prev => prev.map(u => u.id === id ? { ...u, [field]: value || null } : u))
    setSaving(null)
  }

  if (loading) return <div className="flex justify-center py-8"><div className="w-5 h-5 border-4 border-gray-200 rounded-full animate-spin" style={{ borderTopColor: 'var(--color-primary)' }} /></div>

  return (
    <div className="space-y-2">
      {users.map(u => (
        <div key={u.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-sm font-bold">
              {u.full_name?.[0] ?? '?'}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">{u.full_name}</p>
              <p className="text-[10px] text-gray-400">{u.email}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-semibold text-gray-500 mb-1 block">สิทธิ์ระบบยานพาหนะ</label>
              <select value={u.fleet_role ?? ''} onChange={e => update(u.id, 'fleet_role', e.target.value)}
                disabled={saving === u.id + 'fleet_role'}
                className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-lg bg-white text-gray-900 focus:outline-none appearance-none">
                <option value="">— ไม่มีสิทธิ์ —</option>
                {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-gray-500 mb-1 block">กอง</label>
              <select value={u.fleet_department_id ?? ''} onChange={e => update(u.id, 'fleet_department_id', e.target.value)}
                disabled={saving === u.id + 'fleet_department_id'}
                className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-lg bg-white text-gray-900 focus:outline-none appearance-none">
                <option value="">— ไม่ระบุ —</option>
                {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── Main ──────────────────────────────────────────────── */
export default function FleetSetup({ tenant, depts: initDepts, setDepts: setParentDepts }) {
  const [depts, setDepts] = useState(initDepts ?? [])
  const [activeTab, setActiveTab] = useState('dept')

  function updateDepts(fn) {
    setDepts(fn)
    if (setParentDepts) setParentDepts(fn)
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <Tab id="dept"   active={activeTab === 'dept'}   label="กอง/หน่วยงาน" onClick={setActiveTab} />
        <Tab id="budget" active={activeTab === 'budget'} label="งบประมาณ"     onClick={setActiveTab} />
        <Tab id="users"  active={activeTab === 'users'}  label="สิทธิ์ผู้ใช้"   onClick={setActiveTab} />
      </div>

      {activeTab === 'dept'   && <DeptTab   tenant={tenant} depts={depts} setDepts={updateDepts} />}
      {activeTab === 'budget' && <BudgetTab tenant={tenant} depts={depts} />}
      {activeTab === 'users'  && <UsersTab  tenant={tenant} depts={depts} />}
    </div>
  )
}
