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

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
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
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { municipality_id, user_id, title, body, url } = await req.json() as {
      municipality_id?: string
      user_id?: string
      title: string
      body: string
      url?: string
    }

    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      return new Response(JSON.stringify({ error: 'VAPID keys not configured' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if ((!municipality_id && !user_id) || !title || !body) {
      return new Response(JSON.stringify({ error: 'missing fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const safeUrl = typeof url === 'string' && url.startsWith('/') ? url : '/'
    const safeTitle = String(title).slice(0, 150)
    const safeBody = String(body).slice(0, 300)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    let query = supabase.from('push_subscriptions').select('endpoint, p256dh, auth_key')

    if (user_id) {
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

    const payload = JSON.stringify({ title: safeTitle, body: safeBody, url: safeUrl })

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
