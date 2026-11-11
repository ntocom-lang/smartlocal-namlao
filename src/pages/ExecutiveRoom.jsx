import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Bell, Loader2 } from 'lucide-react'
import { supabase, getSessionResilient, signOutSafely } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { useNotifications } from '../contexts/NotificationsContext'
import { useMyPositionCategory } from '../hooks/useMyPositionCategory'
import { canOpenExecutiveHome } from '../lib/executiveAccess'
import { isStaffModuleEnabled, staffMenuAccess } from '../lib/staffMenuAccess'
import PortalSwitcher from '../components/layout/PortalSwitcher'
import StaffAccountMenu from '../components/layout/StaffAccountMenu'
import StaffSideNav from '../components/staff/StaffSideNav'
import StaffBottomNav from '../components/staff/StaffBottomNav'
import useStaffNavGroups from '../hooks/useStaffNavGroups'
import useStickyChrome from '../hooks/useStickyChrome'
import { EXECUTIVE_TAB, staffBottomTabs } from '../lib/staffNavGroups'

const ExecutiveHome = lazy(() => import('../components/staff/executive/ExecutiveHome'))
const ExecSimpleHome = lazy(() => import('../components/staff/executive/ExecSimpleHome'))

// "ห้องผู้บริหาร" หน้าเดี่ยว /executive — ของนายก/รองนายก (viewer) และปลัด/รองปลัด (ตำแหน่งหมวด top_admin ทุก role) + admin ที่เปิดดูได้
// เมนูซ้าย (PC) + แถบล่าง (มือถือ) เป็นชุดเดียวกับระบบเจ้าหน้าที่ (StaffSideNav/StaffBottomNav — เจ้าของระบบสั่ง 2569-11-10)
// กดเมนูอื่นแล้วไป /staff พร้อม state.module (StaffDashboard อ่านตอนเปิดหน้า) · App.jsx ซ่อนหัว/แถบล่างของเว็บประชาชนให้ path นี้
// ไม่แสดงตัวเลข badge (การ์ดหน้ารวมใช้ตัวเลขจาก RPC เท่านั้น ไม่เพิ่ม query ใหม่ที่หน้านี้)
// ⚠️ ด่านในหน้านี้ (canOpenExecutiveHome) แค่กันคนที่ไม่มีห้องนี้ไม่ให้เห็นหน้าว่าง — สิทธิ์ข้อมูลตัดสินที่ RPC/RLS ฝั่งฐานข้อมูลเสมอ
// สองหน้าในเส้นทางเดียว (เจ้าของระบบอนุมัติ 2026-11-11): แบบเรียบ (ExecSimpleHome — หน้าเดียวตัวใหญ่สำหรับนายก) กับแบบเต็ม (ExecutiveHome)
//   ?view=simple → แบบเรียบ · ?view=full → แบบเต็ม · ไม่ระบุ = viewer (นายก/รองนายก/ที่ปรึกษา/เลขาฯ) แบบเรียบ · ปลัด/admin/superadmin แบบเต็ม — สลับได้ทั้งสองทาง

const PAGE_BG = '#eef2f7'

function Centered({ children, label }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6 text-center" role="status" aria-label={label}>
      {children}
    </div>
  )
}

export default function ExecutiveRoom() {
  const navigate = useNavigate()
  const { tenant, isModuleEnabled: tenantIsModuleEnabled } = useTenant()
  const { unreadCount } = useNotifications()
  const [profileState, setProfileState] = useState({ profile: null, failed: false, tick: 0 })
  const { profile, failed } = profileState
  const [searchParams] = useSearchParams()
  const viewParam = searchParams.get('view')

  // โปรไฟล์ตัวเอง (ต้องใช้ role + fleet_role/asset_role/position_id) — วิธีเดียวกับ StaffDashboard
  useEffect(() => {
    let cancelled = false
    getSessionResilient().then(({ data }) => {
      if (cancelled) return null
      if (!data.session) { navigate('/auth', { state: { from: '/executive' } }); return null }
      return supabase.from('profiles').select('*').eq('id', data.session.user.id).single()
    }).then((result) => {
      if (!result || cancelled) return
      setProfileState((prev) => ({ ...prev, profile: result.data ?? null, failed: Boolean(result.error) || !result.data }))
    }).catch(() => { if (!cancelled) setProfileState((prev) => ({ ...prev, failed: true })) })
    return () => { cancelled = true }
  }, [navigate, profileState.tick])

  const { category: positionCategory, ready: positionReady, error: positionError, retry: retryPosition } = useMyPositionCategory(profile)

  // เมนูที่บัญชีนี้เห็นในระบบเจ้าหน้าที่ — ฟังก์ชันชุดเดียวกับ StaffDashboard (ลิงก์ในห้องไม่เป็นปุ่มหลอก)
  const menuAccess = useMemo(
    () => (profile ? staffMenuAccess({ role: profile.role, profile, tenant }) : { scopedKeys: [], hasLocalPlanAccess: false }),
    [profile, tenant],
  )
  const { scopedKeys } = menuAccess
  // เมนูซ้าย/แถบล่าง: ฮุกกลางตัวเดียวกับ StaffDashboard — ชื่อ/ลำดับ/การกรองตรงกันเสมอ
  const { visibleHomeGroups, visibleModules } = useStaffNavGroups({ scopedKeys, hasLocalPlanAccess: menuAccess.hasLocalPlanAccess, tenantId: tenant?.id })
  // หัวจอ PC ปักติดบน + เมนูซ้ายปักใต้หัว (ดู src/hooks/useStickyChrome.js) — เหมือนหน้าเจ้าหน้าที่
  const headerRef = useRef(null)
  const stickyBox = useStickyChrome(headerRef)
  // isModuleEnabled ของ TenantContext เปลี่ยนตัวทุก render แต่ผลขึ้นกับ tenant อย่างเดียว — ทำตัวคงที่ไว้ ไม่งั้นตารางในห้องคำนวณใหม่ทุกรอบ
  // eslint-disable-next-line react-hooks/exhaustive-deps -- ผลของ tenantIsModuleEnabled ขึ้นกับ tenant ล้วนๆ
  const tenantModuleEnabled = useCallback((key) => tenantIsModuleEnabled(key), [tenant])
  const isModuleEnabled = useCallback(
    (key) => isStaffModuleEnabled(key, { scopedKeys, tenantModuleEnabled }),
    [scopedKeys, tenantModuleEnabled],
  )

  async function handleLogout() {
    await signOutSafely('/')
    navigate('/')
  }

  // ยังไม่รู้ผล (โปรไฟล์/ตำแหน่ง) = หมุนรอ ห้ามเด้งไป /staff ก่อน — ปลัดที่ role เป็น officer ต้องรอรู้หมวดตำแหน่งก่อนตัดสิน
  // อ่านตำแหน่งพลาด (เน็ตสะดุด) ใช้หน้าลองใหม่เดียวกับโปรไฟล์พลาด — ห้ามตีความว่า "ไม่ใช่ผู้บริหาร" แล้วเด้งไป /staff
  const retryLoad = failed
    ? () => setProfileState((prev) => ({ ...prev, failed: false, tick: prev.tick + 1 }))
    : retryPosition
  // เมนูเจ้าหน้าที่ไปงานอื่น: ไป /staff พร้อมโมดูลที่เลือก (StaffDashboard อ่าน location.state.module ตอนเปิดหน้า)
  // newTab = เอกสารคงที่ (คู่มือ) · externalUrl = หน้าแยกของตัวเอง (ศูนย์ข้อมูล) — ตามตาราง STAFF_MENU_TARGETS ที่ตรึงด้วยเทสต์
  const goModule = (key) => navigate('/staff', { state: { module: key } })
  const openNavItem = ({ key, newTab, externalUrl }) => {
    if (newTab) window.open(newTab, '_blank', 'noopener,noreferrer')
    else if (externalUrl) navigate(externalUrl)
    else goModule(key)
  }
  let showNav = false
  let simpleView = false
  let body
  if (failed || positionError) {
    body = (
      <Centered label="โหลดข้อมูลบัญชีไม่สำเร็จ">
        <div className="space-y-3">
          <p className="text-sm text-slate-600">โหลดข้อมูลบัญชีไม่สำเร็จ อาจเกิดจากสัญญาณขาดช่วง</p>
          <button type="button" onClick={retryLoad} data-exec-retry
            className="min-h-11 rounded-xl px-5 text-sm font-bold text-white" style={{ backgroundColor: 'var(--color-primary)' }}>
            ลองใหม่
          </button>
        </div>
      </Centered>
    )
  } else if (!profile || !positionReady) {
    body = <Centered label="กำลังโหลดห้องผู้บริหาร"><Loader2 size={28} className="animate-spin text-blue-500" aria-hidden="true" /></Centered>
  } else if (!canOpenExecutiveHome({ role: profile.role, positionCategory })) {
    return <Navigate to="/staff" replace />
  } else {
    showNav = true
    simpleView = viewParam === 'simple' || (viewParam !== 'full' && profile.role === 'viewer')
    const Home = simpleView ? ExecSimpleHome : ExecutiveHome
    body = (
      <Suspense fallback={<Centered label="กำลังโหลดห้องผู้บริหาร"><Loader2 size={28} className="animate-spin text-blue-500" aria-hidden="true" /></Centered>}>
        <Home key={`${simpleView ? 'simple' : 'full'}-${tenant?.id}`} scopedKeys={scopedKeys} navigate={navigate} profile={profile} tenant={tenant}
          isModuleEnabled={isModuleEnabled} tenantModuleEnabled={tenantModuleEnabled} />
      </Suspense>
    )
  }

  return (
    <div className="min-h-full" style={{ backgroundColor: PAGE_BG }}>
      {/* แถบหัวเล็ก: ธีมเดียวกับหัวหน้าเจ้าหน้าที่/ศูนย์ข้อมูล (ไล่สี primary) — โลโก้ + ชื่อ อปท. + แจ้งเตือน + ชิปสลับมุมมอง (จอกว้าง) + เมนูบัญชี */}
      <header ref={headerRef} data-exec-header className="relative z-30 w-full shrink-0 text-white md:sticky md:top-0"
        style={{ background: 'linear-gradient(180deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}>
        <div className="relative z-10 flex items-center gap-2 px-4 py-3 md:gap-3 md:px-6">
          <button type="button" onClick={() => navigate('/')} aria-label="กลับหน้าแรก"
            className="flex h-11 w-11 shrink-0 items-center justify-center transition-opacity active:opacity-70">
            {tenant?.logo_url
              ? <img src={tenant.logo_url} alt="" className="h-10 w-10 rounded-full border-2 border-white/40 bg-white/10 object-contain" />
              : <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-white/40 bg-white/20 text-lg font-bold">{tenant?.name?.[0] ?? '🏛️'}</span>}
          </button>
          <div className="min-w-0 flex-1">
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-white">ห้องผู้บริหาร</span>
            <p className="mt-0.5 truncate text-sm font-bold leading-tight text-white">{tenant?.name}</p>
          </div>
          <button type="button" onClick={() => navigate('/notifications')} data-exec-bell
            aria-label={unreadCount > 0 ? `การแจ้งเตือน ${unreadCount} รายการใหม่` : 'การแจ้งเตือน'}
            className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/5 text-white/90 transition-colors hover:border-white/40 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
            <Bell size={18} aria-hidden="true" />
            {unreadCount > 0 && (
              <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          {/* จอกว้าง: ชิปสลับมุมมองอยู่แถวเดียวกับปุ่มอื่น (แบบหัวหน้าเจ้าหน้าที่) · มือถือไม่มีชิป (แถบหัวจะสูง 2 แถว)
              — ทางไประบบเจ้าหน้าที่บนมือถือคือแถบล่าง (เดิมเป็นปุ่มกระเป๋าเอกสารบนหัว ถอดออกแล้วเพราะซ้ำกับแถบล่าง) */}
          <PortalSwitcher className="hidden md:flex" />
          <StaffAccountMenu compact onLogout={handleLogout} />
        </div>
      </header>

      <div className="md:flex">
        {showNav && (
          <StaffSideNav key={`${tenant?.id}-${profile?.id}`} groups={visibleHomeGroups} activeKey={null}
            executiveActive style={{ top: stickyBox.top ?? undefined, height: stickyBox.height ?? undefined }}
            onHome={() => navigate('/staff')} onExecutive={() => navigate('/executive')} onSelect={openNavItem} />
        )}
        {/* pb-24 บนมือถือ: เว้นที่ให้แถบล่างปักอยู่ไม่ทับท้ายหน้า */}
        <main className="min-w-0 flex-1 px-3 py-4 pb-24 md:px-6 md:py-6 md:pb-6">
          {/* แบบเรียบใช้เต็มความกว้างพื้นที่หน้า (จอกว้างวาง 3 คอลัมน์) · แบบเต็มคงกว้างสูงสุดเดิม */}
          <div className={simpleView ? 'w-full' : 'mx-auto w-full max-w-5xl'}>
            {body}
          </div>
        </main>
      </div>

      {showNav && (
        <StaffBottomNav tabs={staffBottomTabs(visibleModules, EXECUTIVE_TAB)} activeKey={EXECUTIVE_TAB.key}
          onSelect={(key) => (key === EXECUTIVE_TAB.key ? navigate('/executive') : goModule(key))}
          onMenu={() => goModule('menu')} />
      )}
    </div>
  )
}
