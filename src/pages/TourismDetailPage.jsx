import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, MapPin, ExternalLink, Share2, Phone, X } from 'lucide-react'
import { supabase } from '../lib/supabase'

const CAT_LABEL = {
  travel: '🏛️ เที่ยว',
  food:   '🍽️ กิน',
  stay:   '🏨 พัก',
  shop:   '🛍️ ชอป',
}

function PhotoCarousel({ images, name, category, onBack, onShare }) {
  const scrollRef = useRef(null)
  const fullscreenScrollRef = useRef(null)
  const [active, setActive] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setActive(Math.round(el.scrollLeft / el.offsetWidth))
  }, [])

  const goTo = useCallback((i) => {
    const el = scrollRef.current
    if (el) el.scrollTo({ left: el.offsetWidth * i, behavior: 'smooth' })
    const fsEl = fullscreenScrollRef.current
    if (fsEl) fsEl.scrollTo({ left: fsEl.offsetWidth * i, behavior: 'smooth' })
    setActive(i)
  }, [])

  if (images.length === 0) {
    return (
      <div className="relative h-72 bg-gray-100 flex items-center justify-center text-6xl">
        🏛️
        <button onClick={onBack}
          className="absolute top-4 left-4 w-9 h-9 rounded-full bg-black/20 flex items-center justify-center">
          <ArrowLeft size={18} className="text-gray-600" />
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="relative h-72">
        {/* Slides */}
        <div ref={scrollRef} onScroll={onScroll}
             className="flex h-full overflow-x-scroll snap-x snap-mandatory"
             style={{ scrollbarWidth: 'none' }}>
          {images.map((url, i) => (
            <div key={i} className="snap-start shrink-0 w-full h-full cursor-pointer" onClick={() => setFullscreen(true)}>
              <img src={url} alt={`${name} ${i + 1}`} className="w-full h-full object-cover" />
            </div>
          ))}
        </div>

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-linear-to-t from-black/60 via-transparent to-black/30 pointer-events-none" />

        {/* Back */}
        <button onClick={onBack}
          className="absolute top-4 left-4 w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center active:scale-95 transition-transform z-10">
          <ArrowLeft size={18} className="text-white" />
        </button>

        {/* Share */}
        <button onClick={onShare}
          className="absolute top-4 right-4 w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center active:scale-95 transition-transform z-10">
          <Share2 size={16} className="text-white" />
        </button>

        {/* Prev / Next arrows */}
        {images.length > 1 && (
          <>
            <button onClick={() => goTo(active - 1)} disabled={active === 0}
              className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/35 backdrop-blur-sm flex items-center justify-center disabled:opacity-20 active:scale-95 transition-all z-10">
              <ChevronLeft size={18} className="text-white" />
            </button>
            <button onClick={() => goTo(active + 1)} disabled={active === images.length - 1}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/35 backdrop-blur-sm flex items-center justify-center disabled:opacity-20 active:scale-95 transition-all z-10">
              <ChevronRight size={18} className="text-white" />
            </button>
          </>
        )}

        {/* Bottom row: category badge + counter */}
        <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between z-10 pointer-events-none">
          <span className="text-xs font-bold px-3 py-1.5 rounded-full bg-white/90 text-gray-800 pointer-events-auto">
            {CAT_LABEL[category] ?? category}
          </span>
          {images.length > 1 && (
            <div className="flex items-center gap-1.5 bg-black/40 backdrop-blur-sm rounded-full px-3 py-1 pointer-events-auto">
              {images.map((_, i) => (
                <span key={i} className={`rounded-full transition-all duration-300 ${i === active ? 'w-4 h-1.5 bg-white' : 'w-1.5 h-1.5 bg-white/50'}`} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Fullscreen Viewer */}
      {fullscreen && (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col">
          <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center z-50 bg-gradient-to-b from-black/60 to-transparent">
             <div className="w-10" />
             {images.length > 1 && (
               <div className="text-white text-sm font-medium bg-black/40 px-3 py-1 rounded-full backdrop-blur-sm">
                 {active + 1} / {images.length}
               </div>
             )}
             <button onClick={() => setFullscreen(false)} className="w-10 h-10 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm active:scale-95 transition-transform">
                <X size={20} className="text-white" />
             </button>
          </div>

          <div className="flex-1 flex overflow-x-scroll snap-x snap-mandatory relative" style={{ scrollbarWidth: 'none' }} 
               ref={(node) => {
                 fullscreenScrollRef.current = node;
                 if (node && !node.dataset.initialized) {
                   node.scrollLeft = node.offsetWidth * active;
                   node.dataset.initialized = 'true';
                 }
               }}
               onScroll={(e) => {
                 const el = e.currentTarget;
                 const idx = Math.round(el.scrollLeft / el.offsetWidth);
                 if (idx !== active) {
                    setActive(idx);
                    if (scrollRef.current) {
                       scrollRef.current.scrollTo({ left: scrollRef.current.offsetWidth * idx });
                    }
                 }
               }}>
             {images.map((url, i) => (
               <div key={i} className="snap-start shrink-0 w-full h-full flex items-center justify-center p-2">
                 <img src={url} alt={`${name} ${i + 1}`} className="max-w-full max-h-full object-contain" />
               </div>
             ))}
          </div>

          {/* Prev / Next arrows (Fullscreen) */}
          {images.length > 1 && (
            <>
              <button onClick={() => goTo(active - 1)} disabled={active === 0}
                className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center disabled:opacity-20 active:scale-95 transition-all z-50">
                <ChevronLeft size={24} className="text-white" />
              </button>
              <button onClick={() => goTo(active + 1)} disabled={active === images.length - 1}
                className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center disabled:opacity-20 active:scale-95 transition-all z-50">
                <ChevronRight size={24} className="text-white" />
              </button>
            </>
          )}
        </div>
      )}
    </>
  )
}

export default function TourismDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [place, setPlace] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('tourism_places').select('*').eq('id', id).single()
      .then(({ data }) => { setPlace(data); setLoading(false) })
  }, [id])

  async function handleShare() {
    if (navigator.share) {
      await navigator.share({ title: place?.name, text: place?.description ?? '', url: window.location.href })
    } else {
      await navigator.clipboard.writeText(window.location.href)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-6 h-6 border-4 border-gray-200 rounded-full animate-spin"
             style={{ borderTopColor: 'var(--color-primary)' }} />
      </div>
    )
  }

  if (!place) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3">
        <p className="text-4xl">🏙️</p>
        <p className="text-gray-400 text-sm">ไม่พบข้อมูลสถานที่นี้</p>
        <button onClick={() => navigate(-1)} className="text-sm text-blue-500 underline">กลับ</button>
      </div>
    )
  }

  const allImages = [place.image_url, ...(place.gallery ?? [])].filter(Boolean)

  return (
    <div className="max-w-lg mx-auto pb-28">

      {/* Photo carousel */}
      <PhotoCarousel
        images={allImages}
        name={place.name}
        category={place.category}
        onBack={() => navigate(-1)}
        onShare={handleShare}
      />

      {/* Content */}
      <div className="px-5 pt-5 space-y-4">

        <h1 className="text-2xl font-bold text-gray-900 leading-tight">{place.name}</h1>

        {place.description && (
          <div>
            <h2 className="text-sm font-semibold text-gray-500 mb-2">เกี่ยวกับสถานที่</h2>
            <p className="text-gray-700 text-sm leading-relaxed whitespace-pre-line">{place.description}</p>
          </div>
        )}

        {(place.phone || place.address) && (
          <div className="bg-gray-50 rounded-2xl divide-y divide-gray-100">
            {place.phone && (
              <a href={`tel:${place.phone}`}
                 className="flex items-center gap-3 px-4 py-3 active:bg-gray-100 rounded-t-2xl transition-colors">
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

        {place.maps_url && (
          <a href={place.maps_url} target="_blank" rel="noopener noreferrer"
             className="flex items-center justify-center gap-2 w-full py-3.5 rounded-2xl font-semibold text-sm text-white active:scale-[0.98] transition-transform"
             style={{ backgroundColor: '#10b981' }}>
            <MapPin size={16} />
            เปิดใน Google Maps
            <ExternalLink size={14} className="opacity-70" />
          </a>
        )}

      </div>
    </div>
  )
}
