import { Link } from 'react-router-dom'
import { useTenant } from '../../../../contexts/TenantContext'
import { MessageSquareWarning, Search, Smile, Wifi, Users, MapPinned, Compass } from 'lucide-react'
import BannerSlider from '../../../../components/home/BannerSlider'
import WeatherWidget from '../../../../components/home/WeatherWidget'
import ComplaintBand from '../../../../components/home/ComplaintBand'
import ComplaintStatsWidget from '../../../../components/home/ComplaintStatsWidget'
import PostsHighlight from '../../../../components/home/PostsHighlight'
import TourismSection from '../../../../components/home/TourismSection'
import DataCenterBanner from '../../../../components/home/DataCenterBanner'

// เฉพาะเมนูที่มีระบบจริงรองรับเท่านั้น — ตั้งใจไม่ใส่ "ชำระภาษี/ค่าขยะ/เบี้ยยังชีพ" เพราะยังไม่มี
// ระบบชำระเงินจริงในแพลตฟอร์มนี้ ใส่ไปจะเป็นปุ่มหลอกที่กดแล้วไม่มีอะไรเกิดขึ้น
const E_SERVICE_ITEMS = [
  { label: 'แจ้งเรื่องร้องเรียน',        href: '/complaint',     icon: MessageSquareWarning, color: '#ef4444' },
  { label: 'ติดตามเรื่องร้องเรียน/ร้องทุกข์', href: '/my-complaints', icon: Search,            color: '#2563eb' },
  { label: 'ประเมินความพึงพอใจ',        href: '/satisfaction',  icon: Smile,                 color: '#f59e0b' },
]

// ป้ายลอย 4 มุมทับภาพแบนเนอร์ — ใช้ชื่อฟีเจอร์ของเราเองล้วนๆ (ไม่ได้ยืมข้อความ/โลโก้จากที่ไหน)
// เพื่อให้ hero ดูมีมิติแบบ "smart city" ตามภาพต้นแบบที่ขอเลียนแบบเลย์เอาต์
const HERO_BADGES = [
  { icon: Wifi,       label: 'บริการออนไลน์', pos: 'top-3 left-3' },
  { icon: Users,       label: 'เพื่อประชาชน',   pos: 'top-3 right-3' },
  { icon: MapPinned,  label: 'ข้อมูลเปิด GIS', pos: 'bottom-3 left-3' },
  { icon: Compass,    label: 'แหล่งท่องเที่ยว', pos: 'bottom-3 right-3' },
]

function HeroBanner({ tenant }) {
  // fallback gradient ไว้ใต้ BannerSlider เสมอ — เผื่อ อปท. ยังไม่ได้อัปโหลดรูปแบนเนอร์เลย (BannerSlider
  // จะ render null ทันที ไม่เหลือความสูงอะไรให้ป้าย/wordmark ทับ) มี min-height กันไม่ให้ยุบจนป้ายหาย
  return (
    <div className="relative rounded-2xl overflow-hidden"
      style={{ minHeight: 200, background: 'linear-gradient(135deg, var(--color-primary), #0f172a)' }}>
      <BannerSlider />
      <div className="absolute inset-0 pointer-events-none hidden sm:block">
        {HERO_BADGES.map(({ icon: Icon, label, pos }) => (
          <div key={label}
            className={`absolute ${pos} flex items-center gap-1.5 px-2.5 py-1.5 rounded-full backdrop-blur-md bg-white/25 border border-white/40 text-white text-[10px] font-bold shadow-lg`}>
            <Icon size={13} /> {label}
          </div>
        ))}
      </div>
      <div className="absolute inset-0 flex items-center justify-center px-4 pointer-events-none">
        <div className="text-center px-5 py-3 rounded-2xl backdrop-blur-md bg-black/30 border border-white/20 max-w-[85%]">
          <p className="text-white font-black text-lg sm:text-2xl leading-tight drop-shadow-lg">{tenant?.name}</p>
          <p className="text-white/80 text-[11px] sm:text-sm font-semibold mt-0.5">
            {tenant?.system_subtitle || 'บริการออนไลน์ครบวงจร สะดวก รวดเร็ว'}
          </p>
        </div>
      </div>
    </div>
  )
}

function EServiceGrid() {
  return (
    <div className="rounded-2xl overflow-hidden shadow-sm border border-gray-100">
      <div className="px-4 py-4 sm:py-5"
        style={{ background: 'linear-gradient(135deg, #306eb8 0%, #1d4aa0 100%)' }}>
        <p className="text-white font-black text-xl sm:text-2xl tracking-tight italic">e-Service</p>
        <p className="text-white/70 text-xs sm:text-sm font-semibold mt-0.5">บริการแบบเบ็ดเสร็จ ณ จุดเดียว ด้วยระบบออนไลน์</p>
      </div>
      <div className="bg-white p-3 sm:p-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {E_SERVICE_ITEMS.map(({ label, href, icon: Icon, color }) => (
            <Link key={href} to={href}
              className="flex items-center gap-2.5 p-2.5 rounded-2xl border border-gray-100 hover:bg-gray-50 active:scale-95 transition-all">
              <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: color + '18' }}>
                <Icon size={18} style={{ color }} />
              </div>
              <p className="text-xs font-bold text-gray-700 leading-tight">{label}</p>
            </Link>
          ))}
        </div>
        <Link to="/complaint"
          className="mt-3 flex items-center justify-center gap-1.5 py-2 rounded-full text-xs font-bold"
          style={{ backgroundColor: '#facc15', color: '#78350f' }}>
          ดูทั้งหมด
        </Link>
      </div>
    </div>
  )
}

export default function ServiceHubHome() {
  const { tenant } = useTenant()

  return (
    <div className="bg-gray-50">
      <div className="px-3 sm:px-4 lg:px-6 pt-2 lg:pt-3 pb-4 max-w-[1440px] mx-auto space-y-3">
        <HeroBanner tenant={tenant} />

        <div className="grid lg:grid-cols-12 gap-3">
          <div className="lg:col-span-8">
            <EServiceGrid />
          </div>
          <aside className="lg:col-span-4">
            <WeatherWidget />
          </aside>
        </div>

        <ComplaintBand variant="clean" />
        <ComplaintStatsWidget />
        <DataCenterBanner />
        <PostsHighlight />
      </div>

      <div className="px-3 sm:px-4 lg:px-6 pb-2 max-w-[1440px] mx-auto">
        <TourismSection />
      </div>

      <div className="px-3 sm:px-4 lg:px-6 py-4 max-w-[1440px] mx-auto flex flex-wrap gap-2">
        {tenant?.facebook_url && (
          <a href={tenant.facebook_url} target="_blank" rel="noopener noreferrer"
            className="flex-1 min-w-35 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white"
            style={{ backgroundColor: '#1877f2' }}>
            💬 แชทผ่าน Facebook
          </a>
        )}
        {tenant?.line_oa_url && (
          <a href={tenant.line_oa_url} target="_blank" rel="noopener noreferrer"
            className="flex-1 min-w-35 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white"
            style={{ backgroundColor: '#06c755' }}>
            💬 แชทผ่าน LINE
          </a>
        )}
      </div>

      <div className="text-center text-[11px] text-gray-400 pb-6 px-4">
        Copyright © {new Date().getFullYear()}.{tenant?.website_url ? ` ${tenant.website_url.replace(/^https?:\/\//, '')}` : ''} สงวนลิขสิทธิ์
        {tenant?.developer_name && <> · พัฒนาโดย {tenant.developer_name}</>}
      </div>
    </div>
  )
}
