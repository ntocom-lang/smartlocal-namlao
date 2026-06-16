/**
 * บีบอัดรูปภาพก่อนอัปโหลด
 * @param {File} file - ไฟล์ต้นฉบับ
 * @param {number} maxPx - ความกว้าง/สูงสูงสุด (px)
 * @param {number} quality - คุณภาพ JPEG 0-1
 * @returns {Promise<File>} ไฟล์ที่บีบอัดแล้ว (ถ้าไม่ใช่รูปจะคืนค่าเดิม)
 */
export async function compressImage(file, maxPx = 1200, quality = 0.82) {
  if (!file.type.startsWith('image/')) return file
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const scale = img.naturalWidth > maxPx ? maxPx / img.naturalWidth : 1
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(img.naturalWidth  * scale)
      canvas.height = Math.round(img.naturalHeight * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      const outName = file.name.replace(/\.[^.]+$/, '.jpg')
      canvas.toBlob(
        blob => resolve(new File([blob], outName, { type: 'image/jpeg' })),
        'image/jpeg',
        quality
      )
    }
    img.src = URL.createObjectURL(file)
  })
}
