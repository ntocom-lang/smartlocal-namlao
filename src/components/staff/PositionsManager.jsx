import { useState, useEffect, useCallback } from 'react'
import { Briefcase, Plus, Pencil, Trash2, X, Loader2, ChevronDown, ChevronRight, Users, Search, Phone, AlertCircle } from 'lucide-react'
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

const ROLE_TH = {
  superadmin: 'Super Admin', admin: 'แอดมินระบบ', officer: 'ธุรการกอง',
  technician: 'ปฏิบัติงาน', staff: 'เจ้าหน้าที่', viewer: 'ผู้บริหาร', council: 'สภาเทศบาล',
}

const EMPTY_FORM = { name: '', category: 'operating_staff', role: 'staff', department_hint: '', sort_order: 0 }
const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200'

// ใช้ร่วมกันทั้งมุมมองปกติ (ไล่ทีละหมวด) และผลค้นหา (ข้ามหมวด) — กันโค้ด/หน้าตาเพี้ยนกันคนละแบบ
function PositionRow({ p, holders, isOpen, forceOpen, isSuperadmin, deptName, onToggle, onEdit, onDelete }) {
  const open = forceOpen || isOpen
  const isVacant = holders.length === 0
  return (
    <div>
      <div role="button" tabIndex={0} onClick={forceOpen ? undefined : onToggle}
        onKeyDown={forceOpen ? undefined : (e => (e.key === 'Enter' || e.key === ' ') && onToggle())}
        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-200 ${
          forceOpen ? '' : 'hover:bg-gray-50 cursor-pointer'
        }`}>
        {!forceOpen && (open ? <ChevronDown size={14} className="text-gray-300 shrink-0" /> : <ChevronRight size={14} className="text-gray-300 shrink-0" />)}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800 truncate">{p.name}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600">{ROLE_TH[p.role] ?? p.role}</span>
            {p.department_hint && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{p.department_hint}</span>
            )}
            {isVacant && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600">
                <AlertCircle size={10} /> ตำแหน่งว่าง
              </span>
            )}
          </div>
        </div>
        <span className={`shrink-0 flex items-center gap-1 text-xs font-bold ${isVacant ? 'text-amber-400' : 'text-gray-400'}`}>
          <Users size={12} /> {holders.length}
        </span>
        {isSuperadmin && (
          <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
            <button onClick={() => onEdit(p)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
              <Pencil size={13} />
            </button>
            <button onClick={() => onDelete(p)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>
      {open && (
        <div className="px-4 pb-3 pl-11 space-y-2">
          {holders.length === 0 ? (
            <p className="text-xs text-gray-300 italic">ยังไม่มีใครถือตำแหน่งนี้ในเทศบาลนี้</p>
          ) : (
            <div className="space-y-2">
              {holders.map(h => (
                <div key={h.id} className="flex items-center gap-2 text-xs text-gray-600">
                  {h.avatar_url ? (
                    <img src={h.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-[9px] font-bold text-gray-400 shrink-0">
                      {(h.full_name || '?')[0]?.toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium text-gray-700">{h.full_name}</p>
                    {deptName(h.department_id) && (
                      <p className="text-[10px] text-gray-400 truncate">{deptName(h.department_id)}</p>
                    )}
                  </div>
                  {h.phone && (
                    <a href={`tel:${h.phone}`} onClick={e => e.stopPropagation()}
                      className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg bg-green-50 text-green-600 font-semibold hover:bg-green-100 transition-colors">
                      <Phone size={11} /> {h.phone}
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function PositionsManager({ tenant, currentUserRole }) {
  const [positions, setPositions] = useState([])
  const [profiles, setProfiles] = useState([])
  const [depts, setDepts] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(() => new Set())
  const [editing, setEditing] = useState(null) // null=ปิด, {}=สร้างใหม่, {...position}=แก้ไข
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [activeDept, setActiveDept] = useState('') // '' = ยังไม่เลือก (ตั้งเป็นการ์ดแรกหลังโหลดกอง)
  const [search, setSearch] = useState('')

  const isSuperadmin = currentUserRole === 'superadmin'

  const reload = useCallback(() => {
    Promise.all([
      supabase.from('positions').select('*').order('sort_order'),
      tenant?.id
        ? supabase.from('profiles').select('id, full_name, avatar_url, phone, department_id, position_id, role').eq('municipality_id', tenant.id).order('full_name')
        : Promise.resolve({ data: [] }),
      tenant?.id
        ? supabase.from('departments').select('id, name').eq('municipality_id', tenant.id).eq('is_active', true).order('sort_order')
        : Promise.resolve({ data: [] }),
    ]).then(([{ data: pos }, { data: prof }, { data: deptRows }]) => {
      setPositions(pos ?? [])
      setProfiles(prof ?? [])
      setDepts(deptRows ?? [])
      setLoading(false)
    })
  }, [tenant])

  useEffect(() => {
    reload()
  }, [reload])

  function toggleExpand(id) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function openCreate() {
    setForm(EMPTY_FORM)
    setEditing({})
  }
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

  // แยกตามกอง/หน่วยงานจริงของแต่ละ อปท. (เหมือนหน้า "จัดการผู้ใช้และการแต่งตั้ง" ฝั่งแอดมิน) แทนหมวด
  // ตำแหน่งนามธรรมเดิม (CATEGORIES) — ตำแหน่งเองไม่มี department_id (เป็นตารางกลางใช้ร่วมทุก อปท.)
  // จึงคำนวณจาก "มีคนในกองนี้ถือตำแหน่งนั้นอยู่จริงไหม" แทน
  const inDept = (p, deptValue) => deptValue === 'none' ? !p.department_id : p.department_id === deptValue
  const deptCards = [
    ...depts.map(d => ({ value: d.id, label: d.name, count: profiles.filter(p => p.department_id === d.id).length })),
    { value: 'none', label: 'ไม่ระบุกอง', count: profiles.filter(p => !p.department_id).length },
  ]
  const activeGroup = deptCards.find(g => g.value === activeDept) ?? deptCards[0]
  const groupPositions = activeGroup
    ? positions
        .map(p => ({ ...p, holders: profiles.filter(pr => pr.position_id === p.id && inDept(pr, activeGroup.value)) }))
        .filter(p => p.holders.length > 0)
    : []
  // ตำแหน่งที่ยังไม่มีใครถือเลยทั้งองค์กร (ไม่ผูกกับกองไหนได้ เพราะไม่มีคนถือให้อ้างอิงกอง) — โชว์แยกต่างหาก
  const vacantPositions = positions.filter(p => !profiles.some(pr => pr.position_id === p.id))

  // ค้นหาข้ามทุกกองพร้อมกัน (ชื่อตำแหน่ง หรือ ชื่อคนที่ถือตำแหน่ง) ไม่ต้องไล่กดทีละกองเอง
  const searchQ = search.trim().toLowerCase()
  const isSearching = searchQ.length > 0
  const searchResults = isSearching
    ? positions
        .map(p => ({ ...p, holders: profiles.filter(pr => pr.position_id === p.id) }))
        .filter(p => p.name.toLowerCase().includes(searchQ) || p.holders.some(h => (h.full_name || '').toLowerCase().includes(searchQ)))
    : []
  const deptName = (id) => depts.find(d => d.id === id)?.name ?? null

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Briefcase size={18} className="text-indigo-500" /> ทำเนียบตำแหน่ง</h1>
          <p className="text-xs text-gray-400 mt-0.5">ใช้กำหนดแบบตำแหน่งมาตรฐานและตรวจรายชื่อผู้ดำรงตำแหน่งเท่านั้น</p>
        </div>
        {isSuperadmin && (
          <button onClick={openCreate}
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-white shadow-sm active:scale-95 transition-all"
            style={{ backgroundColor: '#1e293b' }}>
            <Plus size={14} /> เพิ่มตำแหน่ง
          </button>
        )}
      </div>

      <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-700">
        การแต่งตั้งหรือเปลี่ยนตำแหน่งบุคลากร ให้ทำที่ <strong>Admin → จัดการผู้ใช้และการแต่งตั้ง → การแต่งตั้งและสิทธิ์</strong> เพียงจุดเดียว
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาชื่อตำแหน่ง หรือชื่อคน..."
          className="w-full pl-8 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-blue-400 text-gray-900 bg-white" />
      </div>

      {isSearching ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 pt-3 pb-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">ผลค้นหา “{search.trim()}”</p>
          </div>
          {searchResults.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-4 py-12 text-center border-t border-gray-50">
              <Search size={28} className="text-gray-200" />
              <p className="mt-3 text-sm font-semibold text-gray-500">ไม่พบตำแหน่งหรือชื่อที่ตรงกับ "{search.trim()}"</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {searchResults.map(p => (
                <PositionRow key={p.id} p={p} holders={p.holders} isOpen forceOpen
                  isSuperadmin={isSuperadmin} deptName={deptName}
                  onToggle={() => {}} onEdit={openEdit} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </div>
      ) : (
      <>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3" aria-label="กลุ่มกอง/หน่วยงาน">
        {deptCards.map(dept => {
            const isActive = dept.value === activeGroup.value
            return (
              <button
                key={dept.value}
                type="button"
                aria-pressed={isActive}
                onClick={() => setActiveDept(dept.value)}
                className={`flex min-h-16 w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${
                  isActive
                    ? 'border-indigo-400 bg-indigo-50 shadow-sm'
                    : 'border-gray-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/40'
                }`}
              >
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                  isActive ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-500'
                }`}>
                  <Briefcase size={18} />
                </span>
                <span className={`min-w-0 flex-1 text-xs font-semibold leading-5 ${
                  isActive ? 'text-indigo-800' : 'text-gray-700'
                }`}>
                  {dept.label}
                </span>
                <span className={`min-w-6 shrink-0 rounded-full px-1.5 py-0.5 text-center text-[10px] font-bold ${
                  isActive ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-400'
                }`}>
                  {dept.count}
                </span>
              </button>
            )
        })}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
          <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">{activeGroup?.label}</p>
          <p className="text-[11px] font-semibold text-gray-300">{groupPositions.length} ตำแหน่ง</p>
        </div>
        {groupPositions.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center border-t border-gray-50">
            <Briefcase size={28} className="text-gray-200" />
            <p className="mt-3 text-sm font-semibold text-gray-500">ยังไม่มีใครในกองนี้ผูกตำแหน่งไว้</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {groupPositions.map(p => (
              <PositionRow key={p.id} p={p} holders={p.holders}
                isOpen={expanded.has(p.id)} isSuperadmin={isSuperadmin} deptName={deptName}
                onToggle={() => toggleExpand(p.id)} onEdit={openEdit} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>

      {vacantPositions.length > 0 && (
        <div className="bg-amber-50 rounded-2xl border border-amber-100 overflow-hidden">
          <div className="px-4 pt-3 pb-2 flex items-center gap-1.5">
            <AlertCircle size={13} className="text-amber-500" />
            <p className="text-[11px] font-bold uppercase tracking-widest text-amber-600">ตำแหน่งที่ยังไม่มีใครถือ ({vacantPositions.length})</p>
          </div>
          <div className="px-4 pb-3 flex flex-wrap gap-1.5">
            {vacantPositions.map(p => (
              <span key={p.id} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg bg-white border border-amber-200 text-amber-700">
                {p.name}
                {isSuperadmin && (
                  <button onClick={() => openEdit(p)} className="text-amber-400 hover:text-amber-600"><Pencil size={10} /></button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
      </>
      )}

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
