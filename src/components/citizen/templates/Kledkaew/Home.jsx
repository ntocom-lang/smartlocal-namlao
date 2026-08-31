import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import ModuleLink from '../../../common/ModuleLink'
import { useTenant } from '../../../../contexts/TenantContext'
import { supabase } from '../../../../lib/supabase'
import PostsHighlight from '../../../../components/home/PostsHighlight'
import MiniEventCalendar from '../../../../components/MiniEventCalendar'
import StaffSection from '../../../../components/home/StaffSection'
import SmartCityBanner from '../../../../components/home/SmartCityBanner'
import TourismSection from '../../../../components/home/TourismSection'
import WeatherWidget from '../../../../components/home/WeatherWidget'
import { CategoryIcon } from '../../../../lib/categoryIcon'

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

const POPULAR = [
  { label: 'ร้องเรียน\nร้องทุกข์', emoji: '🙋', path: '/complaint' },
  { label: 'E-Service',           emoji: '🌐', path: '/doc-request' },
  { label: 'ติดตาม\nคำร้อง',     emoji: '🔎', path: '/my-complaints' },
  { label: 'ติดตาม\nเอกสาร',     emoji: '📄', path: '/my-docs' },
]

export default function Home() {
  const { tenant, isModuleEnabled } = useTenant()
  const [cats, setCats] = useState(DEFAULT_CATS)
  const showComplaints = isModuleEnabled('complaints')
  const showEvents = isModuleEnabled('events')

  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('complaint_categories').select('value, label, emoji, color')
      .eq('municipality_id', tenant.id).eq('is_active', true).order('sort_order')
      .then(({ data }) => { if (data?.length) setCats(data) })
      .catch((err) => { console.warn('[kledkaew] โหลดประเภทคำร้องไม่สำเร็จ:', err?.message) })
  }, [tenant?.id])

  return (
    <div className="min-h-screen pb-28 font-sans"
      style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 8%, white)' }}>
      <div className="w-full h-12" style={{ background: 'linear-gradient(180deg, var(--color-primary-dark) 0%, transparent 100%)' }}></div>

      <div className="px-4 -mt-10 relative z-20 max-w-6xl mx-auto">
        <h2 className="text-[17px] font-black mb-3 px-2 drop-shadow-sm" style={{ color: 'var(--color-primary-dark)' }}>บริการยอดนิยม</h2>

        <div className="flex justify-evenly items-start backdrop-blur-sm rounded-3xl p-4 shadow-inner overflow-x-auto gap-4 hide-scrollbar border"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-primary) 10%, white)',
            borderColor: 'color-mix(in srgb, var(--color-primary) 22%, white)',
          }}>
          {POPULAR.map((srv) => (
            <ModuleLink to={srv.path} key={srv.path} className="flex flex-col items-center shrink-0 w-[72px] group">
              <div className="w-[60px] h-[60px] flex items-center justify-center shadow-lg relative bg-white transition-transform group-active:scale-95"
                   style={{
                     borderRadius: '50% 50% 50% 0',
                     transform: 'rotate(-45deg)',
                     border: '2px solid color-mix(in srgb, var(--color-primary) 45%, white)',
                     boxShadow: '0 4px 15px color-mix(in srgb, var(--color-primary) 22%, transparent)',
                   }}>
                <div style={{ transform: 'rotate(45deg)' }}>
                  <span className="text-3xl drop-shadow-sm">{srv.emoji}</span>
                </div>
              </div>
              <span className="text-[13px] font-bold mt-3 text-center whitespace-pre-line leading-tight"
                style={{ color: 'var(--color-primary-dark)' }}>
                {srv.label}
              </span>
            </ModuleLink>
          ))}
        </div>
      </div>

      <div className="px-4 mt-4 max-w-6xl mx-auto">
        <StaffSection />
      </div>

      <div className="px-4 mt-4 max-w-6xl mx-auto space-y-3">
        <h2 className="text-[17px] font-black px-2" style={{ color: 'var(--color-primary-dark)' }}>แนะนำสำหรับคุณ</h2>
        <WeatherWidget />
        <a href="https://air4thai.pcd.go.th/webV3/#/Home" target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-between gap-3 rounded-2xl bg-sky-50 border border-sky-100 px-4 py-3 hover:bg-sky-100 transition-colors">
          <div>
            <p className="text-sm font-black text-sky-800">เช็คฝุ่น PM 2.5</p>
            <p className="text-xs text-sky-700 mt-0.5">Air4Thai · กรมควบคุมมลพิษ (เปิดเว็บภายนอก)</p>
          </div>
          <span className="text-sky-700 text-sm font-bold shrink-0">เปิด →</span>
        </a>
        <ModuleLink to="/doc-request"
          className="block rounded-2xl overflow-hidden shadow-sm relative min-h-28 px-5 py-6 text-center"
          style={{ background: 'linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 55%, color-mix(in srgb, var(--color-primary) 55%, white) 100%)' }}>
          <h3 className="text-2xl md:text-3xl font-black text-white tracking-wide drop-shadow">e-Service</h3>
          <p className="text-lg md:text-xl font-black text-white/90 mt-1">เพื่อประชาชน</p>
        </ModuleLink>
      </div>

      {showComplaints && (
        <div className="px-4 mt-4 max-w-6xl mx-auto">
          <div className="bg-white rounded-[24px] shadow-sm border border-gray-100 p-4 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-14 rounded-t-[24px]"
              style={{ background: 'linear-gradient(to bottom, color-mix(in srgb, var(--color-primary) 8%, white), transparent)' }}></div>

            <div className="relative z-10 flex justify-between items-start mb-5">
              <h2 className="text-[17px] font-black leading-tight" style={{ color: 'var(--color-primary-dark)' }}>แจ้งเรื่องร้องเรียน<br/>/ร้องทุกข์</h2>
              <ModuleLink to="/complaint" className="bg-yellow-400 text-yellow-900 text-[13px] font-black px-4 py-1.5 rounded-full shadow-sm hover:bg-yellow-300 transition-colors">
                ดูทั้งหมด
              </ModuleLink>
            </div>

            <div className="grid grid-cols-3 gap-3 relative z-10">
              {cats.slice(0, 6).map((cat) => {
                const emoji = cat.emoji || CAT_FALLBACK_EMOJI[cat.value] || '📋'
                return (
                  <Link to={`/request?category=${cat.value}`} key={cat.value} className="flex flex-col items-center group">
                    <div className="w-full h-20 rounded-2xl shadow-sm flex items-center justify-center transition-transform group-active:scale-95 border"
                      style={{
                        background: 'linear-gradient(to bottom, color-mix(in srgb, var(--color-primary) 8%, white), color-mix(in srgb, var(--color-primary) 16%, white))',
                        borderColor: 'color-mix(in srgb, var(--color-primary) 22%, white)',
                      }}>
                      <CategoryIcon emoji={emoji} size={44} style={tenant?.category_icon_style} />
                    </div>
                    <span className="text-[13px] font-bold text-gray-700 mt-2 text-center leading-tight line-clamp-2">{cat.label}</span>
                  </Link>
                )
              })}
            </div>

            <div className="mt-5 relative overflow-hidden rounded-l-md rounded-r-full inline-block">
              <ModuleLink to="/my-complaints" className="block hover:opacity-90 transition-opacity text-white text-xs font-bold px-5 py-2.5 shadow-md relative z-10"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                ติดตามเรื่องร้องเรียน &gt;
              </ModuleLink>
            </div>
          </div>
        </div>
      )}

      <div className="px-4 mt-4 max-w-6xl mx-auto">
        <SmartCityBanner />
      </div>

      <div className="px-4 mt-4 max-w-6xl mx-auto">
        <PostsHighlight showOnDesktop />
      </div>

      <div className="mt-4 px-4 max-w-6xl mx-auto">
        <TourismSection />
      </div>

      {showEvents && (
        <div className="px-4 mt-4 max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="text-[17px] font-black" style={{ color: 'var(--color-primary-dark)' }}>📅 ปฏิทินกิจกรรม</h2>
            <ModuleLink to="/events" className="text-xs font-bold hover:opacity-80" style={{ color: 'var(--color-primary)' }}>ดูทั้งหมด →</ModuleLink>
          </div>
          <MiniEventCalendar />
        </div>
      )}
    </div>
  )
}
