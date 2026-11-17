import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  Home, ClipboardList, FileText, CalendarDays, Newspaper,
  MapPin, FileSearch, FolderOpen, Bell,
  Phone, AlertCircle, BookUser, LogIn, LogOut, LayoutGrid, Database, Trash2, CloudRain, ChartColumn,
  UserRound, FileSignature, ShieldCheck, Briefcase, CalendarClock,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useTenant } from '../../contexts/TenantContext'
import { useNotifications } from '../../contexts/NotificationsContext'
import { signOutSafely } from '../../lib/supabase'
import { moduleForPath } from '../../lib/staffModules'
import { canAccessStaffPortal } from '../../lib/portalAccess'
import PortalDrawer from '../common/PortalDrawer'
import { NavBadge, NavIconTile } from '../common/CollapsibleNavGroup'

const NAV_GROUPS = [
  {
    label: 'บริการหลัก',
    items: [
      { label: 'หน้าแรก',          href: '/',            Icon: Home,          exact: true, color: '#2563eb' },
      { label: 'ร้องเรียน/ร้องทุกข์', href: '/complaint', Icon: ClipboardList, color: '#ef4444' },
      { label: 'งานบริการประชาชน', href: '/doc-request', Icon: FileText, color: '#8b5cf6' },
      // จองคิวรับบริการ (E2) — moduleForPath กรองให้: โผล่เฉพาะ อปท. ที่เปิดโมดูล queue-booking
      { label: 'จองคิวรับบริการ', href: '/queue-booking', Icon: CalendarClock, color: '#7c3aed' },
      { label: 'ตารางวันเก็บขยะ', href: '/waste',       Icon: Trash2, color: '#15803d' },
      { label: 'สถานการณ์น้ำ-ฝน', href: '/water-situation', Icon: CloudRain, color: '#0284c7' },
      { label: 'ปฏิทินกิจกรรม',   href: '/events',      Icon: CalendarDays, color: '#10b981' },
      { label: 'ข่าวสาร/ประกาศ',  href: '/news',        Icon: Newspaper, color: '#059669' },
      { label: 'เที่ยว กิน พัก ช้อป บริการ', href: '/tourism', Icon: MapPin, color: '#d97706' },
      { label: 'ศูนย์ข้อมูลดิจิทัล', href: '/data-center', Icon: Database, color: '#4338ca' },
    ],
  },
  {
    label: 'ของฉัน',
    items: [
      { label: 'คำร้องของฉัน',  href: '/my-complaints', Icon: FileSearch, color: '#e11d48' },
      { label: 'เอกสารของฉัน',  href: '/my-docs',       Icon: FolderOpen, color: '#7c3aed' },
      { label: 'การแจ้งเตือน',  href: '/notifications', Icon: Bell, badge: true, color: '#d97706' },
    ],
  },
  {
    label: 'ข้อมูลองค์กร',
    items: [
      // ทางเข้าเดียวของรายงานสาธารณะ ชื่อเดียวกับ MorePage/Kledkaew More/เมนูล่าง — รายงานย่อยอยู่เป็นการ์ดในหน้านี้
      // ไม่ exact: อยู่หน้าลูก (/reports/complaints, /reports/visitors) รายการนี้ต้องติดไฟต่อ
      { label: 'รายงาน', href: '/reports', Icon: ChartColumn, color: '#b45309' },
      { label: 'ติดต่อเรา',   href: '/contact',   Icon: Phone, color: '#0d9488' },
      { label: 'สายด่วนฉุกเฉิน', href: '/emergency', Icon: AlertCircle, color: '#dc2626' },
      { label: 'เบอร์โทรสำคัญ', href: '/directory', Icon: BookUser, color: '#0891b2' },
      { label: 'เมนูทั้งหมด', href: '/more',      Icon: LayoutGrid, color: '#475569' },
    ],
  },
]

// /technician ไม่อยู่ในนี้ตั้งใจ — ช่างใช้แถบข้างนี้บนจอ PC ด้วย (ดู App.jsx)
const HIDDEN_PATHS = ['/admin', '/staff', '/executive']

// พื้นไล่สีน้ำเงิน สว่าง/เป็นมิตรกว่าฝั่งเจ้าหน้าที่ (กรมท่า) · backgroundColor = สีทึบสำรอง
const CITIZEN_NAV_BG = { backgroundColor: '#1a4680', backgroundImage: 'linear-gradient(180deg, #1e4f8f 0%, #163d70 100%)' }
const BORDER   = '#12293f'
const DIVIDER  = 'rgba(255,255,255,0.12)'
const LABEL    = '#cfe0f7' // บน #163d70 ≈ 8:1

export default function CitizenSidebar({ showOnAccount = false, accountActive, accountHome = '/', drawerOpen = false, onDrawerClose, onBeforeNavigate } = {}) {
  const location         = useLocation()
  const navigate         = useNavigate()
  const { session, role, profileLoading, profileError, displayName, avatarUrl } = useAuth()
  const { tenant, isModuleEnabled } = useTenant()
  const { unreadCount }  = useNotifications()

  // ใช้เฉพาะหน้าบัญชีที่ครอบด้วย layout กลาง ไม่เปิดแถบประชาชนทับหน้า staff/admin อื่น
  const accountPage = showOnAccount && ['/profile', '/profile/notifications', '/staff/my-signatures'].includes(location.pathname)
  if (!accountPage && HIDDEN_PATHS.some(p => location.pathname.startsWith(p))) return null
  if (!accountPage && tenant?.ui_style === 'kledkaew') return null

  // หน้าบัญชีใช้รายการเฉพาะงานนี้ ไม่ดึงเมนูบริการประชาชนทั้งเว็บมาซ้ำกับหน้าแรก
  const accountGroups = [
    { label: 'จัดการบัญชี', items: [
      { id: 'account', label: 'ข้อมูลบัญชี', href: '/profile', Icon: UserRound, color: '#2563eb' },
      ...(!profileLoading && !profileError && canAccessStaffPortal(role)
        ? [{ id: 'signatures', label: 'ลายเซ็นของฉัน', href: '/staff/my-signatures', Icon: FileSignature, state: { returnTo: '/profile' }, color: '#0f766e' }] : []),
      { id: 'notifications', label: 'ตั้งค่าการแจ้งเตือน', href: '/profile/notifications', Icon: Bell, badge: true, color: '#d97706' },
      { id: 'security', label: 'ความปลอดภัย', href: '/profile?tab=security', Icon: ShieldCheck, color: '#7c3aed' },
    ] },
    { label: 'กลับไปใช้งาน', items: [
      { label: 'กลับหน้าหลัก', href: '/', Icon: Home, exact: true, color: '#2563eb' },
      ...(accountHome !== '/' ? [{ label: accountHome === '/admin' ? 'กลับหน้า Admin' : accountHome === '/technician' ? 'กลับหน้าช่าง' : 'กลับหน้าเจ้าหน้าที่', href: accountHome, Icon: Briefcase, color: '#1a3a5c' }] : []),
    ] },
  ]
  const visibleGroups = (accountPage ? accountGroups : NAV_GROUPS).map(group => ({
    ...group,
    items: group.items.filter(item => {
      const key = moduleForPath(item.href)
      return !key || isModuleEnabled(key)
    }),
  })).filter(group => group.items.length > 0)

  function openFromDrawer(item) {
    if (onBeforeNavigate?.(item.href) === false) return
    onDrawerClose?.()
    navigate(item.href, { state: item.state })
  }

  function isActive(href, exact) {
    return exact ? location.pathname === href : location.pathname.startsWith(href)
  }

  async function logout() { await signOutSafely('/'); navigate('/') }

  return (
    <>
    {accountPage && <PortalDrawer open={drawerOpen} onClose={onDrawerClose} tenant={tenant} portalLabel="บัญชีของฉัน" ariaLabel="เมนูบัญชี"
      homeItem={{ key: '/', href: '/', label: 'กลับหน้าหลัก', Icon: Home, color: '#2563eb' }} homeGroupLabel="เว็บหลัก"
      groups={visibleGroups.map(group => ({ group: group.label, items: group.items.filter(item => item.href !== '/').map(item => ({ ...item, key: item.id || item.href })) })).filter(group => group.items.length > 0)}
      activeKey={accountActive} badges={{ notifications: unreadCount }} onSelect={openFromDrawer} />}
    {/* แบบพรีเมียมสำหรับประชาชน (PR3 2569-11-16 เจ้าของอนุมัติ): ตัวใหญ่ 15px · แถว 40px (หน้าบัญชี 44px) · ไอคอนในกล่องสี
        เมนูที่เปิดอยู่ = พื้นขาวตัวน้ำเงิน (เห็นชัดสุดสำหรับผู้สูงอายุ) · กล่องผู้ใช้/ปุ่มเข้าสู่ระบบปักล่างเสมอ
        (แถวสูงขึ้นทำให้เมนูยาวเกินจอโน้ตบุค 768px — ถ้าไม่ปัก ปุ่มเข้าสู่ระบบจะหลุดลงไปนอกจอ) รายการเมนูเลื่อนในกรอบตัวเอง
        ⚠️ หน้าประชาชน: self-stretch = สูงเท่าแถวใต้หัวเว็บใน App.jsx พอดี (แถวนั้น overflow-hidden ไม่ใช่ตัวเลื่อน)
        เดิม self-start + max-h-screen สูงได้เต็มจอทั้งที่เริ่มใต้หัวเว็บ → ล้นจอเท่าความสูงหัวเว็บ (วัดจริง 141px ที่ 1366×768) */}
    <aside aria-label="เมนูหลักด้านซ้าย" data-account-sidebar={accountPage ? '' : undefined} data-citizen-aside
      className={`flex-col w-56 shrink-0 overflow-hidden shadow-lg ${accountPage ? 'hidden md:flex h-full max-h-full' : 'hidden lg:flex self-stretch'}`}
      style={{ ...CITIZEN_NAV_BG, borderRight: `1px solid ${BORDER}` }}>

      {/* Brand */}
      <div className="shrink-0 border-b px-4 py-3.5" style={{ borderColor: DIVIDER }}>
        {accountPage ? <p className="text-sm font-semibold text-blue-100">บัญชีของฉัน</p> : <Link to="/" className="flex items-center w-full rounded-md hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-blue-100">ระบบบริการประชาชน</p>
          </div>
        </Link>}
      </div>

      {/* Nav */}
      {/* ตัดเมนูของโมดูลที่ อปท. ไม่ได้เปิดออก แล้วซ่อนหัวข้อกลุ่มที่ไม่เหลือเมนูเลย
          (ไม่งั้นจะเห็นหัวข้อ "ของฉัน" ลอยอยู่โดยไม่มีอะไรอยู่ข้างใต้) */}
      <nav className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-2.5 py-2 [scrollbar-color:rgba(255,255,255,0.35)_transparent] [scrollbar-width:thin]">
        {visibleGroups.map(group => (
          <div key={group.label}>
            {/* หัวกลุ่ม 12px สีฟ้าอ่อน (เดิม 9px ขาวจาง 35% ≈ 2.6:1 ไม่ผ่าน AA) */}
            <p className="mb-1 px-2 text-xs font-semibold" style={{ color: LABEL }}>
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map(({ id, label, href, Icon, color, exact, badge, newTab, state }) => {
                const active = accountPage ? id === accountActive : isActive(href, exact)
                // เจ้าของระบบสั่ง 2569-11-16: โทนนุ่มสบายตา — แถว active เดิมพื้นขาวตัวน้ำเงิน (เจ้าของเลือกไว้ตอน #741)
                // เปลี่ยนเป็นพื้นขาวโปร่ง 14% + ตัวขาว + ขอบใน ให้เหมือนเมนูอื่นทุกเมนู (พื้นขาวจ้า = สิ่งที่ "แสบตา")
                const rowCls = `flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-[15px] leading-snug transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${accountPage ? 'min-h-11' : 'min-h-10'} ${active ? 'bg-white/[0.14] font-semibold text-white ring-1 ring-inset ring-white/25' :'font-medium text-white/85 hover:bg-white/10 hover:text-white'}`
                const content = (
                  <>
                    <NavIconTile Icon={Icon} color={color} size={28} />
                    <span className="min-w-0 flex-1 break-words">{label}</span>
                    {badge && <NavBadge count={unreadCount} />}
                  </>
                )
                if (newTab) return (
                  <a key={href} href={href} target="_blank" rel="noopener noreferrer" className={rowCls}>
                    {content}
                  </a>
                )
                return (
                  <Link key={href} to={href} state={state} aria-current={active ? 'page' : undefined} className={rowCls}>
                    {content}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User block — ปักล่าง (shrink-0 นอกตัวเลื่อน) เห็นเสมอแม้เมนูยาวเกินจอ */}
      {!accountPage && <div data-citizen-user className="shrink-0 space-y-1 border-t px-2.5 py-3" style={{ borderColor: DIVIDER }}>
        {session ? (
          <>
            <Link to="/profile" title="โปรไฟล์ของคุณ (คลิกเพื่อดูและแก้ไข)"
              className="group flex min-h-11 items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80">
              {avatarUrl ? (
                <img src={avatarUrl} alt={displayName} className="h-8 w-8 shrink-0 rounded-full border border-white/40 object-cover transition-transform group-hover:scale-105" />
              ) : (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20 text-sm font-bold text-white transition-transform group-hover:scale-105">
                  {(displayName || '?')[0].toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold leading-tight text-white">{displayName || 'ผู้ใช้'}</p>
                <p className="mt-0.5 text-xs leading-tight text-white/75">จัดการโปรไฟล์</p>
              </div>
            </Link>
            <button type="button" onClick={logout}
              className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80">
              <LogOut size={15} aria-hidden="true" /> ออกจากระบบ
            </button>
          </>
        ) : (
          // ปุ่มทองตัวเข้ม: #2a1800 บน #fbbf24 ≈ 11:1
          <Link to="/auth"
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-amber-200 to-amber-400 text-[15px] font-bold text-[#2a1800] shadow-[0_6px_16px_-8px_rgba(0,0,0,0.6)] transition-[filter] hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/90">
            <LogIn size={17} aria-hidden="true" /> เข้าสู่ระบบ
          </Link>
        )}
      </div>}
    </aside>
    </>
  )
}
