import { useState } from 'react'
import { Loader2, Undo2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { notifyTelegram } from '../../lib/notifyTelegram'
import { RETURN_REASON_MAX, validateReturnReason } from '../../lib/complaintIntake'

// ปุ่ม "ไม่ใช่งานของกองนี้" ของผู้รับผิดชอบ — ทางแก้ 1 คลิกของกรณีที่ระบบรับเรื่องเองแล้วส่งผิดกอง
// (ประชาชนเลือกหมวดผิด) เรื่องกลับไปคิวแอดมินพร้อมเหตุผล แทนการโทรตามแอดมินเอง
// สิทธิ์และเงื่อนไขจริงตรวจที่ return_complaint_to_intake() ฝั่ง DB ผู้เรียกใช้ canReturnComplaint() กันปุ่มโผล่ผิดที่
export default function ReturnToIntakeButton({ complaintId, onReturned }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function close() {
    setOpen(false)
    setReason('')
    setError('')
  }

  async function submit() {
    const invalid = validateReturnReason(reason)
    if (invalid) { setError(invalid); return }
    setSaving(true)
    const { error: rpcError } = await supabase.rpc('return_complaint_to_intake', {
      p_complaint_id: complaintId,
      p_reason: reason.trim(),
    })
    setSaving(false)
    if (rpcError) {
      setError('ส่งคืนไม่สำเร็จ: ' + rpcError.message)
      return
    }
    notifyTelegram('complaint_status_updated', complaintId)
    close()
    onReturned?.(complaintId)
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors">
        <Undo2 size={13} /> ไม่ใช่งานของกองนี้ — ส่งคืนแอดมิน
      </button>
    )
  }

  return (
    <div className="w-full space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-3">
      <p className="text-xs font-semibold text-amber-800">ส่งคืนให้แอดมินเลือกผู้รับผิดชอบใหม่</p>
      <textarea
        autoFocus
        rows={2}
        maxLength={RETURN_REASON_MAX}
        value={reason}
        onChange={(e) => { setReason(e.target.value); setError('') }}
        placeholder="เหตุผล เช่น เป็นงานของกองช่าง / ประชาชนเลือกหมวดผิด"
        className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-amber-300"
      />
      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={saving}
          className="flex-1 inline-flex items-center justify-center gap-1 py-2 rounded-xl text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 transition-colors">
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />} ยืนยันส่งคืน
        </button>
        <button type="button" onClick={close} disabled={saving}
          className="flex-1 py-2 rounded-xl text-xs font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-50 transition-colors">
          ยกเลิก
        </button>
      </div>
    </div>
  )
}
