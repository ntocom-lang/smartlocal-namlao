import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Phone, MapPin, Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'

const CATS = [
  { key: null,     label: 'ทั้งหมด' },
  { key: 'travel', label: '🏛️ เที่ยว' },
  { key: 'food',   label: '🍽️ กิน' },
  { key: 'stay',   label: '🏨 พัก' },
  { key: 'shop',   label: '🛍️ ชอป' },
]

export default function TourismPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { tenant } = useTenant()
  const [places, setPlaces] = useState([])
  const [activeCat, setActiveCat] = useState(searchParams.get('cat') || null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tenant?.id) return
    supabase
      .from('tourism_places')
      .select('*')
      .eq('municipality_id', tenant.id)
      .eq('is_active', true)
      .order('display_order')
      .then(({ data }) => {
        setPlaces(data ?? [])
        setLoading(false)
      })
  }, [tenant?.id])

  const filtered = activeCat ? places.filter(p => p.category === activeCat) : places

  const catLabel = CATS.find(c => c.key === activeCat)?.label?.replace(/^[^ ]+ /, '') ?? 'ทั้งหมด'

  return (
    <div className="max-w-6xl mx-auto pb-28 md:pb-8">

      {/* Mobile Header */}
      <div className="md:hidden sticky top-0 z-30 bg-gray-50/95 backdrop-blur-md">
        <div className="flex items-center gap-2 px-4 pt-3 pb-2">
          <button onClick={() => navigate(-1)}
            className="p-2 -ml-1 rounded-xl hover:bg-gray-200/60 text-gray-500 transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-base font-bold text-gray-800">
            สถานที่แนะนำ {activeCat ? `— ${catLabel}` : ''}
          </h1>
        </div>

        {/* Category filter (mobile) */}
        <div className="flex gap-2 px-4 pb-3 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {CATS.map(({ key, label }) => (
            <button
              key={key ?? 'all'}
              onClick={() => setActiveCat(key)}
              className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full transition-colors"
              style={
                activeCat === key
                  ? { backgroundColor: 'var(--color-primary)', color: '#fff' }
                  : { backgroundColor: '#f1f5f9', color: '#64748b' }
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* PC Header */}
      <div className="hidden md:block px-4 pt-8 pb-4 border-b border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">
              สถานที่แนะนำ {activeCat ? `— ${catLabel}` : ''}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">ค้นพบสถานที่น่าสนใจในพื้นที่</p>
          </div>
        </div>
        {/* Category filter (PC) */}
        <div className="flex gap-2 flex-wrap">
          {CATS.map(({ key, label }) => (
            <button
              key={key ?? 'all'}
              onClick={() => setActiveCat(key)}
              className="shrink-0 text-xs font-semibold px-4 py-2 rounded-full transition-colors"
              style={
                activeCat === key
                  ? { backgroundColor: 'var(--color-primary)', color: '#fff' }
                  : { backgroundColor: '#f1f5f9', color: '#64748b' }
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pt-2 md:pt-6">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-4 border-gray-200 rounded-full animate-spin"
                 style={{ borderTopColor: 'var(--color-primary)' }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-3xl mb-3">🏙️</p>
            <p className="text-gray-400 text-sm">ยังไม่มีรายการในหมวดนี้</p>
          </div>
        ) : (
          <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
            {filtered.map(place => {
              const catObj = CATS.find(c => c.key === place.category)
              return (
                <button key={place.id} onClick={() => navigate(`/tourism/${place.id}`)}
                     className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 active:scale-[0.98] transition-transform text-left w-full">
                  <div className="h-36 md:h-44 relative">
                    {place.image_url
                      ? <img src={place.image_url} alt={place.name} className="absolute inset-0 w-full h-full object-cover" />
                      : <div className="absolute inset-0 bg-gray-100 flex items-center justify-center text-3xl">🏛️</div>
                    }
                    <span className="absolute top-2 left-2 text-[11px] px-2 py-0.5 rounded-full bg-black/40 text-white font-medium">
                      {catObj?.label ?? place.category}
                    </span>
                  </div>
                  <div className="p-3 space-y-1">
                    <p className="text-sm font-bold text-gray-800 leading-tight line-clamp-1">{place.name}</p>
                    {place.description && (
                      <p className="text-xs text-gray-500 line-clamp-2 leading-snug">{place.description}</p>
                    )}
                    {place.phone && (
                      <div className="flex items-center gap-1 pt-0.5">
                        <Phone size={10} className="text-gray-400 shrink-0" />
                        <span className="text-[11px] text-gray-500 truncate">{place.phone}</span>
                      </div>
                    )}
                    {place.address && (
                      <div className="flex items-start gap-1">
                        <MapPin size={10} className="text-gray-400 shrink-0 mt-0.5" />
                        <span className="text-[11px] text-gray-400 line-clamp-1">{place.address}</span>
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          {/* CTA: ลงทะเบียนสถานที่ */}
          <button onClick={() => navigate('/business-register')}
            className="mt-6 w-full flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-4 text-left active:scale-[0.99] transition-transform hover:bg-amber-100">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
              <Plus size={20} className="text-amber-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-amber-800">มีร้านค้า / สถานที่ท่องเที่ยว?</p>
              <p className="text-xs text-amber-600 mt-0.5">ลงทะเบียนเพื่อแสดงบนแผนที่และเว็บไซต์ →</p>
            </div>
          </button>
          </>
        )}
      </div>
    </div>
  )
}
