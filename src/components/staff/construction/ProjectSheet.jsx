import { useEffect, useMemo, useState } from 'react'
import { Link2, Loader2, Plus, Trash2, Unlink } from 'lucide-react'
import { Sheet } from '../../patientTransport/StaffShell'
import { fiscalYearOf } from '../../../lib/fiscalYear'
import {
  PEOPLE_GROUPS, ROAD_WORK_PRESETS, round2, validateItems,
} from '../../../lib/constructionReport'
import { GUARANTEE_TYPES, PRICE_KINDS, STAGE_LABELS, WORK_GROUPS, initialStageOptions } from '../../../lib/constructionLifecycle'
import { lifecycleFormDefaults, validateLifecycleForm } from '../../../lib/constructionContractForm'
import {
  PROJECT_TYPES, ROAD_SURFACES, friendlyError, saveProject,
} from '../../../lib/constructionReportApi'
import { fetchRegistryForLinking } from '../../../lib/localPlanApi'
import { normalizeProjectName, suggestRegistryMatches } from '../../../lib/localPlanProgress'
import { Field, Problems, Section } from './ui'
import { btnGhost, btnPrimary, inp, lbl } from './uiStyles'

const Hint = ({ children }) => <span className="mt-1 block text-[11px] font-normal text-teal-700">{children}</span>
const ExternalTag = () => <span className="ml-1 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-700">ออกจาก e-GP</span>

const emptyPerson = (grp, index) => ({
  key: `new-${grp}-${index}-${Math.random().toString(36).slice(2, 7)}`,
  name: '', position_title: '', duty: PEOPLE_GROUPS.find(g => g.key === grp)?.defaultDuties[index] ?? '', profile_id: '',
})

function initialForm(project, contract) {
  const spec = contract?.spec ?? {}
  const sections = [...(spec.sections ?? [])]
  while (sections.length < 3) sections.push({ name: '', length_km: '', surface: '' })
  return {
    title: project?.title ?? '',
    initial_stage: 'budgeted',   // ใช้เฉพาะตอนสร้าง (saveProject ส่งค่านี้ใน INSERT เท่านั้น)
    project_no: project?.project_no ?? '',
    fiscal_year: project?.fiscal_year ?? String(fiscalYearOf()),
    project_type: project?.project_type ?? 'road',
    location_desc: project?.location_desc ?? '',
    registry_ref: project?.registry_ref ?? '',   // ผูกทะเบียนโครงการแผนพัฒนาท้องถิ่น (ว่าง = ไม่ผูก)
    contract_no: project?.contract_no ?? '',
    contractor_name: project?.contractor_name ?? '',
    contract_amount: project?.contract_amount ?? '',
    budget_amount: project?.budget_amount ?? '',
    start_date: project?.start_date ?? '',
    end_date: project?.end_date ?? '',
    contract_date: contract?.contract_date ?? '',
    extended_until: contract?.extended_until ?? '',
    fine_per_day: contract?.fine_per_day ?? '',
    installments_total: contract?.installments_total ?? '',
    designer_name: contract?.designer_name ?? '',
    attach_no: contract?.attach_no ?? '',
    attach_date: contract?.attach_date ?? '',
    ...lifecycleFormDefaults(project, contract),
    road_type: spec.road_type ?? '',
    length_km: spec.length_km ?? '',
    width_m: spec.width_m ?? '',
    sections,
  }
}

/**
 * ผูกโครงการนี้กับทะเบียนโครงการของแผนพัฒนาท้องถิ่น — ผูกแล้วแท็บ "ติดตามผล" ของเมนูแผนพัฒนาฯ อ่านขั้นของโครงการนี้เป็นผลดำเนินการเอง
 * (กองไม่ต้องกรอกซ้ำ 2 ที่) · ทะเบียนโหลดเฉพาะของ อปท. ตัวเอง · โหลดไม่ได้ (ยังไม่มีแผน/ไม่มีสิทธิ์อ่าน) = ซ่อนช่องพร้อมข้อความเล็ก ไม่กระทบการบันทึก
 * ระบบเดาคู่จากชื่อ+ปีงบให้ แต่คนกดเลือกเอง (ไม่ผูกให้โดยอัตโนมัติ)
 */
function RegistryLinkField({ tenantId, form, onChange }) {
  const [state, setState] = useState({ status: 'loading', projects: [], years: [] })
  const [query, setQuery] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      const result = await fetchRegistryForLinking(tenantId)
      if (!alive) return
      setState(result.error || !result.projects.length
        ? { status: 'unavailable', projects: [], years: [] }
        : { status: 'ready', projects: result.projects, years: result.years })
    })()
    return () => { alive = false }
  }, [tenantId])

  const linked = form.registry_ref ? state.projects.find(p => p.id === form.registry_ref) : null
  const suggestions = useMemo(
    () => (form.registry_ref ? [] : suggestRegistryMatches({ title: form.title, fiscal_year: form.fiscal_year }, state.projects, state.years)),
    [form.registry_ref, form.title, form.fiscal_year, state.projects, state.years],
  )
  const found = useMemo(() => {
    const q = normalizeProjectName(query)
    if (!q) return []
    return state.projects
      .filter(p => p.status !== 'dropped' && (normalizeProjectName(p.official_name).includes(q) || String(p.project_code ?? '').toLowerCase().includes(q)))
      .slice(0, 8)
  }, [query, state.projects])

  if (state.status === 'loading') return null
  if (state.status === 'unavailable') {
    return <p className="text-xs text-gray-500 sm:col-span-2">ผูกทะเบียนโครงการแผนพัฒนาท้องถิ่นไม่ได้ในตอนนี้ (ยังไม่มีแผน หรืออ่านทะเบียนไม่ได้) — ข้ามได้ ไม่กระทบการบันทึกโครงการ</p>
  }

  const pick = id => { onChange(id); setQuery('') }
  const label = p => [p.project_code, p.official_name].filter(Boolean).join(' · ')
  // RPC ฝั่งแผนกรองปีด้วยข้อความตรงตัว: ปีที่ไม่ใช่เลข 4 หลักตรงๆ (เช่น เลขไทย/มีคำนำหน้า) จะจับคู่ไม่เจอ ผลจึงไม่ขึ้นในแท็บติดตามผล
  const yearWarn = Boolean(form.registry_ref) && !/^\d{4}$/.test(String(form.fiscal_year ?? '').trim())

  return (
    <div className="sm:col-span-2" data-testid="registry-link">
      <span className={lbl}>ผูกทะเบียนโครงการ (แผนพัฒนาท้องถิ่น)</span>
      {form.registry_ref ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
          <Link2 size={15} className="shrink-0 text-emerald-700" aria-hidden="true" />
          <span className="min-w-0 flex-1 break-words text-sm font-semibold text-gray-800">{linked ? label(linked) : 'โครงการในทะเบียน (ไม่พบในแผนที่เมนูแสดงอยู่ตอนนี้)'}</span>
          <button type="button" className={btnGhost} onClick={() => pick('')}><Unlink size={15} />เลิกผูก</button>
        </div>
      ) : (
        <div className="space-y-2">
          {suggestions.length > 0 && (
            <div className="space-y-1.5" aria-label="ระบบเดาคู่ให้">
              <p className="text-xs font-semibold text-teal-700">ระบบเดาคู่ให้ (กดเลือกถ้าถูก)</p>
              {suggestions.map(({ project, score }) => (
                <button key={project.id} type="button" onClick={() => pick(project.id)}
                  className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-left text-sm text-gray-800 hover:bg-teal-100">
                  <Link2 size={15} className="shrink-0 text-teal-700" aria-hidden="true" />
                  <span className="min-w-0 flex-1 break-words">{label(project)}</span>
                  <span className="shrink-0 text-xs text-teal-700">ใกล้เคียง {Math.round(score * 100)}%</span>
                </button>
              ))}
            </div>
          )}
          <input className={inp} value={query} onChange={e => setQuery(e.target.value)} maxLength={100} placeholder="ค้นหาโครงการในทะเบียน (ชื่อหรือรหัส)" aria-label="ค้นหาโครงการในทะเบียน" />
          {found.map(project => (
            <button key={project.id} type="button" onClick={() => pick(project.id)}
              className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50">
              <span className="min-w-0 flex-1 break-words">{label(project)}</span>
            </button>
          ))}
          {query.trim() && found.length === 0 && <p className="text-xs text-gray-500">ไม่พบโครงการที่ตรงกับคำค้น</p>}
        </div>
      )}
      <Hint>ผูกแล้ว แท็บ "ติดตามผล" ของเมนูแผนพัฒนาท้องถิ่นอ่านขั้นของโครงการนี้เป็นผลดำเนินการเอง กองไม่ต้องกรอกซ้ำ</Hint>
      {yearWarn && <span className="mt-1 block rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">⚠️ ปีงบประมาณของโครงการนี้ต้องเป็นเลข พ.ศ. 4 หลักแบบอารบิก (เช่น 2570) ไม่งั้นระบบแผนจับคู่ไม่เจอและผลจะไม่ขึ้น</span>}
    </div>
  )
}

/**
 * ตั้งค่าโครงการ — ทำครั้งเดียวตอนเริ่มโครงการ แล้วระบบเติมลงรายงานทุกสัปดาห์ให้เอง (เจ้าหน้าที่ไม่ต้องพิมพ์ซ้ำ)
 *   ทะเบียน/สัญญา → หัวบันทึกข้อความและหน้า 2 · รายการงาน+วันแผน → แผนสะสมเชิงเส้น · บุคคล → ช่องลงนาม
 * ชื่อบุคคลเก็บในตารางที่ RLS แคบ ไม่เก็บในทะเบียนโครงการเดิม (policy ของตารางนั้นอ่านได้กว้าง)
 */
export default function ProjectSheet({ tenant, profile, mode, project, bundle, access, departments, staffChoices, onClose, onSaved }) {
  const isAdmin = profile?.role === 'admin' || profile?.role === 'superadmin'
  const editBase = mode === 'create' || access.editBase
  const [form, setForm] = useState(() => initialForm(project, bundle?.contract))
  const [items, setItems] = useState(() => (bundle?.items ?? []).map(i => ({
    id: i.id, name: i.name, weight_pct: i.weight_pct, plan_start: i.plan_start ?? '', plan_end: i.plan_end ?? '',
  })))
  const [people, setPeople] = useState(() => Object.fromEntries(PEOPLE_GROUPS.map(g => {
    const rows = (bundle?.people ?? []).filter(p => p.grp === g.key).map(p => ({
      id: p.id, key: p.id, name: p.name, position_title: p.position_title, duty: p.duty, profile_id: p.profile_id ?? '',
    }))
    return [g.key, rows.length || mode === 'edit' ? rows : g.defaultDuties.map((_, i) => emptyPerson(g.key, i))]
  })))
  const [departmentId, setDepartmentId] = useState(project?.department_id ?? profile?.department_id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }))

  const itemCheck = useMemo(() => validateItems(items.map((i, n) => ({ ...i, sort_order: n }))), [items])
  const weightSum = round2(items.reduce((s, i) => s + (Number(i.weight_pct) || 0), 0))
  const hasReports = (bundle?.reports ?? []).length > 0

  const setItem = (index, patch) => setItems(rows => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  const setPerson = (grp, index, patch) => setPeople(p => ({ ...p, [grp]: p[grp].map((r, i) => (i === index ? { ...r, ...patch } : r)) }))

  const save = async () => {
    setError('')
    if (editBase && !form.title.trim()) return setError('กรอกชื่อโครงการก่อน')
    if (editBase && !/^\d{4}$/.test(String(form.fiscal_year).trim())) return setError('ปีงบประมาณต้องเป็นเลข พ.ศ. 4 หลัก เช่น 2570')
    if (items.some(i => !i.name.trim() && (Number(i.weight_pct) || i.plan_start || i.plan_end))) {
      return setError('มีรายการงานที่กรอกสัดส่วนหรือวันแล้วแต่ยังไม่ได้ตั้งชื่อ')
    }
    const invalid = validateLifecycleForm(form, { editBase })
    if (invalid) return setError(invalid)
    setBusy(true)
    const result = await saveProject({
      mode, tenantId: tenant.id, userId: profile.id, projectId: project?.id, form,
      items: items.filter(i => i.name.trim()),
      people: Object.fromEntries(Object.entries(people).map(([g, rows]) => [g, rows.filter(r => r.name.trim())])),
      existing: { items: bundle?.items ?? [], people: bundle?.people ?? [] },
      editBase,
      departmentId: mode === 'create' ? (departmentId || null) : (isAdmin ? (departmentId || null) : undefined),
    })
    setBusy(false)
    if (result.error) {
      setError(friendlyError(result.error))
      // สร้างโครงการสำเร็จแต่ขั้นหลังล้ม: พาเข้าโหมดแก้ไขของโครงการนั้น ไม่ให้กดบันทึกซ้ำแล้วได้โครงการซ้ำ
      if (result.projectId && mode === 'create') onSaved(result.projectId, { keepOpen: true })
      return
    }
    onSaved(result.projectId)
  }

  return (
    <Sheet title={mode === 'create' ? 'เพิ่มโครงการก่อสร้าง' : 'ตั้งค่าโครงการ'} subtitle={mode === 'edit' ? project?.title : 'กรอกครั้งเดียว ระบบเติมลงรายงานทุกสัปดาห์ให้'} onClose={onClose} busy={busy} wide>
      {!editBase && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">ข้อมูลทะเบียนโครงการแก้ได้เฉพาะผู้สร้างโครงการ หัวหน้ากอง หรือผู้ดูแลระบบ — คุณแก้ได้ส่วนสัญญา รายการงาน และรายชื่อบุคคล</p>}

      <Section title="ข้อมูลโครงการ" open>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="ชื่อโครงการ *" className="sm:col-span-2"><input className={inp} value={form.title} onChange={e => set('title', e.target.value)} disabled={!editBase} maxLength={300} /></Field>
          <Field label="ประเภทงาน"><select className={inp} value={form.project_type} onChange={e => set('project_type', e.target.value)} disabled={!editBase}>
            {PROJECT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            {!PROJECT_TYPES.some(t => t.value === form.project_type) && <option value={form.project_type}>{form.project_type}</option>}
          </select></Field>
          {/* ตอนสร้าง: เลือกขั้นเริ่มต้นได้ (ลงทะเบียนโครงการที่เดินมาแล้วโดยไม่ต้องกดเลื่อนทีละขั้น — เจ้าของระบบเลือก 2569-11-08)
              ฐานข้อมูลรับเฉพาะ 9 ขั้นหลัก + warranty/closed ต้องเป็นผู้จัดการ (civil_projects_stage_guard) และบันทึกประวัติ "สร้างที่ขั้น X" เอง
              ตอนแก้ไข: แสดงอย่างเดียว — เปลี่ยนขั้นที่ปุ่มในหน้าโครงการ (RPC ตรวจสิทธิ์และบันทึกประวัติ) */}
          {mode === 'create' ? (
            <Field label="ขั้นเริ่มต้นของโครงการ">
              <select className={inp} value={form.initial_stage} onChange={e => set('initial_stage', e.target.value)} data-testid="project-initial-stage">
                {initialStageOptions(['superadmin', 'admin', 'officer'].includes(profile?.role)).map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
              </select>
              <span className="mt-1 block text-xs text-gray-500">โครงการที่ดำเนินการมาแล้ว เลือกขั้นที่เป็นอยู่จริง จุดตรวจของขั้นก่อนหน้ากรอกย้อนหลังได้ในหน้าโครงการ</span>
              {/* civil_projects_delete_guard: ขั้นตั้งแต่ลงนามสัญญา = บันทึกทางราชการ ลบไม่ได้ (เจ้าของสั่ง) — บอกก่อนกดบันทึก ไม่ให้สร้างผิดแล้วลบไม่ได้ */}
              {['contracted', 'started', 'construction', 'final_inspection', 'warranty', 'closed'].includes(form.initial_stage) && (
                <span className="mt-1 block rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800" data-testid="initial-stage-permanent">
                  ⚠️ โครงการที่ลงนามสัญญาแล้วเป็นบันทึกทางราชการ บันทึกแล้วลบไม่ได้ — ตรวจชื่อและขั้นให้ถูกก่อนกดบันทึก
                </span>
              )}
            </Field>
          ) : (
            <div>
              <span className="mb-1 block text-xs font-semibold text-gray-500">ขั้นของโครงการ</span>
              <p className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm font-semibold text-gray-800" data-testid="project-stage-readonly">
                {STAGE_LABELS[project?.stage] ?? '—'}
              </p>
              <p className="mt-1 text-xs text-gray-500">เปลี่ยนขั้นที่หน้าโครงการ ไม่ใช่ที่นี่</p>
            </div>
          )}
          <Field label="ปีงบประมาณ (พ.ศ.)"><input className={inp} inputMode="numeric" value={form.fiscal_year} onChange={e => set('fiscal_year', e.target.value)} disabled={!editBase} maxLength={4} /></Field>
          <Field label="เลขที่โครงการ"><input className={inp} value={form.project_no} onChange={e => set('project_no', e.target.value)} disabled={!editBase} maxLength={60} /></Field>
          <Field label="สถานที่ก่อสร้าง" className="sm:col-span-2"><input className={inp} value={form.location_desc} onChange={e => set('location_desc', e.target.value)} disabled={!editBase} maxLength={300} placeholder="เช่น ซอยข้างวัด หมู่ 3 ต.…" /></Field>
          {editBase && <RegistryLinkField tenantId={tenant.id} form={form} onChange={id => set('registry_ref', id)} />}
          {isAdmin && (
            <Field label="กองที่รับผิดชอบ" className="sm:col-span-2">
              <select className={inp} value={departmentId} onChange={e => setDepartmentId(e.target.value)}>
                <option value="">— ไม่ระบุ (เห็นเฉพาะผู้ดูแลระบบ) —</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
          )}
        </div>
      </Section>

      <Section title="สัญญา" hint="เติมลงหัวบันทึกและหน้า 2 ของรายงานอัตโนมัติ" open={mode === 'create'}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="สัญญาเลขที่"><input className={inp} value={form.contract_no} onChange={e => set('contract_no', e.target.value)} disabled={!editBase} maxLength={80} /></Field>
          <Field label="ลงวันที่"><input type="date" className={inp} value={form.contract_date} onChange={e => set('contract_date', e.target.value)} /></Field>
          <Field label="ผู้รับจ้าง"><input className={inp} value={form.contractor_name} onChange={e => set('contractor_name', e.target.value)} disabled={!editBase} maxLength={200} /></Field>
          <Field label="ผู้ออกแบบ"><input className={inp} value={form.designer_name} onChange={e => set('designer_name', e.target.value)} maxLength={200} /></Field>
          <Field label="ราคาค่าก่อสร้าง (บาท)"><input className={inp} inputMode="decimal" value={form.contract_amount} onChange={e => set('contract_amount', e.target.value)} disabled={!editBase} /></Field>
          <Field label="วงเงินงบประมาณ (บาท)"><input className={inp} inputMode="decimal" value={form.budget_amount} onChange={e => set('budget_amount', e.target.value)} disabled={!editBase} /></Field>
          <Field label="เริ่มสัญญา วันที่"><input type="date" className={inp} value={form.start_date} onChange={e => set('start_date', e.target.value)} disabled={!editBase} /></Field>
          <Field label="สิ้นสุดสัญญา วันที่"><input type="date" className={inp} value={form.end_date} onChange={e => set('end_date', e.target.value)} disabled={!editBase} /></Field>
          <Field label="ต่อสัญญาถึง (ถ้ามี)"><input type="date" className={inp} value={form.extended_until} onChange={e => set('extended_until', e.target.value)} /></Field>
          <Field label="จำนวนงวดงาน"><input className={inp} inputMode="numeric" value={form.installments_total} onChange={e => set('installments_total', e.target.value)} /></Field>
          <Field label="ค่าปรับวันละ (บาท) — เก็บตามสัญญาเฉยๆ ระบบไม่คำนวณค่าปรับ"><input className={inp} inputMode="decimal" value={form.fine_per_day} onChange={e => set('fine_per_day', e.target.value)} /></Field>
          <Field label="บันทึกแนบท้ายที่"><input className={inp} value={form.attach_no} onChange={e => set('attach_no', e.target.value)} maxLength={60} /></Field>
          <Field label="บันทึกแนบท้าย ลงวันที่"><input type="date" className={inp} value={form.attach_date} onChange={e => set('attach_date', e.target.value)} /></Field>
        </div>
        <p className="text-xs text-gray-500">วันที่ต่อสัญญาให้กรอกตามที่ได้รับอนุมัติจริง — ระบบไม่ตัดสินเรื่องต่อสัญญา ค่าปรับ หรืองวดเงิน</p>
      </Section>

      <Section title="สัญญาและหลักประกัน (ตามแบบสัญญาจ้างก่อสร้าง)" hint="ระบบใช้คำนวณวันครบกำหนด ระยะประกัน และรายการตรวจก่อนปิดโครงการ">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="ชนิดราคา">
            <select className={inp} value={form.price_kind} onChange={e => set('price_kind', e.target.value)}>
              <option value="">— ไม่ระบุ —</option>
              {Object.entries(PRICE_KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <Hint>แสดงในหน้าโครงการ (เก็บตามสัญญา)</Hint>
          </Field>
          <Field label="กลุ่มงาน (หลักเกณฑ์ราคากลาง)">
            <select className={inp} value={form.work_group} onChange={e => set('work_group', e.target.value)} disabled={!editBase}>
              <option value="">— ไม่ระบุ —</option>
              {Object.entries(WORK_GROUPS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <Hint>เก็บเป็นข้อมูลทะเบียน แก้ได้เฉพาะผู้สร้างโครงการ หัวหน้ากอง หรือผู้ดูแลระบบ</Hint>
          </Field>

          <Field label="ชนิดหลักประกันสัญญา">
            <select className={inp} value={form.guarantee_type} onChange={e => set('guarantee_type', e.target.value)}>
              <option value="">— ไม่ระบุ —</option>
              {Object.entries(GUARANTEE_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <Hint>เลือก "ไม่มีหลักประกัน" ถ้าสัญญาไม่เรียกหลักประกัน — รายการตรวจก่อนปิดโครงการจะไม่รอ "คืนหลักประกัน"</Hint>
          </Field>
          <Field label="จำนวนเงินหลักประกัน (บาท)"><input className={inp} inputMode="decimal" value={form.guarantee_amount} onChange={e => set('guarantee_amount', e.target.value)} /></Field>
          <Field label="เลขที่หลักประกัน / หนังสือค้ำประกัน"><input className={inp} value={form.guarantee_ref} onChange={e => set('guarantee_ref', e.target.value)} maxLength={200} /></Field>
          <Field label="หลักประกันหมดอายุวันที่">
            <input type="date" className={inp} value={form.guarantee_expires_on} onChange={e => set('guarantee_expires_on', e.target.value)} />
            <Hint>ใช้เตือนเมื่อหมดอายุก่อนพ้นข้อผูกพัน (ข้อ 171)</Hint>
          </Field>

          <Field label="เงินล่วงหน้า (ร้อยละ)"><input className={inp} inputMode="decimal" value={form.advance_pct} onChange={e => set('advance_pct', e.target.value)} /></Field>
          <Field label="เงินล่วงหน้า (บาท)">
            <input className={inp} inputMode="decimal" value={form.advance_amount} onChange={e => set('advance_amount', e.target.value)} />
            <Hint>เก็บตามสัญญา ระบบยังไม่นำไปคำนวณ</Hint>
          </Field>
          <Field label="เงินประกันผลงาน (ร้อยละ)">
            <input className={inp} inputMode="decimal" value={form.retention_pct} onChange={e => set('retention_pct', e.target.value)} />
            <Hint>ถ้ามากกว่า 0 รายการตรวจก่อนปิดโครงการจะรอ "คืนเงินประกันผลงาน"</Hint>
          </Field>
          <Field label="ค่าควบคุมงานต่อวัน (บาท)">
            <input className={inp} inputMode="decimal" value={form.supervision_fee_per_day} onChange={e => set('supervision_fee_per_day', e.target.value)} />
            <Hint>ใช้ประมาณการค่าปรับ (ค่าปรับต่อวัน + ค่าควบคุมงานต่อวัน) เพื่อเตือนเมื่อใกล้เกินร้อยละ 10 — ไม่ใช่ยอดทางการ</Hint>
          </Field>

          <Field label="ระยะประกันผลงาน (เดือน)">
            <input className={inp} inputMode="numeric" value={form.warranty_months} onChange={e => set('warranty_months', e.target.value)} />
            <Hint>ใช้คำนวณระยะประกัน และเลือกช่วงตรวจความชำรุดครั้งสุดท้าย (ตั้งแต่ 6 เดือน = ก่อนครบ 30 วัน · ต่ำกว่า = 15 วัน)</Hint>
          </Field>
          <div className="hidden sm:block" aria-hidden="true" />
          <Field label="ระยะประกันเริ่มวันที่">
            <input type="date" className={inp} value={form.warranty_starts_on} onChange={e => set('warranty_starts_on', e.target.value)} />
            <Hint>เว้นว่างให้ระบบคำนวณ = วันถัดจากวันส่งมอบงวดสุดท้ายที่ตรวจรับแล้ว · ถ้ากรอกเอง ค่าที่กรอกชนะ</Hint>
          </Field>
          <Field label="ระยะประกันสิ้นสุดวันที่">
            <input type="date" className={inp} value={form.warranty_ends_on} onChange={e => set('warranty_ends_on', e.target.value)} />
            <Hint>เว้นว่างให้ระบบคำนวณ = วันเริ่ม + จำนวนเดือน − 1 วัน · ใช้คำนวณกำหนดตรวจครั้งสุดท้าย พ้นข้อผูกพัน และกำหนดคืนหลักประกัน</Hint>
          </Field>

          <Field label={<>หนังสือแจ้งให้เริ่มทำงาน — เลขที่ <ExternalTag /></>}>
            <input className={inp} value={form.notice_to_proceed_no} onChange={e => set('notice_to_proceed_no', e.target.value)} maxLength={200} />
          </Field>
          <Field label={<>หนังสือแจ้งให้เริ่มทำงาน — ลงวันที่ <ExternalTag /></>}>
            <input type="date" className={inp} value={form.notice_to_proceed_date} onChange={e => set('notice_to_proceed_date', e.target.value)} />
            <Hint>ต้องมีวันนี้ โครงการจึงพร้อมเลื่อนจาก "ลงนามสัญญา" เป็น "เริ่มงาน" ตามรายการตรวจ และใช้เป็นฐานคำนวณวันเริ่ม/สิ้นสุดสัญญา</Hint>
          </Field>
          <Field label="เริ่มงานภายใน (วัน นับถัดจากวันที่หนังสือแจ้ง)"><input className={inp} inputMode="numeric" value={form.start_within_days} onChange={e => set('start_within_days', e.target.value)} /></Field>
          <Field label="แล้วเสร็จภายใน (วัน นับถัดจากวันที่หนังสือแจ้ง)"><input className={inp} inputMode="numeric" value={form.finish_within_days} onChange={e => set('finish_within_days', e.target.value)} /></Field>
        </div>
        <p className="text-xs text-gray-500">ระบบคำนวณวันเริ่ม/สิ้นสุดสัญญาจาก "วันที่หนังสือแจ้งให้เริ่มทำงาน + จำนวนวัน" ให้เมื่อไม่ได้กรอกวันเริ่ม/สิ้นสุดสัญญาในส่วน "สัญญา" ด้านบน (ถ้ากรอกวันที่เองแล้ว ค่าที่กรอกชนะ) วันที่ที่ระบบคำนวณเองจะมีคำกำกับ "ต้องยืนยันกับระเบียบฉบับปัจจุบัน" เพราะถ้อยคำนับวันของสัญญาแต่ละฉบับต่างกันได้</p>
        <label className="flex min-h-11 items-start gap-2 rounded-xl border border-gray-200 p-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={form.operator_eval_required} disabled={!editBase}
            onChange={e => set('operator_eval_required', e.target.checked)} />
          <span>
            <span className="font-semibold">เข้าเกณฑ์ประเมินผู้ประกอบการ (ฉบับที่ 3 พ.ศ. 2569 หมวด 7) — ผู้มีอำนาจตัดสิน</span>
            <span className="block text-xs text-gray-500">ติ๊กแล้วรายการตรวจก่อนปิดโครงการจะรอ "ประเมินผู้ประกอบการใน e-GP แล้ว" · แก้ได้เฉพาะผู้สร้างโครงการ หัวหน้ากอง หรือผู้ดูแลระบบ</span>
          </span>
        </label>
      </Section>

      {form.project_type === 'road' && (
        <Section title="ลักษณะงานถนน" hint="ไม่บังคับ">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="ผิวทาง"><select className={inp} value={form.road_type} onChange={e => set('road_type', e.target.value)}>
              <option value="">— ไม่ระบุ —</option>
              {ROAD_SURFACES.map(s => <option key={s} value={s}>{s}</option>)}
            </select></Field>
            <Field label="ความยาวทั้งหมด (กม.)"><input className={inp} inputMode="decimal" value={form.length_km} onChange={e => set('length_km', e.target.value)} /></Field>
            <Field label="ความกว้าง (ม.)"><input className={inp} inputMode="decimal" value={form.width_m} onChange={e => set('width_m', e.target.value)} /></Field>
          </div>
          {form.sections.map((s, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-3">
              <Field label={`ช่วงถนนที่ ${i + 1}`}><input className={inp} value={s.name} placeholder="ชื่อ/ช่วง กม." onChange={e => set('sections', form.sections.map((x, n) => (n === i ? { ...x, name: e.target.value } : x)))} /></Field>
              <Field label="ยาว (กม.)"><input className={inp} inputMode="decimal" value={s.length_km} onChange={e => set('sections', form.sections.map((x, n) => (n === i ? { ...x, length_km: e.target.value } : x)))} /></Field>
              <Field label="ผิวทาง"><input className={inp} value={s.surface} placeholder="คสล./ลาดยาง" onChange={e => set('sections', form.sections.map((x, n) => (n === i ? { ...x, surface: e.target.value } : x)))} /></Field>
            </div>
          ))}
        </Section>
      )}

      <Section title="รายการงาน สัดส่วน และแผน" hint={`สัดส่วนรวม ${weightSum}% (ต้อง 100%)`} open={mode === 'create' || items.length === 0}>
        <p className="text-xs text-gray-500">กรอกวันเริ่ม–สิ้นสุดของแต่ละรายการครั้งเดียว ระบบคำนวณ "แผนสะสม" ให้ทุกสัปดาห์เอง (แผนเชิงเส้น — ใบรายงานจะเขียนว่าเทียบกับแผนที่ตั้งในระบบ) แก้ทับรายสัปดาห์ได้ถ้าแผนตามสัญญาไม่เป็นเส้นตรง</p>
        {items.map((item, i) => (
          <div key={item.id ?? `n${i}`} className="grid gap-2 rounded-xl border border-gray-100 p-3 sm:grid-cols-12">
            <Field label={`รายการที่ ${i + 1}`} className="sm:col-span-5"><input className={inp} value={item.name} onChange={e => setItem(i, { name: e.target.value })} maxLength={200} /></Field>
            <Field label="สัดส่วน (%)" className="sm:col-span-2"><input className={inp} inputMode="decimal" value={item.weight_pct} onChange={e => setItem(i, { weight_pct: e.target.value })} /></Field>
            <Field label="แผนเริ่ม" className="sm:col-span-2"><input type="date" className={inp} value={item.plan_start} onChange={e => setItem(i, { plan_start: e.target.value })} /></Field>
            <Field label="แผนสิ้นสุด" className="sm:col-span-2"><input type="date" className={inp} value={item.plan_end} onChange={e => setItem(i, { plan_end: e.target.value })} /></Field>
            <button type="button" aria-label={`ลบรายการที่ ${i + 1}`} className="flex min-h-11 items-center justify-center self-end rounded-xl text-red-600 hover:bg-red-50 sm:col-span-1"
              onClick={() => setItems(rows => rows.filter((_, n) => n !== i))}><Trash2 size={16} /></button>
          </div>
        ))}
        {hasReports && <p className="text-xs text-amber-700">โครงการนี้มีรายงานแล้ว — ลบรายการงานไม่ได้เมื่อมีรายงานที่ล็อกแล้ว (แก้ชื่อ/สัดส่วนแทนได้ ตัวเลขในรายงานที่ล็อกไม่ขยับ)</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnGhost} onClick={() => setItems(rows => [...rows, { name: '', weight_pct: '', plan_start: '', plan_end: '' }])}><Plus size={15} />เพิ่มรายการงาน</button>
          {form.project_type === 'road' && ROAD_WORK_PRESETS.filter(p => !items.some(i => i.name === p)).map(p => (
            <button key={p} type="button" className="min-h-9 rounded-xl border border-dashed border-gray-300 px-2.5 text-xs text-gray-600 hover:bg-gray-50"
              onClick={() => setItems(rows => [...rows, { name: p, weight_pct: '', plan_start: '', plan_end: '' }])}>+ {p}</button>
          ))}
        </div>
        <Problems problems={itemCheck} />
      </Section>

      {PEOPLE_GROUPS.map(g => (
        <Section key={g.key} title={g.title} hint={g.key === 'supervisor' ? 'ผู้ที่ผูกบัญชีไว้ เขียนรายงานของโครงการนี้ได้' : undefined}>
          {people[g.key].map((p, i) => (
            <div key={p.key} className="grid gap-2 rounded-xl border border-gray-100 p-3 sm:grid-cols-12">
              <Field label="ชื่อ-นามสกุล" className="sm:col-span-4"><input className={inp} value={p.name} onChange={e => setPerson(g.key, i, { name: e.target.value })} maxLength={150} /></Field>
              <Field label={g.positionLabel} className="sm:col-span-3"><input className={inp} value={p.position_title} onChange={e => setPerson(g.key, i, { position_title: e.target.value })} maxLength={150} /></Field>
              <Field label="หน้าที่" className="sm:col-span-4"><input className={inp} value={p.duty} onChange={e => setPerson(g.key, i, { duty: e.target.value })} maxLength={150} /></Field>
              <button type="button" aria-label="ลบแถว" className="flex min-h-11 items-center justify-center self-end rounded-xl text-red-600 hover:bg-red-50 sm:col-span-1"
                onClick={() => setPeople(all => ({ ...all, [g.key]: all[g.key].filter((_, n) => n !== i) }))}><Trash2 size={16} /></button>
              {g.key !== 'contractor_rep' && (
                <Field label="ผูกกับบัญชีเจ้าหน้าที่ในระบบ (ไม่บังคับ)" className="sm:col-span-12">
                  <select className={inp} value={p.profile_id} onChange={e => setPerson(g.key, i, { profile_id: e.target.value })}>
                    <option value="">— ไม่ผูก —</option>
                    {staffChoices.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                  </select>
                </Field>
              )}
            </div>
          ))}
          <button type="button" className={btnGhost} onClick={() => setPeople(all => ({ ...all, [g.key]: [...all[g.key], emptyPerson(g.key, all[g.key].length)] }))}><Plus size={15} />เพิ่มแถว</button>
        </Section>
      ))}

      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-gray-100 bg-white px-4 py-3 sm:-mx-5 sm:px-5">
        <button type="button" className={`${btnPrimary} flex-1`} style={{ backgroundColor: 'var(--color-primary)' }} onClick={save} disabled={busy}>
          {busy && <Loader2 size={16} className="animate-spin" />}บันทึก
        </button>
        <button type="button" className={btnGhost} onClick={onClose} disabled={busy}>ปิด</button>
      </div>
    </Sheet>
  )
}
