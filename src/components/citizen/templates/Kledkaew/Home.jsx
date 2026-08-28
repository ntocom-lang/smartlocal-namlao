import { useState, useEffect } from 'react'
import ModuleLink from '../../../common/ModuleLink'
import { Link } from 'react-router-dom'
import { useTenant } from '../../../../contexts/TenantContext'
import { supabase } from '../../../../lib/supabase'
import PostsHighlight from '../../../../components/home/PostsHighlight'
import MiniEventCalendar from '../../../../components/MiniEventCalendar'
import StaffSection from '../../../../components/home/StaffSection'
import SmartCityBanner from '../../../../components/home/SmartCityBanner'
import { CategoryIcon } from '../../../../lib/categoryIcon'
import { useNavigate } from 'react-router-dom'


const CAT_FALLBACK_EMOJI = {
  light: '💡', road: '🛤️', mosquito: '🧴', tree: '🌲',
  trash: '♻️', water_supply: '💧', drain: '🚧', flood: '🪣',
  borrow_equipment: '🔧', corruption: '🚨', grievance: '🌫️',
  noise: '🔊', building: '🏢', tax: '🧾', canal: '🚽',
  animals: '🐾', fire: '🔥', phone_complaint: '☎️',
  waste_water: '💧', other: '❓',
}

const DEFAULT_CATS = [
  { value: 'light',       label: 'ไฟฟ้าสาธารณะ',    emoji: '💡' },
  { value: 'drain',       label: 'ท่อระบายน้ำ',      emoji: '🚧' },
  { value: 'road',        label: 'ถนน/ทางเท้า',      emoji: '🛤️' },
  { value: 'waste_water', label: 'น้ำเสีย',           emoji: '💧' },
  { value: 'canal',       label: 'ดูดสิ่งปฏิกูล',    emoji: '🚽' },
  { value: 'trash',       label: 'ขยะ/แจ้งเก็บ',     emoji: '♻️' },
]

const TOUR_TABS = [
  { key: 'travel', label: 'เที่ยว', emoji: '🏔️' },
  { key: 'food',   label: 'กิน',    emoji: '🍜' },
  { key: 'stay',   label: 'พัก',    emoji: '🏨' },
  { key: 'shop',   label: 'OTOP',   emoji: '🛒' },
]

export default function Home() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const [cats, setCats] = useState(DEFAULT_CATS)
  const [activeTab, setActiveTab] = useState('travel')

  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('complaint_categories').select('value, label, emoji, color')
      .eq('municipality_id', tenant.id).eq('is_active', true).order('sort_order')
      .then(({ data }) => { if (data?.length) setCats(data) })
      .catch(() => {})
  }, [tenant?.id])

  return (
    <div className="bg-[#f0fdf4] min-h-screen pb-28 font-sans">
      {/* Wave transition from header */}
      <div className="w-full h-12" style={{ background: 'linear-gradient(180deg, #064e3b 0%, transparent 100%)' }}></div>

      {/* Services Dropdown styled section */}
      <div className="px-4 -mt-10 relative z-20 max-w-6xl mx-auto">
        <h2 className="text-[17px] font-black text-emerald-900 mb-3 px-2 drop-shadow-sm">บริการยอดนิยม</h2>
        
        <div className="flex justify-between items-center bg-emerald-900/10 backdrop-blur-sm rounded-3xl p-4 shadow-inner overflow-x-auto gap-4 hide-scrollbar border border-emerald-200/50">
          {[
            { label: 'ร้องเรียน\nร้องทุกข์', icon: <span className="text-3xl drop-shadow-sm">🙋</span>, path: '/complaint' },
            { label: 'E-Service', icon: <span className="text-3xl drop-shadow-sm">🌐</span>, path: '/doc-request' },
            { label: 'ติดตาม\nคำร้อง', icon: <span className="text-3xl drop-shadow-sm">🔎</span>, path: '/my-complaints' },
            { label: 'ติดตาม\nเอกสาร', icon: <span className="text-3xl drop-shadow-sm">📄</span>, path: '/my-docs' },
          ].map((srv, i) => (
            <Link to={srv.path || '/'} key={i} className="flex flex-col items-center shrink-0 w-[72px] group">
              <div className="w-[60px] h-[60px] flex items-center justify-center shadow-lg relative bg-linear-to-br from-white to-emerald-50 transition-transform group-active:scale-95"
                   style={{
                     borderRadius: '50% 50% 50% 0',
                     transform: 'rotate(-45deg)',
                     border: '2px solid #6ee7b7',
                     boxShadow: '0 4px 15px rgba(5, 150, 105, 0.2)'
                   }}>
                <div style={{ transform: 'rotate(45deg)' }}>
                  {srv.icon}
                </div>
              </div>
              <span className="text-[13px] font-bold text-emerald-950 mt-3 text-center whitespace-pre-line leading-tight">
                {srv.label}
              </span>
            </Link>
          ))}
        </div>
      </div>

      {/* รูปผู้บริหาร — นายก & ปลัด */}
      <div className="px-4 mt-4 max-w-6xl mx-auto">
        <StaffSection />
      </div>

      {/* Recommended for you */}
      <div className="px-4 mt-4 max-w-6xl mx-auto">
        <h2 className="text-[17px] font-black text-emerald-900 mb-3 px-2">แนะนำสำหรับคุณ</h2>
        <div className="grid grid-cols-2 gap-3">
           <Link to="/weather" className="rounded-2xl overflow-hidden shadow-sm relative h-32 border border-gray-100 block transition-transform active:scale-95 group">
             <img src="https://images.unsplash.com/photo-1584267385494-9fdd9a71ad75?auto=format&fit=crop&w=400&q=80" alt="Weather Radar" className="w-full h-full object-cover opacity-90 transition-transform duration-500 group-hover:scale-105" />
             <div className="absolute top-2 right-0 bg-[#f97316] text-white text-[13px] font-bold px-2.5 py-1 rounded-l-md z-10 shadow-md border-l-2 border-[#ea580c]">รายงานพยากรณ์อากาศ</div>
           </Link>
           <a href="https://air4thai.pcd.go.th/webV3/#/Home" target="_blank" rel="noopener noreferrer" className="rounded-2xl overflow-hidden shadow-sm relative h-32 border border-gray-100 block transition-transform active:scale-95 group">
             <img src="https://images.unsplash.com/photo-1611273426858-450d8e3c9fce?auto=format&fit=crop&w=400&q=80" alt="Air4Thai PM 2.5" className="w-full h-full object-cover opacity-90 transition-transform duration-500 group-hover:scale-105" />
             <div className="absolute top-2 left-0 bg-[#38bdf8] text-white text-[13px] font-bold px-2.5 py-1 rounded-r-md z-10 shadow-md border-r-2 border-[#0284c7]">เช็คฝุ่น PM 2.5</div>
             <div className="absolute inset-0 bg-linear-to-t from-black/70 via-black/10 to-transparent flex items-end p-3">
               <p className="text-white text-xs font-bold leading-snug drop-shadow-md">Air4Thai<br/>รายงานสถานการณ์<br/>มลพิษทางอากาศ</p>
             </div>
           </a>
           <ModuleLink to="/doc-request" className="rounded-2xl overflow-hidden shadow-sm relative h-32 col-span-2 block transition-transform active:scale-95 group bg-white border border-gray-100">
             {/* Background Image */}
             <img src="https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=800&q=80" alt="e-Service Background" className="w-full h-full object-cover opacity-60 transition-transform duration-500 group-hover:scale-105" />
             
             {/* Inner Black Border */}
             <div className="absolute inset-[6px] border border-black z-10 pointer-events-none"></div>
             
             {/* Text Content */}
             <div className="absolute inset-0 flex flex-col items-center justify-center z-20 pointer-events-none drop-shadow-md">
               <h3 className="text-4xl font-black tracking-wide"
                   style={{ 
                     color: '#003b5c', 
                     WebkitTextStroke: '2px white',
                     paintOrder: 'stroke fill'
                   }}>
                 e-Service
               </h3>
               <p className="text-3xl font-black mt-[-4px]"
                  style={{ 
                     color: '#003b5c', 
                     WebkitTextStroke: '2px white',
                     paintOrder: 'stroke fill'
                   }}>
                 เพื่อประชาชน
               </p>
             </div>
           </ModuleLink>
        </div>
      </div>

      {/* Complaints Grid */}
      <div className="px-4 mt-4 max-w-6xl mx-auto">
        <div className="bg-white rounded-[24px] shadow-sm border border-gray-100 p-4 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-14 bg-linear-to-b from-[#f0fdf4] to-transparent rounded-t-[24px]"></div>
          
          <div className="relative z-10 flex justify-between items-start mb-5">
            <h2 className="text-[17px] font-black text-emerald-900 leading-tight">แจ้งเรื่องร้องเรียน<br/>/ร้องทุกข์</h2>
            <ModuleLink to="/complaint" className="bg-yellow-400 text-yellow-900 text-[13px] font-black px-4 py-1.5 rounded-full shadow-sm hover:bg-yellow-300 transition-colors">
              ดูทั้งหมด
            </ModuleLink>
          </div>
          
          <div className="grid grid-cols-3 gap-3 relative z-10">
            {cats.slice(0, 6).map((cat) => {
              const emoji = cat.emoji || CAT_FALLBACK_EMOJI[cat.value] || '📋'
              return (
                <Link to={`/request?category=${cat.value}`} key={cat.value} className="flex flex-col items-center group">
                  <div className="w-full h-20 rounded-2xl bg-linear-to-b from-emerald-50 to-emerald-100 border border-emerald-100 shadow-sm flex items-center justify-center transition-transform group-active:scale-95">
                    <CategoryIcon emoji={emoji} size={44} style={tenant?.category_icon_style} />
                  </div>
                  <span className="text-[13px] font-bold text-gray-700 mt-2 text-center leading-tight line-clamp-2">{cat.label}</span>
                </Link>
              )
            })}
          </div>

          <div className="mt-5 relative overflow-hidden rounded-l-md rounded-r-full inline-block">
             <ModuleLink to="/my-complaints" className="block bg-[#10b981] hover:bg-[#059669] transition-colors text-white text-xs font-bold px-5 py-2.5 shadow-md relative z-10">
               ติดตามเรื่องร้องเรียน &gt;
             </ModuleLink>
          </div>
          
        </div>
      </div>

      <div className="px-4 mt-4 max-w-6xl mx-auto">
        <SmartCityBanner />
      </div>

      <div className="px-4 mt-4 max-w-6xl mx-auto">
        <PostsHighlight showOnDesktop />
      </div>

      {/* Tour tabs */}
      <div className="mt-4 px-4 max-w-6xl mx-auto relative">
        <div className="relative rounded-[24px] overflow-hidden shadow-sm h-48">
           <img src="/kledkaew-tour-banner.png" alt="Tour banner" className="w-full h-full object-cover" style={{ objectPosition: 'center 30%' }} />
           <div className="absolute inset-0 bg-linear-to-r from-black/60 via-black/20 to-transparent"></div>
           <div className="absolute left-4" style={{ top: '16px' }}>
             <div className="flex flex-col gap-0.5"
               style={{ borderLeft: '4px solid #fde047', paddingLeft: '10px' }}>
               <div className="flex items-baseline gap-2">
                 <span className="text-base font-black"
                   style={{ color: 'rgba(255,255,255,0.9)', textShadow: '0 1px 6px rgba(0,0,0,0.8)' }}>
                   มา
                 </span>
                 <span className="font-black leading-none"
                   style={{
                     fontSize: '1.75rem',
                     color: '#fde047',
                     textShadow: '0 0 20px rgba(253,224,71,0.8), 0 2px 8px rgba(0,0,0,0.9)',
                     WebkitTextStroke: '0.5px #92400e',
                   }}>
                   {(tenant?.name || '').replace(/^(องค์การบริหารส่วนจังหวัด|องค์การบริหารส่วนตำบล|เทศบาลนคร|เทศบาลเมือง|เทศบาลตำบล|เทศบาล|อบต\.|อบต|ทต\.|ทต|ทน\.|ทม\.)\s*/u, '') || 'ตำบลเรา'}
                 </span>
               </div>
               <span className="text-base font-black tracking-wide"
                 style={{ color: '#6ee7b7', textShadow: '0 0 12px rgba(110,231,183,0.7), 0 2px 6px rgba(0,0,0,0.8)' }}>
                 ต้องไม่พลาด ✨
               </span>
             </div>
           </div>
        </div>
        
        <div className="bg-white rounded-2xl shadow-xl -mt-10 mx-3 flex justify-between p-2 relative z-10 border border-gray-100">
          {TOUR_TABS.map((tab) => {
            const isActive = activeTab === tab.key
            return (
              <button key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex flex-col items-center p-2.5 flex-1 rounded-xl transition-all relative ${isActive ? 'bg-[#059669] text-white shadow-lg -translate-y-6' : 'text-gray-700 hover:bg-gray-50'}`}>
                {isActive && (
                  <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-[#059669] rotate-45" />
                )}
                <span className="text-2xl leading-none">{tab.emoji}</span>
                <span className="text-xs font-bold mt-1.5">{tab.label}</span>
              </button>
            )
          })}
        </div>

        <div className="mt-5 flex flex-col items-center gap-3">
          <p className="text-sm text-gray-500">
            ดูสถานที่หมวด <span className="font-bold text-emerald-700">{TOUR_TABS.find(t => t.key === activeTab)?.label}</span> ทั้งหมด
          </p>
          <button
            onClick={() => navigate(`/tourism?cat=${activeTab}`)}
            className="bg-yellow-400 text-yellow-900 text-sm font-black px-6 py-2.5 rounded-full shadow-sm hover:bg-yellow-300 active:scale-95 transition-all">
            ดูทั้งหมด →
          </button>
        </div>
      </div>

      {/* ปฏิทินกิจกรรม */}
      <div className="px-4 mt-4 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-3 px-1">
          <h2 className="text-[17px] font-black text-emerald-900">📅 ปฏิทินกิจกรรม</h2>
          <ModuleLink to="/events" className="text-xs font-bold text-emerald-700 hover:text-emerald-900">ดูทั้งหมด →</ModuleLink>
        </div>
        <MiniEventCalendar />
      </div>

    </div>
  )
}
