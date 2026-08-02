import { supabase } from './supabase'

const TELEGRAM_NOTIFICATIONS_DISABLED = false

export function notifyTelegram(groupId, message) {
  if (TELEGRAM_NOTIFICATIONS_DISABLED) return
  if (!groupId || !message) return
  supabase.functions.invoke('notify-telegram', {
    body: { group_id: groupId, message },
  }).catch(() => {})
}
