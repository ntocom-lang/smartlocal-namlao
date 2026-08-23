import { Link } from 'react-router-dom'
import { ArrowLeft, ClipboardList, ShieldCheck, Database, ChevronRight, FileBarChart } from 'lucide-react'
import { useTenant } from '../contexts/TenantContext'

const REPORTS = [
  {
    label: 'เรื่องร้องเรียน/ร้องทุกข์',
    desc: 'สถิติการรับเรื่องและระยะเวลาดำเนินการ',
    href: '/reports/complaints',
    Icon: ClipboardList,
    iconBg: 'bg-amber-500',
  },
  {
    label: 'งานบริการประชาชน',
    desc: 'สถิติการออกเอกสาร/ใบรับรองดิจิทัล',
    href: '/doc-stats',
    Icon: ShieldCheck,
    iconBg: 'bg-emerald-500',
  },
  {
    label: 'ภาพรวมระบบสารสนเทศดิจิทัล',
    desc: 'จำนวนข้อมูลสถานที่/โครงสร้างพื้นฐานในระบบ',
    href: '/data-center/public',
    Icon: Database,
    iconBg: 'bg-sky-500',
  },
]

export default function ReportsHub() {
  const { tenant } = useTenant()

  return (
    <div className="min-h-screen pb-28 md:pb-8" style={{ backgroundColor: '#eef2f7' }}>
      <div className="bg-white border-b border-gray-100 shadow-sm px-4 py-5">
        <div className="max-w-2xl mx-auto">
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-4">
            <ArrowLeft size={14} /> กลับหน้าแรก
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
                 style={{ backgroundColor: 'var(--color-primary)' }}>
              <FileBarChart size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-black text-gray-800 leading-tight">รายงาน</h1>
              <p className="text-sm text-gray-500 mt-0.5">{tenant?.name ?? 'หน่วยงาน'}</p>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            ข้อมูลสถิติภาพรวมสำหรับประชาชน เปิดเผยแบบไม่ระบุตัวตน ไม่มีข้อมูลส่วนบุคคล
          </p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-3">
        {REPORTS.map(r => (
          <Link key={r.href} to={r.href}
            className="flex items-center gap-3 bg-white rounded-2xl border border-gray-100 p-4 hover:border-gray-200 hover:shadow-sm active:scale-[0.99] transition-all">
            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${r.iconBg}`}>
              <r.Icon size={20} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-gray-800">{r.label}</p>
              <p className="text-xs text-gray-400 mt-0.5">{r.desc}</p>
            </div>
            <ChevronRight size={18} className="text-gray-300 shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  )
}
