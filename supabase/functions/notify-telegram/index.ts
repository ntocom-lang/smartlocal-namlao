// Supabase Edge Function: notify-telegram
// Deploy: supabase functions deploy notify-telegram
// Secrets required (Supabase Dashboard → Settings → Edge Functions secrets):
//   TELEGRAM_BOT_TOKEN = <token from @BotFather>

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { group_id, message } = await req.json() as { group_id: string; message: string }

    if (!group_id || !message) {
      return new Response(JSON.stringify({ ok: false, error: 'missing group_id or message' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!BOT_TOKEN) {
      return new Response(JSON.stringify({ ok: false, error: 'TELEGRAM_BOT_TOKEN not set' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: group_id,
        text: message,
        parse_mode: 'HTML',
      }),
    })

    const result = await res.json()
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
