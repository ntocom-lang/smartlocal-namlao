import { useMemo, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { Sheet } from '../../patientTransport/StaffShell'
import { fiscalYearOf } from '../../../lib/fiscalYear'
import {
  PEOPLE_GROUPS, ROAD_WORK_PRESETS, round2, validateItems,
} from '../../../lib/constructionReport'
import {
  PROJECT_STATUSES, PROJECT_TYPES, ROAD_SURFACES, friendlyError, saveProject,
} from '../../../lib/constructionReportApi'
import { Field, Problems, Section } from './ui'
import { btnGhost, btnPrimary, inp } from './uiStyles'

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
    project_no: project?.project_no ?? '',
    fiscal_year: project?.fiscal_year ?? String(fiscalYearOf()),
    project_type: project?.project_type ?? 'road',
    status: project?.status ?? 'in_progress',
    location_desc: project?.location_desc ?? '',
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
    road_type: spec.road_type ?? '',
    length_km: spec.length_km ?? '',
    width_m: spec.width_m ?? '',
    sections,
  }
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
          <Field label="สถานะโครงการ"><select className={inp} value={form.status} onChange={e => set('status', e.target.value)} disabled={!editBase}>
            {PROJECT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select></Field>
          <Field label="ปีงบประมาณ (พ.ศ.)"><input className={inp} inputMode="numeric" value={form.fiscal_year} onChange={e => set('fiscal_year', e.target.value)} disabled={!editBase} maxLength={4} /></Field>
          <Field label="เลขที่โครงการ"><input className={inp} value={form.project_no} onChange={e => set('project_no', e.target.value)} disabled={!editBase} maxLength={60} /></Field>
          <Field label="สถานที่ก่อสร้าง" className="sm:col-span-2"><input className={inp} value={form.location_desc} onChange={e => set('location_desc', e.target.value)} disabled={!editBase} maxLength={300} placeholder="เช่น ซอยข้างวัด หมู่ 3 ต.…" /></Field>
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
