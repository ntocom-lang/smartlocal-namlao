// ฟอนต์ Kanit ของภาพข่าวคำร้อง (เจ้าของระบบเลือก 2569-11-12 ตามภาพอินโฟกราฟิกอ้างอิง) — เบราว์เซอร์เท่านั้น
//
// ทำไมต้องฝังเป็น base64 ใน SVG: ภาพข่าววาดเป็นสตริง SVG แล้วเปิดผ่าน <img> (svgToPngFile) ซึ่งเบราว์เซอร์
// ไม่ยอมให้ SVG แบบรูปภาพโหลดไฟล์ภายนอกเลย ฟอนต์จึงต้องอยู่ในตัว SVG เอง (@font-face data:)
// ทำไมต้อง FontFace ในหน้าด้วย: ตัวตัดบรรทัดวัดความกว้างด้วย canvas ของหน้า ถ้าหน้าไม่มี Kanit จะวัดด้วย Tahoma
// แล้วตัดบรรทัดไม่ตรงกับที่วาดจริง (ข้อความล้นกรอบ/ความสูงภาพเพี้ยนจากเพดาน A4)
//
// ไฟล์: Google Fonts ชุด thai + latin × 400/700 (~63 KB) ใน src/assets → Vite ใส่ hash ให้ แคชแบบ immutable
// สัญญาอนุญาต SIL OFL 1.1 (src/assets/fonts/news-kanit/OFL.txt) — ใช้/ฝังในภาพได้ฟรี
// โหลดเฉพาะตอนเปิดหน้าต่างภาพข่าว ไม่อยู่ในบันเดิลหลัก · โหลดไม่สำเร็จ = คืน null แล้วภาพใช้ FONT_STACK เดิม (ไม่พัง)

import latin400 from '../assets/fonts/news-kanit/kanit-latin-400.woff2?url'
import latin700 from '../assets/fonts/news-kanit/kanit-latin-700.woff2?url'
import thai400 from '../assets/fonts/news-kanit/kanit-thai-400.woff2?url'
import thai700 from '../assets/fonts/news-kanit/kanit-thai-700.woff2?url'

// ชื่อเฉพาะของระบบ ไม่ชนกับ Kanit ที่อาจลงไว้ในเครื่อง (คนละรุ่น = ความกว้างไม่ตรงกับที่ฝังใน SVG)
export const NEWS_FONT_FAMILY = 'SmartLocal News Kanit'

// ช่วงอักษรตามที่ Google Fonts แบ่งไฟล์ — อักษรนอกช่วงตกไปใช้ FONT_STACK
const THAI_RANGE = 'U+02D7, U+0303, U+0331, U+0E01-0E5B, U+200C-200D, U+25CC'
const LATIN_RANGE = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'

const FILES = [
  { url: thai400, weight: '400', range: THAI_RANGE },
  { url: thai700, weight: '700', range: THAI_RANGE },
  { url: latin400, weight: '400', range: LATIN_RANGE },
  { url: latin700, weight: '700', range: LATIN_RANGE },
]

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

let pending = null

/**
 * โหลดฟอนต์ครั้งเดียวต่อหน้า (เก็บ promise ไว้) แล้วคืน { family, css } สำหรับ buildNewsSvg
 * @returns {Promise<{ family: string, css: string } | null>} null = โหลดไม่สำเร็จ ให้ใช้ฟอนต์ระบบ
 */
export function loadNewsFont() {
  if (pending) return pending
  pending = (async () => {
    if (typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts) return null
    const buffers = await Promise.all(FILES.map(async file => {
      const response = await fetch(file.url)
      if (!response.ok) throw new Error(`font ${response.status}`)
      return response.arrayBuffer()
    }))
    const faces = FILES.map((file, i) => new FontFace(NEWS_FONT_FAMILY, buffers[i], { weight: file.weight, unicodeRange: file.range }))
    await Promise.all(faces.map(face => face.load()))
    faces.forEach(face => document.fonts.add(face))
    const css = FILES.map((file, i) => `@font-face{font-family:'${NEWS_FONT_FAMILY}';font-weight:${file.weight};src:url(data:font/woff2;base64,${toBase64(buffers[i])}) format('woff2');unicode-range:${file.range};}`).join('')
    return { family: NEWS_FONT_FAMILY, css }
  })().catch(() => {
    pending = null // เน็ตหลุดชั่วคราว → เปิดหน้าต่างครั้งหน้าลองใหม่
    return null
  })
  return pending
}
