// Supabase Edge Function: notify-telegram
// Deploy: supabase functions deploy notify-telegram
// Secrets required (Supabase Dashboard → Settings → Edge Functions secrets):
//   TELEGRAM_BOT_TOKEN = <token from @BotFather>

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// เดิมยิงไป Telegram ตรงๆ ด้วย group_id/message ที่ client ส่งมาแบบไม่ตรวจสอบอะไรเลย
// ทำให้ใครก็ยิง POST เข้ามาตรงๆ พร้อม chat_id ใดๆ ก็ได้ (ใช้บอทตัวเดียวส่งสแปม/ฟิชชิ่ง
// ไปยังกลุ่มไหนก็ได้ที่บอทอยู่) — แก้โดยยอมรับเฉพาะ group_id ที่ตรงกับ telegram_group_id
// ที่ลงทะเบียนไว้จริงในตาราง municipalities เท่านั้น (public data อยู่แล้ว ไม่ใช่ secret
// แต่ป้องกันไม่ให้ใช้บอทยิงไปยัง chat อื่นที่ไม่ใช่กลุ่มเทศบาลที่ลงทะเบียน)
// และตัด parse_mode: 'HTML' ออกเพราะ message มีข้อความที่ประชาชนกรอกเอง (เช่น รายละเอียด
// คำร้อง) ปนอยู่แบบไม่ escape — ถ้าเปิด HTML parse mode จะฝัง <a href="..."> ลิงก์ฟิชชิ่ง
// เข้ากลุ่มทางการได้
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

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
    )
    const { data: muni } = await supabase
      .from('municipalities')
      .select('id')
      .eq('telegram_group_id', group_id)
      .maybeSingle()

    if (!muni) {
      return new Response(JSON.stringify({ ok: false, error: 'unregistered group_id' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: group_id,
        text: String(message).slice(0, 2000),
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
