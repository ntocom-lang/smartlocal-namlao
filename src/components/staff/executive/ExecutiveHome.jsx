import { useMemo, useState } from 'react'
import { CalendarClock, CheckCircle2, ChevronRight, FileSignature, FileText, LayoutDashboard, MapPinned, TriangleAlert } from 'lucide-react'
import { EXEC_PERIOD_KEYS, EXEC_ZONES, isPhaseLive, liveEntries } from '../../../lib/executiveRegistry'
import {
  EXEC_DEFAULT_PERIOD, buildAlerts, buildDecisionQueue, deriveExec, execPeriodRange, execPreviousRange, execRangeText, execSummaryKeys,
  execToday, thaiDayLabel, upcomingEvents,
} from '../../../lib/executiveData'
import { esignPendingFromRpc } from '../../../lib/esign'
import { STAFF_MENU_TARGETS } from '../../../lib/staffMenuAccess'
import { useHomeRpc } from '../../../lib/staffHomeData'
import { groupMyEvents } from '../../../lib/staffHomeSummary'
import { useTenant } from '../../../contexts/TenantContext'
import { useExecOverview } from '../../../hooks/useExecOverview'
import { useExecPlanProgress } from '../../../hooks/useExecPlanProgress'
import { useExecReviewCount, useExecSchedule } from '../../../hooks/useExecExtras'
import MyPendingSignatures from '../../esign/MyPendingSignatures'
import { AssignedEventsSection } from '../StaffOperationalDashboard'
import ExecServiceZone from './ExecServiceZone'
import { OverdueCard } from './ExecServiceBlocks'
import ExecServiceReportTile from './ExecServiceReportTile'
import { AlertZone, ContextZone, DecisionQueue, DeptZone, PlanZone } from './ExecOpsZones'
import { ExecSection, FormulaPanel, InfoButton, LoadingLine, SectionError, SubHead, Tile } from './ExecParts'
import { execIcon } from './execIcons'

// "ห้องผู้บริหาร" — หน้าแรกของนายก/รองนายก/ปลัด
// เฟส E1: RPC เดิมทั้งหมด (สถิติสาธารณะ + esign_my_pending + staff_home_summary) · เฟส E2: executive_overview() เรียกครั้งเดียวต่อช่วงที่ตัวนี้
// ทะเบียน executiveRegistry.js เป็นตัวกำหนดว่าโซนไหนมีอะไร — หน้านี้วาดเฉพาะรายการที่ liveEntries() คืนมา (โมดูลเปิดอยู่ + เฟสถึงแล้ว)
// ช่วงเวลา (วันนี้/7 วัน/เดือน/ปีงบ) ถือที่นี่ที่เดียว: โซน ② เป็นคนวาดปุ่มเลือก · โซน ⑥ รายกอง/ข้อมูลประกอบใช้ช่วงเดียวกัน
// หน้านี้เป็นหน้าเดี่ยว /executive (ExecutiveRoom.jsx) ไม่ได้ฝังในหน้าแรก /staff — ลิงก์เปิดโมดูลพาไป /staff พร้อม state { module } (ดู resolveLink)
// ข้อห้ามของหน้านี้: ไม่มีปุ่มอนุมัติ/เปลี่ยนสถานะ · ไม่แสดงชื่อคนจากข้อมูลคำร้อง/คำขอ/ผู้ป่วย · ไม่อ่านตารางคำร้อง/คำขอตรงๆ (ใช้ RPC เท่านั้น)

const zoneTitle = (zone) => EXEC_ZONES[zone].replace(/^[①-⑳]\s*/, '')
const inZone = (entries, zone) => entries.filter((e) => e.zones.includes(zone))
// แถวบนจอกว้าง — โซนในแถวเดียวกันวางคู่กัน (lg ขึ้นไป) · แถวที่เหลือโซนเดียวกินเต็มแถว
// สัญญาณเตือน (③) ขึ้นใต้เรื่องของท่านทันที · ตารางรายกอง/แผนกว้างเกินครึ่งแถว จึงอยู่แถวเต็ม
const ZONE_ROWS = [['decision', 'schedule'], ['alert'], ['service'], ['plan'], ['dept'], ['area', 'report'], ['context']]
// การ์ด "เลยกำหนด (ค้างอยู่ตอนนี้)" + รายการ/เร่งรัด (E3-2) — ไม่ใช่โซนในทะเบียน (ข้อมูลเป็นของโซน ② งานบริการ)
// แต่วางเป็นแถวของตัวเองเหนือ ③ สัญญาณเตือน ให้นายกเห็นก่อน (เจ้าของระบบสั่ง 2026-11-11)
// วันที่ไม่มีสัญญาณเตือน (โซน ③ ไม่ขึ้น) = อยู่เหนือโซน ② แทน · ไม่มีงานบริการประชาชนเลย = ไม่ขึ้น
const OVERDUE_BEFORE = ['alert', 'service']

// ───────────────────────── ① รอท่านลงนาม / รอท่านพิจารณา ─────────────────────────

// canOpenFleet = บัญชีนี้เปิดเมนูยานพาหนะได้จริง — ใช้บอกทางไปดูใบที่เหลือ (ไม่ชี้ทางที่บัญชีนี้เข้าไม่ได้)
function DecisionZone({ entries, tenantId, profileId, canOpenFleet, ov, queue, resolveLink }) {
  const esignEntry = entries.find((e) => e.key === 'src:esign')
  const kpi = esignEntry?.kpis.find((k) => k.id === 'my_pending' && isPhaseLive(k.phase))
  // ลงนามออนไลน์ครอบเฉพาะใบขอใช้รถ — อปท. ที่ไม่ได้เปิดโมดูลยานพาหนะไม่มีรายการ src:esign จึงไม่วาดส่วนลงนาม (ไม่ขึ้น "ไม่มีเอกสารรอลงนาม" ลวงๆ)
  const rpc = useHomeRpc({ rpc: 'esign_my_pending', args: {}, tenantId, profileId, enabled: Boolean(profileId && esignEntry) })
  const pending = esignPendingFromRpc(rpc)
  // ลงนามใบสุดท้ายแล้วรายการว่าง — เก็บส่วนนี้ไว้จนกว่าจะออกจากหน้า ให้ข้อความ "ลงนามแล้ว" ยังอยู่ (แบบเดียวกับหน้าแรกเจ้าหน้าที่)
  const [touched, setTouched] = useState(false)
  const [showFormula, setShowFormula] = useState(false)
  const total = pending.items.length + pending.returned.length

  const clear = pending.status === 'ok' && total === 0 && !touched
  const infoButton = kpi && <InfoButton active={showFormula} onClick={() => setShowFormula((v) => !v)} label={kpi.label} />

  return (
    <ExecSection compact id="decision" title="รอท่านตัดสินใจ/ลงนาม" Icon={FileSignature} note={esignEntry ? 'ลงนามออนไลน์เปิดใช้กับใบขอใช้รถ' : 'ระบบแค่รวมเรื่องให้ · การตัดสินทำที่เมนูเดิมของเรื่องนั้น'} aside={infoButton}>
      {esignEntry && (
        <>
          {/* ไม่มีเรื่อง = แถบเขียวเตี้ยแถบเดียว (ไม่ต้องมีเลข 0 ซ้ำอีกกล่อง) · มีเรื่อง = เลขสีส้ม + รายการเดิม */}
          {clear ? (
            <div data-exec-esign-clear className="flex min-h-9 items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-1.5 text-xs font-bold text-emerald-800 shadow-sm">
              <CheckCircle2 size={16} className="shrink-0 text-emerald-600" aria-hidden="true" />
              <span className="min-w-0 flex-1">ไม่มีเอกสารรอท่านลงนาม</span>
              <span data-exec-esign-count className="sr-only">0 ใบ</span>
            </div>
          ) : (
            <div className="flex min-h-11 items-center gap-2 rounded-xl border border-amber-200 bg-white px-3 py-1.5 shadow-sm">
              <span className="min-w-0 flex-1 text-sm font-bold text-slate-700">{kpi?.label ?? 'เอกสารรอท่านลงนาม'}</span>
              <span data-exec-esign-count className={`text-2xl font-black tabular-nums ${total > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                {pending.status === 'ok' ? total : '–'}<span className="sr-only"> ใบ</span>
              </span>
            </div>
          )}
          {showFormula && kpi && <FormulaPanel title={kpi.label} items={[{ who: esignEntry.label, formula: kpi.formula, source: kpi.source }]} />}

          {pending.status === 'loading' && <LoadingLine text="กำลังตรวจรายการรอลงนาม…" />}
          {/* ดึงไม่ได้ต้องไม่ขึ้นว่า "ไม่มีเรื่องรอท่าน" — อาจมีใบรออยู่ · MyPendingSignatures วาดสถานะ error + ปุ่มลองใหม่ให้เอง */}
          <MyPendingSignatures variant="home" status={pending.status} items={pending.items} returned={pending.returned} limit={5}
            moreHint={canOpenFleet ? 'ที่เหลือดูได้ที่ ยานพาหนะและเชื้อเพลิง › การใช้รถ' : undefined}
            onSigned={() => { setTouched(true); rpc.reload() }} onRetry={rpc.reload} />
        </>
      )}
      <DecisionQueue ov={ov} queue={queue} resolveLink={resolveLink} />
    </ExecSection>
  )
}

// ───────────────────────── ④ กำหนดการ ─────────────────────────

const SCHEDULE_LIMIT = 10

function ScheduleZone({ entries, tenantId, profileId, role, resolveLink, today }) {
  const eventsEntry = entries.find((e) => e.key === 'events') ?? null
  const summary = useHomeRpc({ rpc: 'staff_home_summary', tenantId, profileId, enabled: Boolean(eventsEntry && profileId) })
  const week = useExecSchedule({ tenantId, profileId, role, enabled: Boolean(eventsEntry && profileId) })
  const open = eventsEntry ? resolveLink(eventsEntry) : null
  const myEvents = groupMyEvents(summary.status === 'ok' ? summary.data?.my_events : [], summary.data?.today)
  const count = myEvents.today.length + myEvents.tomorrow.length
  const upcoming = useMemo(() => upcomingEvents(week.events, today), [week.events, today])
  // ⓘ: 'assigned' = กิจกรรมที่มอบหมายให้ท่าน (วันนี้-พรุ่งนี้) · 'upcoming' = กำหนดการ 7 วัน (ปฏิทิน + รายการส่วนตัว) — สูตรจากทะเบียน
  const assignedKpi = eventsEntry?.kpis.find((k) => k.id === 'assigned' && isPhaseLive(k.phase))
  const upcomingKpi = eventsEntry?.kpis.find((k) => k.id === 'upcoming' && isPhaseLive(k.phase))
  const [formulaId, setFormulaId] = useState(null)
  const toggle = (id) => setFormulaId((cur) => (cur === id ? null : id))
  const formulaOf = (kpi) => (kpi ? [{ who: eventsEntry.label, formula: kpi.formula, source: kpi.source }] : [])

  const shown = upcoming.slice(0, SCHEDULE_LIMIT)
  const days = [...new Set(shown.map((e) => e.day))]

  return (
    // ปุ่มเปิดปฏิทินอยู่มุมขวาของหัวกล่อง (เดิมเป็นแถบเต็มกว้างท้ายกล่อง) — กินที่น้อยลง (เจ้าของระบบขอ 2026-11-11)
    <ExecSection compact id="schedule" title="กำหนดการ" Icon={CalendarClock}
      aside={open && (
        <button type="button" data-exec-open-calendar onClick={open}
          className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2.5 text-xs font-bold text-emerald-800 shadow-sm hover:bg-emerald-50 active:scale-95">
          <CalendarClock size={14} className="text-emerald-600" aria-hidden="true" />เปิดปฏิทิน
          <ChevronRight size={13} className="text-slate-300" aria-hidden="true" />
        </button>
      )}>
      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <SubHead tone="border-emerald-500 text-emerald-950">มอบหมายให้ท่าน (วันนี้-พรุ่งนี้)</SubHead>
          {assignedKpi && <InfoButton active={formulaId === 'assigned'} onClick={() => toggle('assigned')} label={assignedKpi.label} />}
        </div>
        {formulaId === 'assigned' && <FormulaPanel title={assignedKpi.label} items={formulaOf(assignedKpi)} />}
        {summary.status === 'loading' && <LoadingLine text="กำลังโหลดกำหนดการ…" />}
        {summary.status === 'error' && <SectionError text="โหลดกำหนดการไม่ได้" onRetry={summary.reload} />}
        {summary.status === 'ok' && count > 0 && (
          <div className="rounded-2xl border border-emerald-100 bg-white p-2.5 shadow-sm">
            <AssignedEventsSection myEvents={myEvents} onOpen={open ?? undefined} showHeading={false} />
          </div>
        )}
        {summary.status === 'ok' && count === 0 && (
          <p data-exec-schedule-empty className="flex min-h-9 items-center rounded-xl border border-emerald-100 bg-white px-3 py-1.5 text-xs text-slate-600 shadow-sm">
            ไม่มีกิจกรรมที่มอบหมายให้ท่านวันนี้หรือพรุ่งนี้
          </p>
        )}
      </div>

      <div data-exec-upcoming className="space-y-1.5">
        <div className="flex items-center gap-1">
          <SubHead tone="border-emerald-500 text-emerald-950">กำหนดการ 7 วันข้างหน้า</SubHead>
          {upcomingKpi && <InfoButton active={formulaId === 'upcoming'} onClick={() => toggle('upcoming')} label={upcomingKpi.label} />}
        </div>
        {formulaId === 'upcoming' && <FormulaPanel title={upcomingKpi.label} items={formulaOf(upcomingKpi)} />}
        {week.status === 'loading' && <LoadingLine text="กำลังโหลดกำหนดการ 7 วัน…" />}
        {week.status === 'error' && <SectionError text="โหลดกำหนดการ 7 วันไม่ได้" onRetry={week.reload} />}
        {week.status === 'ok' && upcoming.length === 0 && (
          <p data-exec-upcoming-empty className="flex min-h-9 items-center rounded-xl border border-emerald-100 bg-white px-3 py-1.5 text-xs text-slate-600 shadow-sm">
            ไม่มีกำหนดการใน 7 วันข้างหน้า
          </p>
        )}
        {week.status === 'ok' && upcoming.length > 0 && (
          <div className="space-y-2 rounded-2xl border border-emerald-100 bg-white p-2.5 shadow-sm">
            {days.map((day) => (
              <section key={day} aria-label={thaiDayLabel(day, today)}>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{thaiDayLabel(day, today)}</p>
                <ul className="mt-1 space-y-1">
                  {shown.filter((e) => e.day === day).map((e) => (
                    <li key={e.id} data-exec-event className="flex items-start gap-2 text-sm">
                      <span className="w-11 shrink-0 pt-0.5 text-xs font-semibold tabular-nums text-emerald-700">{e.time ?? 'ทั้งวัน'}</span>
                      <span className="min-w-0 flex-1 break-words text-slate-800">
                        {e.title}
                        {e.end > e.start && <span className="ml-1 text-[11px] text-slate-500">(ถึง {execRangeText({ from: e.end, to: e.end })})</span>}
                      </span>
                      {e.personal && <span className="shrink-0 rounded-full bg-pink-100 px-1.5 py-0.5 text-[10px] font-bold text-pink-700">เฉพาะฉัน</span>}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {upcoming.length > shown.length && <p className="text-[11px] text-slate-500">และอีก {upcoming.length - shown.length} รายการ — ดูทั้งหมดที่ปฏิทินกิจกรรม</p>}
          </div>
        )}
      </div>

    </ExecSection>
  )
}

// ───────────────────────── ⑦ พื้นที่ / ⑧ รายงาน (ไทล์ลิงก์) ─────────────────────────

function AreaZone({ entries, resolveLink }) {
  const tiles = inZone(entries, 'area').map((e) => ({ entry: e, go: resolveLink(e) })).filter((t) => t.go)
  if (tiles.length === 0) return null
  return (
    <ExecSection id="area" title={zoneTitle('area')} Icon={MapPinned}>
      <div className="grid gap-2 sm:grid-cols-2">
        {tiles.map(({ entry, go }) => (
          <Tile key={entry.key} testId={entry.key} tone="area" Icon={execIcon(entry.icon)} label={entry.label} sub={entry.dept} onClick={go} />
        ))}
      </div>
    </ExecSection>
  )
}

// รายงานแบบ action (ทะเบียน: report.action = true ไม่มี path) — ตัววาดผูกด้วย id · เพิ่มรายการ action ใหม่ในทะเบียนแล้วต้องเพิ่มที่นี่ด้วย
// (ไม่มีตัววาด = ไม่ขึ้นจอ ไม่ใช่ปุ่มหลอก) · ⚠️ test:exec-report ล้มถ้า id ของรายการ action ในทะเบียนไม่อยู่ในแผนที่นี้ (กันหายเงียบ)
const ACTION_REPORTS = Object.freeze({ service_summary: ExecServiceReportTile })

function ReportZone({ entries, navigate, tenant }) {
  const seen = new Set()
  const reports = entries.flatMap((e) => (e.reports ?? [])
    .filter((r) => isPhaseLive(r.phase) && (r.path || ACTION_REPORTS[r.id]))
    .map((r) => ({ ...r, ownerLabel: e.label })))
    // กันไทล์ซ้ำ: แบบลิงก์ = path+ป้ายเดียวกันจากหลายรายการขึ้นไทล์เดียว (เหมือนเดิม) · แบบ action = id
    .filter((r) => { const k = r.path ? `path:${r.path}|${r.label}` : `action:${r.id}`; if (seen.has(k)) return false; seen.add(k); return true })
  if (reports.length === 0) return null
  return (
    <ExecSection id="report" title={zoneTitle('report')} Icon={FileText}>
      <div className="grid gap-2 sm:grid-cols-2">
        {reports.map((r) => {
          if (r.path) return <Tile key={`${r.path}|${r.id}`} testId={r.id} tone="report" Icon={FileText} label={r.label} sub={r.ownerLabel} onClick={() => navigate(r.path)} />
          const ActionTile = ACTION_REPORTS[r.id]
          return <ActionTile key={r.id} tenant={tenant} sub={r.ownerLabel} entries={entries} />
        })}
      </div>
    </ExecSection>
  )
}

// ───────────────────────── หน้าหลัก ─────────────────────────

/**
 * @param {{
 *   scopedKeys: string[],         // คีย์โมดูลที่บัญชีนี้เห็นในเมนูเจ้าหน้าที่จริง (staffVisibleModuleKeys) — ใช้ตัดสินว่าลิงก์ไหนเปิดได้ ไม่ทำปุ่มหลอก
 *   navigate: (path: string, options?: object) => void,
 *   profile: object|null,
 *   tenant: object|null,
 *   isModuleEnabled: (key: string) => boolean,         // โมดูลเปิดอยู่ไหมตามกติกาเดียวกับเมนูจริง (ต้องคงที่ข้าม render)
 *   tenantModuleEnabled: (key: string) => boolean,     // isModuleEnabled ของ TenantContext — ใช้ตัดสินว่า อปท. เปิดโมดูลนั้นไหม (ไม่ดูสิทธิ์รายบุคคล)
 * }} props
 */
export default function ExecutiveHome({ scopedKeys = [], navigate, profile, tenant, isModuleEnabled, tenantModuleEnabled }) {
  const { holidaysVersion } = useTenant()
  const tenantId = tenant?.id
  const profileId = profile?.id
  const [openedAt] = useState(() => new Date())
  const todayTH = openedAt.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const [period, setPeriod] = useState(EXEC_DEFAULT_PERIOD)
  const range = useMemo(() => execPeriodRange(period, openedAt), [period, openedAt])
  const prevRange = useMemo(() => execPreviousRange(period, openedAt), [period, openedAt])
  // ลงนามออนไลน์ปัจจุบันครอบเฉพาะใบขอใช้รถ (esign_my_pending) — อปท. ที่ไม่ได้เปิดโมดูลยานพาหนะจึงไม่มีอะไรให้ลงนาม ไม่แสดงส่วนลงนามเลย
  const hasEsign = tenantModuleEnabled('fleet')
  const entries = useMemo(
    () => liveEntries(isModuleEnabled).filter((e) => e.key !== 'src:esign' || hasEsign),
    [isModuleEnabled, hasEsign],
  )
  const canOpenFleet = scopedKeys.includes('fleet')

  // executive_overview: ช่วงปัจจุบัน = ทุกคีย์ของรายการที่ขึ้นจอ · ช่วงก่อนหน้า = เฉพาะคีย์ที่ผลขึ้นกับช่วง (สำหรับลูกศรเทียบ)
  const keys = useMemo(() => execSummaryKeys(entries), [entries])
  const prevKeys = useMemo(() => keys.filter((k) => EXEC_PERIOD_KEYS.includes(k)), [keys])
  const cur = useExecOverview({ tenantId, profileId, range, keys, enabled: true })
  const before = useExecOverview({ tenantId, profileId, range: prevRange, keys: prevKeys, enabled: true })
  // "วันนี้" ใช้ค่าจากฐานข้อมูล (วันปฏิทินไทย ตัวเดียวกับที่ SQL ตัดสินเลยกำหนด) ไม่มีก็ใช้เวลาตอนเปิดหน้า
  const today = cur.today ?? execToday(openedAt)

  // วันทำการขึ้นกับตารางวันหยุดที่โหลดจากฐานข้อมูลทีหลังหน้าจอ — holidaysVersion เป็น dependency โดยตั้งใจ (แพตเทิร์นเดียวกับ LocalPlanModule)
  const derived = useMemo(() => { void holidaysVersion; return deriveExec({ model: cur.model, today }) }, [cur.model, today, holidaysVersion])
  const prevDerived = useMemo(
    () => (before.status === 'ok' ? deriveExec({ model: before.model, today: before.today ?? today }) : null),
    [before.status, before.model, before.today, today],
  )
  const hasPlanEntry = entries.some((e) => e.key === 'local-plan')
  const plan = useExecPlanProgress({ tenantId, profileId, enabled: hasPlanEntry })
  const resultMissing = plan.status === 'ok' && plan.data?.state === 'ok' ? plan.data.resultMissing : 0
  const queue = useMemo(() => { void holidaysVersion; return buildDecisionQueue({ entries, model: cur.model, today }) }, [entries, cur.model, today, holidaysVersion])
  const alerts = useMemo(() => {
    void holidaysVersion
    const built = buildAlerts({ entries, model: cur.model, today, resultMissing })
    const failures = [...built.failures]
    // executive_overview ล้มทั้งก้อน (เน็ต/หมดเวลา) → model เป็น missing ทุกคีย์ buildAlerts จึงไม่เห็นว่าพัง
    // ต้องบอกเอง ไม่งั้นโซน ③ หายเงียบ ผู้บริหารอ่านว่า "ไม่มีสัญญาณเตือน" (code review #685)
    if (cur.status === 'error') failures.push('ตัวเลขสรุปทั้งหมด')
    // ผลดำเนินการตามแผนโหลดไม่ได้ = ตรวจ "ถึงกำหนดแต่ยังไม่มีผล" ไม่ได้ — บอกชัด ไม่ปล่อยให้ดูเหมือนไม่มีเรื่อง
    if (plan.status === 'error') failures.push('ผลดำเนินการตามแผนพัฒนา')
    return { ...built, failures }
  }, [entries, cur.model, cur.status, today, resultMissing, plan.status, holidaysVersion])
  const hasReviewEntry = entries.some((e) => e.key === 'tourism-reviews')
  const reviews = useExecReviewCount({ tenantId, range, enabled: hasReviewEntry })

  const ov = {
    status: cur.status, reload: cur.reload, model: cur.model, today, derived,
    prevStatus: before.status, prevModel: before.model, prevDerived,
  }

  // ลิงก์ของรายการ → ฟังก์ชันเปิด · null = บัญชีนี้ไม่มีทางเปิด (โมดูลไม่อยู่ในเมนูที่เห็น) จึงไม่ทำเป็นปุ่มหลอก
  // โมดูล = พาไป /staff พร้อม state { module } (StaffDashboard อ่าน location.state.module) · เมนูที่เป็นหน้าแยก/แท็บใหม่ใช้ STAFF_MENU_TARGETS
  const resolveLink = (entry) => {
    const link = entry?.link
    if (!link) return null
    if (link.module && scopedKeys.includes(link.module)) {
      const target = STAFF_MENU_TARGETS[link.module]
      return () => {
        if (target?.newTab) window.open(target.newTab, '_blank', 'noopener,noreferrer')
        else if (target?.externalUrl) navigate(target.externalUrl)
        else navigate('/staff', { state: { module: link.module } })
      }
    }
    if (link.path) return () => navigate(link.path)
    return null
  }

  const rangeText = execRangeText(range)
  const renderers = {
    decision: () => (
      <DecisionZone key="decision" entries={entries} tenantId={tenantId} profileId={profileId} canOpenFleet={canOpenFleet}
        ov={ov} queue={queue} resolveLink={resolveLink} />
    ),
    service: () => (
      <ExecServiceZone key="service" entries={inZone(entries, 'service')} tenant={tenant} profileId={profileId}
        isModuleEnabled={isModuleEnabled} resolveLink={resolveLink}
        ov={ov} period={period} setPeriod={setPeriod} range={range} prev={prevRange} />
    ),
    overdue: () => (
      <div key="overdue" data-exec-overdue-top>
        <OverdueCard ov={ov} entries={inZone(entries, 'service')} tenant={tenant} profile={profile} />
      </div>
    ),
    alert: () => <AlertZone key="alert" alerts={alerts} ov={ov} resolveLink={resolveLink} />,
    schedule: () => <ScheduleZone key="schedule" entries={entries} tenantId={tenantId} profileId={profileId} role={profile?.role} resolveLink={resolveLink} today={today} />,
    plan: () => <PlanZone key="plan" ov={ov} entries={entries} plan={plan} resolveLink={resolveLink} />,
    dept: () => <DeptZone key="dept" ov={ov} entries={entries} rangeText={rangeText} resolveLink={resolveLink} />,
    area: () => <AreaZone key="area" entries={entries} resolveLink={resolveLink} />,
    report: () => <ReportZone key="report" entries={entries} navigate={navigate} tenant={tenant} />,
    context: () => <ContextZone key="context" entries={entries} reviews={reviews} rangeText={rangeText} resolveLink={resolveLink} />,
  }

  // โซนที่ขึ้นจอได้: เรียงตามทะเบียน (EXEC_ZONES) เฉพาะโซนที่มีรายการ live และมีตัววาด
  // ③ สัญญาณเตือนขึ้นเฉพาะเมื่อมีเรื่อง (หรือมีโมดูลที่ตรวจไม่ได้) · ⑤ ต้องมีโครงการหรือแผน · ⑥ ต้องมีเมนูผลการปฏิบัติงาน (ไม่ใช่แค่ "รายงาน")
  const hasZone = {
    alert: alerts.items.length > 0 || alerts.failures.length > 0,
    plan: entries.some((e) => e.key === 'projects' || e.key === 'local-plan'),
    dept: entries.some((e) => e.key === 'performance'),
    context: entries.some((e) => e.zones.includes('context') && e.kind === 'module' && (e.key === 'tourism-reviews' || resolveLink(e))),
  }
  const shown = Object.keys(EXEC_ZONES).filter((zone) => renderers[zone] && (zone in hasZone ? hasZone[zone] : inZone(entries, zone).length > 0))
  // จัดแถวบนจอกว้าง (lg) ให้เป็นสัดส่วน · มือถือเรียงลงตามลำดับเดิม · โซนที่ไม่อยู่ใน ZONE_ROWS ต่อท้ายเต็มแถวเอง ไม่หายเงียบ
  const rows = [...ZONE_ROWS.map((row) => row.filter((z) => shown.includes(z))), ...shown.filter((z) => !ZONE_ROWS.flat().includes(z)).map((z) => [z])]
    .filter((row) => row.length > 0)
  // เงื่อนไขเดียวกับที่ ExecServiceZone ใช้ตัดสินว่ามีงานบริการประชาชนให้แสดง (คำร้อง หรือคำขอ E-Service)
  const hasCitizenService = inZone(entries, 'service').some((e) => e.key === 'complaints' || e.isCitizenService)
  const overdueAt = hasCitizenService ? rows.findIndex((row) => row.some((z) => OVERDUE_BEFORE.includes(z))) : -1
  if (overdueAt >= 0) rows.splice(overdueAt, 0, ['overdue'])

  // relative: span sr-only (position:absolute) ของตัวเลขต้องอิงกล่องนี้ ไม่งั้นไปอิง body แล้วดันความสูงเอกสาร
  // จนเกิดแถบเลื่อนซ้อน 2 ชั้น (main เลื่อน + ทั้งหน้าเลื่อน) — เจอจริงตอนตรวจ E2 บนจอ 1280px
  return (
    <div data-exec-home className="relative space-y-4">
      <header className="min-w-0 rounded-3xl bg-gradient-to-br from-sky-800 to-indigo-800 px-4 py-3.5 text-white shadow-sm">
        <div className="flex items-center gap-2">
          <LayoutDashboard size={20} className="shrink-0 text-sky-200" aria-hidden="true" />
          <h1 className="truncate text-xl font-black">ห้องผู้บริหาร</h1>
        </div>
        <p className="mt-0.5 truncate text-xs text-sky-100">{[tenant?.name, todayTH].filter(Boolean).join(' · ')}</p>
      </header>
      {cur.status === 'forbidden' && (
        <p role="alert" data-exec-forbidden className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>บัญชีนี้ไม่มีสิทธิ์ดูตัวเลขสรุปของห้องผู้บริหาร (เลยกำหนด / % ทันกำหนด / คะแนน / รายกอง) จึงแสดงเฉพาะส่วนที่เปิดอ่านได้ — แจ้งผู้ดูแลระบบหากควรมีสิทธิ์</span>
        </p>
      )}
      {rows.map((row) => (
        <div key={row.join('|')} className={row.length > 1 ? 'grid items-start gap-4 lg:grid-cols-2' : ''}>
          {row.map((zone) => renderers[zone]())}
        </div>
      ))}
    </div>
  )
}
