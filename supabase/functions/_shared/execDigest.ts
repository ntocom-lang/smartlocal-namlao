// ตรรกะล้วนของ "สรุปเช้าผู้บริหาร + แจ้งคะแนนต่ำ" (ห้องผู้บริหาร E3-3) — ใช้ใน exec-digest-notify และเทสต์ node import ตรง
// ห้ามแตะ Deno/fetch/Supabase ในไฟล์นี้ เทสต์รันด้วย node (type stripping) ได้ทันที
//
// ข้อมูลเข้ามาจาก exec_digest_for() / exec_low_ratings_pending() (migration 20261118100100) เท่านั้น
// สัญญาข้อมูลอยู่ที่หัวไฟล์ migration นั้น — ไม่มีชื่อผู้ร้อง/ผู้ประเมิน/ความเห็น/รายละเอียดเรื่อง (PDPA: ลบย้อนหลังจาก Telegram ไม่ได้)
// ข้อความมีเฉพาะ จำนวน / เลขที่ / หมวด / กอง / สถานะ / วันที่ / ชื่อกิจกรรม (ชื่อกิจกรรมต้อง esc ทุกครั้ง)

import { clean, documentTypeLabel, esc, isUuid, thaiDate } from './execNudge.ts'

/** Telegram ส่งข้อความได้ไม่เกิน 4096 ตัว — เกินแล้ว API ปฏิเสธทั้งฉบับ (ไม่ตัดให้) */
export const TELEGRAM_MAX = 4096

export const DIGEST_NOTIFICATION_TYPE = 'exec_digest'
export const LOW_RATING_NOTIFICATION_TYPE = 'exec_low_rating'
export const DIGEST_JOB = 'exec-digest-notify'
export const LOW_RATING_JOB = 'exec-low-rating-alert'

/** แจ้งคะแนนต่ำ: แสดงในข้อความไม่เกินนี้ ที่เหลือเขียนเป็น "และอีก N รายการ" */
export const LOW_RATING_MAX_LINES = 10

export const NO_DEPT = 'ไม่ระบุกอง'

// ───────────────────────── ป้ายสถานะ ─────────────────────────

// ⚠️ สำเนาของ itemStatusLabel ใน src/lib/execFollowNudgeHelpers.js (edge function import โค้ดเว็บไม่ได้)
// เทสต์ tests/exec-digest-notify.test.mjs เทียบทุกสถานะกับของเว็บ — แก้ที่ใดที่หนึ่งแล้วลืมอีกที่ = เทสต์ล้ม
// (ไม่ใช้ COMPLAINT_STATUS ของ execNudge.ts: ชุดนั้นมีเฉพาะสถานะ "ค้าง" แต่สรุปเช้าต้องบอกสถานะ "เสร็จ/ปิด" ด้วย)
const COMPLAINT_STATUS: Record<string, string> = {
  new: 'คำร้องใหม่', pending: 'คำร้องใหม่', received: 'รับเรื่องแล้ว',
  in_progress: 'กำลังดำเนินการ', parked: 'ขึ้นทะเบียนรอดำเนินการ', done: 'ดำเนินการแล้ว', closed: 'ดำเนินการแล้ว',
  rejected: 'ปฏิเสธ',
}
const DOCUMENT_STATUS: Record<string, string> = {
  pending: 'รอดำเนินการ', processing: 'กำลังดำเนินการ', completed: 'เสร็จสิ้น', rejected: 'ปฏิเสธ',
}

/** ป้ายสถานะ — คำร้องกับคำขอใช้ชื่อต่างกัน · สถานะที่ไม่รู้จักแสดงตามที่ได้ · ว่าง = "ไม่ระบุสถานะ" */
export function statusLabel(kind: unknown, status: unknown): string {
  const key = clean(status, 30)
  const table = kind === 'document_request' ? DOCUMENT_STATUS : COMPLAINT_STATUS
  return table[key] ?? (key || 'ไม่ระบุสถานะ')
}

export const RATING_SOURCE_LABEL: Record<string, string> = {
  proxy: 'สท. บันทึกแทน',
  verified: 'ผู้ยื่นประเมินเอง',
  via_link: 'ผู้ถือลิงก์ติดตามเรื่อง',
  linked_anon: 'ไม่ได้ล็อกอิน',
}

// ───────────────────────── ชนิดข้อมูล (ปรับรูปแล้ว) ─────────────────────────

export type OverdueTop = { k: string; ref: string; cat: string; catLabel: string; dept: string; wd: number }
export type FollowItem = { k: string; ref: string; state: 'changed' | 'done' | 'gone'; from: string; to: string }
export type EventItem = { title: string; time: string }

export type Digest = {
  asOf: string
  windowFrom: string
  newComplaints: number
  newRequests: number
  overdue: { total: number; truncated: boolean; sensitive: number; over5: number; top: OverdueTop[] }
  esign: { count: number; over2wd: number }
  follows: { items: FollowItem[]; more: number }
  events: { items: EventItem[]; more: number }
}

export type LowRating = {
  rating: number
  source: string
  ratedAt: string
  sensitive: boolean
  ref: string
  catLabel: string
  dept: string
}

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(obj) : [])
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)

/**
 * ผลของ exec_digest_for → รูปที่ใช้สร้างข้อความ · ok:false / ไม่ใช่ object / ไม่มี as_of = null (ข้าม ไม่ส่ง)
 * ทุกช่องมีค่าตั้งต้น — ฐานเพิ่มช่องใหม่หรือบางช่องหายแล้วข้อความต้องไม่พัง
 */
export function readDigest(raw: unknown): Digest | null {
  const r = obj(raw)
  if (r.ok !== true || !isDate(r.as_of)) return null
  const win = obj(r.window)
  const nw = obj(r.new)
  const ov = obj(r.overdue)
  const es = obj(r.esign)
  const fo = obj(r.follows)
  const ev = obj(r.events)
  return {
    asOf: String(r.as_of).slice(0, 10),
    windowFrom: isDate(win.from) ? String(win.from).slice(0, 10) : String(r.as_of).slice(0, 10),
    newComplaints: num(nw.complaints),
    newRequests: num(nw.requests),
    overdue: {
      total: num(ov.total),
      truncated: ov.truncated === true,
      sensitive: num(ov.sensitive),
      over5: num(ov.over5),
      top: arr(ov.top).map((t) => ({
        k: clean(t.k, 20), ref: clean(t.ref, 40), cat: clean(t.cat, 60), catLabel: clean(t.cat_label, 80),
        dept: clean(t.dept, 80), wd: num(t.wd),
      })),
    },
    esign: { count: num(es.count), over2wd: num(es.over_2wd) },
    follows: {
      items: arr(fo.items)
        .filter((i) => i.state === 'changed' || i.state === 'done' || i.state === 'gone')
        .map((i) => ({
          k: clean(i.k, 20), ref: clean(i.ref, 40), state: i.state as FollowItem['state'],
          from: clean(i.from, 30), to: clean(i.to, 30),
        })),
      more: num(fo.more),
    },
    events: {
      items: arr(ev.items).map((e) => ({ title: clean(e.title, 120), time: clean(e.event_time, 12) })),
      more: num(ev.more),
    },
  }
}

/** ทุกหมวดว่าง = ไม่ส่ง (วันเงียบๆ ไม่ปลุกผู้บริหารด้วยข้อความว่างเปล่า) */
export function isEmptyDigest(d: Digest): boolean {
  return d.newComplaints === 0 && d.newRequests === 0
    && d.esign.count === 0
    && d.overdue.total === 0 && d.overdue.sensitive === 0
    && d.follows.items.length === 0
    && d.events.items.length === 0
}

// ───────────────────────── สรุปเช้า ─────────────────────────

/** "09:00:00" / "09:00" → "09:00" · ว่าง/อ่านไม่ได้ = "ทั้งวัน" */
export function eventTimeLabel(value: string): string {
  const m = /^(\d{2}):(\d{2})/.exec(clean(value, 12))
  return m ? `${m[1]}:${m[2]}` : 'ทั้งวัน'
}

type Caps = { top: number; follows: number; events: number }
const FULL_CAPS: Caps = { top: 5, follows: 20, events: 8 }

function followLine(i: FollowItem): string {
  const ref = `<b>${esc(i.ref || '-', 40)}</b>`
  if (i.state === 'gone') return `• ${ref} ไม่พบเรื่องนี้แล้ว (เลิกติดตามให้แล้ว)`
  if (i.state === 'done') return `• ${ref} ${esc(statusLabel(i.k, i.to), 40)} (เลิกติดตามให้แล้ว)`
  return i.from
    ? `• ${ref} ${esc(statusLabel(i.k, i.from), 40)} → ${esc(statusLabel(i.k, i.to), 40)}`
    // from ว่าง = เพิ่งเริ่มติดตามยังไม่เคยแจ้งสถานะ — แสดงสถานะปัจจุบันอย่างเดียว ไม่เดาสถานะเดิม
    : `• ${ref} สถานะตอนนี้ ${esc(statusLabel(i.k, i.to), 40)}`
}

function render(d: Digest, tenantName: string, feeSchedule: unknown, caps: Caps): string {
  const L: string[] = []
  L.push(`☀️ <b>สรุปเช้า ${esc(tenantName || 'SmartLocal', 120)}</b>`)
  L.push(esc(thaiDate(d.asOf)))
  L.push('')
  L.push(`เรื่องใหม่ (ตั้งแต่ ${esc(thaiDate(d.windowFrom))}): คำร้อง ${d.newComplaints} · คำขอ ${d.newRequests}`)

  if (d.esign.count > 0) {
    L.push(`✍️ รอท่านลงนาม ${d.esign.count} ใบ`)
    if (d.esign.over2wd > 0) L.push(`<b>⚠️ ถึงคิวท่านเกิน 2 วันทำการ ${d.esign.over2wd} ใบ</b>`)
  }

  const ov = d.overdue
  if (ov.total > 0 || ov.sensitive > 0) {
    // ถูกตัดที่ 300 แถวฝั่งฐาน — ตัวเลขจริงอาจมากกว่านี้ ห้ามเขียนเหมือนนับครบ
    const atLeast = ov.truncated ? 'อย่างน้อย ' : ''
    L.push(`⏰ เลยกำหนด ${atLeast}${ov.total} เรื่อง${ov.sensitive > 0
      ? ` (หมวดคุ้มครองผู้ร้อง ${ov.sensitive} เรื่อง — แสดงเป็นยอดรวม)` : ''}`)
  }
  if (ov.over5 > 0) {
    L.push(`<b>🔴 เลยกำหนดเกิน 5 วันทำการ ${ov.truncated ? 'อย่างน้อย ' : ''}${ov.over5} เรื่อง</b>`)
    const shown = ov.top.slice(0, caps.top)
    for (const t of shown) {
      const type = t.k === 'document_request'
        ? documentTypeLabel(t.cat, feeSchedule)
        : t.catLabel || t.cat || 'ไม่ระบุหมวด'
      L.push(`• ${esc(t.ref || '-', 40)} ${esc(type, 80)} · ${esc(t.dept || NO_DEPT, 80)} · เลย ${t.wd} วันทำการ`)
    }
    const hidden = ov.over5 - shown.length
    if (hidden > 0) L.push(`และอีก ${hidden} เรื่อง`)
  }

  const fo = d.follows
  if (fo.items.length > 0) {
    L.push('', '⭐ <b>เรื่องที่ท่านติดตาม</b>')
    const shown = fo.items.slice(0, caps.follows)
    for (const i of shown) L.push(followLine(i))
    const hidden = fo.more + (fo.items.length - shown.length)
    if (hidden > 0) L.push(`และอีก ${hidden} เรื่อง`)
  }

  const ev = d.events
  if (ev.items.length > 0) {
    L.push('', '📅 <b>กำหนดการวันนี้</b>')
    const shown = ev.items.slice(0, caps.events)
    for (const e of shown) L.push(`• ${esc(eventTimeLabel(e.time))} ${esc(e.title, 120)}`)
    const hidden = ev.more + (ev.items.length - shown.length)
    if (hidden > 0) L.push(`และอีก ${hidden} รายการ`)
  }

  L.push('', 'ดูรายละเอียดที่เมนู ห้องผู้บริหาร · ปิดรับสรุปเช้าได้ที่ ตั้งค่าแจ้งเตือน')
  return L.join('\n')
}

/**
 * ข้อความสรุปเช้า (HTML ตาม sendTelegramMessage) — ยาวเกิน 4096 ให้ลดจำนวนบรรทัดรายการ (กิจกรรม → เรื่องติดตาม → เรื่องเลยกำหนด)
 * ไม่ตัดกลางข้อความ เพื่อไม่ทิ้งแท็ก HTML ค้างแล้ว Telegram ปฏิเสธทั้งฉบับ
 */
export function buildDigestMessage(args: { digest: Digest; tenantName: string; feeSchedule?: unknown }): string {
  const { digest, tenantName, feeSchedule = null } = args
  const caps: Caps = { ...FULL_CAPS }
  let text = render(digest, tenantName, feeSchedule, caps)
  const order: (keyof Caps)[] = ['events', 'follows', 'top']
  for (const key of order) {
    while (text.length > TELEGRAM_MAX && caps[key] > 0) {
      caps[key] = Math.max(0, caps[key] - (key === 'follows' ? 5 : 1))
      text = render(digest, tenantName, feeSchedule, caps)
    }
  }
  return text
}

// ───────────────────────── แจ้งคะแนนต่ำ ─────────────────────────

export function readLowRatings(raw: unknown): { municipalityId: string; ratingId: string; value: LowRating }[] {
  if (!Array.isArray(raw)) return []
  const out: { municipalityId: string; ratingId: string; value: LowRating }[] = []
  for (const row of raw.map(obj)) {
    if (!isUuid(row.municipality_id) || !isUuid(row.rating_id)) continue
    const rating = Number(row.rating)
    if (!Number.isFinite(rating)) continue
    out.push({
      municipalityId: String(row.municipality_id),
      ratingId: String(row.rating_id),
      value: {
        rating: Math.min(5, Math.max(0, Math.round(rating))),
        source: clean(row.source, 20),
        ratedAt: clean(row.rated_at, 40),
        // ไม่รู้ว่าอ่อนไหวไหม (ค่าไม่ใช่ boolean) = ถือว่าอ่อนไหว ไม่ปล่อยเลขที่ออกไป
        sensitive: row.sensitive !== false,
        ref: clean(row.ref, 40),
        catLabel: clean(row.cat_label, 80),
        dept: clean(row.dept, 80),
      },
    })
  }
  return out
}

/** "14:05 น. 11 พ.ย. 2569" — เวลาไทยเสมอ (เครื่อง edge เป็น UTC) · อ่านไม่ได้ = "-" */
export function thaiDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' })
  const ymd = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
  return `${hm} น. ${thaiDate(ymd)}`
}

export function lowRatingLine(r: LowRating): string {
  const head = `• ⭐${r.rating}/5`
  if (r.sensitive) return `${head} เรื่องหมวดคุ้มครองผู้ร้อง · ${esc(r.dept || NO_DEPT, 80)}`
  const source = RATING_SOURCE_LABEL[r.source] ?? 'ไม่ทราบที่มา'
  return `${head} ${esc(r.ref || '-', 40)} ${esc(r.catLabel || 'ไม่ระบุหมวด', 80)} · ${esc(r.dept || NO_DEPT, 80)} · ${esc(source, 40)} · ${esc(thaiDateTime(r.ratedAt))}`
}

/** ข้อความรวมฉบับเดียวต่อผู้รับ — แสดงไม่เกิน 10 บรรทัด ที่เหลือบอกจำนวน */
export function buildLowRatingMessage(args: { ratings: LowRating[]; tenantName: string }): string {
  const { ratings, tenantName } = args
  const shown = ratings.slice(0, LOW_RATING_MAX_LINES)
  const L = [`⚠️ <b>คะแนนความพึงพอใจต่ำ ${ratings.length} รายการ — ${esc(tenantName || 'SmartLocal', 120)}</b>`, '']
  for (const r of shown) L.push(lowRatingLine(r))
  const hidden = ratings.length - shown.length
  if (hidden > 0) L.push(`และอีก ${hidden} รายการ — ดูที่ห้องผู้บริหาร`)
  L.push('', 'ปิดรับการแจ้งนี้ได้ที่ ตั้งค่าแจ้งเตือน')
  return L.join('\n')
}

// ───────────────────────── กุญแจกันส่งซ้ำ ─────────────────────────
// ห้ามใส่ chat_id / ชื่อคน — admin อ่านตาราง notification_deliveries ได้ มีแต่รหัสภายใน (uuid) กับวันที่

export function digestKey(asOf: string, userId: string): string {
  return `exec_digest:${asOf}:${userId}`
}

export function lowRatingKey(ratingId: string, userId: string): string {
  return `exec_low_rating:${ratingId}:${userId}`
}
