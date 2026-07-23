import { useState, useRef, useEffect } from 'react'
import { Send, Sparkles, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTenant } from '../../contexts/TenantContext'
import { askGemini } from '../../lib/geminiChat'

const QUICK_PROMPTS = [
  { emoji: '🗑️', text: 'แจ้งปัญหาขยะ' },
  { emoji: '📄', text: 'ขอเอกสาร' },
  { emoji: '🔧', text: 'แจ้งซ่อมไฟถนน' },
  { emoji: '🗺️', text: 'แหล่งท่องเที่ยว' },
]

export default function AISearchCard() {
  const navigate = useNavigate()
  const { tenant } = useTenant()
  const [input, setInput] = useState('')
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)
  const [asked, setAsked] = useState(false)
  const answerRef = useRef(null)

  useEffect(() => {
    if (answer) answerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [answer])

  const ask = async (text) => {
    const q = (text || input).trim()
    if (!q || loading) return
    setInput(q)
    setAsked(true)
    setAnswer('')
    setLoading(true)

    try {
      const reply = await askGemini([], q, tenant?.name)
      setAnswer(reply)
    } catch {
      setAnswer('ขออภัยค่ะ เกิดข้อผิดพลาด ลองถามใหม่อีกครั้งนะคะ 🦖')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-2xl shadow-lg border border-gray-100 overflow-hidden bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3"
           style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, var(--color-primary-dark, #1e40af) 100%)' }}>
        <div className="w-10 h-10 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center text-xl shrink-0 shadow-inner">
          🦖
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-white font-bold text-sm">ถามน้องสมายล์ AI</p>
            <Sparkles size={12} className="text-yellow-300" />
          </div>
          <p className="text-white/60 text-[10px] truncate">ผู้ช่วยอัจฉริยะ · ตอบทันที 24 ชม.</p>
        </div>
        <button onClick={() => navigate('/search')}
          className="text-[10px] text-white/70 hover:text-white flex items-center gap-0.5 shrink-0 transition-colors">
          เต็มจอ <ChevronRight size={11} />
        </button>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        {/* Quick prompts */}
        {!asked && (
          <div className="flex flex-wrap gap-1.5">
            {QUICK_PROMPTS.map(p => (
              <button key={p.text} onClick={() => ask(p.text)}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-50 hover:bg-gray-100 rounded-full text-[11px] text-gray-600 font-medium transition-colors border border-gray-100">
                <span>{p.emoji}</span> {p.text}
              </button>
            ))}
          </div>
        )}

        {/* Search bar */}
        <form onSubmit={e => { e.preventDefault(); ask() }}
          className="flex gap-2 bg-gray-50 p-1 rounded-full border border-gray-200 focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="ถามอะไรก็ได้ เช่น วิธีแจ้งร้องเรียน..."
            className="flex-1 bg-transparent px-3 py-2 text-sm outline-none text-gray-700 placeholder-gray-400"
            disabled={loading}
          />
          <button type="submit" disabled={!input.trim() || loading}
            className="w-9 h-9 rounded-full flex items-center justify-center text-white transition-all shadow-sm shrink-0 disabled:opacity-30"
            style={{ backgroundColor: 'var(--color-primary, #2563eb)' }}>
            {loading
              ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : <Send size={14} className="ml-0.5" />
            }
          </button>
        </form>

        {/* Answer */}
        {(answer || loading) && (
          <div ref={answerRef}
            className="bg-gradient-to-br from-blue-50 to-sky-50 rounded-xl p-3 border border-blue-100 transition-all">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 bg-blue-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 bg-blue-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-1.5 h-1.5 bg-blue-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span>น้องสมายล์กำลังคิด...</span>
              </div>
            ) : (
              <div className="flex gap-2">
                <span className="text-lg shrink-0">🦖</span>
                <p className="text-[13px] text-gray-700 leading-relaxed whitespace-pre-wrap">{answer}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
