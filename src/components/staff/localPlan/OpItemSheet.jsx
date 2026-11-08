// เพิ่ม/แก้รายการในแผนการดำเนินงาน
// ผู้จัดการแก้ได้ทุกช่อง · กองผู้รับผิดชอบเห็นเฉพาะ "เดือน + หมายเหตุ" ให้แก้ ที่เหลือ disabled (ตรงกับ trigger local_op_plan_items_guard)
// ผูกโครงการทะเบียน → ชื่อรายการ = ชื่อทางการเสมอ (ฐานข้อมูลตั้งให้ ช่องชื่อจึง disabled) · โครงการจากหน่วยงานอื่น (source = external) ไม่ผูกทะเบียน
import { useMemo, useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { FISCAL_MONTHS_TH } from '../../../lib/fiscalYear'
import { createOpItem, deleteOpItem, friendlyError, updateOpItem } from '../../../lib/localPlanApi'
import { validateSpan } from '../../../lib/localPlanCalendar'
import { canEditItem, formatBaht, nextSeqNo, parseAmountInput } from '../../../lib/localPlanView'
import { Sheet } from '../../patientTransport/StaffShell'
import { Field } from '../construction/ui'
import { btnGhost, btnPrimary, inp } from '../construction/uiStyles'
import PlanHistory from './PlanHistory'

const emptyToNull = v => (v === '' || v === null || v === undefined ? null : v)

/**
 * item = null → เพิ่มรายการใหม่ (ผู้จัดการเท่านั้น) · opPlan = ฉบับที่กำลังแก้ · items = รายการทั้งฉบับ (ไว้หาเลขที่ถัดไป/โครงการที่อยู่ในแผนแล้ว)
 * projects/years = ทะเบียนของแผนพัฒนาเดียวกัน · onSaved() / onDeleted()
 */
export default function OpItemSheet({ tenant, profile, isManager, opPlan, item, items, projects, years, departments, onClose, onSaved, onDeleted }) {
  const isNew = !item
  const rights = isNew ? { months: isManager, note: isManager, all: isManager } : canEditItem({ isManager, role: profile?.role, myDepartmentId: profile?.department_id ?? null, item, opPlan })
  const canAny = rights.all || rights.months || rights.note
  const fy = opPlan.fiscal_year

  // วงเงินของปีงบนี้ต่อโครงการ — ไว้เรียงโครงการที่มีวงเงินปีนี้ขึ้นก่อน และเติมงบให้เมื่อเลือก
  const amountOf = useMemo(() => {
    const map = {}
    for (const y of years) if (y.fiscal_year === fy) map[y.project_id] = y.amount
    return map
  }, [years, fy])
  const usedProjectIds = useMemo(() => new Set(items.filter(i => i.id !== item?.id && i.dev_project_id).map(i => i.dev_project_id)), [items, item])
  const projectChoices = useMemo(() => projects
    .filter(p => p.status === 'active' || p.id === item?.dev_project_id)
    .map(p => ({ p, inYear: p.id in amountOf, used: usedProjectIds.has(p.id) }))
    .sort((a, b) => (Number(b.inYear) - Number(a.inYear)) || (Number(a.used) - Number(b.used)) || String(a.p.project_code ?? '').localeCompare(String(b.p.project_code ?? ''), 'th', { numeric: true })),
  [projects, amountOf, usedProjectIds, item])

  const [form, setForm] = useState(() => ({
    source: item?.source ?? 'local', external_agency: item?.external_agency ?? '', dev_project_id: item?.dev_project_id ?? '',
    item_name: item?.item_name ?? '', amount: item?.amount === null || item?.amount === undefined ? '' : String(item.amount),
    seq_no: item ? (item.seq_no === null ? '' : String(item.seq_no)) : String(nextSeqNo(items)),
    department_id: item?.department_id ?? '', month_from: item?.month_from ? String(item.month_from) : '', month_to: item?.month_to ? String(item.month_to) : '',
    note: item?.note ?? '',
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [historyKey, setHistoryKey] = useState(0)
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }))
  const linked = Boolean(form.dev_project_id)

  const pickProject = id => {
    const project = projects.find(p => p.id === id)
    setForm(f => ({
      ...f,
      dev_project_id: id,
      source: id ? 'local' : f.source,
      // เลือกจากทะเบียน = ดึงกองและวงเงินของปีนี้มาเป็นค่าตั้งต้น (ผู้จัดการแก้ต่อได้) — เฉพาะตอนเพิ่มใหม่ ไม่ทับค่าที่กรอกไว้แล้วของรายการเดิม
      ...(isNew && project ? {
        item_name: project.official_name,
        department_id: project.department_id ?? '',
        amount: amountOf[id] === null || amountOf[id] === undefined ? '' : String(amountOf[id]),
      } : {}),
      ...(id && project ? { item_name: project.official_name } : {}),
    }))
  }

  const save = async () => {
    if (!canAny || busy) return
    const spanError = validateSpan(emptyToNull(form.month_from), emptyToNull(form.month_to))
    if (rights.months && spanError) return setError(spanError)
    setBusy(true); setError('')
    let result
    if (rights.all) {
      const name = linked ? (projects.find(p => p.id === form.dev_project_id)?.official_name ?? form.item_name) : form.item_name.trim()
      if (!name) { setBusy(false); return setError('ระบุชื่อรายการ หรือเลือกโครงการจากทะเบียน') }
      if (form.source === 'external' && !form.external_agency.trim()) { setBusy(false); return setError('ระบุหน่วยงานเจ้าของโครงการ') }
      const amount = parseAmountInput(form.amount)
      if (amount.error) { setBusy(false); return setError(amount.error) }
      const seq = emptyToNull(form.seq_no.trim())
      if (seq !== null && !/^\d{1,4}$/.test(seq)) { setBusy(false); return setError('ที่ ต้องเป็นเลข 1–9999 (หรือเว้นว่าง)') }
      if (seq !== null && (Number(seq) < 1)) { setBusy(false); return setError('ที่ ต้องเป็นเลข 1–9999 (หรือเว้นว่าง)') }
      const columns = {
        source: form.source, external_agency: form.source === 'external' ? form.external_agency.trim() : null,
        dev_project_id: form.source === 'local' ? emptyToNull(form.dev_project_id) : null,
        item_name: name, amount: amount.value, seq_no: seq === null ? null : Number(seq),
        department_id: emptyToNull(form.department_id), month_from: form.month_from ? Number(form.month_from) : null,
        month_to: form.month_to ? Number(form.month_to) : null, note: emptyToNull(form.note.trim()),
      }
      result = isNew
        ? await createOpItem(opPlan.id, tenant.id, { ...columns, sort_order: (Math.max(0, ...items.map(i => Number(i.sort_order) || 0)) + 10) })
        : await updateOpItem(item.id, columns)
    } else {
      // กองผู้รับผิดชอบ: ส่งเฉพาะช่องที่ฐานข้อมูลให้แก้ (ส่งช่องอื่นมา = ถูกปฏิเสธทั้งคำสั่ง)
      result = await updateOpItem(item.id, {
        month_from: form.month_from ? Number(form.month_from) : null, month_to: form.month_to ? Number(form.month_to) : null,
        note: emptyToNull(form.note.trim()),
      })
    }
    setBusy(false)
    if (result.error) return setError(friendlyError(result.error))
    setHistoryKey(k => k + 1)
    onSaved()
  }

  const remove = async () => {
    if (!item || busy || !window.confirm(`ลบรายการ "${item.item_name}" ออกจากแผนการดำเนินงานฉบับนี้?`)) return
    setBusy(true); setError('')
    const { error: deleteError } = await deleteOpItem(item.id)
    setBusy(false)
    if (deleteError) return setError(friendlyError(deleteError))
    onDeleted()
  }

  const monthOptions = FISCAL_MONTHS_TH.map((m, i) => <option key={m.label} value={i + 1}>{m.label}</option>)
  const allOff = !rights.all
  const readOnlyNote = opPlan.status === 'published'
    ? 'แผนการดำเนินงานฉบับนี้ประกาศแล้ว แก้รายการไม่ได้ — ทำฉบับเพิ่มเติม/แก้ไขครั้งถัดไป'
    : !canAny ? 'ดูได้อย่างเดียว — แก้ได้เฉพาะนักวิเคราะห์ฯ ที่ได้รับสิทธิ์จัดการแผน แอดมิน หรือเจ้าหน้าที่กองผู้รับผิดชอบรายการนี้ (เดือนและหมายเหตุ)' : ''

  return (
    <Sheet title={isNew ? 'เพิ่มรายการในแผนการดำเนินงาน' : item.item_name} subtitle={`ปีงบ ${fy}`} onClose={onClose} busy={busy} wide>
      <div className="space-y-3 text-gray-800">
        {readOnlyNote && <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600">{readOnlyNote}</p>}
        {canAny && !rights.all && <p className="rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-900">กองผู้รับผิดชอบแก้ได้เฉพาะเดือนดำเนินการและหมายเหตุ — ช่องอื่น (ชื่อ งบประมาณ กอง) ให้นักวิเคราะห์ฯ แก้</p>}

        <Field label="แหล่งของโครงการ">
          <select className={inp} value={form.source} disabled={allOff} onChange={e => setForm(f => ({ ...f, source: e.target.value, dev_project_id: e.target.value === 'external' ? '' : f.dev_project_id }))}>
            <option value="local">โครงการของ อปท. (ผูกทะเบียนโครงการได้)</option>
            <option value="external">โครงการของหน่วยงานอื่น</option>
          </select>
        </Field>
        {form.source === 'external' && (
          <Field label="หน่วยงานเจ้าของโครงการ *">
            <input className={inp} value={form.external_agency} maxLength={300} disabled={allOff} onChange={e => set('external_agency', e.target.value)} />
          </Field>
        )}
        {form.source === 'local' && (
          <Field label="ผูกโครงการในทะเบียน">
            <select className={inp} value={form.dev_project_id} disabled={allOff} onChange={e => pickProject(e.target.value)}>
              <option value="">— ไม่ผูกทะเบียน (พิมพ์ชื่อเอง) —</option>
              {projectChoices.map(({ p, inYear, used }) => (
                <option key={p.id} value={p.id}>
                  {[p.project_code, p.official_name].filter(Boolean).join(' · ')}{inYear ? ` — งบปี ${fy}: ${formatBaht(amountOf[p.id])}` : ''}{used ? ' (อยู่ในฉบับนี้แล้ว)' : ''}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-gray-500">โครงการที่มีวงเงินของปี {fy} อยู่ก่อน · ผูกแล้วชื่อรายการใช้ชื่อทางการในทะเบียนเสมอ</span>
          </Field>
        )}
        <Field label="ชื่อรายการ / โครงการ *">
          <textarea className={inp} rows={2} value={linked ? (projects.find(p => p.id === form.dev_project_id)?.official_name ?? form.item_name) : form.item_name}
            maxLength={1000} disabled={allOff || linked} onChange={e => set('item_name', e.target.value)} />
          {linked && <span className="mt-1 block text-xs text-gray-500">ผูกทะเบียนแล้ว — แก้ชื่อที่ทะเบียนโครงการ</span>}
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="งบประมาณ (บาท)">
            <input className={inp} inputMode="decimal" value={form.amount} disabled={allOff} onChange={e => set('amount', e.target.value)} />
          </Field>
          <Field label="ที่ (ลำดับที่พิมพ์)">
            <input className={inp} inputMode="numeric" value={form.seq_no} disabled={allOff} onChange={e => set('seq_no', e.target.value.replace(/\D/g, '').slice(0, 4))} />
          </Field>
          <Field label="ผู้รับผิดชอบ (กอง)">
            <select className={inp} value={form.department_id} disabled={allOff} onChange={e => set('department_id', e.target.value)}>
              <option value="">— ยังไม่ระบุกอง —</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="เดือนเริ่ม">
            <select className={inp} value={form.month_from} disabled={!rights.months} onChange={e => set('month_from', e.target.value)}>
              <option value="">— ยังไม่ระบุ —</option>{monthOptions}
            </select>
          </Field>
          <Field label="เดือนสิ้นสุด">
            <select className={inp} value={form.month_to} disabled={!rights.months} onChange={e => set('month_to', e.target.value)}>
              <option value="">— ยังไม่ระบุ —</option>{monthOptions}
            </select>
          </Field>
        </div>
        <Field label="หมายเหตุ">
          <textarea className={inp} rows={2} value={form.note} maxLength={2000} disabled={!rights.note} onChange={e => set('note', e.target.value)} />
        </Field>

        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {canAny && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`${btnPrimary} flex-1`} style={{ backgroundColor: 'var(--color-primary)' }} onClick={save} disabled={busy}>
              {busy && <Loader2 size={16} className="animate-spin" />}{isNew ? 'เพิ่มรายการ' : 'บันทึก'}
            </button>
            {rights.all && !isNew && <button type="button" className={`${btnGhost} text-red-700`} onClick={remove} disabled={busy}><Trash2 size={15} />ลบ</button>}
            <button type="button" className={btnGhost} onClick={onClose} disabled={busy}>ปิด</button>
          </div>
        )}

        {!isNew && <PlanHistory tenantId={tenant.id} entityId={item.id} departments={departments} reloadKey={historyKey} title="ประวัติรายการ" />}
      </div>
    </Sheet>
  )
}
