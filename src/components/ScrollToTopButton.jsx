import { useState, useEffect } from 'react'
import { ChevronUp } from 'lucide-react'

export default function ScrollToTopButton() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = document.querySelector('main')
    if (!el) return
    const onScroll = () => setVisible(el.scrollTop > 300)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  if (!visible) return null

  return (
    <button
      onClick={() => document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="กลับขึ้นบน"
      className="scroll-to-top fixed bottom-24 right-4 md:bottom-6 md:right-6 z-50 w-11 h-11 rounded-full shadow-lg flex items-center justify-center transition-all active:scale-90"
      style={{ background: 'linear-gradient(135deg, var(--color-primary-dark), var(--color-primary))' }}
    >
      <ChevronUp size={22} className="text-white" strokeWidth={2.5} />
    </button>
  )
}
