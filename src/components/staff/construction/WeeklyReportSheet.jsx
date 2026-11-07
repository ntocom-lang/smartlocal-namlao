import { useMemo, useState } from 'react'
import { Loader2, Lock, LockOpen, Plus, Save, Trash2 } from 'lucide-react'
import { Sheet } from '../../patientTransport/StaffShell'
import {
  ROAD_CREW_PRESETS, ROAD_MACHINERY_PRESETS, WEATHER_ROWS, buildReportSheet, emptyFinance, formatPct, periodDates, plannedPct,
} from '../../../lib/constructionReport'
import {
  deleteReport, finalizeReport, friendlyError, saveDraft, saveMemoFields, unlockReport,
} from '../../../lib/constructionReportApi'
import { printConstructionReport } from '../../../lib/constructionReportPrint'
import { thaiDateRange, thaiShortDate } from '../../../lib/complaintReportPeriods'
import { Field, Problems, ScheduleBadge, Section } from './ui'
import { btnGhost, btnPrimary, inp } from './uiStyles'

const toNumber = v => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v))
const fit = (days, n) => Array.from({ length: n }, (_, i) => days?.[i] ?? 0)

const initialValues = report => ({
  report_no: report.report_no ?? '',
  period_start: report.period_start,
  period_end: report.period_end,
  memo_no: report.memo_no ?? '',
  memo_date: report.memo_date ?? '',
  memo_to: report.memo_to ?? '',
  progress: JSON.parse(JSON.stringify(report.progress ?? {})),
  crew: JSON.parse(JSON.stringify(report.crew ?? [])),
  machinery: JSON.parse(JSON.stringify(report.machinery ?? [])),
  weather: JSON.parse(JSON.stringify(report.weather ?? {})),
  daily_log: JSON.parse(JSON.stringify(report.daily_log ?? [])),
  issues: { problems: '', solution: '', other: '', ...(report.issues ?? {}) },
  finance: { ...emptyFinance(), ...(report.finance ?? {}) },
})

// ค่าที่กรอกเป็นสตริงในช่อง → ตัวเลขจริงก่อนส่งฐานข้อมูล · แถวกำลังคน/เครื่องจักรที่ไม่มีชื่อทิ้ง
function normalize(values, dayCount) {
  const rows = list => (list ?? []).filter(r => String(r.name ?? '').trim())
    .map(r => ({ name: r.name.trim(), days: fit(r.days, dayCount).map(d => toNumber(d) ?? 0) }))
  return {
    ...values,
    progress: Object.fromEntries(Object.entries(values.progress).map(([id, p]) => [id, {
      week: toNumber(p.week) ?? 0, plan: toNumber(p.plan), base: toNumber(p.base),
    }])),
    crew: rows(values.crew),
    machinery: rows(values.machinery),
    daily_log: (values.daily_log ?? []).filter(r => String(r.detail ?? '').trim()),
    finance: {
      advance_amount: toNumber(values.finance.advance_amount),
      advance_pct: toNumber(values.finance.advance_pct),
      budget_rows: (values.finance.budget_rows ?? []).filter(r => String(r.year ?? '').trim()),
    },
  }
}

function DayGrid({ title, rows, dates, disabled, presets, onChange }) {
  const set = (i, patch) => onChange(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)))
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border border-gray-100">
        <table className="w-full min-w-[34rem] text-xs">
          <thead><tr className="bg-gray-50 text-gray-500">
            <th className="px-2 py-1.5 text-left font-semibold">{title}</th>
            {dates.map(d => <th key={d} className="w-12 px-1 py-1.5 text-center font-semibold">{thaiShortDate(d, false)}</th>)}
            {!disabled && <th className="w-9" />}
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="px-1 py-1"><input className={inp} value={r.name} disabled={disabled} onChange={e => set(i, { name: e.target.value })} aria-label={`ชื่อ${title}`} maxLength={120} /></td>
                {dates.map((d, di) => (
                  <td key={d} className="px-0.5 py-1"><input type="number" min="0" inputMode="numeric" className={`${inp} px-1 text-center`} disabled={disabled}
                    value={fit(r.days, dates.length)[di]} aria-label={`${r.name || title} ${thaiShortDate(d)}`}
                    onChange={e => set(i, { days: fit(r.days, dates.length).map((x, n) => (n === di ? e.target.value : x)) })} /></td>
                ))}
                {!disabled && <td className="px-1"><button type="button" aria-label="ลบแถว" className="flex size-9 items-center justify-center rounded-lg text-red-600 hover:bg-red-50" onClick={() => onChange(rows.filter((_, n) => n !== i))}><Trash2 size={14} /></button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!disabled && (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={btnGhost} onClick={() => onChange([...rows, { name: '', days: [] }])}><Plus size={14} />เพิ่มแถว</button>
          {presets.filter(p => !rows.some(r => r.name === p)).map(p => (
            <button key={p} type="button" className="min-h-9 rounded-xl border border-dashed border-gray-300 px-2.5 text-xs text-gray-600 hover:bg-gray-50"
              onClick={() => onChange([...rows, { name: p, days: [] }])}>+ {p}</button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * แก้รายงานสัปดาห์ — กรอกเฉพาะสิ่งที่เป็นดุลยพินิจของผู้ควบคุมงาน (% ผลงานในสัปดาห์ กำลังคน เครื่องจักร อากาศ ปัญหา)
 * ที่เหลือระบบเติม/คำนวณเอง: ยอดก่อนหน้า สะสม แผนสะสม ผลถ่วงน้ำหนัก เร็ว/ช้า วันคงเหลือ สัญญา ชื่อลงนาม
 * ล็อกแล้วตัวเลขถูกแช่แข็ง พิมพ์ย้อนหลังได้เลขเดิม · ปลดล็อกได้เฉพาะหัวหน้ากอง/ผู้ดูแล และเฉพาะสัปดาห์ล่าสุด
 */
export default function WeeklyReportSheet({ tenant, project, bundle, report, access, isLatest, isAdmin, onClose, onChanged, onDeleted }) {
  const locked = report.status === 'final'
  const [values, setValues] = useState(() => initialValues(report))
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const isFirst = bundle.reports.every(r => r.week_no >= report.week_no)
  const [showBase, setShowBase] = useState(() => Object.values(report.progress ?? {}).some(p => Number(p?.base) > 0))

  const dates = useMemo(() => periodDates(values.period_start, values.period_end), [values.period_start, values.period_end])
  const contract = useMemo(() => ({
    start_date: project.start_date, end_date: project.end_date, extended_until: bundle.contract?.extended_until,
  }), [project, bundle.contract])
  const live = useMemo(() => buildReportSheet({
    items: bundle.items, reports: bundle.reports, report: { ...report, ...values }, contract,
  }), [bundle.items, bundle.reports, report, values, contract])
  const sheet = locked && report.frozen?.version === 1 ? { ...report.frozen, problems: [], canFinalize: true } : live
  const disabled = locked || !access.write || busy

  const edit = patch => { setValues(v => ({ ...v, ...patch })); setDirty(true) }
  const setProgress = (id, patch) => edit({ progress: { ...values.progress, [id]: { ...(values.progress[id] ?? {}), ...patch } } })
  const setFinance = patch => edit({ finance: { ...values.finance, ...patch } })

  const run = async (action, doneNotice) => {
    setBusy(true); setError(''); setNotice('')
    const result = await action()
    setBusy(false)
    if (result.error) return setError(friendlyError(result.error))
    if (result.report) { onChanged(result.report); setValues(initialValues(result.report)); setDirty(false) }
    if (doneNotice) setNotice(doneNotice)
  }
  const payload = () => normalize(values, dates.length)

  const requestClose = () => {
    if (dirty && !window.confirm('มีข้อมูลที่ยังไม่ได้บันทึก — ปิดโดยไม่บันทึก?')) return
    onClose()
  }
  const print = () => printConstructionReport({ tenant, project, bundle, report: { ...report, ...(locked ? {} : payload()) }, sheet })

  const toggleWeather = (iso, key) => {
    const current = values.weather[iso] ?? []
    const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key]
    edit({ weather: { ...values.weather, [iso]: next } })
  }
  // ทางลัดที่ผู้ควบคุมงานกดเอง (ระบบไม่ติ๊กอากาศให้ — เป็นข้อเท็จจริงที่คนยืนยัน)
  const fillClear = () => edit({ weather: Object.fromEntries(dates.map(d => [d, ['clear']])) })

  const s = sheet.overall
  const t = sheet.timing
  const stat = (label, value, extra) => (
    <div className="rounded-xl bg-gray-50 px-3 py-2"><p className="text-[11px] text-gray-500">{label}</p><p className="text-base font-extrabold text-gray-900">{value}</p>{extra}</div>
  )

  return (
    <Sheet wide busy={busy} onClose={requestClose} onPrint={print}
      title={`รายงานสัปดาห์ที่ ${report.week_no} · ${project.title}`}
      subtitle={`${thaiDateRange(values.period_start, values.period_end)}${locked ? ' · ล็อกแล้ว' : ' · ฉบับร่าง'}`}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stat('ผลงานจริงสะสม', formatPct(s.actual))}
        {stat('แผนที่ตั้งในระบบ', formatPct(s.plan), <ScheduleBadge label={s.label} />)}
        {stat('แผนตามเวลา', formatPct(t?.planPct), t && <ScheduleBadge label={t.label} />)}
        {stat(t && t.remainingDays < 0 ? 'เกินกำหนดสัญญา' : 'เวลาคงเหลือ', t ? `${Math.abs(t.remainingDays)} วัน` : '—',
          t && <p className="text-[11px] text-gray-500">จากทั้งหมด {t.durationDays} วัน</p>)}
      </div>

      {!locked && <Problems problems={live.problems} only="error" />}

      <Section title="ผลการดำเนินงานก่อสร้าง" open>
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full min-w-[40rem] text-xs">
            <thead><tr className="bg-gray-50 text-gray-500">
              <th className="px-2 py-1.5 text-left font-semibold">รายการงาน</th>
              <th className="px-2 py-1.5 font-semibold">สัดส่วน</th>
              {showBase && <th className="px-2 py-1.5 font-semibold">ยอดตั้งต้น</th>}
              <th className="px-2 py-1.5 font-semibold">ก่อนหน้า</th>
              <th className="px-2 py-1.5 font-semibold">สัปดาห์นี้ %</th>
              <th className="px-2 py-1.5 font-semibold">สะสม</th>
              <th className="px-2 py-1.5 font-semibold">แผนสะสม</th>
              <th className="px-2 py-1.5 font-semibold">เทียบแผน</th>
            </tr></thead>
            <tbody>
              {sheet.items.map(row => {
                const item = bundle.items.find(i => i.id === row.id)
                const linear = item ? plannedPct(item, values.period_end) : null
                const p = values.progress[row.id] ?? {}
                return (
                  <tr key={row.id} className="border-t border-gray-100">
                    <td className="px-2 py-1.5 font-medium text-gray-800">{row.name}</td>
                    <td className="px-2 text-center">{row.weight}</td>
                    {showBase && <td className="px-1"><input type="number" min="0" max="100" className={`${inp} w-20 px-1 text-center`} disabled={disabled || !isFirst} value={p.base ?? ''}
                      aria-label={`ยอดตั้งต้น ${row.name}`} onChange={e => setProgress(row.id, { base: e.target.value })} /></td>}
                    <td className="px-2 text-center text-gray-600">{row.prev}</td>
                    <td className="px-1"><input type="number" min="0" max="100" step="any" inputMode="decimal" className={`${inp} w-20 px-1 text-center font-bold`} disabled={disabled}
                      value={p.week ?? ''} aria-label={`ผลงานสัปดาห์นี้ ${row.name}`} onChange={e => setProgress(row.id, { week: e.target.value })} /></td>
                    <td className="px-2 text-center font-bold">{row.cum}</td>
                    <td className="px-1">
                      <input type="number" min="0" max="100" step="any" inputMode="decimal" className={`${inp} w-20 px-1 text-center`} disabled={disabled}
                        value={p.plan ?? ''} placeholder={linear === null ? '—' : String(Math.round(linear * 100) / 100)}
                        title="เว้นว่าง = ระบบคำนวณเชิงเส้นจากวันแผนของรายการ · กรอกเพื่อแก้ทับเฉพาะสัปดาห์นี้" aria-label={`แผนสะสม ${row.name}`}
                        onChange={e => setProgress(row.id, { plan: e.target.value })} />
                    </td>
                    <td className="px-2 text-center"><ScheduleBadge label={row.label} /></td>
                  </tr>
                )
              })}
              <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
                <td className="px-2 py-1.5">รวมถ่วงน้ำหนัก</td><td className="text-center">100</td>
                {showBase && <td />}
                <td className="text-center">{s.prev.toFixed(2)}</td><td className="text-center">{s.week.toFixed(2)}</td>
                <td className="text-center">{s.actual.toFixed(2)}</td><td className="text-center">{s.plan === null ? '—' : s.plan.toFixed(2)}</td>
                <td className="text-center"><ScheduleBadge label={s.label} /></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500">"แผนสะสม" คำนวณเชิงเส้นจากวันเริ่ม–สิ้นสุดของแต่ละรายการ (เทียบแผนที่ตั้งในระบบ ไม่ใช่แผนตามสัญญา) — ช่องว่างในช่องแผนแสดงค่าที่ระบบคำนวณให้ กรอกเพื่อแก้ทับเฉพาะสัปดาห์นี้</p>
        {isFirst && !locked && !showBase && (
          <button type="button" className="text-xs font-semibold text-blue-700 underline" onClick={() => setShowBase(true)}>โครงการนี้เริ่มก่อนใช้ระบบ? ใส่ยอดสะสมที่ทำไปแล้ว</button>
        )}
      </Section>

      <Section title="ช่วงเวลาและหัวบันทึกข้อความ" hint={`${dates.length} วัน`}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="เริ่มวันที่"><input type="date" className={inp} value={values.period_start} disabled={disabled} onChange={e => edit({ period_start: e.target.value })} /></Field>
          <Field label="ถึงวันที่"><input type="date" className={inp} value={values.period_end} disabled={disabled} onChange={e => edit({ period_end: e.target.value })} /></Field>
          <Field label="รายงานครั้งที่ (ว่าง = เท่าเลขสัปดาห์)"><input className={inp} inputMode="numeric" value={values.report_no} disabled={disabled} onChange={e => edit({ report_no: e.target.value })} /></Field>
          <Field label="เรียน"><input className={inp} value={values.memo_to} disabled={!access.write} onChange={e => edit({ memo_to: e.target.value })} placeholder="เช่น ผู้อำนวยการกองช่าง" maxLength={200} /></Field>
          <Field label="ที่ (เลขหนังสือ)"><input className={inp} value={values.memo_no} onChange={e => edit({ memo_no: e.target.value })} maxLength={80} disabled={!access.write} /></Field>
          <Field label="วันที่ของหนังสือ"><input type="date" className={inp} value={values.memo_date} onChange={e => edit({ memo_date: e.target.value })} disabled={!access.write} /></Field>
        </div>
        {locked && access.write && (
          <button type="button" className={btnGhost} disabled={busy} onClick={() => run(() => saveMemoFields(report.id, values), 'บันทึกหัวบันทึกข้อความแล้ว')}><Save size={15} />บันทึกเลขที่/วันที่/เรียน</button>
        )}
      </Section>

      <Section title="กำลังคน" hint="จำนวนคนต่อวัน">
        <DayGrid title="ตำแหน่ง/ประเภทแรงงาน" rows={values.crew} dates={dates} disabled={disabled} presets={ROAD_CREW_PRESETS} onChange={rows => edit({ crew: rows })} />
      </Section>
      <Section title="เครื่องจักร" hint="จำนวนเครื่องต่อวัน">
        <DayGrid title="เครื่องจักร" rows={values.machinery} dates={dates} disabled={disabled} presets={ROAD_MACHINERY_PRESETS} onChange={rows => edit({ machinery: rows })} />
      </Section>

      <Section title="สภาพอากาศ" hint="ผู้ควบคุมงานยืนยันเอง — ระบบไม่เดาให้">
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full min-w-[30rem] text-xs">
            <thead><tr className="bg-gray-50 text-gray-500"><th className="px-2 py-1.5 text-left font-semibold">สภาพอากาศ</th>
              {dates.map(d => <th key={d} className="w-12 px-1 py-1.5 text-center font-semibold">{thaiShortDate(d, false)}</th>)}</tr></thead>
            <tbody>
              {WEATHER_ROWS.map(row => (
                <tr key={row.key} className="border-t border-gray-100">
                  <td className="px-2 py-1.5 font-medium">{row.group}{row.label && ` — ${row.label}`}</td>
                  {dates.map(d => (
                    <td key={d} className="text-center"><input type="checkbox" className="size-5" disabled={disabled}
                      checked={(values.weather[d] ?? []).includes(row.key)} onChange={() => toggleWeather(d, row.key)}
                      aria-label={`${row.group}${row.label} ${thaiShortDate(d)}`} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!disabled && <button type="button" className={btnGhost} onClick={fillClear}>ติ๊ก "แจ่มใส" ทุกวัน</button>}
      </Section>

      <Section title="บันทึกการปฏิบัติงานรายวัน" hint={`${values.daily_log.length} รายการ`}>
        {values.daily_log.map((row, i) => (
          <div key={i} className="grid gap-2 rounded-xl border border-gray-100 p-3 sm:grid-cols-12">
            <Field label="วันที่" className="sm:col-span-3">
              <select className={inp} disabled={disabled} value={row.date ?? ''} onChange={e => edit({ daily_log: values.daily_log.map((r, n) => (n === i ? { ...r, date: e.target.value } : r)) })}>
                <option value="">— วันเดิมต่อจากแถวบน —</option>
                {dates.map(d => <option key={d} value={d}>{thaiShortDate(d)}</option>)}
              </select>
            </Field>
            <Field label="รายละเอียดการปฏิบัติงาน" className="sm:col-span-6"><textarea rows={2} className={inp} disabled={disabled} value={row.detail ?? ''} maxLength={1000}
              onChange={e => edit({ daily_log: values.daily_log.map((r, n) => (n === i ? { ...r, detail: e.target.value } : r)) })} /></Field>
            <Field label="หมายเหตุ" className="sm:col-span-2"><input className={inp} disabled={disabled} value={row.note ?? ''} maxLength={200}
              onChange={e => edit({ daily_log: values.daily_log.map((r, n) => (n === i ? { ...r, note: e.target.value } : r)) })} /></Field>
            {!disabled && <button type="button" aria-label="ลบแถว" className="flex min-h-11 items-center justify-center self-end rounded-xl text-red-600 hover:bg-red-50 sm:col-span-1" onClick={() => edit({ daily_log: values.daily_log.filter((_, n) => n !== i) })}><Trash2 size={16} /></button>}
          </div>
        ))}
        {!disabled && (
          <button type="button" className={btnGhost} onClick={() => {
            const lastDate = [...values.daily_log].reverse().find(r => r.date)?.date
            const next = dates[Math.min(dates.length - 1, lastDate ? dates.indexOf(lastDate) + 1 : 0)] ?? ''
            edit({ daily_log: [...values.daily_log, { date: next, detail: '', note: '' }] })
          }}><Plus size={15} />เพิ่มแถว (วันถัดไปอัตโนมัติ)</button>
        )}
      </Section>

      <Section title="ปัญหา อุปสรรค และเหตุการณ์">
        <p className="text-xs text-gray-500">เว้นว่าง = "ไม่มี" ในใบรายงาน</p>
        <Field label="ปัญหา - อุปสรรค"><textarea rows={2} className={inp} disabled={disabled} maxLength={1000} value={values.issues.problems} onChange={e => edit({ issues: { ...values.issues, problems: e.target.value } })} /></Field>
        <Field label="แนวทางแก้ไข"><textarea rows={2} className={inp} disabled={disabled} maxLength={1000} value={values.issues.solution} onChange={e => edit({ issues: { ...values.issues, solution: e.target.value } })} /></Field>
        <Field label="เหตุการณ์อื่นๆ"><textarea rows={2} className={inp} disabled={disabled} maxLength={1000} value={values.issues.other} onChange={e => edit({ issues: { ...values.issues, other: e.target.value } })} /></Field>
      </Section>

      <Section title="งบประมาณและการเบิกจ่าย" hint="ไม่บังคับ — กรอกเมื่อมีข้อมูล คัดลอกจากสัปดาห์ก่อนให้แล้ว">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="ค่าจ้างล่วงหน้า (บาท)"><input className={inp} inputMode="decimal" disabled={disabled} value={values.finance.advance_amount ?? ''} onChange={e => setFinance({ advance_amount: e.target.value })} /></Field>
          <Field label="คิดเป็น (%)"><input className={inp} inputMode="decimal" disabled={disabled} value={values.finance.advance_pct ?? ''} onChange={e => setFinance({ advance_pct: e.target.value })} /></Field>
        </div>
        {(values.finance.budget_rows ?? []).map((r, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 rounded-xl border border-gray-100 p-3 sm:grid-cols-5">
            {[['year', 'ปีงบประมาณ'], ['installments_total', 'จำนวนงวดทั้งหมด'], ['inspected', 'ตรวจรับแล้ว'], ['paid', 'เบิกจ่ายแล้ว'], ['remaining', 'คงเหลือ']].map(([key, label]) => (
              <Field key={key} label={label}><input className={inp} disabled={disabled} value={r[key] ?? ''}
                onChange={e => setFinance({ budget_rows: values.finance.budget_rows.map((x, n) => (n === i ? { ...x, [key]: e.target.value } : x)) })} /></Field>
            ))}
          </div>
        ))}
        {!disabled && <button type="button" className={btnGhost} onClick={() => setFinance({ budget_rows: [...(values.finance.budget_rows ?? []), { year: '' }] })}><Plus size={15} />เพิ่มปีงบประมาณ</button>}
        <p className="text-xs text-gray-500">ข้อมูลส่วนนี้เป็นข้อเท็จจริงที่ผู้บันทึกกรอกเอง ระบบไม่ตรวจรับงวดและไม่คำนวณการเบิกจ่าย</p>
      </Section>

      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}

      <div className="sticky bottom-0 -mx-4 flex flex-wrap gap-2 border-t border-gray-100 bg-white px-4 py-3 sm:-mx-5 sm:px-5">
        {!locked && access.write && (
          <>
            <button type="button" className={`${btnPrimary} flex-1`} style={{ backgroundColor: 'var(--color-primary)' }} disabled={busy || !dirty}
              onClick={() => run(() => saveDraft(report.id, payload()), 'บันทึกร่างแล้ว')}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}บันทึกร่าง
            </button>
            <button type="button" className={btnGhost} disabled={busy || !live.canFinalize}
              title={live.canFinalize ? 'ล็อกรายงานและแช่แข็งตัวเลข' : 'แก้รายการสีแดงด้านบนก่อน'}
              onClick={() => {
                if (!window.confirm(`ล็อกรายงานสัปดาห์ที่ ${report.week_no}?\nล็อกแล้วแก้ไม่ได้ และตัวเลขจะถูกแช่แข็งสำหรับพิมพ์ (หัวหน้ากองหรือผู้ดูแลปลดล็อกได้)`)) return
                run(() => finalizeReport({ report, values: payload(), sheet: live, project, tenantId: tenant.id }), 'ล็อกรายงานแล้ว')
              }}><Lock size={16} />ล็อกรายงาน</button>
          </>
        )}
        {locked && access.manage && isLatest && (
          <button type="button" className={btnGhost} disabled={busy} onClick={() => {
            const reason = window.prompt('เหตุผลที่ปลดล็อก (บันทึกไว้ในประวัติการใช้งาน)')
            if (reason === null) return
            run(() => unlockReport({ report, project, tenantId: tenant.id, reason: reason.trim() }), 'ปลดล็อกแล้ว — แก้ไขได้')
          }}><LockOpen size={16} />ปลดล็อก</button>
        )}
        {isAdmin && (
          <button type="button" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-red-600 hover:bg-red-50" disabled={busy} onClick={async () => {
            if (!window.confirm(`ลบรายงานสัปดาห์ที่ ${report.week_no} ถาวร? (บันทึกทางราชการ — ใช้เมื่อสร้างผิดเท่านั้น)`)) return
            setBusy(true)
            const result = await deleteReport({ report, project, tenantId: tenant.id })
            setBusy(false)
            if (result.error) return setError(friendlyError(result.error))
            onDeleted(report)
          }}><Trash2 size={16} />ลบ</button>
        )}
        <button type="button" className={btnGhost} onClick={requestClose}>ปิด</button>
      </div>
    </Sheet>
  )
}
