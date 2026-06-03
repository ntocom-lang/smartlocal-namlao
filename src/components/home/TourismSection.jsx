import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Luggage, Utensils, BedDouble, ShoppingBag, ChevronRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'

const CATS = [
  { key: 'travel', label: 'เที่ยว', Icon: Luggage },
  { key: 'food',   label: 'กิน',   Icon: Utensils },
  { key: 'stay',   label: 'พัก',   Icon: BedDouble },
  { key: 'shop',   label: 'ชอป',  Icon: ShoppingBag },
]

export default function TourismSection() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const [places, setPlaces] = useState([])
  const [activeCat, setActiveCat] = useState('travel')

  useEffect(() => {
    if (!tenant?.id) return
    supabase
      .from('tourism_places')
      .select('*')
      .eq('municipality_id', tenant.id)
      .eq('is_active', true)
      .order('display_order')
      .then(({ data }) => {
        if (data) setPlaces(data)
      })
  }, [tenant?.id])

  const filtered = activeCat ? places.filter(p => p.category === activeCat) : places

  return (
    <section className="relative w-full rounded-3xl overflow-hidden shadow-sm">
      {/* Background Image with Gradient Overlay */}
      <div 
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/tourism-bg.jpg'), url('https://images.unsplash.com/photo-1552465011-b4e21bf6e79a?auto=format&fit=crop&q=80')" }}
      /><div className="absolute inset-0 bg-linear-to-b from-black/60 via-black/20 to-black/80" />

      <div className="relative z-10 pt-8 flex flex-col">
        {/* Header */}
        <div className="px-5 mb-8">
          <h2 className="text-3xl font-bold mb-1 drop-shadow-md">
            <span className="text-teal-300">มา</span>
            <span className="text-white">{tenant?.name?.replace('เทศบาล', '') || 'ของเรา'}</span>
          </h2>
          <p className="text-white text-2xl font-semibold drop-shadow-md">...ต้องไม่พลาด</p>
        </div>

        {/* Category buttons */}
        <div className="flex justify-between px-5 mb-8">
          {CATS.map(({ key, label, Icon }) => {
            const isActive = activeCat === key
            return (
              <button key={key}
                onClick={() => setActiveCat(isActive ? null : key)}
                className="flex flex-col items-center gap-2 active:scale-95 transition-transform">
                <div className={`w-16 h-16 rounded-[1.25rem] flex items-center justify-center shadow-lg transition-colors ${isActive ? 'bg-[#fcd34d]' : 'bg-white'}`}>
                  <Icon size={28} className={isActive ? 'text-white' : 'text-[#86efac]'} strokeWidth={2} />
                </div>
                <span className={`font-bold text-sm drop-shadow-sm ${isActive ? 'text-[#fcd34d]' : 'text-white'}`}>
                  {label}
                </span>
              </button>
            )
          })}
        </div>

        {/* Places grid */}
        <div className="bg-white/20 backdrop-blur-md rounded-t-3xl p-5 border-t border-white/20">
          {filtered.length === 0 ? (
            <p className="text-white/70 text-sm text-center py-6">ยังไม่มีรายการในหมวดนี้</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 mb-4">
              {filtered.slice(0, 4).map((place) => (
                <button key={place.id} onClick={() => navigate(`/tourism/${place.id}`)}
                     className="bg-white rounded-xl overflow-hidden shadow-sm active:scale-[0.98] transition-transform text-left w-full">
                  <div className="h-24 relative">
                    {place.image_url
                      ? <img src={place.image_url} alt={place.name} className="absolute inset-0 w-full h-full object-cover" />
                      : <div className="absolute inset-0 bg-gray-100 flex items-center justify-center text-2xl">🏛️</div>
                    }
                  </div>
                  <div className="px-2 py-2.5">
                    <p className="text-xs font-bold text-gray-800 truncate">{place.name}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <button
              onClick={() => navigate(`/tourism${activeCat ? `?cat=${activeCat}` : ''}`)}
              className="flex items-center gap-1 bg-[#4fd1c5] text-white px-5 py-2 rounded-full text-sm font-bold shadow-md active:scale-95 transition-transform">
              ดูทั้งหมด <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
