import { useState, useEffect, useCallback, useMemo } from 'react'
import { Briefcase, Plus, Pencil, Trash2, X, Loader2, Search, AlertCircle, Users, DownloadCloud } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// แบบตำแหน่งของหน่วยงาน (ตาราง positions) — ย้ายมาจากเมนู "ทำเนียบตำแหน่ง" ฝั่งเจ้าหน้าที่ที่ถอดออก
// 2026-08-31 (ซ้ำซ้อนกับหน้าจัดการผู้ใช้ในสายตาแอดมิน) ตาราง positions ยังจำเป็นเพราะเป็น dependency
// จริง 2 จุด: RPC get_public_personnel_directory ใช้ INNER JOIN (ใครไม่มี position_id หายจากหน้า
// บุคลากรฝั่งประชาชนทั้งคน) และ dropdown "ตำแหน่ง" ในแท็บเจ้าหน้าที่
//
// ตั้งแต่ 20260831140000_positions_per_municipality.sql ตารางนี้เป็นของใครของมันแล้ว
// (municipality_id NOT NULL) แอดมินแต่ละ อปท. แก้ได้เฉพาะของหน่วยงานตัวเอง — RLS บังคับซ้ำฝั่ง DB
// ยังต้องกรอง .eq('municipality_id') ฝั่ง client อยู่ เพราะ superadmin อ่านได้ทุกแถวข้าม อปท.

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
  superadmin: 'Super Admin', admin: 'แอดมินระบบ', officer: 'หัวหน้ากอง',
  technician: 'ปฏิบัติงาน', staff: 'เจ้าหน้าที่', viewer: 'ผู้บริหาร', council: 'สภาเทศบาล',
}

const EMPTY_FORM = { name: '', category: 'operating_staff', role: 'staff', department_hint: '', sort_order: 0 }
const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200'

export default function PositionCatalogAdmin({ tenant, currentUserRole }) {
  const [positions, setPositions] = useState([])
  const [usage, setUsage] = useState({}) // position_id -> จำนวนคนในหน่วยงานนี้ที่ถืออยู่
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // null=ปิด, {}=สร้างใหม่, {...position}=แก้ไข
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [search, setSearch] = useState('')

  const canManage = ['admin', 'superadmin'].includes(currentUserRole)

  // ไม่ setLoading(true) ตรงนี้ — เรียกจาก useEffect ตอน mount ด้วย การ setState แบบ sync ในเอฟเฟกต์
  // ทำให้เกิด cascading render (react-hooks/set-state-in-effect) ค่าเริ่มต้นเป็น true อยู่แล้ว
  // ส่วนการ reload หลังบันทึก/ลบ ให้รีเฟรชเงียบๆ ไม่ต้องกระพริบทั้งหน้า
  const reload = useCallback(() => {
    const query = tenant?.id
      ? Promise.all([
          supabase.from('positions').select('*').eq('municipality_id', tenant.id).order('sort_order'),
          supabase.from('profiles').select('position_id').eq('municipality_id', tenant.id).not('position_id', 'is', null),
        ])
      : Promise.resolve([{ data: [] }, { data: [] }])
    query.then(([{ data: pos }, { data: holders }]) => {
      setPositions(pos ?? [])
      const counts = {}
      for (const row of holders ?? []) counts[row.position_id] = (counts[row.position_id] ?? 0) + 1
      setUsage(counts)
      setLoading(false)
    })
  }, [tenant])

  useEffect(() => { reload() }, [reload])

  function openCreate() {
    setForm(EMPTY_FORM)
    setEditing({})
  }
  function openEdit(p) {
    setForm({ name: p.name, category: p.category, role: p.role, department_hint: p.department_hint ?? '', sort_order: p.sort_order })
    setEditing(p)
  }

  async function handleSave() {
    if (!form.name.trim() || !tenant?.id) return
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
      : await supabase.from('positions').insert({ ...payload, municipality_id: tenant.id })
    setSaving(false)
    if (error) {
      // 23505 = ชน UNIQUE (municipality_id, name) — ข้อความดิบของ Postgres อ่านไม่รู้เรื่องสำหรับแอดมิน
      alert(error.code === '23505'
        ? `มีตำแหน่งชื่อ "${payload.name}" อยู่แล้วในหน่วยงานนี้`
        : 'บันทึกไม่สำเร็จ: ' + error.message)
      return
    }
    setEditing(null)
    reload()
  }

  async function handleDelete(p) {
    const count = usage[p.id] ?? 0
    // ลบตำแหน่งที่ยังมีคนถือ = คนเหล่านั้นหลุด position_id (ON DELETE SET NULL) แล้วหายจากหน้า
    // บุคลากรฝั่งประชาชนทันที เพราะ RPC ใช้ INNER JOIN — บล็อกไว้ก่อน ให้ย้ายคนออกเอง
    if (count > 0) {
      alert(`ลบไม่ได้: ยังมีบุคลากร ${count} คนถือตำแหน่ง "${p.name}" อยู่\n\n` +
        'ต้องย้ายคนเหล่านั้นไปตำแหน่งอื่นที่แท็บ "เจ้าหน้าที่" ก่อน')
      return
    }
    if (!window.confirm(`ลบตำแหน่ง "${p.name}" ของหน่วยงานนี้?`)) return
    const { error } = await supabase.from('positions').delete().eq('id', p.id)
    if (error) { alert('ลบไม่สำเร็จ: ' + error.message); return }
    reload()
  }

  async function handleImportDefaults() {
    if (!tenant?.id) return
    if (!window.confirm('นำเข้าชุดตำแหน่งมาตรฐาน อบต./เทศบาล?\n\nจะเพิ่มเฉพาะชื่อที่ยังไม่มีในหน่วยงานนี้ ของเดิมไม่ถูกแก้')) return
    setImporting(true)
    const { data, error } = await supabase.rpc('import_default_positions', { p_municipality_id: tenant.id })
    setImporting(false)
    if (error) { alert('นำเข้าไม่สำเร็จ: ' + error.message); return }
    alert(data > 0 ? `เพิ่มตำแหน่งใหม่ ${data} รายการ` : 'ไม่มีตำแหน่งใหม่ให้เพิ่ม — มีครบอยู่แล้ว')
    reload()
  }

  const searchQ = search.trim().toLowerCase()
  const grouped = useMemo(() => {
    const visible = searchQ
      ? positions.filter(p => p.name.toLowerCase().includes(searchQ) || (p.department_hint ?? '').toLowerCase().includes(searchQ))
      : positions
    return CATEGORIES
      .map(c => ({ ...c, items: visible.filter(p => p.category === c.value) }))
      .filter(c => c.items.length > 0)
  }, [positions, searchQ])

  if (loading) return <div className="flex justify-center py-16"><Loader2 size={28} className="animate-spin text-gray-200" /></div>

  return (
    <div className="space-y-4 px-4 py-4 md:px-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
            <Briefcase size={17} className="text-indigo-500" /> แบบตำแหน่งของหน่วยงาน
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            ใช้เป็นตัวเลือกตำแหน่งตอนแต่งตั้งในแท็บ "เจ้าหน้าที่" — {positions.length} ตำแหน่ง
          </p>
        </div>
        {canManage && (
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={handleImportDefaults} disabled={importing}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50 active:scale-95 transition-all">
              {importing ? <Loader2 size={14} className="animate-spin" /> : <DownloadCloud size={14} />}
              <span className="hidden md:inline">ชุดมาตรฐาน</span>
            </button>
            <button onClick={openCreate}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-white shadow-sm active:scale-95 transition-all"
              style={{ backgroundColor: '#1e293b' }}>
              <Plus size={14} /> เพิ่มตำแหน่ง
            </button>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-700 flex gap-2">
        <AlertCircle size={15} className="shrink-0 mt-0.5" />
        <span>
          ตำแหน่งชุดนี้เป็น<strong>ของหน่วยงานนี้เท่านั้น</strong> แก้แล้วไม่กระทบ อปท. อื่น —
          การแต่งตั้งคนเข้าตำแหน่งทำที่แท็บ <strong>เจ้าหน้าที่</strong>
        </span>
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="ค้นหาชื่อตำแหน่ง..."
          className="w-full pl-8 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-blue-400 text-gray-900 bg-white" />
      </div>

      {grouped.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 flex flex-col items-center justify-center px-4 py-12 text-center">
          <Briefcase size={28} className="text-gray-200" />
          <p className="mt-3 text-sm font-semibold text-gray-500">
            {searchQ ? `ไม่พบตำแหน่งที่ตรงกับ "${search.trim()}"` : 'หน่วยงานนี้ยังไม่มีตำแหน่ง'}
          </p>
          {!searchQ && canManage && (
            <p className="mt-1 text-xs text-gray-400">กด "ชุดมาตรฐาน" เพื่อนำเข้าโครงสร้างตำแหน่ง อบต./เทศบาล ทั้งชุด</p>
          )}
        </div>
      ) : (
        grouped.map(cat => (
          <div key={cat.value} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">{cat.label}</p>
              <p className="text-[11px] font-semibold text-gray-300">{cat.items.length} ตำแหน่ง</p>
            </div>
            <div className="divide-y divide-gray-50">
              {cat.items.map(p => {
                const count = usage[p.id] ?? 0
                return (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{p.name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600">{ROLE_TH[p.role] ?? p.role}</span>
                        {p.department_hint && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{p.department_hint}</span>
                        )}
                        <span className="text-[10px] font-semibold text-gray-300">ลำดับ {p.sort_order}</span>
                      </div>
                    </div>
                    <span className={`shrink-0 flex items-center gap-1 text-xs font-bold ${count > 0 ? 'text-gray-400' : 'text-amber-400'}`}
                      title={count > 0 ? `มีผู้ถือตำแหน่ง ${count} คน` : 'ยังไม่มีใครถือตำแหน่งนี้'}>
                      <Users size={12} /> {count}
                    </span>
                    {canManage && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => openEdit(p)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => handleDelete(p)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))
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
