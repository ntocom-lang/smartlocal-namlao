// Supabase Edge Function: admin-update-login-email
// Deploy: supabase functions deploy admin-update-login-email
//
// Changes the REAL login email (auth.users.email) for a staff/admin account —
// not just the display copy cached in profiles.email. Requires the Supabase
// Admin API (auth.admin.updateUserById), which only works with the service_role
// key server-side; this can never be a plain client-side .update() or a plpgsql
// RPC the way admin_update_user() is for other fields.
//
// email_confirm: true — the new email is marked confirmed immediately, skipping
// the "click a link to verify" step a self-service change would normally require.
// This is a deliberate trade-off for the admin-correction use case (the admin has
// already verified the person's identity/email out-of-band, e.g. this is their
// own staff member) — flagged here explicitly since it bypasses email-ownership
// verification, unlike a normal Supabase email-change flow.
//
// Reuses the same authorization shape as admin_update_user() (SQL RPC): caller
// must be admin/superadmin, cannot target self, cannot target a superadmin
// unless caller is superadmin, admin caller is scoped to their own municipality.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

function cleanText(value: unknown, maxLength = 300) {
  return String(value ?? '').replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405)
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: 'server configuration is incomplete' }, 500)
  }

  try {
    const body = await req.json() as Record<string, unknown>
    const targetUserId = body.user_id
    const newEmail = String(body.email ?? '').trim().toLowerCase()

    if (!isUuid(targetUserId)) return json({ ok: false, error: 'invalid user_id' }, 400)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail) || newEmail.length > 254) {
      return json({ ok: false, error: 'invalid email format' }, 400)
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
    const callerId = authData.user?.id ?? null
    if (!callerId) return json({ ok: false, error: 'authentication required' }, 401)
    if (callerId === targetUserId) {
      return json({ ok: false, error: 'cannot change your own login email from this tool' }, 400)
    }

    const { data: caller } = await admin.from('profiles').select('role, municipality_id, full_name')
      .eq('id', callerId).maybeSingle()
    if (!caller || !['admin', 'superadmin'].includes(String(caller.role))) {
      return json({ ok: false, error: 'permission denied' }, 403)
    }

    const { data: target } = await admin.from('profiles').select('role, municipality_id')
      .eq('id', targetUserId).maybeSingle()
    if (!target) return json({ ok: false, error: 'user not found' }, 404)
    if (target.role === 'superadmin') return json({ ok: false, error: 'cannot modify a superadmin account' }, 403)
    if (caller.role === 'admin' && target.role === 'admin') {
      return json({ ok: false, error: 'only superadmin can manage admin accounts' }, 403)
    }
    if (caller.role === 'admin' && target.municipality_id !== caller.municipality_id) {
      return json({ ok: false, error: 'permission denied: user is outside your municipality' }, 403)
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(targetUserId, {
      email: newEmail,
      email_confirm: true,
    })
    if (updateError) return json({ ok: false, error: cleanText(updateError.message, 300) }, 400)

    // profiles.email เป็นแค่ cache สำหรับแสดงผล ไม่ได้ถูก guard โดย
    // trg_guard_profile_privileged_update เลย — sync ตรงให้ตรงกับ auth.users.email จริง
    await admin.from('profiles').update({ email: newEmail }).eq('id', targetUserId)

    // ไม่เก็บอีเมลเต็มลง audit log (PII) เก็บแค่โดเมนพอให้ตรวจสอบย้อนหลังได้คร่าวๆ
    await admin.from('audit_logs').insert({
      municipality_id: target.municipality_id ?? caller.municipality_id,
      actor_id: callerId,
      actor_name: caller.full_name ?? null,
      actor_role: caller.role,
      action: 'admin_update_login_email',
      resource_type: 'profile',
      resource_id: targetUserId,
      metadata: { target_user_id: targetUserId, new_email_domain: newEmail.split('@')[1] ?? null },
    })

    return json({ ok: true })
  } catch (error) {
    console.error('admin-update-login-email failed:', error)
    return json({ ok: false, error: 'internal error' }, 500)
  }
})
