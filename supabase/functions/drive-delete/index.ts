// Supabase Edge Function: drive-delete
// ลบไฟล์บน Google Drive (จริงๆ คือย้ายลงถังขยะ — ดู trashDriveFile ใน _shared.ts) + ลบ mapping ออกจาก
// ตาราง drive_files — ต้อง login เสมอ (ไม่มี bucket ไหนอนุญาต anon ลบไฟล์ได้)
// Secret ที่ต้องตั้งก่อนใช้งาน: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET,
// GOOGLE_OAUTH_REFRESH_TOKEN (เหมือน drive-upload/drive-file)
// Deploy: supabase functions deploy drive-delete

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getDriveAccessToken, trashDriveFile } from './_shared.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const INTERNAL_ROLES = new Set(['superadmin', 'admin', 'officer', 'staff', 'technician'])

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.replace('Bearer ', '').trim()
  if (!token) return json({ error: 'unauthorized' }, 401)

  const authClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)
  const { data: { user }, error: authErr } = await authClient.auth.getUser(token)
  if (authErr || !user) return json({ error: 'unauthorized' }, 401)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid json body' }, 400)
  }
  const fileId = typeof body.fileId === 'string' ? body.fileId : ''
  if (!fileId) return json({ error: 'missing fileId' }, 400)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: fileRow } = await admin.from('drive_files').select('*').eq('id', fileId).maybeSingle()
  if (!fileRow) return json({ error: 'not found' }, 404)

  const { data: profile } = await admin.from('profiles').select('role, municipality_id').eq('id', user.id).maybeSingle()
  const isOwner = fileRow.owner_user_id === user.id
  const isSameMuniStaff = profile?.municipality_id === fileRow.municipality_id && INTERNAL_ROLES.has(profile?.role ?? '')
  const isSuperadmin = profile?.role === 'superadmin'
  if (!isOwner && !isSameMuniStaff && !isSuperadmin) return json({ error: 'forbidden' }, 403)

  try {
    const accessToken = await getDriveAccessToken()
    await trashDriveFile(accessToken, fileId)
    await admin.from('drive_files').delete().eq('id', fileId)
    return json({ ok: true })
  } catch (err) {
    console.error('drive-delete failed:', err)
    return json({ error: String(err instanceof Error ? err.message : err) }, 500)
  }
})
