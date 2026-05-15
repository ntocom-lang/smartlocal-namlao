import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Newspaper } from 'lucide-react'
import { useTenant } from '../../contexts/TenantContext'

const SCALE = 0.78
const VISIBLE_H = 280

function buildSrc(fbPageUrl, width) {
  const fbW = Math.round(width / SCALE)
  const fbH = Math.round(VISIBLE_H / SCALE)
  return (
    'https://www.facebook.com/plugins/page.php' +
    '?href=' + encodeURIComponent(fbPageUrl) +
    '&tabs=timeline' +
    '&width=' + fbW +
    '&height=' + fbH +
    '&small_header=true' +
    '&adapt_container_width=true' +
    '&hide_cover=false' +
    '&show_facepile=false'
  )
}

export default function NewsSection() {
  const { tenant } = useTenant()
  const wrapRef = useRef(null)
  const [src, setSrc] = useState(null)

  useEffect(() => {
    if (!tenant?.facebook_url || !wrapRef.current) return

    const observer = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry.contentRect.width)
      if (w > 0) setSrc(buildSrc(tenant.facebook_url, w))
    })
    observer.observe(wrapRef.current)
    return () => observer.disconnect()
  }, [tenant?.facebook_url])

  if (!tenant?.facebook_url) {
    return (
      <section>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-6 rounded-full" style={{ backgroundColor: 'var(--color-primary)' }} />
          <h2 className="text-base font-bold text-gray-700 dark:text-slate-200">ข่าวสารประชาสัมพันธ์</h2>
        </div>
        <div className="w-full bg-white rounded-2xl border border-gray-100 shadow-sm dark:bg-white/10 dark:border-white/10
                        flex flex-col items-center justify-center gap-2 py-10 text-gray-400 dark:text-slate-500">
          <Newspaper size={32} strokeWidth={1.5} />
          <p className="text-sm">ยังไม่มีข่าวสารประชาสัมพันธ์</p>
        </div>
      </section>
    )
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-1 h-6 rounded-full" style={{ backgroundColor: 'var(--color-primary)' }} />
          <h2 className="text-base font-bold text-gray-700 dark:text-slate-200">ข่าวสารประชาสัมพันธ์</h2>
        </div>
        <a
          href={tenant.facebook_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-sm font-medium hover:underline"
          style={{ color: 'var(--color-primary)' }}
        >
          ดูทั้งหมด <ArrowRight size={14} />
        </a>
      </div>

      <div
        ref={wrapRef}
        className="w-full bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden dark:bg-white/10 dark:border-white/10 dark:shadow-none"
        style={{ minHeight: VISIBLE_H, height: VISIBLE_H }}
      >
        {src && (
          <iframe
            key={src}
            src={src}
            width={`${Math.round(100 / SCALE)}%`}
            height={Math.round(VISIBLE_H / SCALE)}
            style={{
              border: 'none',
              overflow: 'hidden',
              display: 'block',
              transform: `scale(${SCALE})`,
              transformOrigin: 'top left',
            }}
            scrolling="no"
            frameBorder="0"
            allowFullScreen
            allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
            title="Facebook Page Feed"
          />
        )}
      </div>
    </section>
  )
}
