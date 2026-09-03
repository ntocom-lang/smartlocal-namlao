import { CalendarRange } from 'lucide-react'
import { FY_ALL } from '../../lib/fiscalYearParam'

// ตัวเลือกปีงบประมาณของหน้ารายงานสาธารณะ — ตัว state/URL อยู่ที่ useFiscalYearParam()
// ใน src/lib/fiscalYearParam.js ไฟล์นี้เป็นคอมโพเนนต์ล้วนตามข้อกำหนดของ react-refresh
export default function FiscalYearPicker({ value, options, onChange, id = 'fy-picker' }) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 shrink-0">
        <CalendarRange size={14} aria-hidden="true" /> ปีงบประมาณ
      </label>
      <select
        id={id}
        value={String(value)}
        onChange={e => onChange(e.target.value === FY_ALL ? FY_ALL : Number(e.target.value))}
        className="text-sm font-bold text-gray-800 bg-white border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-offset-0"
        style={{ '--tw-ring-color': 'var(--color-primary)' }}>
        {options.map(fy => (
          <option key={fy} value={fy}>พ.ศ. {fy}</option>
        ))}
        <option value={FY_ALL}>ทุกปีงบประมาณ</option>
      </select>
    </div>
  )
}
