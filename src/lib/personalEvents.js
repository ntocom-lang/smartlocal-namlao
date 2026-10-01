// รายการส่วนตัวในปฏิทิน ("🔒 เฉพาะฉัน") — เจ้าของระบบสั่ง 2569-10-01 · ตรรกะล้วน
// ไฟล์นี้ห้าม import supabase เทสต์ node (tests/personal-events.test.mjs) import ตรง
//
// เก็บในตารางแยก personal_events (อ่าน/เขียนได้เฉพาะเจ้าของ แอดมินไม่เห็น) หน้าจอแปลงแถวให้หน้าตา
// เหมือนกิจกรรมปกติด้วย toPersonalEvent() แล้วปนไปกับรายการของหน่วยงาน ทุกจุดที่ต้องแยกทาง
// (บันทึก ลบ มอบหมาย ไฟล์แนบ แจ้งเตือน) เช็กด้วย isPersonalEvent()
//
// ⚠️ ด่านจริงอยู่ที่ฐานข้อมูล (migration 20261001150000 + 20261001150100) ที่นี่แค่ให้หน้าจอตรงกับด่าน
// ค่าคงที่ในไฟล์นี้ต้องตรงกับ migration — เทสต์เทียบให้ทุกครั้ง
import { STAFF_PORTAL_ROLES } from './portalAccess.js'
import { isAssignedTo } from './eventAssignment.js'
import { AUDIENCE_COLOR, AUDIENCE_LABEL } from './orgTerms.js'

// ค่าที่ใส่ใน ev.audiences ของรายการส่วนตัว — ไม่ได้เก็บในฐานข้อมูล (ตารางแยกอยู่แล้ว) และจงใจไม่เพิ่มเข้า
// AUDIENCE_COLOR/AUDIENCE_LABEL เพราะหน้าสาธารณะใช้สองตัวนั้นวาดคำอธิบายสีให้ประชาชนเห็น
export const PERSONAL_AUDIENCE = 'private'
export const PERSONAL_LABEL = 'เฉพาะฉัน'
// ชมพู: ไม่ซ้ำกับสี 4 กลุ่มเดิม (เขียว น้ำเงิน ม่วง เหลือง) และเห็นได้ทั้งพื้นขาวและพื้นมืดของหน้า /events
export const PERSONAL_COLOR = '#db2777'
// ค่าตัวกรอง "ของฉัน" = รายการที่จดเอง + กิจกรรมที่ตัวเองได้รับมอบหมาย
export const MINE_FILTER = 'mine'
export const MINE_LABEL = 'ของฉัน'

// ต้องตรงกับ v_limit ใน personal_events_guard() และ CHECK ของตาราง
export const PERSONAL_LIMIT = 100
export const PERSONAL_LIMITS = { title: 200, description: 2000, location: 200, category: 60 }
// SQLSTATE ที่ trigger ใช้ — เต็มและไม่มีรายการให้ทับ / วันที่เกิน 1 ปี
export const PERSONAL_LIMIT_CODE = 'PE001'
export const PERSONAL_HORIZON_CODE = 'PE002'
// ระบบเลือกประเภทให้เมื่อยังไม่ได้เลือก (แก้ได้ใน 1 แตะ) — ต้องเป็นค่าหนึ่งใน EVENTS_CATEGORIES ของ EventsManager
export const PERSONAL_DEFAULT_CATEGORY = 'กำหนดการ'

// ใครใช้ได้: ผู้มีตำแหน่งทุกคน ยกเว้นประชาชน — นิยามเดียวกับ "เฉพาะผู้มีตำแหน่ง" ของคำร้อง/E-Service
// (src/lib/serviceAudience.js) role จาก useAuth() ถูกลดเป็น citizen เองเมื่อเปิดเว็บของ อปท. อื่น
export function canUsePersonalEvents(role) {
  return STAFF_PORTAL_ROLES.includes(role)
}

export function isPersonalEvent(ev) {
  return ev?.is_personal === true
}

export function isPersonalAudience(audiences) {
  return Array.isArray(audiences) && audiences.includes(PERSONAL_AUDIENCE)
}

// ── วันที่ (สตริง YYYY-MM-DD ล้วน ไม่ผ่าน Date เพื่อไม่ให้ timezone ทำวันเลื่อน) ───────────────────────

const pad2 = (n) => String(n).padStart(2, '0')

function dateParts(dateStr) {
  const match = String(dateStr ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) } : null
}

function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

// 29 ก.พ. ในปีที่ไม่มี ให้เป็น 28 ก.พ. — ผลเดียวกับ (date + interval '1 year') ของ PostgreSQL
function sameDayInYear(year, m, d) {
  const day = m === 2 && d === 29 && !isLeapYear(year) ? 28 : d
  return `${year}-${pad2(m)}-${pad2(day)}`
}

// วันสุดท้ายที่ลงล่วงหน้าได้ = วันนี้ + 1 ปี (ต้องตรงกับ v_horizon ใน trigger)
export function maxPersonalDate(todayStr) {
  const p = dateParts(todayStr)
  return p ? sameDayInYear(p.y + 1, p.m, p.d) : ''
}

// วันของรายการ "ทุกปี" ในปีที่กำหนด — ปีก่อนปีที่เริ่มจดไม่ขึ้น (คืน null)
export function occurrenceInYear(baseDateStr, year) {
  const p = dateParts(baseDateStr)
  if (!p || !Number.isInteger(year) || year < p.y) return null
  return sameDayInYear(year, p.m, p.d)
}

// ครั้งถัดไปของรายการ "ทุกปี" นับจากวันนี้ (ตรงกับวันนี้ถือเป็นครั้งถัดไป) — ใช้กับหน้ารายการ
export function nextOccurrence(baseDateStr, todayStr) {
  const base = dateParts(baseDateStr)
  const today = dateParts(todayStr)
  if (!base || !today) return baseDateStr
  const year = Math.max(base.y, today.y)
  const thisYear = occurrenceInYear(baseDateStr, year)
  return thisYear >= todayStr ? thisYear : occurrenceInYear(baseDateStr, year + 1)
}

// ── แปลงแถวจากตาราง personal_events ให้หน้าตาเหมือนกิจกรรมที่มาจาก list_events_for_staff ────────────

export function toPersonalEvent(row, todayStr) {
  const yearly = row.repeat_yearly === true
  return {
    ...row,
    is_personal: true,
    audiences: [PERSONAL_AUDIENCE],
    // เจ้าของ = คนสร้าง กติกาปุ่มแก้ไข/ลบเดิม (created_by === ผู้ใช้) จึงใช้ได้เลย
    created_by: row.owner_id,
    department_id: null,
    creator: null,
    is_all_day: false,
    can_view_detail: true,
    has_attachment: false,
    attachment_url: null,
    attachment_urls: [],
    assignments: [],
    category: row.category || PERSONAL_DEFAULT_CATEGORY,
    repeat_yearly: yearly,
    // รายการ "ทุกปี": หน้ารายการแสดงครั้งถัดไป ส่วนวันที่จดไว้จริงเก็บใน base_date
    // (ปฏิทินคำนวณวันของแต่ละปีจากค่านี้ และฟอร์มแก้ไขต้องใช้ค่านี้ ไม่ใช่วันของครั้งถัดไป)
    base_date: row.event_date,
    event_date: yearly ? nextOccurrence(row.event_date, todayStr) : row.event_date,
  }
}

// รายการสำหรับตารางเดือนของปีที่กำลังเปิดดู — รายการ "ทุกปี" ย้ายไปวันของปีนั้น
export function eventsForCalendarYear(events, year) {
  const out = []
  for (const ev of events ?? []) {
    if (!(isPersonalEvent(ev) && ev.repeat_yearly)) { out.push(ev); continue }
    const date = occurrenceInYear(ev.base_date ?? ev.event_date, year)
    if (date) out.push(date === ev.event_date ? ev : { ...ev, event_date: date })
  }
  return out
}

// ── ตัวกรองและป้าย ────────────────────────────────────────────────────────────────────────────

// "ของฉัน" — ระบบรวมให้เอง ไม่ต้องจดซ้ำ: รายการที่จดเอง + กิจกรรมของหน่วยงานที่ตัวเองได้รับมอบหมาย
export function isMine(ev, userId) {
  return isPersonalEvent(ev) || isAssignedTo(ev, userId)
}

// ป้ายและสีของกลุ่มเป้าหมาย รวม "เฉพาะฉัน" — ค่าที่ไม่รู้จักคืน null (ไม่วาดป้าย)
export function audienceMeta(value) {
  if (value === PERSONAL_AUDIENCE) return { value, label: PERSONAL_LABEL, color: PERSONAL_COLOR }
  const color = AUDIENCE_COLOR[value]
  if (typeof color !== 'string') return null
  return { value, label: AUDIENCE_LABEL[value], color }
}

export function audienceColor(value) {
  return audienceMeta(value)?.color ?? '#6b7280'
}

// ── ฟอร์ม ─────────────────────────────────────────────────────────────────────────────────────

// กติกาเลือกกลุ่มเป้าหมาย: "เฉพาะฉัน" กับกลุ่มอื่นเลือกพร้อมกันไม่ได้ (เผยแพร่พร้อมกับเก็บส่วนตัวไม่ได้)
// ที่เหลือเหมือนเดิม — เลือกได้หลายกลุ่ม และเอากลุ่มสุดท้ายออกไม่ได้
export function nextAudiences(current, clicked) {
  const list = Array.isArray(current) ? current : []
  if (clicked === PERSONAL_AUDIENCE) return [PERSONAL_AUDIENCE]
  const shared = list.filter((v) => v !== PERSONAL_AUDIENCE)
  const next = shared.includes(clicked) ? shared.filter((v) => v !== clicked) : [...shared, clicked]
  return next.length ? next : list
}

const trimmed = (v) => String(v ?? '').trim()

// แถวที่จะส่งไปบันทึก — ไม่มีไฟล์แนบ ไม่มีการมอบหมาย · "ทุกปี" ใช้กับรายการวันเดียว
export function personalPayload(form, { repeatYearly = false } = {}) {
  const category = form?.category === 'อื่นๆ' ? (trimmed(form?.customCategory) || 'อื่นๆ') : trimmed(form?.category)
  return {
    title: trimmed(form?.title),
    description: trimmed(form?.description) || null,
    event_date: form?.event_date || '',
    end_date: repeatYearly ? null : (form?.end_date || null),
    event_time: form?.event_time || null,
    end_time: form?.end_time || null,
    location: trimmed(form?.location) || null,
    category: category || PERSONAL_DEFAULT_CATEGORY,
    repeat_yearly: !!repeatYearly,
  }
}

// ตรวจก่อนบันทึก (ซ้ำกับฐานข้อมูล) จะได้บอกผู้ใช้ทันที — คืนข้อความผิดพลาด หรือ '' ถ้าผ่าน
export function validatePersonalForm(payload, todayStr) {
  if (!payload?.title) return 'กรุณากรอกชื่อรายการ'
  if (payload.title.length > PERSONAL_LIMITS.title) return `ชื่อรายการยาวเกิน ${PERSONAL_LIMITS.title} ตัวอักษร`
  if ((payload.description ?? '').length > PERSONAL_LIMITS.description) return `รายละเอียดยาวเกิน ${PERSONAL_LIMITS.description} ตัวอักษร`
  if ((payload.location ?? '').length > PERSONAL_LIMITS.location) return `สถานที่ยาวเกิน ${PERSONAL_LIMITS.location} ตัวอักษร`
  if ((payload.category ?? '').length > PERSONAL_LIMITS.category) return `ประเภทยาวเกิน ${PERSONAL_LIMITS.category} ตัวอักษร`
  if (!dateParts(payload.event_date)) return 'กรุณาระบุวันที่'
  if (payload.end_date && payload.end_date < payload.event_date) return 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม'
  const max = maxPersonalDate(todayStr)
  if (max && (payload.event_date > max || (payload.end_date ?? '') > max)) {
    return 'รายการส่วนตัวลงล่วงหน้าได้ไม่เกิน 1 ปี ถ้าเป็นเรื่องที่เกิดทุกปี ให้กด "ทุกปี"'
  }
  return ''
}

// ── เต็ม 100 แล้วเขียนทับ ─────────────────────────────────────────────────────────────────────

// รายการที่จะถูกทับเมื่อเพิ่มรายการใหม่ตอนเต็ม — ต้องเลือกตัวเดียวกับ personal_events_guard():
// ไม่ใช่ "ทุกปี" · วันสิ้นสุด (หรือวันที่) ผ่านไปแล้ว · เก่าที่สุด แล้วตามด้วยสร้างก่อน
// คืน null เมื่อไม่มีรายการให้ทับ (ฐานข้อมูลจะปฏิเสธด้วย PE001)
export function overwriteCandidate(personalRows, todayStr) {
  const lastDay = (ev) => ev.end_date || ev.base_date || ev.event_date
  const past = (personalRows ?? []).filter((ev) => !ev.repeat_yearly && lastDay(ev) < todayStr)
  if (past.length === 0) return null
  // เทียบสตริงตรงๆ ไม่ใช้ localeCompare — ต้องได้ลำดับเดียวกับ ORDER BY ของฐานข้อมูล ไม่ขึ้นกับภาษาของเครื่อง
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  return [...past].sort((a, b) =>
    cmp(lastDay(a), lastDay(b))
    || cmp(String(a.created_at ?? ''), String(b.created_at ?? ''))
    || cmp(String(a.id ?? ''), String(b.id ?? '')))[0]
}

// สถานะเพดานสำหรับข้อความในฟอร์ม — full: ครบแล้ว · victim: รายการที่จะถูกทับ (null = บันทึกไม่ได้ ต้องลบเอง)
export function personalQuota(personalRows, todayStr) {
  const used = (personalRows ?? []).length
  const full = used >= PERSONAL_LIMIT
  return { used, full, victim: full ? overwriteCandidate(personalRows, todayStr) : null }
}

export function isPersonalLimitError(error) {
  return error?.code === PERSONAL_LIMIT_CODE
}

export function isPersonalHorizonError(error) {
  return error?.code === PERSONAL_HORIZON_CODE
}
