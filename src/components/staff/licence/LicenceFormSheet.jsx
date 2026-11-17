import { useEffect, useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { Sheet } from '../../patientTransport/StaffShell'
import { deleteLicence, fetchHistory, friendlyError, insertLicence, updateLicence } from '../../../lib/licenceRegistryApi'
import { docKindLabel, suggestExpiry, validateLicenceForm } from '../../../lib/licenceRegistry'
import { btnGhost, btnPrimary, inp } from '../construction/uiStyles'
import Field from './Field'
import { fmtDate } from './format'

const EMPTY = {
  licence_type_id: '', licence_no: '', business_name: '', sub_type: '', holder_name: '', holder_phone: '', address: '', village: '',
  area_sqm: '', fee_amount: '', issued_on: '', expires_on: '', next_fee_due_on: '', note: '',
}

const toForm = l => Object.fromEntries(Object.keys(EMPTY).map(k => [k, l?.[k] ?? '']))

/**
 * แผ่นเพิ่ม/แก้ข้อมูลใบ — สถานะ (พักใช้/เพิกถอน/เลิกกิจการ) แก้ที่นี่ไม่ได้ ต้องใช้ปุ่ม "บันทึกคำสั่ง"
 * ใบที่มีรายการรับค่าธรรมเนียมแล้ว: ประเภท/วันหมดอายุ/วันครบกำหนด ถูกล็อก (ฐานข้อมูลห้ามแก้ตรงๆ ต้องผ่าน "บันทึกรับค่าธรรมเนียม" หรือยกเลิกรายการที่ผิดในประวัติ)
 */
export default function LicenceFormSheet({ tenantId, licence, types, onClose, onSaved }) {
  const editing = Boolean(licence)
  const [form, setForm] = useState(() => toForm(licence))
  const [locked, setLocked] = useState(editing ? null : false) // null = กำลังตรวจว่ามีรายการรับเงินไหม
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!editing) return undefined
    let alive = true
    fetchHistory(licence.id).then(r => {
      if (!alive) return
      if (r.error) { setError(friendlyError(r.error)); setLocked(true); return }
      setLocked(r.payments.some(p => !p.voided_at))
    })
    return () => { alive = false }
  }, [editing, licence?.id])

  const type = types.find(t => t.id === form.licence_type_id) ?? null
  const isNotice = type?.doc_kind === 'notice_certificate'
  const suggested = suggestExpiry(form.issued_on, type)

  function pickType(id) {
    const t = types.find(x => x.id === id)
    setForm(f => ({ ...f, licence_type_id: id, fee_amount: f.fee_amount === '' && t?.default_fee != null ? String(t.default_fee) : f.fee_amount }))
  }

  async function save() {
    const problem = validateLicenceForm(form, type)
    if (problem) { setError(problem); return }
    setBusy(true); setError('')
    const result = editing
      ? await updateLicence(licence.id, tenantId, form, { lockDates: locked === true })
      : await insertLicence(tenantId, form)
    setBusy(false)
    if (result.error) { setError(friendlyError(result.error)); return }
    onSaved()
  }

  async function remove() {
    if (!window.confirm(`ลบ "${licence.business_name}" ออกจากทะเบียน? (ใบที่เคยบันทึกรับค่าธรรมเนียมแล้วลบไม่ได้ — ให้เปลี่ยนสถานะเป็นเลิกกิจการแทน)`)) return
    setBusy(true); setError('')
    const { error: err } = await deleteLicence(licence.id, tenantId)
    setBusy(false)
    if (err) {
      // ใบที่มีรายการรับค่าธรรมเนียมแล้วลบไม่ได้ (FK RESTRICT ฝั่งฐาน) → บอกเหตุผลและทางที่ถูกต้อง
      setError(err.code === '23503'
        ? 'ลบใบนี้ไม่ได้ เพราะมีรายการรับค่าธรรมเนียมที่เป็นหลักฐานแล้ว — ถ้าเลิกประกอบกิจการให้เปลี่ยนสถานะเป็น "เลิกกิจการ" ที่ปุ่ม "บันทึกคำสั่ง" แทน'
        : friendlyError(err))
      return
    }
    onSaved()
  }

  const dateHint = iso => (iso ? `พ.ศ.: ${fmtDate(iso)}` : undefined)
  const typeLocked = editing && locked !== false

  return (
    <Sheet title={editing ? 'แก้ข้อมูลใบ' : 'เพิ่มใบเข้าทะเบียน'} subtitle={editing ? licence.business_name : 'ทะเบียนใบอนุญาต'} onClose={onClose} busy={busy} wide>
      <div className="space-y-3">
        {editing && locked === null && <p className="flex items-center gap-2 text-xs text-gray-500"><Loader2 size={14} className="animate-spin" />กำลังตรวจประวัติการรับค่าธรรมเนียม…</p>}
        {editing && locked === true && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
            ใบนี้มีรายการรับค่าธรรมเนียมแล้ว — ประเภท วันหมดอายุ และวันครบกำหนดแก้ตรงๆ ไม่ได้ (ใช้ปุ่ม "บันทึกรับค่าธรรมเนียม" หรือยกเลิกรายการที่บันทึกผิดในประวัติ)
          </p>
        )}
        <Field label="ประเภทใบอนุญาต" required hint={type ? `${docKindLabel(type.doc_kind)}${type.legal_basis ? ` · ${type.legal_basis}` : ''}` : undefined}>
          <select className={inp} value={form.licence_type_id} disabled={typeLocked} onChange={e => pickType(e.target.value)}>
            <option value="">— เลือกประเภท —</option>
            {types.filter(t => t.is_active || t.id === form.licence_type_id).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="เลขที่ใบอนุญาต"><input className={inp} maxLength={60} value={form.licence_no} onChange={e => set('licence_no', e.target.value)} /></Field>
          <Field label="ประเภทย่อย/ลำดับตามข้อบัญญัติ"><input className={inp} maxLength={300} value={form.sub_type} onChange={e => set('sub_type', e.target.value)} /></Field>
        </div>
        <Field label="ชื่อสถานประกอบการ" required><input className={inp} maxLength={300} value={form.business_name} onChange={e => set('business_name', e.target.value)} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="ชื่อผู้ประกอบการ/ผู้รับใบอนุญาต" required><input className={inp} maxLength={200} value={form.holder_name} onChange={e => set('holder_name', e.target.value)} /></Field>
          <Field label="เบอร์โทร"><input className={inp} inputMode="tel" maxLength={20} value={form.holder_phone} onChange={e => set('holder_phone', e.target.value)} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="หมู่บ้าน"><input className={inp} maxLength={100} value={form.village} onChange={e => set('village', e.target.value)} /></Field>
          <Field label="ที่ตั้ง/ที่อยู่"><input className={inp} maxLength={500} value={form.address} onChange={e => set('address', e.target.value)} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="พื้นที่ (ตร.ม.)"><input className={inp} inputMode="decimal" value={form.area_sqm} onChange={e => set('area_sqm', e.target.value)} /></Field>
          <Field label="ค่าธรรมเนียมต่อปี (บาท)" hint={type?.default_fee != null ? `ค่าตั้งต้นของประเภทนี้ ${type.default_fee} บาท` : undefined}>
            <input className={inp} inputMode="decimal" value={form.fee_amount} onChange={e => set('fee_amount', e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="วันที่ออกใบ" hint={dateHint(form.issued_on)}>
            <input type="date" className={inp} value={form.issued_on} onChange={e => set('issued_on', e.target.value)} />
          </Field>
          {isNotice ? (
            <Field label="วันครบกำหนดชำระค่าธรรมเนียมรายปี" required hint={dateHint(form.next_fee_due_on) ?? 'หนังสือรับรองการแจ้งไม่มีวันหมดอายุ'}>
              <input type="date" className={inp} value={form.next_fee_due_on} disabled={typeLocked} onChange={e => set('next_fee_due_on', e.target.value)} />
            </Field>
          ) : (
            <Field label="วันหมดอายุ (วันสุดท้ายที่ใบยังใช้ได้)" required hint={dateHint(form.expires_on)}>
              <input type="date" className={inp} value={form.expires_on} disabled={typeLocked} onChange={e => set('expires_on', e.target.value)} />
              {suggested && suggested !== form.expires_on && !typeLocked && (
                <button type="button" className="mt-1 text-xs font-semibold text-blue-700 underline" onClick={() => set('expires_on', suggested)}>
                  ใช้วันที่เสนอ {fmtDate(suggested)} (ออกใบ + {type?.validity_months ?? 12} เดือน − 1 วัน)
                </button>
              )}
            </Field>
          )}
        </div>
        <Field label="หมายเหตุ" hint="ห้ามใส่เบอร์โทร เลขบัตรประชาชน หรือข้อมูลส่วนตัวอื่น — ประวัติการแก้ไขเก็บถาวร ลบย้อนหลังไม่ได้ (เบอร์โทรผู้ประกอบการใส่ที่ช่อง เบอร์โทร)"><textarea className={inp} rows={2} maxLength={2000} value={form.note} onChange={e => set('note', e.target.value)} /></Field>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} disabled={busy || locked === null} onClick={save}>
            {busy && <Loader2 size={15} className="animate-spin" />}บันทึก
          </button>
          <button type="button" className={btnGhost} onClick={onClose} disabled={busy}>ยกเลิก</button>
          {editing && <button type="button" className={`${btnGhost} ml-auto text-red-700`} onClick={remove} disabled={busy}><Trash2 size={15} />ลบใบนี้</button>}
        </div>
      </div>
    </Sheet>
  )
}
