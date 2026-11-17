import { FEE_PUBLIC_NOTICE, formatFeeRate, normalizeFeeRates } from '../../lib/complaintAppointment'

// ตารางอัตราค่าบริการของหมวดคำร้อง — แสดงอย่างเดียว ไม่มีช่องคำนวณ ไม่รับชำระเงิน (งาน 1.1 / E1)
// ใช้ร่วมกันในฟอร์มยื่นคำร้อง (CitizenForm) และหน้าติดตามเรื่อง (/t/) เพื่อให้ข้อความตรงกัน
// อัตราต้องมาจากข้อบัญญัติของ อปท. นั้น (แอดมินกรอกเองที่ตั้งค่าหมวด) — ระบบไม่ใส่ตัวเลขให้
// เปิดเป็น <details> พับได้: หมวดที่มีหลายแถวจะไม่ดันฟอร์มจนผู้กรอกต้องเลื่อนไกล
export default function FeeRatesCard({ rates, reference, defaultOpen = false, className = '' }) {
  const rows = normalizeFeeRates(rates)
  if (rows.length === 0) return null
  return (
    <details data-fee-rates open={defaultOpen || rows.length <= 4}
      className={`rounded-xl border border-teal-200 bg-teal-50/70 px-3.5 py-2.5 text-sm text-teal-950 ${className}`}>
      <summary className="cursor-pointer font-bold text-sm min-h-[28px] flex items-center">
        อัตราค่าบริการ ({rows.length} รายการ)
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-teal-800/80">
              <th scope="col" className="py-1 pr-2 font-semibold">รายการ</th>
              <th scope="col" className="py-1 pr-2 font-semibold whitespace-nowrap">หน่วย</th>
              <th scope="col" className="py-1 text-right font-semibold whitespace-nowrap">บาท</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-t border-teal-100 align-top">
                <td className="py-1.5 pr-2 break-words">
                  {row.item}
                  {row.note && <span className="block text-xs text-teal-800/70">{row.note}</span>}
                </td>
                <td className="py-1.5 pr-2 whitespace-nowrap">{row.unit}</td>
                <td className="py-1.5 text-right font-semibold whitespace-nowrap">{formatFeeRate(row.rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {reference && <p className="mt-2 text-xs text-teal-900/80 break-words">อ้างอิง: {reference}</p>}
      <p className="mt-1.5 text-xs text-teal-900/80 leading-relaxed">{FEE_PUBLIC_NOTICE}</p>
    </details>
  )
}
