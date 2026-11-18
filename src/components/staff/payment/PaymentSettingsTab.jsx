import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { friendlyError, savePaymentSettings } from '../../../lib/paymentDuesApi'
import { CHANNEL_LABEL, accountChanged, settingsToForm, validateSettingsForm } from '../../../lib/paymentDues'
import { btnGhost, btnPrimary, inp, lbl } from '../construction/uiStyles'

const box = 'flex items-start gap-2 rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-800'

/**
 * แท็บ "ตั้งค่า" (เฉพาะแอดมิน — ตัวบังคับจริงคือ RPC payment_save_settings)
 *   เปิด/ปิดทีละช่อง ค่าเริ่มต้นปิดหมด ไม่มีปุ่มเปิดทั้งหมด · ไม่มีแถวตั้งค่า = ไม่รับเงินช่องไหนเลย
 *   บัญชีปลายทางเปลี่ยน = ขึ้นกล่องยืนยันก่อนบันทึก (ฐานลงประวัติ + ประทับเวลา ป้ายเตือน 30 วันแสดงให้ทุกคนที่ใช้เมนูเห็น)
 */
export default function PaymentSettingsTab({ tenantId, settings, departments, onSaved }) {
  const [form, setForm] = useState(() => settingsToForm(settings))
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const set = (key, value) => { setForm(prev => ({ ...prev, [key]: value })); setSaved(false); setConfirming(false) }
  const toggleChannel = id => set('licenceChannels', form.licenceChannels.includes(id) ? form.licenceChannels.filter(x => x !== id) : [...form.licenceChannels, id])

  function submit() {
    const problem = validateSettingsForm(form)
    if (problem) { setError(problem); return }
    setError('')
    if (accountChanged(settings, form) && !confirming) { setConfirming(true); return }
    void save()
  }

  async function save() {
    setBusy(true); setError('')
    const { error: err } = await savePaymentSettings(tenantId, form)
    setBusy(false); setConfirming(false)
    if (err) { setError(friendlyError(err)); return }
    setSaved(true)
    onSaved()
  }

  return (
    <section className="space-y-5 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <h2 className="text-base font-bold text-gray-900">ตั้งค่ารับชำระเงิน</h2>

      <div className="space-y-2">
        <span className={lbl}>ช่องทางรับชำระที่เปิดให้ใช้ (ค่าเริ่มต้นปิดทุกช่อง เปิดทีละช่อง)</span>
        <label className={box}><input type="checkbox" className="mt-1 size-4" checked={form.counter} onChange={e => set('counter', e.target.checked)} />
          <span><b>{CHANNEL_LABEL.counter}</b><span className="block text-xs text-gray-500">ผู้ประกอบการมาชำระที่ อปท. ในวันและเวลาราชการ</span></span></label>
        <label className={box}><input type="checkbox" className="mt-1 size-4" checked={form.promptpay} onChange={e => set('promptpay', e.target.checked)} />
          <span><b>{CHANNEL_LABEL.promptpay}</b><span className="block text-xs text-gray-500">QR ของบัญชี อปท. ระบุยอดเงินในใบแจ้งชำระ</span></span></label>
        <label className={box}><input type="checkbox" className="mt-1 size-4" checked={form.billPayment} onChange={e => set('billPayment', e.target.checked)} />
          <span><b>{CHANNEL_LABEL.bill_payment}</b><span className="block text-xs text-gray-500">QR ชำระข้ามธนาคารพร้อมเลข Ref1 ต่อยอด</span>
            <span className="mt-1 block text-xs font-semibold text-amber-800">ต้องทำสัญญาผู้รับชำระกับธนาคาร และลองสแกนจ่ายจริงก่อนเปิดให้ประชาชน</span></span></label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className={lbl}>เลขพร้อมเพย์ของ อปท.</span>
          <input className={inp} inputMode="numeric" maxLength={20} value={form.promptpayId} onChange={e => set('promptpayId', e.target.value)} />
          <span className="mt-1 block text-[11px] text-gray-500">เลขนิติบุคคล 13 หลัก หรือเบอร์มือถือ 10 หลัก</span></label>
        <label className="block"><span className={lbl}>รหัสผู้รับชำระ (Biller ID)</span>
          <input className={inp} inputMode="numeric" maxLength={20} value={form.billerId} onChange={e => set('billerId', e.target.value)} />
          <span className="mt-1 block text-[11px] text-gray-500">เลข 15 หลักที่ธนาคารออกให้ อปท.</span></label>
        <label className="block"><span className={lbl}>ธนาคาร</span>
          <input className={inp} maxLength={100} value={form.bankName} onChange={e => set('bankName', e.target.value)} /></label>
        <label className="block"><span className={lbl}>ชื่อบัญชีผู้รับ</span>
          <input className={inp} maxLength={200} value={form.payeeName} onChange={e => set('payeeName', e.target.value)} />
          <span className="mt-1 block text-[11px] text-gray-500">พิมพ์บนใบแจ้งชำระให้ผู้ชำระตรวจกับชื่อที่แอปธนาคารแสดงก่อนกดจ่าย</span></label>
      </div>

      <div className="space-y-2">
        <span className={lbl}>ค่าธรรมเนียมใบอนุญาตรับชำระช่องไหน</span>
        <div className="flex flex-wrap gap-2">
          {['counter', 'promptpay', 'bill_payment'].map(id => (
            <label key={id} className="flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 px-3 text-sm text-gray-800">
              <input type="checkbox" className="size-4" checked={form.licenceChannels.includes(id)} onChange={() => toggleChannel(id)} />{CHANNEL_LABEL[id]}
            </label>
          ))}
        </div>
        <label className={box}><input type="checkbox" className="mt-1 size-4" checked={form.elaasLicence} onChange={e => set('elaasLicence', e.target.checked)} />
          <span><b>ใบแจ้งหนี้ออกจาก e-LAAS อยู่แล้ว</b><span className="block text-xs text-gray-500">ระบบไม่สร้าง QR ซ้ำสำหรับค่าธรรมเนียมใบอนุญาต แต่ยังติดตามยอดค้างให้</span></span></label>
        <span className="block text-[11px] text-gray-500">ช่องที่ใช้ได้จริงของบริการ = ช่องที่ติ๊กตรงนี้ และเปิดอยู่ในช่องทางด้านบน</span>
      </div>

      <label className="block max-w-xs"><span className={lbl}>สร้างยอดค้างล่วงหน้ากี่วันก่อนครบกำหนด</span>
        <input className={inp} inputMode="numeric" maxLength={3} value={form.leadDays} onChange={e => set('leadDays', e.target.value)} />
        <span className="mt-1 block text-[11px] text-gray-500">1–180 วัน (ค่าเริ่มต้น 60) · ระบบสร้างยอดเองตามกฎ ไม่ต้องกรอกทุกรอบ</span></label>

      <div className="space-y-2">
        <label className={box}><input type="checkbox" className="mt-1 size-4" checked={form.financeCanRecord} onChange={e => set('financeCanRecord', e.target.checked)} />
          <span><b>ให้กองคลังบันทึกเลขใบเสร็จได้</b><span className="block text-xs text-gray-500">ตัวเลือก (ค่าเริ่มต้นปิด) · กองคลังเห็นชื่อร้าน เลขใบ Ref1 และยอด ไม่เห็นที่อยู่ผู้ประกอบการ และยกเลิกยอดไม่ได้</span></span></label>
        {form.financeCanRecord && (
          <label className="block"><span className={lbl}>เลือกกองคลัง</span>
            <select className={inp} value={form.financeDepartmentId} onChange={e => set('financeDepartmentId', e.target.value)}>
              <option value="">— เลือกกอง —</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select></label>
        )}
      </div>

      {confirming && (
        <div role="alertdialog" aria-label="ยืนยันการเปลี่ยนบัญชีรับเงิน" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-bold">ยืนยันการเปลี่ยนบัญชีรับเงิน</p>
          <p>การเปลี่ยนบัญชีจะถูกบันทึกในประวัติและแสดงให้ทุกคนที่ใช้เมนูนี้เห็น 30 วัน</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} disabled={busy} onClick={save}>
              {busy && <Loader2 size={15} className="animate-spin" />}ยืนยัน เปลี่ยนบัญชี
            </button>
            <button type="button" className={btnGhost} disabled={busy} onClick={() => setConfirming(false)}>กลับไปแก้</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {saved && !error && <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">บันทึกค่าตั้งแล้ว</p>}
      {!confirming && (
        <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} disabled={busy} onClick={submit}>
          {busy && <Loader2 size={15} className="animate-spin" />}บันทึกค่าตั้ง
        </button>
      )}
    </section>
  )
}
