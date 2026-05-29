// Supabase Edge Function: send-push
// Deploy: supabase functions deploy send-push
// Secrets required (set via Supabase Dashboard → Settings → Edge Functions secrets):
//   VAPID_PUBLIC_KEY   = BBH-3E4L9jXf1s8ks2bj3QyihvN9GUs75AioPx4Gzb-61ispg0aM5kpE6mH_LdhSXZwEAvWRO-2xTocvNyuBejg
//   VAPID_PRIVATE_KEY  = RvfQKafR0pk8QuYrdcGlWJUfs8lGdYd1eFglVzjLkL8
//   VAPID_SUBJECT      = mailto:ntocom@gmail.com

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @ts-ignore — webpush types not needed
import webpush from 'npm:web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

webpush.setVapidDetails(
  'mailto:ntocom@gmail.com',
  'BBH-3E4L9jXf1s8ks2bj3QyihvN9GUs75AioPx4Gzb-61ispg0aM5kpE6mH_LdhSXZwEAvWRO-2xTocvNyuBejg',
  'RvfQKafR0pk8QuYrdcGlWJUfs8lGdYd1eFglVzjLkL8',
)

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { municipality_id, title, body, url } = await req.json() as {
      municipality_id: string
      title: string
      body: string
      url?: string
    }

    if (!municipality_id || !title || !body) {
      return new Response(JSON.stringify({ error: 'missing fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: subs, error } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth_key')
      .eq('municipality_id', municipality_id)

    if (error) throw error

    const payload = JSON.stringify({ title, body, url: url ?? '/' })

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
