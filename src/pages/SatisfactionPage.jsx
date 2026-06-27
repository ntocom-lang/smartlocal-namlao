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
    if (err) {
      setError('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง')
    } else {
      setDone(true)
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#f0f4fb' }}>

      {/* Header gradient */}
      <div className="relative text-white text-center px-6 pt-10 pb-14"
           style={{ background: 'linear-gradient(160deg, #1e40af 0%, #3b82f6 60%, #60a5fa 100%)' }}>
        <button
          onClick={() => navigate(-1)}
          className="absolute top-4 left-4 p-2 rounded-xl hover:bg-white/20 transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="text-5xl mb-3">📋</div>
        <h1 className="text-xl font-bold">ประเมินความพึงพอใจ</h1>
        <p className="text-white/80 text-sm mt-1">{tenant?.name}</p>
      </div>

      {/* Card */}
      <div className="flex-1 -mt-6 mx-4 bg-white rounded-3xl shadow-lg p-5 space-y-4 mb-8">

        {done ? (
          /* Success state */
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <CheckCircle2 size={64} className="text-green-400" strokeWidth={1.5} />
            <p className="text-xl font-bold text-gray-700">ขอบคุณสำหรับการประเมิน!</p>
            <p className="text-sm text-gray-400 text-center leading-relaxed">
              ความคิดเห็นของคุณมีคุณค่ามาก<br />
              เราจะนำไปพัฒนาบริการให้ดียิ่งขึ้น
            </p>
            <button
              onClick={() => navigate('/')}
              className="mt-4 px-8 py-3 rounded-2xl text-white font-bold text-sm transition-all hover:opacity-90 active:scale-95"
              style={{ background: 'linear-gradient(135deg, #1e40af, #3b82f6)' }}
            >
              กลับหน้าหลัก
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500 text-center pt-2">
              กรุณาให้คะแนนความพึงพอใจการให้บริการ
            </p>

            {/* Rating options */}
            <div className="space-y-2.5">
              {RATINGS.map(({ score, emoji, label }) => (
                <button
                  key={score}
                  onClick={() => setSelected(score)}
                  className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl border-2 transition-all active:scale-[0.98] ${
                    selected === score
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <span className="text-3xl">{emoji}</span>
                  <span className={`text-base font-semibold ${selected === score ? 'text-blue-700' : 'text-gray-700'}`}>
                    {label}
                  </span>
                  {selected === score && (
                    <span className="ml-auto w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center shrink-0">
                      <span className="w-2 h-2 rounded-full bg-white" />
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Optional comment */}
            <div className="pt-1">
              <label className="text-xs font-semibold text-gray-400 mb-1.5 block">ความคิดเห็นเพิ่มเติม (ไม่บังคับ)</label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="แนะนำหรือติชมเพื่อปรับปรุงบริการ..."
                rows={3}
                className="w-full px-4 py-3 text-sm text-gray-900 bg-white border border-gray-200 rounded-2xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>

            {error && (
              <p className="text-sm text-red-500 text-center">{error}</p>
            )}

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={!selected || submitting}
              className="w-full py-4 rounded-2xl text-white font-bold text-base transition-all active:scale-[0.98] disabled:opacity-50"
              style={{
                background: selected
                  ? 'linear-gradient(135deg, #1e40af, #3b82f6)'
                  : '#93c5fd',
              }}
            >
              {submitting
                ? <span className="flex items-center justify-center gap-2"><Loader2 size={18} className="animate-spin" /> กำลังส่ง...</span>
                : 'ส่งผลการประเมิน'}
            </button>
          </>
        )}
      </div>

      {/* Footer note */}
      {!done && (
        <p className="text-center text-xs text-gray-400 px-6 pb-8 leading-relaxed">
          ทุกความคิดเห็นของคุณจะเป็นประโยชน์ให้เรา<br />
          นำไปพัฒนา{tenant?.name}ให้ดียิ่งขึ้น
        </p>
      )}
    </div>
  )
}
