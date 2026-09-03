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
  'fleet_trip_bumped',
  'fleet_fuel_created',
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
    // อปท. ที่ไม่ได้ผูกกลุ่ม Telegram (เช่น สนามซ้อม slug='demo') Edge Function คืน 2xx พร้อม
    // skipped:true ไม่ใช่ error — ห้าม log เป็น error เพราะจะกลบสัญญาณของที่พังจริงใน console
    else if (data?.skipped) console.info('ข้ามการแจ้งเตือน Telegram:', data.reason ?? 'not_configured')
    return data ?? null
  }).catch((error) => {
    console.error('Telegram notification failed:', error?.message ?? error)
    return null
  })
}
