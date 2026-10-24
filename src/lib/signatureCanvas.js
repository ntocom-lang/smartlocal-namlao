// ภาพลายเซ็น — ส่วนที่ต้องใช้ canvas (เบราว์เซอร์เท่านั้น) · ตรรกะที่ทดสอบใน Node ได้อยู่ที่ signatureImage.js
// ทุกทางออกคือ PNG โปร่งใส ตัดขอบเนื้อหา ≤ 640×320 ≤ ~44 KB ผ่าน canvas.toDataURL — จึงไม่มี metadata ติดมา (EXIF/ตำแหน่ง/กล้อง)
import {
  SIGNATURE_PAD_W, SIGNATURE_PAD_H, SIGNATURE_PEN_WIDTHS,
  PNG_DATA_URL_PREFIX, checkSignatureFile, contentBounds, dilationOffsets, estimateStrokePx, exportWithinBudget, padBounds,
  pngBase64FromDataUrl, printedMmPerPx, strokeGrowRadius, whiteToAlpha,
} from './signatureImage.js'

const EXPORT_SCALE = 2 // วาดตอนส่งออกที่ 1280×640 แล้วค่อยย่อ — เส้นเรียบกว่าวาดที่ขนาดหน้าจอ

function newCanvas(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

export function penPixels(penKey, canvasWidth) {
  const pen = SIGNATURE_PEN_WIDTHS.find(item => item.key === penKey) ?? SIGNATURE_PEN_WIDTHS[1]
  return (pen.px / SIGNATURE_PAD_W) * canvasWidth
}

// วาดเส้นทั้งหมดลง ctx — เส้นเก็บเป็นพิกัดสัดส่วน (0..1 ของความกว้าง/ความสูงแผ่น) วาดซ้ำได้ทุกขนาดจอ
// strokes = [{ color, pen, points: [{ x, y }] }]
export function drawStrokes(ctx, strokes, width, height) {
  ctx.clearRect(0, 0, width, height)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const stroke of strokes) {
    const points = stroke.points
    if (!points.length) continue
    const lineWidth = penPixels(stroke.pen, width)
    ctx.strokeStyle = stroke.color
    ctx.fillStyle = stroke.color
    ctx.lineWidth = lineWidth
    if (points.length === 1) {
      ctx.beginPath()
      ctx.arc(points[0].x * width, points[0].y * height, lineWidth / 2, 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    ctx.beginPath()
    ctx.moveTo(points[0].x * width, points[0].y * height)
    for (let i = 1; i < points.length - 1; i++) {
      // เส้นโค้งผ่านจุดกึ่งกลางระหว่างจุดที่ลาก — ลายเซ็นลื่นกว่าต่อเส้นตรงทีละช่วง
      const midX = ((points[i].x + points[i + 1].x) / 2) * width
      const midY = ((points[i].y + points[i + 1].y) / 2) * height
      ctx.quadraticCurveTo(points[i].x * width, points[i].y * height, midX, midY)
    }
    const last = points[points.length - 1]
    ctx.lineTo(last.x * width, last.y * height)
    ctx.stroke()
  }
}

// canvas ที่วาดเสร็จ → PNG ที่ตัดขอบและอยู่ในงบไบต์ · คืน { ok, base64, width, height, bytes } หรือ { ok:false, code }
export function canvasToSignature(source, visibleCount = null) {
  const width = source.width
  const height = source.height
  const ctx = source.getContext('2d', { willReadFrequently: true })
  const image = ctx.getImageData(0, 0, width, height)
  const box = contentBounds(image.data, width, height)
  if (!box || visibleCount === 0) return { ok: false, code: 'image_blank' }
  const crop = padBounds(box, Math.round(Math.max(box.width, box.height) * 0.03) + 4, width, height)
  const cropped = newCanvas(crop.width, crop.height)
  cropped.getContext('2d').drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)

  const result = exportWithinBudget({
    width: crop.width,
    height: crop.height,
    encode: (w, h) => {
      const out = newCanvas(w, h)
      const outCtx = out.getContext('2d')
      outCtx.imageSmoothingEnabled = true
      outCtx.imageSmoothingQuality = 'high'
      outCtx.drawImage(cropped, 0, 0, crop.width, crop.height, 0, 0, w, h)
      const base64 = pngBase64FromDataUrl(out.toDataURL('image/png'))
      return base64 ? { base64 } : null
    },
  })
  if (!result) return { ok: false, code: 'too_detailed' }
  return { ok: true, ...result }
}

export function strokesToSignature(strokes) {
  if (!strokes.length) return { ok: false, code: 'pad_empty' }
  const canvas = newCanvas(SIGNATURE_PAD_W * EXPORT_SCALE, SIGNATURE_PAD_H * EXPORT_SCALE)
  drawStrokes(canvas.getContext('2d'), strokes, canvas.width, canvas.height)
  return canvasToSignature(canvas)
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      try { return await createImageBitmap(file) } catch { /* ลอง <img> ต่อ */ }
    }
  }
  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('image_unreadable'))
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ไฟล์ PNG/JPG ที่ผู้ใช้เลือก → ลบพื้นขาวให้โปร่งใส → ตัดขอบ → ย่อให้พอดี
export async function fileToSignature(file) {
  const invalid = checkSignatureFile(file)
  if (invalid) return { ok: false, code: invalid }
  let bitmap
  try {
    bitmap = await loadBitmap(file)
  } catch {
    return { ok: false, code: 'image_unreadable' }
  }
  const srcW = bitmap.width || bitmap.naturalWidth
  const srcH = bitmap.height || bitmap.naturalHeight
  if (!srcW || !srcH) return { ok: false, code: 'image_unreadable' }
  // จำกัดด้านยาวไว้ที่ 1600 ก่อนประมวลผล — รูปถ่ายจากมือถือใหญ่ 4000+ พิกเซลกินหน่วยความจำโดยไม่ได้ประโยชน์
  const cap = Math.min(1, 1600 / Math.max(srcW, srcH))
  const w = Math.max(1, Math.round(srcW * cap))
  const h = Math.max(1, Math.round(srcH * cap))
  const canvas = newCanvas(w, h)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  const image = ctx.getImageData(0, 0, w, h)
  const visible = whiteToAlpha(image.data)
  if (visible === 0) return { ok: false, code: 'image_blank' }
  ctx.putImageData(image, 0, 0)
  return canvasToSignature(canvas, visible)
}

// ── ภาพลายเซ็นสำหรับพิมพ์บนใบ (ใบแบบ ๓ / สก.๑) ───────────────────────────────────
// เสริมความหนาเส้นให้ถึงขั้นต่ำบนกระดาษ (ดู PRINT_MIN_STROKE_MM) · ทำที่ภาพที่ใช้พิมพ์เท่านั้น ไม่แก้ภาพในฐานข้อมูล
// ทำไม่ได้/ไม่ต้องทำ = คืนภาพเดิม — ห้ามขวางการพิมพ์ใบที่ลงนามแล้ว
function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('image_unreadable'))
    image.src = src
  })
}

export async function signatureForPrint(base64, box) {
  const original = { png: base64, width: 0, height: 0, strokePx: 0, radius: 0 }
  try {
    const image = await loadImageElement(`${PNG_DATA_URL_PREFIX}${base64}`)
    const width = image.naturalWidth
    const height = image.naturalHeight
    if (!width || !height) return original
    original.width = width
    original.height = height
    const probe = newCanvas(width, height)
    const probeCtx = probe.getContext('2d', { willReadFrequently: true })
    probeCtx.drawImage(image, 0, 0)
    const strokePx = estimateStrokePx(probeCtx.getImageData(0, 0, width, height).data, width, height)
    const radius = strokeGrowRadius({ strokePx, mmPerPx: printedMmPerPx(width, height, box) })
    original.strokePx = strokePx
    if (radius <= 0) return original
    const pad = Math.ceil(radius)
    const out = newCanvas(width + pad * 2, height + pad * 2)
    const outCtx = out.getContext('2d')
    for (const [dx, dy] of dilationOffsets(radius)) outCtx.drawImage(image, pad + dx, pad + dy)
    const png = pngBase64FromDataUrl(out.toDataURL('image/png'))
    return png ? { png, width: out.width, height: out.height, strokePx, radius } : original
  } catch {
    return original
  }
}

// ผลของ getTripEsignStamps → ชุดเดียวกันแต่ภาพทุกช่องผ่าน signatureForPrint · boxFor(slot) → { heightMm, widthMm }
export async function prepareStampsForPrint(stamps, boxFor) {
  if (!stamps?.ok || !Array.isArray(stamps.items)) return stamps
  const items = await Promise.all(stamps.items.map(async item => {
    if (!item?.png_base64) return item
    const result = await signatureForPrint(item.png_base64, boxFor(item.slot))
    return { ...item, png_base64: result.png, width: result.width || item.width, height: result.height || item.height }
  }))
  return { ...stamps, items }
}
