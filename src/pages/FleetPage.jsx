import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, LayoutDashboard, Car, Fuel, Route, Wrench, Settings } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { useAuth } from '../contexts/AuthContext'
import FleetDashboard   from '../components/fleet/FleetDashboard'
import FleetVehicles    from '../components/fleet/FleetVehicles'
import FleetFuelLog     from '../components/fleet/FleetFuelLog'
import FleetTrips       from '../components/fleet/FleetTrips'
import FleetMaintenance from '../components/fleet/FleetMaintenance'
import FleetSetup       from '../components/fleet/FleetSetup'

const TABS = [
  { id: 'dashboard',    label: 'ภาพรวม',     Icon: LayoutDashboard },
  { id: 'vehicles',     label: 'ยานพาหนะ',   Icon: Car             },
  { id: 'fuel',         label: 'น้ำมัน',      Icon: Fuel            },
  { id: 'trips',        label: 'การเดินทาง', Icon: Route           },
  { id: 'maintenance',  label: 'ซ่อมบำรุง',  Icon: Wrench          },
  { id: 'setup',        label: 'ตั้งค่า',     Icon: Settings        },
]

export default function FleetPage() {
  const navigate    = useNavigate()
  const { tenant }  = useTenant()
  const { user }    = useAuth()
  const [tab, setTab]           = useState('dashboard')
  const [fleetInfo, setFleetInfo] = useState(null)  // { fleet_role, fleet_department_id }
  const [depts, setDepts]       = useState([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    if (!tenant?.id || !user?.id) return
    Promise.all([
      supabase.from('profiles')
        .select('fleet_role, fleet_department_id')
        .eq('id', user.id)
        .single(),
      supabase.from('fleet_departments')
        .select('id, code, name, short_name')
        .eq('municipality_id', tenant.id)
        .eq('is_active', true)
        .order('sort_order'),
    ]).then(([{ data: p }, { data: d }]) => {
      setFleetInfo(p ?? { fleet_role: null, fleet_department_id: null })
      setDepts(d ?? [])
    }).finally(() => setLoading(false))
  }, [tenant?.id, user?.id])

  const isAdmin   = fleetInfo?.fleet_role === 'fleet_admin'
  const isStaff   = fleetInfo?.fleet_role === 'fleet_staff'
  const isViewer  = fleetInfo?.fleet_role === 'fleet_viewer'
  const hasAccess = isAdmin || isStaff || isViewer

  const visibleTabs = TABS.filter(t => {
    if (t.id === 'setup') return isAdmin
    return true
  })

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
      <button onClick={() => navigate(-1)}
              className="mt-2 px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600">
        ย้อนกลับ
      </button>
    </div>
  )

  const ctx = { tenant, fleetInfo, depts, setDepts, isAdmin, isStaff, isViewer }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Header */}
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
              {fleetInfo?.fleet_department_id && depts.find(d => d.id === fleetInfo.fleet_department_id)
                ? ` · ${depts.find(d => d.id === fleetInfo.fleet_department_id).name}` : ''}
            </p>
          </div>
        </div>
        {/* Tab bar */}
        <div className="flex overflow-x-auto px-2 pb-0" style={{ scrollbarWidth: 'none' }}>
          {visibleTabs.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className="flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-bold shrink-0 border-b-2 transition-colors"
              style={{
                borderColor: tab === id ? 'var(--color-primary)' : 'transparent',
                color:       tab === id ? 'var(--color-primary)' : '#9ca3af',
              }}>
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 max-w-5xl mx-auto w-full">
        {tab === 'dashboard'   && <FleetDashboard   {...ctx} />}
        {tab === 'vehicles'    && <FleetVehicles    {...ctx} />}
        {tab === 'fuel'        && <FleetFuelLog     {...ctx} />}
        {tab === 'trips'       && <FleetTrips       {...ctx} />}
        {tab === 'maintenance' && <FleetMaintenance {...ctx} />}
        {tab === 'setup'       && <FleetSetup       {...ctx} />}
      </div>
    </div>
  )
}
