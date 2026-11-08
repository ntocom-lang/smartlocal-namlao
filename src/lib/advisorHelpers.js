// ฟังก์ชัน pure ของหน้า "ที่ปรึกษา AI" (เฉพาะ Super Admin) — แยกจาก advisorApi.js เพราะไฟล์นั้น
// import supabase.js ซึ่งอ่าน import.meta.env ทำให้ node รันเทสต์ตรงๆ ไม่ได้ (npm run test:advisor)

// รูปแบบชื่อโมเดลเดียวกับ CHECK ของตาราง advisor_provider_slots (migration 20261109130000)
export const ADVISOR_MODEL_RE = /^[a-z0-9][a-z0-9.-]{1,62}$/
export const ADVISOR_MESSAGE_MAX = 8000
export const ADVISOR_DAILY_CAP_MIN = 1
export const ADVISOR_DAILY_CAP_MAX = 10000 // ตรงกับ CHECK ของ advisor_provider_slots.daily_cap
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

// ตรวจค่าของ "ช่อง" ก่อนบันทึก — คืน { error, model, daily_cap } · error ว่าง = ผ่าน (ฐานข้อมูลตรวจซ้ำอีกชั้น)
// daily_cap เว้นว่าง = ไม่จำกัด → คืน null (คอลัมน์ daily_cap ของช่องรับ NULL ได้)
export function validateSlotSettings({ model, daily_cap }) {
  const m = String(model ?? '').trim()
  if (!ADVISOR_MODEL_RE.test(m)) {
    return { error: 'ชื่อโมเดลใช้ได้เฉพาะ a-z 0-9 จุด และขีดกลาง ยาว 2–63 ตัว เช่น gemini-2.5-flash', model: m, daily_cap: null }
  }
  const raw = String(daily_cap ?? '').trim()
  if (raw === '') return { error: '', model: m, daily_cap: null }
  const cap = Number(raw)
  if (!/^\d+$/.test(raw) || !Number.isInteger(cap) || cap < ADVISOR_DAILY_CAP_MIN || cap > ADVISOR_DAILY_CAP_MAX) {
    return {
      error: `เพดานต่อวันต้องเป็นจำนวนเต็ม ${ADVISOR_DAILY_CAP_MIN}–${ADVISOR_DAILY_CAP_MAX.toLocaleString('th-TH')} (เว้นว่าง = ไม่จำกัด)`,
      model: m, daily_cap: null,
    }
  }
  return { error: '', model: m, daily_cap: cap }
}

// ชื่อช่อง — claude = "Claude" · gemini + ช่อง 2 = "Gemini จ่ายเงิน" · gemini + ช่อง 3 หรือไม่มีช่อง (ข้อความรอบ 1) = "Gemini ฟรี"
export function slotDisplayName({ provider, slot } = {}) {
  if (provider === 'claude') return 'Claude'
  if (provider === 'gemini' && Number(slot) === 2) return 'Gemini จ่ายเงิน'
  return 'Gemini ฟรี'
}

// ป้ายใต้คำตอบ "ตอบโดย {ช่อง} ({โมเดล})" + หมายเหตุการสลับช่อง (ถ้ามี)
// รับได้ทั้งแถว advisor_messages (provider/slot/model/route_note) และ response ของ Edge Function (answered_by/notes)
export function answerBadge(m) {
  if (!m) return { text: '', note: '' }
  const by = m.answered_by
  const label = by?.label ?? slotDisplayName({ provider: by?.provider ?? m.provider, slot: by?.slot ?? m.slot })
  const model = by?.model ?? m.model
  const note = Array.isArray(m.notes) ? m.notes.filter(Boolean).join(' · ') : String(m.route_note ?? '')
  return { text: model ? `ตอบโดย ${label} (${model})` : `ตอบโดย ${label}`, note: note.trim() }
}

// ยอดใช้วันนี้ของช่องที่ตอบ "{used} / {cap}" (cap ว่าง = ไม่จำกัด)
export function usageText(used, cap) {
  if (!Number.isFinite(used)) return ''
  return `${used.toLocaleString('th-TH')} / ${cap == null ? 'ไม่จำกัด' : Number(cap).toLocaleString('th-TH')}`
}

export const PAUSE_REASON_LABEL = { billing: 'เครดิตหมด', rate_limit: 'ถูกจำกัดความถี่', quota: 'โควตาเต็ม' }

// HH:MM เวลาไทย (UTC+7 ไม่ผูกกับ timezone เครื่อง)
export function bangkokClockText(value) {
  const ms = new Date(value).getTime()
  if (Number.isNaN(ms)) return ''
  const local = new Date(ms + BANGKOK_OFFSET_MS)
  return `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`
}

// ช่องถูกพักอยู่ไหม (paused_until อยู่ในอนาคต)
export function isSlotPaused(slot, now = new Date()) {
  if (!slot?.paused_until) return false
  const until = new Date(slot.paused_until).getTime()
  return Number.isFinite(until) && until > new Date(now).getTime()
}

// ข้อความบทสนทนาสำหรับคัดลอกไปถามต่อที่ Claude (คำตอบระบุช่องที่ตอบ; ข้อความรอบ 1 ไม่มี provider = Gemini ฟรี)
export function conversationToText(messages) {
  return (messages ?? [])
    .map(m => `${m.role === 'user' ? 'ฉัน' : slotDisplayName(m)}: ${m.content}`)
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
