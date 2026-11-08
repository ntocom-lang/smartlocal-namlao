// แท็บ "แผนดำเนินงาน" — แผนการดำเนินงานรายปี (ฉบับหลัก / เพิ่มเติม / แก้ไข) ของแผนพัฒนาที่เลือก
// ผู้จัดการแผนสร้าง/ตั้งฐานนับ 30 วัน/ประกาศ · ประกาศแล้วแช่แข็ง (อ่านอย่างเดียว) แก้ต้องทำฉบับครั้งถัดไป
// ขยายเวลา (ข้อ 27) เป็นอำนาจผู้บริหารท้องถิ่น — ระบบแค่เก็บเลขที่/วันที่หนังสือและกำหนดใหม่ ไม่ตัดสินให้
import { useEffect, useMemo, useState } from 'react'
import { History, Loader2, Plus, Printer, Upload } from 'lucide-react'
import { bangkokIsoDate, thaiShortDate } from '../../../lib/complaintReportPeriods'
import {
  createOpPlan, fetchOpItems, friendlyError, saveItemOrder, saveOpPlan, setOpPlanStatus, updateOpItem,
} from '../../../lib/localPlanApi'
import { BASIS_LABELS, opPlanDeadline, warningText } from '../../../lib/localPlanDeadlines'
import { effectiveItemSet, effectivePlans } from '../../../lib/localPlanProgress'
import { buildOpPlanPrintHtml, openOpPlanPrintWindow } from '../../../lib/localPlanPrint'
import {
  fiscalYearOfIso, latestOpPlan, nextRevisionNo, reorderItems, sortItems, versionLabel,
} from '../../../lib/localPlanView'
import { ListCard, Pills } from '../../patientTransport/StaffShell'
import { Field } from '../construction/ui'
import { btnGhost, btnPrimary, inp } from '../construction/uiStyles'
import OpImportSheet from './OpImportSheet'
import OpItemSheet from './OpItemSheet'
import OpPlanTable from './OpPlanTable'
import PlanHistory from './PlanHistory'
import PublishBox from './PublishBox'

const blankToNull = v => (v === '' || v === null || v === undefined ? null : v)

const TONES = {
  danger: 'border-red-200 bg-red-50 text-red-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-900',
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  muted: 'border-gray-200 bg-gray-50 text-gray-700',
}

/** ข้อความ + โทนของแถบกำหนด 30 วัน (ข้อ 27) — warningText ให้เฉพาะสถานะที่ต้องเตือน สถานะปกติเขียนเอง */
function deadlineView(d) {
  const text = warningText(d)
  const due = d.dueOn ? thaiShortDate(d.dueOn) : ''
  const holiday = d.dueIsHoliday ? ` · วันครบกำหนดตรงวันหยุด${d.holidayName ? ` (${d.holidayName})` : ''}` : ''
  if (d.state === 'overdue' || d.state === 'due_today') return { tone: 'danger', text }
  if (d.state === 'soon' || d.state === 'published_late') return { tone: 'warn', text }
  if (d.state === 'no_basis') return { tone: 'muted', text }
  if (d.state === 'open') return { tone: 'muted', text: `เหลือ ${d.daysLeft} วัน · ครบกำหนดจัดทำแผนการดำเนินงาน (ข้อ 27) ${due}${d.extended ? ' (ขยายเวลาแล้ว)' : ''}${holiday}` }
  if (d.state === 'published_on_time') return { tone: 'ok', text: `ประกาศทันกำหนด (ครบ ${due}${d.extended ? ' · ขยายเวลาแล้ว' : ''})` }
  return { tone: 'muted', text: text ?? '' }
}

/** การ์ดหัวฉบับ: สถานะ ฐานนับ 30 วัน ช่องขยายเวลา หมายเหตุ + ประกาศ/ยกเลิกประกาศ — key ที่ฉบับ+เวลาแก้ล่าสุด ฟอร์มจึงรีเซ็ตเองเมื่อโหลดข้อมูลใหม่ */
function PlanCard({ opPlan, isManager, deadline, onSaved, onStatusChanged }) {
  const draft = opPlan.status === 'draft'
  const editable = isManager && draft
  const [form, setForm] = useState({
    basis: opPlan.basis ?? '', basis_on: opPlan.basis_on ?? '', basis_ref_no: opPlan.basis_ref_no ?? '',
    extension_ref_no: opPlan.extension_ref_no ?? '', extension_ref_date: opPlan.extension_ref_date ?? '',
    extended_due_on: opPlan.extended_due_on ?? '', note: opPlan.note ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [box, setBox] = useState(null)
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }))
  const view = deadlineView(deadline)

  const save = async () => {
    if (busy) return
    if (editable) {
      if (Boolean(form.basis) !== Boolean(form.basis_on)) return setError('ระบุฐานนับและวันที่ตั้งต้นให้ครบทั้งคู่ (หรือเว้นว่างทั้งคู่)')
      if (form.extended_due_on && !form.extension_ref_no.trim()) return setError('กำหนดใหม่จากการขยายเวลา ต้องมีเลขที่หนังสือขยายเวลา')
    }
    setBusy(true); setError('')
    const columns = editable ? {
      basis: blankToNull(form.basis), basis_on: blankToNull(form.basis_on), basis_ref_no: blankToNull(form.basis_ref_no.trim()),
      extension_ref_no: blankToNull(form.extension_ref_no.trim()), extension_ref_date: blankToNull(form.extension_ref_date),
      extended_due_on: blankToNull(form.extended_due_on), note: blankToNull(form.note.trim()),
    } : { note: blankToNull(form.note.trim()) }
    const { error: saveError } = await saveOpPlan(opPlan.id, columns)
    setBusy(false)
    if (saveError) return setError(friendlyError(saveError))
    onSaved()
  }

  const publish = async ({ publishedOn, announceRefNo }) => {
    const { error: rpcError } = await setOpPlanStatus({ opPlanId: opPlan.id, status: 'published', publishedOn, announceRefNo })
    if (rpcError) return friendlyError(rpcError)
    setBox(null)
    onStatusChanged()
    return ''
  }
  const unpublish = async ({ reason }) => {
    const { error: rpcError } = await setOpPlanStatus({ opPlanId: opPlan.id, status: 'draft', reason })
    if (rpcError) return friendlyError(rpcError)
    setBox(null)
    onStatusChanged()
    return ''
  }

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 text-gray-800">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-bold text-gray-900">ปีงบ {opPlan.fiscal_year} · {versionLabel(opPlan)}</p>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${draft ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {draft ? 'ฉบับร่าง' : `ประกาศใช้แล้ว ${opPlan.published_on ? thaiShortDate(opPlan.published_on) : ''}${opPlan.announce_ref_no ? ` · เลขที่ ${opPlan.announce_ref_no}` : ''}`}
        </span>
      </div>

      <div className={`rounded-xl border px-3 py-2 text-sm ${TONES[view.tone]}`}>
        <p className="break-words">{view.text}</p>
        {deadline.basisLabel && <p className="mt-0.5 break-words text-xs opacity-80">ฐานนับ: {deadline.basisLabel}{opPlan.basis_on ? ` · ${thaiShortDate(opPlan.basis_on)}` : ''}{opPlan.basis_ref_no ? ` · เลขที่ ${opPlan.basis_ref_no}` : ''}</p>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="ฐานนับกำหนด 30 วัน (ข้อ 27)" className="sm:col-span-2">
          <select className={inp} value={form.basis} disabled={!editable} onChange={e => set('basis', e.target.value)}>
            <option value="">— ยังไม่ระบุ —</option>
            {Object.entries(BASIS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label="วันที่ประกาศใช้ / วันที่ได้รับแจ้ง">
          <input type="date" className={inp} value={form.basis_on} disabled={!editable} onChange={e => set('basis_on', e.target.value)} />
        </Field>
        <Field label="เลขที่ประกาศ/หนังสือ">
          <input className={inp} value={form.basis_ref_no} maxLength={200} disabled={!editable} onChange={e => set('basis_ref_no', e.target.value)} />
        </Field>
        <p className="text-xs text-gray-500 sm:col-span-2">ขยายเวลาจัดทำแผนเป็นอำนาจของผู้บริหารท้องถิ่น — กรอกตามหนังสือที่ผู้บริหารลงนามแล้ว ระบบแค่เก็บและนับกำหนดใหม่ให้ ไม่ตัดสินแทน</p>
        <Field label="เลขที่หนังสือขยายเวลา">
          <input className={inp} value={form.extension_ref_no} maxLength={200} disabled={!editable} onChange={e => set('extension_ref_no', e.target.value)} />
        </Field>
        <Field label="ลงวันที่ (หนังสือขยายเวลา)">
          <input type="date" className={inp} value={form.extension_ref_date} disabled={!editable} onChange={e => set('extension_ref_date', e.target.value)} />
        </Field>
        <Field label="กำหนดเสร็จใหม่ (หลังขยายเวลา)">
          <input type="date" className={inp} value={form.extended_due_on} disabled={!editable} onChange={e => set('extended_due_on', e.target.value)} />
        </Field>
        <Field label="หมายเหตุของฉบับ" className="sm:col-span-2">
          <textarea className={inp} rows={2} value={form.note} maxLength={4000} disabled={!isManager} onChange={e => set('note', e.target.value)} />
        </Field>
      </div>
      {!draft && <p className="text-xs text-gray-500">ฉบับที่ประกาศแล้วแก้ได้เฉพาะหมายเหตุ — ถ้าต้องแก้เนื้อหา ให้ทำฉบับเพิ่มเติม/แก้ไขครั้งถัดไป</p>}

      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {isManager && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} onClick={save} disabled={busy}>
            {busy && <Loader2 size={16} className="animate-spin" />}บันทึกข้อมูลฉบับ
          </button>
          {!box && <button type="button" className={btnGhost} onClick={() => setBox(draft ? 'publish' : 'unpublish')}>{draft ? 'ประกาศใช้…' : 'ยกเลิกประกาศ…'}</button>}
        </div>
      )}
      {isManager && box && (
        <PublishBox mode={box} subject="แผนการดำเนินงานฉบับนี้" onSubmit={box === 'publish' ? publish : unpublish} onCancel={() => setBox(null)}
          hint={box === 'publish'
            ? 'ประกาศแล้วทั้งฉบับและทุกรายการแก้ไม่ได้ (แก้ได้เฉพาะหมายเหตุของฉบับ) · โครงการในทะเบียนที่ถูกรายการอ้างจะล็อกชื่อ/รหัส/ยุทธศาสตร์/สถานะ/วงเงิน'
            : 'ยกเลิกไม่ได้ถ้ามีฉบับเพิ่มเติม/แก้ไขครั้งถัดไปของปีนี้ที่ประกาศแล้ว'} />
      )}
    </section>
  )
}

/** กล่องทำฉบับเพิ่มเติม/แก้ไขครั้งถัดไป (หลังฉบับล่าสุดประกาศแล้ว) */
function NextRevisionBox({ revisionNo, busy, onCreate }) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState('amendment')
  const [copy, setCopy] = useState(true)
  if (!open) return <button type="button" className={btnGhost} onClick={() => setOpen(true)}><Plus size={15} />ทำฉบับเพิ่มเติม/แก้ไขครั้งถัดไป</button>
  const pickKind = value => { setKind(value); setCopy(value === 'amendment') } // ฉบับแก้ไข: คัดรายการเดิมไว้ก่อน · ฉบับเพิ่มเติม: เริ่มจากว่าง
  return (
    <div className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50/60 p-3 text-gray-800">
      <p className="text-sm font-bold">ทำฉบับถัดไป (ครั้งที่ {revisionNo})</p>
      <div className="flex flex-wrap gap-4" role="radiogroup" aria-label="ชนิดฉบับ">
        {[['amendment', 'แก้ไข'], ['supplement', 'เพิ่มเติม']].map(([value, label]) => (
          <label key={value} className="flex min-h-11 items-center gap-2 text-sm font-semibold">
            <input type="radio" name="op-kind" className="size-5" checked={kind === value} onChange={() => pickKind(value)} />{label}
          </label>
        ))}
      </div>
      <label className="flex min-h-11 items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={copy} onChange={e => setCopy(e.target.checked)} />
        <span><span className="font-semibold">คัดรายการจากฉบับล่าสุดของปีนี้</span><span className="block text-xs text-gray-500">คัดแล้วแก้ต่อจากของเดิม · ฉบับแก้ไขคัดรายการทั้งปี (ฉบับหลัก + ฉบับเพิ่มเติม) · ไม่คัด = เริ่มจากฉบับว่าง</span></span>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} disabled={busy} onClick={() => onCreate({ kind, copy })}>
          {busy && <Loader2 size={16} className="animate-spin" />}สร้างฉบับร่าง
        </button>
        <button type="button" className={btnGhost} onClick={() => setOpen(false)} disabled={busy}>ยกเลิก</button>
      </div>
    </div>
  )
}

/**
 * plan = แผนพัฒนาที่เลือก · opPlans/items(เบา) = ของแผนนี้ · onChanged() = ให้หน้าหลักโหลดข้อมูลแผนใหม่
 * ต้องใส่ key={plan.id} ที่ผู้เรียก — สถานะปีงบ/ฉบับที่เลือกจะได้เริ่มใหม่เมื่อเปลี่ยนแผน
 */
export default function OpPlanTab({ tenant, profile, plan, isManager, departments, projects, years, opPlans, lightItems, holidaysVersion, onChanged }) {
  const today = bangkokIsoDate()
  const [fiscalYear, setFiscalYear] = useState(() => {
    const current = fiscalYearOfIso(today)
    return current >= plan.year_from && current <= plan.year_to ? current : plan.year_from
  })
  const [chosenId, setChosenId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sheet, setSheet] = useState(null) // { item }
  const [importOpen, setImportOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [itemsState, setItemsState] = useState({ planId: null, items: [], error: '' })
  const [itemsReload, setItemsReload] = useState(0)

  const planYears = useMemo(() => Array.from({ length: plan.year_to - plan.year_from + 1 }, (_, i) => plan.year_from + i), [plan.year_from, plan.year_to])
  const yearPlans = useMemo(() => opPlans.filter(p => p.fiscal_year === fiscalYear).sort((a, b) => a.revision_no - b.revision_no), [opPlans, fiscalYear])
  const latest = latestOpPlan(opPlans, fiscalYear)
  const opPlan = yearPlans.find(p => p.id === chosenId) ?? latest ?? null

  useEffect(() => {
    if (!opPlan?.id || !tenant?.id) return undefined
    let alive = true
    ;(async () => {
      const { items, error: loadError } = await fetchOpItems(tenant.id, opPlan.id)
      if (alive) setItemsState({ planId: opPlan.id, items, error: loadError ? friendlyError(loadError) : '' })
    })()
    return () => { alive = false }
  }, [tenant?.id, opPlan?.id, itemsReload])

  const itemsReady = Boolean(opPlan) && itemsState.planId === opPlan.id
  const items = useMemo(() => (itemsReady ? sortItems(itemsState.items) : []), [itemsReady, itemsState.items])
  // วันหยุดโหลดจากฐานข้อมูลทีหลังหน้าจอ — holidaysVersion เป็น dependency โดยตั้งใจ (แพตเทิร์นเดียวกับ WasteScheduleManager)
  const deadline = useMemo(() => {
    void holidaysVersion
    return opPlan ? opPlanDeadline(opPlan, today) : null
  }, [opPlan, today, holidaysVersion])

  const reloadAll = () => { setItemsReload(k => k + 1); onChanged() }
  const patchItem = (id, patch) => setItemsState(s => ({ ...s, items: s.items.map(i => (i.id === id ? { ...i, ...patch } : i)) }))

  const createMain = async () => {
    setBusy(true); setError('')
    const { opPlan: created, error: createError } = await createOpPlan({ municipalityId: tenant.id, devPlanId: plan.id, fiscalYear, kind: 'main', revisionNo: 0 })
    setBusy(false)
    if (createError) return setError(friendlyError(createError))
    setChosenId(created.id)
    onChanged()
  }

  const createNext = async ({ kind, copy }) => {
    setBusy(true); setError('')
    // ฉบับแก้ไขต้องคัด "ชุดรายการที่มีผลทั้งปี" (ฉบับหลัก/แก้ไขล่าสุด + ฉบับเพิ่มเติมที่ตามมา) ไม่ใช่เฉพาะรายการในฉบับล่าสุด
    // บั๊กเดิม: ถ้าฉบับล่าสุดเป็นฉบับเพิ่มเติม (มีแต่รายการใหม่) ฉบับแก้ไขที่คัดจากมันจะไม่มีรายการของฉบับหลักเลย
    // ฉบับเพิ่มเติมที่เลือกคัดยังคัดจากฉบับล่าสุดตามเดิม (ผู้ใช้ตั้งใจเริ่มจากชุดเล็กอยู่แล้ว)
    let copyItems = null
    if (copy && kind === 'amendment') {
      const needed = effectivePlans(opPlans, fiscalYear, { publishedOnly: false })
      const loaded = await Promise.all(needed.map(p => fetchOpItems(tenant.id, p.id)))
      const failed = loaded.find(r => r.error)
      if (failed) { setBusy(false); return setError(friendlyError(failed.error)) }
      copyItems = effectiveItemSet(opPlans, loaded.flatMap(r => r.items), fiscalYear, { publishedOnly: false })
    }
    const { opPlan: created, error: createError } = await createOpPlan({
      municipalityId: tenant.id, devPlanId: plan.id, fiscalYear, kind, revisionNo: nextRevisionNo(opPlans, fiscalYear),
      copyFromId: copy ? latest.id : null, copyItems,
    })
    setBusy(false)
    if (createError) return setError(friendlyError(createError))
    setChosenId(created.id)
    onChanged()
  }

  const saveMonths = async (item, from, to) => {
    const { item: saved, error: saveError } = await updateOpItem(item.id, { month_from: from, month_to: to })
    if (saveError) return friendlyError(saveError)
    patchItem(item.id, saved)
    return ''
  }

  // พิมพ์ใบแผน (ทุกคนที่เห็นแท็บ) — เปิดหน้าต่างทันทีที่กดปุ่ม (กัน pop-up blocker บนมือถือ) · ข้อมูล ณ วันนี้ตามเวลาไทย
  const printPlan = () => {
    if (!itemsReady || !opPlan) return
    setError(''); setNotice('')
    const html = buildOpPlanPrintHtml({ tenant, opPlan, items, departments, asOf: bangkokIsoDate() })
    if (!openOpPlanPrintWindow(html)) setError('เบราว์เซอร์ปิดกั้นหน้าต่างพิมพ์ กรุณาอนุญาต pop-up แล้วลองใหม่')
  }

  const move = async (item, direction) => {
    const changes = reorderItems(items, item.id, direction)
    if (!changes.length) return
    setBusy(true); setError('')
    const { error: orderError } = await saveItemOrder(changes)
    setBusy(false)
    if (orderError) { setError(friendlyError(orderError)); return setItemsReload(k => k + 1) }
    setItemsState(s => ({ ...s, items: s.items.map(i => { const c = changes.find(x => x.id === i.id); return c ? { ...i, sort_order: c.sort_order } : i }) }))
  }

  const draftExists = Boolean(latest) && latest.status === 'draft'
  const isLatest = opPlan && latest && opPlan.id === latest.id
  const manage = isManager && opPlan?.status === 'draft'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-gray-500">ปีงบประมาณ</span>
          <select className="min-h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-800" value={fiscalYear}
            onChange={e => { setFiscalYear(Number(e.target.value)); setChosenId(null); setError(''); setNotice('') }}>
            {planYears.map(y => <option key={y} value={y}>ปีงบ {y}</option>)}
          </select>
        </label>
        {yearPlans.length > 1 && (
          <div className="min-w-0 flex-1">
            <Pills label="เลือกฉบับ" value={opPlan?.id} onChange={setChosenId}
              items={yearPlans.map(p => ({ id: p.id, label: versionLabel(p), count: lightItems.filter(i => i.op_plan_id === p.id).length, color: p.status === 'published' ? '#15803d' : '#d97706' }))} />
          </div>
        )}
      </div>

      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}

      {!opPlan && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-5 py-10 text-center text-gray-800">
          <p className="text-sm text-gray-600">ยังไม่มีแผนการดำเนินงานของปีงบ {fiscalYear}</p>
          {isManager
            ? <button type="button" className={`${btnPrimary} mt-3`} style={{ backgroundColor: 'var(--color-primary)' }} onClick={createMain} disabled={busy}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}สร้างแผนการดำเนินงานปี {fiscalYear}
            </button>
            : <p className="mt-1 text-xs text-gray-500">นักวิเคราะห์นโยบายและแผนเป็นผู้สร้าง</p>}
        </div>
      )}

      {opPlan && deadline && (
        <>
          <PlanCard key={`${opPlan.id}|${opPlan.updated_at}`} opPlan={opPlan} isManager={isManager} deadline={deadline} onSaved={reloadAll} onStatusChanged={reloadAll} />

          {isManager && opPlan.status === 'published' && isLatest && <NextRevisionBox revisionNo={nextRevisionNo(opPlans, fiscalYear)} busy={busy} onCreate={createNext} />}
          {isManager && opPlan.status === 'published' && !isLatest && draftExists && <p className="text-xs text-gray-500">มีฉบับร่างครั้งถัดไปของปีนี้อยู่แล้ว — เลือกฉบับล่าสุดด้านบนเพื่อแก้ต่อ</p>}

          <ListCard title={`รายการในแผน · ปีงบ ${opPlan.fiscal_year} · ${versionLabel(opPlan)}`} count={items.length}
            action={(
              <>
                {manage && <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} onClick={() => setSheet({ item: null })} disabled={!itemsReady}><Plus size={16} />เพิ่มรายการ</button>}
                {manage && <button type="button" className={btnGhost} onClick={() => { setNotice(''); setImportOpen(true) }} disabled={!itemsReady}><Upload size={16} />นำเข้า</button>}
                <button type="button" className={btnGhost} onClick={printPlan} disabled={!itemsReady}><Printer size={16} />พิมพ์</button>
              </>
            )}>
            {itemsState.error && <p role="alert" className="m-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">โหลดรายการไม่สำเร็จ — {itemsState.error}</p>}
            {!itemsReady && !itemsState.error && <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500"><Loader2 className="animate-spin" size={16} />กำลังโหลดรายการ…</div>}
            {itemsReady && (
              <OpPlanTable opPlan={opPlan} items={items} departments={departments} isManager={isManager} role={profile?.role} myDepartmentId={profile?.department_id ?? null}
                busy={busy} onSaveMonths={saveMonths} onEdit={item => setSheet({ item })} onMove={move} onAdd={() => setSheet({ item: null })} onError={setError} />
            )}
          </ListCard>

          <div>
            {showHistory
              ? <PlanHistory tenantId={tenant.id} entityId={opPlan.id} includeChildren departments={departments} reloadKey={itemsReload} title={`ประวัติ · ${versionLabel(opPlan)} (รวมรายการในฉบับ)`} />
              : <button type="button" className={btnGhost} onClick={() => setShowHistory(true)}><History size={15} />ดูประวัติของฉบับนี้</button>}
          </div>
        </>
      )}

      {importOpen && opPlan && manage && (
        <OpImportSheet
          tenant={tenant} opPlan={opPlan} existingItems={items} departments={departments} projects={projects}
          onClose={() => setImportOpen(false)}
          onImported={count => { setImportOpen(false); setNotice(`นำเข้าแล้ว ${count} รายการ (ต่อท้ายรายการเดิม)`); reloadAll() }}
        />
      )}

      {sheet && opPlan && (
        <OpItemSheet
          key={sheet.item?.id ?? 'new'}
          tenant={tenant} profile={profile} isManager={isManager} opPlan={opPlan} item={sheet.item} items={items}
          projects={projects} years={years} departments={departments}
          onClose={() => setSheet(null)}
          onSaved={() => { setSheet(null); reloadAll() }}
          onDeleted={() => { setSheet(null); reloadAll() }}
        />
      )}
    </div>
  )
}
