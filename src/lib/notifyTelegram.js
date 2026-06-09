import { supabase } from './supabase'

export function notifyTelegram(groupId, message) {
  if (!groupId || !message) return
  supabase.functions.invoke('notify-telegram', {
    body: { group_id: groupId, message },
  }).catch(() => {})
}
