import { supabase, supabaseUrl } from './supabase'

// อัปโหลด/อ่านไฟล์ผ่าน Google Drive แทน Supabase Storage — ต้องผ่าน Edge Function (drive-upload/
// drive-file) เสมอ ห้ามเรียก Google Drive API ตรงจากเบราว์เซอร์เด็ดขาด เพราะ Service Account
// credential (private key) ต้องอยู่ฝั่งเซิร์ฟเวอร์เท่านั้น — ถ้าฝังในโค้ดฝั่งไคลเอนต์ (เช่นผ่าน
// import.meta.env.VITE_*) จะรั่วไปอยู่ใน JS bundle ที่ส่งถึงเบราว์เซอร์ทุกคนทันที (ดูปัญหาเดียวกัน
// ที่เคยพบใน r2Storage.js — เก็บไว้เป็นบทเรียน ไม่ใช้ pattern เดียวกันซ้ำ)
//
// bucket ต้องอยู่ใน whitelist ที่ตรงกับ Supabase Storage bucket เดิม (เช็คซ้ำอีกทีฝั่ง Edge Function)
// subject = หัวเรื่อง ใช้ตั้งชื่อโฟลเดอร์ย่อยสุดท้าย (เช่น เลขที่คำร้อง/ชื่อกิจกรรม) ไม่ใส่ก็ได้ จะตกไปที่ "ทั่วไป"

// เดา content type จากนามสกุลไฟล์ ใช้เฉพาะตอน file.type ว่าง — กล้องมือถือ Android/iOS บางรุ่นคืน
// file.type="" มาเปล่าๆ (ปัญหาที่รู้กันแล้วใน compressImage ของ imageUtils.js) ถ้าไม่มี fallback
// contentType จะตกไปเป็น 'application/octet-stream' ทำให้ <img>/<iframe> บางเบราว์เซอร์ไม่ยอมเรนเดอร์
// ไฟล์ตรงๆ ทั้งที่จริงเป็นรูป/PDF ปกติ
const EXT_CONTENT_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp',
  pdf: 'application/pdf', html: 'text/html', htm: 'text/html',
}
function guessContentType(file) {
  if (file.type) return file.type
  const ext = (file.name ?? '').split('.').pop()?.toLowerCase()
  return EXT_CONTENT_TYPES[ext] || 'application/octet-stream'
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      resolve(typeof result === 'string' ? (result.split(',')[1] ?? '') : '')
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/**
 * @param {string} bucket - ต้องตรงกับ Supabase Storage bucket เดิม เช่น 'complaint-attachments'
 * @param {File|Blob} file
 * @param {{ subject?: string, filename?: string, municipality?: string }} [options] - municipality:
 *   slug ของเทศบาล ต้องส่งมาด้วยเสมอถ้าผู้ใช้ไม่ได้ login (เช่นประชาชนยื่นคำร้องแบบไม่ล็อกอิน) เพราะฝั่ง
 *   Edge Function ไม่มี profile ให้ดูเทศบาลจาก DB ได้ ต้องรู้จาก useTenant() ของโดเมนที่เปิดอยู่แทน
 * @returns {Promise<{ url: string|null, fileId: string|null, error: any }>}
 */
export async function uploadFile(bucket, file, options = {}) {
  let base64Data
  try {
    base64Data = await fileToBase64(file)
  } catch (err) {
    return { url: null, fileId: null, error: err }
  }

  const { data, error } = await supabase.functions.invoke('drive-upload', {
    body: {
      bucket,
      subject: options.subject ?? '',
      filename: options.filename || file.name || `file-${Date.now()}`,
      contentType: guessContentType(file),
      data: base64Data,
      ...(options.municipality ? { municipality: options.municipality } : {}),
    },
  })
  if (error) return { url: null, fileId: null, error }
  if (data?.error) return { url: null, fileId: null, error: new Error(data.error) }
  return { url: data.url, fileId: data.fileId, error: null }
}

// ไฟล์ public (url ขึ้นต้น https://) เปิดตรงได้เลย ไม่ต้องเรียกฟังก์ชันนี้
// ไฟล์ private (url รูปแบบ 'drive:FILE_ID' ที่ได้จาก uploadFile) ต้องแลกเป็น blob URL ผ่านตรงนี้ก่อนแสดงผล
// คืน blob: URL — อย่าลืม URL.revokeObjectURL() ตอนเลิกใช้ (เช่นตอน component unmount) กัน memory leak
export async function resolvePrivateFileUrl(fileId) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return { url: null, error: new Error('ยังไม่ได้เข้าสู่ระบบ') }

  const response = await fetch(`${supabaseUrl}/functions/v1/drive-file?id=${encodeURIComponent(fileId)}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    return { url: null, error: new Error(body?.error || `โหลดไฟล์ไม่สำเร็จ (${response.status})`) }
  }
  const blob = await response.blob()
  return { url: URL.createObjectURL(blob), error: null }
}

// ลบไฟล์ (จริงๆ คือย้ายลงถังขยะ Drive — ดูเหตุผลใน drive-delete/_shared.ts) ใช้ได้กับทั้งไฟล์ public/
// private เพราะเช็คสิทธิ์จากตาราง drive_files ฝั่งเซิร์ฟเวอร์เอง ไม่ใช่จาก URL — ต้อง login เสมอ
export async function deleteFile(fileId) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return { error: new Error('ยังไม่ได้เข้าสู่ระบบ') }

  const { data, error } = await supabase.functions.invoke('drive-delete', { body: { fileId } })
  if (error) return { error }
  if (data?.error) return { error: new Error(data.error) }
  return { error: null }
}

// ไฟล์รูป public ที่อัปโหลดขึ้น Drive เคยถูกบันทึก URL hotlink ตรงไว้ใน DB 2 แบบเก่า:
//   1) https://drive.google.com/uc?id=...        (เด้งไปหน้า "เลือกบัญชี Google" บนมือถือบางเครื่อง)
//   2) https://lh3.googleusercontent.com/d/...=s0 (ถูก Chromium/Edge บล็อกด้วย ORB — net::ERR_BLOCKED_BY_ORB
//      เวลาฝังเป็น <img> ข้ามโดเมน แม้ response จะถูกต้องทุกอย่างก็ตาม)
// ทั้งคู่ไม่เสถียรพอให้ hotlink ตรง — อัปโหลดใหม่จะได้ URL แบบ proxy ผ่าน drive-file function ของเราเองแล้ว
// (ดู drive-upload/index.ts) แต่ของเก่าที่เก็บไว้ใน DB ยังเป็น 2 รูปแบบเดิม แก้ทันทีที่แสดงผลแทนการไล่แก้
// ข้อมูลเก่าทีละแถว — ปลอดภัยเรียกซ้ำได้ (URL ที่ไม่เข้าเงื่อนไขจะคืนค่าเดิมกลับไปเฉยๆ)
export function toReliableImageUrl(url) {
  if (typeof url !== 'string') return url
  const ucMatch = url.match(/^https:\/\/drive\.google\.com\/uc\?id=([^&]+)/)
  if (ucMatch) return `${supabaseUrl}/functions/v1/drive-file?id=${ucMatch[1]}`
  const lh3Match = url.match(/^https:\/\/lh3\.googleusercontent\.com\/d\/([^=&]+)=/)
  if (lh3Match) return `${supabaseUrl}/functions/v1/drive-file?id=${lh3Match[1]}`
  return url
}

// ตัวช่วยแยกว่า url ที่เก็บไว้เป็นไฟล์ private ของ Drive หรือเป็น URL ปกติ (public/ของเดิมจาก Supabase)
export function isPrivateDriveRef(url) {
  return typeof url === 'string' && url.startsWith('drive:')
}

export function driveFileIdFromRef(url) {
  return isPrivateDriveRef(url) ? url.slice('drive:'.length) : null
}
