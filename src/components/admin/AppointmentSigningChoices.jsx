import { FileSignature } from 'lucide-react'
import { SIGNING_EFFECT_TEXT } from '../../lib/documentSignatories'

// ผลของการแต่งตั้งนี้ต่อการลงนาม — แสดงในฟอร์มแต่งตั้ง (แท็บการแต่งตั้ง + ปุ่มเพิ่มบุคลากร) ให้จบในการบันทึกครั้งเดียว
// ไม่ต้องไปอีกเมนูหลังแต่งตั้ง แต่ทุกข้อเห็นก่อนบันทึกและเอาออกได้ ระบบไม่ตัดสินแทน
//   offers = รายการจาก signatoryChangeFor ของช่องที่ตำแหน่งเพิ่งเปลี่ยนมาหาคนนี้ (ไม่ขึ้นกับติ๊กหัวหน้ากอง)
export default function AppointmentSigningChoices({ offers, declinedSlots, onToggleSlot }) {
  if (!offers.length) return null
  return (
    <div className="space-y-2.5 rounded-xl border border-teal-200 bg-teal-50/60 px-3.5 py-3" data-appointment-signing>
      <p className="flex items-center gap-1.5 text-sm font-bold text-teal-900">
        <FileSignature size={15} className="shrink-0" /> ผลต่อการลงนามเอกสาร
      </p>
      {offers.map(offer => (
        <label key={offer.key} className="flex cursor-pointer items-start gap-2.5 text-sm leading-5 text-slate-800" data-appointment-signing-offer={offer.key}>
          <input type="checkbox" checked={!declinedSlots.includes(offer.key)} onChange={() => onToggleSlot(offer.key)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-teal-700" />
          <span className="min-w-0">
            <span className="font-semibold">ตั้งเป็นผู้ลงนามช่อง “{offer.label}” ด้วย</span>
            <span className="mt-0.5 block text-xs leading-5 text-slate-600">
              {offer.current
                ? `ตอนนี้ช่องนี้เป็น ${offer.current.name}${offer.current.manual ? ' (พิมพ์ชื่อเอง)' : ''}${offer.current.title ? ` · ${offer.current.title}` : ''}`
                : 'ตอนนี้ช่องนี้ยังไม่มีผู้ลงนาม'}
            </span>
          </span>
        </label>
      ))}
      <p className="text-xs font-semibold leading-5 text-teal-900">{SIGNING_EFFECT_TEXT}</p>
    </div>
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
