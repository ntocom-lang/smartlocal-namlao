import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const fmt  = n => (n ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })
const fmtB = n => `฿${Math.round(n ?? 0).toLocaleString('th-TH')}`
const thDate = d => d ? new Date(d).toLocaleDateString('th-TH', { dateStyle: 'short' }) : '—'

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

function ReportSection({ title, empty, children }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-gray-600 uppercase tracking-wide">{title}</p>
      {empty ? (
        <p className="text-center text-sm text-gray-400 py-6 bg-white rounded-2xl border border-gray-100">
          ไม่มีข้อมูลในช่วงนี้
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-300 shadow-sm">{children}</div>
      )}
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
  const [dateFrom,   setDateFrom]   = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10)
  })
  const [dateTo,     setDateTo]     = useState(new Date().toISOString().slice(0, 10))
  const [data,       setData]       = useState(null)
  const [loading,    setLoading]    = useState(false)

  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('fleet_vehicles').select('id,name,license_plate')
      .eq('municipality_id', tenant.id).order('name')
      .then(({ data: v }) => setVehicles(v ?? []))
  }, [tenant?.id])

  async function loadReport() {
    setLoading(true)
    const vq = q => selVehicle ? q.eq('vehicle_id', selVehicle) : q
    const toEOD = dateTo + 'T23:59:59'

    const [{ data: trips }, { data: fuel }, { data: maint }] = await Promise.all([
      vq(supabase.from('fleet_trips')
        .select('*, vehicle:fleet_vehicles(name,license_plate), driver:profiles!fleet_trips_driver_id_fkey(full_name)')
        .eq('municipality_id', tenant.id).eq('status', 'completed')
        .gte('started_at', dateFrom).lte('started_at', toEOD)).order('started_at'),
      vq(supabase.from('fleet_fuel_records')
        .select('*, fleet_vehicles(name,license_plate)')
        .eq('municipality_id', tenant.id)
        .gte('filled_at', dateFrom).lte('filled_at', dateTo)).order('filled_at'),
      vq(supabase.from('fleet_maintenance')
        .select('*, fleet_vehicles(name,license_plate)')
        .eq('municipality_id', tenant.id)
        .gte('service_date', dateFrom).lte('service_date', dateTo)).order('service_date'),
    ])
    setData({ trips: trips ?? [], fuel: fuel ?? [], maint: maint ?? [] })
    setLoading(false)
  }

  /* ── Summaries ── */
  const totalKm       = data?.trips.reduce((s, t) => s + (t.odometer_end && t.odometer_start ? t.odometer_end - t.odometer_start : 0), 0) ?? 0
  const totalLiters   = data?.fuel.reduce((s, f) => s + (f.liters ?? 0), 0) ?? 0
  const totalFuelCost = data?.fuel.reduce((s, f) => s + ((f.liters ?? 0) * (f.price_per_liter ?? 0)), 0) ?? 0
  const totalMaintCost = data?.maint.reduce((s, m) => s + (m.cost ?? 0), 0) ?? 0

  const selVehicleName = selVehicle ? (vehicles.find(v => v.id === selVehicle)?.name ?? '') : 'ทุกคัน'
  const reportTitle = `รายงานยานพาหนะ — ${selVehicleName} | ${dateFrom} ถึง ${dateTo}`

  /* ── PDF ── */
  function exportPDF() {
    const trRows = (data?.trips ?? []).map((t, i) => {
      const km = t.odometer_end && t.odometer_start ? t.odometer_end - t.odometer_start : ''
      return `<tr style="background:${i%2?'#f5f8fc':'#fff'}">
        <td>${i+1}</td><td>${thDate(t.started_at)}</td>
        <td>${t.vehicle?.name??''} ${t.vehicle?.license_plate??''}</td>
        <td>${t.destination}</td><td>${t.purpose}</td>
        <td>${t.driver?.full_name??''}</td>
        <td align="right">${km ? km.toLocaleString()+'&nbsp;กม.' : '—'}</td></tr>`
    }).join('')
    const fuelRows = (data?.fuel ?? []).map((f, i) => {
      const cost = (f.liters??0)*(f.price_per_liter??0)
      return `<tr style="background:${i%2?'#f5f8fc':'#fff'}">
        <td>${i+1}</td><td>${thDate(f.filled_at)}</td>
        <td>${f.fleet_vehicles?.name??''}</td>
        <td align="right">${fmt(f.liters)}</td>
        <td align="right">${fmt(f.price_per_liter)}</td>
        <td align="right">${fmtB(cost)}</td>
        <td>${f.fuel_station??'—'}</td></tr>`
    }).join('')
    const maintRows = (data?.maint ?? []).map((m, i) =>
      `<tr style="background:${i%2?'#f5f8fc':'#fff'}">
        <td>${i+1}</td><td>${thDate(m.service_date)}</td>
        <td>${m.fleet_vehicles?.name??''}</td>
        <td>${MAINT_TH[m.maintenance_type]??m.maintenance_type}</td>
        <td>${m.description}</td>
        <td align="right">${fmtB(m.cost)}</td>
        <td>${m.vendor??'—'}</td></tr>`
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
        <div class="card"><div class="val">${data?.trips.length??0}</div><div class="lbl">การเดินทาง (ครั้ง)</div></div>
        <div class="card"><div class="val">${totalKm.toLocaleString()}</div><div class="lbl">ระยะทาง (กม.)</div></div>
        <div class="card"><div class="val">${fmt(totalLiters)}</div><div class="lbl">น้ำมัน (ลิตร)</div></div>
        <div class="card"><div class="val">${fmtB(totalFuelCost)}</div><div class="lbl">ค่าน้ำมัน</div></div>
        <div class="card"><div class="val">${fmtB(totalMaintCost)}</div><div class="lbl">ค่าซ่อมบำรุง</div></div>
      </div>
      <h2>การเดินทาง (${data?.trips.length??0} รายการ)</h2>
      <table><tr><th>ที่</th><th>วันที่</th><th>ยานพาหนะ</th><th>ปลายทาง</th><th>วัตถุประสงค์</th><th>ผู้ขับ</th><th>ระยะทาง</th></tr>
        ${trRows}
        <tr class="total"><td colspan="6" align="right">รวมระยะทาง</td><td align="right">${totalKm.toLocaleString()} กม.</td></tr>
      </table>
      <h2>บันทึกน้ำมัน (${data?.fuel.length??0} รายการ)</h2>
      <table><tr><th>ที่</th><th>วันที่</th><th>ยานพาหนะ</th><th>ลิตร</th><th>ราคา/ล.</th><th>รวม</th><th>ปั๊ม</th></tr>
        ${fuelRows}
        <tr class="total"><td colspan="3" align="right">รวม</td><td align="right">${fmt(totalLiters)} ล.</td><td></td><td align="right">${fmtB(totalFuelCost)}</td><td></td></tr>
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
      ['ที่','วันที่','ยานพาหนะ','ทะเบียน','ปลายทาง','วัตถุประสงค์','ผู้ขับ','เลขไมล์ก่อน','เลขไมล์หลัง','ระยะทาง (กม.)'],
      ...(data?.trips ?? []).map((t, i) => {
        const km = t.odometer_end && t.odometer_start ? t.odometer_end - t.odometer_start : ''
        return [i+1, thDate(t.started_at), t.vehicle?.name??'', t.vehicle?.license_plate??'',
          t.destination, t.purpose, t.driver?.full_name??'',
          t.odometer_start??'', t.odometer_end??'', km]
      }),
    ], `การเดินทาง_${dateFrom}_${dateTo}.csv`)
  }

  function exportFuelCSV() {
    downloadCSV([
      ['ที่','วันที่','ยานพาหนะ','ทะเบียน','ลิตร','ราคา/ลิตร','รวม (บาท)','เลขไมล์','ปั๊ม','ใบเสร็จ'],
      ...(data?.fuel ?? []).map((f, i) => [
        i+1, thDate(f.filled_at), f.fleet_vehicles?.name??'', f.fleet_vehicles?.license_plate??'',
        f.liters??'', f.price_per_liter??'',
        Math.round((f.liters??0)*(f.price_per_liter??0)),
        f.odometer??'', f.fuel_station??'', f.receipt_no??'',
      ]),
    ], `น้ำมัน_${dateFrom}_${dateTo}.csv`)
  }

  function exportMaintCSV() {
    downloadCSV([
      ['ที่','วันที่','ยานพาหนะ','ทะเบียน','ประเภท','รายละเอียด','ค่าใช้จ่าย (บาท)','อู่/ผู้รับจ้าง','เลขไมล์'],
      ...(data?.maint ?? []).map((m, i) => [
        i+1, thDate(m.service_date), m.fleet_vehicles?.name??'', m.fleet_vehicles?.license_plate??'',
        MAINT_TH[m.maintenance_type]??m.maintenance_type, m.description, m.cost??0,
        m.vendor??'', m.odometer??'',
      ]),
    ], `ซ่อมบำรุง_${dateFrom}_${dateTo}.csv`)
  }

  /* ── Quick range shortcuts ── */
  function setThisMonth() {
    const d = new Date(); d.setDate(1)
    setDateFrom(d.toISOString().slice(0, 10))
    setDateTo(new Date().toISOString().slice(0, 10))
  }
  function setLastMonth() {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1)
    const e = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    setDateFrom(d.toISOString().slice(0, 10))
    setDateTo(e.toISOString().slice(0, 10))
  }
  function setThisYear() {
    const y = new Date().getFullYear()
    setDateFrom(`${y}-01-01`); setDateTo(`${y}-12-31`)
  }

  return (
    <div className="space-y-5">

      {/* ── Filter panel ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <p className="text-sm font-bold text-gray-700">🔍 เลือกข้อมูลที่ต้องการดู</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">ยานพาหนะ</label>
            <select value={selVehicle} onChange={e => setSelVehicle(e.target.value)}
              className="w-full px-3 py-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-xl focus:outline-none">
              <option value="">ทุกคัน</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.name} ({v.license_plate})</option>)}
            </select>
          </div>
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
          <div className="flex items-end">
            <button onClick={loadReport} disabled={loading}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              {loading ? 'กำลังโหลด...' : '📊 ดูรายงาน'}
            </button>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {[['เดือนนี้', setThisMonth], ['เดือนที่แล้ว', setLastMonth], ['ปีนี้', setThisYear]].map(([label, fn]) => (
            <button key={label} onClick={fn}
              className="px-3 py-1 text-[11px] font-semibold text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Results ── */}
      {data && (
        <>
          {/* Export buttons */}
          <div className="flex gap-2 flex-wrap">
            <button onClick={exportPDF}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-gray-200 text-gray-600 bg-white hover:bg-gray-50">
              🖨️ พิมพ์ / PDF
            </button>
            <button onClick={exportTripCSV}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-green-200 text-green-700 bg-green-50 hover:bg-green-100">
              📥 Excel การเดินทาง
            </button>
            <button onClick={exportFuelCSV}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-green-200 text-green-700 bg-green-50 hover:bg-green-100">
              📥 Excel น้ำมัน
            </button>
            <button onClick={exportMaintCSV}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-green-200 text-green-700 bg-green-50 hover:bg-green-100">
              📥 Excel ซ่อมบำรุง
            </button>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'การเดินทาง', val: `${data.trips.length} ครั้ง`, clr: '#3b82f6' },
              { label: 'ระยะทางรวม', val: `${totalKm.toLocaleString()} กม.`, clr: '#8b5cf6' },
              { label: 'น้ำมันรวม',   val: `${fmt(totalLiters)} ล.`, clr: '#f59e0b' },
              { label: 'ค่าน้ำมัน',   val: fmtB(totalFuelCost), clr: '#ef4444' },
              { label: 'ค่าซ่อมบำรุง', val: fmtB(totalMaintCost), clr: '#10b981' },
            ].map(c => (
              <div key={c.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
                <p className="text-lg font-black" style={{ color: c.clr }}>{c.val}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{c.label}</p>
              </div>
            ))}
          </div>

          {/* ── Trips table ── */}
          <ReportSection title={`การเดินทาง (${data.trips.length} รายการ)`} empty={data.trips.length === 0}>
            <table className="w-full text-sm border-collapse">
              <THdr cols={['ที่','วันที่','ยานพาหนะ','ปลายทาง','วัตถุประสงค์','ผู้ขับ','ระยะทาง']} />
              <tbody>
                {data.trips.map((t, i) => {
                  const km = t.odometer_end && t.odometer_start ? t.odometer_end - t.odometer_start : null
                  return (
                    <tr key={t.id} style={{ backgroundColor: i%2===0?'#fff':'#f5f8fc' }}>
                      <td className="px-3 py-2 text-xs text-gray-400 border-r border-gray-200 text-center">{i+1}</td>
                      <td className="px-3 py-2 text-xs text-gray-700 border-r border-gray-200 whitespace-nowrap">{thDate(t.started_at)}</td>
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
          <ReportSection title={`บันทึกน้ำมัน (${data.fuel.length} รายการ)`} empty={data.fuel.length === 0}>
            <table className="w-full text-sm border-collapse">
              <THdr cols={['ที่','วันที่','ยานพาหนะ','ลิตร','ราคา/ล.','รวม (บาท)','ปั๊ม']} />
              <tbody>
                {data.fuel.map((f, i) => {
                  const cost = (f.liters ?? 0) * (f.price_per_liter ?? 0)
                  return (
                    <tr key={f.id} style={{ backgroundColor: i%2===0?'#fff':'#f5f8fc' }}>
                      <td className="px-3 py-2 text-xs text-gray-400 border-r border-gray-200 text-center">{i+1}</td>
                      <td className="px-3 py-2 text-xs text-gray-700 border-r border-gray-200 whitespace-nowrap">{thDate(f.filled_at)}</td>
                      <td className="px-3 py-2 text-xs font-semibold text-gray-700 border-r border-gray-200 whitespace-nowrap">{f.fleet_vehicles?.name}</td>
                      <td className="px-3 py-2 text-xs text-gray-700 border-r border-gray-200 text-right">{fmt(f.liters)}</td>
                      <td className="px-3 py-2 text-xs text-gray-700 border-r border-gray-200 text-right">{fmt(f.price_per_liter)}</td>
                      <td className="px-3 py-2 text-xs font-semibold text-gray-700 border-r border-gray-200 text-right">{fmtB(cost)}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{f.fuel_station ?? '—'}</td>
                    </tr>
                  )
                })}
                {data.fuel.length > 0 && (
                  <tr style={{ backgroundColor: '#eef2f7' }}>
                    <td colSpan={3} className="px-3 py-2 text-xs font-bold text-gray-700 text-right border-r border-gray-200">รวม</td>
                    <td className="px-3 py-2 text-xs font-bold text-gray-800 text-right border-r border-gray-200">{fmt(totalLiters)} ล.</td>
                    <td className="px-3 py-2 border-r border-gray-200" />
                    <td className="px-3 py-2 text-xs font-bold text-gray-800 text-right border-r border-gray-200">{fmtB(totalFuelCost)}</td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </ReportSection>

          {/* ── Maintenance table ── */}
          <ReportSection title={`ซ่อมบำรุง (${data.maint.length} รายการ)`} empty={data.maint.length === 0}>
            <table className="w-full text-sm border-collapse">
              <THdr cols={['ที่','วันที่','ยานพาหนะ','ประเภท','รายละเอียด','ค่าใช้จ่าย','อู่/ผู้รับจ้าง']} />
              <tbody>
                {data.maint.map((m, i) => (
                  <tr key={m.id} style={{ backgroundColor: i%2===0?'#fff':'#f5f8fc' }}>
                    <td className="px-3 py-2 text-xs text-gray-400 border-r border-gray-200 text-center">{i+1}</td>
                    <td className="px-3 py-2 text-xs text-gray-700 border-r border-gray-200 whitespace-nowrap">{thDate(m.service_date)}</td>
                    <td className="px-3 py-2 text-xs font-semibold text-gray-700 border-r border-gray-200 whitespace-nowrap">{m.fleet_vehicles?.name}</td>
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
