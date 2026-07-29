import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Bell, FileSearch, ClipboardList, ShieldCheck,
  Phone, AlertTriangle, Cloud,
  Store, FileText, CalendarDays, Luggage, Info,
  UserCircle, LogOut, Globe, UserCog, Settings, RefreshCw, ChevronDown
} from 'lucide-react'
import { useAuth } from '../../../../contexts/AuthContext'
import { useNotifications } from '../../../../contexts/NotificationsContext'
import { supabase } from '../../../../lib/supabase'
import { clearCacheAndReload } from '../../../../lib/clearCache'

export default function KledkaewMore() {
  const { session, role } = useAuth()
  const { unreadCount } = useNotifications()
  const navigate = useNavigate()
  const [clearingCache, setClearingCache] = useState(false)
  const [openSections, setOpenSections] = useState(() => new Set(['services']))

  function toggleSection(id) {
    setOpenSections(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/')
  }

  function handleClearCache() {
    setClearingCache(true)
    clearCacheAndReload()
  }

  // Define our story (the menus from the app) grouped by accordion
  const accordions = [
    ...(role && role !== 'citizen' ? [{
      id: 'staff-admin',
      title: 'สำหรับเจ้าหน้าที่',
      items: [
        { label: 'ระบบเจ้าหน้าที่ (Staff)', icon: UserCog, href: '/staff', color: 'text-emerald-500' },
        ...(role === 'admin' || role === 'superadmin' ? [
          { label: 'แผงควบคุมผู้ดูแลระบบ (Admin)', icon: Settings, href: '/admin', color: 'text-emerald-500' }
        ] : [])
      ]
    }] : []),
    {
      id: 'services',
      title: 'บริการออนไลน์และคำร้อง',
      items: [
        { label: 'บริการเอกสารออนไลน์', icon: FileText, href: '/doc-request', color: 'text-emerald-500' },
        { label: 'เอกสารของฉัน', icon: FileSearch, href: '/my-docs', color: 'text-emerald-500' },
        { label: 'แจ้งเหตุ/แจ้งซ่อม', icon: ClipboardList, href: '/complaint', color: 'text-emerald-500' },
        { label: 'คำร้องของฉัน', icon: FileSearch, href: '/my-complaints', color: 'text-emerald-500' },
        { label: 'เหตุฉุกเฉิน', icon: AlertTriangle, href: '/emergency', color: 'text-red-500' },
        { label: 'ปฏิทินกิจกรรม', icon: CalendarDays, href: '/events', color: 'text-emerald-500' },
        { label: 'สภาพอากาศ', icon: Cloud, href: '/weather', color: 'text-emerald-500' },
      ]
    },
    {
      id: 'economy',
      title: 'ท่องเที่ยวและเศรษฐกิจ',
      items: [
        { label: 'แหล่งท่องเที่ยว', icon: Luggage, href: '/tourism', color: 'text-emerald-500' },
        { label: 'เที่ยว กิน พัก OTOP', icon: Store, href: '/market', color: 'text-emerald-500' },
        { label: 'ลงทะเบียนร้านค้า', icon: Store, href: '/business-register', color: 'text-emerald-500' },
      ]
    },
    {
      id: 'info',
      title: 'ข้อมูลและบัญชีผู้ใช้',
      items: [
        { label: 'การแจ้งเตือน', icon: Bell, href: '/notifications', color: 'text-emerald-500', badge: unreadCount },
        { label: 'รายงานการออกเอกสาร', icon: ShieldCheck, href: '/doc-stats', color: 'text-emerald-500' },
        { label: 'ประเมินความพึงพอใจ', icon: Info, href: '/satisfaction', color: 'text-emerald-500' },
        { label: 'ติดต่อเรา', icon: Phone, href: '/contact', color: 'text-emerald-500' },
        { label: clearingCache ? 'กำลังล้างแคช...' : 'ล้างแคช / อัปเดตเวอร์ชั่นล่าสุด', icon: RefreshCw, action: handleClearCache, color: 'text-emerald-500' },
        ...(session ? [
          { label: 'บัญชีของฉัน', icon: UserCircle, href: '/profile', color: 'text-emerald-500' },
          { label: 'ออกจากระบบ', icon: LogOut, action: handleLogout, color: 'text-red-500' },
        ] : [
          { label: 'เข้าสู่ระบบ', icon: UserCircle, href: '/auth', color: 'text-emerald-500' },
        ])
      ]
    }
  ]

  return (
    <div className="min-h-screen bg-gray-50 pb-28 md:pb-8 font-sans pt-6 md:pt-8">
      <div className="max-w-6xl mx-auto px-4 md:grid md:grid-cols-[20rem_minmax(0,1fr)] md:gap-6 md:items-start">
      {/* Top Menu Card */}
      <div className="relative z-20 w-full max-w-lg mx-auto mb-4 mt-2 md:mx-0 md:mb-0 md:sticky md:top-6">
        <div className="bg-[#10b981] rounded-2xl p-4 shadow-xl border border-emerald-400/30">
          <h3 className="text-white font-bold text-[16px] mb-3 px-1 drop-shadow-sm">ติดต่อ/แจ้งเรื่องร้องเรียน</h3>
          <div className="bg-[#064e3b] rounded-xl py-4 px-1 flex justify-between items-stretch text-center shadow-inner">
            <Link to="/complaint" className="flex-1 flex flex-col items-center justify-start gap-2 border-r border-white/10 px-1">
              <div className="relative">
                <ClipboardList size={32} className="text-amber-400 drop-shadow-sm" strokeWidth={1.5} />
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-amber-400 rounded-full flex items-center justify-center text-[#064e3b] text-[10px] font-bold">?</div>
              </div>
              <span className="text-white/90 text-[13px] font-medium leading-tight">ร้องเรียน<br/>ร้องทุกข์</span>
            </Link>
            <Link to="/doc-request" className="flex-1 flex flex-col items-center justify-start gap-2 border-r border-white/10 px-1">
              <Globe size={32} className="text-amber-400 drop-shadow-sm" strokeWidth={1.5} />
              <span className="text-white/90 text-[13px] font-medium leading-tight">E-Service</span>
            </Link>
            <Link to="/my-complaints" className="flex-1 flex flex-col items-center justify-start gap-2 border-r border-white/10 px-1">
              <FileSearch size={32} className="text-amber-400 drop-shadow-sm" strokeWidth={1.5} />
              <span className="text-white/90 text-[13px] font-medium leading-tight">ติดตาม<br/>คำร้อง</span>
            </Link>
            <Link to="/my-docs" className="flex-1 flex flex-col items-center justify-start gap-2 px-1">
              <div className="relative">
                <FileText size={32} className="text-amber-400 drop-shadow-sm" strokeWidth={1.5} />
                <div className="absolute -top-1 -right-1 w-4 h-4 border-2 border-[#064e3b] rounded-full bg-amber-400"></div>
              </div>
              <span className="text-white/90 text-[13px] font-medium leading-tight">ติดตาม<br/>เอกสาร</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Accordions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-5 w-full max-w-lg mx-auto md:max-w-none md:mx-0">
        {accordions.map((acc) => (
          <div key={acc.id} className="overflow-hidden rounded-2xl shadow-sm border border-emerald-100 bg-white">
            <button
              type="button"
              onClick={() => toggleSection(acc.id)}
              aria-expanded={openSections.has(acc.id)}
              aria-controls={`more-section-${acc.id}`}
              className="w-full min-h-11 bg-[#059669] text-white flex justify-between items-center gap-3 px-4 py-3 text-left md:hidden"
            >
              <span className="font-bold text-[16px] drop-shadow-sm">{acc.title}</span>
              <ChevronDown
                size={19}
                className={`shrink-0 transition-transform md:hidden ${openSections.has(acc.id) ? 'rotate-180' : ''}`}
              />
            </button>
            <div className="hidden min-h-11 bg-[#059669] text-white md:flex items-center px-4 py-3">
              <span className="font-bold text-[16px] drop-shadow-sm">{acc.title}</span>
            </div>
            
            <div
              id={`more-section-${acc.id}`}
              className={`bg-white ${openSections.has(acc.id) ? 'block' : 'hidden'} md:block`}
            >
              {acc.items.map((item, i) => {
                const inner = (
                  <>
                    <item.icon size={22} className={item.color} />
                    <span className={`font-medium text-[15px] flex-1 ${item.color === 'text-red-500' ? 'text-red-500' : 'text-gray-700'}`}>{item.label}</span>
                    {item.badge > 0 && (
                      <span className="min-w-5 h-5 text-[10px] font-bold rounded-full flex items-center justify-center px-1.5 bg-amber-400 text-amber-900">
                        {item.badge > 99 ? '99+' : item.badge}
                      </span>
                    )}
                  </>
                )
                const className = "flex min-h-12 items-center gap-3 px-4 py-3 border-b border-gray-100 hover:bg-gray-50 active:bg-gray-100 transition-colors w-full text-left"
                
                if (item.action) {
                  return <button key={i} onClick={item.action} className={className}>{inner}</button>
                }
                if (item.external) {
                  return <a key={i} href={item.href} target="_blank" rel="noopener noreferrer" className={className}>{inner}</a>
                }
                return (
                  <Link key={i} to={item.href} className={className}>
                    {inner}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      </div>
    </div>
  )
}
