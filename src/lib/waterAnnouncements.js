// ประกาศน้ำ-ฝนของ อปท. ที่มีผู้ยืนยัน (เฟส 2 · PR 2.2) — ตรรกะล้วน ห้าม import supabase (เทสต์ node tests/water-announcements.test.mjs import ตรง)
//
// ข้อมูลมาจากฟังก์ชันฐานข้อมูล (migration 20261020100100 + 20261020130100):
//   หน้าประชาชน  get_public_water_announcement   → ฉบับที่ยืนยันแล้วและยังไม่หมดอายุเท่านั้น (ไม่มีชื่อผู้ยืนยัน)
//   หน้าเจ้าหน้าที่ list_water_announcements        → ร่างรอยืนยัน · ฉบับที่ใช้อยู่ · ประวัติ · can_approve
// ระบบร่าง คนกดยืนยัน — ไม่มีคนกด = ไม่มีอะไรออก · ไฟล์นี้ไม่ตัดสินเรื่องประกาศเอง แค่แปลงข้อมูลเป็นข้อความบนหน้าจอ
import { thaiDateTime } from './waterEvents.js'

// ⚠️ ต้องตรงกับ c_draft_life ใน water_announcement_tick / approve_water_announcement / water_announcement_todo (เทสต์เทียบให้)
export const DRAFT_LIFE_HOURS = 3
export const DEFAULT_EXPIRY_HOURS = 24
export const MAX_EXPIRY_HOURS = 72
export const MAX_APPROVERS = 5
export const AUTHORITY_NOTE_MAX = 300
export const PUBLIC_REFRESH_MS = 5 * 60 * 1000
const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000

export const STATUS_LABELS = {
  draft: 'ร่างรอยืนยัน',
  published: 'เผยแพร่อยู่',
  declined: 'เลือกไม่ประกาศ',
  cancelled: 'ยกเลิกแล้ว',
  superseded: 'ถูกฉบับใหม่แทนที่',
  expired: 'หมดอายุ',
  lapsed: 'ร่างที่ไม่ได้ใช้',
}

const ROLE_LABELS = { admin: 'ผู้ดูแลระบบ', officer: 'หัวหน้ากอง', staff: 'เจ้าหน้าที่' }
export const roleLabel = (role) => ROLE_LABELS[role] ?? ''

const toMs = (value) => {
  if (value === null || value === undefined || value === '') return null
  const ms = typeof value === 'number' ? value : Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

/**
 * ฉบับที่ยังใช้อยู่ ณ เวลา nowMs หรือไม่ — ตัดสินจากเวลาหมดอายุเอง ไม่พึ่งสถานะที่เก็บ (cron เก็บสถานะช้ากว่าได้)
 * ครบอายุ = หายทันที · ไม่มีเวลาหมดอายุ/อ่านไม่ออก = ไม่แสดง (ไม่เดาว่ายังใช้ได้)
 */
export function isActive(announcement, nowMs) {
  const exp = toMs(announcement?.expires_at)
  const now = toMs(nowMs)
  return Boolean(announcement?.body) && exp !== null && now !== null && exp > now
}

/**
 * เวลา "ตอนนี้" ที่ใช้นับหมดอายุ = นาฬิกาเครื่อง + ส่วนต่างจากนาฬิกาเซิร์ฟเวอร์ตอนโหลด (server_now)
 * เครื่องที่ตั้งเวลาเพี้ยนจะไม่แสดงประกาศที่หมดอายุแล้ว/ไม่ซ่อนประกาศที่ยังใช้ได้ผิดเวลา
 * ไม่มี server_now = ส่วนต่าง 0
 */
export function clockOffsetMs(serverNow, deviceNowMs) {
  const server = toMs(serverNow)
  const device = toMs(deviceNowMs)
  return server === null || device === null ? 0 : server - device
}

/** "เหลืออีก 5 ชม. 20 นาที" / "เหลืออีก 12 นาที" / "ใกล้หมดอายุ" / "หมดอายุแล้ว" */
export function remainingText(expiresAt, nowMs) {
  const exp = toMs(expiresAt)
  const now = toMs(nowMs)
  if (exp === null || now === null) return ''
  const left = exp - now
  if (left <= 0) return 'หมดอายุแล้ว'
  if (left < MINUTE_MS) return 'ใกล้หมดอายุ'
  const hours = Math.floor(left / HOUR_MS)
  const minutes = Math.floor((left % HOUR_MS) / MINUTE_MS)
  if (hours === 0) return `เหลืออีก ${minutes} นาที`
  return minutes === 0 ? `เหลืออีก ${hours} ชม.` : `เหลืออีก ${hours} ชม. ${minutes} นาที`
}

/** บรรทัดของข้อความประกาศ (ตัดบรรทัดว่างหัวท้าย เก็บบรรทัดว่างตรงกลางไว้เป็นย่อหน้า) */
export function bodyLines(body) {
  return String(body ?? '').replace(/\r\n/g, '\n').split('\n').map(line => line.trimEnd())
    .reduce((acc, line) => (line === '' && (acc.length === 0 || acc[acc.length - 1] === '') ? acc : [...acc, line]), [])
    .filter((line, i, arr) => !(line === '' && i === arr.length - 1))
}

/**
 * ข้อมูลที่หน้าประชาชนแสดง — ไม่ active = null (ไม่แสดงอะไร)
 * ไม่มีชื่อผู้ยืนยัน (ฐานข้อมูลไม่ส่งมา) แสดงแค่ว่า "ผ่านการยืนยันจากเจ้าหน้าที่ที่หน่วยงานกำหนดแล้ว"
 */
export function publicView(announcement, nowMs) {
  if (!isActive(announcement, nowMs)) return null
  return {
    id: announcement.id,
    issuer: announcement.issuer || '',
    lines: bodyLines(announcement.body),
    publishedText: announcement.published_at ? thaiDateTime(announcement.published_at) : '',
    expiresText: thaiDateTime(announcement.expires_at),
    remaining: remainingText(announcement.expires_at, nowMs),
  }
}

/** "ร่างนี้ยืนยันได้ถึง 21:42 น." — ร่างเก่ากว่า 3 ชม. ระบบถือว่าค่าที่วัดไว้ไม่สดแล้ว ต้องรอร่างใหม่ */
export function draftDeadline(draftedAt) {
  const ms = toMs(draftedAt)
  return ms === null ? null : ms + DRAFT_LIFE_HOURS * HOUR_MS
}
export function draftCanApprove(draftedAt, nowMs) {
  const deadline = draftDeadline(draftedAt)
  const now = toMs(nowMs)
  return deadline !== null && now !== null && deadline > now
}

/** ผลที่ฐานข้อมูลคืนมาเมื่อกดแล้วทำไม่ได้ (ไม่ใช่ error) → ข้อความที่คนอ่านแล้วรู้ว่าต้องทำอะไรต่อ */
export function actionFailureText(reason) {
  switch (reason) {
    case 'disabled': return 'ประกาศน้ำ-ฝนของหน่วยงานนี้ถูกปิดอยู่ ยังเผยแพร่ไม่ได้'
    case 'already_handled': return 'ประกาศฉบับนี้ถูกจัดการไปแล้ว (อาจมีผู้มีสิทธิ์อีกคนกดไปก่อน) — โหลดหน้าใหม่เพื่อดูสถานะล่าสุด'
    case 'event_closed': return 'เหตุการณ์นี้สิ้นสุดแล้ว ร่างนี้จึงใช้เผยแพร่ไม่ได้ — ระบบจะร่างใหม่เองเมื่อมีเหตุการณ์ใหม่'
    case 'draft_too_old': return `ร่างนี้เก่าเกิน ${DRAFT_LIFE_HOURS} ชั่วโมง ค่าที่วัดไว้อาจไม่เป็นปัจจุบันแล้ว จึงเผยแพร่ไม่ได้ — ระบบจะร่างใหม่ให้เองในรอบตรวจถัดไป`
    case 'not_active': return 'ประกาศฉบับนี้หมดอายุหรือถูกยกเลิกไปแล้ว'
    case 'not_staff': return 'บัญชีนี้ตั้งเป็นผู้มีสิทธิ์ยืนยันไม่ได้ (ต้องเป็นผู้ดูแลระบบ หัวหน้ากอง หรือเจ้าหน้าที่ของหน่วยงานนี้)'
    case 'max_reached': return `ตั้งผู้มีสิทธิ์ยืนยันได้ไม่เกิน ${MAX_APPROVERS} คน — ถอนสิทธิ์ของคนเดิมก่อน`
    default: return 'ทำรายการไม่สำเร็จ'
  }
}

/** error จาก supabase.rpc → ข้อความ (ไม่แสดงข้อความดิบของฐานข้อมูล) */
export function describeRpcError(error) {
  const code = error?.code
  const message = String(error?.message || '')
  if (code === '42501') return 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้'
  if (code === '22023') return message.includes('ยาวเกิน') ? `ข้อความอ้างอิงอำนาจยาวเกิน ${AUTHORITY_NOTE_MAX} ตัวอักษร` : 'ข้อมูลที่ส่งไม่ถูกต้อง'
  if (code === 'PGRST202' || code === '42883' || /could not find the function/i.test(message)) {
    return 'ระบบฐานข้อมูลยังไม่พร้อมสำหรับส่วนประกาศ (ยังไม่ได้ติดตั้งฟังก์ชัน)'
  }
  return 'ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
}

/** error ที่แปลว่า "ส่วนประกาศไม่พร้อม/ไม่มีสิทธิ์ดู" — หน้าเจ้าหน้าที่ซ่อนส่วนนี้เงียบๆ ไม่ขึ้นข้อความผิดพลาดให้ อปท. ที่ไม่ได้ใช้ */
export function isQuietListError(error) {
  const code = error?.code
  const message = String(error?.message || '')
  return code === '42501' || code === 'PGRST202' || code === '42883' || /could not find the function/i.test(message)
}

/** หน้าแรกเจ้าหน้าที่: ผลของ water_announcement_todo → จำนวนงานรอ (0/1) — ไม่ใช่ผู้ยืนยัน/ไม่มีร่าง = 0 */
export function todoCount(data) {
  return data && data.can_approve === true && data.pending === true ? 1 : 0
}

/** ข้อความสถานะของฉบับในประวัติ: "เผยแพร่ 20 ต.ค. 69 10:20 น. – หมดอายุ 21 ต.ค. 69 10:20 น." */
export function historyLine(row, nowMs) {
  // สถานะ published แต่เลยเวลาหมดอายุแล้ว (cron ยังไม่ได้เก็บสถานะ) = แสดงว่า "หมดอายุ" — ตัดสินจากเวลาอย่างเดียว ไม่เกี่ยวกับข้อความ
  const exp = toMs(row.expires_at)
  const now = toMs(nowMs)
  const lapsed = row.status === 'published' && exp !== null && now !== null && exp <= now
  const label = lapsed ? STATUS_LABELS.expired : (STATUS_LABELS[row.status] ?? row.status)
  const parts = [label]
  if (row.published_at) parts.push(`เผยแพร่ ${thaiDateTime(row.published_at)}`)
  else if (row.drafted_at) parts.push(`ร่างเมื่อ ${thaiDateTime(row.drafted_at)}`)
  if (row.closed_at && row.status !== 'expired') parts.push(`ปิดเมื่อ ${thaiDateTime(row.closed_at)}`)
  else if (row.expires_at && (row.status === 'expired' || row.status === 'published')) parts.push(`หมดอายุ ${thaiDateTime(row.expires_at)}`)
  return parts.join(' · ')
}
