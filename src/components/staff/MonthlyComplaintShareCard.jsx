import { Link } from 'react-router-dom'
import { ChevronRight, Share2 } from 'lucide-react'
import { lastFullMonth } from '../../lib/complaintMonthlySummary'

// ทางลัดไปหน้า "สรุปเรื่องร้องเรียนรายเดือน" สำหรับเจ้าหน้าที่ที่ต้องแชร์ลง LINE/Facebook ทุกเดือน
// เป็นแค่ลิงก์ไปหน้าสาธารณะเดียวกับที่ประชาชนเห็น (ตัวเลขชุดเดียว ไม่มีสำเนา ไม่มีอะไรให้กรอก)
// พาไปเดือนล่าสุดที่จบครบแล้ว เพราะเดือนนี้ยังไม่ครบ ตัวเลขยังไม่นิ่ง
// ผู้เรียกเป็นคนตัดสินว่าจะแสดงหรือไม่ (โมดูลเรื่องร้องเรียนต้องเปิดอยู่) การ์ดนี้ไม่เช็กเอง
export default function MonthlyComplaintShareCard({ now = new Date() }) {
  const month = lastFullMonth(now)
  return (
    <Link
      to={`/reports/complaints?m=${month.key}`}
      data-testid="monthly-share-card"
      className="flex min-h-14 items-center gap-3 rounded-3xl border border-slate-100 bg-white p-3 shadow-sm transition-colors hover:bg-slate-50">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-white"
        style={{ backgroundColor: 'var(--color-primary)' }}>
        <Share2 size={18} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold leading-snug text-slate-800">
          สรุปเรื่องร้องเรียนรายเดือน สำหรับแชร์ LINE / Facebook
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-slate-500">
          {month.label} · ระบบสร้างภาพให้เอง กดดาวน์โหลดหรือแชร์ได้เลย ไม่ต้องกรอกอะไร
        </span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-slate-400" aria-hidden="true" />
    </Link>
  )
}
