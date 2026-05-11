import { useEffect, useRef, useState } from 'react'
import { ArrowRight } from 'lucide-react'

const FB_PAGE_URL = 'https://www.facebook.com/profile.php?id=100068879483708'

function buildSrc(width) {
  return (
    'https://www.facebook.com/plugins/page.php' +
    '?href=' + encodeURIComponent(FB_PAGE_URL) +
    '&tabs=timeline' +
    '&width=' + width +
    '&height=400' +
    '&small_header=true' +
    '&adapt_container_width=true' +
    '&hide_cover=false' +
    '&show_facepile=false'
  )
}

export default function NewsSection() {
  const wrapRef = useRef(null)
  const [src, setSrc] = useState(null)

  useEffect(() => {
    if (!wrapRef.current) return

    const observer = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry.contentRect.width)
      if (w > 0) setSrc(buildSrc(w))
    })
    observer.observe(wrapRef.current)
    return () => observer.disconnect()
  }, [])

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-1 h-6 rounded-full" style={{ backgroundColor: 'var(--color-primary)' }} />
          <h2 className="text-base font-bold text-gray-700 dark:text-slate-200">ข่าวสารประชาสัมพันธ์</h2>
        </div>
        <a
          href={FB_PAGE_URL}
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
        style={{ minHeight: 400 }}
      >
        {src && (
          <iframe
            key={src}
            src={src}
            width="100%"
            height="400"
            style={{ border: 'none', overflow: 'hidden', display: 'block' }}
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
