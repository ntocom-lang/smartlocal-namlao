import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Sheet } from '../../patientTransport/StaffShell'
import { cancelDue, friendlyError } from '../../../lib/paymentDuesApi'
import { formatRef1, kindLabel } from '../../../lib/paymentDues'
import { btnGhost, btnPrimary, inp } from '../construction/uiStyles'
import Field from '../licence/Field'
import { fmtMoney } from '../licence/format'

/**
 * แผ่น "ยกเลิกยอด" — เฉพาะผู้จัดการทะเบียน (กองคลังไม่มีปุ่มนี้) ต้องใส่เหตุผล 3–1000 ตัวอักษร ลงประวัติ
 * ระบบไม่ยกเลิก/ยกเว้นยอดเอง · ยอดที่ยกเลิกแล้วระบบไม่สร้างกลับมาเอง (ใช้เมื่อยอดผิด)
 */
export default function PaymentCancelSheet({ due, onClose, onSaved }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    const text = reason.trim()
    if (text.length < 3) { setError('ต้องระบุเหตุผล (อย่างน้อย 3 ตัวอักษร)'); return }
    setBusy(true); setError('')
    const { error: err } = await cancelDue(due.id, text)
    setBusy(false)
    if (err) { setError(friendlyError(err)); return }
    onSaved()
  }

  return (
    <Sheet title="ยกเลิกยอด" subtitle={`${due.business_name} · ${kindLabel(due.kind)} · ${fmtMoney(due.amount)} บาท · Ref1 ${formatRef1(due.ref1)}`} onClose={onClose} busy={busy}>
      <div className="space-y-3">
        <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-700">
          ใช้เมื่อยอดนี้ไม่ควรมี (เช่น ยอดผิด) — เหตุผลจะถูกบันทึกในประวัติ และระบบจะไม่สร้างยอดของรอบนี้กลับมาเอง
        </p>
        <Field label="เหตุผลที่ยกเลิก" required>
          <textarea className={`${inp} min-h-24`} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} />
        </Field>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" className={btnPrimary} style={{ backgroundColor: '#b91c1c' }} disabled={busy} onClick={save}>
            {busy && <Loader2 size={15} className="animate-spin" />}ยืนยัน ยกเลิกยอด
          </button>
          <button type="button" className={btnGhost} onClick={onClose} disabled={busy}>ไม่ยกเลิก</button>
        </div>
      </div>
    </Sheet>
  )
}
