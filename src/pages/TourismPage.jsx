import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Phone, MapPin, Plus, ShoppingCart, Search, X, SlidersHorizontal,
  CalendarCheck, MessageCircle, Globe, Bike, Zap, Loader2, Star, Navigation,
  Clock, Sparkles,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import {
  TOURISM_CATS, catOf, getOpenState, parseCoords, haversineKm,
  formatDistance, directionsUrl, matchesQuery,
} from '../lib/tourismPlaces'

// ─── Config ───────────────────────────────────────────────────────────────────

const CATS = [{ key: null, label: 'ทั้งหมด', emoji: null }, ...TOURISM_CATS]

const SVC = {
  order:   { label: 'สั่งซื้อ',    Icon: ShoppingCart,  bg: '#fef3c7', color: '#b45309' },
  book:    { label: 'จอง',        Icon: CalendarCheck, bg: '#dbeafe', color: '#1d4ed8' },
  line:    { label: 'ทัก LINE',   Icon: MessageCircle, bg: '#dcfce7', color: '#15803d' },
  website: { label: 'เว็บไซต์',   Icon: Globe,         bg: '#ede9fe', color: '#6d28d9' },
}

const SORTS = [
  { key: 'recommended', label: 'แนะนำ' },
  { key: 'near',        label: 'ใกล้ฉัน' },
  { key: 'rating',      label: 'คะแนนสูงสุด' },
  { key: 'name',        label: 'ชื่อ ก-ฮ' },
]

const OPEN_STYLE = {
  open:         { bg: '#dcfce7', color: '#15803d', dot: '#22c55e' },
  closing_soon: { bg: '#fef3c7', color: '#b45309', dot: '#f59e0b' },
  closed:       { bg: '#f1f5f9', color: '#64748b', dot: '#94a3b8' },
}

// ─── ชิ้นส่วนเล็ก ──────────────────────────────────────────────────────────────

function OpenBadge({ state, label, compact = false }) {
  if (state === 'unknown') return null
  const s = OPEN_STYLE[state]
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
      style={{ backgroundColor: s.bg, color: s.color }}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: s.dot }} />
      {compact ? (state === 'closed' ? 'ปิด' : 'เปิด') : label}
    </span>
  )
}

function RatingBadge({ avg, count }) {
  if (!avg || !count) return null
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-amber-700">
      <Star size={10} fill="#f59e0b" stroke="none" />
      {Number(avg).toFixed(1)}
      <span className="font-normal text-gray-400">({count})</span>
    </span>
  )
}

// ปุ่มลัดใต้การ์ด — เจตนาให้ "โทร" กับ "นำทาง" กดได้จากหน้ารวมโดยไม่ต้องเข้าไปหน้าใน
// เพราะ 2 อย่างนี้คือสิ่งที่คนหาร้านต้องการจริงๆ การบังคับกด 2 ชั้นคือแรงเสียดทานเปล่าๆ
function ActionRow({ place }) {
  const dir = directionsUrl(place)
  const svc = SVC[place.online_service] ?? SVC.order
  const SvcIcon = svc.Icon
  const stop = (e) => e.stopPropagation()

  return (
    <div className="flex items-stretch gap-1.5 px-2.5 pb-2.5">
      {place.phone && (
        <a href={`tel:${place.phone}`} onClick={stop}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-xl text-[11px] font-bold bg-green-50 text-green-700 active:scale-95 transition-transform"
          aria-label={`โทรหา ${place.name}`}>
          <Phone size={11} /> โทร
        </a>
      )}
      {dir && (
        <a href={dir} target="_blank" rel="noopener noreferrer" onClick={stop}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-xl text-[11px] font-bold bg-blue-50 text-blue-700 active:scale-95 transition-transform"
          aria-label={`นำทางไป ${place.name}`}>
          <Navigation size={11} /> นำทาง
        </a>
      )}
      {place.online_url && (
        <a href={place.online_url} target="_blank" rel="noopener noreferrer" onClick={stop}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-xl text-[11px] font-bold active:scale-95 transition-transform"
          style={{ backgroundColor: svc.bg, color: svc.color }}>
          <SvcIcon size={11} /> {svc.label}
        </a>
      )}
    </div>
  )
}

function PlaceCard({ place, onOpen, rating, distanceKm, now }) {
  const cat = catOf(place.category)
  const open = getOpenState(place.opening_hours, now)
  const dist = formatDistance(distanceKm)

  return (
    <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 hover:shadow-md transition-shadow flex flex-col">
      <button onClick={onOpen} className="text-left w-full active:scale-[0.99] transition-transform">
        <div className="relative overflow-hidden bg-gray-100" style={{ aspectRatio: '4/3' }}>
          {place.image_url
            ? <img src={place.image_url} alt={place.name} loading="lazy" decoding="async"
                className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-4xl">{cat?.emoji ?? '🏙️'}</div>
          }
          {cat && (
            <span className="absolute top-2 left-2 text-[11px] font-semibold px-2 py-0.5 rounded-full shadow-sm"
              style={{ backgroundColor: `${cat.bg}f0`, color: cat.color }}>
              {cat.emoji} {cat.label}
            </span>
          )}
          {place.is_featured && (
            <span className="absolute top-2 right-2 flex items-center gap-0.5 bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
              <Sparkles size={9} /> แนะนำ
            </span>
          )}
          <div className="absolute bottom-2 left-2 flex items-center gap-1">
            <OpenBadge state={open.state} label={open.label} />
            {place.has_delivery && (
              <span className="flex items-center gap-0.5 bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                <Bike size={9} /> ส่งได้
              </span>
            )}
          </div>
        </div>

        <div className="px-2.5 pt-2.5 pb-2">
          <p className="text-sm font-bold text-gray-800 leading-tight line-clamp-1">{place.name}</p>
          <div className="flex items-center gap-2 mt-1 min-h-[16px]">
            <RatingBadge avg={rating?.avg_rating} count={rating?.review_count} />
            {dist && (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-gray-500 font-semibold">
                <Navigation size={9} className="text-gray-400" /> {dist}
              </span>
            )}
          </div>
          {place.description && (
            <p className="text-xs text-gray-500 mt-1 line-clamp-2 leading-snug">{place.description}</p>
          )}
          {place.address && (
            <div className="flex items-start gap-1 mt-1">
              <MapPin size={10} className="text-gray-400 shrink-0 mt-0.5" />
              <span className="text-[11px] text-gray-400 line-clamp-1">{place.address}</span>
            </div>
          )}
        </div>
      </button>
      <div className="mt-auto">
        <ActionRow place={place} />
      </div>
    </div>
  )
}

function FilterChip({ active, onClick, children, activeBg = 'var(--color-primary)', activeColor = '#fff' }) {
  return (
    <button onClick={onClick}
      className="shrink-0 flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full transition-colors border"
      style={active
        ? { backgroundColor: activeBg, color: activeColor, borderColor: activeBg }
        : { backgroundColor: '#fff', color: '#64748b', borderColor: '#e2e8f0' }}>
      {children}
    </button>
  )
}

// ─── หน้าหลัก ─────────────────────────────────────────────────────────────────

export default function TourismPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { tenant } = useTenant()

  const [places, setPlaces]   = useState([])
  const [loading, setLoading] = useState(true)
  const [ratings, setRatings] = useState({})

  const [query, setQuery]     = useState('')
  const [activeCat, setActiveCat] = useState(searchParams.get('cat') || null)
  const [openNow, setOpenNow] = useState(false)
  const [onlineOnly, setOnlineOnly] = useState(searchParams.get('online') === '1')
  const [deliveryOnly, setDeliveryOnly] = useState(false)
  const [sort, setSort] = useState('recommended')

  const [myPos, setMyPos] = useState(null)
  const [geoState, setGeoState] = useState('idle') // idle | asking | denied | ok

  // เวลาอ้างอิงของป้ายเปิด/ปิด — เดินทุก 1 นาที ไม่งั้นเปิดหน้าค้างไว้แล้วป้ายจะโกหก
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!tenant?.id) return
    let alive = true
    // ไม่ setLoading(true) ตรงนี้ — ค่าเริ่มต้นเป็น true อยู่แล้ว และ tenant เปลี่ยนกลางคัน
    // ไม่ได้ในทางปฏิบัติ (ผูกกับ hostname) การเรียก setState ตรงๆ ในบอดี้ effect ผิดกฎ lint ของโปรเจกต์
    supabase
      .from('tourism_places')
      .select('*')
      .eq('municipality_id', tenant.id)
      .eq('is_active', true)
      .order('display_order')
      .then(({ data }) => { if (alive) setPlaces(data ?? []) })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [tenant?.id])

  // คะแนนรีวิว: อ่านจาก view สรุป (migration 20260906130000) ถ้ายังไม่มี view ค่อยถอยไป
  // นับเองจาก tourism_reviews — หน้าเว็บจึงใช้ได้ทั้งก่อนและหลังรัน migration
  useEffect(() => {
    if (!tenant?.id) return
    let alive = true
    async function load() {
      const view = await supabase
        .from('tourism_place_ratings')
        .select('place_id, avg_rating, review_count')
        .eq('municipality_id', tenant.id)
      if (!alive) return
      if (!view.error && view.data) {
        setRatings(Object.fromEntries(view.data.map(r => [r.place_id, r])))
        return
      }
      const raw = await supabase
        .from('tourism_reviews')
        .select('place_id, rating')
        .eq('municipality_id', tenant.id)
      if (!alive || raw.error || !raw.data) return
      const acc = {}
      raw.data.forEach((r) => {
        acc[r.place_id] = acc[r.place_id] ?? { sum: 0, review_count: 0 }
        acc[r.place_id].sum += r.rating
        acc[r.place_id].review_count += 1
      })
      setRatings(Object.fromEntries(
        Object.entries(acc).map(([id, v]) => [id, { avg_rating: v.sum / v.review_count, review_count: v.review_count }]),
      ))
    }
    load()
    return () => { alive = false }
  }, [tenant?.id])

  // ขอตำแหน่งเฉพาะตอนผู้ใช้กด "ใกล้ฉัน" เท่านั้น ไม่ขอตั้งแต่เปิดหน้า —
  // ป๊อปอัพขอพิกัดตั้งแต่ยังไม่ได้ทำอะไรคือสาเหตุอันดับต้นๆ ที่คนกดปฏิเสธถาวร
  const askLocation = useCallback(() => {
    if (myPos) { setSort('near'); return }
    if (!navigator.geolocation) { setGeoState('denied'); return }
    setGeoState('asking')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMyPos({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setGeoState('ok')
        setSort('near')
      },
      () => setGeoState('denied'),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    )
  }, [myPos])

  const distances = useMemo(() => {
    if (!myPos) return {}
    const out = {}
    places.forEach((p) => {
      const c = parseCoords(p)
      if (c) out[p.id] = haversineKm(myPos, c)
    })
    return out
  }, [myPos, places])

  const visible = useMemo(() => {
    const list = places.filter((p) => {
      if (activeCat && p.category !== activeCat) return false
      if (onlineOnly && p.service_type !== 'online' && p.service_type !== 'online_only') return false
      if (deliveryOnly && !p.has_delivery) return false
      if (openNow && getOpenState(p.opening_hours, now).state === 'closed') return false
      if (openNow && getOpenState(p.opening_hours, now).state === 'unknown') return false
      return matchesQuery(p, query)
    })

    const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'th')
    if (sort === 'name') return [...list].sort(byName)
    if (sort === 'rating') {
      return [...list].sort((a, b) =>
        (ratings[b.id]?.avg_rating ?? 0) - (ratings[a.id]?.avg_rating ?? 0)
        || (ratings[b.id]?.review_count ?? 0) - (ratings[a.id]?.review_count ?? 0)
        || byName(a, b))
    }
    if (sort === 'near' && myPos) {
      // รายการที่ไม่มีพิกัดต้องไปท้ายสุด ไม่ใช่ปนอยู่ต้นๆ ทั้งที่ไม่รู้ว่าอยู่ไหน
      return [...list].sort((a, b) => {
        const da = distances[a.id] ?? Infinity
        const db = distances[b.id] ?? Infinity
        return da - db || byName(a, b)
      })
    }
    return [...list].sort((a, b) =>
      Number(b.is_featured ?? false) - Number(a.is_featured ?? false)
      || (a.display_order ?? 999) - (b.display_order ?? 999)
      || byName(a, b))
  }, [places, activeCat, onlineOnly, deliveryOnly, openNow, query, sort, ratings, distances, myPos, now])

  const hasFilter = Boolean(query || activeCat || openNow || onlineOnly || deliveryOnly)

  function clearFilters() {
    setQuery(''); setActiveCat(null); setOpenNow(false)
    setOnlineOnly(false); setDeliveryOnly(false); setSort('recommended')
    setSearchParams({}, { replace: true })
  }

  function pickCat(key) {
    setActiveCat(key)
    const next = new URLSearchParams(searchParams)
    if (key) next.set('cat', key); else next.delete('cat')
    setSearchParams(next, { replace: true })
  }

  const countByCat = useMemo(() => {
    const acc = {}
    places.forEach((p) => { acc[p.category] = (acc[p.category] ?? 0) + 1 })
    return acc
  }, [places])

  return (
    <div className="max-w-6xl mx-auto pb-28 md:pb-8">

      {/* ── หัวเรื่อง + ตัวกรอง (ติดบนสุด) ── */}
      <div className="sticky top-0 z-30 bg-white/97 backdrop-blur-md border-b border-gray-100 shadow-sm">
        <div className="flex items-center gap-2 px-4 pt-3 pb-1 md:hidden">
          <button onClick={() => navigate(-1)}
            className="p-2 -ml-1 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors" aria-label="ย้อนกลับ">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-base font-bold text-gray-800 flex-1 truncate">เที่ยว กิน พัก ชอป บริการ</h1>
          <button onClick={() => navigate('/business-register')}
            className="shrink-0 flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-xl"
            style={{ backgroundColor: '#fef3c7', color: '#b45309' }}>
            <Plus size={11} /> ลงทะเบียน
          </button>
        </div>

        <div className="hidden md:flex items-center justify-between px-6 pt-5 pb-1">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">เที่ยว กิน พัก ชอป บริการ</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              ที่เที่ยว ร้านอาหาร ที่พัก ของฝาก และบริการในพื้นที่ · {places.length} รายการ
            </p>
          </div>
          <button onClick={() => navigate('/business-register')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors hover:bg-amber-100"
            style={{ backgroundColor: '#fef3c7', color: '#b45309' }}>
            <Plus size={15} /> ลงทะเบียนร้านของคุณ
          </button>
        </div>

        {/* ค้นหา */}
        <div className="px-4 md:px-6 pt-2">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นหาชื่อร้าน ของที่ขาย หรือหมู่บ้าน..."
              aria-label="ค้นหาสถานที่และร้านค้า"
              className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-9 pr-9 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-200 focus:bg-white"
            />
            {query && (
              <button onClick={() => setQuery('')} aria-label="ล้างคำค้นหา"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-gray-400 hover:bg-gray-100">
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* หมวด */}
        <div className="flex gap-2 px-4 md:px-6 pt-3 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {CATS.map(({ key, label, emoji }) => (
            <FilterChip key={key ?? 'all'} active={activeCat === key} onClick={() => pickCat(key)}>
              {emoji && <span>{emoji}</span>}
              {label}
              {key && countByCat[key] > 0 && (
                <span className={activeCat === key ? 'opacity-70' : 'text-gray-400'}>{countByCat[key]}</span>
              )}
            </FilterChip>
          ))}
        </div>

        {/* ตัวกรองด่วน + เรียงลำดับ */}
        <div className="flex gap-2 px-4 md:px-6 py-2.5 overflow-x-auto items-center" style={{ scrollbarWidth: 'none' }}>
          <FilterChip active={openNow} onClick={() => setOpenNow(v => !v)} activeBg="#16a34a">
            <Clock size={11} /> เปิดอยู่ตอนนี้
          </FilterChip>
          <FilterChip active={onlineOnly} onClick={() => setOnlineOnly(v => !v)} activeBg="#22c55e">
            <Zap size={11} /> สั่งออนไลน์
          </FilterChip>
          <FilterChip active={deliveryOnly} onClick={() => setDeliveryOnly(v => !v)} activeBg="#f97316">
            <Bike size={11} /> ส่งถึงบ้าน
          </FilterChip>
          <FilterChip active={sort === 'near'} onClick={askLocation} activeBg="#0ea5e9">
            {geoState === 'asking' ? <Loader2 size={11} className="animate-spin" /> : <Navigation size={11} />}
            ใกล้ฉัน
          </FilterChip>

          <div className="ml-auto shrink-0 flex items-center gap-1 pl-2">
            <SlidersHorizontal size={12} className="text-gray-400" />
            <select value={sort} aria-label="เรียงลำดับ"
              onChange={(e) => { const v = e.target.value; if (v === 'near') askLocation(); else setSort(v) }}
              className="text-xs font-semibold text-gray-600 bg-transparent focus:outline-none py-1">
              {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
        </div>

        {geoState === 'denied' && (
          <p className="px-4 md:px-6 pb-2 text-[11px] text-gray-400">
            เปิดสิทธิ์ตำแหน่งในเบราว์เซอร์ก่อน จึงจะเรียง &quot;ใกล้ฉัน&quot; ได้
          </p>
        )}
      </div>

      {/* ── เนื้อหา ── */}
      <div className="px-4 md:px-6 pt-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 size={28} className="animate-spin text-gray-300" />
            <p className="text-sm text-gray-400">กำลังโหลด...</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-gray-400 font-semibold">
                พบ {visible.length} รายการ
                {sort === 'near' && myPos && ' · เรียงจากใกล้ที่สุด'}
              </p>
              {hasFilter && (
                <button onClick={clearFilters}
                  className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-700">
                  <X size={12} /> ล้างตัวกรอง
                </button>
              )}
            </div>

            {visible.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-4xl mb-3">🔍</p>
                <p className="text-sm font-semibold text-gray-500">
                  {places.length === 0 ? 'ยังไม่มีรายการในระบบ' : 'ไม่พบรายการที่ตรงกับที่ค้นหา'}
                </p>
                <p className="text-xs text-gray-400 mt-1 max-w-xs">
                  {places.length === 0
                    ? 'ถ้าคุณมีร้านหรือที่พักในพื้นที่ ลงทะเบียนได้ฟรี เจ้าหน้าที่จะตรวจแล้วเผยแพร่ให้'
                    : 'ลองลดตัวกรอง หรือพิมพ์คำสั้นลง เช่น ชื่อร้านคำเดียว'}
                </p>
                {hasFilter && (
                  <button onClick={clearFilters}
                    className="mt-4 px-4 py-2 rounded-xl text-xs font-bold bg-gray-100 text-gray-600">
                    ล้างตัวกรองทั้งหมด
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
                {visible.map(place => (
                  <PlaceCard key={place.id} place={place} now={now}
                    rating={ratings[place.id]}
                    distanceKm={distances[place.id]}
                    onOpen={() => navigate(`/tourism/${place.id}`)} />
                ))}
              </div>
            )}

            <button onClick={() => navigate('/business-register')}
              className="w-full mt-6 flex items-center gap-3 rounded-2xl px-4 py-4 text-left active:scale-[0.99] transition-transform"
              style={{ background: 'linear-gradient(135deg, #fef3c7, #fff7ed)', border: '1px solid #fcd34d' }}>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 text-xl"
                style={{ backgroundColor: '#fde68a' }}>
                🏪
              </div>
              <div>
                <p className="text-sm font-bold text-amber-800">มีร้านค้า ที่พัก หรือแหล่งท่องเที่ยว?</p>
                <p className="text-xs text-amber-700/80 mt-0.5">ลงทะเบียนฟรี เพื่อแสดงบนแผนที่และเว็บไซต์ของ อปท. →</p>
              </div>
            </button>
          </>
        )}
      </div>
    </div>
  )
}
