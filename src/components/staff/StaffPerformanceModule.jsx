import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Download, Info, Loader2, Printer } from 'lucide-react'
import { ListCard, Pills } from '../patientTransport/StaffShell'
import { logAction } from '../../lib/auditLog'
import { MONTH_OPTIONS, QUARTERS, fiscalYearOptionsBE, yearOptionsBE } from '../../lib/fleetReportPeriod'
import {
  CHANNEL_LABELS, DIMENSION_LABELS, EVALUATION_ROUNDS, LIST_PAGE_SIZE, PERFORMANCE_PERIOD_MODES,
  defaultPerformancePeriod, normalizePerformanceRows, pageWindow, performanceCsvRows, performancePeriodRange,
  summarizePerformance, thaiShortDate, toCsv,
} from '../../lib/staffPerformance'
import { buildStaffPerformanceHtml, pickCertifier } from '../../lib/staffPerformancePrint'
import {
  canViewOthers, loadCategoryLabels, loadPeople, loadPerformanceRows, loadPersonCard, loadSignatoryRegistry,
} from '../../lib/staffPerformanceData'
import { groupStaffByDepartment } from '../../lib/staffRoster'
import { printableCategoryLabel, categoryNameOf } from '../../lib/complaintCategoryLabels'

// เมนู "ผลการปฏิบัติงาน" — ผลงานรายคนจากคำร้อง ใช้ดูและพิมพ์ตอนประเมินผลการปฏิบัติงาน
// ระบบรวบรวมเองจากที่เจ้าหน้าที่กดอยู่แล้วทุกวัน ไม่มีช่องกรอก ไม่ให้คะแนน ไม่จัดอันดับคน
// หัวเรื่องของหน้าวาดโดย ModuleHeader ใน StaffDashboard — ห้ามวาดซ้ำที่นี่

const selectCls = 'w-full px-3 py-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-xl focus:outline-none'
const labelCls = 'text-xs font-semibold text-gray-500 mb-1 block'
const OPEN_STATUS_LABELS = { received: 'รับเรื่องแล้ว', in_progress: 'กำลังดำเนินการ' }
const DUE_LABELS = { on_time: 'ทันกำหนด', late: 'เกินกำหนด', no_due: 'ไม่มีกำหนด' }
const DUE_COLORS = { on_time: '#047857', late: '#b91c1c', no_due: '#6b7280' }
const FISCAL_YEARS = fiscalYearOptionsBE(new Date(), 4, 0).reverse()
const CALENDAR_YEARS = yearOptionsBE(new Date(), 4, 0).reverse()

// เปิดหน้าต่างก่อนรอข้อมูลใดๆ (ข้อมูลโหลดมาแล้วตอนนี้) ไม่งั้นเบราว์เซอร์มือถือบล็อก pop-up
// แล้วรอฟอนต์ราชการก่อนสั่งพิมพ์ แบบเดียวกับ FleetReport.jsx
function openPrintWindow(html) {
  const win = window.open('', '_blank', 'width=1150,height=800')
  if (!win) {
    alert('เบราว์เซอร์ปิดกั้นหน้าต่างพิมพ์ กรุณาอนุญาต pop-up แล้วลองใหม่')
    return
  }
  win.document.open()
  win.document.write(html)
  win.document.close()
  setTimeout(async () => {
    try {
      if (win.document.fonts?.ready) {
        await Promise.race([win.document.fonts.ready, new Promise(resolve => setTimeout(resolve, 1200))])
      }
    } catch { /* โหลดฟอนต์ไม่ทันก็พิมพ์ด้วยฟอนต์บนเครื่อง */ }
    win.focus()
    win.print()
  }, 200)
}

function downloadText(text, filename) {
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })),
    download: filename,
  })
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

const rateText = value => (value == null ? '–' : `${value}%`)

function DimensionCard({ title, value, caption, lines, color }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-bold" style={{ color }}>{title}</p>
      <p className="mt-1 text-2xl font-extrabold text-gray-800">{value}</p>
      <p className="text-xs font-semibold text-gray-500">{caption}</p>
      <ul className="mt-2 space-y-0.5 text-[11px] text-gray-500">
        {lines.map(line => <li key={line}>{line}</li>)}
      </ul>
    </div>
  )
}

export default function StaffPerformanceModule({ tenant, profile }) {
  const tenantId = tenant?.id
  const me = profile
  const [people, setPeople] = useState([])
  const [pickedPersonId, setPersonId] = useState(null)
  const [period, setPeriod] = useState(() => defaultPerformancePeriod())
  const [category, setCategory] = useState('all')
  const [list, setList] = useState('completed')
  const [labels, setLabels] = useState({})
  const [registry, setRegistry] = useState([])
  const [card, setCard] = useState(null)
  const [result, setResult] = useState({ rows: [], error: null, incomplete: false, key: '' })
  // หน้าของตารางรายการ จำคู่กับอาร์เรย์รายการที่แบ่งอยู่ — เปลี่ยนช่วง/คน/หมวด = คำนวณสรุปใหม่ = อาร์เรย์ใหม่ = กลับหน้า 1
  // เองโดยไม่ต้อง reset ใน effect (แบบเดียวกับ usePagedRows ของ FleetReport) · สลับกลุ่มรายการ (แล้วเสร็จ/ค้าง/ไม่ทราบวัน)
  // อาร์เรย์เดิมยังเป็นตัวเดิม จึงต้องสั่งรีเซ็ตเองที่ปุ่ม ไม่งั้นสลับไปแล้วกลับมาจะค้างหน้าเก่า
  const [paging, setPaging] = useState({ rows: null, page: 0 })
  const listTopRef = useRef(null)

  // ผู้บริหารไม่มีคำร้องของตัวเอง จึงเริ่มที่คนแรกในรายชื่อแทนตัวเอง
  const defaultPersonId = me?.role === 'viewer' ? (people[0]?.id ?? null) : (me?.id ?? null)
  const personId = pickedPersonId ?? defaultPersonId
  const range = useMemo(() => performancePeriodRange(period), [period])
  const requestKey = personId && range.from && range.to ? `${personId}|${range.from}|${range.to}` : ''
  const loading = Boolean(requestKey) && result.key !== requestKey
  const viewingOther = Boolean(me?.id && personId && personId !== me.id)
  const updatePeriod = patch => setPeriod(current => ({ ...current, ...patch }))

  useEffect(() => {
    if (!tenantId || !me?.id) return
    let cancelled = false
    loadPeople(tenantId, me).then(list => { if (!cancelled) setPeople(list) })
    return () => { cancelled = true }
  }, [tenantId, me])

  useEffect(() => {
    if (!tenantId) return
    let cancelled = false
    Promise.all([loadCategoryLabels(tenantId), loadSignatoryRegistry(tenantId)]).then(([labelMap, rows]) => {
      if (cancelled) return
      setLabels(labelMap)
      setRegistry(rows)
    })
    return () => { cancelled = true }
  }, [tenantId])

  useEffect(() => {
    if (!personId) return
    let cancelled = false
    loadPersonCard(personId).then(value => { if (!cancelled) setCard(value) })
    return () => { cancelled = true }
  }, [personId])

  useEffect(() => {
    if (!requestKey) return
    let cancelled = false
    const [id, from, to] = requestKey.split('|')
    loadPerformanceRows(id, from, to).then(res => {
      if (!cancelled) setResult({ ...res, key: requestKey })
    })
    return () => { cancelled = true }
  }, [requestKey])

  const personName = card?.id === personId ? card.name : ''
  const audit = (action, extra = {}) => {
    if (!viewingOther || !tenantId) return
    logAction({
      action, resourceType: 'staff_performance', resourceId: personId,
      resourceLabel: `${personName || personId} · ${range.label}`, municipalityId: tenantId,
      metadata: { from: range.from, to: range.to, ...extra },
    })
  }

  // ผลการปฏิบัติงานของคนอื่นเป็นข้อมูลส่วนบุคคลของเจ้าหน้าที่ — บันทึกร่องรอยการเปิดดูทุกครั้งที่โหลด
  useEffect(() => {
    if (!result.key || result.error || !viewingOther || !tenantId) return
    const [id, from, to] = result.key.split('|')
    logAction({
      action: 'view_staff_performance', resourceType: 'staff_performance', resourceId: id,
      resourceLabel: `${from} – ${to}`, municipalityId: tenantId, metadata: { from, to },
    })
  }, [result.key, result.error, viewingOther, tenantId])

  const items = useMemo(() => normalizePerformanceRows(result.rows), [result.rows])
  const categoryOptions = useMemo(() => [...new Set(items.map(i => i.category).filter(Boolean))]
    .filter(value => !items.some(i => i.category === value && i.isConfidential)), [items])
  const scopedItems = useMemo(() => (category === 'all' ? items : items.filter(i => i.category === category)),
    [items, category])
  const summary = useMemo(() => summarizePerformance(scopedItems, { from: range.from, to: range.to }),
    [scopedItems, range.from, range.to])
  const certifier = pickCertifier(registry, { departmentId: card?.departmentId, personId })
  const scopeNote = viewingOther && me?.role === 'officer'
    ? 'นับเฉพาะคำร้องของกองที่ผู้พิมพ์สังกัด ฉบับที่นับครบทุกเรื่องคือฉบับที่เจ้าตัวพิมพ์เอง'
    : ''
  const categoryLabel = category === 'all' ? '' : printableCategoryLabel(category, labels[category] ?? category)
  const canOutput = !loading && !result.error && Boolean(card?.id === personId)

  function handlePrint() {
    openPrintWindow(buildStaffPerformanceHtml({
      tenant, person: card, periodLabel: range.label, categoryLabel, summary,
      categoryLabels: labels, certifier, scopeNote,
    }))
    audit('print_staff_performance', { category })
  }

  function handleCsv() {
    const csv = toCsv(performanceCsvRows(summary, { categoryLabels: labels }))
    downloadText(csv, `ผลการปฏิบัติงาน_${personName || 'บุคคล'}_${range.from}_${range.to}.csv`)
    audit('export_staff_performance', { category })
  }

  const { total } = summary
  const legacyCount = summary.completedItems.filter(i => i.completionSource === 'legacy').length
  const hidden = summary.confidential.completed + summary.confidential.openAtEnd
  const listItems = list === 'completed' ? summary.completedItems : list === 'open' ? summary.openItems : summary.undatedItems
  // แบ่งหน้าเฉพาะที่แสดงบนจอ — ตัวเลขสรุป ใบพิมพ์ และ CSV ใช้ทุกรายการของช่วงที่เลือก ไม่ผ่านตรงนี้
  const win = pageWindow(listItems.length, paging.rows === listItems ? paging.page : 0)
  const pageItems = listItems.slice(win.start, win.end)
  function goToPage(next) {
    setPaging({ rows: listItems, page: next })
    // กดจากท้ายตารางบนมือถือแล้วหน้าใหม่ต้องเริ่มที่บนสุดของตาราง ไม่ใช่ค้างท้ายหน้า
    const top = listTopRef.current
    if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: 'start' })
  }
  const errorText = result.error
    ? (result.error.code === '42501' ? 'ไม่มีสิทธิ์ดูผลการปฏิบัติงานของบุคคลนี้' : `โหลดข้อมูลไม่สำเร็จ: ${result.error.message}`)
    : ''

  return (
    <div className="space-y-3 md:space-y-4">
      <div className="space-y-2.5 rounded-xl border border-gray-100 bg-white p-3 shadow-sm md:space-y-3 md:rounded-2xl md:p-4">
        <p className="text-xs font-bold text-gray-700 md:text-sm">เลือกข้อมูลที่ต้องการดู</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="ช่วงเวลา">
          {PERFORMANCE_PERIOD_MODES.map(mode => (
            <button key={mode.value} type="button" aria-pressed={period.mode === mode.value}
              onClick={() => updatePeriod({ mode: mode.value })}
              className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold md:text-xs ${period.mode === mode.value
                ? 'border-transparent text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
              style={period.mode === mode.value ? { backgroundColor: 'var(--color-primary)' } : undefined}>
              {mode.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
          {canViewOthers(me?.role) && (
            <div className="col-span-2 md:col-span-1">
              <label className={labelCls} htmlFor="performance-person">ผู้รับผิดชอบ</label>
              <select id="performance-person" value={personId ?? ''} onChange={e => setPersonId(e.target.value)} className={selectCls}>
                {groupStaffByDepartment(people).map(group => (
                  <optgroup key={group.department_name} label={group.department_name}>
                    {group.members.map(p => (
                      <option key={p.id} value={p.id}>{p.full_name || p.email || '—'}{p.id === me?.id ? ' (ตัวเอง)' : ''}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          )}
          {period.mode === 'month' && (
            <div>
              <label className={labelCls} htmlFor="performance-month">เดือน</label>
              <select id="performance-month" value={period.month} onChange={e => updatePeriod({ month: Number(e.target.value) })} className={selectCls}>
                {MONTH_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          )}
          {period.mode === 'quarter' && (
            <div>
              <label className={labelCls} htmlFor="performance-quarter">ไตรมาส</label>
              <select id="performance-quarter" value={period.quarter} onChange={e => updatePeriod({ quarter: Number(e.target.value) })} className={selectCls}>
                {QUARTERS.map(q => <option key={q.value} value={q.value}>{q.label}</option>)}
              </select>
            </div>
          )}
          {period.mode === 'round' && (
            <div>
              <label className={labelCls} htmlFor="performance-round">รอบการประเมิน</label>
              <select id="performance-round" value={period.round} onChange={e => updatePeriod({ round: Number(e.target.value) })} className={selectCls}>
                {EVALUATION_ROUNDS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className={labelCls} htmlFor="performance-year">{period.mode === 'month' ? 'ปี พ.ศ.' : 'ปีงบประมาณ พ.ศ.'}</label>
            <select id="performance-year" className={selectCls}
              value={period.mode === 'month' ? period.yearBE : period.fiscalYearBE}
              onChange={e => updatePeriod(period.mode === 'month'
                ? { yearBE: Number(e.target.value) } : { fiscalYearBE: Number(e.target.value) })}>
              {(period.mode === 'month' ? CALENDAR_YEARS : FISCAL_YEARS).map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="col-span-2 md:col-span-1">
            <label className={labelCls} htmlFor="performance-category">หมวดคำร้อง</label>
            <select id="performance-category" value={category} onChange={e => setCategory(e.target.value)} className={selectCls}>
              <option value="all">ทุกหมวด</option>
              {categoryOptions.map(value => <option key={value} value={value}>{categoryNameOf(labels, value)}</option>)}
            </select>
          </div>
        </div>
        <p className="text-[11px] text-gray-500">ช่วงที่เลือก: {range.label}</p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={handlePrint} disabled={!canOutput}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            <Printer size={14} />พิมพ์รายงาน (A4)
          </button>
          <button type="button" onClick={handleCsv} disabled={!canOutput}
            className="flex items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            <Download size={14} />ดาวน์โหลด CSV
          </button>
        </div>
      </div>

      {errorText && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />{errorText}
        </div>
      )}
      {result.incomplete && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          ข้อมูลที่โหลดได้ไม่ครบตามจำนวนในระบบ ตัวเลขด้านล่างอาจต่ำกว่าจริง กรุณาเปลี่ยนช่วงหรือโหลดหน้าใหม่ก่อนพิมพ์
        </div>
      )}

      {loading ? (
        <div className="flex min-h-40 flex-col items-center justify-center rounded-2xl bg-white text-gray-400 shadow-sm ring-1 ring-gray-100">
          <Loader2 size={26} className="animate-spin text-blue-500" />
          <p className="mt-2 text-xs">กำลังรวบรวมผลการปฏิบัติงาน...</p>
        </div>
      ) : !errorText && (
        <>
          <div className="grid gap-2 md:grid-cols-3 md:gap-3">
            <DimensionCard title={DIMENSION_LABELS.quantity} color="#0369a1"
              value={total.quantity.completed} caption="เรื่องที่แล้วเสร็จในช่วงนี้"
              lines={[
                `รับในช่วง ${total.quantity.received} · เสร็จภายในช่วง ${total.quantity.receivedDone} (${rateText(total.quantity.receivedDoneRate)})`,
                `ค้าง ณ สิ้นช่วง ${total.quantity.openAtEnd} เรื่อง`,
              ]} />
            <DimensionCard title={DIMENSION_LABELS.quality} color="#6d28d9"
              value={rateText(total.quality.notReopenedRate)} caption="ผู้ร้องไม่เปิดเรื่องกลับ"
              lines={[
                `เปิดกลับ ${total.quality.reopened} เรื่อง`,
                total.quality.ratingCount
                  ? `คะแนนผู้ร้องเฉลี่ย ${total.quality.ratingAverage} จาก ${total.quality.ratingCount} เรื่อง`
                  : 'ยังไม่มีผู้ร้องให้คะแนน',
              ]} />
            <DimensionCard title={DIMENSION_LABELS.benefit} color="#047857"
              value={rateText(total.benefit.onTimeRate)} caption="เสร็จทันกำหนด"
              lines={[
                `ทัน ${total.benefit.onTime} · เกิน ${total.benefit.late} · ค้างเลยกำหนด ${total.benefit.openPastDue}`,
                total.benefit.medianWorkingDays == null ? 'ยังไม่มีเรื่องที่นับวันทำการได้' : `มัธยฐาน ${total.benefit.medianWorkingDays} วันทำการ`,
              ]} />
          </div>

          <div className="space-y-1 rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-[11px] leading-relaxed text-gray-600">
            <p className="flex items-start gap-1.5"><Info size={13} className="mt-0.5 shrink-0 text-blue-500" />
              ใช้ประกอบแบบประเมินผลการปฏิบัติงาน ส่วนที่ 1 ผลสัมฤทธิ์ของงาน — ระบบไม่ให้คะแนน ผู้ประเมินเทียบกับค่าเป้าหมายตามข้อตกลงเอง</p>
            {legacyCount > 0 && <p>† {legacyCount} เรื่องใช้วันที่จากประวัติการดำเนินงาน (ก่อนมีปุ่ม "ดำเนินการแล้ว") · เรื่องเก่าที่ค้างสถานะ "รอปิด" อย่ากด "ดำเนินการแล้ว" ซ้ำ ระบบจะบันทึกวันเสร็จเป็นวันที่กด</p>}
            {summary.undatedItems.length > 0 && <p>ไม่ทราบวันแล้วเสร็จ {summary.undatedItems.length} เรื่อง แสดงแยก ไม่นับในตัวเลข</p>}
            {hidden > 0 && <p>เรื่องที่ต้องปกปิดตามหมวด {hidden} เรื่อง นับจำนวนอย่างเดียว ไม่แสดงรายละเอียด</p>}
            {summary.rejected > 0 && <p>ไม่รับเรื่อง {summary.rejected} เรื่อง</p>}
            {summary.holidayYearsMissing.length > 0 && <p className="font-semibold text-amber-700">ยังไม่มีวันหยุดราชการของปี พ.ศ. {summary.holidayYearsMissing.map(y => y + 543).join(', ')} ในระบบ วันทำการของปีนั้นตัดเฉพาะเสาร์-อาทิตย์</p>}
            {scopeNote && <p className="font-semibold text-amber-700">{scopeNote}</p>}
          </div>

          {summary.byCategory.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-gray-300 bg-white shadow-sm">
              <table className="w-full min-w-[720px] border-collapse text-xs text-gray-700">
                <thead className="bg-[#1a3a5c] text-white">
                  <tr>
                    <th rowSpan={2} className="px-3 py-2 text-left">หมวดคำร้อง</th>
                    <th colSpan={3} className="border-l border-white/20 px-3 py-1.5">{DIMENSION_LABELS.quantity}</th>
                    <th colSpan={2} className="border-l border-white/20 px-3 py-1.5">{DIMENSION_LABELS.quality}</th>
                    <th colSpan={2} className="border-l border-white/20 px-3 py-1.5">{DIMENSION_LABELS.benefit}</th>
                  </tr>
                  <tr className="text-[11px] font-semibold">
                    <th className="border-l border-white/20 px-2 py-1">แล้วเสร็จ</th><th className="px-2 py-1">รับ/เสร็จในช่วง</th><th className="px-2 py-1">ค้างสิ้นช่วง</th>
                    <th className="border-l border-white/20 px-2 py-1">ไม่ถูกเปิดกลับ</th><th className="px-2 py-1">คะแนน (เรื่อง)</th>
                    <th className="border-l border-white/20 px-2 py-1">ทันกำหนด</th><th className="px-2 py-1">มัธยฐานวันทำการ</th>
                  </tr>
                </thead>
                <tbody>
                  {[...summary.byCategory, ...(summary.byCategory.length > 1 ? [total] : [])].map(group => {
                    const base = group.benefit.onTime + group.benefit.late + group.benefit.openPastDue
                    const isTotal = group === total
                    return (
                      <tr key={group.category ?? 'total'} className={`border-t border-gray-200 text-center ${isTotal ? 'bg-gray-50 font-bold' : ''}`}>
                        <td className="px-3 py-2 text-left">{isTotal ? 'รวมทุกหมวด' : (categoryNameOf(labels, group.category))}</td>
                        <td className="px-2 py-2">{group.quantity.completed}</td>
                        <td className="px-2 py-2">{group.quantity.received ? `${group.quantity.receivedDone}/${group.quantity.received} (${rateText(group.quantity.receivedDoneRate)})` : '–'}</td>
                        <td className="px-2 py-2">{group.quantity.openAtEnd}</td>
                        <td className="px-2 py-2">{group.quantity.completed ? `${group.quality.notReopened}/${group.quantity.completed} (${rateText(group.quality.notReopenedRate)})` : '–'}</td>
                        <td className="px-2 py-2">{group.quality.ratingCount ? `${group.quality.ratingAverage} (${group.quality.ratingCount})` : '–'}</td>
                        <td className="px-2 py-2">{base ? `${group.benefit.onTime}/${base} (${rateText(group.benefit.onTimeRate)})` : '–'}</td>
                        <td className="px-2 py-2">{group.benefit.medianWorkingDays ?? '–'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div ref={listTopRef}>
          <ListCard title="รายการคำร้องของผู้รับผิดชอบ" count={listItems.length}
            pills={<Pills value={list} onChange={next => { setList(next); setPaging({ rows: null, page: 0 }) }} label="กลุ่มรายการ" items={[
              { id: 'completed', label: 'แล้วเสร็จในช่วงนี้', count: summary.completedItems.length, color: '#047857' },
              { id: 'open', label: 'ค้าง ณ สิ้นช่วง', count: summary.openItems.length, color: '#d97706' },
              { id: 'undated', label: 'ไม่ทราบวันแล้วเสร็จ', count: summary.undatedItems.length, color: '#6b7280' },
            ]} />}>
            {listItems.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-gray-400">ไม่มีคำร้องในกลุ่มนี้</p>
            ) : (
              <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-xs">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="px-3 py-2 text-left">เลขที่</th><th className="px-3 py-2 text-left">หมวด / ลักษณะปัญหา</th>
                      <th className="px-3 py-2 text-left">หมู่บ้าน</th><th className="px-3 py-2">วันที่รับเรื่อง</th>
                      <th className="px-3 py-2">{list === 'open' ? 'วันครบกำหนด' : 'วันที่แล้วเสร็จ'}</th>
                      <th className="px-3 py-2">{list === 'open' ? 'สถานะ' : 'วันทำการ'}</th>
                      {list === 'completed' && <th className="px-3 py-2">ผลเทียบกำหนด</th>}
                      <th className="px-3 py-2 text-left">หมายเหตุ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map(item => (
                      <tr key={item.id} className="border-t border-gray-100 align-top">
                        <td className="whitespace-nowrap px-3 py-2 font-semibold text-gray-700">{item.refNo ?? '—'}</td>
                        <td className="px-3 py-2 text-gray-700">{categoryNameOf(labels, item.category)}{item.issueType && <span className="block text-gray-400">{item.issueType}</span>}</td>
                        <td className="px-3 py-2 text-gray-600">{item.village ?? ''}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-center text-gray-600">{thaiShortDate(item.receivedDate)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-center text-gray-600">
                          {list === 'open'
                            ? <>{item.dueDate ? thaiShortDate(item.dueDate) : '–'}{item.pastDue && <span className="ml-1 font-bold text-red-600">เลยกำหนด</span>}</>
                            : <>{thaiShortDate(item.completedDate) || '–'}{item.completionSource === 'legacy' && ' †'}</>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-center text-gray-600">
                          {list === 'open'
                            ? (item.finishedAfterPeriod ? `เสร็จ ${thaiShortDate(item.completedDate)}` : (OPEN_STATUS_LABELS[item.status] ?? item.status))
                            : (item.workingDays ?? '–')}
                        </td>
                        {list === 'completed' && (
                          <td className="whitespace-nowrap px-3 py-2 text-center font-semibold" style={{ color: DUE_COLORS[item.dueResult] }}>{DUE_LABELS[item.dueResult] ?? ''}</td>
                        )}
                        <td className="px-3 py-2 text-gray-500">{[
                          item.reopened && 'ผู้ร้องเปิดเรื่องกลับ',
                          item.closedOnBehalfBy && `ปิดงานแทนโดย ${item.closedOnBehalfBy}`,
                          item.rating != null && `คะแนนผู้ร้อง ${item.rating}/5`,
                          item.channel === 'oss_counter' && `รับแจ้งที่${CHANNEL_LABELS.oss_counter}`,
                          item.dateAnomaly && 'วันที่แล้วเสร็จก่อนวันรับเรื่อง ตรวจสอบข้อมูล',
                        ].filter(Boolean).join(' · ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {listItems.length > LIST_PAGE_SIZE && (
                <nav aria-label="แบ่งหน้ารายการคำร้อง"
                  className="flex flex-col items-center justify-between gap-2 border-t border-gray-200 px-4 py-3 text-xs text-gray-500 sm:flex-row sm:px-5 md:bg-[#f5f8fc]">
                  <span>แสดง {win.start + 1}–{win.end} จาก {listItems.length} รายการ</span>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => goToPage(win.page - 1)} disabled={win.page === 0}
                      className="min-h-10 rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40">ก่อนหน้า</button>
                    <span aria-live="polite">หน้า {win.page + 1} / {win.pages}</span>
                    <button type="button" onClick={() => goToPage(win.page + 1)} disabled={win.page >= win.pages - 1}
                      className="min-h-10 rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40">ถัดไป</button>
                  </div>
                </nav>
              )}
              </>
            )}
          </ListCard>
          </div>
        </>
      )}
    </div>
  )
}
