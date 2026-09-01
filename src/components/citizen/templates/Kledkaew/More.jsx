import { useEffect, useState } from 'react'
import ModuleLink from '../../../common/ModuleLink'
import { Link, useNavigate } from 'react-router-dom'
import {
  Bell, FileSearch, ClipboardList, ShieldCheck,
  Phone, AlertTriangle, Cloud,
  Store, FileText, CalendarDays, Luggage, Info,
  UserCircle, LogOut, Globe, UserCog, Settings, RefreshCw, ChevronDown,
  Database, BookOpen, Monitor, Check, UploadIcon, Wrench,
} from 'lucide-react'
import { useAuth } from '../../../../contexts/AuthContext'
import { useNotifications } from '../../../../contexts/NotificationsContext'
import { useTenant } from '../../../../contexts/TenantContext'
import { signOutSafely } from '../../../../lib/supabase'
import { clearCacheAndReload } from '../../../../lib/clearCache'
import { moduleForPath } from '../../../../lib/staffModules'
import { canAccessAdminPortal, canAccessStaffPortal } from '../../../../lib/portalAccess'
import { IOSGuide } from '../../../InstallPrompt'

export default function KledkaewMore() {
  const { session, role } = useAuth()
  const { unreadCount } = useNotifications()
  const { isModuleEnabled } = useTenant()
  const navigate = useNavigate()
  const [clearingCache, setClearingCache] = useState(false)
  const [openSections, setOpenSections] = useState(() => new Set(['services']))
  const [showIOSGuide, setShowIOSGuide] = useState(false)
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
  const [installPrompt, setInstallPrompt] = useState(null)
  const [installState, setInstallState] = useState(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    if (isStandalone) return 'installed'
    if (isIOS) return 'installable'
    return 'unknown'
  })

  function toggleSection(id) {
    setOpenSections(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleLogout() {
    await signOutSafely('/')
    navigate('/')
  }

  function handleClearCache() {
    setClearingCache(true)
    clearCacheAndReload()
  }

  useEffect(() => {
    if (installState !== 'unknown') return
    const handler = (e) => {
      e.preventDefault()
      setInstallPrompt(e)
      setInstallState('installable')
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [installState])

  async function handleInstall() {
    if (isIOS) {
      setShowIOSGuide(true)
      return
    }
    if (!installPrompt) return
    await installPrompt.prompt()
  }

  const staffItems = [
    canAccessStaffPortal(role) && { label: 'ระบบเจ้าหน้าที่', icon: UserCog, href: '/staff', color: 'text-[var(--color-primary)]' },
    role === 'technician' && { label: 'งานของฉัน', icon: Wrench, href: '/technician', color: 'text-[var(--color-primary)]' },
    canAccessAdminPortal(role) && {
      label: role === 'viewer' ? 'รายงาน' : 'แผงควบคุมผู้ดูแลระบบ',
      icon: Settings, href: '/admin', color: 'text-[var(--color-primary)]',
    },
  ].filter(Boolean)

  const pwaItem = installState === 'installed'
    ? { label: 'ติดตั้งแอปพลิเคชันแล้ว', icon: Check, color: 'text-[var(--color-primary)]' }
    : installState === 'installable'
      ? {
          label: isIOS ? 'เพิ่มไปยังหน้าจอโฮม' : 'ติดตั้งแอปพลิเคชัน',
          icon: isIOS ? UploadIcon : Monitor,
          action: handleInstall,
          color: 'text-[var(--color-primary)]',
        }
      : null

  const accordions = [
    staffItems.length > 0 && {
      id: 'staff-admin',
      title: 'สำหรับเจ้าหน้าที่',
      items: staffItems,
    },
    {
      id: 'services',
      title: 'บริการออนไลน์และคำร้อง',
      items: [
        { label: 'บริการเอกสารออนไลน์', icon: FileText, href: '/doc-request', color: 'text-[var(--color-primary)]' },
        { label: 'เอกสารของฉัน', icon: FileSearch, href: '/my-docs', color: 'text-[var(--color-primary)]' },
        { label: 'แจ้งเหตุ/แจ้งซ่อม', icon: ClipboardList, href: '/complaint', color: 'text-[var(--color-primary)]' },
        { label: 'คำร้องของฉัน', icon: FileSearch, href: '/my-complaints', color: 'text-[var(--color-primary)]' },
        { label: 'สายด่วนฉุกเฉิน', icon: AlertTriangle, href: '/emergency', color: 'text-red-500' },
        { label: 'ปฏิทินกิจกรรม', icon: CalendarDays, href: '/events', color: 'text-[var(--color-primary)]' },
        { label: 'สภาพอากาศ', icon: Cloud, href: '/weather', color: 'text-[var(--color-primary)]' },
      ],
    },
    {
      id: 'economy',
      title: 'ท่องเที่ยวและเศรษฐกิจ',
      items: [
        { label: 'แหล่งท่องเที่ยว', icon: Luggage, href: '/tourism', color: 'text-[var(--color-primary)]' },
        { label: 'เที่ยว กิน พัก OTOP', icon: Store, href: '/market', color: 'text-[var(--color-primary)]' },
        { label: 'ลงทะเบียนร้านค้า', icon: Store, href: '/business-register', color: 'text-[var(--color-primary)]' },
        { label: 'ศูนย์ข้อมูลดิจิทัล', icon: Database, href: '/data-center', color: 'text-[var(--color-primary)]' },
      ],
    },
    {
      id: 'info',
      title: 'ข้อมูลและบัญชีผู้ใช้',
      items: [
        { label: 'การแจ้งเตือน', icon: Bell, href: '/notifications', color: 'text-[var(--color-primary)]', badge: unreadCount },
        { label: 'รายงานการออกเอกสาร', icon: ShieldCheck, href: '/doc-stats', color: 'text-[var(--color-primary)]' },
        { label: 'รายงานการจัดการเรื่องร้องเรียน/ร้องทุกข์', icon: ClipboardList, href: '/reports/complaints', color: 'text-[var(--color-primary)]' },
        { label: 'ประเมินความพึงพอใจ', icon: Info, href: '/satisfaction', color: 'text-[var(--color-primary)]' },
        { label: 'ติดต่อเรา', icon: Phone, href: '/contact', color: 'text-[var(--color-primary)]' },
        { label: 'คู่มือการใช้งาน', icon: BookOpen, href: '/manual-citizen.html', external: true, color: 'text-[var(--color-primary)]' },
        pwaItem,
        { label: clearingCache ? 'กำลังล้างแคช...' : 'ล้างแคช / อัปเดตเวอร์ชั่นล่าสุด', icon: RefreshCw, action: handleClearCache, color: 'text-[var(--color-primary)]' },
        ...(session ? [
          { label: 'บัญชีของฉัน', icon: UserCircle, href: '/profile', color: 'text-[var(--color-primary)]' },
          { label: 'ออกจากระบบ', icon: LogOut, action: handleLogout, color: 'text-red-500' },
        ] : [
          { label: 'เข้าสู่ระบบ', icon: UserCircle, href: '/auth', color: 'text-[var(--color-primary)]' },
        ]),
      ].filter(Boolean),
    },
  ].filter(Boolean).map(acc => ({
    ...acc,
    items: acc.items.filter(item => {
      if (!item.href || item.external || item.action) return true
      const key = moduleForPath(item.href)
      return !key || isModuleEnabled(key)
    }),
  })).filter(acc => acc.items.length > 0)

  return (
    <div className="min-h-screen bg-gray-50 pb-28 md:pb-8 font-sans pt-6 md:pt-8">
      {showIOSGuide && <IOSGuide onClose={() => setShowIOSGuide(false)} />}
      <div className="max-w-6xl mx-auto px-4 md:grid md:grid-cols-[20rem_minmax(0,1fr)] md:gap-6 md:items-start">
      <div className="relative z-20 w-full max-w-lg mx-auto mb-4 mt-2 md:mx-0 md:mb-0 md:sticky md:top-6">
        <div className="rounded-2xl p-4 shadow-xl border border-white/20"
          style={{ backgroundColor: 'var(--color-primary)' }}>
          <h3 className="text-white font-bold text-[16px] mb-3 px-1 drop-shadow-sm">ติดต่อ/แจ้งเรื่องร้องเรียน</h3>
          <div className="rounded-xl py-4 px-1 flex justify-between items-stretch text-center shadow-inner"
            style={{ backgroundColor: 'var(--color-primary-dark)' }}>
            <ModuleLink to="/complaint" className="flex-1 flex flex-col items-center justify-start gap-2 border-r border-white/10 px-1">
              <div className="relative">
                <ClipboardList size={32} className="text-amber-400 drop-shadow-sm" strokeWidth={1.5} />
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-amber-400 rounded-full flex items-center justify-center text-[10px] font-bold"
                  style={{ color: 'var(--color-primary-dark)' }}>?</div>
              </div>
              <span className="text-white/90 text-[13px] font-medium leading-tight">ร้องเรียน<br/>ร้องทุกข์</span>
            </ModuleLink>
            <ModuleLink to="/doc-request" className="flex-1 flex flex-col items-center justify-start gap-2 border-r border-white/10 px-1">
              <Globe size={32} className="text-amber-400 drop-shadow-sm" strokeWidth={1.5} />
              <span className="text-white/90 text-[13px] font-medium leading-tight">E-Service</span>
            </ModuleLink>
            <ModuleLink to="/my-complaints" className="flex-1 flex flex-col items-center justify-start gap-2 border-r border-white/10 px-1">
              <FileSearch size={32} className="text-amber-400 drop-shadow-sm" strokeWidth={1.5} />
              <span className="text-white/90 text-[13px] font-medium leading-tight">ติดตาม<br/>คำร้อง</span>
            </ModuleLink>
            <ModuleLink to="/my-docs" className="flex-1 flex flex-col items-center justify-start gap-2 px-1">
              <div className="relative">
                <FileText size={32} className="text-amber-400 drop-shadow-sm" strokeWidth={1.5} />
                <div className="absolute -top-1 -right-1 w-4 h-4 border-2 rounded-full bg-amber-400"
                  style={{ borderColor: 'var(--color-primary-dark)' }}></div>
              </div>
              <span className="text-white/90 text-[13px] font-medium leading-tight">ติดตาม<br/>เอกสาร</span>
            </ModuleLink>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-5 w-full max-w-lg mx-auto md:max-w-none md:mx-0">
        {accordions.map((acc) => (
          <div key={acc.id} className="overflow-hidden rounded-2xl shadow-sm border border-gray-100 bg-white">
            <button
              type="button"
              onClick={() => toggleSection(acc.id)}
              aria-expanded={openSections.has(acc.id)}
              aria-controls={`more-section-${acc.id}`}
              className="w-full min-h-11 text-white flex justify-between items-center gap-3 px-4 py-3 text-left md:hidden"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              <span className="font-bold text-[16px] drop-shadow-sm">{acc.title}</span>
              <ChevronDown
                size={19}
                className={`shrink-0 transition-transform md:hidden ${openSections.has(acc.id) ? 'rotate-180' : ''}`}
              />
            </button>
            <div className="hidden min-h-11 text-white md:flex items-center px-4 py-3"
              style={{ backgroundColor: 'var(--color-primary)' }}>
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
                if (!item.href) {
                  return <div key={i} className={className}>{inner}</div>
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
