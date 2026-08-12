// Supabase Edge Function: drive-upload
// รับไฟล์ (base64) จาก client → อัปโหลดขึ้น Google Drive ในนามบัญชี Google จริงของผู้ดูแล (OAuth
// refresh token, credential ฝั่งเซิร์ฟเวอร์เท่านั้น ไม่เคยส่งออกไปฝั่งไคลเอนต์) → จัดเก็บในโครงสร้าง
// โฟลเดอร์ หน่วยงาน/ปี(พ.ศ.)/ประเภท/เรื่อง — ตั้งค่า refresh token ครั้งแรกผ่าน drive-oauth-callback
// Secret ที่ต้องตั้งก่อนใช้งาน: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET,
// GOOGLE_OAUTH_REFRESH_TOKEN, GOOGLE_DRIVE_ROOT_FOLDER_ID
// Deploy: supabase functions deploy drive-upload
//
// subject อาจส่งมาเป็นหลายระดับคั่นด้วย '/' เช่น 'civil/{id}' หรือ 'staff/{staffId}' — เจตนาให้เป็น
// โฟลเดอร์ซ้อนกันจริงๆ (ประเภท/รายการ) sanitizeSegment แต่ละท่อนแยกกันก่อนส่งเข้า resolveFolderChain
// (เคยมีบั๊ก: sanitize ทั้งก้อนเป็น segment เดียว ทำให้ได้โฟลเดอร์แบนราบชื่อ "civil_{id}" แทนที่จะซ้อน)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getDriveAccessToken, resolveFolderChain, uploadFileToDrive, makeFilePublic } from './_shared.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// key ต้องตรงกับชื่อ bucket เดิมใน Supabase Storage เป๊ะ (เทียบเท่ากันคนละที่เก็บ) — ป้ายไทยไว้ตั้งชื่อโฟลเดอร์
const BUCKET_LABELS: Record<string, string> = {
  'complaint-attachments': 'คำร้อง',
  'event-attachments': 'กิจกรรม',
  'municipality-assets': 'ทรัพย์สินเทศบาล',
  logos: 'โลโก้',
  avatars: 'รูปโปรไฟล์',
  'official-documents': 'เอกสารราชการ',
  'payment-slips': 'สลิปโอนเงิน',
  'document-certs': 'ใบรับรอง',
  'org-documents': 'เอกสารหน่วยงาน',
}
// บัคเก็ตที่เดิมตั้งเป็น public ใน Supabase Storage — ไฟล์ในนี้จะแชร์ "ทุกคนที่มีลิงก์ดูได้" ตอนอัปโหลด
// ที่เหลือ (payment-slips/official-documents/org-documents/document-certs) ไม่แชร์เลย ต้องผ่าน drive-file
// function เท่านั้นถึงจะเห็นเนื้อไฟล์ — ตรงกับ public:true/false ของบัคเก็ตเดิมที่ตรวจไว้แล้ว
const PUBLIC_BUCKETS = new Set(['complaint-attachments', 'event-attachments', 'municipality-assets', 'logos', 'avatars'])
const ALLOWED_BUCKETS = new Set(Object.keys(BUCKET_LABELS))

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

// กันชื่อโฟลเดอร์/ไฟล์มีอักขระที่ Drive หรือ OS ปลายทางไม่ชอบ (ผู้ใช้พิมพ์หัวเรื่องเองได้ ต้อง sanitize)
function sanitizeSegment(name: unknown): string {
  const cleaned = String(name ?? '').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 100)
  return cleaned || 'ไม่ระบุ'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid json body' }, 400)
  }
  const bucket = String(body.bucket ?? '')
  const subject = body.subject
  const filename = body.filename
  const contentType = typeof body.contentType === 'string' ? body.contentType : 'application/octet-stream'
  const base64Data = body.data

  if (!ALLOWED_BUCKETS.has(bucket)) return json({ error: 'invalid bucket' }, 400)
  if (!filename || typeof base64Data !== 'string') return json({ error: 'missing filename or data' }, 400)

  // complaint-attachments เท่านั้นที่อนุญาตให้ "ไม่ login" อัปโหลดได้ — ต้องตรงกับ RLS policy เดิมของ
  // Supabase Storage bucket เดียวกันเป๊ะๆ ("allow upload complaint-attachments", roles: anon,authenticated)
  // บัคเก็ตอื่นทั้งหมดยังคง "ต้อง login" เหมือนเดิมทุกประการ ห้ามขยาย allowAnon เพิ่ม
  const allowAnon = bucket === 'complaint-attachments'

  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.replace('Bearer ', '').trim()
  let user: { id: string } | null = null
  if (token) {
    const authClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)
    const { data } = await authClient.auth.getUser(token)
    user = data?.user ?? null
  }
  if (!user && !allowAnon) return json({ error: 'unauthorized' }, 401)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // superadmin ไม่ผูกกับเทศบาลใดเทศบาลหนึ่ง (municipality_id เป็น null ปกติ) จึงต้องให้ระบุ municipality
  // (slug) มาใน body เอง — user ทั่วไปใช้ municipality_id ของตัวเองเสมอ ห้าม override จาก body เด็ดขาด
  // ผู้ใช้ไม่ login ไม่มี profile ให้ดูเทศบาลจาก DB ได้เลย ต้องรับ slug จาก client เสมอ
  let municipalityId: string
  let municipalitySlug: string
  const profile = user ? (await admin.from('profiles').select('role, municipality_id').eq('id', user.id).maybeSingle()).data : null
  if (profile?.municipality_id) {
    const { data: municipality } = await admin.from('municipalities').select('id, slug').eq('id', profile.municipality_id).single()
    if (!municipality) return json({ error: 'municipality not found' }, 404)
    municipalityId = municipality.id
    municipalitySlug = municipality.slug
  } else if ((!user || profile?.role === 'superadmin') && typeof body.municipality === 'string' && body.municipality) {
    const { data: municipality } = await admin.from('municipalities').select('id, slug').eq('slug', body.municipality).maybeSingle()
    if (!municipality) return json({ error: 'ไม่พบเทศบาลตาม slug ที่ระบุ' }, 404)
    municipalityId = municipality.id
    municipalitySlug = municipality.slug
  } else {
    return json({ error: 'ไม่พบเทศบาล (ต้องระบุ municipality slug มาใน body)' }, 403)
  }

  const rootFolderId = Deno.env.get('GOOGLE_DRIVE_ROOT_FOLDER_ID')
  if (!rootFolderId) return json({ error: 'GOOGLE_DRIVE_ROOT_FOLDER_ID is not configured' }, 500)

  let bytes: Uint8Array
  try {
    const binaryStr = atob(base64Data)
    bytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
  } catch {
    return json({ error: 'invalid base64 data' }, 400)
  }
  // 25MB — EventsManager.jsx อนุญาตไฟล์แนบกิจกรรมสูงสุด 20MB ต้องเผื่อ headroom (เดิม 15MB)
  if (bytes.length > 25 * 1024 * 1024) return json({ error: 'ไฟล์ใหญ่เกิน 25MB' }, 413)

  try {
    const accessToken = await getDriveAccessToken()
    const yearBE = String(new Date().getFullYear() + 543) // ปี พ.ศ. ตามธรรมเนียมราชการไทย
    const subjectSegments = String(subject || 'ทั่วไป').split('/').map((s) => sanitizeSegment(s)).filter(Boolean)
    const folderId = await resolveFolderChain(accessToken, rootFolderId, [
      sanitizeSegment(municipalitySlug),
      yearBE,
      BUCKET_LABELS[bucket],
      ...(subjectSegments.length ? subjectSegments : ['ทั่วไป']),
    ])
    const uploaded = await uploadFileToDrive(accessToken, folderId, sanitizeSegment(filename), contentType, bytes)

    const isPublic = PUBLIC_BUCKETS.has(bucket)
    if (isPublic) await makeFilePublic(accessToken, uploaded.id)

    const { error: insertErr } = await admin.from('drive_files').insert({
      id: uploaded.id,
      bucket,
      municipality_id: municipalityId,
      owner_user_id: user?.id ?? null,
      is_public: isPublic,
      filename: sanitizeSegment(filename),
      content_type: contentType,
      web_view_link: uploaded.webViewLink,
    })
    if (insertErr) console.error('drive_files insert failed (ไฟล์ขึ้น Drive แล้วแต่บันทึก mapping ไม่สำเร็จ):', insertErr.message)

    // uc?id= เดิมเปิดตรงจากมือถือแล้วบางทีเด้งไปหน้า "เลือกบัญชี Google" แทนที่จะโชว์รูป (Google เปลี่ยน
    // พฤติกรรม endpoint นี้ ไม่ใช่ endpoint ที่ตั้งใจให้ hotlink โดยตรง) — รูปภาพใช้ lh3.googleusercontent.com
    // (CDN รูปของ Google เอง เสถียรกว่าสำหรับ hotlink ตรงมาก) แทน ไฟล์ที่ไม่ใช่รูป (PDF ฯลฯ) ยังใช้ uc?id=
    // เหมือนเดิมไปก่อน (ยังไม่มีปัญหารายงานเข้ามาสำหรับไฟล์ประเภทนี้)
    const url = isPublic
      ? (contentType.startsWith('image/') ? `https://lh3.googleusercontent.com/d/${uploaded.id}=s0` : `https://drive.google.com/uc?id=${uploaded.id}`)
      : `drive:${uploaded.id}`
    return json({ fileId: uploaded.id, url })
  } catch (err) {
    console.error('drive-upload failed:', err)
    return json({ error: String(err instanceof Error ? err.message : err) }, 500)
  }
})
