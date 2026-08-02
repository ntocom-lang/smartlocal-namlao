import { supabase } from './supabase'

const TELEGRAM_NOTIFICATIONS_DISABLED = false

const ALLOWED_NOTIFICATION_TYPES = new Set([
  'complaint_created',
  'complaint_status_updated',
  'document_request_created',
  'document_request_status_updated',
  'building_permit_created',
  'event_created',
  'fee_verified',
  'technician_received',
  'technician_in_progress',
  'technician_closed',
])

/**
 * Queue a Telegram notification by trusted resource ID.
 * Message content and destination are resolved by the Edge Function.
 */
export function notifyTelegram(notificationType, resourceId) {
  if (TELEGRAM_NOTIFICATIONS_DISABLED) return Promise.resolve(null)
  if (!ALLOWED_NOTIFICATION_TYPES.has(notificationType) || !resourceId) return Promise.resolve(null)

  return supabase.functions.invoke('notify-telegram', {
    body: {
      notification_type: notificationType,
      resource_id: resourceId,
    },
  }).then(({ data, error }) => {
    if (error) console.error('Telegram notification failed:', error.message)
    return data ?? null
  }).catch((error) => {
    console.error('Telegram notification failed:', error?.message ?? error)
    return null
  })
}
