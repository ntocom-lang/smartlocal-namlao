import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, MapPin, Phone, Store, Image, AlignLeft, CheckCircle2, Loader2, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import MapPicker from '../components/MapPicker'

const BUSINESS_TYPES = [
  { value: 'shop',    label: '🛍️  ร้านค้าทั่วไป / ร้านสะดวกซื้อ' },
  { value: 'food',    label: '🍽️  ร้านอาหาร / ของกิน' },
  { value: 'stay',    label: '🏨  ที่พัก / โฮมสเตย์' },
  { value: 'otop',   label: '🏺  OTOP / สินค้าชุมชน' },
  { value: 'tourism', label: '📍  สถานที่ท่องเที่ยว' },
  { value: 'service', label: '🔧  บริการ / ช่าง' },
  { value: 'other',   label: '📝  อื่นๆ' },
]

async function compressImage(file) {
  return new Promise((resolve) => {
    const img = new window.Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      const ratio = Math.min(1920 / width, 1920 / height, 1)
      width = Math.round(width * ratio)
      height = Math.round(height * ratio)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        (blob) => {
          const name = file.name.replace(/\.[^.]+$/, '.jpg')
          resolve(new File([blob], name, { type: 'image/jpeg' }))
        },
        'image/jpeg', 0.82
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}

function SuccessScreen({ onBack }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[65vh] px-6 text-center">
      <div className="w-20 h-20 rounded-full bg-amber-50 flex items-center justify-center mb-5">
        <CheckCircle2 size={44} className="text-amber-500" />
      </div>
      <h2 className="text-xl font-bold text-gray-800 mb-2">ส่งข้อมูลสำเร็จ!</h2>
      <p className="text-gray-500 text-sm leading-relaxed mb-2 max-w-xs">
        เจ้าหน้าที่จะตรวจสอบและอนุมัติข้อมูลของคุณ
        เมื่ออนุมัติแล้วจะแสดงบนหน้าตลาดออนไลน์น้ำเลาโดยอัตโนมัติ
      </p>
      <p className="text-xs text-gray-400 mb-8">โดยปกติใช้เวลาไม่เกิน 3 วันทำการ</p>
      <button onClick={onBack}
        className="w-full max-w-xs py-3.5 rounded-2xl font-semibold text-white shadow-lg active:scale-95 transition-transform"
        style={{ backgroundColor: '#f59e0b' }}>
        กลับหน้าหลัก
      </button>
    </div>
  )
}

export default function BusinessRegisterPage() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const [form, setForm] = useState({
    business_name: '',
    business_type: 'shop',
    description: '',
    operating_hours: '',
    phone: '',
    line_id: '',
    facebook_url: '',
    address: '',
    service_type: 'offline',
    online_service: 'order',
    online_url: '',
    has_delivery: false,
  })
  const [geo, setGeo] = useState({ lat: null, lng: null })
  const [showMap, setShowMap] = useState(false)
  const [images, setImages] = useState([])  // { file, preview }
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    return () => images.forEach((img) => URL.revokeObjectURL(img.preview))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (field) => (e) => setForm((p) => ({ ...p, [field]: e.target.value }))

  async function handleImages(e) {
    const files = Array.from(e.target.files ?? [])
    const items = await Promise.all(
      files.map(async (f) => {
        const compressed = f.size > 2_000_000 ? await compressImage(f) : f
        return { file: compressed, preview: URL.createObjectURL(compressed) }
      })
    )
    setImages((prev) => [...prev, ...items].slice(0, 5))
    e.target.value = ''
  }

  async function uploadImages(id) {
    const urls = []
    for (const item of images) {
      const ext = item.file.name.split('.').pop()
      const path = `business/${id}/${Date.now()}.${ext}`
      const { error } = await supabase.storage
        .from('complaint-attachments')
        .upload(path, item.file, { upsert: false })
      if (!error) {
        const { data } = supabase.storage.from('complaint-attachments').getPublicUrl(path)
        urls.push(data.publicUrl)
      }
    }
    return urls
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.business_name.trim()) { setError('กรุณากรอกชื่อร้าน/สถานที่'); return }
    if (!geo.lat) { setError('กรุณาปักหมุด GPS ตำแหน่งร้านก่อนส่ง — ข้อมูลนี้จะใช้แสดงบนแผนที่'); return }
    if (!tenant?.id) { setError('ไม่พบข้อมูลหน่วยงาน'); return }

    setError(null)
    setSubmitting(true)

    const { data: { session } } = await supabase.auth.getSession()
    const id = crypto.randomUUID()
    const imageUrls = images.length > 0 ? await uploadImages(id) : []

    const { error: dbError } = await supabase.from('business_registrations').insert({
      id,
      municipality_id: tenant.id,
      user_id:         session?.user?.id ?? null,
      business_name:   form.business_name.trim(),
      business_type:   form.business_type,
      description:     form.description.trim() || null,
      operating_hours: form.operating_hours.trim() || null,
      phone:           form.phone.trim() || null,
      line_id:         form.line_id.trim() || null,
      facebook_url:    form.facebook_url.trim() || null,
      address:         form.address.trim() || null,
      latitude:        geo.lat,
      longitude:       geo.lng,
      images:          imageUrls,
      status:          'pending',
      service_type:    form.service_type,
      online_service:  form.service_type === 'online' ? form.online_service : null,
      online_url:      form.service_type === 'online' ? (form.online_url.trim() || null) : null,
      has_delivery:    form.service_type === 'online' ? form.has_delivery : false,
    })

    setSubmitting(false)
    if (dbError) { setError(`เกิดข้อผิดพลาด: ${dbError.message}`); return }
    setSuccess(true)
  }

  if (success) return (
    <div className="max-w-3xl mx-auto px-4">
      <SuccessScreen onBack={() => navigate('/')} />
    </div>
  )

  return (
    <div className="max-w-3xl mx-auto min-h-screen bg-gray-50">
      {showMap && (
        <MapPicker
          initialPos={geo.lat ? { lat: geo.lat, lng: geo.lng } : (tenant?.latitude ? { lat: tenant.latitude, lng: tenant.longitude } : null)}
          onConfirm={({ lat, lng, address }) => {
            setGeo({ lat, lng })
            if (address) setForm((p) => ({ ...p, address }))
            setShowMap(false)
          }}
          onClose={() => setShowMap(false)}
        />
      )}

      {/* Mobile header */}
      <div className="md:hidden sticky top-0 z-10 flex items-center gap-3 px-4 py-3 text-white shadow-sm"
           style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}>
        <button onClick={() => navigate(-1)} className="p-1.5 rounded-xl bg-white/20 hover:bg-white/30 transition-colors">
          <ArrowLeft size={20} className="text-white" />
        </button>
        <div>
          <h1 className="font-bold text-white text-base leading-tight">ลงทะเบียนร้านค้า / ท่องเที่ยว</h1>
          <p className="text-white/70 text-xs">เที่ยว กิน พัก ชอป · {tenant?.system_name || `${tenant?.name} One Data`}</p>
        </div>
      </div>

      {/* PC header */}
      <div className="hidden md:flex items-center gap-3 px-6 pt-8 pb-5 border-b border-gray-200 mb-2">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-2xl shrink-0"
             style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}>
          🏪
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-800">ลงทะเบียนร้านค้า / ท่องเที่ยว</h1>
          <p className="text-sm text-gray-500 mt-0.5">เที่ยว กิน พัก ชอป · หลังอนุมัติจะแสดงบนหน้าตลาดออนไลน์น้ำเลา</p>
        </div>
        <span className="text-xs font-bold px-3 py-1 rounded-full bg-amber-50 text-amber-700">
          📍 GPS บังคับ
        </span>
      </div>

      <form onSubmit={handleSubmit} className="px-4 md:px-6 pt-4 pb-24 md:pb-10 space-y-4">

        {/* Business type */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <p className="text-sm font-semibold text-gray-700 mb-3">ประเภท</p>
          <div className="flex flex-wrap gap-2">
            {BUSINESS_TYPES.map((t) => (
              <button key={t.value} type="button"
                onClick={() => setForm((p) => ({ ...p, business_type: t.value }))}
                className="text-xs font-semibold px-3 py-1.5 rounded-full border transition-all"
                style={form.business_type === t.value
                  ? { backgroundColor: '#f59e0b', color: '#fff', borderColor: '#f59e0b' }
                  : { backgroundColor: '#f8fafc', color: '#475569', borderColor: '#e2e8f0' }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Business name */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Store size={16} className="text-amber-500" />
            <span className="text-sm font-semibold text-gray-700">ชื่อร้าน / สถานที่ <span className="text-red-500">*</span></span>
          </div>
          <input type="text" value={form.business_name} onChange={set('business_name')} required
            placeholder="เช่น ร้านข้าวต้มยายแดง, โฮมสเตย์บ้านริมน้ำ"
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-300" />
        </div>

        {/* GPS — บังคับ */}
        <div className="rounded-2xl shadow-sm border border-amber-200 ring-1 ring-amber-100 bg-white p-4">
          <div className="flex items-center gap-2 mb-3">
            <MapPin size={16} className="text-amber-500" />
            <span className="text-sm font-semibold text-gray-700">ตำแหน่ง GPS ของร้าน</span>
            <span className="ml-auto text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">* บังคับ</span>
          </div>
          <button type="button" onClick={() => setShowMap(true)}
            className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium border transition-all ${
              geo.lat
                ? 'bg-green-50 border-green-200 text-green-700'
                : 'bg-amber-50 border-amber-200 text-amber-700'
            }`}>
            <MapPin size={16} />
            {geo.lat
              ? `📍 ${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)} — กดเพื่อแก้ไข`
              : 'กดเพื่อปักหมุดตำแหน่งร้านบนแผนที่'}
          </button>
          {form.address && (
            <p className="text-xs text-gray-500 mt-2 px-1">{form.address}</p>
          )}
          {!geo.lat && (
            <p className="text-xs text-amber-600 mt-1.5 px-1">
              ⚠️ พิกัดนี้จะใช้แสดงหมุดบนแผนที่ตลาดออนไลน์น้ำเลา
            </p>
          )}
        </div>

        {/* Address */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-3">
            <MapPin size={16} className="text-amber-500" />
            <span className="text-sm font-semibold text-gray-700">ที่อยู่</span>
          </div>
          <textarea value={form.address} onChange={set('address')} rows={2}
            placeholder="เช่น บ้านเลขที่ 12 หมู่ 3 บ้านบุญแจ่ม ตำบลน้ำเลา อำเภอร้องกวาง"
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-amber-300" />
        </div>

        {/* Description */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlignLeft size={16} className="text-amber-500" />
            <span className="text-sm font-semibold text-gray-700">รายละเอียด / สินค้า / บริการ</span>
          </div>
          <textarea value={form.description} onChange={set('description')} rows={3}
            placeholder="อธิบายร้านของคุณ เช่น ขายผักปลอดสารพิษ, รับทำอาหารตามสั่ง..."
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-amber-300" />
        </div>

        {/* Operating hours */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">🕐</span>
            <span className="text-sm font-semibold text-gray-700">วัน / เวลาทำการ</span>
          </div>
          <input type="text" value={form.operating_hours} onChange={set('operating_hours')}
            placeholder="เช่น จันทร์-ศุกร์ 08:00-17:00, เปิดทุกวัน"
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-300" />
        </div>

        {/* Contact */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Phone size={16} className="text-amber-500" />
            <span className="text-sm font-semibold text-gray-700">ช่องทางติดต่อ</span>
          </div>
          <input type="tel" value={form.phone} onChange={set('phone')}
            placeholder="เบอร์โทรศัพท์"
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-300" />
          <input type="text" value={form.line_id} onChange={set('line_id')}
            placeholder="Line ID (ถ้ามี)"
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-300" />
          <input type="text" value={form.facebook_url} onChange={set('facebook_url')}
            placeholder="Facebook Page / ลิงก์ (ถ้ามี)"
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-300" />
        </div>

        {/* Images */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Image size={16} className="text-amber-500" />
            <span className="text-sm font-semibold text-gray-700">รูปภาพ (ไม่เกิน 5 รูป)</span>
          </div>
          <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-xl py-4 cursor-pointer hover:bg-gray-50 transition-colors">
            <Image size={20} className="text-gray-300 mb-1" />
            <span className="text-xs text-gray-400">แตะเพื่อเลือกรูป</span>
            <input type="file" accept="image/*" multiple className="hidden" onChange={handleImages} />
          </label>
          {images.length > 0 && (
            <div className="grid grid-cols-4 gap-2 mt-3">
              {images.map((img, i) => (
                <div key={i} className="relative aspect-square rounded-xl overflow-hidden bg-gray-100">
                  <img src={img.preview} alt="" className="w-full h-full object-cover" />
                  <button type="button"
                    onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute top-0.5 right-0.5 bg-black/50 rounded-full p-0.5">
                    <X size={10} className="text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Online service */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">⚡</span>
            <span className="text-sm font-semibold text-gray-700">บริการออนไลน์</span>
          </div>
          <p className="text-xs text-gray-500 mb-3">ถ้ามีช่องทางให้ลูกค้าสั่งซื้อ / จอง / ติดต่อออนไลน์ได้</p>
          <div className="flex gap-2 mb-3">
            {[{ v: 'offline', label: '📍 ไม่มี (ออฟไลน์)' }, { v: 'online', label: '⚡ มีบริการออนไลน์' }].map(({ v, label }) => (
              <button key={v} type="button"
                onClick={() => setForm(p => ({ ...p, service_type: v }))}
                className="flex-1 py-2.5 rounded-xl text-xs font-semibold border transition-all"
                style={form.service_type === v
                  ? { backgroundColor: v === 'online' ? '#dcfce7' : '#f1f5f9', color: v === 'online' ? '#15803d' : '#374151', borderColor: v === 'online' ? '#86efac' : '#d1d5db' }
                  : { backgroundColor: '#f8fafc', color: '#94a3b8', borderColor: '#e2e8f0' }}>
                {label}
              </button>
            ))}
          </div>
          {form.service_type === 'online' && (
            <div className="space-y-2.5 p-3 bg-green-50 rounded-xl border border-green-100">
              <div>
                <p className="text-xs text-gray-500 mb-1.5">ประเภทบริการ</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { v: 'order',   label: '🛒 สั่งซื้อ' },
                    { v: 'book',    label: '📅 จอง' },
                    { v: 'line',    label: '💬 Line' },
                    { v: 'website', label: '🌐 เว็บไซต์' },
                  ].map(({ v, label }) => (
                    <button key={v} type="button"
                      onClick={() => setForm(p => ({ ...p, online_service: v }))}
                      className="py-2 rounded-xl text-xs font-semibold border transition-all"
                      style={form.online_service === v
                        ? { backgroundColor: '#f59e0b', color: '#fff', borderColor: '#f59e0b' }
                        : { backgroundColor: '#fff', color: '#64748b', borderColor: '#e2e8f0' }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <input type="text" value={form.online_url} onChange={set('online_url')}
                placeholder="ลิงก์ / Line ID / URL"
                className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-300" />
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.has_delivery}
                  onChange={e => setForm(p => ({ ...p, has_delivery: e.target.checked }))}
                  className="w-4 h-4 rounded accent-amber-500" />
                <span className="text-sm text-gray-700">🛵 มีบริการส่งถึงบ้าน</span>
              </label>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <button type="submit" disabled={submitting}
          className="w-full py-4 rounded-2xl font-bold text-white text-sm disabled:opacity-50 flex items-center justify-center gap-2"
          style={{ backgroundColor: '#f59e0b' }}>
          {submitting
            ? <><Loader2 size={16} className="animate-spin" /> กำลังส่ง...</>
            : '🏪 ส่งข้อมูลลงทะเบียน'}
        </button>

        <p className="text-center text-xs text-gray-400 pb-2">
          หลังส่งแล้ว เจ้าหน้าที่จะตรวจสอบและอนุมัติภายใน 3 วันทำการ
        </p>
      </form>
    </div>
  )
}
