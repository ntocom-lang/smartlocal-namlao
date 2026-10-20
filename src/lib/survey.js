// แบบสำรวจความเห็นประชาชน — ตัวช่วยฝั่งหน้าเว็บ
// กติกาจริงอยู่ที่ฐานข้อมูล: supabase/migrations/20261020170000_community_survey_tables.sql + 20261020170100_..._functions.sql
// ค่าคงที่ในไฟล์นี้ต้องตรงกับ SQL ทุกตัว — tests/community-survey.test.mjs อ่านทั้งสองฝั่งมาเทียบให้
//
// ⚠️ ไฟล์นี้ต้องไม่ import supabase หรือ basename (ใช้ import.meta.env) — เทสต์รันด้วย node ตรงๆ
//
// ผลแบบสำรวจคือ "ความเห็นประกอบการพิจารณา ไม่ใช่มติ" และห้ามอ้างแทนประชาคมตามระเบียบจัดทำแผนพัฒนาท้องถิ่น
// (ต้องยืนยันกับฉบับปัจจุบัน) — ป้ายนี้ต้องขึ้นทุกหน้าที่แสดงคำถาม/ผล (SURVEY_NOT_A_VOTE_NOTICE)

export const SURVEY_QUESTION_MIN = 5
export const SURVEY_QUESTION_MAX = 200
export const SURVEY_OPTIONS_MIN = 2
export const SURVEY_OPTIONS_MAX = 5
export const SURVEY_OPTION_MAX = 100
export const SURVEY_COMMENT_MAX = 300
export const SURVEY_MAX_OPEN = 3
export const SURVEY_DEFAULT_DAYS = 14
export const SURVEY_MAX_DAYS = 90
export const SURVEY_COMMENT_KEEP_DAYS = 90
// ระยะเวลาเปิดรับที่เลือกได้ในฟอร์มเจ้าหน้าที่ (ทุกค่าอยู่ในช่วงที่ฐานข้อมูลรับ: เกิน 1 ชั่วโมง ไม่เกิน SURVEY_MAX_DAYS)
export const SURVEY_DAY_CHOICES = [7, 14, 30, 60]

export const SURVEY_NOT_A_VOTE_NOTICE = 'ความเห็นประกอบการพิจารณา ไม่ใช่มติและไม่ใช่การประชาคม'

const SURVEY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function isSurveyId(value) {
  return typeof value === 'string' && SURVEY_ID_PATTERN.test(value)
}

export function surveyPath(id) {
  return `/survey/${id}`
}

// ข้อความที่แนบไปกับลิงก์ตอนแชร์ — มีแค่ชื่อหน่วยงานกับคำเชิญ (แชร์ผ่านแอปแชตของผู้ใช้ ระบบคุมต่อไม่ได้)
export function surveyShareText({ orgName }) {
  const org = orgName ? `ของ ${orgName}` : ''
  return `ร่วมตอบแบบสำรวจความเห็น${org} ใช้เวลาไม่ถึง 1 นาที`
}

// แม่แบบให้เจ้าหน้าที่เลือกแทนการพิมพ์เอง — ข้อความเป็นตัวอย่าง อปท. แก้ได้ก่อนเผยแพร่
export const SURVEY_TEMPLATES = [
  {
    key: 'priority',
    label: 'ควรทำเรื่องใดก่อน',
    question: 'ปีงบประมาณหน้า ควรให้หน่วยงานทำเรื่องใดก่อน?',
    options: ['ซ่อมถนนและทางเข้าหมู่บ้าน', 'เพิ่มไฟส่องสว่างสาธารณะ', 'ระบบประปาและแหล่งน้ำ', 'ทางระบายน้ำและป้องกันน้ำท่วม'],
  },
  {
    key: 'satisfaction',
    label: 'พอใจบริการหรือไม่',
    question: 'ท่านพอใจกับการให้บริการของหน่วยงานในรอบปีที่ผ่านมามากน้อยเพียงใด?',
    options: ['พอใจมาก', 'พอใจ', 'ไม่ค่อยพอใจ', 'ไม่พอใจ'],
  },
  { key: 'blank', label: 'เปิดว่าง', question: '', options: ['', ''] },
]

/**
 * ตรวจฟอร์มสร้างแบบสำรวจก่อนส่ง (ซ้ำกับที่ฐานข้อมูลตรวจ เพื่อบอกผู้ใช้ก่อนยิงคำขอ)
 * ตัดช่องตัวเลือกที่เว้นว่างทิ้งก่อน — ฐานข้อมูลถือว่าตัวเลือกว่างคือข้อผิดพลาด
 * @returns {{ ok: boolean, errors: { question?: string, options?: string }, clean: { question: string, options: string[] } }}
 */
export function validateSurveyDraft({ question, options }) {
  const q = String(question ?? '').trim()
  const opts = (options ?? []).map(o => String(o ?? '').trim()).filter(Boolean)
  const errors = {}
  if (q.length < SURVEY_QUESTION_MIN) errors.question = `คำถามต้องยาวอย่างน้อย ${SURVEY_QUESTION_MIN} ตัวอักษร`
  else if (q.length > SURVEY_QUESTION_MAX) errors.question = `คำถามต้องไม่เกิน ${SURVEY_QUESTION_MAX} ตัวอักษร`

  if (opts.length < SURVEY_OPTIONS_MIN) errors.options = `ต้องมีตัวเลือกอย่างน้อย ${SURVEY_OPTIONS_MIN} ข้อ`
  else if (opts.length > SURVEY_OPTIONS_MAX) errors.options = `ตัวเลือกต้องไม่เกิน ${SURVEY_OPTIONS_MAX} ข้อ`
  else if (opts.some(o => o.length > SURVEY_OPTION_MAX)) errors.options = `ตัวเลือกแต่ละข้อต้องไม่เกิน ${SURVEY_OPTION_MAX} ตัวอักษร`
  else if (new Set(opts.map(o => o.toLowerCase())).size !== opts.length) errors.options = 'มีตัวเลือกซ้ำกัน กรุณาแก้ให้ต่างกัน'

  return { ok: Object.keys(errors).length === 0, errors, clean: { question: q, options: opts } }
}

// เวลาปิดรับ = ตอนนี้ + จำนวนวันที่เลือก (ฐานข้อมูลกำหนดช่วงที่รับ: เกิน 1 ชั่วโมง ไม่เกิน SURVEY_MAX_DAYS)
export function surveyClosesAt(days, now = Date.now()) {
  const d = SURVEY_DAY_CHOICES.includes(days) ? days : SURVEY_DEFAULT_DAYS
  return new Date(now + d * 86400e3).toISOString()
}

// ───── วันเวลา: ปฏิทินพุทธ เวลาไทยเสมอ ─────
const TH = 'th-TH-u-ca-buddhist'

export function formatSurveyDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(TH, { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Asia/Bangkok' })
}

// เหลืออีกกี่วัน (นับเป็นวันเต็มปัดขึ้น): ต่ำกว่า 1 วันก็ยังเหลือ 1 · ปิดแล้ว = 0
export function surveyDaysLeft(closesAt, now = Date.now()) {
  const end = new Date(closesAt).getTime()
  if (Number.isNaN(end) || end <= now) return 0
  return Math.max(1, Math.ceil((end - now) / 86400e3))
}

export function surveyPercent(count, total) {
  if (!total || !count) return 0
  return Math.round((count / total) * 100)
}

// ───── คำตอบของฉัน: เก็บไว้ในเครื่องผู้ตอบเท่านั้น ─────
// เซิร์ฟเวอร์ไม่รู้ว่าใครเลือกข้อไหน (ตั้งใจ) จึงให้เครื่องจำไว้เองเพื่อไฮไลต์ "คำตอบของคุณ" — เครื่องอื่น/ล้างข้อมูลแล้วจะไม่เห็นป้ายนี้ ผลรวมไม่กระทบ
const MINE_KEY = id => `survey_mine_${id}`

export function rememberMyAnswer(surveyId, optionId, storage = globalThis.localStorage) {
  try { storage?.setItem(MINE_KEY(surveyId), optionId) } catch { /* โหมดส่วนตัวของบางเบราว์เซอร์เขียนไม่ได้ — ไม่จำก็ไม่เป็นไร */ }
}

export function recallMyAnswer(surveyId, storage = globalThis.localStorage) {
  try { return storage?.getItem(MINE_KEY(surveyId)) || null } catch { return null }
}

// ───── การ์ดหน้าแรก: เลือกว่าจะโชว์แบบสำรวจไหน ─────
// ลำดับ: ที่เปิดอยู่และผู้ดูยังไม่ได้ตอบ → ที่เปิดอยู่และตอบแล้ว (ขอบคุณ+ดูผล) → ที่เพิ่งปิดไม่เกิน SURVEY_HOME_RECENT_DAYS วัน (ดูผล)
// ผู้ไม่ล็อกอิน has_voted เป็น false เสมอ จึงเห็นคำเชิญ กดแล้วไปหน้าตอบซึ่งชวนล็อกอินอีกที
export const SURVEY_HOME_RECENT_DAYS = 14

export function pickSurveyForHome(list, now = Date.now()) {
  const items = Array.isArray(list) ? list : []
  const open = items.filter(s => s.status === 'open')
  const unanswered = open.find(s => !s.has_voted)
  if (unanswered) return { kind: 'invite', survey: unanswered, moreCount: items.length - 1 }
  const answered = open[0]
  if (answered) return { kind: 'thanks', survey: answered, moreCount: items.length - 1 }
  const recent = items.find(s => s.status === 'closed' && now - new Date(s.closes_at).getTime() <= SURVEY_HOME_RECENT_DAYS * 86400e3)
  if (recent) return { kind: 'result', survey: recent, moreCount: items.length - 1 }
  return null
}

// ───── ข้อความเมื่อทำรายการไม่สำเร็จ (code จากฟังก์ชันฐานข้อมูล) ─────
export const SURVEY_VOTE_ERRORS = {
  login_required: 'กรุณาเข้าสู่ระบบก่อนตอบแบบสำรวจ',
  not_found: 'ไม่พบแบบสำรวจนี้',
  other_municipality: 'แบบสำรวจนี้สำหรับผู้ใช้ที่สังกัดหน่วยงานนี้เท่านั้น',
  not_open: 'แบบสำรวจนี้ปิดรับแล้ว',
  invalid_option: 'กรุณาเลือกคำตอบอีกครั้ง',
  already_voted: 'คุณตอบแบบสำรวจนี้แล้ว',
  comment_too_long: `ความเห็นยาวเกิน ${SURVEY_COMMENT_MAX} ตัวอักษร`,
}

export const SURVEY_MANAGE_ERRORS = {
  forbidden: 'บัญชีนี้ไม่มีสิทธิ์จัดการแบบสำรวจของหน่วยงานนี้',
  invalid_question: `คำถามต้องยาว ${SURVEY_QUESTION_MIN}–${SURVEY_QUESTION_MAX} ตัวอักษร`,
  invalid_options: `ต้องมีตัวเลือก ${SURVEY_OPTIONS_MIN}–${SURVEY_OPTIONS_MAX} ข้อ ไม่ซ้ำกัน และแต่ละข้อไม่เกิน ${SURVEY_OPTION_MAX} ตัวอักษร`,
  invalid_closes_at: 'วันปิดรับไม่ถูกต้อง',
  too_many_open: `เปิดพร้อมกันได้ไม่เกิน ${SURVEY_MAX_OPEN} เรื่อง กรุณาปิดเรื่องเดิมก่อน`,
  duplicate: 'มีแบบสำรวจคำถามเดียวกันที่ยังเปิดอยู่แล้ว',
  not_found: 'ไม่พบแบบสำรวจนี้แล้ว',
  not_open: 'แบบสำรวจนี้ปิดรับแล้ว ทำรายการนี้ไม่ได้',
}

export const SURVEY_BUSY_MESSAGE = 'ส่งถี่เกินไป กรุณารอสักครู่แล้วลองใหม่'

// ผู้ที่ลบแบบสำรวจได้ — ต้องตรงกับ survey_can_delete() ใน 20261021110000_survey_delete.sql (เทสต์เทียบให้)
// แคบกว่าผู้ที่สร้าง/ปิดได้ (survey_can_manage) เพราะลบแล้วกู้คืนไม่ได้ · ฝั่งฐานข้อมูลบังคับจริง ตัวนี้แค่ซ่อนปุ่ม
export const SURVEY_DELETE_ROLES = ['superadmin', 'admin']

// ข้อความเตือนในขั้นยืนยันลบ — บอกสิ่งที่จะหายตามตัวเลขจริงของเรื่องนั้น (ไม่ให้กดลบโดยไม่รู้ว่าทิ้งอะไร)
export function surveyDeleteWarning({ open, total, comments }) {
  const parts = []
  if (open) parts.push('ยังเปิดรับอยู่')
  parts.push(total > 0
    ? `ตอบแล้ว ${total} คน${comments > 0 ? ` ความเห็น ${comments} รายการ` : ''} จะหายทั้งหมด`
    : 'ยังไม่มีผู้ตอบ')
  parts.push('ลบแล้วกู้คืนไม่ได้ ลิงก์ที่แชร์ไว้จะขึ้น "ไม่พบแบบสำรวจนี้"')
  return parts.join(' · ')
}

// ฐานข้อมูลตอบ PT429 เมื่อยิงถี่เกินโควตา — แยกออกจาก "ไม่พบ" และ "เครือข่ายล่ม"
export function isSurveyBusy(error) {
  return error?.code === 'PT429' || String(error?.message ?? '').includes('ถี่เกินไป')
}

// ข้อความหลังตอบสำเร็จ: บอกผู้ตอบถ้าระบบซ่อนข้อมูลส่วนตัวในความเห็นให้
export function surveyThanksText(result) {
  if (result?.comment_masked) return 'ขอบคุณที่ร่วมตอบ ระบบซ่อนเบอร์โทร เลขบัตร หรืออีเมลในความเห็นของคุณให้แล้ว'
  return 'ขอบคุณที่ร่วมตอบแบบสำรวจ'
}
