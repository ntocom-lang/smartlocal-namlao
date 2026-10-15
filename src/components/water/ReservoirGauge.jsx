import { useId } from 'react'
import { barPercent, formatMm } from '../../lib/waterSituation'

// วงกลมวัดปริมาตรน้ำในอ่าง — ย้ายมาจาก WaterSituationPage.jsx (ใช้ร่วมกับการ์ดอ่างขนาดเล็ก) โค้ดเดิมทุกบรรทัด
// สีวงรับจากผู้เรียก: อ่างกลางส่งสีตามเกณฑ์ DAM_LEVELS · อ่างขนาดเล็กส่งสีกลาง เพราะยังไม่ได้ยืนยันเกณฑ์สีของอ่างเล็ก
export default function ReservoirGauge({ percent, color }) {
  const id = useId()
  const fill = barPercent(percent, 100)
  return (
    <div className="water-gauge" role="img" aria-label={`น้ำในอ่าง ${formatMm(percent)}% ของความจุที่ระดับเก็บกัก`}>
      <svg viewBox="0 0 112 112" aria-hidden="true">
        <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#e0f2fe" /><stop offset="1" stopColor="#bae6fd" /></linearGradient></defs>
        <circle cx="56" cy="56" r="42" fill={`url(#${id})`} />
        <circle cx="56" cy="56" r="49" fill="none" stroke="#e2e8f0" strokeWidth="6" />
        <circle cx="56" cy="56" r="49" fill="none" stroke={color} strokeWidth="6" pathLength="100"
          strokeDasharray={`${fill} 100`} transform="rotate(-90 56 56)" />
        <path d="M25 76Q40 69 56 76T87 76" stroke="#38bdf8" strokeWidth="2" fill="none" />
      </svg>
      <strong>{formatMm(percent)}<small>%</small></strong>
    </div>
  )
}
