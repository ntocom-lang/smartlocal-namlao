import { supabase } from './supabase'

// ปิดชั่วคราวจากจุดกลาง: ทุก workflow ยังบันทึกข้อมูลตามปกติ แต่ไม่เรียก Edge Function
const TELEGRAM_NOTIFICATIONS_DISABLED = true

export function notifyTelegram(groupId, message) {
  if (TELEGRAM_NOTIFICATIONS_DISABLED) return
  if (!groupId || !message) return
  supabase.functions.invoke('notify-telegram', {
    body: { group_id: groupId, message },
  }).catch(() => {})
}
