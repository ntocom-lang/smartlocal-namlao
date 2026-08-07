// Supabase Edge Function: drive-oauth-callback
// ใช้ครั้งเดียวตอน setup — ขอสิทธิ์เขียนไฟล์ Google Drive "ในนามบัญชี Google จริง" ของผู้ดูแลระบบ
// (ไม่ใช่ Service Account ที่ไม่มีโควตาพื้นที่เก็บไฟล์เป็นของตัวเอง) แลกเป็น refresh_token เก็บถาวร
// ฝั่งเซิร์ฟเวอร์ ให้ drive-upload/drive-file ใช้ขอ access_token สดใหม่ได้เรื่อยๆ โดยไม่ต้อง login ซ้ำ
//
// verify_jwt ปิดไว้ (deploy ด้วย --no-verify-jwt) เพราะ Google redirect กลับมาแบบ browser navigation
// ธรรมดา ไม่มี Supabase bearer token ส่งมาด้วย — ป้องกันด้วย setup_key query param แทน (สุ่มเองแล้วตั้ง
// เป็น secret DRIVE_OAUTH_SETUP_KEY ก่อนใช้งาน)
//
// วิธีใช้: เปิด https://umxssfahtuprnztlytdd.supabase.co/functions/v1/drive-oauth-callback?setup_key=xxx
// ด้วยเบราว์เซอร์ที่ login บัญชี Google ที่ต้องการใช้เก็บไฟล์อยู่ → ยินยอมสิทธิ์ → คัดลอก refresh_token
// ที่โชว์ไปตั้งเป็น secret GOOGLE_OAUTH_REFRESH_TOKEN → ลบ secret DRIVE_OAUTH_SETUP_KEY ทิ้ง (ใช้ครั้งเดียวพอ)
//
// Secrets ที่ต้องตั้งก่อนใช้งาน: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, DRIVE_OAUTH_SETUP_KEY
// Deploy: supabase functions deploy drive-oauth-callback --no-verify-jwt

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const REDIRECT_URI = 'https://umxssfahtuprnztlytdd.supabase.co/functions/v1/drive-oauth-callback'
const SCOPE = 'https://www.googleapis.com/auth/drive'

function html(body: string, status = 200) {
  return new Response(
    `<!doctype html><html><body style="font-family: system-ui, sans-serif; max-width: 640px; margin: 40px auto; line-height: 1.6;">${body}</body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

serve(async (req) => {
  const url = new URL(req.url)

  const code = url.searchParams.get('code')
  // ขา 1 (ยังไม่มี code): setup_key มาจาก query param ตรงๆ ที่ผู้ใช้พิมพ์เอง
  // ขา 2 (Google redirect กลับมาพร้อม code): Google ไม่ส่ง query param เดิมกลับมาให้ นอกจาก code/state
  // เท่านั้น — setup_key ที่ฝากไว้ใน state ตอนขา 1 (บรรทัดล่างๆ) เลยต้องอ่านจาก state แทนตรงนี้
  const setupKey = Deno.env.get('DRIVE_OAUTH_SETUP_KEY')
  const providedKey = code ? url.searchParams.get('state') : url.searchParams.get('setup_key')
  if (!setupKey || providedKey !== setupKey) {
    return html('<p><b>Forbidden</b> — setup_key ไม่ถูกต้อง หรือยังไม่ได้ตั้ง secret DRIVE_OAUTH_SETUP_KEY</p>', 403)
  }

  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET')
  if (!clientId || !clientSecret) {
    return html('<p>ยังไม่ได้ตั้ง secret GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET</p>', 500)
  }

  // ขา 1: ยังไม่มี code — พาไปหน้ายินยอมของ Google ก่อน
  if (!code) {
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', SCOPE)
    authUrl.searchParams.set('access_type', 'offline') // ต้องมีถึงจะได้ refresh_token กลับมาด้วย
    authUrl.searchParams.set('prompt', 'consent') // บังคับขึ้นหน้ายินยอมทุกครั้ง กัน Google งดส่ง refresh_token ซ้ำ
    authUrl.searchParams.set('state', providedKey) // ส่ง setup_key กลับมาด้วยตอน redirect กลับ (ขา 2 จะได้เช็คได้อีกรอบ)
    return Response.redirect(authUrl.toString(), 302)
  }

  // ขา 2: Google redirect กลับมาพร้อม code แล้ว — แลกเป็น token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })
  const tokenData = await tokenRes.json()

  if (!tokenRes.ok || !tokenData.refresh_token) {
    return html(`
      <p><b>แลก token ไม่สำเร็จ</b></p>
      <pre style="background:#f5f5f5; padding:12px; overflow:auto;">${JSON.stringify(tokenData, null, 2)}</pre>
      <p>ถ้าไม่มี refresh_token กลับมา: ไปที่ <a href="https://myaccount.google.com/permissions" target="_blank">Google Account → Third-party access</a>
      ถอนสิทธิ์แอปนี้ออกก่อน แล้วเปิดลิงก์ตั้งค่าใหม่อีกครั้ง (ต้อง prompt=consent ถึงจะได้ refresh_token ทุกครั้งที่ยินยอมใหม่)</p>
    `, 400)
  }

  return html(`
    <p>✅ <b>สำเร็จ!</b> คัดลอกค่าด้านล่างทั้งหมด ไปตั้งเป็น secret ชื่อ <code>GOOGLE_OAUTH_REFRESH_TOKEN</code> ใน Supabase Dashboard</p>
    <textarea readonly style="width:100%; height:80px; font-family: monospace;">${tokenData.refresh_token}</textarea>
    <p>ตั้งเสร็จแล้ว <b>ลบ secret <code>DRIVE_OAUTH_SETUP_KEY</code> ทิ้งได้เลย</b> (ไม่ต้องใช้อีก กันหน้านี้ถูกเปิดซ้ำโดยไม่ตั้งใจ)</p>
  `)
})
