// ตรรกะล้วนของ Edge Function superadmin-advisor — ไม่เรียกเน็ต ไม่แตะฐานข้อมูล
// แยกไว้ให้ node รันเทสต์ได้ตรง (tests/superadmin-advisor-core.test.mjs) ใช้ type ได้แค่แบบที่ลบทิ้งแล้วรันได้
// (node รัน .ts ด้วยการตัด type ทิ้ง — ห้ามใช้ enum / namespace / parameter property)

export const MAX_MESSAGE_CHARS = 8000
export const HISTORY_LIMIT = 40
export const MODEL_PATTERN = /^[a-z0-9][a-z0-9.-]{1,62}$/

// ── ปิดบังข้อมูลส่วนบุคคลก่อนส่งออกนอกระบบ ────────────────────────────────────────
// Gemini แบบไม่เสียเงิน Google นำข้อความไปพัฒนาผลิตภัณฑ์ได้และคนรีวิวได้ จึงตัดของที่ระบุตัวคนได้ชัดทิ้งก่อน
// เป็นตาข่ายอีกชั้น ไม่ใช่ตัวกันหลัก (ชื่อ-ที่อยู่ปิดบังด้วยกฎไม่ได้ หน้าจอจึงเตือนห้ามวางข้อมูลประชาชนด้วย)
//   เลขประจำตัวประชาชน 13 หลัก — ติดกัน หรือคั่นแบบ 1-2345-67890-12-3 (ขีด/เว้นวรรค)
//   เบอร์โทรไทย — มือถือ 0x-xxxx-xxxx (10 หลัก) · บ้าน 0x-xxx-xxxx (9 หลัก) · +66 / 66 นำหน้า
const NATIONAL_ID = /(?<!\d)\d[ -]?\d{4}[ -]?\d{5}[ -]?\d{2}[ -]?\d(?!\d)/g
const PHONE = /(?<![\d+])(?:\+?66[ -]?|0)\d{1,2}[ -]?\d{3}[ -]?\d{3,4}(?!\d)/g

export function maskPersonalData(text: string): { text: string, masked: number } {
  let masked = 0
  const out = String(text ?? '')
    .replace(NATIONAL_ID, () => { masked++; return '[เลขบัตรประชาชน]' })
    .replace(PHONE, () => { masked++; return '[เบอร์โทร]' })
  return { text: out, masked }
}

// ── ตรวจข้อความที่ส่งมา ──────────────────────────────────────────────────────────
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function validateRequest(body: unknown): { ok: true, conversationId: string, message: string } | { ok: false, error: string } {
  const b = (body && typeof body === 'object') ? body as Record<string, unknown> : {}
  const conversationId = b.conversation_id
  const raw = b.message
  if (typeof conversationId !== 'string' || !UUID.test(conversationId)) return { ok: false, error: 'conversation_id ไม่ถูกต้อง' }
  if (typeof raw !== 'string') return { ok: false, error: 'ไม่มีข้อความ' }
  const message = raw.trim()
  if (!message) return { ok: false, error: 'ไม่มีข้อความ' }
  if (message.length > MAX_MESSAGE_CHARS) return { ok: false, error: `ข้อความยาวเกิน ${MAX_MESSAGE_CHARS} ตัวอักษร` }
  return { ok: true, conversationId, message }
}

// ── เวลาไทย ───────────────────────────────────────────────────────────────────────
// เที่ยงคืนวันนี้ตามเวลาไทย (UTC+7 ไม่มีเวลาออมแสง) เป็น ISO UTC — ใช้นับยอดคำถามต่อวัน
export function bangkokDayStartIso(now: Date = new Date()): string {
  const BKK = 7 * 3600 * 1000
  const local = new Date(now.getTime() + BKK)
  const startLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
  return new Date(startLocal - BKK).toISOString()
}

export function thaiDateLabel(now: Date = new Date()): string {
  const local = new Date(now.getTime() + 7 * 3600 * 1000)
  const months = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
  return `${local.getUTCDate()} ${months[local.getUTCMonth()]} พ.ศ. ${local.getUTCFullYear() + 543}`
}

// ── บทบาทของที่ปรึกษา ─────────────────────────────────────────────────────────────
// หลักชุดเดียวกับ docs/ai/CORE.md + DOMAIN.md ที่เจ้าของระบบตั้งให้ AI ทุกตัว (ย่อให้เหมาะกับแชต)
export function systemPrompt(now: Date = new Date()): string {
  return `คุณคือที่ปรึกษาส่วนตัวของผู้ดูแลระบบสูงสุด (Super Admin) ของ SmartLocal — ระบบ Smart City ด้าน Smart Governance
สำหรับองค์กรปกครองส่วนท้องถิ่นไทย (อบต./เทศบาล) วันนี้คือ ${thaiDateLabel(now)}

บทบาท: ที่ปรึกษาระดับผู้เชี่ยวชาญและวิศวกรระบบอาวุโส ช่วยคิด วิเคราะห์ และให้คำแนะนำได้ทุกเรื่อง
ทั้งเทคนิค การบริหารงานท้องถิ่น ระเบียบราชการ งานเอกสาร และเรื่องทั่วไป ตอบภาษาไทย คงศัพท์เทคนิคเป็นภาษาอังกฤษ

หลักการตอบ
1. ตรงไปตรงมาบนข้อเท็จจริง ไม่ประจบ ไม่มีคำนำอวย เจอจุดพังในแผนให้ชี้ทันทีพร้อมเหตุผลหรือเคสที่ล้มเหลวจริง แล้วเสนอทางแก้
   ถ้าแผนถูกแล้วให้บอกว่าถูกสั้นๆ ห้ามค้านเพื่อค้าน และห้ามยอมตามเพียงเพราะถูกกดดันโดยไม่มีข้อเท็จจริงใหม่
2. เรื่องกฎหมาย ระเบียบ หนังสือสั่งการ: ห้ามเดาเลขมาตรา เลขข้อ ชื่อระเบียบ หรือปี พ.ศ.
   ไม่มั่นใจให้เขียนว่า "ต้องยืนยันกับฉบับปัจจุบัน" แล้วชี้ชื่อระเบียบ/หมวดที่ต้องเปิด
   ความไม่แน่ใจที่บอกตรงๆ มีค่ากว่าคำตอบที่มั่นใจแต่ผิด และแนะนำแหล่งทางการ (ราชกิจจานุเบกษา, กรมส่งเสริมการปกครองท้องถิ่น,
   ระบบจัดซื้อจัดจ้างภาครัฐ, สำนักงานคณะกรรมการกฤษฎีกา)
3. แยกให้ชัดระหว่าง "ข้อเท็จจริงตรวจสอบได้" กับ "ความเห็นเชิงวิชาชีพ"
4. เสนอเทคโนโลยีที่มี track record และอยู่ในงบที่ อปท. ดูแลต่อเองได้ ระบุ trade-off ทุกครั้ง
   ระบบนี้ใช้นโยบายงบเป็นศูนย์: เสนอเฉพาะ free tier ที่ไม่ผูกบัตร, open source หรือ self-hosted
5. งานฝั่งเจ้าหน้าที่ต้อง "ช่วยงาน" ไม่ใช่ "เพิ่มงาน" — ถามก่อนเสมอว่าระบบทำเองได้ไหม
   แต่ดุลพินิจทางปกครอง การลงนาม การอนุมัติเงิน/พัสดุ/จัดซื้อจัดจ้าง และการตัดสินสิทธิประชาชน ต้องเป็นของคนเท่านั้น
6. ถ้าข้อมูลที่ขาดจะเปลี่ยนคำตอบอย่างมีนัยสำคัญ ถามกลับได้ไม่เกิน 3 ข้อ ถ้าขาดแค่รายละเอียดปลีกย่อย ให้ตั้งสมมติฐานกำกับแล้วตอบให้จบ

รูปแบบ: ข้อสรุปก่อน แล้วค่อยกางเหตุผลทีละขั้น ใช้หัวข้อ/bullet กระชับ ไม่สรุปซ้ำท้ายคำตอบ
ข้อความที่เห็นเป็น [เลขบัตรประชาชน] หรือ [เบอร์โทร] คือข้อมูลที่ระบบปิดบังไว้ก่อนส่ง ห้ามเดาค่าจริง`
}

// ── แปลงประวัติเป็นรูปแบบของ Gemini ──────────────────────────────────────────────
// รวมข้อความบทบาทเดียวกันที่ติดกัน (เช่นคำถามที่ส่งแล้ว AI ไม่ตอบ) เพื่อให้สลับ user/model เสมอ
export type HistoryRow = { role: 'user' | 'model', content: string }

export function buildContents(history: HistoryRow[], userText: string) {
  const turns: { role: 'user' | 'model', parts: { text: string }[] }[] = []
  for (const row of [...history, { role: 'user' as const, content: userText }]) {
    if (row.role !== 'user' && row.role !== 'model') continue
    const last = turns[turns.length - 1]
    if (last && last.role === row.role) last.parts[0].text += `\n\n${row.content}`
    else turns.push({ role: row.role, parts: [{ text: row.content }] })
  }
  // Gemini ต้องเริ่มด้วย user — ประวัติที่ถูกตัดเหลือ HISTORY_LIMIT แถวอาจเริ่มด้วยคำตอบ
  while (turns.length && turns[0].role !== 'user') turns.shift()
  return turns
}

// ── อ่านคำตอบ ─────────────────────────────────────────────────────────────────────
// โมเดลรุ่นที่ "คิดก่อนตอบ" อาจส่ง part ที่เป็นความคิด (thought: true) มาด้วย — เอาเฉพาะคำตอบจริง
export function extractReply(data: unknown): { ok: true, text: string } | { ok: false, reason: string } {
  const d = data as { candidates?: { content?: { parts?: { text?: string, thought?: boolean }[] }, finishReason?: string }[], promptFeedback?: { blockReason?: string } }
  const block = d?.promptFeedback?.blockReason
  if (block) return { ok: false, reason: `Google ปฏิเสธคำถามนี้ (${block})` }
  const cand = d?.candidates?.[0]
  const text = (cand?.content?.parts ?? [])
    .filter(p => p && p.thought !== true && typeof p.text === 'string')
    .map(p => p.text)
    .join('')
    .trim()
  if (!text) return { ok: false, reason: `AI ไม่ได้ส่งคำตอบกลับมา (${cand?.finishReason ?? 'ไม่ทราบสาเหตุ'})` }
  return { ok: true, text: text.slice(0, 100000) }
}
