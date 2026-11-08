// เพิ่ม/แก้โครงการในทะเบียนของแผนพัฒนา + วงเงินรายปี (ตามช่วงปีของแผน) + ประวัติ
// ช่องที่ล็อกเป็น disabled พร้อมเหตุผลสั้นๆ — ฐานข้อมูลยังเป็นตัวกันสุดท้าย (local_dev_plan_projects_guard / _years_guard)
// คนที่ไม่ใช่ผู้จัดการแผนเห็นอ่านอย่างเดียว (RLS ไม่ให้เขียนอยู่แล้ว ปุ่มที่กดแล้วล้มคือภาระเปล่า)
import { useState } from 'react'
import { Loader2, Lock, Trash2 } from 'lucide-react'
import { deleteProject, friendlyError, saveProject, saveProjectYears } from '../../../lib/localPlanApi'
import { formatBaht, parseAmountInput } from '../../../lib/localPlanView'
import { Sheet } from '../../patientTransport/StaffShell'
import { Field } from '../construction/ui'
import { btnGhost, btnPrimary, inp } from '../construction/uiStyles'
import PlanHistory from './PlanHistory'

const sameAmount = (a, b) => (a === null || a === undefined ? null : Number(a)) === (b === null || b === undefined ? null : Number(b))

/**
 * project = null → เพิ่มโครงการใหม่ · years = แถววงเงินรายปีของโครงการนี้ [{ fiscal_year, amount }]
 * locked = โครงการถูกรายการในแผนการดำเนินงานที่ประกาศแล้วอ้างอยู่
 * onSaved({ keepOpen }) · onDeleted()
 */
export default function DevProjectSheet({ tenant, plan, project, years, departments, isManager, locked, onClose, onSaved, onDeleted }) {
  const isNew = !project
  const planPublished = plan.status === 'published'
  const original = Boolean(project) && Number(project.added_in_revision) === 0
  // โครงการเดิมของแผนที่ประกาศแล้ว หรือที่แผนดำเนินงานประกาศอ้างอยู่ = ชื่อ/รหัส/ยุทธศาสตร์/สถานะ/วงเงิน แก้ไม่ได้ (เปลี่ยนกองกับหมายเหตุได้)
  const frozenReason = !isNew && planPublished && original
    ? 'โครงการในแผนที่ประกาศใช้แล้ว — แก้ได้เฉพาะกองผู้รับผิดชอบและหมายเหตุ'
    : !isNew && locked ? 'โครงการนี้ถูกอ้างในแผนการดำเนินงานที่ประกาศแล้ว — แก้ได้เฉพาะกองผู้รับผิดชอบและหมายเหตุ' : ''
  const frozen = Boolean(frozenReason)
  const readOnly = !isManager
  // แผนประกาศแล้ว: โครงการใหม่/โครงการที่เพิ่มภายหลังต้องมีครั้งที่เพิ่มเติม ≥ 1 + เลขที่ประกาศ (ข้อ 22) · แผนร่างต้องเป็น 0 (RPC ประกาศบังคับ)
  const needsRevision = planPublished && (isNew || !original)

  const existingYears = Object.fromEntries((years ?? []).map(y => [y.fiscal_year, y.amount]))
  const planYears = Array.from({ length: plan.year_to - plan.year_from + 1 }, (_, i) => plan.year_from + i)
  const [form, setForm] = useState(() => ({
    official_name: project?.official_name ?? '', project_code: project?.project_code ?? '', strategy: project?.strategy ?? '',
    department_id: project?.department_id ?? '', status: project?.status ?? 'active', note: project?.note ?? '',
    added_in_revision: project ? String(project.added_in_revision) : (planPublished ? '1' : '0'), revision_ref_no: project?.revision_ref_no ?? '',
  }))
  const [yearRows, setYearRows] = useState(() => Object.fromEntries(planYears.map(y => [y, {
    on: y in existingYears, amount: existingYears[y] === null || existingYears[y] === undefined ? '' : String(existingYears[y]),
  }])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [historyKey, setHistoryKey] = useState(0)
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }))
  const setYear = (y, patch) => setYearRows(rows => ({ ...rows, [y]: { ...rows[y], ...patch } }))

  const save = async () => {
    if (readOnly || busy) return
    if (!form.official_name.trim()) return setError('ระบุชื่อทางการของโครงการ')
    if (needsRevision) {
      const n = Number(form.added_in_revision)
      if (!Number.isInteger(n) || n < 1 || n > 99) return setError('ระบุครั้งที่ของการเพิ่มเติม/เปลี่ยนแปลงแผน (1–99)')
      if (!form.revision_ref_no.trim()) return setError('ระบุเลขที่ประกาศการเพิ่มเติม/เปลี่ยนแปลงแผน')
    }
    // วงเงินรายปี: ส่งเฉพาะปีที่เปลี่ยน (ฐานข้อมูลปฏิเสธการเขียนวงเงินของโครงการที่ล็อกแล้วแม้ค่าเท่าเดิม)
    const upserts = []
    const removes = []
    if (!frozen) {
      for (const y of planYears) {
        const row = yearRows[y]
        const had = y in existingYears
        if (row.on) {
          const parsed = parseAmountInput(row.amount)
          if (parsed.error) return setError(`ปี ${y}: ${parsed.error}`)
          if (!had || !sameAmount(existingYears[y], parsed.value)) upserts.push({ fiscal_year: y, amount: parsed.value })
        } else if (had) removes.push(y)
      }
    }
    setBusy(true); setError('')
    const columns = { ...form, added_in_revision: needsRevision ? Number(form.added_in_revision) : (project?.added_in_revision ?? 0), revision_ref_no: needsRevision ? form.revision_ref_no : (project?.revision_ref_no ?? '') }
    const saved = await saveProject(plan.id, columns, project?.id ?? null)
    if (saved.error) { setBusy(false); return setError(friendlyError(saved.error)) }
    const yearResult = await saveProjectYears(saved.project.id, { upserts, removes })
    setBusy(false)
    if (yearResult.error) {
      // โครงการบันทึกแล้วแต่วงเงินไม่ติด — บอกตรงๆ ให้กดบันทึกซ้ำ ไม่บอกว่าสำเร็จ
      onSaved({ keepOpen: true, projectId: saved.project.id })
      return setError(`บันทึกโครงการแล้ว แต่วงเงินรายปีไม่สำเร็จ — ${friendlyError(yearResult.error)}`)
    }
    setHistoryKey(k => k + 1)
    onSaved({ keepOpen: false, projectId: saved.project.id })
  }

  const remove = async () => {
    if (!project || busy || !window.confirm(`ลบโครงการ "${project.official_name}" ออกจากทะเบียน?\n\nลบแล้วกู้คืนไม่ได้ (ประวัติยังเหลือไว้ตรวจสอบ)`)) return
    setBusy(true); setError('')
    const { error: deleteError } = await deleteProject(project.id)
    setBusy(false)
    if (deleteError) return setError(friendlyError(deleteError))
    onDeleted()
  }

  const canDelete = isManager && !isNew && !locked && !(planPublished && original)

  return (
    <Sheet title={isNew ? 'เพิ่มโครงการในทะเบียน' : project.official_name} subtitle={isNew ? 'ทะเบียนโครงการ' : (project.project_code ? `รหัส ${project.project_code}` : 'ทะเบียนโครงการ')} onClose={onClose} busy={busy} wide>
      <div className="space-y-3 text-gray-800">
        {readOnly && <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600">ดูได้อย่างเดียว — แก้ทะเบียนได้เฉพาะนักวิเคราะห์นโยบายและแผนที่ได้รับสิทธิ์ หรือแอดมิน</p>}
        {frozen && !readOnly && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900"><Lock size={14} className="mt-0.5 shrink-0" aria-hidden="true" />{frozenReason}</p>
        )}
        <Field label="ชื่อทางการของโครงการ *">
          <textarea className={inp} rows={2} value={form.official_name} maxLength={1000} disabled={readOnly || frozen} onChange={e => set('official_name', e.target.value)} />
          <span className="mt-1 block text-xs text-gray-500">แผนการดำเนินงานที่ผูกโครงการนี้ใช้ชื่อนี้เสมอ (ชื่อตรงกันทุกเอกสาร) · แก้ชื่อแล้วฉบับร่างที่ผูกอยู่เปลี่ยนตามให้เอง</span>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="รหัส/ลำดับในบัญชีโครงการ">
            <input className={inp} value={form.project_code} maxLength={50} disabled={readOnly || frozen} onChange={e => set('project_code', e.target.value)} />
          </Field>
          <Field label="สถานะโครงการ">
            <select className={inp} value={form.status} disabled={readOnly || frozen} onChange={e => set('status', e.target.value)}>
              <option value="active">ใช้งาน</option>
              <option value="dropped">ตัดออก/ยกเลิก</option>
            </select>
          </Field>
          <Field label="ยุทธศาสตร์/ประเด็นการพัฒนา" className="sm:col-span-2">
            <input className={inp} value={form.strategy} maxLength={500} disabled={readOnly || frozen} onChange={e => set('strategy', e.target.value)} />
          </Field>
          <Field label="กองผู้รับผิดชอบ" className="sm:col-span-2">
            <select className={inp} value={form.department_id} disabled={readOnly} onChange={e => set('department_id', e.target.value)}>
              <option value="">— ยังไม่ระบุกอง —</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
        </div>

        {needsRevision && (
          <div className="grid gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-3 sm:grid-cols-2">
            <p className="text-xs text-gray-700 sm:col-span-2">แผนประกาศใช้แล้ว: โครงการใหม่เพิ่มได้เฉพาะเมื่อมีการเพิ่มเติม/เปลี่ยนแปลงแผน (ข้อ 22) — ระบุครั้งที่และเลขที่ประกาศ</p>
            <Field label="เพิ่มเติม/เปลี่ยนแปลงแผนครั้งที่ *">
              <input className={inp} inputMode="numeric" value={form.added_in_revision} disabled={readOnly || frozen} onChange={e => set('added_in_revision', e.target.value.replace(/\D/g, '').slice(0, 2))} />
            </Field>
            <Field label="เลขที่ประกาศการเพิ่มเติม/เปลี่ยนแปลง *">
              <input className={inp} value={form.revision_ref_no} maxLength={200} disabled={readOnly || frozen} onChange={e => set('revision_ref_no', e.target.value)} />
            </Field>
          </div>
        )}

        <div className="rounded-2xl border border-gray-200 p-3">
          <p className="text-sm font-bold text-gray-900">วงเงินรายปี (บาท)</p>
          <p className="mb-2 text-xs text-gray-500">ติ๊ก "มีในปีนี้" แล้วใส่วงเงิน · ติ๊กแต่เว้นวงเงินว่าง = มีในปีนี้แต่ยังไม่ระบุวงเงิน · เอาติ๊กออก = ลบแถวปีนั้น</p>
          <ul className="space-y-2">
            {planYears.map(y => (
              <li key={y} className="flex flex-wrap items-center gap-2">
                <label className="flex min-h-11 w-40 shrink-0 items-center gap-2 text-sm font-semibold">
                  <input type="checkbox" className="size-5" checked={yearRows[y].on} disabled={readOnly || frozen} onChange={e => setYear(y, { on: e.target.checked })} />
                  ปีงบ {y}
                </label>
                <input className={`${inp} min-w-0 flex-1 basis-40`} inputMode="decimal" aria-label={`วงเงินปี ${y}`} placeholder="ยังไม่ระบุวงเงิน"
                  value={yearRows[y].amount} disabled={readOnly || frozen || !yearRows[y].on} onChange={e => setYear(y, { amount: e.target.value })} />
              </li>
            ))}
          </ul>
          {frozen && (years ?? []).length > 0 && (
            <p className="mt-2 text-xs text-gray-500">วงเงินที่บันทึกไว้: {years.map(y => `${y.fiscal_year}: ${formatBaht(y.amount)}`).join(' · ')}</p>
          )}
        </div>

        <Field label="หมายเหตุ">
          <textarea className={inp} rows={2} value={form.note} maxLength={4000} disabled={readOnly} onChange={e => set('note', e.target.value)} />
        </Field>

        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {isManager && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`${btnPrimary} flex-1`} style={{ backgroundColor: 'var(--color-primary)' }} onClick={save} disabled={busy}>
              {busy && <Loader2 size={16} className="animate-spin" />}{isNew ? 'เพิ่มโครงการ' : 'บันทึก'}
            </button>
            {canDelete && <button type="button" className={`${btnGhost} text-red-700`} onClick={remove} disabled={busy}><Trash2 size={15} />ลบ</button>}
            <button type="button" className={btnGhost} onClick={onClose} disabled={busy}>ปิด</button>
          </div>
        )}

        {!isNew && <PlanHistory tenantId={tenant.id} entityId={project.id} departments={departments} reloadKey={historyKey} title="ประวัติโครงการ" />}
      </div>
    </Sheet>
  )
}
