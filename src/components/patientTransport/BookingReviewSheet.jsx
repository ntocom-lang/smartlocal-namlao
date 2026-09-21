import { useState } from 'react'
import { buttonClass, primaryClass, orgAbbr } from '../../lib/patientBooking'

/**
 * หน้าทวนก่อนส่งคำขอจองรถ — โครงเดียวกับ ComplaintReviewSheet ของ "คำร้อง" (แผ่นลอยขึ้นจากด้านล่าง
 * สรุปสิ่งที่จะส่งทั้งหมด กลับไปแก้ได้ และยินยอมอยู่ในกล่องเดียวกัน ไม่เพิ่มจำนวนครั้งที่ต้องกด)
 * เจ้าของระบบกำหนดรูปแบบนี้ไว้กับคำร้องเมื่อ 2569-09-17 แล้วสั่งให้โมดูลนี้ทำตาม 2569-09-21
 *
 * ต่างจากคำร้องข้อเดียว: "ความยินยอมให้ใช้ข้อมูล" เป็นช่องติ๊กแยก 1 ช่อง เพราะวันนัดโรงพยาบาลและ
 * การใช้รถเข็น/เปลเป็นข้อมูลเกี่ยวกับสุขภาพ ซึ่งต้องขอความยินยอมแยกให้ชัด ส่วนคำรับรองที่เหลือ
 * (ไม่ฉุกเฉิน · จุดรับอยู่ในเขต · ได้รับอนุญาตให้จองแทน) อยู่เหนือปุ่มยืนยันแบบเดียวกับคำร้อง
 *
 * ตัวหนังสือตั้งใจให้ใหญ่กว่าปกติ ผู้ใช้ส่วนใหญ่เป็นผู้สูงอายุ ถ้าอ่านไม่ออกก็จะกดผ่านโดยไม่อ่าน
 * แล้วขั้นทวนนี้จะไม่มีความหมาย
 */
export default function BookingReviewSheet({ summary = [], privacyNotice, ownerName, forOther, staffEntry, submitting, onBack, onConfirm }) {
  const [consent, setConsent] = useState(false)
  const org = orgAbbr()
  const promises = [
    'เป็นการเดินทางไปตามนัดของแพทย์ ไม่ใช่เจ็บป่วยฉุกเฉิน (ฉุกเฉินให้โทร 1669)',
    staffEntry ? `ตรวจแล้วว่าจุดรับอยู่ในเขตพื้นที่ให้บริการของ${org}` : `จุดรับอยู่ในเขตพื้นที่ให้บริการของ${org}`,
    forOther && (staffEntry ? 'ผู้จองยืนยันว่าได้รับอนุญาตจากผู้ป่วยหรือมีอำนาจกระทำการแทน' : 'ได้รับอนุญาตจากผู้ป่วย หรือมีอำนาจกระทำการแทนผู้ป่วยแล้ว'),
  ].filter(Boolean)
  return <div className="fixed inset-0 z-200 flex items-end bg-black/40" onClick={submitting ? undefined : onBack}>
    <div className="mx-auto max-h-[92vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-t-3xl bg-white px-5 pb-8 pt-5" onClick={e => e.stopPropagation()}>
      <div>
        <h2 className="text-lg font-bold text-slate-900">ตรวจทานก่อนส่ง</h2>
        <p className="mt-0.5 text-sm text-slate-600">ถ้ามีอะไรไม่ถูกต้อง กดปุ่มด้านล่างเพื่อกลับไปแก้ไขได้</p>
      </div>
      <dl className="divide-y divide-slate-100 rounded-2xl border border-slate-200">
        {summary.filter(row => row?.value).map(row => <div key={row.label} className="flex gap-3 px-4 py-2.5">
          <dt className="w-24 shrink-0 text-sm text-slate-500">{row.label}</dt>
          <dd className="flex-1 text-base font-medium text-slate-900 [overflow-wrap:anywhere]">{row.value}</dd>
        </div>)}
      </dl>
      <div className="rounded-2xl bg-slate-50 p-4">
        <p className="font-semibold text-slate-900">เมื่อกดส่ง ข้าพเจ้ารับรองว่า</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-base text-slate-800">{promises.map(text => <li key={text}>{text}</li>)}</ul>
      </div>
      <details className="rounded-2xl border border-slate-200 px-4">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-sky-800">อ่านข้อความการใช้ข้อมูลทั้งหมด</summary>
        <div className="whitespace-pre-wrap pb-4 text-sm text-slate-700">{privacyNotice}
          <p className="mt-3 font-bold">เจ้าของรถและผู้รับข้อมูล: {ownerName}</p>
        </div>
      </details>
      <label className="flex min-h-11 gap-3 rounded-2xl bg-sky-50 p-4 text-base">
        <input className="mt-0.5 size-5 shrink-0" type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
        {staffEntry ? 'ผู้จองยินยอมให้ใช้ข้อมูลตามข้อความข้างต้น (แจ้งทางโทรศัพท์/หน้าเคาน์เตอร์แล้ว)' : 'ยินยอมให้ใช้ข้อมูลตามข้อความข้างต้น'}
      </label>
      {!consent && <p className="text-sm text-slate-600">ต้องติ๊กช่องยินยอมก่อนจึงจะส่งคำขอได้</p>}
      <div className="flex gap-3">
        <button type="button" className={`${buttonClass} flex-1`} disabled={submitting} onClick={onBack}>← กลับไปแก้ไข</button>
        <button type="button" className={`${primaryClass} flex-1 text-base`} disabled={submitting || !consent} onClick={onConfirm}>{submitting ? 'กำลังส่ง…' : 'ยืนยันส่งคำขอ'}</button>
      </div>
    </div>
  </div>
}
