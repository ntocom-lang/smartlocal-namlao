import { supabase } from './supabase'

const TELEGRAM_NOTIFICATIONS_DISABLED = false

const TELEGRAM_EVENT_TYPES = [
  { marker: '<b>คำร้องใหม่</b>', text: '📋 <b>มีคำร้องใหม่</b>' },
  { marker: '<b>คำขอเอกสารใหม่</b>', text: '📄 <b>มีคำขอเอกสารใหม่</b>' },
  { marker: '<b>คำขอ ข.๑ ใหม่', text: '🏗️ <b>มีคำขออนุญาตก่อสร้างใหม่</b>' },
  { marker: '<b>กิจกรรมใหม่</b>', text: '📅 <b>มีปฏิทินกิจกรรมใหม่</b>' },
  { marker: '<b>อัปเดตสถานะคำร้อง</b>', text: '🔄 <b>มีการอัปเดตสถานะคำร้อง</b>' },
  { marker: '<b>อัปเดตสถานะคำขอเอกสาร</b>', text: '🔄 <b>มีการอัปเดตสถานะคำขอเอกสาร</b>' },
  { marker: '<b>แจ้งผลยอดที่ตรวจสอบ</b>', text: '💰 <b>มีการตรวจสอบค่าธรรมเนียมแล้ว</b>' },
  { marker: '<b>ช่างรับงานแล้ว</b>', text: '🔧 <b>ผู้ปฏิบัติงานรับงานแล้ว</b>' },
  { marker: '<b>ช่างเริ่มลงพื้นที่ดำเนินการ</b>', text: '🔧 <b>ผู้ปฏิบัติงานเริ่มดำเนินการแล้ว</b>' },
  { marker: '<b>ช่างปิดงานแล้ว', text: '🔧 <b>ผู้ปฏิบัติงานปิดงานแล้ว</b>' },
]

function cleanTelegramLine(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\p{Cc}/gu, '')
    .trim()
}

function sanitizeEventMessage(message) {
  const lines = String(message ?? '')
    .split(/\r?\n/)
    .map(cleanTelegramLine)
    .filter(Boolean)

  const heading = lines[0] ?? ''
  const audience = heading.match(/\[[^\]\r\n]{1,120}\]/)?.[0] ?? ''
  const title = lines[1]?.slice(0, 300) ?? 'ไม่ระบุชื่อกิจกรรม'
  const details = lines.slice(2, 8).map(line => line.slice(0, 500))

  return [
    `📅 <b>กิจกรรมใหม่</b>${audience ? ` ${audience}` : ''}`,
    `<b>${title}</b>`,
    ...details,
  ].join('\n').slice(0, 1800)
}

export function sanitizeTelegramMessage(message) {
  const firstLine = String(message ?? '').split(/\r?\n/, 1)[0]
  if (firstLine.includes('<b>กิจกรรมใหม่</b>')) {
    return sanitizeEventMessage(message)
  }
  const eventType = TELEGRAM_EVENT_TYPES.find(({ marker }) => firstLine.includes(marker))
  const heading = eventType?.text ?? '🔔 <b>มีรายการแจ้งเตือนใหม่</b>'
  return `${heading}\nกรุณาเข้าสู่ระบบ SmartLocal เพื่อดูรายละเอียดตามสิทธิ์`
}

export function notifyTelegram(groupId, message) {
  if (TELEGRAM_NOTIFICATIONS_DISABLED) return
  if (!groupId || !message) return
  const safeMessage = sanitizeTelegramMessage(message)
  supabase.functions.invoke('notify-telegram', {
    body: { group_id: groupId, message: safeMessage },
  }).catch(() => {})
}
