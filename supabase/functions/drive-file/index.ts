// Supabase Edge Function: drive-file
// สตรีมไฟล์ที่เป็น "private" (ไม่แชร์สาธารณะ) จาก Google Drive กลับให้ client — Drive เองไม่มีแนวคิด
// สิทธิ์แบบเทศบาล/เจ้าของ จึงต้องเช็คผ่านตาราง drive_files (mapping ที่ drive-upload บันทึกไว้) ก่อนทุกครั้ง
// ไฟล์ public (complaint-attachments ฯลฯ) ไม่ต้องผ่าน function นี้ เปิดลิงก์ Drive ตรงได้เลย
// Secret ที่ต้องตั้งก่อนใช้งาน: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN (เหมือน drive-upload)
// Deploy: supabase functions deploy drive-file

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getDriveAccessToken, streamDriveFile } from './_shared.ts'

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

  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.replace('Bearer ', '').trim()
  if (!token) return json({ error: 'unauthorized' }, 401)

  const authClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)
  const { data: { user }, error: authErr } = await authClient.auth.getUser(token)
  if (authErr || !user) return json({ error: 'unauthorized' }, 401)

  const url = new URL(req.url)
  const fileId = url.searchParams.get('id')
  if (!fileId) return json({ error: 'missing id' }, 400)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: fileRow } = await admin.from('drive_files').select('*').eq('id', fileId).maybeSingle()
  if (!fileRow) return json({ error: 'not found' }, 404)

  const { data: profile } = await admin.from('profiles').select('role, municipality_id').eq('id', user.id).maybeSingle()
  const isOwner = fileRow.owner_user_id === user.id
  const isSameMuniStaff = profile?.municipality_id === fileRow.municipality_id && INTERNAL_ROLES.has(profile?.role ?? '')
  const isSuperadmin = profile?.role === 'superadmin'

  if (!fileRow.is_public && !isOwner && !isSameMuniStaff && !isSuperadmin) {
    return json({ error: 'forbidden' }, 403)
  }

  try {
    const accessToken = await getDriveAccessToken()
    const driveRes = await streamDriveFile(accessToken, fileId)
    if (!driveRes.ok || !driveRes.body) return json({ error: 'ไฟล์ไม่พบใน Drive' }, 404)
    return new Response(driveRes.body, {
      headers: { ...corsHeaders, 'Content-Type': fileRow.content_type || 'application/octet-stream' },
    })
  } catch (err) {
    console.error('drive-file failed:', err)
    return json({ error: String(err instanceof Error ? err.message : err) }, 500)
  }
})
