// แท็บ "ติดตามผล" — ผลดำเนินการตามแผนการดำเนินงานรายปีงบ (นับเฉพาะรายการในฉบับที่ประกาศแล้ว)
// 3 มุม: งานของกอง (กองกดผลเองครั้งเดียวตอนมีผล) · ภาพรวม (สรุปตามยุทธศาสตร์/กอง) · รายงานประจำปี (ข้อมูลประกอบ + ใบพิมพ์)
// รายการที่ผูกทะเบียนโครงการซึ่งกองช่างผูกกับโครงการก่อสร้างไว้ ดึงผลจากขั้นก่อสร้างเอง (กองไม่ต้องกรอกซ้ำ) กดเองไม่ได้
// ตัวบังคับสิทธิ์จริงคือ RLS — ปุ่มที่ซ่อนเป็นแค่ความสะดวก · เตือนเท่านั้น ระบบไม่ตัดสินแทนคณะกรรมการ (ข้อ 29)
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Building2, FileText, Loader2, Pencil, Printer } from 'lucide-react'
import { bangkokIsoDate, thaiShortDate } from '../../../lib/complaintReportPeriods'
import {
  fetchCivilStages, fetchEvaluation, fetchOpItems, fetchProgress, friendlyError,
} from '../../../lib/localPlanApi'
import { spanLabel } from '../../../lib/localPlanCalendar'
import { buildEvalPrintHtml, completionText } from '../../../lib/localPlanEvalPrint'
import { openOpPlanPrintWindow } from '../../../lib/localPlanPrint'
import {
  PROGRESS_LABELS, buildProgressRows, canRecordProgress, civilStageMap, effectiveItemSet, effectivePlans,
  evaluationDeadlines, evaluationWarningText, publishedFiscalYears, summarize,
} from '../../../lib/localPlanProgress'
import { abbrevBaht, fiscalYearOfIso, formatBaht } from '../../../lib/localPlanView'
import { btnGhost, btnPrimary } from '../construction/uiStyles'
import EvaluationSheet from './EvaluationSheet'
import ProgressItemSheet from './ProgressItemSheet'

const SUBTABS = [
  { id: 'dept', label: 'งานของกอง' },
  { id: 'overview', label: 'ภาพรวม' },
  { id: 'report', label: 'รายงานประจำปี' },
]

const STATUS_TONE = {
  none: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-sky-50 text-sky-800',
  done: 'bg-emerald-50 text-emerald-800',
  not_done: 'bg-red-50 text-red-700',
}
const BAR_COLOR = { done: '#15803d', in_progress: '#0284c7', not_done: '#dc2626' }

const NO_DEPT = '__none__'   // ตัวเลือกตัวกรองกอง: รายการที่ยังไม่ระบุกอง

function StatusBadge({ resolved }) {
  const status = resolved?.status ?? 'none'
  return <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${STATUS_TONE[status]}`}>{PROGRESS_LABELS[status]}</span>
}

/** แถบความคืบหน้าอย่างง่าย: เขียว = แล้วเสร็จ ฟ้า = กำลังดำเนินการ แดง = ไม่ได้ดำเนินการ (ส่วนที่เหลือ = ยังไม่ดำเนินการ) */
function ProgressBar({ group }) {
  const pct = n => (group.total ? (n / group.total) * 100 : 0)
  return (
    <div className="flex h-2 w-full min-w-24 overflow-hidden rounded-full bg-gray-200" role="img"
      aria-label={`แล้วเสร็จ ${group.done} กำลังดำเนินการ ${group.in_progress} ไม่ได้ดำเนินการ ${group.not_done} จาก ${group.total} รายการ`}>
      {['done', 'in_progress', 'not_done'].map(key => <span key={key} style={{ width: `${pct(group[key])}%`, backgroundColor: BAR_COLOR[key] }} />)}
    </div>
  )
}

function SummaryRow({ g, strong }) {
  return (
    <tr className={strong ? 'border-t-2 border-gray-300 bg-gray-50 font-bold' : 'border-t border-gray-100'}>
      <td className="px-3 py-2 text-left">{g.label}</td>
      <td className="px-2 py-2 text-center">{g.total}</td>
      <td className="px-2 py-2 text-center">{g.none}</td>
      <td className="px-2 py-2 text-center">{g.in_progress}</td>
      <td className="px-2 py-2 text-center">{g.done}</td>
      <td className="px-2 py-2 text-center">{g.not_done}</td>
      <td className="whitespace-nowrap px-2 py-2 text-right">{abbrevBaht(g.amount)}</td>
      <td className="px-3 py-2"><div className="flex items-center gap-2"><ProgressBar group={g} /><span className="w-12 shrink-0 text-right text-xs">{g.donePct.toFixed(1)}%</span></div></td>
    </tr>
  )
}

function SummaryTable({ title, firstHeader, summary }) {
  const { groups, totals } = summary
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white text-gray-800">
      <p className="border-b border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-bold text-gray-900">{title}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-176 text-sm">
          <thead>
            <tr className="text-xs text-gray-500">
              <th className="px-3 py-2 text-left font-semibold">{firstHeader}</th>
              <th className="px-2 py-2 font-semibold">ทั้งหมด</th>
              <th className="px-2 py-2 font-semibold">ยังไม่</th>
              <th className="px-2 py-2 font-semibold">กำลังทำ</th>
              <th className="px-2 py-2 font-semibold">เสร็จ</th>
              <th className="px-2 py-2 font-semibold">ไม่ได้ทำ</th>
              <th className="px-2 py-2 text-right font-semibold">งบตามแผน</th>
              <th className="px-3 py-2 text-left font-semibold">แล้วเสร็จ</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(g => <SummaryRow key={String(g.key)} g={g} />)}
            {groups.length > 0 ? <SummaryRow g={totals} strong /> : <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-500">ไม่มีรายการ</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/**
 * opPlans/projects = ของแผนพัฒนาที่เลือก · ต้องใส่ key={plan.id} ที่ผู้เรียก (สถานะปีงบที่เลือกจะเริ่มใหม่เมื่อเปลี่ยนแผน)
 */
export default function ProgressTab({ tenant, profile, isManager, departments, projects, opPlans }) {
  const today = bangkokIsoDate()
  const years = useMemo(() => publishedFiscalYears(opPlans), [opPlans])
  const [chosenYear, setChosenYear] = useState(null)
  const fiscalYear = chosenYear ?? (years.includes(fiscalYearOfIso(today)) ? fiscalYearOfIso(today) : (years[0] ?? null))
  const [sub, setSub] = useState('dept')
  const [reloadKey, setReloadKey] = useState(0)
  const [deptFilter, setDeptFilter] = useState('')   // manager: '' = ทุกกอง · id · NO_DEPT
  const [statusFilter, setStatusFilter] = useState('all')
  const [sheetItem, setSheetItem] = useState(null)   // แถวของ buildProgressRows
  const [evalOpen, setEvalOpen] = useState(false)
  const [printError, setPrintError] = useState('')
  const [state, setState] = useState({ key: null })

  // ฉบับที่มีผลของปีนี้ (ฐาน + เพิ่มเติมหลังฐาน) — ฉบับที่ประกาศแล้วแช่แข็ง จึงผูกการโหลดซ้ำกับรหัสฉบับ ไม่ใช่ตัวแปรอ้างอิงของ opPlans
  const planIds = useMemo(
    () => (fiscalYear ? effectivePlans(opPlans, fiscalYear, { publishedOnly: true }).map(p => p.id).join(',') : ''),
    [opPlans, fiscalYear],
  )
  const key = `${tenant?.id}|${fiscalYear}|${planIds}|${reloadKey}`

  useEffect(() => {
    if (!tenant?.id || !fiscalYear || !planIds) return undefined
    let alive = true
    ;(async () => {
      const ids = planIds.split(',')
      const [itemResults, progress, civil, evaluation] = await Promise.all([
        Promise.all(ids.map(id => fetchOpItems(tenant.id, id))),
        fetchProgress(tenant.id, fiscalYear),
        fetchCivilStages(tenant.id, null),   // ทุกปี: ไว้บอกว่า "ผูกแล้วแต่ไม่พบโครงการก่อสร้างของปีนี้" (RPC กรองปีด้วยข้อความตรงตัว)
        fetchEvaluation(tenant.id, fiscalYear),
      ])
      if (!alive) return
      const hardError = itemResults.find(r => r.error)?.error ?? progress.error
      setState({
        key,
        error: hardError ? friendlyError(hardError) : '',
        // ข้อมูลเสริม: อ่านไม่ได้ก็แสดงต่อ (ผลที่กองกดเองยังใช้ได้) แค่บอกให้รู้
        civilError: civil.error ? friendlyError(civil.error) : '',
        evalError: evaluation.error ? friendlyError(evaluation.error) : '',
        items: itemResults.flatMap(r => r.items),
        progress: progress.progress,
        civilRows: civil.rows,
        evaluation: evaluation.evaluation,
      })
    })()
    return () => { alive = false }
  }, [tenant?.id, fiscalYear, planIds, key])

  const ready = state.key === key
  const rows = useMemo(() => {
    if (!ready || state.error) return []
    const items = effectiveItemSet(opPlans, state.items, fiscalYear, { publishedOnly: true })
    const yearText = String(fiscalYear)
    const civilByRef = civilStageMap(state.civilRows.filter(r => String(r.fiscal_year ?? '').trim() === yearText))
    const linkedRefs = new Set(state.civilRows.map(r => r.registry_ref))
    const progressByLineage = Object.fromEntries(state.progress.map(p => [p.lineage_id, p]))
    return buildProgressRows({ items, projects, progressByLineage, civilByRef, linkedRefs })
  }, [ready, state, opPlans, fiscalYear, projects])

  const myDepartmentId = profile?.department_id ?? null
  const deptName = id => departments.find(d => d.id === id)?.name ?? ''
  const canRecord = row => canRecordProgress({ isManager, role: profile?.role, myDepartmentId, item: row.item, resolved: row.resolved })

  const deptRows = useMemo(() => rows.filter(row => {
    if (!isManager) return Boolean(myDepartmentId) && row.departmentId === myDepartmentId
    if (deptFilter === NO_DEPT) return !row.departmentId
    return !deptFilter || row.departmentId === deptFilter
  }), [rows, isManager, myDepartmentId, deptFilter])
  const shownRows = useMemo(() => deptRows.filter(row => statusFilter === 'all' || row.resolved.status === statusFilter), [deptRows, statusFilter])

  const byStrategy = useMemo(() => summarize(rows, { groupBy: 'strategy' }), [rows])
  const byDepartment = useMemo(() => summarize(rows, { groupBy: 'department', departments }), [rows, departments])
  const civilCount = rows.filter(r => r.resolved.source === 'civil').length

  const evaluation = ready ? state.evaluation : null
  const deadline = useMemo(() => evaluationDeadlines(evaluation, today), [evaluation, today])
  const deadlineText = evaluationWarningText(deadline)

  const reload = () => setReloadKey(k => k + 1)

  // พิมพ์ (ทุกคนที่เห็นแท็บ) — สร้างใบและเปิดหน้าต่างในการกดเดียวกัน (กัน pop-up blocker บนมือถือ) · ข้อมูลโหลดครบก่อนปุ่มใช้ได้
  const printReport = () => {
    if (!ready || state.error) return
    setPrintError('')
    const html = buildEvalPrintHtml({ tenant, fiscalYear, evaluation, rows, departments, asOf: bangkokIsoDate() })
    if (!openOpPlanPrintWindow(html)) setPrintError('เบราว์เซอร์ปิดกั้นหน้าต่างพิมพ์ กรุณาอนุญาต pop-up แล้วลองใหม่')
  }

  if (!years.length) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-5 py-10 text-center text-sm text-gray-600">
        ยังไม่มีแผนการดำเนินงานที่ประกาศแล้ว — บันทึกผลได้หลังประกาศ
      </div>
    )
  }

  const statusPills = [['all', 'ทั้งหมด'], ['none', PROGRESS_LABELS.none], ['in_progress', PROGRESS_LABELS.in_progress], ['done', PROGRESS_LABELS.done], ['not_done', PROGRESS_LABELS.not_done]]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-gray-500">ปีงบประมาณ</span>
          <select className="min-h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-800" value={fiscalYear}
            onChange={e => { setChosenYear(Number(e.target.value)); setStatusFilter('all') }}>
            {years.map(y => <option key={y} value={y}>ปีงบ {y}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="มุมมอง">
          {SUBTABS.map(t => (
            <button key={t.id} type="button" aria-pressed={sub === t.id} onClick={() => setSub(t.id)}
              className={`min-h-11 rounded-xl border px-4 text-sm font-semibold transition-colors ${sub === t.id ? 'border-transparent text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
              style={sub === t.id ? { backgroundColor: 'var(--color-primary)' } : {}}>{t.label}</button>
          ))}
        </div>
      </div>

      {!ready && !state.error && <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500"><Loader2 className="animate-spin" size={18} />กำลังโหลดผลดำเนินการ…</div>}
      {ready && state.error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">โหลดผลดำเนินการไม่สำเร็จ — {state.error}</p>}
      {ready && !state.error && state.civilError && (
        <p role="status" className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />อ่านขั้นของโครงการก่อสร้างไม่ได้ ({state.civilError}) — ตอนนี้แสดงเฉพาะผลที่กองกดเอง
        </p>
      )}

      {ready && !state.error && sub === 'dept' && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            {isManager ? (
              <label className="block min-w-0">
                <span className="mb-1 block text-xs font-semibold text-gray-500">กอง</span>
                <select className="min-h-11 min-w-0 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-800" value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
                  <option value="">ทุกกอง</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  <option value={NO_DEPT}>ยังไม่ระบุกอง</option>
                </select>
              </label>
            ) : (
              <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-700"><Building2 size={16} aria-hidden="true" />{myDepartmentId ? (deptName(myDepartmentId) || 'กองของคุณ') : 'ยังไม่ได้ระบุกองในบัญชี'}</p>
            )}
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-gray-500">ผล</span>
              <select className="min-h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-800" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                {statusPills.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <p className="pb-3 text-xs text-gray-500">{shownRows.length} จาก {deptRows.length} รายการ</p>
          </div>

          {!isManager && !myDepartmentId && (
            <p className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-600">บัญชีของคุณยังไม่ได้ระบุกอง จึงไม่มีงานของกองให้แสดง — ดูภาพรวมทั้งองค์กรได้ที่แท็บ "ภาพรวม"</p>
          )}
          {civilCount > 0 && <p className="text-xs text-gray-500">รายการที่มีป้าย "ดึงจากงานก่อสร้าง" ระบบอ่านจากขั้นของโครงการก่อสร้างให้เอง — ไม่ต้องกรอกซ้ำ ถ้าไม่ตรงความจริงให้กองช่างแก้ขั้นในเมนูโครงการก่อสร้าง</p>}

          <ul className="space-y-2">
            {shownRows.map(row => {
              const { item, resolved } = row
              const span = spanLabel(item.month_from, item.month_to)
              const can = canRecord(row)
              return (
                <li key={row.lineage} className="rounded-2xl border border-gray-200 bg-white p-3 text-gray-800">
                  <div className="flex flex-wrap items-start gap-2">
                    <p className="min-w-0 flex-1 break-words font-semibold text-gray-900">{item.item_name}</p>
                    <StatusBadge resolved={resolved} />
                    {resolved.source === 'civil' && <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-bold text-indigo-700">ดึงจากงานก่อสร้าง</span>}
                  </div>
                  <p className="mt-1 break-words text-xs text-gray-500">
                    {[item.source === 'external' ? item.external_agency : deptName(row.departmentId), span && `ช่วง ${span}`, item.amount !== null && item.amount !== undefined && `งบ ${formatBaht(item.amount)}`].filter(Boolean).join(' · ') || '—'}
                  </p>
                  {(resolved.status === 'done' || resolved.status === 'not_done') && (
                    <p className="mt-1 break-words text-xs text-gray-600">{completionText(resolved, fiscalYear)}</p>
                  )}
                  {resolved.civilLinkedNoStage && (
                    <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-800"><AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />ผูกกับงานก่อสร้างแล้ว แต่ไม่พบโครงการก่อสร้างของปีงบ {fiscalYear} — ให้กองช่างตรวจปีงบ หรือกรอกผลเองได้</p>
                  )}
                  {can && (
                    <button type="button" className={`${btnGhost} mt-2`} onClick={() => setSheetItem(row)}>
                      <Pencil size={15} />{resolved.source === 'manual' ? 'แก้ผล' : 'บันทึกผล'}
                    </button>
                  )}
                </li>
              )
            })}
            {shownRows.length === 0 && deptRows.length === 0 && (isManager || myDepartmentId) && (
              <li className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-8 text-center text-sm text-gray-500">ไม่มีรายการ{isManager && !deptFilter ? '' : 'ของกองนี้'}ในแผนการดำเนินงานปีงบ {fiscalYear}</li>
            )}
            {shownRows.length === 0 && deptRows.length > 0 && (
              <li className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-8 text-center text-sm text-gray-500">ไม่มีรายการที่ตรงตัวกรอง</li>
            )}
          </ul>
        </section>
      )}

      {ready && !state.error && sub === 'overview' && (
        <div className="space-y-4">
          <SummaryTable title={`สรุปตามยุทธศาสตร์ · ปีงบ ${fiscalYear}`} firstHeader="ยุทธศาสตร์" summary={byStrategy} />
          <SummaryTable title={`สรุปตามกอง · ปีงบ ${fiscalYear}`} firstHeader="กอง" summary={byDepartment} />
          <p className="text-xs text-gray-500">ร้อยละแล้วเสร็จนับตามจำนวนรายการ · งบตามแผนคือยอดในแผนการดำเนินงาน ไม่ใช่ยอดเบิกจ่าย · ยุทธศาสตร์อ่านจากทะเบียนโครงการ (รายการที่ไม่ผูกทะเบียนอยู่ในกลุ่ม "ไม่ระบุ")</p>
        </div>
      )}

      {ready && !state.error && sub === 'report' && (
        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 text-gray-800">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold text-gray-900">รายงานติดตามและประเมินผล · ปีงบ {fiscalYear}</p>
            {state.evalError && <span className="text-xs text-red-700">โหลดข้อมูลรายงานไม่สำเร็จ ({state.evalError})</span>}
          </div>
          {deadlineText && (
            <p className={`flex items-start gap-2 rounded-xl px-3 py-2 text-sm ${deadline.state === 'overdue' || deadline.state === 'due_today' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}`}>
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words">{deadlineText}</span>
            </p>
          )}
          {deadline.state === 'announced_on_time' && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">ประกาศผลทันกำหนด (ครบ {thaiShortDate(deadline.dueOn)})</p>}
          {evaluation ? (
            <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
              <div className="sm:col-span-2"><dt className="text-xs font-semibold text-gray-500">ยอดเบิกจ่ายรวมทั้งปี</dt>
                <dd>{evaluation.disbursed_total === null ? 'ยังไม่ได้บันทึก' : `${formatBaht(evaluation.disbursed_total)} บาท ณ วันที่ ${thaiShortDate(evaluation.disbursed_as_of)}${evaluation.disbursed_source ? ` · ที่มา ${evaluation.disbursed_source}` : ''}`}</dd></div>
              {[['committee_met_on', 'คณะกรรมการประชุม'], ['reported_to_exec_on', 'รายงานผู้บริหาร'], ['presented_on', 'เสนอสภา/คณะกรรมการพัฒนาท้องถิ่น'], ['announced_on', 'ประกาศผล']].map(([k, label]) => (
                <div key={k}><dt className="text-xs font-semibold text-gray-500">{label}</dt><dd>{evaluation[k] ? thaiShortDate(evaluation[k]) : '—'}</dd></div>
              ))}
              <div><dt className="text-xs font-semibold text-gray-500">เลขที่ประกาศผล</dt><dd className="break-words">{evaluation.announce_ref_no || '—'}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs font-semibold text-gray-500">ข้อสังเกต</dt><dd className="whitespace-pre-wrap break-words">{evaluation.observations || '—'}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs font-semibold text-gray-500">ข้อเสนอแนะ</dt><dd className="whitespace-pre-wrap break-words">{evaluation.recommendations || '—'}</dd></div>
              {evaluation.note && <div className="sm:col-span-2"><dt className="text-xs font-semibold text-gray-500">หมายเหตุ</dt><dd className="whitespace-pre-wrap break-words">{evaluation.note}</dd></div>}
            </dl>
          ) : (
            <p className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-600">
              <FileText size={14} className="mr-1 inline" aria-hidden="true" />ยังไม่มีข้อมูลรายงานของปีงบนี้{isManager ? ' — กด "แก้ข้อมูลรายงาน" เพื่อบันทึกยอดเบิกจ่าย วันที่ขั้นตอน ข้อสังเกตและข้อเสนอแนะ' : ' (นักวิเคราะห์ฯ เป็นผู้บันทึก)'}
            </p>
          )}
          {printError && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{printError}</p>}
          <div className="flex flex-wrap gap-2">
            {isManager && (
              <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} onClick={() => setEvalOpen(true)}><Pencil size={16} />แก้ข้อมูลรายงาน</button>
            )}
            <button type="button" className={btnGhost} onClick={printReport}><Printer size={16} />พิมพ์รายงาน</button>
          </div>
          <p className="text-xs text-gray-500">ใบพิมพ์ไม่มีช่องลงนาม — คณะกรรมการกำหนดรูปแบบรายงานเอง (ข้อ 29) · ยอดเบิกจ่ายเป็นตัวเลขรวมทั้งปีจากระบบบัญชี ไม่แยกรายโครงการ</p>
        </section>
      )}

      {sheetItem && (
        <ProgressItemSheet
          key={sheetItem.lineage}
          tenant={tenant} item={sheetItem.item} resolved={sheetItem.resolved}
          progress={state.progress?.find(p => p.lineage_id === sheetItem.lineage) ?? null}
          fiscalYear={fiscalYear} departments={departments}
          onClose={() => setSheetItem(null)}
          onSaved={() => { setSheetItem(null); reload() }}
        />
      )}
      {evalOpen && isManager && (
        <EvaluationSheet
          tenant={tenant} fiscalYear={fiscalYear} evaluation={evaluation}
          onClose={() => setEvalOpen(false)}
          onSaved={() => { setEvalOpen(false); reload() }}
        />
      )}
    </div>
  )
}
