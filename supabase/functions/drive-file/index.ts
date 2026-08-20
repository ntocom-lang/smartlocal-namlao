// Supabase Edge Function: drive-file
// สตรีมไฟล์จาก Google Drive กลับให้ client ผ่านโดเมนของเราเอง — ใช้ 2 กรณี:
//   1) ไฟล์ private (ไม่แชร์สาธารณะ) — ต้อง login และเช็คสิทธิ์เจ้าของ/เทศบาล/superadmin เหมือนเดิม
//   2) ไฟล์ public (โลโก้/banner/header/รูปกิจกรรม ฯลฯ) — เดิมตั้งใจให้เปิดลิงก์ Drive ตรง
//      (lh3.googleusercontent.com หรือ drive.google.com/uc?id=) แต่พบว่า Chromium/Edge บล็อกการฝัง
//      รูปข้ามโดเมนแบบนี้ด้วย ORB (net::ERR_BLOCKED_BY_ORB) แม้ response จะถูกต้องทุกอย่างก็ตาม —
//      เลยต้อง proxy รูป public ผ่าน function นี้เหมือนกัน แต่ "ไม่บังคับ login" (ต่างจากไฟล์ private)
//      เพราะเป็นรูปสาธารณะที่ประชาชนทั่วไป (ไม่ล็อกอิน) ต้องเห็นได้ปกติจากหน้าเว็บ
// Secret ที่ต้องตั้งก่อนใช้งาน: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN (เหมือน drive-upload)
// Deploy: supabase functions deploy drive-file --no-verify-jwt (ต้องปิด JWT gate ระดับ gateway ด้วย
// ไม่งั้นคำขอแบบไม่ login ของไฟล์ public จะโดนบล็อกก่อนถึงโค้ดในนี้เลย)

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

  const url = new URL(req.url)
  const fileId = url.searchParams.get('id')
  if (!fileId) return json({ error: 'missing id' }, 400)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: fileRow } = await admin.from('drive_files').select('*').eq('id', fileId).maybeSingle()
  if (!fileRow) return json({ error: 'not found' }, 404)

  // ไฟล์ public: ข้ามการเช็ค login/สิทธิ์ทั้งหมด — ใครก็เปิดดูได้ (เจตนาเดียวกับตอนเคย hotlink Drive ตรง)
  if (!fileRow.is_public) {
    const authHeader = req.headers.get('authorization') ?? ''
    const token = authHeader.replace('Bearer ', '').trim()
    if (!token) return json({ error: 'unauthorized' }, 401)

    const authClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)
    const { data: { user }, error: authErr } = await authClient.auth.getUser(token)
    if (authErr || !user) return json({ error: 'unauthorized' }, 401)

    const { data: profile } = await admin.from('profiles').select('role, municipality_id').eq('id', user.id).maybeSingle()
    const isOwner = fileRow.owner_user_id === user.id
    const isSameMuniStaff = profile?.municipality_id === fileRow.municipality_id && INTERNAL_ROLES.has(profile?.role ?? '')
    const isSuperadmin = profile?.role === 'superadmin'
    if (!isOwner && !isSameMuniStaff && !isSuperadmin) return json({ error: 'forbidden' }, 403)
  }

  try {
    const accessToken = await getDriveAccessToken()
    const driveRes = await streamDriveFile(accessToken, fileId)
    if (!driveRes.ok || !driveRes.body) return json({ error: 'ไฟล์ไม่พบใน Drive' }, 404)
    return new Response(driveRes.body, {
      headers: {
        ...corsHeaders,
        'Content-Type': fileRow.content_type || 'application/octet-stream',
        // รูป public เปลี่ยน fileId ใหม่ทุกครั้งที่อัปโหลดอยู่แล้ว (ไม่มีการเขียนทับไฟล์เดิม) จึง cache
        // ยาวได้อย่างปลอดภัย ลดโหลด Drive API ซ้ำๆ เวลาประชาชนหลายคนเปิดหน้าเดียวกัน
        ...(fileRow.is_public ? { 'Cache-Control': 'public, max-age=31536000, immutable' } : {}),
      },
    })
  } catch (err) {
    console.error('drive-file failed:', err)
    return json({ error: String(err instanceof Error ? err.message : err) }, 500)
  }
})
