import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTenant } from '../../../../contexts/TenantContext'
import { Wifi, Users, MapPinned, Compass, Phone, BookUser, ChevronRight } from 'lucide-react'
import BannerSlider from '../../../../components/home/BannerSlider'
// ComplaintBand นำออกจากหน้าแรกตามคำขอ (เข้าใช้งานผ่านปุ่ม ร้องเรียน/ร้องทุกข์ ด้านบน)
import ComplaintStatsWidget from '../../../../components/home/ComplaintStatsWidget'
import PostsHighlight from '../../../../components/home/PostsHighlight'
import TourismSection from '../../../../components/home/TourismSection'
import SmartCityBanner from '../../../../components/home/SmartCityBanner'
import { CategoryIcon } from '../../../../lib/categoryIcon'

// รายการ "งานบริการประชาชน" จริง — ใช้ชุดข้อมูลเดียวกับ EServiceBlock ของธีมอื่นๆ (EcoFriendly ฯลฯ)
// คือประเภทคำร้องขอเอกสาร ไม่ใช่เรื่องร้องเรียน (นั่นเป็นของ ComplaintBand คนละส่วนกัน) ผูกกับ
// /doc-request?type=... เหมือนกันทุกธีม + เพิ่มประเภทที่แอดมินตั้งเองได้ผ่าน fee_schedule._custom_types
const COMPLAINT_SERVICE = {
  value: 'complaint',
  label: 'ร้องเรียน/ร้องทุกข์',
  emoji: '📢',
  href: '/complaint',
}

const CITIZEN_SERVICE = {
  value: 'citizen_service',
  label: 'บริการประชาชน',
  emoji: '📋',
  href: '/doc-request',
}

const SATISFACTION_SERVICE = {
  value: 'satisfaction',
  label: 'ประเมินความพึงพอใจ',
  emoji: '⭐',
  href: '/satisfaction',
}

const MANUAL_SERVICE = {
  value: 'manual',
  label: 'คู่มือสำหรับประชาชน',
  emoji: '📖',
  href: '/manual-citizen.html',
  external: true,
}

// 3 บริการเอกสารเดิม (ขยะ/ภาษี/ขอสร้างบ้าน) เข้าถึงผ่านหน้า /doc-request
// - ค่าธรรมเนียมขยะ
// - ค่าธรรมเนียม/ภาษี
// - ขออนุญาตก่อสร้างบ้าน


// ป้ายลอย 4 มุมทับภาพแบนเนอร์ — ใช้ชื่อฟีเจอร์ของเราเองล้วนๆ (ไม่ได้ยืมข้อความ/โลโก้จากที่ไหน)
// เพื่อให้ hero ดูมีมิติแบบ "smart city" ตามภาพต้นแบบที่ขอเลียนแบบเลย์เอาต์
const HERO_BADGES = [
  { icon: Wifi,       label: 'บริการออนไลน์', pos: 'top-2 left-3' },
  { icon: Users,       label: 'เพื่อประชาชน',   pos: 'top-2 right-3' },
  { icon: MapPinned,  label: 'ข้อมูลเปิด GIS', pos: 'bottom-2 left-3' },
  { icon: Compass,    label: 'แหล่งท่องเที่ยว', pos: 'bottom-2 right-3' },
]

function HeroBanner({ tenant, rounded = 'rounded-2xl' }) {
  // ไม่ใช้รูปแบนเนอร์ของแอดมิน (BannerSlider ตัว "สไลด์ Banner หน้าแรก") ตรงนี้ — ย้ายไปไว้ใต้ E-Service
  // แทนแล้ว ตำแหน่งนี้ใช้ "ภาพพื้นหลัง Header" (tenant.header_image_url) จากแท็บแบรนด์และรูปภาพแทน — ธีมนี้
  // ไม่มีแถบ header บางๆ ให้ใส่รูปแบบธีมอื่น จึงยืมช่องอัปโหลดเดิมมาใช้กับ hero ใหญ่แทน ไม่มีรูป
  // ก็ยังใช้ไล่สีเดิม (var(--color-primary) → เข้ม) เป็น fallback ไม่ว่างเปล่า
  return (
    <div className={`relative overflow-hidden ${rounded}`}
      style={{ minHeight: 100, background: 'linear-gradient(135deg, var(--color-primary), #0f172a)' }}>
      {tenant?.header_image_url && (
        <>
          <img src={tenant.header_image_url} alt="" className="absolute inset-0 w-full h-full object-cover" />
          {/* โหมด 'full' (แอดมินเลือกไว้ในแท็บแบรนด์และรูปภาพ) = โชว์ภาพเต็มสีสัน ไม่คลุมเงา
              โหมด 'background' (ค่าเริ่มต้น) = คลุมเงาให้ตัวหนังสือ/ป้ายด้านบนอ่านง่าย */}
          {tenant?.header_image_mode !== 'full' && (
            <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.15) 50%, rgba(0,0,0,0.45) 100%)' }} />
          )}
        </>
      )}
      <div className="absolute inset-0 pointer-events-none hidden md:block">
        {HERO_BADGES.map(({ icon: Icon, label, pos }) => (
          <div key={label}
            className={`absolute ${pos} flex items-center gap-1.5 px-2 py-1 rounded-full backdrop-blur-md bg-white/25 border border-white/40 text-white text-[9px] font-bold shadow-lg`}>
            <Icon size={12} /> {label}
          </div>
        ))}
      </div>
      <div className="absolute inset-0 flex items-center justify-center px-4 pointer-events-none">
        <div className="text-center px-4 py-1.5 sm:py-2 rounded-xl backdrop-blur-md bg-black/30 border border-white/20 max-w-[85%]">
          <p className="text-white font-black text-base sm:text-xl leading-tight drop-shadow-lg">{tenant?.name}</p>
          <p className="text-white/80 text-[10px] sm:text-xs font-semibold mt-0.5">
            {tenant?.system_subtitle || 'บริการออนไลน์ครบวงจร สะดวก รวดเร็ว'}
          </p>
        </div>
      </div>
    </div>
  )
}

function EServiceGrid({ docTypes, rounded = 'rounded-2xl' }) {
  const { tenant } = useTenant()
  const displayItems = docTypes.slice(0, 6)
  const isPair = displayItems.length === 2
  const gridCols = isPair
    ? 'grid-cols-2'
    : displayItems.length === 4
      ? 'grid-cols-4'
      : displayItems.length <= 3
        ? 'grid-cols-3'
        : 'grid-cols-3 sm:grid-cols-6'
  return (
    <div className={`relative isolate overflow-hidden shadow-lg p-4 sm:p-5 ${rounded}`}
      style={{
        background: [
          'radial-gradient(circle at 88% 12%, rgba(34,211,238,0.42) 0%, transparent 26%)',
          'radial-gradient(circle at 8% 92%, rgba(139,92,246,0.34) 0%, transparent 32%)',
          'linear-gradient(135deg, #2563ad 0%, #19458f 52%, #312e81 100%)',
        ].join(', '),
      }}>
      {/* ลาย digital grid + วงโคจรบางๆ เพิ่มมิติ โดยไม่แย่งสายตาจากปุ่มบริการ */}
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-25"
        style={{
          backgroundImage: [
            'linear-gradient(rgba(255,255,255,0.16) 1px, transparent 1px)',
            'linear-gradient(90deg, rgba(255,255,255,0.16) 1px, transparent 1px)',
          ].join(', '),
          backgroundSize: '30px 30px',
          maskImage: 'linear-gradient(to bottom, black, transparent 78%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black, transparent 78%)',
        }} />
      <div className="pointer-events-none absolute -right-14 -top-20 -z-10 h-52 w-52 rounded-full border border-cyan-100/25" />
      <div className="pointer-events-none absolute -right-5 -top-10 -z-10 h-32 w-32 rounded-full border border-cyan-100/25" />
      <div className="pointer-events-none absolute -bottom-24 -left-20 -z-10 h-56 w-56 rounded-full bg-violet-400/20 blur-2xl" />
      <div className="pointer-events-none absolute left-[12%] top-4 -z-10 h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-200 shadow-[0_0_12px_rgba(165,243,252,0.9)]" />
      <div className="pointer-events-none absolute right-[28%] top-10 -z-10 h-1 w-1 rounded-full bg-white/80 shadow-[0_0_9px_rgba(255,255,255,0.9)]" />
      <svg className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-24 w-full opacity-[0.09]"
        viewBox="0 0 600 100" preserveAspectRatio="none" aria-hidden="true">
        <path fill="white" d="M0 100V76h28V58h18v42h25V67h14v-9h15v42h23V49h18v51h32V73h23v27h31V55h11V40h18v60h35V69h21v31h27V47h13v-8h16v61h30V63h26v37h22V52h21v48h39V72h22v28h28V57h18v43h31V69h19v31h27V61h26v39H600v0z" />
        <path d="M0 45 C130 6 250 82 388 35 S540 36 620 10" fill="none" stroke="white" strokeWidth="1.5" strokeDasharray="5 8" />
      </svg>

      <p className="relative z-10 inline-block font-black text-2xl sm:text-3xl tracking-tight italic overflow-hidden"
        style={{
          background: 'linear-gradient(180deg, #fed7aa 0%, #fb923c 35%, #ea580c 70%, #c2410c 100%)',
          WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
          filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.35))',
        }}>
        e-Service
        {/* แถบแสงสะท้อนพาดทแยง ให้ความรู้สึกมันวาวแบบโลโก้ 3 มิติตามภาพอ้างอิง */}
        <span className="absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(115deg, transparent 35%, rgba(255,255,255,0.85) 48%, transparent 58%)' }} />
      </p>
      <p className="relative z-10 text-white/75 text-[11px] sm:text-xs font-semibold mt-0.5 mb-3">บริการแบบเบ็ดเสร็จ ณ จุดเดียว ด้วยระบบออนไลน์</p>
      {/* ปุ่มติดต่อวางคู่กัน: เหตุด่วนอยู่ซ้ายตามลำดับการมอง และสมุดโทรศัพท์อยู่ขวา
          ใช้ <Link> ตรงๆ เพราะทั้งสองเส้นทางเปิดเสมอและไม่ได้ผูกกับ MODULE_ROUTES */}
      <div className="relative z-10 mb-2 grid grid-cols-2 items-stretch gap-2">
        <Link to="/emergency" aria-label="สายด่วนฉุกเฉิน แจ้งเหตุด่วนตลอด 24 ชั่วโมง"
          className="flex min-w-0 items-center gap-2 rounded-xl border border-red-300/60 px-2.5 py-2.5 shadow-md shadow-red-950/25 transition-all hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.98]"
          style={{ background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 55%, #b91c1c 100%)' }}>
          <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 ring-2 ring-white/45">
            <Phone size={17} className="text-white" />
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-yellow-300 ring-2 ring-red-600" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-black leading-tight text-white drop-shadow-sm sm:text-[13px]">สายด่วนฉุกเฉิน</span>
            <span className="mt-0.5 block text-[9px] font-semibold leading-tight text-white/85 sm:text-[10px]">ฉุกเฉินตลอด 24 ชั่วโมง</span>
          </span>
          <ChevronRight size={13} className="shrink-0 text-white/90" />
        </Link>

        <Link to="/directory" aria-label="เบอร์โทรสำคัญ หน่วยงานราชการและผู้นำท้องถิ่น"
          className="flex min-w-0 items-center gap-2 rounded-xl border border-white/70 bg-white/95 px-2.5 py-2.5 shadow-md shadow-blue-950/10 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:bg-white hover:shadow-lg active:scale-[0.98]">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700">
            <BookUser size={17} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-black leading-tight text-gray-800 sm:text-[13px]">เบอร์โทรสำคัญ</span>
            <span className="mt-0.5 block text-[9px] font-semibold leading-tight text-gray-500 sm:text-[10px]">รวมเบอร์ติดต่อในพื้นที่</span>
          </span>
          <ChevronRight size={13} className="shrink-0 text-gray-400" />
        </Link>
      </div>
      <div className={`relative z-10 grid ${gridCols} ${isPair ? 'gap-2' : 'gap-1.5 sm:gap-2'}`}>
        {displayItems.map(({ value, label, emoji, href, external }) => {
          const cardContent = (
            <>
              <CategoryIcon emoji={emoji} size={isPair ? 26 : 22} style={tenant?.category_icon_style} />
              <p className={`${isPair ? 'text-[11px] sm:text-xs' : 'text-[10px] sm:text-[11px]'} font-bold text-gray-700 text-center leading-tight line-clamp-2 transition-colors group-hover:text-blue-700`}>{label}</p>
            </>
          )
          const cardClass = `group flex flex-col items-center justify-center gap-1.5 rounded-xl border border-white/70 bg-white/95 ${isPair ? 'p-2.5 sm:p-3' : 'p-1.5 sm:p-2'} shadow-md shadow-blue-950/10 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:bg-white hover:shadow-lg active:scale-95`
          if (external) {
            return (
              <a key={value} href={href} target="_blank" rel="noopener noreferrer" className={cardClass}>
                {cardContent}
              </a>
            )
          }
          return (
            <Link key={value} to={href || `/doc-request?type=${value}`} className={cardClass}>
              {cardContent}
            </Link>
          )
        })}
      </div>
    </div>
  )
}

export default function ServiceHubHome() {
  const { tenant, isModuleEnabled } = useTenant()

  const docTypes = useMemo(() => {
    const extras = (tenant?.fee_schedule?._custom_types || []).map(t => ({
      value: t.value, label: t.label, emoji: t.emoji || '📋',
    }))
    const complaintsEnabled = !isModuleEnabled || isModuleEnabled('complaints')
    const inboxEnabled = !isModuleEnabled || isModuleEnabled('inbox')
    const base = []
    if (complaintsEnabled) base.push(COMPLAINT_SERVICE)
    if (inboxEnabled) base.push(CITIZEN_SERVICE)
    if (complaintsEnabled) base.push(SATISFACTION_SERVICE)
    base.push(MANUAL_SERVICE)
    return [...base, ...extras]
  }, [tenant, isModuleEnabled])

  return (
    <div className="bg-gray-50">
      {/* Hero + e-Service ตั้งใจให้ชิดขอบจอเต็ม มุมเหลี่ยม ไม่มีช่องว่างคั่น — ตรงตามภาพอ้างอิงเป๊ะ
          ต่างจากส่วนอื่นด้านล่างที่ยังเป็นการ์ดโค้งมนมีระยะขอบตามปกติ */}
      <div className="max-w-[1440px] mx-auto">
        <HeroBanner tenant={tenant} rounded="rounded-none" />
        <EServiceGrid docTypes={docTypes} rounded="rounded-none" />
      </div>

      <div className="px-3 sm:px-4 lg:px-6 pt-3 pb-4 max-w-[1440px] mx-auto space-y-3">
        {/* สถิติร้องเรียนขึ้นมาไว้ใต้ e-Service ทันที — บนมือถือจะเห็นตัวเลขได้ตั้งแต่จอแรก
            ไม่ต้องเลื่อนผ่านสไลด์ภาพก่อน (BannerSlider สูงเกินครึ่งจอบนเครื่องเล็ก) */}
        <ComplaintStatsWidget />
        <BannerSlider />
        <PostsHighlight />
        <SmartCityBanner />
      </div>

      <div className="px-3 sm:px-4 lg:px-6 pb-2 max-w-[1440px] mx-auto">
        <TourismSection />
      </div>

    </div>
  )
}
