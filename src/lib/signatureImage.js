// ภาพลายเซ็น — ส่วนที่คำนวณล้วน (ไม่แตะ DOM/canvas) เพื่อให้ทดสอบใน Node ได้: tests/signature-image.test.mjs
// ฝั่ง canvas/DOM อยู่ที่ signatureCanvas.js · ฝั่งฐานข้อมูล: supabase/migrations/20261023100000_esign_image_tables.sql,
// ..100100_esign_image_functions.sql (ฟังก์ชัน esign_png_decode ตรวจ PNG ≤ 50,000 ไบต์ ≤ 640×320 ซ้ำอีกชั้นเสมอ)
//
// ภาพนี้เป็นข้อมูลส่วนบุคคล และเป็นเพียง "ส่วนแสดง" บนใบพิมพ์ — หลักฐานการลงนามคือบันทึกลงนาม (ผู้ลงนาม รหัส เวลา hash)

export const SIGNATURE_MAX_W = 640
export const SIGNATURE_MAX_H = 320
export const SIGNATURE_MAX_BYTES = 50000 // เพดานของฐานข้อมูล
export const SIGNATURE_TARGET_BYTES = 44000 // เผื่อไว้ ไม่ให้ชนเพดานเพราะ base64/ส่วนหัวต่างกันเล็กน้อย
export const SIGNATURE_MAX_IMAGES = 5
export const SIGNATURE_MAX_UPLOAD_BYTES = 8 * 1024 * 1024
export const SIGNATURE_UPLOAD_TYPES = ['image/png', 'image/jpeg']

// สีปากกา: น้ำเงินเข้ม/ดำ/น้ำเงิน/ม่วง — ลายเซ็นราชการส่วนใหญ่เป็นหมึกน้ำเงินหรือดำ
export const SIGNATURE_PEN_COLORS = [
  { key: 'navy', label: 'น้ำเงินเข้ม', hex: '#1e3a8a' },
  { key: 'black', label: 'ดำ', hex: '#111827' },
  { key: 'blue', label: 'น้ำเงิน', hex: '#1d4ed8' },
  { key: 'violet', label: 'ม่วง', hex: '#6d28d9' },
]
// ความหนาเส้น หน่วยเป็นพิกเซลของแผ่นวาดกว้าง 640 (คูณตามความกว้างจริงตอนวาด/ส่งออก)
export const SIGNATURE_PEN_WIDTHS = [
  { key: 'S', label: 'บาง', px: 1.8 },
  { key: 'M', label: 'กลาง', px: 3 },
  { key: 'L', label: 'หนา', px: 4.8 },
]
export const SIGNATURE_PAD_W = 640
export const SIGNATURE_PAD_H = 320

// ข้อความของข้อผิดพลาดฝั่งเบราว์เซอร์ (ก่อนส่งไปฐานข้อมูล) — ของฐานข้อมูลอยู่ใน esign.js
export const SIGNATURE_CLIENT_MESSAGES = {
  pad_empty: 'ยังไม่ได้เซ็น — ใช้นิ้ว ปากกา หรือเมาส์เซ็นในกรอบก่อน',
  file_missing: 'ยังไม่ได้เลือกไฟล์',
  file_type: 'ใช้ได้เฉพาะไฟล์ภาพ PNG หรือ JPG',
  file_too_big: 'ไฟล์ใหญ่เกิน 8 MB',
  image_unreadable: 'เปิดไฟล์ภาพนี้ไม่ได้ ลองไฟล์อื่น',
  image_blank: 'ไม่พบลายเซ็นในภาพ (ภาพว่าง หรือเส้นสีอ่อนเกินไป)',
  too_detailed: 'ภาพละเอียดเกินไปจนย่อให้พอดีไม่ได้ ลองถ่ายให้ลายเซ็นใหญ่ พื้นเรียบ และแสงสม่ำเสมอ',
}

export function signatureClientMessage(code) {
  return SIGNATURE_CLIENT_MESSAGES[code] ?? 'ทำรายการไม่สำเร็จ กรุณาลองใหม่'
}

// ตรวจไฟล์ที่ผู้ใช้เลือกก่อนอ่านภาพ — คืนรหัสข้อผิดพลาดหรือ null
export function checkSignatureFile(file) {
  if (!file) return 'file_missing'
  if (!SIGNATURE_UPLOAD_TYPES.includes(file.type)) return 'file_type'
  if (file.size > SIGNATURE_MAX_UPLOAD_BYTES) return 'file_too_big'
  return null
}

// ย่อให้พอดีกรอบโดยรักษาสัดส่วน ไม่ขยายขึ้น
export function fitSize(width, height, maxW = SIGNATURE_MAX_W, maxH = SIGNATURE_MAX_H) {
  const scale = Math.min(1, maxW / width, maxH / height)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

// กรอบเนื้อหา (พิกเซลที่ alpha ≥ alphaMin) บนข้อมูล RGBA — null ถ้าว่างเปล่า
export function contentBounds(data, width, height, alphaMin = 12) {
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (let y = 0; y < height; y++) {
    const row = y * width * 4
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] >= alphaMin) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

// ขยายกรอบออกด้านละ pad พิกเซล แต่ไม่เกินขอบภาพ
export function padBounds(box, pad, width, height) {
  const x = Math.max(0, box.x - pad)
  const y = Math.max(0, box.y - pad)
  const right = Math.min(width, box.x + box.width + pad)
  const bottom = Math.min(height, box.y + box.height + pad)
  return { x, y, width: right - x, height: bottom - y }
}

const clamp01 = value => (value < 0 ? 0 : value > 1 ? 1 : value)
const lumaOf = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b

// ภาพที่มีส่วนโปร่งใสอยู่แล้ว (PNG ลายเซ็นที่ลบพื้นแล้ว) — ไม่ต้องลบพื้นซ้ำ ไม่งั้นเส้นสีอ่อนจะจางหาย
export function hasTransparency(data, ratio = 0.2) {
  const pixels = data.length / 4
  if (pixels === 0) return false
  let clear = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) clear++
  return clear / pixels >= ratio
}

// ความสว่างของพื้นกระดาษ = เปอร์เซ็นไทล์ที่ 85 ของความสว่างทุกพิกเซล (ภาพลายเซ็นส่วนใหญ่คือกระดาษ)
export function estimateBackgroundLuma(data, percentile = 0.85) {
  const bins = new Uint32Array(256)
  let total = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    bins[Math.min(255, Math.round(lumaOf(data[i], data[i + 1], data[i + 2])))]++
    total++
  }
  if (total === 0) return 255
  const target = total * percentile
  let seen = 0
  for (let v = 0; v < 256; v++) {
    seen += bins[v]
    if (seen >= target) return v
  }
  return 255
}

// ลบพื้นกระดาษให้โปร่งใส (แก้ข้อมูลในที่): พื้นสว่างเกินเส้นตัด → โปร่งใส · เข้มกว่าพื้นมากพอ → ทึบเต็ม · ระหว่างนั้นไล่ระดับ
// เส้นตัดอิงความสว่างพื้นจริง (กระดาษเทา/ถ่ายในที่มืดก็ลบได้) แต่ไม่เกิน 245 และไม่ต่ำกว่า 120
// คืนจำนวนพิกเซลที่ยังเห็น (alpha ≥ 12) ไว้ให้ผู้เรียกเช็กว่าภาพว่างไหม
export function whiteToAlpha(data) {
  if (hasTransparency(data)) {
    let visible = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] >= 12) visible++
    return visible
  }
  const background = estimateBackgroundLuma(data)
  const cut = Math.max(120, Math.min(245, background - 14))
  const full = Math.max(40, cut - 90)
  let visible = 0
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a === 0) continue
    const ink = clamp01((cut - lumaOf(data[i], data[i + 1], data[i + 2])) / (cut - full))
    const alpha = Math.round(a * ink)
    data[i + 3] = alpha
    if (alpha >= 12) visible++
  }
  return visible
}

export function base64Bytes(base64) {
  const clean = String(base64 ?? '')
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
  return Math.floor((clean.length * 3) / 4) - padding
}

export const PNG_DATA_URL_PREFIX = 'data:image/png;base64,'

// data URL → base64 ล้วน (ฐานข้อมูลรับ base64 ไม่มี prefix และไม่มีขึ้นบรรทัดใหม่) — null ถ้าไม่ใช่ PNG
export function pngBase64FromDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PNG_DATA_URL_PREFIX)) return null
  const base64 = dataUrl.slice(PNG_DATA_URL_PREFIX.length)
  return /^[A-Za-z0-9+/]+={0,2}$/.test(base64) ? base64 : null
}

// ลดขนาดทีละขั้นจนไบต์พอดีเพดาน — encode(width, height) คืน { base64 } (ตัวเข้ารหัสจริงอยู่ฝั่ง canvas)
// ไม่เล็กกว่า 80 พิกเซลกว้าง (ลายเซ็นเล็กกว่านี้อ่านไม่ออกบนใบพิมพ์) · คืน null ถ้าย่อสุดแล้วก็ยังไม่พอดี
export const SIGNATURE_SHRINK_STEPS = [1, 0.8, 0.64, 0.5, 0.4, 0.3, 0.22]
export function exportWithinBudget({ width, height, encode, maxBytes = SIGNATURE_TARGET_BYTES }) {
  const first = fitSize(width, height)
  for (const step of SIGNATURE_SHRINK_STEPS) {
    const w = Math.max(1, Math.round(first.width * step))
    const h = Math.max(1, Math.round(first.height * step))
    if (step < 1 && w < 80) break
    const encoded = encode(w, h)
    if (!encoded?.base64) continue
    const bytes = base64Bytes(encoded.base64)
    if (bytes <= maxBytes) return { base64: encoded.base64, width: w, height: h, bytes }
  }
  return null
}
