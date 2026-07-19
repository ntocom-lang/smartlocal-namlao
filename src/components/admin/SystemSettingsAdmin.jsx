import { useState, useEffect, useRef } from 'react'
import { Settings, Save, Loader2, CheckCircle2, QrCode, Upload, Image as ImageIcon, Building2, Wallpaper } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import DepartmentManager from './DepartmentManager'

const inputCls = 'w-full px-4 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent transition-all'

export default function SystemSettingsAdmin() {
  const { tenant, patchTenant } = useTenant()
  const [pwaShortName, setPwaShortName] = useState(() => tenant?.pwa_short_name || '')
  const [subtitle, setSubtitle] = useState(() => tenant?.system_subtitle || '')
  const [address, setAddress] = useState(() => tenant?.address || '')
  const [phone, setPhone] = useState(() => tenant?.phone || '')
  const [websiteUrl, setWebsiteUrl] = useState(() => tenant?.website_url || '')
  const [email, setEmail] = useState(() => tenant?.email || '')
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
  const logoRef = useRef()
  const qrRef = useRef()
  const headerRef = useRef()

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
      const newWebsiteUrl = websiteUrl.trim() || null
      const newEmail = email.trim() || null

      if (!tenant?.id) throw new Error('ไม่พบ tenant.id — กรุณา refresh หน้า')
      
      const payload = {
        address: newAddress,
        phone: newPhone,
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
        website_url: newWebsiteUrl,
        email: newEmail
      })
      
      setSavedSection('contact')
      setTimeout(() => setSavedSection(null), 2500)
    } catch (err) {
      alert('บันทึกไม่สำเร็จ: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  function resizeImage(file, maxPx = 600) {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width  = Math.round(img.width  * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(resolve, 'image/png', 0.92)
      }
      img.src = URL.createObjectURL(file)
    })
  }

  async function handleLogoUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoPreview(URL.createObjectURL(file))
    setLogoUploading(true)
    try {
      const blob = await resizeImage(file, 512)
      const path = `logos/logo-${tenant.slug}.png`
      const { error: upErr } = await supabase.storage
        .from('municipality-assets')
        .upload(path, blob, { upsert: true, contentType: 'image/png' })
      if (upErr) throw upErr
      const { data: { publicUrl } } = supabase.storage.from('municipality-assets').getPublicUrl(path)
      const bustedUrl = `${publicUrl}?v=${Date.now()}`
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
      const path = `qr/${tenant.slug}.png`
      const { error: upErr } = await supabase.storage
        .from('municipality-assets')
        .upload(path, blob, { upsert: true, contentType: 'image/png' })
      if (upErr) throw upErr
      const { data: { publicUrl } } = supabase.storage.from('municipality-assets').getPublicUrl(path)
      const bustedUrl = `${publicUrl}?v=${Date.now()}`
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
      const path = `headers/header-${tenant.slug}.jpg`
      const { error: upErr } = await supabase.storage
        .from('municipality-assets')
        .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
      if (upErr) throw upErr
      const { data: { publicUrl: url } } = supabase.storage.from('municipality-assets').getPublicUrl(path)
      // เพิ่ม timestamp ป้องกัน browser cache รูปเก่า
      publicUrl = `${url}?v=${Date.now()}`
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
    address, setAddress, phone, setPhone, websiteUrl, setWebsiteUrl, email, setEmail, saveContactInfo,
    logoPreview, logoUploading, logoRef, handleLogoUpload,
    headerPreview, headerUploading, headerRef, handleHeaderUpload, removeHeaderImage,
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
  { key: 'general',     label: 'ข้อมูลทั่วไป',       icon: Settings,  Component: GeneralInfoTab },
  { key: 'branding',    label: 'แบรนด์และรูปภาพ',    icon: Wallpaper, Component: BrandingTab },
  { key: 'qr',          label: 'โลโก้/QR Code',      icon: QrCode,    Component: QrCodeTab },
  { key: 'departments', label: 'กอง/หน่วยงาน',      icon: Building2, Component: DepartmentsTab },
]

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
  address, setAddress, phone, setPhone, websiteUrl, setWebsiteUrl, email, setEmail, saveContactInfo,
}) {
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
              <label className="block text-xs font-semibold text-gray-500 mb-1">เบอร์โทรศัพท์ / แฟกซ์</label>
              <input
                type="text"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="เช่น 054-546-092"
                className={inputCls}
              />
            </div>
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
    </div>
  )
}

function BrandingTab({
  tenant, savedSection,
  headerPreview, headerUploading, headerRef, handleHeaderUpload, removeHeaderImage,
}) {
  return (
    <div className="space-y-6">
      {/* ── ภาพพื้นหลัง Header ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
          <Wallpaper size={15} /> ภาพพื้นหลัง Header
        </h2>
        <p className="text-xs text-gray-400 mb-5 leading-relaxed">
          แสดงเป็นพื้นหลังแถบ header บนสุดของแอป · แนะนำรูปแนวนอน 1600×400px ขึ้นไป · ระบบจะเพิ่ม gradient overlay อัตโนมัติให้อ่านข้อความได้
        </p>
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
      .then(({ data }) => setBanners(data ?? []))
      .catch(() => {})
  }, [tenant?.id])

  async function handleUpload(e) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setUploading(true)
    try {
      for (const file of files) {
        const ext  = file.name.split('.').pop() || 'jpg'
        const path = `banners/${tenant.slug}/${crypto.randomUUID()}.${ext}`
        const { error: upErr } = await supabase.storage
          .from('municipality-assets')
          .upload(path, file, { upsert: false, contentType: file.type || 'image/jpeg' })
        if (upErr) throw upErr
        const { data: { publicUrl } } = supabase.storage.from('municipality-assets').getPublicUrl(path)
        const { data: row, error: dbErr } = await supabase.from('banners')
          .insert({ municipality_id: tenant.id, image_url: publicUrl, sort_order: banners.length + 1, object_position: 'center' })
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
