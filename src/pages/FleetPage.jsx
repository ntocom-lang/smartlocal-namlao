import { lazy, Suspense, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, LayoutDashboard, Car, Fuel, Route, Wrench, BarChart2, Wallet, ChevronRight, BookOpen } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { useAuth } from '../contexts/AuthContext'

const FleetDashboard = lazy(() => import('../components/fleet/FleetDashboard'))
const FleetVehicles = lazy(() => import('../components/fleet/FleetVehicles'))
const FleetFuelLog = lazy(() => import('../components/fleet/FleetFuelLog'))
const FleetTrips = lazy(() => import('../components/fleet/FleetTrips'))
const FleetMaintenance = lazy(() => import('../components/fleet/FleetMaintenance'))
const FleetReport = lazy(() => import('../components/fleet/FleetReport'))
const FleetBudget = lazy(() => import('../components/fleet/FleetBudget'))

// adminOnly = เห็นเฉพาะผู้มีสิทธิ์ fleet_admin (หรือ admin/superadmin ของ อปท.)
// งบประมาณเดิมมี UI อยู่หลัง /admin ทางเดียว ผู้ดูแลยานพาหนะที่ role เป็น staff จึงตั้งงบไม่ได้
// ทั้งที่ RLS fbudget_write ให้สิทธิ์อยู่แล้ว และแถบงบบนหน้าภาพรวมก็ไม่มีวันขึ้น
const TABS = [
  { id: 'dashboard',   label: 'ภาพรวม',     sub: 'สถิติและสรุปรวม',     Icon: LayoutDashboard, color: '#1a3a5c', grad: 'linear-gradient(135deg,#1a3a5c,#2d5f8a)' },
  { id: 'vehicles',    label: 'รถและเครื่องยนต์', sub: 'ทะเบียนรถและครุภัณฑ์', Icon: Car,          color: '#2563eb', grad: 'linear-gradient(135deg,#1d4ed8,#3b82f6)' },
  { id: 'fuel',        label: 'เชื้อเพลิง',  sub: 'บันทึกเชื้อเพลิง/ของเหลว', Icon: Fuel,          color: '#d97706', grad: 'linear-gradient(135deg,#b45309,#f59e0b)' },
  { id: 'trips',       label: 'การใช้รถ', sub: 'คำขอและบันทึกการใช้รถ', Icon: Route,           color: '#7c3aed', grad: 'linear-gradient(135deg,#6d28d9,#8b5cf6)' },
  { id: 'maintenance', label: 'ซ่อมบำรุง',  sub: 'ประวัติการซ่อมบำรุง',  Icon: Wrench,          color: '#dc2626', grad: 'linear-gradient(135deg,#b91c1c,#ef4444)' },
  { id: 'report',      label: 'รายงาน',     sub: 'ส่งออก PDF / Excel',   Icon: BarChart2,       color: '#059669', grad: 'linear-gradient(135deg,#047857,#10b981)' },
  { id: 'budget',      label: 'งบประมาณ',   sub: 'งบน้ำมันรายกอง',      Icon: Wallet,          color: '#0891b2', grad: 'linear-gradient(135deg,#0e7490,#22d3ee)', adminOnly: true },
]

/* ── ปุ่มเปิดคู่มือการใช้งาน (เปิดแท็บใหม่ ไม่ทับหน้าที่กำลังทำงานอยู่) ── */
function ManualLink({ light, className = '' }) {
  return (
    <a href="/manual-staff.html" target="_blank" rel="noopener noreferrer" title="คู่มือการใช้งานยานพาหนะ/น้ำมัน"
      className={`shrink-0 flex items-center justify-center rounded-xl transition-colors ${
        light ? 'bg-white/15 hover:bg-white/25 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-500'
      } ${className}`}>
      <BookOpen size={16} />
    </a>
  )
}

/* ── Desktop horizontal tab bar ── */
function TabBar({ tab, setTab, tabs }) {
  return (
    <div className="hidden md:flex items-center overflow-x-auto border-b border-gray-200 bg-white"
         style={{ scrollbarWidth: 'none' }}>
      {tabs.map(({ id, label, Icon }) => (
        <button key={id} onClick={() => setTab(id)}
          className="flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-bold shrink-0 border-b-2 transition-colors"
          style={{
            borderColor: tab === id ? 'var(--color-primary)' : 'transparent',
            color:       tab === id ? 'var(--color-primary)' : '#9ca3af',
          }}>
          <Icon size={14} />
          {label}
        </button>
      ))}
      <ManualLink className="w-8 h-8 ml-auto mr-3" />
    </div>
  )
}

/* ── Mobile grid launcher ── */
// ป้ายบอกสิทธิ์ต้องคำนวณด้วยตรรกะเดียวกับ isAdmin (fleet_role === 'fleet_admin' || isSysAdmin)
// เดิมป้ายดูแค่ fleet_role แล้วตกมาที่ 'ผู้ดูรายงาน' เป็นค่าท้ายสุด ผู้ดูแลระบบของ อปท.
// (role = 'admin') ที่ยังไม่ถูกกำหนด fleet_role จึงถูกแสดงว่า "อ่านอย่างเดียว"
// ทั้งที่ fleet_is_manager() ฝั่ง DB ให้สิทธิ์อนุมัติและลบได้ทุกอย่าง
function fleetRoleLabel(fleetInfo, isSysAdmin, short = false) {
  if (fleetInfo?.fleet_role === 'fleet_admin' || isSysAdmin)
    return short ? 'ผู้ดูแลระบบ' : 'ผู้ดูแลระบบยานพาหนะ'
  if (fleetInfo?.fleet_role === 'fleet_staff')
    return short ? 'เจ้าหน้าที่' : 'เจ้าหน้าที่ยานพาหนะ'
  if (fleetInfo?.fleet_role === 'fleet_viewer') return 'ผู้ดูรายงาน'
  return 'ผู้ใช้งาน'
}

function MobileGrid({ setTab, fleetInfo, depts, tenant, isSysAdmin, tabs }) {
  const roleLabel = fleetRoleLabel(fleetInfo, isSysAdmin)
  const deptName = depts.find(d => d.id === fleetInfo?.department_id)?.name ?? ''

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Hero header */}
      <div className="px-5 pt-8 pb-6" style={{ background: 'linear-gradient(160deg,#0f2744,#1a3a5c,#1e4976)' }}>
        <p className="text-[11px] font-semibold text-blue-300 uppercase tracking-widest mb-1">
          {tenant?.name ?? 'เทศบาล'}
        </p>
        <h1 className="text-xl font-black text-white leading-tight">
          ระบบยานพาหนะ<br />และเชื้อเพลิง
        </h1>
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="inline-flex items-center gap-1.5 bg-white/10 rounded-full px-3 py-1">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
            <p className="text-[11px] text-white/80 font-medium">
              {roleLabel}{deptName ? ` · ${deptName}` : ''}
            </p>
          </div>
          <ManualLink light className="w-8 h-8" />
        </div>
      </div>

      {/* Grid */}
      <div className="px-4 py-5 flex-1">
        {/* ภาพรวม — full width */}
        <button onClick={() => setTab('dashboard')}
          className="w-full mb-3 rounded-2xl overflow-hidden shadow-md active:scale-[0.98] transition-transform text-left flex items-center gap-4 px-5 py-4"
          style={{ background: tabs[0].grad }}>
          <div className="w-12 h-12 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
            <LayoutDashboard size={22} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-black text-white">{tabs[0].label}</p>
            <p className="text-[11px] text-white/70 mt-0.5">{tabs[0].sub}</p>
          </div>
          <ChevronRight size={18} className="text-white/50" />
        </button>

        {/* 2-col grid for the rest */}
        <div className="grid grid-cols-2 gap-3">
          {tabs.slice(1).map(({ id, label, sub, Icon, grad }) => (
            <button key={id} onClick={() => setTab(id)}
              className="rounded-2xl overflow-hidden shadow-sm active:scale-[0.97] transition-transform text-left flex flex-col"
              style={{ background: '#fff', border: '1px solid #e5e7eb' }}>
              {/* Color top */}
              <div className="w-full h-20 flex items-center justify-center" style={{ background: grad }}>
                <div className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center">
                  <Icon size={21} className="text-white" />
                </div>
              </div>
              {/* Label bottom */}
              <div className="px-3 py-3">
                <p className="text-[13px] font-bold text-gray-800">{label}</p>
                <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{sub}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── Mobile content view (เมื่อเลือก tab แล้ว) ── */
function MobileContent({ tab, setTab, children, tabs }) {
  const t = tabs.find(x => x.id === tab)
  if (!t) return null
  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <div className="sticky top-0 z-30 shadow-sm"
           style={{ background: t.grad }}>
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <button onClick={() => setTab(null)}
            className="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center shrink-0 active:bg-white/25">
            <ArrowLeft size={18} className="text-white" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-white/60 font-medium">ระบบยานพาหนะ</p>
            <p className="text-[15px] font-black text-white leading-tight">{t.label}</p>
          </div>
          <ManualLink light className="w-9 h-9" />
          <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
            <t.Icon size={18} className="text-white" />
          </div>
        </div>
      </div>
      <div className="flex-1 px-3 py-3">{children}</div>
    </div>
  )
}

export default function FleetPage({ onBack } = {}) {
  const navigate    = useNavigate()
  const { tenant }  = useTenant()
  const { session, role } = useAuth()
  const user        = session?.user
  const isSysAdmin  = role === 'admin' || role === 'superadmin'

  // null = mobile grid home, string = tab selected
  const [tab, setTab]           = useState(null)
  const [fleetInfo, setFleetInfo] = useState(null)
  const [depts, setDepts]       = useState([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    if (!tenant?.id || !user?.id) return
    Promise.all([
      supabase.from('profiles')
        .select('fleet_role, department_id')
        .eq('id', user.id).single(),
      supabase.from('departments')
        .select('id, code, name, short_name')
        .eq('municipality_id', tenant.id).eq('is_active', true).order('sort_order'),
    ]).then(([{ data: p }, { data: d }]) => {
      setFleetInfo(p ?? { fleet_role: null, department_id: null })
      setDepts(d ?? [])
    }).finally(() => setLoading(false))
  }, [tenant?.id, user?.id])

  const isAdmin   = fleetInfo?.fleet_role === 'fleet_admin' || isSysAdmin
  const isStaff   = fleetInfo?.fleet_role === 'fleet_staff'
  const isViewer  = fleetInfo?.fleet_role === 'fleet_viewer'
  const hasAccess = isAdmin || isStaff || isViewer || isSysAdmin

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-6 h-6 border-4 border-gray-200 rounded-full animate-spin"
           style={{ borderTopColor: 'var(--color-primary)' }} />
    </div>
  )

  if (!hasAccess) return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-6 text-center">
      <div className="text-5xl">🚫</div>
      <h2 className="text-lg font-bold text-gray-800">ไม่มีสิทธิ์เข้าใช้ระบบ</h2>
      <p className="text-sm text-gray-500">กรุณาติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์ใช้งานระบบยานพาหนะ</p>
      <button onClick={() => onBack ? onBack() : navigate(-1)}
              className="mt-2 px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600">
        ย้อนกลับ
      </button>
    </div>
  )

  const ctx = { tenant, fleetInfo, depts, setDepts, isAdmin, isStaff, isViewer }

  // desktop default to 'dashboard' when tab is null
  const activeTab = tab ?? 'dashboard'

  // แท็บที่ผู้ใช้คนนี้เห็นจริง — งบประมาณเปิดให้เฉพาะผู้ดูแลระบบยานพาหนะ ตรงกับ RLS fbudget_write
  const visibleTabs = TABS.filter(t => !t.adminOnly || isAdmin)

  const contentNode = (
    <Suspense fallback={
      <div className="flex min-h-48 items-center justify-center" role="status" aria-label="กำลังโหลดโมดูลยานพาหนะ">
        <div className="w-6 h-6 border-4 border-gray-200 rounded-full animate-spin"
             style={{ borderTopColor: 'var(--color-primary)' }} />
      </div>
    }>
      {activeTab === 'dashboard'   && <FleetDashboard   {...ctx} />}
      {activeTab === 'vehicles'    && <FleetVehicles    {...ctx} />}
      {activeTab === 'fuel'        && <FleetFuelLog     {...ctx} />}
      {activeTab === 'trips'       && <FleetTrips       {...ctx} />}
      {activeTab === 'maintenance' && <FleetMaintenance {...ctx} />}
      {activeTab === 'report'      && <FleetReport      tenant={tenant} depts={depts} />}
      {activeTab === 'budget' && isAdmin && <FleetBudget tenant={tenant} depts={depts} />}
    </Suspense>
  )

  const embedded = !!onBack

  /* ── Embedded ── */
  if (embedded) {
    return (
      <div className="-mx-4 md:-mx-6 -mt-5">
        {/* Desktop title (สำนักงาน embed ไม่มีหัวข้อมาก่อนเลย ต่างจากโหมด standalone /fleet ที่มีอยู่แล้ว) */}
        <div className="hidden md:block bg-white px-4 md:px-6 pt-4">
          <h1 className="text-base font-black text-gray-800">🚗 ระบบยานพาหนะและเชื้อเพลิง</h1>
          <p className="text-[11px] text-gray-400 mb-1">
            {fleetRoleLabel(fleetInfo, isSysAdmin, true)}
            {depts.find(d => d.id === fleetInfo?.department_id)
              ? ` · ${depts.find(d => d.id === fleetInfo.department_id).name}` : ''}
          </p>
        </div>

        {/* Desktop tab bar */}
        <TabBar tab={activeTab} setTab={setTab} tabs={visibleTabs} />

        {/* Mobile: grid or content */}
        <div className="md:hidden">
          {tab === null
            ? <MobileGrid setTab={setTab} fleetInfo={fleetInfo} depts={depts} tenant={tenant} isSysAdmin={isSysAdmin} tabs={visibleTabs} />
            : <MobileContent tab={tab} setTab={setTab} tabs={visibleTabs}>
                <div>{contentNode}</div>
              </MobileContent>
          }
        </div>

        {/* Desktop: content */}
        <div className="hidden md:block px-4 md:px-6 py-5">{contentNode}</div>
      </div>
    )
  }

  /* ── Standalone /fleet ── */
  return (
    <>
      {/* Mobile */}
      <div className="md:hidden">
        {tab === null
          ? (
            <div className="relative">
              <button onClick={() => navigate(-1)}
                className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                <ArrowLeft size={16} className="text-white" />
              </button>
              <MobileGrid setTab={setTab} fleetInfo={fleetInfo} depts={depts} tenant={tenant} isSysAdmin={isSysAdmin} tabs={visibleTabs} />
            </div>
          )
          : <MobileContent tab={tab} setTab={setTab} tabs={visibleTabs}>{contentNode}</MobileContent>
        }
      </div>

      {/* Desktop */}
      <div className="hidden md:flex flex-col min-h-screen bg-gray-50">
        <div className="sticky top-0 z-30 bg-white border-b border-gray-100 shadow-sm">
          <div className="flex items-center gap-3 px-4 pt-3 pb-2">
            <button onClick={() => navigate(-1)}
                    className="p-2 -ml-1 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors">
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-base font-black text-gray-800">🚗 ระบบยานพาหนะและเชื้อเพลิง</h1>
              <p className="text-[11px] text-gray-400">
                {fleetRoleLabel(fleetInfo, isSysAdmin, true)}
                {depts.find(d => d.id === fleetInfo?.department_id)
                  ? ` · ${depts.find(d => d.id === fleetInfo.department_id).name}` : ''}
              </p>
            </div>
          </div>
          <TabBar tab={activeTab} setTab={setTab} tabs={visibleTabs} />
        </div>
        <div className="flex-1 p-4 max-w-5xl mx-auto w-full">{contentNode}</div>
      </div>
    </>
  )
}
