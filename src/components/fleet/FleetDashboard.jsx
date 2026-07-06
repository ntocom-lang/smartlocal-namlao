import { useState, useEffect } from 'react'
import { Car, Fuel, Route, Wrench, AlertTriangle, TrendingUp, Wallet, CalendarClock } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const fmt = (n) => (n ?? 0).toLocaleString('th-TH')
const fmtB = (n) => `฿${fmt(Math.round(n ?? 0))}`

function KpiCard({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
             style={{ backgroundColor: color + '18' }}>
          <Icon size={18} style={{ color }} />
        </div>
      </div>
      <p className="text-xl font-black text-gray-800">{value}</p>
      <p className="text-xs font-semibold text-gray-500 mt-0.5">{label}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

function ExpiryAlert({ vehicles }) {
  const today = new Date()
  const in60  = new Date(today); in60.setDate(in60.getDate() + 60)

  const alerts = []
  vehicles.forEach(v => {
    const checks = [
      { field: 'insurance_expiry',    label: 'ประกันภัย' },
      { field: 'act_expiry',          label: 'พรบ.' },
      { field: 'registration_expiry', label: 'ทะเบียน' },
      { field: 'inspection_expiry',   label: 'ตรวจสภาพ' },
    ]
    checks.forEach(({ field, label }) => {
      if (!v[field]) return
      const exp = new Date(v[field])
      const days = Math.ceil((exp - today) / 86400000)
      if (days <= 60) alerts.push({ name: v.name, label, days, expired: days < 0 })
    })
  })
  alerts.sort((a, b) => a.days - b.days)

  if (!alerts.length) return (
    <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 rounded-xl px-4 py-3 text-sm">
      ✅ เอกสารยานพาหนะทุกคันยังไม่หมดอายุใน 60 วัน
    </div>
  )

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
        <AlertTriangle size={15} className="text-amber-500" />
        <span className="text-sm font-bold text-gray-700">เอกสารใกล้หมดอายุ</span>
        <span className="ml-auto text-xs font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
          {alerts.length} รายการ
        </span>
      </div>
      <div className="divide-y divide-gray-50">
        {alerts.slice(0, 5).map((a, i) => (
          <div key={i} className="flex items-center justify-between px-4 py-2.5">
            <div>
              <p className="text-xs font-semibold text-gray-700">{a.name}</p>
              <p className="text-[10px] text-gray-400">{a.label}</p>
            </div>
            <span className={`text-[10px] font-black px-2 py-1 rounded-lg ${
              a.expired ? 'bg-red-100 text-red-600'
              : a.days <= 15 ? 'bg-orange-100 text-orange-600'
              : 'bg-amber-100 text-amber-600'
            }`}>
              {a.expired ? `เกิน ${Math.abs(a.days)} วัน` : `อีก ${a.days} วัน`}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function BudgetBar({ depts, budgets, fuelByDept }) {
  if (!budgets.length) return null
  const now = new Date()
  const month = now.getMonth() + 1
  const year  = now.getFullYear() + 543

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
        <Wallet size={15} className="text-purple-500" />
        <span className="text-sm font-bold text-gray-700">งบน้ำมันเดือนนี้</span>
        <span className="text-[10px] text-gray-400 ml-1">เดือน {month}/{year}</span>
      </div>
      <div className="divide-y divide-gray-50">
        {depts.map(dept => {
          const budget = budgets.find(b => b.department_id === dept.id && b.month === month)?.budget_amount ?? 0
          const used   = fuelByDept[dept.id] ?? 0
          const pct    = budget > 0 ? Math.min((used / budget) * 100, 100) : 0
          if (!budget && !used) return null
          return (
            <div key={dept.id} className="px-4 py-3">
              <div className="flex justify-between mb-1.5">
                <span className="text-xs font-semibold text-gray-700">{dept.name}</span>
                <span className="text-[10px] text-gray-500">
                  {fmtB(used)} / {fmtB(budget)}
                </span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all"
                     style={{
                       width: `${pct}%`,
                       backgroundColor: pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#10b981'
                     }} />
              </div>
              <p className="text-[10px] text-gray-400 mt-1">{pct.toFixed(0)}% ของงบ</p>
            </div>
          )
        }).filter(Boolean)}
      </div>
    </div>
  )
}

export default function FleetDashboard({ tenant, depts, isAdmin }) {
  const [vehicles,   setVehicles]   = useState([])
  const [thisMonth,  setThisMonth]  = useState({ fuel_cost: 0, distance_km: 0, fuel_liters: 0 })
  const [budgets,    setBudgets]    = useState([])
  const [fuelByDept, setFuelByDept] = useState({})
  const [pendingCnt, setPendingCnt] = useState(0)
  const [loading,    setLoading]    = useState(true)

  useEffect(() => {
    if (!tenant?.id) return
    const now   = new Date()
    const y     = now.getFullYear()
    const m     = String(now.getMonth() + 1).padStart(2, '0')
    const from  = `${y}-${m}-01`
    const to    = `${y}-${m}-31`

    Promise.all([
      supabase.from('fleet_vehicles').select('*').eq('municipality_id', tenant.id),
      supabase.from('fleet_fuel_records').select('total_cost, liters, vehicle_id')
        .eq('municipality_id', tenant.id).gte('filled_at', from).lte('filled_at', to),
      supabase.from('fleet_trips').select('distance_km, department_id')
        .eq('municipality_id', tenant.id).gte('trip_date', from).lte('trip_date', to),
      supabase.from('fleet_budgets').select('*')
        .eq('municipality_id', tenant.id).eq('fiscal_year', now.getFullYear() + 543),
      supabase.from('fleet_trips').select('id', { count: 'exact', head: true })
        .eq('municipality_id', tenant.id).eq('status', 'pending'),
      supabase.from('fleet_fuel_records').select('total_cost, vehicle_id, fleet_vehicles(department_id)')
        .eq('municipality_id', tenant.id).gte('filled_at', from).lte('filled_at', to),
    ]).then(([{ data: v }, { data: f }, { data: t }, { data: b }, { count }, { data: fd }]) => {
      setVehicles(v ?? [])
      setThisMonth({
        fuel_cost:   (f ?? []).reduce((s, r) => s + (r.total_cost ?? 0), 0),
        fuel_liters: (f ?? []).reduce((s, r) => s + (r.liters ?? 0), 0),
        distance_km: (t ?? []).reduce((s, r) => s + (r.distance_km ?? 0), 0),
      })
      setBudgets(b ?? [])
      setPendingCnt(count ?? 0)
      const byDept = {}
      ;(fd ?? []).forEach(r => {
        const deptId = r.fleet_vehicles?.department_id
        if (deptId) byDept[deptId] = (byDept[deptId] ?? 0) + (r.total_cost ?? 0)
      })
      setFuelByDept(byDept)
    }).finally(() => setLoading(false))
  }, [tenant?.id])

  /* ── Realtime ── */
  useEffect(() => {
    if (!tenant?.id) return

    const refreshPending = () =>
      supabase.from('fleet_trips').select('id', { count: 'exact', head: true })
        .eq('municipality_id', tenant.id).eq('status', 'pending')
        .then(({ count }) => setPendingCnt(count ?? 0))

    const refreshVehicles = () =>
      supabase.from('fleet_vehicles').select('*').eq('municipality_id', tenant.id)
        .then(({ data }) => setVehicles(data ?? []))

    const channel = supabase.channel(`fleet-dash-${tenant.id}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fleet_trips' },
        ({ new: row }) => { if (row?.municipality_id === tenant.id) refreshPending() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fleet_vehicles' },
        ({ new: row }) => { if (row?.municipality_id === tenant.id) refreshVehicles() })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [tenant?.id])

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-4 border-gray-200 rounded-full animate-spin"
           style={{ borderTopColor: 'var(--color-primary)' }} />
    </div>
  )

  const activeVeh  = vehicles.filter(v => v.status === 'active').length
  const repairVeh  = vehicles.filter(v => v.status === 'under_repair').length
  const efficiency = thisMonth.fuel_liters > 0
    ? (thisMonth.distance_km / thisMonth.fuel_liters).toFixed(1) : '-'

  return (
    <div className="space-y-4">
      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={Car}       label="รถทั้งหมด"     value={vehicles.length}
          sub={`ใช้งานได้ ${activeVeh} คัน · ซ่อม ${repairVeh} คัน`} color="#3b82f6" />
        <KpiCard icon={Fuel}      label="ค่าน้ำมันเดือนนี้" value={fmtB(thisMonth.fuel_cost)}
          sub={`${fmt(thisMonth.fuel_liters.toFixed(0))} ลิตร`} color="#f59e0b" />
        <KpiCard icon={Route}     label="ระยะทางรวม"    value={`${fmt(Math.round(thisMonth.distance_km))} กม.`}
          sub="เดือนนี้" color="#10b981" />
        <KpiCard icon={TrendingUp} label="อัตราสิ้นเปลือง" value={`${efficiency} กม./ล.`}
          sub="เฉลี่ยเดือนนี้" color="#8b5cf6" />
      </div>

      {isAdmin && pendingCnt > 0 && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
          <CalendarClock size={16} className="text-blue-500 shrink-0" />
          <p className="text-sm text-blue-700">
            มีการเดินทางรอการอนุมัติ <strong>{pendingCnt}</strong> รายการ
          </p>
        </div>
      )}

      <ExpiryAlert vehicles={vehicles} />

      {isAdmin && <BudgetBar depts={depts} budgets={budgets} fuelByDept={fuelByDept} />}
    </div>
  )
}
