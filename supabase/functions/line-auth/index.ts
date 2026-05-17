import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS })
  }

  try {
    const { code, redirect_uri } = await req.json()
    if (!code || !redirect_uri) {
      return Response.json({ error: 'Missing parameters' }, { status: 400, headers: CORS })
    }

    const channelId = Deno.env.get('LINE_CHANNEL_ID')!
    const channelSecret = Deno.env.get('LINE_CHANNEL_SECRET')!

    // 1. Exchange code for LINE access token
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri,
        client_id: channelId,
        client_secret: channelSecret,
      }),
    })
    if (!tokenRes.ok) {
      console.error('LINE token error:', await tokenRes.text())
      return Response.json({ error: 'LINE authentication failed' }, { status: 400, headers: CORS })
    }
    const { access_token } = await tokenRes.json()

    // 2. Get LINE profile
    const profileRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    if (!profileRes.ok) {
      return Response.json({ error: 'Failed to get LINE profile' }, { status: 400, headers: CORS })
    }
    const { userId: lineUserId, displayName, pictureUrl } = await profileRes.json()

    const email = `line_${lineUserId}@line.smartlocal.app`

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // 3. Generate magic link — สร้าง user ถ้ายังไม่มี หรือสร้าง token สำหรับ user เดิม
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: {
        data: {
          full_name: displayName,
          avatar_url: pictureUrl,
          line_user_id: lineUserId,
          provider: 'line',
        },
      },
    })

    if (linkError || !linkData) {
      console.error('generateLink error:', linkError)
      return Response.json({ error: 'Failed to generate auth token' }, { status: 500, headers: CORS })
    }

    // 4. อัปเดต metadata ทุกครั้งเพื่อให้ข้อมูล LINE เป็นปัจจุบัน
    await supabase.auth.admin.updateUserById(linkData.user.id, {
      user_metadata: {
        full_name: displayName,
        avatar_url: pictureUrl,
        line_user_id: lineUserId,
        provider: 'line',
      },
    })

    return Response.json(
      { token_hash: linkData.properties.hashed_token, email },
      { headers: CORS },
    )
  } catch (err) {
    console.error('line-auth error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: CORS })
  }
})
