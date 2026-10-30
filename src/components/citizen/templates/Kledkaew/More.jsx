import { useState } from 'react'
import ModuleLink from '../../../common/ModuleLink'
import { useNavigate } from 'react-router-dom'
import {
  Bell, FileSearch, ClipboardList,
  Phone, AlertTriangle, Cloud, BookUser,
  Store, FileText, CalendarDays, Luggage, Info,
  UserCircle, LogOut, Globe, UserCog, Settings, RefreshCw,
  Database, BookOpen, Monitor, Check, UploadIcon, Wrench, Trash2, CloudRain, ChartColumn,
} from 'lucide-react'
import { MenuGroup } from '../../../common/MenuTileGrid'
import { useAuth } from '../../../../contexts/AuthContext'
import { useNotifications } from '../../../../contexts/NotificationsContext'
import { useTenant } from '../../../../contexts/TenantContext'
import { signOutSafely } from '../../../../lib/supabase'
import { clearCacheAndReload } from '../../../../lib/clearCache'
import { moduleForPath } from '../../../../lib/staffModules'
import { canAccessAdminPortal, canAccessStaffPortal } from '../../../../lib/portalAccess'
import { useInstallPrompt } from '../../../../hooks/useInstallPrompt'
import { IOSGuide, AndroidGuide } from '../../../InstallPrompt'

// หน้า "เมนูทั้งหมด" ของธีม Kledkaew — รายการเมนูเป็นกริดไอคอนชุดเดียวกับหน้าเมนูของธีมอื่น (MenuTileGrid.jsx)
// การ์ด "ติดต่อ / แจ้งเหตุ" ด้านบนเป็นเอกลักษณ์ของธีมนี้ คงไว้เหมือนเดิม
// color = สีประจำเมนู (hex) — MenuTileGrid ไล่เฉดและปรับให้ไอคอนขาวอ่านออกเอง (src/lib/menuTileColor.js)
// ปลายทางเดียวกับหน้าเมนูธีมอื่นใช้สีเดียวกัน (ดู QUICK_MENU_CATALOG ใน src/pages/MorePage.jsx)
export default function KledkaewMore() {
  const { session, role } = useAuth()
  const { unreadCount } = useNotifications()
  const { isModuleEnabled } = useTenant()
  const navigate = useNavigate()
  const [clearingCache, setClearingCache] = useState(false)
  const [showIOSGuide, setShowIOSGuide] = useState(false)
  const { mode: installMode, install } = useInstallPrompt()
  const isIOS = installMode === 'manual-ios'
  const installState = installMode === 'installed' ? 'installed' : installMode === 'hidden' ? 'unknown' : 'installable'

  async function handleLogout() {
    await signOutSafely('/')
    navigate('/')
  }

  function handleClearCache() {
    setClearingCache(true)
    clearCacheAndReload()
  }

  async function handleInstall() {
    if (await install() === 'guide') setShowIOSGuide(true)
  }

  const staffItems = [
    canAccessStaffPortal(role) && { label: 'ระบบเจ้าหน้าที่', icon: UserCog, href: '/staff', color: '#0284c7' },
    role === 'technician' && { label: 'งานของฉัน', icon: Wrench, href: '/technician', color: '#0284c7' },
    canAccessAdminPortal(role) && {
      label: role === 'viewer' ? 'รายงาน' : 'แผงควบคุมผู้ดูแลระบบ',
      icon: Settings, href: '/admin', color: '#d97706',
    },
  ].filter(Boolean)

  const pwaItem = installState === 'installed'
    ? { label: 'ติดตั้งแอปพลิเคชันแล้ว', icon: Check, color: '#16a34a' }
    : installState === 'installable'
      ? {
          label: isIOS ? 'เพิ่มไปยังหน้าจอโฮม' : 'ติดตั้งแอปพลิเคชัน',
          icon: isIOS ? UploadIcon : Monitor,
          action: handleInstall,
          color: '#2563eb',
        }
      : null

  const groups = [
    staffItems.length > 0 && {
      id: 'staff-admin',
      title: 'สำหรับเจ้าหน้าที่',
      icon: UserCog, color: '#0284c7',
      items: staffItems,
    },
    {
      id: 'services',
      title: 'บริการออนไลน์และคำร้อง',
      icon: ClipboardList, color: '#ea580c',
      items: [
        { label: 'บริการเอกสารออนไลน์', icon: FileText, href: '/doc-request', color: '#2563eb' },
        { label: 'เอกสารของฉัน', icon: FileSearch, href: '/my-docs', color: '#0284c7' },
        { label: 'ร้องเรียน/ร้องทุกข์', icon: ClipboardList, href: '/complaint', color: '#ea580c' },
        { label: 'คำร้องของฉัน', icon: FileSearch, href: '/my-complaints', color: '#0284c7' },
        { label: 'สายด่วนฉุกเฉิน', icon: AlertTriangle, href: '/emergency', color: '#dc2626' },
        { label: 'เบอร์โทรสำคัญ', icon: BookUser, href: '/directory', color: '#2563eb' },
        { label: 'ตารางวันเก็บขยะ', icon: Trash2, href: '/waste', color: '#059669' },
        { label: 'ปฏิทินกิจกรรม', icon: CalendarDays, href: '/events', color: '#16a34a' },
        { label: 'สภาพอากาศ', icon: Cloud, href: '/weather', color: '#0284c7' },
        // ซ่อนเองเมื่อ อปท. ไม่ได้เปิดโมดูล water-situation (ตัวกรอง moduleForPath ด้านล่าง)
        { label: 'สถานการณ์น้ำ-ฝน', icon: CloudRain, href: '/water-situation', color: '#0284c7' },
      ],
    },
    {
      id: 'economy',
      title: 'ท่องเที่ยวและเศรษฐกิจ',
      icon: Luggage, color: '#ea580c',
      items: [
        { label: 'เที่ยว กิน พัก ช้อป บริการ', icon: Luggage, href: '/tourism', color: '#ea580c' },
        { label: 'ลงทะเบียนร้านค้า', icon: Store, href: '/business-register', color: '#ea580c' },
        { label: 'ศูนย์ข้อมูลดิจิทัล', icon: Database, href: '/data-center', color: '#4f46e5' },
      ],
    },
    {
      id: 'info',
      title: 'ข้อมูลและบัญชีผู้ใช้',
      icon: UserCircle, color: '#475569',
      items: [
        { label: 'การแจ้งเตือน', icon: Bell, href: '/notifications', color: '#9333ea', badge: unreadCount },
        // ธีมนี้ไม่มีเมนูข้างจอ PC (CitizenSidebar คืน null) ทางเข้าหน้ารวมรายงานบน PC จึงอยู่ที่นี่
        { label: 'รายงาน', icon: ChartColumn, href: '/reports', color: '#059669' },
        { label: 'ประเมินความพึงพอใจ', icon: Info, href: '/satisfaction', color: '#ca8a04' },
        { label: 'ติดต่อเรา', icon: Phone, href: '/contact', color: '#059669' },
        { label: 'คู่มือการใช้งาน', icon: BookOpen, href: '/manual-citizen.html', external: true, color: '#4f46e5' },
        pwaItem,
        {
          label: clearingCache ? 'กำลังล้างแคช...' : 'ล้างแคช / อัปเดตเวอร์ชั่นล่าสุด', icon: RefreshCw, color: '#0d9488',
          action: clearingCache ? undefined : handleClearCache,
        },
        ...(session ? [
          { label: 'บัญชีของฉัน', icon: UserCircle, href: '/profile', color: '#475569' },
          { label: 'ออกจากระบบ', icon: LogOut, action: handleLogout, danger: true },
        ] : [
          { label: 'เข้าสู่ระบบ', icon: UserCircle, href: '/auth', color: '#2563eb' },
        ]),
      ].filter(Boolean),
    },
  ].filter(Boolean).map(group => ({
    ...group,
    // กรองเมนูของโมดูลที่ อปท. ปิดไว้ "ก่อนวาด" — เลข "N เมนู" ที่หัวกลุ่มจึงตรงกับที่เห็น และกลุ่มที่ไม่เหลือเมนูไม่ขึ้นหัวเปล่า
    items: group.items.filter(item => {
      if (!item.href || item.external || item.action) return true
      const key = moduleForPath(item.href)
      return !key || isModuleEnabled(key)
    }),
  })).filter(group => group.items.length > 0)

  // แปลงเป็นรูปแบบของ MenuTile: ลิงก์ภายใน = to · ลิงก์นอก = href+external · ปุ่ม = onClick · ไม่มีเลย (กดไม่ได้) = ป้ายสถานะ
  const toTile = item => ({
    key: item.href ?? item.label, label: item.label, Icon: item.icon, color: item.color, badge: item.badge, danger: item.danger,
    ...(item.action ? { onClick: item.action }
      : item.external ? { href: item.href, external: true }
        : item.href ? { to: item.href } : {}),
  })

  return (
    <div className="min-h-screen bg-gray-50 pb-28 md:pb-8 font-sans pt-6 md:pt-8">
      {showIOSGuide && (isIOS ? <IOSGuide onClose={() => setShowIOSGuide(false)} /> : <AndroidGuide onClose={() => setShowIOSGuide(false)} />)}
      <div className="max-w-6xl mx-auto px-4 md:grid md:grid-cols-[20rem_minmax(0,1fr)] md:gap-6 md:items-start">
      <div className="relative z-20 w-full max-w-lg mx-auto mb-4 mt-2 md:mx-0 md:mb-0 md:sticky md:top-6">
        <div className="rounded-2xl p-4 shadow-xl border border-white/20"
          style={{ backgroundColor: 'var(--color-primary)' }}>
          <h3 className="text-white font-bold text-[16px] mb-3 px-1 drop-shadow-sm">ติดต่อ / แจ้งเหตุ</h3>
          <div className="rounded-xl py-4 px-1 flex justify-between items-stretch text-center shadow-inner"
            style={{ backgroundColor: 'var(--color-primary-dark)' }}>
            <ModuleLink to="/complaint" className="flex-1 flex flex-col items-center justify-start gap-2 border-r border-white/10 px-1">
              <div className="relative">
                <ClipboardList size={32} className="text-amber-400 drop-shadow-sm" strokeWidth={1.5} />
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-amber-400 rounded-full flex items-center justify-center text-[10px] font-bold"
                  style={{ color: 'var(--color-primary-dark)' }}>?</div>
              </div>
              <span className="text-white/90 text-[13px] font-medium leading-tight">แจ้งเหตุ<br/>แจ้งซ่อม</span>
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

      {/* คอลัมน์เดียวทุกขนาดจอ (เดิม lg แบ่ง 2 คอลัมน์) — กริดไอคอน 3–4 คอลัมน์ต่อการ์ด ถ้าแบ่ง 2 การ์ดข้างกันบนจอ lg ปุ่มจะแคบเหลือ ~70px */}
      <div className="grid grid-cols-1 gap-3 md:gap-5 w-full max-w-lg mx-auto md:max-w-none md:mx-0">
        {groups.map(group => (
          <MenuGroup key={group.id} title={group.title} Icon={group.icon} color={group.color}
            layout="citizen" items={group.items.map(toTile)} />
        ))}
      </div>
      </div>
    </div>
  )
}
