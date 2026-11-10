import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Bell, Briefcase, Loader2 } from 'lucide-react'
import { supabase, getSessionResilient, signOutSafely } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { useNotifications } from '../contexts/NotificationsContext'
import { useMyPositionCategory } from '../hooks/useMyPositionCategory'
import { canOpenExecutiveHome } from '../lib/executiveAccess'
import { isStaffModuleEnabled, staffMenuAccess } from '../lib/staffMenuAccess'
import PortalSwitcher from '../components/layout/PortalSwitcher'
import StaffAccountMenu from '../components/layout/StaffAccountMenu'

const ExecutiveHome = lazy(() => import('../components/staff/executive/ExecutiveHome'))

// "ห้องผู้บริหาร" หน้าเดี่ยว /executive — ของนายก/รองนายก (viewer) และปลัด/รองปลัด (ตำแหน่งหมวด top_admin ทุก role) + admin ที่เปิดดูได้
// ไม่มีเมนูซ้าย/แถบล่างของระบบเจ้าหน้าที่ (App.jsx ซ่อนหัว/แถบล่างของเว็บประชาชนให้ path นี้) — ทางไปงานอื่นคือชิปสลับมุมมองกับปุ่ม "ระบบเจ้าหน้าที่"
// ⚠️ ด่านในหน้านี้ (canOpenExecutiveHome) แค่กันคนที่ไม่มีห้องนี้ไม่ให้เห็นหน้าว่าง — สิทธิ์ข้อมูลตัดสินที่ RPC/RLS ฝั่งฐานข้อมูลเสมอ

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

  const { category: positionCategory, ready: positionReady } = useMyPositionCategory(profile)

  // เมนูที่บัญชีนี้เห็นในระบบเจ้าหน้าที่ — ฟังก์ชันชุดเดียวกับ StaffDashboard (ลิงก์ในห้องไม่เป็นปุ่มหลอก)
  const scopedKeys = useMemo(
    () => (profile ? staffMenuAccess({ role: profile.role, profile, tenant }).scopedKeys : []),
    [profile, tenant],
  )
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
  let body
  if (failed) {
    body = (
      <Centered label="โหลดข้อมูลบัญชีไม่สำเร็จ">
        <div className="space-y-3">
          <p className="text-sm text-slate-600">โหลดข้อมูลบัญชีไม่สำเร็จ อาจเกิดจากสัญญาณขาดช่วง</p>
          <button type="button" onClick={() => setProfileState((prev) => ({ ...prev, failed: false, tick: prev.tick + 1 }))}
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
    body = (
      <Suspense fallback={<Centered label="กำลังโหลดห้องผู้บริหาร"><Loader2 size={28} className="animate-spin text-blue-500" aria-hidden="true" /></Centered>}>
        <ExecutiveHome key={tenant?.id} scopedKeys={scopedKeys} navigate={navigate} profile={profile} tenant={tenant}
          isModuleEnabled={isModuleEnabled} tenantModuleEnabled={tenantModuleEnabled} />
      </Suspense>
    )
  }

  return (
    <div className="min-h-full" style={{ backgroundColor: PAGE_BG }}>
      {/* แถบหัวเล็ก: ธีมเดียวกับหัวหน้าเจ้าหน้าที่/ศูนย์ข้อมูล (ไล่สี primary) — โลโก้ + ชื่อ อปท. + แจ้งเตือน + ชิปสลับมุมมอง (จอกว้าง) / ปุ่มระบบเจ้าหน้าที่ (มือถือ) + เมนูบัญชี */}
      <header data-exec-header className="relative w-full shrink-0 text-white"
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
          {/* จอกว้าง: ชิปสลับมุมมองอยู่แถวเดียวกับปุ่มอื่น (แบบหัวหน้าเจ้าหน้าที่) — มีชิป "เจ้าหน้าที่" แล้ว ไม่ต้องมีปุ่มซ้ำ
              มือถือ: ไม่มีชิป (แถบหัวจะสูง 2 แถว) เหลือปุ่มไอคอนไประบบเจ้าหน้าที่ปุ่มเดียว */}
          <PortalSwitcher className="hidden md:flex" />
          <button type="button" onClick={() => navigate('/staff')} data-exec-to-staff aria-label="ระบบเจ้าหน้าที่" title="ระบบเจ้าหน้าที่"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/5 text-white/90 transition-colors hover:border-white/40 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 md:hidden">
            <Briefcase size={16} aria-hidden="true" />
          </button>
          <StaffAccountMenu compact onLogout={handleLogout} />
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl px-3 py-4 md:px-6 md:py-6">
        {body}
      </div>
    </div>
  )
}
