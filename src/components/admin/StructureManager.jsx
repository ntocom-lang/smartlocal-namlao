import { useState, useEffect, useCallback, useMemo } from 'react'
import { Building2, ChevronRight, DownloadCloud, Loader2, Pencil, Plus, Search, Trash2, Users, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { activeOrgTerms } from '../../lib/orgTerms'
import { departmentColor } from '../../lib/departmentColors'
import {
  EXECUTIVE_POSITION_GROUP, UNASSIGNED_DEPARTMENT, groupPositionsByDepartment, isExecutivePosition, isUnitHeadPositionName,
  suggestedDepartmentId,
} from '../../lib/personnelStructure'
import DepartmentDialog from './DepartmentDialog'

// แท็บ "กองและตำแหน่ง" — รายการเดียวจัดตามกอง (เจ้าของระบบสั่ง 2569-10-31)
// เดิมวางหน้ากอง (DepartmentManager) ต่อกับหน้าแบบตำแหน่ง ชื่อกองโผล่ 2 รอบ และฟอร์มเพิ่มกองค้างบนหน้า
// สนามซ้อม 7 กอง 28 ตำแหน่งยาว 3 จอ (มือถือ 4 จอ) และยาวขึ้นทุกครั้งที่เพิ่ม
// ตอนนี้ทุกกองพับไว้ เปิดได้ทีละกอง ความยาวจึงขึ้นกับจำนวนกอง ไม่ขึ้นกับจำนวนตำแหน่ง
// เพิ่ม/แก้/ลบกองอยู่ใน DepartmentDialog · ลบตำแหน่งอยู่ในหน้าต่างแก้ตำแหน่ง (กันกดพลาดจากแถว)
//
// ตาราง positions ยังเป็น dependency จริง 2 จุด: RPC get_public_personnel_directory ใช้ INNER JOIN
// (ใครไม่มี position_id หายจากหน้าบุคลากรฝั่งประชาชนทั้งคน) และช่องตำแหน่งในฟอร์มเจ้าหน้าที่
// ตั้งแต่ 20260831140000_positions_per_municipality.sql ตารางนี้เป็นของใครของมัน (municipality_id NOT NULL)
// RLS บังคับซ้ำฝั่ง DB แต่ยังต้องกรอง .eq('municipality_id') ฝั่ง client เพราะ superadmin อ่านได้ทุกแถวข้าม อปท.

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

// กองหลัก (home_department_id) กับการล็อก (locked) แยกกัน — เดิมเลือกกอง = ล็อกทันที
// แอดมินที่แค่อยากจัดตำแหน่งไว้ใต้กองจึงล็อกโดยไม่ตั้งใจ (ทุ่งแค้ว 30 ตำแหน่ง 2569-10-30)
// - กองหลัก: จัดกลุ่มในหน้านี้ + ระบบเติมกองให้ตอนแต่งตั้ง (department_hint) ไม่บังคับใคร
// - ล็อก: department_id = ผู้ถือทุกคนต้องอยู่กองนั้น ใช้เฉพาะหัวหน้าหน่วยงาน
// "เพิ่มตำแหน่งในกองนี้" ตั้งกองหลักให้ แล้วล็อกเองเมื่อชื่อเป็นหัวหน้าหน่วยงาน จนกว่าแอดมินจะกดสวิตช์เอง (lock_touched)
const EMPTY_FORM = {
  name: '', category: 'operating_staff', role: 'staff', sort_order: 0,
  home_department_id: '', initial_home_department_id: '', locked: false, lock_touched: false,
}
const inputCls = 'min-h-11 w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200'
const toolbarButtonCls = 'flex min-h-11 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition-all active:scale-95 disabled:opacity-50'

export default function StructureManager({ tenant, currentUserRole, onChanged }) {
  const [positions, setPositions] = useState([])
  const [departments, setDepartments] = useState([])
  const [usage, setUsage] = useState({}) // position_id -> จำนวนคนในหน่วยงานนี้ที่ถืออยู่
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // null=ปิด, {}=สร้างใหม่, {...position}=แก้ไข
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [search, setSearch] = useState('')
  const [openKey, setOpenKey] = useState(null) // กองที่กางอยู่ ทีละกอง
  const [departmentDialog, setDepartmentDialog] = useState(null) // null=ปิด, {}=เพิ่ม, {...department}=แก้
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
          supabase.from('departments').select('id, code, name, short_name, color, sort_order, is_active')
            .eq('municipality_id', tenant.id).order('sort_order'),
        ])
      : Promise.resolve([{ data: [] }, { data: [] }, { data: [] }])
    query.then(([positionResult, holderResult, departmentResult]) => {
      const error = positionResult.error || holderResult.error || departmentResult.error
      if (error) {
        setLoadError('โหลดกองและตำแหน่งไม่สำเร็จ กรุณาลองใหม่')
        setLoading(false)
        return
      }
      setLoadError('')
      setPositions(positionResult.data ?? [])
      setDepartments(departmentResult.data ?? [])
      const counts = {}
      for (const row of holderResult.data ?? []) counts[row.position_id] = Number(row.holder_count)
      setUsage(counts)
      setLoading(false)
    })
  }, [tenant])

  useEffect(() => { reload() }, [reload])

  // หน้าจัดการผู้ใช้ถือรายชื่อกอง/ตำแหน่งของตัวเองไว้ใช้ในแท็บเจ้าหน้าที่และฟอร์ม ต้องโหลดใหม่ตามด้วย
  function changed() {
    reload()
    onChanged?.()
  }

  function openCreate(departmentId = '') {
    setSaveError('')
    setForm({ ...EMPTY_FORM, home_department_id: departmentId, initial_home_department_id: departmentId })
    setEditing({})
  }
  function openEdit(p) {
    setSaveError('')
    setForm({
      ...EMPTY_FORM,
      name: p.name,
      category: p.category,
      role: p.role,
      home_department_id: suggestedDepartmentId(p, departments) ?? '',
      initial_home_department_id: suggestedDepartmentId(p, departments) ?? '',
      locked: Boolean(p.department_id),
      lock_touched: true,
      sort_order: p.sort_order,
    })
    setEditing(p)
  }
  function changeName(name) {
    setForm(f => ({
      ...f,
      name,
      locked: f.lock_touched ? f.locked : Boolean(f.home_department_id) && isUnitHeadPositionName(name),
    }))
  }
  function toggleGroup(key) {
    setOpenKey(current => (current === key ? null : key))
  }

  async function handleSave() {
    if (saving || !form.name.trim() || !tenant?.id) return
    setSaving(true)
    setSaveError('')
    const payload = {
      name: form.name.trim(),
      category: form.category,
      role: form.role,
      department_id: formDepartmentId || null,
      sort_order: Number(form.sort_order) || 0,
    }
    // ส่งกองหลักเฉพาะเมื่อแอดมินเปลี่ยน — กองหลักเดิมที่เป็นข้อความจับคู่กองไม่ได้จะไม่ถูกล้างเงียบๆ
    const homeChanged = form.home_department_id !== form.initial_home_department_id
    const { data, error } = editing?.id
      ? await supabase.rpc('admin_save_position', {
          p_position_id: editing.id,
          p_changes: !formDepartmentId && homeChanged ? { ...payload, department_hint: homeDepartmentName } : payload,
          p_expected_department_id: editing.department_id || null,
          p_expected_holder_count: usage[editing.id] ?? 0,
          p_confirm_move: departmentChanged && editingHolderCount > 0,
        })
      : await supabase.from('positions').insert({
          ...payload,
          // ใช้ได้ทุกกอง = จำกองหลักไว้เป็นกองแนะนำ (ล็อกกองแล้ว DB ใส่ชื่อกองให้เอง)
          department_hint: payload.department_id ? null : homeDepartmentName,
          municipality_id: tenant.id,
        }).select('id').single()
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
    // กางกองที่ตำแหน่งไปอยู่ ให้เห็นทันทีว่าบันทึกแล้วอยู่ตรงไหน
    setOpenKey(form.home_department_id
      || (isExecutivePosition({ category: form.category }) ? EXECUTIVE_POSITION_GROUP : UNASSIGNED_DEPARTMENT))
    changed()
  }

  async function handleDelete(p) {
    // ลบตำแหน่งที่ยังมีคนถือ = คนเหล่านั้นหลุด position_id แล้วหายจากหน้าบุคลากรฝั่งประชาชนทันที
    // เพราะ RPC ใช้ INNER JOIN — หน้าต่างไม่ให้กดอยู่แล้ว (trigger guard_position_department กันซ้ำฝั่ง DB)
    if (deleting || (usage[p.id] ?? 0) > 0) return
    if (!window.confirm(`ลบตำแหน่ง "${p.name}" ของหน่วยงานนี้?`)) return
    setDeleting(true)
    setSaveError('')
    const { error } = await supabase.from('positions').delete().eq('id', p.id)
    setDeleting(false)
    if (error) { setSaveError('ลบไม่สำเร็จ: ' + error.message); return }
    setEditing(null)
    changed()
  }

  async function handleImportDefaults() {
    if (!tenant?.id) return
    if (!window.confirm('นำเข้าชุดตำแหน่งมาตรฐาน อบต./เทศบาล?\n\nจะเพิ่มเฉพาะชื่อที่ยังไม่มีในหน่วยงานนี้ ของเดิมไม่ถูกแก้')) return
    setImporting(true)
    const { data, error } = await supabase.rpc('import_default_positions', { p_municipality_id: tenant.id })
    setImporting(false)
    if (error) { alert('นำเข้าไม่สำเร็จ: ' + error.message); return }
    alert(data > 0 ? `เพิ่มตำแหน่งใหม่ ${data} รายการ` : 'ไม่มีตำแหน่งใหม่ให้เพิ่ม — มีครบอยู่แล้ว')
    changed()
  }

  function departmentSaved(saved) {
    const removedId = saved === null ? departmentDialog?.id : null
    // กองใหม่กางให้เลย ขั้นต่อไปคือเพิ่มตำแหน่งในกองนี้
    if (!departmentDialog?.id && saved?.id) setOpenKey(saved.id)
    if (removedId) setOpenKey(current => (current === removedId ? null : current))
    setDepartmentDialog(null)
    changed()
  }

  const query = search.trim().toLowerCase()
  const editingHolderCount = editing?.id ? (usage[editing.id] ?? 0) : 0
  // department_id ที่จะบันทึก = กองหลักเมื่อติ๊กล็อกเท่านั้น
  const formDepartmentId = form.locked ? form.home_department_id : ''
  const homeDepartmentName = departments.find(department => department.id === form.home_department_id)?.name ?? null
  const departmentChanged = Boolean(editing?.id && formDepartmentId !== (editing.department_id ?? ''))
  const targetDepartmentName = departments.find(department => department.id === formDepartmentId)?.name
  const activeDepartments = departments.filter(department => department.is_active !== false)
  // ไม่ค้นหา: กองที่ใช้งานทุกกอง + กลุ่มที่มีตำแหน่ง · ค้นหา: ชื่อกองตรง = ทั้งกอง / ไม่ตรง = เฉพาะตำแหน่งที่ตรง
  const groups = useMemo(() => {
    const all = groupPositionsByDepartment(positions, departments)
    if (!query) return all.filter(group => group.items.length > 0 || (group.department && group.department.is_active !== false))
    const hit = text => (text ?? '').toLowerCase().includes(query)
    return all
      .map(group => {
        const groupHit = group.department ? hit(group.department.name) || hit(group.department.short_name) : hit(group.label)
        const items = groupHit ? group.items : group.items.filter(p => hit(p.name) || hit(p.department_hint))
        return { ...group, items, groupHit }
      })
      .filter(group => group.items.length > 0 || group.groupHit)
  }, [departments, positions, query])

  if (loading) return <div className="flex justify-center py-16"><Loader2 size={28} className="animate-spin text-gray-200" /></div>
  if (loadError) return (
    <div className="m-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800" role="alert">
      <p>{loadError}</p>
      <button type="button" onClick={reload} className="mt-2 min-h-11 rounded-xl bg-white px-4 font-bold">ลองใหม่</button>
    </div>
  )

  return (
    <div className="space-y-3 px-4 py-4 md:px-5" data-structure-manager>
      <div className="flex flex-col items-stretch gap-3 lg:flex-row lg:items-start lg:justify-between" data-structure-toolbar>
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-bold text-gray-800">
            <Building2 size={17} className="text-indigo-500" /> กองและตำแหน่ง
          </h2>
          <p className="mt-0.5 text-xs leading-5 text-gray-500">
            {activeDepartments.length} กอง · {positions.length} ตำแหน่ง · กดชื่อกองเพื่อดูตำแหน่ง
            · เพิ่มเจ้าหน้าที่ไม่ต้องมาหน้านี้ก่อน ฟอร์มเพิ่มกองและตำแหน่งให้ได้เลย
          </p>
        </div>
        {canManage && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button type="button" onClick={() => setDepartmentDialog({})} data-structure-add-department
              className={`${toolbarButtonCls} bg-slate-800 text-white shadow-sm`}>
              <Plus size={14} /> เพิ่มกอง
            </button>
            <button type="button" onClick={() => openCreate()}
              className={`${toolbarButtonCls} bg-slate-800 text-white shadow-sm`}>
              <Plus size={14} /> เพิ่มตำแหน่ง
            </button>
            <button type="button" onClick={handleImportDefaults} disabled={importing}
              className={`${toolbarButtonCls} border border-gray-200 bg-white text-gray-600 hover:bg-gray-50`}>
              {importing ? <Loader2 size={14} className="animate-spin" /> : <DownloadCloud size={14} />}
              <span>ชุดมาตรฐาน</span>
            </button>
          </div>
        )}
      </div>

      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} aria-label="ค้นหากองหรือตำแหน่ง"
          placeholder="ค้นหากองหรือตำแหน่ง..." data-structure-search
          className="min-h-11 w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-8 pr-3 text-sm text-gray-900 focus:border-blue-400 focus:outline-none" />
      </div>
      <p className="text-xs leading-5 text-gray-500">
        ตำแหน่งจัดไว้ใต้ “กองหลัก” ส่วนใหญ่ <strong className="text-emerald-700">ใช้ได้ทุกกอง</strong> เช่น ธุรการ จ้างเหมา
        · <strong className="text-amber-700">🔒 ล็อกกอง</strong> เฉพาะหัวหน้าหน่วยงานที่มีได้กองเดียว เช่น ผู้อำนวยการกอง
      </p>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-gray-100 bg-white px-4 py-12 text-center">
          <Building2 size={28} className="text-gray-200" />
          <p className="mt-3 text-sm font-semibold text-gray-500">
            {query ? `ไม่พบกองหรือตำแหน่งที่ตรงกับ "${search.trim()}"` : 'หน่วยงานนี้ยังไม่มีกองและตำแหน่ง'}
          </p>
          {!query && canManage && (
            <p className="mt-1 text-xs text-gray-500">กด “เพิ่มกอง” หรือ “ชุดมาตรฐาน” เพื่อนำเข้าโครงสร้างตำแหน่ง อบต./เทศบาล ทั้งชุด</p>
          )}
        </div>
      ) : (
        <div className="space-y-2" data-structure-groups>
          {groups.map((group, index) => {
            const open = query ? true : openKey === group.key
            const panelId = `structure-group-${index}`
            const editable = canManage && group.department && group.department.is_active !== false
            const marker = group.department
              ? (departmentColor(group.department.color)?.emoji ?? '⬜')
              : (group.key === EXECUTIVE_POSITION_GROUP ? '🏛️' : '🗂️')
            return (
              <section key={group.key} data-structure-group={group.key}
                className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                <div className="flex items-center gap-1 pr-2">
                  <button type="button" onClick={() => toggleGroup(group.key)} disabled={Boolean(query)}
                    aria-expanded={open} aria-controls={open ? panelId : undefined} data-structure-toggle
                    className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 disabled:cursor-default disabled:hover:bg-transparent">
                    <ChevronRight size={16} className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`} />
                    <span aria-hidden="true" className="shrink-0 text-base leading-none">{marker}</span>
                    <span className="min-w-0">
                      <span className="block break-words text-sm font-bold text-gray-800">{group.label}</span>
                      <span className="block text-xs text-gray-500">
                        {group.department?.short_name ? `${group.department.short_name} · ` : ''}{group.items.length} ตำแหน่ง
                      </span>
                    </span>
                  </button>
                  {editable && (
                    <button type="button" onClick={() => setDepartmentDialog(group.department)}
                      aria-label={`แก้ไขกอง ${group.department.name}`} data-structure-edit-department
                      className="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-gray-600 hover:bg-gray-100">
                      <Pencil size={14} /> <span className="hidden sm:inline">แก้กอง</span>
                    </button>
                  )}
                </div>
                {open && (
                  <div id={panelId} className="border-t border-gray-100">
                    {editable && (
                      <button type="button" onClick={() => openCreate(group.department.id)} data-structure-add-position
                        className="flex min-h-11 w-full items-center gap-1.5 border-b border-gray-50 px-4 text-sm font-bold text-indigo-700 hover:bg-indigo-50">
                        <Plus size={14} /> เพิ่มตำแหน่งในกองนี้
                      </button>
                    )}
                    {group.items.length === 0 ? (
                      <p className="px-4 py-4 text-center text-xs text-gray-500">กองนี้ยังไม่มีแบบตำแหน่ง</p>
                    ) : (
                      <ul className="grid lg:grid-cols-2">
                        {group.items.map(p => {
                          const count = usage[p.id] ?? 0
                          return (
                            <li key={p.id} data-structure-position={p.id} className="flex items-center gap-3 border-b border-gray-50 px-4 py-2">
                              <div className="min-w-0 flex-1">
                                <p className="break-words text-sm font-semibold leading-6 text-gray-800">{p.name}</p>
                                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                                  <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 font-bold text-indigo-600">{ROLE_TH[p.role] ?? p.role}</span>
                                  {p.department_id ? (
                                    <span data-position-scope="locked" className="rounded-full bg-amber-50 px-1.5 py-0.5 font-bold text-amber-700">🔒 ล็อกกอง</span>
                                  ) : group.department ? (
                                    <span data-position-scope="shared" className="rounded-full bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700">ใช้ได้ทุกกอง</span>
                                  ) : null}
                                  <span className={`inline-flex items-center gap-1 font-semibold ${count > 0 ? 'text-gray-500' : 'text-amber-700'}`}
                                    title={count > 0 ? `มีผู้ถือตำแหน่ง ${count} คน` : 'ยังไม่มีใครถือตำแหน่งนี้'}>
                                    <Users size={12} /> {count} คน
                                  </span>
                                </div>
                                {!p.department_id && p.department_hint && !group.department && (
                                  <p className="mt-0.5 text-xs leading-5 text-gray-500">
                                    กองที่มักสังกัด: {p.department_hint} (ระบบเติมให้ตอนแต่งตั้ง เปลี่ยนได้)
                                  </p>
                                )}
                              </div>
                              {canManage && (
                                <button type="button" onClick={() => openEdit(p)} aria-label={`แก้ไขตำแหน่ง ${p.name}`}
                                  className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg bg-gray-50 px-3 text-gray-600 transition-colors hover:bg-gray-100">
                                  <Pencil size={15} /> <span className="text-sm">แก้ไข</span>
                                </button>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}

      {departmentDialog !== null && (
        <DepartmentDialog tenant={tenant} department={departmentDialog.id ? departmentDialog : null} departments={departments}
          onClose={() => setDepartmentDialog(null)} onSaved={departmentSaved} />
      )}

      {editing !== null && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center"
          role="dialog" aria-modal="true" aria-labelledby="position-edit-title">
          <div className="bg-white w-full md:max-w-md md:rounded-3xl rounded-t-3xl max-h-[93vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 shrink-0">
              <button onClick={() => setEditing(null)} disabled={saving || deleting} aria-label="ปิด"
                className="flex min-h-11 min-w-11 items-center justify-center rounded-xl hover:bg-gray-100 text-gray-500"><X size={18} /></button>
              <p id="position-edit-title" className="font-bold text-gray-800">{editing?.id ? 'แก้ไขตำแหน่ง' : 'เพิ่มตำแหน่งใหม่'}</p>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5">
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">ชื่อตำแหน่ง *</label>
                <input type="text" value={form.name} onChange={e => changeName(e.target.value)}
                  className={inputCls} placeholder="เช่น เจ้าพนักงานธุรการชำนาญงาน" />
              </div>
              <div>
                <label htmlFor="position-department" className="text-xs font-semibold text-gray-500 mb-1 block">กองหลัก</label>
                <select id="position-department" value={form.home_department_id}
                  onChange={e => setForm(f => ({ ...f, home_department_id: e.target.value, locked: e.target.value ? f.locked : false }))}
                  disabled={saving} className={inputCls}>
                  <option value="">— ไม่ระบุกองหลัก (ตำแหน่งทั่วไป) —</option>
                  {departments.map(department => (
                    <option key={department.id} value={department.id} disabled={department.is_active === false}>
                      {department.name}{department.is_active === false ? ' (ปิดใช้งาน)' : ''}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs leading-5 text-gray-500">
                  ใช้จัดกลุ่มตำแหน่งในหน้านี้ และระบบเติมกองนี้ให้ตอนแต่งตั้ง (เปลี่ยนเป็นกองอื่นได้) — ไม่บังคับใคร
                </p>
                <button type="button" role="switch" aria-checked={form.locked} data-position-lock
                  onClick={() => setForm(f => ({ ...f, locked: !f.locked, lock_touched: true }))}
                  disabled={saving || !form.home_department_id}
                  className={`mt-2 flex min-h-11 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50 ${
                    form.locked ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-gray-200 bg-white text-gray-600'}`}>
                  <span className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${form.locked ? 'bg-amber-500' : 'bg-gray-300'}`}>
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${form.locked ? 'left-[18px]' : 'left-0.5'}`} />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-bold">🔒 ล็อกกอง: ผู้ถือตำแหน่งนี้ทุกคนต้องอยู่กองหลัก</span>
                    <span className="block text-xs leading-5 opacity-80">เฉพาะหัวหน้าหน่วยงานที่มีได้กองเดียว เช่น ผู้อำนวยการกอง หัวหน้าสำนักปลัด</span>
                  </span>
                </button>
                {form.locked && form.name.trim() && !isUnitHeadPositionName(form.name) && (
                  <p className="mt-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-xs leading-5 text-amber-800">
                    ชื่อนี้ไม่ใช่หัวหน้าหน่วยงานระดับกอง ถ้าตำแหน่งนี้มีได้หลายกอง (เช่น ธุรการ จ้างเหมา)
                    ให้ปิดล็อก — ตำแหน่งยังอยู่ใต้กองหลักเหมือนเดิม แต่คนกองอื่นใช้ได้ด้วย
                  </p>
                )}
              </div>
              {departmentChanged && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-800" role="status">
                  <p className="font-bold">{targetDepartmentName ? `ย้ายตำแหน่งไป ${targetDepartmentName}` : 'เปลี่ยนเป็นตำแหน่งที่ใช้ได้ทุกกอง'}</p>
                  <p className="mt-1">
                    {formDepartmentId
                      ? `ผู้ถือตำแหน่ง ${editingHolderCount} คนจะใช้กองนี้ โดยบทบาทระบบเดิมคงไว้ คนที่ย้ายกองจะถูกยกเลิกสถานะหัวหน้ากองเดิม`
                      : `ผู้ถือตำแหน่ง ${editingHolderCount} คนยังคงกองปัจจุบัน ไม่ล้างสังกัดเดิม — กองเดิมจะเป็นกองที่ระบบเติมให้ตอนแต่งตั้ง`}
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
                    <p className="mt-1 text-xs leading-5 text-gray-500">เป็นคำแนะนำเท่านั้น ระบบไม่เพิ่มสิทธิ์ให้บุคลากรโดยอัตโนมัติ</p>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">ลำดับการแสดงผล</label>
                    <input type="number" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} className={inputCls} />
                  </div>
                </div>
              </details>
              {editing?.id && canManage && (
                editingHolderCount > 0 ? (
                  <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-600" data-position-delete-blocked>
                    ลบไม่ได้: ยังมีบุคลากร {editingHolderCount} คนถือตำแหน่งนี้ ย้ายคนเหล่านั้นไปตำแหน่งอื่นที่แท็บ “เจ้าหน้าที่” ก่อน
                  </p>
                ) : (
                  <button type="button" onClick={() => handleDelete(editing)} disabled={saving || deleting} data-position-delete
                    className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-red-50 text-sm font-bold text-red-600 hover:bg-red-100 disabled:opacity-50">
                    {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} ลบตำแหน่งนี้
                  </button>
                )
              )}
              {saveError && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">{saveError}</p>}
            </div>
            <div className="px-4 pb-6 pt-3 border-t border-gray-100 shrink-0">
              <button onClick={handleSave} disabled={saving || deleting || !form.name.trim()}
                className="w-full min-h-11 py-3.5 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50 text-sm active:scale-[0.98] transition-all"
                style={{ backgroundColor: '#1e293b' }}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                {departmentChanged
                  ? (formDepartmentId ? 'ยืนยันย้ายตำแหน่งและบุคลากร' : 'ยืนยันเปลี่ยนเป็นใช้ได้ทุกกอง')
                  : editing?.id ? 'บันทึกการแก้ไข' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
