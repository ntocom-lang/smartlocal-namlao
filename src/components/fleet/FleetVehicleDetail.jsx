import { useState, useEffect, useMemo } from 'react'
import { X, Route, Fuel, Wrench, Gauge, CalendarClock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { assetIdentifier, isVehicleAsset } from '../../lib/fleetAssets'
import { fetchAllRows } from '../../lib/fetchAllRows'
import FleetEmptyState from './FleetEmptyState'

const fmt  = n => (n ?? 0).toLocaleString('th-TH')
const fmtB = n => `฿${fmt(Math.round(n ?? 0))}`

// เดือนภาษาไทยแบบย่อ เรียงตามปีงบประมาณ (เริ่ม ต.ค.) ให้ตรงกับที่ อปท. คุ้นเคย ไม่ใช่ปีปฏิทิน ม.ค.–ธ.ค.
const MONTH_TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']

// ปีงบประมาณไทยปัจจุบัน: เริ่ม 1 ต.ค. ของปี (calendar year นี้ ถ้าเดือนปัจจุบัน >= ต.ค., ไม่งั้นปีก่อนหน้า) ถึง 30 ก.ย. ปีถัดไป
function fiscalYearRange(now = new Date()) {
  const y = now.getFullYear()
  const startYear = now.getMonth() >= 9 ? y : y - 1
  const from = new Date(startYear, 9, 1)
  const to   = new Date(startYear + 1, 8, 30, 23, 59, 59)
  return { from, to, labelBE: startYear + 1 + 543 }
}

function monthKey(dateStr) {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function isoDate(d) { return d.toISOString().slice(0, 10) }

export default function FleetVehicleDetail({ vehicle, tenant, onClose }) {
  const [loading, setLoading] = useState(true)
  const [months,  setMonths]  = useState([]) // [{ key, label, trips, distance, fuelLiters, fuelCost, maintCost }]
  const [totals,  setTotals]  = useState({ trips: 0, distance: 0, fuelLiters: 0, fuelCost: 0, maintCost: 0 })
  // อัตราสิ้นเปลืองคิดแบบ full-to-full จาก efficiency_kml ที่ trigger ฝั่ง DB คำนวณให้ต่อการเติมแต่ละครั้ง
  // ไม่ใช่ (ระยะทางจากใบเดินทาง ÷ ลิตรทั้งหมด) แบบเดิม เพราะสองตัวนี้ไม่ได้ครอบคลุมช่วงเดียวกัน:
  // การใช้รถบางเที่ยวไม่ได้ลงใบเดินทาง แต่ค่าน้ำมันลงครบทุกใบเสร็จ ตัวหารจึงใหญ่เกินจริงเสมอ
  // (เคยได้ 0.6 กม./ล. สำหรับรถกระบะ ขณะที่หน้าภาพรวมแสดง 7.1 กม./ล. ของคันเดียวกัน)
  const [efficiency, setEfficiency] = useState(null)
  // useMemo กันสร้าง Date object ใหม่ทุก render (ค่าคงที่ตราบใดที่ยังไม่ปิด modal) ไม่งั้น effect ด้านล่างจะวนซ้ำ
  const { from, to, labelBE } = useMemo(() => fiscalYearRange(), [])

  useEffect(() => {
    if (!tenant?.id || !vehicle?.id) return
    // setState เรียกผ่าน queueMicrotask กันเข้าเงื่อนไข effect เรียก setState ตรงๆ ในตัว effect
    queueMicrotask(() => {
      setLoading(true)
      const fromStr = isoDate(from), toStr = isoDate(to)
      // ทั้ง 3 ชุดถูกนำไปรวมเป็นสถิติรายเดือน (ระยะทาง/ลิตร/ค่าน้ำมัน/ค่าซ่อม) ฝั่ง client
      // จึงต้องได้แถวครบ ไม่ถูก PostgREST ตัดตาม db-max-rows — .order('id') บังคับลำดับ
      // ให้ชี้ขาด ไม่งั้นการไล่หน้าจะได้แถวซ้ำหรือตกหล่น
      Promise.all([
        // นับเฉพาะ 'completed' — คำขอที่ยังไม่อนุมัติ ที่ถูกปฏิเสธ และที่ยกเลิกไปแล้ว ไม่ใช่ "เที่ยว"
        // ที่ใช้รถจริง ถ้านับรวมด้วย สมุดประจำรถจะรายงานจำนวนเที่ยวเกินความจริง (รายงานส่งออก
        // ที่ FleetReport กรอง completed อยู่แล้ว ตัวเลขสองที่จึงเคยไม่ตรงกัน)
        fetchAllRows(() => supabase.from('fleet_trips').select('trip_date, distance_km')
          .eq('municipality_id', tenant.id).eq('vehicle_id', vehicle.id).eq('status', 'completed')
          .gte('trip_date', fromStr).lte('trip_date', toStr).order('id')),
        fetchAllRows(() => supabase.from('fleet_fuel_records').select('filled_at, liters, total_cost, efficiency_kml')
          .eq('municipality_id', tenant.id).eq('vehicle_id', vehicle.id)
          .gte('filled_at', fromStr).lte('filled_at', toStr).order('id')),
        fetchAllRows(() => supabase.from('fleet_maintenance').select('service_date, cost')
          .eq('municipality_id', tenant.id).eq('vehicle_id', vehicle.id)
          .gte('service_date', fromStr).lte('service_date', toStr).order('id')),
      ]).then((results) => {
        const failed = results.filter(r => r && r.error)
        if (failed.length) console.error('FleetVehicleDetail query error:', failed.map(r => r.error.message))
        const [{ data: trips }, { data: fuel }, { data: maint }] = results
        const byMonth = {}
        const ensure = key => byMonth[key] ??= { trips: 0, distance: 0, fuelLiters: 0, fuelCost: 0, maintCost: 0 }

        ;(trips ?? []).forEach(t => {
          const m = ensure(monthKey(t.trip_date))
          m.trips += 1
          m.distance += t.distance_km ?? 0
        })
        ;(fuel ?? []).forEach(f => {
          const m = ensure(monthKey(f.filled_at))
          m.fuelLiters += f.liters ?? 0
          m.fuelCost += f.total_cost ?? 0
        })
        ;(maint ?? []).forEach(x => {
          const m = ensure(monthKey(x.service_date))
          m.maintCost += x.cost ?? 0
        })

        // เรียงตามปีงบประมาณ (ต.ค.→ก.ย.) ไม่ใช่ ม.ค.→ธ.ค. และข้ามเดือนที่ไม่มีข้อมูลเลย
        const ordered = []
        for (let i = 0; i < 12; i++) {
          const d = new Date(from.getFullYear(), from.getMonth() + i, 1)
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
          if (!byMonth[key]) continue
          ordered.push({ key, label: `${MONTH_TH[d.getMonth()]} ${d.getFullYear() + 543}`, ...byMonth[key] })
        }
        ordered.reverse() // ล่าสุดขึ้นก่อน

        setMonths(ordered)
        setTotals(ordered.reduce((acc, m) => ({
          trips: acc.trips + m.trips,
          distance: acc.distance + m.distance,
          fuelLiters: acc.fuelLiters + m.fuelLiters,
          fuelCost: acc.fuelCost + m.fuelCost,
          maintCost: acc.maintCost + m.maintCost,
        }), { trips: 0, distance: 0, fuelLiters: 0, fuelCost: 0, maintCost: 0 }))

        const effVals = (fuel ?? []).map(f => f.efficiency_kml).filter(x => x != null).map(Number)
        setEfficiency(isVehicleAsset(vehicle) && effVals.length
          ? (effVals.reduce((s, x) => s + x, 0) / effVals.length).toFixed(1)
          : null)
      }).finally(() => setLoading(false))
    })
    // vehicle ทั้งก้อนไม่ต้องอยู่ใน dependency — modal นี้ผูกกับรถคันเดียวตลอดอายุ (id เปลี่ยน = เปิดใหม่)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id, vehicle?.id, from, to])


  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-t-3xl md:rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl">
        <div className="shrink-0 px-5 py-4 border-b border-gray-100 flex items-start justify-between">
          <div>
            <h2 className="text-base font-black text-gray-800">{vehicle.name}</h2>
            <p className="text-xs text-gray-400">{assetIdentifier(vehicle)} · ปีงบประมาณ {labelBE}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16} /></button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4 flex-1">
          {loading ? (
            <div className="flex justify-center py-10">
              <div className="w-5 h-5 border-4 border-gray-200 rounded-full animate-spin"
                   style={{ borderTopColor: 'var(--color-primary)' }} />
            </div>
          ) : (
            <>
              {/* สรุปสะสมทั้งปีงบประมาณ */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                  <div className="flex items-center gap-1.5 text-blue-500 mb-1"><Route size={13} /><span className="text-[11px] font-bold">ระยะทางสะสม</span></div>
                  <p className="text-xl font-black text-gray-800">{fmt(Math.round(totals.distance))} <span className="text-xs font-semibold text-gray-400">กม.</span></p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{fmt(totals.trips)} เที่ยว</p>
                </div>
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
                  <div className="flex items-center gap-1.5 text-amber-500 mb-1"><Fuel size={13} /><span className="text-[11px] font-bold">เชื้อเพลิงสะสม</span></div>
                  <p className="text-xl font-black text-gray-800">{fmtB(totals.fuelCost)}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{fmt(totals.fuelLiters.toFixed(0))} ลิตร</p>
                </div>
                <div className="bg-red-50 border border-red-100 rounded-xl p-3">
                  <div className="flex items-center gap-1.5 text-red-500 mb-1"><Wrench size={13} /><span className="text-[11px] font-bold">ซ่อมบำรุงสะสม</span></div>
                  <p className="text-xl font-black text-gray-800">{fmtB(totals.maintCost)}</p>
                </div>
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                  <div className="flex items-center gap-1.5 text-emerald-500 mb-1"><Gauge size={13} /><span className="text-[11px] font-bold">อัตราสิ้นเปลืองเฉลี่ย</span></div>
                  <p className="text-xl font-black text-gray-800">{efficiency ? `${efficiency}` : '—'} <span className="text-xs font-semibold text-gray-400">{efficiency ? 'กม./ล.' : ''}</span></p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {efficiency ? 'เฉลี่ยจากการเติมเต็มถัง' : 'ต้องเติมเต็มถังติดกันอย่างน้อย 2 ครั้ง'}
                  </p>
                </div>
              </div>

              {/* รายเดือน */}
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">สถิติรายเดือน</p>
                {months.length === 0 ? (
                  <FleetEmptyState icon={CalendarClock} title="ยังไม่มีข้อมูลในปีงบประมาณนี้" compact />
                ) : (
                  <div className="space-y-1.5">
                    {months.map(m => (
                      <div key={m.key} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2.5">
                        <span className="text-xs font-bold text-gray-700 w-20 shrink-0">{m.label}</span>
                        <div className="flex-1 flex flex-wrap justify-end gap-x-3 gap-y-0.5 text-[11px] text-gray-500">
                          {m.trips > 0 && <span>{m.trips} เที่ยว · {fmt(Math.round(m.distance))} กม.</span>}
                          {m.fuelLiters > 0 && <span>เติม {fmt(m.fuelLiters.toFixed(0))} ล. ({fmtB(m.fuelCost)})</span>}
                          {m.maintCost > 0 && <span className="text-red-400">ซ่อม {fmtB(m.maintCost)}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
