import { supabase } from './supabase'

export const FLEET_DOCUMENT_BUCKET = 'fleet-documents'
export const FLEET_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

const EXTENSION_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
}

export function validateFleetDocument(file) {
  if (!file) return null
  if (file.size > FLEET_DOCUMENT_MAX_BYTES) {
    return 'ไฟล์ต้องมีขนาดไม่เกิน 10 MB'
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return 'รองรับเฉพาะ JPG, PNG, WebP, PDF, CSV และ XLSX'
  }
  return null
}

export async function uploadFleetDocument({ tenantId, scope, recordId, file }) {
  const validationError = validateFleetDocument(file)
  if (validationError) throw new Error(validationError)
  if (!tenantId || !recordId || !scope) throw new Error('ข้อมูลปลายทางเอกสารไม่ครบถ้วน')

  const extension = EXTENSION_BY_MIME[file.type]
  const path = `${tenantId}/${scope}/${recordId}/${crypto.randomUUID()}.${extension}`
  const { error } = await supabase.storage
    .from(FLEET_DOCUMENT_BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false,
    })

  if (error) throw error
  return path
}

export async function getFleetDocumentUrl(path, expiresIn = 300) {
  if (!path) throw new Error('ไม่พบเอกสาร')

  // รองรับข้อมูลเก่าที่บันทึกเป็น URL แต่บังคับเฉพาะ HTTPS
  if (/^https:\/\//i.test(path)) return path
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) throw new Error('รูปแบบที่อยู่เอกสารไม่ปลอดภัย')

  const { data, error } = await supabase.storage
    .from(FLEET_DOCUMENT_BUCKET)
    .createSignedUrl(path, expiresIn)

  if (error) throw error
  return data.signedUrl
}

export async function openFleetDocument(path) {
  const url = await getFleetDocumentUrl(path)
  const win = window.open(url, '_blank', 'noopener,noreferrer')
  if (!win) window.location.assign(url)
}

export async function removeFleetDocument(path) {
  if (!path || /^https:\/\//i.test(path)) return
  const { error } = await supabase.storage.from(FLEET_DOCUMENT_BUCKET).remove([path])
  if (error) throw error
}
