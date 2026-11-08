// ฟังก์ชัน pure ของหน้า "ที่ปรึกษา AI" (เฉพาะ Super Admin) — แยกจาก advisorApi.js เพราะไฟล์นั้น
// import supabase.js ซึ่งอ่าน import.meta.env ทำให้ node รันเทสต์ตรงๆ ไม่ได้ (npm run test:advisor)

// รูปแบบชื่อโมเดลเดียวกับ CHECK ของตาราง advisor_settings (migration 20261109120000)
export const ADVISOR_MODEL_RE = /^[a-z0-9][a-z0-9.-]{1,62}$/
export const ADVISOR_MESSAGE_MAX = 8000
export const ADVISOR_DAILY_CAP_MIN = 1
export const ADVISOR_DAILY_CAP_MAX = 1000
export const ADVISOR_TITLE_MAX = 60

// เที่ยงคืนของ "วันนี้เวลาไทย" (UTC+7 ไม่มี DST) เป็น ISO UTC — คำนวณเองจากเลขล้วน
// ห้ามใช้ setHours(0,0,0,0) เพราะผูกกับ timezone ของเครื่อง เครื่องที่ตั้งเขตเวลาอื่นจะนับยอดวันผิด
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
export function bangkokDayStartIso(now = new Date()) {
  const ms = new Date(now).getTime()
  const bangkokMs = ms + BANGKOK_OFFSET_MS
  const startBangkok = bangkokMs - (((bangkokMs % DAY_MS) + DAY_MS) % DAY_MS)
  return new Date(startBangkok - BANGKOK_OFFSET_MS).toISOString()
}

// จัดแถว advisor_messages เป็นรายการบทสนทนา: หัวข้อ = ข้อความ user แรก (ตัด 60 ตัว)
// เรียงเรื่องที่คุยล่าสุดก่อน · แถวเรียงเวลาเก่า→ใหม่ในแต่ละเรื่อง (id ช่วยตัดสินเมื่อเวลาเท่ากัน)
export function groupConversations(rows) {
  const byConv = new Map()
  for (const row of rows ?? []) {
    if (!row?.conversation_id) continue
    if (!byConv.has(row.conversation_id)) byConv.set(row.conversation_id, [])
    byConv.get(row.conversation_id).push(row)
  }
  const time = (r) => Date.parse(r.created_at) || 0
  const list = []
  for (const [id, msgs] of byConv) {
    msgs.sort((a, b) => time(a) - time(b) || Number(a.id ?? 0) - Number(b.id ?? 0))
    const firstUser = msgs.find(m => m.role === 'user' && String(m.content ?? '').trim())
    const title = firstUser
      ? String(firstUser.content).replace(/\s+/g, ' ').trim().slice(0, ADVISOR_TITLE_MAX)
      : 'บทสนทนา'
    list.push({ id, title, lastAt: msgs[msgs.length - 1].created_at, count: msgs.length })
  }
  list.sort((a, b) => (Date.parse(b.lastAt) || 0) - (Date.parse(a.lastAt) || 0))
  return list
}

// ตรวจค่าตั้งค่าก่อนบันทึก — คืนข้อความผิดพลาดภาษาไทย หรือ '' เมื่อผ่าน (ฐานข้อมูลตรวจซ้ำอีกชั้น)
export function validateAdvisorSettings({ model, daily_cap }) {
  const m = String(model ?? '').trim()
  if (!ADVISOR_MODEL_RE.test(m)) {
    return 'ชื่อโมเดลใช้ได้เฉพาะ a-z 0-9 จุด และขีดกลาง ยาว 2–63 ตัว เช่น gemini-2.5-flash'
  }
  const cap = Number(daily_cap)
  if (!Number.isInteger(cap) || cap < ADVISOR_DAILY_CAP_MIN || cap > ADVISOR_DAILY_CAP_MAX) {
    return `เพดานต่อวันต้องเป็นจำนวนเต็ม ${ADVISOR_DAILY_CAP_MIN}–${ADVISOR_DAILY_CAP_MAX}`
  }
  return ''
}

// ข้อความบทสนทนาสำหรับคัดลอกไปถามต่อที่ Claude
export function conversationToText(messages) {
  return (messages ?? [])
    .map(m => `${m.role === 'user' ? 'ฉัน' : 'Gemini'}: ${m.content}`)
    .join('\n\n')
}

// UUID ของบทสนทนาใหม่ — randomUUID ใช้ได้เฉพาะ secure context (https/localhost) จึงมีทางสำรอง
export function newConversationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
