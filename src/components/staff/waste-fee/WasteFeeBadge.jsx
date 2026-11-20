import { accountPhase } from '../../../lib/wasteFee'

const PHASE = {
  active: { label: 'เก็บอยู่', tone: 'bg-emerald-100 text-emerald-800' },
  pending: { label: 'รอเริ่มเก็บ', tone: 'bg-amber-100 text-amber-800' },
  closed: { label: 'เลิกเก็บ', tone: 'bg-gray-200 text-gray-700' },
}

/** ป้ายสถานะของบัญชี (คำนวณจากเดือนปัจจุบัน ไม่ใช่ค่าในฐาน) + ป้าย "ลดค่ากำจัด" เมื่อ sorted = ได้ลดในเดือนนี้ (จากช่วงใน waste_fee_sorting_periods) */
export default function WasteFeeBadge({ account, month, sorted }) {
  const p = PHASE[accountPhase(account, month)]
  return (
    <span className="flex flex-wrap gap-1">
      <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold ${p.tone}`}>{p.label}</span>
      {sorted && <span className="inline-block whitespace-nowrap rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] font-bold text-sky-800">ลดค่ากำจัด</span>}
    </span>
  )
}
