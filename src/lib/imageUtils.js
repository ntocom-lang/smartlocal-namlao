function resizeOnCanvas(file, maxPx, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(img.naturalWidth  * scale)
      canvas.height = Math.round(img.naturalHeight * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      const outName = file.name.replace(/\.[^.]+$/, '.jpg')
      canvas.toBlob(
        blob => blob ? resolve(new File([blob], outName, { type: 'image/jpeg' })) : reject(new Error('toBlob failed')),
        'image/jpeg',
        quality,
      )
    }
    img.onerror = reject
    img.src = url
  })
}

/**
 * บีบอัดรูปภาพ — ลดขนาดให้ได้ไม่เกิน targetMB
 * ถ้ารอบแรกยังใหญ่เกินจะ compress ซ้ำด้วย quality ต่ำลง
 */
export async function compressImage(file, maxPx = 1280, quality = 0.80) {
  if (!file.type.startsWith('image/')) return file
  let out = await resizeOnCanvas(file, maxPx, quality)
  // ถ้ายังเกิน 1 MB → compress ซ้ำด้วย quality ต่ำลง
  if (out.size > 1024 * 1024) {
    out = await resizeOnCanvas(out, 1024, 0.65)
  }
  return out
}
