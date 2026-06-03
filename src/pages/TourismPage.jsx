import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
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
    <div className="max-w-lg mx-auto pb-28">

      {/* Header */}
      <div className="sticky top-0 z-30 bg-gray-50/95 backdrop-blur-md">
        <div className="flex items-center gap-2 px-4 pt-3 pb-2">
          <button onClick={() => navigate(-1)}
            className="p-2 -ml-1 rounded-xl hover:bg-gray-200/60 text-gray-500 transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-base font-bold text-gray-800">
            สถานที่แนะนำ {activeCat ? `— ${catLabel}` : ''}
          </h1>
        </div>

        {/* Category filter */}
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

      {/* Content */}
      <div className="px-4 pt-2">
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
          <div className="grid grid-cols-2 gap-3">
            {filtered.map(place => {
              const catObj = CATS.find(c => c.key === place.category)
              return (
                <button key={place.id} onClick={() => navigate(`/tourism/${place.id}`)}
                     className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 active:scale-[0.98] transition-transform text-left w-full">
                  <div className="h-36 relative">
                    {place.image_url
                      ? <img src={place.image_url} alt={place.name} className="absolute inset-0 w-full h-full object-cover" />
                      : <div className="absolute inset-0 bg-gray-100 flex items-center justify-center text-3xl">🏛️</div>
                    }
                    <span className="absolute top-2 left-2 text-[11px] px-2 py-0.5 rounded-full bg-black/40 text-white font-medium">
                      {catObj?.label ?? place.category}
                    </span>
                  </div>
                  <div className="p-3">
                    <p className="text-sm font-bold text-gray-800 leading-tight">{place.name}</p>
                    {place.description && (
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{place.description}</p>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
