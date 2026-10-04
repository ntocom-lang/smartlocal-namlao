function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

function doBlob(canvas, outName, quality) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      canvas.width = 0
      canvas.height = 0
      reject(new Error('toBlob_timeout'))
    }, 3_000)
    try {
      canvas.toBlob(
        (blob) => {
          clearTimeout(timer)
          canvas.width = 0
          canvas.height = 0
          if (blob) resolve(new File([blob], outName, { type: 'image/jpeg' }))
          else reject(new Error('toBlob_null'))
        },
        'image/jpeg',
        quality,
      )
    } catch (err) {
      clearTimeout(timer)
      canvas.width = 0
      canvas.height = 0
      reject(err)
    }
  })
}

function drawToCanvas(source, w, h) {
  const canvas = document.createElement('canvas')
  canvas.width  = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  // JPEG ไม่มีช่องโปร่งใส — ถ้าไม่รองพื้นขาวก่อน ส่วนโปร่งใสของ PNG จะกลายเป็นสีดำ
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(source, 0, 0, w, h)
  return canvas
}

async function resizeOnCanvas(file, maxPx, quality) {
  const outName = (file.name ?? 'photo').replace(/\.[^.]+$/, '.jpg')

  // ─── primary: createImageBitmap ──────────────────
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await Promise.race([
        createImageBitmap(file, { resizeWidth: maxPx, resizeQuality: 'medium' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('bitmap_timeout')), 3_000)),
      ])
      const canvas = drawToCanvas(bitmap, bitmap.width, bitmap.height)
      bitmap.close()
      return await doBlob(canvas, outName, quality)
    } catch {
      // fall through → img element fallback
    }
  }

  // ─── fallback: img element ───────────────
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    const timer = setTimeout(() => {
      URL.revokeObjectURL(url)
      reject(new Error('image_load_timeout'))
    }, 3_000)
    img.onload = async () => {
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      const scale  = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = drawToCanvas(img, Math.round(img.naturalWidth * scale), Math.round(img.naturalHeight * scale))
      try { resolve(await doBlob(canvas, outName, quality)) } catch (e) { reject(e) }
    }
    img.onerror = () => {
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      reject(new Error('image_load_error'))
    }
    img.src = url
  })
}

/**
 * บีบอัดรูปภาพ — ลดขนาดให้ได้ไม่เกิน ~1 MB
 * รองรับกล้อง Android/iOS ที่คืน file.type="" (ว่าง) โดยเช็ค extension ด้วย
 * หากค้างหรือเกิดข้อผิดพลาดจะคืนค่าไฟล์เดิมทันที ไม่บล็อกการทำงาน
 */
export async function compressImage(file, maxPx, quality = 0.80, { skipUnder = 1.5 * 1024 * 1024 } = {}) {
  if (!file) return file

  // หากไฟล์เล็กกว่า 1.5 MB อยู่แล้ว ไม่จำเป็นต้องบีบอัด เพื่อหลีกเลี่ยง canvas memory hang บนมือถือ
  // (skipUnder ปรับได้สำหรับรูปที่แสดงบนหน้าสาธารณะ — ดู limitPublicImage ข้างล่าง)
  if (file.size <= skipUnder) return file

  const hasImageMime = typeof file.type === 'string' && file.type.startsWith('image/')
  const hasImageExt  = /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp|tiff?)$/i.test(file.name ?? '')
  if (!hasImageMime && !hasImageExt) return file

  try {
    const compressPromise = (async () => {
      if (maxPx === undefined) {
        maxPx = isMobile() ? 1024 : 1280
      }
      let out = await resizeOnCanvas(file, maxPx, quality)
      if (out.size > 1_024 * 1_024) {
        out = await resizeOnCanvas(out, 800, 0.60)
      }
      return out
    })()

    const timeoutPromise = new Promise((resolve) =>
      setTimeout(() => resolve(file), 4_000)
    )

    return await Promise.race([compressPromise, timeoutPromise])
  } catch (err) {
    console.warn('compressImage failed, fallback to original file:', err)
    return file
  }
}

// ── ด่านกลางก่อนอัปโหลดรูปที่แสดงบนหน้าสาธารณะ ─────────────────────────────────────────
//
// เหตุการณ์จริง 2026-10-04: แบนเนอร์ PNG ใหญ่สุด 4.72 MB ถูกอัปโหลดแบบไม่ย่อ แล้วหน้าแรกโหลดซ้ำจน
// Cached Egress ของ Supabase เกินโควตาแผนฟรี (5 GB) ทั้งโปรเจกต์ตอบ 402 ทุกเว็บ
// ของเดิมพึ่งให้ "แต่ละปุ่มอัปโหลดเรียก compressImage เอง" ซึ่งลืมได้ (แบนเนอร์/ไฟล์แนบอีเวนต์ลืมจริง)
// จึงบังคับที่ uploadFile() จุดเดียว: ใครเพิ่มปุ่มอัปโหลดใหม่ก็ได้ด่านนี้ฟรี
//
// ใช้เฉพาะ bucket ที่เป็นรูปแสดงผล — ห้ามเพิ่ม bucket เอกสาร (payment-slips, official-documents,
// document-certs, org-documents, fleet-documents) เพราะบีบแล้วตัวหนังสือในสแกนอาจอ่านไม่ออก
export const PUBLIC_IMAGE_BUCKETS = new Set([
  'municipality-assets', 'logos', 'avatars', 'event-attachments', 'complaint-attachments',
])
export const PUBLIC_IMAGE_MAX_PX = 1600

// jpeg/png/webp/heic เท่านั้น — gif (อาจเป็นภาพเคลื่อนไหว) กับ svg (เวกเตอร์) ห้ามแตะ
const SHRINKABLE_MIME = /^image\/(jpeg|png|webp|heic|heif)$/i
const SHRINKABLE_EXT = /\.(jpe?g|png|webp|heic|heif)$/i

export function isShrinkableImage(file) {
  if (!file) return false
  if (typeof file.type === 'string' && file.type) return SHRINKABLE_MIME.test(file.type)
  return SHRINKABLE_EXT.test(file.name ?? '')   // กล้องมือถือบางรุ่นคืน type ว่าง
}

// เกณฑ์ "เล็กพอแล้ว ไม่ต้องย่อ" ของรูปสาธารณะ — เดิม 1.5 MB (ผ่านมาตรฐานเดียวกับ compressImage) แต่รูปข่าว/ท่องเที่ยว
// บนหน้าแรกวัดจริง 0.4–1 MB ต่อรูป และแสดงที่ ~320 px หลุดด่านทั้งหมด จึงลดเหลือ 500 KB
export const PUBLIC_IMAGE_SKIP_UNDER = 500 * 1024
// ต้องประหยัดได้อย่างน้อยเท่านี้จึงใช้ไฟล์ที่ย่อ ไม่งั้นคืนไฟล์เดิม — กันกรณีเข้ารหัส JPEG ซ้ำแล้วไฟล์ไม่เล็กลง
// (เสียคุณภาพเปล่า) เช่นรูป JPEG ที่ผ่าน compressImage หรือ resizeImage มาแล้ว
export const SHRINK_MIN_SAVING = 0.15
const SHRINK_TIMEOUT_MS = 8_000

// รูปข่าว/กิจกรรมที่แอดมินอัปโหลด (PostsManager) — ด้านยาวสูงสุดและคุณภาพ JPEG
// ที่แสดงจริงมี 2 ขนาด: การ์ด 4:3 (กว้างไม่เกิน ~380 px) กับโมดัลรายละเอียด aspect-video กว้างสูงสุด 512 px (max-w-lg)
// 800 px = ~1.5 เท่าของจุดที่แสดงใหญ่สุด ยังคมบนมือถือ ส่วน 1600 px ของด่านกลางเกินความจำเป็น 4 เท่าของพื้นที่
// (วัดจาก log 2026-10-04: รูปข่าว 1200–2112 px 120–300 KB ต่อใบ ถูกโหลด ~14 ชุด/วัน = ~16 MB/วัน Cached Egress)
// ห้ามเอาค่านี้ไปใช้กับรูปท่องเที่ยว — หน้ารายละเอียดแสดงสูง 420 px กว้างได้ถึง 1024 px ต้องการความละเอียดมากกว่านี้
export const POST_IMAGE_MAX_EDGE = 800
export const POST_IMAGE_QUALITY = 0.8

function loadImageElement(file) {
  const url = URL.createObjectURL(file)
  return new Promise((resolve, reject) => {
    const img = new Image()
    const timer = setTimeout(() => { URL.revokeObjectURL(url); reject(new Error('image_load_timeout')) }, 3_000)
    img.onload = () => { clearTimeout(timer); URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { clearTimeout(timer); URL.revokeObjectURL(url); reject(new Error('image_load_error')) }
    img.src = url
  })
}

// วาดรูปลง canvas ขนาด tw x th (ย่ออย่างเดียว ไม่ขยาย — ผู้เรียกคำนวณขนาดมาแล้ว)
// createImageBitmap ย่อตอน decode จึงไม่ต้องถือรูปเต็มความละเอียดไว้ในหน่วยความจำ (มือถือค้างเพราะเรื่องนี้มาก่อน)
async function drawScaled(file, tw, th) {
  const canvas = document.createElement('canvas')
  canvas.width = tw
  canvas.height = th
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { resizeWidth: tw, resizeHeight: th, resizeQuality: 'medium' })
      ctx.drawImage(bitmap, 0, 0, tw, th)
      bitmap.close()
      return { canvas, ctx }
    } catch { /* ถอยไปใช้ <img> */ }
  }
  const img = await loadImageElement(file)
  ctx.drawImage(img, 0, 0, tw, th)
  return { canvas, ctx }
}

function hasTransparency(ctx, w, h) {
  const { data } = ctx.getImageData(0, 0, w, h)
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true
  return false
}

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 5_000)
    try {
      canvas.toBlob((blob) => { clearTimeout(timer); resolve(blob) }, 'image/jpeg', quality)
    } catch {
      clearTimeout(timer)
      resolve(null)
    }
  })
}

/**
 * ย่อรูปถ่ายเป็น JPEG ด้านยาวไม่เกิน maxEdge (ไม่ขยายรูปเล็ก) คืนไฟล์เดิมตัวเดิม (=== file) เมื่อ:
 *  - ถอดรหัสไม่ได้ / หมดเวลา / เกิดข้อผิดพลาดใดๆ (ไม่บล็อกการอัปโหลด)
 *  - ภาพมีส่วนโปร่งใส (PNG โลโก้/ไอคอน) — แปลงเป็น JPEG แล้วพื้นโปร่งใสกลายเป็นสีดำ/ขาว ภาพเพี้ยน
 *  - ผลที่ได้ไม่เล็กลงอย่างน้อย SHRINK_MIN_SAVING
 *
 * ไม่ใช้ compressImage เพราะมันส่ง maxPx เป็น "ความกว้าง" ให้ createImageBitmap: ขยายรูปแคบให้กว้างถึง maxPx
 * (1200x2112 → 1600x2816 ไฟล์ใหญ่ขึ้น 139 → 322 KB) และรูปแนวตั้งด้านยาวเกิน maxPx (3000x4000 → 1600x2134)
 * ส่วน compressImage ยังคงพฤติกรรมเดิมไว้เพราะมี 20 จุดเรียกใช้ที่พึ่งมันอยู่
 */
export async function shrinkPhoto(file, { maxEdge = PUBLIC_IMAGE_MAX_PX, quality = 0.85 } = {}) {
  const work = (async () => {
    const { naturalWidth: w, naturalHeight: h } = await loadImageElement(file)
    if (!w || !h) return file
    const scale = Math.min(1, maxEdge / Math.max(w, h))
    const tw = Math.max(1, Math.round(w * scale))
    const th = Math.max(1, Math.round(h * scale))
    const { canvas, ctx } = await drawScaled(file, tw, th)
    try {
      const isJpeg = /^image\/jpe?g$/i.test(file.type ?? '') || (!file.type && /\.jpe?g$/i.test(file.name ?? ''))
      if (!isJpeg && hasTransparency(ctx, tw, th)) return file
      const blob = await canvasToJpeg(canvas, quality)
      if (!blob || blob.size > file.size * (1 - SHRINK_MIN_SAVING)) return file
      const base = (file.name ?? 'photo').replace(/\.[^.]+$/, '') || 'photo'
      return new File([blob], `${base}.jpg`, { type: 'image/jpeg' })
    } finally {
      canvas.width = 0
      canvas.height = 0
    }
  })()
  const timeout = new Promise((resolve) => setTimeout(() => resolve(file), SHRINK_TIMEOUT_MS))
  try {
    return await Promise.race([work, timeout])
  } catch (err) {
    console.warn('shrinkPhoto failed, fallback to original file:', err)
    return file
  }
}

/**
 * คืนไฟล์ที่ย่อแล้ว (JPEG ด้านยาวไม่เกิน 1600 px) ถ้าเป็นรูปใน bucket สาธารณะที่ใหญ่เกิน PUBLIC_IMAGE_SKIP_UNDER
 * นอกเหนือจากนั้นคืนไฟล์เดิมตัวเดิม (=== file) ย่อไม่สำเร็จ/หมดเวลาก็คืนไฟล์เดิม ไม่บล็อกการอัปโหลด
 *
 * keepFormat: true สำหรับไฟล์ที่ต้องคงรูปแบบเดิม (โลโก้ ไอคอนแอป QR) — ต้องส่งเองที่จุดเรียก
 */
export async function limitPublicImage(bucket, file, { keepFormat = false } = {}) {
  if (keepFormat || !PUBLIC_IMAGE_BUCKETS.has(bucket) || !isShrinkableImage(file)) return file
  if (file.size <= PUBLIC_IMAGE_SKIP_UNDER) return file
  return shrinkPhoto(file, { maxEdge: PUBLIC_IMAGE_MAX_PX, quality: 0.85 })
}
