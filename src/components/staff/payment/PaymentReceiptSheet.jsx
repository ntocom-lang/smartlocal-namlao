import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Sheet } from '../../patientTransport/StaffShell'
import { friendlyError, recordReceipt } from '../../../lib/paymentDuesApi'
import { isIsoDate } from '../../../lib/licenceRegistry'
import { CHANNEL_LABEL, defaultRecordChannel, formatRef1, kindLabel, receiptPreview, recordChannelOptions, suggestedSurcharge } from '../../../lib/paymentDues'
import { btnGhost, btnPrimary, inp } from '../construction/uiStyles'
import Field from '../licence/Field'
import { fmtDate, fmtMoney } from '../licence/format'

/**
 * แผ่น "บันทึกเลขใบเสร็จ" ของยอดค้าง — เจ้าหน้าที่ยืนยันว่ารับเงินแล้วพร้อมเลขที่ใบเสร็จ (e-LAAS) ระบบปิดยอดและขยายวันของใบตามกฎ
 * ใบเสร็จรับเงินออกโดยหน่วยงานคลัง/e-LAAS — ระบบนี้เก็บแค่เลขที่ที่กรอก · ค่าปรับร้อยละ 20 ของยอดรายปีที่ชำระช้าเป็นยอดที่เสนอ แก้ได้
 * ตัวบังคับจริงคือ RPC payment_record_receipt (ผ่าน licence_record_fee) — ข้อความบนแผ่นนี้เป็นการบอกล่วงหน้า
 * type = ประเภทใบอนุญาต (เฉพาะผู้จัดการทะเบียนอ่านได้ — กองคลังไม่มี จึงไม่เห็นผลล่วงหน้าของการต่ออายุ ไม่เดาอายุใบ)
 * prefill = { paidOn, amount, channel } จากรายการเงินเข้าที่จับคู่แล้ว (แท็บ "เงินเข้าจากธนาคาร") — เติมวันที่รับ/ช่องทางให้ เหลือกรอกเลขที่ใบเสร็จ
 *   ยอดยังเป็นยอดค้างเสมอ (ฐานบังคับให้เท่ากับเงินเข้าตอนจับคู่) · วันที่แก้ได้ถ้าเงินเข้าจริงคนละวันกับในไฟล์
 */
export default function PaymentReceiptSheet({ due, settings, type, today, prefill = null, onClose, onSaved }) {
  const baseOptions = recordChannelOptions(settings, due.source)
  // ช่องทางจากไฟล์ธนาคารอาจไม่ได้เปิดไว้ในค่าตั้ง (เงินเข้าจริงแล้ว) — ยังต้องเลือกได้ ไม่งั้นเติมให้แล้วปุ่มไม่ขึ้นเลือก
  const options = prefill?.channel && !baseOptions.includes(prefill.channel) ? [prefill.channel, ...baseOptions] : baseOptions
  const [paidOn, setPaidOn] = useState(prefill?.paidOn && isIsoDate(prefill.paidOn) ? prefill.paidOn : today)
  const [amount] = useState(String(due.amount ?? ''))
  const [surcharge, setSurcharge] = useState(null) // null = ใช้ยอดที่ระบบเสนอ
  const [receiptNo, setReceiptNo] = useState('')
  const [channel, setChannel] = useState(prefill?.channel ?? defaultRecordChannel(settings, due.source))
  const [noChange, setNoChange] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const kind = due.kind
  const suggested = suggestedSurcharge({ ...due, amount }, paidOn)
  const surchargeValue = surcharge ?? String(suggested)
  const late = kind === 'annual' && isIsoDate(paidOn) && paidOn > due.due_on
  const preview = receiptPreview(due, type)
  // ต่ออายุ: วันรับเงินหลังวันหมดอายุ (due_on) บันทึกไม่ได้ — ฐานปฏิเสธอยู่แล้ว บอกล่วงหน้าให้แก้วันที่ก่อนกด
  const afterExpiry = kind === 'renewal' && isIsoDate(paidOn) && isIsoDate(due.due_on) && paidOn > due.due_on

  async function save() {
    if (!isIsoDate(paidOn)) { setError('ระบุวันที่ชำระ'); return }
    if (!(Number(amount) >= 0) || amount === '') { setError('ระบุจำนวนเงินค่าธรรมเนียม'); return }
    if (!receiptNo.trim()) { setError('ระบุเลขที่ใบเสร็จ (e-LAAS)'); return }
    if (!(Number(surchargeValue) >= 0)) { setError('ค่าปรับต้องไม่ติดลบ'); return }
    if (kind === 'renewal' && !noChange) { setError('ต้องติ๊กรับรองว่าผู้ประกอบการไม่เปลี่ยนแปลงสาระสำคัญ'); return }
    setBusy(true); setError('')
    const { error: err } = await recordReceipt({ dueId: due.id, paidOn, amount, receiptNo, channel, surcharge: surchargeValue, noMaterialChange: noChange })
    setBusy(false)
    if (err) { setError(friendlyError(err)); return }
    onSaved()
  }

  return (
    <Sheet title="บันทึกเลขใบเสร็จ" subtitle={`${due.business_name} · ${kindLabel(kind)} · Ref1 ${formatRef1(due.ref1)}`} onClose={onClose} busy={busy}>
      <div className="space-y-3">
        {prefill && (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-900">
            เงินเข้าจากไฟล์ธนาคารวันที่ <b>{fmtDate(prefill.paidOn)}</b> ยอด <b>{fmtMoney(prefill.amount)}</b> บาท — ระบบเติมวันที่และช่องทางให้แล้ว เหลือกรอกเลขที่ใบเสร็จ (e-LAAS)
          </p>
        )}
        <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-700">
          เจ้าหน้าที่ยืนยันว่ารับเงินแล้วพร้อมเลขที่ใบเสร็จ (ออกโดย อปท. ผ่าน e-LAAS) — ระบบปิดยอดนี้และขยายวันของใบตามกฎให้เอง ระบบไม่ออกใบเสร็จและไม่ลดหรือยกเว้นยอด
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="วันที่ชำระ" required hint={isIsoDate(paidOn) ? `พ.ศ.: ${fmtDate(paidOn)}` : undefined}>
            <input type="date" className={inp} max={today} value={paidOn} onChange={e => setPaidOn(e.target.value)} />
          </Field>
          <Field label="เลขที่ใบเสร็จ (e-LAAS)" required>
            <input className={inp} maxLength={60} value={receiptNo} onChange={e => setReceiptNo(e.target.value)} autoFocus={Boolean(prefill)} />
          </Field>
          {/* ยอดที่รับต้องเท่ายอดค้าง (ฐานปฏิเสธถ้าไม่เท่า) — แก้ไม่ได้ที่นี่ อัตราเปลี่ยนให้แก้ที่ทะเบียนแล้วปรับยอดค้าง · ค่าปรับแยกช่อง */}
          <Field label="ยอดที่รับ (บาท)" required hint="ต้องเท่ายอดค้าง — ถ้าอัตราค่าธรรมเนียมเปลี่ยน ให้แก้อัตราที่เมนูทะเบียนใบอนุญาตก่อน แล้วระบบจะปรับยอดให้">
            <input className={inp} inputMode="decimal" value={amount} readOnly aria-readonly="true" />
          </Field>
          {kind === 'annual' && (
            <Field label="ค่าปรับ (บาท)" hint={late
              ? `ชำระหลังวันครบกำหนด ${fmtDate(due.due_on)} — ระบบเสนอร้อยละ 20 ของค่าธรรมเนียม = ${fmtMoney(suggested)} บาท เจ้าหน้าที่ยืนยันหรือแก้ยอดได้`
              : 'ชำระภายในกำหนด ไม่มีค่าปรับ (ใส่เองได้ถ้ามี)'}>
              <input className={inp} inputMode="decimal" value={surchargeValue} onChange={e => setSurcharge(e.target.value)} />
            </Field>
          )}
        </div>
        <fieldset>
          <legend className="mb-1 block text-xs font-semibold text-gray-500">ช่องทางที่รับเงิน</legend>
          <div className="flex flex-wrap gap-2">
            {options.map(id => (
              <label key={id} className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm ${channel === id ? 'border-blue-300 bg-blue-50 font-semibold text-gray-900' : 'border-gray-200 text-gray-700'}`}>
                <input type="radio" name="payment-channel" className="size-4" checked={channel === id} onChange={() => setChannel(id)} />
                {CHANNEL_LABEL[id]}
              </label>
            ))}
          </div>
        </fieldset>
        {kind === 'renewal' && (
          <label className="flex items-start gap-2 rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-800">
            <input type="checkbox" className="mt-1 size-4" checked={noChange} onChange={e => setNoChange(e.target.checked)} />
            <span>ผู้ประกอบการรับรองว่า <b>ไม่เปลี่ยนแปลงสาระสำคัญ</b> ของใบอนุญาต (ถ้ามีการเปลี่ยนแปลง ต้องยื่นคำขอ ไม่ใช่ชำระค่าธรรมเนียมต่ออายุ)</span>
          </label>
        )}
        {preview && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">
            <p className="text-xs font-semibold">หลังกดยืนยัน</p>
            <p className="font-bold">{kind === 'renewal' ? 'ใบจะใช้ได้ถึง' : preview.label}: {fmtDate(kind === 'renewal' ? preview.to : preview.newDate)}</p>
            <p className="text-xs">รอบที่ชำระ {fmtDate(preview.from)} – {fmtDate(preview.to)}</p>
          </div>
        )}
        {afterExpiry && (
          <p role="status" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
            วันที่รับเงินอยู่หลังวันหมดอายุของใบ ({fmtDate(due.due_on)}) — ต่ออายุโดยชำระค่าธรรมเนียมไม่ได้แล้ว ถ้าเงินเข้าก่อนหรือในวันหมดอายุ ให้ใช้วันที่เงินเข้าจริงจากไฟล์ธนาคาร (แท็บ "เงินเข้าจากธนาคาร")
          </p>
        )}
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }}
            disabled={busy || (kind === 'renewal' && !noChange)} onClick={save}>
            {busy && <Loader2 size={15} className="animate-spin" />}ยืนยัน บันทึกเลขใบเสร็จ
          </button>
          <button type="button" className={btnGhost} onClick={onClose} disabled={busy}>ยกเลิก</button>
        </div>
      </div>
    </Sheet>
  )
}
