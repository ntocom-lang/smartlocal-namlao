import { useMemo } from 'react'
import ModuleLink from '../../../common/ModuleLink'
import { Link } from 'react-router-dom'
import { useTenant } from '../../../../contexts/TenantContext'
import { Wifi, Users, MapPinned, Compass, Phone, BookUser, ChevronRight } from 'lucide-react'
import BannerSlider from '../../../../components/home/BannerSlider'
import ComplaintBand from '../../../../components/home/ComplaintBand'
import ComplaintStatsWidget from '../../../../components/home/ComplaintStatsWidget'
import PostsHighlight from '../../../../components/home/PostsHighlight'
import TourismSection from '../../../../components/home/TourismSection'
import SmartCityBanner from '../../../../components/home/SmartCityBanner'
import { CategoryIcon } from '../../../../lib/categoryIcon'

// รายการ "งานบริการประชาชน" จริง — ใช้ชุดข้อมูลเดียวกับ EServiceBlock ของธีมอื่นๆ (EcoFriendly ฯลฯ)
// คือประเภทคำร้องขอเอกสาร ไม่ใช่เรื่องร้องเรียน (นั่นเป็นของ ComplaintBand คนละส่วนกัน) ผูกกับ
// /doc-request?type=... เหมือนกันทุกธีม + เพิ่มประเภทที่แอดมินตั้งเองได้ผ่าน fee_schedule._custom_types
const BASE_DOC_TYPES = [
  { value: 'waste_collection', label: 'ค่าธรรมเนียมขยะ',      emoji: '🗑️' },
  { value: 'tax_notice',       label: 'ค่าธรรมเนียม/ภาษี',     emoji: '🏛️' },
  { value: 'building_permit',  label: 'ขออนุญาตก่อสร้างบ้าน', emoji: '🏗️' },
]

// ป้ายลอย 4 มุมทับภาพแบนเนอร์ — ใช้ชื่อฟีเจอร์ของเราเองล้วนๆ (ไม่ได้ยืมข้อความ/โลโก้จากที่ไหน)
// เพื่อให้ hero ดูมีมิติแบบ "smart city" ตามภาพต้นแบบที่ขอเลียนแบบเลย์เอาต์
const HERO_BADGES = [
  { icon: Wifi,       label: 'บริการออนไลน์', pos: 'top-3 left-3' },
  { icon: Users,       label: 'เพื่อประชาชน',   pos: 'top-3 right-3' },
  { icon: MapPinned,  label: 'ข้อมูลเปิด GIS', pos: 'bottom-3 left-3' },
  { icon: Compass,    label: 'แหล่งท่องเที่ยว', pos: 'bottom-3 right-3' },
]

function HeroBanner({ tenant, rounded = 'rounded-2xl' }) {
  // ไม่ใช้รูปแบนเนอร์ของแอดมิน (BannerSlider ตัว "สไลด์ Banner หน้าแรก") ตรงนี้ — ย้ายไปไว้ใต้ E-Service
  // แทนแล้ว ตำแหน่งนี้ใช้ "ภาพพื้นหลัง Header" (tenant.header_image_url) จากแท็บแบรนด์และรูปภาพแทน — ธีมนี้
  // ไม่มีแถบ header บางๆ ให้ใส่รูปแบบธีมอื่น จึงยืมช่องอัปโหลดเดิมมาใช้กับ hero ใหญ่แทน ไม่มีรูป
  // ก็ยังใช้ไล่สีเดิม (var(--color-primary) → เข้ม) เป็น fallback ไม่ว่างเปล่า
  return (
    <div className={`relative overflow-hidden ${rounded}`}
      style={{ minHeight: 200, background: 'linear-gradient(135deg, var(--color-primary), #0f172a)' }}>
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

function EServiceGrid({ docTypes, rounded = 'rounded-2xl' }) {
  const { tenant } = useTenant()
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
      {/* สายด่วนฉุกเฉิน — วางเป็นแถวแรกเหนืองานบริการตามที่ผู้บริหารสั่ง ไม่ยัดเป็นการ์ดในกริด 3 ช่อง
          เพราะ (1) จำนวนบริการจะเกินแถวพอดีกลายเป็นการ์ดโดดเดี่ยว (2) สีแดงเต็มแถบแยกเหตุด่วนออกจาก
          งานบริการทั่วไปชัดกว่า และพื้นที่กดใหญ่กว่า เหมาะกับผู้สูงอายุที่กดตอนตกใจ
          ใช้ <Link> ตรงๆ ไม่ผ่าน ModuleLink เพราะ /emergency ไม่ได้ผูกกับโมดูลใน MODULE_ROUTES (เปิดเสมอ) */}
      <Link to="/emergency" aria-label="สายด่วนฉุกเฉิน แจ้งเหตุด่วนตลอด 24 ชั่วโมง"
        className="relative z-10 mb-2 flex items-center gap-3 rounded-xl border border-red-300/60 px-3 py-2.5 shadow-md shadow-red-950/25 transition-all hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.98]"
        style={{ background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 55%, #b91c1c 100%)' }}>
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/20 ring-2 ring-white/45">
          <Phone size={19} className="text-white" />
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-yellow-300 ring-2 ring-red-600" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] sm:text-[15px] font-black leading-tight text-white drop-shadow-sm">สายด่วนฉุกเฉิน</span>
          <span className="block text-[10px] sm:text-[11px] font-semibold leading-tight text-white/85">แจ้งเหตุด่วน เหตุร้าย ตลอด 24 ชั่วโมง</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-black text-red-700 shadow-sm">
          โทรเลย <ChevronRight size={13} />
        </span>
      </Link>
      {/* เบอร์โทรสำคัญ — แถวบางกว่าและสีอ่อนกว่าสายด่วนโดยตั้งใจ ไม่ให้แย่งสายตาจากแถบแดง
          เพราะเหตุด่วนต้องหาเจอก่อนเสมอ ใช้ <Link> ตรงๆ เหมือนกัน /directory ไม่ผูกโมดูล (เปิดเสมอ) */}
      <Link to="/directory" aria-label="ทำเนียบเบอร์โทรสำคัญ หน่วยงานราชการและผู้นำท้องถิ่น"
        className="relative z-10 mb-2 flex items-center gap-2.5 rounded-xl border border-white/70 bg-white/95 px-3 py-2 shadow-md shadow-blue-950/10 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:bg-white hover:shadow-lg active:scale-[0.98]">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700">
          <BookUser size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] sm:text-[13px] font-black leading-tight text-gray-800">เบอร์โทรสำคัญ</span>
          <span className="block text-[10px] font-semibold leading-tight text-gray-500">ส่วนราชการ ผู้นำท้องถิ่น และเบอร์ติดต่อในพื้นที่</span>
        </span>
        <ChevronRight size={14} className="shrink-0 text-gray-400" />
      </Link>
      <div className="relative z-10 grid grid-cols-3 gap-1.5 sm:gap-2">
        {docTypes.slice(0, 6).map(({ value, label, emoji }) => (
          <Link key={value} to={`/doc-request?type=${value}`}
            className="group flex flex-col items-center gap-1 rounded-xl border border-white/70 bg-white/95 p-1.5 shadow-md shadow-blue-950/10 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:bg-white hover:shadow-lg active:scale-95 sm:p-2">
            <CategoryIcon emoji={emoji} size={22} style={tenant?.category_icon_style} />
            <p className="text-[10px] sm:text-[11px] font-bold text-gray-700 text-center leading-tight line-clamp-2 transition-colors group-hover:text-blue-700">{label}</p>
          </Link>
        ))}
      </div>
      <div className="relative z-10 mt-2.5 flex justify-end">
        <ModuleLink to="/doc-request"
          className="rounded-full border border-yellow-200/80 bg-gradient-to-r from-yellow-300 to-amber-400 px-3 py-1 text-[11px] font-black text-amber-950 shadow-md shadow-amber-950/15 transition-all hover:-translate-y-0.5 hover:shadow-lg">
          ดูทั้งหมด ›
        </ModuleLink>
      </div>
    </div>
  )
}

export default function ServiceHubHome() {
  const { tenant } = useTenant()

  const docTypes = useMemo(() => {
    const extras = (tenant?.fee_schedule?._custom_types || []).map(t => ({
      value: t.value, label: t.label, emoji: t.emoji || '📋',
    }))
    return [...BASE_DOC_TYPES, ...extras]
  }, [tenant])

  return (
    <div className="bg-gray-50">
      {/* Hero + e-Service ตั้งใจให้ชิดขอบจอเต็ม มุมเหลี่ยม ไม่มีช่องว่างคั่น — ตรงตามภาพอ้างอิงเป๊ะ
          ต่างจากส่วนอื่นด้านล่างที่ยังเป็นการ์ดโค้งมนมีระยะขอบตามปกติ */}
      <div className="max-w-[1440px] mx-auto">
        <HeroBanner tenant={tenant} rounded="rounded-none" />
        <EServiceGrid docTypes={docTypes} rounded="rounded-none" />
      </div>

      <div className="px-3 sm:px-4 lg:px-6 pt-3 pb-4 max-w-[1440px] mx-auto space-y-3">
        <BannerSlider />
        <ComplaintBand variant="clean" />
        <ComplaintStatsWidget />
        <PostsHighlight />
        <SmartCityBanner />
      </div>

      <div className="px-3 sm:px-4 lg:px-6 pb-2 max-w-[1440px] mx-auto">
        <TourismSection />
      </div>

    </div>
  )
}
