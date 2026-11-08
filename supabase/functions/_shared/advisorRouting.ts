// ตรรกะล้วนของการ "สลับช่องผู้ให้บริการ" ของ superadmin-advisor (รอบ 2) — ไม่เรียกเน็ต ไม่แตะฐานข้อมูล
// node รันเทสต์ตรงได้ (tests/superadmin-advisor-routing.test.mjs) — ใช้ type ได้แค่แบบที่ตัดทิ้งแล้วรันได้
//
// ลำดับที่เจ้าของระบบกำหนด: ช่อง 1 Claude → ช่อง 2 Gemini (จ่ายเงิน) → ช่อง 3 Gemini ฟรี
// คำถามเดียวกัน ถ้าช่องหนึ่งใช้ไม่ได้ ไปช่องถัดไปเอง · ช่องที่หมดถูก "พัก" ไว้จนพ้นเวลาแล้วลองเอง (ไม่ต้องมีคนกด)
//   402 billing_error (เครดิต Claude หมด)   → พัก 60 นาที
//   429 ของ Claude                          → retry-after ถ้ามี ไม่งั้น 15 นาที
//   429 ของ Gemini (RESOURCE_EXHAUSTED)      → พัก 60 นาที (โควตารายวัน/รายนาทีของ project)
//   401/403 หรือ key ไม่ถูกต้อง              → ข้ามจนกว่าจะใส่ key ใหม่ (ประทับ key_invalid_at)
//   5xx / 529 / timeout / เน็ตหลุด / ปฏิเสธคำถาม / ตั้งค่าโมเดลผิด → ข้ามเฉพาะคำถามนี้ ไม่พัก
//   ครบเพดานต่อวันที่ตั้งเอง                   → ข้ามเหมือนหมด (นับใหม่เที่ยงคืนเวลาไทย)

export type Provider = 'claude' | 'gemini'
export type SlotRow = {
  slot: number, provider: Provider, tier: 'paid' | 'free', enabled: boolean, model: string,
  daily_cap: number | null, key_last4: string | null, key_invalid_at: string | null,
  paused_until: string | null, pause_reason: string | null,
}
export type Failure =
  | { kind: 'pause', reason: 'billing' | 'rate_limit' | 'quota', until: Date, label: string }
  | { kind: 'invalid_key', label: string }
  | { kind: 'skip', label: string }

export const PAUSE_BILLING_MIN = 60
export const PAUSE_CLAUDE_RATE_MIN = 15
export const PAUSE_GEMINI_QUOTA_MIN = 60
// retry-after ที่ผู้ให้บริการส่งมา เชื่อได้แต่ไม่เกินนี้ (กันค่าผิดปกติพักช่องทิ้งทั้งวัน)
export const PAUSE_MAX_MIN = 24 * 60

export function slotLabel(s: { provider: Provider, tier: 'paid' | 'free' }): string {
  if (s.provider === 'claude') return 'Claude'
  return s.tier === 'free' ? 'Gemini ฟรี' : 'Gemini จ่ายเงิน'
}

// HH:MM เวลาไทย (UTC+7 ไม่มีเวลาออมแสง)
export function bangkokClock(d: Date): string {
  const local = new Date(d.getTime() + 7 * 3600 * 1000)
  return `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`
}

// เหตุผลที่ "ไม่ลอง" ช่องนี้เลย (null = ลองได้) — hasKey: มี key ใน Vault หรือ (ช่องฟรี) มี GEMINI_API_KEY ใน Secrets
export function slotSkipReason(s: SlotRow, opts: { now: Date, usedToday: number, hasKey: boolean }): string | null {
  const name = slotLabel(s)
  if (!s.enabled) return `${name}: ปิดอยู่`
  if (!opts.hasKey) return `${name}: ยังไม่ใส่ API key`
  if (s.key_invalid_at) return `${name}: API key ใช้ไม่ได้ — ใส่ key ใหม่ที่หน้าตั้งค่า`
  if (s.paused_until && new Date(s.paused_until).getTime() > opts.now.getTime()) {
    return `${name}: ${pauseReasonText(s.pause_reason)} ลองใหม่ ${bangkokClock(new Date(s.paused_until))} น.`
  }
  if (s.daily_cap != null && opts.usedToday >= s.daily_cap) return `${name}: ครบเพดาน ${s.daily_cap} คำถามของวันนี้`
  return null
}

export function pauseReasonText(reason: string | null): string {
  if (reason === 'billing') return 'เครดิตหมด'
  if (reason === 'rate_limit') return 'ถูกจำกัดความถี่'
  if (reason === 'quota') return 'โควตาเต็ม'
  return 'พักชั่วคราว'
}

// retry-after เป็นวินาที (ตัวเลข) หรือวันที่แบบ HTTP — แปลงเป็นนาที ปัดขึ้น ไม่เกิน PAUSE_MAX_MIN
export function retryAfterMinutes(header: string | null | undefined, now: Date): number | null {
  if (!header) return null
  const s = String(header).trim()
  let ms: number | null = null
  if (/^\d+(\.\d+)?$/.test(s)) ms = Number(s) * 1000
  else {
    const t = Date.parse(s)
    if (!Number.isNaN(t)) ms = t - now.getTime()
  }
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null
  return Math.min(PAUSE_MAX_MIN, Math.max(1, Math.ceil(ms / 60000)))
}

function pauseFor(reason: 'billing' | 'rate_limit' | 'quota', minutes: number, now: Date, name: string): Failure {
  const until = new Date(now.getTime() + minutes * 60000)
  return { kind: 'pause', reason, until, label: `${name}: ${pauseReasonText(reason)} ลองใหม่ ${bangkokClock(until)} น.` }
}

// แปลงความล้มเหลวของผู้ให้บริการเป็น "สิ่งที่ต้องทำกับช่อง"
//   status = HTTP status (0 = timeout/เน็ตหลุด) · errorType = type/สถานะจากผู้ให้บริการ · message ใช้จับ key ผิดของ Google เท่านั้น
//   ห้ามส่งข้อความผู้ใช้เข้ามา — ข้อความที่คืนไปถูกบันทึกลง route_note และแสดงบนจอ
export function classifyFailure(
  s: { provider: Provider, tier: 'paid' | 'free' },
  e: { status: number, errorType?: string | null, message?: string | null, retryAfter?: string | null },
  now: Date,
): Failure {
  const name = slotLabel(s)
  const status = Number(e.status) || 0
  const type = String(e.errorType ?? '')
  if (s.provider === 'claude') {
    if (status === 402 || type === 'billing_error') return pauseFor('billing', PAUSE_BILLING_MIN, now, name)
    if (status === 429 || type === 'rate_limit_error') {
      return pauseFor('rate_limit', retryAfterMinutes(e.retryAfter, now) ?? PAUSE_CLAUDE_RATE_MIN, now, name)
    }
  } else if (status === 429 || type === 'RESOURCE_EXHAUSTED') {
    return pauseFor('quota', PAUSE_GEMINI_QUOTA_MIN, now, name)
  }
  // Google ตอบ key ผิดเป็น 400 INVALID_ARGUMENT ("API key not valid") ไม่ใช่ 401
  const googleBadKey = s.provider === 'gemini' && status === 400 && /api[ _]?key/i.test(String(e.message ?? '') + ' ' + type)
  if (status === 401 || status === 403 || type === 'authentication_error' || type === 'permission_error' || googleBadKey) {
    return { kind: 'invalid_key', label: `${name}: API key ใช้ไม่ได้ (HTTP ${status}) — ใส่ key ใหม่ที่หน้าตั้งค่า` }
  }
  if (status === 0) return { kind: 'skip', label: `${name}: ตอบช้าเกินเวลา/เชื่อมต่อไม่ได้` }
  if (status === 404) return { kind: 'skip', label: `${name}: ไม่พบโมเดลที่ตั้งไว้ — แก้ชื่อโมเดลที่หน้าตั้งค่า` }
  if (status === 529 || status >= 500) return { kind: 'skip', label: `${name}: ระบบผู้ให้บริการขัดข้องชั่วคราว (HTTP ${status})` }
  return { kind: 'skip', label: `${name}: ตอบผิดพลาด (HTTP ${status})` }
}

// รวมเหตุผลการสลับเป็นบรรทัดเดียว ลง route_note (CHECK ≤ 1000 ตัว)
export function routeNote(notes: string[]): string | null {
  const text = notes.filter(Boolean).join(' · ')
  return text ? text.slice(0, 1000) : null
}

// ── Claude ──────────────────────────────────────────────────────────────────────────
// fallbacks: "default" (beta server-side-fallback-2026-07-01) รับเฉพาะ Opus 5.5 / Opus 5 / Fable 5.x / Sonnet 5.5
// รุ่นอื่น (เช่น Haiku 5.5) ส่งไปแล้ว 400 หรือไม่มีผล → ไม่ส่ง
export function claudeSupportsFallbacks(model: string): boolean {
  return /^claude-(opus-5(-5)?|fable-5(-1)?|sonnet-5-5)$/.test(model)
}

// ประวัติ (role user|model) → messages ของ Claude: model → assistant · รวมบทบาทเดียวกันที่ติดกัน · เริ่มด้วย user
export function toClaudeMessages(history: { role: 'user' | 'model', content: string }[], userText: string) {
  const out: { role: 'user' | 'assistant', content: string }[] = []
  for (const row of [...history, { role: 'user' as const, content: userText }]) {
    const role = row.role === 'user' ? 'user' : row.role === 'model' ? 'assistant' : null
    if (!role) continue
    const last = out[out.length - 1]
    if (last && last.role === role) last.content += `\n\n${row.content}`
    else out.push({ role, content: row.content })
  }
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}

// อ่านคำตอบ Claude — ต้องดู stop_reason ก่อนอ่าน content (refusal = HTTP 200 ที่ไม่มีคำตอบ)
export function extractClaudeReply(msg: unknown): { ok: true, text: string, truncated: boolean } | { ok: false, reason: string } {
  const m = msg as { stop_reason?: string, stop_details?: { category?: string | null } | null, content?: { type?: string, text?: string }[] }
  if (m?.stop_reason === 'refusal') {
    const cat = m.stop_details?.category
    return { ok: false, reason: `Claude: ปฏิเสธคำถามนี้${cat ? ` (${cat})` : ''}` }
  }
  const text = (m?.content ?? [])
    .filter(b => b && b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('')
    .trim()
  if (!text) return { ok: false, reason: `Claude: ไม่ได้ส่งคำตอบกลับมา (${m?.stop_reason ?? 'ไม่ทราบสาเหตุ'})` }
  return { ok: true, text: text.slice(0, 100000), truncated: m?.stop_reason === 'max_tokens' }
}

// ── งบเวลา ─────────────────────────────────────────────────────────────────────────
// Edge Function แผนฟรีถูกตัดที่ ~150 วิ · หน้าเว็บรอ 120 วิ → ทั้งคำขอต้องจบใน 110 วิ
// ช่องแรกได้ไม่เกิน 70 วิ ที่เหลือแบ่งให้ช่องถัดไป · เหลือไม่ถึง 15 วิ ไม่เริ่มช่องใหม่
export const REQUEST_BUDGET_MS = 110_000
export const SLOT_TIMEOUT_MAX_MS = 70_000
export const SLOT_MIN_START_MS = 15_000

export function slotTimeoutMs(startedAt: number, now: number): number | null {
  const left = REQUEST_BUDGET_MS - (now - startedAt)
  if (left < SLOT_MIN_START_MS) return null
  return Math.min(SLOT_TIMEOUT_MAX_MS, left - 2_000)
}
