import { useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { Sheet } from '../../patientTransport/StaffShell'
import { deleteAccount, friendlyError, insertAccount, updateAccount } from '../../../lib/wasteFeeApi'
import { PLACE_TYPES, UNIT_KG, accountPayload, currentMonthStart, fmtUnits, kgToUnits, monthStart, validateAccountForm } from '../../../lib/wasteFee'
import { btnGhost, btnPrimary, inp } from '../construction/uiStyles'
import Field from '../licence/Field'
import { fmtMonth, toMonthInput } from './format'

const EMPTY = { account_no: '', payer_name: '', payer_phone: '', house_no: '', village: '', address: '', place_type: 'house', monthly_units: '1', service_from: '', note: '' }
const toForm = a => ({ ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map(k => [k, a?.[k] ?? EMPTY[k]])), monthly_units: String(a?.monthly_units ?? 1), service_from: a?.service_from ?? currentMonthStart() })

/**
 * แผ่นเพิ่ม/แก้ข้อมูลบัญชีผู้ชำระ — ช่องคัดแยกขยะ (ลดค่ากำจัด) และการเลิกเก็บแก้ที่นี่ไม่ได้ ต้องใช้ปุ่มในแผ่น "ยอด/ประวัติ"
 * ปริมาณเป็นหน่วย (120 กก.) ทีละครึ่งหน่วย · ตัวช่วยแปลงกิโลกรัมต่อเดือนเป็นหน่วยตามข้อ ๑๐ · ไม่มีช่องเลขบัตรประชาชน (PDPA)
 */
export default function WasteFeeFormSheet({ tenantId, account, onClose, onSaved }) {
  const editing = Boolean(account)
  const [form, setForm] = useState(() => toForm(account))
  const [kg, setKg] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const kgUnits = kg.trim() === '' ? null : kgToUnits(kg)

  async function save() {
    const problem = validateAccountForm(form)
    if (problem) { setError(problem); return }
    setBusy(true); setError('')
    const payload = accountPayload(form)
    const result = editing ? await updateAccount(account.id, tenantId, payload) : await insertAccount(tenantId, payload)
    setBusy(false)
    if (result.error) { setError(friendlyError(result.error)); return }
    onSaved()
  }

  async function remove() {
    if (!window.confirm(`ลบบัญชี "${account.payer_name}" ออกจากทะเบียน? (ประวัติการแก้ไขยังเก็บไว้ — ถ้าแค่เลิกเก็บค่าธรรมเนียม ให้ใช้ปุ่ม "เลิกเก็บ" ในแผ่น ยอด/ประวัติ แทน)`)) return
    setBusy(true); setError('')
    const { error: err } = await deleteAccount(account.id, tenantId)
    setBusy(false)
    if (err) { setError(friendlyError(err)); return }
    onSaved()
  }

  return (
    <Sheet title={editing ? 'แก้ข้อมูลบัญชี' : 'เพิ่มบัญชีเข้าทะเบียน'} subtitle={editing ? account.payer_name : 'ทะเบียนค่าธรรมเนียมขยะ'} onClose={onClose} busy={busy} wide>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="เลขทะเบียน" hint="เลขทะเบียนเดิมของ อปท. (ถ้ามี) — ห้ามซ้ำในทะเบียนเดียวกัน"><input className={inp} maxLength={40} value={form.account_no} onChange={e => set('account_no', e.target.value)} /></Field>
          <Field label="ชื่อผู้ชำระ" required><input className={inp} maxLength={200} value={form.payer_name} onChange={e => set('payer_name', e.target.value)} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="เบอร์โทร"><input className={inp} inputMode="tel" maxLength={20} value={form.payer_phone} onChange={e => set('payer_phone', e.target.value)} /></Field>
          <Field label="ประเภทสถานที่" required>
            <select className={inp} value={form.place_type} onChange={e => set('place_type', e.target.value)}>
              {PLACE_TYPES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="บ้านเลขที่"><input className={inp} maxLength={50} value={form.house_no} onChange={e => set('house_no', e.target.value)} /></Field>
          <Field label="หมู่" hint="พิมพ์เลขหมู่อย่างเดียวได้ (เช่น 3 → หมู่ 3)"><input className={inp} maxLength={100} value={form.village} onChange={e => set('village', e.target.value)} /></Field>
        </div>
        <Field label="ที่อยู่/จุดสังเกต"><input className={inp} maxLength={500} value={form.address} onChange={e => set('address', e.target.value)} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="ปริมาณขยะต่อเดือน (หน่วย)" required hint={`1 หน่วย = ไม่เกิน ${UNIT_KG} กก. · ทีละครึ่งหน่วย (1, 1.5, 2 …) — บ้านทั่วไป = 1`}>
            <input className={inp} type="number" inputMode="decimal" min="0.5" max="10000" step="0.5" value={form.monthly_units} onChange={e => set('monthly_units', e.target.value)} />
          </Field>
          <Field label="เดือนแรกที่เก็บค่าธรรมเนียม" required hint={form.service_from ? `${fmtMonth(form.service_from)} — ระบบปัดเป็นวันที่ 1 ของเดือน` : undefined}>
            <input type="month" className={inp} value={toMonthInput(form.service_from)} onChange={e => set('service_from', monthStart(e.target.value) ?? '')} />
          </Field>
        </div>
        <div className="rounded-xl bg-gray-50 px-3 py-2.5">
          <p className="text-xs font-semibold text-gray-600">ตัวช่วย: รู้ปริมาณเป็นกิโลกรัม</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <input className={`${inp} !w-36`} inputMode="decimal" aria-label="ปริมาณขยะต่อเดือน (กิโลกรัม)" placeholder="กก. ต่อเดือน" value={kg} onChange={e => setKg(e.target.value)} />
            <span className="text-sm text-gray-700">{kg.trim() === '' ? '' : kgUnits === null ? 'กรอกตัวเลขบวก' : `= ${fmtUnits(kgUnits)} หน่วย`}</span>
            <button type="button" className={`${btnGhost} min-h-9 px-3 text-xs`} disabled={kgUnits === null} onClick={() => { set('monthly_units', String(kgUnits)); setKg('') }}>ใช้ค่านี้</button>
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-gray-500">
            ไม่เกิน {UNIT_KG} กก. = 1 หน่วย · เกินแล้วนับหน่วยละ {UNIT_KG} กก. เศษไม่เกินครึ่งหน่วยนับครึ่งหน่วย เกินครึ่งนับเต็มหน่วย (ตามข้อบัญญัติข้อว่าด้วยการปัดเศษ — ต้องยืนยันกับของ อปท. เอง)
          </p>
        </div>
        <Field label="หมายเหตุ" hint="ห้ามใส่เลขบัตรประชาชนหรือข้อมูลส่วนตัวอื่น — ประวัติการแก้ไขเก็บถาวร ลบย้อนหลังไม่ได้ (เบอร์โทรใส่ที่ช่อง เบอร์โทร)">
          <textarea className={inp} rows={2} maxLength={2000} value={form.note} onChange={e => set('note', e.target.value)} />
        </Field>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} disabled={busy} onClick={save}>
            {busy && <Loader2 size={15} className="animate-spin" />}บันทึก
          </button>
          <button type="button" className={btnGhost} onClick={onClose} disabled={busy}>ยกเลิก</button>
          {editing && <button type="button" className={`${btnGhost} ml-auto text-red-700`} onClick={remove} disabled={busy}><Trash2 size={15} />ลบบัญชีนี้</button>}
        </div>
      </div>
    </Sheet>
  )
}
