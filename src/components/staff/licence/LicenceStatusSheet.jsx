import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Sheet } from '../../patientTransport/StaffShell'
import { friendlyError, setStatus } from '../../../lib/licenceRegistryApi'
import { STATUS_LABEL, STATUS_ORDER_OPTIONS, SUSPEND_MAX_DAYS, addDays, suspendDays, validateStatusOrder } from '../../../lib/licenceRegistry'
import { btnGhost, btnPrimary, inp } from '../construction/uiStyles'
import Field from './Field'
import { fmtDate } from './format'

/**
 * แผ่น "บันทึกคำสั่ง" (พักใช้ / เพิกถอน / เลิกกิจการ / คืนสถานะใช้งาน)
 * พักใช้และเพิกถอนเป็นคำสั่งของเจ้าพนักงานท้องถิ่น — ระบบเก็บเลขที่คำสั่ง วัน และเหตุผลที่เจ้าหน้าที่กรอกเท่านั้น ไม่ตัดสินเอง
 */
export default function LicenceStatusSheet({ row, today, onClose, onSaved }) {
  const { licence } = row
  const options = STATUS_ORDER_OPTIONS.filter(o => o.value !== licence.status || o.value === 'suspended')
  const [status, setStatusValue] = useState(options[0]?.value ?? 'suspended')
  const [orderRef, setOrderRef] = useState('')
  const [reason, setReason] = useState('')
  const [from, setFrom] = useState(today)
  const [until, setUntil] = useState(addDays(today, SUSPEND_MAX_DAYS - 1))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const needsOrder = status === 'suspended' || status === 'revoked'
  const fromFinal = ['revoked', 'closed'].includes(licence.status) && status !== licence.status
  const days = status === 'suspended' ? suspendDays(from, until) : null

  async function save() {
    const problem = validateStatusOrder({ status, reason, orderRef, from, until, currentStatus: licence.status })
    if (problem) { setError(problem); return }
    setBusy(true); setError('')
    const { error: err } = await setStatus({ licenceId: licence.id, status, reason, orderRef, from: status === 'active' ? null : from, until: status === 'suspended' ? until : null })
    setBusy(false)
    if (err) { setError(friendlyError(err)); return }
    onSaved()
  }

  return (
    <Sheet title="บันทึกคำสั่ง" subtitle={`${licence.business_name} · สถานะปัจจุบัน ${STATUS_LABEL[licence.status]}`} onClose={onClose} busy={busy}>
      <div className="space-y-3">
        <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-700">
          พักใช้และเพิกถอนเป็นคำสั่งของเจ้าพนักงานท้องถิ่น — กรอกเลขที่คำสั่งและเหตุผลตามคำสั่งที่ออกแล้ว ระบบบันทึกและแสดงสถานะตามนั้น
          (พักใช้ได้ไม่เกิน {SUSPEND_MAX_DAYS} วัน ต้องยืนยันกับตัวบทฉบับปัจจุบัน)
        </p>
        <Field label="สถานะตามคำสั่ง" required>
          <select className={inp} value={status} onChange={e => setStatusValue(e.target.value)}>
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        {(needsOrder || fromFinal) && (
          <Field label="เลขที่คำสั่ง/หนังสือ" required
            hint={fromFinal ? 'ใบที่ถูกเพิกถอน/เลิกกิจการ เปลี่ยนสถานะได้เมื่อมีคำสั่ง/หนังสือที่ให้เปลี่ยน' : undefined}>
            <input className={inp} maxLength={200} value={orderRef} onChange={e => setOrderRef(e.target.value)} />
          </Field>
        )}
        {status !== 'active' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={status === 'suspended' ? 'พักใช้ตั้งแต่' : 'มีผลตั้งแต่'} required hint={`พ.ศ.: ${fmtDate(from)}`}>
              <input type="date" className={inp} value={from} onChange={e => setFrom(e.target.value)} />
            </Field>
            {status === 'suspended' && (
              <Field label="พักใช้ถึงวันที่" required hint={days ? `รวม ${days} วัน (พ.ศ.: ${fmtDate(until)})` : undefined}>
                <input type="date" className={inp} value={until} onChange={e => setUntil(e.target.value)} />
              </Field>
            )}
          </div>
        )}
        <Field label="เหตุผล" required><textarea className={inp} rows={3} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} /></Field>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} disabled={busy} onClick={save}>
            {busy && <Loader2 size={15} className="animate-spin" />}บันทึกคำสั่ง
          </button>
          <button type="button" className={btnGhost} onClick={onClose} disabled={busy}>ยกเลิก</button>
        </div>
      </div>
    </Sheet>
  )
}
