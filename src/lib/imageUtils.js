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
  canvas.getContext('2d').drawImage(source, 0, 0, w, h)
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
export async function compressImage(file, maxPx, quality = 0.80) {
  if (!file) return file

  // หากไฟล์เล็กกว่า 1.5 MB อยู่แล้ว ไม่จำเป็นต้องบีบอัด เพื่อหลีกเลี่ยง canvas memory hang บนมือถือ
  if (file.size <= 1.5 * 1024 * 1024) return file

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
