import { useState } from 'react'
import { CalendarClock, CheckCircle2, ChevronRight, FileSignature, FileText, LayoutDashboard, MapPinned } from 'lucide-react'
import { EXEC_ZONES, isPhaseLive, liveEntries } from '../../../lib/executiveRegistry'
import { esignPendingFromRpc } from '../../../lib/esign'
import { useHomeRpc } from '../../../lib/staffHomeData'
import { groupMyEvents } from '../../../lib/staffHomeSummary'
import MyPendingSignatures from '../../esign/MyPendingSignatures'
import { AssignedEventsSection } from '../StaffOperationalDashboard'
import ExecServiceZone from './ExecServiceZone'
import { ExecSection, FormulaPanel, InfoButton, LoadingLine, SectionError } from './ExecParts'
import { execIcon } from './execIcons'

// "ห้องผู้บริหาร" — หน้าแรกของนายก/รองนายก/ปลัด (เฟส E1: ใช้ RPC เดิมทั้งหมด ไม่มี SQL)
//
// ทะเบียน executiveRegistry.js เป็นตัวกำหนดว่าโซนไหนมีอะไร — หน้านี้วาดเฉพาะรายการที่ liveEntries() คืนมา (โมดูลเปิดอยู่ + เฟสถึงแล้ว)
// โซนที่ยังไม่มีรายการเฟส E1 (③ สัญญาณเตือน ⑤ แผน ⑥ รายกอง ข้อมูลประกอบ) จึงยังไม่ขึ้นจอ — เพิ่มตัววาดใน ZONE_RENDERERS ตอนเฟสถัดไป
// ข้อห้ามของหน้านี้: ไม่มีปุ่มอนุมัติ/เปลี่ยนสถานะ · ไม่แสดงชื่อคนจากข้อมูลคำร้อง/คำขอ/ผู้ป่วย · ไม่อ่านตารางคำร้อง/คำขอตรงๆ

const zoneTitle = (zone) => EXEC_ZONES[zone].replace(/^[①-⑳]\s*/, '')
const inZone = (entries, zone) => entries.filter((e) => e.zones.includes(zone))
// แถวบนจอกว้าง — โซนในแถวเดียวกันวางคู่กัน (lg ขึ้นไป) · แถวที่เหลือโซนเดียวกินเต็มแถว
const ZONE_ROWS = [['decision', 'schedule'], ['service'], ['area', 'report']]

// ───────────────────────── ① รอท่านลงนาม ─────────────────────────

function DecisionZone({ entries, tenantId, profileId }) {
  const esignEntry = entries.find((e) => e.key === 'src:esign')
  const kpi = esignEntry?.kpis.find((k) => k.id === 'my_pending' && isPhaseLive(k.phase))
  const rpc = useHomeRpc({ rpc: 'esign_my_pending', args: {}, tenantId, profileId, enabled: Boolean(profileId) })
  const pending = esignPendingFromRpc(rpc)
  // ลงนามใบสุดท้ายแล้วรายการว่าง — เก็บส่วนนี้ไว้จนกว่าจะออกจากหน้า ให้ข้อความ "ลงนามแล้ว" ยังอยู่ (แบบเดียวกับหน้าแรกเจ้าหน้าที่)
  const [touched, setTouched] = useState(false)
  const [showFormula, setShowFormula] = useState(false)
  const total = pending.items.length + pending.returned.length

  const clear = pending.status === 'ok' && total === 0 && !touched
  const infoButton = kpi && <InfoButton active={showFormula} onClick={() => setShowFormula((v) => !v)} label={kpi.label} />

  return (
    <ExecSection id="decision" title="รอท่านลงนาม" Icon={FileSignature} note="ลงนามออนไลน์เปิดใช้กับใบขอใช้รถ" aside={infoButton}>
      {/* ไม่มีเรื่อง = กล่องเขียวกล่องเดียว (ไม่ต้องมีเลข 0 ซ้ำอีกกล่อง) · มีเรื่อง = เลขใหญ่สีส้ม + รายการเดิม */}
      {clear ? (
        <div data-exec-esign-clear className="flex min-h-14 items-center gap-2.5 rounded-2xl border border-emerald-200 bg-white px-3 py-2 text-sm font-bold text-emerald-800 shadow-sm">
          <CheckCircle2 size={22} className="shrink-0 text-emerald-600" aria-hidden="true" />
          <span className="min-w-0 flex-1">ไม่มีเอกสารรอท่านลงนาม</span>
          <span data-exec-esign-count className="sr-only">0 ใบ</span>
        </div>
      ) : (
        <div className="flex min-h-14 items-center gap-2 rounded-2xl border border-amber-200 bg-white px-3 py-2 shadow-sm">
          <span className="min-w-0 flex-1 text-sm font-bold text-slate-700">{kpi?.label ?? 'เอกสารรอท่านลงนาม'}</span>
          <span data-exec-esign-count className={`text-3xl font-black tabular-nums ${total > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
            {pending.status === 'ok' ? total : '–'}<span className="sr-only"> ใบ</span>
          </span>
        </div>
      )}
      {showFormula && kpi && <FormulaPanel title={kpi.label} items={[{ who: esignEntry.label, formula: kpi.formula, source: kpi.source }]} />}

      {pending.status === 'loading' && <LoadingLine text="กำลังตรวจรายการรอลงนาม…" />}
      {/* ดึงไม่ได้ต้องไม่ขึ้นว่า "ไม่มีเรื่องรอท่าน" — อาจมีใบรออยู่ · MyPendingSignatures วาดสถานะ error + ปุ่มลองใหม่ให้เอง */}
      <MyPendingSignatures variant="home" status={pending.status} items={pending.items} returned={pending.returned} limit={5}
        moreHint="ที่เหลือดูได้ที่ ยานพาหนะและเชื้อเพลิง › การใช้รถ"
        onSigned={() => { setTouched(true); rpc.reload() }} onRetry={rpc.reload} />
    </ExecSection>
  )
}

// ───────────────────────── ④ กำหนดการ ─────────────────────────

function ScheduleZone({ entries, tenantId, profileId, resolveLink }) {
  const eventsEntry = entries.find((e) => e.key === 'events') ?? null
  const summary = useHomeRpc({ rpc: 'staff_home_summary', tenantId, profileId, enabled: Boolean(eventsEntry && profileId) })
  const open = eventsEntry ? resolveLink(eventsEntry) : null
  const myEvents = groupMyEvents(summary.status === 'ok' ? summary.data?.my_events : [], summary.data?.today)
  const count = myEvents.today.length + myEvents.tomorrow.length

  return (
    <ExecSection id="schedule" title="กำหนดการ" Icon={CalendarClock}>
      {summary.status === 'loading' && <LoadingLine text="กำลังโหลดกำหนดการ…" />}
      {summary.status === 'error' && <SectionError text="โหลดกำหนดการไม่ได้" onRetry={summary.reload} />}
      {summary.status === 'ok' && count > 0 && (
        <div className="rounded-2xl border border-emerald-100 bg-white p-2.5 shadow-sm">
          <AssignedEventsSection myEvents={myEvents} onOpen={open ?? undefined} showHeading={false} />
        </div>
      )}
      {summary.status === 'ok' && count === 0 && (
        <p data-exec-schedule-empty className="flex min-h-14 items-center rounded-2xl border border-emerald-100 bg-white px-3 py-2 text-sm text-slate-600 shadow-sm">
          ไม่มีกิจกรรมที่มอบหมายให้ท่านวันนี้หรือพรุ่งนี้
        </p>
      )}
      {open && (
        <button type="button" onClick={open}
          className="flex min-h-11 w-full items-center gap-2 rounded-2xl border border-emerald-200 bg-white px-3 py-2 text-left text-sm font-bold text-emerald-800 shadow-sm hover:bg-emerald-50 active:scale-[0.99]">
          <CalendarClock size={16} className="shrink-0 text-emerald-600" aria-hidden="true" />
          <span className="min-w-0 flex-1">เปิดปฏิทินกิจกรรม</span>
          <ChevronRight size={15} className="shrink-0 text-slate-300" aria-hidden="true" />
        </button>
      )}
    </ExecSection>
  )
}

// ───────────────────────── ⑦ พื้นที่ / ⑧ รายงาน (ไทล์ลิงก์) ─────────────────────────

// สีไอคอนในไทล์ตามโซน (ชื่อคลาสเต็ม — Tailwind ไม่สแกนคลาสที่ประกอบจากตัวแปร)
const TILE_ICON_TONE = { area: 'bg-teal-100 text-teal-700', report: 'bg-violet-100 text-violet-700' }

function Tile({ Icon, label, sub, onClick, testId, tone }) {
  return (
    <button type="button" data-exec-tile={testId} onClick={onClick}
      className="flex min-h-14 items-center gap-3 rounded-2xl border border-white bg-white px-3 py-2 text-left shadow-sm hover:bg-slate-50 active:scale-[0.99]">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${TILE_ICON_TONE[tone] ?? 'bg-slate-100 text-slate-600'}`}><Icon size={19} aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-slate-800">{label}</span>
        {sub && <span className="block truncate text-[11px] text-slate-500">{sub}</span>}
      </span>
      <ChevronRight size={16} className="shrink-0 text-slate-300" aria-hidden="true" />
    </button>
  )
}

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

function ReportZone({ entries, navigate }) {
  const seen = new Set()
  const reports = entries.flatMap((e) => (e.reports ?? [])
    .filter((r) => isPhaseLive(r.phase))
    .map((r) => ({ ...r, ownerLabel: e.label })))
    .filter((r) => { const k = `${r.path}|${r.label}`; if (seen.has(k)) return false; seen.add(k); return true })
  if (reports.length === 0) return null
  return (
    <ExecSection id="report" title={zoneTitle('report')} Icon={FileText}>
      <div className="grid gap-2 sm:grid-cols-2">
        {reports.map((r) => (
          <Tile key={`${r.path}|${r.id}`} testId={r.id} tone="report" Icon={FileText} label={r.label} sub={r.ownerLabel} onClick={() => navigate(r.path)} />
        ))}
      </div>
    </ExecSection>
  )
}

// ───────────────────────── หน้าหลัก ─────────────────────────

/**
 * @param {{
 *   visibleGroups: Array,        // เมนูที่บัญชีนี้เห็นจริง (visibleHomeGroups ของ StaffDashboard) — ใช้เปิดโมดูลให้ตรงกับเมนู
 *   setActiveModule: (key: string) => void,
 *   navigate: (path: string) => void,
 *   profile: object|null,
 *   tenant: object|null,
 *   isModuleEnabled: (key: string) => boolean,   // ตัวเดียวกับที่กรองเมนูจริงของหน้าเจ้าหน้าที่
 * }} props
 */
export default function ExecutiveHome({ visibleGroups = [], setActiveModule, navigate, profile, tenant, isModuleEnabled }) {
  const tenantId = tenant?.id
  const profileId = profile?.id
  const [openedAt] = useState(() => new Date())
  const todayTH = openedAt.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const entries = liveEntries(isModuleEnabled)

  const itemByKey = new Map(visibleGroups.flatMap((g) => g.items).map((item) => [item.key, item]))
  // ลิงก์ของรายการ → ฟังก์ชันเปิด · null = บัญชีนี้ไม่มีทางเปิด (โมดูลไม่อยู่ในเมนูที่เห็น) จึงไม่ทำเป็นปุ่มหลอก
  const resolveLink = (entry) => {
    const link = entry?.link
    if (!link) return null
    const item = link.module ? itemByKey.get(link.module) : null
    if (item) {
      return () => {
        if (item.newTab) window.open(item.newTab, '_blank', 'noopener,noreferrer')
        else if (item.externalUrl) navigate(item.externalUrl)
        else setActiveModule(item.key)
      }
    }
    if (link.path) return () => navigate(link.path)
    return null
  }

  const renderers = {
    decision: () => <DecisionZone key="decision" entries={entries} tenantId={tenantId} profileId={profileId} />,
    service: () => (
      <ExecServiceZone key="service" entries={inZone(entries, 'service')} tenant={tenant} profileId={profileId}
        isModuleEnabled={isModuleEnabled} resolveLink={resolveLink} />
    ),
    schedule: () => <ScheduleZone key="schedule" entries={entries} tenantId={tenantId} profileId={profileId} resolveLink={resolveLink} />,
    area: () => <AreaZone key="area" entries={entries} resolveLink={resolveLink} />,
    report: () => <ReportZone key="report" entries={entries} navigate={navigate} />,
  }

  // โซนที่ขึ้นจอได้: เรียงตามทะเบียน (EXEC_ZONES) เฉพาะโซนที่มีรายการ live และมีตัววาดแล้วในเฟสนี้
  const shown = Object.keys(EXEC_ZONES).filter((zone) => renderers[zone] && inZone(entries, zone).length > 0)
  // จัดแถวบนจอกว้าง (lg) ให้เป็นสัดส่วน: เรื่องของท่าน (ลงนาม|กำหนดการ) → บริการประชาชนเต็มแถว → พื้นที่|รายงาน
  // มือถือเรียงลงตามลำดับเดิม · โซนที่ไม่อยู่ใน ZONE_ROWS (เฟสหลัง) ต่อท้ายเต็มแถวเอง ไม่หายเงียบ
  const rows = [...ZONE_ROWS.map((row) => row.filter((z) => shown.includes(z))), ...shown.filter((z) => !ZONE_ROWS.flat().includes(z)).map((z) => [z])]
    .filter((row) => row.length > 0)

  return (
    <div data-exec-home className="space-y-4">
      <header className="min-w-0 rounded-3xl bg-gradient-to-br from-sky-800 to-indigo-800 px-4 py-3.5 text-white shadow-sm">
        <div className="flex items-center gap-2">
          <LayoutDashboard size={20} className="shrink-0 text-sky-200" aria-hidden="true" />
          <h1 className="truncate text-xl font-black">ห้องผู้บริหาร</h1>
        </div>
        <p className="mt-0.5 truncate text-xs text-sky-100">{[tenant?.name, todayTH].filter(Boolean).join(' · ')}</p>
      </header>
      {rows.map((row) => (
        <div key={row.join('|')} className={row.length > 1 ? 'grid items-start gap-4 lg:grid-cols-2' : ''}>
          {row.map((zone) => renderers[zone]())}
        </div>
      ))}
    </div>
  )
}
