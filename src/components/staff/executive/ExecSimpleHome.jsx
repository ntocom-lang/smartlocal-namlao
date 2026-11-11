import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bell, CalendarDays, CheckCircle2, Clock, Droplets, FileText, Inbox, PenLine, Star, Users } from 'lucide-react'
import { liveEntries } from '../../../lib/executiveRegistry'
import { addDays } from '../../../lib/complaintReportPeriods'
import {
  buildAlerts, buildDecisionQueue, deriveExec, esignWaitingFromRpc, execNf, execPeriodRange, execRangeText, execSummaryKeys, execToday, waitText,
} from '../../../lib/executiveData'
import { esignPendingFromRpc } from '../../../lib/esign'
import { canNudgeItems, itemStatusLabel } from '../../../lib/execFollowNudgeHelpers'
import {
  EXEC_SIMPLE_SKIP_SUMMARY_KEYS, bangkokClock, isRefreshWindow, markNewAlerts, mergeSimpleSchedule, nextEventInfo, readSessionJson,
  saveSimpleScroll, simpleAlertWords, simpleOverdueWhat, simpleServiceNumbers, splitSimpleAlerts, takeSimpleScroll, writeSessionJson,
} from '../../../lib/execSimpleView'
import { STAFF_MENU_TARGETS } from '../../../lib/staffMenuAccess'
import { useHomeRpc } from '../../../lib/staffHomeData'
import { groupMyEvents } from '../../../lib/staffHomeSummary'
import { useTenant } from '../../../contexts/TenantContext'
import useExecAutoRefresh from '../../../hooks/useExecAutoRefresh'
import { useExecOverview } from '../../../hooks/useExecOverview'
import { useExecRpc } from '../../../hooks/useExecRpc'
import { useExecSchedule } from '../../../hooks/useExecExtras'
import useExecSimpleFollows from '../../../hooks/useExecSimpleFollows'
import { useMyPositionCategory } from '../../../hooks/useMyPositionCategory'
import ExecSimpleSign, { SignNotice } from './ExecSimpleSign'
import { FollowItems, MinorItems, OverdueItems, RatingSources } from './ExecSimpleLists'
import { AlertBlock, Expandable, Flag, LabelNumber, LoadFail, Loading, Mini, OpenBtn, Row, SimpleCard } from './ExecSimpleParts'

// "ห้องผู้บริหารแบบเรียบ" — หน้าเดียวสำหรับนายก/รองนายก (เจ้าของระบบอนุมัติแผน 2026-11-11) ตอบคำถามเดียว: "วันนี้มีอะไรต้องทำ หรือต้องรู้ไหม"
// 4 หัวข้อ ตำแหน่งคงที่ทุกวัน: ① เรื่องรอท่าน ② เรื่องที่ควรรู้ ③ งานบริการประชาชนเดือนนี้ ④ กำหนดการวันนี้+พรุ่งนี้ (+ ปุ่ม "แดชบอร์ดสำหรับผู้บริหารแบบครบทั้งหมด")
// ไม่มีอะไรผิดปกติ = บรรทัดเขียว "ไม่มี…" ในที่เดิม (หัวข้อไม่หาย)
// ข้อมูลทุกอย่างมาจากฮุก/ฟังก์ชันชุดเดียวกับหน้าแบบเต็ม (ExecutiveHome) — ไม่มี RPC/SQL ใหม่ ตัวเลขสองหน้าต้องตรงกันเสมอ
//   executive_overview ช่วง "เดือนนี้" ช่วงเดียว (ไม่ขอช่วงก่อนหน้า/ไม่ขอคีย์รายกอง-รถผู้ป่วย) · exec_my_esign_waiting · esign_my_pending · staff_home_summary · list_events_for_staff_between · exec_my_follows
// อัปเดตเองทุก 5 นาที (useExecAutoRefresh: เฉพาะแท็บที่มองเห็น + 06:00–20:00 น. เวลาไทย) แบบเงียบ จอไม่กระพริบ · ดึงพลาด = คงตัวเลขเดิม + ป้ายเทา "ยังอัปเดตไม่ได้"
// ข้อห้าม: ไม่มีปุ่มอนุมัติของตัวเอง (ลงนามในหน้าต่างเดิม) · ไม่แสดงชื่อผู้ร้อง/ผู้ประเมิน/ข้อความอิสระ (PDPA)
//   · ไม่อ่านตารางคำร้อง/คำขอตรงๆ · ตัวเลขอ่านไม่ได้ = "—" / "โหลดไม่ได้ + ลองใหม่" ห้ามเป็น 0 หรือ "ไม่มีเรื่อง" ลวงๆ
// ⚠️ ไม่ได้ต่อ useExecPlanProgress (ผลดำเนินการตามแผนรายการ) — สัญญาณเตือน local-plan:result_missing จึงไม่ขึ้นในแบบเรียบ (อยู่ครบในหน้ารายละเอียด) เพื่อไม่เพิ่มการดึงข้อมูลหนักทุก 5 นาที

const NOW_TICK_MS = 30_000

// "พฤหัสบดี 12 พ.ย." ของวันที่ไทย (YYYY-MM-DD) — ตัดคำว่า "วัน" หน้าชื่อวันออกให้สั้น
const thaiDayShort = (iso) => {
  const d = new Date(`${iso}T00:00:00+07:00`)
  if (Number.isNaN(d.getTime())) return iso
  const weekday = d.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'long' }).replace(/^วัน/, '')
  return `${weekday} ${d.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' })}`
}

const thaiLongDate = (now) => now.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

// ตารางประกอบข้อความเวลา "ล่าสุด" — เวลาที่ได้ผลสำเร็จเก่าสุดในบรรดาข้อมูลที่หน้านี้ใช้ (ไม่โชว์ว่าสดกว่าความจริง)
const oldest = (list) => {
  const known = list.filter((n) => Number.isFinite(n))
  return known.length > 0 ? Math.min(...known) : null
}

/**
 * @param {{
 *   scopedKeys: string[], navigate: (path: string, options?: object) => void, profile: object|null, tenant: object|null,
 *   isModuleEnabled: (key: string) => boolean, tenantModuleEnabled: (key: string) => boolean,
 * }} props  ชุดเดียวกับ ExecutiveHome
 */
export default function ExecSimpleHome({ scopedKeys = [], navigate, profile, tenant, isModuleEnabled, tenantModuleEnabled }) {
  const { holidaysVersion } = useTenant()
  const tenantId = tenant?.id
  const profileId = profile?.id
  // นาฬิกาในเครื่อง (ไม่ดึงข้อมูล) — ใช้แสดงเวลา + "ถัดไป · อีก N นาที" + ตัดสินว่านอกเวลาอัปเดตไหม
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), NOW_TICK_MS)
    return () => window.clearInterval(timer)
  }, [])
  const todayLocal = execToday(now)
  // ช่วง "เดือนนี้" ผูกกับวันที่ไทยของนาฬิกา: เปิดข้ามเที่ยงคืนตอนสิ้นเดือน ช่วงจะขยับเอง (ไม่ค้างเดือนเก่า)
  const range = useMemo(() => execPeriodRange('month', new Date(`${todayLocal}T12:00:00+07:00`)), [todayLocal])

  const hasEsign = tenantModuleEnabled('fleet')
  const entries = useMemo(
    () => liveEntries(isModuleEnabled).filter((e) => e.key !== 'src:esign' || hasEsign),
    [isModuleEnabled, hasEsign],
  )
  const keys = useMemo(() => execSummaryKeys(entries).filter((k) => !EXEC_SIMPLE_SKIP_SUMMARY_KEYS.includes(k)), [entries])
  const cur = useExecOverview({ tenantId, profileId, range, keys, enabled: true })
  const today = cur.today ?? todayLocal
  const derived = useMemo(() => { void holidaysVersion; return deriveExec({ model: cur.model, today }) }, [cur.model, today, holidaysVersion])
  const queue = useMemo(() => { void holidaysVersion; return buildDecisionQueue({ entries, model: cur.model, today }) }, [entries, cur.model, today, holidaysVersion])

  // ใบรอลงนาม: จำนวน/รายการ (esign_my_pending) + "รอท่านเกิน 2 วันทำการ" (exec_my_esign_waiting) — ชุดเดียวกับหน้าแบบเต็ม
  const esignEntry = entries.find((e) => e.key === 'src:esign') ?? null
  const hasEsignAlert = Boolean(esignEntry?.alerts.some((a) => a.id === 'waiting_2wd'))
  const pendingRpc = useHomeRpc({ rpc: 'esign_my_pending', args: {}, tenantId, profileId, enabled: Boolean(profileId && esignEntry) })
  const pending = esignPendingFromRpc(pendingRpc)
  const esignRpc = useExecRpc({ rpc: 'exec_my_esign_waiting', args: { _municipality_id: tenantId }, tenantId, profileId, enabled: hasEsignAlert })
  const esignWaiting = esignRpc.status === 'ok' ? esignWaitingFromRpc(esignRpc.data) : null
  const esignFailed = hasEsignAlert && (esignRpc.status === 'error' || (esignRpc.status === 'ok' && !esignWaiting))

  const alerts = useMemo(() => {
    void holidaysVersion
    return buildAlerts({ entries, model: cur.model, today, resultMissing: 0, esignWaiting })
  }, [entries, cur.model, today, holidaysVersion, esignWaiting])
  const split = useMemo(() => splitSimpleAlerts(alerts.items), [alerts.items])
  const numbers = useMemo(() => simpleServiceNumbers(cur.model, derived), [cur.model, derived])

  // ป้าย "ใหม่ HH:MM" (1 ชั่วโมง): เทียบกับรอบก่อนที่จำไว้ใน sessionStorage — เวลาที่ติดป้ายคือเวลาที่ได้ข้อมูลรอบนั้น
  const newKey = tenantId && profileId ? `exec-simple-new:${tenantId}:${profileId}` : null
  const marked = useMemo(() => {
    if (!newKey || cur.status !== 'ok' || cur.fetchedAt == null) return null
    return markNewAlerts(readSessionJson(newKey), alerts.items, new Date(cur.fetchedAt))
  }, [newKey, cur.status, cur.fetchedAt, alerts.items])
  useEffect(() => { if (marked && newKey) writeSessionJson(newKey, marked.snapshot) }, [marked, newKey])
  const newLabel = (ids) => {
    const times = ids.map((id) => marked?.snapshot.marks[id]).filter((t) => Number.isFinite(t))
    return times.length > 0 ? bangkokClock(Math.max(...times)) : null
  }

  // กำหนดการวันนี้ + พรุ่งนี้: ปฏิทิน/รายการส่วนตัว (7 วัน) + กิจกรรมที่มอบหมายให้ท่าน
  const eventsEntry = entries.find((e) => e.key === 'events') ?? null
  const summary = useHomeRpc({ rpc: 'staff_home_summary', tenantId, profileId, enabled: Boolean(eventsEntry && profileId) })
  const week = useExecSchedule({ tenantId, profileId, role: profile?.role, enabled: Boolean(eventsEntry && profileId) })
  const summaryData = summary.status === 'ok' ? summary.data : null
  const myEvents = useMemo(() => groupMyEvents(summaryData?.my_events, summaryData?.today ?? today), [summaryData, today])
  const schedule = useMemo(() => mergeSimpleSchedule({ events: week.status === 'ok' ? week.events : [], myEvents, today }), [week.status, week.events, myEvents, today])
  const next = nextEventInfo(schedule.all, now)

  // เรื่องที่ท่านติดตาม (exec_my_follows) — เฉพาะ อปท. ที่มีคำร้อง/คำขอ
  const hasCitizenService = entries.some((e) => e.key === 'complaints' || e.isCitizenService)
  const [tick, setTick] = useState(0)
  const follows = useExecSimpleFollows({ tenantId, enabled: hasCitizenService, tick })
  const changedFollows = follows.rows.filter((r) => r.changed && r.hidden !== true && r.gone !== true)

  // อัปเดตเอง: ทุกฮุกที่หน้านี้ใช้ ดึงใหม่แบบเงียบ (ไม่ตั้ง 'loading') · tick ปลุกรายการที่กางอยู่ (ช้าเกิน 5 วัน / ติดตาม) ให้โหลดใหม่ด้วย
  const { refresh: refreshOverview, reload: reloadOverview } = cur
  const { refresh: refreshEsignRpc, reload: reloadEsignRpc } = esignRpc
  const { reload: reloadPending } = pendingRpc
  const { reload: reloadSummary } = summary
  const { refresh: refreshWeek, reload: reloadWeek } = week
  const refreshAll = useCallback(() => {
    refreshOverview(); refreshEsignRpc(); reloadPending(); reloadSummary(); refreshWeek()
    setTick((t) => t + 1)
  }, [refreshOverview, refreshEsignRpc, reloadPending, reloadSummary, refreshWeek])
  useExecAutoRefresh({ refresh: refreshAll })

  const stale = cur.stale || esignRpc.stale || pendingRpc.stale || summary.stale || week.stale || follows.stale
  const lastAt = oldest([cur.fetchedAt, hasEsignAlert ? esignRpc.fetchedAt : null, esignEntry ? pendingRpc.fetchedAt : null,
    eventsEntry ? summary.fetchedAt : null, eventsEntry ? week.fetchedAt : null, hasCitizenService ? follows.fetchedAt : null])
  const paused = !isRefreshWindow(now)

  // ── ไปหน้าอื่น: จำตำแหน่งเลื่อน + ส่ง state ให้แถบ "‹ กลับห้องผู้บริหาร" (ExecBackBar) รู้ว่ามาจากห้องนี้ ──
  // ⚠️ StaffDashboard อ่าน location.state.module ตอนเปิดหน้า — ส่ง { module, fromExec } ไม่ทับของเดิม · ไม่เปิดแท็บใหม่
  const leave = useCallback((path, state) => {
    saveSimpleScroll(document.querySelector('main')?.scrollTop ?? 0)
    navigate(path, { state: { ...(state ?? {}), fromExec: true, execReturnIdx: window.history.state?.idx ?? null } })
  }, [navigate])
  const resolveLink = (entry) => {
    const link = entry?.link
    if (!link) return null
    if (link.module && scopedKeys.includes(link.module)) {
      const target = STAFF_MENU_TARGETS[link.module]
      if (target?.newTab) return null // เอกสารคงที่เปิดแท็บใหม่ — แบบเรียบไม่เปิดแท็บใหม่ (ไม่ทำเป็นปุ่มหลอก)
      if (target?.externalUrl) return () => leave(target.externalUrl)
      return () => leave('/staff', { module: link.module })
    }
    if (link.path) return () => leave(link.path)
    return null
  }
  const eventsLink = resolveLink(eventsEntry)
  const satisfactionLink = resolveLink(entries.find((e) => e.key === 'src:satisfaction'))

  // เลื่อนจอคืนตำแหน่งเดิม: ครั้งเดียว หลังข้อมูลชุดแรกขึ้น (กลับจากหน้าอื่นด้วยแถบกลับ/ปุ่มย้อนกลับ)
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current || cur.status !== 'ok') return
    restoredRef.current = true
    const y = takeSimpleScroll()
    if (y != null) window.requestAnimationFrame(() => document.querySelector('main')?.scrollTo({ top: y }))
  }, [cur.status])

  // ปุ่มเร่งกอง: ตัดสินสิทธิ์จาก role + ตำแหน่ง (ชุดเดียวกับหน้าแบบเต็ม) — ฐานข้อมูลตรวจซ้ำเสมอ · ยังไม่รู้ตำแหน่ง = ไม่แสดงปุ่ม
  const { category, ready } = useMyPositionCategory(profile)
  const canNudge = canNudgeItems({ role: profile?.role, positionCategory: ready ? category : null, tenantSlug: tenant?.slug })

  const [notice, setNotice] = useState(null)
  const afterSigned = useCallback(() => { reloadPending(); reloadEsignRpc(); refreshOverview() }, [reloadPending, reloadEsignRpc, refreshOverview])

  // ───────── ① เรื่องรอท่าน ─────────
  const signTotal = pending.items.length + pending.returned.length
  const ovOk = cur.status === 'ok'
  const calm1 = ovOk && (!esignEntry || (pending.status === 'ok' && signTotal === 0 && !esignFailed)) && queue.items.length === 0 && queue.failures.length === 0
  const over2wd = esignWaiting?.over2wd ?? 0
  // แถวใบรอลงนามขึ้นเมื่อมีอะไรให้บอก (กำลังโหลด/โหลดไม่ได้/มีใบรอ/ตรวจใบค้างนานไม่ได้) — ไม่มีใบรอเลย = ไม่มีแถว (บรรทัดเขียวของการ์ดบอกแทน)
  const showSignRow = Boolean(esignEntry) && (pending.status !== 'ok' || signTotal > 0 || esignFailed)

  // ───────── ② เรื่องที่ควรรู้ ─────────
  const lowView = derived.satisfaction
  const hasAny2 = Boolean(split.overdue5) || split.major.length > 0 || split.minor.length > 0
  const calm2 = ovOk && alerts.failures.length === 0 && !hasAny2
  const overdueNew = newLabel(['complaints:overdue_5wd', 'inbox:overdue_5wd'])

  // ───────── ③ ตัวเลขเดือนนี้ ─────────
  const nRec = numbers.received
  const sat = numbers.satisfaction

  const timeText = lastAt != null ? bangkokClock(lastAt) : null
  let statusText = 'กำลังโหลดข้อมูล…'
  if (timeText) {
    if (stale) statusText = `ยังอัปเดตไม่ได้ · ล่าสุด ${timeText} น.`
    else if (paused) statusText = `หยุดอัปเดตเองนอกเวลา 06:00–20:00 น. · ล่าสุด ${timeText} น.`
    else statusText = `อัปเดตเองทุก 5 นาที · ล่าสุด ${timeText} น.`
  }

  return (
    <div className="es-root" data-exec-simple>
      <header className="es-head">
        <div>
          <h1>{thaiLongDate(now)}</h1>
          <p>{tenant?.name}</p>
        </div>
        <div className="es-live" role="status" aria-label="เวลาและการอัปเดตข้อมูล" data-stale={stale ? 'true' : 'false'} data-paused={paused ? 'true' : 'false'}>
          <Clock className="es-icon" aria-hidden="true" />
          <div>
            <div className="es-clock" data-exec-simple-clock>{bangkokClock(now)} น.</div>
            <div className="es-st"><span className="es-dot" aria-hidden="true" /><span data-exec-simple-status>{statusText}</span></div>
          </div>
        </div>
      </header>

      {cur.status === 'forbidden' && (
        <Flag tone="gray" role="alert" data-exec-forbidden>บัญชีนี้ไม่มีสิทธิ์ดูตัวเลขสรุปของห้องผู้บริหาร จึงแสดงเฉพาะส่วนที่เปิดอ่านได้ — แจ้งผู้ดูแลระบบหากควรมีสิทธิ์</Flag>
      )}

      <div className="es-grid">
        {/* ① เรื่องรอท่าน */}
        <SimpleCard area="s1" id="s1" Icon={PenLine} title="เรื่องรอท่าน" calm={calm1}>
          <SignNotice notice={notice} />
          {showSignRow && (
            <Row data-exec-simple-sign>
              {pending.status === 'loading' && <Loading text="กำลังตรวจรายการเอกสารรอลงนาม…" />}
              {/* ดึงไม่ได้ต้องไม่ขึ้นว่า "ไม่มีเรื่องรอท่าน" — อาจมีใบรออยู่ */}
              {pending.status === 'error' && <LoadFail text="ตรวจรายการเอกสารรอลงนามไม่ได้ — อาจมีใบที่รอท่านอยู่" onRetry={reloadPending} />}
              {pending.status === 'ok' && (
                <>
                  <LabelNumber icon={<Mini tone="blue" Icon={PenLine} />} label="เอกสารรอท่านลงนาม" value={signTotal} unit="ฉบับ" data-exec-simple-sign-count />
                  {over2wd > 0 && <Flag tone="amber" data-exec-simple-sign-wait>ในนี้ {execNf(over2wd)} ฉบับ รอท่านมาเกิน 2 วันทำการแล้ว</Flag>}
                  {esignFailed && <LoadFail text="ตรวจใบที่รอท่านนานเกิน 2 วันทำการไม่ได้" onRetry={reloadEsignRpc} />}
                  {signTotal > 0 && (
                    <Expandable id="sign" closedText="ดูเอกสาร และลงนาม" openText="ซ่อนรายการเอกสาร">
                      {() => <ExecSimpleSign items={pending.items} returned={pending.returned} onSigned={afterSigned} onNotice={setNotice} />}
                    </Expandable>
                  )}
                </>
              )}
            </Row>
          )}
          {cur.status === 'loading' && <Row><Loading text="กำลังตรวจเรื่องรอท่านพิจารณา…" /></Row>}
          {cur.status === 'error' && <Row><LoadFail text="โหลดเรื่องรอท่านพิจารณาไม่ได้" onRetry={reloadOverview} /></Row>}
          {ovOk && queue.failures.length > 0 && (
            <Row><LoadFail text={`ตรวจเรื่องรอพิจารณาของ ${queue.failures.join(', ')} ไม่ได้ — อาจมีเรื่องค้างอยู่`} onRetry={reloadOverview} /></Row>
          )}
          {ovOk && queue.items.map((it) => {
            const go = resolveLink(it.entry)
            const wait = waitText(it.waitDays)
            return (
              <Row key={it.id} data-exec-simple-decision={it.id}>
                <LabelNumber icon={<Mini tone="sky" Icon={it.id.startsWith('water') ? Droplets : FileText} />} label={`${it.label}`} value={it.count} unit={it.unit} />
                {wait && <Flag tone={it.warn ? 'amber' : 'gray'}>{wait}{it.warn ? ' — เกิน 2 วันทำการ' : ''}</Flag>}
                {go && <OpenBtn onClick={go}>ไปดู</OpenBtn>}
              </Row>
            )
          })}
          {calm1 && <Flag tone="green" data-exec-simple-calm="s1">ไม่มีเรื่องรอท่าน</Flag>}
        </SimpleCard>

        {/* ② เรื่องที่ควรรู้ */}
        <SimpleCard area="s2" id="s2" Icon={Bell} title="เรื่องที่ควรรู้" calm={calm2}>
          {cur.status === 'loading' && <Loading text="กำลังตรวจเรื่องที่ควรรู้…" />}
          {cur.status === 'error' && <LoadFail text="โหลดเรื่องที่ควรรู้ไม่ได้" onRetry={reloadOverview} />}
          {cur.status === 'forbidden' && <Flag tone="gray">ไม่มีสิทธิ์ดูตัวเลขสรุปเรื่องที่ควรรู้</Flag>}
          {ovOk && (
            <>
              {alerts.failures.length > 0 && (
                <LoadFail text={`ตรวจสัญญาณเตือนของ ${alerts.failures.join(', ')} ไม่ได้ — อาจมีเรื่องที่ไม่แสดง`} onRetry={reloadOverview} />
              )}
              {split.overdue5 && (
                <AlertBlock tone="red" Icon={FileText} what={simpleOverdueWhat(split.overdue5)} count={split.overdue5.count} unit="เรื่อง"
                  newLabel={overdueNew} data-exec-simple-alert="overdue5">
                  <Expandable id="overdue" closedText="ดูรายการ และส่งให้กองเร่ง" openText="ซ่อนรายการ">
                    {() => <OverdueItems tenant={tenant} today={today} canNudge={canNudge} tick={tick} />}
                  </Expandable>
                </AlertBlock>
              )}
              {split.major.map((it) => {
                const w = simpleAlertWords(it)
                const go = resolveLink(it.entry)
                const isRating = it.id === 'complaints:low_rating'
                return (
                  <AlertBlock key={it.id} tone="amber" Icon={isRating ? Star : Droplets} what={w.what} count={it.count} unit={w.unit}
                    showCount={it.showCount} detail={it.showCount ? null : it.detail} newLabel={newLabel([it.id])} data-exec-simple-alert={it.id}>
                    {isRating && lowView ? (
                      <Expandable id="rating" closedText="ดูว่ามาจากไหน" openText="ซ่อน">
                        {() => <RatingSources low={lowView.low} onOpenSatisfaction={satisfactionLink} />}
                      </Expandable>
                    ) : go && <OpenBtn onClick={go}>{w.go}</OpenBtn>}
                  </AlertBlock>
                )
              })}
              {split.minor.length > 0 && (
                <div className="es-more" data-exec-simple-minor-summary>
                  มีเรื่องเล็กอีก {split.minor.length} เรื่อง ({[...new Set(split.minor.map((m) => m.entry?.label).filter(Boolean))].join(' / ')})
                  <Expandable id="minor" closedText={`ดูเรื่องเล็กอีก ${split.minor.length} เรื่อง`} openText="ซ่อนเรื่องเล็ก">
                    {() => <MinorItems items={split.minor} resolveLink={resolveLink} />}
                  </Expandable>
                </div>
              )}
              {calm2 && <Flag tone="green" data-exec-simple-calm="s2">ไม่มีเรื่องผิดปกติ</Flag>}
            </>
          )}

          {follows.status === 'error' && <div className="es-follow"><LoadFail text="โหลดเรื่องที่ท่านติดตามไม่ได้" onRetry={follows.reload} /></div>}
          {follows.status === 'ok' && follows.rows.length > 0 && (
            <div className="es-follow" data-exec-simple-follows>
              <div className="es-label">เรื่องที่ท่านติดตาม {follows.rows.length} เรื่อง</div>
              <div className="es-sub">
                {changedFollows.length === 0
                  ? 'ยังไม่มีความเคลื่อนไหว'
                  : `มีความเคลื่อนไหว ${changedFollows.length} เรื่อง: ${changedFollows[0].ref} ${changedFollows[0].open === false ? 'เสร็จ/ปิดแล้ว' : itemStatusLabel(changedFollows[0].k, changedFollows[0].s)}${changedFollows.length > 1 ? ` และอีก ${changedFollows.length - 1} เรื่อง` : ''}`}
              </div>
              <Expandable id="follow" closedText="ดูเรื่องที่ติดตาม" openText="ซ่อนเรื่องที่ติดตาม">
                {() => <FollowItems rows={follows.rows} tenant={tenant} />}
              </Expandable>
            </div>
          )}
        </SimpleCard>

        {/* ③ งานบริการประชาชน เดือนนี้ */}
        {hasCitizenService && (
          <SimpleCard area="s3" id="s3" Icon={Users} title="งานบริการประชาชน" small={`เดือนนี้ · ${execRangeText(range)}`}>
            {cur.status === 'loading' && <Loading text="กำลังโหลดตัวเลขเดือนนี้…" />}
            {cur.status === 'error' && <LoadFail text="โหลดตัวเลขงานบริการประชาชนไม่ได้" onRetry={reloadOverview} />}
            {cur.status === 'forbidden' && <Flag tone="gray">ไม่มีสิทธิ์ดูตัวเลขงานบริการประชาชน</Flag>}
            {ovOk && (
              <>
                <Row data-exec-simple-received>
                  <LabelNumber icon={<Mini tone="blue" Icon={Inbox} />} label="รับเรื่องเข้ามา" value={nRec.total} unit="เรื่อง" />
                  {nRec.state === 'error' && <LoadFail text="โหลดยอดรับเรื่องบางส่วนไม่ได้" onRetry={reloadOverview} />}
                  {nRec.state === 'ok' && (
                    <div className="es-sub">{[nRec.complaints != null && `คำร้อง ${execNf(nRec.complaints)}`, nRec.docs != null && `คำขอ ${execNf(nRec.docs)}`].filter(Boolean).join(' · ')}</div>
                  )}
                </Row>
                <Row data-exec-simple-ontime>
                  <div className="es-line"><span className="es-label"><Mini tone="green" Icon={CheckCircle2} />ทำเสร็จทันเวลา</span></div>
                  {[['complaints', 'คำร้อง'], ['docs', 'คำขอ']].filter(([k]) => numbers.onTime[k].state !== 'missing').map(([k, name]) => {
                    const o = numbers.onTime[k]
                    return (
                      <div key={k} className="es-side" data-exec-simple-ontime-side={k}>
                        {o.state === 'error' && <><div className="es-side-name">{name}</div><LoadFail text={`โหลด${name}ที่ทำเสร็จทันเวลาไม่ได้`} onRetry={reloadOverview} /></>}
                        {o.state === 'ok' && o.denominator > 0 && (
                          <>
                            <LabelNumber label={name} value={o.onTime} unit={`จาก ${execNf(o.denominator)} เรื่อง`} />
                            <div className="es-bar" role="img" aria-label={`${name} ทำเสร็จทันเวลา ${o.onTime} จาก ${o.denominator} เรื่อง`}><span style={{ width: `${Math.min(100, Math.max(0, o.pct ?? 0))}%` }} /></div>
                          </>
                        )}
                        {o.state === 'ok' && !(o.denominator > 0) && <><div className="es-side-name">{name}</div><div className="es-sub">— ยังไม่มีเรื่องครบกำหนดในเดือนนี้</div></>}
                      </div>
                    )
                  })}
                </Row>
                {sat.state !== 'missing' && (
                  <Row data-exec-simple-satisfaction>
                    <LabelNumber icon={<Mini tone="gold" Icon={Star} />} label="ประชาชนพอใจ" value={sat.avg} unit="จาก 5" />
                    {sat.state === 'error' && <LoadFail text="โหลดคะแนนความพึงพอใจไม่ได้" onRetry={reloadOverview} />}
                    {sat.state === 'ok' && sat.avg != null && (
                      <>
                        <div className="es-stars" role="img" aria-label={`${sat.avg} ดาว จาก 5`}>★★★★★<span style={{ width: `${Math.min(100, Math.max(0, (sat.avg / 5) * 100))}%` }}>★★★★★</span></div>
                        <div className="es-sub">จาก {execNf(sat.count)} คะแนนที่ประชาชนให้</div>
                      </>
                    )}
                    {sat.state === 'ok' && sat.avg == null && <div className="es-sub">— ยังไม่มีคะแนนจากประชาชนในเดือนนี้</div>}
                  </Row>
                )}
              </>
            )}
          </SimpleCard>
        )}

        {/* ④ กำหนดการ วันนี้ + พรุ่งนี้ */}
        <SimpleCard area="s4" id="s4" Icon={CalendarDays} title="กำหนดการ">
          <div className="es-sched">
            {!eventsEntry && <p className="es-note">หน่วยงานนี้ยังไม่ได้เปิดใช้ปฏิทินกิจกรรม</p>}
            {eventsEntry && week.status === 'loading' && summary.status !== 'ok' && <Loading text="กำลังโหลดกำหนดการ…" />}
            {eventsEntry && week.status === 'error' && <LoadFail text="โหลดกำหนดการไม่ได้" onRetry={() => { reloadWeek(); reloadSummary() }} />}
            {eventsEntry && week.status === 'ok' && summary.status === 'error' && (
              <LoadFail text="โหลดกิจกรรมที่มอบหมายให้ท่านไม่ได้ — กำหนดการด้านล่างอาจไม่ครบ" onRetry={reloadSummary} />
            )}
            {eventsEntry && (week.status === 'ok' || summary.status === 'ok') && (
              <>
                <h3>วันนี้</h3>
                {schedule.today.length === 0 && <p className="es-sub" style={{ margin: 0 }}>ไม่มีกำหนดการในระบบ</p>}
                {schedule.today.map((e) => <EventRow key={e.id} e={e} next={next?.id === e.id ? next.text : null} />)}
                <h3>พรุ่งนี้ · {thaiDayShort(addDays(today, 1))}</h3>
                {schedule.tomorrow.length === 0 && <p className="es-sub" style={{ margin: 0 }}>ไม่มีกำหนดการในระบบ</p>}
                {schedule.tomorrow.map((e) => <EventRow key={e.id} e={e} next={null} />)}
              </>
            )}
          </div>
          {eventsLink && <OpenBtn onClick={eventsLink}>เปิดปฏิทิน</OpenBtn>}
        </SimpleCard>

        {/* ท้ายหน้า: ไปหน้าแบบเต็ม (ตัวเลขละเอียด แยกกอง วิธีคิด) */}
        <section className="es-card es-foot es-a-dt" aria-label="ดูรายละเอียด">
          ต้องการตัวเลขละเอียด แยกกอง แยกหมู่บ้าน หรือวิธีคิดตัวเลข
          <OpenBtn onClick={() => navigate('/executive?view=full')} data-exec-simple-full>แดชบอร์ดสำหรับผู้บริหารแบบครบทั้งหมด</OpenBtn>
        </section>
      </div>
    </div>
  )
}

function EventRow({ e, next }) {
  return (
    <div className={`es-ev${next ? ' next' : ''}`} data-exec-simple-event>
      <span className={`t${e.time ? '' : ' allday'}`}>{e.time ?? 'ทั้งวัน'}</span>
      <span>{next && <span className="nx">{next}</span>}{e.title}</span>
    </div>
  )
}
