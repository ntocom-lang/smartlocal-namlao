// ตรรกะล้วนของการผูก Telegram รายคน (ข้อ 3b ตั้งค่าแจ้งเตือน) — ใช้ใน telegram-webhook และเทสต์ node import ตรง
// ห้ามแตะ Deno/fetch ในไฟล์นี้ เทสต์รันด้วย node (type stripping) ได้ทันที

/** อายุลิงก์ผูกบัญชี — สั้นพอให้ภาพหน้าจอที่หลุดไปใช้ไม่ได้ ยาวพอให้สลับไปเปิดแอป Telegram ทัน */
export const LINK_TOKEN_TTL_MS = 15 * 60_000
/** ขอลิงก์ได้กี่ครั้งต่อ 15 นาทีต่อบัญชี (กดซ้ำเพราะลิงก์หมดอายุ/เปิดผิดเครื่อง) */
export const LINK_TOKEN_LIMIT = 5
export const LINK_TOKEN_WINDOW_MS = 15 * 60_000

/**
 * บทบาทที่ผูกได้ = ผู้เข้าหน้าเจ้าหน้าที่ได้ (ชุดเดียวกับ STAFF_PORTAL_ROLES ใน src/lib/portalAccess.js — edge function
 * import โมดูลฝั่งเว็บไม่ได้ เพิ่มบทบาทต้องแก้ 2 ที่) · ประชาชนไม่ได้รับงานมอบหมาย จึงไม่เปิดให้ผูก
 */
export const TELEGRAM_LINK_ROLES = ['staff', 'officer', 'admin', 'superadmin', 'viewer', 'council', 'technician']

export function canLinkTelegram(role: unknown): boolean {
  return typeof role === 'string' && TELEGRAM_LINK_ROLES.includes(role)
}

export function linkAllowed(recentCount: unknown): boolean {
  return typeof recentCount === 'number' && Number.isInteger(recentCount) && recentCount >= 0
    && recentCount < LINK_TOKEN_LIMIT
}

/** Telegram ให้ start parameter ได้ 1–64 ตัวจาก A-Z a-z 0-9 _ - · 32 ไบต์ base64url = 43 ตัวพอดี */
export const LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function newLinkToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)))
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(value: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

/**
 * secret_token ของ webhook = HMAC-SHA256(bot token, ป้ายคงที่) — ไม่ต้องสร้าง secret ใหม่ให้เจ้าของระบบตั้ง
 * คนที่ไม่มี bot token คำนวณไม่ได้ · เปลี่ยน bot token เมื่อไรต้องกด "ตั้ง webhook" ใหม่ (ค่าเปลี่ยนตาม)
 * Telegram รับ 1–256 ตัวจาก A-Z a-z 0-9 _ - → hex 64 ตัวผ่าน
 */
export async function webhookSecret(botToken: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(botToken), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('smartlocal-telegram-webhook-v1')))
}

export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  let diff = x.length ^ y.length
  const len = Math.max(x.length, y.length)
  for (let i = 0; i < len; i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

export function webhookUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/telegram-webhook`
}

export function deepLink(botUsername: string, token: string): string | null {
  if (!/^[A-Za-z0-9_]{5,32}$/.test(botUsername) || !LINK_TOKEN_PATTERN.test(token)) return null
  return `https://t.me/${botUsername}?start=${token}`
}

/** ชื่อที่แสดงใน Telegram ไว้ให้เจ้าของบัญชีตรวจว่าผูกถูกคน — @username ก่อน ไม่มีค่อยใช้ชื่อจริงที่ตั้งในแอป */
export function telegramDisplay(from: Record<string, unknown> | null | undefined): string | null {
  if (!from) return null
  const username = typeof from.username === 'string' ? from.username.trim() : ''
  const name = [from.first_name, from.last_name]
    .filter((part) => typeof part === 'string' && part.trim())
    .map((part) => String(part).trim())
    .join(' ')
  const value = (username ? `@${username}` : name).replace(/\p{Cc}/gu, ' ').trim()
  return value ? [...value].slice(0, 64).join('') : null
}

export type TelegramUpdateAction =
  | { kind: 'start'; chatId: number; token: string; display: string | null }
  | { kind: 'start_bare'; chatId: number }
  | { kind: 'stop'; chatId: number }
  | { kind: 'blocked'; chatId: number }
  | { kind: 'group'; chatId: number; chatType: string; title: string | null; botStatus: string | null; migratedTo: number | null }
  | { kind: 'ignore' }

const GROUP_TYPES = new Set(['group', 'supergroup', 'channel'])

function chatOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

/** แปลง update ของ Telegram เป็นสิ่งที่ต้องทำ — ทุกอย่างที่ไม่รู้จักคือ ignore (ตอบ 200 ไม่ให้ Telegram ยิงซ้ำ) */
export function classifyUpdate(update: unknown): TelegramUpdateAction {
  const root = chatOf(update)
  if (!root) return { kind: 'ignore' }

  const member = chatOf(root.my_chat_member)
  if (member) {
    const chat = chatOf(member.chat)
    const chatId = Number(chat?.id)
    const status = String(chatOf(member.new_chat_member)?.status ?? '')
    if (!chat || !Number.isSafeInteger(chatId)) return { kind: 'ignore' }
    if (chat.type === 'private') return status === 'kicked' && chatId > 0 ? { kind: 'blocked', chatId } : { kind: 'ignore' }
    if (GROUP_TYPES.has(String(chat.type)) && chatId < 0) {
      return {
        kind: 'group', chatId, chatType: String(chat.type),
        title: typeof chat.title === 'string' ? [...chat.title].slice(0, 255).join('') : null,
        botStatus: status ? status.slice(0, 32) : null, migratedTo: null,
      }
    }
    return { kind: 'ignore' }
  }

  const message = chatOf(root.message) ?? chatOf(root.channel_post)
  const chat = chatOf(message?.chat)
  const chatId = Number(chat?.id)
  if (!message || !chat || !Number.isSafeInteger(chatId)) return { kind: 'ignore' }

  if (chat.type === 'private' && chatId > 0) {
    const text = typeof message.text === 'string' ? message.text.trim() : ''
    const start = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?$/.exec(text)
    if (start) {
      const token = start[1] ?? ''
      if (!token) return { kind: 'start_bare', chatId }
      if (!LINK_TOKEN_PATTERN.test(token)) return { kind: 'start_bare', chatId }
      return { kind: 'start', chatId, token, display: telegramDisplay(chatOf(message.from)) }
    }
    if (/^\/stop(?:@[A-Za-z0-9_]+)?$/.test(text)) return { kind: 'stop', chatId }
    return { kind: 'start_bare', chatId }
  }

  if (GROUP_TYPES.has(String(chat.type)) && chatId < 0) {
    const migrated = Number(message.migrate_to_chat_id)
    return {
      kind: 'group', chatId, chatType: String(chat.type),
      title: typeof chat.title === 'string' ? [...chat.title].slice(0, 255).join('') : null,
      botStatus: null, migratedTo: Number.isSafeInteger(migrated) && migrated < 0 ? migrated : null,
    }
  }
  return { kind: 'ignore' }
}

export const LINK_REPLY = {
  linked: 'เชื่อมบัญชี SmartLocal กับ Telegram นี้เรียบร้อยแล้ว\n\nแชทนี้จะได้รับเฉพาะงานที่มอบหมายให้คุณ ข้อความมีแค่เลขที่เรื่อง ประเภท และลิงก์เข้าระบบ ไม่มีชื่อหรือเบอร์โทรของประชาชน\n\nพิมพ์ /stop เมื่อต้องการยกเลิก',
  expired: 'ลิงก์นี้หมดอายุแล้ว (ใช้ได้ 15 นาที) กลับไปที่หน้า "การแจ้งเตือนของฉัน" ในระบบแล้วกดเชื่อม Telegram ใหม่',
  invalid: 'ลิงก์นี้ใช้ไม่ได้หรือถูกใช้ไปแล้ว กลับไปที่หน้า "การแจ้งเตือนของฉัน" ในระบบแล้วกดเชื่อม Telegram ใหม่',
  bare: 'บอตนี้ใช้ส่งงานที่มอบหมายให้บุคลากรของ อปท. การเชื่อมบัญชีต้องเริ่มจากหน้า "การแจ้งเตือนของฉัน" ในระบบ SmartLocal เท่านั้น',
  stopped: 'ยกเลิกการเชื่อมแล้ว แชทนี้จะไม่ได้รับข้อความจากระบบอีก เชื่อมใหม่ได้จากหน้า "การแจ้งเตือนของฉัน"',
  notLinked: 'แชทนี้ยังไม่ได้เชื่อมกับบัญชีใน SmartLocal',
} as const

export function linkReply(result: unknown): string {
  return result === 'linked' ? LINK_REPLY.linked : result === 'expired' ? LINK_REPLY.expired : LINK_REPLY.invalid
}

/** สรุปสถานะ webhook จาก getWebhookInfo ให้หน้าเว็บ (superadmin) ไม่ส่ง URL ของคนอื่นกลับไปทั้งเส้น */
export function webhookState(info: Record<string, unknown> | null, expectedUrl: string) {
  const url = typeof info?.url === 'string' ? info.url : ''
  return {
    configured: url === expectedUrl,
    other: Boolean(url) && url !== expectedUrl,
    otherHost: url && url !== expectedUrl ? (() => { try { return new URL(url).host } catch { return 'ไม่ทราบ' } })() : null,
    pending: Number(info?.pending_update_count ?? 0) || 0,
    lastError: typeof info?.last_error_message === 'string' ? info.last_error_message.slice(0, 200) : null,
    lastErrorAt: Number(info?.last_error_date) > 0 ? new Date(Number(info?.last_error_date) * 1000).toISOString() : null,
  }
}

export const ALLOWED_UPDATES = ['message', 'my_chat_member', 'channel_post']
