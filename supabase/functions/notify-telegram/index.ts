// Supabase Edge Function: notify-telegram
// Deploy: supabase functions deploy notify-telegram
// Secret required: TELEGRAM_BOT_TOKEN

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendTelegramMessage, type TelegramSendResult } from '../_shared/telegram.ts'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const notificationSpecs = {
  complaint_created: { table: 'complaints', resourceType: 'complaint', access: 'public_create' },
  complaint_status_updated: { table: 'complaints', resourceType: 'complaint', access: 'staff' },
  document_request_created: { table: 'document_requests', resourceType: 'document_request', access: 'public_create' },
  document_request_status_updated: { table: 'document_requests', resourceType: 'document_request', access: 'staff' },
  building_permit_created: { table: 'document_requests', resourceType: 'document_request', access: 'public_create' },
  event_created: { table: 'events', resourceType: 'event', access: 'event_create' },
  fee_verified: { table: 'document_requests', resourceType: 'document_request', access: 'staff' },
  technician_received: { table: 'complaints', resourceType: 'complaint', access: 'staff' },
  technician_in_progress: { table: 'complaints', resourceType: 'complaint', access: 'staff' },
  technician_closed: { table: 'complaints', resourceType: 'complaint', access: 'staff' },
} as const

type NotificationType = keyof typeof notificationSpecs

type DeliveryRow = {
  id: string
  status: 'pending' | 'sent' | 'failed'
  attempt_count: number
  updated_at: string
  claim_token: string | null
}

type ClaimResult = {
  claimed: boolean
  duplicate?: boolean
  inProgress?: boolean
  delivery: DeliveryRow
  claimToken: string | null
}

const INTERNAL_ROLES = new Set([
  'superadmin', 'admin', 'officer', 'viewer', 'council', 'staff', 'technician', 'kamnan',
])

const AUDIENCE_LABELS: Record<string, string> = {
  public: 'ประชาชน',
  staff: 'เจ้าหน้าที่',
  management: 'ผู้บริหาร',
  council: 'สภาเทศบาล',
}

// ต้องตรงกับ CATEGORY_LABEL ใน src/components/admin/ComplaintsManager.jsx ทุกคำ — ไม่งั้นข้อความ
// แจ้งเตือนใน Telegram กับหน้าเว็บจะขึ้นชื่อประเภทคำร้องไม่ตรงกัน
const COMPLAINT_CATEGORY_LABEL: Record<string, string> = {
  road: 'ถนน/ทางสาธารณะ', light: 'ไฟฟ้าสาธารณะ',
  trash: 'ขยะ/ความสะอาด', water: 'น้ำประปา',
  flood: 'น้ำท่วม/ระบายน้ำ', tree: 'ต้นไม้/สวนสาธารณะ',
  noise: 'เหตุรำคาญ', drain: 'ท่อระบายน้ำ',
  waste_water: 'น้ำเสีย', building: 'ตรวจสอบอาคาร',
  mosquito: 'พ่นยุง', canal: 'ลอกคลอง',
  animals: 'สุนัขจรจัด', water_supply: 'สนับสนุนน้ำอุปโภค',
  borrow_equipment: 'ยืมพัสดุ', grievance: 'ร้องทุกข์/ร้องเรียน',
  corruption: 'แจ้งการทุจริต', tax: 'ภาษีและค่าธรรมเนียม',
  disease: 'ควบคุมโรคติดต่อ', other: 'อื่นๆ',
  odor: 'กลิ่นเหม็นรบกวน (มลพิษทางอากาศ)',
}

// ต้องตรงกับ STATUS ใน src/components/admin/ComplaintsManager.jsx ทุกคำ
const COMPLAINT_STATUS_LABEL: Record<string, string> = {
  new: 'คำร้องใหม่', pending: 'คำร้องใหม่',
  received: 'รับเรื่องแล้ว',
  in_progress: 'กำลังดำเนินการ',
  done: 'ดำเนินการแล้ว', completed: 'ดำเนินการแล้ว',
  closed: 'ปิดเรื่องแล้ว',
  rejected: 'ปฏิเสธ',
}

// complaint_created/complaint_status_updated/technician_* ไม่อยู่ในนี้แล้ว — ใช้ buildComplaintCreatedMessage()/
// buildComplaintStatusMessage() แทน เพื่อโชว์ประเภท/สถานะจริงในข้อความ (ดู notificationType selection ด้านล่าง)
const STATIC_MESSAGES: Partial<Record<NotificationType, string>> = {
  document_request_created: '📄 <b>มีคำขอเอกสารใหม่</b>\nกรุณาเข้าสู่ระบบ SmartLocal เพื่อดูรายละเอียดตามสิทธิ์',
  document_request_status_updated: '🔄 <b>มีการอัปเดตสถานะคำขอเอกสาร</b>\nกรุณาเข้าสู่ระบบ SmartLocal เพื่อดูรายละเอียดตามสิทธิ์',
  building_permit_created: '🏗️ <b>มีคำขออนุญาตก่อสร้างใหม่</b>\nกรุณาเข้าสู่ระบบ SmartLocal เพื่อดูรายละเอียดตามสิทธิ์',
  fee_verified: '💰 <b>มีการตรวจสอบค่าธรรมเนียมแล้ว</b>\nกรุณาเข้าสู่ระบบ SmartLocal เพื่อดูรายละเอียดตามสิทธิ์',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function cleanText(value: unknown, maxLength = 500) {
  return String(value ?? '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function escapeHtml(value: unknown, maxLength = 500) {
  return cleanText(value, maxLength)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function formatThaiDate(dateValue: unknown) {
  const value = cleanText(dateValue, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return ''
  const date = new Date(`${value}T00:00:00+07:00`)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('th-TH', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok',
  })
}

function buildEventMessage(event: Record<string, unknown>) {
  const audiences = Array.isArray(event.audiences)
    ? event.audiences.map((value) => AUDIENCE_LABELS[String(value)] ?? cleanText(value, 40)).filter(Boolean)
    : []
  const date = formatThaiDate(event.event_date)
  const startTime = cleanText(event.event_time, 5)
  const endTime = cleanText(event.end_time, 5)
  const time = event.is_all_day || !/^\d{2}:\d{2}$/.test(startTime)
    ? ''
    : `${startTime}${/^\d{2}:\d{2}$/.test(endTime) ? ` – ${endTime}` : ''} น.`

  return [
    `📅 <b>กิจกรรมใหม่</b>${audiences.length ? ` [${escapeHtml(audiences.join(', '), 160)}]` : ''}`,
    `<b>${escapeHtml(event.title, 300) || 'ไม่ระบุชื่อกิจกรรม'}</b>`,
    date ? `📆 ${escapeHtml(date, 120)}` : '',
    time ? `⏰ ${escapeHtml(time, 30)}` : '',
    event.location ? `📍 ${escapeHtml(event.location, 200)}` : '',
    event.description ? `📝 ${escapeHtml(event.description, 120)}` : '',
  ].filter(Boolean).join('\n').slice(0, 1800)
}

// เดิม complaint_created ใช้ STATIC_MESSAGES ข้อความเดียวกันทุกคำร้อง ไม่บอกประเภท — ผู้ดูแลต้องเปิดระบบ
// ก่อนถึงจะรู้ว่าเรื่องอะไร เลยเพิ่มประเภทให้เห็นเบื้องต้นในแชทเลย เหมือน buildComplaintStatusMessage()
function buildComplaintCreatedMessage(complaint: Record<string, unknown>) {
  const category = COMPLAINT_CATEGORY_LABEL[String(complaint.category)] ?? (cleanText(complaint.category, 60) || 'อื่นๆ')
  return [
    '📋 <b>มีคำร้องใหม่</b>',
    `ประเภท: ${escapeHtml(category, 60)}`,
  ].join('\n')
}

function buildComplaintStatusMessage(complaint: Record<string, unknown>) {
  const category = COMPLAINT_CATEGORY_LABEL[String(complaint.category)] ?? (cleanText(complaint.category, 60) || 'อื่นๆ')
  const status = COMPLAINT_STATUS_LABEL[String(complaint.status)] ?? cleanText(complaint.status, 60)
  return [
    '🔄 <b>อัปเดตสถานะคำร้อง</b>',
    `ประเภท: ${escapeHtml(category, 60)}`,
    `สถานะ: ${escapeHtml(status, 60)}`,
  ].join('\n')
}

function isRecent(createdAt: unknown, minutes = 15) {
  const timestamp = new Date(String(createdAt ?? '')).getTime()
  return Number.isFinite(timestamp) && timestamp >= Date.now() - minutes * 60_000
}

function sameMunicipality(profile: Record<string, unknown> | null, resource: Record<string, unknown>) {
  return profile?.role === 'superadmin'
    || (!!profile?.municipality_id && profile.municipality_id === resource.municipality_id)
}

function canRequestNotification(
  spec: typeof notificationSpecs[NotificationType],
  resource: Record<string, unknown>,
  userId: string | null,
  profile: Record<string, unknown> | null,
) {
  const role = String(profile?.role ?? '')
  const isInternal = INTERNAL_ROLES.has(role)

  if (spec.access === 'event_create') {
    if (!userId || !isInternal) return false
    if (role === 'superadmin') return true
    if (role === 'admin' && sameMunicipality(profile, resource)) return true
    return resource.created_by === userId && sameMunicipality(profile, resource)
  }

  if (spec.access === 'staff') {
    return !!userId && isInternal && sameMunicipality(profile, resource)
  }

  if (userId && resource.user_id === userId) return true
  if (userId && isInternal && sameMunicipality(profile, resource)) return true
  return resource.user_id == null && isRecent(resource.created_at)
}

function idempotencyKey(type: NotificationType, resource: Record<string, unknown>) {
  const base = `${type}:${resource.id}`
  if (type === 'complaint_status_updated' || type === 'document_request_status_updated') {
    return `${base}:${cleanText(resource.status, 40)}:${cleanText(resource.updated_at, 40)}`
  }
  if (type === 'fee_verified') {
    return `${base}:${cleanText(resource.fee_amount, 40)}:${cleanText(resource.updated_at, 40)}`
  }
  if (type.startsWith('technician_')) {
    return `${base}:${cleanText(resource.status, 40)}:${cleanText(resource.updated_at, 40)}`
  }
  return base
}

function notificationMatchesResource(type: NotificationType, resource: Record<string, unknown>) {
  if (type === 'building_permit_created') return resource.document_type === 'building_permit'
  if (type === 'fee_verified') return Number(resource.fee_amount ?? 0) > 0
  if (type === 'technician_received') return resource.status === 'received'
  if (type === 'technician_in_progress') return resource.status === 'in_progress'
  if (type === 'technician_closed') return resource.status === 'done' || resource.status === 'completed'
  return true
}

async function claimDelivery(
  admin: ReturnType<typeof createClient>,
  values: Record<string, unknown>,
): Promise<ClaimResult> {
  const claimToken = crypto.randomUUID()
  const now = new Date().toISOString()
  const insertValues = { ...values, claim_token: claimToken, status: 'pending', updated_at: now }
  const { data: inserted, error: insertError } = await admin
    .from('notification_deliveries')
    .insert(insertValues)
    .select('id,status,attempt_count,updated_at,claim_token')
    .maybeSingle()

  if (!insertError && inserted) return { claimed: true, delivery: inserted, claimToken }
  if (insertError?.code !== '23505') throw insertError

  const { data: existing, error: existingError } = await admin
    .from('notification_deliveries')
    .select('id,status,attempt_count,updated_at,claim_token')
    .eq('municipality_id', values.municipality_id)
    .eq('channel', values.channel)
    .eq('idempotency_key', values.idempotency_key)
    .maybeSingle()
  if (existingError || !existing) throw existingError ?? new Error('delivery row not found')
  if (existing.status === 'sent') return { claimed: false, duplicate: true, delivery: existing, claimToken: null }

  const stalePending = existing.status === 'pending'
    && new Date(existing.updated_at).getTime() < Date.now() - 2 * 60_000
  if (existing.status === 'pending' && !stalePending) {
    return { claimed: false, inProgress: true, delivery: existing, claimToken: null }
  }

  const { data: reclaimed, error: reclaimError } = await admin
    .from('notification_deliveries')
    .update({
      status: 'pending', claim_token: claimToken, last_error: null,
      requested_by: values.requested_by, updated_at: now,
    })
    .eq('id', existing.id)
    .eq('updated_at', existing.updated_at)
    .select('id,status,attempt_count,updated_at,claim_token')
    .maybeSingle()
  if (reclaimError) throw reclaimError
  if (!reclaimed) return { claimed: false, inProgress: true, delivery: existing, claimToken: null }
  return { claimed: true, delivery: reclaimed, claimToken }
}

async function sendTelegram(chatId: string, text: string): Promise<TelegramSendResult> {
  return sendTelegramMessage(chatId, text, BOT_TOKEN as string)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405)
  if (Number(req.headers.get('content-length') ?? 0) > 4096) {
    return json({ ok: false, error: 'request too large' }, 413)
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: 'server configuration is incomplete' }, 500)
  }

  try {
    const body = await req.json() as Record<string, unknown>
    const notificationType = body.notification_type as NotificationType
    const resourceId = body.resource_id
    if (!(notificationType in notificationSpecs) || !isUuid(resourceId)) {
      return json({ ok: false, error: 'invalid notification_type or resource_id' }, 400)
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const authorization = req.headers.get('Authorization') ?? ''
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: authorization ? { Authorization: authorization } : {} },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: authData } = await authClient.auth.getUser()
    const userId = authData.user?.id ?? null
    const { data: profile } = userId
      ? await admin.from('profiles').select('id,role,municipality_id').eq('id', userId).maybeSingle()
      : { data: null }

    const spec = notificationSpecs[notificationType]
    const selectColumns = spec.table === 'events'
      ? 'id,municipality_id,created_by,created_at,title,description,event_date,event_time,end_time,location,audiences,is_all_day'
      : spec.table === 'complaints'
        ? 'id,municipality_id,user_id,created_at,updated_at,status,category,assigned_to'
        : 'id,municipality_id,user_id,created_at,updated_at,status,document_type,fee_amount'
    const { data: resource, error: resourceError } = await admin
      .from(spec.table)
      .select(selectColumns)
      .eq('id', resourceId)
      .maybeSingle()

    if (resourceError) return json({ ok: false, error: 'resource lookup failed' }, 500)
    if (!resource) return json({ ok: false, error: 'resource not found' }, 404)
    if (!notificationMatchesResource(notificationType, resource)) {
      return json({ ok: false, error: 'notification type does not match resource state' }, 422)
    }
    if (!canRequestNotification(spec, resource, userId, profile)) {
      return json({ ok: false, error: 'not authorized for this notification' }, 403)
    }

    const municipalityId = resource.municipality_id
    if (!isUuid(municipalityId)) return json({ ok: false, error: 'resource municipality is invalid' }, 422)
    const { data: municipality, error: municipalityError } = await admin
      .from('municipalities')
      .select('id,telegram_group_id')
      .eq('id', municipalityId)
      .maybeSingle()
    if (municipalityError || !municipality) return json({ ok: false, error: 'municipality not found' }, 404)

    const claim = await claimDelivery(admin, {
      municipality_id: municipalityId,
      channel: 'telegram',
      notification_type: notificationType,
      resource_type: spec.resourceType,
      resource_id: resourceId,
      idempotency_key: idempotencyKey(notificationType, resource),
      requested_by: userId,
    })
    if (claim.duplicate) return json({ ok: true, duplicate: true, status: 'sent' })
    if (claim.inProgress || !claim.claimed) return json({ ok: true, duplicate: true, status: 'pending' }, 202)

    const finish = async (status: 'sent' | 'failed', values: Record<string, unknown>) => {
      await admin.from('notification_deliveries').update({
        status, claim_token: null, updated_at: new Date().toISOString(), ...values,
      }).eq('id', claim.delivery.id).eq('claim_token', claim.claimToken)
    }

    if (!municipality.telegram_group_id) {
      await finish('failed', { last_error: 'Telegram group is not configured' })
      return json({ ok: false, error: 'Telegram group is not configured' }, 422)
    }
    if (!BOT_TOKEN) {
      await finish('failed', { last_error: 'TELEGRAM_BOT_TOKEN is not configured' })
      return json({ ok: false, error: 'Telegram bot is not configured' }, 500)
    }

    const message = notificationType === 'event_created'
      ? buildEventMessage(resource)
      : notificationType === 'complaint_created'
        ? buildComplaintCreatedMessage(resource)
        : notificationType === 'complaint_status_updated' || notificationType.startsWith('technician_')
          ? buildComplaintStatusMessage(resource)
          : STATIC_MESSAGES[notificationType]
    if (!message) {
      await finish('failed', { last_error: 'Notification template is not configured' })
      return json({ ok: false, error: 'notification template is not configured' }, 500)
    }

    const result = await sendTelegram(String(municipality.telegram_group_id), message)
    const totalAttempts = Number(claim.delivery.attempt_count ?? 0) + result.attempts
    if (!result.ok) {
      await finish('failed', { attempt_count: totalAttempts, last_error: result.error })
      return json({ ok: false, status: 'failed', error: result.error }, 502)
    }

    await finish('sent', {
      attempt_count: totalAttempts,
      provider_message_id: result.messageId == null ? null : String(result.messageId),
      last_error: null,
      sent_at: new Date().toISOString(),
    })
    return json({ ok: true, status: 'sent' })
  } catch (error) {
    console.error('notify-telegram failed:', error)
    return json({ ok: false, error: 'internal notification error' }, 500)
  }
})
