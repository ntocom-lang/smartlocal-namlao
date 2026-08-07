// ใช้ร่วมกันระหว่าง drive-upload/drive-file/drive-delete (คัดลอกไฟล์นี้ไว้ทุกโฟลเดอร์ เพราะ Edge Function
// แต่ละตัว deploy แยกกัน ไม่ได้แชร์ dependency ข้าม function อัตโนมัติ) — ห้ามแก้ไฟล์นี้แค่ที่เดียว
// ต้องแก้ทั้งคู่ให้ตรงกันเสมอ

// ใช้ OAuth refresh token ของบัญชี Google จริง (ไม่ใช่ Service Account) — เพราะ Service Account
// ไม่มีโควตาพื้นที่เก็บไฟล์เป็นของตัวเองเลย เขียนไฟล์ลง Drive ปกติไม่ได้ (ต้องใช้ Shared Drive ซึ่งเป็น
// ฟีเจอร์ Google Workspace เท่านั้น) วิธีนี้ทำให้ใช้โควตาจริงของบัญชี (เช่น Google One 5TB) ได้เต็มที่
// refresh_token ได้มาจากการยินยอมครั้งเดียวผ่าน drive-oauth-callback function (ดูไฟล์นั้น)
let cachedToken: { token: string; expiresAt: number } | null = null

export async function getDriveAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.token

  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET')
  const refreshToken = Deno.env.get('GOOGLE_OAUTH_REFRESH_TOKEN')
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN is not configured')
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })
  const data = await response.json()
  if (!response.ok || !data.access_token) {
    throw new Error(`Google token refresh failed: ${JSON.stringify(data)}`)
  }
  cachedToken = { token: data.access_token, expiresAt: now + (data.expires_in ?? 3600) }
  return data.access_token
}

const DRIVE_API = 'https://www.googleapis.com/drive/v3'

// ย้ายไฟล์ไปถังขยะของ Drive แทนลบถาวรทันที (trashed:true) — กู้คืนได้จากถังขยะ Google Drive เอง
// ภายใน 30 วันถ้าลบผิด ปลอดภัยกว่าสำหรับเอกสารราชการที่มีผลทางกฎหมาย แม้ฝั่งแอปจะเตือนผู้ใช้ว่า
// "ไม่สามารถกู้คืนได้" (หมายถึงกู้คืนจากในแอปไม่ได้ ไม่ได้แปลว่ากู้คืนจาก Drive ไม่ได้เลย)
export async function trashDriveFile(accessToken: string, fileId: string): Promise<void> {
  const res = await fetch(`${DRIVE_API}/files/${fileId}?supportsAllDrives=true`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  })
  if (!res.ok && res.status !== 404) {
    const data = await res.json().catch(() => ({}))
    throw new Error(`Drive trash failed: ${JSON.stringify(data)}`)
  }
}
