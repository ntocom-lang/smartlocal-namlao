import { Link } from 'react-router-dom'
import { Eye, ChevronRight } from 'lucide-react'
import { useTenant } from '../../contexts/TenantContext'
import { withModule } from '../../lib/withModule'
import { useSiteOpenSummary } from '../../lib/siteOpenCounter'

const formatCount = value => Number(value ?? 0).toLocaleString('th-TH')

const ITEMS = [
  { key: 'today',      label: 'วันนี้' },
  { key: 'this_month', label: 'เดือนนี้' },
  { key: 'total',      label: 'ทั้งหมด' },
]

// กล่องตัวนับใต้ลิขสิทธิ์ของท้ายเว็บ — ท้ายเว็บตัวเดียวใช้ร่วมทั้ง 7 ธีม จึงขึ้นครบทุก อปท.
// หัวกล่องต้องเป็น "การเข้าชม… (ครั้ง)" เสมอ ห้ามเปลี่ยนเป็น "ผู้เข้าชม … คน" — ยอดนี้นับทุกครั้งที่เปิด/
// รีเฟรช/เปลี่ยนหน้า คนเดียวนับได้หลายครั้ง (นิยามอยู่ที่ src/lib/siteOpenStats.js)
//
// ทำเป็น 3 ช่องแคบกลางจอ ไม่ใช่บรรทัดยาวบรรทัดเดียว — ปุ่มลอย "เลื่อนขึ้นบนสุด" (ScrollToTopButton:
// right-4 กว้าง 44px) ลอยทับขวาของท้ายเว็บพอดีตอนเลื่อนถึงล่างสุด บรรทัดยาวบนจอ 360px เคยโดนบัง
// ตรงยอด "ทั้งหมด" ซึ่งเป็นตัวเลขที่สำคัญที่สุด inline-block + grid ทำให้กล่องกว้างแค่เท่าเนื้อหา
function SiteVisitCounter() {
  const { tenant } = useTenant()
  const summary = useSiteOpenSummary(tenant?.id)
  const opens = summary?.opens

  // ยังไม่มียอด/อ่านไม่ได้ = ไม่แสดงทั้งกล่อง ดีกว่าขึ้น 0 หลอกๆ ระหว่างรอ
  if (!opens) return null

  return (
    <Link to="/reports/visitors" aria-label="ดูสถิติการเข้าชมเว็บไซต์"
      className="inline-block rounded-2xl px-2 py-2 transition-colors hover:bg-white/10"
      style={{ color: 'rgba(186,230,253,0.8)' }}>
      <p className="flex items-center justify-center gap-1 text-[11px] font-semibold leading-4">
        <Eye size={12} aria-hidden="true" /> การเข้าชมเว็บไซต์ (ครั้ง)
        <ChevronRight size={12} aria-hidden="true" className="opacity-60" />
      </p>
      {/* ช่องกว้างตามตัวเลขของตัวเอง ไม่บังคับเท่ากัน — ยอดสะสมหลักล้านช่องเดียวจะได้ไม่ถ่างทั้ง 3 ช่อง
          (วัดแล้ว: ยอด 1,234,567 กล่องกว้าง ~194px พ้นปุ่มลอยตั้งแต่จอ 320px) */}
      <dl className="mt-1 grid grid-cols-[repeat(3,auto)] justify-center gap-x-3 text-center">
        {ITEMS.map(({ key, label }) => (
          <div key={key}>
            <dt className="text-[10px] leading-4">{label}</dt>
            <dd className="text-[13px] font-bold leading-5 text-white">{formatCount(opens[key])}</dd>
          </div>
        ))}
      </dl>
    </Link>
  )
}

// ซ่อนเมื่อ อปท. ไม่ได้เปิดโมดูล 'report' — ตัวนับพาไปหน้า /reports/visitors ซึ่งอยู่ใต้โมดูลเดียวกัน
export default withModule('report', SiteVisitCounter)
