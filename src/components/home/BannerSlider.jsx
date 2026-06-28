import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'

const INTERVAL = 4500

export default function BannerSlider() {
  const { tenant } = useTenant()
  const [banners, setBanners] = useState([])
  const [idx, setIdx] = useState(0)
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
      .then(({ data }) => { if (data?.length) setBanners(data) })
      .catch(() => {})
  }, [tenant?.id])

  useEffect(() => {
    if (banners.length < 2) return
    timerRef.current = setInterval(() => setIdx(i => (i + 1) % banners.length), INTERVAL)
    return () => clearInterval(timerRef.current)
  }, [banners.length])

  function goTo(i) {
    clearInterval(timerRef.current)
    setIdx(i)
    timerRef.current = setInterval(() => setIdx(p => (p + 1) % banners.length), INTERVAL)
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
  const rightIdx = (idx + 1) % n

  const dots = n > 1 ? (
    <div className="flex justify-center gap-1.5 py-2.5 bg-white">
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
  ) : null

  function SlotImg({ b, visible }) {
    const Tag = b.link_url ? 'a' : 'div'
    const props = b.link_url ? { href: b.link_url, target: '_blank', rel: 'noopener noreferrer' } : {}
    return (
      <Tag {...props}
        className="absolute inset-0 w-full h-full transition-opacity duration-700"
        style={{ opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none' }}>
        <img src={b.image_url} alt=""
          className="w-full h-full object-cover"
          style={{ objectPosition: b.object_position || 'center' }} />
      </Tag>
    )
  }

  return (
    <>
      {/* Mobile: single slider */}
      <div className="md:hidden rounded-2xl overflow-hidden shadow-md select-none">
        <div className="relative w-full overflow-hidden aspect-video"
          onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {banners.map((b, i) => (
            <SlotImg key={b.id} b={b} visible={i === idx} />
          ))}
        </div>
        {dots}
      </div>

      {/* Desktop: 2 slots side-by-side, slide ทีละ 1 ภาพ */}
      <div className="hidden md:block select-none rounded-2xl overflow-hidden shadow-md">
        <div className="flex gap-0.5 h-56">
          <div className="relative flex-1 overflow-hidden">
            {banners.map((b, i) => (
              <SlotImg key={b.id} b={b} visible={i === idx} />
            ))}
          </div>
          {n > 1 && (
            <div className="relative flex-1 overflow-hidden">
              {banners.map((b, i) => (
                <SlotImg key={b.id} b={b} visible={i === rightIdx} />
              ))}
            </div>
          )}
        </div>
        {dots}
      </div>
    </>
  )
}
