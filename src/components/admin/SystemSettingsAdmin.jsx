import { useState, useRef } from 'react'
import { Settings, Save, Loader2, CheckCircle2, QrCode, Upload, Image as ImageIcon } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'

const inputCls = 'w-full px-4 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent transition-all'

export default function SystemSettingsAdmin() {
  const { tenant, patchTenant } = useTenant()
  const [pwaShortName, setPwaShortName] = useState(() => tenant?.pwa_short_name || '')
  const [loading, setLoading] = useState(false)
  const [savedSection, setSavedSection] = useState(null)
  const [qrUploading, setQrUploading] = useState(false)
  const [qrPreview, setQrPreview] = useState(() => tenant?.qr_code_url || null)
  const [qrLabel, setQrLabel] = useState(() => tenant?.qr_label || '')
  const [qrLabelSaving, setQrLabelSaving] = useState(false)
  const qrRef = useRef()

  async function saveSystemName(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const newPwaShortName = pwaShortName.trim() || null
      if (!tenant?.id) throw new Error('ไม่พบ tenant.id — กรุณา refresh หน้า')
      const { error } = await supabase.rpc('update_municipality_settings', {
        p_municipality_id: tenant.id,
        p_system_name:     tenant.system_name || tenant.name,
        p_system_subtitle: null,
        p_pwa_short_name:  newPwaShortName,
      })
      if (error) throw error
      patchTenant({ pwa_short_name: newPwaShortName })
      setSavedSection('name')
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
      const { error: dbErr } = await supabase
        .from('municipalities')
        .update({ qr_code_url: publicUrl })
        .eq('id', tenant.id)
      if (dbErr) throw dbErr
      setQrPreview(publicUrl)
      patchTenant({ qr_code_url: publicUrl })
      setSavedSection('qr')
      setTimeout(() => setSavedSection(null), 2500)
    } catch (err) {
      setQrPreview(tenant?.qr_code_url || null)
      alert('อัปโหลด QR ไม่สำเร็จ: ' + err.message)
    } finally {
      setQrUploading(false)
    }
  }

  async function saveQrLabel(e) {
    e.preventDefault()
    setQrLabelSaving(true)
    try {
      const { error } = await supabase
        .from('municipalities')
        .update({ qr_label: qrLabel.trim() || null })
        .eq('id', tenant.id)
      if (error) throw error
      patchTenant({ qr_label: qrLabel.trim() || null })
      setSavedSection('qrLabel')
      setTimeout(() => setSavedSection(null), 2500)
    } catch (err) {
      alert('บันทึกไม่สำเร็จ: ' + err.message)
    } finally {
      setQrLabelSaving(false)
    }
  }

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

      {/* ── ชื่อแอปบนมือถือ ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
          <Settings size={15} /> ชื่อแอปบนมือถือ
        </h2>
        <form onSubmit={saveSystemName} className="space-y-4">
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
          <button type="submit" disabled={loading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 active:scale-95 transition-all"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            {loading ? <Loader2 size={15} className="animate-spin" /> : savedSection === 'name' ? <CheckCircle2 size={15} /> : <Save size={15} />}
            {savedSection === 'name' ? 'บันทึกสำเร็จ' : 'บันทึก'}
          </button>
        </form>
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
