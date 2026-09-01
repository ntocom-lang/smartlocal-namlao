import { useState, useEffect } from 'react'
import { FileX2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { assetIdentifier, assetOptionLabel, FUEL_LABEL, meterUnitShort } from '../../lib/fleetAssets'
import { fetchAllRows } from '../../lib/fetchAllRows'
import { buildFleetForm4Html } from '../../lib/fleetForm4Print'
import {
  PERIOD_MODES, QUARTERS, MONTH_OPTIONS,
  currentPeriodDefaults, yearOptionsBE, fiscalYearOptionsBE, fleetPeriodRange,
} from '../../lib/fleetReportPeriod'
import FleetEmptyState from './FleetEmptyState'

const PERIOD_DEFAULTS = currentPeriodDefaults()
const PERIOD_YEARS = yearOptionsBE()
const FISCAL_YEARS = fiscalYearOptionsBE()
const INITIAL_PERIOD = fleetPeriodRange(PERIOD_DEFAULTS)

const fmt  = n => (n ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })
const fmtB = n => `฿${Math.round(n ?? 0).toLocaleString('th-TH')}`
const thDate = d => d ? new Date(d).toLocaleDateString('th-TH', { dateStyle: 'short' }) : '—'
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char])

function nextDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

const MAINT_TH = {
  routine: 'บำรุงรักษา', oil_change: 'เปลี่ยนถ่ายน้ำมัน', repair: 'ซ่อมแซม',
  inspection: 'ตรวจสภาพ', tire: 'ยาง', battery: 'แบตเตอรี่', other: 'อื่นๆ',
}

function downloadCSV(rows, filename) {
  const csv = '﻿' + rows.map(r =>
    r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')
  ).join('\n')
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })),
    download: filename,
  })
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
}

function ReportSection({ title, empty, children, mobile }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-gray-600 uppercase tracking-wide">{title}</p>
      {empty ? (
        <div className="bg-white rounded-2xl border border-gray-100">
          <FleetEmptyState icon={FileX2} title="ไม่มีข้อมูลในช่วงนี้" compact />
        </div>
      ) : <>
        <div className="md:hidden">{mobile}</div>
        <div className="hidden md:block overflow-x-auto rounded-xl border border-gray-300 shadow-sm">{children}</div>
      </>}
    </div>
  )
}

function THdr({ cols }) {
  return (
    <thead>
      <tr style={{ backgroundColor: '#1a3a5c' }}>
        {cols.map(h => (
          <th key={h} className="px-3 py-2.5 text-left text-xs font-bold text-white border-r border-white/10 last:border-r-0 whitespace-nowrap">
            {h}
          </th>
        ))}
      </tr>
    </thead>
  )
}

export default function FleetReport({ tenant }) {
  const [vehicles,   setVehicles]   = useState([])
  const [selVehicle, setSelVehicle] = useState('')
  const [periodMode, setPeriodMode] = useState(PERIOD_DEFAULTS.mode)
  const [periodMonth, setPeriodMonth] = useState(PERIOD_DEFAULTS.month)
  const [periodQuarter, setPeriodQuarter] = useState(PERIOD_DEFAULTS.quarter)
  const [periodYearBE, setPeriodYearBE] = useState(PERIOD_DEFAULTS.yearBE)
  const [periodFiscalYearBE, setPeriodFiscalYearBE] = useState(PERIOD_DEFAULTS.fiscalYearBE)
  const [dateFrom,   setDateFrom]   = useState(INITIAL_PERIOD.from)
  const [dateTo,     setDateTo]     = useState(INITIAL_PERIOD.to)
  const [data,       setData]       = useState(null)
  const [loading,    setLoading]    = useState(false)
  const [printingForm4, setPrintingForm4] = useState(false)

  const period = fleetPeriodRange({
    mode: periodMode, yearBE: periodYearBE, fiscalYearBE: periodFiscalYearBE,
    month: periodMonth, quarter: periodQuarter, dateFrom, dateTo,
  })
  const periodLabel = period.label
  const rangeFrom = period.from
  const rangeTo = period.to

  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('fleet_vehicles').select('id,name,license_plate,asset_code,asset_kind,meter_unit')
      .eq('municipality_id', tenant.id).order('name')
      .then(({ data: v }) => setVehicles(v ?? []))
  }, [tenant?.id])

  async function loadReport() {
    setLoading(true)
    try {
      const vq = q => selVehicle ? q.eq('vehicle_id', selVehicle) : q
      const endDay = nextDay(rangeTo) // ใช้ .lt(nextDay) แทน .lte(T23:59:59) เพื่อหลีกเลี่ยง format tz

      // ดึงผ่าน fetchAllRows เพราะยอดรวมค่าน้ำมัน/ค่าซ่อมด้านล่างคำนวณฝั่ง client จากแถวที่ได้มา
      // ถ้า PostgREST ตัดแถวตาม db-max-rows ยอดในรายงานจะต่ำกว่าจริงโดยไม่มีสัญญาณเตือน
      // ซึ่งเป็นตัวเลขที่ใช้เสนอผู้บริหารและใช้ตรวจสอบ — ยอมจ่ายรอบ request เพิ่มเพื่อความครบถ้วน
      const [tripResult, fuelResult, maintResult] = await Promise.all([
        fetchAllRows(() => vq(supabase.from('fleet_trips')
          .select('*, vehicle:fleet_vehicles(id,name,license_plate,asset_code,asset_kind,meter_unit), driver:profiles!fleet_trips_driver_id_fkey(id,full_name)')
          .eq('municipality_id', tenant.id).eq('status', 'completed')
          .gte('trip_date', rangeFrom).lt('trip_date', endDay)).order('trip_date').order('id')),
        fetchAllRows(() => vq(supabase.from('fleet_fuel_records')
          .select('*, fleet_vehicles(name, license_plate, asset_code, asset_kind, meter_unit)')
          .eq('municipality_id', tenant.id)
          .gte('filled_at', rangeFrom).lte('filled_at', rangeTo)).order('filled_at').order('id')),
        fetchAllRows(() => vq(supabase.from('fleet_maintenance')
          .select('*, fleet_vehicles(name, license_plate, asset_code, asset_kind, meter_unit)')
          .eq('municipality_id', tenant.id)
          .gte('service_date', rangeFrom).lte('service_date', rangeTo)).order('service_date').order('id')),
      ])
      const loadError = tripResult.error || fuelResult.error || maintResult.error
      if (loadError) {
        setData(null)
        alert('โหลดรายงานไม่สำเร็จ: ' + loadError.message)
        return
      }
      const { data: trips } = tripResult
      const { data: fuel } = fuelResult
      const { data: maint } = maintResult
      setData({ trips: trips ?? [], fuel: fuel ?? [], maint: maint ?? [] })
      // ชนเพดานกันลูป = ข้อมูลไม่ครบจริง ต้องบอก ห้ามปล่อยให้เข้าใจว่ายอดถูกต้อง
      if (tripResult.truncated || fuelResult.truncated || maintResult.truncated) {
        alert('ข้อมูลในช่วงที่เลือกมีจำนวนมากเกินกว่าที่ระบบดึงได้ในครั้งเดียว — ยอดรวมในรายงานนี้ยังไม่ครบ กรุณาแบ่งช่วงวันที่ให้สั้นลง')
      }
    } catch (err) {
      // fetchAllRows คืน { error } เมื่อ PostgREST ตอบ error แต่ "reject" เมื่อ fetch เองล้ม
      // (เน็ตหลุด / timeout 25 วิ) เส้นทางหลังนี้เดิมไม่มีใครดัก รายงานจึงค้างสปินเนอร์ถาวร
      // และเพราะเป็นตัวเลขงบประมาณ ต้องบอกให้ชัดว่าโหลดไม่สำเร็จ ห้ามโชว์ยอดเก่าค้างไว้เฉยๆ
      console.error('[fleet-report] โหลดรายงานไม่สำเร็จ:', err?.message ?? err)
      setData(null)
      alert('โหลดรายงานไม่สำเร็จ — เซิร์ฟเวอร์ตอบช้าหรือสัญญาณขาดช่วง กรุณาลองใหม่')
    } finally {
      setLoading(false)
    }
  }

  /* ── Summaries ── */
  const totalKm       = data?.trips.reduce((s, t) => s + (t.odometer_end && t.odometer_start ? t.odometer_end - t.odometer_start : 0), 0) ?? 0
  const totalLiters   = data?.fuel.reduce((s, f) => s + (f.liters ?? 0), 0) ?? 0
  const totalFuelCost = data?.fuel.reduce((s, f) => s + (f.total_cost ?? ((f.liters ?? 0) * (f.price_per_liter ?? 0))), 0) ?? 0
  const totalMaintCost = data?.maint.reduce((s, m) => s + (m.cost ?? 0), 0) ?? 0

  const selVehicleName = selVehicle ? (vehicles.find(v => v.id === selVehicle)?.name ?? '') : 'ทุกทรัพย์สิน'
  // เดิมหัวรายงานพิมพ์ช่วงวันที่เป็น ค.ศ. (2026-08-01) ทั้งที่ทุกแถวในตารางเป็น พ.ศ. (20/8/69)
  // เอกสารฉบับเดียวกันมีสองศักราชปนกัน ผู้ตรวจสอบอ่านแล้วสรุปได้ว่ารายการอยู่นอกช่วงที่ระบุ
  const reportTitle = `รายงานรถ เครื่องยนต์ และเชื้อเพลิง — ${selVehicleName} | ${periodLabel}`

  function openPrintWindow(html, { width = 900, height = 760 } = {}) {
    const win = window.open('', '_blank', `width=${width},height=${height}`)
    if (!win) {
      alert('เบราว์เซอร์ปิดกั้นหน้าต่างพิมพ์ กรุณาอนุญาต pop-up แล้วลองใหม่')
      return null
    }
    win.document.open()
    win.document.write(html)
    win.document.close()
    const printWhenReady = async () => {
      try {
        if (win.document.fonts?.ready) {
          await Promise.race([
            win.document.fonts.ready,
            new Promise(resolve => setTimeout(resolve, 1200)),
          ])
        }
      } catch { /* โหลดฟอนต์ไม่ทันก็พิมพ์ด้วยฟอนต์บนเครื่อง */ }
      win.focus()
      win.print()
    }
    setTimeout(printWhenReady, 200)
    return win
  }

  // แบบ 4 = บันทึกการใช้รถรายคันตามกระดาษ ดึงทริปเสร็จสิ้นของคันที่เลือกเอง
  // ไม่ใช้ชุด data ของรายงานผู้บริหาร เพราะชุดนั้นอาจรวมทุกคัน และไม่มีชื่อผู้ขอใช้รถ
  async function printForm4() {
    if (!tenant?.id) return alert('ไม่พบหน่วยงาน')
    if (!selVehicle) {
      return alert('แบบ 4 เป็นบันทึกการใช้รถรายคัน กรุณาเลือกยานพาหนะก่อนพิมพ์')
    }
    const vehicle = vehicles.find(v => v.id === selVehicle)
    if (!vehicle) return alert('ไม่พบยานพาหนะที่เลือก')
    setPrintingForm4(true)
    try {
      const endDay = nextDay(rangeTo)
      const tripResult = await fetchAllRows(() => supabase.from('fleet_trips')
        .select('id,trip_date,depart_time,return_time,started_at,returned_at,odometer_start,odometer_end,distance_km,destination,notes,backdated_reason,driver:profiles!fleet_trips_driver_id_fkey(id,full_name),requester:profiles!fleet_trips_requested_by_fkey(id,full_name),creator:profiles!fleet_trips_created_by_fkey(id,full_name)')
        .eq('municipality_id', tenant.id)
        .eq('vehicle_id', selVehicle)
        .eq('status', 'completed')
        .gte('trip_date', rangeFrom)
        .lt('trip_date', endDay)
        .order('trip_date')
        .order('id'))
      if (tripResult.error) {
        alert('โหลดบันทึกการใช้รถไม่สำเร็จ: ' + tripResult.error.message)
        return
      }
      if (tripResult.truncated) {
        alert('รายการใช้รถในช่วงนี้มีจำนวนมากเกินกว่าที่ระบบดึงได้ในครั้งเดียว — เอกสารที่พิมพ์ยังไม่ครบ กรุณาแบ่งช่วงวันที่ให้สั้นลง')
      }
      openPrintWindow(buildFleetForm4Html({
        vehicle, trips: tripResult.data ?? [], periodLabel,
      }), {
        width: 1123, height: 794,
      })
    } catch (err) {
      console.error('[fleet-form4] พิมพ์แบบ 4 ไม่สำเร็จ:', err?.message ?? err)
      alert('พิมพ์แบบ 4 ไม่สำเร็จ — เซิร์ฟเวอร์ตอบช้าหรือสัญญาณขาดช่วง กรุณาลองใหม่')
    } finally {
      setPrintingForm4(false)
    }
  }

  /* ── PDF ── */
  function exportPDF() {
    const trRows = (data?.trips ?? []).map((t, i) => {
      const km = t.odometer_end && t.odometer_start ? t.odometer_end - t.odometer_start : ''
      return `<tr style="background:${i%2?'#f5f8fc':'#fff'}">
        <td>${i+1}</td><td>${thDate(t.trip_date)}</td>
        <td>${escapeHtml(t.vehicle?.name)} ${escapeHtml(assetIdentifier(t.vehicle))}</td>
        <td>${escapeHtml(t.destination)}</td><td>${escapeHtml(t.purpose)}</td>
        <td>${escapeHtml(t.driver?.full_name)}</td>
        <td align="right">${km ? km.toLocaleString()+'&nbsp;กม.' : '—'}</td></tr>`
    }).join('')
    const fuelRows = (data?.fuel ?? []).map((f, i) => {
      const cost = f.total_cost ?? (f.liters??0)*(f.price_per_liter??0)
      return `<tr style="background:${i%2?'#f5f8fc':'#fff'}">
        <td>${i+1}</td><td>${thDate(f.filled_at)}</td>
        <td>${escapeHtml(f.fleet_vehicles?.name)} ${escapeHtml(assetIdentifier(f.fleet_vehicles))}</td>
        <td align="right">${fmt(f.liters)}</td>
        <td align="right">${fmt(f.price_per_liter)}</td>
        <td align="right">${fmtB(cost)}</td>
        <td>${escapeHtml(f.fuel_station ?? '—')}</td>
        <td>${f.is_anomaly ? '⚠ ' + escapeHtml(f.anomaly_reason || 'ผิดปกติ') : '—'}</td></tr>`
    }).join('')
    const maintRows = (data?.maint ?? []).map((m, i) =>
      `<tr style="background:${i%2?'#f5f8fc':'#fff'}">
        <td>${i+1}</td><td>${thDate(m.service_date)}</td>
        <td>${escapeHtml(m.fleet_vehicles?.name)} ${escapeHtml(assetIdentifier(m.fleet_vehicles))}</td>
        <td>${escapeHtml(MAINT_TH[m.maintenance_type]??m.maintenance_type)}</td>
        <td>${escapeHtml(m.description)}</td>
        <td align="right">${fmtB(m.cost)}</td>
        <td>${escapeHtml(m.vendor ?? '—')}</td></tr>`
    ).join('')

    const win = window.open('', '_blank')
    win.document.write(`<!DOCTYPE html><html><head>
      <meta charset="UTF-8"><title>${reportTitle}</title>
      <style>
        body{font-family:Sarabun,Arial,sans-serif;font-size:11px;color:#222;padding:20px;margin:0}
        h1{font-size:15px;color:#1a3a5c;border-bottom:2px solid #1a3a5c;padding-bottom:6px;margin:0 0 12px}
        h2{font-size:12px;color:#1a3a5c;margin:20px 0 6px;border-left:3px solid #1a3a5c;padding-left:8px}
        .summary{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}
        .card{border:1px solid #ddd;padding:8px 12px;border-radius:6px;flex:1;min-width:100px;text-align:center}
        .card .val{font-size:16px;font-weight:bold;color:#1a3a5c}
        .card .lbl{font-size:9px;color:#888;margin-top:2px}
        table{width:100%;border-collapse:collapse;margin-bottom:6px}
        th{background:#1a3a5c;color:#fff;padding:5px 7px;text-align:left;font-size:10px}
        td{padding:4px 7px;border-bottom:1px solid #eee;font-size:10px}
        .total td{background:#eef2f7;font-weight:bold}
        @media print{body{padding:6px}}
      </style>
    </head><body>
      <h1>${reportTitle}</h1>
      <div class="summary">
        <div class="card"><div class="val">${data?.trips.length??0}</div><div class="lbl">การใช้รถ (ครั้ง)</div></div>
        <div class="card"><div class="val">${totalKm.toLocaleString()}</div><div class="lbl">ระยะทาง (กม.)</div></div>
        <div class="card"><div class="val">${fmt(totalLiters)}</div><div class="lbl">น้ำมัน (ลิตร)</div></div>
        <div class="card"><div class="val">${fmtB(totalFuelCost)}</div><div class="lbl">ค่าน้ำมัน</div></div>
        <div class="card"><div class="val">${fmtB(totalMaintCost)}</div><div class="lbl">ค่าซ่อมบำรุง</div></div>
      </div>
      <h2>การใช้รถ (${data?.trips.length??0} รายการ)</h2>
      <table><tr><th>ที่</th><th>วันที่</th><th>ยานพาหนะ</th><th>ปลายทาง</th><th>วัตถุประสงค์</th><th>ผู้ใช้รถ</th><th>ระยะทาง</th></tr>
        ${trRows}
        <tr class="total"><td colspan="6" align="right">รวมระยะทาง</td><td align="right">${totalKm.toLocaleString()} กม.</td></tr>
      </table>
      <h2>บันทึกน้ำมัน (${data?.fuel.length??0} รายการ)</h2>
      <table><tr><th>ที่</th><th>วันที่</th><th>ยานพาหนะ</th><th>ลิตร</th><th>ราคา/ล.</th><th>รวม</th><th>ปั๊ม</th><th>ตรวจสอบ</th></tr>
        ${fuelRows}
        <tr class="total"><td colspan="3" align="right">รวม</td><td align="right">${fmt(totalLiters)} ล.</td><td></td><td align="right">${fmtB(totalFuelCost)}</td><td></td><td></td></tr>
      </table>
      <h2>ซ่อมบำรุง (${data?.maint.length??0} รายการ)</h2>
      <table><tr><th>ที่</th><th>วันที่</th><th>ยานพาหนะ</th><th>ประเภท</th><th>รายละเอียด</th><th>ค่าใช้จ่าย</th><th>อู่/ผู้รับจ้าง</th></tr>
        ${maintRows}
        <tr class="total"><td colspan="5" align="right">รวม</td><td align="right">${fmtB(totalMaintCost)}</td><td></td></tr>
      </table>
    </body></html>`)
    win.document.close()
    setTimeout(() => { win.focus(); win.print() }, 600)
  }

  /* ── CSV exports ── */
  function exportTripCSV() {
    downloadCSV([
      ['ที่','วันที่','ยานพาหนะ','ทะเบียน/รหัส','ปลายทาง','วัตถุประสงค์','ผู้ใช้รถ','เลขไมล์ก่อน','เลขไมล์หลัง','ระยะทาง (กม.)'],
      ...(data?.trips ?? []).map((t, i) => {
        const km = t.odometer_end && t.odometer_start ? t.odometer_end - t.odometer_start : ''
        return [i+1, thDate(t.trip_date), t.vehicle?.name??'', assetIdentifier(t.vehicle),
          t.destination, t.purpose, t.driver?.full_name??'',
          t.odometer_start??'', t.odometer_end??'', km]
      }),
    ], `การใช้รถ_${rangeFrom}_${rangeTo}.csv`)
  }

  function exportFuelCSV() {
    downloadCSV([
      ['ที่','วันที่','ทรัพย์สิน','ทะเบียน/รหัส','ชนิดเชื้อเพลิง','ลิตร','ราคา/ลิตร','รวม (บาท)','ค่ามิเตอร์','หน่วย','ปั๊ม','ใบเสร็จ','กม./ล.','ผิดปกติ','เหตุผลที่ตั้งธง'],
      ...(data?.fuel ?? []).map((f, i) => [
        i+1, thDate(f.filled_at), f.fleet_vehicles?.name??'', assetIdentifier(f.fleet_vehicles),
        f.fuel_type === 'other' ? f.fuel_other_name || 'อื่นๆ' : FUEL_LABEL[f.fuel_type] || f.fuel_type || '',
        f.liters??'', f.price_per_liter??'',
        Math.round(f.total_cost ?? (f.liters??0)*(f.price_per_liter??0)),
        f.odometer??'', meterUnitShort(f.fleet_vehicles), f.fuel_station??'', f.receipt_no??'',
        f.efficiency_kml ?? '', f.is_anomaly ? 'ผิดปกติ' : '', f.anomaly_reason ?? '',
      ]),
    ], `น้ำมัน_${rangeFrom}_${rangeTo}.csv`)
  }

  function exportMaintCSV() {
    downloadCSV([
      ['ที่','วันที่','ทรัพย์สิน','ทะเบียน/รหัส','ประเภท','รายละเอียด','ค่าใช้จ่าย (บาท)','อู่/ผู้รับจ้าง','ค่ามิเตอร์','หน่วย'],
      ...(data?.maint ?? []).map((m, i) => [
        i+1, thDate(m.service_date), m.fleet_vehicles?.name??'', assetIdentifier(m.fleet_vehicles),
        MAINT_TH[m.maintenance_type]??m.maintenance_type, m.description, m.cost??0,
        m.vendor??'', m.odometer??'', meterUnitShort(m.fleet_vehicles),
      ]),
    ], `ซ่อมบำรุง_${rangeFrom}_${rangeTo}.csv`)
  }

  function resetPeriod() {
    setSelVehicle('')
    setPeriodMode(PERIOD_DEFAULTS.mode)
    setPeriodMonth(PERIOD_DEFAULTS.month)
    setPeriodQuarter(PERIOD_DEFAULTS.quarter)
    setPeriodYearBE(PERIOD_DEFAULTS.yearBE)
    setPeriodFiscalYearBE(PERIOD_DEFAULTS.fiscalYearBE)
    setDateFrom(INITIAL_PERIOD.from)
    setDateTo(INITIAL_PERIOD.to)
    setData(null)
  }

  return (
    <div className="space-y-3 md:space-y-5">

      {/* ── Filter panel ── */}
      <div className="bg-white rounded-xl md:rounded-2xl border border-gray-100 shadow-sm p-3 md:p-4 space-y-2.5 md:space-y-3">
        <p className="text-xs md:text-sm font-bold text-gray-700">🔍 เลือกข้อมูลที่ต้องการดู</p>
        <div className="flex flex-wrap gap-1.5">
          {PERIOD_MODES.map(mode => (
            <button key={mode.value} type="button" onClick={() => {
              if (mode.value === 'custom' && periodMode !== 'custom') {
                setDateFrom(period.from)
                setDateTo(period.to)
              }
              setPeriodMode(mode.value)
            }}
              className={`px-3 py-1.5 text-[11px] md:text-xs font-bold rounded-lg border ${
                periodMode === mode.value
                  ? 'text-white border-transparent'
                  : 'text-gray-600 border-gray-200 bg-white hover:bg-gray-50'
              }`}
              style={periodMode === mode.value ? { backgroundColor: 'var(--color-primary)' } : undefined}>
              {mode.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
          <div className="col-span-2 md:col-span-1">
            <label className="text-xs font-semibold text-gray-500 mb-1 block">รถ/เครื่องยนต์/ครุภัณฑ์</label>
            <select value={selVehicle} onChange={e => setSelVehicle(e.target.value)}
              className="w-full px-3 py-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-xl focus:outline-none">
              <option value="">ทุกทรัพย์สิน</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{assetOptionLabel(v)}</option>)}
            </select>
          </div>
          {periodMode === 'month' && (
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">เดือน</label>
              <select value={periodMonth} onChange={e => setPeriodMonth(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-xl focus:outline-none">
                {MONTH_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          )}
          {periodMode === 'quarter' && (
            <div className="col-span-2 md:col-span-1">
              <label className="text-xs font-semibold text-gray-500 mb-1 block">ไตรมาส</label>
              <select value={periodQuarter} onChange={e => setPeriodQuarter(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-xl focus:outline-none">
                {QUARTERS.map(q => <option key={q.value} value={q.value}>{q.label}</option>)}
              </select>
            </div>
          )}
          {periodMode !== 'custom' && (
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">
                {periodMode === 'month' ? 'ปี พ.ศ.' : 'ปีงบประมาณ พ.ศ.'}
              </label>
              <select
                value={periodMode === 'month' ? periodYearBE : periodFiscalYearBE}
                onChange={e => {
                  const value = Number(e.target.value)
                  if (periodMode === 'month') setPeriodYearBE(value)
                  else setPeriodFiscalYearBE(value)
                }}
                className="w-full px-3 py-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-xl focus:outline-none">
                {(periodMode === 'month' ? PERIOD_YEARS : FISCAL_YEARS).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          )}
          {periodMode === 'custom' && (
            <>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">ตั้งแต่วันที่</label>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  className="w-full px-3 py-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-xl focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">ถึงวันที่</label>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  className="w-full px-3 py-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-xl focus:outline-none" />
              </div>
            </>
          )}
          <div className="col-span-2 md:col-span-1 flex items-end">
            <button onClick={loadReport} disabled={loading}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              {loading ? 'กำลังโหลด...' : '📊 ดูรายงาน'}
            </button>
          </div>
        </div>
        {periodLabel && (
          <p className="text-[11px] text-gray-500">ช่วงที่เลือก: {periodLabel}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={printForm4} disabled={printingForm4 || !selVehicle}
            className="w-full md:w-auto px-3 py-2 rounded-xl text-[11px] md:text-xs font-bold border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
            {printingForm4 ? 'กำลังเตรียมแบบ 4...' : '🖨️ พิมพ์แบบ 4 บันทึกการใช้รถ (รายคัน)'}
          </button>
          <button onClick={resetPeriod}
            className="px-3 py-1.5 text-[11px] font-semibold text-red-500 border border-red-200 rounded-lg hover:bg-red-50">
            ล้าง
          </button>
        </div>
        {!selVehicle && (
          <p className="text-[11px] text-gray-400">แบบ 4 ต้องเลือกยานพาหนะ 1 คัน แล้วจึงพิมพ์ได้</p>
        )}
      </div>

      {/* ── Results ── */}
      {data && (
        <>
          {/* Export buttons */}
          <div className="grid grid-cols-2 md:flex gap-2">
            <button onClick={printForm4} disabled={printingForm4 || !selVehicle}
              className="justify-center flex items-center gap-1.5 px-2 md:px-3 py-2 rounded-xl text-[11px] md:text-xs font-bold border border-gray-800 text-gray-800 bg-white hover:bg-gray-50 disabled:opacity-50">
              {printingForm4 ? 'กำลังเตรียมแบบ 4...' : '🖨️ พิมพ์แบบ 4'}
            </button>
            <button onClick={exportPDF}
              className="justify-center flex items-center gap-1.5 px-2 md:px-3 py-2 rounded-xl text-[11px] md:text-xs font-bold border border-gray-200 text-gray-600 bg-white hover:bg-gray-50">
              🖨️ พิมพ์ / PDF
            </button>
            <button onClick={exportTripCSV}
              className="justify-center flex items-center gap-1.5 px-2 md:px-3 py-2 rounded-xl text-[11px] md:text-xs font-bold border border-green-200 text-green-700 bg-green-50 hover:bg-green-100">
              📥 Excel การใช้รถ
            </button>
            <button onClick={exportFuelCSV}
              className="justify-center flex items-center gap-1.5 px-2 md:px-3 py-2 rounded-xl text-[11px] md:text-xs font-bold border border-green-200 text-green-700 bg-green-50 hover:bg-green-100">
              📥 Excel น้ำมัน
            </button>
            <button onClick={exportMaintCSV}
              className="justify-center flex items-center gap-1.5 px-2 md:px-3 py-2 rounded-xl text-[11px] md:text-xs font-bold border border-green-200 text-green-700 bg-green-50 hover:bg-green-100">
              📥 Excel ซ่อมบำรุง
            </button>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-3">
            {[
              { label: 'การใช้รถ', val: `${data.trips.length} ครั้ง`, clr: '#3b82f6' },
              { label: 'ระยะทางรวม', val: `${totalKm.toLocaleString()} กม.`, clr: '#8b5cf6' },
              { label: 'เชื้อเพลิงรวม', val: `${fmt(totalLiters)} ล.`, clr: '#f59e0b' },
              { label: 'ค่าเชื้อเพลิง', val: fmtB(totalFuelCost), clr: '#ef4444' },
              { label: 'ค่าซ่อมบำรุง', val: fmtB(totalMaintCost), clr: '#10b981' },
            ].map(c => (
              <div key={c.label} className="last:col-span-2 md:last:col-span-1 bg-white rounded-xl md:rounded-2xl border border-gray-100 shadow-sm p-3 md:p-4 text-center">
                <p className="text-base md:text-lg font-black" style={{ color: c.clr }}>{c.val}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{c.label}</p>
              </div>
            ))}
          </div>

          {/* ── Trips table ── */}
          <ReportSection
            title={`การใช้รถ (${data.trips.length} รายการ)`}
            empty={data.trips.length === 0}
            mobile={
              <div className="space-y-1.5">
                {data.trips.map(t => {
                  const km = t.odometer_end && t.odometer_start ? t.odometer_end - t.odometer_start : null
                  return (
                    <div key={t.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-gray-800 truncate">{t.vehicle?.name ?? '—'}</p>
                          <p className="text-[10px] text-gray-400">{thDate(t.trip_date)} · {t.driver?.full_name ?? 'ไม่ระบุผู้ใช้รถ'}</p>
                        </div>
                        <span className="text-xs font-black text-purple-600 whitespace-nowrap">{km != null ? `${km.toLocaleString()} กม.` : '—'}</span>
                      </div>
                      <p className="text-[11px] text-gray-600 mt-1 truncate">{t.destination || 'ไม่ระบุปลายทาง'}</p>
                      <p className="text-[10px] text-gray-400 truncate">{t.purpose || 'ไม่ระบุวัตถุประสงค์'}</p>
                    </div>
                  )
                })}
              </div>
            }>
            <table className="w-full text-sm border-collapse">
              <THdr cols={['ที่','วันที่','ยานพาหนะ','ปลายทาง','วัตถุประสงค์','ผู้ใช้รถ','ระยะทาง']} />
              <tbody>
                {data.trips.map((t, i) => {
                  const km = t.odometer_end && t.odometer_start ? t.odometer_end - t.odometer_start : null
                  return (
                    <tr key={t.id} style={{ backgroundColor: i%2===0?'#fff':'#f5f8fc' }}>
                      <td className="px-3 py-2 text-xs text-gray-400 border-r border-gray-200 text-center">{i+1}</td>
                      <td className="px-3 py-2 text-xs text-gray-700 border-r border-gray-200 whitespace-nowrap">{thDate(t.trip_date)}</td>
                      <td className="px-3 py-2 text-xs font-semibold text-gray-700 border-r border-gray-200 whitespace-nowrap">{t.vehicle?.name}</td>
                      <td className="px-3 py-2 text-xs text-gray-600 border-r border-gray-200">{t.destination}</td>
                      <td className="px-3 py-2 text-xs text-gray-500 border-r border-gray-200">{t.purpose}</td>
                      <td className="px-3 py-2 text-xs text-gray-600 border-r border-gray-200 whitespace-nowrap">{t.driver?.full_name}</td>
                      <td className="px-3 py-2 text-xs text-gray-700 text-right whitespace-nowrap">
                        {km != null ? `${km.toLocaleString()} กม.` : '—'}
                      </td>
                    </tr>
                  )
                })}
                {data.trips.length > 0 && (
                  <tr style={{ backgroundColor: '#eef2f7' }}>
                    <td colSpan={6} className="px-3 py-2 text-xs font-bold text-gray-700 text-right border-r border-gray-200">รวมระยะทาง</td>
                    <td className="px-3 py-2 text-xs font-bold text-gray-800 text-right">{totalKm.toLocaleString()} กม.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </ReportSection>

          {/* ── Fuel table ── */}
          <ReportSection
            title={`บันทึกน้ำมัน (${data.fuel.length} รายการ)`}
            empty={data.fuel.length === 0}
            mobile={
              <div className="space-y-1.5">
                {data.fuel.map(f => {
                  const cost = f.total_cost ?? (f.liters ?? 0) * (f.price_per_liter ?? 0)
                  return (
                    <div key={f.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-gray-800 truncate">{f.fleet_vehicles?.name ?? '—'}</p>
                          <p className="text-[10px] text-gray-400 truncate">{assetIdentifier(f.fleet_vehicles)} · {thDate(f.filled_at)}</p>
                        </div>
                        <span className="text-xs font-black text-red-500 whitespace-nowrap">{fmtB(cost)}</span>
                      </div>
                      <p className="text-[11px] text-gray-600 mt-1 truncate">
                        {f.fuel_type === 'other' ? f.fuel_other_name || 'อื่นๆ' : FUEL_LABEL[f.fuel_type] || f.fuel_type || '—'}
                        {' · '}{fmt(f.liters)} ลิตร{f.fuel_station ? ` · ${f.fuel_station}` : ''}
                      </p>
                      {f.is_anomaly && (
                        <p className="text-[10px] text-red-600 font-semibold mt-0.5 leading-relaxed">
                          ⚠ {f.anomaly_reason || 'ผิดปกติ'}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            }>
            <table className="w-full text-sm border-collapse">
              <THdr cols={['ที่','วันที่','ทรัพย์สิน','เชื้อเพลิง','ลิตร','ราคา/ล.','รวม (บาท)','ปั๊ม','ตรวจสอบ']} />
              <tbody>
                {data.fuel.map((f, i) => {
                  const cost = f.total_cost ?? (f.liters ?? 0) * (f.price_per_liter ?? 0)
                  return (
                    <tr key={f.id} style={{ backgroundColor: i%2===0?'#fff':'#f5f8fc' }}>
                      <td className="px-3 py-2 text-xs text-gray-400 border-r border-gray-200 text-center">{i+1}</td>
                      <td className="px-3 py-2 text-xs text-gray-700 border-r border-gray-200 whitespace-nowrap">{thDate(f.filled_at)}</td>
                      <td className="px-3 py-2 text-xs font-semibold text-gray-700 border-r border-gray-200 whitespace-nowrap">{f.fleet_vehicles?.name}<span className="block text-[10px] text-gray-400">{assetIdentifier(f.fleet_vehicles)}</span></td>
                      <td className="px-3 py-2 text-xs text-gray-600 border-r border-gray-200 whitespace-nowrap">{f.fuel_type === 'other' ? f.fuel_other_name || 'อื่นๆ' : FUEL_LABEL[f.fuel_type] || f.fuel_type || '—'}</td>
                      <td className="px-3 py-2 text-xs text-gray-700 border-r border-gray-200 text-right">{fmt(f.liters)}</td>
                      <td className="px-3 py-2 text-xs text-gray-700 border-r border-gray-200 text-right">{fmt(f.price_per_liter)}</td>
                      <td className="px-3 py-2 text-xs font-semibold text-gray-700 border-r border-gray-200 text-right">{fmtB(cost)}</td>
                      <td className="px-3 py-2 text-xs text-gray-500 border-r border-gray-200">{f.fuel_station ?? '—'}</td>
                      {/* ธงที่ trg_fleet_fuel_anomaly ตั้งไว้ ต้องปรากฏในรายงานด้วย ไม่ใช่เห็นแค่ในหน้าคีย์ข้อมูล
                          ไม่งั้นรายการที่ระบบสงสัยจะถูกส่งให้ผู้ตรวจสอบในสภาพเดียวกับรายการปกติ */}
                      <td className="px-3 py-2 text-xs">
                        {f.is_anomaly
                          ? <span className="text-red-600 font-semibold">⚠ {f.anomaly_reason || 'ผิดปกติ'}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  )
                })}
                {data.fuel.length > 0 && (
                  <tr style={{ backgroundColor: '#eef2f7' }}>
                    <td colSpan={4} className="px-3 py-2 text-xs font-bold text-gray-700 text-right border-r border-gray-200">รวม</td>
                    <td className="px-3 py-2 text-xs font-bold text-gray-800 text-right border-r border-gray-200">{fmt(totalLiters)} ล.</td>
                    <td className="px-3 py-2 border-r border-gray-200" />
                    <td className="px-3 py-2 text-xs font-bold text-gray-800 text-right border-r border-gray-200">{fmtB(totalFuelCost)}</td>
                    <td className="px-3 py-2 border-r border-gray-200" />
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </ReportSection>

          {/* ── Maintenance table ── */}
          <ReportSection
            title={`ซ่อมบำรุง (${data.maint.length} รายการ)`}
            empty={data.maint.length === 0}
            mobile={
              <div className="space-y-1.5">
                {data.maint.map(m => (
                  <div key={m.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-gray-800 truncate">{m.fleet_vehicles?.name ?? '—'}</p>
                        <p className="text-[10px] text-gray-400 truncate">{assetIdentifier(m.fleet_vehicles)} · {thDate(m.service_date)} · {MAINT_TH[m.maintenance_type] ?? m.maintenance_type}</p>
                      </div>
                      <span className="text-xs font-black text-emerald-600 whitespace-nowrap">{fmtB(m.cost)}</span>
                    </div>
                    <p className="text-[11px] text-gray-600 mt-1 line-clamp-2">{m.description || 'ไม่ระบุรายละเอียด'}</p>
                    {m.vendor && <p className="text-[10px] text-gray-400 truncate">{m.vendor}</p>}
                  </div>
                ))}
              </div>
            }>
            <table className="w-full text-sm border-collapse">
              <THdr cols={['ที่','วันที่','ทรัพย์สิน','ประเภท','รายละเอียด','ค่าใช้จ่าย','อู่/ผู้รับจ้าง']} />
              <tbody>
                {data.maint.map((m, i) => (
                  <tr key={m.id} style={{ backgroundColor: i%2===0?'#fff':'#f5f8fc' }}>
                    <td className="px-3 py-2 text-xs text-gray-400 border-r border-gray-200 text-center">{i+1}</td>
                    <td className="px-3 py-2 text-xs text-gray-700 border-r border-gray-200 whitespace-nowrap">{thDate(m.service_date)}</td>
                    <td className="px-3 py-2 text-xs font-semibold text-gray-700 border-r border-gray-200 whitespace-nowrap">{m.fleet_vehicles?.name}<span className="block text-[10px] text-gray-400">{assetIdentifier(m.fleet_vehicles)}</span></td>
                    <td className="px-3 py-2 text-xs text-gray-600 border-r border-gray-200 whitespace-nowrap">{MAINT_TH[m.maintenance_type] ?? m.maintenance_type}</td>
                    <td className="px-3 py-2 text-xs text-gray-600 border-r border-gray-200">{m.description}</td>
                    <td className="px-3 py-2 text-xs font-semibold text-gray-700 border-r border-gray-200 text-right">{fmtB(m.cost)}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{m.vendor ?? '—'}</td>
                  </tr>
                ))}
                {data.maint.length > 0 && (
                  <tr style={{ backgroundColor: '#eef2f7' }}>
                    <td colSpan={5} className="px-3 py-2 text-xs font-bold text-gray-700 text-right border-r border-gray-200">รวม</td>
                    <td className="px-3 py-2 text-xs font-bold text-gray-800 text-right border-r border-gray-200">{fmtB(totalMaintCost)}</td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </ReportSection>
        </>
      )}

      {!data && !loading && (
        <div className="text-center text-sm text-gray-400 py-16">
          เลือกช่วงเวลาและกด "ดูรายงาน"
        </div>
      )}
    </div>
  )
}
