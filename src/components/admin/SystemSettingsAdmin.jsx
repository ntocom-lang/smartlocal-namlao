import { useState, useEffect, useRef } from 'react'
import { Settings, Save, Loader2, CheckCircle2, QrCode, Upload, Image as ImageIcon, Building2, Wallpaper, MapPinned, X, Plus, Pencil, Trash2, RefreshCw, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { uploadFile, toReliableImageUrl } from '../../lib/driveStorage'
import { useTenant } from '../../contexts/TenantContext'
import DepartmentManager from './DepartmentManager'

const inputCls = 'w-full px-4 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent transition-all'

// เพดานจำนวนสถานที่ — ข้อมูลจริงของ อปท. ที่ใช้อยู่มีศาลาหมู่บ้านครบ 10 หมู่ + ห้องประชุมอีก 2-3 แห่ง
// จึงตั้งไว้ 20 ไม่ใช่ 10 แต่ไม่ปล่อยไม่จำกัด เพราะปุ่มลัดเรียงกริด 2 คอลัมน์ ยาวเกินไปจะกดยากบนมือถือ
const MAX_EVENT_LOCATIONS = 20

export default function SystemSettingsAdmin() {
  const { tenant, patchTenant } = useTenant()
  const [pwaShortName, setPwaShortName] = useState(() => tenant?.pwa_short_name || '')
  const [subtitle, setSubtitle] = useState(() => tenant?.system_subtitle || '')
  const [address, setAddress] = useState(() => tenant?.address || '')
  const [phone, setPhone] = useState(() => tenant?.phone || '')
  const [fax, setFax] = useState(() => tenant?.fax || '')
  const [websiteUrl, setWebsiteUrl] = useState(() => tenant?.website_url || '')
  const [email, setEmail] = useState(() => tenant?.email || '')
  // หมายเลขภายในแต่ละกอง — [{name, ext}] ต่างจากฟิลด์อื่นในฟอร์มนี้ตรงที่เป็นลิสต์ยาวไม่เท่ากันได้ จึงแยก
  // ปุ่มบันทึกออกจาก saveContactInfo (กันพลาดกดบันทึกอันหนึ่งแล้วไปทับอีกอันที่ยังแก้ไม่เสร็จ)
  const [internalExtensions, setInternalExtensions] = useState(() => tenant?.internal_extensions || [])
  const [extensionsSaving, setExtensionsSaving] = useState(false)
  // สถานที่จัดกิจกรรมที่ใช้บ่อย — โผล่เป็นปุ่มลัดในฟอร์ม "เพิ่มกิจกรรมในปฏิทิน" ลิสต์ว่าง = ใช้ค่า
  // เริ่มต้นของระบบ (ห้องประชุมสภา / ห้องประชุม{อบต.|เทศบาล} / โดมอเนกประสงค์)
  const [eventLocations, setEventLocations] = useState(() => tenant?.event_location_presets || [])
  const [eventLocationsSaving, setEventLocationsSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [savedSection, setSavedSection] = useState(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoPreview, setLogoPreview] = useState(() => tenant?.logo_url || null)
  const [qrUploading, setQrUploading] = useState(false)
  const [qrPreview, setQrPreview] = useState(() => tenant?.qr_code_url || null)
  const [qrLabel, setQrLabel] = useState(() => tenant?.qr_label || '')
  const [qrLabelSaving, setQrLabelSaving] = useState(false)
  const [headerUploading, setHeaderUploading] = useState(false)
  const [headerPreview, setHeaderPreview] = useState(() => tenant?.header_image_url || null)
  const [headerImageMode, setHeaderImageMode] = useState(() => tenant?.header_image_mode || 'background')
  const [headerModeSaving, setHeaderModeSaving] = useState(false)
  const [smartCityUploading, setSmartCityUploading] = useState(false)
  const [smartCityPreview, setSmartCityPreview] = useState(() => tenant?.smart_city_image_url || null)
  const [tourismBgUploading, setTourismBgUploading] = useState(false)
  const [tourismBgPreview, setTourismBgPreview] = useState(() => toReliableImageUrl(tenant?.tourism_background_url) || null)
  const logoRef = useRef()
  const qrRef = useRef()
  const headerRef = useRef()
  const smartCityRef = useRef()
  const tourismBgRef = useRef()

  useEffect(() => {
    let cancelled = false
    if (!tenant?.id) return undefined

    supabase
      .from('municipalities')
      .select('tourism_background_url')
      .eq('id', tenant.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!cancelled && !error) {
          setTourismBgPreview(toReliableImageUrl(data?.tourism_background_url) || null)
        }
      })

    return () => { cancelled = true }
  }, [tenant?.id])

  async function saveSystemName(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const newPwaShortName = pwaShortName.trim() || null
      const newSubtitle = subtitle.trim() || null
      if (!tenant?.id) throw new Error('ไม่พบ tenant.id — กรุณา refresh หน้า')
      const { error } = await supabase.rpc('update_municipality_settings', {
        p_municipality_id: tenant.id,
        p_system_name:     tenant.system_name || tenant.name,
        p_system_subtitle: newSubtitle,
        p_pwa_short_name:  newPwaShortName,
      })
      if (error) throw error
      patchTenant({ pwa_short_name: newPwaShortName, system_subtitle: newSubtitle })
      setSavedSection('name')
      setTimeout(() => setSavedSection(null), 2500)
    } catch (err) {
      alert('บันทึกไม่สำเร็จ: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  async function saveContactInfo(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const newAddress = address.trim() || null
      const newPhone = phone.trim() || null
      const newFax = fax.trim() || null
      // เติม https:// ให้อัตโนมัติถ้าแอดมินพิมพ์แค่ "www.xxx.go.th" มา — ไม่งั้น <a href> จะตีความเป็น
      // relative path ต่อท้าย URL แอปเอง (เช่น localhost:5173/www.xxx.go.th) แทนที่จะออกเว็บจริง
      const trimmedWebsiteUrl = websiteUrl.trim()
      const newWebsiteUrl = trimmedWebsiteUrl ? (/^https?:\/\//i.test(trimmedWebsiteUrl) ? trimmedWebsiteUrl : `https://${trimmedWebsiteUrl}`) : null
      const newEmail = email.trim() || null

      if (!tenant?.id) throw new Error('ไม่พบ tenant.id — กรุณา refresh หน้า')

      const payload = {
        address: newAddress,
        phone: newPhone,
        fax: newFax,
        website_url: newWebsiteUrl,
        email: newEmail,
      }

      const { data, error } = await supabase
        .from('municipalities')
        .update(payload)
        .eq('id', tenant.id)
        .select('id')

      if (error) throw error
      if (!data?.length) throw new Error('RLS block — ไม่มีสิทธิ์ update municipalities')

      patchTenant({
        address: newAddress,
        phone: newPhone,
        fax: newFax,
        website_url: newWebsiteUrl,
        email: newEmail
      })
      setWebsiteUrl(newWebsiteUrl || '')

      setSavedSection('contact')
      setTimeout(() => setSavedSection(null), 2500)
    } catch (err) {
      alert('บันทึกไม่สำเร็จ: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  // หมายเลขภายใน — กรองแถวว่างทิ้งก่อนบันทึก (ชื่อกอง/เบอร์ต่อ ว่างทั้งคู่ = แถวที่ผู้ใช้เพิ่มมาแล้วไม่ได้กรอก)
  async function saveInternalExtensions() {
    setExtensionsSaving(true)
    try {
      if (!tenant?.id) throw new Error('ไม่พบ tenant.id — กรุณา refresh หน้า')
      const cleaned = internalExtensions
        .map(row => ({ name: row.name.trim(), ext: row.ext.trim() }))
        .filter(row => row.name || row.ext)

      const { data, error } = await supabase
        .from('municipalities')
        .update({ internal_extensions: cleaned })
        .eq('id', tenant.id)
        .select('id')

      if (error) throw error
      if (!data?.length) throw new Error('RLS block — ไม่มีสิทธิ์ update municipalities')

      patchTenant({ internal_extensions: cleaned })
      setInternalExtensions(cleaned)
      setSavedSection('extensions')
      setTimeout(() => setSavedSection(null), 2500)
    } catch (err) {
      alert('บันทึกไม่สำเร็จ: ' + err.message)
    } finally {
      setExtensionsSaving(false)
    }
  }

  // สถานที่จัดกิจกรรม — ตัดช่องว่างหัวท้าย ทิ้งแถวว่าง ตัดชื่อซ้ำ (ปุ่มในฟอร์มใช้ชื่อเป็น key)
  // และจำกัดความยาว/จำนวนไว้ ไม่ให้ปุ่มลัดยาวจนล้นกริด 2 คอลัมน์บนมือถือ
  async function saveEventLocations() {
    setEventLocationsSaving(true)
    try {
      if (!tenant?.id) throw new Error('ไม่พบ tenant.id — กรุณา refresh หน้า')
      const cleaned = [...new Set(
        eventLocations.map(v => String(v ?? '').trim().slice(0, 60)).filter(Boolean)
      )].slice(0, MAX_EVENT_LOCATIONS)

      const { data, error } = await supabase
        .from('municipalities')
        .update({ event_location_presets: cleaned })
        .eq('id', tenant.id)
        .select('id')

      if (error) throw error
      if (!data?.length) throw new Error('RLS block — ไม่มีสิทธิ์ update municipalities')

      patchTenant({ event_location_presets: cleaned })
      setEventLocations(cleaned)
      setSavedSection('eventLocations')
      setTimeout(() => setSavedSection(null), 2500)
    } catch (err) {
      alert('บันทึกไม่สำเร็จ: ' + err.message)
    } finally {
      setEventLocationsSaving(false)
    }
  }

  // เดิมไม่มี onerror/timeout เลย — ถ้าเบราว์เซอร์ decode ไฟล์เป็น <img> ไม่ได้ (ไฟล์เสีย, HEIC/WebP
  // บางรูปแบบที่ไม่รองรับ, ฯลฯ) Promise จะค้างไม่ resolve/reject ตลอดไป ทำให้ handleXxxUpload ที่ await
  // อยู่หยุดนิ่งเงียบๆ ไม่ error ไม่บันทึก แก้โดยเพิ่ม onerror + timeout กันค้าง แล้ว reject ให้ catch จับได้จริง
  function resizeImage(file, maxPx = 600) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file)
      const timer = setTimeout(() => {
        URL.revokeObjectURL(objectUrl)
        reject(new Error('โหลดไฟล์รูปภาพไม่สำเร็จ (หมดเวลา) — ไฟล์อาจเสียหายหรือเป็นชนิดที่เบราว์เซอร์นี้ไม่รองรับ'))
      }, 15000)
      const img = new Image()
      img.onload = () => {
        clearTimeout(timer)
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width  = Math.round(img.width  * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(blob => {
          URL.revokeObjectURL(objectUrl)
          if (blob) resolve(blob)
          else reject(new Error('แปลงไฟล์รูปภาพไม่สำเร็จ — ลองไฟล์อื่น (แนะนำ JPG/PNG)'))
        }, 'image/png', 0.92)
      }
      img.onerror = () => {
        clearTimeout(timer)
        URL.revokeObjectURL(objectUrl)
        reject(new Error('เปิดไฟล์รูปภาพไม่สำเร็จ — ไฟล์อาจเสียหายหรือไม่ใช่รูปภาพที่รองรับ (รองรับ JPG/PNG/WebP)'))
      }
      img.src = objectUrl
    })
  }

  async function handleLogoUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoPreview(URL.createObjectURL(file))
    setLogoUploading(true)
    try {
      const blob = await resizeImage(file, 512)
      const { url, error: upErr } = await uploadFile('municipality-assets', blob, {
        subject: 'logos',
        filename: `logo-${tenant.slug}.png`,
        municipality: tenant?.slug,
      })
      if (upErr) throw upErr
      // url จาก Drive มี query string (?id=...) อยู่แล้ว ต้องต่อด้วย & ไม่ใช่ ? (ผิดกับ Supabase Storage
      // getPublicUrl เดิมที่ไม่มี query string มาก่อน)
      const bustedUrl = `${url}&v=${Date.now()}`
      const { error: dbErr } = await supabase.rpc('update_municipality_logo', {
        p_municipality_id: tenant.id,
        p_logo_url: bustedUrl,
      })
      if (dbErr) throw dbErr
      setLogoPreview(bustedUrl)
      patchTenant({ logo_url: bustedUrl })
      setSavedSection('logo')
      setTimeout(() => setSavedSection(null), 2500)
    } catch (err) {
      setLogoPreview(tenant?.logo_url || null)
      alert('อัปโหลดโลโก้ไม่สำเร็จ: ' + err.message)
    } finally {
      setLogoUploading(false)
      e.target.value = ''
    }
  }

  async function handleQrUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setQrPreview(URL.createObjectURL(file))
    setQrUploading(true)
    try {
      const blob = await resizeImage(file, 600)
      const { url, error: upErr } = await uploadFile('municipality-assets', blob, {
        subject: 'qr',
        filename: `${tenant.slug}.png`,
        municipality: tenant?.slug,
      })
      if (upErr) throw upErr
      const bustedUrl = `${url}&v=${Date.now()}`
      const { error: dbErr } = await supabase.rpc('update_municipality_qr', {
        p_municipality_id: tenant.id,
        p_qr_code_url:     bustedUrl,
        p_qr_label:        tenant.qr_label ?? null,
      })
      if (dbErr) throw dbErr
      setQrPreview(bustedUrl)
      patchTenant({ qr_code_url: bustedUrl })
      setSavedSection('qr')
      setTimeout(() => setSavedSection(null), 2500)
    } catch (err) {
      setQrPreview(tenant?.qr_code_url || null)
      alert('อัปโหลด QR ไม่สำเร็จ: ' + err.message)
    } finally {
      setQrUploading(false)
    }
  }

  async function handleHeaderUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const blobUrl = URL.createObjectURL(file)
    setHeaderPreview(blobUrl)
    setHeaderUploading(true)
    let publicUrl = null
    try {
      const blob = await resizeImage(file, 1600)
      const { url, error: upErr } = await uploadFile('municipality-assets', blob, {
        subject: 'headers',
        filename: `header-${tenant.slug}.jpg`,
        municipality: tenant?.slug,
      })
      if (upErr) throw upErr
      // เพิ่ม timestamp ป้องกัน browser cache รูปเก่า — & ไม่ใช่ ? เพราะ url จาก Drive มี ?id= อยู่แล้ว
      publicUrl = `${url}&v=${Date.now()}`
      const { data: updatedRows, error: dbErr } = await supabase
        .from('municipalities')
        .update({ header_image_url: publicUrl })
        .eq('id', tenant.id)
        .select('id')
      if (dbErr) throw dbErr
      if (!updatedRows?.length) throw new Error('RLS block — ไม่มีสิทธิ์ update municipalities\nกรุณารัน SQL ใน Supabase: ALTER TABLE municipalities DISABLE ROW LEVEL SECURITY;')
      setHeaderPreview(publicUrl)
      patchTenant({ header_image_url: publicUrl })
      setSavedSection('header')
      setTimeout(() => setSavedSection(null), 2500)
    } catch (err) {
      // storage สำเร็จแต่ DB ล้มเหลว → คง preview ไว้ + แจ้งให้รู้
      if (publicUrl) {
        setHeaderPreview(publicUrl)
        alert('อัปโหลดไฟล์สำเร็จ แต่บันทึกลงฐานข้อมูลไม่ได้: ' + err.message + '\n\nตรวจสอบ RLS policy บน municipalities table')
      } else {
        setHeaderPreview(tenant?.header_image_url || null)
        alert('อัปโหลดภาพพื้นหลังไม่สำเร็จ: ' + err.message)
      }
    } finally {
      setHeaderUploading(false)
      e.target.value = ''
    }
  }

  async function removeHeaderImage() {
    if (!confirm('ลบภาพพื้นหลัง header ออก?')) return
    const { error } = await supabase
      .from('municipalities')
      .update({ header_image_url: null })
      .eq('id', tenant.id)
    if (error) { alert('ลบไม่สำเร็จ: ' + error.message); return }
    setHeaderPreview(null)
    patchTenant({ header_image_url: null })
  }

  // 'background' (เดิม) = มีเงาไล่สีคลุมให้อ่านตัวหนังสือทับได้ · 'full' = โชว์ภาพเต็มสีสัน ไม่มีเงาคลุม
  // — บางธีม (เช่น thungkaew-Theme) ใช้ภาพนี้เป็นภาพเด่นเต็มจอ ไม่ได้ใช้เป็นพื้นหลังคลุมข้อความ
  async function setHeaderMode(mode) {
    if (mode === headerImageMode) return
    setHeaderModeSaving(true)
    setHeaderImageMode(mode) // optimistic — เปลี่ยน UI ก่อน ไม่ต้องรอ round-trip
    try {
      const { error } = await supabase
        .from('municipalities').update({ header_image_mode: mode }).eq('id', tenant.id)
      if (error) throw error
      patchTenant({ header_image_mode: mode })
    } catch (err) {
      setHeaderImageMode(tenant?.header_image_mode || 'background')
      alert('เปลี่ยนโหมดไม่สำเร็จ: ' + err.message)
    } finally {
      setHeaderModeSaving(false)
    }
  }

  async function handleSmartCityUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const blobUrl = URL.createObjectURL(file)
    setSmartCityPreview(blobUrl)
    setSmartCityUploading(true)
    let publicUrl = null
    try {
      const blob = await resizeImage(file, 1600)
      const { url, error: upErr } = await uploadFile('municipality-assets', blob, {
        subject: 'smart-city',
        filename: `smart-city-${tenant.slug}.jpg`,
        municipality: tenant?.slug,
      })
      if (upErr) throw upErr
      publicUrl = `${url}&v=${Date.now()}`
      const { data: updatedRows, error: dbErr } = await supabase
        .from('municipalities')
        .update({ smart_city_image_url: publicUrl })
        .eq('id', tenant.id)
        .select('id')
      if (dbErr) throw dbErr
      if (!updatedRows?.length) throw new Error('RLS block — ไม่มีสิทธิ์ update municipalities')
      setSmartCityPreview(publicUrl)
      patchTenant({ smart_city_image_url: publicUrl })
      setSavedSection('smartcity')
      setTimeout(() => setSavedSection(null), 2500)
    } catch (err) {
      if (publicUrl) {
        setSmartCityPreview(publicUrl)
        alert('อัปโหลดไฟล์สำเร็จ แต่บันทึกลงฐานข้อมูลไม่ได้: ' + err.message)
      } else {
        setSmartCityPreview(tenant?.smart_city_image_url || null)
        alert('อัปโหลดภาพไม่สำเร็จ: ' + err.message)
      }
    } finally {
      setSmartCityUploading(false)
      e.target.value = ''
    }
  }

  async function removeSmartCityImage() {
    if (!confirm('ลบภาพพื้นหลัง SMART CITY ออก? (จะกลับไปใช้ภาพผังเมืองที่วาดเองแทน)')) return
    const { error } = await supabase
      .from('municipalities')
      .update({ smart_city_image_url: null })
      .eq('id', tenant.id)
    if (error) { alert('ลบไม่สำเร็จ: ' + error.message); return }
    setSmartCityPreview(null)
    patchTenant({ smart_city_image_url: null })
  }

  async function handleTourismBgUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const supportedType = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
      || (!file.type && /\.(jpe?g|png|webp)$/i.test(file.name))
    if (!supportedType) {
      alert('รองรับเฉพาะไฟล์ JPG, PNG และ WebP')
      e.target.value = ''
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('ไฟล์มีขนาดเกิน 5 MB กรุณาลดขนาดรูปก่อนอัปโหลด')
      e.target.value = ''
      return
    }

    const blobUrl = URL.createObjectURL(file)
    setTourismBgPreview(blobUrl)
    setTourismBgUploading(true)
    let publicUrl = null
    try {
      const blob = await resizeImage(file, 1600)
      const { url, error: upErr } = await uploadFile('municipality-assets', blob, {
        subject: 'tourism-backgrounds',
        filename: `tourism-background-${tenant.slug}.png`,
        municipality: tenant?.slug,
      })
      if (upErr) throw upErr
      if (!url) throw new Error('ระบบอัปโหลดไม่ส่ง URL ของรูปภาพกลับมา')
      publicUrl = `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`
      const { data: updatedRows, error: dbErr } = await supabase
        .from('municipalities')
        .update({ tourism_background_url: publicUrl })
        .eq('id', tenant.id)
        .select('id')
      if (dbErr) throw dbErr
      if (!updatedRows?.length) throw new Error('RLS block — ไม่มีสิทธิ์ update municipalities')

      const reliableUrl = toReliableImageUrl(publicUrl)
      setTourismBgPreview(reliableUrl)
      patchTenant({ tourism_background_url: publicUrl })
      setSavedSection('tourismBg')
      setTimeout(() => setSavedSection(null), 2500)
    } catch (err) {
      if (publicUrl) {
        setTourismBgPreview(toReliableImageUrl(publicUrl))
        alert('อัปโหลดไฟล์สำเร็จ แต่บันทึกลงฐานข้อมูลไม่ได้: ' + err.message)
      } else {
        setTourismBgPreview(toReliableImageUrl(tenant?.tourism_background_url) || null)
        alert('อัปโหลดภาพพื้นหลังท่องเที่ยวไม่สำเร็จ: ' + err.message)
      }
    } finally {
      URL.revokeObjectURL(blobUrl)
      setTourismBgUploading(false)
      e.target.value = ''
    }
  }

  async function removeTourismBgImage() {
    if (!confirm('ลบภาพพื้นหลังท่องเที่ยวออก? (ระบบจะกลับไปใช้ภาพเริ่มต้น)')) return
    const { data: updatedRows, error } = await supabase
      .from('municipalities')
      .update({ tourism_background_url: null })
      .eq('id', tenant.id)
      .select('id')
    if (error) { alert('ลบไม่สำเร็จ: ' + error.message); return }
    if (!updatedRows?.length) { alert('ลบไม่สำเร็จ: ไม่มีสิทธิ์แก้ไขข้อมูลเทศบาล'); return }
    setTourismBgPreview(null)
    patchTenant({ tourism_background_url: null })
  }

  async function saveQrLabel(e) {
    e.preventDefault()
    setQrLabelSaving(true)
    try {
      const label = qrLabel.trim() || null
      const { error } = await supabase.rpc('update_municipality_qr', {
        p_municipality_id: tenant.id,
        p_qr_code_url:     tenant.qr_code_url ?? null,
        p_qr_label:        label,
      })
      if (error) throw error
      patchTenant({ qr_label: label })
      setSavedSection('qrLabel')
      setTimeout(() => setSavedSection(null), 2500)
    } catch (err) {
      alert('บันทึกไม่สำเร็จ: ' + err.message)
    } finally {
      setQrLabelSaving(false)
    }
  }

  const [activeTab, setActiveTab] = useState('general')
  const props = {
    tenant, inputCls, loading, savedSection,
    subtitle, setSubtitle, pwaShortName, setPwaShortName, saveSystemName,
    address, setAddress, phone, setPhone, fax, setFax, websiteUrl, setWebsiteUrl, email, setEmail, saveContactInfo,
    internalExtensions, setInternalExtensions, extensionsSaving, saveInternalExtensions,
    eventLocations, setEventLocations, eventLocationsSaving, saveEventLocations,
    logoPreview, logoUploading, logoRef, handleLogoUpload,
    headerPreview, headerUploading, headerRef, handleHeaderUpload, removeHeaderImage,
    headerImageMode, headerModeSaving, setHeaderMode,
    smartCityPreview, smartCityUploading, smartCityRef, handleSmartCityUpload, removeSmartCityImage,
    tourismBgPreview, tourismBgUploading, tourismBgRef, handleTourismBgUpload, removeTourismBgImage,
    qrPreview, qrUploading, qrRef, handleQrUpload, qrLabel, setQrLabel, qrLabelSaving, saveQrLabel,
  }
  const ActiveComponent = SETTINGS_TABS.find(t => t.key === activeTab)?.Component ?? GeneralInfoTab

  return (
    <div className="space-y-6 max-w-2xl">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
             style={{ backgroundColor: 'var(--color-primary)', color: '#fff' }}>
          <Settings size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-800">ตั้งค่าระบบ</h1>
          <p className="text-sm text-gray-500">จัดการข้อมูลพื้นฐานและบริการออนไลน์</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-2 flex gap-1 overflow-x-auto">
        {SETTINGS_TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === t.key ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      <ActiveComponent {...props} />
    </div>
  )
}

// เพิ่มแท็บใหม่ในอนาคต: เพิ่ม entry ตรงนี้ + เขียน component ใหม่ ไม่ต้องแก้โครงสร้าง SystemSettingsAdmin เลย
const SETTINGS_TABS = [
  { key: 'general',      label: 'ข้อมูลทั่วไป',       icon: Settings,  Component: GeneralInfoTab },
  { key: 'branding',     label: 'แบรนด์และรูปภาพ',    icon: Wallpaper, Component: BrandingTab },
  { key: 'qr',           label: 'โลโก้/QR Code',      icon: QrCode,    Component: QrCodeTab },
  { key: 'departments',  label: 'กอง/หน่วยงาน',      icon: Building2, Component: DepartmentsTab },
  // ซ่อนไว้ 2569-08-31: ตัวเลขบนแท็บนี้จะเป็น 0 ไปจนถึงราวปี 2573 (เรื่องแรกที่ปิด + 5 ปี)
  // จึงยังไม่มีอะไรให้แอดมินตัดสินใจ กลไกฝั่ง DB ยังอยู่ครบและยังเรียกได้จาก SQL Editor
  // เปิดกลับ = ลบคอมเมนต์บรรทัดล่างนี้ออก + เติม ShieldCheck กลับใน import บรรทัดบนสุด
  // (DataRetentionTab ยังอยู่ครบในไฟล์นี้ ไม่ต้องเขียนใหม่)
  // { key: 'retention',    label: 'ข้อมูลส่วนบุคคล',    icon: ShieldCheck, Component: DataRetentionTab },
]

// ระยะเวลาเก็บรักษาที่ประกาศไว้กับประชาชนในฟอร์มและ PDPA modal (src/pages/CitizenForm.jsx)
// ต้องเป็นค่าเดียวกับที่ส่งให้ฐานข้อมูล ไม่งั้นหน้าจอกับสิ่งที่ลบจริงจะคนละเรื่องกัน
const RETENTION = '5 years'
const RETENTION_LABEL = '5 ปีนับจากวันปิดเรื่อง'

// การลบข้อมูลติดต่อของประชาชนเคยเป็น cron รายวัน แต่ถอดออกแล้ว (migration 20260902150000)
// ให้เป็นการกระทำที่มีคนรับผิดชอบแทน — แท็บนี้คือหน้าที่ทำให้คำประกาศเรื่องระยะเวลาเก็บรักษา
// เป็นจริงได้โดยไม่ต้องเข้า SQL editor: ดูจำนวนที่ถึงกำหนด แล้วกดลบเมื่อตัดสินใจแล้ว
// ตัวเลขทั้งหมดมาจาก complaint_contact_retention_preview() (อ่านอย่างเดียว) และการลบไปที่
// purge_due_complaint_contacts() ที่บังคับให้ส่งจำนวนบนหน้าจอไปยืนยันกับความจริงฝั่งเซิร์ฟเวอร์
// eslint-disable-next-line no-unused-vars -- ถูกซ่อนจาก SETTINGS_TABS ชั่วคราว เก็บไว้รอเปิดกลับ
function DataRetentionTab() {
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [purging, setPurging] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  async function loadPreview() {
    setLoading(true)
    setError(null)
    const { data, error: rpcError } = await supabase
      .rpc('complaint_contact_retention_preview', { p_retention: RETENTION })
    if (rpcError) setError('ดูข้อมูลไม่สำเร็จ: ' + rpcError.message)
    else setPreview(data)
    setLoading(false)
  }

  useEffect(() => { queueMicrotask(loadPreview) }, [])

  async function runPurge() {
    setPurging(true)
    setError(null)
    setResult(null)
    const { data, error: rpcError } = await supabase.rpc('purge_due_complaint_contacts', {
      p_expected_count: preview?.due_for_purge ?? 0,
      p_retention: RETENTION,
    })
    if (rpcError) setError('ลบไม่สำเร็จ: ' + rpcError.message)
    else setResult(data)
    setConfirming(false)
    setPurging(false)
    await loadPreview()
  }

  const due = preview?.due_for_purge ?? 0
  const cutoffLabel = preview?.cutoff
    ? new Date(preview.cutoff).toLocaleDateString('th-TH', { dateStyle: 'long' })
    : '—'

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
      <div>
        <h2 className="text-base font-bold text-gray-800">ระยะเวลาเก็บข้อมูลติดต่อผู้แจ้ง</h2>
        <p className="text-sm text-gray-500 mt-1">
          หน่วยงานประกาศกับประชาชนในแบบฟอร์มว่าเก็บ <strong>ชื่อ-นามสกุลและเบอร์โทรศัพท์</strong> ไว้ {RETENTION_LABEL}
          — หน้านี้คือที่ที่ทำให้คำประกาศนั้นเป็นจริง ระบบไม่ลบเองอัตโนมัติ ผู้ดูแลเป็นคนตัดสินใจกดลบ
          (รายละเอียดคำร้อง พิกัด และสถิติไม่ถูกแตะ)
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-6">
          <Loader2 size={16} className="animate-spin" /> กำลังตรวจข้อมูล...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'ถึงกำหนดลบแล้ว', value: due, tone: due > 0 ? 'text-red-600' : 'text-gray-800' },
              { label: 'ยังเก็บข้อมูลติดต่ออยู่', value: preview?.holding_contacts ?? 0, tone: 'text-gray-800' },
              { label: 'ตัดสินไม่ได้', value: preview?.skipped_no_anchor ?? 0, tone: 'text-amber-600' },
            ].map(card => (
              <div key={card.label} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3">
                <p className="text-[11px] font-semibold text-gray-400">{card.label}</p>
                <p className={`text-2xl font-bold mt-0.5 ${card.tone}`}>{card.value}</p>
                <p className="text-[11px] text-gray-400">เรื่อง</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-500">
            นับเรื่องที่ปิดก่อนวันที่ <strong>{cutoffLabel}</strong>
            {preview?.scope === 'all_municipalities' ? ' (ทุกหน่วยงาน)' : ' (เฉพาะหน่วยงานของท่าน)'}
          </p>

          {(preview?.skipped_no_anchor ?? 0) > 0 && (
            <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>
                มี {preview.skipped_no_anchor} เรื่องที่ปิดแล้วแต่ไม่มีวันที่ปิดเรื่องบันทึกไว้ จึงนับอายุไม่ได้และจะไม่ถูกลบ
                — ต้องให้ผู้ดูแลระบบเติมวันที่ปิดเรื่องย้อนหลังก่อน
              </span>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">{error}</div>
          )}

          {result && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800">
              {result.purged > 0
                ? `ลบข้อมูลติดต่อของ ${result.purged} เรื่องเรียบร้อย บันทึกไว้ในบันทึกกิจกรรมแล้ว`
                : (result.message ?? 'ยังไม่มีเรื่องที่ถึงกำหนดลบ')}
            </div>
          )}

          {confirming ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3">
              <p className="text-sm font-bold text-red-800">ยืนยันการลบข้อมูลติดต่อ {due} เรื่อง</p>
              <p className="text-xs text-red-700">
                ชื่อ-นามสกุลและเบอร์โทรของผู้แจ้งในเรื่องเหล่านี้จะถูกลบถาวร กู้คืนไม่ได้
                ตัวคำร้อง สถานะ และพิกัดยังอยู่ครบ ระบบจะบันทึกว่าท่านเป็นผู้สั่งลบไว้ในบันทึกกิจกรรม
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={runPurge} disabled={purging}
                  className="flex-1 rounded-xl bg-red-600 py-2 text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2">
                  {purging && <Loader2 size={14} className="animate-spin" />} ยืนยันลบ {due} เรื่อง
                </button>
                <button type="button" onClick={() => setConfirming(false)} disabled={purging}
                  className="flex-1 rounded-xl border border-gray-200 bg-white py-2 text-sm font-medium text-gray-600">
                  ยกเลิก
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setConfirming(true)} disabled={due === 0}
                title={due === 0 ? 'ยังไม่มีเรื่องที่ถึงกำหนดลบ' : undefined}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2">
                <Trash2 size={15} /> ลบข้อมูลติดต่อที่ครบกำหนด{due > 0 ? ` (${due} เรื่อง)` : ''}
              </button>
              <button type="button" onClick={loadPreview}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 flex items-center gap-2">
                <RefreshCw size={15} /> ตรวจใหม่
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function DepartmentsTab({ tenant }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <DepartmentManager tenant={tenant} />
    </div>
  )
}

function GeneralInfoTab({
  tenant, inputCls, loading, savedSection,
  subtitle, setSubtitle, pwaShortName, setPwaShortName, saveSystemName,
  address, setAddress, phone, setPhone, fax, setFax, websiteUrl, setWebsiteUrl, email, setEmail, saveContactInfo,
  internalExtensions, setInternalExtensions, extensionsSaving, saveInternalExtensions,
  eventLocations, setEventLocations, eventLocationsSaving, saveEventLocations,
}) {
  const orgLabel = tenant?.org_type === 'อบต.' ? 'อบต.' : 'เทศบาล'
  const DEFAULT_EVENT_LOCATIONS = ['ห้องประชุมสภา', `ห้องประชุม${orgLabel}`, 'โดมอเนกประสงค์']

  function addLocationRow() {
    setEventLocations(prev => [...prev, ''])
  }
  function updateLocationRow(i, value) {
    setEventLocations(prev => prev.map((row, idx) => idx === i ? value : row))
  }
  function removeLocationRow(i) {
    setEventLocations(prev => prev.filter((_, idx) => idx !== i))
  }
  // ให้แอดมินเริ่มจากค่าเริ่มต้นแล้วแก้คำ (เช่น "โดมอเนกประสงค์" → "โดมหน้าสำนักงาน") ง่ายกว่าพิมพ์ใหม่หมด
  function seedDefaultLocations() {
    setEventLocations(DEFAULT_EVENT_LOCATIONS)
  }

  function addExtensionRow() {
    setInternalExtensions(prev => [...prev, { name: '', ext: '' }])
  }
  function updateExtensionRow(i, field, value) {
    setInternalExtensions(prev => prev.map((row, idx) => idx === i ? { ...row, [field]: value } : row))
  }
  function removeExtensionRow(i) {
    setInternalExtensions(prev => prev.filter((_, idx) => idx !== i))
  }
  return (
    <div className="space-y-6">
      {/* ── ชื่อแอปบนมือถือ ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
          <Settings size={15} /> ชื่อและคำอธิบายระบบ
        </h2>
        <form onSubmit={saveSystemName} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">คำอธิบายระบบ (Subtitle)</label>
            <p className="text-xs text-gray-400 mb-2 leading-relaxed">
              แสดงใต้ชื่อหน่วยงานใน Header — ถ้าไม่กำหนดจะใช้ค่าเริ่มต้น "✦ E-Service ✦ งานบริการประชาชน"
            </p>
            <input
              type="text"
              value={subtitle}
              onChange={e => setSubtitle(e.target.value)}
              placeholder="เช่น ระบบบริการประชาชนออนไลน์ หรือ E-Service เทศบาลตำบลน้ำเลา"
              maxLength={80}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">PWA Short Name</label>
            <p className="text-xs text-gray-400 mb-2 leading-relaxed">
              ชื่อที่แสดงใต้ไอคอนและหน้า Splash Screen เมื่อติดตั้งแอป — แนะนำไม่เกิน 12 ตัวอักษร<br />
              ถ้าไม่กำหนดจะใช้ชื่อย่ออัตโนมัติ เช่น ทต.น้ำเลา, อบต.ตำหนักธรรม
            </p>
            <input
              type="text"
              value={pwaShortName}
              onChange={e => setPwaShortName(e.target.value)}
              placeholder={`เช่น ทต.${tenant?.name?.replace(/เทศบาลตำบล|เทศบาลเมือง|เทศบาลนคร|องค์การบริหารส่วนตำบล/g, '') || 'น้ำเลา'}`}
              maxLength={20}
              className={inputCls}
            />
          </div>
          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-xl shadow-sm hover:shadow transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {savedSection === 'name' ? <CheckCircle2 size={16} /> : <Save size={16} />}
              {savedSection === 'name' ? 'บันทึกแล้ว' : 'บันทึก'}
            </button>
          </div>
        </form>
      </div>

      {/* ── ข้อมูลหน่วยงานและการติดต่อ ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
          <Building2 size={15} /> ข้อมูลหน่วยงานและการติดต่อ
        </h2>
        <form onSubmit={saveContactInfo} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">ที่อยู่หน่วยงาน</label>
            <textarea
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="เช่น เลขที่ 101 หมู่ที่ 5 ตำบลน้ำเลา อำเภอร้องกวาง จังหวัดแพร่ 54140"
              rows={2}
              className={inputCls}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">เบอร์โทรศัพท์</label>
              <input
                type="text"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="เช่น 054-546-092"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">โทรสาร (แฟกซ์) — เว้นว่างได้ถ้าไม่มี</label>
              <input
                type="text"
                value={fax}
                onChange={e => setFax(e.target.value)}
                placeholder="เช่น 054-546-092 ต่อ 18"
                className={inputCls}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">เว็บไซต์</label>
              <input
                type="text"
                value={websiteUrl}
                onChange={e => setWebsiteUrl(e.target.value)}
                placeholder="เช่น www.namlao.go.th"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">อีเมลกลาง</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="เช่น phrae_namlao101@hotmail.co.th"
                className={inputCls}
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-xl shadow-sm hover:shadow transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {savedSection === 'contact' ? <CheckCircle2 size={16} /> : <Save size={16} />}
              {savedSection === 'contact' ? 'บันทึกแล้ว' : 'บันทึกข้อมูลติดต่อ'}
            </button>
          </div>
        </form>
      </div>

      {/* ── หมายเลขภายในแต่ละกอง ── แสดงในหน้า "ติดต่อหน่วยงาน" ของประชาชน ถ้าไม่กรอกจะซ่อน section
          นั้นไปเลย ไม่ต้องกรอกครบทุกกองถ้าไม่มี — เพิ่ม/ลบแถวได้อิสระ ไม่ fix จำนวนกอง */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
          <Building2 size={15} /> หมายเลขภายในแต่ละกอง
        </h2>
        <p className="text-xs text-gray-400 mb-4">แสดงในหน้า "ติดต่อหน่วยงาน" — เว้นว่างได้ถ้าไม่ต้องการแสดง</p>

        <div className="space-y-2.5">
          {internalExtensions.map((row, i) => (
            <div key={i} className="flex items-center gap-2.5">
              <input
                type="text"
                value={row.name}
                onChange={e => updateExtensionRow(i, 'name', e.target.value)}
                placeholder="เช่น กองคลัง"
                className={`${inputCls} flex-1`}
              />
              <input
                type="text"
                value={row.ext}
                onChange={e => updateExtensionRow(i, 'ext', e.target.value)}
                placeholder="เช่น 11, 14"
                className={`${inputCls} w-28 shrink-0`}
              />
              <button type="button" onClick={() => removeExtensionRow(i)}
                className="shrink-0 w-9 h-9 flex items-center justify-center rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                <X size={16} />
              </button>
            </div>
          ))}
        </div>

        <button type="button" onClick={addExtensionRow}
          className="mt-3 px-4 py-2 text-xs font-semibold text-gray-500 border border-dashed border-gray-300 rounded-xl hover:bg-gray-50 hover:text-gray-700 transition-colors flex items-center gap-1.5">
          <Plus size={14} /> เพิ่มกอง/ฝ่าย
        </button>

        <div className="flex justify-end pt-4">
          <button
            type="button"
            onClick={saveInternalExtensions}
            disabled={extensionsSaving}
            className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-xl shadow-sm hover:shadow transition-all flex items-center gap-2 disabled:opacity-50"
          >
            {savedSection === 'extensions' ? <CheckCircle2 size={16} /> : <Save size={16} />}
            {savedSection === 'extensions' ? 'บันทึกแล้ว' : 'บันทึกหมายเลขภายใน'}
          </button>
        </div>
      </div>

      {/* ── สถานที่จัดกิจกรรม ── ปุ่มลัดในฟอร์ม "เพิ่มกิจกรรมในปฏิทิน" ลิสต์ว่าง = ใช้ค่าเริ่มต้นของระบบ
          เพราะชื่ออาคารของแต่ละ อปท. ไม่เหมือนกัน (โดมอยู่หน้า/ข้าง/หลัง หรือไม่มีโดมเลย) */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
          <MapPinned size={15} /> สถานที่จัดกิจกรรม
        </h2>
        <p className="text-xs text-gray-400 mb-4">
          ปุ่มลัดในฟอร์ม "เพิ่มกิจกรรมในปฏิทิน" — เจ้าหน้าที่ยังกด "อื่นๆ (ระบุ)" พิมพ์สถานที่นอกรายการได้เสมอ
        </p>

        {eventLocations.length === 0 ? (
          <div className="rounded-xl bg-gray-50 border border-gray-100 p-4">
            <p className="text-xs text-gray-500 mb-2">ยังไม่ได้ตั้งค่า — ตอนนี้ระบบใช้ค่าเริ่มต้น:</p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {DEFAULT_EVENT_LOCATIONS.map(loc => (
                <span key={loc} className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs text-gray-600">{loc}</span>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={seedDefaultLocations}
                className="px-4 py-2 text-xs font-semibold text-gray-600 border border-dashed border-gray-300 rounded-xl hover:bg-white hover:text-gray-800 transition-colors flex items-center gap-1.5">
                <Pencil size={14} /> แก้ไขให้ตรงกับสถานที่จริง
              </button>
              {/* ลบแถวจนหมดแล้วต้องกดบันทึกได้ ไม่งั้นค่าที่เคยตั้งไว้ใน DB จะค้างอยู่ทั้งที่หน้าจอว่าง */}
              {tenant?.event_location_presets?.length > 0 && (
                <button type="button" onClick={saveEventLocations} disabled={eventLocationsSaving}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold rounded-xl shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-50">
                  {savedSection === 'eventLocations' ? <CheckCircle2 size={14} /> : <Save size={14} />}
                  {savedSection === 'eventLocations' ? 'บันทึกแล้ว' : 'บันทึกกลับไปใช้ค่าเริ่มต้น'}
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-2.5">
              {eventLocations.map((loc, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  <input
                    type="text"
                    value={loc}
                    maxLength={60}
                    onChange={e => updateLocationRow(i, e.target.value)}
                    placeholder="เช่น โดมหน้าสำนักงาน, ศาลาประชาคม"
                    className={`${inputCls} flex-1`}
                  />
                  <button type="button" onClick={() => removeLocationRow(i)}
                    className="shrink-0 w-9 h-9 flex items-center justify-center rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>

            {eventLocations.length < MAX_EVENT_LOCATIONS && (
              <button type="button" onClick={addLocationRow}
                className="mt-3 px-4 py-2 text-xs font-semibold text-gray-500 border border-dashed border-gray-300 rounded-xl hover:bg-gray-50 hover:text-gray-700 transition-colors flex items-center gap-1.5">
                <Plus size={14} /> เพิ่มสถานที่
              </button>
            )}

            <div className="flex justify-end pt-4">
              <button
                type="button"
                onClick={saveEventLocations}
                disabled={eventLocationsSaving}
                className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-xl shadow-sm hover:shadow transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {savedSection === 'eventLocations' ? <CheckCircle2 size={16} /> : <Save size={16} />}
                {savedSection === 'eventLocations' ? 'บันทึกแล้ว' : 'บันทึกสถานที่'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function BrandingTab({
  tenant, savedSection,
  headerPreview, headerUploading, headerRef, handleHeaderUpload, removeHeaderImage,
  headerImageMode, headerModeSaving, setHeaderMode,
  smartCityPreview, smartCityUploading, smartCityRef, handleSmartCityUpload, removeSmartCityImage,
  tourismBgPreview, tourismBgUploading, tourismBgRef, handleTourismBgUpload, removeTourismBgImage,
}) {
  return (
    <div className="space-y-6">
      {/* ── ภาพพื้นหลัง Header ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
          <Wallpaper size={15} /> ภาพพื้นหลัง Header
        </h2>
        <p className="text-xs text-gray-400 mb-4 leading-relaxed">
          แสดงเป็นพื้นหลังแถบ header บนสุดของแอป · แนะนำรูปแนวนอน 1600×400px ขึ้นไป
        </p>

        {/* โหมดการแสดงผล — บางธีมต้องการภาพเต็มสีสันแทนที่จะเป็นพื้นหลังจางๆ ทับด้วยตัวหนังสือ */}
        <div className="mb-5">
          <p className="text-xs font-semibold text-gray-500 mb-1.5">รูปแบบการแสดงผล</p>
          <div className="inline-flex rounded-xl border border-gray-200 p-1 bg-gray-50">
            <button type="button" disabled={headerModeSaving} onClick={() => setHeaderMode('background')}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
              style={headerImageMode === 'background'
                ? { backgroundColor: 'var(--color-primary)', color: '#fff' }
                : { color: '#6b7280' }}>
              พื้นหลัง (มีเงาคลุม)
            </button>
            <button type="button" disabled={headerModeSaving} onClick={() => setHeaderMode('full')}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
              style={headerImageMode === 'full'
                ? { backgroundColor: 'var(--color-primary)', color: '#fff' }
                : { color: '#6b7280' }}>
              ภาพเต็มสีสัน (ไม่มีเงาคลุม)
            </button>
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">
            "พื้นหลัง" เหมาะกับภาพที่มีตัวหนังสือ/โลโก้ อปท. ทับอยู่ด้านบน · "ภาพเต็มสีสัน" เหมาะกับธีมที่ต้องการโชว์ภาพจริงไม่มีอะไรบัง
          </p>
        </div>

        <div className="flex items-start gap-5">
          <div className="shrink-0">
            <div className="w-48 h-20 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden">
              {headerPreview
                ? <img src={headerPreview} alt="Header" className="w-full h-full object-cover" />
                : <div className="flex flex-col items-center gap-1 text-gray-300">
                    <Wallpaper size={24} />
                    <span className="text-[10px]">ยังไม่มีภาพ</span>
                  </div>
              }
            </div>
            {savedSection === 'header' && (
              <p className="flex items-center gap-1 text-xs text-emerald-600 mt-2 justify-center">
                <CheckCircle2 size={12} /> บันทึกสำเร็จ
              </p>
            )}
          </div>
          <div className="flex-1 space-y-2">
            <p className="text-xs text-gray-500 leading-relaxed">รองรับ JPG · PNG · WebP<br /><span className="text-gray-400">ขนาดไฟล์ไม่เกิน 5 MB</span></p>
            <input ref={headerRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleHeaderUpload} />
            <button onClick={() => headerRef.current?.click()} disabled={headerUploading}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 active:scale-95 transition-all whitespace-nowrap"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              {headerUploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              {headerUploading ? 'กำลังอัปโหลด...' : 'อัปโหลดภาพพื้นหลัง'}
            </button>
            {headerPreview && (
              <button onClick={removeHeaderImage}
                className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-600 transition-colors">
                ลบภาพออก
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── ภาพพื้นหลัง SMART CITY ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
          <MapPinned size={15} /> ภาพพื้นหลัง SMART CITY
        </h2>
        <p className="text-xs text-gray-400 mb-5 leading-relaxed">
          แสดงเป็นพื้นหลังแบนเนอร์ "SMART CITY" ในหน้าแรก (thungkaew-Theme) · ไม่อัปโหลดจะใช้ภาพผังเมืองที่ระบบวาดเองแทน · แนะนำรูปแนวนอน 1200×800px ขึ้นไป
        </p>
        <div className="flex items-start gap-5">
          <div className="shrink-0">
            <div className="w-40 h-28 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden">
              {smartCityPreview
                ? <img src={smartCityPreview} alt="SMART CITY" className="w-full h-full object-cover" />
                : <div className="flex flex-col items-center gap-1 text-gray-300">
                    <MapPinned size={24} />
                    <span className="text-[10px]">ใช้ภาพวาดเอง</span>
                  </div>
              }
            </div>
            {savedSection === 'smartcity' && (
              <p className="flex items-center gap-1 text-xs text-emerald-600 mt-2 justify-center">
                <CheckCircle2 size={12} /> บันทึกสำเร็จ
              </p>
            )}
          </div>
          <div className="flex-1 space-y-2">
            <p className="text-xs text-gray-500 leading-relaxed">รองรับ JPG · PNG · WebP<br /><span className="text-gray-400">ขนาดไฟล์ไม่เกิน 5 MB</span></p>
            <input ref={smartCityRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleSmartCityUpload} />
            <button onClick={() => smartCityRef.current?.click()} disabled={smartCityUploading}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 active:scale-95 transition-all whitespace-nowrap"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              {smartCityUploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              {smartCityUploading ? 'กำลังอัปโหลด...' : 'อัปโหลดภาพพื้นหลัง'}
            </button>
            {smartCityPreview && (
              <button onClick={removeSmartCityImage}
                className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-600 transition-colors">
                ลบภาพออก (กลับไปใช้ภาพวาดเอง)
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── ภาพพื้นหลังส่วนท่องเที่ยว ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
          <ImageIcon size={15} /> ภาพพื้นหลังส่วนเที่ยว กิน พัก ชอป บริการ
        </h2>
        <p className="text-xs text-gray-400 mb-5 leading-relaxed">
          แสดงเป็นภาพพื้นหลังขนาดใหญ่ด้านหลังการ์ดแนะนำสถานที่ในหน้าแรก · แนะนำรูปแนวนอนที่มีพื้นที่ว่างสำหรับข้อความ
        </p>
        <div className="flex flex-col sm:flex-row items-start gap-5">
          <div className="shrink-0">
            <div className="relative w-48 h-32 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 overflow-hidden">
              <img
                src={tourismBgPreview || '/tourism-bg.jpg'}
                alt="ภาพพื้นหลังส่วนท่องเที่ยว"
                className="w-full h-full object-cover"
              />
              {!tourismBgPreview && (
                <span className="absolute left-2 bottom-2 px-2 py-1 rounded-lg bg-black/60 text-[10px] font-bold text-white">
                  ภาพเริ่มต้นของระบบ
                </span>
              )}
            </div>
            {savedSection === 'tourismBg' && (
              <p className="flex items-center gap-1 text-xs text-emerald-600 mt-2 justify-center">
                <CheckCircle2 size={12} /> บันทึกสำเร็จ
              </p>
            )}
          </div>
          <div className="flex-1 space-y-2">
            <p className="text-xs text-gray-500 leading-relaxed">รองรับ JPG · PNG · WebP<br /><span className="text-gray-400">ขนาดไฟล์ไม่เกิน 5 MB</span></p>
            <input ref={tourismBgRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleTourismBgUpload} />
            <button onClick={() => tourismBgRef.current?.click()} disabled={tourismBgUploading}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 active:scale-95 transition-all whitespace-nowrap"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              {tourismBgUploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              {tourismBgUploading ? 'กำลังอัปโหลด...' : 'อัปโหลดพื้นหลังท่องเที่ยว'}
            </button>
            {tourismBgPreview && (
              <button onClick={removeTourismBgImage}
                className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-600 transition-colors">
                ลบภาพออก (กลับไปใช้ภาพเริ่มต้น)
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Banner Slider ── */}
      <BannerManager tenant={tenant} />
    </div>
  )
}

function QrCodeTab({
  tenant, savedSection,
  logoPreview, logoUploading, logoRef, handleLogoUpload,
  qrPreview, qrUploading, qrRef, handleQrUpload, qrLabel, setQrLabel, qrLabelSaving, saveQrLabel, inputCls,
}) {
  return (
    <div className="space-y-6">
      {/* ── โลโก้หน่วยงาน ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
          <Building2 size={15} /> โลโก้หน่วยงาน
        </h2>
        <p className="text-xs text-gray-400 mb-5 leading-relaxed">
          แสดงในแอปและ link preview เมื่อแชร์ลิ้งก์ใน LINE / WhatsApp · แนะนำ PNG สี่เหลี่ยม ขนาด 512×512px
        </p>
        <div className="flex items-center gap-5">
          <div className="shrink-0">
            <div className="w-24 h-24 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden">
              {logoPreview
                ? <img src={logoPreview} alt="โลโก้" className="w-full h-full object-contain p-1" />
                : <div className="flex flex-col items-center gap-1 text-gray-300">
                    <ImageIcon size={24} />
                    <span className="text-[10px]">ยังไม่มีโลโก้</span>
                  </div>
              }
            </div>
            {savedSection === 'logo' && (
              <p className="flex items-center gap-1 text-xs text-emerald-600 mt-2 justify-center">
                <CheckCircle2 size={12} /> บันทึกสำเร็จ
              </p>
            )}
          </div>
          <div className="flex-1">
            <p className="text-xs text-gray-500 mb-3 leading-relaxed">
              โลโก้จะปรากฏใน link preview และ PWA icon<br />
              <span className="text-gray-400">รองรับ PNG · JPG · WebP</span>
            </p>
            <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleLogoUpload} />
            <button onClick={() => logoRef.current?.click()} disabled={logoUploading}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 active:scale-95 transition-all"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              {logoUploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              {logoUploading ? 'กำลังอัปโหลด...' : 'อัปโหลดโลโก้'}
            </button>
          </div>
        </div>
      </div>

      {/* ── QR Code ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
          <QrCode size={15} /> QR Code ของหน่วยงาน
        </h2>
        <p className="text-xs text-gray-400 mb-5 leading-relaxed">
          แสดงในหน้า "เมนูอื่นๆ" ให้ประชาชนสแกนเพื่อเข้าระบบ · แนะนำ PNG ขนาด 400×400px ขึ้นไป
        </p>

        <div className="flex items-start gap-5">
          {/* Preview */}
          <div className="shrink-0">
            <div className="w-32 h-32 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden">
              {qrPreview ? (
                <img src={qrPreview} alt="QR Code" className="w-full h-full object-contain p-1" />
              ) : (
                <div className="flex flex-col items-center gap-1 text-gray-300">
                  <ImageIcon size={28} />
                  <span className="text-[10px]">ยังไม่มี QR</span>
                </div>
              )}
            </div>
            {savedSection === 'qr' && (
              <p className="flex items-center gap-1 text-xs text-emerald-600 mt-2 justify-center">
                <CheckCircle2 size={12} /> บันทึกสำเร็จ
              </p>
            )}
          </div>

          {/* Upload */}
          <div className="flex-1">
            <p className="text-xs text-gray-500 mb-3 leading-relaxed">
              อัปโหลดภาพ QR Code สำหรับ URL ของระบบนี้<br />
              <span className="text-gray-400">{window.location.origin}</span>
            </p>
            <input
              ref={qrRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleQrUpload}
            />
            <button
              onClick={() => qrRef.current?.click()}
              disabled={qrUploading}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 active:scale-95 transition-all"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              {qrUploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              {qrUploading ? 'กำลังอัปโหลด...' : 'อัปโหลด QR Code'}
            </button>
          </div>
        </div>

        {/* QR Label */}
        <form onSubmit={saveQrLabel} className="mt-5 pt-5 border-t border-gray-100">
          <label className="block text-xs font-semibold text-gray-500 mb-1">ชื่อที่แสดงใต้ QR Code</label>
          <p className="text-xs text-gray-400 mb-2">แสดงใต้ภาพ QR ในหน้า "เมนูอื่นๆ" เช่น "สแกนเพื่อเข้าใช้บริการ อบต.น้ำเลา"</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={qrLabel}
              onChange={e => setQrLabel(e.target.value)}
              placeholder={`เช่น สแกนเพื่อเข้าใช้บริการ ${tenant?.name || ''}`}
              className={inputCls + ' flex-1'}
              maxLength={80}
            />
            <button type="submit" disabled={qrLabelSaving}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 active:scale-95 transition-all shrink-0"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              {qrLabelSaving ? <Loader2 size={14} className="animate-spin" /> : savedSection === 'qrLabel' ? <CheckCircle2 size={14} /> : <Save size={14} />}
              {savedSection === 'qrLabel' ? 'บันทึกแล้ว' : 'บันทึก'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}


function BannerManager({ tenant }) {
  const [banners, setBanners] = useState([])
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [dragOver, setDragOver] = useState(null)
  const fileRef = useRef()
  // iState: { type:'reorder', srcIdx, lastTarget } | { type:'pan', id, startX, startY, objX, objY, livePos }
  const iState = useRef(null)

  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('banners').select('id, image_url, sort_order, object_position')
      .eq('municipality_id', tenant.id).eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => setBanners((data ?? []).map(b => ({ ...b, image_url: toReliableImageUrl(b.image_url) }))))
      .catch(() => {})
  }, [tenant?.id])

  async function handleUpload(e) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setUploading(true)
    try {
      for (const file of files) {
        const ext  = file.name.split('.').pop() || 'jpg'
        const { url, error: upErr } = await uploadFile('municipality-assets', file, {
          subject: `banners/${tenant.slug}`,
          filename: `${crypto.randomUUID()}.${ext}`,
          municipality: tenant?.slug,
        })
        if (upErr) throw upErr
        const { data: row, error: dbErr } = await supabase.from('banners')
          .insert({ municipality_id: tenant.id, image_url: url, sort_order: banners.length + 1, object_position: 'center' })
          .select('id, image_url, sort_order, object_position').single()
        if (dbErr) throw dbErr
        setBanners(prev => [...prev, row])
      }
    } catch (err) {
      alert('อัปโหลดไม่สำเร็จ: ' + err.message)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  async function handleDelete(id) {
    setDeleting(id)
    await supabase.from('banners').update({ is_active: false }).eq('id', id)
    setBanners(prev => prev.filter(b => b.id !== id))
    setDeleting(null)
  }

  async function reorder(srcIdx, targetIdx) {
    setDragOver(null)
    if (srcIdx == null || targetIdx == null || srcIdx === targetIdx) return
    const next = [...banners]
    const [moved] = next.splice(srcIdx, 1)
    next.splice(targetIdx, 0, moved)
    const reordered = next.map((b, i) => ({ ...b, sort_order: i + 1 }))
    setBanners(reordered)
    await Promise.all(reordered.map(b =>
      supabase.from('banners').update({ sort_order: b.sort_order }).eq('id', b.id)
    ))
  }

  // ── Grip pointer events (เรียงลำดับ) ──
  function onGripDown(e, idx) {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    iState.current = { type: 'reorder', srcIdx: idx, lastTarget: idx }
  }
  function onGripMove(e) {
    if (!iState.current || iState.current.type !== 'reorder') return
    const el = document.elementFromPoint(e.clientX, e.clientY)
    const card = el?.closest('[data-drag-idx]')
    if (card) {
      const t = parseInt(card.dataset.dragIdx)
      iState.current.lastTarget = t
      setDragOver(t !== iState.current.srcIdx ? t : null)
    }
  }
  async function onGripUp() {
    if (!iState.current || iState.current.type !== 'reorder') return
    const { srcIdx, lastTarget } = iState.current
    iState.current = null
    await reorder(srcIdx, lastTarget)
  }

  // ── Image pointer events (ปรับตำแหน่ง) ──
  function parsePosToXY(pos = 'center') {
    const kw = { left: 0, center: 50, right: 100, top: 0, bottom: 100 }
    const parts = pos.trim().split(/\s+/)
    const x = kw[parts[0]] ?? parseFloat(parts[0])
    const y = parts[1] !== undefined ? (kw[parts[1]] ?? parseFloat(parts[1])) : 50
    return [isNaN(x) ? 50 : x, isNaN(y) ? 50 : y]
  }
  function onImageDown(e, b) {
    if (e.target.closest('[data-is-grip]')) return
    if (e.target.closest('button')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const [objX, objY] = parsePosToXY(b.object_position)
    iState.current = { type: 'pan', id: b.id, startX: e.clientX, startY: e.clientY, objX, objY, livePos: null }
  }
  function onImageMove(e, bid) {
    if (!iState.current || iState.current.type !== 'pan' || iState.current.id !== bid) return
    const { startX, startY, objX, objY } = iState.current
    const rect = e.currentTarget.getBoundingClientRect()
    const newX = Math.max(0, Math.min(100, objX - (e.clientX - startX) * 100 / Math.max(rect.width, 1)))
    const newY = Math.max(0, Math.min(100, objY - (e.clientY - startY) * 100 / Math.max(rect.height, 1)))
    const pos = `${Math.round(newX)}% ${Math.round(newY)}%`
    iState.current.livePos = pos
    setBanners(prev => prev.map(b => b.id === bid ? { ...b, object_position: pos } : b))
  }
  async function onImageUp(e, bid) {
    if (!iState.current || iState.current.type !== 'pan' || iState.current.id !== bid) return
    const pos = iState.current.livePos
    iState.current = null
    if (pos) await supabase.from('banners').update({ object_position: pos }).eq('id', bid)
  }

  const cancelAll = () => { iState.current = null; setDragOver(null) }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h2 className="text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
        <ImageIcon size={15} /> สไลด์ Banner หน้าแรก
      </h2>
      <p className="text-xs text-gray-400 mb-2 leading-relaxed">
        ลาก ⠿ เพื่อเรียงลำดับ · ลากบนรูปเพื่อปรับตำแหน่ง
      </p>
      <div className="flex items-start gap-2 mb-5 px-3 py-2.5 rounded-xl bg-blue-50 border border-blue-100">
        <span className="text-blue-400 text-base leading-none mt-0.5">📐</span>
        <div className="text-xs text-blue-600 leading-relaxed space-y-0.5">
          <p>แนะนำอัปโหลด <strong>1280 × 640 px</strong> (สัดส่วน 2:1) · JPG หรือ PNG</p>
          <p className="text-blue-400">มือถือแสดงเต็มหน้าจอ 16:9 · เดสก์ท็อปแสดง 2 ภาพคู่กัน ~544 × 224 px</p>
        </div>
      </div>

      {banners.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-5">
          {banners.map((b, i) => (
            <div key={b.id} data-drag-idx={i}
              className="flex flex-col gap-2 transition-opacity"
              style={{ opacity: dragOver === i ? 0.4 : 1 }}>
              <div className="relative rounded-xl overflow-hidden border bg-gray-50"
                style={{ aspectRatio: '5/2', borderColor: dragOver === i ? 'var(--color-primary)' : '#f3f4f6', borderWidth: dragOver === i ? 2 : 1, cursor: 'move', touchAction: 'none' }}
                onPointerDown={e => onImageDown(e, b)}
                onPointerMove={e => onImageMove(e, b.id)}
                onPointerUp={e => onImageUp(e, b.id)}
                onPointerCancel={cancelAll}>
                <img src={b.image_url} alt=""
                  className="w-full h-full object-cover pointer-events-none select-none"
                  style={{ objectPosition: b.object_position || 'center' }} />
                {/* grip handle — เรียงลำดับ */}
                <div data-is-grip
                  className="absolute top-1.5 left-1.5 w-8 h-8 bg-black/60 rounded-full flex items-center justify-center cursor-grab z-10"
                  style={{ touchAction: 'none' }}
                  onPointerDown={e => onGripDown(e, i)}
                  onPointerMove={onGripMove}
                  onPointerUp={onGripUp}
                  onPointerCancel={cancelAll}>
                  <span className="text-white text-[13px] leading-none select-none">⠿</span>
                </div>
                <button onClick={() => handleDelete(b.id)} disabled={deleting === b.id}
                  className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/60 hover:bg-red-600 rounded-full flex items-center justify-center transition-colors z-10">
                  {deleting === b.id
                    ? <Loader2 size={11} className="animate-spin text-white" />
                    : <span className="text-white text-[10px] font-bold leading-none">✕</span>}
                </button>
                <span className="absolute bottom-1 left-1.5 text-[9px] text-white/70 font-bold select-none">#{i + 1}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleUpload} />
      <button onClick={() => fileRef.current?.click()} disabled={uploading}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 active:scale-95 transition-all"
        style={{ backgroundColor: 'var(--color-primary)' }}>
        {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
        {uploading ? 'กำลังอัปโหลด...' : 'เพิ่มรูป Banner'}
      </button>
    </div>
  )
}
