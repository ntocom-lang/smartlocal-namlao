// Supabase Edge Function: send-push
// Deploy: supabase functions deploy send-push
// Secrets required (Supabase Dashboard → Settings → Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY  — generate ด้วย: npx web-push generate-vapid-keys
//   VAPID_PRIVATE_KEY — (ต้อง rotate ถ้าเคย hardcode ไว้ก่อนหน้า)
//   VAPID_SUBJECT     — mailto:your@email.com

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @ts-ignore — webpush types not needed
import webpush from 'npm:web-push@3.6.7'
import {
  CONFIDENTIAL_COMPLAINT_CATEGORIES,
  FINISHED_STATUSES,
  NEW_COMPLAINT_PUSH_ROLES,
  complaintPushMessage,
  isComplaintPushKind,
  isFreshTimestamp,
  pickNewComplaintRecipients,
  type ComplaintPushKind,
  type PushMessage,
} from '../_shared/complaintPush.ts'
import {
  SELF_TEST_KIND,
  SELF_TEST_WINDOW_MS,
  isPushEndpoint,
  selfTestAllowed,
  selfTestMessage,
} from '../_shared/pushSelfTest.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@smartlocal.app'

// ผู้เรียกชนิดฝั่งเจ้าหน้าที่ (ปิดงาน/บันทึกข้อความ/เพิ่มรูป) ต้องเป็นบทบาทนี้ของ อปท. เดียวกับคำร้อง
const STAFF_ROLES = ['superadmin', 'admin', 'officer', 'staff', 'technician']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

type Supabase = ReturnType<typeof createClient>
type ComplaintRow = {
  id: string
  municipality_id: string
  user_id: string | null
  category: string | null
  status: string | null
  closed_at: string | null
  created_at: string | null
  complaint_number: string | null
  department: string | null
  assigned_to: string | null
}
type Denied = { error: string; status: number }

// ผู้เรียกต้องเป็นเจ้าหน้าที่ของ อปท. เดียวกับคำร้อง (หรือ superadmin)
async function denyUnlessComplaintStaff(supabase: Supabase, req: Request, complaint: ComplaintRow): Promise<Denied | null> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: callerData } = await supabase.auth.getUser(jwt)
  const caller = callerData?.user
  if (!caller) return { error: 'unauthorized', status: 401 }

  const { data: callerProfile } = await supabase
    .from('profiles').select('role, municipality_id').eq('id', caller.id).maybeSingle()
  const isSuperadmin = callerProfile?.role === 'superadmin'
  const sameMuni = callerProfile?.municipality_id
    && callerProfile.municipality_id === complaint.municipality_id
  if (!isSuperadmin && !(callerProfile?.role && STAFF_ROLES.includes(callerProfile.role) && sameMuni)) {
    return { error: 'forbidden', status: 403 }
  }
  return null
}

// ชื่อหมวด + เป็นหมวดเฉพาะกิจไหม — ลำดับเดียวกับ guard_complaint_final_close_role()
// (หมวดซ้ำชื่อให้หมวดที่เปิดใช้อยู่มาก่อน) · เฉพาะกิจ: แถวไหนเป็นเฉพาะกิจก็ถือว่าเฉพาะกิจ (ผู้รับแคบลง ไม่กว้างขึ้น)
async function loadCategory(supabase: Supabase, complaint: ComplaintRow): Promise<{ label: string; adhoc: boolean }> {
  const { data, error } = await supabase
    .from('complaint_categories')
    .select('label, is_adhoc')
    .eq('municipality_id', complaint.municipality_id)
    .eq('value', complaint.category)
    .order('is_active', { ascending: false })
    .order('sort_order')
    .order('id')
  if (error) throw error
  const rows = (data ?? []) as { label: string | null; is_adhoc: boolean | null }[]
  return { label: String(rows[0]?.label ?? ''), adhoc: rows.some((row) => row.is_adhoc === true) }
}

// เจ้าหน้าที่ที่ได้แจ้งเตือน "คำร้องใหม่" — กติกาอยู่ใน _shared/complaintPush.ts
async function newComplaintRecipients(supabase: Supabase, complaint: ComplaintRow, adhoc: boolean): Promise<string[]> {
  const columns = 'id, role, municipality_id, department_id'
  const [staff, superadmins, departments] = await Promise.all([
    supabase.from('profiles').select(columns)
      .eq('municipality_id', complaint.municipality_id)
      .in('role', NEW_COMPLAINT_PUSH_ROLES.filter((role) => role !== 'superadmin')),
    supabase.from('profiles').select(columns).eq('role', 'superadmin'),
    supabase.from('departments').select('id, municipality_id, name, short_name, code')
      .eq('municipality_id', complaint.municipality_id),
  ])
  for (const result of [staff, superadmins, departments]) if (result.error) throw result.error
  return pickNewComplaintRecipients(
    complaint,
    adhoc,
    [...(staff.data ?? []), ...(superadmins.data ?? [])],
    departments.data ?? [],
  )
}

type Subscription = { endpoint: string; p256dh: string; auth_key: string }
type SendResult = { sent: number; failed: number }

// ส่งถึงทุกเครื่องในรายการ แล้วลบเครื่องที่บริการ push ตอบว่าหมดอายุ (HTTP 410 Gone)
async function sendToSubscriptions(supabase: Supabase, subs: Subscription[], message: PushMessage): Promise<SendResult> {
  const payload = JSON.stringify(message)
  const results = await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
        payload,
      )
    ),
  )
  const sent = results.filter((r) => r.status === 'fulfilled').length
  const failed = results.filter((r) => r.status === 'rejected').length
  const expiredEndpoints: string[] = []
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const err = r.reason as { statusCode?: number }
      if (err?.statusCode === 410 && subs[i]) expiredEndpoints.push(subs[i].endpoint)
    }
  })
  if (expiredEndpoints.length > 0) {
    await supabase.from('push_subscriptions').delete().in('endpoint', expiredEndpoints)
  }
  return { sent, failed }
}

// บันทึกการส่งใน notification_deliveries (ช่องทาง push) — idempotency_key ซ้ำ = เคยส่งแล้ว คืน null
// เป็นทั้งตัวกันส่งซ้ำและหลักฐานย้อนตรวจ (แอดมินของ อปท. อ่านได้ตาม policy เดิม)
async function openDelivery(supabase: Supabase, values: Record<string, unknown>): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('notification_deliveries')
    .insert({ ...values, channel: 'push', status: 'pending' })
    .select('id')
    .maybeSingle()
  if (error?.code === '23505') return null
  if (error) throw error
  return data as { id: string }
}

async function closeDelivery(supabase: Supabase, id: string, { sent, failed }: SendResult) {
  const now = new Date().toISOString()
  const status = sent > 0 ? 'sent' : failed > 0 ? 'failed' : 'skipped'
  await supabase.from('notification_deliveries').update({
    status,
    attempt_count: sent + failed,
    sent_at: sent > 0 ? now : null,
    updated_at: now,
    last_error: status === 'failed' ? 'push service rejected every device' : status === 'skipped' ? 'no subscribed device' : null,
  }).eq('id', id)
}

// ปุ่ม "ส่งทดสอบถึงเครื่องนี้" — ต้องล็อกอิน · endpoint ต้องเป็นแถวของบัญชีนี้ · ข้อความตายตัว · จำกัดครั้งต่อช่วงเวลา
async function handleSelfTest(supabase: Supabase, req: Request, endpoint: unknown) {
  if (!isPushEndpoint(endpoint)) return jsonResponse({ error: 'invalid endpoint' }, 400)
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: callerData } = await supabase.auth.getUser(jwt)
  const caller = callerData?.user
  if (!caller) return jsonResponse({ error: 'unauthorized' }, 401)

  const { data: device, error: deviceError } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth_key, municipality_id')
    .eq('user_id', caller.id)
    .eq('endpoint', endpoint)
    .maybeSingle()
  if (deviceError) throw deviceError
  if (!device?.municipality_id) return jsonResponse({ error: 'device not registered' }, 404)

  const since = new Date(Date.now() - SELF_TEST_WINDOW_MS).toISOString()
  const { count, error: countError } = await supabase
    .from('notification_deliveries')
    .select('id', { count: 'exact', head: true })
    .eq('channel', 'push')
    .eq('notification_type', SELF_TEST_KIND)
    .eq('requested_by', caller.id)
    .gte('created_at', since)
  if (countError) throw countError
  if (!selfTestAllowed(count)) return jsonResponse({ error: 'too many tests' }, 429)

  const delivery = await openDelivery(supabase, {
    municipality_id: device.municipality_id,
    notification_type: SELF_TEST_KIND,
    resource_type: 'user',
    resource_id: caller.id,
    idempotency_key: `${SELF_TEST_KIND}:${crypto.randomUUID()}`,
    requested_by: caller.id,
  })
  const result = await sendToSubscriptions(supabase, [device as Subscription], selfTestMessage())
  if (delivery) await closeDelivery(supabase, delivery.id, result)
  return jsonResponse(result)
}

// ผู้เรียกส่งได้แค่ { complaint_id, kind } (หรือ { kind: 'self_test', endpoint } ส่งทดสอบถึงเครื่องตัวเอง)
// — server หาผู้รับและประกอบข้อความเองทุกชนิด
//   complaint_created  ประชาชนเพิ่งยื่นคำร้อง (ยื่นได้โดยไม่ล็อกอิน จึงไม่ตรวจผู้เรียก) → เจ้าหน้าที่ที่ดูแลเรื่องนี้
//                      ส่งครั้งเดียวต่อคำร้อง (notification_deliveries) กันยิงซ้ำภายในช่วงเพิ่งยื่น
//   complaint_finished เจ้าหน้าที่เพิ่งปิดงาน → ผู้ร้อง
//   complaint_note     เจ้าหน้าที่บันทึกข้อความถึงผู้ร้อง → ผู้ร้อง
//   complaint_photo    ช่างเพิ่มรูปความคืบหน้า → ผู้ร้อง
// โหมดข้อความอิสระเดิม (municipality_id/user_id + title/body/url) ถอดแล้ว 2569-10-28 — เหตุผลอยู่หัว _shared/complaintPush.ts
// · list_complaints_for_staff ตัด user_id ทิ้งสำหรับ officer/staff ตาม PDPA หน้าเว็บจึงไม่รู้ว่าใครคือผู้ร้อง
//   ให้ server หาเจ้าของคำร้องเองแทน (เดิมบันทึกข้อความ/รูปจากบัญชี officer ไม่เคยแจ้งผู้ร้องเลย)
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { complaint_id, kind, endpoint } = (await req.json().catch(() => null) ?? {}) as { complaint_id?: unknown; kind?: unknown; endpoint?: unknown }

    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      return jsonResponse({ error: 'VAPID keys not configured' }, 503)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    if (kind === SELF_TEST_KIND) return await handleSelfTest(supabase, req, endpoint)

    if (!isComplaintPushKind(kind)) return jsonResponse({ error: 'unknown kind' }, 400)
    if (typeof complaint_id !== 'string' || !UUID_RE.test(complaint_id)) {
      return jsonResponse({ error: 'invalid complaint_id' }, 400)
    }
    const pushKind: ComplaintPushKind = kind

    const { data: complaint, error: complaintError } = await supabase
      .from('complaints')
      .select('id, municipality_id, user_id, category, status, closed_at, created_at, complaint_number, department, assigned_to')
      .eq('id', complaint_id)
      .maybeSingle()
    if (complaintError) throw complaintError
    if (!complaint) return jsonResponse({ error: 'not found' }, 404)
    const row = complaint as ComplaintRow

    if (pushKind === 'complaint_created') {
      if (!isFreshTimestamp(row.created_at, Date.now())) {
        return jsonResponse({ error: 'complaint not recently created' }, 409)
      }
    } else {
      const denied = await denyUnlessComplaintStaff(supabase, req, row)
      if (denied) return jsonResponse({ error: denied.error }, denied.status)
      // 'complaint_finished' ยิงหลัง finish_complaint() สำเร็จเท่านั้น
      if (pushKind === 'complaint_finished'
        && (!FINISHED_STATUSES.includes(String(row.status ?? '')) || !isFreshTimestamp(row.closed_at, Date.now()))) {
        return jsonResponse({ error: 'complaint not recently finished' }, 409)
      }
    }

    const category = await loadCategory(supabase, row)
    const userIds = pushKind === 'complaint_created'
      ? await newComplaintRecipients(supabase, row, category.adhoc)
      // คำร้องที่ไม่มีบัญชีผู้ร้อง (รับแทนที่เคาน์เตอร์/ยื่นโดยไม่ล็อกอิน) ไม่มีใครให้แจ้ง
      : (row.user_id ? [row.user_id] : [])
    if (!userIds.length) return jsonResponse({ sent: 0, failed: 0 })

    const message = complaintPushMessage(pushKind, {
      label: category.label,
      confidential: CONFIDENTIAL_COMPLAINT_CATEGORIES.has(String(row.category ?? '')),
      complaintNumber: row.complaint_number,
    })

    let query = supabase.from('push_subscriptions').select('endpoint, p256dh, auth_key').in('user_id', userIds)
    // เจ้าหน้าที่ (โดยเฉพาะ superadmin ที่ดูแลหลาย อปท.) ได้เฉพาะเครื่องที่สมัครจากเว็บของ อปท. นี้
    if (pushKind === 'complaint_created') query = query.eq('municipality_id', row.municipality_id)

    const { data: subs, error } = await query

    if (error) throw error
    if (!subs?.length) return jsonResponse({ sent: 0, failed: 0 })

    // คำร้องใหม่ส่งได้ครั้งเดียวต่อคำร้อง — complaint_created เรียกได้โดยไม่ล็อกอิน คนที่เพิ่งยื่นจึงกดยิงซ้ำได้ถ้าไม่กันไว้
    const delivery = pushKind === 'complaint_created'
      ? await openDelivery(supabase, {
        municipality_id: row.municipality_id,
        notification_type: pushKind,
        resource_type: 'complaint',
        resource_id: row.id,
        idempotency_key: `${pushKind}:${row.id}`,
      })
      : null
    if (pushKind === 'complaint_created' && !delivery) return jsonResponse({ sent: 0, failed: 0, duplicate: true })

    const result = await sendToSubscriptions(supabase, subs as Subscription[], message)
    if (delivery) await closeDelivery(supabase, delivery.id, result)
    return jsonResponse(result)
  } catch (err) {
    console.error(err)
    return jsonResponse({ error: String(err) }, 500)
  }
})
