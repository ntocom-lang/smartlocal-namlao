import { useMemo, useState } from 'react'
import { AlertCircle, ArrowLeft, Check, Loader2, Pencil, Sparkles } from 'lucide-react'
import { polishComplaintText } from '../../lib/complaintTextPolish'

// กล่องทวนคำร้องก่อนส่ง — แทนกล่องยินยอม PDPA เดิมที่มีแต่ข้อความยินยอม
// เจ้าของระบบกำหนด 2569-09-17: ผู้ร้องต้องเห็นสิ่งที่จะส่งทั้งหมดก่อน กลับไปแก้ได้
// และถ้าระบบเรียบเรียงข้อความให้ได้ ต้องแสดงให้เลือก — ห้ามเปลี่ยนข้อความให้เอง
//
// ตัวหนังสือในกล่องนี้ตั้งใจให้ใหญ่กว่าปกติ ผู้ใช้จำนวนมากเป็นผู้สูงอายุที่อ่านตัวเล็กไม่ออก
// แล้วจะกดยืนยันผ่านโดยไม่อ่าน ซึ่งทำให้ขั้นตอนทวนนี้ไม่มีความหมาย
export default function ComplaintReviewSheet({
  summary = [],
  detail,
  photoCount = 0,
  orgName = 'หน่วยงาน',
  submitting = false,
  submitLabel = 'ยืนยันและส่ง',
  onPdpaClick,
  onBack,
  onConfirm,
}) {
  const { polished, changes } = useMemo(() => polishComplaintText(detail), [detail])
  const hasSuggestion = changes.length > 0 && polished.trim() && polished.trim() !== String(detail ?? '').trim()

  // 'original' = ข้อความของผู้ร้อง (ค่าเริ่มต้นเสมอ) · 'system' = ฉบับที่ระบบเรียบเรียง · 'edited' = แก้เอง
  const [source, setSource] = useState('original')
  const [editedText, setEditedText] = useState('')
  const [editing, setEditing] = useState(false)

  const finalText = source === 'system' ? polished : source === 'edited' ? editedText : detail

  function startEditing(base) {
    setEditedText(base)
    setSource('edited')
    setEditing(true)
  }

  return (
    <div className="fixed inset-0 z-200 flex items-end bg-black/40" onClick={submitting ? undefined : onBack}>
      <div className="w-full max-w-lg mx-auto max-h-[92vh] overflow-y-auto bg-white rounded-t-3xl px-5 pt-5 pb-8 space-y-4"
        onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 className="font-bold text-gray-900 text-lg">ตรวจทานก่อนส่ง</h2>
          <p className="text-sm text-gray-500 mt-0.5">ถ้ามีอะไรไม่ถูกต้อง กดปุ่มด้านล่างเพื่อกลับไปแก้ไขได้</p>
        </div>

        {/* สิ่งที่จะส่ง */}
        <dl className="rounded-2xl border border-gray-200 divide-y divide-gray-100">
          {summary.filter((row) => row?.value).map((row) => (
            <div key={row.label} className="flex gap-3 px-4 py-2.5">
              <dt className="w-24 shrink-0 text-sm text-gray-500">{row.label}</dt>
              <dd className="flex-1 text-base font-medium text-gray-800 break-words">{row.value}</dd>
            </div>
          ))}
          {photoCount > 0 && (
            <div className="flex gap-3 px-4 py-2.5">
              <dt className="w-24 shrink-0 text-sm text-gray-500">รูปที่แนบ</dt>
              <dd className="flex-1 text-base font-medium text-gray-800">{photoCount} รูป</dd>
            </div>
          )}
        </dl>

        {/* ข้อความคำร้อง */}
        <div className="space-y-2">
          <p className="text-sm font-semibold text-gray-700">ข้อความคำร้องที่จะส่ง</p>

          {editing ? (
            <>
              <textarea value={editedText} onChange={(e) => setEditedText(e.target.value)} rows={6} maxLength={5000}
                className="w-full rounded-2xl border-2 border-blue-300 px-4 py-3 text-base text-gray-800 bg-white resize-y focus:outline-none" />
              <button type="button" onClick={() => setEditing(false)}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-blue-700 bg-blue-50 border border-blue-200">
                เสร็จแล้ว
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setSource('original')}
                className={`w-full text-left rounded-2xl border-2 px-4 py-3 ${source === 'original' ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-white'}`}>
                <span className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                  {source === 'original' && <Check size={15} className="text-green-600" />} ข้อความของคุณ
                </span>
                <span className="mt-1 block text-base text-gray-800 whitespace-pre-wrap">{detail}</span>
              </button>

              {hasSuggestion && (
                <button type="button" onClick={() => setSource('system')}
                  className={`w-full text-left rounded-2xl border-2 px-4 py-3 ${source === 'system' ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-white'}`}>
                  <span className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                    {source === 'system' ? <Check size={15} className="text-green-600" /> : <Sparkles size={15} className="text-amber-500" />}
                    ฉบับที่ระบบช่วยเรียบเรียง
                  </span>
                  <span className="mt-1 block text-base text-gray-800 whitespace-pre-wrap">{polished}</span>
                  <span className="mt-2 block text-xs text-gray-500">
                    ระบบแก้ให้: {changes.slice(0, 4).map((c) => `${c.from} → ${c.to}`).join(' · ')}
                    {changes.length > 4 ? ` และอีก ${changes.length - 4} จุด` : ''}
                  </span>
                </button>
              )}

              {source === 'edited' && (
                <div className="rounded-2xl border-2 border-green-500 bg-green-50 px-4 py-3">
                  <span className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <Check size={15} className="text-green-600" /> ข้อความที่คุณแก้เอง
                  </span>
                  <span className="mt-1 block text-base text-gray-800 whitespace-pre-wrap">{editedText}</span>
                </div>
              )}

              <button type="button" onClick={() => startEditing(finalText)}
                className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold text-gray-700 bg-gray-100">
                <Pencil size={14} /> แก้ข้อความเอง
              </button>
            </>
          )}

          {!finalText?.trim() && (
            <p className="flex items-center gap-1.5 text-sm font-medium text-red-600">
              <AlertCircle size={14} /> ข้อความคำร้องต้องไม่ว่าง
            </p>
          )}
        </div>

        <p className="text-sm text-gray-600 leading-relaxed">
          ข้าพเจ้ารับรองว่าข้อมูลถูกต้องและเป็นความจริง และยินยอมให้{orgName}เก็บข้อมูลส่วนบุคคลเพื่อดำเนินการตามคำร้อง ตาม{' '}
          <a href="#" className="underline" style={{ color: 'var(--color-primary)' }}
            onClick={(e) => { e.preventDefault(); onPdpaClick?.() }}>นโยบายความเป็นส่วนตัว (PDPA)</a>
        </p>

        <div className="flex gap-3">
          <button type="button" onClick={onBack} disabled={submitting}
            className="flex-1 inline-flex items-center justify-center gap-1.5 py-3 rounded-2xl border border-gray-200 text-gray-600 text-sm font-medium disabled:opacity-50">
            <ArrowLeft size={15} /> กลับไปแก้ไข
          </button>
          <button type="button" disabled={submitting || !finalText?.trim()}
            onClick={() => onConfirm?.({ detail: finalText.trim(), source, original: String(detail ?? '').trim() })}
            className="flex-1 py-3 rounded-2xl font-semibold text-white text-sm disabled:opacity-60"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            {submitting ? <Loader2 size={16} className="animate-spin mx-auto" /> : submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
