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
      .select('id, image_url, link_url')
      .eq('municipality_id', tenant.id)
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => { if (data?.length) setBanners(data) })
      .catch(() => {})
  }, [tenant?.id])

  useEffect(() => {
    if (banners.length < 2) return
    timerRef.current = setInterval(() => {
      setIdx(i => (i + 1) % banners.length)
    }, INTERVAL)
    return () => clearInterval(timerRef.current)
  }, [banners.length])

  function goTo(i) {
    clearInterval(timerRef.current)
    setIdx(i)
    timerRef.current = setInterval(() => {
      setIdx(p => (p + 1) % banners.length)
    }, INTERVAL)
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

  const cur = banners[idx]
  const Wrapper = cur.link_url ? 'a' : 'div'
  const wrapperProps = cur.link_url
    ? { href: cur.link_url, target: '_blank', rel: 'noopener noreferrer' }
    : {}

  return (
    <div className="rounded-2xl overflow-hidden shadow-md select-none">
      <Wrapper {...wrapperProps}
        className="block relative w-full"
        style={{ backgroundColor: '#000' }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}>
        {banners.map((b, i) => (
          <img key={b.id} src={b.image_url} alt=""
            className="block w-full transition-opacity duration-700"
            style={{ opacity: i === idx ? 1 : 0, position: i === idx ? 'relative' : 'absolute', inset: 0 }} />
        ))}
      </Wrapper>

      {/* Dot indicators */}
      {banners.length > 1 && (
        <div className="flex justify-center gap-1.5 py-2.5 bg-white">
          {banners.map((_, i) => (
            <button key={i} onClick={() => goTo(i)}
              className="rounded-full transition-all duration-300"
              style={{
                width:  i === idx ? 20 : 7,
                height: 7,
                backgroundColor: i === idx ? 'var(--color-primary)' : '#d1d5db',
              }} />
          ))}
        </div>
      )}
    </div>
  )
}
