import { useEffect, useMemo, useState } from 'react'
import { supabase, supabaseUrl } from '../../lib/supabase'
import { fetchImageAsDataUrl } from '../../lib/driveStorage'
import { departmentColorKeyByName, newsThemeFor } from '../../lib/departmentColors'
import { NEWS_EXEC_PHOTO_SIDE, cutoutPlainBackground, svgToPngFile, transparentPhotoBox, withNewsPhotoUrl } from '../../lib/complaintNewsImage'

// ตัวโหลดรูป + hook ที่กล่องภาพข่าวรายเรื่อง (ComplaintNewsDialog) กับกล่องภาพข่าวรวม (ComplaintNewsBatchDialog) ใช้ร่วมกัน
// แยกจากไฟล์คอมโพเนนต์ (newsDialogParts.jsx) เพราะ fast-refresh ต้องการให้ไฟล์คอมโพเนนต์ export แต่คอมโพเนนต์

const KEEP_SIDE = 1400
const HAS_ALPHA_MIME = /^data:image\/(png|webp|gif)[;,]/i

// ย่อรูปก่อนฝังใน SVG — รูปมือถือหลาย MB ฝังตรงๆ ทำให้ภาพตัวอย่างและการแปลงเป็น PNG ช้า ภาพข่าวใช้ไม่เกินครึ่งความกว้าง 1080 อยู่แล้ว
// ย่อไม่ได้ (เบราว์เซอร์ถอดรหัสไม่ได้ ฯลฯ) = ใช้ตัวเดิม ไม่ล้ม
async function shrinkDataUrl(dataUrl) {
  try {
    const image = new Image()
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = dataUrl })
    const scale = Math.min(1, KEEP_SIDE / Math.max(image.naturalWidth, image.naturalHeight))
    if (scale >= 1 && dataUrl.length < 600000) return dataUrl
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) return dataUrl
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    // PNG/WebP ที่มีพื้นโปร่งใส (รูปนายกที่ตัดพื้นหลังมาแล้ว / โลโก้) ต้องคงเป็น PNG — แปลง JPEG แล้วพื้นกลายเป็นสีขาวทึบ
    // ตรวจเฉพาะชนิดที่มีช่องโปร่งใสได้ รูปถ่ายคำร้อง (JPEG) ไม่ต้องอ่านพิกเซล
    if (HAS_ALPHA_MIME.test(dataUrl)
      && transparentPhotoBox(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)) {
      return canvas.toDataURL('image/png')
    }
    context.globalCompositeOperation = 'destination-over'
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.86)
  } catch {
    return dataUrl
  }
}

const EXEC_SIDE = NEWS_EXEC_PHOTO_SIDE
const FRAME_BORDER = 10
const FRAME_RADIUS = 30

function roundedRectPath(context, x, y, w, h, r) {
  context.beginPath()
  context.moveTo(x + r, y)
  context.arcTo(x + w, y, x + w, y + h, r)
  context.arcTo(x + w, y + h, x, y + h, r)
  context.arcTo(x, y + h, x, y, r)
  context.arcTo(x, y, x + w, y, r)
  context.closePath()
}

/**
 * รูปนายกสำหรับภาพข่าว (เจ้าของสั่ง 2569-11-11 ให้ตัดพื้นหลังขาวออกแบบภาพข่าวต้นฉบับ):
 *  - PNG/WebP ที่มีพื้นโปร่งใสมาเอง (transparentPhotoBox) → ใช้ตามไฟล์ แค่ครอปชิดส่วนที่มองเห็น ไม่ตัดพื้นหลังซ้ำ
 *    (ผู้อัปโหลดตัดภาพมาดีกว่ากติกาเทสีของเรา ตัดซ้ำมีแต่เสี่ยงกินผม/ขอบเสื้อ)
 *  - ฉากเรียบ (ตรวจด้วย cutoutPlainBackground) → PNG โปร่งใส ครอปชิดตัวคน ไม่มีที่ว่างเหนือหัว
 *  - ฉากไม่เรียบ/ตัดแล้วเสี่ยงกินเสื้อ → PNG รูปเดิมในกรอบขาวมุมมน ไม่ตัดมั่ว
 * ทำในเบราว์เซอร์ล้วน ไม่ส่งรูปออกไปบริการภายนอก · พังกลางทาง = ใช้รูปเดิม ภาพข่าวยังออกได้
 */
export async function prepareExecutivePhoto(dataUrl) {
  try {
    const image = new Image()
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = dataUrl })
    const scale = Math.min(1, EXEC_SIDE / Math.max(image.naturalWidth, image.naturalHeight))
    const w = Math.max(1, Math.round(image.naturalWidth * scale))
    const h = Math.max(1, Math.round(image.naturalHeight * scale))
    const work = document.createElement('canvas')
    work.width = w
    work.height = h
    const context = work.getContext('2d', { willReadFrequently: true })
    if (!context) return dataUrl
    context.drawImage(image, 0, 0, w, h)
    const pixels = context.getImageData(0, 0, w, h)
    // ลำดับสำคัญ: ตรวจความโปร่งใสเดิมก่อน (ไม่แก้ pixels) แล้วค่อยลองตัดฉากเรียบ (แก้ pixels ในที่)
    const box = transparentPhotoBox(pixels.data, w, h) || cutoutPlainBackground(pixels.data, w, h)
    const out = document.createElement('canvas')
    const outContext = out.getContext('2d')
    if (!outContext) return dataUrl
    if (box) {
      context.putImageData(pixels, 0, 0)
      out.width = box.w
      out.height = box.h
      outContext.drawImage(work, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h)
    } else {
      out.width = w + FRAME_BORDER * 2
      out.height = h + FRAME_BORDER * 2
      outContext.fillStyle = '#ffffff'
      roundedRectPath(outContext, 0, 0, out.width, out.height, FRAME_RADIUS)
      outContext.fill()
      roundedRectPath(outContext, FRAME_BORDER, FRAME_BORDER, w, h, FRAME_RADIUS - FRAME_BORDER / 2)
      outContext.clip()
      outContext.drawImage(work, FRAME_BORDER, FRAME_BORDER)
    }
    return out.toDataURL('image/png')
  } catch {
    return dataUrl
  }
}

export async function loadImage(ref) {
  const result = await fetchImageAsDataUrl(ref)
  if (result.error || !result.dataUrl) return { dataUrl: null }
  return { dataUrl: await shrinkDataUrl(result.dataUrl) }
}

// ข้อความไทยจากฐานข้อมูลที่แสดงตรงๆ ได้ (42501 ไม่มีสิทธิ์ / 22023 เงื่อนไขไม่ผ่าน / P0002 ไม่พบ) · error อื่นไม่โชว์ข้อความดิบ
export const SHOWABLE_CODES = new Set(['42501', '22023', 'P0002'])
export const GENERIC_ERROR = 'โหลดข้อมูลเรื่องไม่สำเร็จ ลองใหม่อีกครั้ง'

/**
 * โลโก้ อปท. + ชื่อ/ตำแหน่ง/รูปนายก (ผู้ลงนามช่องนายกคนปัจจุบัน ผ่าน RPC complaint_news_branding)
 * โหลดไม่ได้ = ไม่มีโลโก้/ไม่มีบล็อกนายก ไม่ทำให้กล่องพัง
 */
export function useNewsBranding(tenant) {
  const [logo, setLogo] = useState(null)
  const [branding, setBranding] = useState(null)
  const [mayorPhoto, setMayorPhoto] = useState(null)

  useEffect(() => {
    if (!tenant?.id) return undefined
    let alive = true
    supabase.rpc('complaint_news_branding', { _municipality_id: tenant.id })
      .then(({ data, error }) => {
        if (!alive) return
        if (error) { console.error('complaint_news_branding error:', error.message); return }
        setBranding(withNewsPhotoUrl(data, supabaseUrl))
      }, (cause) => { console.error('complaint_news_branding error:', cause?.message) })
    return () => { alive = false }
  }, [tenant?.id])

  useEffect(() => {
    if (!branding?.photo_url) return undefined
    let alive = true
    loadImage(branding.photo_url)
      .then(result => (result.dataUrl ? prepareExecutivePhoto(result.dataUrl) : null))
      .then(dataUrl => { if (alive) setMayorPhoto(dataUrl) })
    return () => { alive = false }
  }, [branding?.photo_url])

  useEffect(() => {
    if (!tenant?.logo_url) return undefined
    let alive = true
    loadImage(tenant.logo_url).then(result => { if (alive) setLogo(result.dataUrl) })
    return () => { alive = false }
  }, [tenant?.logo_url])

  return { logo, branding, mayorPhoto }
}

/**
 * สีธีมของภาพข่าวตามสีกอง (departments.color ที่มีอยู่แล้ว) — จับคู่จากชื่อกอง (name หรือ short_name)
 * อ่านตาราง departments ตรงๆ ได้ทุกบทบาทเจ้าหน้าที่รวม viewer/council (RLS fdept_read) · โหลดไม่ได้/ไม่เจอกอง/ยังไม่ตั้งสี = ส้มชุดเดิม ไม่ทำกล่องพัง
 * @param {string | null | undefined} tenantId
 * @param {string | null | undefined} departmentName
 */
export function useDepartmentTheme(tenantId, departmentName) {
  const [rows, setRows] = useState(null)

  useEffect(() => {
    if (!tenantId) return undefined
    let alive = true
    supabase.from('departments').select('name, short_name, color').eq('municipality_id', tenantId)
      .then(({ data, error }) => {
        if (!alive) return
        if (error) { console.error('departments color load error:', error.message); return }
        setRows(Array.isArray(data) ? data : [])
      }, (cause) => { console.error('departments color load error:', cause?.message) })
    return () => { alive = false }
  }, [tenantId])

  return useMemo(() => newsThemeFor(departmentColorKeyByName(rows, departmentName)), [rows, departmentName])
}

/**
 * เตรียมไฟล์ PNG ไว้ล่วงหน้า ไม่ใช่ตอนกดปุ่ม: navigator.share() ต้องถูกเรียกในจังหวะที่ผู้ใช้เพิ่งกด
 * (แบบเดียวกับ ComplaintMonthlyInfographic) · คืน file เฉพาะเมื่อไฟล์ตรงกับภาพล่าสุดแล้ว
 */
export function usePreparedPng(image, fileName) {
  const [prepared, setPrepared] = useState(null)
  const [retry, setRetry] = useState(0)
  const imageKey = image ? image.svg : ''

  useEffect(() => {
    if (!image) return undefined
    let active = true
    svgToPngFile(image.svg, image.width, image.height, fileName)
      .then(file => { if (active) setPrepared({ key: imageKey, file }) })
      .catch(() => { if (active) setPrepared({ key: imageKey, error: 'เตรียมไฟล์ภาพไม่สำเร็จ กรุณาลองอีกครั้ง' }) })
    return () => { active = false }
  }, [image, imageKey, fileName, retry])

  return {
    file: prepared?.key === imageKey ? prepared.file ?? null : null,
    error: prepared?.key === imageKey ? prepared.error ?? '' : '',
    retry: () => setRetry(value => value + 1),
  }
}
