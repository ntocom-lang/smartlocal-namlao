import { useState, useEffect, useMemo } from 'react'
import { X, Route, Fuel, Wrench, Gauge, CalendarClock, ShieldCheck, AlertTriangle, Pencil, ClipboardList, History } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { assetEmoji, assetIdentifier, FUEL_LABEL, isVehicleAsset, meterUnitShort } from '../../lib/fleetAssets'
import { fetchAllRows } from '../../lib/fetchAllRows'
import { form5DateText, INCIDENT_KIND_LABEL } from '../../lib/fleetForm5Print'
import { MAINTENANCE_TYPE_LABEL } from '../../lib/fleetForm6Print'
import { classifyEmission, emissionDueText } from '../../lib/fleetEmission'
import {
  buildMonthlySeries, costSplit, documentReadiness, efficiencyVsStandard, fiscalYearRange, fuelCostPerKm,
  maintenanceTitle, recentActivity, sumSeries, vehicleAgeText, vehicleCompleteness,
} from '../../lib/fleetVehicleSummary'
import FleetEmptyState from './FleetEmptyState'
import FleetIncidentModal from './FleetIncidentModal'

const fmt  = n => (n ?? 0).toLocaleString('th-TH')
const fmtB = n => `฿${fmt(Math.round(n ?? 0))}`
const thDate = d => new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
const thDateLong = d => new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })

function isoDate(d) { return d.toISOString().slice(0, 10) }
function bangkokToday() { return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }) }

const REGULATION_LABEL = { central: 'ยานพาหนะส่วนกลาง (แบบ 2)', position: 'รถยนต์ประจำตำแหน่ง (แบบ 1)' }

// สีสถานะความพร้อม — ชุดเดียวทั้งเอกสารและตรวจมลพิษ ผู้ใช้อ่านสีเดียวกันได้ทั้งแถบ
const READY_TONE = {
  ok:      { dot: '#10b981', bg: 'bg-emerald-50', border: 'border-emerald-100', text: 'text-emerald-700' },
  soon:    { dot: '#f59e0b', bg: 'bg-amber-50',   border: 'border-amber-100',   text: 'text-amber-700' },
  expired: { dot: '#ef4444', bg: 'bg-red-50',     border: 'border-red-100',     text: 'text-red-700' },
  missing: { dot: '#9ca3af', bg: 'bg-gray-50',    border: 'border-gray-200',    text: 'text-gray-500' },
}
const EMISSION_TONE = { ok: 'ok', soon: 'soon', overdue: 'expired', never: 'missing' }

function documentText(item) {
  if (item.state === 'missing') return 'ยังไม่กรอกวันหมดอายุ'
  if (item.state === 'expired') return `หมดอายุแล้ว ${fmt(Math.abs(item.daysLeft))} วัน`
  return `อีก ${fmt(item.daysLeft)} วัน · ${thDate(item.date)}`
}

function SectionTitle({ icon: Icon, children, right }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <p className="flex items-center gap-1.5 text-xs font-bold text-gray-600">
        {Icon && <Icon size={13} className="text-gray-400" />}{children}
      </p>
      {right}
    </div>
  )
}

function ReadyCard({ tone, label, sub, text }) {
  const t = READY_TONE[tone] ?? READY_TONE.missing
  return (
    <div className={`rounded-xl border ${t.border} ${t.bg} px-3 py-2.5`}>
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.dot }} />
        <span className="text-xs font-bold text-gray-700">{label}</span>
      </div>
      <p className={`mt-1 text-[12px] font-semibold ${t.text}`}>{text}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function KpiCard({ icon: Icon, tone, label, value, unit, sub, children }) {
  return (
    <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-3.5">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ backgroundColor: tone + '1a', color: tone }}>
          <Icon size={13} />
        </span>
        <span className="text-[11px] font-bold text-gray-500">{label}</span>
      </div>
      <p className="text-xl font-black text-gray-800 leading-tight">
        {value} {unit && <span className="text-xs font-semibold text-gray-400">{unit}</span>}
      </p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
      {children}
    </div>
  )
}

function InfoRow({ label, value }) {
  const empty = value === null || value === undefined || String(value).trim() === ''
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-gray-100 last:border-b-0">
      <dt className="text-[11px] text-gray-500 shrink-0">{label}</dt>
      <dd className={`text-xs text-right ${empty ? 'text-gray-300 italic' : 'font-semibold text-gray-700'}`}>{empty ? 'ยังไม่กรอก' : value}</dd>
    </div>
  )
}

export default function FleetVehicleDetail({
  vehicle, tenant, isAdmin = false, onClose, onEdit = null,
  typeLabel = '', statusLabel = '', statusColor = '#10b981',
}) {
  const [loading, setLoading] = useState(true)
  // แบบ 5 รายงานเหตุสูญหาย/เสียหาย — ผู้ดูแลยานพาหนะเท่านั้น (RLS fleet_is_manager กันซ้ำ)
  // กรณีไม่มีทริปผูก (เช่น รถหาย/เสียหายระหว่างจอด) สร้างจากที่นี่ · ทุกปีงบประมาณ ไม่กรองตามช่วง
  const [incidents, setIncidents] = useState([])
  const [incidentModal, setIncidentModal] = useState(null) // { id } | { id: null } = รายงานใหม่
  const [series, setSeries] = useState([])
  // อัตราสิ้นเปลืองคิดแบบ full-to-full จาก efficiency_kml ที่ trigger ฝั่ง DB คำนวณให้ต่อการเติมแต่ละครั้ง
  // ไม่ใช่ (ระยะทางจากใบเดินทาง ÷ ลิตรทั้งหมด) แบบเดิม เพราะสองตัวนี้ไม่ได้ครอบคลุมช่วงเดียวกัน:
  // การใช้รถบางเที่ยวไม่ได้ลงใบเดินทาง แต่ค่าน้ำมันลงครบทุกใบเสร็จ ตัวหารจึงใหญ่เกินจริงเสมอ
  // (เคยได้ 0.6 กม./ล. สำหรับรถกระบะ ขณะที่หน้าภาพรวมแสดง 7.1 กม./ล. ของคันเดียวกัน)
  const [efficiency, setEfficiency] = useState(null)
  const [emission, setEmission] = useState(null)   // แถวของคันนี้จาก fleet_emission_status
  const [lastMeter, setLastMeter] = useState(null) // เลขไมล์ขากลับของทริปที่เสร็จล่าสุด
  const [recent, setRecent] = useState([])
  const [metric, setMetric] = useState('cost')     // กราฟรายเดือน: cost | distance
  const [pickedKey, setPickedKey] = useState(null)
  // useMemo กันสร้าง Date object ใหม่ทุก render (ค่าคงที่ตราบใดที่ยังไม่ปิด modal) ไม่งั้น effect ด้านล่างจะวนซ้ำ
  const { from, to, labelBE, today } = useMemo(() => ({ ...fiscalYearRange(), today: bangkokToday() }), [])
  const vehicleLike = isVehicleAsset(vehicle)

  useEffect(() => {
    if (!tenant?.id || !vehicle?.id) return
    // setState เรียกผ่าน queueMicrotask กันเข้าเงื่อนไข effect เรียก setState ตรงๆ ในตัว effect
    queueMicrotask(() => {
      setLoading(true)
      const fromStr = isoDate(from), toStr = isoDate(to)
      // 3 ชุดแรกถูกนำไปรวมเป็นสถิติรายเดือนฝั่ง client จึงต้องได้แถวครบ ไม่ถูก PostgREST ตัด
      // ตาม db-max-rows — .order('id') บังคับลำดับให้ชี้ขาด ไม่งั้นการไล่หน้าจะได้แถวซ้ำหรือตกหล่น
      Promise.all([
        // นับเฉพาะ 'completed' — คำขอที่ยังไม่อนุมัติ ที่ถูกปฏิเสธ และที่ยกเลิกไปแล้ว ไม่ใช่ "เที่ยว"
        // ที่ใช้รถจริง (รายงานส่งออกที่ FleetReport กรอง completed เหมือนกัน ตัวเลขสองที่ต้องตรงกัน)
        fetchAllRows(() => supabase.from('fleet_trips').select('trip_date, distance_km')
          .eq('municipality_id', tenant.id).eq('vehicle_id', vehicle.id).eq('status', 'completed')
          .gte('trip_date', fromStr).lte('trip_date', toStr).order('id')),
        // invoice_total/price_per_liter ต้องมาด้วย — ยอดเงินตัดสินที่ fuelRecordAmount() (ยอดตามบิลชนะ)
        fetchAllRows(() => supabase.from('fleet_fuel_records')
          .select('filled_at, liters, total_cost, invoice_total, price_per_liter, efficiency_kml')
          .eq('municipality_id', tenant.id).eq('vehicle_id', vehicle.id)
          .gte('filled_at', fromStr).lte('filled_at', toStr).order('id')),
        fetchAllRows(() => supabase.from('fleet_maintenance').select('service_date, cost')
          .eq('municipality_id', tenant.id).eq('vehicle_id', vehicle.id)
          .gte('service_date', fromStr).lte('service_date', toStr).order('id')),
        // รายการล่าสุดไม่จำกัดปีงบ — รถที่ปีนี้ยังไม่ได้ใช้ก็ยังเห็นว่าเติม/ซ่อมครั้งสุดท้ายเมื่อไร
        supabase.from('fleet_fuel_records').select('id, filled_at, liters, total_cost, invoice_total, price_per_liter')
          .eq('municipality_id', tenant.id).eq('vehicle_id', vehicle.id)
          .order('filled_at', { ascending: false }).order('created_at', { ascending: false }).limit(5),
        supabase.from('fleet_maintenance').select('id, service_date, maintenance_type, description, cost')
          .eq('municipality_id', tenant.id).eq('vehicle_id', vehicle.id)
          .order('service_date', { ascending: false }).order('created_at', { ascending: false }).limit(5),
        // เลขไมล์ล่าสุดเรียงตามเวลาจริงแบบเดียวกับฟอร์มใช้รถ (ไม่ใช่ค่ามากสุด — เลขพิมพ์ผิดหลักจะชนะ)
        supabase.rpc('fleet_vehicle_last_odometer', { p_vehicle_id: vehicle.id, p_exclude_trip: null }),
        // ตรวจมลพิษ (ข้อ ๒๐) — RPC คืนทุกคันของ อปท. ใช้เฉพาะแถวของคันนี้
        vehicleLike
          ? supabase.rpc('fleet_emission_status', { p_municipality_id: tenant.id })
          : Promise.resolve({ data: [] }),
      ]).then((results) => {
        const failed = results.filter(r => r && r.error)
        if (failed.length) console.error('FleetVehicleDetail query error:', failed.map(r => r.error.message))
        const [{ data: trips }, { data: fuel }, { data: maint }, { data: recentFuel }, { data: recentMaint },
          { data: odo }, { data: emissionRows }] = results
        const months = buildMonthlySeries({ from, trips: trips ?? [], fuel: fuel ?? [], maint: maint ?? [] })
        setSeries(months)
        setRecent(recentActivity({ fuel: recentFuel ?? [], maint: recentMaint ?? [], limit: 5 }))
        setLastMeter(Array.isArray(odo) ? odo[0]?.odometer ?? null : odo?.odometer ?? null)
        setEmission((emissionRows ?? []).find(row => row.vehicle_id === vehicle.id) ?? null)

        const effVals = (fuel ?? []).map(f => f.efficiency_kml).filter(x => x != null).map(Number)
        setEfficiency(vehicleLike && effVals.length
          ? Math.round((effVals.reduce((s, x) => s + x, 0) / effVals.length) * 10) / 10
          : null)
      }).finally(() => setLoading(false))
    })
    // vehicle ทั้งก้อนไม่ต้องอยู่ใน dependency — modal นี้ผูกกับรถคันเดียวตลอดอายุ (id เปลี่ยน = เปิดใหม่)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id, vehicle?.id, from, to])

  // ดึงเฉพาะข้อเท็จจริงของเหตุ ไม่ดึงตารางบุคคล — รายการนี้แค่ให้เลือกเปิด
  function loadIncidents() {
    if (!isAdmin || !tenant?.id || !vehicle?.id) return
    supabase.from('fleet_incidents')
      .select('id,incident_kind,incident_date,report_date,location,trip_id')
      .eq('municipality_id', tenant.id).eq('vehicle_id', vehicle.id)
      .order('incident_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error('FleetVehicleDetail incidents error:', error.message)
        setIncidents(data ?? [])
      })
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { queueMicrotask(loadIncidents) }, [isAdmin, tenant?.id, vehicle?.id])

  const totals = useMemo(() => sumSeries(series), [series])
  const split = costSplit(totals)
  const perKm = fuelCostPerKm({ fuelCost: totals.fuelCost, fuelLiters: totals.fuelLiters, efficiencyKml: efficiency })
  const vsStandard = efficiencyVsStandard(efficiency, vehicle.fuel_rate_standard_kml)
  const documents = documentReadiness(vehicle, today)
  const emissionState = emission ? classifyEmission(emission, today) : null
  const completeness = vehicleCompleteness(vehicle)
  const age = vehicleAgeText(vehicle.acquired_date, today)
  const unit = meterUnitShort(vehicle)
  // เลขไมล์ปัจจุบัน: ทริปที่เสร็จล่าสุด → ค่าจากสถานะมลพิษ (มีเติมน้ำมัน/ซ่อมสำรอง) → เลขเริ่มต้น
  const meterNow = lastMeter ?? emission?.current_meter ?? vehicle.odometer_initial ?? null
  const brandModel = [vehicle.brand, vehicle.model].map(v => String(v ?? '').trim()).filter(Boolean).join(' ')

  // กราฟ: ค่าของแต่ละเดือนตามมุมมองที่เลือก · เดือนที่ยังไม่ถึงจางลง ไม่ใช่ "ไม่มีการใช้รถ"
  const currentKey = today.slice(0, 7)
  const valueOf = m => (metric === 'cost' ? m.fuelCost + m.maintCost : m.distance)
  const maxValue = Math.max(1, ...series.map(valueOf))
  const lastActive = [...series].reverse().find(m => m.trips || m.fuelCount || m.maintCount)
  const picked = series.find(m => m.key === pickedKey) ?? lastActive ?? series.find(m => m.key === currentKey) ?? null

  const deptText = vehicle.is_pool && !vehicle.department_id
    ? 'ใช้ร่วมทุกกอง'
    : vehicle.departments?.short_name || vehicle.departments?.name || ''

  return (
    // z-[55]: เหนือแถบเมนูล่างบนมือถือ (BottomNav z-50 วาดทีหลังจึงทับส่วนท้าย — แบบ 5 ถูกบังจนกดไม่ได้)
    // แต่ต่ำกว่า FleetIncidentModal (z-[60]) ที่เปิดซ้อนจากหน้านี้
    <div className="fixed inset-0 z-[55] flex items-end md:items-center justify-center bg-black/50 md:p-4">
      {/* มือถือ: ทั้งแผ่นเลื่อนพร้อมกัน (หัวการ์ดสูง ~40% ของจอ ถ้าค้างไว้เนื้อหาเหลือที่นิดเดียว)
          จอใหญ่: หัวการ์ดค้าง เนื้อหาเลื่อนข้างใน · ปุ่มปิด sticky จึงกดได้ตลอดทั้งสองแบบ */}
      <div className="bg-white rounded-t-3xl md:rounded-2xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl overflow-y-auto md:overflow-hidden">
        <div className="sticky top-0 z-10 h-0 flex justify-end">
          <button onClick={onClose} aria-label="ปิด"
            className="mt-3 mr-3 h-8 w-8 flex items-center justify-center rounded-full bg-black/25 text-white hover:bg-black/40 backdrop-blur-sm">
            <X size={17} />
          </button>
        </div>
        {/* ── หัวการ์ด ── */}
        <div className="shrink-0 px-5 md:px-6 pt-5 pb-4 text-white"
             style={{ background: 'linear-gradient(135deg,#1a3a5c 0%,#24507a 55%,#2d5f8a 100%)' }}>
          <div className="flex items-start gap-3 pr-10">
            <div className="w-12 h-12 rounded-2xl bg-white/15 ring-1 ring-white/20 flex items-center justify-center text-2xl shrink-0">
              {assetEmoji(vehicle)}
            </div>
            <div className="min-w-0">
              <h2 className="text-lg md:text-xl font-black leading-tight">{vehicle.name}</h2>
              <p className="text-sm font-semibold text-white/80">{assetIdentifier(vehicle)}</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {statusLabel && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/15 text-[11px] font-bold">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor }} />{statusLabel}
                  </span>
                )}
                {[typeLabel, vehicleLike ? (vehicle.regulation_category === 'position' ? 'ประจำตำแหน่ง' : 'ส่วนกลาง') : '',
                  deptText, FUEL_LABEL[vehicle.fuel_type] ?? ''].filter(Boolean).map(text => (
                  <span key={text} className="px-2 py-0.5 rounded-full bg-white/10 text-[11px] font-semibold text-white/90">{text}</span>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              { label: vehicleLike ? 'เลขไมล์ล่าสุด' : 'ค่ามิเตอร์ล่าสุด', value: meterNow != null ? `${fmt(Math.round(Number(meterNow)))} ${unit}` : '—' },
              { label: 'ยี่ห้อ / รุ่น', value: brandModel || '—' },
              { label: 'อายุใช้งาน', value: age || '—' },
              { label: 'ปีงบประมาณ', value: String(labelBE) },
            ].map(item => (
              <div key={item.label} className="rounded-xl bg-white/10 ring-1 ring-white/10 px-3 py-2 min-w-0">
                <p className="text-[10px] text-white/60">{item.label}</p>
                <p className="text-sm font-bold truncate" title={item.value}>{item.value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="md:overflow-y-auto flex-1 p-4 md:p-6 space-y-5 bg-slate-50">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-6 h-6 border-4 border-gray-200 rounded-full animate-spin"
                   style={{ borderTopColor: 'var(--color-primary)' }} />
            </div>
          ) : (
            <>
              {/* ── ความพร้อมใช้งาน ── */}
              {vehicleLike && (
                <section>
                  <SectionTitle icon={ShieldCheck}>ความพร้อมใช้งาน</SectionTitle>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {documents.map(item => (
                      <ReadyCard key={item.key} tone={item.state} label={item.label} sub={item.detail} text={documentText(item)} />
                    ))}
                    {emissionState ? (
                      <ReadyCard tone={EMISSION_TONE[emissionState.state]} label="ตรวจวัดมลพิษ"
                        sub="ทุก 6 เดือน หรือ 15,000 กม. แล้วแต่อย่างใดถึงก่อน"
                        text={emissionDueText(emissionState)} />
                    ) : vehicle.fuel_type === 'electric' || vehicle.status === 'retired' ? null : (
                      <ReadyCard tone="missing" label="ตรวจวัดมลพิษ" text="ยังไม่มีบันทึกการตรวจ" />
                    )}
                  </div>
                </section>
              )}

              {/* ── ตัวเลขหลักทั้งปีงบ ── */}
              <section className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                <KpiCard icon={Route} tone="#3b82f6" label="ระยะทาง" value={fmt(Math.round(totals.distance))} unit={unit}
                  sub={`${fmt(totals.trips)} เที่ยว`} />
                <KpiCard icon={Fuel} tone="#f59e0b" label="ค่าเชื้อเพลิง" value={fmtB(totals.fuelCost)}
                  sub={`${fmt(Math.round(totals.fuelLiters))} ลิตร · ${fmt(totals.fuelCount)} ครั้ง`} />
                <KpiCard icon={Wrench} tone="#ef4444" label="ค่าซ่อมบำรุง" value={fmtB(totals.maintCost)}
                  sub={`${fmt(totals.maintCount)} ครั้ง`} />
                <KpiCard icon={Gauge} tone="#10b981" label="อัตราสิ้นเปลือง"
                  value={efficiency != null ? efficiency.toFixed(1) : '—'} unit={efficiency != null ? 'กม./ล.' : ''}
                  sub={efficiency == null ? 'ต้องเติมเต็มถังติดกัน 2 ครั้ง'
                    : vsStandard ? `อัตราที่กำหนด ${vsStandard.standard} · ${vsStandard.pct}%` : 'ยังไม่ได้ตั้งอัตราที่กำหนด'}>
                  {vsStandard && (
                    <div className="mt-1.5 h-1.5 rounded-full bg-gray-100 overflow-hidden" title={`${vsStandard.pct}% ของอัตราที่กำหนด`}>
                      <div className="h-full rounded-full" style={{
                        width: `${Math.min(100, vsStandard.pct)}%`,
                        backgroundColor: vsStandard.meets ? '#10b981' : '#f59e0b',
                      }} />
                    </div>
                  )}
                </KpiCard>
              </section>

              {/* ── สัดส่วนค่าใช้จ่าย ── */}
              <section className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4">
                <div className="flex items-baseline justify-between gap-2 mb-2.5">
                  <p className="text-xs font-bold text-gray-600">ค่าใช้จ่ายรวมปีงบ {labelBE}</p>
                  <p className="text-lg font-black text-gray-800">{fmtB(split.total)}</p>
                </div>
                {split.total === 0 ? (
                  <p className="text-[11px] text-gray-400">ยังไม่มีค่าเชื้อเพลิงหรือค่าซ่อมในปีงบประมาณนี้</p>
                ) : <>
                <div className="h-3 rounded-full bg-gray-100 overflow-hidden flex">
                  <div className="h-full bg-amber-400" style={{ width: `${split.fuelPct}%` }} />
                  <div className="h-full bg-red-400" style={{ width: `${split.maintPct}%` }} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-amber-400" />
                    เชื้อเพลิง <b className="text-gray-700">{split.fuelPct}%</b> ({fmtB(totals.fuelCost)})</span>
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-red-400" />
                    ซ่อมบำรุง <b className="text-gray-700">{split.maintPct}%</b> ({fmtB(totals.maintCost)})</span>
                  {perKm != null && (
                    <span className="ml-auto" title="ราคาเฉลี่ยต่อลิตร ÷ อัตราสิ้นเปลืองจริง (ไม่ใช้ระยะทางจากใบเดินทาง)">
                      ค่าน้ำมันเฉลี่ย <b className="text-gray-700">฿{perKm.toFixed(2)}/กม.</b>
                    </span>
                  )}
                </div>
                </>}
              </section>

              {/* ── กราฟรายเดือน (ต.ค. → ก.ย.) ── */}
              <section className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4">
                <SectionTitle icon={CalendarClock} right={
                  <div className="flex rounded-lg bg-gray-100 p-0.5 text-[11px] font-bold">
                    {[['cost', 'ค่าใช้จ่าย'], ['distance', 'ระยะทาง']].map(([key, label]) => (
                      <button key={key} onClick={() => setMetric(key)}
                        className={`px-2.5 py-1 rounded-md ${metric === key ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                }>รายเดือน ปีงบประมาณ {labelBE}</SectionTitle>
                {totals.trips + totals.fuelCount + totals.maintCount === 0 ? (
                  <FleetEmptyState icon={CalendarClock} title="ยังไม่มีข้อมูลในปีงบประมาณนี้" compact />
                ) : (
                  <>
                    <div className="flex items-end gap-1 h-32 pt-2">
                      {series.map(m => {
                        const total = valueOf(m)
                        const height = total > 0 ? Math.max(4, (total / maxValue) * 100) : 0
                        const future = m.key > currentKey
                        const isPicked = picked?.key === m.key
                        const fuelShare = metric === 'cost' && total > 0 ? (m.fuelCost / total) * 100 : 100
                        return (
                          <button key={m.key} onClick={() => setPickedKey(m.key)}
                            aria-label={`${m.label}: ${metric === 'cost' ? fmtB(total) : `${fmt(Math.round(total))} ${unit}`}`}
                            className={`flex-1 h-full flex flex-col justify-end rounded-md ${isPicked ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-gray-50'}`}>
                            {total > 0 ? (
                              <div className="mx-auto w-3/5 min-w-[6px] rounded-t-md overflow-hidden flex flex-col-reverse" style={{ height: `${height}%` }}>
                                {metric === 'cost' ? <>
                                  <div className="bg-amber-400" style={{ height: `${fuelShare}%` }} />
                                  <div className="bg-red-400 flex-1" />
                                </> : <div className="bg-blue-400 h-full" />}
                              </div>
                            ) : (
                              <div className={`mx-auto w-3/5 h-0.5 rounded ${future ? 'bg-gray-100' : 'bg-gray-200'}`} />
                            )}
                          </button>
                        )
                      })}
                    </div>
                    <div className="flex gap-1 mt-1">
                      {series.map(m => (
                        <span key={m.key} className={`flex-1 text-center text-[9px] md:text-[10px] ${m.key > currentKey ? 'text-gray-300' : 'text-gray-500'} ${picked?.key === m.key ? 'font-bold text-blue-600' : ''}`}>
                          {m.short}
                        </span>
                      ))}
                    </div>
                    {picked && (
                      <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
                        <span className="text-xs font-bold text-gray-700">{picked.label}</span>
                        <span>{fmt(picked.trips)} เที่ยว · {fmt(Math.round(picked.distance))} {unit}</span>
                        <span>เติม {fmt(Math.round(picked.fuelLiters))} ล. ({fmtB(picked.fuelCost)})</span>
                        <span className={picked.maintCost > 0 ? 'text-red-500' : ''}>ซ่อม {fmtB(picked.maintCost)}</span>
                      </div>
                    )}
                  </>
                )}
              </section>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* ── ข้อมูลทะเบียน + ความครบ ── */}
                <section className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4">
                  <SectionTitle icon={ClipboardList} right={isAdmin && onEdit && (
                    <button onClick={onEdit}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold border border-blue-200 text-blue-700 hover:bg-blue-50">
                      <Pencil size={11} /> แก้ไขข้อมูลรถ
                    </button>
                  )}>ข้อมูลทะเบียน</SectionTitle>
                  <div className="mb-3">
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-gray-500">ข้อมูลครบ</span>
                      <span className="font-bold text-gray-700">{completeness.filled}/{completeness.total}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full rounded-full" style={{
                        width: `${(completeness.filled / Math.max(1, completeness.total)) * 100}%`,
                        backgroundColor: completeness.missing.length ? '#f59e0b' : '#10b981',
                      }} />
                    </div>
                    {completeness.missing.length > 0 && (
                      <p className="text-[10px] text-amber-700 mt-1">ยังขาด: {completeness.missing.join(' · ')}</p>
                    )}
                  </div>
                  <dl>
                    {vehicleLike && <InfoRow label="ประเภทตามระเบียบ" value={REGULATION_LABEL[vehicle.regulation_category] ?? REGULATION_LABEL.central} />}
                    <InfoRow label="ยี่ห้อ / รุ่น" value={brandModel} />
                    {vehicleLike && <InfoRow label="รุ่นปี" value={vehicle.manufacture_year} />}
                    {vehicleLike && vehicle.fuel_type !== 'electric' && <InfoRow label="ขนาดเครื่องยนต์" value={vehicle.engine_cc ? `${fmt(vehicle.engine_cc)} ซีซี` : ''} />}
                    <InfoRow label="ราคา" value={vehicle.purchase_price != null && vehicle.purchase_price !== ''
                      ? `฿${Number(vehicle.purchase_price).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''} />
                    <InfoRow label="วันที่ได้มา" value={vehicle.acquired_date ? thDateLong(vehicle.acquired_date) : ''} />
                    {vehicle.disposed_date && <InfoRow label="วันที่จำหน่าย" value={thDateLong(vehicle.disposed_date)} />}
                    <InfoRow label="กอง / การใช้" value={deptText} />
                    {vehicle.fuel_type !== 'electric' && <InfoRow label="ความจุถัง" value={vehicle.tank_capacity ? `${fmt(vehicle.tank_capacity)} ลิตร` : ''} />}
                    {vehicleLike && vehicle.fuel_type !== 'electric' && <InfoRow label="อัตราที่กำหนด" value={vehicle.fuel_rate_standard_kml ? `${vehicle.fuel_rate_standard_kml} กม./ล.` : ''} />}
                  </dl>
                </section>

                {/* ── รายการล่าสุด ── */}
                <section className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4">
                  <SectionTitle icon={History}>รายการล่าสุด</SectionTitle>
                  {recent.length === 0 ? (
                    <p className="text-[11px] text-gray-400 py-4 text-center">ยังไม่มีการเติมเชื้อเพลิงหรือซ่อมบำรุง</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {recent.map(item => {
                        const fuel = item.kind === 'fuel'
                        const maint = fuel ? null : maintenanceTitle(item.row, MAINTENANCE_TYPE_LABEL)
                        const title = fuel
                          ? `เติมเชื้อเพลิง ${item.liters != null ? `${fmt(Math.round(item.liters * 100) / 100)} ล.` : ''}`
                          : maint.title
                        return (
                          <li key={`${item.kind}-${item.row.id}`} className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2">
                            <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${fuel ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-500'}`}>
                              {fuel ? <Fuel size={13} /> : <Wrench size={13} />}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-gray-700 truncate">{title}</p>
                              <p className="text-[10px] text-gray-400 truncate">
                                {thDate(item.date)}{maint?.detail ? ` · ${maint.detail}` : ''}
                              </p>
                            </div>
                            <span className="text-xs font-bold text-gray-700 shrink-0">{item.amount != null ? fmtB(item.amount) : '—'}</span>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </section>
              </div>

              {isAdmin && vehicleLike && (
                <section>
                  <SectionTitle icon={AlertTriangle} right={
                    <button onClick={() => setIncidentModal({ id: null })}
                      className="px-2 py-1 rounded-lg text-[11px] font-bold border border-red-200 bg-red-50 text-red-600 hover:bg-red-100">
                      + รายงานเหตุ
                    </button>
                  }>รายงานเหตุสูญหาย/เสียหาย (แบบ 5)</SectionTitle>
                  {incidents.length === 0 ? (
                    <p className="text-[11px] text-gray-400">ยังไม่มีรายงาน · เหตุระหว่างใช้รถรายงานจากรายละเอียดการใช้รถได้เลย ระบบเติมวันที่/ปลายทางให้</p>
                  ) : (
                    <div className="space-y-1.5">
                      {incidents.map(item => (
                        <button key={item.id} onClick={() => setIncidentModal({ id: item.id })}
                          className="w-full text-left flex items-center justify-between gap-2 bg-white border border-red-100 hover:bg-red-50 rounded-xl px-3 py-2.5">
                          <span className="text-xs font-bold text-gray-700 shrink-0">{form5DateText(item.incident_date || item.report_date) || '—'}</span>
                          <span className="flex-1 min-w-0 truncate text-[11px] text-gray-500">{item.location || '—'}</span>
                          <span className="text-[10px] font-bold text-red-600 shrink-0">{INCIDENT_KIND_LABEL[item.incident_kind] ?? ''}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </div>
      {incidentModal && (
        <FleetIncidentModal
          tenant={tenant}
          vehicle={vehicle}
          incidentId={incidentModal.id}
          onClose={() => setIncidentModal(null)}
          onSaved={loadIncidents}
        />
      )}
    </div>
  )
}
