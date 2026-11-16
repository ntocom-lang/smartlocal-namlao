import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Bell, Menu, Sparkles } from 'lucide-react'
import { supabase, signOutSafely, getSessionResilient } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import SuperAdminAdvisor from '../components/dev/SuperAdminAdvisor'
import PortalSwitcher from '../components/layout/PortalSwitcher'
import StaffAccountMenu from '../components/layout/StaffAccountMenu'
import PortalDrawer, { GroupLabel } from '../components/common/PortalDrawer'
import { useNotifications } from '../contexts/NotificationsContext'
import useStickyChrome from '../hooks/useStickyChrome'
import { DEV_USER_ID } from '../lib/portalAccess'
import DevNavButton from '../components/dev/DevNavButton'
import { DEV_NAV_BG, DEV_ADVISOR_COLOR, DEV_ALL_COLOR } from '../lib/navTileColor'

// ที่ปรึกษา AI เฉพาะ Super Admin — ย้ายมาอยู่ใต้ศูนย์ควบคุมงานพัฒนาระบบ (เจ้าของระบบอนุมัติ 2569-11-08, รอบ 2)
// ด่านที่ 1: session user id ต้องเป็น DEV_USER_ID (แบบเดียวกับ DevJournal) ไม่ใช่ = กลับหน้าล็อกอิน
// ด่านที่ 2: profiles.role ต้องเป็น 'superadmin' ไม่ใช่ = ข้อความไม่มีสิทธิ์ (ใน SuperAdminAdvisor)
// ด่านที่ 3: RLS + Edge Function superadmin-advisor ตรวจฝั่งเซิร์ฟเวอร์ซ้ำ — ด่านหน้าจอไม่ใช่การรักษาความปลอดภัยจริง
export default function DevAdvisor() {
  const navigate = useNavigate()
  const [role, setRole] = useState(null) // null = ยังตรวจไม่เสร็จ · '' = ตรวจแล้วแต่ไม่พบ role

  useEffect(() => {
    let cancelled = false
    // getSessionResilient: เน็ตสะดุดตอนต่ออายุ token ต้องไม่พาออกจากระบบ
    getSessionResilient().then(async ({ data }) => {
      const uid = data.session?.user?.id
      if (uid !== DEV_USER_ID) {
        if (!cancelled) navigate('/admin/login', { replace: true })
        return
      }
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', uid).maybeSingle()
      if (!cancelled) setRole(profile?.role ?? '')
    })
    return () => { cancelled = true }
  }, [navigate])

  // Mount หลังตรวจสิทธิ์ เพื่อให้ useStickyChrome วัดหัวเว็บที่มีอยู่จริงตั้งแต่รอบแรก
  return role === null ? null : <DevAdvisorWorkspace role={role} />
}

function DevAdvisorWorkspace({ role }) {
  const { tenant } = useTenant()
  const { unreadCount } = useNotifications()
  const navigate = useNavigate()
  const headerRef = useRef(null)
  const stickyBox = useStickyChrome(headerRef)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  async function handleLogout() {
    await signOutSafely('/')
    navigate('/')
  }

  // ใช้รายการเดียวกันทั้ง PC และลิ้นชักมือถือ
  function renderNavigation(onSelected = () => {}) {
    return (
      <>
        <GroupLabel>งานพัฒนาระบบ</GroupLabel>
        <div className="space-y-0.5">
          <DevNavButton Icon={ArrowLeft} label="กลับศูนย์ควบคุมงานพัฒนาระบบ" color={DEV_ALL_COLOR}
            onClick={() => { navigate('/dev-journal'); onSelected() }} />
          <DevNavButton Icon={Sparkles} label="ที่ปรึกษา AI" color={DEV_ADVISOR_COLOR} active />
        </div>
      </>
    )
  }

  return (
    <div className="min-h-full text-slate-900" style={{ backgroundColor: '#eef2f7' }}>
      {/* หัวเว็บและเมนูบัญชีใช้รูปแบบเดียวกับหน้า DevJournal */}
      <header className="relative px-4 pt-3 pb-3 text-white md:hidden"
        style={{ background: 'linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 100%)' }}>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setDrawerOpen(true)} aria-label="เปิดเมนู"
            aria-expanded={drawerOpen} aria-controls="portal-drawer"
            className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white/90 active:bg-white/15">
            <Menu size={22} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => navigate('/')} aria-label="กลับหน้าแรก" className="shrink-0">
            {tenant?.logo_url
              ? <img src={tenant.logo_url} alt="" className="h-11 w-11 rounded-full border border-white/20 bg-white/10 object-contain p-0.5" />
              : <span className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-white/40 bg-white/20 text-lg font-bold">{tenant?.name?.[0] ?? 'S'}</span>}
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold leading-tight break-words">{tenant?.name ?? 'SmartLocal'}</p>
            <span className="mt-1 inline-block rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-black tracking-widest">ผู้พัฒนาระบบ</span>
          </div>
          <StaffAccountMenu compact onLogout={handleLogout} />
        </div>
        <PortalSwitcher className="mt-3 flex flex-wrap [&_a]:min-h-11" />
      </header>

      <PortalDrawer open={drawerOpen} onClose={closeDrawer} tenant={tenant} portalLabel="ผู้พัฒนาระบบ" tone="dev"
        ariaLabel="เมนูผู้พัฒนาระบบ" homeItem={{ key: 'back-to-admin', label: 'กลับหน้าแอดมิน', Icon: ArrowLeft }}
        groups={[]} activeKey={null} onSelect={() => { closeDrawer(); navigate('/admin') }}>
        {renderNavigation(closeDrawer)}
      </PortalDrawer>

      <header ref={headerRef} data-dev-header className="sticky top-0 z-30 hidden w-full text-white md:block"
        style={{ background: 'linear-gradient(180deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}>
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          {tenant?.header_image_url && <div className="absolute inset-0 bg-cover bg-center opacity-25" style={{ backgroundImage: `url("${tenant.header_image_url}")` }} />}
          <div className="absolute inset-x-0 bottom-0 h-12" style={{ background: 'linear-gradient(to top, var(--color-primary-dark), transparent)' }} />
        </div>
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={() => navigate('/')} aria-label="กลับหน้าแรก" className="shrink-0">
              {tenant?.logo_url
                ? <img src={tenant.logo_url} alt="" className="h-11 w-11 rounded-full border-2 border-white/40 bg-white/10 object-contain" />
                : <span className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-white/40 bg-white/20 text-lg font-bold">🏛️</span>}
            </button>
            <div className="min-w-0">
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-black tracking-widest">ผู้พัฒนาระบบ</span>
              <p className="mt-0.5 text-sm font-bold leading-tight break-words">{tenant?.name ?? 'SmartLocal'}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={() => navigate('/notifications')}
              aria-label={unreadCount > 0 ? `การแจ้งเตือน ${unreadCount} รายการใหม่` : 'การแจ้งเตือน'}
              className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/5 text-white/90 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
              <Bell size={18} aria-hidden="true" />
              {unreadCount > 0 && <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold">{unreadCount > 9 ? '9+' : unreadCount}</span>}
            </button>
            <PortalSwitcher className="flex flex-wrap" />
            <StaffAccountMenu onLogout={handleLogout} />
          </div>
        </div>
      </header>

      <div className="md:flex">
        <aside data-dev-aside className="sticky hidden w-60 shrink-0 self-start flex-col shadow-lg md:flex"
          style={{ ...DEV_NAV_BG, top: stickyBox.top ?? undefined, height: stickyBox.height ?? undefined }}>
          <nav aria-label="เมนูผู้พัฒนาระบบ" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 [scrollbar-color:rgba(255,255,255,0.35)_transparent] [scrollbar-width:thin]">
            {renderNavigation()}
          </nav>
          <div className="border-t border-white/10 px-3 py-3">
            <DevNavButton Icon={ArrowLeft} label="กลับหน้าแอดมิน" color="#475569" onClick={() => navigate('/admin')} />
          </div>
        </aside>

        <div className="min-w-0 flex-1 pb-24 md:pb-0">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 sm:px-6 lg:px-8">
            <div className="min-w-0">
              <p className="text-xs text-slate-500">ผู้พัฒนาระบบ · เฉพาะ Super Admin</p>
              <h2 className="mt-1 text-base font-bold break-words">ที่ปรึกษา AI</h2>
            </div>
            <button type="button" onClick={() => navigate('/dev-journal')}
              className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
              <ArrowLeft size={16} /> กลับศูนย์ควบคุมงานพัฒนาระบบ
            </button>
          </div>
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-5 lg:py-7">
            <SuperAdminAdvisor currentUserRole={role} />
          </div>
        </div>
      </div>
    </div>
  )
}

