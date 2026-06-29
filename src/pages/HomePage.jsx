import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTenant } from '../contexts/TenantContext'
import { useAuth } from '../contexts/AuthContext'
import HeroBanner from '../components/home/HeroBanner'
import StaffSection from '../components/home/StaffSection'
import NewsSection from '../components/home/NewsSection'
import TourismSection from '../components/home/TourismSection'
import ComplaintBand from '../components/home/ComplaintBand'
import BannerSlider from '../components/home/BannerSlider'
import { Info, ChevronRight, Briefcase } from 'lucide-react'
import WeatherWidget from '../components/home/WeatherWidget'

const BASE_DOC_TYPES = [
  { value: 'residence_cert',  label: 'ใบรับรองการอยู่อาศัย',          emoji: '🏠' },
  { value: 'personal_cert',   label: 'หนังสือรับรองบุคคล',             emoji: '👤' },
  { value: 'conduct_cert',    label: 'หนังสือรับรองความประพฤติ',       emoji: '✅' },
  { value: 'tax_notice',      label: 'ชำระภาษีที่ดินและสิ่งปลูกสร้าง', emoji: '🏦' },
  { value: 'waste_collection', label: 'ชำระค่าธรรมเนียมขยะ',           emoji: '🗑️' },
  { value: 'other',           label: 'คำขออื่นๆ',                      emoji: '📝' },
]

export default function HomePage() {
  const { tenant } = useTenant()
  const { role } = useAuth()

  const isAdmin = role === 'admin' || role === 'superadmin' || role === 'officer'
  const isViewer = role === 'viewer'
  const isCouncil = role === 'council'
  const isStaff = role === 'staff' || role === 'technician'

  const docTypes = useMemo(() => {
    const extras = (tenant?.fee_schedule?._custom_types || []).map(t => ({
      value: t.value, label: t.label, emoji: t.emoji || '📋',
    }))
    return [...BASE_DOC_TYPES, ...extras]
  }, [tenant])

  return (
    <div className="max-w-6xl mx-auto md:px-8 md:py-6 space-y-4 md:space-y-6">

      {/* Hero zone — ยืดขึ้นไปอยู่ใต้ sticky nav (margin-top: -68px) เพื่อให้รูปต่อเนื่อง */}
      <div className="relative overflow-hidden"
        style={tenant?.header_image_url
          ? { marginTop: -100, borderRadius: '0 0 28px 28px', position: 'relative', zIndex: 1 }
          : {}}>
        {tenant?.header_image_url && <>
          <img src={tenant.header_image_url} aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover object-top pointer-events-none" />
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.05) 55%, white 100%)' }} />
        </>}
        <div className={`relative z-10 flex flex-col gap-2 md:gap-3 ${tenant?.header_image_url ? 'px-4 pt-28 pb-8' : 'px-4 py-4'}`}>
          <WeatherWidget transparent={!!tenant?.header_image_url} />
          <BannerSlider />
        </div>
      </div>

      {/* ส่วนที่เหลือ — ปกติ */}
      <div className="flex flex-col gap-2 md:gap-3 px-4 md:px-0">

        {/* Staff shortcut — เฉพาะ staff/technician (admin ใช้ icon ใน Header แทน) */}
        {isStaff && (
          <Link to="/staff"
            className="flex items-center gap-3 rounded-2xl px-4 py-3.5 shadow-md active:scale-98 transition-transform"
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

        {/* Service Band */}
        <div className="rounded-2xl shadow-md px-4 py-5"
          style={{ background: 'linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 100%)' }}>
          <p className="text-white/80 text-[11px] font-semibold mb-4 tracking-widest uppercase">E-Service</p>
          <div className="flex gap-4 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {docTypes.map(({ value, label, emoji }) => (
              <Link key={value} to={`/doc-request?type=${value}`}
                className="flex flex-col items-center gap-2 shrink-0 active:scale-95 transition-transform">
                <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center shadow-inner text-2xl">
                  {emoji}
                </div>
                <p className="text-white text-[10px] font-semibold text-center leading-tight w-16">{label}</p>
              </Link>
            ))}
          </div>
        </div>

        {!role && (
          <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800">
            <Info size={16} className="shrink-0 mt-0.5" />
            <p>สมัครสมาชิกเพื่อติดตามสถานะคำร้องของท่าน และรับการแจ้งเตือนทันที</p>
          </div>
        )}

        <HeroBanner />
        <ComplaintBand />
      </div>{/* end content section */}

      <div className="px-4 md:px-0"><StaffSection /></div>

      {/* News + Tourism — side by side on PC */}
      <div className="px-4 md:px-0 md:grid md:grid-cols-2 md:gap-6 space-y-4 md:space-y-0">
        <NewsSection />
        <TourismSection />
      </div>
    </div>
  )
}
