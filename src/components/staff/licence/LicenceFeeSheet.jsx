import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Sheet } from '../../patientTransport/StaffShell'
import { friendlyError, recordFee } from '../../../lib/licenceRegistryApi'
import { checkAnnual, checkRenewal, feeButtonState, isIsoDate, isLateAnnual, previewFeeResult, suggestSurcharge } from '../../../lib/licenceRegistry'
import { btnGhost, btnPrimary, inp } from '../construction/uiStyles'
import Field from './Field'
import { fmtDate, fmtMoney } from './format'

/**
 * แผ่น "บันทึกรับค่าธรรมเนียม" — เจ้าหน้าที่ยืนยันการรับเงินพร้อมเลขใบเสร็จ (e-LAAS) ระบบแค่ขยายวันตามกฎ
 *   ใบอนุญาต: ต่ออายุโดยชำระค่าธรรมเนียมก่อน/ภายในวันสุดท้ายของใบ ต้องติ๊กรับรองว่าไม่เปลี่ยนแปลงสาระสำคัญ
 *   หนังสือรับรองการแจ้ง: ค่าธรรมเนียมรายปี · ชำระช้า → เสนอค่าปรับร้อยละ 20 ให้เจ้าหน้าที่แก้ยอดได้
 * ตัวบังคับจริงคือ RPC licence_record_fee — ข้อความบนแผ่นนี้เป็นการบอกล่วงหน้า
 */
export default function LicenceFeeSheet({ row, today, onClose, onSaved }) {
  const { licence, type } = row
  const state = feeButtonState({ licence, type, today })
  const kind = state.kind
  const [paidOn, setPaidOn] = useState(today)
  const [amount, setAmount] = useState(licence.fee_amount != null ? String(licence.fee_amount) : type?.default_fee != null ? String(type.default_fee) : '')
  const [receiptNo, setReceiptNo] = useState('')
  const [surcharge, setSurcharge] = useState(null) // null = ใช้ยอดที่ระบบเสนอ
  const [noChange, setNoChange] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const late = kind === 'annual' && isLateAnnual(paidOn, licence.next_fee_due_on)
  const suggested = late ? suggestSurcharge(amount) : 0
  const surchargeValue = surcharge ?? String(suggested)
  // ผลตรวจตามด่านเดียวกับ RPC (ต่ออายุ: ก่อนสิ้นอายุ/ช่วงล่วงหน้า/ไม่ซ้อน 1 รอบ · รายปี: ไม่ซ้อน 1 รอบ) (ติ๊กรับรองตรวจที่ปุ่มยืนยันแยกต่างหาก)
  const renewal = kind === 'renewal' ? checkRenewal({ licence, type, paidOn }) : checkAnnual({ licence, paidOn })
  const blocking = renewal.ok ? '' : renewal.reason
  const preview = blocking ? null : previewFeeResult({ kind, licence, type })

  async function save() {
    if (!isIsoDate(paidOn)) { setError('ระบุวันที่ชำระ'); return }
    if (!(Number(amount) >= 0) || amount === '') { setError('ระบุจำนวนเงินค่าธรรมเนียม'); return }
    if (!receiptNo.trim()) { setError('ระบุเลขที่ใบเสร็จ (e-LAAS)'); return }
    if (!(Number(surchargeValue) >= 0)) { setError('ค่าปรับต้องไม่ติดลบ'); return }
    if (kind === 'renewal' && !noChange) { setError('ต้องติ๊กรับรองว่าผู้ประกอบการไม่เปลี่ยนแปลงสาระสำคัญ'); return }
    setBusy(true); setError('')
    const { error: err } = await recordFee({ licenceId: licence.id, kind, paidOn, amount, receiptNo, surcharge: surchargeValue, noMaterialChange: noChange })
    setBusy(false)
    if (err) { setError(friendlyError(err)); return }
    onSaved()
  }

  return (
    <Sheet title="บันทึกรับค่าธรรมเนียม" subtitle={`${licence.business_name} · ${type?.name ?? ''}`} onClose={onClose} busy={busy}>
      <div className="space-y-3">
        <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-700">
          {kind === 'renewal'
            ? 'ต่ออายุโดยชำระค่าธรรมเนียม (พ.ร.ฎ. 2564): เจ้าหน้าที่ยืนยันว่ารับเงินแล้วพร้อมเลขที่ใบเสร็จ — ระบบขยายวันหมดอายุตามอายุใบของประเภทนี้ ต้องยืนยันกับตัวบทฉบับปัจจุบัน'
            : 'ค่าธรรมเนียมรายปีของหนังสือรับรองการแจ้ง: เจ้าหน้าที่ยืนยันว่ารับเงินแล้วพร้อมเลขที่ใบเสร็จ — ระบบเลื่อนวันครบกำหนดไปอีก 12 เดือน'}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="วันที่ชำระ" required hint={isIsoDate(paidOn) ? `พ.ศ.: ${fmtDate(paidOn)}` : undefined}>
            <input type="date" className={inp} max={today} value={paidOn} onChange={e => setPaidOn(e.target.value)} />
          </Field>
          <Field label="เลขที่ใบเสร็จ (e-LAAS)" required>
            <input className={inp} maxLength={60} value={receiptNo} onChange={e => setReceiptNo(e.target.value)} />
          </Field>
          <Field label="ค่าธรรมเนียม (บาท)" required>
            <input className={inp} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
          </Field>
          {kind === 'annual' && (
            <Field label="ค่าปรับ (บาท)" hint={late
              ? `ชำระหลังวันครบกำหนด ${fmtDate(licence.next_fee_due_on)} — ระบบเสนอร้อยละ 20 ของค่าธรรมเนียม = ${fmtMoney(suggested)} บาท เจ้าหน้าที่ยืนยันหรือแก้ยอดได้`
              : 'ชำระภายในกำหนด ไม่มีค่าปรับ (ใส่เองได้ถ้ามี)'}>
              <input className={inp} inputMode="decimal" value={surchargeValue} onChange={e => setSurcharge(e.target.value)} />
            </Field>
          )}
        </div>
        {kind === 'renewal' && (
          <label className="flex items-start gap-2 rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-800">
            <input type="checkbox" className="mt-1 size-4" checked={noChange} onChange={e => setNoChange(e.target.checked)} />
            <span>ผู้ประกอบการรับรองว่า <b>ไม่เปลี่ยนแปลงสาระสำคัญ</b> ของใบอนุญาต (ถ้ามีการเปลี่ยนแปลง ต้องยื่นคำขอ ไม่ใช่ชำระค่าธรรมเนียมต่ออายุ)</span>
          </label>
        )}
        {preview && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">
            <p className="text-xs font-semibold">หลังกดยืนยัน</p>
            <p className="font-bold">{preview.label}: {fmtDate(preview.newDate)}</p>
            <p className="text-xs">รอบที่ชำระ {fmtDate(preview.from)} – {fmtDate(preview.to)}</p>
          </div>
        )}
        {blocking && <p role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{blocking}</p>}
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }}
            disabled={busy || !state.enabled || Boolean(blocking) || (kind === 'renewal' && !noChange)} onClick={save}>
            {busy && <Loader2 size={15} className="animate-spin" />}ยืนยัน บันทึกรับค่าธรรมเนียม
          </button>
          <button type="button" className={btnGhost} onClick={onClose} disabled={busy}>ยกเลิก</button>
        </div>
      </div>
    </Sheet>
  )
}
