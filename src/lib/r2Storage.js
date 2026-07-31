import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { supabase } from './supabase'

const accountId = import.meta.env.VITE_R2_ACCOUNT_ID
const accessKeyId = import.meta.env.VITE_R2_ACCESS_KEY_ID
const secretAccessKey = import.meta.env.VITE_R2_SECRET_ACCESS_KEY
const bucketName = import.meta.env.VITE_R2_BUCKET_NAME || 'smartlocal-files'
const publicUrl = import.meta.env.VITE_R2_PUBLIC_URL

export const isR2Configured = Boolean(accountId && accessKeyId && secretAccessKey && publicUrl)

let s3Client = null
if (isR2Configured) {
  s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  })
}

/**
 * Uploads a file to Cloudflare R2 (with automatic fallback to Supabase Storage if R2 keys are missing)
 * @param {string} bucket - Storage bucket / category name (e.g. 'complaint-attachments')
 * @param {string} path - File path key inside the bucket
 * @param {File|Blob|Uint8Array} file - Binary file content
 * @param {object} [options] - Additional options (contentType, upsert)
 * @returns {Promise<{ publicUrl: string | null, error: any }>}
 */
export async function uploadFile(bucket, path, file, options = {}) {
  const fullKey = `${bucket}/${path}`

  if (isR2Configured && s3Client) {
    try {
      let bodyData = file
      if (file instanceof Blob && typeof file.arrayBuffer === 'function') {
        bodyData = new Uint8Array(await file.arrayBuffer())
      }

      const contentType = options.contentType || file.type || 'application/octet-stream'

      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: fullKey,
        Body: bodyData,
        ContentType: contentType,
      })

      await s3Client.send(command)

      const baseUrl = publicUrl.endsWith('/') ? publicUrl.slice(0, -1) : publicUrl
      const finalUrl = `${baseUrl}/${fullKey}`

      return { publicUrl: finalUrl, error: null }
    } catch (err) {
      console.error('[R2 Storage Error] Failed to upload to Cloudflare R2:', err)
      return { publicUrl: null, error: err }
    }
  }

  // Fallback to Supabase Storage if R2 is not configured
  const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: options.upsert ?? true,
    contentType: options.contentType,
  })

  if (upErr) return { publicUrl: null, error: upErr }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return { publicUrl: data?.publicUrl || null, error: null }
}

/**
 * Deletes a file from Cloudflare R2 (or Supabase Storage as fallback)
 * @param {string} bucket - Bucket name
 * @param {string} path - File path key
 * @returns {Promise<{ success: boolean, error: any }>}
 */
export async function deleteFile(bucket, path) {
  const fullKey = `${bucket}/${path}`

  if (isR2Configured && s3Client) {
    try {
      const command = new DeleteObjectCommand({
        Bucket: bucketName,
        Key: fullKey,
      })
      await s3Client.send(command)
      return { success: true, error: null }
    } catch (err) {
      console.error('[R2 Storage Error] Failed to delete from R2:', err)
      return { success: false, error: err }
    }
  }

  const { error } = await supabase.storage.from(bucket).remove([path])
  return { success: !error, error }
}
