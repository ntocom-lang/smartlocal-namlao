import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Camera, CheckCircle2, Loader2, MapPin, X } from 'lucide-react'
import MapPicker from '../MapPicker'
import { finishComplaint } from '../../lib/complaintFinish'

// กล่อง "ดำเนินการแล้ว" ใช้ร่วมทุกหน้า (แอดมิน / เจ้าหน้าที่ / ช่าง) — ขั้นสุดท้ายของคำร้อง
// เจ้าของระบบกำหนด 2569-09-15: ต้องปักหมุดจุดที่ดำเนินการ (ยกเว้นหมวดที่ตั้งไว้) รูปไม่บังคับ
// DB ตรวจซ้ำทุกข้อที่ finish_complaint() / guard_complaint_final_close_role() — ปุ่มที่นี่แค่กันกดเสียเที่ยว
export default function FinishComplaintDialog({ complaint, requiresPin = true, categoryLabel = '', tenantSlug, onDone, onCancel }) {
  const startPos = complaint?.latitude && complaint?.longitude
    ? { lat: complaint.latitude, lng: complaint.longitude }
    : null
  const [pin, setPin] = useState(null)
  const [showMap, setShowMap] = useState(false)
  const [files, setFiles] = useState([])
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const previews = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files])
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews])

  const blocked = requiresPin && !pin

  async function submit() {
    if (blocked) { setError('กรุณาปักหมุดจุดที่ดำเนินการก่อน'); return }
    setSaving(true)
    setError('')
    const { error: finishError, workPhotos } = await finishComplaint({
      complaint, pin, files, note, categoryLabel, tenantSlug,
    })
    setSaving(false)
    if (finishError) { setError(finishError.message); return }
    onDone?.({ pin, note: note.trim(), workPhotos })
  }

  // portal แยก DOM แต่ event ของ React ยังไหลตามต้นไม้คอมโพเนนต์: คลิกบนแผนที่ (portal ซ้อนอีกชั้น) จะไหลมาถึง
  // พื้นหลังกล่องนี้ และคลิกในกล่องจะไหลต่อไปถึงโมดัลรายละเอียดที่เปิดกล่องนี้ — ปิดเฉพาะคลิกที่พื้นหลังจริง
  // และหยุดไม่ให้ไหลต่อขึ้นไป
  function handleBackdropClick(e) {
    e.stopPropagation()
    if (e.target === e.currentTarget && !saving) onCancel?.()
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/45 p-0 sm:p-4" onClick={handleBackdropClick}>
      <div className="w-full max-w-md max-h-[92vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-base font-bold text-gray-800">บันทึก "ดำเนินการแล้ว"</p>
            <p className="text-xs text-gray-500 mt-0.5">
              ผู้ร้องจะได้รับแจ้งผล และแจ้งกลับได้ภายใน 7 วันถ้ายังไม่เรียบร้อย
            </p>
          </div>
          <button type="button" onClick={onCancel} disabled={saving} className="p-1 rounded-full hover:bg-gray-100 disabled:opacity-40">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {/* หมุดจุดที่ดำเนินการ */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
            <MapPin size={12} /> จุดที่ดำเนินการ {requiresPin ? <span className="text-red-500">(บังคับ)</span> : <span className="text-gray-400">(ไม่บังคับสำหรับหมวดนี้)</span>}
          </p>
          {pin ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2">
              <span className="text-xs font-medium text-green-800">{pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}</span>
              <button type="button" onClick={() => setShowMap(true)} className="text-xs font-semibold text-green-700 underline">ปักใหม่</button>
            </div>
          ) : (
            <button type="button" onClick={() => setShowMap(true)}
              className={`w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold border-2 border-dashed ${requiresPin ? 'border-orange-300 text-orange-700 bg-orange-50' : 'border-gray-200 text-gray-600 bg-gray-50'}`}>
              <MapPin size={14} /> ปักหมุดจุดที่ดำเนินการ
            </button>
          )}
        </div>

        {/* รูปผลงาน */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-600 flex items-center gap-1.5"><Camera size={12} /> รูปผลงาน (ไม่บังคับ)</p>
          <label className="flex items-center justify-center gap-2 w-full py-2 border-2 border-dashed border-gray-200 rounded-xl text-xs text-gray-500 cursor-pointer hover:border-blue-300">
            <Camera size={13} /> เพิ่มรูป
            <input type="file" accept="image/*" multiple className="hidden"
              onChange={(e) => { setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])].slice(0, 20)); e.target.value = '' }} />
          </label>
          {files.length > 0 && (
            <div className="grid grid-cols-4 gap-1.5">
              {previews.map((url, i) => (
                <div key={url} className="relative aspect-square rounded-xl overflow-hidden bg-gray-100">
                  <img src={url} alt="" className="w-full h-full object-cover" />
                  <button type="button" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute top-0.5 right-0.5 bg-black/50 rounded-full p-0.5">
                    <X size={10} className="text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* บันทึกผล */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-600">บันทึกผลการดำเนินงาน (ไม่บังคับ)</p>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000}
            placeholder="เช่น เปลี่ยนหลอดไฟ LED 18W จำนวน 2 ดวง"
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white resize-none focus:outline-none focus:ring-2 focus:ring-green-200" />
        </div>

        {error && <p className="text-xs font-medium text-red-600">{error}</p>}

        <div className="flex gap-2">
          <button type="button" onClick={submit} disabled={saving || blocked}
            className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold text-white bg-green-600 hover:bg-green-700 disabled:opacity-50">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} ยืนยันดำเนินการแล้ว
          </button>
          <button type="button" onClick={onCancel} disabled={saving}
            className="px-4 py-2.5 rounded-xl text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 disabled:opacity-50">
            ยกเลิก
          </button>
        </div>
      </div>

      {showMap && (
        <MapPicker
          initialPos={pin ?? startPos}
          fallbackPos={pin ?? startPos}
          onConfirm={({ lat, lng }) => { setPin({ lat, lng }); setError(''); setShowMap(false) }}
          onClose={() => setShowMap(false)}
        />
      )}
    </div>,
    document.body,
  )
}
