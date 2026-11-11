import { useState } from 'react'
import { BellRing, Building2, CheckCircle2, ChevronRight, Info, ListChecks, Star } from 'lucide-react'
import { execFormulas, execNf, projectStageRows, waitText } from '../../../lib/executiveData'
import { ExecSection, FormulaPanel, InfoButton, LoadingLine, SectionError, SubHead, SummaryGate, Tile } from './ExecParts'
import { EXEC_CHART } from './execChart'
import { execIcon } from './execIcons'

// โซนของเฟส E2 ที่ไม่ใช่งานบริการประชาชน: ① คิวรอตัดสิน · ③ สัญญาณเตือน · ⑤ โครงการ/แผน · ⑥ รายกอง · ข้อมูลประกอบ
// ตัวเลขทุกตัวคิดแล้วใน src/lib/executiveData.js (pure + มีเทสต์) ที่นี่แค่วาด · สูตร/กฎ ⓘ ดึงจากทะเบียนตรงๆ ไม่เขียนถ้อยคำเอง
// ข้อห้าม: ไม่มีปุ่มอนุมัติ/เปลี่ยนสถานะ (กดแล้วไปเมนูเดิมตาม link ในทะเบียน) · ไม่แสดงชื่อคน/ผู้ป่วย/ผู้ประเมิน · ไม่จัดอันดับรายคน
// ชื่อคลาส Tailwind เขียนเต็มทุกตัว (ห้ามต่อสตริง)

const nf = execNf

// ───────────────────────── ① คิวรอตัดสิน ─────────────────────────

/**
 * เรื่องรอท่านตัดสิน (ใบยืมพัสดุ / ประกาศน้ำ-ฝน / ขอเปลี่ยนแปลงสัญญา / ร่างแผน) — แสดงเฉพาะที่มีเรื่อง
 * "รอมากี่วันทำการ" นับจากวันที่ที่ข้อมูลให้ · เกิน 2 วันทำการขึ้นสีส้ม · ไม่มีวันที่ในข้อมูล = ไม่โชว์ระยะรอ (ไม่เดา)
 * @param {{ ov: object, queue: { items: object[], failures: string[] }, resolveLink: (entry: object) => (null | (() => void)) }} props
 */
export function DecisionQueue({ ov, queue, resolveLink }) {
  const [open, setOpen] = useState(null)
  if (ov.status === 'loading') return <LoadingLine text="กำลังตรวจเรื่องรอพิจารณา…" />
  if (ov.status === 'error') return <SectionError text="โหลดเรื่องรอพิจารณาไม่ได้" onRetry={ov.reload} />
  if (ov.status !== 'ok') return null
  const { items, failures } = queue
  return (
    <div data-exec-queue className="space-y-1.5">
      {failures.length > 0 && (
        <SectionError text={`ตรวจเรื่องรอพิจารณาของ ${failures.join(', ')} ไม่ได้ — อาจมีเรื่องค้างอยู่`} onRetry={ov.reload} />
      )}
      {items.length === 0 && failures.length === 0 && (
        <p data-exec-queue-clear className="flex min-h-9 items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-sm">
          <CheckCircle2 size={16} className="shrink-0 text-emerald-600" aria-hidden="true" />ไม่มีเรื่องอื่นรอท่านพิจารณา
        </p>
      )}
      {items.map((it) => {
        const go = resolveLink(it.entry)
        const wait = waitText(it.waitDays)
        // แถวกะทัดรัด (เจ้าของระบบขอ 2026-11-11): ชื่อเมนู + ป้าย "รอมา…" อยู่บรรทัดเดียวกัน (พับลงเองเมื่อจอแคบ)
        const body = (
          <>
            <span className={`w-9 shrink-0 text-right text-2xl font-black tabular-nums ${it.warn ? 'text-orange-600' : 'text-amber-600'}`}>{nf(it.count)}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold leading-tight text-slate-800">{it.label}<span className="ml-1 text-[11px] font-normal text-slate-500">({it.unit})</span></span>
              <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-snug text-slate-500">
                <span>{it.entry.label}</span>
                {wait && (
                  <span data-exec-wait={it.warn ? 'warn' : 'ok'} className={`inline-block rounded-full px-1.5 py-px text-[10px] font-bold ${it.warn ? 'bg-orange-100 text-orange-800' : 'bg-slate-100 text-slate-600'}`}>
                    {it.sinceDay === null || it.waitDays === 0 ? wait : `${wait} · ตั้งแต่ ${new Date(`${it.sinceDay}T00:00:00+07:00`).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' })}`}
                  </span>
                )}
              </span>
            </span>
            {go && <ChevronRight size={16} className="shrink-0 text-slate-300" aria-hidden="true" />}
          </>
        )
        return (
          <div key={it.id} data-exec-decision={it.id} className="space-y-1.5">
            <div className={`flex items-stretch gap-1 rounded-xl border bg-white shadow-sm ${it.warn ? 'border-orange-300' : 'border-amber-200'}`}>
              {go ? (
                <button type="button" onClick={go} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl px-2.5 py-1.5 text-left active:scale-[0.99]">{body}</button>
              ) : (
                <div className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5">{body}</div>
              )}
              <div className="flex items-start py-1 pr-1">
                <InfoButton active={open === it.id} onClick={() => setOpen((cur) => (cur === it.id ? null : it.id))} label={it.label} />
              </div>
            </div>
            {open === it.id && <FormulaPanel title={it.label} items={[{ who: it.entry.label, formula: it.kpi.formula, source: it.kpi.source }]} />}
          </div>
        )
      })}
    </div>
  )
}

// ───────────────────────── ③ สัญญาณเตือน ─────────────────────────

const SEVERITY = {
  critical: { border: 'border-rose-500', chip: 'bg-rose-100 text-rose-800', label: 'เร่งด่วน', count: 'text-rose-600' },
  warn: { border: 'border-amber-500', chip: 'bg-amber-100 text-amber-800', label: 'ควรดู', count: 'text-amber-600' },
  info: { border: 'border-slate-400', chip: 'bg-slate-100 text-slate-700', label: 'ทราบไว้', count: 'text-slate-600' },
}

/**
 * สัญญาณเตือน — ผู้เรียกวาดโซนนี้เฉพาะเมื่อมีเรื่อง (alerts.items > 0 หรือมีโมดูลที่ตรวจไม่ได้)
 * กฎของแต่ละข้อ (ⓘ) มาจากทะเบียน — ตรงไปตรงมา ตรวจย้อนได้ ไม่ใช้ AI
 */
export function AlertZone({ alerts, ov, resolveLink }) {
  const [open, setOpen] = useState(null)
  return (
    <ExecSection id="alert" title="สัญญาณเตือน" Icon={BellRing} note="ขึ้นเฉพาะเมื่อมีเรื่อง · กฎตรงไปตรงมา ไม่ใช้ AI">
      {alerts.failures.length > 0 && (
        <SectionError text={`ตรวจสัญญาณเตือนของ ${alerts.failures.join(', ')} ไม่ได้ — อาจมีเรื่องที่ไม่แสดง`} onRetry={alerts.retry ?? ov.reload} />
      )}
      <ul className="space-y-1.5">
        {alerts.items.map((a) => {
          const tone = SEVERITY[a.severity] ?? SEVERITY.info
          const go = resolveLink(a.entry)
          const body = (
            <>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tone.chip}`}>{tone.label}</span>
                  <span className="text-sm font-bold leading-tight text-slate-800">{a.label}</span>
                </span>
                <span className="mt-0.5 block text-[11px] text-slate-500">{a.entry.label}{a.detail ? ` · ${a.detail}` : ''}</span>
              </span>
              {a.showCount && (
                <span className={`shrink-0 text-right text-2xl font-black tabular-nums ${tone.count}`}>{nf(a.count)}<span className="ml-0.5 text-[11px] font-bold text-slate-400">{a.unit}</span></span>
              )}
              {go && <ChevronRight size={16} className="shrink-0 text-slate-300" aria-hidden="true" />}
            </>
          )
          return (
            <li key={a.id} data-exec-alert={a.id} className="space-y-1.5">
              <div className={`flex items-stretch gap-1 rounded-2xl border-l-4 bg-white shadow-sm ${tone.border}`}>
                {go ? (
                  <button type="button" onClick={go} className="flex min-h-14 min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left active:scale-[0.99]">{body}</button>
                ) : (
                  <div className="flex min-h-14 min-w-0 flex-1 items-center gap-2.5 px-3 py-2">{body}</div>
                )}
                <div className="flex items-start py-1.5 pr-1.5">
                  <InfoButton active={open === a.id} onClick={() => setOpen((cur) => (cur === a.id ? null : a.id))} label={a.label} />
                </div>
              </div>
              {open === a.id && <FormulaPanel title={a.label} items={[{ who: a.entry.label, formula: a.rule }]} />}
            </li>
          )
        })}
      </ul>
    </ExecSection>
  )
}

// ───────────────────────── ⑤ โครงการและแผนพัฒนา ─────────────────────────

const PLAN_BAR = { done: '#15803d', in_progress: '#0284c7', not_done: '#dc2626' }

function PlanBar({ group }) {
  const pct = (n) => (group.total ? (n / group.total) * 100 : 0)
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-200" role="img"
      aria-label={`แล้วเสร็จ ${group.done} กำลังดำเนินการ ${group.in_progress} ไม่ได้ดำเนินการ ${group.not_done} จาก ${group.total} รายการ`}>
      {['done', 'in_progress', 'not_done'].map((k) => <span key={k} style={{ width: `${pct(group[k])}%`, backgroundColor: PLAN_BAR[k] }} />)}
    </div>
  )
}

/** % ดำเนินการตามแผนรายกอง — ตัวคำนวณเดียวกับเมนูแผนพัฒนา (hook useExecPlanProgress) */
function PlanProgress({ plan, entry }) {
  const kpi = entry.kpis.find((k) => k.id === 'progress_by_dept')
  const [open, setOpen] = useState(false)
  const head = (
    <div className="flex items-center gap-1">
      <SubHead tone="border-indigo-500 text-indigo-950">ดำเนินการตามแผนรายกอง</SubHead>
      {kpi && <InfoButton active={open} onClick={() => setOpen((v) => !v)} label={kpi.label} />}
    </div>
  )
  const formula = open && kpi && <FormulaPanel title={kpi.label} items={[{ who: entry.label, formula: kpi.formula, source: kpi.source }]} />
  if (plan.status === 'loading' || plan.status === 'idle') return <div className="space-y-2">{head}<LoadingLine text="กำลังโหลดผลดำเนินการตามแผน…" /></div>
  if (plan.status === 'error') return <div className="space-y-2">{head}<SectionError text="โหลดผลดำเนินการตามแผนไม่ได้" onRetry={plan.reload} /></div>
  const d = plan.data
  if (d.state !== 'ok' || d.total === 0) {
    return (
      <div className="space-y-2">{head}
        <p data-exec-plan-empty className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-xs text-slate-500">
          {d.state === 'no_plan' ? 'ยังไม่มีข้อมูล — ยังไม่ได้ตั้งแผนพัฒนาท้องถิ่น' : d.state === 'no_published' ? 'ยังไม่มีข้อมูล — ยังไม่มีแผนการดำเนินงานที่ประกาศแล้ว' : 'ยังไม่มีข้อมูล — แผนการดำเนินงานยังไม่มีรายการ'}
        </p>
        {formula}
      </div>
    )
  }
  return (
    <div data-exec-plan className="space-y-2">
      {head}
      <ul className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        {d.groups.map((g) => (
          <li key={String(g.key)} data-exec-plan-dept={String(g.key)}>
            <div className="flex items-baseline gap-2 text-xs">
              <span className="min-w-0 flex-1 break-words font-medium text-slate-700">{g.label}</span>
              <span className="text-[10px] tabular-nums text-slate-500">{nf(g.done)}/{nf(g.total)}</span>
              <span className="w-12 shrink-0 text-right font-black tabular-nums text-slate-900">{g.donePct.toFixed(1)}%</span>
            </div>
            <div className="mt-0.5"><PlanBar group={g} /></div>
          </li>
        ))}
        <li className="border-t border-dashed border-slate-200 pt-2">
          <div className="flex items-baseline gap-2 text-xs font-bold">
            <span className="min-w-0 flex-1 text-slate-800">รวมทุกกอง · ปีงบ {d.fiscalYear}</span>
            <span className="text-[10px] tabular-nums text-slate-500">{nf(d.totals.done)}/{nf(d.totals.total)}</span>
            <span className="w-12 shrink-0 text-right font-black tabular-nums text-slate-900">{d.totals.donePct.toFixed(1)}%</span>
          </div>
        </li>
      </ul>
      <p className="text-[10px] leading-snug text-slate-500">
        แถบ: เขียว = แล้วเสร็จ · ฟ้า = กำลังดำเนินการ · แดง = ไม่ได้ดำเนินการ · ร้อยละนับตามจำนวนรายการ ไม่ถ่วงเงิน
        {!d.isCurrentYear && ' · ปีงบปัจจุบันยังไม่มีแผนการดำเนินงานที่ประกาศ จึงแสดงปีงบล่าสุดที่ประกาศ'}
        {d.civilUnavailable && ' · อ่านขั้นของโครงการก่อสร้างไม่ได้ ตอนนี้นับเฉพาะผลที่กองกดเอง'}
      </p>
      {formula}
    </div>
  )
}

/**
 * ⑤ — โครงการก่อสร้างตามขั้น (executive_overview.projects) + ดำเนินการตามแผนรายกอง (localPlanProgress)
 * ผู้เรียกวาดเมื่อมีรายการ projects หรือ local-plan ที่ขึ้นจอ
 */
export function PlanZone({ ov, entries, plan, resolveLink }) {
  const [open, setOpen] = useState(null)
  const projectsEntry = entries.find((e) => e.key === 'projects') ?? null
  const planEntry = entries.find((e) => e.key === 'local-plan') ?? null
  const goProjects = projectsEntry ? resolveLink(projectsEntry) : null
  const goPlan = planEntry ? resolveLink(planEntry) : null
  return (
    <ExecSection id="plan" title="โครงการและแผนพัฒนา" Icon={ListChecks}>
      {projectsEntry && (
        <div data-exec-projects className="space-y-2">
          <div className="flex items-center gap-1">
            <SubHead tone="border-indigo-500 text-indigo-950">โครงการก่อสร้างตามขั้น</SubHead>
            <InfoButton active={open === 'by_stage'} onClick={() => setOpen((c) => (c === 'by_stage' ? null : 'by_stage'))} label="โครงการตามขั้น" />
          </div>
          <SummaryGate ov={ov} name="projects" label="โครงการตามขั้น">
            {(p) => {
              const rows = projectStageRows(p.byStage)
              const total = rows.reduce((t, r) => t + r.n, 0)
              const max = rows.reduce((m, r) => Math.max(m, r.n), 0)
              if (total === 0 && p.suspended === 0) return <p className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-xs text-slate-500">ยังไม่มีข้อมูล — ไม่มีโครงการที่ยังไม่จบ</p>
              return (
                <ul className="space-y-1.5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  {rows.map((r) => (
                    <li key={r.stage} data-exec-stage-row={r.stage}>
                      <div className="flex items-baseline gap-2 text-xs">
                        <span className="min-w-0 flex-1 break-words font-medium text-slate-700">{r.label}</span>
                        <span className="font-black tabular-nums text-slate-900">{nf(r.n)}<span className="sr-only"> โครงการ</span></span>
                      </div>
                      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                        <div className={`h-full rounded-full ${r.stage === 'suspended' ? 'bg-rose-400' : 'bg-indigo-400'}`} style={{ width: `${max > 0 ? Math.max(3, Math.round((r.n / max) * 100)) : 0}%` }} />
                      </div>
                    </li>
                  ))}
                  <li className="flex items-center gap-1 border-t border-dashed border-slate-200 pt-1.5 text-xs text-slate-700">
                    <span className="min-w-0 flex-1">รวมที่ยังไม่จบ <span className="font-black tabular-nums">{nf(total)}</span> โครงการ</span>
                    <span className="inline-flex items-center gap-0.5">ระงับ <span className={`font-black tabular-nums ${p.suspended > 0 ? 'text-rose-600' : 'text-slate-400'}`}>{nf(p.suspended)}</span>
                      <InfoButton active={open === 'suspended'} onClick={() => setOpen((c) => (c === 'suspended' ? null : 'suspended'))} label="ระงับ" />
                    </span>
                  </li>
                </ul>
              )
            }}
          </SummaryGate>
          {open === 'by_stage' && <FormulaPanel title="โครงการตามขั้น" items={execFormulas(entries, 'by_stage')} />}
          {open === 'suspended' && <FormulaPanel title="ระงับ" items={execFormulas(entries, 'suspended')} />}
          {goProjects && <LinkButton onClick={goProjects} label="เปิดเมนูโครงการก่อสร้าง" />}
        </div>
      )}
      {planEntry && (
        <div className="space-y-2">
          <PlanProgress plan={plan} entry={planEntry} />
          {goPlan && <LinkButton onClick={goPlan} label="เปิดเมนูแผนพัฒนาท้องถิ่น" />}
        </div>
      )}
    </ExecSection>
  )
}

function LinkButton({ onClick, label }) {
  return (
    <button type="button" onClick={onClick}
      className="flex min-h-11 w-full items-center gap-2 rounded-2xl border border-white bg-white px-3 py-2 text-left text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 active:scale-[0.99]">
      <span className="min-w-0 flex-1">{label}</span>
      <ChevronRight size={15} className="shrink-0 text-slate-300" aria-hidden="true" />
    </button>
  )
}

// ───────────────────────── ⑥ ภาพรวมรายกอง ─────────────────────────

const DEPT_COLUMNS = [
  { id: 'dept_open', label: 'งานค้าง' },
  { id: 'dept_overdue', label: 'เลยกำหนด' },
  { id: 'dept_done', label: 'เสร็จในช่วงนี้' },
  { id: 'dept_rating', label: 'คะแนนเฉลี่ย' },
]

const ratingText = (r) => (r && r.avg != null ? `${r.avg}` : '—')

/**
 * กราฟแท่งแนวนอนรายกอง — ความยาวแท่ง = งานค้าง บนสเกลเดียวกันทุกกอง (กองที่ค้างมากสุด = เต็มแถว)
 * แบ่งในแท่ง: แดง = เลยกำหนด (จุดเน้น) · เทา = ค้างแต่ยังไม่เลยกำหนด · ตัวเลขพิมพ์กำกับทุกแถว (สีไม่ใช่ทางเดียวที่บอกค่า)
 * เสร็จ/คะแนนเป็นคนละมาตร (นับตามช่วง) จึงเป็นตัวเลขข้างแท่ง ไม่ซ้อนในแท่งเดียวกัน
 * กองที่ไม่มีงานค้าง ไม่มีงานเสร็จ และไม่มีคะแนน → ยุบเป็นบรรทัดเดียวท้ายกราฟ (ยังเห็นครบในโหมดตาราง)
 */
function DeptBars({ rows }) {
  const active = rows.filter((r) => r.openTotal > 0 || r.doneTotal > 0 || r.rating?.avg != null)
  const quiet = rows.filter((r) => !active.includes(r))
  const max = Math.max(1, ...active.map((r) => r.openTotal))
  return (
    <div data-exec-dept-chart className="space-y-2.5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600" aria-label="คำอธิบายสี">
        <li className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: EXEC_CHART.critical }} aria-hidden="true" />เลยกำหนด</li>
        <li className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: EXEC_CHART.muted }} aria-hidden="true" />ค้าง ยังไม่เลยกำหนด</li>
      </ul>
      {active.length === 0 && <p className="text-xs text-slate-500">ไม่มีงานค้างและไม่มีงานเสร็จในช่วงนี้</p>}
      <ul className="space-y-2.5">
        {active.map((r) => {
          const notDue = Math.max(0, r.openTotal - r.overdueTotal)
          const breakdown = `คำร้อง ${nf(r.complaints.open)} · คำขอ ${nf(r.docs.open)}${r.complaints.parked > 0 ? ` · รอดำเนินการ ${nf(r.complaints.parked)}` : ''}`
          return (
            <li key={r.key} data-exec-dept={r.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="w-full break-words text-sm font-bold text-slate-800 md:w-40 md:shrink-0">{r.name}</span>
              <div className="h-3 min-w-0 basis-full rounded-full bg-slate-100 md:flex-1 md:basis-0" role="img"
                aria-label={`${r.name}: ค้าง ${nf(r.openTotal)} เรื่อง เลยกำหนด ${nf(r.overdueTotal)} เรื่อง (${breakdown})`}>
                {r.openTotal > 0 && (
                  <div className="flex h-full gap-0.5 overflow-hidden rounded-full" style={{ width: `${(r.openTotal / max) * 100}%` }}>
                    {r.overdueTotal > 0 && <span title={`เลยกำหนด ${nf(r.overdueTotal)} เรื่อง`} className="min-w-1 basis-0" style={{ flexGrow: r.overdueTotal, backgroundColor: EXEC_CHART.critical }} />}
                    {notDue > 0 && <span title={`ค้าง ยังไม่เลยกำหนด ${nf(notDue)} เรื่อง`} className="min-w-1 basis-0" style={{ flexGrow: notDue, backgroundColor: EXEC_CHART.muted }} />}
                  </div>
                )}
              </div>
              {/* PC: คอลัมน์ตัวเลขกว้างคงที่ ⇒ รางของทุกแถวยาวเท่ากัน = สเกลเดียวกันจริง (กว้างตามข้อความทำให้แท่งเทียบกันผิด) */}
              <span className="w-full text-[11px] tabular-nums text-slate-500 md:w-60 md:shrink-0 md:text-right" title={breakdown}>
                ค้าง <b className="text-slate-900">{nf(r.openTotal)}</b>
                {r.overdueTotal > 0 && <> · <b className="text-rose-600">เลยกำหนด {nf(r.overdueTotal)}</b></>}
                {' · '}เสร็จ <b className={r.doneTotal > 0 ? 'text-emerald-700' : 'text-slate-400'}>{nf(r.doneTotal)}</b>
                {' · '}คะแนน <b className="text-slate-900">{ratingText(r.rating)}</b>
              </span>
            </li>
          )
        })}
      </ul>
      {quiet.length > 0 && (
        <p data-exec-dept-quiet className="border-t border-dashed border-slate-200 pt-2 text-[11px] text-slate-500">
          ไม่มีงานค้าง/งานเสร็จในช่วงนี้: {quiet.map((r) => r.name).join(' · ')}
        </p>
      )}
    </div>
  )
}

/**
 * 1 แถวต่อกอง — ไม่จัดอันดับ ไม่มีชื่อรายคน (ดูรายคนที่เมนูผลการปฏิบัติงานตามสิทธิ์เดิม)
 * ใช้ช่วงเวลาเดียวกับโซน ② (rangeText) · งานค้าง/เลยกำหนดเป็นสถานะตอนนี้ · เสร็จ/คะแนนนับตามช่วง
 */
export function DeptZone({ ov, entries, rangeText, resolveLink }) {
  const [open, setOpen] = useState(null)
  const [asTable, setAsTable] = useState(false)
  const entry = entries.find((e) => e.key === 'performance') ?? null
  if (!entry) return null
  const go = resolveLink(entry)
  const toggle = (id) => setOpen((cur) => (cur === id ? null : id))
  const info = (c) => <InfoButton active={open === c.id} onClick={() => toggle(c.id)} label={c.label} />
  return (
    <ExecSection id="dept" title="ภาพรวมรายกอง" Icon={Building2} note={`ไม่จัดอันดับรายคน · เสร็จ/คะแนนนับตามช่วง ${rangeText}`}
      aside={(
        <button type="button" data-exec-dept-view aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}
          className="inline-flex min-h-8 items-center rounded-full border border-cyan-200 bg-white px-2.5 text-[11px] font-semibold text-cyan-800 hover:bg-cyan-50">
          {asTable ? 'ดูเป็นกราฟ' : 'ดูเป็นตาราง'}
        </button>
      )}>
      <SummaryGate ov={ov} name="departments" label="ภาพรวมรายกอง">
        {() => {
          const rows = ov.derived?.deptRows ?? []
          const ratingFailed = ov.model.satisfaction?.state === 'error'
          if (rows.length === 0) return <p data-exec-dept-empty className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-xs text-slate-500">ยังไม่มีข้อมูล</p>
          return (
            <>
              {/* กราฟ (ค่าเริ่มต้น) — แท่งงานค้างรายกองบนสเกลเดียวกัน: แดง = เลยกำหนด · เทา = ยังไม่เลยกำหนด
                  เรียงตามทะเบียนกอง (ไม่จัดอันดับ — เจ้าของระบบตัดสิน) · กองที่ไม่มีอะไรเลยยุบเป็นบรรทัดเดียว ให้หน้าไม่ยาว */}
              {!asTable && <DeptBars rows={rows} />}
              {/* ตาราง (กดสลับ) — ตัวเลขครบทุกช่องสำหรับคนที่อยากอ่านเป็นตัวเลข/ใช้โปรแกรมอ่านหน้าจอ · มือถือเลื่อนแนวนอนในกรอบ */}
              <div className={`${asTable ? 'block' : 'hidden'} overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm`}>
                <table data-exec-dept-table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-[11px] text-slate-500">
                      <th scope="col" className="px-3 py-2 text-left font-semibold">กอง</th>
                      {DEPT_COLUMNS.map((c) => (
                        <th key={c.id} scope="col" className="px-1 py-2 text-right font-semibold"><span className="inline-flex items-center gap-0.5">{c.label}{info(c)}</span></th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key} data-exec-dept={r.key} className="border-b border-slate-50 last:border-0">
                        <td className="px-3 py-2 font-semibold text-slate-800">{r.name}</td>
                        <td className="px-1 py-2 text-right tabular-nums">
                          <span className={r.openTotal > 0 ? 'text-base font-bold text-amber-600' : 'text-base text-slate-300'}>{nf(r.openTotal)}</span>
                          <span className="block text-[10px] text-slate-400">คำร้อง {nf(r.complaints.open)} · คำขอ {nf(r.docs.open)}{r.complaints.parked > 0 ? ` · รอดำเนินการ ${nf(r.complaints.parked)}` : ''}</span>
                        </td>
                        <td className={`px-1 py-2 text-right text-base tabular-nums ${r.overdueTotal > 0 ? 'font-bold text-rose-600' : 'text-slate-300'}`}>{nf(r.overdueTotal)}</td>
                        <td className={`px-1 py-2 text-right text-base tabular-nums ${r.doneTotal > 0 ? 'font-bold text-emerald-600' : 'text-slate-300'}`}>{nf(r.doneTotal)}</td>
                        <td className="px-1 py-2 pr-3 text-right tabular-nums text-slate-800">
                          <span className="text-base font-bold">{ratingText(r.rating)}</span>
                          {r.rating?.avg != null && <span className="block text-[10px] text-slate-400">{nf(r.rating.cnt)} คะแนน</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* โหมดกราฟไม่มีหัวตาราง — แถวปุ่มสูตร ⓘ อยู่ใต้กราฟ (โหมดตารางมี ⓘ ที่หัวคอลัมน์แล้ว) */}
              <div className={`${asTable ? 'hidden' : 'flex'} flex-wrap items-center gap-1`}>
                <span className="text-[10px] text-slate-400">วิธีคำนวณ:</span>
                {DEPT_COLUMNS.map((c) => (
                  <button key={c.id} type="button" aria-expanded={open === c.id} onClick={() => toggle(c.id)}
                    className={`inline-flex min-h-8 items-center rounded-full border px-2.5 text-[11px] font-semibold ${open === c.id ? 'border-sky-300 bg-sky-50 text-sky-800' : 'border-slate-200 bg-white text-slate-600'}`}>
                    ⓘ {c.label}
                  </button>
                ))}
              </div>
              {ratingFailed && <SectionError text="คะแนนรายกองโหลดไม่ได้ — คอลัมน์คะแนนแสดงเป็นขีด" onRetry={ov.reload} />}
              <p className="text-[10px] text-slate-500">คะแนน = ค่าเฉลี่ยเสียงผู้รับบริการตัวจริงของคำร้องที่ปิดในช่วง · ขีด = ยังไม่มีคะแนน (ไม่ใช่ 0)</p>
              {DEPT_COLUMNS.map((c) => open === c.id && <FormulaPanel key={c.id} title={c.label} items={execFormulas(entries, c.id)} />)}
              {go && <LinkButton onClick={go} label="ดูรายคนที่เมนูผลการปฏิบัติงาน" />}
            </>
          )
        }}
      </SummaryGate>
    </ExecSection>
  )
}

// ───────────────────────── ข้อมูลประกอบ ─────────────────────────

/** รีวิวสถานที่ใหม่ในช่วงที่เลือก (นับจำนวนอย่างเดียว ไม่ดึงเนื้อรีวิว/ชื่อผู้รีวิว) */
function ReviewCard({ entry, reviews, rangeText, go }) {
  const kpi = entry.kpis.find((k) => k.id === 'new_reviews')
  const [open, setOpen] = useState(false)
  const body = (
    <>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700"><Star size={19} aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-slate-800">{kpi?.label ?? 'รีวิวใหม่'}</span>
        <span className="block truncate text-[11px] text-slate-500">{entry.label} · ช่วง {rangeText}</span>
      </span>
      <span data-exec-review-count className="text-2xl font-black tabular-nums text-slate-800">
        {reviews.status === 'ok' ? nf(reviews.count) : reviews.status === 'error' ? '—' : '…'}<span className="sr-only"> รายการ</span>
      </span>
      {go && <ChevronRight size={16} className="shrink-0 text-slate-300" aria-hidden="true" />}
    </>
  )
  return (
    <div data-exec-reviews className="space-y-1.5">
      <div className="flex items-stretch gap-1 rounded-2xl border border-white bg-white shadow-sm">
        {go
          ? <button type="button" onClick={go} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-2 text-left active:scale-[0.99]">{body}</button>
          : <div className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-3 py-2">{body}</div>}
        {kpi && <div className="flex items-start py-1.5 pr-1.5"><InfoButton active={open} onClick={() => setOpen((v) => !v)} label={kpi.label} /></div>}
      </div>
      {reviews.status === 'error' && <SectionError text="โหลดจำนวนรีวิวไม่ได้" onRetry={reviews.reload} />}
      {open && kpi && <FormulaPanel title={kpi.label} items={[{ who: entry.label, formula: kpi.formula, source: kpi.source }]} />}
    </div>
  )
}

/** ข้อมูลประกอบ: รีวิวใหม่ (ตัวเลข) + ทางลัดไปเมนูที่ไม่มีตัวเลขบนหน้านี้ (ข่าว/ท่องเที่ยว/ตารางขยะ/บันทึกงานซ่อม) */
export function ContextZone({ entries, reviews, rangeText, resolveLink }) {
  const reviewEntry = entries.find((e) => e.key === 'tourism-reviews') ?? null
  const tiles = entries
    .filter((e) => e.zones.includes('context') && e.kind === 'module' && e.key !== 'tourism-reviews')
    .map((e) => ({ entry: e, go: resolveLink(e) }))
    .filter((t) => t.go)
  if (!reviewEntry && tiles.length === 0) return null
  return (
    <ExecSection id="context" title="ข้อมูลประกอบ" Icon={Info}>
      {reviewEntry && <ReviewCard entry={reviewEntry} reviews={reviews} rangeText={rangeText} go={resolveLink(reviewEntry)} />}
      {tiles.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {tiles.map(({ entry, go }) => (
            <Tile key={entry.key} testId={entry.key} tone="context" Icon={execIcon(entry.icon)} label={entry.label} sub={entry.dept} onClick={go} />
          ))}
        </div>
      )}
    </ExecSection>
  )
}

