import { useState, useEffect, useRef, useCallback } from 'react'
import {
  X, ChevronLeft, ChevronRight, Phone, MapPin, Navigation, ExternalLink,
  Clock, Zap, Bike, Star, Pencil, Eye, EyeOff, ShoppingCart, CalendarCheck,
  MessageCircle, Globe, Loader2,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  catOf, getOpenState, weeklyHours, directionsUrl, DAY_KEYS,
  resolveServiceUrl, serviceChannelLabel,
} from '../../lib/tourismPlaces'

// พรีวิว "แบบที่ประชาชนเห็น" สำหรับฝั่งเจ้าหน้าที่ — กดการ์ดในรายการแล้วเห็นทันทีว่าข้อมูล
// ที่กรอกไว้ออกมาหน้าตาแบบไหนบนเว็บประชาชน โดยไม่ต้องเปิดอีกแท็บไปที่ /tourism/:id
//
// ⚠️ ตรรกะที่ตัดสินว่า "เปิดอยู่ไหม / ปุ่มสั่งซื้อชี้ไปไหน / นำทางยังไง" ต้องเรียกจาก
// src/lib/tourismPlaces.js เท่านั้น ห้าม copy มาเขียนใหม่ ไม่งั้นพรีวิวกับของจริงจะไม่ตรงกัน
// (เคสจริง: online_url เป็นเบอร์โทร/Line ID ไม่ใช่ URL เสมอ ยัดลง href ดิบๆ แล้วหน้าขาว — PR #148)

const SVC = {
  order:   { label: 'สั่งซื้อเลย', Icon: ShoppingCart,  bg: '#fef3c7', color: '#d97706', border: '#fcd34d' },
  book:    { label: 'จองเลย',      Icon: CalendarCheck, bg: '#dbeafe', color: '#1d4ed8', border: '#93c5fd' },
  line:    { label: 'ติดต่อ Line',  Icon: MessageCircle, bg: '#dcfce7', color: '#15803d', border: '#86efac' },
  website: { label: 'เปิดเว็บไซต์', Icon: Globe,         bg: '#ede9fe', color: '#7c3aed', border: '#c4b5fd' },
}

function StarDisplay({ value, size = 13 }) {
  const rounded = Math.round(value)
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} size={size}
          fill={rounded >= i ? '#f59e0b' : 'none'}
          stroke={rounded >= i ? '#f59e0b' : '#d1d5db'}
          strokeWidth={1.5} />
      ))}
    </span>
  )
}

function Gallery({ images, name, catLabel }) {
  const scrollRef = useRef(null)
  const [active, setActive] = useState(0)

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setActive(Math.round(el.scrollLeft / el.offsetWidth))
  }, [])

  const goTo = useCallback((i) => {
    const el = scrollRef.current
    if (el) el.scrollTo({ left: el.offsetWidth * i, behavior: 'smooth' })
    setActive(i)
  }, [])

  if (images.length === 0) {
    return (
      <div className="relative h-40 md:h-full md:min-h-[22rem] bg-gray-100 flex flex-col items-center justify-center gap-1 text-5xl">
        🏙️
        <span className="text-xs text-gray-400">ยังไม่มีรูปภาพ</span>
      </div>
    )
  }

  return (
    <div className="relative h-56 md:h-full md:min-h-[22rem] bg-gray-900">
      <div ref={scrollRef} onScroll={onScroll}
        className="flex h-full overflow-x-scroll snap-x snap-mandatory"
        style={{ scrollbarWidth: 'none' }}>
        {images.map((url, i) => (
          <div key={url ?? i} className="snap-start shrink-0 w-full h-full">
            <img src={url} alt={`${name} ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
          </div>
        ))}
      </div>

      <div className="absolute inset-0 bg-linear-to-t from-black/55 via-transparent to-black/20 pointer-events-none" />

      {images.length > 1 && (
        <>
          <button type="button" onClick={() => goTo(active - 1)} disabled={active === 0}
            aria-label="รูปก่อนหน้า"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center disabled:opacity-20 active:scale-95 transition-all">
            <ChevronLeft size={18} className="text-white" />
          </button>
          <button type="button" onClick={() => goTo(active + 1)} disabled={active === images.length - 1}
            aria-label="รูปถัดไป"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center disabled:opacity-20 active:scale-95 transition-all">
            <ChevronRight size={18} className="text-white" />
          </button>
        </>
      )}

      <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-2 pointer-events-none">
        {catLabel && (
          <span className="text-xs font-bold px-3 py-1.5 rounded-full bg-white/90 text-gray-800">{catLabel}</span>
        )}
        {images.length > 1 && (
          <div className="flex items-center gap-1.5 bg-black/40 backdrop-blur-sm rounded-full px-2.5 py-1">
            {images.map((_, i) => (
              <span key={i} className={`rounded-full transition-all duration-300 ${i === active ? 'w-4 h-1.5 bg-white' : 'w-1.5 h-1.5 bg-white/50'}`} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function TourismPlacePreview({ place, canManage = false, onClose, onEdit, onToggleActive }) {
  const [reviews, setReviews] = useState(null)   // null = ยังโหลดไม่เสร็จ

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const placeId = place?.id
  useEffect(() => {
    if (!placeId) return undefined
    let alive = true
    supabase.from('tourism_reviews')
      .select('id, rating, comment, reviewer_name, created_at')
      .eq('place_id', placeId)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (!alive) return
        if (error) {
          console.error('[tourism] โหลดรีวิวของสถานที่ไม่สำเร็จ:', error.message)
          setReviews([])
          return
        }
        setReviews(data ?? [])
      })
    return () => { alive = false }
  }, [placeId])

  if (!place) return null

  const cat      = catOf(place.category)
  const catLabel = cat ? `${cat.emoji} ${cat.label}` : place.category
  const images   = [place.image_url, ...(place.gallery ?? [])].filter(Boolean)

  const isOnline     = place.service_type === 'online' || place.service_type === 'online_only'
  const isOnlineOnly = place.service_type === 'online_only'
  const svc      = SVC[place.online_service] ?? SVC.order
  const svcLink  = resolveServiceUrl(place)
  const ctaLabel = serviceChannelLabel(place.online_service, svcLink?.kind) ?? svc.label
  const CtaIcon  = svcLink?.kind === 'phone' ? Phone
                 : svcLink?.kind === 'line'  ? MessageCircle
                 : svc.Icon
  // tel:/line: ห้ามใส่ target="_blank" — เดสก์ท็อปจะเปิดแท็บว่างค้างไว้อีกใบ
  const ctaExternal = !!svcLink && svcLink.href.startsWith('http')

  const openState = getOpenState(place.opening_hours)
  const hours     = weeklyHours(place.opening_hours)
  const todayKey  = DAY_KEYS[new Date().getDay()]
  const navUrl    = directionsUrl(place)

  const avg = reviews?.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center md:justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div role="dialog" aria-modal="true" aria-label={`รายละเอียด ${place.name}`}
        onClick={e => e.stopPropagation()}
        className="relative w-full md:max-w-3xl md:mx-4 bg-white rounded-t-3xl md:rounded-3xl shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">

        {/* ป้ายกำกับว่านี่คือพรีวิว — กันเจ้าหน้าที่เข้าใจผิดว่าหลุดไปหน้าเว็บประชาชน */}
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-gray-100 shrink-0">
          <p className="text-[11px] font-bold text-gray-400 tracking-wide">พรีวิว · หน้านี้คือสิ่งที่ประชาชนเห็น</p>
          <button type="button" onClick={onClose} aria-label="ปิด"
            className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          <div className="md:grid md:grid-cols-[1.05fr_1fr] md:items-stretch">

            <Gallery images={images} name={place.name} catLabel={catLabel} />

            <div className="px-5 py-4 md:py-5 space-y-4">

              <div>
                <h3 className="text-xl md:text-2xl font-bold text-gray-900 leading-tight">{place.name}</h3>
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {/* ไม่มีรูป = ป้ายหมวดบนรูปไม่ถูกวาด ต้องย้ายมาไว้แถวนี้แทน ไม่งั้นหายไปทั้งใบ */}
                  {images.length === 0 && cat && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: cat.bg, color: cat.color }}>
                      {cat.emoji} {cat.label}
                    </span>
                  )}
                  {!place.is_active && (
                    <span className="flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">
                      <EyeOff size={10} /> ซ่อนอยู่ · ประชาชนยังไม่เห็น
                    </span>
                  )}
                  {place.is_featured && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                      ⭐ แนะนำ
                    </span>
                  )}
                  {openState.state !== 'unknown' && (
                    <span className="flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full"
                      style={openState.state === 'closed'
                        ? { backgroundColor: '#f1f5f9', color: '#64748b' }
                        : { backgroundColor: '#dcfce7', color: '#15803d' }}>
                      <Clock size={10} /> {openState.label}
                    </span>
                  )}
                  {isOnline && (
                    <span className="flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
                      <Zap size={10} fill="#15803d" strokeWidth={0} /> {isOnlineOnly ? 'ตลาดออนไลน์' : 'บริการออนไลน์'}
                    </span>
                  )}
                  {isOnlineOnly && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
                      🏪 ไม่มีหน้าร้าน
                    </span>
                  )}
                  {place.has_delivery && (
                    <span className="flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 border border-orange-200">
                      <Bike size={10} /> มีบริการส่ง
                    </span>
                  )}
                  {place.village_no && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                      หมู่ {place.village_no}
                    </span>
                  )}
                </div>
              </div>

              {isOnline && svcLink && (
                <a href={svcLink.href}
                  {...(ctaExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  className="flex items-center justify-center gap-2 w-full py-3.5 rounded-2xl font-bold text-sm active:scale-[0.98] transition-transform border"
                  style={{ backgroundColor: svc.bg, color: svc.color, borderColor: svc.border }}>
                  <CtaIcon size={17} />
                  {ctaLabel}
                  {ctaExternal && <ExternalLink size={13} className="opacity-60" />}
                </a>
              )}

              {place.description && (
                <div>
                  <p className="text-xs font-bold text-gray-400 tracking-wide mb-1.5">เกี่ยวกับสถานที่</p>
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{place.description}</p>
                </div>
              )}

              {(place.phone || place.address) && (
                <div className="bg-gray-50 rounded-2xl divide-y divide-gray-100 overflow-hidden">
                  {place.phone && (
                    <a href={`tel:${place.phone}`} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-100 transition-colors">
                      <Phone size={16} className="text-green-500 shrink-0" />
                      <span className="text-sm text-gray-700 font-medium">{place.phone}</span>
                    </a>
                  )}
                  {place.address && (
                    <div className="flex items-start gap-3 px-4 py-3">
                      <MapPin size={16} className="text-red-500 shrink-0 mt-0.5" />
                      <p className="text-sm text-gray-700 leading-relaxed">{place.address}</p>
                    </div>
                  )}
                </div>
              )}

              {(hours.length > 0 || place.hours_note) && (
                <div>
                  <p className="text-xs font-bold text-gray-400 tracking-wide mb-1.5">เวลาทำการ</p>
                  {hours.length > 0 && (
                    <div className="bg-gray-50 rounded-2xl divide-y divide-gray-100 overflow-hidden">
                      {hours.map(d => (
                        <div key={d.key} className="flex items-center justify-between px-4 py-2"
                          style={d.key === todayKey ? { backgroundColor: '#fffbeb' } : undefined}>
                          <span className={`text-sm ${d.key === todayKey ? 'font-bold text-amber-800' : 'text-gray-600'}`}>
                            {d.label}{d.key === todayKey ? ' (วันนี้)' : ''}
                          </span>
                          <span className={`text-sm ${d.closed ? 'text-gray-400' : 'text-gray-700 font-medium'}`}>{d.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {place.hours_note && (
                    <p className="text-xs text-gray-500 mt-2 leading-relaxed">หมายเหตุ: {place.hours_note}</p>
                  )}
                </div>
              )}

              {(place.facebook_url || place.line_id) && (
                <div className="bg-gray-50 rounded-2xl divide-y divide-gray-100 overflow-hidden">
                  {place.facebook_url && (
                    <a href={place.facebook_url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-3 px-4 py-3 hover:bg-gray-100 transition-colors">
                      <span className="text-base">📘</span>
                      <span className="text-sm text-gray-700 font-medium">Facebook</span>
                      <ExternalLink size={13} className="ml-auto text-gray-400" />
                    </a>
                  )}
                  {place.line_id && (
                    <div className="flex items-center gap-3 px-4 py-3">
                      <span className="text-base">💬</span>
                      <span className="text-sm text-gray-700">LINE: {place.line_id}</span>
                    </div>
                  )}
                </div>
              )}

              {navUrl && (
                <a href={navUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl font-semibold text-sm text-white active:scale-[0.98] transition-transform"
                  style={{ backgroundColor: '#10b981' }}>
                  <Navigation size={16} /> นำทางไปที่นี่
                  <ExternalLink size={13} className="opacity-70" />
                </a>
              )}

              <div>
                <p className="text-xs font-bold text-gray-400 tracking-wide mb-2">รีวิวจากประชาชน</p>
                {reviews === null ? (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Loader2 size={13} className="animate-spin" /> กำลังโหลดรีวิว...
                  </div>
                ) : reviews.length === 0 ? (
                  <p className="text-sm text-gray-400">ยังไม่มีรีวิว</p>
                ) : (
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-3">
                      <p className="text-2xl font-bold text-gray-800 leading-none">{avg.toFixed(1)}</p>
                      <div>
                        <StarDisplay value={avg} size={15} />
                        <p className="text-[11px] text-gray-400 mt-0.5">{reviews.length} รีวิว</p>
                      </div>
                    </div>
                    {reviews.filter(r => r.comment).slice(0, 3).map(r => (
                      <div key={r.id} className="bg-white rounded-xl border border-gray-100 px-3.5 py-2.5 space-y-1">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-[10px] font-bold text-gray-500">
                            {(r.reviewer_name?.[0] || '?').toUpperCase()}
                          </div>
                          <p className="text-xs font-semibold text-gray-700">{r.reviewer_name || 'นิรนาม'}</p>
                          <StarDisplay value={r.rating} size={11} />
                        </div>
                        <p className="text-sm text-gray-600 leading-relaxed pl-8">{r.comment}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </div>
        </div>

        {/* แถบจัดการ — เฉพาะคนที่มีสิทธิ์แก้รายการนี้ */}
        {canManage && (
          <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-100 shrink-0 bg-white">
            <button type="button" onClick={onToggleActive}
              className={`flex items-center justify-center gap-1.5 flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-colors ${place.is_active ? 'border-gray-200 text-gray-600 hover:bg-gray-50' : 'border-green-200 text-green-700 hover:bg-green-50'}`}>
              {place.is_active ? <><EyeOff size={15} /> ซ่อนจากประชาชน</> : <><Eye size={15} /> แสดงให้ประชาชนเห็น</>}
            </button>
            <button type="button" onClick={onEdit}
              className="flex items-center justify-center gap-1.5 flex-1 py-2.5 rounded-xl text-sm font-bold text-white active:scale-[0.98] transition-transform"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              <Pencil size={15} /> แก้ไขข้อมูล
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
