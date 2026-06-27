function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

function resizeOnCanvas(file, maxPx, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()

    // Timeout สำหรับ Image.onload — HEIC/format ที่ไม่รองรับจะไม่ fire onload เลย
    const loadTimeout = setTimeout(() => {
      URL.revokeObjectURL(url)
      reject(new Error('image_load_timeout'))
    }, 10_000)

    img.onload = () => {
      clearTimeout(loadTimeout)
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(img.naturalWidth  * scale)
      canvas.height = Math.round(img.naturalHeight * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      const outName = file.name.replace(/\.[^.]+$/, '.jpg')

      // Timeout สำหรับ toBlob — mobile + canvas ใหญ่อาจ fail เงียบ (ไม่เรียก callback)
      const blobTimeout = setTimeout(() => {
        canvas.width = 0
        canvas.height = 0
        reject(new Error('toBlob_timeout'))
      }, 8_000)

      try {
        canvas.toBlob(
          (blob) => {
            clearTimeout(blobTimeout)
            canvas.width = 0
            canvas.height = 0
            if (blob) resolve(new File([blob], outName, { type: 'image/jpeg' }))
            else reject(new Error('toBlob_null'))
          },
          'image/jpeg',
          quality,
        )
      } catch (err) {
        clearTimeout(blobTimeout)
        canvas.width = 0
        canvas.height = 0
        reject(err)
      }
    }
    img.onerror = () => {
      clearTimeout(loadTimeout)
      URL.revokeObjectURL(url)
      reject(new Error('image_load_error'))
    }
    img.src = url
  })
}

/**
 * บีบอัดรูปภาพ — ลดขนาดให้ได้ไม่เกิน ~1 MB
 * มือถือใช้ maxPx ต่ำกว่า PC เพื่อป้องกัน canvas OOM
 * ถ้ารอบแรกยังใหญ่เกินจะ compress ซ้ำด้วย quality ต่ำลง
 */
export async function compressImage(file, maxPx, quality = 0.80) {
  if (!file.type.startsWith('image/')) return file
  // มือถือใช้ maxPx ต่ำกว่า — ลด canvas memory pressure
  if (maxPx === undefined) {
    maxPx = isMobile() ? 1024 : 1280
  }
  let out = await resizeOnCanvas(file, maxPx, quality)
  // ถ้ายังเกิน 1 MB → compress ซ้ำด้วย quality + pixel ต่ำลง
  if (out.size > 1024 * 1024) {
    out = await resizeOnCanvas(out, 800, 0.60)
  }
  return out
}
