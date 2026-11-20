import { Plus } from 'lucide-react'
import { ListCard } from '../../patientTransport/StaffShell'
import { PLACE_TYPES, UNIT_KG, firstMonthUsing, rateState } from '../../../lib/wasteFee'
import { btnGhost, btnPrimary } from '../construction/uiStyles'
import { fmtDate, fmtMoney, fmtMonth } from './format'
import WasteFeeSampleTable from './WasteFeeSampleTable'

const STATE = {
  current: { label: 'ใช้อยู่ตอนนี้', tone: 'bg-emerald-100 text-emerald-800' },
  pending: { label: 'รอมีผล', tone: 'bg-sky-100 text-sky-800' },
  past: { label: 'ถูกแทนด้วยรุ่นใหม่แล้ว', tone: 'bg-gray-200 text-gray-700' },
}

// สรุปตัวเลขของรุ่นอัตราเป็นบรรทัดสั้น
function summary(rate) {
  if (rate.basis === 'place_type') {
    return PLACE_TYPES.filter(p => rate.place_type_rates?.[p.value] !== undefined).map(p => `${p.label} ${fmtMoney(rate.place_type_rates[p.value])}`).join(' · ')
  }
  const parts = [`ไม่เกิน ${UNIT_KG} กก.: เก็บขน ${fmtMoney(rate.base_collect)} + กำจัด ${fmtMoney(rate.base_dispose)}`]
  if (rate.unit_collect !== null) parts.push(`ส่วนเกิน/หน่วย: ${fmtMoney(rate.unit_collect)} + ${fmtMoney(rate.unit_dispose)}`)
  if (rate.big_unit_collect !== null) parts.push(`เกิน 30 หน่วย/หน่วย: ${fmtMoney(rate.big_unit_collect)} + ${fmtMoney(rate.big_unit_dispose)}`)
  return parts.join(' · ')
}

/**
 * แท็บ "อัตราค่าธรรมเนียม": รุ่นอัตราเรียงตามวันเริ่มมีผล (ใหม่สุดก่อน) + ตารางตัวอย่างยอด
 * ระบบไม่มีอัตราเริ่มต้น — แต่ละ อปท. ตั้งตามข้อบัญญัติของตัวเอง · แถวตัวอย่างขึ้นป้ายเตือนจนกว่าจะแก้ตัวเลข
 */
export default function WasteFeeRatesTab({ rates, onAdd, onEdit }) {
  return (
    <ListCard title="อัตราค่าธรรมเนียม" count={rates.length}
      action={<button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} onClick={onAdd}><Plus size={16} />เพิ่มรุ่นอัตรา</button>}>
      <p className="border-b border-gray-100 px-4 py-2.5 text-xs text-gray-600 sm:px-5">
        อัตราค่าธรรมเนียมเป็นข้อบัญญัติของแต่ละ อปท. — ตั้งตามข้อบัญญัติที่ประกาศใช้แล้วพร้อมอ้างข้อบัญญัติ ข้อบัญญัติใหม่ให้เพิ่มเป็นรุ่นใหม่ตามวันเริ่มมีผล
        (เดือนไหนใช้รุ่นไหน = รุ่นที่เริ่มมีผลล่าสุดที่ไม่เกินวันที่ 1 ของเดือนนั้น) ส่วนตัวเลขและเงื่อนไขต้องยืนยันกับตัวบทฉบับปัจจุบัน
      </p>
      {rates.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-gray-500">ยังไม่มีอัตรา — กด "เพิ่มรุ่นอัตรา" แล้วกรอกตามข้อบัญญัติของ อปท. (ไม่มีอัตราที่ใช้ได้ ระบบจะคำนวณยอดให้ไม่ได้)</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rates.map(rate => {
            const state = STATE[rateState(rate, rates)]
            return (
              <li key={rate.id} className="space-y-2 px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="break-words font-semibold text-gray-900">
                      เริ่มมีผล {fmtDate(String(rate.effective_from).slice(0, 10))}
                      <span className={`ml-2 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${state.tone}`}>{state.label}</span>
                      {rate.is_example && <span className="ml-2 inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-900">อัตราตัวอย่าง</span>}
                    </p>
                    <p className="break-words text-xs text-gray-500">
                      {rate.basis === 'place_type' ? 'เหมาตามประเภทสถานที่' : `ตามปริมาณขยะ หน่วยละ ${UNIT_KG} กก.${rate.sorting_discount ? ' · มีหมวดลดค่ากำจัดเมื่อคัดแยก' : ''}`}
                      {' · ใช้คำนวณตั้งแต่เดือน '}{fmtMonth(firstMonthUsing(rate.effective_from))}
                    </p>
                    <p className="break-words text-xs text-gray-600">{summary(rate)}</p>
                    <p className="break-words text-xs text-gray-500">อ้างอิง: {rate.ordinance_ref}</p>
                    {rate.is_example && <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1.5 text-xs font-semibold text-amber-900">อัตราตัวอย่าง ต้องแก้ตามข้อบัญญัติของ อปท. — ตัวเลขนี้ไม่ใช่อัตราของ อปท. ของท่าน</p>}
                    {rate.note && <p className="break-words text-xs text-gray-500">{rate.note}</p>}
                  </div>
                  <button type="button" className={`${btnGhost} min-h-9 px-3 text-xs`} onClick={() => onEdit(rate)}>แก้ไข</button>
                </div>
                <details className="text-xs text-gray-700">
                  <summary className="cursor-pointer font-semibold text-blue-700">ดูตัวอย่างยอดรายเดือน</summary>
                  <div className="mt-1.5"><WasteFeeSampleTable rate={rate} /></div>
                </details>
              </li>
            )
          })}
        </ul>
      )}
    </ListCard>
  )
}
