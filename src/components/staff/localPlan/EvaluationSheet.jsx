// ข้อมูลรายงานติดตามและประเมินผลประจำปีงบ (ผู้จัดการแผนเท่านั้น — RLS) · ตารางสรุปคำนวณจากแผน+ผลตอนแสดง ไม่กรอกซ้ำ
// ยอดเบิกจ่าย = ตัวเลขรวมทั้งปี "ช่องเดียว" จากระบบบัญชี e-LAAS (ระบบนี้ไม่มีข้อมูลการเงิน) ต้องระบุ "ณ วันที่" เสมอ — ไม่เก็บรายโครงการ
// วันที่ 4 ช่อง = ข้อเท็จจริงที่คนทำแล้ว (ระบบแค่นับ 15 วันให้) · ข้อสังเกต/ข้อเสนอแนะ = คณะกรรมการเขียนเอง ระบบไม่เขียนแทน (ข้อ 29)
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { bangkokIsoDate } from '../../../lib/complaintReportPeriods'
import { friendlyError, saveEvaluation } from '../../../lib/localPlanApi'
import { PDPA_FREE_TEXT_WARNING } from '../../../lib/localPlanProgress'
import { parseAmountInput } from '../../../lib/localPlanView'
import { Sheet } from '../../patientTransport/StaffShell'
import { Field } from '../construction/ui'
import { btnGhost, btnPrimary, inp } from '../construction/uiStyles'

const DEFAULT_SOURCE = 'ระบบ e-LAAS'

const DATE_FIELDS = [
  ['committee_met_on', 'วันที่คณะกรรมการติดตามและประเมินผลประชุม'],
  ['reported_to_exec_on', 'วันที่คณะกรรมการรายงานผลต่อผู้บริหารท้องถิ่น'],
  ['presented_on', 'วันที่ผู้บริหารเสนอต่อสภาท้องถิ่นและคณะกรรมการพัฒนาท้องถิ่น'],
  ['announced_on', 'วันที่ประกาศผลให้ประชาชนทราบ'],
]

/** evaluation = แถวเดิมของปีงบนี้ หรือ null (สร้างใหม่) · onSaved() = ให้ผู้เรียกโหลดข้อมูลใหม่ */
export default function EvaluationSheet({ tenant, fiscalYear, evaluation, onClose, onSaved }) {
  const today = bangkokIsoDate()
  const [form, setForm] = useState(() => ({
    disbursed_total: evaluation?.disbursed_total === null || evaluation?.disbursed_total === undefined ? '' : String(evaluation.disbursed_total),
    disbursed_as_of: evaluation?.disbursed_as_of ?? '',
    disbursed_source: evaluation ? (evaluation.disbursed_source ?? '') : DEFAULT_SOURCE,
    committee_met_on: evaluation?.committee_met_on ?? '',
    reported_to_exec_on: evaluation?.reported_to_exec_on ?? '',
    presented_on: evaluation?.presented_on ?? '',
    announced_on: evaluation?.announced_on ?? '',
    announce_ref_no: evaluation?.announce_ref_no ?? '',
    observations: evaluation?.observations ?? '',
    recommendations: evaluation?.recommendations ?? '',
    note: evaluation?.note ?? '',
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }))

  const save = async () => {
    if (busy) return
    const total = parseAmountInput(form.disbursed_total)
    if (total.error) return setError(total.error.replace('งบประมาณ', 'ยอดเบิกจ่าย'))
    if (total.value !== null && !form.disbursed_as_of) return setError('ใส่ยอดเบิกจ่ายแล้วต้องระบุ "ณ วันที่" ด้วย')
    if (form.disbursed_as_of && form.disbursed_as_of > today) return setError('"ณ วันที่" ต้องไม่เกินวันนี้')
    for (const [key, label] of DATE_FIELDS) {
      if (form[key] && form[key] > today) return setError(`${label} ต้องไม่เกินวันนี้ (บันทึกสิ่งที่ทำแล้วเท่านั้น)`)
    }
    setBusy(true); setError('')
    // ยอดว่าง → ล้างคู่ "ณ วันที่"/แหล่ง ด้วย (ฐานข้อมูลบังคับว่ามียอดต้องมีวันที่ · วันที่ลอยๆ ไม่มีความหมาย)
    const hasTotal = total.value !== null
    const { error: saveError } = await saveEvaluation(tenant.id, fiscalYear, {
      disbursed_total: total.value,
      disbursed_as_of: hasTotal ? form.disbursed_as_of : null,
      disbursed_source: hasTotal ? form.disbursed_source.trim() : null,
      committee_met_on: form.committee_met_on, reported_to_exec_on: form.reported_to_exec_on,
      presented_on: form.presented_on, announced_on: form.announced_on,
      announce_ref_no: form.announce_ref_no.trim(), observations: form.observations.trim(),
      recommendations: form.recommendations.trim(), note: form.note.trim(),
    }, evaluation?.id ?? null)
    setBusy(false)
    if (saveError) return setError(friendlyError(saveError))
    onSaved()
  }

  const PDPA = <span className="mt-1 block text-[11px] font-normal text-amber-700">{PDPA_FREE_TEXT_WARNING}</span>

  return (
    <Sheet title={`รายงานติดตามและประเมินผล ปีงบ ${fiscalYear}`} subtitle="ข้อมูลประกอบรายงานประจำปี" onClose={onClose} busy={busy} wide>
      <div className="space-y-4 text-gray-800">
        <section className="space-y-3 rounded-2xl border border-gray-200 p-3">
          <p className="text-sm font-bold text-gray-900">ยอดเบิกจ่ายรวมทั้งปี</p>
          <p className="text-xs text-gray-500">ตัวเลขรวมทั้งปีช่องเดียวจากระบบบัญชี (เช่น e-LAAS) — ระบบนี้ไม่มีข้อมูลการเงิน จึงไม่เก็บรายโครงการ</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="ยอดเบิกจ่ายรวม (บาท)">
              <input className={inp} inputMode="decimal" value={form.disbursed_total} onChange={e => set('disbursed_total', e.target.value)} />
            </Field>
            <Field label="ณ วันที่ *">
              <input type="date" className={inp} value={form.disbursed_as_of} max={today} onChange={e => set('disbursed_as_of', e.target.value)} />
            </Field>
            <Field label="ที่มาของตัวเลข">
              <input className={inp} value={form.disbursed_source} maxLength={300} onChange={e => set('disbursed_source', e.target.value)} />
            </Field>
          </div>
        </section>

        <section className="space-y-3 rounded-2xl border border-gray-200 p-3">
          <p className="text-sm font-bold text-gray-900">ขั้นตอนการรายงาน (ข้อ 29)</p>
          <p className="text-xs text-gray-500">กรอกวันที่เมื่อทำแล้วจริง — ระบบนับกำหนดประกาศผล 15 วันนับแต่วันเสนอให้ (เตือนเท่านั้น)</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {DATE_FIELDS.map(([key, label]) => (
              <Field key={key} label={label}>
                <input type="date" className={inp} value={form[key]} max={today} onChange={e => set(key, e.target.value)} />
              </Field>
            ))}
            <Field label="เลขที่ประกาศผล" className="sm:col-span-2">
              <input className={inp} value={form.announce_ref_no} maxLength={200} onChange={e => set('announce_ref_no', e.target.value)} />
            </Field>
          </div>
        </section>

        <section className="space-y-3 rounded-2xl border border-gray-200 p-3">
          <p className="text-sm font-bold text-gray-900">ข้อสังเกตและข้อเสนอแนะของคณะกรรมการ</p>
          <Field label="ข้อสังเกต">
            <textarea className={inp} rows={4} value={form.observations} maxLength={8000} onChange={e => set('observations', e.target.value)} />
            {PDPA}
          </Field>
          <Field label="ข้อเสนอแนะ">
            <textarea className={inp} rows={4} value={form.recommendations} maxLength={8000} onChange={e => set('recommendations', e.target.value)} />
            {PDPA}
          </Field>
          <Field label="หมายเหตุ">
            <textarea className={inp} rows={2} value={form.note} maxLength={4000} onChange={e => set('note', e.target.value)} />
          </Field>
        </section>

        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${btnPrimary} flex-1`} style={{ backgroundColor: 'var(--color-primary)' }} onClick={save} disabled={busy}>
            {busy && <Loader2 size={16} className="animate-spin" />}บันทึก
          </button>
          <button type="button" className={btnGhost} onClick={onClose} disabled={busy}>ปิด</button>
        </div>
      </div>
    </Sheet>
  )
}
