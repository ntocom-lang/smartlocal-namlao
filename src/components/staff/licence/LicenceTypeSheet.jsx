import { useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { Sheet } from '../../patientTransport/StaffShell'
import { deleteType, friendlyError, insertType, updateType } from '../../../lib/licenceRegistryApi'
import { LICENCE_CATEGORIES, categoryDefaults, categoryOf, validateTypeForm } from '../../../lib/licenceRegistry'
import { btnGhost, btnPrimary, inp } from '../construction/uiStyles'
import Field from './Field'

const EMPTY = {
  category: '', name: '', validity_months: '12', renewal_by_fee: true, ordinance_ref: '', legal_basis: '',
  renewal_window_days: '', default_fee: '', external_url: '', external_label: '', is_active: true, sort_order: 0,
}
const toForm = t => (t ? {
  category: t.category, name: t.name, validity_months: t.validity_months ?? '12', renewal_by_fee: t.renewal_by_fee,
  ordinance_ref: t.ordinance_ref ?? '', legal_basis: t.legal_basis ?? '', renewal_window_days: t.renewal_window_days ?? '',
  default_fee: t.default_fee ?? '', external_url: t.external_url ?? '', external_label: t.external_label ?? '',
  is_active: t.is_active, sort_order: t.sort_order ?? 0,
} : EMPTY)

/**
 * แผ่นเพิ่ม/แก้ประเภทใบอนุญาต — แบบ อัตรา และช่วงต่ออายุ เป็นข้อกำหนดของท้องถิ่นแต่ละแห่ง (พ.ร.บ.การสาธารณสุข ม.54 ม.63)
 * ฐานกฎหมายที่เติมให้เป็นค่าเริ่มต้นที่แก้ได้ ต้องยืนยันกับตัวบทฉบับปัจจุบัน · ช่อง "ยื่นผ่านระบบอื่น" = ลิงก์ไป Biz Portal ฯลฯ
 */
export default function LicenceTypeSheet({ tenantId, type, onClose, onSaved }) {
  const editing = Boolean(type)
  const [form, setForm] = useState(() => toForm(type))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const cat = categoryOf(form.category)
  const isNotice = cat?.docKind === 'notice_certificate'

  function pickCategory(value) {
    const d = categoryDefaults(value)
    setForm(f => ({ ...f, category: value, renewal_by_fee: d.renewal_by_fee, legal_basis: f.legal_basis && editing ? f.legal_basis : d.legal_basis,
      validity_months: d.validity_months ?? '12', name: f.name || categoryOf(value)?.label || '' }))
  }

  async function save() {
    const problem = validateTypeForm(form)
    if (problem) { setError(problem); return }
    setBusy(true); setError('')
    const result = editing ? await updateType(type.id, tenantId, form) : await insertType(tenantId, form)
    setBusy(false)
    if (result.error) { setError(friendlyError(result.error)); return }
    onSaved()
  }

  async function remove() {
    if (!window.confirm(`ลบประเภท "${type.name}"? (ประเภทที่ยังมีใบในทะเบียนลบไม่ได้ — ให้ปิดการใช้งานแทน)`)) return
    setBusy(true); setError('')
    const { error: err } = await deleteType(type.id, tenantId)
    setBusy(false)
    if (err) { setError(friendlyError(err)); return }
    onSaved()
  }

  return (
    <Sheet title={editing ? 'แก้ประเภทใบอนุญาต' : 'เพิ่มประเภทใบอนุญาต'} subtitle="ตั้งตามข้อกำหนดของท้องถิ่นที่ อปท. ประกาศใช้" onClose={onClose} busy={busy} wide>
      <div className="space-y-3">
        <Field label="หมวดตามตัวบท" required hint="ใช้จัดกลุ่ม/รายงาน — ชื่อที่แสดงตั้งเองได้ด้านล่าง">
          <select className={inp} value={form.category} onChange={e => pickCategory(e.target.value)} disabled={editing}>
            <option value="">— เลือกหมวด —</option>
            {LICENCE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </Field>
        {editing && <p className="text-[11px] text-gray-500">เปลี่ยนหมวดไม่ได้หลังสร้าง (ถ้าต้องเปลี่ยนชนิดเอกสาร ให้สร้างประเภทใหม่)</p>}
        <Field label="ชื่อประเภท (ตามข้อบัญญัติ/ข้อกำหนดของ อปท.)" required>
          <input className={inp} maxLength={200} value={form.name} onChange={e => set('name', e.target.value)} />
        </Field>
        <Field label="ข้อกำหนดของท้องถิ่นที่รองรับ (ชื่อ + ปี)" hint="เช่น ข้อบัญญัติ/เทศบัญญัติ เรื่อง … พ.ศ. … — ระบบแสดงตามที่กรอก ไม่ตีความ">
          <input className={inp} maxLength={300} value={form.ordinance_ref} onChange={e => set('ordinance_ref', e.target.value)} />
        </Field>
        <Field label="ฐานกฎหมาย" hint="ค่าเริ่มต้นตามหมวด แก้ได้ — ต้องยืนยันกับตัวบทฉบับปัจจุบัน">
          <input className={inp} maxLength={200} value={form.legal_basis} onChange={e => set('legal_basis', e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          {form.category === 'other' && (
            <Field label="อายุใบ (เดือน)" required><input className={inp} inputMode="numeric" value={form.validity_months} onChange={e => set('validity_months', e.target.value)} /></Field>
          )}
          {cat && !isNotice && form.category !== 'other' && (
            <Field label="อายุใบ"><p className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-700">12 เดือน (ตามหมวด)</p></Field>
          )}
          <Field label="ค่าธรรมเนียมตั้งต้น (บาท)" hint="เติมให้ตอนเพิ่มใบ แก้รายใบได้">
            <input className={inp} inputMode="decimal" value={form.default_fee} onChange={e => set('default_fee', e.target.value)} />
          </Field>
          {cat && !isNotice && (
            <Field label="ช่วงต่ออายุล่วงหน้า (วัน)" hint="ตามข้อกำหนดของ อปท. เว้นว่าง = ไม่จำกัด (ต้องชำระก่อนสิ้นอายุเท่านั้น)">
              <input className={inp} inputMode="numeric" value={form.renewal_window_days} onChange={e => set('renewal_window_days', e.target.value)} />
            </Field>
          )}
        </div>
        {cat && !isNotice && (
          <label className="flex items-start gap-2 rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-800">
            <input type="checkbox" className="mt-1 size-4" checked={form.renewal_by_fee} onChange={e => set('renewal_by_fee', e.target.checked)} />
            <span>ต่ออายุโดยชำระค่าธรรมเนียมได้ (พ.ร.ฎ. 2564)<span className="block text-[11px] text-gray-500">ไม่ติ๊ก = ผู้ประกอบการยื่นคำขอต่ออายุตามปกติ (หมวดรับทำการเก็บ ขน กำจัดสิ่งปฏิกูล/มูลฝอยเริ่มต้นไม่ติ๊ก — ต้องยืนยันกับบัญชีท้าย พ.ร.ฎ.)</span></span>
          </label>
        )}
        {isNotice && <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-700">หนังสือรับรองการแจ้งไม่มีวันหมดอายุ — ใช้วันครบกำหนดค่าธรรมเนียมรายปีแทน</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="ยื่นผ่านระบบอื่น (ลิงก์)" hint="เช่น Biz Portal — ต้องขึ้นต้นด้วย https://">
            <input className={inp} inputMode="url" maxLength={500} value={form.external_url} onChange={e => set('external_url', e.target.value)} />
          </Field>
          <Field label="ชื่อระบบอื่น" hint="เช่น Biz Portal"><input className={inp} maxLength={100} value={form.external_label} onChange={e => set('external_label', e.target.value)} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input type="checkbox" className="size-4" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} />ใช้งาน (ปิด = ไม่ให้เลือกตอนเพิ่มใบใหม่ ใบเดิมยังอยู่)
        </label>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} disabled={busy} onClick={save}>
            {busy && <Loader2 size={15} className="animate-spin" />}บันทึก
          </button>
          <button type="button" className={btnGhost} onClick={onClose} disabled={busy}>ยกเลิก</button>
          {editing && <button type="button" className={`${btnGhost} ml-auto text-red-700`} onClick={remove} disabled={busy}><Trash2 size={15} />ลบประเภท</button>}
        </div>
      </div>
    </Sheet>
  )
}
