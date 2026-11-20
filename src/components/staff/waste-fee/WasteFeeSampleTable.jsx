import { sampleRows } from '../../../lib/wasteFee'
import { fmtMoney } from './format'

const cell = r => (r?.ok ? fmtMoney(r.total) : '—')

/**
 * ตารางตัวอย่างยอดรายเดือนของรุ่นอัตรา (ใช้ computeMonthly ชุดเดียวกับที่ตรวจเทียบกับ wfee_compute ในเทสต์)
 * basis units: 1 / 1.5 / 5 / 31 หน่วย (± คัดแยกถ้ารุ่นนี้มีหมวดลด) · basis place_type: ยอดเหมาแต่ละประเภทสถานที่
 */
export default function WasteFeeSampleTable({ rate }) {
  const rows = sampleRows(rate)
  const hasSorted = rows.some(r => r.sorted)
  if (rows.length === 0) return null
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full min-w-[320px] border-collapse text-xs">
        <thead className="bg-gray-50 text-left text-gray-600">
          <tr>
            <th className="px-3 py-1.5">{rate.basis === 'place_type' ? 'ประเภทสถานที่' : 'ปริมาณต่อเดือน'}</th>
            <th className="px-3 py-1.5 text-right">ยอด (บาท/เดือน)</th>
            {hasSorted && <th className="px-3 py-1.5 text-right">ถ้าคัดแยก (ลดค่ากำจัด)</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map(r => (
            <tr key={r.key}>
              <td className="px-3 py-1.5 text-gray-800">{r.label}</td>
              <td className="px-3 py-1.5 text-right font-semibold text-gray-900">{cell(r.plain)}</td>
              {hasSorted && <td className="px-3 py-1.5 text-right text-gray-800">{cell(r.sorted)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
