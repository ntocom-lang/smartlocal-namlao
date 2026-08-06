// ใช้ร่วมกันระหว่าง drive-upload และ drive-file (คัดลอกไฟล์นี้ไว้ทั้ง 2 โฟลเดอร์ เพราะ Edge Function
// แต่ละตัว deploy แยกกัน ไม่ได้แชร์ dependency ข้าม function อัตโนมัติ) — ห้ามแก้ไฟล์นี้แค่ที่เดียว
// ต้องแก้ทั้งคู่ให้ตรงกันเสมอ

interface ServiceAccountKey {
  client_email: string
  private_key: string
  token_uri?: string
}

let cachedToken: { token: string; expiresAt: number } | null = null

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlEncodeString(s: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(s))
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

// ขอ access token จาก Service Account ผ่าน JWT bearer flow (เซ็นเองด้วย Web Crypto ไม่พึ่ง googleapis
// npm package ซึ่งหนักและใช้กับ Deno Edge Function ไม่ค่อยลื่น) แคชไว้ในตัวแปรระดับโมดูล ใช้ซ้ำได้
// ระหว่าง request ถ้า instance เดียวกันยังอุ่นอยู่ (ไม่ต้องขอใหม่ทุกครั้ง)
export async function getDriveAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.token

  const keyJson = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_KEY')
  if (!keyJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not configured')
  const key = JSON.parse(keyJson) as ServiceAccountKey

  const header = { alg: 'RS256', typ: 'JWT' }
  const claim = {
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: key.token_uri || 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }
  const unsigned = `${base64UrlEncodeString(JSON.stringify(header))}.${base64UrlEncodeString(JSON.stringify(claim))}`

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(key.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(unsigned))
  const jwt = `${unsigned}.${base64UrlEncodeBytes(new Uint8Array(signature))}`

  const response = await fetch(key.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  const data = await response.json()
  if (!response.ok || !data.access_token) {
    throw new Error(`Google token exchange failed: ${JSON.stringify(data)}`)
  }
  cachedToken = { token: data.access_token, expiresAt: now + (data.expires_in ?? 3600) }
  return data.access_token
}

const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'

async function findOrCreateFolder(accessToken: string, name: string, parentId: string): Promise<string> {
  const safeName = name.replace(/'/g, "\\'")
  const q = `name='${safeName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const listRes = await fetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  const listData = await listRes.json()
  if (listData.files?.length) return listData.files[0].id

  const createRes = await fetch(`${DRIVE_API}/files?supportsAllDrives=true`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  })
  const createData = await createRes.json()
  if (!createRes.ok) throw new Error(`Drive folder create failed: ${JSON.stringify(createData)}`)
  return createData.id
}

// เดินสร้าง/หาโฟลเดอร์ทีละชั้นตามลำดับ segments เช่น [หน่วยงาน, ปี, ประเภท, เรื่อง] คืน folder id ชั้นสุดท้าย
export async function resolveFolderChain(accessToken: string, rootId: string, segments: string[]): Promise<string> {
  let parentId = rootId
  for (const segment of segments) {
    parentId = await findOrCreateFolder(accessToken, segment, parentId)
  }
  return parentId
}

export async function uploadFileToDrive(
  accessToken: string, folderId: string, filename: string, contentType: string, bytes: Uint8Array,
): Promise<{ id: string; webViewLink: string }> {
  const boundary = 'smartlocal_' + crypto.randomUUID()
  const metadata = JSON.stringify({ name: filename, parents: [folderId] })
  const encoder = new TextEncoder()
  const head = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
  )
  const tail = encoder.encode(`\r\n--${boundary}--`)
  const body = new Uint8Array(head.length + bytes.length + tail.length)
  body.set(head, 0)
  body.set(bytes, head.length)
  body.set(tail, head.length + bytes.length)

  const res = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Drive upload failed: ${JSON.stringify(data)}`)
  return { id: data.id, webViewLink: data.webViewLink }
}

export async function makeFilePublic(accessToken: string, fileId: string): Promise<void> {
  await fetch(`${DRIVE_API}/files/${fileId}/permissions?supportsAllDrives=true`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  })
}

export async function streamDriveFile(accessToken: string, fileId: string): Promise<Response> {
  return fetch(`${DRIVE_API}/files/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}
