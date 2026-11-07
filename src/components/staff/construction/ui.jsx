// ชิ้นส่วนหน้าตาที่ใช้ร่วมกันในโมดูลโครงการก่อสร้าง (ฟอร์มโครงการ / ฟอร์มรายงานสัปดาห์ / สรุป)
import { AlertTriangle } from 'lucide-react'

import { lbl } from './uiStyles'

export function Field({ label, children, className = '' }) {
  return <label className={`block ${className}`}><span className={lbl}>{label}</span>{children}</label>
}

/** ส่วนพับได้ของฟอร์มยาว — เปิดเฉพาะส่วนที่ต้องกรอกบ่อย ที่เหลือพับไว้ ไม่ให้หน้ายาวเกินจอมือถือ */
export function Section({ title, hint, open = false, children }) {
  return (
    <details open={open} className="group rounded-2xl border border-gray-200 bg-white">
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-2.5 text-sm font-bold text-gray-800 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="text-gray-400 transition-transform group-open:rotate-90">▸</span>
        {title}
        {hint && <span className="text-xs font-normal text-gray-500">{hint}</span>}
      </summary>
      <div className="space-y-3 border-t border-gray-100 p-4">{children}</div>
    </details>
  )
}

/** รายการปัญหาจากตรรกะคำนวณ — error ขวางการล็อก (แดง) · info แค่บอก (เทา ไม่เด่น เพราะไม่ใช่งานที่ต้องทำทันที) */
export function Problems({ problems, only }) {
  const shown = (problems ?? []).filter(p => (only ? p.level === only : true))
  if (!shown.length) return null
  return (
    <ul className="space-y-1.5">
      {shown.map((p, i) => (
        <li key={`${p.code}-${i}`} className={`flex items-start gap-2 rounded-xl px-3 py-2 text-xs ${p.level === 'error' ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-600'}`}>
          {p.level === 'error' && <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />}
          <span>{p.message}</span>
        </li>
      ))}
    </ul>
  )
}

const LABEL_STYLE = {
  ahead: 'bg-emerald-50 text-emerald-800',
  on_track: 'bg-slate-100 text-slate-700',
  behind: 'bg-red-50 text-red-700',
  unknown: 'bg-gray-50 text-gray-500',
}
/** ป้ายเร็ว/ช้า/ตามแผน */
export function ScheduleBadge({ label }) {
  if (!label) return null
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${LABEL_STYLE[label.key] ?? LABEL_STYLE.unknown}`}>{label.text}</span>
}
