import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2, CheckCircle2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'

const RATINGS = [
  { score: 5, emoji: '😄', label: 'ยอดเยี่ยม' },
  { score: 4, emoji: '😊', label: 'ดี' },
  { score: 3, emoji: '😐', label: 'พอสมควร' },
  { score: 2, emoji: '😟', label: 'แย่' },
  { score: 1, emoji: '😡', label: 'แย่มาก' },
]

export default function SatisfactionPage() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const [selected, setSelected] = useState(null)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit() {
    if (!selected) return
    setSubmitting(true)
    setError(null)
    const { data: { session } } = await supabase.auth.getSession()
    const { error: err } = await supabase.from('satisfaction_responses').insert({
      municipality_id: tenant.id,
      score: selected,
      comment: comment.trim() || null,
      user_id: session?.user?.id ?? null,
    })
    setSubmitting(false)
    if (err) setError('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง')
    else setDone(true)
  }

  return (
    <div className="flex flex-col pb-20" style={{ minHeight: 'calc(100dvh - 64px)', backgroundColor: '#f0f4fb' }}>

      {/* Header — compact */}
      <div className="relative text-white text-center px-6 pt-5 pb-10 shrink-0"
           style={{ background: 'linear-gradient(160deg, #1e40af 0%, #3b82f6 60%, #60a5fa 100%)' }}>
        <button onClick={() => navigate(-1)}
          className="absolute top-3 left-3 p-2 rounded-xl hover:bg-white/20 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="text-3xl mb-1.5">📋</div>
        <h1 className="text-base font-bold">ประเมินความพึงพอใจ</h1>
        <p className="text-white/75 text-xs mt-0.5">{tenant?.name}</p>
      </div>

      {/* Card — pulls up over header */}
      <div className="flex-1 flex flex-col -mt-5 mx-3 bg-white rounded-2xl shadow-lg overflow-hidden">
        {done ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6">
            <CheckCircle2 size={56} className="text-green-400" strokeWidth={1.5} />
            <p className="text-lg font-bold text-gray-700">ขอบคุณสำหรับการประเมิน!</p>
            <p className="text-sm text-gray-400 text-center leading-relaxed">
              ความคิดเห็นของคุณมีคุณค่ามาก<br />เราจะนำไปพัฒนาบริการให้ดียิ่งขึ้น
            </p>
            <button onClick={() => navigate('/')}
              className="mt-2 px-8 py-2.5 rounded-2xl text-white font-bold text-sm active:scale-95 transition-all"
              style={{ background: 'linear-gradient(135deg, #1e40af, #3b82f6)' }}>
              กลับหน้าหลัก
            </button>
          </div>
        ) : (
          <div className="flex flex-col h-full p-4 gap-2.5">

            <p className="text-xs text-gray-400 text-center">กรุณาให้คะแนนความพึงพอใจการให้บริการ</p>

            {/* Rating options */}
            <div className="flex flex-col gap-1.5">
              {RATINGS.map(({ score, emoji, label }) => (
                <button
                  key={score}
                  onClick={() => setSelected(score)}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border-2 transition-all active:scale-[0.98] ${
                    selected === score
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-gray-100 bg-white hover:border-gray-200'
                  }`}
                >
                  <span className="text-2xl leading-none">{emoji}</span>
                  <span className={`text-sm font-semibold flex-1 text-left ${selected === score ? 'text-blue-700' : 'text-gray-700'}`}>
                    {label}
                  </span>
                  <span className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
                    selected === score ? 'border-blue-500 bg-blue-500' : 'border-gray-300'
                  }`}>
                    {selected === score && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </span>
                </button>
              ))}
            </div>

            {/* Comment */}
            <div>
              <label className="text-[11px] font-semibold text-gray-400 mb-1 block">ความคิดเห็นเพิ่มเติม (ไม่บังคับ)</label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="แนะนำหรือติชมเพื่อปรับปรุงบริการ..."
                rows={2}
                className="w-full px-3 py-2 text-sm text-gray-900 bg-white border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>

            {error && <p className="text-xs text-red-500 text-center">{error}</p>}

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={!selected || submitting}
              className="w-full py-3 rounded-xl text-white font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50"
              style={{ background: selected ? 'linear-gradient(135deg, #1e40af, #3b82f6)' : '#93c5fd' }}
            >
              {submitting
                ? <span className="flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" />กำลังส่ง...</span>
                : 'ส่งผลการประเมิน'}
            </button>

            <p className="text-center text-[10px] text-gray-300 leading-relaxed">
              ทุกความคิดเห็นของคุณจะนำไปพัฒนา{tenant?.name}ให้ดียิ่งขึ้น
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
