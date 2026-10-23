import { useState } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'
import { Notice } from './EsignBits'
import { ESIGN_DUTY_TEXT, esignFailureText } from '../../lib/esign'
import { setEsignPin } from '../../lib/esignApi'
import { PIN_INPUT_CLASS, isPin } from '../../lib/esignUi'

// ฟอร์มตั้ง/เปลี่ยนรหัสลงนาม 6 หลัก — ใช้ทั้งในหน้า "ลายเซ็นของฉัน" และในกล่องลงนาม (คนที่ยังไม่เคยตั้งรหัสตั้งได้ตรงนั้นเลย)
// ตั้งครั้งแรก: ต้องติ๊กรับทราบหน้าที่ของเจ้าของลายมือชื่อ · เปลี่ยนรหัส: ต้องใส่รหัสเดิม (ใช้ตัวนับผิด/ล็อกชุดเดียวกับตอนลงนาม)
// onDone(result) เรียกเมื่อบันทึกสำเร็จ — ผู้เรียกโหลดสถานะใหม่เอง
export default function PinForm({ pinSet, onDone }) {
  const [form, setForm] = useState({ current: '', next: '', confirm: '', ack: false })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  const mismatch = form.confirm.length > 0 && form.next !== form.confirm
  const ready = isPin(form.next) && form.next === form.confirm && (pinSet ? isPin(form.current) : form.ack)
  const digits = key => event => setForm(current => ({ ...current, [key]: event.target.value.replace(/\D/g, '') }))

  async function handleSave() {
    setBusy(true)
    setNotice(null)
    const result = await setEsignPin({ pin: form.next, currentPin: pinSet ? form.current : null, ackDuty: !pinSet && form.ack })
    setBusy(false)
    if (!result?.ok) { setNotice({ ok: false, text: esignFailureText(result) }); return }
    setNotice({ ok: true, text: pinSet ? 'เปลี่ยนรหัสลงนามแล้ว' : 'ตั้งรหัสลงนามแล้ว — ใช้รหัสนี้ยืนยันทุกครั้งที่ลงนาม' })
    setForm({ current: '', next: '', confirm: '', ack: false })
    onDone?.(result)
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-gray-500">
        รหัสตัวเลข 6 หลักที่คุณตั้งเอง ใช้ยืนยันทุกครั้งที่ลงนาม แยกจากรหัสผ่านเข้าระบบ (บัญชี LINE/Google ก็ใช้ได้) ระบบเก็บแบบเข้ารหัส ผู้ดูแลระบบก็อ่านไม่ได้
        ใส่ผิด 5 ครั้งติดกันระบบล็อก 15 นาที
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {pinSet && (
          <label className="block text-xs font-semibold text-gray-600" htmlFor="esign-pin-current">รหัสเดิม
            <input id="esign-pin-current" name="esign-pin-current" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={6} autoComplete="off"
              value={form.current} onChange={digits('current')} className={`${PIN_INPUT_CLASS} mt-1`} />
          </label>
        )}
        <label className="block text-xs font-semibold text-gray-600" htmlFor="esign-pin-next">รหัสใหม่ 6 หลัก
          <input id="esign-pin-next" name="esign-pin-next" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={6} autoComplete="off"
            value={form.next} onChange={digits('next')} className={`${PIN_INPUT_CLASS} mt-1`} />
        </label>
        <label className="block text-xs font-semibold text-gray-600" htmlFor="esign-pin-confirm">ยืนยันรหัสใหม่
          <input id="esign-pin-confirm" name="esign-pin-confirm" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={6} autoComplete="off"
            value={form.confirm} onChange={digits('confirm')} className={`${PIN_INPUT_CLASS} mt-1`} />
        </label>
      </div>
      {mismatch && <p className="text-xs text-red-600" data-pin-mismatch>รหัสที่ยืนยันไม่ตรงกับรหัสใหม่</p>}
      {!pinSet && (
        <label className="flex items-start gap-2.5 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs leading-5 text-gray-700" htmlFor="esign-duty-ack">
          <input id="esign-duty-ack" type="checkbox" checked={form.ack} onChange={event => setForm(current => ({ ...current, ack: event.target.checked }))} className="mt-1 h-4 w-4 shrink-0" />
          <span>{ESIGN_DUTY_TEXT}</span>
        </label>
      )}
      <button type="button" onClick={handleSave} disabled={!ready || busy} data-save-pin
        className="inline-flex min-h-11 items-center gap-2 rounded-xl px-5 text-sm font-bold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--color-primary)' }}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} {pinSet ? 'เปลี่ยนรหัส' : 'ตั้งรหัสลงนาม'}
      </button>
      <Notice notice={notice} />
    </div>
  )
}
