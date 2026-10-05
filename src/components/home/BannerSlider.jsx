import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import { toReliableImageUrl } from '../../lib/driveStorage'
import { edgeImageUrl } from '../../lib/edgeImage'
import { slideIndexesToLoad } from '../../lib/bannerSlides'

const INTERVAL = 4500

// seen = ใบที่เคยแสดงแล้ว ต้องคง <img> ไว้ ไม่งั้นสไลด์วนรอบสองจะเริ่มโหลดใหม่
function visit(slide, to) {
  return slide.seen.includes(to) ? { ...slide, idx: to } : { idx: to, seen: [...slide.seen, to] }
}

export default function BannerSlider({ rounded = true }) {
  const { tenant } = useTenant()
  const [banners, setBanners] = useState([])
  const [slide, setSlide] = useState({ idx: 0, seen: [0] })
  const idx = slide.idx
  const timerRef = useRef(null)
  const startXRef = useRef(null)

  useEffect(() => {
    if (!tenant?.id) return
    supabase
      .from('banners')
      .select('id, image_url, link_url, object_position')
      .eq('municipality_id', tenant.id)
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => {
        if (data?.length) setBanners(data.map(b => ({ ...b, image_url: edgeImageUrl(toReliableImageUrl(b.image_url)) })))
      })
      .catch(() => {})
  }, [tenant?.id])

  useEffect(() => {
    if (banners.length < 2) return
    timerRef.current = setInterval(() => setSlide(s => visit(s, (s.idx + 1) % banners.length)), INTERVAL)
    return () => clearInterval(timerRef.current)
  }, [banners.length])

  function goTo(i) {
    clearInterval(timerRef.current)
    setSlide(s => visit(s, i))
    timerRef.current = setInterval(() => setSlide(s => visit(s, (s.idx + 1) % banners.length)), INTERVAL)
  }

  function onTouchStart(e) { startXRef.current = e.touches[0].clientX }
  function onTouchEnd(e) {
    if (startXRef.current == null) return
    const dx = e.changedTouches[0].clientX - startXRef.current
    startXRef.current = null
    if (Math.abs(dx) < 40) return
    goTo((idx + (dx < 0 ? 1 : -1) + banners.length) % banners.length)
  }

  if (!banners.length) return null

  const n = banners.length
  // โหลดรูปเฉพาะใบที่แสดง/ใบถัดไป/ใบที่เคยแสดง — เหตุผลเต็มที่ src/lib/bannerSlides.js
  const loadable = slideIndexesToLoad(n, idx, slide.seen)

  function SlotImg({ b, visible, load }) {
    const Tag = b.link_url ? 'a' : 'div'
    const props = b.link_url ? { href: b.link_url, target: '_blank', rel: 'noopener noreferrer' } : {}
    return (
      <Tag {...props}
        className="absolute inset-0 w-full h-full transition-opacity duration-700"
        style={{ opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none' }}>
        {load && (
          <img src={b.image_url} alt=""
            className="w-full h-full object-cover"
            style={{ objectPosition: b.object_position || 'center' }} />
        )}
      </Tag>
    )
  }
  return (
    <div className="overflow-hidden select-none"
         style={{ borderRadius: rounded ? 'var(--radius-card, 1rem)' : 0, boxShadow: 'var(--shadow-card, 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06))', border: 'var(--border-card, none)' }}>
      <div className="relative w-full overflow-hidden aspect-video md:aspect-[21/9] lg:aspect-[24/9]"
        onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {banners.map((b, i) => (
          <SlotImg key={b.id} b={b} visible={i === idx} load={loadable.has(i)} />
        ))}
      </div>
      {n > 1 && (
        <div className="flex justify-center gap-1.5 py-2.5"
             style={{ backgroundColor: 'var(--bg-card, #ffffff)' }}>
          {banners.map((_, i) => (
            <button key={i} onClick={() => goTo(i)}
              className="rounded-full transition-all duration-300"
              style={{
                width: i === idx ? 20 : 7,
                height: 7,
                backgroundColor: i === idx ? 'var(--color-primary)' : '#d1d5db',
              }} />
          ))}
        </div>
      )}
    </div>
  )
}
