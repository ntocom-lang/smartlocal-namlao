import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Luggage, Utensils, BedDouble, ShoppingBag, Wrench, ChevronRight, Zap } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'

const CATS = [
  { key: 'travel',  label: 'เที่ยว',  Icon: Luggage,    from: '#f59e0b', to: '#d97706', glow: '#f59e0b50', emoji: '🏛️' },
  { key: 'food',    label: 'กิน',     Icon: Utensils,   from: '#22c55e', to: '#15803d', glow: '#22c55e50', emoji: '🍽️' },
  { key: 'stay',    label: 'พัก',     Icon: BedDouble,  from: '#3b82f6', to: '#1d4ed8', glow: '#3b82f650', emoji: '🏨' },
  { key: 'shop',    label: 'ชอป',    Icon: ShoppingBag, from: '#f472b6', to: '#db2777', glow: '#f472b650', emoji: '🛍️' },
  { key: 'service', label: 'บริการ',  Icon: Wrench,     from: '#fb923c', to: '#ea580c', glow: '#fb923c50', emoji: '🔧' },
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
      .then(({ data }) => { if (data) setPlaces(data) })
  }, [tenant?.id])

  const filtered = activeCat ? places.filter(p => p.category === activeCat) : places
  const catData  = CATS.find(c => c.key === activeCat)

  return (
    <section className="relative w-full rounded-3xl overflow-hidden shadow-xl">
      {/* Background */}
      <div className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/tourism-bg.jpg'), url('https://images.unsplash.com/photo-1552465011-b4e21bf6e79a?auto=format&fit=crop&q=80')" }} />
      <div className="absolute inset-0 bg-linear-to-b from-black/70 via-black/25 to-black/85" />

      <div className="relative z-10 pt-7 flex flex-col">

        {/* ── Header ── */}
        <div className="px-5 mb-6">
          <p className="text-white/50 text-[10px] font-bold uppercase tracking-widest mb-1">ค้นพบสถานที่</p>
          <h2 className="text-[2rem] font-black leading-tight drop-shadow-lg">
            <span className="text-teal-300">มา</span>
            <span className="text-white">
              {tenant?.name?.replace('เทศบาล', '')?.replace('ตำบล', '') || 'ของเรา'}
            </span>
          </h2>
          <p className="text-white/85 text-xl font-bold drop-shadow-md mt-0.5">...ต้องไม่พลาด</p>
        </div>

        {/* ── Category pills (horizontal scroll) ── */}
        <div className="flex gap-3 px-5 mb-5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {CATS.map(({ key, label, Icon, from, to, glow }) => {
            const isActive = activeCat === key
            return (
              <button key={key}
                onClick={() => setActiveCat(isActive ? null : key)}
                className="shrink-0 flex flex-col items-center gap-2 active:scale-90 transition-all duration-200"
                style={{ minWidth: 64 }}>
                <div
                  className="w-15 h-15 rounded-2xl flex items-center justify-center transition-all duration-300"
                  style={isActive
                    ? { width: 60, height: 60, background: `linear-gradient(140deg, ${from}, ${to})`, boxShadow: `0 6px 22px ${glow}, 0 2px 8px rgba(0,0,0,0.3)`, transform: 'scale(1.1)' }
                    : { width: 60, height: 60, backgroundColor: 'rgba(255,255,255,0.18)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.2)' }}>
                  <Icon size={26} className="text-white" strokeWidth={isActive ? 2 : 1.5} />
                </div>
                <span className={`text-[11px] font-bold drop-shadow-sm transition-all ${isActive ? 'text-white scale-105' : 'text-white/65'}`}>
                  {label}
                </span>
              </button>
            )
          })}
        </div>

        {/* ── Places grid ── */}
        <div className="bg-black/20 backdrop-blur-lg rounded-t-3xl px-4 pt-4 pb-5 border-t border-white/10">

          {filtered.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-white/40 text-sm">ยังไม่มีรายการในหมวดนี้</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 mb-3.5">
              {filtered.slice(0, 4).map((place) => (
                <button key={place.id} onClick={() => navigate(`/tourism/${place.id}`)}
                  className="relative rounded-2xl overflow-hidden active:scale-[0.96] transition-transform text-left w-full group"
                  style={{ height: 122 }}>
                  {/* Image */}
                  {place.image_url
                    ? <img src={place.image_url} alt={place.name}
                        className="absolute inset-0 w-full h-full object-cover group-active:scale-105 transition-transform duration-300" />
                    : <div className="absolute inset-0 flex items-center justify-center text-4xl"
                        style={{ background: catData ? `linear-gradient(135deg, ${catData.from}99, ${catData.to})` : '#374151' }}>
                        {catData?.emoji ?? '🏙️'}
                      </div>
                  }
                  {/* Overlay */}
                  <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/15 to-transparent" />
                  {/* Online badge */}
                  {(place.service_type === 'online' || place.service_type === 'online_only') && (
                    <span className="absolute top-2 right-2 flex items-center gap-0.5 bg-green-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow-md">
                      <Zap size={7} fill="white" strokeWidth={0} />
                      {place.service_type === 'online_only' ? 'ออนไลน์' : 'ออนไลน์'}
                    </span>
                  )}
                  {/* Name */}
                  <p className="absolute bottom-2.5 left-2.5 right-2.5 text-[12px] font-bold text-white drop-shadow-lg leading-tight line-clamp-2">
                    {place.name}
                  </p>
                </button>
              ))}
            </div>
          )}

          {/* "ดูทั้งหมด" button — matches active category color */}
          <button
            onClick={() => navigate(`/tourism${activeCat ? `?cat=${activeCat}` : ''}`)}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-2xl text-sm font-bold transition-all active:scale-[0.98] shadow-md"
            style={catData
              ? { background: `linear-gradient(135deg, ${catData.from}, ${catData.to})`, color: '#fff', boxShadow: `0 4px 14px ${catData.glow}` }
              : { backgroundColor: 'rgba(255,255,255,0.2)', color: '#fff' }}>
            ดูทั้งหมด
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </section>
  )
}
