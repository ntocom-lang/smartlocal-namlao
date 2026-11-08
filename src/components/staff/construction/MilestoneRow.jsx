// แถวจุดตรวจ 1 จุดในกล่อง "ต้องทำตามระเบียบ" — กดบรรทัดแล้วช่องกรอกโผล่ใต้บรรทัดนั้น (ช่องตาม spec.fields)
// ไม่มีสิทธิ์เขียน = แสดงอย่างเดียว ไม่มีปุ่ม/ช่อง · คีย์ managerOnly แก้ได้เฉพาะ access.manage (ฐานข้อมูลบังคับซ้ำที่ civil_milestones_guard)
import { useState } from 'react'
import { CheckCircle2, ChevronDown, Circle, Loader2 } from 'lucide-react'
import { Field } from './ui'
import { btnGhost, btnPrimary, inp } from './uiStyles'
import { DEADLINE_TONE, VERIFY_TEXT, deadlineStatusText, moneyTh, thaiDay } from './lifecycleFormat'
import { LevelIcon } from './LifecycleBits'

const FIELD_LABELS = {
  done_on: 'วันที่เกิดขึ้นจริง',
  ref_no: 'เลขที่หนังสือ / เลขอ้างอิง',
  ref_date: 'ลงวันที่',
  amount: 'ยอดเงิน (บาท)',
  link: 'ลิงก์ประกาศ (https://…)',
  note: 'รายละเอียด',
}

const draftOf = (spec, row) => Object.fromEntries(spec.fields.map(f => [f, row?.[f] ?? '']))

/** สรุปค่าที่บันทึกไว้เป็นข้อความบรรทัดเดียว */
function summaryOf(spec, row) {
  if (!row) return ''
  const parts = []
  if (spec.fields.includes('done_on') && row.done_on) parts.push(thaiDay(row.done_on))
  if (row.ref_no) parts.push(`เลขที่ ${row.ref_no}${row.ref_date ? ` ลว. ${thaiDay(row.ref_date)}` : ''}`)
  else if (row.ref_date) parts.push(`ลว. ${thaiDay(row.ref_date)}`)
  if (row.amount !== null && row.amount !== undefined && row.amount !== '') parts.push(`${moneyTh(row.amount)} บาท`)
  if (row.link) parts.push('มีลิงก์ประกาศ')
  if (row.note) parts.push(String(row.note).length > 60 ? `${String(row.note).slice(0, 60)}…` : row.note)
  return parts.join(' · ')
}

export default function MilestoneRow({ spec, row, deadline, canEdit, managerOnlyBlocked, onSave, onClear }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(() => draftOf(spec, row))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const recorded = Boolean(row)
  const done = Boolean(row?.done_on) || (recorded && !spec.fields.includes('done_on'))
  const summary = summaryOf(spec, row)

  const toggle = () => {
    if (!open) { setDraft(draftOf(spec, row)); setError('') }
    setOpen(!open)
  }
  const run = async action => {
    setBusy(true); setError('')
    const result = await action()
    setBusy(false)
    if (result?.error) { setError(result.message || result.error.message || 'เกิดข้อผิดพลาด'); return }
    setOpen(false)
  }

  const head = (
    <>
      {done ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" aria-label="บันทึกแล้ว" role="img" />
        : <Circle size={18} className="mt-0.5 shrink-0 text-gray-300" aria-label="ยังไม่บันทึก" role="img" />}
      <span className="min-w-0 flex-1">
        <span className="font-semibold text-gray-900">{spec.label}</span>
        {summary ? <span className="mt-0.5 block text-xs text-gray-600">{summary}</span>
          : <span className="mt-0.5 block text-xs text-gray-400">ยังไม่บันทึก</span>}
        {deadline && (
          <span className={`mt-0.5 block text-xs ${deadline.state === 'overdue' ? 'font-bold text-red-700' : 'text-gray-600'}`}>
            ภายใน {thaiDay(deadline.due)}{deadlineStatusText(deadline) ? ` — ${deadlineStatusText(deadline)}` : ''}
            {deadline.verify && <span className="ml-1 text-amber-700">({VERIFY_TEXT})</span>}
          </span>
        )}
        {spec.basis && <span className="mt-0.5 block text-[11px] text-gray-400">{spec.basis}</span>}
        {managerOnlyBlocked && <span className="mt-0.5 block text-[11px] text-amber-700">บันทึกได้เฉพาะหัวหน้ากองหรือผู้ดูแลระบบ</span>}
      </span>
      {spec.egp && <span className="shrink-0 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-700">ออกจาก e-GP — บันทึกเลขที่</span>}
      {canEdit && <ChevronDown size={16} aria-hidden="true" className={`mt-1 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />}
    </>
  )

  return (
    <li className={`px-4 py-2.5 text-sm ${deadline ? DEADLINE_TONE[deadline.state] ?? '' : ''}`}>
      {canEdit
        ? <button type="button" aria-expanded={open} onClick={toggle} className="flex min-h-11 w-full items-start gap-2 text-left">{head}</button>
        : <div className="flex items-start gap-2">{head}</div>}
      {canEdit && open && (
        <div className="mt-2 space-y-3 rounded-xl bg-gray-50 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {spec.fields.map(f => (
              <Field key={f} label={FIELD_LABELS[f]} className={f === 'note' || f === 'link' ? 'sm:col-span-2' : ''}>
                {f === 'note'
                  ? <textarea className={inp} rows={3} maxLength={4000} value={draft.note} onChange={e => setDraft(d => ({ ...d, note: e.target.value }))} />
                  : <input className={inp} value={draft[f]}
                    type={f === 'done_on' || f === 'ref_date' ? 'date' : f === 'link' ? 'url' : 'text'}
                    inputMode={f === 'amount' ? 'decimal' : undefined} maxLength={f === 'ref_no' ? 200 : f === 'link' ? 1000 : undefined}
                    onChange={e => setDraft(d => ({ ...d, [f]: e.target.value }))} />}
              </Field>
            ))}
          </div>
          {error && <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700"><LevelIcon level="error" size={14} />{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} disabled={busy} onClick={() => run(() => onSave(spec.key, draft))}>
              {busy && <Loader2 size={16} className="animate-spin" />}บันทึก
            </button>
            <button type="button" className={btnGhost} disabled={busy} onClick={() => setOpen(false)}>ยกเลิก</button>
            {recorded && <button type="button" className={`${btnGhost} text-red-600`} disabled={busy} onClick={() => run(() => onClear(spec.key))}>ล้างค่า</button>}
          </div>
        </div>
      )}
    </li>
  )
}
