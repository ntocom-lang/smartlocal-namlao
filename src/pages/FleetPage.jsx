import { lazy, Suspense, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, LayoutDashboard, Car, Fuel, Route, Wrench, BarChart2, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { useAuth } from '../contexts/AuthContext'

const FleetDashboard = lazy(() => import('../components/fleet/FleetDashboard'))
const FleetVehicles = lazy(() => import('../components/fleet/FleetVehicles'))
const FleetFuelLog = lazy(() => import('../components/fleet/FleetFuelLog'))
const FleetTrips = lazy(() => import('../components/fleet/FleetTrips'))
const FleetMaintenance = lazy(() => import('../components/fleet/FleetMaintenance'))
const FleetReport = lazy(() => import('../components/fleet/FleetReport'))

const TABS = [
  { id: 'dashboard',   label: 'ภาพรวม',     sub: 'สถิติและสรุปรวม',     Icon: LayoutDashboard, color: '#1a3a5c', grad: 'linear-gradient(135deg,#1a3a5c,#2d5f8a)' },
  { id: 'vehicles',    label: 'รถและเครื่องยนต์', sub: 'ทะเบียนรถและครุภัณฑ์', Icon: Car,          color: '#2563eb', grad: 'linear-gradient(135deg,#1d4ed8,#3b82f6)' },
  { id: 'fuel',        label: 'เชื้อเพลิง',  sub: 'บันทึกเชื้อเพลิง/ของเหลว', Icon: Fuel,          color: '#d97706', grad: 'linear-gradient(135deg,#b45309,#f59e0b)' },
  { id: 'trips',       label: 'การเดินทาง', sub: 'จองและบันทึกการใช้รถ', Icon: Route,           color: '#7c3aed', grad: 'linear-gradient(135deg,#6d28d9,#8b5cf6)' },
  { id: 'maintenance', label: 'ซ่อมบำรุง',  sub: 'ประวัติการซ่อมบำรุง',  Icon: Wrench,          color: '#dc2626', grad: 'linear-gradient(135deg,#b91c1c,#ef4444)' },
  { id: 'report',      label: 'รายงาน',     sub: 'ส่งออก PDF / Excel',   Icon: BarChart2,       color: '#059669', grad: 'linear-gradient(135deg,#047857,#10b981)' },
]

/* ── Desktop horizontal tab bar ── */
function TabBar({ tab, setTab }) {
  return (
    <div className="hidden md:flex overflow-x-auto border-b border-gray-200 bg-white"
         style={{ scrollbarWidth: 'none' }}>
      {TABS.map(({ id, label, Icon }) => (
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
    </div>
  )
}

/* ── Mobile grid launcher ── */
function MobileGrid({ setTab, fleetInfo, depts, tenant }) {
  const roleLabel =
    fleetInfo?.fleet_role === 'fleet_admin'  ? 'ผู้ดูแลระบบยานพาหนะ' :
    fleetInfo?.fleet_role === 'fleet_staff'  ? 'เจ้าหน้าที่ยานพาหนะ' :
    fleetInfo?.fleet_role === 'fleet_viewer' ? 'ผู้ดูรายงาน' : 'ผู้ใช้งาน'
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
        <div className="mt-3 inline-flex items-center gap-1.5 bg-white/10 rounded-full px-3 py-1">
          <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
          <p className="text-[11px] text-white/80 font-medium">
            {roleLabel}{deptName ? ` · ${deptName}` : ''}
          </p>
        </div>
      </div>

      {/* Grid */}
      <div className="px-4 py-5 flex-1">
        {/* ภาพรวม — full width */}
        <button onClick={() => setTab('dashboard')}
          className="w-full mb-3 rounded-2xl overflow-hidden shadow-md active:scale-[0.98] transition-transform text-left flex items-center gap-4 px-5 py-4"
          style={{ background: TABS[0].grad }}>
          <div className="w-12 h-12 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
            <LayoutDashboard size={22} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-black text-white">{TABS[0].label}</p>
            <p className="text-[11px] text-white/70 mt-0.5">{TABS[0].sub}</p>
          </div>
          <ChevronRight size={18} className="text-white/50" />
        </button>

        {/* 2-col grid for the rest */}
        <div className="grid grid-cols-2 gap-3">
          {TABS.slice(1).map(({ id, label, sub, Icon, grad }) => (
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
function MobileContent({ tab, setTab, children }) {
  const t = TABS.find(x => x.id === tab)
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
          <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center">
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
    </Suspense>
  )

  const embedded = !!onBack

  /* ── Embedded ── */
  if (embedded) {
    return (
      <div className="-mx-4 md:-mx-6 -mt-5">
        {/* Desktop tab bar */}
        <TabBar tab={activeTab} setTab={setTab} />

        {/* Mobile: grid or content */}
        <div className="md:hidden">
          {tab === null
            ? <MobileGrid setTab={setTab} fleetInfo={fleetInfo} depts={depts} tenant={tenant} />
            : <MobileContent tab={tab} setTab={setTab}>
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
              <MobileGrid setTab={setTab} fleetInfo={fleetInfo} depts={depts} tenant={tenant} />
            </div>
          )
          : <MobileContent tab={tab} setTab={setTab}>{contentNode}</MobileContent>
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
                {fleetInfo?.fleet_role === 'fleet_admin' ? 'ผู้ดูแลระบบ'
                 : fleetInfo?.fleet_role === 'fleet_staff' ? 'เจ้าหน้าที่'
                 : 'ผู้ดูรายงาน'}
                {depts.find(d => d.id === fleetInfo?.department_id)
                  ? ` · ${depts.find(d => d.id === fleetInfo.department_id).name}` : ''}
              </p>
            </div>
          </div>
          <TabBar tab={activeTab} setTab={setTab} />
        </div>
        <div className="flex-1 p-4 max-w-5xl mx-auto w-full">{contentNode}</div>
      </div>
    </>
  )
}
