// ตรรกะของ "ห้องผู้บริหารแบบเรียบ" (หน้าเดียวสำหรับนายก) — ฟังก์ชันบริสุทธิ์ล้วน (ไม่ import React/supabase เทสต์ด้วย node ได้)
// ตัวเลขทุกตัวมาจาก model/derived ของ executiveData.js ชุดเดียวกับหน้าแบบเต็ม (ไม่มีสูตรใหม่ ไม่มี SQL ใหม่)
// ⇒ สองหน้าตัวเลขต้องตรงกันเสมอ · เทสต์: npm run test:exec-simple
// ข้อห้าม: ไม่มีชื่อผู้ร้อง/ผู้ประเมิน/ข้อความอิสระ (PDPA) · ค่าอ่านไม่ได้ (null/error) ต้องเป็น null เสมอ ห้ามกลายเป็น 0

import { execCount, upcomingEvents } from './executiveData.js'
import { addDays, bangkokIsoDate } from './complaintReportPeriods.js'

// ───────────────────────── ② เรื่องที่ควรรู้ ─────────────────────────

/**
 * สัญญาณเตือนที่ "สำคัญจริง" ของนายก (ตามแผนที่เจ้าของอนุมัติ 2026-11-11) — คีย์ = `${entry.key}:${alert.id}` ตรงกับ ALERT_RULES
 * ทุกตัวต้องอยู่ใน EXEC_ALERT_RULE_KEYS (เทสต์ตรวจ) ไม่งั้นแก้ชื่อกฎแล้วเรื่องหายเงียบ
 */
export const EXEC_SIMPLE_MAJOR_ALERTS = Object.freeze([
  'complaints:overdue_5wd',
  'inbox:overdue_5wd',
  'complaints:low_rating',
  'water-situation:event_open',
  'projects:contract_past',
  'projects:behind',
  'local-plan:no_published_plan',
])

/** สองข้อนี้รวมเป็นแถวเดียว "ช้ากว่ากำหนดเกิน 5 วันทำการ" (คำร้อง + คำขอ) */
export const EXEC_SIMPLE_OVERDUE_IDS = Object.freeze(['complaints:overdue_5wd', 'inbox:overdue_5wd'])
/** ใบรอลงนามเกิน 2 วันทำการ ไปขึ้นใน ① (เรื่องรอท่าน) ไม่ขึ้นใน ② */
export const EXEC_SIMPLE_ESIGN_ALERT_ID = 'src:esign:waiting_2wd'
/** แถวเด่นใน ② ไม่เกินนี้ (ที่เหลือเป็น "เรื่องเล็ก" ไม่ซ่อนเงียบ) */
export const EXEC_SIMPLE_MAX_MAJOR = 3

/**
 * แยกสัญญาณเตือน (alerts.items ของ buildAlerts — เรียงความรุนแรงแล้ว) เป็นส่วนของ ②
 *   overdue5 = รวม complaints + inbox เป็นแถวเดียว (count รวม) · ไม่มี = null
 *   major    = แถวเด่นตามลำดับความรุนแรง ไม่เกิน 3 แถว (เฉพาะรายการในรายการสำคัญ ไม่รวมแถวช้า 5 วันทำการ)
 *   minor    = ที่เหลือทั้งหมด (นอกรายการสำคัญ + แถวสำคัญที่เกิน 3) — หน้าจอบอกจำนวน ไม่ซ่อนเงียบ
 *   esign    = ใบรอลงนามเกิน 2 วันทำการ (ไปขึ้น ①) · ไม่มี = null
 * @param {Array<{ id: string, count: number }>} items
 */
export function splitSimpleAlerts(items) {
  const list = Array.isArray(items) ? items.filter((it) => it && typeof it.id === 'string') : []
  const overdueItems = list.filter((it) => EXEC_SIMPLE_OVERDUE_IDS.includes(it.id))
  const overdue5 = overdueItems.length > 0
    ? { count: overdueItems.reduce((t, it) => t + execCount(it.count), 0), items: overdueItems }
    : null
  const esign = list.find((it) => it.id === EXEC_SIMPLE_ESIGN_ALERT_ID) ?? null
  const rest = list.filter((it) => !EXEC_SIMPLE_OVERDUE_IDS.includes(it.id) && it.id !== EXEC_SIMPLE_ESIGN_ALERT_ID)
  const majorPool = rest.filter((it) => EXEC_SIMPLE_MAJOR_ALERTS.includes(it.id))
  const major = majorPool.slice(0, EXEC_SIMPLE_MAX_MAJOR)
  const minor = rest.filter((it) => !major.includes(it))
  return { overdue5, major, minor, esign }
}

/**
 * ถ้อยคำภาษาคนของแถวเด่นใน ② (ทะเบียนใช้ถ้อยคำสั้นสำหรับ ⓘ เช่น "คะแนนประเมิน ≤ 2" — นายกอ่านแล้วไม่เข้าใจ)
 * what = ข้อความหัวแถว · unit = หน่วยใต้ตัวเลข · go = ปุ่มไปหน้าเดิม · ไม่มีในตาราง = ใช้ป้ายจากทะเบียน (เรื่องเล็ก)
 */
export const EXEC_SIMPLE_ALERT_WORDS = Object.freeze({
  'complaints:low_rating': { what: 'ประชาชนให้คะแนนพอใจน้อย (1–2 ดาว) เดือนนี้', unit: 'ครั้ง', go: 'ดูว่ามาจากไหน' },
  'water-situation:event_open': { what: 'มีเหตุการณ์น้ำ–ฝน ที่ยังเฝ้าระวังอยู่', unit: 'เหตุการณ์', go: 'ดูสถานการณ์น้ำ' },
  'projects:contract_past': { what: 'โครงการก่อสร้างเลยวันสิ้นสุดสัญญาแล้ว', unit: 'โครงการ', go: 'ดูโครงการก่อสร้าง' },
  'projects:behind': { what: 'โครงการก่อสร้างช้ากว่าแผน', unit: 'โครงการ', go: 'ดูโครงการก่อสร้าง' },
  'local-plan:no_published_plan': { what: 'ปีงบนี้ยังไม่ประกาศแผนการดำเนินงาน', unit: '', go: 'ดูแผนพัฒนา' },
})

/** ข้อความของแถว ② จากสัญญาณเตือน 1 ข้อ (ตารางข้างบน หรือป้ายจากทะเบียนถ้าไม่อยู่ในตาราง) */
export function simpleAlertWords(item) {
  const w = EXEC_SIMPLE_ALERT_WORDS[item?.id]
  return w ?? { what: item?.label ?? '', unit: item?.unit ?? '', go: `ดู${item?.entry?.label ?? 'รายละเอียด'}` }
}

/** คีย์สรุปที่แบบเรียบไม่ใช้ (ไม่มีอะไรในหน้านี้อ่านรายกอง/รถรับส่งผู้ป่วย) — ไม่ขอจากฐานข้อมูลเพื่อลด Egress ของแผนฟรี */
export const EXEC_SIMPLE_SKIP_SUMMARY_KEYS = Object.freeze(['departments', 'patient_transport'])

// ───────────────────────── ③ งานบริการประชาชนเดือนนี้ ─────────────────────────

const stateOf = (model, field) => model?.[field]?.state ?? 'missing'

/**
 * ตัวเลข 3 ตัวของ ③ — รับ model (buildExecModel) + derived (deriveExec) ของช่วง "เดือนนี้"
 *   received  : รับเรื่องเข้ามา = คำร้อง (period.total) + คำขอ (ผลรวม by_type.total) · ฝั่งไหนโหลดไม่ได้ = ทั้งยอดเป็น null (ไม่รวมแค่ครึ่งเดียว)
 *               โมดูลปิด (missing) = ไม่นับฝั่งนั้น
 *   onTime    : แยก คำร้อง / คำขอ — ไม่รวมตัวหาร (เจ้าของระบบตัดสิน 2569-11-10: คำร้องนับวันทำการ คำขอนับวันปฏิทิน)
 *               แต่ละฝั่ง { onTime, denominator, pct } · pct null = ยังไม่มีเรื่องครบกำหนด (แสดงเป็นข้อความ ไม่ใช่ 0%)
 *   satisfaction : ค่าเดียวกับการ์ดหน้าเต็ม (เสียงผู้รับบริการตัวจริง genuineAvg) · ไม่มีคะแนน = avg null
 * state ของแต่ละส่วน: 'ok' | 'error' (โหลดไม่ได้) | 'missing' (โมดูลปิด/ไม่ได้ขอ)
 * @returns {{
 *   received: { state: string, total: number|null, complaints: number|null, docs: number|null },
 *   onTime: { complaints: { state: string, onTime: number|null, denominator: number|null, pct: number|null }, docs: { state: string, onTime: number|null, denominator: number|null, pct: number|null } },
 *   satisfaction: { state: string, avg: number|null, count: number|null },
 * }}
 */
export function simpleServiceNumbers(model, derived) {
  const cState = stateOf(model, 'complaints')
  const dState = stateOf(model, 'docRequests')
  const sState = stateOf(model, 'satisfaction')

  const complaints = cState === 'ok' ? execCount(model.complaints.data?.period?.total) : null
  const docs = dState === 'ok'
    ? (model.docRequests.data?.byType ?? []).reduce((t, r) => t + execCount(r?.total), 0)
    : null
  const anyError = cState === 'error' || dState === 'error'
  const anyOk = cState === 'ok' || dState === 'ok'
  const receivedState = anyError ? 'error' : (anyOk ? 'ok' : 'missing')
  const total = receivedState === 'ok' ? (complaints ?? 0) + (docs ?? 0) : null

  const side = (state, o) => {
    if (state !== 'ok' || !o) return { state: state === 'ok' ? 'error' : state, onTime: null, denominator: null, pct: null }
    return { state: 'ok', onTime: o.onTime, denominator: o.denominator, pct: o.pct }
  }
  const sat = derived?.satisfaction
  const satisfaction = sState !== 'ok' || !sat
    ? { state: sState === 'ok' ? 'error' : sState, avg: null, count: null }
    : { state: 'ok', avg: sat.genuineAvg, count: sat.genuineCnt }

  return {
    received: { state: receivedState, total, complaints, docs },
    onTime: { complaints: side(cState, derived?.complaintOnTime), docs: side(dState, derived?.docOnTime) },
    satisfaction,
  }
}

// ───────────────────────── เวลา (Asia/Bangkok ไม่พึ่งโซนเครื่อง) ─────────────────────────

/** รอบอัปเดตเอง 5 นาที */
export const EXEC_SIMPLE_REFRESH_MS = 5 * 60 * 1000

/** นาทีของวันตามเวลาไทย (0–1439) — ไทยไม่มี DST จึงเป็น UTC+7 ตายตัว */
export function bangkokMinutes(now = new Date()) {
  const ms = now instanceof Date ? now.getTime() : Number(now)
  return ((Math.floor(ms / 60000) + 7 * 60) % 1440 + 1440) % 1440
}

/** ช่วงที่อนุญาตให้อัปเดตเอง: 06:00 ≤ เวลาไทย < 20:00 (นอกช่วงนี้ไม่ดึง — Supabase แผนฟรี egress จำกัด) */
export function isRefreshWindow(now = new Date()) {
  const m = bangkokMinutes(now)
  return m >= 6 * 60 && m < 20 * 60
}

/** ถึงรอบอัปเดตเองไหม (รอบนาฬิกา): แท็บต้องมองเห็น และอยู่ในช่วง 06:00–20:00 */
export function canAutoRefresh({ now = new Date(), visible = true } = {}) {
  return visible === true && isRefreshWindow(now)
}

/** กลับมาที่แท็บแล้วควรดึงทันทีไหม: ข้อมูลเก่ากว่ารอบ (ค่าเริ่มต้น 5 นาที) + เงื่อนไขเดียวกับ canAutoRefresh */
export function shouldRefreshOnReturn({ now = new Date(), visible = true, lastAt, intervalMs = EXEC_SIMPLE_REFRESH_MS } = {}) {
  if (!canAutoRefresh({ now, visible })) return false
  const last = Number(lastAt)
  if (!Number.isFinite(last)) return true
  return (now instanceof Date ? now.getTime() : Number(now)) - last >= intervalMs
}

/** "HH:MM" เวลาไทยของเวลาใดๆ · ค่าเสีย = null */
export function bangkokClock(value) {
  const ms = value instanceof Date ? value.getTime() : Number(value)
  if (!Number.isFinite(ms)) return null
  const m = bangkokMinutes(ms)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/**
 * ข้อความ "ถัดไป · อีก N นาที" — จากกิจกรรม "วันนี้" ที่มีเวลาเท่านั้น (ทั้งวัน/ไม่มีเวลา ไม่นับ)
 * @param {Array<{ id: string, day: string, time: string|null }>} events  day = YYYY-MM-DD ไทย · time = HH:MM
 * @returns {{ id: string, minutes: number, text: string }|null}
 */
export function nextEventInfo(events, now = new Date()) {
  const today = bangkokIsoDate(now)
  const cur = bangkokMinutes(now)
  let best = null
  for (const ev of Array.isArray(events) ? events : []) {
    if (!ev || ev.day !== today || typeof ev.time !== 'string') continue
    const m = /^(\d{2}):(\d{2})/.exec(ev.time)
    if (!m) continue
    const at = Number(m[1]) * 60 + Number(m[2])
    if (at < cur) continue
    if (!best || at < best.at) best = { id: ev.id, at }
  }
  if (!best) return null
  const minutes = best.at - cur
  return { id: best.id, minutes, text: nextEventText(minutes) }
}

export function nextEventText(minutes) {
  if (minutes <= 0) return 'ถัดไป · ตอนนี้'
  if (minutes < 60) return `ถัดไป · อีก ${minutes} นาที`
  const h = Math.floor(minutes / 60)
  const r = minutes % 60
  return `ถัดไป · อีก ${h} ชั่วโมง${r > 0 ? ` ${r} นาที` : ''}`
}

// ───────────────────────── ④ กำหนดการวันนี้ + พรุ่งนี้ ─────────────────────────

/**
 * รวมกำหนดการวันนี้และพรุ่งนี้จาก 2 แหล่ง: ปฏิทิน (+รายการส่วนตัว) 7 วัน กับกิจกรรมที่มอบหมายให้ท่าน (staff_home_summary.my_events)
 * ตัดซ้ำด้วย id · เรียงเวลา (ไม่ระบุเวลาไว้ท้าย) · ไม่ส่งรายละเอียด/ผู้รับมอบหมาย/สถานที่ต่อ (เก็บเฉพาะชื่อ+เวลา)
 * @param {{ events: object[], myEvents: { today: object[], tomorrow: object[] }|null, today: string }} input
 * @returns {{ today: object[], tomorrow: object[], all: object[] }}
 */
export function mergeSimpleSchedule({ events, myEvents, today }) {
  const tomorrow = addDays(today, 1)
  const seen = new Set()
  const rows = []
  const push = (e) => {
    if (seen.has(String(e.id))) return
    seen.add(String(e.id))
    rows.push(e)
  }
  for (const e of upcomingEvents(events, today, 1)) push({ id: e.id, title: e.title, time: e.time, day: e.day, end: e.end, personal: e.personal })
  for (const e of [...(myEvents?.today ?? []), ...(myEvents?.tomorrow ?? [])]) {
    const day = e.day === 'tomorrow' ? tomorrow : today
    push({ id: e.id ?? `${day}|${e.title}`, title: e.title, time: e.time ?? null, day, end: day, personal: false })
  }
  const byTime = (a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99') || a.title.localeCompare(b.title, 'th')
  const sorted = rows.filter((r) => r.day === today || r.day === tomorrow).sort(byTime)
  return { today: sorted.filter((r) => r.day === today), tomorrow: sorted.filter((r) => r.day === tomorrow), all: sorted }
}

// ───────────────────────── ป้าย "ใหม่ HH:MM" ─────────────────────────

/** ป้าย "ใหม่" อยู่ 1 ชั่วโมง */
export const EXEC_SIMPLE_NEW_MARK_MS = 60 * 60 * 1000

/**
 * เทียบรอบนี้กับรอบก่อน: ข้อที่ "เพิ่งขึ้น" หรือ "จำนวนเพิ่มจากรอบก่อน" ได้ป้าย ใหม่ HH:MM (ค้างอยู่ 1 ชั่วโมง)
 * - ไม่มีรอบก่อน (เปิดหน้าครั้งแรกของเซสชัน) = ไม่ติดป้ายใคร (ทุกอย่างคือสถานะตั้งต้น ไม่ใช่ของใหม่)
 * - จำนวนลด/เท่าเดิม = ไม่ติดป้ายใหม่ แต่ป้ายเดิมที่ยังไม่ครบชั่วโมงคงอยู่
 * @param {{ counts: Record<string, number>, marks: Record<string, number> }|null} prev  snapshot ที่เก็บไว้ (sessionStorage)
 * @param {Array<{ id: string, count: number }>} items
 * @returns {{ snapshot: { counts: Record<string, number>, marks: Record<string, number> }, labels: Record<string, string> }}
 */
export function markNewAlerts(prev, items, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now)
  const prevCounts = prev && typeof prev.counts === 'object' && prev.counts ? prev.counts : null
  const prevMarks = prev && typeof prev.marks === 'object' && prev.marks ? prev.marks : {}
  const counts = {}
  const marks = {}
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it.id !== 'string') continue
    const count = execCount(it.count)
    counts[it.id] = count
    const before = prevCounts ? prevCounts[it.id] : undefined
    const increased = prevCounts && (before === undefined || count > before)
    const markedAt = Number(prevMarks[it.id])
    if (increased) marks[it.id] = nowMs
    else if (Number.isFinite(markedAt) && nowMs - markedAt < EXEC_SIMPLE_NEW_MARK_MS) marks[it.id] = markedAt
  }
  const labels = Object.fromEntries(Object.entries(marks).map(([id, at]) => [id, bangkokClock(at)]))
  return { snapshot: { counts, marks }, labels }
}

// ───────────────────────── ข้อความแถวช้า 5 วันทำการ ─────────────────────────

/**
 * หัวแถว "ช้ากว่ากำหนดเกิน 5 วันทำการ" — ชื่อประเภทตามที่มีจริง (คำร้อง/คำขอ) ไม่เหมาหมวด
 * @param {{ items: Array<{ id: string }> }} overdue5  ผลของ splitSimpleAlerts().overdue5
 */
export function simpleOverdueWhat(overdue5) {
  const ids = (overdue5?.items ?? []).map((it) => it.id)
  const c = ids.includes('complaints:overdue_5wd')
  const d = ids.includes('inbox:overdue_5wd')
  const name = c && d ? 'เรื่องร้องเรียน/คำขอบริการ' : (d ? 'คำขอบริการ' : 'เรื่องร้องเรียน')
  return `${name} ช้ากว่ากำหนดเกิน 5 วันทำการ`
}

// ───────────────────────── sessionStorage (ห่อ try/catch ทุกจุด — เบราว์เซอร์บางโหมดปิด/เต็มแล้วโยน error) ─────────────────────────

/** อ่าน JSON จาก sessionStorage · ไม่มี/พัง/ใช้ไม่ได้ = null */
export function readSessionJson(key) {
  try {
    const raw = globalThis.sessionStorage?.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** เขียน JSON ลง sessionStorage · เขียนไม่ได้ = ข้ามเงียบๆ (ผลคือแค่ไม่จำค่า ไม่ทำให้หน้าพัง) */
export function writeSessionJson(key, value) {
  try {
    globalThis.sessionStorage?.setItem(key, JSON.stringify(value))
  } catch {
    /* ไม่จำค่า */
  }
}

export function removeSessionKey(key) {
  try {
    globalThis.sessionStorage?.removeItem(key)
  } catch {
    /* ข้าม */
  }
}

// ───────────────────────── เลื่อนจอคืนตำแหน่งเดิม ─────────────────────────

export const EXEC_SIMPLE_SCROLL_KEY = 'exec-simple-scroll'
/** ตำแหน่งที่จำไว้ใช้ได้ไม่เกินนี้ — ออกไปแล้วไม่กลับมาภายในครึ่งชั่วโมงถือว่าเป็นการเปิดหน้าใหม่ ไม่เลื่อนให้ */
export const EXEC_SIMPLE_SCROLL_TTL_MS = 30 * 60 * 1000

/** จำตำแหน่งเลื่อน (px) ก่อนออกจากหน้า */
export function saveSimpleScroll(y, now = Date.now()) {
  const top = Number(y)
  if (!Number.isFinite(top) || top < 0) return
  writeSessionJson(EXEC_SIMPLE_SCROLL_KEY, { y: Math.round(top), at: now })
}

/** หยิบตำแหน่งที่จำไว้ "ครั้งเดียว" (หยิบแล้วลบทิ้ง) · เก่าเกิน TTL/ค่าเสีย = null */
export function takeSimpleScroll(now = Date.now()) {
  const saved = readSessionJson(EXEC_SIMPLE_SCROLL_KEY)
  removeSessionKey(EXEC_SIMPLE_SCROLL_KEY)
  const y = Number(saved?.y)
  const at = Number(saved?.at)
  if (!Number.isFinite(y) || y < 0 || !Number.isFinite(at) || now - at > EXEC_SIMPLE_SCROLL_TTL_MS || now < at) return null
  return y
}
