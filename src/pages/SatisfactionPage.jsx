import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2 } from 'lucide-react'
import { useTenant } from '../contexts/TenantContext'
import { supabase } from '../lib/supabase'

const RATINGS = [
  { value: 5, emoji: '😄', label: 'ยอดเยี่ยม',  color: '#22c55e', bg: '#f0fdf4', border: '#86efac' },
  { value: 4, emoji: '😊', label: 'ดี',          color: '#3b82f6', bg: '#eff6ff', border: '#93c5fd' },
  { value: 3, emoji: '😐', label: 'พอสมควร',    color: '#f59e0b', bg: '#fffbeb', border: '#fcd34d' },
  { value: 2, emoji: '😢', label: 'แย่',         color: '#f97316', bg: '#fff7ed', border: '#fdba74' },
  { value: 1, emoji: '😡', label: 'แย่มาก',     color: '#ef4444', bg: '#fef2f2', border: '#fca5a5' },
]

export default function SatisfactionPage() {
  const navigate = useNavigate()
  const { tenant } = useTenant()
  const [selected, setSelected] = useState(null)
  const [comment, setComment] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  const orgName = tenant?.name || 'หน่วยงาน'

  async function handleSubmit() {
    if (!selected) return
    setLoading(true)
    await supabase.from('satisfaction_ratings').insert({
      municipality_id: tenant?.id ?? null,
      rating: selected,
      comment: comment.trim() || null,
    })
    setLoading(false)
    setSubmitted(true)
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 pb-24 bg-white">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <div className="w-20 h-20 rounded-full flex items-center justify-center"
            style={{ backgroundColor: '#f0fdf4' }}>
            <CheckCircle2 size={44} className="text-green-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-800">ขอบคุณสำหรับความคิดเห็น</h2>
          <p className="text-gray-500 leading-relaxed text-sm">
            ความคิดเห็นของคุณจะเป็นประโยชน์ให้เรา<br />
            นำไปพัฒนา{orgName}ให้ดียิ่งขึ้น
          </p>
          <button
            onClick={() => navigate(-1)}
            className="mt-4 px-8 py-3 rounded-2xl font-bold text-white text-base"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            กลับหน้าหลัก
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white pb-28 md:pb-12">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white border-b border-gray-100">
        <div className="max-w-lg mx-auto flex items-center gap-3 px-4 py-3">
          <button onClick={() => navigate(-1)}
            className="p-2 -ml-1 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-base font-bold text-gray-800">ประเมินความพึงพอใจ</h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-5 pt-8 space-y-6">
        {/* Wave decoration */}
        <div className="rounded-3xl overflow-hidden shadow-sm"
          style={{ background: 'linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 100%)' }}>
          <div className="px-6 py-6 text-center text-white">
            <div className="text-4xl mb-2">📋</div>
            <h2 className="text-lg font-bold">ประเมินความพึงพอใจ</h2>
            <p className="text-sm text-white/80 mt-1">{orgName}</p>
          </div>
        </div>

        <p className="text-center text-gray-600 font-medium text-sm">
          กรุณาให้คะแนนความพึงพอใจการให้บริการ
        </p>

        {/* Rating options */}
        <div className="space-y-3">
          {RATINGS.map(r => (
            <button
              key={r.value}
              onClick={() => setSelected(r.value)}
              className="w-full flex items-center gap-4 px-5 py-4 rounded-2xl border-2 transition-all active:scale-[0.98]"
              style={{
                backgroundColor: selected === r.value ? r.bg : '#f9fafb',
                borderColor: selected === r.value ? r.border : '#e5e7eb',
                boxShadow: selected === r.value ? `0 0 0 2px ${r.color}30` : 'none',
              }}>
              <span className="text-4xl leading-none">{r.emoji}</span>
              <span className="text-lg font-bold" style={{ color: selected === r.value ? r.color : '#374151' }}>
                {r.label}
              </span>
              {selected === r.value && (
                <CheckCircle2 size={20} className="ml-auto" style={{ color: r.color }} />
              )}
            </button>
          ))}
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!selected || loading}
          className="w-full py-4 rounded-2xl font-bold text-white text-base disabled:opacity-40 transition-opacity"
          style={{ backgroundColor: 'var(--color-primary)' }}>
          {loading ? 'กำลังส่ง...' : 'ส่งผลการประเมิน'}
        </button>

        <p className="text-center text-xs text-gray-400 pb-4">
          ทุกความคิดเห็นของคุณจะเป็นประโยชน์ให้เรา<br />
          นำไปพัฒนา{orgName}ให้ดียิ่งขึ้น
        </p>
      </div>
    </div>
  )
}
