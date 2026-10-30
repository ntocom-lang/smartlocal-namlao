// ผูก Telegram ส่วนตัวของบุคลากร (ข้อ 3b ตั้งค่าแจ้งเตือน) — ใช้ในหน้า /profile/notifications
// ฝั่ง server: Edge Function telegram-webhook + ตาราง telegram_user_links (migration 20261029120000)
import { supabase } from './supabase'
import { STAFF_PORTAL_ROLES } from './portalAccess'

/** ผูกได้เฉพาะผู้เข้าหน้าเจ้าหน้าที่ได้ — ตรงกับ TELEGRAM_LINK_ROLES ใน supabase/functions/_shared/telegramLink.ts */
export const canLinkTelegram = (role) => STAFF_PORTAL_ROLES.includes(role)

/** ตารางยังไม่มี (ยังไม่ apply migration) → ซ่อนส่วนนี้เงียบๆ ไม่ขึ้น error ให้ผู้ใช้ */
export function isMissingTelegramLinkTable(error) {
  const code = String(error?.code ?? '')
  const message = String(error?.message ?? '')
  return code === 'PGRST205' || code === '42P01'
    || (/telegram_user_links/.test(message) && /not find|does not exist/.test(message))
}

/** null = ยังไม่ผูก · { tg_display, linked_at } = ผูกแล้ว (หน้าเว็บไม่เห็น chat_id — สิทธิ์ระดับคอลัมน์) */
export async function getMyTelegramLink(userId) {
  const { data, error } = await supabase
    .from('telegram_user_links')
    .select('tg_display, linked_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data ?? null
}

export async function unlinkMyTelegram(userId) {
  const { error } = await supabase.from('telegram_user_links').delete().eq('user_id', userId)
  if (error) throw error
}

async function errorBody(error) {
  try {
    const body = await error?.context?.json?.()
    return body && typeof body === 'object' ? body : {}
  } catch {
    return {} // ตอบไม่เป็น JSON
  }
}

// 409 (บอตมี webhook ที่อื่นอยู่) ส่งสถานะกลับมาด้วย หน้าเว็บต้องเห็นว่าเป็นของโฮสต์ไหนก่อนตัดสินใจทับ
async function callWebhook(body, fallback) {
  const { data, error } = await supabase.functions.invoke('telegram-webhook', { body })
  if (!error) return { ok: true, ...data }
  const detail = await errorBody(error)
  return {
    ok: false,
    status: Number(error?.context?.status) || 0,
    error: typeof detail.error === 'string' && detail.error ? detail.error : fallback,
    other: Boolean(detail.other),
    otherHost: detail.otherHost ?? null,
  }
}

export const requestTelegramLink = () => callWebhook({ action: 'link' }, 'ขอลิงก์เชื่อม Telegram ไม่สำเร็จ กรุณาลองใหม่')
export const telegramBotStatus = () => callWebhook({ action: 'status' }, 'ตรวจสถานะบอตไม่สำเร็จ')
export const setupTelegramWebhook = (force = false) => callWebhook({ action: 'setup', force }, 'ตั้ง webhook ไม่สำเร็จ')

export function linkExpired(expiresAt, now = Date.now()) {
  const at = new Date(expiresAt).getTime()
  return !Number.isFinite(at) || at <= now
}

export function minutesLeft(expiresAt, now = Date.now()) {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 60_000))
}
