import { useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { reopenComplaint } from '../../lib/complaintFinish'
import { REOPEN_REASON_MAX, reopenState, validateReopenReason } from '../../lib/complaintWorkflow'

// ผู้ร้องแจ้ง "ยังไม่เรียบร้อย" — เปิดเรื่องกลับได้ภายใน 7 วันหลังดำเนินการแล้ว 1 ครั้ง (เจ้าของระบบกำหนด 2569-09-15)
// ทดแทนขั้นตรวจรับของแอดมินที่ตัดออก: ผู้ร้องคือคนที่รู้ดีที่สุดว่างานเสร็จจริงหรือไม่
// เรื่องกลับไปผู้รับผิดชอบเดิมทันที — เงื่อนไขจริงตรวจที่ reopen_complaint() ฝั่ง DB
export default function ReopenComplaintBox({ complaint, userId, onReopened }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const state = reopenState(complaint, userId)

  if (complaint?.extra_data?.reopened_at && !state.allowed) {
    return (
      <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
        คุณแจ้งว่ายังไม่เรียบร้อยไปแล้วเมื่อ {new Date(complaint.extra_data.reopened_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}
        {' '}— ถ้ายังมีปัญหา กรุณายื่นคำร้องใหม่
      </p>
    )
  }
  if (!state.allowed) return null

  async function submit() {
    const invalid = validateReopenReason(reason)
    if (invalid) { setError(invalid); return }
    setSaving(true)
    const { status, error: rpcError } = await reopenComplaint(complaint.id, reason)
    setSaving(false)
    if (rpcError) { setError('แจ้งกลับไม่สำเร็จ: ' + rpcError.message); return }
    setOpen(false)
    onReopened?.(complaint.id, status, reason.trim())
  }

  return (
    <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4 space-y-2">
      <p className="text-sm font-bold text-orange-800">ยังไม่เรียบร้อย?</p>
      <p className="text-xs text-orange-700">
        แจ้งกลับให้ผู้รับผิดชอบดำเนินการต่อได้อีก {state.daysLeft} วัน (แจ้งกลับได้ 1 ครั้ง)
      </p>
      {open ? (
        <>
          <textarea value={reason} onChange={(e) => { setReason(e.target.value); setError('') }}
            rows={3} maxLength={REOPEN_REASON_MAX} autoFocus
            placeholder="เล่าสั้นๆ ว่ายังมีปัญหาอะไร เช่น ไฟยังดับอยู่ / ซ่อมแล้วแต่รั่วอีก"
            className="w-full rounded-xl border border-orange-200 bg-white px-3 py-2 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-orange-300" />
          {error && <p className="text-xs font-medium text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={submit} disabled={saving}
              className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold text-white bg-orange-600 disabled:opacity-50">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} ส่งเรื่องกลับ
            </button>
            <button type="button" onClick={() => { setOpen(false); setError('') }} disabled={saving}
              className="px-4 py-2.5 rounded-xl text-sm text-gray-600 bg-white border border-gray-200">
              ยกเลิก
            </button>
          </div>
        </>
      ) : (
        <button type="button" onClick={() => setOpen(true)}
          className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold text-orange-700 bg-white border border-orange-300">
          <RotateCcw size={14} /> แจ้งว่ายังไม่เรียบร้อย
        </button>
      )}
    </div>
  )
}
