import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Archive, Loader2, X } from 'lucide-react'
import { parkComplaints } from '../../lib/complaintFinish'
import {
  PARK_NOTE_MAX, PARK_REASONS, PARKED_LABEL, PARKED_PUBLIC_NOTE, summarizeParkResult, validateParkInput,
} from '../../lib/complaintWorkflow'

// กล่อง "ขึ้นทะเบียนรอดำเนินการ" ใช้ทั้งทีละเรื่อง (หน้ารายละเอียด) และหลายเรื่อง (เลือกในตารางของแอดมิน)
// เรื่องที่ อปท. รับไว้แล้วแต่ยังไม่พร้อมดำเนินการ — เก็บรูป/พิกัดไว้เป็นข้อมูลความต้องการ ไม่ลบ ไม่ปิดเป็น
// "ดำเนินการแล้ว" และไม่ใช้ "ปฏิเสธ" · DB ตรวจสิทธิ์/หมวด/สถานะซ้ำทุกเรื่อง (park_complaints) เรื่องที่ทำไม่ได้ถูกข้าม
// ไม่ทำให้ทั้งชุดล้ม — ผลที่ข้ามแสดงในกล่องนี้ก่อนปิด
export default function ParkComplaintDialog({ ids, categoryLabel = '', onDone, onCancel }) {
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const count = ids.length
  const summary = result ? summarizeParkResult(result) : null

  async function submit() {
    const problem = validateParkInput({ reason, note })
    if (problem) { setError(problem); return }
    setSaving(true)
    setError('')
    const { result: res, error: rpcError } = await parkComplaints(ids, reason, note)
    setSaving(false)
    if (rpcError) { setError(rpcError.message || 'ขึ้นทะเบียนไม่สำเร็จ กรุณาลองใหม่'); return }
    // ทำครบทุกเรื่อง = ปิดกล่องเลย · มีเรื่องที่ข้าม = ให้อ่านเหตุผลก่อนปิด ไม่ให้ข้อความหายวับ
    if (!res?.skipped?.length) { onDone?.(res); return }
    setResult(res)
  }

  // portal แยก DOM แต่ event ของ React ยังไหลตามต้นไม้คอมโพเนนต์ — หยุดไม่ให้คลิกในกล่องไหลไปถึงโมดัลรายละเอียด
  function handleBackdropClick(e) {
    e.stopPropagation()
    if (e.target === e.currentTarget && !saving) (summary ? onDone?.(result) : onCancel?.())
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/45 p-0 sm:p-4" onClick={handleBackdropClick}>
      <div className="w-full max-w-md max-h-[92vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-base font-bold text-gray-800 flex items-center gap-1.5">
              <Archive size={16} className="text-slate-600" /> {PARKED_LABEL}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {count > 1 ? `${count} เรื่องที่เลือก` : 'เรื่องนี้'}{categoryLabel ? ` · ${categoryLabel}` : ''}
            </p>
          </div>
          <button type="button" onClick={summary ? () => onDone?.(result) : onCancel} disabled={saving}
            className="p-1 rounded-full hover:bg-gray-100 disabled:opacity-40" aria-label="ปิด">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {summary ? (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-gray-800">
              ขึ้นทะเบียนแล้ว {summary.parked} เรื่อง · ข้าม {summary.skippedCount} เรื่อง
            </p>
            <ul className="list-disc pl-5 space-y-1 text-xs text-gray-600">
              {summary.lines.map((line) => <li key={line}>{line}</li>)}
            </ul>
            <button type="button" onClick={() => onDone?.(result)}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white" style={{ backgroundColor: 'var(--color-primary)' }}>
              ตกลง
            </button>
          </div>
        ) : (
          <>
            <ul className="space-y-1 text-xs text-gray-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
              <li>• เก็บรูปและพิกัดไว้เป็นข้อมูลความต้องการ ไม่ลบ</li>
              <li>• ไม่นับเป็นงานค้างหรือเกินกำหนด และไม่ใช่ "ดำเนินการแล้ว"</li>
              <li>• ผู้ร้องเห็นสถานะ "{PARKED_LABEL}" พร้อมข้อความ: {PARKED_PUBLIC_NOTE}</li>
              <li>• นำกลับเข้าคิวงานได้ทุกเมื่อ (กำหนดเสร็จนับใหม่ตั้งแต่วันที่นำกลับ)</li>
            </ul>

            <fieldset className="space-y-1.5">
              <legend className="text-xs font-semibold text-gray-600 mb-1.5">เหตุผล (เลือก 1 ข้อ — ไม่แสดงให้ผู้ร้อง)</legend>
              {PARK_REASONS.map((item) => (
                <label key={item.code}
                  className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm cursor-pointer min-h-[44px] ${reason === item.code ? 'border-slate-500 bg-slate-50 text-gray-900 font-medium' : 'border-gray-200 text-gray-700'}`}>
                  <input type="radio" name="park-reason" value={item.code} checked={reason === item.code}
                    onChange={() => { setReason(item.code); setError('') }} className="accent-slate-700" />
                  {item.label}
                </label>
              ))}
            </fieldset>

            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-gray-600">
                หมายเหตุ {reason === 'other' ? <span className="text-red-500">(บังคับ)</span> : <span className="text-gray-400">(ไม่บังคับ)</span>}
              </p>
              <textarea value={note} onChange={(e) => { setNote(e.target.value); setError('') }} rows={2} maxLength={PARK_NOTE_MAX}
                placeholder="เช่น รอสำรวจเส้นทางร่วมกับกองช่าง"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white resize-none focus:outline-none focus:ring-2 focus:ring-slate-200" />
            </div>

            {error && <p className="text-xs font-medium text-red-600">{error}</p>}

            <div className="flex gap-2">
              <button type="button" onClick={submit} disabled={saving}
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold text-white bg-slate-700 hover:bg-slate-800 disabled:opacity-50">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Archive size={15} />}
                {count > 1 ? `ขึ้นทะเบียน ${count} เรื่อง` : 'ยืนยันขึ้นทะเบียน'}
              </button>
              <button type="button" onClick={onCancel} disabled={saving}
                className="px-4 py-2.5 rounded-xl text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 disabled:opacity-50">
                ยกเลิก
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
