import { useState, useEffect, useCallback, useMemo } from 'react'
import { Briefcase, Plus, Pencil, Trash2, X, Loader2, Search, AlertCircle, Users, DownloadCloud } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { activeOrgTerms } from '../../lib/orgTerms'
import { groupPositionsByDepartment } from '../../lib/personnelStructure'

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
  technician: 'ปฏิบัติงาน', staff: 'เจ้าหน้าที่', viewer: 'ผู้บริหาร',
  // getter เพราะคำเรียกสภาเปลี่ยนตาม org_type และค่านี้ยังไม่พร้อมตอน import — ดู src/lib/orgTerms.js
  get council() { return activeOrgTerms().councilOrg },
}

const EMPTY_FORM = { name: '', category: 'operating_staff', role: 'staff', department_id: '', sort_order: 0 }
const inputCls = 'min-h-11 w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200'

export default function PositionCatalogAdmin({ tenant, currentUserRole }) {
  const [positions, setPositions] = useState([])
  const [departments, setDepartments] = useState([])
  const [usage, setUsage] = useState({}) // position_id -> จำนวนคนในหน่วยงานนี้ที่ถืออยู่
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // null=ปิด, {}=สร้างใหม่, {...position}=แก้ไข
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [search, setSearch] = useState('')
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')

  const canManage = ['admin', 'superadmin'].includes(currentUserRole)

  // ไม่ setLoading(true) ตรงนี้ — เรียกจาก useEffect ตอน mount ด้วย การ setState แบบ sync ในเอฟเฟกต์
  // ทำให้เกิด cascading render (react-hooks/set-state-in-effect) ค่าเริ่มต้นเป็น true อยู่แล้ว
  // ส่วนการ reload หลังบันทึก/ลบ ให้รีเฟรชเงียบๆ ไม่ต้องกระพริบทั้งหน้า
  const reload = useCallback(() => {
    const query = tenant?.id
      ? Promise.all([
          supabase.from('positions').select('*').eq('municipality_id', tenant.id).order('sort_order'),
          supabase.rpc('get_position_holder_counts', { p_municipality_id: tenant.id }),
          supabase.from('departments').select('id, name, short_name, sort_order, is_active')
            .eq('municipality_id', tenant.id).order('sort_order'),
        ])
      : Promise.resolve([{ data: [] }, { data: [] }, { data: [] }])
    query.then(([positionResult, holderResult, departmentResult]) => {
      const error = positionResult.error || holderResult.error || departmentResult.error
      if (error) {
        setLoadError('โหลดโครงสร้างตำแหน่งไม่สำเร็จ กรุณาลองใหม่')
        setLoading(false)
        return
      }
      setLoadError('')
      const pos = positionResult.data
      const holders = holderResult.data
      const departmentRows = departmentResult.data
      setPositions(pos ?? [])
      setDepartments(departmentRows ?? [])
      const counts = {}
      for (const row of holders ?? []) counts[row.position_id] = Number(row.holder_count)
      setUsage(counts)
      setLoading(false)
    })
  }, [tenant])

  useEffect(() => { reload() }, [reload])

  function openCreate(departmentId = '') {
    setSaveError('')
    setForm({ ...EMPTY_FORM, department_id: departmentId })
    setEditing({})
  }
  function openEdit(p) {
    setSaveError('')
    setForm({
      name: p.name,
      category: p.category,
      role: p.role,
      department_id: p.department_id ?? '',
      sort_order: p.sort_order,
    })
    setEditing(p)
  }

  async function handleSave() {
    if (saving || !form.name.trim() || !tenant?.id) return
    setSaving(true)
    setSaveError('')
    const payload = {
      name: form.name.trim(),
      category: form.category,
      role: form.role,
      department_id: form.department_id || null,
      sort_order: Number(form.sort_order) || 0,
    }
    const { data, error } = editing?.id
      ? await supabase.rpc('admin_save_position', {
          p_position_id: editing.id,
          p_changes: payload,
          p_expected_department_id: editing.department_id || null,
          p_expected_holder_count: usage[editing.id] ?? 0,
          p_confirm_move: departmentChanged && editingHolderCount > 0,
        })
      : await supabase.from('positions').insert({ ...payload, municipality_id: tenant.id }).select('id').single()
    setSaving(false)
    if (error) {
      // 23505 = ชน UNIQUE (municipality_id, name) — ข้อความดิบของ Postgres อ่านไม่รู้เรื่องสำหรับแอดมิน
      const stale = error.code === '40001' || /changed|reload|concurrent/i.test(error.message)
      const protectedAccount = /own account|Only superadmin|superadmin account/i.test(error.message)
      setSaveError(error.code === '23505'
        ? `มีตำแหน่งชื่อ "${payload.name}" อยู่แล้วในหน่วยงานนี้`
        : stale ? 'ข้อมูลเปลี่ยนระหว่างแก้ไข กรุณาปิดหน้าต่างแล้วเปิดตำแหน่งนี้ใหม่เพื่อตรวจจำนวนคนก่อนยืนยัน'
          : protectedAccount ? 'มีบัญชีผู้ดูแลระบบที่คุณไม่มีสิทธิ์ย้าย กรุณาให้ Super Admin ดำเนินการ'
            : 'บันทึกไม่สำเร็จ: ' + error.message)
      if (stale) reload()
      return
    }
    if (editing?.id ? data?.position_id !== editing.id : !data?.id) {
      setSaveError('ไม่พบตำแหน่งที่บันทึก กรุณาโหลดข้อมูลใหม่')
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
  const editingHolderCount = editing?.id ? (usage[editing.id] ?? 0) : 0
  const departmentChanged = Boolean(editing?.id && form.department_id !== (editing.department_id ?? ''))
  const targetDepartmentName = departments.find(department => department.id === form.department_id)?.name
  const grouped = useMemo(() => {
    const visible = searchQ
      ? positions.filter(p => p.name.toLowerCase().includes(searchQ) || (p.department_hint ?? '').toLowerCase().includes(searchQ))
      : positions
    return groupPositionsByDepartment(visible, departments)
      .filter(group => group.items.length > 0 || (!searchQ && group.department))
  }, [departments, positions, searchQ])

  if (loading) return <div className="flex justify-center py-16"><Loader2 size={28} className="animate-spin text-gray-200" /></div>
  if (loadError) return (
    <div className="m-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800" role="alert">
      <p>{loadError}</p>
      <button type="button" onClick={reload} className="mt-2 min-h-11 rounded-xl bg-white px-4 font-bold">ลองใหม่</button>
    </div>
  )

  return (
    <div className="space-y-4 px-4 py-4 md:px-5">
      <div className="flex flex-col items-stretch gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
            <Briefcase size={17} className="text-indigo-500" /> แบบตำแหน่งของหน่วยงาน
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            ใช้เป็นตัวเลือกตำแหน่งตอนแต่งตั้งในแท็บ "เจ้าหน้าที่" — {positions.length} ตำแหน่ง
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={handleImportDefaults} disabled={importing}
              className="flex min-h-11 items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50 active:scale-95 transition-all">
              {importing ? <Loader2 size={14} className="animate-spin" /> : <DownloadCloud size={14} />}
              <span>ชุดมาตรฐาน</span>
            </button>
            <button onClick={() => openCreate()}
              className="flex min-h-11 items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-white shadow-sm active:scale-95 transition-all"
              style={{ backgroundColor: '#1e293b' }}>
              <Plus size={14} /> เพิ่มตำแหน่ง
            </button>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-700 flex gap-2">
        <AlertCircle size={15} className="shrink-0 mt-0.5" />
        <span>
          เลือกกองครั้งเดียวตอนสร้างตำแหน่ง จากนั้นเมื่อแต่งตั้ง ระบบจะใส่กองให้เอง —
          ตำแหน่ง “ส่วนกลาง” เท่านั้นที่ผู้ดูแลต้องเลือกกองตอนแต่งตั้ง
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
        grouped.map((group, index) => (
          <details key={group.key} open={Boolean(searchQ) || index === 0}
            className="group bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <div className="min-w-0">
                <p className="break-words text-sm font-bold text-gray-700">{group.label}</p>
                <p className="mt-0.5 text-xs text-gray-400">{group.items.length} ตำแหน่ง</p>
              </div>
              {canManage && group.department && group.department.is_active !== false && (
                <button type="button" onClick={(event) => { event.preventDefault(); openCreate(group.department.id) }}
                  className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100">
                  <Plus size={14} /> เพิ่มในกองนี้
                </button>
              )}
            </summary>
            <div className="divide-y divide-gray-50 border-t border-gray-50">
              {group.items.length === 0 && (
                <p className="px-4 py-5 text-center text-xs text-gray-400">กองนี้ยังไม่มีแบบตำแหน่ง</p>
              )}
              {group.items.map(p => {
                const count = usage[p.id] ?? 0
                return (
                  <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="w-full min-w-0 md:w-auto md:flex-1">
                      <p className="text-sm font-semibold leading-relaxed text-gray-800 break-words">{p.name}</p>
                      {!p.department_id && p.department_hint && (
                        <p className="mt-1 text-xs leading-5 text-amber-600">
                          ข้อมูลเดิมระบุ “{p.department_hint}” — ยังไม่ผูกกอง กรุณาตรวจสังกัดก่อนแก้ไข
                        </p>
                      )}
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600">{ROLE_TH[p.role] ?? p.role}</span>
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{group.label}</span>
                        <span className="text-[10px] font-semibold text-gray-300">ลำดับ {p.sort_order}</span>
                      </div>
                    </div>
                    <span className={`shrink-0 flex items-center gap-1 text-xs font-bold ${count > 0 ? 'text-gray-400' : 'text-amber-400'}`}
                      title={count > 0 ? `มีผู้ถือตำแหน่ง ${count} คน` : 'ยังไม่มีใครถือตำแหน่งนี้'}>
                      <Users size={12} /> {count}
                    </span>
                    {canManage && (
                      <div className="ml-auto flex items-center gap-2 shrink-0 md:ml-0">
                        <button onClick={() => openEdit(p)}
                          aria-label={`แก้ไขตำแหน่ง ${p.name}`}
                          className="flex min-h-11 items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-600 transition-colors">
                          <Pencil size={15} /> <span className="text-sm">แก้ไข</span>
                        </button>
                        <button onClick={() => handleDelete(p)}
                          aria-label={`ลบตำแหน่ง ${p.name}`}
                          className="flex min-h-11 items-center gap-1.5 px-3 py-2 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 transition-colors">
                          <Trash2 size={15} /> <span className="text-sm">ลบ</span>
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </details>
        ))
      )}

      {editing !== null && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center"
          role="dialog" aria-modal="true" aria-labelledby="position-edit-title">
          <div className="bg-white w-full md:max-w-md md:rounded-3xl rounded-t-3xl max-h-[93vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 shrink-0">
              <button onClick={() => setEditing(null)} disabled={saving} aria-label="ปิด"
                className="flex min-h-11 min-w-11 items-center justify-center rounded-xl hover:bg-gray-100 text-gray-500"><X size={18} /></button>
              <p id="position-edit-title" className="font-bold text-gray-800">{editing?.id ? 'แก้ไขตำแหน่ง' : 'เพิ่มตำแหน่งใหม่'}</p>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5">
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">ชื่อตำแหน่ง *</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className={inputCls} placeholder="เช่น ผู้อำนวยการกองสาธารณสุขและสิ่งแวดล้อม" />
              </div>
              <div>
                <label htmlFor="position-department" className="text-xs font-semibold text-gray-500 mb-1 block">กอง / หน่วยงาน</label>
                <select id="position-department" value={form.department_id}
                  onChange={e => setForm(f => ({ ...f, department_id: e.target.value }))}
                  disabled={saving} className={inputCls}>
                  <option value="">ส่วนกลาง / ยังไม่ผูกกอง</option>
                  {departments.map(department => (
                    <option key={department.id} value={department.id} disabled={department.is_active === false}>
                      {department.name}{department.is_active === false ? ' (ปิดใช้งาน)' : ''}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] leading-5 text-gray-400">
                  เลือกย้ายกองได้แม้มีผู้ถือตำแหน่ง ระบบจะแสดงผลที่จะเกิดขึ้นก่อนบันทึก
                </p>
              </div>
              {departmentChanged && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-800" role="status">
                  <p className="font-bold">{targetDepartmentName ? `ย้ายตำแหน่งไป ${targetDepartmentName}` : 'กลับเป็นตำแหน่งส่วนกลาง / ยังไม่ผูกกอง'}</p>
                  <p className="mt-1">
                    {form.department_id
                      ? `ผู้ถือตำแหน่ง ${editingHolderCount} คนจะใช้กองนี้ โดยบทบาทระบบเดิมคงไว้ คนที่ย้ายกองจะถูกยกเลิกสถานะหัวหน้ากองเดิม`
                      : `ผู้ถือตำแหน่ง ${editingHolderCount} คนยังคงกองปัจจุบัน ไม่ล้างสังกัดเดิม`}
                  </p>
                </div>
              )}
              <details className="rounded-2xl border border-gray-100 bg-gray-50 px-3 py-2">
                <summary className="min-h-11 cursor-pointer py-3 text-xs font-bold text-gray-500">ตัวเลือกขั้นสูง: ระดับ สิทธิ์แนะนำ และลำดับ</summary>
                <div className="space-y-3 pb-2">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">ระดับ</label>
                    <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className={inputCls}>
                      {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">บทบาทที่แนะนำ</label>
                    <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className={inputCls}>
                      {Object.entries(ROLE_TH).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <p className="mt-1 text-[11px] leading-5 text-gray-400">เป็นคำแนะนำเท่านั้น ระบบไม่เพิ่มสิทธิ์ให้บุคลากรโดยอัตโนมัติ</p>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">ลำดับการแสดงผล</label>
                    <input type="number" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} className={inputCls} />
                  </div>
                </div>
              </details>
              {saveError && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">{saveError}</p>}
            </div>
            <div className="px-4 pb-6 pt-3 border-t border-gray-100 shrink-0">
              <button onClick={handleSave} disabled={saving || !form.name.trim()}
                className="w-full py-3.5 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50 text-sm active:scale-[0.98] transition-all"
                style={{ backgroundColor: '#1e293b' }}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                {departmentChanged
                  ? (form.department_id ? 'ยืนยันย้ายตำแหน่งและบุคลากร' : 'ยืนยันกลับเป็นตำแหน่งส่วนกลาง')
                  : editing?.id ? 'บันทึกการแก้ไข' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
