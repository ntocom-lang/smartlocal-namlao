import { useEffect, useState } from 'react'
import { supabase, supabaseUrl } from '../../lib/supabase'
import { fetchImageAsDataUrl } from '../../lib/driveStorage'
import { svgToPngFile, withNewsPhotoUrl } from '../../lib/complaintNewsImage'

// ตัวโหลดรูป + hook ที่กล่องภาพข่าวรายเรื่อง (ComplaintNewsDialog) กับกล่องภาพข่าวรวม (ComplaintNewsBatchDialog) ใช้ร่วมกัน
// แยกจากไฟล์คอมโพเนนต์ (newsDialogParts.jsx) เพราะ fast-refresh ต้องการให้ไฟล์คอมโพเนนต์ export แต่คอมโพเนนต์

const KEEP_SIDE = 1400

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
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.86)
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
    loadImage(branding.photo_url).then(result => { if (alive) setMayorPhoto(result.dataUrl) })
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
