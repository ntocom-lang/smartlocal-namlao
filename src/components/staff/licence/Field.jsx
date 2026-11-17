import { lbl } from '../construction/uiStyles'

/** ช่องกรอก: ป้ายชื่อ + ตัวควบคุม + คำอธิบายเล็ก (ใช้ร่วมทุกแผ่นของทะเบียนใบอนุญาต) */
export default function Field({ label, hint, required, children }) {
  return (
    <label className="block">
      <span className={lbl}>{label}{required && <span className="text-red-600"> *</span>}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-snug text-gray-500">{hint}</span>}
    </label>
  )
}
