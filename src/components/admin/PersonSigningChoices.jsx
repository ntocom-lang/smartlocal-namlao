import { useState } from 'react'
import { FileSignature } from 'lucide-react'
import { CUSTOM_ROLE, isActingSignatory, SIGNING_EFFECT_TEXT, signatoryName, signatoryTitle } from '../../lib/documentSignatories'

function rowNote(row) {
  const { assignment, held, proposed, newly, checked } = row
  if (held) {
    return assignment?.is_vehicle_order_default
      ? 'ตอนนี้คนนี้ลงนามช่องนี้อยู่ และเป็นผู้มีอำนาจสั่งใช้รถ ถ้าเอาออก ใบขอใช้รถจะกลับไปใช้นายก'
      : 'ตอนนี้คนนี้ลงนามช่องนี้อยู่'
  }
  if (!assignment) {
    if (row.slot.role === CUSTOM_ROLE) return 'ช่องใหม่ ระบบสร้างให้ตอนบันทึก ใช้กับใบขออนุญาตใช้รถเท่านั้น'
    return proposed && !newly && !checked ? 'ตามการแต่งตั้ง คนนี้ควรลงนามช่องนี้ แต่ตอนนี้ยังไม่มีผู้ลงนาม' : 'ตอนนี้ยังไม่มีผู้ลงนาม'
  }
  const current = `${signatoryName(assignment)}${assignment.manual_name?.trim() ? ' (พิมพ์ชื่อเอง)' : ''}${signatoryTitle(assignment) ? ` · ${signatoryTitle(assignment)}` : ''}`
  if (isActingSignatory(assignment)) return `ตอนนี้ตั้งผู้แทนไว้: ${current} ระบบจึงไม่ติ๊กให้`
  if (proposed && !newly && !checked) return `ตามการแต่งตั้ง คนนี้ควรลงนามช่องนี้ แต่ตอนนี้เป็น ${current}`
  return `ตอนนี้เป็น ${current} ถ้าบันทึกจะเปลี่ยนเป็นคนนี้`
}

function rowWarning(row) {
  if (!row.checked || row.matches || isActingSignatory(row.assignment)) return ''
  return row.held
    ? 'ตำแหน่งนี้ไม่ตรงกับช่องนี้ ถ้าคงติ๊กไว้ เอกสารยังพิมพ์ชื่อคนนี้'
    : 'ตำแหน่งนี้ไม่ตรงกับช่องนี้ ตรวจคำสั่งมอบอำนาจก่อน'
}

// ส่วน "การลงนามเอกสาร" ในฟอร์มเจ้าหน้าที่ — แยกจากหัวหน้ากอง ทุกตำแหน่งเลือกช่องได้ (เจ้าของระบบสั่ง 2569-10-31)
// ระบบเสนอจากตำแหน่ง แอดมินเห็นชื่อเดิมก่อนบันทึก และเอาติ๊กออกได้ ระบบไม่ตั้งผู้ลงนามเองเงียบๆ
//   rows     = จาก personSigningRows · pickable = ช่องอื่นที่เลือกเพิ่มได้ · titles = ตำแหน่งที่พิมพ์ใต้ชื่อของคนที่ตำแหน่งไม่ตรงช่อง
//   signMode = 'wet' | 'online' | null (ยังไม่รู้) ตั้งที่เมนูการลงนามเอกสาร ฟอร์มแค่บอกผล
export default function PersonSigningChoices({
  rows, pickable, positionName, titles, signMode, onToggle, onTitleChange, onPick, onAddCustom, onOpenSigning,
}) {
  const [addingCustom, setAddingCustom] = useState(false)
  const [customLabel, setCustomLabel] = useState('')
  const changing = rows.some(row => row.checked !== row.held)

  function addCustom() {
    const label = customLabel.trim().replace(/\s+/g, ' ')
    if (label.length < 2) return
    onAddCustom(label)
    setCustomLabel('')
    setAddingCustom(false)
  }

  return (
    <section className="space-y-2.5 rounded-xl border border-teal-200 bg-teal-50/60 px-3.5 py-3" data-person-signing>
      <h3 className="flex items-center gap-1.5 text-sm font-bold text-teal-900">
        <FileSignature size={15} className="shrink-0" /> การลงนามเอกสาร
      </h3>
      {rows.map(row => {
        const warning = rowWarning(row)
        const asksTitle = row.checked && !row.held && !row.proposed
        return (
          <div key={row.key} className="space-y-1.5" data-person-signing-row={row.key}>
            <label className="flex min-h-11 cursor-pointer items-start gap-2.5 text-sm leading-5 text-slate-800">
              <input type="checkbox" checked={row.checked} onChange={event => onToggle(row.key, event.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-teal-700" />
              <span className="min-w-0">
                <span className="font-semibold">ลงนามช่อง “{row.slot.label}”</span>
                {row.proposed && !row.held && (
                  <span className="ml-1.5 inline-block rounded-full bg-teal-100 px-2 text-xs font-bold text-teal-800">ระบบเสนอจากตำแหน่ง</span>
                )}
                <span className="mt-0.5 block text-xs leading-5 text-slate-600">{rowNote(row)}</span>
              </span>
            </label>
            {warning && <p className="text-xs font-semibold leading-5 text-amber-800" data-person-signing-warn>{warning}</p>}
            {asksTitle && (
              <div>
                <label htmlFor={`person-signing-title-${row.key}`} className="mb-1 block text-xs font-semibold text-slate-600">ตำแหน่งที่พิมพ์ใต้ชื่อ</label>
                <input id={`person-signing-title-${row.key}`} value={titles[row.key] ?? positionName} onChange={event => onTitleChange(row.key, event.target.value)}
                  placeholder="เช่น รักษาราชการแทนผู้อำนวยการกองคลัง" data-person-signing-title={row.key}
                  className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-100" />
              </div>
            )}
          </div>
        )
      })}
      <div>
        <label htmlFor="person-slot-add" className="mb-1 block text-xs font-semibold text-slate-600">
          {rows.length ? 'ลงนามช่องอื่นด้วย' : 'คนนี้ยังไม่เป็นผู้ลงนาม ถ้าลงนามด้วยให้เลือกช่อง'}
        </label>
        <select id="person-slot-add" value="" data-person-slot-add
          onChange={event => {
            if (event.target.value === '__custom') setAddingCustom(true)
            else if (event.target.value) onPick(event.target.value)
          }}
          className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-100">
          <option value="">+ เลือกช่องลงนาม</option>
          {pickable.map(option => (
            <option key={option.key} value={option.key}>{option.label} {option.holder ? `(ตอนนี้ ${option.holder})` : '(ว่าง)'}</option>
          ))}
          <option value="__custom">+ สร้างช่องลงนามใหม่</option>
        </select>
      </div>
      {addingCustom && (
        <div className="space-y-1" data-person-custom-slot>
          <div className="flex flex-wrap gap-1.5">
            <input autoFocus value={customLabel} onChange={event => setCustomLabel(event.target.value)} aria-label="ชื่อช่องลงนามใหม่"
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addCustom() } }}
              placeholder="เช่น รองปลัดที่ได้รับมอบอำนาจ"
              className="min-h-11 min-w-0 flex-1 basis-40 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-100" />
            <button type="button" onClick={addCustom}
              className="min-h-11 rounded-xl border border-teal-600 bg-white px-3 text-sm font-bold text-teal-800 hover:bg-teal-50">เพิ่มช่องนี้</button>
          </div>
          <p className="text-xs leading-5 text-slate-600">ช่องที่สร้างเองใช้กับใบขออนุญาตใช้รถเท่านั้น ใบอื่นมีช่องนายก ปลัด และกอง</p>
        </div>
      )}
      {changing && <p className="text-xs font-semibold leading-5 text-teal-900">{SIGNING_EFFECT_TEXT}</p>}
      {signMode === 'wet' && <p className="text-xs leading-5 text-slate-600" data-person-sign-mode="wet">หน่วยงานนี้เซ็นสด ระบบพิมพ์ชื่อบนเอกสาร แล้วเซ็นบนกระดาษ</p>}
      {signMode === 'online' && (
        <p className="text-xs font-semibold leading-5 text-amber-800" data-person-sign-mode="online">
          หน่วยงานนี้เปิดลงนามออนไลน์ เจ้าตัวต้องตั้งรหัสลงนามและเพิ่มลายเซ็นเองที่เมนูลายเซ็นของฉัน
        </p>
      )}
      {onOpenSigning && (
        <button type="button" onClick={onOpenSigning} className="min-h-11 rounded-lg px-1 text-xs font-bold text-teal-700 hover:underline">
          ดูทุกช่องและกรณีพิเศษที่เมนูการลงนามเอกสาร
        </button>
      )}
    </section>
  )
}

// หัวหน้าคนเดิมของกอง — เป็นเรื่องของการแต่งตั้ง อยู่แยกจากกรอบการลงนาม เอาสถานะหัวหน้าออกแล้วชื่อบนเอกสารไม่เปลี่ยน
//   otherHeads = คนอื่นในกองที่ติ๊กเป็นหัวหน้าอยู่ · canClear = false คือแอดมินทั่วไปแก้บัญชีแอดมินด้วยกันไม่ได้ (DB ปฏิเสธ)
export function OtherHeadsChoices({ otherHeads, keptHeads, onToggleHead }) {
  if (!otherHeads.length) return null
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5" data-appointment-other-heads>
      {otherHeads.map(head => head.canClear ? (
        <label key={head.id} className="flex cursor-pointer items-start gap-2.5 text-sm leading-5 text-slate-800" data-appointment-other-head={head.id}>
          <input type="checkbox" checked={!keptHeads.includes(head.id)} onChange={() => onToggleHead(head.id)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-blue-600" />
          <span className="min-w-0">
            <span className="font-semibold">เอาสถานะหัวหน้ากองของ {head.full_name || 'คนเดิม'} ออก</span>
            <span className="mt-0.5 block text-xs leading-5 text-slate-600">
              กองนี้มีคนนี้เป็นหัวหน้าอยู่ ถ้าปล่อยไว้จะมีหัวหน้าสองคน อนุมัติกิจกรรมของกองได้ทั้งคู่ · บัญชี ตำแหน่ง และการลงนามของคนเดิมไม่เปลี่ยน
            </span>
          </span>
        </label>
      ) : (
        <p key={head.id} className="text-xs leading-5 text-amber-800" data-appointment-other-head-locked={head.id}>
          {head.full_name || 'คนเดิม'} (แอดมินระบบ) เป็นหัวหน้ากองนี้อยู่ ต้องให้ Super Admin เอาออก ไม่งั้นกองนี้มีหัวหน้าสองคน
        </p>
      ))}
    </div>
  )
}
