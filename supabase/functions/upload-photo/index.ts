// Supabase Edge Function: upload-photo
// รับ base64 image จาก client → อัปโหลดฝั่ง server → คืน public URL
// Deploy: supabase functions deploy upload-photo

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // ตรวจ JWT — ต้อง authenticated (ไม่รับ anon เพราะใช้ service role bypass RLS)
  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.replace('Bearer ', '').trim()
  if (!token) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // ตรวจว่าเป็น user จริง (ไม่ใช่ anon key)
  const authClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
  )
  const { data: { user }, error: authErr } = await authClient.auth.getUser(token)
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const { path, data: base64Data, contentType } = await req.json() as {
      path: string
      data: string
      contentType: string
    }

    // ป้องกัน path traversal และจำกัดเฉพาะ complaint attachment paths
    if (!path || !base64Data) {
      return new Response(JSON.stringify({ error: 'missing path or data' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // block paths ที่ sensitive
    if (path.includes('..') || path.startsWith('municipality-qr/')) {
      return new Response(JSON.stringify({ error: 'invalid path' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // จำกัด content type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (contentType && !allowedTypes.includes(contentType)) {
      return new Response(JSON.stringify({ error: 'invalid content type' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // base64 → binary
    const binaryStr = atob(base64Data)
    const bytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i)
    }

    // อัปโหลดฝั่ง server ด้วย service role (bypass RLS)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { error: upErr } = await supabase.storage
      .from('complaint-attachments')
      .upload(path, bytes, { contentType: contentType || 'image/jpeg', upsert: false })

    if (upErr) {
      return new Response(JSON.stringify({ error: upErr.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: urlData } = supabase.storage
      .from('complaint-attachments')
      .getPublicUrl(path)

    return new Response(JSON.stringify({ url: urlData.publicUrl }), {
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
