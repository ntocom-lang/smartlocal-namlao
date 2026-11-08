// บันทึกผลดำเนินการของ 1 รายการในแผนการดำเนินงาน (แท็บ "ติดตามผล")
// กองผู้รับผิดชอบกดเองครั้งเดียวตอนมีผล (ไม่ใช่รายงานรายเดือน) · ผู้จัดการแผนกดแทนได้ทุกกอง
// ผลเก็บตาม "สาย" ของรายการ (ฉบับแก้ไขคัดรายการเป็นแถวใหม่ ผลที่กดไว้ตามไปด้วย) · ไม่มีแถวผล = ยังไม่ดำเนินการ (เลือกค่านี้ = ลบแถว)
// ตรวจฝั่งหน้าจอให้ตรง CHECK/trigger ของฐานข้อมูล (20261110100000/100100) ก่อนส่ง — ตัวบังคับจริงคือฐานข้อมูล
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { bangkokIsoDate, thaiShortDate } from '../../../lib/complaintReportPeriods'
import { fiscalYearBounds } from '../../../lib/fiscalYear'
import { deleteProgress, fetchEvents, fetchProfileNames, friendlyError, saveProgress } from '../../../lib/localPlanApi'
import { spanLabel } from '../../../lib/localPlanCalendar'
import { PDPA_FREE_TEXT_WARNING, PROGRESS_LABELS, lineageOf, validateProgressForm } from '../../../lib/localPlanProgress'
import { formatBaht } from '../../../lib/localPlanView'
import { Sheet } from '../../patientTransport/StaffShell'
import { Field } from '../construction/ui'
import { btnGhost, btnPrimary, inp } from '../construction/uiStyles'

const STATUS_CHOICES = ['none', 'in_progress', 'done', 'not_done']

// วัน+เวลาตามเวลาไทย (ไม่ใช้โซนเวลาเครื่องเจ้าหน้าที่) — แบบเดียวกับ PlanHistory
function stamp(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(d)
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }).format(d)
  return `${thaiShortDate(day)} ${time} น.`
}

/**
 * item = แถวรายการ (ชุดที่มีผล) · progress = แถวผลเดิมของสายนี้ (หรือ null) · resolved = ผลจาก resolveItemStatus
 * onSaved() = ให้ผู้เรียกโหลดผลใหม่ · ผู้เรียกเปิดแผ่นนี้เฉพาะรายการที่กดได้ (canRecordProgress)
 */
export default function ProgressItemSheet({ tenant, item, progress, resolved, fiscalYear, departments, onClose, onSaved }) {
  const lineage = lineageOf(item)
  const today = bangkokIsoDate()
  const [form, setForm] = useState(() => ({
    status: progress?.status ?? 'none',
    started_on: progress?.started_on ?? '',
    done_on: progress?.done_on ?? '',
    reason: progress?.reason ?? '',
    note: progress?.note ?? '',
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [last, setLast] = useState(null) // { at, name } | null
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }))

  // "แก้ล่าสุด": อ่านจากประวัติ (local_plan_events entity op_progress, entity_id = ต้นสาย) ไม่ใช้ updated_by
  useEffect(() => {
    if (!progress || !tenant?.id) return undefined
    let alive = true
    ;(async () => {
      const { events, error: loadError } = await fetchEvents(tenant.id, lineage, { limit: 1 })
      if (loadError || !events[0]) return
      const names = await fetchProfileNames([events[0].actor])
      if (alive) setLast({ at: events[0].created_at, name: events[0].actor ? (names[events[0].actor] ?? 'ผู้ใช้') : 'ระบบ' })
    })()
    return () => { alive = false }
  }, [tenant?.id, lineage, progress])

  const deptName = departments.find(d => d.id === item.department_id)?.name
  const span = spanLabel(item.month_from, item.month_to)

  const save = async () => {
    if (busy) return
    const problem = validateProgressForm(form, { fiscalYear, today })
    if (problem) return setError(problem)
    setBusy(true); setError('')
    let result
    if (form.status === 'none') {
      result = progress ? await deleteProgress(lineage) : { error: null }
    } else {
      // ช่องที่ไม่เกี่ยวกับสถานะล้างทิ้ง (ไม่ทิ้งเหตุผลเก่าไว้เมื่อเปลี่ยนเป็นแล้วเสร็จ · ไม่ทิ้งวันเสร็จเมื่อเปลี่ยนเป็นกำลังดำเนินการ)
      result = await saveProgress(lineage, {
        status: form.status,
        started_on: form.started_on || null,
        done_on: form.status === 'done' ? form.done_on : null,
        reason: form.status === 'not_done' ? form.reason.trim() : null,
        note: form.note.trim() || null,
      })
    }
    setBusy(false)
    if (result.error) return setError(friendlyError(result.error))
    onSaved()
  }

  const PDPA = <span className="mt-1 block text-[11px] font-normal text-amber-700">{PDPA_FREE_TEXT_WARNING}</span>

  return (
    <Sheet title={item.item_name} subtitle={`บันทึกผลดำเนินการ · ปีงบ ${fiscalYear}`} onClose={onClose} busy={busy} wide>
      <div className="space-y-3 text-gray-800">
        <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600">
          {[deptName, span && `ช่วงตามแผน ${span}`, item.amount !== null && item.amount !== undefined && `งบ ${formatBaht(item.amount)} บาท`].filter(Boolean).join(' · ') || 'รายการในแผนการดำเนินงาน'}
        </p>
        {resolved?.civilLinkedNoStage && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
            โครงการนี้ถูกผูกกับงานก่อสร้างแล้ว แต่ไม่พบโครงการก่อสร้างของปีงบ {fiscalYear} (ระบบจับคู่ด้วยปีงบ 4 หลักตรงตัว) — กรอกผลเองได้ หรือให้กองช่างตรวจปีงบของโครงการก่อสร้าง
          </p>
        )}

        <fieldset>
          <legend className="mb-1 block text-xs font-semibold text-gray-500">ผลดำเนินการ</legend>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2" role="radiogroup" aria-label="ผลดำเนินการ">
            {STATUS_CHOICES.map(value => (
              <label key={value} className="flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 px-3 text-sm font-semibold">
                <input type="radio" name="progress-status" className="size-5" checked={form.status === value} onChange={() => set('status', value)} />
                {PROGRESS_LABELS[value]}
              </label>
            ))}
          </div>
          {form.status === 'none' && progress && <span className="mt-1 block text-xs text-gray-500">เลือกแล้วบันทึก = ลบผลที่บันทึกไว้ (กลับเป็นยังไม่ดำเนินการ) · ประวัติยังเก็บไว้</span>}
        </fieldset>

        {form.status !== 'none' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="วันที่เริ่มดำเนินการ (ไม่บังคับ)">
              <input type="date" className={inp} value={form.started_on} max={today} onChange={e => set('started_on', e.target.value)} />
            </Field>
            {form.status === 'done' && (
              <Field label="วันที่แล้วเสร็จ *">
                <input type="date" className={inp} value={form.done_on} max={today} min={fiscalYearBounds(fiscalYear).from} onChange={e => set('done_on', e.target.value)} />
                <span className="mt-1 block text-xs text-gray-500">ระบบคิดไตรมาสที่เสร็จจากวันนี้</span>
              </Field>
            )}
            {form.status === 'not_done' && (
              <Field label="เหตุผลที่ไม่ได้ดำเนินการ *" className="sm:col-span-2">
                <textarea className={inp} rows={2} value={form.reason} maxLength={2000} onChange={e => set('reason', e.target.value)} />
                {PDPA}
              </Field>
            )}
            <Field label="หมายเหตุ" className="sm:col-span-2">
              <textarea className={inp} rows={2} value={form.note} maxLength={2000} onChange={e => set('note', e.target.value)} />
              {PDPA}
            </Field>
          </div>
        )}

        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${btnPrimary} flex-1`} style={{ backgroundColor: 'var(--color-primary)' }} onClick={save} disabled={busy}>
            {busy && <Loader2 size={16} className="animate-spin" />}บันทึก
          </button>
          <button type="button" className={btnGhost} onClick={onClose} disabled={busy}>ปิด</button>
        </div>
        {last && <p className="text-xs text-gray-500">แก้ล่าสุด: {last.name} {stamp(last.at)}</p>}
      </div>
    </Sheet>
  )
}
