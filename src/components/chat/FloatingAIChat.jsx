import { useState, useRef, useEffect } from 'react'
import { Send, X, Minimize2 } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useTenant } from '../../contexts/TenantContext'
import { askGemini } from '../../lib/geminiChat'

// ─── Floating Chat Bubble ─────────────────────────────────────────────
export default function FloatingAIChat() {
  const { tenant } = useTenant()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([
    { id: 1, sender: 'bot', text: 'สวัสดีครับ ถามน้ำเลาใจดีได้เลยนะครับ 🤖' }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const endRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 300) }, [open])

  // ซ่อน FAB ในหน้า chatbot เต็มจอ, admin, staff
  const hide = ['/search', '/admin', '/staff'].some(p => location.pathname.startsWith(p))
  if (hide) return null

  const send = async (e) => {
    e?.preventDefault()
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    setMessages(p => [...p, { id: Date.now(), sender: 'user', text }])
    setLoading(true)
    try {
      const reply = await askGemini(messages, text, tenant?.name, tenant?.id)
      setMessages(p => [...p, { id: Date.now() + 1, sender: 'bot', text: reply }])
    } catch {
      setMessages(p => [...p, { id: Date.now() + 1, sender: 'bot', text: 'ขออภัยครับ เกิดข้อผิดพลาด ลองใหม่อีกครั้งนะครับ 🤖' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* ── Mini Chat Panel ── */}
      <div className={`fixed z-[60] transition-all duration-300 ${
        open
          ? 'bottom-20 md:bottom-6 left-3 md:left-6 opacity-100 translate-y-0 pointer-events-auto'
          : 'bottom-16 left-3 opacity-0 translate-y-4 pointer-events-none'
      }`}>
        <div className="w-[calc(100vw-24px)] max-w-sm bg-white rounded-3xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col"
             style={{ height: 'min(480px, calc(100dvh - 160px))' }}>

          {/* header */}
          <div className="flex items-center gap-3 px-4 py-3 text-white shrink-0"
               style={{ background: 'linear-gradient(135deg, var(--color-primary-dark, #1e40af) 0%, var(--color-primary, #2563eb) 100%)' }}>
            <img src="/images/nong-jaidee.png" alt="น้ำเลาใจดี" className="w-9 h-9 rounded-full object-cover border border-yellow-300 bg-white p-0.5 shrink-0" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex' }} />
            <div className="w-9 h-9 rounded-full bg-white/20 hidden items-center justify-center text-xl border border-white/30 shrink-0">🤖</div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm leading-tight">น้ำเลาใจดี AI</p>
              <p className="text-[10px] text-white/70 truncate">{tenant?.name || 'ผู้ช่วยอัจฉริยะ'}</p>
            </div>
            <button onClick={() => setOpen(false)} className="p-1.5 rounded-xl hover:bg-white/20 transition-colors">
              <Minimize2 size={16} />
            </button>
          </div>

          {/* messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-gradient-to-b from-blue-50/50 to-white">
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.sender === 'bot' && (
                  <img src="/images/nong-jaidee.png" alt="น้ำเลาใจดี" className="w-6 h-6 rounded-full object-cover mr-1.5 shrink-0 border border-yellow-300 bg-white p-0.5 shadow-xs" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex' }} />
                )}
                {msg.sender === 'bot' && (
                  <div className="w-6 h-6 rounded-full bg-white hidden items-center justify-center shadow-xs mr-1.5 shrink-0 border border-yellow-300 text-sm">🤖</div>
                )}
                <div className={`max-w-[80%] px-3 py-2 shadow-sm ${
                  msg.sender === 'user'
                    ? 'bg-emerald-500 text-white rounded-2xl rounded-tr-sm'
                    : 'bg-white text-gray-700 rounded-2xl rounded-tl-sm border border-gray-100'
                }`}>
                  <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <img src="/images/nong-jaidee.png" alt="น้ำเลาใจดี" className="w-6 h-6 rounded-full object-cover mr-1.5 shrink-0 border border-yellow-300 bg-white p-0.5 shadow-xs" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex' }} />
                <div className="w-6 h-6 rounded-full bg-white hidden items-center justify-center shadow-xs mr-1.5 shrink-0 border border-yellow-300 text-sm">🤖</div>
                <div className="bg-white px-4 py-3 rounded-2xl rounded-tl-sm border border-gray-100 shadow-sm flex items-center gap-1">
                  <div className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* input */}
          <form onSubmit={send} className="flex gap-2 p-2 border-t border-gray-100 bg-white shrink-0">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="ถามน้ำเลาใจดี..."
              className="flex-1 bg-gray-50 px-3 py-2 rounded-full text-sm outline-none focus:bg-gray-100 transition-colors text-gray-700 placeholder-gray-400"
              disabled={loading}
            />
            <button type="submit" disabled={!input.trim() || loading}
              className="w-9 h-9 rounded-full flex items-center justify-center text-white transition-colors shadow-sm shrink-0 disabled:opacity-40"
              style={{ backgroundColor: 'var(--color-primary, #2563eb)' }}>
              <Send size={15} className="ml-0.5" />
            </button>
          </form>
        </div>
      </div>

      {/* ── FAB Button ── */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`fixed z-[61] bottom-[76px] md:bottom-6 left-3 md:left-6 w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-all duration-300 active:scale-90 group ${
          open ? 'rotate-0' : 'hover:scale-110'
        }`}
        style={{
          background: open
            ? 'linear-gradient(135deg, #ef4444, #dc2626)'
            : 'linear-gradient(135deg, var(--color-primary-dark, #1e40af), var(--color-primary, #2563eb))',
        }}
        aria-label={open ? 'ปิดแชท' : 'เปิดแชท AI'}
      >
        {open
          ? <X size={22} className="text-white" />
          : (
            <>
              <img src="/images/nong-jaidee.png" alt="น้องใจดี" className="w-10 h-10 rounded-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'inline' }} />
              <span className="text-2xl hidden">🤖</span>
              {/* pulse ring */}
              <span className="absolute inset-0 rounded-full animate-ping opacity-20"
                style={{ backgroundColor: 'var(--color-primary, #2563eb)' }} />
            </>
          )
        }
      </button>
    </>
  )
}
