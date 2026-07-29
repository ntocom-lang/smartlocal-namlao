import { useState, useEffect } from 'react'
import { Briefcase, Plus, Pencil, Trash2, X, Loader2, ChevronDown, ChevronRight, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// ต้องตรงกับ CHECK constraint ใน supabase/migrations (positions_personnel)
const CATEGORIES = [
  { value: 'political_exec',   label: 'ฝ่ายบริหาร (การเมือง)' },
  { value: 'council',          label: 'สภาท้องถิ่น' },
  { value: 'top_admin',        label: 'ผู้บริหารสูงสุดฝ่ายประจำ' },
  { value: 'dept_head',        label: 'หัวหน้าส่วนราชการ/ผู้อำนวยการกอง' },
  { value: 'operating_staff',  label: 'เจ้าหน้าที่ปฏิบัติงาน' },
  { value: 'field_technician', label: 'ช่างเทคนิค/ปฏิบัติการภาคสนาม' },
]
const catLabel = v => CATEGORIES.find(c => c.value === v)?.label ?? v

const ROLE_TH = {
  superadmin: 'Super Admin', admin: 'แอดมินระบบ', officer: 'แอดมินกอง',
  technician: 'ปฏิบัติงาน', staff: 'เจ้าหน้าที่', viewer: 'ผู้บริหาร', council: 'สภาเทศบาล',
}

const EMPTY_FORM = { name: '', category: 'operating_staff', role: 'staff', department_hint: '', sort_order: 0 }
const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200'

export default function PositionsManager({ tenant, currentUserRole }) {
  const [positions, setPositions] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(() => new Set())
  const [editing, setEditing] = useState(null) // null=ปิด, {}=สร้างใหม่, {...position}=แก้ไข
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const isSuperadmin = currentUserRole === 'superadmin'

  function reload() {
    setLoading(true)
    Promise.all([
      supabase.from('positions').select('*').order('sort_order'),
      tenant?.id
        ? supabase.from('profiles').select('id, full_name, avatar_url, position_id').eq('municipality_id', tenant.id)
        : Promise.resolve({ data: [] }),
    ]).then(([{ data: pos }, { data: prof }]) => {
      setPositions(pos ?? [])
      setProfiles(prof ?? [])
      setLoading(false)
    })
  }
  useEffect(reload, [tenant?.id])

  function toggleExpand(id) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function openCreate() { setForm(EMPTY_FORM); setEditing({}) }
  function openEdit(p) {
    setForm({ name: p.name, category: p.category, role: p.role, department_hint: p.department_hint ?? '', sort_order: p.sort_order })
    setEditing(p)
  }

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    const payload = {
      name: form.name.trim(),
      category: form.category,
      role: form.role,
      department_hint: form.department_hint.trim() || null,
      sort_order: Number(form.sort_order) || 0,
    }
    const { error } = editing?.id
      ? await supabase.from('positions').update(payload).eq('id', editing.id)
      : await supabase.from('positions').insert(payload)
    setSaving(false)
    if (error) { alert('บันทึกไม่สำเร็จ: ' + error.message); return }
    setEditing(null)
    reload()
  }

  async function handleDelete(p) {
    if (!window.confirm(`ลบตำแหน่ง "${p.name}" ออกจากตารางกลาง?\n\nบุคลากรที่ผูกตำแหน่งนี้อยู่จะกลายเป็นไม่มีตำแหน่ง (ไม่ถูกลบบัญชี)`)) return
    const { error } = await supabase.from('positions').delete().eq('id', p.id)
    if (error) { alert('ลบไม่สำเร็จ: ' + error.message); return }
    reload()
  }

  if (loading) return <div className="flex justify-center py-16"><Loader2 size={28} className="animate-spin text-gray-200" /></div>

  const grouped = CATEGORIES.map(c => ({
    ...c,
    items: positions.filter(p => p.category === c.value),
  })).filter(g => g.items.length > 0)

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Briefcase size={18} className="text-indigo-500" /> ตำแหน่งและบุคลากร</h1>
          <p className="text-xs text-gray-400 mt-0.5">ตารางตำแหน่งมาตรฐานกลาง ใช้ร่วมกันทุกเทศบาล — รายชื่อที่แสดงคือบุคลากรของเทศบาลนี้เท่านั้น</p>
        </div>
        {isSuperadmin && (
          <button onClick={openCreate}
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-white shadow-sm active:scale-95 transition-all"
            style={{ backgroundColor: '#1e293b' }}>
            <Plus size={14} /> เพิ่มตำแหน่ง
          </button>
        )}
      </div>

      {grouped.map(g => (
        <div key={g.value} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <p className="px-4 pt-3 pb-2 text-[11px] font-bold uppercase tracking-widest text-gray-400">{g.label}</p>
          <div className="divide-y divide-gray-50">
            {g.items.map(p => {
              const holders = profiles.filter(pr => pr.position_id === p.id)
              const isOpen = expanded.has(p.id)
              return (
                <div key={p.id}>
                  <div role="button" tabIndex={0} onClick={() => toggleExpand(p.id)}
                    onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggleExpand(p.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-200">
                    {isOpen ? <ChevronDown size={14} className="text-gray-300 shrink-0" /> : <ChevronRight size={14} className="text-gray-300 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{p.name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600">{ROLE_TH[p.role] ?? p.role}</span>
                        {p.department_hint && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{p.department_hint}</span>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 flex items-center gap-1 text-xs font-bold text-gray-400">
                      <Users size={12} /> {holders.length}
                    </span>
                    {isSuperadmin && (
                      <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                        <button onClick={() => openEdit(p)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => handleDelete(p)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                  {isOpen && (
                    <div className="px-4 pb-3 pl-11">
                      {holders.length === 0 ? (
                        <p className="text-xs text-gray-300 italic">ยังไม่มีใครถือตำแหน่งนี้ในเทศบาลนี้</p>
                      ) : (
                        <div className="space-y-1.5">
                          {holders.map(h => (
                            <div key={h.id} className="flex items-center gap-2 text-xs text-gray-600">
                              {h.avatar_url ? (
                                <img src={h.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover" />
                              ) : (
                                <div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center text-[9px] font-bold text-gray-400">
                                  {(h.full_name || '?')[0]?.toUpperCase()}
                                </div>
                              )}
                              {h.full_name}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {editing !== null && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center">
          <div className="bg-white w-full md:max-w-md md:rounded-3xl rounded-t-3xl max-h-[93vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 shrink-0">
              <button onClick={() => setEditing(null)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500"><X size={18} /></button>
              <p className="font-bold text-gray-800">{editing?.id ? 'แก้ไขตำแหน่ง' : 'เพิ่มตำแหน่งใหม่'}</p>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5">
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">ชื่อตำแหน่ง *</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className={inputCls} placeholder="เช่น ผู้อำนวยการกองสาธารณสุขและสิ่งแวดล้อม" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">ระดับ</label>
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className={inputCls}>
                  {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">บทบาท (role) ที่ควรได้</label>
                <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className={inputCls}>
                  {Object.entries(ROLE_TH).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">กองที่มักสังกัด (ถ้ามี)</label>
                <input type="text" value={form.department_hint} onChange={e => setForm(f => ({ ...f, department_hint: e.target.value }))}
                  className={inputCls} placeholder="เช่น กองช่าง — เว้นว่างได้ถ้าไม่ผูกกองใดกองหนึ่ง" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">ลำดับการแสดงผล</label>
                <input type="number" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} className={inputCls} />
              </div>
            </div>
            <div className="px-4 pb-6 pt-3 border-t border-gray-100 shrink-0">
              <button onClick={handleSave} disabled={saving || !form.name.trim()}
                className="w-full py-3.5 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50 text-sm active:scale-[0.98] transition-all"
                style={{ backgroundColor: '#1e293b' }}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                {editing?.id ? 'บันทึกการแก้ไข' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
