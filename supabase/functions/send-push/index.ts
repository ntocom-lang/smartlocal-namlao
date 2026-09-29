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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@smartlocal.app'

const STAFF_ROLES = ['superadmin', 'admin', 'officer', 'staff', 'technician']

// โหมด complaint_id — ต้องตรงกับ src/lib/complaintWorkflow.js (FINISHED_STATUSES, REOPEN_WINDOW_DAYS)
const FINISHED_STATUSES = ['closed', 'completed']
const REOPEN_WINDOW_DAYS = 7
// สมมติฐาน 2569-09-29: ส่งได้เฉพาะคำร้องที่เพิ่งปิด กันการกดส่งซ้ำย้อนหลังไปหาผู้ร้อง
const FINISH_PUSH_WINDOW_MS = 15 * 60 * 1000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// เรื่องลับ — ชุดเดียวกับ CONFIDENTIAL_COMPLAINT_CATEGORIES ของ notify-telegram
// แจ้งเตือนขึ้นบนหน้าจอล็อกมือถือผู้แจ้ง ใครเห็นเครื่องก็รู้ว่าเขาแจ้งเรื่องทุจริต จึงไม่ใส่ชื่อหมวด (2569-09-29)
const CONFIDENTIAL_COMPLAINT_CATEGORIES = new Set(['corruption'])

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

type PushMessage = { title: string; body: string; url: string }

// หาเจ้าของคำร้องและประกอบข้อความฝั่ง server — ผู้เรียกไม่ต้องรู้ user_id ของผู้ร้อง
// และกำหนดข้อความเองไม่ได้ (กันใช้เป็นช่องส่งข้อความปลอมถึงประชาชน)
async function resolveComplaintPush(
  supabase: ReturnType<typeof createClient>,
  req: Request,
  complaintId: string,
  kind: string | undefined,
): Promise<{ error: string; status: number } | { userId: string | null; message: PushMessage }> {
  if (kind !== 'complaint_finished') return { error: 'unknown kind', status: 400 }
  if (!UUID_RE.test(complaintId)) return { error: 'invalid complaint_id', status: 400 }

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: callerData } = await supabase.auth.getUser(jwt)
  const caller = callerData?.user
  if (!caller) return { error: 'unauthorized', status: 401 }

  const { data: callerProfile } = await supabase
    .from('profiles').select('role, municipality_id').eq('id', caller.id).maybeSingle()
  const { data: complaint } = await supabase
    .from('complaints')
    .select('municipality_id, user_id, category, status, closed_at')
    .eq('id', complaintId)
    .maybeSingle()
  if (!complaint) return { error: 'not found', status: 404 }

  const isSuperadmin = callerProfile?.role === 'superadmin'
  const sameMuni = callerProfile?.municipality_id
    && callerProfile.municipality_id === complaint.municipality_id
  if (!isSuperadmin && !(callerProfile?.role && STAFF_ROLES.includes(callerProfile.role) && sameMuni)) {
    return { error: 'forbidden', status: 403 }
  }

  // 'complaint_finished' ยิงหลัง finish_complaint() สำเร็จเท่านั้น
  const closedAt = complaint.closed_at ? Date.parse(complaint.closed_at) : NaN
  if (!FINISHED_STATUSES.includes(complaint.status) || !(Date.now() - closedAt <= FINISH_PUSH_WINDOW_MS)) {
    return { error: 'complaint not recently finished', status: 409 }
  }

  const reopenHint = `แตะเพื่อดูผลและให้คะแนน ถ้ายังไม่เรียบร้อยแจ้งกลับได้ภายใน ${REOPEN_WINDOW_DAYS} วัน`
  const confidential = CONFIDENTIAL_COMPLAINT_CATEGORIES.has(String(complaint.category ?? ''))
  let label = ''
  if (!confidential) {
    // ลำดับเดียวกับ guard_complaint_final_close_role() — หมวดซ้ำชื่อให้หมวดที่เปิดใช้อยู่มาก่อน
    const { data: category } = await supabase
      .from('complaint_categories')
      .select('label')
      .eq('municipality_id', complaint.municipality_id)
      .eq('value', complaint.category)
      .order('is_active', { ascending: false })
      .order('sort_order')
      .order('id')
      .limit(1)
      .maybeSingle()
    label = String(category?.label ?? '').replace(/^[\p{Extended_Pictographic}\u{FE0F}\u{200D}\s]+/u, '').trim()
  }

  return {
    userId: complaint.user_id ?? null,
    message: {
      title: 'คำร้องของคุณดำเนินการแล้ว',
      body: confidential ? reopenHint : `คำร้อง${label} ดำเนินการแล้ว — ${reopenHint}`,
      url: '/my-complaints',
    },
  }
}

// เดิม endpoint นี้ไม่มีการตรวจสิทธิ์ใดๆ เลย — ใครก็ POST ตรงมาได้พร้อม title/body/url
// ที่ต้องการ แล้วยิงพุชแจ้งเตือนปลอมไปหาผู้ subscribe ทุกคนของ municipality_id ไหนก็ได้
// (สแปม/ฟิชชิ่งภายใต้ชื่อระบบ) หรือระบุ user_id เพื่อยิงหาคนใดคนหนึ่งโดยตรง (ก่อนหน้านี้
// พังเงียบอยู่แล้วเพราะโค้ดไม่รองรับ user_id เลย)
// แก้:
//   - โหมด user_id (แจ้งเตือนรายบุคคล เช่น "งานของคุณเสร็จแล้ว"): ต้องมี JWT ของ staff
//     และ staff ต้องอยู่ municipality เดียวกับเจ้าของ user_id เป้าหมายเท่านั้น
//   - โหมด municipality_id (แจ้งเตือนหน้าแดชบอร์ดตอนมีคำร้องใหม่): ยังต้องเรียกแบบ
//     anonymous ได้ต่อไป (ประชาชนยื่นคำร้องได้โดยไม่ login) แต่บังคับ url ให้เป็น path
//     ภายในเว็บเราเท่านั้น ป้องกัน open-redirect/phishing link ผ่านแจ้งเตือน
// เพิ่ม 2569-09-29:
//   - โหมด complaint_id + kind (แจ้งผู้ร้องว่าคำร้อง "ดำเนินการแล้ว"): list_complaints_for_staff ตัด
//     user_id ทิ้งสำหรับ officer/staff ตาม PDPA หน้าเว็บของคนกลุ่มนี้จึงใช้โหมด user_id ไม่ได้
//     (ผู้ร้องไม่ได้แจ้งเตือนเลยเมื่อปิดจากตาราง) — ให้ server หาเจ้าของคำร้องเองแทน
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { municipality_id, user_id, complaint_id, kind, title, body, url } = await req.json() as {
      municipality_id?: string
      user_id?: string
      complaint_id?: string
      kind?: string
      title?: string
      body?: string
      url?: string
    }

    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      return new Response(JSON.stringify({ error: 'VAPID keys not configured' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!complaint_id && ((!municipality_id && !user_id) || !title || !body)) {
      return new Response(JSON.stringify({ error: 'missing fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let message: PushMessage = {
      title: String(title ?? '').slice(0, 150),
      body: String(body ?? '').slice(0, 300),
      // path ภายในเว็บเท่านั้น — "//host" และ "/\host" เบราว์เซอร์ตีความเป็นเว็บอื่น (protocol-relative)
      // และ src/sw.js เปิดลิงก์นี้ตรงๆ ตอนกดแจ้งเตือน เดิมเช็กแค่ขึ้นต้นด้วย "/" จึงพาออกนอกเว็บได้
      url: typeof url === 'string' && /^\/(?![/\\])/.test(url) ? url : '/',
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    let query = supabase.from('push_subscriptions').select('endpoint, p256dh, auth_key')

    if (complaint_id) {
      const target = await resolveComplaintPush(supabase, req, complaint_id, kind)
      if ('error' in target) return jsonResponse({ error: target.error }, target.status)
      // คำร้องที่ไม่มีบัญชีผู้ร้อง (รับแทนที่เคาน์เตอร์) ไม่มีใครให้แจ้ง
      if (!target.userId) return jsonResponse({ sent: 0, failed: 0 })
      message = target.message
      query = query.eq('user_id', target.userId)
    } else if (user_id) {
      // โหมดรายบุคคล — ต้อง auth เป็น staff ของ municipality เดียวกับเป้าหมาย
      const authHeader = req.headers.get('Authorization') ?? ''
      const jwt = authHeader.replace(/^Bearer\s+/i, '')
      const { data: callerData } = await supabase.auth.getUser(jwt)
      const caller = callerData?.user
      if (!caller) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: callerProfile } = await supabase
        .from('profiles').select('role, municipality_id').eq('id', caller.id).maybeSingle()
      const { data: targetProfile } = await supabase
        .from('profiles').select('municipality_id').eq('id', user_id).maybeSingle()

      const isSuperadmin = callerProfile?.role === 'superadmin'
      const sameMuni = callerProfile?.municipality_id && targetProfile?.municipality_id
        && callerProfile.municipality_id === targetProfile.municipality_id

      if (!isSuperadmin && !(callerProfile?.role && STAFF_ROLES.includes(callerProfile.role) && sameMuni)) {
        return new Response(JSON.stringify({ error: 'forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      query = query.eq('user_id', user_id)
    } else {
      query = query.eq('municipality_id', municipality_id!)
    }

    const { data: subs, error } = await query

    if (error) throw error

    const payload = JSON.stringify(message)

    const results = await Promise.allSettled(
      (subs ?? []).map((sub) =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          payload,
        )
      ),
    )

    const sent = results.filter((r) => r.status === 'fulfilled').length
    const failed = results.filter((r) => r.status === 'rejected').length

    // ลบ subscription ที่ expired (HTTP 410 Gone)
    const expiredEndpoints: string[] = []
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const err = r.reason as { statusCode?: number }
        if (err?.statusCode === 410 && subs?.[i]) {
          expiredEndpoints.push(subs[i].endpoint)
        }
      }
    })
    if (expiredEndpoints.length > 0) {
      await supabase
        .from('push_subscriptions')
        .delete()
        .in('endpoint', expiredEndpoints)
    }

    return new Response(JSON.stringify({ sent, failed }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
