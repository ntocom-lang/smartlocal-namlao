import { useState, useEffect } from 'react'
import { X, CheckCircle2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'

const RATINGS = [
  { value: 5, emoji: '😄', label: 'ยอดเยี่ยม', color: '#22c55e', bg: '#f0fdf4', border: '#86efac' },
  { value: 4, emoji: '😊', label: 'ดี',         color: '#3b82f6', bg: '#eff6ff', border: '#93c5fd' },
  { value: 3, emoji: '😐', label: 'พอสมควร',   color: '#f59e0b', bg: '#fffbeb', border: '#fcd34d' },
  { value: 2, emoji: '😢', label: 'แย่',         color: '#f97316', bg: '#fff7ed', border: '#fdba74' },
  { value: 1, emoji: '😡', label: 'แย่มาก',    color: '#ef4444', bg: '#fef2f2', border: '#fca5a5' },
]

// ข้อความตาม code ที่ rate_complaint() คืนมา — RPC ไม่ raise exception ในเคสธุรกิจปกติ
// เพราะอยากให้ UI แยกแยะได้ว่าควรให้ผู้ใช้ลองใหม่หรือควรปิดหน้าต่างไปเลย
const RPC_ERROR = {
  not_found:      'ไม่พบคำร้องนี้ในระบบแล้ว',
  not_closed:     'คำร้องยังไม่ปิดเรื่อง ให้คะแนนได้หลังเจ้าหน้าที่ปิดเรื่องแล้ว',
  not_owner:      'ให้คะแนนได้เฉพาะผู้ยื่นคำร้องเท่านั้น',
  invalid_rating: 'คะแนนไม่ถูกต้อง',
}

export default function SatisfactionModal({ onClose, complaintId = null, onRated = null, delayMs = 800 }) {
  const { tenant } = useTenant()
  const [visible, setVisible] = useState(false)
  const [selected, setSelected] = useState(null)
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delayMs)
    return () => clearTimeout(t)
  }, [delayMs])

  async function handleSubmit() {
    if (!selected) return
    setLoading(true)
    setError('')
    try {
      // เดิมไม่อ่าน error เลย ผู้ใช้เห็น "ขอบคุณ" ทุกครั้งแม้บันทึกไม่สำเร็จ คะแนนหายเงียบ
      // ข้อมูลชุดนี้ใช้ทำรายงาน LPA ตัวเลขที่ขาดหายแบบมองไม่เห็นร้ายกว่าการขึ้น error
      if (complaintId) {
        // ผูกกับคำร้อง: ต้องผ่าน RPC เท่านั้น เดิม insert + update complaints ตรงๆ ซึ่ง update
        // โดน RLS กรองทิ้งเงียบทุกครั้ง (ไม่มี UPDATE policy ให้ citizen) complaints.rating
        // จึงเป็น NULL ตลอด — ดู supabase/migrations/20260830150000_rate_complaint_rpc.sql
        const { data, error: err } = await supabase.rpc('rate_complaint', {
          p_complaint_id: complaintId,
          p_rating: selected,
          p_comment: comment.trim() || null,
        })
        if (err) throw err
        if (!data?.ok) {
          // ให้คะแนนไปแล้ว = งานสำเร็จอยู่แล้ว ไม่ต้องบังคับให้ผู้ใช้กดซ้ำจนกว่าจะยอมแพ้
          if (data?.code !== 'already_rated') {
            setError(RPC_ERROR[data?.code] ?? 'ส่งคะแนนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
            return
          }
        }
        onRated?.(complaintId, selected, data?.verified === true)
      } else {
        // ประเมินภาพรวมหน่วยงาน (เมนู "ประเมินความพึงพอใจ") ไม่ผูกคำร้อง
        const { error: err } = await supabase.from('satisfaction_ratings').insert({
          municipality_id: tenant?.id ?? null,
          rating: selected,
          comment: comment.trim() || null,
        })
        if (err) throw err
      }
      setDone(true)
      setTimeout(() => onClose?.(), 1800)
    } catch (err) {
      console.error('[satisfaction] บันทึกผลประเมินไม่สำเร็จ:', err?.message ?? err)
      setError('ส่งคะแนนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setLoading(false)
    }
  }

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm px-4 pb-4 sm:pb-0"
      onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden animate-slide-up">

        {done ? (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center">
              <CheckCircle2 size={36} className="text-green-500" />
            </div>
            <p className="text-lg font-bold text-gray-800">ขอบคุณสำหรับความคิดเห็น!</p>
            <p className="text-sm text-gray-500">ความคิดเห็นของคุณมีประโยชน์มาก</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <p className="text-sm font-bold text-gray-800">ประเมินความพึงพอใจ</p>
                <p className="text-xs text-gray-400 mt-0.5">กรุณาให้คะแนนการให้บริการ</p>
              </div>
              <button onClick={onClose}
                className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400 transition-colors">
                <X size={16} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-2">
              {RATINGS.map(r => (
                <button key={r.value} onClick={() => setSelected(r.value)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl border-2 transition-all active:scale-[0.98]"
                  style={{
                    backgroundColor: selected === r.value ? r.bg : '#f9fafb',
                    borderColor: selected === r.value ? r.border : '#e5e7eb',
                  }}>
                  <span className="text-2xl leading-none">{r.emoji}</span>
                  <span className="text-sm font-semibold" style={{ color: selected === r.value ? r.color : '#374151' }}>
                    {r.label}
                  </span>
                  {selected === r.value && (
                    <CheckCircle2 size={16} className="ml-auto" style={{ color: r.color }} />
                  )}
                </button>
              ))}

              {selected && (
                <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2}
                  placeholder="ความคิดเห็นเพิ่มเติม (ไม่บังคับ)"
                  className="w-full mt-1 border border-gray-200 rounded-2xl px-4 py-2.5 text-sm text-gray-800 bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-200" />
              )}

              {error && (
                <p className="text-xs text-red-500 text-center bg-red-50 border border-red-100 rounded-xl px-3 py-2 mt-1">
                  {error}
                </p>
              )}
            </div>

            <div className="flex gap-2 px-5 pb-5">
              <button onClick={handleSubmit} disabled={!selected || loading}
                className="flex-1 py-3 rounded-2xl text-sm font-bold text-white disabled:opacity-40 transition-opacity"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                {loading ? 'กำลังส่ง...' : 'ส่งคะแนน'}
              </button>
              <button onClick={onClose}
                className="px-4 py-3 rounded-2xl text-sm text-gray-500 bg-gray-100 hover:bg-gray-200 transition-colors">
                ข้าม
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
