// ชวนผู้ยื่นประเมินความพึงพอใจจากหน้าแรกเจ้าหน้าที่ — ตรรกะล้วน (ไม่มี React/supabase)
// ฝั่งฐานข้อมูล: supabase/migrations/20261111100100_complaint_rate_invite_functions.sql
//   my_complaints_to_rate(p_muni)            เรื่องที่ "ฉัน" ยื่นไว้ ดำเนินการแล้วใน 30 วัน ยังไม่มีคะแนนช่องใด
//   rate_complaint_on_behalf(id, rating, c)  สท. ถามชาวบ้านแล้วบันทึกแทน
//
// ทำไมมี: สท. ยื่นแทนชาวบ้านจากบัญชีตัวเอง ล็อกอินแล้วเข้าฝั่งเจ้าหน้าที่ จึงไม่เคยเห็นหน้าต่างชวนประเมินของฝั่งประชาชน
//
// ⚠️ ไฟล์นี้ต้องไม่ import supabase หรือ basename (ใช้ import.meta.env) — เทสต์รันด้วย node ตรงๆ (tests/complaint-rate-invite.test.mjs)
import { isTrackToken } from './complaintTrack.js'

// ชุดเดียวกับ SatisfactionModal.jsx (ไม่ import มาเพราะไฟล์นั้นผูกกับ supabase) — ถ้าแก้ค่าที่นั่นต้องแก้ที่นี่ด้วย
export const RATING_OPTIONS = [
  { value: 5, emoji: '😄', label: 'ยอดเยี่ยม', color: '#22c55e', bg: '#f0fdf4', border: '#86efac' },
  { value: 4, emoji: '😊', label: 'ดี', color: '#3b82f6', bg: '#eff6ff', border: '#93c5fd' },
  { value: 3, emoji: '😐', label: 'พอสมควร', color: '#f59e0b', bg: '#fffbeb', border: '#fcd34d' },
  { value: 2, emoji: '😢', label: 'แย่', color: '#f97316', bg: '#fff7ed', border: '#fdba74' },
  { value: 1, emoji: '😡', label: 'แย่มาก', color: '#ef4444', bg: '#fef2f2', border: '#fca5a5' },
]

const DAY_MS = 24 * 60 * 60 * 1000
const THAI_OFFSET_MS = 7 * 60 * 60 * 1000 // ประเทศไทย UTC+7 ตลอดปี ไม่มี DST — ไม่พึ่ง timezone ของเครื่อง

// ช่วงเดียวกับที่ฐานข้อมูลคัดเรื่อง (closed_at >= now() - 30 วัน)
export const INVITE_WINDOW_DAYS = 30
// ส่งลิงก์ไปแล้วรอกี่วันก่อนเตือนอีกครั้ง (ไม่ทวงทุกวัน) และปิดมากี่วันจึงขึ้นข้อความ "ยังไม่มีผู้ประเมิน"
export const FOLLOW_UP_AFTER_DAYS = 3
export const INVITE_LIST_LIMIT = 5
export const COMMENT_MAX = 500

// ───── วันตามเวลาไทย ─────
export function toMs(value) {
  if (value == null || value === '') return null
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

// เลขวันตามปฏิทินไทย (นับจากวันที่ 1 ม.ค. 1970 เวลาไทย) — ต่างกัน 1 = ข้ามเที่ยงคืนเวลาไทย 1 ครั้ง
function thaiDayNumber(ms) {
  return Math.floor((ms + THAI_OFFSET_MS) / DAY_MS)
}

/** จำนวนวัน (ปฏิทินเวลาไทย) จาก fromMs ถึง toMs · ค่าไม่ถูกต้อง = null · ไม่ติดลบ */
export function thaiDaysBetween(fromMs, toMs_) {
  const from = toMs(fromMs)
  const to = toMs(toMs_)
  if (from === null || to === null) return null
  return Math.max(0, thaiDayNumber(to) - thaiDayNumber(from))
}

/** เวลาอ้างอิง: server_now ถ้าอ่านได้ ไม่งั้นใช้เวลาเครื่อง (นาฬิกาเครื่องเพี้ยนไม่ควรทำให้นับวันปิดงานผิด) */
export function referenceNowMs(serverNow, fallbackMs = Date.now()) {
  return toMs(serverNow) ?? fallbackMs
}

// ───── ข้อมูลจาก RPC ─────
/**
 * ทำให้ผลของ my_complaints_to_rate เป็นรูปแบบที่ใช้ต่อได้เสมอ (ข้อมูลเสีย/ว่าง = ไม่มีรายการ ไม่โยน error)
 * @returns {{ items: object[], canProxy: boolean, serverNow: string|null }}
 */
export function parseInviteData(data) {
  const items = Array.isArray(data?.items)
    ? data.items.filter(item => item && typeof item.id === 'string' && item.id)
    : []
  return {
    items,
    canProxy: data?.can_proxy === true,
    serverNow: typeof data?.server_now === 'string' ? data.server_now : null,
  }
}

// ───── บันทึก "ส่งลิงก์แล้ว" (localStorage แยกตามหน่วยงาน+บัญชี) ─────
// รูปแบบ: { [complaintId]: isoTime } · ไม่มีข้อมูลส่วนบุคคล ไม่ลงฐานข้อมูล · แยกตามเครื่อง (ข้อเสียที่ยอมรับ: เปลี่ยนเครื่อง
// = ไม่รู้ว่าส่งไปแล้ว จึงขึ้นชวนอีกรอบ ไม่ถึงกับเสียหาย)
const STORAGE_PREFIX = 'sl:rate-invite:v1'
const MAX_ID_LEN = 64
const MAX_STAMPS = 100

export function inviteStorageKey(tenantId, profileId) {
  return `${STORAGE_PREFIX}:${tenantId}:${profileId}`
}

function pruneStamps(raw, nowMs) {
  const out = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  const entries = Object.entries(raw)
    .filter(([id]) => id.length > 0 && id.length <= MAX_ID_LEN)
    .map(([id, iso]) => [id, typeof iso === 'string' ? toMs(iso) : null])
    // ตัดรายการเก่ากว่าช่วงชวนประเมิน (เรื่องนั้นพ้น 30 วันไปแล้ว ไม่ขึ้นอีก) และค่าที่อ่านเวลาไม่ได้
    .filter(([, ms]) => ms !== null && nowMs - ms <= INVITE_WINDOW_DAYS * DAY_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_STAMPS)
  for (const [id, ms] of entries) out[id] = new Date(ms).toISOString()
  return out
}

/** อ่านรายการที่ส่งลิงก์แล้ว (ตัดของเก่ากว่า 30 วันออกจากผลลัพธ์) · storage พัง/JSON เสีย = {} */
export function readInviteStamps(storage, tenantId, profileId, nowMs = Date.now()) {
  if (!storage || !tenantId || !profileId) return {}
  try {
    const text = storage.getItem(inviteStorageKey(tenantId, profileId))
    return text ? pruneStamps(JSON.parse(text), nowMs) : {}
  } catch {
    return {}
  }
}

/** จดว่าส่งลิงก์ของเรื่องนี้แล้ว (พร้อมตัดของเก่า) · คืน true เมื่อเขียนสำเร็จ · พังเงียบๆ ได้เพราะเป็นแค่ความสะดวก */
export function recordInviteSent(storage, tenantId, profileId, complaintId, nowMs = Date.now()) {
  if (!storage || !tenantId || !profileId) return false
  if (typeof complaintId !== 'string' || !complaintId || complaintId.length > MAX_ID_LEN) return false
  try {
    const stamps = readInviteStamps(storage, tenantId, profileId, nowMs)
    stamps[complaintId] = new Date(nowMs).toISOString()
    storage.setItem(inviteStorageKey(tenantId, profileId), JSON.stringify(pruneStamps(stamps, nowMs)))
    return true
  } catch {
    return false
  }
}

// ───── แถวที่ต้องแสดง ─────
/**
 * @param {object[]} items  รายการจาก my_complaints_to_rate (ยังไม่มีคะแนนช่องใด)
 * @param {Record<string,string>} stamps  { [complaintId]: เวลาที่ส่งลิงก์ }
 * @param {number} nowMs  เวลาเครื่อง (ตราส่งลิงก์ก็เขียนด้วยเวลาเครื่อง ต้องเทียบกับเวลาเครื่องด้วยกัน)
 * @returns {Array<object & { followUp: boolean, sentDays: number|null }>}
 *   ส่งลิงก์ไปแล้วไม่ถึง 3 วัน (นับเวลาจริง 72 ชม.) = ซ่อน (รอชาวบ้าน ไม่ทวง)
 *   ครบ 3 วันแล้วยังอยู่ในรายการ (= ยังไม่มีคะแนน) = แสดงพร้อม followUp
 *   ตราเวลาในอนาคต (นาฬิกาเครื่องถูกแก้ย้อน) = ซ่อน ถือว่าเพิ่งส่ง
 */
export function visibleInviteRows(items, stamps, nowMs = Date.now()) {
  const rows = []
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item.id !== 'string') continue
    const stampMs = toMs(stamps?.[item.id])
    if (stampMs === null) {
      rows.push({ ...item, followUp: false, sentDays: null })
      continue
    }
    if (nowMs - stampMs < FOLLOW_UP_AFTER_DAYS * DAY_MS) continue
    rows.push({ ...item, followUp: true, sentDays: Math.max(FOLLOW_UP_AFTER_DAYS, thaiDaysBetween(stampMs, nowMs)) })
  }
  return rows
}

/**
 * ข้อความใต้แถว
 *  - ส่งลิงก์แล้วครบ 3 วัน → "ส่งลิงก์ไปแล้ว N วัน ชาวบ้านยังไม่ได้ประเมิน" (+ "บันทึกแทนได้" ถ้าเป็น สท.)
 *  - ปิดมาแล้ว ≥ 3 วัน → "ดำเนินการแล้ว N วัน ยังไม่มีผู้ประเมิน"
 *  - นอกนั้น → "ดำเนินการแล้ว"
 * วันปิดเรื่องนับตามเวลาไทยเทียบกับ server_now (ถ้ามี) ไม่ใช่ timezone/นาฬิกาเครื่อง
 */
export function inviteRowNote(row, { canProxy = false, serverNow = null, nowMs = Date.now() } = {}) {
  if (row?.followUp) {
    const days = Number.isFinite(row.sentDays) ? row.sentDays : FOLLOW_UP_AFTER_DAYS
    return `ส่งลิงก์ไปแล้ว ${days} วัน ชาวบ้านยังไม่ได้ประเมิน${canProxy ? ' · บันทึกแทนได้' : ''}`
  }
  const closedDays = thaiDaysBetween(row?.closed_at, referenceNowMs(serverNow, nowMs))
  if (closedDays !== null && closedDays >= FOLLOW_UP_AFTER_DAYS) return `ดำเนินการแล้ว ${closedDays} วัน ยังไม่มีผู้ประเมิน`
  return 'ดำเนินการแล้ว'
}

/** บรรทัดหัวแถวและรายละเอียด: เลขที่ / หมวด · หมู่บ้าน */
export function inviteRowLines(row) {
  const refNo = typeof row?.ref_no === 'string' && row.ref_no.trim() ? row.ref_no.trim() : 'เรื่องที่ยื่นไว้'
  const detail = [row?.category_label, row?.village]
    .map(part => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' · ')
  return { title: refNo, detail }
}

/** ปุ่ม "ส่งลิงก์" ใช้ได้เฉพาะเรื่องที่มีโทเคนรูปแบบถูกต้อง (ไม่เดา/ไม่ประกอบลิงก์เสีย) */
export function canShareRow(row) {
  return isTrackToken(row?.track_token)
}

export function inviteSummaryText(total) {
  return `เรื่องที่คุณแจ้ง ดำเนินการแล้ว รอประเมิน ${total} เรื่อง`
}

// ───── ผลการส่งคะแนน ─────
// ข้อความตาม code ที่ rate_complaint() / rate_complaint_on_behalf() คืนมา (RPC ไม่ raise ในเคสธุรกิจปกติ)
export const INVITE_RATE_ERRORS = {
  invalid_rating: 'คะแนนไม่ถูกต้อง กรุณาเลือกใหม่',
  not_found: 'ไม่พบเรื่องนี้ในระบบแล้ว',
  not_closed: 'ให้คะแนนได้หลังเรื่องดำเนินการแล้ว',
  not_rateable: 'เรื่องหมวดนี้ไม่มีการประเมินความพึงพอใจ',
  not_owner: 'บันทึกได้เฉพาะเรื่องที่คุณยื่นเอง',
  not_council: 'บันทึกแทนชาวบ้านได้เฉพาะสมาชิกสภา',
  expired: 'เรื่องนี้ปิดมาเกิน 30 วันแล้ว ไม่รับการประเมิน',
  // คุณประเมินเรื่องนี้เองไปแล้ว — ต่างจาก already_rated ตรงที่ห้ามถือเป็นสำเร็จ (คะแนนที่บันทึกแทนไม่ได้ถูกบันทึก)
  self_rated: 'คุณประเมินเรื่องนี้เองไปแล้ว บันทึกแทนชาวบ้านซ้ำไม่ได้',
}
export const INVITE_RATE_FALLBACK_ERROR = 'ส่งคะแนนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'

export function inviteErrorMessage(code) {
  return INVITE_RATE_ERRORS[code] ?? INVITE_RATE_FALLBACK_ERROR
}

/** ผลของ RPC ถือว่าเรื่องนี้จบแล้ว: ok = true หรือ already_rated (มีคะแนนอยู่แล้ว = ไม่ให้กดซ้ำจนยอมแพ้) · self_rated ไม่ใช่ */
export function isRateSuccess(data) {
  return data?.ok === true || data?.code === 'already_rated'
}

/**
 * แยกว่า "บันทึกคะแนนนี้แล้ว" (ok) หรือ "เรื่องนี้มีผู้ประเมินอยู่ก่อนแล้ว คะแนนที่กรอกไม่ได้ถูกบันทึก" (already) หรือผิดพลาด (error)
 * already ต้องไม่ขึ้นคำว่าขอบคุณเหมือน ok: ช่องชาวบ้านอาจถูกใช้ไปแล้วจากลิงก์/ค้นด้วยเลขอ้างอิง ไม่ใช่คะแนนที่ สท. เพิ่งกรอก
 */
export function rateOutcome(data) {
  if (data?.ok === true) return 'ok'
  if (data?.code === 'already_rated') return 'already'
  return 'error'
}

export const RATE_ALREADY_TEXT = 'เรื่องนี้มีผู้ประเมินแล้ว'
// คำเตือนใต้ช่องความเห็นตอนบันทึกแทน — ความเห็นถูกเก็บในตารางคะแนนและขึ้นรายงาน ไม่ควรมีข้อมูลระบุตัวตนของชาวบ้าน (PDPA)
export const PROXY_COMMENT_WARNING = 'ไม่ต้องใส่ชื่อหรือเบอร์โทรของชาวบ้าน'

/** ความเห็นที่จะส่ง: ตัดช่องว่าง · ว่าง = null · ไม่เกิน 500 ตัวอักษร (ตรงกับ left(…, 500) ในฐานข้อมูล) */
export function cleanComment(text) {
  const trimmed = typeof text === 'string' ? text.trim() : ''
  if (!trimmed) return null
  return [...trimmed].slice(0, COMMENT_MAX).join('')
}

// ข้อความที่แสดงหลังกดส่งลิงก์ (ผลจาก shareTrackLink)
export const SHARE_NOTICE_SENT = 'ส่งแล้ว — ถ้าชาวบ้านยังไม่ประเมินใน 3 วัน ระบบจะเตือนอีกครั้ง'
export const SHARE_NOTICE_COPIED = 'คัดลอกลิงก์แล้ว วางส่งให้ชาวบ้านได้เลย — ถ้าชาวบ้านยังไม่ประเมินใน 3 วัน ระบบจะเตือนอีกครั้ง'
export const SHARE_NOTICE_FAILED = 'ส่งต่ออัตโนมัติไม่ได้ กดค้างที่ลิงก์เพื่อคัดลอกแล้วส่งให้ชาวบ้าน'
