// ผลตรวจความชำรุดบกพร่องระหว่าง/ก่อนครบระยะประกัน (PR-C2 · ข้อ 184–186 · หนังสือ กค (กวจ) ว 117)
// แสดงเมื่อมีวันครบระยะประกัน หรือมีผลตรวจแล้ว หรือโครงการอยู่ขั้นประกันผลงาน/ปิดแล้ว · ผู้ดูเห็นรายการอย่างเดียว
// ระบบแค่บันทึกผลตรวจ + นับกำหนด (ตรวจครั้งสุดท้ายภายใน 30/15 วันก่อนครบ · กำหนดแก้ไขของผู้รับจ้าง) — ไม่ตัดสินว่าชำรุดหรือไม่
import { useMemo, useState } from 'react'
import { AlertOctagon, ChevronDown, Loader2, Plus, Printer } from 'lucide-react'
import { bangkokIsoDate } from '../../../lib/complaintReportPeriods'
import { DEFECT_KINDS, DEFECT_RESULTS, baseStage, warrantyWindow } from '../../../lib/constructionLifecycle'
import { deleteDefect, recordHistory, saveDefect } from '../../../lib/constructionLifecycleApi'
import { buildDefectNoticeLetterHtml, buildWarrantyInspectionReportHtml } from '../../../lib/constructionLifecyclePrint'
import { DEFECT_FIELDS, DEFECT_ONLY_FIELDS, defectDraft, historyNote } from '../../../lib/constructionInstallmentForm'
import SpecGrid from './LifecycleFields'
import useLifecyclePrint, { PRINT_BUTTON_CLASS } from './useLifecyclePrint'
import { btnGhost, btnPrimary } from './uiStyles'
import { VERIFY_TEXT, thaiDay } from './lifecycleFormat'

const BADGE = 'inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold'
const NEW = 'new'

function DefectForm({ project, row, today, canDelete, onClose, onChanged }) {
  const [draft, setDraft] = useState(() => (row ? defectDraft(row) : { ...defectDraft(null), inspected_on: today, kind: 'during_warranty' }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const hidden = useMemo(() => new Set(draft.result === 'defect' ? [] : DEFECT_ONLY_FIELDS), [draft.result])
  const change = (key, value) => setDraft(d => ({ ...d, [key]: value }))

  const run = async action => {
    setBusy(true); setError('')
    const result = await action()
    setBusy(false)
    if (result.error) { setError(result.message || result.error.message || 'เกิดข้อผิดพลาด'); return null }
    return result
  }
  const save = async () => {
    const result = await run(() => saveDefect(project.id, draft, row))
    if (!result) return
    await recordHistory(project.id, historyNote('defect', row, result.row))
    await onChanged?.()
    onClose()
  }
  const remove = async () => {
    const result = await run(() => deleteDefect(row.id))
    if (!result) return
    await recordHistory(project.id, historyNote('defect_delete', row, null))
    await onChanged?.()
    onClose()
  }

  return (
    <div className="space-y-3 text-left">
      <SpecGrid specs={DEFECT_FIELDS} draft={draft} onChange={change} hidden={hidden} />
      {error && <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700"><AlertOctagon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} disabled={busy} onClick={save}>
          {busy && <Loader2 size={16} className="animate-spin" />}บันทึก
        </button>
        <button type="button" className={btnGhost} disabled={busy} onClick={onClose}>ยกเลิก</button>
        {canDelete && row && !confirming && <button type="button" className={`${btnGhost} text-red-600`} disabled={busy} onClick={() => setConfirming(true)}>ลบผลตรวจนี้</button>}
      </div>
      {confirming && (
        <div role="alertdialog" aria-label="ยืนยันลบผลตรวจ" className="flex flex-wrap items-center gap-2 rounded-xl bg-red-50 px-3 py-2">
          <p className="min-w-0 flex-1 basis-56 text-sm text-red-800">ลบผลตรวจวันที่ {thaiDay(row.inspected_on)} — ย้อนกลับไม่ได้</p>
          <button type="button" className={`${btnGhost} border-red-300 text-red-700`} disabled={busy} onClick={remove}>ยืนยันลบ</button>
          <button type="button" className={btnGhost} disabled={busy} onClick={() => setConfirming(false)}>ไม่ลบ</button>
        </div>
      )}
    </div>
  )
}

export default function DefectsSection({ bundle, access, today = bangkokIsoDate(), onChanged, initialOpenId = null }) {
  const project = bundle.project
  const canWrite = Boolean(access.write || access.manage)
  const [openId, setOpenId] = useState(initialOpenId)
  const warranty = warrantyWindow(bundle)
  const { print, printable } = useLifecyclePrint(project)
  // P11 รายงานผลตรวจก่อนครบประกัน (ภายใน) / P12 หนังสือแจ้งผู้รับจ้างแก้ไข (ภายนอก) — ร่างจากข้อมูลในระบบ ผลตรวจกรอกมือโดยผู้ตรวจสอบ
  const printReport = () => print(ctx => buildWarrantyInspectionReportHtml({ ...ctx, project, contract: bundle.contract, warranty }))
  const printNotice = row => print(ctx => buildDefectNoticeLetterHtml({ ...ctx, project, contract: bundle.contract, defect: row }))
  const rows = [...(bundle.defects ?? [])].sort((a, b) => String(a.inspected_on ?? '').localeCompare(String(b.inspected_on ?? '')))
  const stage = baseStage(project)
  if (!warranty.end && !rows.length && stage !== 'warranty' && stage !== 'closed') return null

  return (
    <section className="rounded-2xl border border-gray-200" aria-label="ตรวจความชำรุดบกพร่อง">
      <div className="space-y-0.5 border-b border-gray-100 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <b className="text-sm text-gray-900">ตรวจความชำรุดบกพร่อง</b>
          {warranty.end && (
            <button type="button" className={PRINT_BUTTON_CLASS} disabled={!printable} onClick={printReport}>
              <Printer size={13} aria-hidden="true" />พิมพ์รายงานผลตรวจก่อนครบประกัน
            </button>
          )}
        </div>
        {warranty.end ? (
          <p className="text-xs text-gray-600">
            ระยะประกันผลงาน {warranty.start ? thaiDay(warranty.start) : '…'} – {thaiDay(warranty.end)}
            {warranty.opensOn && ` · เริ่มตรวจครั้งสุดท้ายได้ตั้งแต่ ${thaiDay(warranty.opensOn)} (ก่อนครบ ${warranty.leadDays} วัน)`}
            {(warranty.computedStart || warranty.computedEnd) && <span className="ml-1 text-amber-700">({VERIFY_TEXT})</span>}
          </p>
        ) : <p className="text-xs text-gray-500">ยังไม่ทราบวันครบระยะประกัน — กรอกระยะประกัน (เดือน) หรือวันเริ่ม/สิ้นสุดที่ "ตั้งค่าโครงการ"</p>}
      </div>
      <ul className="divide-y divide-gray-100">
        {rows.length === 0 && openId !== NEW && <li className="px-4 py-3 text-xs text-gray-500">ยังไม่มีผลตรวจ</li>}
        {rows.map(row => {
          const open = openId === row.id
          const head = (
            <>
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-gray-900">{thaiDay(row.inspected_on)} · {DEFECT_KINDS[row.kind] ?? row.kind}</span>
                {row.result === 'defect' && (
                  <span className="mt-0.5 block text-xs text-gray-600">
                    {row.fixed_on ? `ผู้รับจ้างแก้ไขแล้ว ${thaiDay(row.fixed_on)}` : row.fix_due_on ? `กำหนดแก้ไข ${thaiDay(row.fix_due_on)}` : 'ยังไม่ระบุกำหนดแก้ไข'}
                    {row.notice_no ? ` · หนังสือแจ้งเลขที่ ${row.notice_no}` : ''}
                  </span>
                )}
              </span>
              <span className={`${BADGE} ${row.result === 'defect' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{DEFECT_RESULTS[row.result] ?? row.result}</span>
              {canWrite && <ChevronDown size={16} aria-hidden="true" className={`mt-1 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />}
            </>
          )
          return (
            <li key={row.id} className="px-4 py-2.5 text-sm">
              {canWrite
                ? <button type="button" aria-expanded={open} onClick={() => setOpenId(open ? null : row.id)} className="flex min-h-11 w-full items-start gap-2 text-left">{head}</button>
                : <div className="flex items-start gap-2">{head}</div>}
              {row.result === 'defect' && (
                <div className="mt-1 flex">
                  <button type="button" className={PRINT_BUTTON_CLASS} disabled={!printable} onClick={() => printNotice(row)}>
                    <Printer size={13} aria-hidden="true" />พิมพ์หนังสือแจ้งแก้ไข
                  </button>
                </div>
              )}
              {canWrite && open && (
                <div className="mt-2 rounded-xl bg-gray-50 p-3">
                  <DefectForm key={`${row.id}-${row.updated_at ?? ''}`} project={project} row={row} today={today} canDelete={Boolean(access.manage)} onClose={() => setOpenId(null)} onChanged={onChanged} />
                </div>
              )}
            </li>
          )
        })}
        {canWrite && openId === NEW && (
          <li className="px-4 py-2.5 text-sm">
            <p className="mb-2 font-semibold text-gray-900">ผลตรวจใหม่</p>
            <div className="rounded-xl bg-gray-50 p-3">
              <DefectForm key="new" project={project} row={null} today={today} canDelete={false} onClose={() => setOpenId(null)} onChanged={onChanged} />
            </div>
          </li>
        )}
      </ul>
      {canWrite && openId !== NEW && (
        <div className="border-t border-gray-100 px-4 py-3">
          <button type="button" className={btnGhost} onClick={() => setOpenId(NEW)}><Plus size={15} />บันทึกผลตรวจ</button>
        </div>
      )}
    </section>
  )
}
