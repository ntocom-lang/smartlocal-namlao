import { useMemo, useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { Sheet } from '../../patientTransport/StaffShell'
import { deleteRate, friendlyError, insertRate, updateRate } from '../../../lib/wasteFeeApi'
import { PLACE_TYPES, UNIT_KG, firstMonthUsing, ratePayload, validateRateForm } from '../../../lib/wasteFee'
import { btnGhost, btnPrimary, inp } from '../construction/uiStyles'
import Field from '../licence/Field'
import { fmtMonth } from './format'
import WasteFeeSampleTable from './WasteFeeSampleTable'

const EMPTY = {
  effective_from: '', ordinance_ref: '', basis: 'units', base_collect: '', base_dispose: '', unit_collect: '', unit_dispose: '',
  big_unit_collect: '', big_unit_dispose: '', place_rates: {}, sorting_discount: false, note: '',
}
const str = v => (v === null || v === undefined ? '' : String(v))
const toForm = r => (r ? {
  effective_from: String(r.effective_from).slice(0, 10), ordinance_ref: r.is_example ? '' : r.ordinance_ref, basis: r.basis,
  base_collect: str(r.base_collect), base_dispose: str(r.base_dispose), unit_collect: str(r.unit_collect), unit_dispose: str(r.unit_dispose),
  big_unit_collect: str(r.big_unit_collect), big_unit_dispose: str(r.big_unit_dispose),
  place_rates: Object.fromEntries(Object.entries(r.place_type_rates ?? {}).map(([k, v]) => [k, str(v)])),
  sorting_discount: Boolean(r.sorting_discount), note: r.note ?? '',
} : EMPTY)

/**
 * แผ่นเพิ่ม/แก้รุ่นอัตรา — ตัวเลขทุกตัวมาจากข้อบัญญัติของ อปท. (ระบบไม่มีอัตราเริ่มต้น) ต้องอ้างข้อบัญญัติทุกรุ่นเพื่อให้ตรวจย้อนได้
 * basis units = ตามปริมาณขยะ หน่วยละ 120 กก. (ค่าเก็บขน + ค่ากำจัด) · place_type = เหมาตามประเภทสถานที่ (ข้อบัญญัติเดิม)
 * แถวตัวอย่าง (is_example) ต้องกรอกข้ออ้างข้อบัญญัติใหม่เอง — ช่องอ้างอิงเริ่มว่างเพื่อไม่ให้ข้อความ "ตัวอย่าง" ติดไปกับอัตราจริง
 */
export default function WasteFeeRateSheet({ tenantId, rate, onClose, onSaved }) {
  const editing = Boolean(rate)
  const [form, setForm] = useState(() => toForm(rate))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setPlace = (k, v) => setForm(f => ({ ...f, place_rates: { ...f.place_rates, [k]: v } }))
  const money = (k, label, hint) => (
    <Field label={label} hint={hint}><input className={inp} type="number" inputMode="decimal" min="0" max="100000" step="0.01" value={form[k]} onChange={e => set(k, e.target.value)} /></Field>
  )

  // ตัวอย่างยอดจากค่าที่กรอกอยู่ (แสดงเมื่อฟอร์มผ่านการตรวจ) — เจ้าหน้าที่เห็นผลก่อนบันทึก
  const live = useMemo(() => {
    if (validateRateForm(form)) return null
    return { id: rate?.id ?? 'draft', is_example: false, ...ratePayload(form) }
  }, [form, rate?.id])

  async function save() {
    const problem = validateRateForm(form)
    if (problem) { setError(problem); return }
    setBusy(true); setError('')
    const payload = ratePayload(form)
    const result = editing ? await updateRate(rate.id, tenantId, payload) : await insertRate(tenantId, payload)
    setBusy(false)
    if (result.error) { setError(friendlyError(result.error)); return }
    onSaved()
  }

  async function remove() {
    if (!window.confirm('ลบรุ่นอัตรานี้? เดือนที่เคยใช้รุ่นนี้จะถูกคำนวณด้วยรุ่นก่อนหน้า (ถ้าไม่มีรุ่นก่อนหน้า จะคำนวณยอดไม่ได้) — ประวัติการแก้ไขยังเก็บไว้')) return
    setBusy(true); setError('')
    const { error: err } = await deleteRate(rate.id, tenantId)
    setBusy(false)
    if (err) { setError(friendlyError(err)); return }
    onSaved()
  }

  const first = firstMonthUsing(form.effective_from)
  return (
    <Sheet title={editing ? 'แก้รุ่นอัตรา' : 'เพิ่มรุ่นอัตรา'} subtitle="อัตราตามข้อบัญญัติของ อปท." onClose={onClose} busy={busy} wide>
      <div className="space-y-3">
        {rate?.is_example && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
            รุ่นนี้เป็นอัตราตัวอย่างของสนามซ้อม — แก้ตัวเลขให้ตรงกับข้อบัญญัติของ อปท. แล้วกรอกข้ออ้างข้อบัญญัติใหม่ ป้าย "ตัวอย่าง" จะหลุดเมื่อบันทึกการแก้ตัวเลข
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="วันที่เริ่มมีผล" required hint={first ? `ใช้คำนวณตั้งแต่เดือน ${fmtMonth(first)} (มีผลวันที่ 1 = เดือนนั้น · มีผลกลางเดือน = เดือนถัดไป — ไม่คิดตามสัดส่วนวัน)` : undefined}>
            <input type="date" className={inp} value={form.effective_from} onChange={e => set('effective_from', e.target.value)} />
          </Field>
          <Field label="วิธีคิดอัตรา" required>
            <select className={inp} value={form.basis} onChange={e => set('basis', e.target.value)}>
              <option value="units">ตามปริมาณขยะ (หน่วยละ {UNIT_KG} กก.)</option>
              <option value="place_type">เหมาตามประเภทสถานที่</option>
            </select>
          </Field>
        </div>
        <Field label="อ้างข้อบัญญัติ/เทศบัญญัติที่ให้อำนาจ" required hint="ชื่อ + ปี + ข้อ เช่น เทศบัญญัติ … เรื่อง อัตราค่าธรรมเนียม … พ.ศ. … ข้อ … — ระบบแสดงตามที่กรอก ไม่ตีความ ต้องยืนยันกับตัวบทฉบับปัจจุบัน">
          <input className={inp} maxLength={300} value={form.ordinance_ref} onChange={e => set('ordinance_ref', e.target.value)} />
        </Field>

        {form.basis === 'units' ? (
          <>
            <fieldset className="space-y-2 rounded-xl border border-gray-200 p-3">
              <legend className="px-1 text-xs font-bold text-gray-600">อัตราเหมา (ไม่เกิน {UNIT_KG} กก. ต่อเดือน — ใช้แม้ปริมาณแค่ครึ่งหน่วย)</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {money('base_collect', 'ค่าเก็บขน (บาท/เดือน)')}
                {money('base_dispose', 'ค่ากำจัด (บาท/เดือน)')}
              </div>
            </fieldset>
            <fieldset className="space-y-2 rounded-xl border border-gray-200 p-3">
              <legend className="px-1 text-xs font-bold text-gray-600">ส่วนเกิน {UNIT_KG}–{UNIT_KG * 30} กก. (บาทต่อหน่วยที่เกิน) — เว้นว่างทั้งคู่ถ้าไม่มี</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {money('unit_collect', 'ค่าเก็บขนต่อหน่วย')}
                {money('unit_dispose', 'ค่ากำจัดต่อหน่วย')}
              </div>
            </fieldset>
            <fieldset className="space-y-2 rounded-xl border border-gray-200 p-3">
              <legend className="px-1 text-xs font-bold text-gray-600">ส่วนเกิน {(UNIT_KG * 30).toLocaleString('th-TH')} กก. (บาทต่อหน่วยที่เกิน) — เว้นว่างทั้งคู่ถ้าไม่มี</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {money('big_unit_collect', 'ค่าเก็บขนต่อหน่วย')}
                {money('big_unit_dispose', 'ค่ากำจัดต่อหน่วย')}
              </div>
            </fieldset>
            <label className="flex items-start gap-2 rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-800">
              <input type="checkbox" className="mt-1 size-4" checked={form.sorting_discount} onChange={e => set('sorting_discount', e.target.checked)} />
              <span>ข้อบัญญัติรุ่นนี้มีหมวดลดค่ากำจัดกึ่งหนึ่งเมื่อคัดแยกขยะ<span className="block text-[11px] text-gray-500">ติ๊กแล้ว เจ้าหน้าที่ยืนยันการคัดแยกรายบัญชีได้ในแผ่น ยอด/ประวัติ — ระบบไม่ลดให้เอง</span></span>
            </label>
          </>
        ) : (
          <fieldset className="space-y-2 rounded-xl border border-gray-200 p-3">
            <legend className="px-1 text-xs font-bold text-gray-600">อัตราเหมารายเดือนตามประเภทสถานที่ (บาท) — เว้นว่างประเภทที่ไม่เก็บ/ไม่มี</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {PLACE_TYPES.map(p => (
                <Field key={p.value} label={p.label}>
                  <input className={inp} type="number" inputMode="decimal" min="0" max="100000" step="0.01" value={form.place_rates[p.value] ?? ''} onChange={e => setPlace(p.value, e.target.value)} />
                </Field>
              ))}
            </div>
          </fieldset>
        )}
        <Field label="หมายเหตุ"><textarea className={inp} rows={2} maxLength={2000} value={form.note} onChange={e => set('note', e.target.value)} /></Field>

        {live && (
          <section className="space-y-1.5">
            <h4 className="text-sm font-bold text-gray-800">ตัวอย่างยอดรายเดือนจากอัตราที่กรอก</h4>
            <WasteFeeSampleTable rate={live} />
          </section>
        )}

        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} disabled={busy} onClick={save}>
            {busy && <Loader2 size={15} className="animate-spin" />}บันทึก
          </button>
          <button type="button" className={btnGhost} onClick={onClose} disabled={busy}>ยกเลิก</button>
          {editing && <button type="button" className={`${btnGhost} ml-auto text-red-700`} onClick={remove} disabled={busy}><Trash2 size={15} />ลบรุ่นนี้</button>}
        </div>
      </div>
    </Sheet>
  )
}
