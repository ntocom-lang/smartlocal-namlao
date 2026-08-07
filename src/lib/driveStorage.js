import { supabase, supabaseUrl } from './supabase'

// อัปโหลด/อ่านไฟล์ผ่าน Google Drive แทน Supabase Storage — ต้องผ่าน Edge Function (drive-upload/
// drive-file) เสมอ ห้ามเรียก Google Drive API ตรงจากเบราว์เซอร์เด็ดขาด เพราะ Service Account
// credential (private key) ต้องอยู่ฝั่งเซิร์ฟเวอร์เท่านั้น — ถ้าฝังในโค้ดฝั่งไคลเอนต์ (เช่นผ่าน
// import.meta.env.VITE_*) จะรั่วไปอยู่ใน JS bundle ที่ส่งถึงเบราว์เซอร์ทุกคนทันที (ดูปัญหาเดียวกัน
// ที่เคยพบใน r2Storage.js — เก็บไว้เป็นบทเรียน ไม่ใช้ pattern เดียวกันซ้ำ)
//
// bucket ต้องอยู่ใน whitelist ที่ตรงกับ Supabase Storage bucket เดิม (เช็คซ้ำอีกทีฝั่ง Edge Function)
// subject = หัวเรื่อง ใช้ตั้งชื่อโฟลเดอร์ย่อยสุดท้าย (เช่น เลขที่คำร้อง/ชื่อกิจกรรม) ไม่ใส่ก็ได้ จะตกไปที่ "ทั่วไป"

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
      contentType: file.type || 'application/octet-stream',
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

// ตัวช่วยแยกว่า url ที่เก็บไว้เป็นไฟล์ private ของ Drive หรือเป็น URL ปกติ (public/ของเดิมจาก Supabase)
export function isPrivateDriveRef(url) {
  return typeof url === 'string' && url.startsWith('drive:')
}

export function driveFileIdFromRef(url) {
  return isPrivateDriveRef(url) ? url.slice('drive:'.length) : null
}
