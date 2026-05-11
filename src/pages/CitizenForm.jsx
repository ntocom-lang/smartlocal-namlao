import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MapPin, Phone, FileText, ChevronDown,
  Loader2, CheckCircle2, AlertCircle, ArrowLeft, Send,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'

const CATEGORIES = [
  { value: 'road',       label: '🛣️  ถนน / ทางสาธารณะ' },
  { value: 'light',      label: '💡  ไฟฟ้าส่องสว่าง' },
  { value: 'trash',      label: '🗑️  ขยะ / ความสะอาด' },
  { value: 'water',      label: '💧  น้ำประปา' },
  { value: 'flood',      label: '🌊  น้ำท่วม / ระบายน้ำ' },
  { value: 'tree',       label: '🌳  ต้นไม้ / สวนสาธารณะ' },
  { value: 'noise',      label: '📢  เหตุรำคาญ / เสียงดัง' },
  { value: 'other',      label: '📝  อื่นๆ' },
]

const GEO_STATUS = { idle: 'idle', loading: 'loading', ok: 'ok', error: 'error' }

function SuccessScreen({ onBack }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-6 text-center">
      <div className="w-20 h-20 rounded-full bg-green-50 flex items-center justify-center mb-5 animate-bounce-once">
        <CheckCircle2 size={44} className="text-green-500" />
      </div>
      <h2 className="text-xl font-bold text-gray-800 mb-2">ส่งเรื่องสำเร็จ!</h2>
      <p className="text-gray-500 text-sm leading-relaxed mb-8 max-w-xs">
        เจ้าหน้าที่จะดำเนินการตรวจสอบและติดต่อกลับหาท่านโดยเร็วที่สุด
      </p>
      <button onClick={onBack}
        className="w-full max-w-xs py-3.5 rounded-2xl font-semibold text-white shadow-lg active:scale-95 transition-transform"
        style={{ backgroundColor: 'var(--color-primary)' }}>
        กลับหน้าหลัก
      </button>
    </div>
  )
}

export default function CitizenForm() {
  const { tenant } = useTenant()
  const navigate = useNavigate()

  const [form, setForm] = useState({ category: '', detail: '', phone: '' })
  const [geo, setGeo] = useState({ lat: null, lng: null })
  const [geoStatus, setGeoStatus] = useState(GEO_STATUS.idle)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))

  const getLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoStatus(GEO_STATUS.error)
      return
    }
    setGeoStatus(GEO_STATUS.loading)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setGeo({ lat: coords.latitude, lng: coords.longitude })
        setGeoStatus(GEO_STATUS.ok)
      },
      () => setGeoStatus(GEO_STATUS.error),
      { timeout: 10000 }
    )
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.category) { setError('กรุณาเลือกหมวดหมู่ปัญหา'); return }
    if (form.detail.trim().length < 10) { setError('กรุณาอธิบายรายละเอียดอย่างน้อย 10 ตัวอักษร'); return }
    if (!tenant?.id) { setError('ไม่พบข้อมูลหน่วยงาน'); return }

    setError(null)
    setSubmitting(true)

    const { error: dbError } = await supabase.from('complaints').insert({
      municipality_id: tenant.id,
      category:        form.category,
      detail:          form.detail.trim(),
      phone:           form.phone.trim() || null,
      latitude:        geo.lat,
      longitude:       geo.lng,
    })

    setSubmitting(false)
    if (dbError) { setError(`เกิดข้อผิดพลาด: ${dbError.message}`); return }
    setSuccess(true)
  }

  if (success) return <SuccessScreen onBack={() => navigate('/')} />

  const geoLabel = {
    [GEO_STATUS.idle]:    'ระบุตำแหน่งอัตโนมัติ',
    [GEO_STATUS.loading]: 'กำลังค้นหาตำแหน่ง...',
    [GEO_STATUS.ok]:      `${geo.lat?.toFixed(5)}, ${geo.lng?.toFixed(5)}`,
    [GEO_STATUS.error]:   'ไม่สามารถระบุตำแหน่งได้',
  }[geoStatus]

  return (
    <div className="max-w-lg mx-auto min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-100 shadow-sm">
        <button onClick={() => navigate(-1)} className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors">
          <ArrowLeft size={20} className="text-gray-600" />
        </button>
        <div>
          <h1 className="font-bold text-gray-800 text-base leading-tight">แจ้งเรื่องร้องเรียน</h1>
          <p className="text-xs text-gray-400">{tenant?.name}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="px-4 pt-5 pb-32 space-y-4">
        {/* Category */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 pt-4 pb-1 flex items-center gap-2">
            <FileText size={16} style={{ color: 'var(--color-primary)' }} />
            <span className="text-sm font-semibold text-gray-700">หมวดหมู่ปัญหา</span>
            <span className="text-red-400 text-xs">*จำเป็น</span>
          </div>
          <div className="relative px-4 pb-4">
            <select value={form.category} onChange={set('category')} required
              className="w-full appearance-none bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 pr-10 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:border-transparent"
              style={{ '--tw-ring-color': 'var(--color-primary)' }}>
              <option value="">— เลือกประเภทปัญหา —</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <ChevronDown size={16} className="absolute right-7 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {/* Detail */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-3">
            <FileText size={16} style={{ color: 'var(--color-primary)' }} />
            <span className="text-sm font-semibold text-gray-700">รายละเอียดปัญหา</span>
            <span className="text-red-400 text-xs">*จำเป็น</span>
          </div>
          <textarea value={form.detail} onChange={set('detail')} rows={4} required
            placeholder="อธิบายปัญหาที่พบ เช่น สถานที่ ความเร่งด่วน ความเสียหาย..."
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:border-transparent"
            style={{ '--tw-ring-color': 'var(--color-primary)' }} />
          <p className="text-right text-xs text-gray-400 mt-1">{form.detail.length} ตัวอักษร</p>
        </div>

        {/* Phone */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Phone size={16} style={{ color: 'var(--color-primary)' }} />
            <span className="text-sm font-semibold text-gray-700">เบอร์โทรติดต่อ</span>
            <span className="text-gray-400 text-xs">(ไม่บังคับ)</span>
          </div>
          <input type="tel" value={form.phone} onChange={set('phone')}
            placeholder="08X-XXX-XXXX"
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent"
            style={{ '--tw-ring-color': 'var(--color-primary)' }} />
        </div>

        {/* Geolocation */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-3">
            <MapPin size={16} style={{ color: 'var(--color-primary)' }} />
            <span className="text-sm font-semibold text-gray-700">ตำแหน่งที่เกิดเหตุ</span>
            <span className="text-gray-400 text-xs">(ไม่บังคับ)</span>
          </div>
          <button type="button" onClick={getLocation}
            disabled={geoStatus === GEO_STATUS.loading}
            className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium border transition-all ${
              geoStatus === GEO_STATUS.ok
                ? 'bg-green-50 border-green-200 text-green-700'
                : geoStatus === GEO_STATUS.error
                ? 'bg-red-50 border-red-200 text-red-600'
                : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-(--color-primary) hover:text-(--color-primary)'
            }`}>
            {geoStatus === GEO_STATUS.loading
              ? <Loader2 size={16} className="animate-spin" />
              : geoStatus === GEO_STATUS.ok
              ? <CheckCircle2 size={16} />
              : geoStatus === GEO_STATUS.error
              ? <AlertCircle size={16} />
              : <MapPin size={16} />}
            <span className="truncate">{geoLabel}</span>
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-sm text-red-700">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            {error}
          </div>
        )}
      </form>

      {/* Fixed submit button */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-100 shadow-lg max-w-lg mx-auto">
        <button onClick={handleSubmit} disabled={submitting}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-bold text-white shadow-lg active:scale-95 transition-all disabled:opacity-60"
          style={{ backgroundColor: 'var(--color-primary)' }}>
          {submitting
            ? <><Loader2 size={20} className="animate-spin" /> กำลังส่ง...</>
            : <><Send size={20} /> ส่งเรื่องร้องเรียน</>}
        </button>
      </div>
    </div>
  )
}
