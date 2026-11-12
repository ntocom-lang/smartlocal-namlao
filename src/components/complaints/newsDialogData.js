import { useEffect, useMemo, useState } from 'react'
import { supabase, supabaseUrl } from '../../lib/supabase'
import { fetchImageAsDataUrl } from '../../lib/driveStorage'
import { loadNewsFont } from '../../lib/newsFont'
import officeTemplateUrl from '../../assets/news/office-template.jpg?url'
import { departmentColorKeyByName, newsThemeFor } from '../../lib/departmentColors'
import { NEWS_EXEC_PHOTO_SIDE, cutoutPlainBackground, execRimPlan, officeFadePlan, svgToPngFile, transparentPhotoBox, withNewsPhotoUrl } from '../../lib/complaintNewsImage'

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
 * ขอบเรืองขาวตามรูปทรงคน (เจ้าของสั่ง 2569-11-12 #711) วาดลงในรูปเลย — เดิมทำด้วย SVG mask + <use> ซึ่ง iPhone Safari วาดไม่ตรง Chrome
 * canvas 2D (drawImage + source-in + globalAlpha) วาดเหมือนกันทุกเบราว์เซอร์ ไม่ใช้ ctx.filter (Safari รุ่นเก่าไม่รองรับ)
 * ทำ: ลอกเงาตัวคนเลื่อนไปรอบตัว (dirs ทิศ) → ระบายขาวทับเฉพาะส่วนที่มีตัว (source-in) → วางขอบนอกจาง + ขอบในเข้ม → วางรูปจริงทับ
 * เว้นที่บน/ซ้าย/ขวาให้ขอบเรือง ไม่เว้นล่าง (รูปยืนชิดก้นกล่อง) · รูปที่ตัดพื้นไม่ได้และมีกรอบ = ได้กรอบเรืองมุมมนแทน (เหมือน #711)
 * พัง = คืน null ผู้เรียกใช้รูปไม่มีขอบเรือง ภาพข่าวยังออกได้
 */
function withWhiteRim(source) {
  const plan = execRimPlan(source.width, source.height)
  if (!plan) return null
  const { pad, dirs, rings } = plan
  const rim = document.createElement('canvas')
  rim.width = source.width + pad * 2
  rim.height = source.height + pad
  const rimContext = rim.getContext('2d')
  const layer = document.createElement('canvas')
  layer.width = rim.width
  layer.height = rim.height
  const layerContext = layer.getContext('2d')
  if (!rimContext || !layerContext) return null
  for (const { radius, alpha } of rings) {
    layerContext.globalCompositeOperation = 'source-over'
    layerContext.clearRect(0, 0, layer.width, layer.height)
    for (let i = 0; i < dirs; i += 1) {
      const angle = (i / dirs) * Math.PI * 2
      layerContext.drawImage(source, pad + Math.cos(angle) * radius, pad + Math.sin(angle) * radius)
    }
    layerContext.globalCompositeOperation = 'source-in'
    layerContext.fillStyle = '#ffffff'
    layerContext.fillRect(0, 0, layer.width, layer.height)
    // ความทึบใส่ตอนวางทั้งชั้น (ไม่ใช่รายสำเนา) — สำเนาที่ซ้อนกันไม่ทึบสะสม ขอบจึงเนียนเท่ากันทุกด้าน
    rimContext.globalAlpha = alpha
    rimContext.drawImage(layer, 0, 0)
  }
  rimContext.globalAlpha = 1
  rimContext.drawImage(source, pad, pad)
  return rim
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
    return (withWhiteRim(out) || out).toDataURL('image/png')
  } catch {
    return dataUrl
  }
}

// ด้านยาวสูงสุดของรูปอาคารที่ใช้ในภาพข่าว — แถบหัวกว้าง 1080 วางอาคารไม่เกินครึ่งแถบ 1200 พอคมแล้ว
const OFFICE_SIDE = 1200

/**
 * รูปอาคารสำนักงานสำหรับแถบหัวภาพข่าว (ผู้อัปโหลด = แอดมิน อปท. ที่ตั้งค่าระบบ แท็บแบรนด์):
 *  - มีพื้นโปร่งใสมาเอง (PNG/WebP ตัดพื้นมาแล้ว) → ใช้ตามไฟล์ แค่ครอปชิดส่วนที่มองเห็น ไม่ทำขอบจางซ้ำ
 *  - รูปถ่ายทึบ → ทำขอบซ้าย/ขวา/บนจางให้กลืนพื้นแถบหัว ล่างคมเพราะรูปชิดก้นแถบ (ความกว้างจาก officeFadePlan)
 *    ใช้ canvas 2D destination-in + linearGradient สองรอบ — ไม่ใช้ ctx.filter / SVG mask (Safari วาดไม่ตรง Chrome)
 * ทำในเบราว์เซอร์ล้วน · พังกลางทาง = ใช้รูปเดิม ภาพข่าวยังออกได้
 * @param {string} dataUrl
 */
export async function prepareOfficePhoto(dataUrl) {
  try {
    const image = new Image()
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = dataUrl })
    const scale = Math.min(1, OFFICE_SIDE / Math.max(image.naturalWidth, image.naturalHeight))
    const w = Math.max(1, Math.round(image.naturalWidth * scale))
    const h = Math.max(1, Math.round(image.naturalHeight * scale))
    const work = document.createElement('canvas')
    work.width = w
    work.height = h
    const context = work.getContext('2d', { willReadFrequently: true })
    if (!context) return dataUrl
    context.drawImage(image, 0, 0, w, h)
    const box = transparentPhotoBox(context.getImageData(0, 0, w, h).data, w, h)
    const out = document.createElement('canvas')
    const outContext = out.getContext('2d')
    if (!outContext) return dataUrl
    if (box) {
      out.width = box.w
      out.height = box.h
      outContext.drawImage(work, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h)
      return out.toDataURL('image/png')
    }
    const plan = officeFadePlan(w, h)
    if (!plan) return dataUrl
    out.width = w
    out.height = h
    outContext.drawImage(work, 0, 0)
    // destination-in: เก็บเฉพาะส่วนที่ "ตัวไล่สี" ทึบ — รอบแรกจางซ้าย/ขวา รอบสองจางบน (ล่างทึบเต็ม)
    outContext.globalCompositeOperation = 'destination-in'
    const horizontal = outContext.createLinearGradient(0, 0, w, 0)
    horizontal.addColorStop(0, 'rgba(0,0,0,0)')
    horizontal.addColorStop(plan.side / w, 'rgba(0,0,0,1)')
    horizontal.addColorStop(1 - plan.side / w, 'rgba(0,0,0,1)')
    horizontal.addColorStop(1, 'rgba(0,0,0,0)')
    outContext.fillStyle = horizontal
    outContext.fillRect(0, 0, w, h)
    const vertical = outContext.createLinearGradient(0, 0, 0, h)
    vertical.addColorStop(0, 'rgba(0,0,0,0)')
    vertical.addColorStop(plan.top / h, 'rgba(0,0,0,1)')
    vertical.addColorStop(1, 'rgba(0,0,0,1)')
    outContext.fillStyle = vertical
    outContext.fillRect(0, 0, w, h)
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

// รูปอาคารแม่แบบ (ไฟล์อยู่ใน lazy chunk ของภาพข่าว ผ่าน ?url — same-origin) · โหลด+ทำขอบจางครั้งเดียวแล้วแคชไว้ใช้ทุกกล่อง
// ขนาดรูปคงเดิม 302×342 (ทึบ ไม่มีพื้นโปร่งใส จึงไม่โดนครอป) พิกัดชื่อใน OFFICE_TEMPLATE จึงยังตรง · โหลดไม่ได้ = null (ไม่แคชความล้มเหลว)
let officeTemplatePending = null
function loadOfficeTemplate() {
  if (!officeTemplatePending) {
    officeTemplatePending = fetchImageAsDataUrl(officeTemplateUrl)
      .then(result => (result.dataUrl ? prepareOfficePhoto(result.dataUrl) : null))
      .then(url => { if (!url) officeTemplatePending = null; return url })
      .catch(() => { officeTemplatePending = null; return null })
  }
  return officeTemplatePending
}

/**
 * โลโก้ อปท. + ชื่อ/ตำแหน่ง/รูปนายก (ผู้ลงนามช่องนายกคนปัจจุบัน ผ่าน RPC complaint_news_branding)
 * โหลดไม่ได้ = ไม่มีโลโก้/ไม่มีบล็อกนายก ไม่ทำให้กล่องพัง
 */
export function useNewsBranding(tenant) {
  const [logo, setLogo] = useState(null)
  const [branding, setBranding] = useState(null)
  const [mayorPhoto, setMayorPhoto] = useState(null)
  const [office, setOffice] = useState({ url: null, isTemplate: false })

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

  // รูปอาคารสำนักงาน (municipalities.office_photo_url) อ่านเอง ไม่ผ่าน TenantContext — ไม่อยู่ใน select ของ context โดยตั้งใจ
  // (deploy หน้าเว็บก่อนรัน SQL แล้วทุกเว็บจะ 42501) · คอลัมน์ยังไม่มี/อ่านไม่ได้/ไม่ได้ตั้ง/โหลดรูปของเขาไม่ได้ = ใช้รูปแม่แบบ
  // (ภาพข่าววาดชื่อ อปท. ทับ) · ตัดสินหลัง query เสร็จเท่านั้น แม่แบบจึงไม่โผล่แวบก่อนรูปจริง
  useEffect(() => {
    if (!tenant?.id) return undefined
    let alive = true
    const resolve = async () => {
      let url = null
      try {
        const { data, error } = await supabase.from('municipalities').select('office_photo_url').eq('id', tenant.id).maybeSingle()
        if (error) console.error('office_photo_url load error:', error.message)
        else if (data?.office_photo_url) {
          const result = await loadImage(data.office_photo_url)
          url = result.dataUrl ? await prepareOfficePhoto(result.dataUrl) : null
        }
      } catch (cause) {
        console.error('office_photo_url load error:', cause?.message)
      }
      if (url) return { url, isTemplate: false }
      const template = await loadOfficeTemplate()
      return { url: template, isTemplate: !!template }
    }
    resolve().then(next => { if (alive) setOffice(next) })
    return () => { alive = false }
  }, [tenant?.id])

  return { logo, branding, mayorPhoto, officePhoto: office.url, officeIsTemplate: office.isTemplate }
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
/**
 * ฟอนต์ Kanit ของภาพข่าว — รอโหลดก่อนค่อยวาดภาพ (ready) ไม่งั้นภาพแรกวาดด้วยฟอนต์ระบบแล้วสลับทีหลัง + เตรียม PNG ซ้ำสองรอบ
 * โหลดไม่สำเร็จ: ready=true, font=null → ภาพใช้ฟอนต์ระบบเดิม (ยังดาวน์โหลด/แชร์ได้)
 * @returns {{ ready: boolean, font: { family: string, css: string } | null }}
 */
export function useNewsFont() {
  const [state, setState] = useState({ ready: false, font: null })
  useEffect(() => {
    let active = true
    loadNewsFont().then(font => { if (active) setState({ ready: true, font }) })
    return () => { active = false }
  }, [])
  return state
}

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
