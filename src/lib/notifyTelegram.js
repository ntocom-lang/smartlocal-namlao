import { supabase } from './supabase'

// ปิดชั่วคราวระหว่างช่วงแก้บั๊ก/ทดสอบระบบ (2026-07-27) — กันแจ้งเตือนสแปมเข้ากลุ่ม
// Telegram ของพนักงานจากการทดสอบซ้ำๆ ตั้งกลับเป็น false เมื่อแก้ไขเสร็จแล้ว
const TELEGRAM_NOTIFICATIONS_DISABLED = true

export function notifyTelegram(groupId, message) {
  if (TELEGRAM_NOTIFICATIONS_DISABLED) return
  if (!groupId || !message) return
  supabase.functions.invoke('notify-telegram', {
    body: { group_id: groupId, message },
  }).catch(() => {})
}
