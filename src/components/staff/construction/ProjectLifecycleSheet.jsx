import { useMemo, useState } from 'react'
import { Check, Loader2, Settings2 } from 'lucide-react'
import { Sheet } from '../../patientTransport/StaffShell'
import { bangkokIsoDate } from '../../../lib/complaintReportPeriods'
import { daysBetween, formatPct } from '../../../lib/constructionReport'
import {
  GUARANTEE_TYPES, MILESTONES, MILESTONE_BY_KEY, PRICE_KINDS, STAGES, STAGE_LABELS, baseStage, buildProjectSteps,
  contractSchedule, deadlines, stageActions, stageOrd, stageSuggestion,
} from '../../../lib/constructionLifecycle'
import { clearMilestone, saveMilestone, setProjectStage } from '../../../lib/constructionLifecycleApi'
import ContractChangesPanel from './ContractChangesPanel'
import DefectsSection from './DefectsSection'
import DocumentsSection from './DocumentsSection'
import InstallmentsTable from './InstallmentsTable'
import LifecycleHistory from './LifecycleHistory'
import { DeadlineRow } from './LifecycleBits'
import MilestoneRow from './MilestoneRow'
import StageChangePanel, { CloseChecklist } from './StageChangePanel'
import { ScheduleBadge } from './ui'
import { btnGhost, btnPrimary } from './uiStyles'
import { DEADLINE_STAGES, actionLabel, isDangerAction, moneyTh, thaiDay, thaiText } from './lifecycleFormat'

const DOT_CLASS = {
  done: 'bg-teal-700 text-white',
  now: 'bg-white text-teal-700 ring-[3px] ring-inset ring-teal-700',
  hold: 'bg-amber-400 text-white',
  todo: 'bg-gray-200 text-gray-500',
  stop: 'bg-red-600 text-white',
}

/** เส้นขั้น 9 จุด (+ จุดแดงเมื่อยกเลิก/บอกเลิก) จาก buildProjectSteps */
function Stepper({ project, events }) {
  const steps = buildProjectSteps(project, events)
  return (
    <div className="overflow-x-auto">
      <ol className="flex min-w-[640px] items-start" aria-label="ขั้นของโครงการ">
        {steps.map((s, i) => (
          <li key={s.key} className="flex flex-1 flex-col items-center text-center" aria-current={s.state === 'now' || s.state === 'hold' ? 'step' : undefined}>
            <div className="flex w-full items-center">
              <div className={`h-0.5 flex-1 ${i === 0 ? 'bg-transparent' : s.state === 'todo' ? 'bg-gray-200' : 'bg-teal-700'}`} />
              <span className={`flex size-[26px] shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${DOT_CLASS[s.state]}`}>
                {s.state === 'done' ? <Check size={14} aria-label="ผ่านแล้ว" role="img" /> : s.state === 'hold' ? 'II' : s.state === 'stop' ? '×' : i + 1}
              </span>
              <div className={`h-0.5 flex-1 ${i === steps.length - 1 ? 'bg-transparent' : s.state === 'done' ? 'bg-teal-700' : 'bg-gray-200'}`} />
            </div>
            <p className={`mt-1 px-0.5 text-[11px] font-semibold leading-tight ${s.state === 'now' ? 'text-teal-800' : s.state === 'hold' ? 'text-amber-700' : s.state === 'stop' ? 'text-red-700' : 'text-gray-500'}`}>
              {s.label}{s.state === 'hold' ? ' (ระงับ)' : ''}
            </p>
            <p className="text-[10px] text-gray-400">{s.at ? thaiDay(s.at) : ''}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** ขั้นที่ใช้แสดงกล่อง "ต้องทำตามระเบียบ": ระงับ = ขั้นที่จำไว้ · ยกเลิก/บอกเลิก = ขั้นสุดท้ายก่อนหยุด */
function focusStage(project, events) {
  const base = baseStage(project)
  if (stageOrd(base) !== null) return base
  const last = [...(events ?? [])].filter(e => e.to_stage === project?.stage).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).at(-1)
  const from = last?.from_stage === 'suspended' ? project?.stage_before_hold : last?.from_stage
  return stageOrd(from) !== null ? from : 'budgeted'
}

function Stat({ label, value, children }) {
  return (
    <div className="rounded-xl bg-gray-50 p-3">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="text-lg font-extrabold text-gray-900">{value}</div>
      {children && <div className="mt-0.5 text-[11px] text-gray-500">{children}</div>}
    </div>
  )
}

export default function ProjectLifecycleSheet({ bundle, access, latest = null, staffChoices = [], today = bangkokIsoDate(), onClose, onChanged, onOpenSettings }) {
  const project = bundle.project
  const [change, setChange] = useState(null)
  const [showOther, setShowOther] = useState(false)
  const [addingChange, setAddingChange] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const canWrite = Boolean(access.write || access.manage)
  const focus = focusStage(project, bundle.events)
  const list = useMemo(() => deadlines(bundle, today), [bundle, today])
  const suggestion = useMemo(() => stageSuggestion(bundle, today), [bundle, today])
  // ระงับอยู่: stageActions ให้ "กลับมาดำเนินการ" ได้ทุกขั้นหลัก — ขั้นเดิมที่จำไว้ต้องขึ้นก่อน (ทดสอบบน demo แล้วปุ่มแรกเป็น "ตั้งงบ" ทำให้กดผิดขั้นได้)
  const actions = useMemo(() => {
    const list = stageActions(bundle, access)
    const hold = bundle.project?.stage === 'suspended' ? bundle.project.stage_before_hold : null
    return hold ? [...list].sort((a, b) => Number(b.kind === 'resume' && b.to === hold) - Number(a.kind === 'resume' && a.to === hold)) : list
  }, [bundle, access])
  const resumeAction = project.stage === 'suspended' ? actions.find(a => a.kind === 'resume' && a.to === project.stage_before_hold) ?? null : null
  const sched = useMemo(() => contractSchedule(bundle), [bundle])
  const rowOf = key => (bundle.milestones ?? []).find(m => m.key === key) ?? null
  const contract = bundle.contract ?? {}

  const afterChange = async () => { await onChanged?.() }
  const save = async (key, values) => {
    const result = await saveMilestone(project.id, key, values)
    if (!result.error) await afterChange()
    return result
  }
  const clear = async key => {
    const result = await clearMilestone(project.id, key)
    if (!result.error) await afterChange()
    return result
  }
  const stepDirect = async action => {
    setBusy(true); setError('')
    const result = await setProjectStage({ projectId: project.id, stage: action.to })
    setBusy(false)
    if (result.error) return setError(result.message)
    await afterChange()
  }

  const milestoneRows = stage => MILESTONES.filter(m => m.stage === stage).map(spec => (
    <MilestoneRow key={spec.key} spec={spec} row={rowOf(spec.key)} deadline={list.find(d => d.key === spec.key)}
      canEdit={canWrite && (!spec.managerOnly || Boolean(access.manage))} managerOnlyBlocked={canWrite && spec.managerOnly && !access.manage}
      onSave={save} onClear={clear} />
  ))
  const deadlineRows = stage => list
    // reminder ที่พ้นกำหนดแล้ว (lapsed) ไม่แสดง: ไม่มีช่องบันทึกว่าทำแล้ว ค้างไว้ทุกงวดจะรกโดยไม่มีอะไรให้ทำต่อ
    .filter(d => DEADLINE_STAGES[d.key]?.includes(stage) && !MILESTONE_BY_KEY[d.key] && d.state !== 'lapsed')
    .map(d => <DeadlineRow key={`${d.key}-${d.installmentNo ?? ''}-${d.due}`} deadline={d} />)
  const otherStages = STAGES.filter(s => s !== focus && (MILESTONES.some(m => m.stage === s) || list.some(d => DEADLINE_STAGES[d.key]?.includes(s) && !MILESTONE_BY_KEY[d.key])))

  const nextAction = suggestion ? actions.find(a => a.to === suggestion.to && a.kind === 'next') : null
  const subtitle = [`ปีงบ ${project.fiscal_year ?? '—'}`, project.contract_no ? `สัญญาเลขที่ ${project.contract_no}` : null, project.contractor_name].filter(Boolean).join(' · ')
  const endDays = sched.effectiveEnd ? daysBetween(today, sched.effectiveEnd) : null
  const guarantee = contract.guarantee_type
  const overall = latest?.overall
  const installments = bundle.installments ?? []
  const showInstallments = stageOrd(focus) >= stageOrd('contracted') || installments.length > 0 || Boolean(contract.installments_total)
  const paidRows = installments.filter(i => i.paid_gross !== null && i.paid_gross !== undefined && i.paid_gross !== '')
  const paidTotal = paidRows.reduce((sum, i) => sum + Number(i.paid_gross), 0)

  return (
    <Sheet title={project.title} subtitle={subtitle} onClose={onClose} busy={busy} wide>
      <div className="space-y-4 text-gray-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-gray-700">
            ขั้นปัจจุบัน: <span className="font-extrabold text-gray-900">{STAGE_LABELS[project.stage] ?? '—'}</span>
            {project.stage === 'suspended' && project.stage_before_hold ? ` (ระงับที่ขั้น "${STAGE_LABELS[project.stage_before_hold]}")` : ''}
          </p>
          {access.write && onOpenSettings && <button type="button" className={btnGhost} onClick={onOpenSettings}><Settings2 size={15} />ตั้งค่าโครงการ</button>}
        </div>

        <Stepper project={project} events={bundle.events} />

        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {suggestion && (
          <section className={`rounded-2xl border p-4 ${suggestion.ready ? 'border-emerald-200 bg-emerald-50/60' : 'border-gray-200 bg-gray-50'}`} aria-label="ข้อเสนอขั้นถัดไป">
            {suggestion.auto ? (
              <p className="text-sm text-teal-800">ระบบจะเลื่อนเป็น "<b>{suggestion.label}</b>" ให้เองเมื่อล็อกรายงานผลการก่อสร้างประจำสัปดาห์ครั้งแรก — ไม่ต้องกดเอง</p>
            ) : suggestion.ready ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="min-w-0 flex-1 basis-56 text-sm text-emerald-900">ครบตามรายการของขั้นนี้แล้ว — พร้อมเลื่อนเป็น "<b>{suggestion.label}</b>"</p>
                {nextAction ? (
                  <button type="button" disabled={busy} className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }}
                    onClick={() => (nextAction.needReason || nextAction.needRef ? setChange(nextAction) : stepDirect(nextAction))}>
                    {busy && <Loader2 size={16} className="animate-spin" />}เลื่อนเป็น "{suggestion.label}"
                  </button>
                ) : canWrite && suggestion.needManage && <p className="text-xs text-amber-700">ขั้นนี้ต้องให้หัวหน้ากองหรือผู้ดูแลระบบเป็นผู้เลื่อน</p>}
              </div>
            ) : (
              <div>
                <p className="text-sm font-semibold text-gray-800">ก่อนเลื่อนเป็น "{suggestion.label}" ยังขาด</p>
                {suggestion.to === 'closed'
                  ? <div className="mt-2"><CloseChecklist bundle={bundle} today={today} /></div>
                  : <ul className="mt-1 list-inside list-disc text-xs text-gray-700">{suggestion.missing.map(m => <li key={m}>{thaiText(m)}</li>)}</ul>}
              </div>
            )}
          </section>
        )}
        {project.stage === 'suspended' && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 px-3 py-2">
            <p className="min-w-0 flex-1 basis-56 text-sm text-amber-900">
              โครงการระงับอยู่{project.stage_before_hold ? ` ที่ขั้น "${STAGE_LABELS[project.stage_before_hold]}"` : ''} — ดำเนินการต่อต้องระบุเหตุผล
            </p>
            {resumeAction && (
              <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} data-testid="resume-hold"
                onClick={() => { setChange(resumeAction); setShowOther(false); setError('') }}>
                ดำเนินการต่อที่ขั้นเดิม
              </button>
            )}
          </div>
        )}

        {canWrite && actions.length > 0 && (
          <details className="group" open={showOther} onToggle={e => setShowOther(e.currentTarget.open)}>
            <summary className={`${btnGhost} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>เปลี่ยนขั้นอื่น…</summary>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="เปลี่ยนขั้น">
              {actions.map(a => (
                <button key={`${a.kind}-${a.to}`} type="button" className={`${btnGhost} ${isDangerAction(a) ? 'border-red-200 text-red-700' : ''}`}
                  onClick={() => { setChange(a); setShowOther(false); setError('') }}>{actionLabel(a)}</button>
              ))}
            </div>
          </details>
        )}
        {change && (
          <StageChangePanel key={`${change.kind}-${change.to}`} project={project} bundle={bundle} access={access} action={change} today={today}
            onCancel={() => setChange(null)} onDone={async () => { setChange(null); await afterChange() }} />
        )}

        <section className="rounded-2xl border border-gray-200" aria-label="ต้องทำตามระเบียบ">
          <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3">
            <b className="text-sm text-gray-900">ต้องทำตามระเบียบ — ขั้น{STAGE_LABELS[focus]}{project.stage === 'suspended' ? ' (ระงับอยู่)' : ''}</b>
            <span className="text-xs text-gray-500">ระบบนับวันครบกำหนดให้ · {canWrite ? 'กดบรรทัดเพื่อบันทึกวันที่/เลขที่' : 'แสดงอย่างเดียว'}</span>
          </div>
          {focus === 'budgeted' && <p className="border-b border-gray-100 px-4 py-2 text-xs text-gray-500">แหล่งงบประมาณ: บันทึกเพียง 1 รายการที่เป็นแหล่งงบของโครงการนี้</p>}
          <ul className="divide-y divide-gray-100">
            {milestoneRows(focus)}
            {deadlineRows(focus)}
          </ul>
          {otherStages.length > 0 && (
            <details className="border-t border-gray-100">
              <summary className="min-h-11 cursor-pointer list-none px-4 py-3 text-sm font-semibold text-gray-700 [&::-webkit-details-marker]:hidden">ดูจุดตรวจของขั้นอื่น ▾</summary>
              {otherStages.map(stage => (
                <div key={stage}>
                  <p className="bg-gray-50 px-4 py-1.5 text-xs font-bold text-gray-600">ขั้น{STAGE_LABELS[stage]}</p>
                  <ul className="divide-y divide-gray-100">{milestoneRows(stage)}{deadlineRows(stage)}</ul>
                </div>
              ))}
            </details>
          )}
        </section>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="ผลงานจริงสะสม" value={overall ? formatPct(overall.actual) : '—'}>
            {overall ? <>สัปดาห์ที่ {latest.week_no} · แผน {formatPct(overall.plan)} <ScheduleBadge label={overall.label} /></> : 'ยังไม่มีรายงานที่ล็อก'}
          </Stat>
          <Stat label={`วงเงินสัญญา${contract.price_kind ? ` (${PRICE_KINDS[contract.price_kind]})` : ''}`} value={moneyTh(project.contract_amount)}>
            {[project.budget_amount ? `วงเงินงบประมาณ ${moneyTh(project.budget_amount)}` : null, paidRows.length ? `จ่ายแล้ว ${moneyTh(paidTotal)}` : null].filter(Boolean).join(' · ')}
          </Stat>
          <Stat label="สิ้นสุดสัญญา" value={sched.effectiveEnd ? thaiDay(sched.effectiveEnd) : '—'}>
            {sched.effectiveEnd ? [
              endDays >= 0 ? `เหลือ ${endDays} วัน` : `เลยมา ${-endDays} วัน`,
              sched.effectiveEnd !== sched.end ? 'ขยายเวลาแล้ว' : 'ไม่มีขยายเวลา',
              sched.computedEnd ? 'คำนวณจากหนังสือแจ้งเริ่มงาน' : null,
            ].filter(Boolean).join(' · ') : ''}
          </Stat>
          <Stat label="หลักประกันสัญญา" value={guarantee === 'none' ? 'ไม่มี' : moneyTh(contract.guarantee_amount)}>
            {guarantee && guarantee !== 'none' ? [GUARANTEE_TYPES[guarantee], contract.guarantee_expires_on ? `หมดอายุ ${thaiDay(contract.guarantee_expires_on)}` : null].filter(Boolean).join(' · ') : ''}
          </Stat>
        </div>

        {showInstallments && <InstallmentsTable bundle={bundle} access={access} deadlines={list} today={today} onChanged={afterChange} />}
        <ContractChangesPanel bundle={bundle} access={access} deadlines={list} adding={addingChange && canWrite} onAddingDone={() => setAddingChange(false)} onChanged={afterChange} />
        <DefectsSection bundle={bundle} access={access} today={today} onChanged={afterChange} />
        <DocumentsSection bundle={bundle} access={access} onChanged={afterChange} />

        <LifecycleHistory events={bundle.events} staffChoices={staffChoices} />
        {canWrite && !addingChange && (
          <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3">
            <button type="button" className={btnGhost} onClick={() => setAddingChange(true)}>ขยายเวลา / แก้ไขสัญญา…</button>
          </div>
        )}
        {!canWrite && <p className="text-[11px] text-gray-500">คุณดูข้อมูลได้อย่างเดียว — การบันทึกและเปลี่ยนขั้นทำได้เฉพาะผู้ควบคุมงาน หัวหน้ากอง และผู้ดูแลระบบ</p>}
      </div>
    </Sheet>
  )
}
