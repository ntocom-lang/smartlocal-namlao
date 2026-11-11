// ฟังก์ชัน pure ของ "รายการเรื่องเลยกำหนด + ⭐ ติดตาม + ส่งให้กองเร่งรัด" (ห้องผู้บริหาร E3-2)
// แยกจาก execFollowNudge.js เพราะไฟล์นั้น import supabase.js ซึ่งอ่าน import.meta.env — node รันเทสต์ตรงๆ ไม่ได้
// (แบบเดียวกับ advisorApi.js / advisorHelpers.js) · เทสต์: npm run test:exec-nudge
//
// สัญญาข้อมูลมาจาก migration 20261117100100 (exec_overdue_items / exec_my_follows / exec_nudge)
// และ Edge Function exec-nudge-notify — ไม่มีชื่อผู้ร้อง/รายละเอียดเรื่องในข้อมูลชุดนี้ (PDPA) ห้ามเพิ่มช่องพวกนั้นที่นี่

import { PARKED_LABEL } from './complaintWorkflow.js'
import { docTypeLabelOf } from './executiveData.js'
import { EXEC_POSITION_CATEGORY } from './executiveAccess.js'
import { workingDaysSince } from './workingDays.js'

// new Date(null) = 1 ม.ค. 1970 — ค่าว่างต้องเป็น "อ่านไม่ได้" ไม่ใช่เวลา epoch (เคยทำให้ปุ่มกดซ้ำเปิดผิด)
const toMs = (value) => (value == null || value === '' ? NaN : new Date(value).getTime())

/** ค้าง pending/sending เกินนี้ถือว่าส่งไม่ถึง กดซ้ำได้ — ตรงกับ interval '10 minutes' ใน exec_nudge (SQL) */
export const EXEC_NUDGE_RETRY_MS = 10 * 60 * 1000

/** กองที่ไม่ระบุ (dept_id ว่าง) — ใช้เป็นกลุ่มท้ายสุด */
export const EXEC_NO_DEPT_LABEL = 'ไม่ระบุกอง'

// ───────────────────────── สิทธิ์ปุ่มเร่ง ─────────────────────────

// ต้องตรงกับ exec_assert_actor (SQL): viewer · ตำแหน่ง top_admin ในกลุ่ม role เจ้าหน้าที่ (รวม admin ที่เป็นปลัด)
// · superadmin เฉพาะ tenant slug 'demo' — ฝั่งเซิร์ฟเวอร์ตัดสินจริงเสมอ (42501) ที่นี่แค่ไม่ทำปุ่มหลอก
const NUDGE_STAFF_ROLES = Object.freeze(['officer', 'staff', 'council', 'technician', 'admin'])
export const EXEC_NUDGE_DEMO_SLUG = 'demo'

/**
 * true = แสดงปุ่ม "ส่งให้กองเร่งรัด" · positionCategory = null/undefined ตอนยังไม่รู้ตำแหน่ง (ไม่แสดงปุ่มจนกว่าจะรู้)
 * admin ที่ไม่ใช่ปลัด = ไม่ได้ (ผู้ดูแลระบบไอทีไม่ใช่ผู้บังคับบัญชา — ข้อความ "ผู้บริหารขอให้เร่งรัด" จะเป็นการแอบอ้าง)
 */
export function canNudgeItems({ role, positionCategory, tenantSlug } = {}) {
  if (role === 'viewer') return true
  if (role === 'superadmin') return tenantSlug === EXEC_NUDGE_DEMO_SLUG
  return NUDGE_STAFF_ROLES.includes(role) && positionCategory === EXEC_POSITION_CATEGORY
}

// ───────────────────────── ป้ายผลการส่ง ─────────────────────────

const DELIVERY_LABELS = Object.freeze({
  dm: 'ส่งถึงหัวหน้ากองทาง Telegram ส่วนตัวแล้ว',
  group: 'ส่งเข้ากลุ่ม Telegram ของหน่วยงานแล้ว',
  none: 'ไม่ได้ส่ง',
  failed: 'ส่งไม่สำเร็จ — กดส่งซ้ำได้',
  pending: 'กำลังส่ง…',
  sending: 'กำลังส่ง…',
})

/**
 * ผลการส่ง → ภาษาคน · tone: ok = ถึงแล้ว · warn = ไม่ถึง/ไม่ได้ส่ง (ต้องบอกให้เห็น) · wait = กำลังส่ง
 * note = ข้อความจากเซิร์ฟเวอร์ที่บอกว่าไปถึงใคร/ไม่ถึงเพราะอะไร — ต้องแสดงคู่กับป้ายเสมอ ("ส่งไม่ถึงต้องบอก")
 */
export function nudgeDeliveryText(delivery, note = null) {
  const label = DELIVERY_LABELS[delivery] ?? 'ไม่ทราบผลการส่ง'
  const tone = delivery === 'dm' || delivery === 'group' ? 'ok' : (delivery === 'pending' || delivery === 'sending' ? 'wait' : 'warn')
  const cleanNote = typeof note === 'string' && note.trim() ? note.trim() : null
  return { label, tone, note: cleanNote }
}

/**
 * การเร่งเดิมกดซ้ำได้ไหม — ตรงกับเงื่อนไขใน exec_nudge: ส่งพลาด (failed) หรือค้าง pending/sending เกิน 10 นาที
 * ค่าที่อ่านไม่ได้ (เวลาเสีย/ไม่มี) = false: ไม่เปิดปุ่มมั่ว ปล่อยให้เซิร์ฟเวอร์ตัดสิน
 * หมายเหตุ: ฝั่งฐานนับ 10 นาทีจาก last_retry_at (ถ้ามี) แต่ exec_overdue_items คืนแค่ nudged_at — ถ้ากดซ้ำแล้วค้างอีก
 * หน้านี้อาจเปิดปุ่มเร็วกว่าเซิร์ฟเวอร์ ผลคือได้ข้อความ already_today กลับมาแสดง ไม่ใช่ส่งซ้ำ
 */
export function canRetry(nudge, now = new Date()) {
  if (!nudge) return false
  if (nudge.delivery === 'failed') return true
  if (nudge.delivery !== 'pending' && nudge.delivery !== 'sending') return false
  const at = toMs(nudge.at)
  const nowMs = toMs(now)
  if (!Number.isFinite(at) || !Number.isFinite(nowMs)) return false
  return nowMs - at > EXEC_NUDGE_RETRY_MS
}

/** ปุ่มเร่งของแถวนี้ปิดไหม: วันนี้มีคนเร่งไปแล้ว และยังไม่ถึงเงื่อนไขกดซ้ำ */
export function nudgeBlocked(item, now = new Date()) {
  return Boolean(item?.nudged_today) && !canRetry(item?.nudge, now)
}

// ───────────────────────── รายการเรื่อง ─────────────────────────

// ต้องตรงกับ STATUS ใน ComplaintsManager.jsx (หน้าเจ้าหน้าที่) และ COMPLAINT_STATUS ใน _shared/execNudge.ts (ข้อความ Telegram)
// ผู้บริหารกับ ผอ.กองต้องเห็นชื่อสถานะเดียวกัน ไม่งั้นคุยกันคนละคำ
const COMPLAINT_STATUS = Object.freeze({
  new: 'คำร้องใหม่', pending: 'คำร้องใหม่', received: 'รับเรื่องแล้ว',
  in_progress: 'กำลังดำเนินการ', parked: PARKED_LABEL, done: 'ดำเนินการแล้ว', closed: 'ดำเนินการแล้ว', rejected: 'ปฏิเสธ',
})
// ต้องตรงกับ STATUS ใน MyDocRequests.jsx
const DOC_STATUS = Object.freeze({
  pending: 'รอดำเนินการ', processing: 'กำลังดำเนินการ', completed: 'เสร็จสิ้น', rejected: 'ปฏิเสธ',
})

/** ป้ายสถานะ — คำร้องกับคำขอใช้ชื่อสถานะต่างกัน (pending = รอรับเรื่อง / รอดำเนินการ) */
export function itemStatusLabel(kind, status) {
  const table = kind === 'document_request' ? DOC_STATUS : COMPLAINT_STATUS
  return table[status] ?? (status ? String(status) : 'ไม่ระบุสถานะ')
}

export const itemKindName = (kind) => (kind === 'document_request' ? 'คำขอ' : 'คำร้อง')

/** หมวดของคำร้อง (cat_label จากเซิร์ฟเวอร์) หรือชื่อประเภทคำขอ (ทะเบียนประเภทคำขอ รวมที่ อปท. เพิ่มเอง) */
export function itemCategoryLabel(item, tenant) {
  if (item?.k === 'document_request') return docTypeLabelOf(item.cat, tenant)
  return item?.cat_label || item?.cat || 'ไม่ระบุหมวด'
}

/** วันทำการที่เลยกำหนดมาแล้ว — หลักเดียวกับ E2 (workingDaysSince ตัวเดียวกับ backlogAnalysis) · due ว่าง = 0 */
export function overdueWorkingDays(due, today) {
  if (typeof due !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(due)) return 0
  return workingDaysSince(due.slice(0, 10), today)
}

export const itemKey = (item) => `${item?.k}:${item?.id}`

/**
 * จัดกลุ่มรายกอง: กองที่เลยกำหนดเยอะก่อน (เท่ากัน = กองที่มีเรื่องเก่าสุดก่อน แล้วตามชื่อ) · กองไม่ระบุอยู่ท้ายสุด
 * ในกองคงลำดับ due เก่าสุดก่อน (เซิร์ฟเวอร์เรียงมาแล้ว — เรียงซ้ำแบบ stable กันข้อมูลสลับ)
 * @returns {Array<{ key: string, deptId: string|null, name: string, items: object[], over: number }>} over = จำนวนเรื่องที่เกิน overWd วันทำการ
 */
export function groupByDept(items, today, overWd = 5) {
  const groups = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    if (!item) continue
    const key = item.dept_id ?? '_none'
    if (!groups.has(key)) groups.set(key, { key, deptId: item.dept_id ?? null, name: item.dept || EXEC_NO_DEPT_LABEL, items: [], over: 0 })
    groups.get(key).items.push(item)
  }
  const dueOf = (item) => (typeof item.due === 'string' ? item.due : '9999-12-31')
  for (const g of groups.values()) {
    g.items = g.items.map((item, i) => ({ item, i }))
      .sort((a, b) => dueOf(a.item).localeCompare(dueOf(b.item)) || a.i - b.i)
      .map((x) => x.item)
    g.over = g.items.filter((item) => overdueWorkingDays(item.due, today) > overWd).length
  }
  return [...groups.values()].sort((a, b) =>
    (a.deptId === null) - (b.deptId === null)
    || b.items.length - a.items.length
    || dueOf(a.items[0]).localeCompare(dueOf(b.items[0]))
    || a.name.localeCompare(b.name, 'th'))
}

// ───────────────────────── รูปแบบข้อมูลจาก RPC (ป้องกันข้อมูลผิดรูป) ─────────────────────────

const asList = (v) => (Array.isArray(v) ? v : [])

/** ผล exec_overdue_items → รูปที่หน้าจอใช้ (ข้ามแถวที่ไม่มี id/ประเภท · ตัวเลขผิดรูป = ค่าสำรอง) */
export function normalizeOverdue(data) {
  const d = data && typeof data === 'object' ? data : {}
  const items = asList(d.items).filter((x) => x && typeof x.id === 'string' && (x.k === 'complaint' || x.k === 'document_request'))
  const total = Number.isFinite(Number(d.total)) ? Math.max(0, Math.floor(Number(d.total))) : items.length
  const limit = Number.isFinite(Number(d.limit)) && Number(d.limit) > 0 ? Math.floor(Number(d.limit)) : items.length
  const sensitive = asList(d.sensitive)
    .map((s) => ({ dept_id: s?.dept_id ?? null, dept: s?.dept || EXEC_NO_DEPT_LABEL, n: Math.max(0, Math.floor(Number(s?.n) || 0)) }))
    .filter((s) => s.n > 0)
  return { asOf: typeof d.as_of === 'string' ? d.as_of : null, total, limit, truncated: d.truncated === true, items, sensitive }
}

/** ผล exec_my_follows → รายการ (ข้ามแถวไม่มี id/ประเภท) */
export function normalizeFollows(data) {
  return asList(data?.follows).filter((x) => x && typeof x.id === 'string' && (x.k === 'complaint' || x.k === 'document_request'))
}

/** แถวที่ติดตามอยู่ แยกประเภทการแสดง: gone = เรื่องหาย · hidden = หมวดคุ้มครองผู้ร้อง (ไม่มีเลขที่) · normal = ปกติ */
export function followRowKind(row) {
  if (row?.gone) return 'gone'
  if (row?.hidden) return 'hidden'
  return 'normal'
}

/** บรรทัดสรุปหมวดคุ้มครองผู้ร้อง — ยอดรวมรายกอง ไม่มีเลขที่ (เลขที่ + กอง เข้ากลุ่ม Telegram จะบอกได้ว่าใครถูกร้อง) */
export function sensitiveSummaryLines(sensitive) {
  return asList(sensitive).filter((s) => s?.n > 0).map((s) =>
    `หมวดคุ้มครองผู้ร้อง เลยกำหนด ${s.n} เรื่อง (${s.dept || EXEC_NO_DEPT_LABEL}) — แสดงเป็นยอดรวม ติดตาม/เร่งรายเรื่องไม่ได้`)
}

/** ข้อความเมื่อรายการถูกตัดที่ 300 เรื่อง (เก่าสุดก่อน) · ไม่ถูกตัด = null */
export function truncatedText({ truncated, total, limit }) {
  return truncated ? `แสดง ${limit.toLocaleString('th-TH')} จาก ${total.toLocaleString('th-TH')} เรื่อง (เก่าสุดก่อน)` : null
}

/** ข้อความถามยืนยันก่อนส่ง (ครั้งเดียว) */
export function nudgeConfirmText(item, deptName) {
  const dept = deptName && deptName !== EXEC_NO_DEPT_LABEL ? `หัวหน้า${deptName}` : 'หัวหน้ากองที่ถือเรื่อง'
  return `ส่งข้อความ Telegram ถึง${dept} ให้เร่งรัดเรื่องเลขที่ ${item.ref}?`
}

// ───────────────────────── ผลการกดเร่ง (ประกอบจากตัวเรียก API) ─────────────────────────

/** เรียก Edge Function ไม่ติด (404 ยังไม่ deploy / เน็ตหลุด / 5xx) — แถวเร่งถูกจดแล้วแต่ยังไม่ได้ส่ง */
export const NUDGE_EDGE_UNREACHABLE_NOTE = 'ส่งไม่สำเร็จ — กดส่งซ้ำได้หลัง 10 นาที'
/** หมดเวลารอ (45 วิ): ฟังก์ชันอาจยังทำงานอยู่ ไม่รู้ผลจริง — ห้ามบอกว่าส่งพลาด (อาจถึงแล้ว) */
export const NUDGE_EDGE_TIMEOUT_NOTE = 'ยังไม่ทราบผลการส่ง (รอนานเกิน 45 วินาที) — โหลดรายการใหม่เพื่อดูสถานะ ก่อนกดส่งซ้ำ'

/**
 * ผลของ exec_nudge + Edge Function → ข้อความบนแถว {tone, text}
 * @param {{ outcome: 'sent'|'already_today'|'in_progress'|'not_pending'|'edge_unreachable'|'timeout', delivery?: string, note?: string|null, existing?: {at?:string, by?:string, delivery?:string} }} result
 */
export function nudgeResultMessage(result) {
  const r = result ?? {}
  if (r.outcome === 'already_today') {
    const by = r.existing?.by || 'ผู้บริหาร'
    const when = r.existing?.at ? ` เมื่อ ${thaiDateTime(r.existing.at)}` : ''
    const d = nudgeDeliveryText(r.existing?.delivery)
    return { tone: 'warn', text: `วันนี้ ${by} เร่งเรื่องนี้ไปแล้ว${when} · ${d.label}` }
  }
  if (r.outcome === 'in_progress') return { tone: 'wait', text: 'กำลังส่งอยู่ — รอสักครู่แล้วโหลดรายการใหม่' }
  if (r.outcome === 'edge_unreachable') return { tone: 'warn', text: NUDGE_EDGE_UNREACHABLE_NOTE }
  if (r.outcome === 'timeout') return { tone: 'warn', text: NUDGE_EDGE_TIMEOUT_NOTE }
  const d = nudgeDeliveryText(r.delivery, r.note)
  return { tone: d.tone, text: d.note ? `${d.label} — ${d.note}` : d.label }
}

// ───────────────────────── วันเวลา ─────────────────────────

const dateTimeFormat = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
})

/** วันเวลาไทยของ timestamp (Asia/Bangkok ไม่พึ่งโซนเครื่อง) เช่น "11 พ.ย. 2569 10:15 น." · ผิดรูป = "—" */
export function thaiDateTime(value) {
  const ms = toMs(value)
  if (!Number.isFinite(ms)) return '—'
  return `${dateTimeFormat.format(new Date(ms))} น.`
}
