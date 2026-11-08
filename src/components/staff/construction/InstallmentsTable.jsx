// ตาราง "งวดงาน · ส่งมอบ / ตรวจรับ / เบิกจ่าย" ของหน้าวงจรโครงการ (PR-C2) — ตามแบบที่เจ้าของระบบอนุมัติ
// กดแถว (ปุ่มเต็มแถว) แล้วฟอร์มโผล่ใต้แถวนั้น แบบเดียวกับ MilestoneRow · ผู้ดูเห็นตารางอย่างเดียว ไม่มีฟอร์ม
// ผลตรวจรับ (inspection_*) = ผู้จัดการเท่านั้น และล็อกช่องข้อเท็จจริงของงวดเมื่อบันทึกผลแล้ว — ฐานข้อมูลบังคับซ้ำที่ civil_manage_columns_guard
// ⚠️ ระบบไม่ตัดสินผลตรวจรับ/ค่าปรับเอง: ตารางแค่นับวันตามระเบียบให้ · ค่าปรับที่แสดงเป็น "ประมาณการ" ยอดทางการใช้ตัวคำนวณของ e-GP
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { AlertOctagon, CheckCircle2, ChevronDown, Loader2, Plus } from 'lucide-react'
import { daysBetween } from '../../../lib/constructionReport'
import { fineEstimate } from '../../../lib/constructionLifecycle'
import { deleteInstallment, recordHistory, saveInstallment } from '../../../lib/constructionLifecycleApi'
import {
  INSTALLMENT_GROUPS, INSTALLMENT_LOCKED_COLUMNS, INSTALLMENT_MANAGER_COLUMNS, historyNote, installmentDraft, installmentSlots,
  MANAGER_ONLY_NOTE, netWarning, suggestedAmount, suggestedNet,
} from '../../../lib/constructionInstallmentForm'
import SpecGrid from './LifecycleFields'
import { btnGhost, btnPrimary } from './uiStyles'
import { moneyTh, thaiDay } from './lifecycleFormat'

const BADGE = 'inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold'
const sameNumber = (a, b) => Number(String(a ?? '').replace(/,/g, '')) === Number(b)

/** ป้ายกำหนดเวลาจาก deadlines() ของงวดนั้น — เลยกำหนดแดง · ยังไม่ถึงเทา */
function DueBadge({ deadline }) {
  if (!deadline) return <span className="text-gray-400">—</span>
  if (deadline.state === 'overdue') return <span className={`${BADGE} bg-red-100 text-red-700`}>เลยกำหนด {thaiDay(deadline.due)}</span>
  if (deadline.state === 'open' || deadline.state === 'due_today') return <span className={`${BADGE} bg-gray-100 text-gray-600`}>ภายใน {thaiDay(deadline.due)}</span>
  return <span className="text-gray-400">—</span>
}

function InstallmentForm({ project, slot, manage, contractAmount, onClose, onChanged }) {
  const row = slot.saved ? slot : null
  const [draft, setDraft] = useState(() => installmentDraft(row, slot.installment_no))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const decided = Boolean(row?.inspection_result)

  const locked = useMemo(() => {
    const set = new Set()
    if (!manage) {
      INSTALLMENT_MANAGER_COLUMNS.forEach(k => set.add(k))
      if (decided) INSTALLMENT_LOCKED_COLUMNS.forEach(k => set.add(k))
    }
    return set
  }, [manage, decided])

  const change = (key, value) => setDraft(d => ({ ...d, [key]: value }))
  const amountHint = suggestedAmount(contractAmount, draft.work_pct)
  const netHint = suggestedNet(draft)
  const warning = netWarning(draft)
  const suggest = (value, text, onUse) => (
    <button type="button" className="mt-1 min-h-9 rounded-lg border border-teal-200 bg-teal-50 px-2.5 text-xs font-semibold text-teal-800" onClick={onUse}>
      ใช้ค่าที่ระบบคำนวณ: {moneyTh(value)}{text}
    </button>
  )
  const extras = {
    amount: amountHint !== null && !sameNumber(draft.amount, amountHint)
      ? suggest(amountHint, ` บาท (${Number(draft.work_pct)}% ของวงเงินสัญญา)`, () => change('amount', String(amountHint))) : null,
    paid_net: <>
      {netHint !== null && !sameNumber(draft.paid_net, netHint)
        ? suggest(netHint, ' บาท (ยอดเบิก − ยอดหัก)', () => change('paid_net', String(netHint))) : null}
      {warning && <span className="mt-1 block text-[11px] text-amber-700">{warning}</span>}
    </>,
  }

  const run = async action => {
    setBusy(true); setError('')
    const result = await action()
    setBusy(false)
    if (result.error) { setError(result.message || result.error.message || 'เกิดข้อผิดพลาด'); return false }
    return result
  }
  const save = async () => {
    const result = await run(() => saveInstallment(project.id, draft, row, { manage }))
    if (!result) return
    await recordHistory(project.id, historyNote('installment', row, result.row))
    await onChanged?.()
    onClose()
  }
  const remove = async () => {
    const result = await run(() => deleteInstallment(row.id))
    if (!result) return
    await recordHistory(project.id, historyNote('installment_delete', row, null))
    await onChanged?.()
    onClose()
  }

  return (
    <div className="space-y-3 text-left">
      {decided && !manage && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">บันทึกผลตรวจรับแล้ว ให้หัวหน้ากองหรือผู้ดูแลระบบแก้</p>}
      {INSTALLMENT_GROUPS.map(group => (
        <fieldset key={group.key} className="rounded-xl border border-gray-200 bg-white p-3">
          <legend className="px-1 text-xs font-bold text-gray-700">{group.title}</legend>
          {group.key === 'inspection' && !manage && <p className="mb-2 text-[11px] text-amber-700">{MANAGER_ONLY_NOTE} (ผลตรวจรับเป็นการตัดสินของคณะกรรมการ — บันทึกตามใบที่ลงนามแล้ว)</p>}
          <SpecGrid specs={group.fields} draft={draft} onChange={change} locked={locked} extras={extras} />
        </fieldset>
      ))}
      {error && <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700"><AlertOctagon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} disabled={busy} onClick={save}>
          {busy && <Loader2 size={16} className="animate-spin" />}บันทึก
        </button>
        <button type="button" className={btnGhost} disabled={busy} onClick={onClose}>ยกเลิก</button>
        {manage && row && !confirming && <button type="button" className={`${btnGhost} text-red-600`} disabled={busy} onClick={() => setConfirming(true)}>ลบงวดนี้</button>}
      </div>
      {confirming && (
        <div role="alertdialog" aria-label="ยืนยันลบงวด" className="flex flex-wrap items-center gap-2 rounded-xl bg-red-50 px-3 py-2">
          <p className="min-w-0 flex-1 basis-56 text-sm text-red-800">ลบงวดที่ {slot.installment_no} ทั้งแถว (รวมข้อมูลส่งมอบ/ตรวจรับ/เบิกจ่าย) — ย้อนกลับไม่ได้</p>
          <button type="button" className={`${btnGhost} border-red-300 text-red-700`} disabled={busy} onClick={remove}>ยืนยันลบ</button>
          <button type="button" className={btnGhost} disabled={busy} onClick={() => setConfirming(false)}>ไม่ลบ</button>
        </div>
      )}
    </div>
  )
}

/** initialOpenNo = เลขงวดที่เปิดฟอร์มไว้ตั้งแต่เริ่ม (ใช้ในเทสต์ SSR ที่กดไม่ได้) */
export default function InstallmentsTable({ bundle, access, deadlines = [], today, onChanged, initialOpenNo = null }) {
  const project = bundle.project
  const canWrite = Boolean(access.write || access.manage)
  const manage = Boolean(access.manage)
  const [added, setAdded] = useState([])      // เลขงวดที่กด "เพิ่มงวด" แต่ยังไม่ได้บันทึก (ไม่มีแถวในฐาน)
  const [openNo, setOpenNo] = useState(initialOpenNo)

  const slots = useMemo(() => {
    const base = installmentSlots(bundle)
    const have = new Set(base.map(s => s.installment_no))
    const more = added.filter(no => !have.has(no)).map(no => ({ installment_no: no, saved: false }))
    return [...base, ...more].sort((a, b) => a.installment_no - b.installment_no)
  }, [bundle, added])

  const paid = slots.reduce((sum, s) => sum + (Number(s.paid_gross) || 0), 0)
  const hasPaid = slots.some(s => s.paid_gross !== null && s.paid_gross !== undefined && s.paid_gross !== '')
  const fine = fineEstimate(bundle, today)
  const dl = (key, no) => deadlines.find(d => d.key === key && d.installmentNo === no)
  const addNext = () => {
    const no = (slots.at(-1)?.installment_no ?? 0) + 1
    setAdded(list => [...list, no])
    setOpenNo(no)
  }
  const COLS = 7
  // ฟอร์มอยู่ในแถวของตารางที่เลื่อนข้างได้ (บนมือถือตารางกว้างกว่าจอ) — วัดความกว้างที่มองเห็นแล้วปักฟอร์มชิดซ้าย
  // ไม่งั้นฟอร์มกว้างเท่าตาราง ช่องกรอกล้นออกขวาต้องเลื่อนข้างถึงจะเห็น (เจอบน demo ที่ 390px)
  const scrollRef = useRef(null)
  const [viewW, setViewW] = useState(null)
  const hasRows = slots.length > 0
  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => setViewW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [hasRows])

  return (
    <section className="rounded-2xl border border-gray-200" aria-label="งวดงาน">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
        <b className="text-sm text-gray-900">งวดงาน · ส่งมอบ / ตรวจรับ / เบิกจ่าย</b>
        <span className="text-xs text-gray-500">{slots.length} งวด{hasPaid ? ` · จ่ายแล้ว ${moneyTh(paid)} บาท` : ''}</span>
      </div>
      {slots.length === 0 ? (
        <p className="px-4 py-3 text-xs text-gray-500">ยังไม่มีงวดงาน{canWrite ? ' — กด "เพิ่มงวด" เพื่อบันทึกงวดแรก (หรือกรอกจำนวนงวดในสัญญาที่ "ตั้งค่าโครงการ" ระบบจะขึ้นแถวให้ครบ)' : ''}</p>
      ) : (
        <div ref={scrollRef} className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-semibold">งวด</th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">เงิน (บาท)</th>
                <th scope="col" className="px-2 py-2 font-semibold">ครบกำหนด</th>
                <th scope="col" className="px-2 py-2 font-semibold">รายงาน ผคง.<br />178(4)</th>
                <th scope="col" className="px-2 py-2 font-semibold">ส่งมอบ</th>
                <th scope="col" className="px-2 py-2 font-semibold">ตรวจรับ<br />176(5)</th>
                <th scope="col" className="px-2 py-2 font-semibold">เบิกจ่าย</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-center">
              {slots.map(slot => {
                const no = slot.installment_no
                const report = dl('installment_due_report', no)
                const inspection = dl('installment_inspection', no)
                const overdue = report?.state === 'overdue' || inspection?.state === 'overdue'
                const lateDays = slot.delivered_on && slot.due_on && slot.delivered_on > slot.due_on ? daysBetween(slot.due_on, slot.delivered_on) : 0
                const open = openNo === no
                const toggle = () => setOpenNo(open ? null : no)
                return (
                  <Fragment key={no}>
                    <tr className={`${overdue ? 'bg-amber-50/60' : ''} ${canWrite ? 'cursor-pointer' : ''}`} onClick={canWrite ? toggle : undefined}>
                      <td className="px-3 py-1 text-left font-semibold text-gray-900">
                        {canWrite ? (
                          <button type="button" aria-expanded={open} aria-label={`งวดที่ ${no}`} className="flex min-h-11 w-full items-center gap-1.5 text-left"
                            onClick={e => { e.stopPropagation(); toggle() }}>
                            <ChevronDown size={14} aria-hidden="true" className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                            <span>{no}{slot.work_pct !== null && slot.work_pct !== undefined && slot.work_pct !== '' ? ` (${Number(slot.work_pct)}%)` : ''}</span>
                          </button>
                        ) : <span>{no}{slot.work_pct !== null && slot.work_pct !== undefined && slot.work_pct !== '' ? ` (${Number(slot.work_pct)}%)` : ''}</span>}
                      </td>
                      <td className="px-2 text-right tabular-nums text-gray-800">{moneyTh(slot.amount)}</td>
                      <td className="px-2 text-gray-700">{slot.due_on ? thaiDay(slot.due_on) : <span className="text-gray-400">—</span>}</td>
                      <td className="px-2">
                        {slot.due_report_on
                          ? <span className="inline-flex items-center gap-1 text-gray-700"><CheckCircle2 size={14} className="text-emerald-600" aria-label="รายงานแล้ว" role="img" />{thaiDay(slot.due_report_on)}</span>
                          : <DueBadge deadline={report} />}
                      </td>
                      <td className="px-2 text-gray-700">
                        {slot.delivered_on ? thaiDay(slot.delivered_on) : <span className="text-gray-400">{slot.saved && slot.due_on ? 'ยังไม่ส่ง' : '—'}</span>}
                        {lateDays > 0 && <div className="text-[11px] font-bold text-red-600">ช้า {lateDays} วัน</div>}
                      </td>
                      <td className="px-2">
                        {slot.inspection_result === 'accepted' ? <span className={`${BADGE} bg-green-100 text-green-700`}>รับ {thaiDay(slot.inspected_on)}</span>
                          : slot.inspection_result === 'rejected' ? <span className={`${BADGE} bg-red-100 text-red-700`}>ไม่รับ</span>
                            : slot.inspected_on ? <span className={`${BADGE} bg-gray-100 text-gray-600`}>ตรวจ {thaiDay(slot.inspected_on)} (ยังไม่บันทึกผล)</span>
                              : <DueBadge deadline={inspection} />}
                      </td>
                      <td className="px-2">
                        {slot.paid_on ? <span className={`${BADGE} bg-green-100 text-green-700`}>จ่าย {thaiDay(slot.paid_on)}</span>
                          : slot.paid_gross !== null && slot.paid_gross !== undefined && slot.paid_gross !== '' ? <span className={`${BADGE} bg-gray-100 text-gray-600`}>บันทึกยอดเบิกแล้ว</span>
                            : <span className="text-gray-400">—</span>}
                      </td>
                    </tr>
                    {canWrite && open && (
                      <tr>
                        <td colSpan={COLS} className="bg-gray-50 p-0">
                          <div className="sticky left-0 p-3" style={viewW ? { width: viewW } : undefined}>
                          <InstallmentForm key={`${no}-${slot.updated_at ?? 'new'}`} project={project} slot={slot} manage={manage}
                            contractAmount={project.contract_amount} onClose={() => setOpenNo(null)} onChanged={onChanged} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {fine.lateDays > 0 && (
        <div className="space-y-1.5 border-t border-gray-100 px-4 py-3 text-xs text-gray-700">
          <p>
            <span className="mr-1.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 font-bold text-amber-800">ประมาณการ — ยอดทางการใช้ e-GP</span>
            {fine.perDay > 0
              ? <>ส่งมอบช้า {fine.lateDays} วัน × {moneyTh(fine.perDay)} บาท/วัน = <b>{moneyTh(fine.amount)} บาท</b>{fine.pct !== null ? ` (${fine.pct.toFixed(2)}% ของวงเงินสัญญา · เกณฑ์พิจารณาบอกเลิก ${fine.thresholdPct}%)` : ''}</>
              : <>ส่งมอบช้า {fine.lateDays} วัน — ยังไม่ได้ตั้งค่าปรับต่อวันของสัญญา (กรอกที่ "ตั้งค่าโครงการ")</>}
          </p>
          {fine.overThreshold && (
            <p role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 px-2.5 py-1.5 font-semibold text-red-700">
              <AlertOctagon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              ค่าปรับประมาณการเกินร้อยละ {fine.thresholdPct} ของวงเงินสัญญา — ผู้มีอำนาจต้องพิจารณาบอกเลิกสัญญา (ข้อ 183) ระบบไม่บอกเลิกให้
            </p>
          )}
          <p className="text-[11px] text-gray-400">{fine.basis} · ระบบไม่เรียกค่าปรับและไม่หักเงินเอง</p>
        </div>
      )}

      {canWrite && (
        <div className="border-t border-gray-100 px-4 py-3">
          <button type="button" className={btnGhost} onClick={addNext}><Plus size={15} />เพิ่มงวด</button>
        </div>
      )}
    </section>
  )
}
