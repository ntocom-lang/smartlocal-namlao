function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

function resizeOnCanvas(file, maxPx, quality) {
  return new Promise((resolve, reject) => {
    const outName = (file.name ?? 'photo').replace(/\.[^.]+$/, '.jpg')

    const doBlob = (canvas) =>
      new Promise((res, rej) => {
        const timer = setTimeout(() => {
          canvas.width = 0
          canvas.height = 0
          rej(new Error('toBlob_timeout'))
        }, 8_000)
        try {
          canvas.toBlob(
            (blob) => {
              clearTimeout(timer)
              canvas.width = 0
              canvas.height = 0
              if (blob) res(new File([blob], outName, { type: 'image/jpeg' }))
              else rej(new Error('toBlob_null'))
            },
            'image/jpeg',
            quality,
          )
        } catch (err) {
          clearTimeout(timer)
          canvas.width = 0
          canvas.height = 0
          rej(err)
        }
      })

    const draw = (source, w, h) => {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d').drawImage(source, 0, 0, w, h)
      return canvas
    }

    // ─── primary: createImageBitmap (off-thread, no DOM, รับ format กว้างกว่า) ───
    if (typeof createImageBitmap === 'function') {
      const bitmapTimeout = setTimeout(() => reject(new Error('bitmap_timeout')), 15_000)
      createImageBitmap(file)
        .then(async (bitmap) => {
          clearTimeout(bitmapTimeout)
          const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height))
          const canvas = draw(bitmap, Math.round(bitmap.width * scale), Math.round(bitmap.height * scale))
          bitmap.close()
          try { resolve(await doBlob(canvas)) } catch (e) { reject(e) }
        })
        .catch(() => {
          clearTimeout(bitmapTimeout)
          // ─── fallback: img element ───────────────────────────────────────
          const url = URL.createObjectURL(file)
          const img = new Image()
          const loadTimeout = setTimeout(() => {
            URL.revokeObjectURL(url)
            reject(new Error('image_load_timeout'))
          }, 10_000)
          img.onload = async () => {
            clearTimeout(loadTimeout)
            URL.revokeObjectURL(url)
            const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight))
            const canvas = draw(img, Math.round(img.naturalWidth * scale), Math.round(img.naturalHeight * scale))
            try { resolve(await doBlob(canvas)) } catch (e) { reject(e) }
          }
          img.onerror = () => { clearTimeout(loadTimeout); URL.revokeObjectURL(url); reject(new Error('image_load_error')) }
          img.src = url
        })
    } else {
      // ─── browsers ที่ไม่มี createImageBitmap ─────────────────────────────
      const url = URL.createObjectURL(file)
      const img = new Image()
      const loadTimeout = setTimeout(() => {
        URL.revokeObjectURL(url)
        reject(new Error('image_load_timeout'))
      }, 10_000)
      img.onload = async () => {
        clearTimeout(loadTimeout)
        URL.revokeObjectURL(url)
        const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight))
        const canvas = draw(img, Math.round(img.naturalWidth * scale), Math.round(img.naturalHeight * scale))
        try { resolve(await doBlob(canvas)) } catch (e) { reject(e) }
      }
      img.onerror = () => { clearTimeout(loadTimeout); URL.revokeObjectURL(url); reject(new Error('image_load_error')) }
      img.src = url
    }
  })
}

/**
 * บีบอัดรูปภาพ — ลดขนาดให้ได้ไม่เกิน ~1 MB
 * รองรับกล้อง Android ที่คืน file.type="" (ว่าง) โดยเช็ค extension ด้วย
 */
export async function compressImage(file, maxPx, quality = 0.80) {
  const hasImageMime = typeof file.type === 'string' && file.type.startsWith('image/')
  const hasImageExt  = /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp|tiff?)$/i.test(file.name ?? '')
  if (!hasImageMime && !hasImageExt) return file

  if (maxPx === undefined) {
    maxPx = isMobile() ? 1024 : 1280
  }
  let out = await resizeOnCanvas(file, maxPx, quality)
  if (out.size > 1_024 * 1_024) {
    out = await resizeOnCanvas(out, 800, 0.60)
  }
  return out
}
