// รายการขยายเวลา / งดหรือลดค่าปรับ / แก้ไขสัญญา (PR-C2) — กดรายการแล้วฟอร์มโผล่ใต้รายการนั้น
// ⚠️ ระบบไม่อนุมัติเอง: "ผลพิจารณา" คือข้อเท็จจริงตามหนังสือที่ผู้มีอำนาจลงนามแล้ว บันทึกได้เฉพาะหัวหน้ากอง/ผู้ดูแลระบบ (ฐานข้อมูลบังคับที่ civil_manage_columns_guard)
//    วันสิ้นสุดใหม่ที่ระบบคำนวณให้เป็นแค่ข้อเสนอ แก้ได้ · ไม่เขียนทับค่าที่กรอกแล้ว · ขยายเวลาที่อนุมัติแล้วจะไปนับใน contractSchedule() เอง
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertOctagon, ChevronDown, Loader2 } from 'lucide-react'
import { addDays } from '../../../lib/complaintReportPeriods'
import { CHANGE_KINDS, RULES, contractSchedule } from '../../../lib/constructionLifecycle'
import { deleteChange, recordHistory, saveChange } from '../../../lib/constructionLifecycleApi'
import {
  CHANGE_DECISIONS, CHANGE_FIELDS, CHANGE_LOCKED_COLUMNS, CHANGE_MANAGER_COLUMNS, MANAGER_ONLY_NOTE, changeDraft, changeFieldApplies, historyNote, suggestedNewEnd,
} from '../../../lib/constructionInstallmentForm'
import SpecGrid from './LifecycleFields'
import { btnGhost, btnPrimary } from './uiStyles'
import { deadlineStatusText, moneyTh, thaiDay } from './lifecycleFormat'

const BADGE = 'inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold'
const REQUEST_SPECS = CHANGE_FIELDS.filter(f => CHANGE_LOCKED_COLUMNS.includes(f.key))
const RESULT_SPECS = CHANGE_FIELDS.filter(f => !CHANGE_LOCKED_COLUMNS.includes(f.key))
const CHANGE_RULE_NOTE = 'ระบบไม่อนุมัติเอง — บันทึกตามหนังสือที่ผู้มีอำนาจลงนามแล้ว · ม.102 / ข้อ 182 (ต้องยืนยันกับระเบียบฉบับปัจจุบัน)'

function summaryOf(ch) {
  const parts = []
  if (ch.kind === 'extend_time' && ch.requested_days !== null && ch.requested_days !== undefined) parts.push(`ขอ ${ch.requested_days} วัน`)
  if (ch.ref_no) parts.push(`หนังสือเลขที่ ${ch.ref_no}${ch.ref_date ? ` ลว. ${thaiDay(ch.ref_date)}` : ''}`)
  if (ch.decision === 'approved') {
    if (ch.kind === 'extend_time') parts.push(`อนุมัติ ${ch.approved_days ?? '—'} วัน${ch.new_end_date ? ` · สิ้นสุดใหม่ ${thaiDay(ch.new_end_date)}` : ''}`)
    else if (ch.kind === 'amend_contract' && ch.amount_change !== null && ch.amount_change !== undefined) parts.push(`วงเงินเปลี่ยน ${moneyTh(ch.amount_change)} บาท`)
  }
  return parts.join(' · ')
}

function ChangeForm({ project, bundle, row, manage, onClose, onChanged }) {
  const [draft, setDraft] = useState(() => (row ? changeDraft(row) : { ...changeDraft(null), kind: 'extend_time' }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const decided = Boolean(row?.decision)

  const locked = useMemo(() => {
    const set = new Set()
    if (!manage) {
      CHANGE_MANAGER_COLUMNS.forEach(k => set.add(k))
      if (decided) CHANGE_LOCKED_COLUMNS.forEach(k => set.add(k))
    }
    return set
  }, [manage, decided])
  const hidden = useMemo(() => new Set(CHANGE_FIELDS.filter(f => !changeFieldApplies(draft.kind, f.key)).map(f => f.key)), [draft.kind])

  // วันสิ้นสุดที่ใช้อยู่ "ไม่นับรายการนี้เอง" — ไม่งั้นแก้รายการที่อนุมัติแล้วจะบวกวันซ้ำ
  const baseEnd = useMemo(
    () => contractSchedule({ ...bundle, changes: (bundle.changes ?? []).filter(c => c.id !== row?.id) }).effectiveEnd,
    [bundle, row?.id],
  )
  const endHint = suggestedNewEnd(baseEnd, draft.approved_days)
  const extras = {
    new_end_date: endHint && draft.new_end_date !== endHint ? (
      <button type="button" className="mt-1 min-h-9 rounded-lg border border-teal-200 bg-teal-50 px-2.5 text-xs font-semibold text-teal-800"
        onClick={() => setDraft(d => ({ ...d, new_end_date: endHint }))}>
        ใช้ค่าที่ระบบคำนวณ: {thaiDay(endHint)} (สิ้นสุดเดิม {thaiDay(baseEnd)} + {Number(draft.approved_days)} วัน)
      </button>
    ) : null,
  }
  const change = (key, value) => setDraft(d => ({ ...d, [key]: value }))

  const run = async action => {
    setBusy(true); setError('')
    const result = await action()
    setBusy(false)
    if (result.error) { setError(result.message || result.error.message || 'เกิดข้อผิดพลาด'); return null }
    return result
  }
  const save = async () => {
    const result = await run(() => saveChange(project.id, draft, row, { manage }))
    if (!result) return
    await recordHistory(project.id, historyNote('change', row, result.row))
    await onChanged?.()
    onClose()
  }
  const remove = async () => {
    const result = await run(() => deleteChange(row.id))
    if (!result) return
    await recordHistory(project.id, historyNote('change_delete', row, null))
    await onChanged?.()
    onClose()
  }

  return (
    <div className="space-y-3 text-left">
      {decided && !manage && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">บันทึกผลพิจารณาแล้ว ให้หัวหน้ากองหรือผู้ดูแลระบบแก้</p>}
      <fieldset className="rounded-xl border border-gray-200 bg-white p-3">
        <legend className="px-1 text-xs font-bold text-gray-700">คำขอของผู้รับจ้าง</legend>
        <SpecGrid specs={REQUEST_SPECS} draft={draft} onChange={change} locked={locked} hidden={hidden} />
      </fieldset>
      <fieldset className="rounded-xl border border-gray-200 bg-white p-3">
        <legend className="px-1 text-xs font-bold text-gray-700">ผลพิจารณาของผู้มีอำนาจ</legend>
        <p className="mb-2 text-[11px] text-gray-500">{CHANGE_RULE_NOTE}</p>
        {!manage && <p className="mb-2 text-[11px] text-amber-700">ผลพิจารณา: {MANAGER_ONLY_NOTE}</p>}
        <SpecGrid specs={RESULT_SPECS} draft={draft} onChange={change} locked={locked} hidden={hidden} extras={extras} />
      </fieldset>
      {error && <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700"><AlertOctagon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} disabled={busy} onClick={save}>
          {busy && <Loader2 size={16} className="animate-spin" />}บันทึก
        </button>
        <button type="button" className={btnGhost} disabled={busy} onClick={onClose}>ยกเลิก</button>
        {manage && row && !confirming && <button type="button" className={`${btnGhost} text-red-600`} disabled={busy} onClick={() => setConfirming(true)}>ลบรายการนี้</button>}
      </div>
      {confirming && (
        <div role="alertdialog" aria-label="ยืนยันลบรายการ" className="flex flex-wrap items-center gap-2 rounded-xl bg-red-50 px-3 py-2">
          <p className="min-w-0 flex-1 basis-56 text-sm text-red-800">ลบรายการ "{CHANGE_KINDS[row.kind] ?? 'แก้ไขสัญญา'}" นี้ — ถ้าเป็นการขยายเวลาที่อนุมัติแล้ว วันสิ้นสุดสัญญาจะกลับไปตามเดิม</p>
          <button type="button" className={`${btnGhost} border-red-300 text-red-700`} disabled={busy} onClick={remove}>ยืนยันลบ</button>
          <button type="button" className={btnGhost} disabled={busy} onClick={() => setConfirming(false)}>ไม่ลบ</button>
        </div>
      )}
    </div>
  )
}

/** adding = หน้าจอสั่งเปิดฟอร์มรายการใหม่ (ปุ่ม "ขยายเวลา / แก้ไขสัญญา…" ท้ายหน้า) · onAddingDone เรียกเมื่อฟอร์มใหม่ปิด */
export default function ContractChangesPanel({ bundle, access, deadlines = [], adding = false, onAddingDone, onChanged, initialOpenId = null }) {
  const project = bundle.project
  const canWrite = Boolean(access.write || access.manage)
  const manage = Boolean(access.manage)
  const [openId, setOpenId] = useState(initialOpenId)
  const topRef = useRef(null)
  // กดปุ่มเพิ่มจากท้ายหน้า ฟอร์มอยู่สูงกว่าปุ่มหลายส่วน — เลื่อนให้เห็น
  useEffect(() => { if (adding) topRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }) }, [adding])
  const changes = [...(bundle.changes ?? [])].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
  if (!changes.length && !adding) return null

  // กำหนด "แจ้งภายใน 15 วัน" (ข้อ 182) ของแต่ละรายการ — deadlines() ไม่ผูก id จึงจับคู่ด้วยวันครบกำหนด + ชนิด
  const requestDeadline = ch => (ch.cause_ended_on
    ? deadlines.find(d => d.key === 'change_request' && d.due === addDays(ch.cause_ended_on, RULES.changeRequestDays) && d.label.endsWith(CHANGE_KINDS[ch.kind] ?? ''))
    : null)

  return (
    <section ref={topRef} className="rounded-2xl border border-gray-200" aria-label="ขยายเวลาและแก้ไขสัญญา">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3">
        <b className="text-sm text-gray-900">ขยายเวลา / งดหรือลดค่าปรับ / แก้ไขสัญญา</b>
        <span className="text-xs text-gray-500">{changes.length} รายการ</span>
      </div>
      <ul className="divide-y divide-gray-100">
        {adding && (
          <li className="px-4 py-2.5 text-sm">
            <p className="mb-2 font-semibold text-gray-900">รายการใหม่</p>
            <div className="rounded-xl bg-gray-50 p-3">
              <ChangeForm key="new" project={project} bundle={bundle} row={null} manage={manage} onClose={() => onAddingDone?.()} onChanged={onChanged} />
            </div>
          </li>
        )}
        {changes.map(ch => {
          const open = openId === ch.id
          const dl = requestDeadline(ch)
          const head = (
            <>
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-gray-900">{CHANGE_KINDS[ch.kind] ?? ch.kind}</span>
                {summaryOf(ch) && <span className="mt-0.5 block text-xs text-gray-600">{summaryOf(ch)}</span>}
                {dl && (
                  <span className={`mt-0.5 block text-xs ${dl.state === 'late_done' || dl.state === 'overdue' ? 'font-bold text-amber-700' : 'text-gray-500'}`}>
                    ผู้รับจ้างต้องแจ้งภายใน 15 วันนับถัดจากเหตุสิ้นสุด (ข้อ 182): ภายใน {thaiDay(dl.due)}{deadlineStatusText(dl) ? ` — ${deadlineStatusText(dl)}` : ''} · ข้อมูลประกอบการพิจารณา
                  </span>
                )}
              </span>
              {ch.decision
                ? <span className={`${BADGE} ${ch.decision === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{CHANGE_DECISIONS[ch.decision]}</span>
                : <span className={`${BADGE} bg-amber-100 text-amber-800`}>รอผลพิจารณา</span>}
              {canWrite && <ChevronDown size={16} aria-hidden="true" className={`mt-1 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />}
            </>
          )
          return (
            <li key={ch.id} className="px-4 py-2.5 text-sm">
              {canWrite
                ? <button type="button" aria-expanded={open} onClick={() => setOpenId(open ? null : ch.id)} className="flex min-h-11 w-full items-start gap-2 text-left">{head}</button>
                : <div className="flex items-start gap-2">{head}</div>}
              {canWrite && open && (
                <div className="mt-2 rounded-xl bg-gray-50 p-3">
                  <ChangeForm key={`${ch.id}-${ch.updated_at ?? ''}`} project={project} bundle={bundle} row={ch} manage={manage} onClose={() => setOpenId(null)} onChanged={onChanged} />
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <p className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-500">{CHANGE_RULE_NOTE}</p>
    </section>
  )
}
