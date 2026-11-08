// กล่องประกาศใช้ / ยกเลิกประกาศ — ใช้ร่วมระหว่างแผนพัฒนา (DevPlanSheet) และแผนการดำเนินงาน (OpPlanTab)
// ระบบแค่เก็บข้อเท็จจริงที่ผู้บริหารท้องถิ่นลงนามไปแล้ว (วันที่ + เลขที่ประกาศ) ไม่ตัดสินแทน · ตัวตรวจจริงคือ RPC ในฐานข้อมูล
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { bangkokIsoDate } from '../../../lib/complaintReportPeriods'
import { Field } from '../construction/ui'
import { btnGhost, btnPrimary, inp } from '../construction/uiStyles'

/**
 * mode 'publish'   : วันที่ลงนามประกาศ (ไม่เกินวันนี้) + เลขที่ประกาศ (ไม่บังคับ — ฐานข้อมูลไม่บังคับ)
 * mode 'unpublish' : เหตุผล (บังคับ ลงประวัติ)
 * onSubmit คืน error string หรือ '' — กล่องแสดงให้เอง
 */
export default function PublishBox({ mode, subject, hint, onSubmit, onCancel }) {
  const today = bangkokIsoDate()
  const [publishedOn, setPublishedOn] = useState('')
  const [announceRefNo, setAnnounceRefNo] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isPublish = mode === 'publish'

  const submit = async () => {
    if (busy) return
    if (isPublish) {
      if (!publishedOn) return setError('ระบุวันที่ผู้บริหารลงนามประกาศ')
      if (publishedOn > today) return setError('วันที่ลงนามประกาศต้องไม่เกินวันนี้')
      if (announceRefNo.length > 200) return setError('เลขที่ประกาศยาวเกิน 200 ตัวอักษร')
    } else if (!reason.trim()) return setError('ระบุเหตุผลที่ยกเลิกประกาศ')
    else if (reason.length > 2000) return setError('เหตุผลยาวเกิน 2,000 ตัวอักษร')
    const question = isPublish
      ? `ประกาศใช้${subject}นี้?\n\nประกาศแล้วระบบจะแช่แข็งข้อมูลตามที่ระเบียบกำหนด — ถ้ากดผิด ยกเลิกประกาศได้ (ต้องระบุเหตุผล และลงประวัติ)`
      : `ยกเลิกประกาศ${subject}นี้?\n\nเหตุผลจะถูกบันทึกในประวัติ`
    if (!window.confirm(question)) return
    setBusy(true); setError('')
    const message = await onSubmit({ publishedOn, announceRefNo, reason })
    setBusy(false)
    if (message) setError(message)
  }

  return (
    <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-3 text-gray-800">
      <p className="text-sm font-bold">{isPublish ? `ประกาศใช้${subject}` : `ยกเลิกประกาศ${subject}`}</p>
      {hint && <p className="text-xs text-gray-600">{hint}</p>}
      {isPublish ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="วันที่ผู้บริหารลงนามประกาศ *">
            <input type="date" className={inp} value={publishedOn} max={today} onChange={e => setPublishedOn(e.target.value)} />
          </Field>
          <Field label="เลขที่ประกาศ">
            <input className={inp} value={announceRefNo} maxLength={200} onChange={e => setAnnounceRefNo(e.target.value)} />
          </Field>
        </div>
      ) : (
        <Field label="เหตุผลที่ยกเลิกประกาศ *">
          <textarea className={inp} rows={3} value={reason} maxLength={2000} onChange={e => setReason(e.target.value)} />
        </Field>
      )}
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} style={{ backgroundColor: isPublish ? 'var(--color-primary)' : '#b91c1c' }} onClick={submit} disabled={busy}>
          {busy && <Loader2 size={16} className="animate-spin" />}{isPublish ? 'ประกาศใช้' : 'ยกเลิกประกาศ'}
        </button>
        {onCancel && <button type="button" className={btnGhost} onClick={onCancel} disabled={busy}>ปิดกล่องนี้</button>}
      </div>
    </div>
  )
}
