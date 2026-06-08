import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Phone, MapPin, Plus, ShoppingCart,
  CalendarCheck, MessageCircle, Globe, Bike, Zap, ChevronRight, Loader2,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'

// ─── Config ───────────────────────────────────────────────────────────────────

const CATS = [
  { key: null,      label: 'ทั้งหมด', emoji: null,  color: '#64748b', bg: '#f1f5f9' },
  { key: 'travel',  label: 'เที่ยว',  emoji: '🏛️', color: '#1d4ed8', bg: '#dbeafe' },
  { key: 'food',    label: 'กิน',     emoji: '🍽️', color: '#d97706', bg: '#fef3c7' },
  { key: 'stay',    label: 'พัก',     emoji: '🏨', color: '#7c3aed', bg: '#ede9fe' },
  { key: 'shop',    label: 'ชอป',    emoji: '🛍️', color: '#15803d', bg: '#dcfce7' },
  { key: 'service', label: 'บริการ',  emoji: '🔧', color: '#dc2626', bg: '#fee2e2' },
]

const SVC = {
  order:   { label: 'สั่งซื้อเลย',  Icon: ShoppingCart,  bg: '#fef3c7', color: '#d97706', solid: '#f59e0b' },
  book:    { label: 'จองเลย',       Icon: CalendarCheck,  bg: '#dbeafe', color: '#1d4ed8', solid: '#3b82f6' },
  line:    { label: 'ติดต่อ Line',   Icon: MessageCircle, bg: '#dcfce7', color: '#15803d', solid: '#22c55e' },
  website: { label: 'เว็บไซต์',     Icon: Globe,          bg: '#ede9fe', color: '#7c3aed', solid: '#8b5cf6' },
}

// ─── Place card (grid) ────────────────────────────────────────────────────────

function PlaceCard({ place, onClick }) {
  const cat = CATS.find(c => c.key === place.category)
  const isOnline = place.service_type === 'online'
  const svc = SVC[place.online_service] ?? SVC.order
  const SvcIcon = svc.Icon

  return (
    <button onClick={onClick}
      className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 active:scale-[0.97] transition-all hover:shadow-md text-left w-full group">
      {/* Image */}
      <div className="relative overflow-hidden" style={{ aspectRatio: '4/3' }}>
        {place.image_url
          ? <img src={place.image_url} alt={place.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
          : <div className="w-full h-full bg-linear-to-br from-gray-100 to-gray-200 flex items-center justify-center text-4xl">
              {cat?.emoji ?? '🏙️'}
            </div>
        }
        {/* Online badge */}
        {isOnline && (
          <span className="absolute top-2 right-2 flex items-center gap-0.5 bg-green-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
            <Zap size={8} fill="white" strokeWidth={0} /> ออนไลน์
          </span>
        )}
        {/* Category badge */}
        {cat?.emoji && (
          <span className="absolute top-2 left-2 text-[11px] font-semibold px-2 py-0.5 rounded-full shadow-sm"
            style={{ backgroundColor: cat.bg + 'f0', color: cat.color }}>
            {cat.emoji} {cat.label}
          </span>
        )}
        {/* Delivery */}
        {place.has_delivery && (
          <span className="absolute bottom-2 left-2 flex items-center gap-0.5 bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
            <Bike size={9} /> ส่งได้
          </span>
        )}
      </div>

      {/* Content */}
      <div className="p-3">
        <p className="text-sm font-bold text-gray-800 leading-tight line-clamp-1">{place.name}</p>
        {place.description && (
          <p className="text-xs text-gray-500 mt-1 line-clamp-2 leading-snug">{place.description}</p>
        )}
        <div className="mt-1.5 space-y-0.5">
          {place.phone && (
            <div className="flex items-center gap-1">
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
        {/* CTA button */}
        {isOnline && (
          <div className="mt-2.5 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-xl text-xs font-bold"
            style={{ backgroundColor: svc.bg, color: svc.color }}>
            <SvcIcon size={11} />
            {svc.label}
          </div>
        )}
      </div>
    </button>
  )
}

// ─── Market card (horizontal layout, online_only) ────────────────────────────

function MarketCard({ place, onClick }) {
  const cat = CATS.find(c => c.key === place.category)
  const svc = SVC[place.online_service] ?? SVC.order
  const SvcIcon = svc.Icon

  return (
    <button onClick={onClick}
      className="bg-white rounded-2xl shadow-sm border border-gray-100 flex gap-3 p-3 active:scale-[0.98] transition-all hover:shadow-md text-left w-full group">
      <div className="relative shrink-0 w-20 h-20 rounded-xl overflow-hidden">
        {place.image_url
          ? <img src={place.image_url} alt={place.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
          : <div className="w-full h-full bg-linear-to-br from-purple-100 to-indigo-200 flex items-center justify-center text-2xl">🏪</div>
        }
        {place.has_delivery && (
          <span className="absolute bottom-1 left-1 flex items-center gap-0.5 bg-orange-500 text-white text-[8px] font-bold px-1 py-0.5 rounded-full">
            <Bike size={7} /> ส่ง
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0 flex flex-col justify-between">
        <div>
          {cat?.emoji && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
              style={{ backgroundColor: cat.bg, color: cat.color }}>
              {cat.emoji} {cat.label}
            </span>
          )}
          <p className="text-sm font-bold text-gray-800 mt-1 truncate">{place.name}</p>
          {place.description && (
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2 leading-snug">{place.description}</p>
          )}
        </div>
        {place.online_url ? (
          <div className="mt-1.5 inline-flex items-center gap-1 py-1 px-2.5 rounded-lg text-[11px] font-bold"
            style={{ backgroundColor: svc.bg, color: svc.color }}>
            <SvcIcon size={10} /> {svc.label}
          </div>
        ) : (
          <div className="mt-1.5 inline-flex items-center gap-1 py-1 px-2.5 rounded-lg text-[11px] font-bold bg-gray-100 text-gray-500">
            <SvcIcon size={10} /> {svc.label}
          </div>
        )}
      </div>
    </button>
  )
}

// ─── Featured card (horizontal scroll, online only) ───────────────────────────

function FeaturedCard({ place, onClick }) {
  const svc = SVC[place.online_service] ?? SVC.order
  const SvcIcon = svc.Icon

  return (
    <button onClick={onClick}
      className="shrink-0 w-40 rounded-2xl overflow-hidden shadow-md active:scale-95 transition-transform text-left relative"
      style={{ height: '200px' }}>
      {place.image_url
        ? <img src={place.image_url} alt={place.name} className="absolute inset-0 w-full h-full object-cover" />
        : <div className="absolute inset-0 bg-linear-to-br from-amber-100 to-orange-200 flex items-center justify-center text-4xl">🏪</div>
      }
      {/* Overlay */}
      <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/10 to-transparent" />
      {/* Delivery badge */}
      {place.has_delivery && (
        <span className="absolute top-2 right-2 flex items-center gap-0.5 bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
          <Bike size={8} /> ส่งได้
        </span>
      )}
      {/* Bottom content */}
      <div className="absolute bottom-0 left-0 right-0 p-2.5">
        <p className="text-white text-xs font-bold line-clamp-2 leading-snug mb-2">{place.name}</p>
        <div className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-xl text-[11px] font-bold"
          style={{ backgroundColor: svc.bg, color: svc.color }}>
          <SvcIcon size={10} />
          {svc.label}
        </div>
      </div>
    </button>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TourismPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { tenant } = useTenant()
  const [places, setPlaces] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeCat, setActiveCat] = useState(searchParams.get('cat') || null)
  const [showOnline, setShowOnline] = useState(searchParams.get('online') === '1')

  useEffect(() => {
    if (!tenant?.id) return
    supabase
      .from('tourism_places')
      .select('*')
      .eq('municipality_id', tenant.id)
      .eq('is_active', true)
      .order('display_order')
      .then(({ data }) => { setPlaces(data ?? []); setLoading(false) })
  }, [tenant?.id])

  const onlinePlaces  = places.filter(p => p.service_type === 'online')
  const marketPlaces  = places.filter(p => p.service_type === 'online_only')
  const mainPlaces    = places.filter(p => p.service_type !== 'online_only')

  const filtered = mainPlaces.filter(p => {
    if (showOnline) return p.service_type === 'online'
    if (activeCat) return p.category === activeCat
    return true
  })

  const filteredMarket = activeCat
    ? marketPlaces.filter(p => p.category === activeCat)
    : marketPlaces

  function handleCatClick(key) {
    if (key === '__online__') { setShowOnline(true); setActiveCat(null) }
    else { setShowOnline(false); setActiveCat(key) }
  }

  const activeKey = showOnline ? '__online__' : activeCat
  const showFeaturedRow  = !showOnline && !activeCat && onlinePlaces.length > 0
  const showMarketSection = !showOnline && filteredMarket.length > 0

  return (
    <div className="max-w-6xl mx-auto pb-28 md:pb-8">

      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-30 bg-white/96 backdrop-blur-md border-b border-gray-100 shadow-sm">

        {/* Mobile title row */}
        <div className="flex items-center gap-2 px-4 pt-3 pb-1 md:hidden">
          <button onClick={() => navigate(-1)} className="p-2 -ml-1 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-base font-bold text-gray-800 flex-1 truncate">
            เที่ยว กิน พัก ชอป
            {showOnline ? ' — ออนไลน์' : activeCat ? ` — ${CATS.find(c => c.key === activeCat)?.label}` : ''}
          </h1>
          <button onClick={() => navigate('/business-register')}
            className="shrink-0 flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-xl"
            style={{ backgroundColor: '#fef3c7', color: '#d97706' }}>
            <Plus size={11} /> ลงทะเบียน
          </button>
        </div>

        {/* PC title row */}
        <div className="hidden md:flex items-center justify-between px-6 pt-5 pb-1">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">เที่ยว กิน พัก ชอป</h1>
            <p className="text-sm text-gray-400 mt-0.5">ค้นพบสถานที่ ร้านค้า และบริการในพื้นที่ · {places.length} รายการ</p>
          </div>
          <button onClick={() => navigate('/business-register')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors hover:bg-amber-100"
            style={{ backgroundColor: '#fef3c7', color: '#d97706' }}>
            <Plus size={15} /> ลงทะเบียนสถานที่ของคุณ
          </button>
        </div>

        {/* Category filter pills */}
        <div className="flex gap-2 px-4 py-3 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {CATS.map(({ key, label, emoji }) => (
            <button key={key ?? 'all'} onClick={() => handleCatClick(key)}
              className="shrink-0 flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
              style={activeKey === key
                ? { backgroundColor: 'var(--color-primary)', color: '#fff' }
                : { backgroundColor: '#f1f5f9', color: '#64748b' }}>
              {emoji && <span>{emoji}</span>}
              {label}
            </button>
          ))}
          {/* Online filter */}
          <button onClick={() => handleCatClick('__online__')}
            className="shrink-0 flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
            style={activeKey === '__online__'
              ? { backgroundColor: '#22c55e', color: '#fff' }
              : { backgroundColor: '#f0fdf4', color: '#15803d' }}>
            <Zap size={11} fill={activeKey === '__online__' ? '#fff' : '#22c55e'} strokeWidth={0} />
            ออนไลน์
            {onlinePlaces.length > 0 && (
              <span className="font-bold px-1.5 rounded-full text-[10px]"
                style={{
                  backgroundColor: activeKey === '__online__' ? 'rgba(255,255,255,0.25)' : '#22c55e',
                  color: '#fff',
                }}>
                {onlinePlaces.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="px-4 pt-5 space-y-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 size={28} className="animate-spin text-gray-300" />
            <p className="text-sm text-gray-400">กำลังโหลด...</p>
          </div>

        ) : (
          <>
            {/* ── Featured: online horizontal row ── */}
            {showFeaturedRow && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                      <Zap size={12} fill="white" strokeWidth={0} />
                    </div>
                    <h2 className="font-bold text-gray-800 text-sm">สั่งได้เลย · บริการออนไลน์</h2>
                  </div>
                  <button onClick={() => handleCatClick('__online__')}
                    className="flex items-center gap-0.5 text-xs text-green-600 font-semibold hover:underline">
                    ทั้งหมด <ChevronRight size={12} />
                  </button>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
                  {onlinePlaces.map(place => (
                    <FeaturedCard key={place.id} place={place} onClick={() => navigate(`/tourism/${place.id}`)} />
                  ))}
                </div>
              </div>
            )}

            {/* ── Main grid ── */}
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <p className="text-4xl mb-3">🏙️</p>
                <p className="text-sm font-semibold text-gray-400">ยังไม่มีรายการในหมวดนี้</p>
                <p className="text-xs text-gray-400 mt-1">ลองเลือกหมวดอื่น หรือกลับมาดูใหม่เร็วๆ นี้</p>
              </div>
            ) : (
              <>
                {showFeaturedRow && (
                  <div className="flex items-center gap-2">
                    <div className="h-px flex-1 bg-gray-100" />
                    <span className="text-xs text-gray-400 font-semibold">สถานที่ทั้งหมด · {filtered.length} รายการ</span>
                    <div className="h-px flex-1 bg-gray-100" />
                  </div>
                )}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
                  {filtered.map(place => (
                    <PlaceCard key={place.id} place={place} onClick={() => navigate(`/tourism/${place.id}`)} />
                  ))}
                </div>
              </>
            )}

            {/* ── ตลาดออนไลน์ section ── */}
            {showMarketSection && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-base"
                    style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
                    🏪
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="font-bold text-gray-800 text-sm leading-tight">ตลาดออนไลน์</h2>
                    <p className="text-[11px] text-gray-400 leading-tight">สั่งซื้อได้เลย · ไม่ต้องออกจากบ้าน</p>
                  </div>
                  <span className="shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: '#ede9fe', color: '#7c3aed' }}>
                    {filteredMarket.length} ร้าน
                  </span>
                </div>
                <div className="space-y-2">
                  {filteredMarket.map(place => (
                    <MarketCard key={place.id} place={place} onClick={() => navigate(`/tourism/${place.id}`)} />
                  ))}
                </div>
              </div>
            )}

            {/* ── CTA: register ── */}
            <button onClick={() => navigate('/business-register')}
              className="w-full flex items-center gap-3 rounded-2xl px-4 py-4 text-left active:scale-[0.99] transition-transform"
              style={{ background: 'linear-gradient(135deg, #fef3c7, #fff7ed)', border: '1px solid #fcd34d' }}>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 text-xl"
                style={{ backgroundColor: '#fde68a' }}>
                🏪
              </div>
              <div>
                <p className="text-sm font-bold text-amber-800">มีร้านค้า / สถานที่ท่องเที่ยว?</p>
                <p className="text-xs text-amber-600 mt-0.5">ลงทะเบียนฟรี เพื่อแสดงบนแผนที่และเว็บไซต์ →</p>
              </div>
            </button>
          </>
        )}
      </div>
    </div>
  )
}
