// ลิงก์ติดตามเรื่องของผู้แจ้ง (/t/<โทเคน>) — ตัวช่วยฝั่งหน้าเว็บ
// กติกาจริงอยู่ที่ฐานข้อมูล: supabase/migrations/20261020160100_complaint_track_token_functions.sql
//
// ทำไมมี: คำร้องส่วนใหญ่ สท. หรือเจ้าหน้าที่ยื่นแทนชาวบ้าน ผู้แจ้งตัวจริงไม่มีบัญชีจึงไม่เห็นความคืบหน้า
// ให้คะแนนไม่ได้ และแจ้งว่ายังไม่เรียบร้อยไม่ได้ ผู้ยื่นกดส่งลิงก์นี้ต่อทาง LINE ได้เลย
//
// ⚠️ ไฟล์นี้ต้องไม่ import supabase หรือ basename (ใช้ import.meta.env) — เทสต์รันด้วย node ตรงๆ
//    ส่วนที่ต้องรู้โดเมนให้หน้าเว็บส่ง url เข้ามาเอง

import { PARKED_LABEL, REOPEN_WINDOW_DAYS } from './complaintWorkflow.js'

// ต้องตรงกับ CHECK complaints_track_token_format ในฐานข้อมูล (สุ่ม 32 ตัวอักษรฐาน 16)
export const TRACK_TOKEN_PATTERN = /^[0-9a-f]{32}$/

export const TRACK_REOPEN_WINDOW_DAYS = REOPEN_WINDOW_DAYS

export function isTrackToken(value) {
  return typeof value === 'string' && TRACK_TOKEN_PATTERN.test(value)
}

export function trackPath(token) {
  return `/t/${token}`
}

// ข้อความที่แนบไปกับลิงก์ตอนแชร์ — ไม่ใส่ชื่อ เบอร์ หรือรายละเอียดเรื่อง (แชร์ผ่านแอปแชตของผู้ใช้ ระบบคุมต่อไม่ได้)
export function trackShareText({ orgName, refNo }) {
  const org = orgName ? ` ${orgName}` : ''
  const ref = refNo ? ` เลขที่ ${refNo}` : ''
  return `ติดตามเรื่องที่แจ้ง${org}${ref} เปิดดูความคืบหน้าและให้คะแนนได้ที่ลิงก์นี้`
}

// คัดลอกข้อความลงคลิปบอร์ด — ใช้ API ใหม่ก่อน ไม่ได้ (เบราว์เซอร์ใน LINE/แอปบางตัวปฏิเสธ) ค่อยถอยไปวิธีเก่า
export async function copyText(text, env = globalThis) {
  try {
    if (env.navigator?.clipboard?.writeText) {
      await env.navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* ลองวิธีถัดไป */ }
  try {
    const doc = env.document
    if (!doc?.body || !doc.execCommand) return false
    const area = doc.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    doc.body.appendChild(area)
    area.select()
    const ok = doc.execCommand('copy')
    doc.body.removeChild(area)
    return Boolean(ok)
  } catch {
    return false
  }
}

/**
 * แชร์ลิงก์ผ่านแผ่นแชร์ของเครื่อง (LINE ฯลฯ) — เครื่องที่ไม่มีให้คัดลอกแทน
 * @returns {Promise<'shared' | 'copied' | 'cancelled' | 'failed'>}
 */
export async function shareTrackLink({ url, text, title }, env = globalThis) {
  const nav = env.navigator
  if (nav?.share) {
    try {
      await nav.share({ title, text, url })
      return 'shared'
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled'
    }
  }
  return (await copyText(url, env)) ? 'copied' : 'failed'
}

// ───── วันเวลา: ปฏิทินพุทธ เวลาไทยเสมอ (เครื่องผู้ใช้ตั้ง timezone อื่นก็ต้องเห็นตรงกัน) ─────
const TH = 'th-TH-u-ca-buddhist'

export function formatTrackDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(TH, { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Asia/Bangkok' })
}

export function formatTrackDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const time = date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' })
  return `${formatTrackDate(value)} · ${time} น.`
}

// วันที่ปิดเรื่อง (เวลาไทย) ไม่เกินวันกำหนดเสร็จ? — ไม่มีวันกำหนดหรือยังไม่ปิด = null (ไม่ตัดสิน)
export function closedOnTime(closedAt, dueDate) {
  if (!closedAt || !dueDate) return null
  const closed = new Date(closedAt)
  if (Number.isNaN(closed.getTime())) return null
  const closedDay = closed.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
  return closedDay <= String(dueDate).slice(0, 10)
}

// ───── ขั้นความคืบหน้า ─────
// 3 ขั้นตามที่ผู้ร้องเข้าใจ: รับเรื่อง → กำลังดำเนินการ → ดำเนินการแล้ว
// state: done = ผ่านแล้ว · now = อยู่ขั้นนี้ · todo = ยังไม่ถึง · stop = ไม่ดำเนินการ · hold = รับไว้แล้วแต่ยังไม่มีกำหนด
const RANK = { new: 1, pending: 1, received: 1, in_progress: 2, done: 3, closed: 3, completed: 3 }
const FINISHED = new Set(['done', 'closed', 'completed'])

export function isTrackFinished(status) {
  return FINISHED.has(status)
}

// เวลาล่าสุดที่เรื่องเข้าสถานะใดสถานะหนึ่ง (ไทม์ไลน์เรียงเก่า → ใหม่) — ใช้ล่าสุดเพราะเรื่องที่แจ้งกลับจะวนกลับมารับเรื่องอีกรอบ
function latestAt(timeline, statuses) {
  let found = null
  for (const entry of Array.isArray(timeline) ? timeline : []) {
    if (statuses.includes(entry?.status) && entry?.at) found = entry.at
  }
  return found
}

export function buildTrackSteps(complaint) {
  const { status, created_at: createdAt, closed_at: closedAt, due_date: dueDate, timeline, is_adhoc: isAdhoc } = complaint ?? {}

  // หมวดเฉพาะกิจไม่ไล่สถานะรายเรื่อง (เจ้าหน้าที่รวบรวมไปวิเคราะห์) บอกแค่ว่าระบบรับเรื่องแล้ว
  if (isAdhoc) {
    return [{ key: 'received', label: 'รับเรื่องแล้ว', at: createdAt ?? null, state: 'done', note: '' }]
  }
  if (status === 'rejected') {
    return [
      { key: 'received', label: 'รับเรื่องแล้ว', at: createdAt ?? null, state: 'done', note: '' },
      { key: 'rejected', label: 'ไม่สามารถดำเนินการได้', at: closedAt ?? latestAt(timeline, ['rejected']), state: 'stop', note: '' },
    ]
  }

  // ขึ้นทะเบียนรอดำเนินการ: ไม่แสดงขั้น "ดำเนินการแล้ว" พร้อมวันกำหนดเสร็จ — ยังไม่มีกำหนด ถ้าโชว์วันที่เดิม
  // ผู้แจ้งจะเข้าใจว่าเลยกำหนดแล้วไม่มีใครทำ · ไม่ใช้ state 'stop' เพราะไม่ใช่การปฏิเสธ
  if (status === 'parked') {
    return [
      { key: 'received', label: 'รับเรื่องแล้ว', at: latestAt(timeline, ['received']) ?? createdAt ?? null, state: 'done', note: '' },
      { key: 'parked', label: PARKED_LABEL, at: latestAt(timeline, ['parked']), state: 'hold', note: 'ยังไม่มีกำหนดดำเนินการ' },
    ]
  }

  const current = RANK[status] ?? 1
  const waiting = status === 'new' || status === 'pending'
  const finished = current === 3

  const steps = [
    { key: 'received', rank: 1, label: waiting ? 'รอเจ้าหน้าที่รับเรื่อง' : 'รับเรื่องแล้ว', at: waiting ? createdAt : (latestAt(timeline, ['received']) ?? createdAt) },
    { key: 'in_progress', rank: 2, label: 'กำลังดำเนินการ', at: latestAt(timeline, ['in_progress']) },
    { key: 'done', rank: 3, label: 'ดำเนินการแล้ว', at: closedAt ?? latestAt(timeline, ['closed', 'done', 'completed']) },
  ]

  return steps.map(({ rank, ...step }) => {
    const state = rank < current ? 'done' : rank === current ? (finished ? 'done' : 'now') : 'todo'
    let note = ''
    if (step.key === 'done') {
      if (state === 'done') note = closedOnTime(closedAt, dueDate) === true ? 'ทันกำหนด' : ''
      else if (dueDate) note = `กำหนดเสร็จภายใน ${formatTrackDate(dueDate)}`
    }
    return { ...step, state, at: state === 'todo' ? null : (step.at ?? null), note }
  })
}

// ───── ข้อความเมื่อทำรายการไม่สำเร็จ (code จากฟังก์ชันฐานข้อมูล) ─────
export const TRACK_RATE_ERRORS = {
  invalid_rating: 'คะแนนไม่ถูกต้อง กรุณาเลือกใหม่',
  not_found: 'ไม่พบเรื่องนี้ในระบบแล้ว',
  not_closed: 'ให้คะแนนได้หลังเรื่องดำเนินการแล้ว',
  staff_cannot_rate: 'เจ้าหน้าที่ให้คะแนนแทนผู้แจ้งไม่ได้',
}

export const TRACK_REOPEN_ERRORS = {
  invalid_reason: 'กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร',
  not_found: 'ไม่พบเรื่องนี้ในระบบแล้ว',
  not_finished: 'แจ้งกลับได้เฉพาะเรื่องที่ดำเนินการแล้ว',
  expired: `เกิน ${REOPEN_WINDOW_DAYS} วันหลังดำเนินการแล้ว กรุณายื่นเรื่องใหม่`,
  already_reopened: 'เรื่องนี้เคยแจ้งกลับแล้ว กรุณายื่นเรื่องใหม่',
  staff_cannot_reopen: 'เจ้าหน้าที่แจ้งกลับแทนผู้แจ้งไม่ได้',
}

export const TRACK_BUSY_MESSAGE = 'ส่งถี่เกินไป กรุณารอสักครู่แล้วลองใหม่'

// ฐานข้อมูลตอบ PT429 เมื่อยิงถี่เกินโควตา — แยกออกจาก "ไม่พบ" และ "เครือข่ายล่ม"
export function isTrackBusy(error) {
  return error?.code === 'PT429' || String(error?.message ?? '').includes('ถี่เกินไป')
}
