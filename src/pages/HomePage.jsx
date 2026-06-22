import { Link } from 'react-router-dom'
import { useTenant } from '../contexts/TenantContext'
import { useAuth } from '../contexts/AuthContext'
import HeroBanner from '../components/home/HeroBanner'
import StaffSection from '../components/home/StaffSection'
import NewsSection from '../components/home/NewsSection'
import TourismSection from '../components/home/TourismSection'
import { Info, LayoutDashboard, ChevronRight, Briefcase, FileText, ClipboardList, FolderOpen } from 'lucide-react'
import WeatherWidget from '../components/home/WeatherWidget'

export default function HomePage() {
  const { tenant } = useTenant()
  const { role } = useAuth()

  const isAdmin = role === 'admin' || role === 'superadmin' || role === 'officer'
  const isViewer = role === 'viewer'
  const isCouncil = role === 'council'
  const isStaff = role === 'staff' || role === 'technician'

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 py-4 md:py-6 space-y-4 md:space-y-6">

      {/* กลุ่มบนสุด */}
      <div className="flex flex-col gap-2 md:gap-3">
        <WeatherWidget />

        {/* Admin / Staff shortcuts — side by side on PC */}
        {(isAdmin || isViewer || isCouncil || isStaff) && (
          <div className="flex flex-col md:flex-row gap-2">
            {(isAdmin || isViewer || isCouncil) && (
              <Link to="/admin"
                className="flex items-center gap-3 rounded-2xl px-4 py-3.5 shadow-md active:scale-98 transition-transform md:flex-1"
                style={{ background: 'linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 100%)' }}>
                <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                  <LayoutDashboard size={18} className="text-white" />
                </div>
                <div className="flex-1">
                  <p className="text-white font-bold text-sm">
                    {isViewer ? 'ดูรายงานและคำร้อง' : isCouncil ? 'ปฏิทินกิจกรรม' : 'เข้าสู่แผงควบคุม Admin'}
                  </p>
                  <p className="text-white/70 text-xs">
                    {isViewer ? 'รายงานสรุป และรายการคำร้องของหน่วยงาน' : isCouncil ? 'จัดการกิจกรรมของสภาเทศบาล' : 'จัดการคำร้อง สถานที่ และผู้ใช้งาน'}
                  </p>
                </div>
                <ChevronRight size={18} className="text-white/60" />
              </Link>
            )}
            {isStaff && (
              <Link to="/staff"
                className="flex items-center gap-3 rounded-2xl px-4 py-3.5 shadow-md active:scale-98 transition-transform md:flex-1"
                style={{ background: 'linear-gradient(135deg, #0369a1 0%, #0ea5e9 100%)' }}>
                <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                  <Briefcase size={18} className="text-white" />
                </div>
                <div className="flex-1">
                  <p className="text-white font-bold text-sm">ระบบเจ้าหน้าที่</p>
                  <p className="text-white/70 text-xs">กล่องงาน เอกสาร อนุมัติ รายงาน</p>
                </div>
                <ChevronRight size={18} className="text-white/60" />
              </Link>
            )}
          </div>
        )}

        {/* Quick Actions — 2 cols mobile / 4 cols PC */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { to: '/doc-request', label: 'ขอเอกสาร',     sub: 'ราชการออนไลน์',     Icon: FileText,      bg: 'bg-blue-50',   iconCls: 'text-blue-500' },
            { to: '/complaint',   label: 'ยื่นคำร้อง',    sub: 'แจ้งซ่อม / แจ้งเหตุ', Icon: ClipboardList, bg: 'bg-red-50',    iconCls: 'text-red-500' },
            { to: '/my-docs',     label: 'เอกสารของฉัน',  sub: 'ติดตามสถานะเอกสาร',   Icon: FolderOpen,    bg: 'bg-purple-50', iconCls: 'text-purple-500' },
            { to: '/my-complaints', label: 'คำร้องของฉัน', sub: 'ติดตามสถานะคำร้อง',   Icon: ClipboardList, bg: 'bg-green-50',  iconCls: 'text-green-500' },
          ].map(({ to, label, sub, Icon, bg, iconCls }) => (
            <Link key={to} to={to}
              className="flex items-center gap-2.5 bg-white rounded-2xl px-3.5 py-3 shadow-sm border border-gray-100 hover:shadow-md active:scale-[0.98] transition-all">
              <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center shrink-0`}>
                <Icon size={18} className={iconCls} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-gray-800 leading-tight">{label}</p>
                <p className="text-[11px] text-gray-400 leading-tight">{sub}</p>
              </div>
            </Link>
          ))}
        </div>

        {!role && (
          <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800">
            <Info size={16} className="shrink-0 mt-0.5" />
            <p>สมัครสมาชิกเพื่อติดตามสถานะคำร้องของท่าน และรับการแจ้งเตือนทันที</p>
          </div>
        )}

        <HeroBanner />
      </div>

      <StaffSection />

      {/* News + Tourism — side by side on PC */}
      <div className="md:grid md:grid-cols-2 md:gap-6 space-y-4 md:space-y-0">
        <NewsSection />
        <TourismSection />
      </div>
    </div>
  )
}
