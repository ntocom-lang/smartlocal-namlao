import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, MapPin, Phone, ExternalLink, Store, Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'

const TYPE_FILTER = [
  { key: null,      label: 'ทั้งหมด' },
  { key: 'shop',    label: '🛍️ ร้านค้า' },
  { key: 'food',    label: '🍽️ อาหาร' },
  { key: 'stay',    label: '🏨 ที่พัก' },
  { key: 'otop',    label: '🏺 OTOP' },
  { key: 'tourism', label: '📍 ท่องเที่ยว' },
  { key: 'service', label: '🔧 บริการ' },
]

const TYPE_LABEL = {
  shop: '🛍️ ร้านค้า', food: '🍽️ อาหาร', stay: '🏨 ที่พัก',
  otop: '🏺 OTOP', tourism: '📍 ท่องเที่ยว', service: '🔧 บริการ', other: '📝 อื่นๆ',
}

export default function MarketPage() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const [places, setPlaces] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeType, setActiveType] = useState(null)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    if (!tenant?.id) return
    supabase
      .from('business_registrations')
      .select('*')
      .eq('municipality_id', tenant.id)
      .eq('status', 'approved')
      .order('approved_at', { ascending: false })
      .then(({ data }) => setPlaces(data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [tenant?.id])

  const filtered = activeType ? places.filter((p) => p.business_type === activeType) : places

  return (
    <div className="max-w-6xl mx-auto pb-28 md:pb-8">

      {/* Mobile header */}
      <div className="md:hidden sticky top-0 z-30 bg-amber-600/95 backdrop-blur-md">
        <div className="flex items-center gap-2 px-4 pt-3 pb-2">
          <button onClick={() => navigate(-1)}
            className="p-2 -ml-1 rounded-xl hover:bg-white/20 text-white transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-base font-bold text-white">เที่ยว กิน พัก ชอบ</h1>
        </div>
        <div className="flex gap-2 px-4 pb-3 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {TYPE_FILTER.map(({ key, label }) => (
            <button key={key ?? 'all'} onClick={() => setActiveType(key)}
              className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full transition-colors"
              style={activeType === key
                ? { backgroundColor: '#fff', color: '#d97706' }
                : { backgroundColor: 'rgba(255,255,255,0.2)', color: '#fff' }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* PC header */}
      <div className="hidden md:block px-4 pt-8 pb-4 border-b border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-2xl shrink-0"
                 style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}>
              🏪
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-800">เที่ยว กิน พัก ชอบ</h1>
              <p className="text-sm text-gray-500 mt-0.5">ร้านค้า OTOP ที่พัก และสถานที่ท่องเที่ยวในชุมชน</p>
            </div>
          </div>
          <button onClick={() => navigate('/business-register')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white shadow-sm transition-all hover:opacity-90"
            style={{ backgroundColor: '#f59e0b' }}>
            <Plus size={16} /> ลงทะเบียนร้านของคุณ
          </button>
        </div>
        <div className="flex gap-2 flex-wrap">
          {TYPE_FILTER.map(({ key, label }) => (
            <button key={key ?? 'all'} onClick={() => setActiveType(key)}
              className="shrink-0 text-xs font-semibold px-4 py-2 rounded-full border transition-colors"
              style={activeType === key
                ? { backgroundColor: '#f59e0b', color: '#fff', borderColor: '#f59e0b' }
                : { backgroundColor: '#f8fafc', color: '#64748b', borderColor: '#e2e8f0' }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Mobile add CTA */}
      <div className="md:hidden px-4 pt-3 pb-2">
        <button onClick={() => navigate('/business-register')}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white"
          style={{ backgroundColor: '#f59e0b' }}>
          <Plus size={16} /> ลงทะเบียนร้านของคุณ
        </button>
      </div>

      {/* Content */}
      <div className="px-4 pt-2 md:pt-6">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-4 border-amber-200 rounded-full animate-spin border-t-amber-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">🏪</p>
            <p className="text-gray-400 text-sm">
              {places.length === 0
                ? 'ยังไม่มีร้านค้าในระบบ — เป็นคนแรกที่ลงทะเบียน!'
                : 'ไม่มีร้านในหมวดนี้'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
            {filtered.map((place) => (
              <button key={place.id} onClick={() => setSelected(place)}
                className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 active:scale-[0.98] transition-transform text-left w-full">
                {/* Image */}
                <div className="h-36 md:h-44 relative">
                  {place.images?.[0] ? (
                    <img src={place.images[0]} alt={place.business_name}
                      className="absolute inset-0 w-full h-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 bg-amber-50 flex items-center justify-center text-4xl">
                      {place.business_type === 'food' ? '🍽️'
                        : place.business_type === 'stay' ? '🏨'
                        : place.business_type === 'otop' ? '🏺'
                        : place.business_type === 'tourism' ? '📍'
                        : '🛍️'}
                    </div>
                  )}
                  <span className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full bg-black/40 text-white font-medium">
                    {TYPE_LABEL[place.business_type] ?? place.business_type}
                  </span>
                </div>
                <div className="p-3">
                  <p className="text-sm font-bold text-gray-800 leading-tight">{place.business_name}</p>
                  {place.description && (
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{place.description}</p>
                  )}
                  {place.phone && (
                    <p className="text-xs text-amber-600 mt-1.5 flex items-center gap-1">
                      <Phone size={10} /> {place.phone}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSelected(null)} />
          <div className="relative w-full sm:max-w-md bg-white sm:rounded-2xl rounded-t-3xl shadow-2xl max-h-[85dvh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="shrink-0 px-5 pt-5 pb-4 border-b border-gray-100">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center text-2xl shrink-0">
                  {selected.images?.[0]
                    ? <img src={selected.images[0]} alt="" className="w-full h-full object-cover rounded-xl" />
                    : '🛍️'}
                </div>
                <div className="flex-1 min-w-0 pr-8">
                  <p className="font-bold text-gray-800 text-base leading-tight">{selected.business_name}</p>
                  <p className="text-xs text-amber-600 mt-0.5">{TYPE_LABEL[selected.business_type] ?? ''}</p>
                </div>
                <button onClick={() => setSelected(null)}
                  className="absolute top-4 right-4 p-1.5 rounded-xl bg-gray-100 text-gray-500 hover:bg-gray-200">
                  ✕
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
              {selected.images?.length > 0 && (
                <div className="grid grid-cols-3 gap-1.5">
                  {selected.images.map((url, i) => (
                    <img key={i} src={url} alt="" className="aspect-square object-cover rounded-xl" />
                  ))}
                </div>
              )}
              {selected.description && (
                <p className="text-sm text-gray-600 leading-relaxed">{selected.description}</p>
              )}
              <div className="bg-gray-50 rounded-xl divide-y divide-gray-100 overflow-hidden">
                {selected.operating_hours && (
                  <div className="flex items-center gap-3 px-4 py-3">
                    <span className="text-base">🕐</span>
                    <p className="text-sm text-gray-700">{selected.operating_hours}</p>
                  </div>
                )}
                {selected.phone && (
                  <a href={`tel:${selected.phone}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-gray-100 transition-colors">
                    <Phone size={15} className="text-green-500 shrink-0" />
                    <span className="text-sm font-medium text-gray-700">{selected.phone}</span>
                    <span className="ml-auto text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-lg">โทร</span>
                  </a>
                )}
                {selected.latitude && (
                  <a href={`https://maps.google.com/?q=${selected.latitude},${selected.longitude}`}
                    target="_blank" rel="noreferrer"
                    className="flex items-center gap-3 px-4 py-3 hover:bg-gray-100 transition-colors">
                    <MapPin size={15} className="text-amber-500 shrink-0" />
                    <span className="text-sm text-gray-700">ดูบนแผนที่</span>
                    <ExternalLink size={12} className="ml-auto text-gray-400" />
                  </a>
                )}
                {selected.facebook_url && (
                  <a href={selected.facebook_url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-3 px-4 py-3 hover:bg-gray-100 transition-colors">
                    <span className="text-base">📘</span>
                    <span className="text-sm text-gray-700">Facebook</span>
                    <ExternalLink size={12} className="ml-auto text-gray-400" />
                  </a>
                )}
                {selected.line_id && (
                  <div className="flex items-center gap-3 px-4 py-3">
                    <span className="text-base">💬</span>
                    <span className="text-sm text-gray-700">Line: {selected.line_id}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
