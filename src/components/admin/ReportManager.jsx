import { useState, useEffect } from 'react'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'
import { Wrench, TrendingUp, AlertTriangle, Printer, X, Clock, CheckCircle2, Download } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const STATUS = {
  pending:     { label: 'รอดำเนินการ',    color: '#f59e0b', bg: '#fef3c7', text: '#92400e' },
  received:    { label: 'รับเรื่องแล้ว',   color: '#3b82f6', bg: '#dbeafe', text: '#1e40af' },
  in_progress: { label: 'กำลังดำเนินการ', color: '#8b5cf6', bg: '#ede9fe', text: '#5b21b6' },
  completed:   { label: 'เสร็จสิ้น',      color: '#10b981', bg: '#d1fae5', text: '#065f46' },
  rejected:    { label: 'ปฏิเสธ',         color: '#ef4444', bg: '#fee2e2', text: '#991b1b' },
}
let CATEGORY_LABEL = {
  road: 'ถนน/ทางสาธารณะ', light: 'ไฟฟ้าส่องสว่าง',
  trash: 'ขยะ/ความสะอาด', water: 'น้ำประปา',
  flood: 'น้ำท่วม/ระบายน้ำ', tree: 'ต้นไม้/สวนสาธารณะ',
  noise: 'เหตุรำคาญ', disease: 'ควบคุมโรคติดต่อ', other: 'อื่นๆ',
}
let CATEGORY_EMOJI = {
  road: '🛣️', light: '💡', trash: '🗑️', water: '💧',
  flood: '🌊', tree: '🌳', noise: '📢', drain: '🕳️', disease: '🏥',
}
const MONTHS_TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
const MONTHS_FULL_TH = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']

function handlePrint({ view, month, year, viewLabel, total, completed, rejected, active, rate, avgDays, catData, trend, tenant }) {
  const today = new Date()
  const thaiDate = `${today.getDate()} ${MONTHS_FULL_TH[today.getMonth()]} ${today.getFullYear() + 543}`
  const trendRows = trend.map(t => `
    <tr>
      <td style="padding:6px 12px;border:1px solid #ddd;text-align:center">${t.label}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;text-align:center">${t.submitted}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;text-align:center">${t.completed}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;text-align:center">${t.submitted - t.completed}</td>
    </tr>`).join('')
  const catRows = catData.map((c, i) => `
    <tr>
      <td style="padding:6px 12px;border:1px solid #ddd;text-align:center">${i + 1}</td>
      <td style="padding:6px 12px;border:1px solid #ddd">${c.emoji} ${c.name}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;text-align:center">${c.count}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;text-align:center">${total > 0 ? Math.round(c.count / total * 100) : 0}%</td>
    </tr>`).join('')
  const trendHeader = view === 'month' ? 'สัปดาห์' : view === 'year' ? 'เดือน' : 'ปี'
  const html = `<!DOCTYPE html><html lang="th"><head>
  <meta charset="UTF-8"><title>รายงาน ${viewLabel} - ${tenant?.name}</title>
  <style>
    @page { size: A4; margin: 2cm 2.5cm; }
    body { font-family: 'TH Sarabun New', Sarabun, sans-serif; font-size: 16pt; color: #000; line-height: 1.6; }
    h1 { font-size: 20pt; text-align: center; margin: 0 0 4px; }
    .sub { text-align: center; font-size: 14pt; margin-bottom: 20px; }
    .memo { display: grid; grid-template-columns: 120px 1fr; gap: 4px 8px; margin-bottom: 20px; font-size: 15pt; }
    .memo b { font-weight: 600; }
    .section { margin: 16px 0 8px; font-size: 16pt; font-weight: 700; border-bottom: 1px solid #000; padding-bottom: 2px; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 12px 0; }
    .stat-box { border: 1px solid #aaa; padding: 8px 10px; text-align: center; }
    .stat-box .num { font-size: 22pt; font-weight: 900; }
    .stat-box .lbl { font-size: 13pt; }
    table { width: 100%; border-collapse: collapse; font-size: 14pt; margin: 8px 0; }
    th { background: #e8e8e8; padding: 7px 12px; border: 1px solid #ddd; text-align: center; }
    .sign { margin-top: 60px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .sign-box { text-align: center; }
    .sign-line { border-top: 1px solid #000; width: 220px; margin: 60px auto 4px; }
    .sign-label { font-size: 13pt; }
    @media print { button { display: none; } }
  </style>
</head><body>
  <h1>บันทึกข้อความ</h1>
  <p class="sub">รายงานสรุปผลการดำเนินงานการรับเรื่องร้องทุกข์ผ่านระบบออนไลน์</p>
  <div class="memo">
    <b>ส่วนราชการ</b><span>${tenant?.name ?? 'หน่วยงาน'}</span>
    <b>วันที่</b><span>${thaiDate}</span>
    <b>เรื่อง</b><span>รายงานสรุปผลการรับคำร้อง ${viewLabel}</span>
    <b>เรียน</b><span>ผู้บังคับบัญชา</span>
  </div>
  <p style="text-indent:2.5em">ตามที่ ${tenant?.name ?? 'หน่วยงาน'} ได้เปิดให้บริการรับเรื่องร้องทุกข์ผ่านระบบบริการออนไลน์ เพื่ออำนวยความสะดวกแก่ประชาชนนั้น ขอรายงานผลการดำเนินงาน${viewLabel} ดังนี้</p>
  <div class="section">๑. สรุปสถิติคำร้อง</div>
  <div class="stats">
    <div class="stat-box"><div class="num">${total}</div><div class="lbl">คำร้องทั้งหมด</div></div>
    <div class="stat-box"><div class="num" style="color:#10b981">${completed}</div><div class="lbl">ดำเนินการแล้วเสร็จ</div></div>
    <div class="stat-box"><div class="num" style="color:#f59e0b">${active}</div><div class="lbl">อยู่ระหว่างดำเนินการ</div></div>
    <div class="stat-box"><div class="num" style="color:#ef4444">${rejected}</div><div class="lbl">ปฏิเสธคำร้อง</div></div>
  </div>
  <p>อัตราการปิดงาน <b>${rate}%</b>${avgDays !== null ? ` &nbsp;|&nbsp; เฉลี่ยระยะเวลาดำเนินการ <b>${avgDays} วัน</b>` : ''}</p>
  <div class="section">๒. แนวโน้มการรับคำร้อง</div>
  <table><thead><tr><th>${trendHeader}</th><th>คำร้องที่รับ</th><th>ดำเนินการแล้วเสร็จ</th><th>คงค้าง</th></tr></thead><tbody>${trendRows}</tbody></table>
  <div style="page-break-inside:avoid">
  <div class="section">๓. ประเภทคำร้องที่พบบ่อย</div>
  <table><thead><tr><th>ลำดับ</th><th>ประเภทคำร้อง</th><th>จำนวน (ราย)</th><th>คิดเป็น (%)</th></tr></thead>
  <tbody>${catRows || '<tr><td colspan="4" style="text-align:center;padding:12px;border:1px solid #ddd">ไม่มีข้อมูล</td></tr>'}</tbody></table></div>
  <p style="margin-top:16px;text-indent:2.5em">จึงเรียนมาเพื่อโปรดทราบ</p>
  <div class="sign">
    <div class="sign-box"><div class="sign-line"></div><div class="sign-label">ผู้รายงาน</div><div class="sign-label">ตำแหน่ง .................................</div><div class="sign-label">วันที่ ${thaiDate}</div></div>
    <div class="sign-box"><div class="sign-line"></div><div class="sign-label">ผู้บังคับบัญชา</div><div class="sign-label">ตำแหน่ง .................................</div><div class="sign-label">วันที่ .................................</div></div>
  </div>
</body></html>`
  const w = window.open('', '_blank', 'width=900,height=700')
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 500)
}

export default function ReportManager({ complaints, tenant, technicians = [] }) {
  const now = new Date()
  const [view, setView]   = useState('month')
  const [month, setMonth] = useState(now.getMonth())
  const [year, setYear]   = useState(now.getFullYear())

  // ดึงหมวดหมู่ที่ Admin สร้างเอง merge เข้า CATEGORY_LABEL/EMOJI
  const [, setCatVer] = useState(0)
  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('complaint_categories').select('value, label, emoji').eq('municipality_id', tenant.id)
      .then(({ data }) => {
        if (data && data.length > 0) {
          for (const c of data) {
            CATEGORY_LABEL[c.value] = c.label
            if (c.emoji) CATEGORY_EMOJI[c.value] = c.emoji
          }
          setCatVer(v => v + 1)
        }
      })
  }, [tenant?.id])

  const years = [...new Set(complaints.map(c => new Date(c.created_at).getFullYear()))]
  if (!years.includes(now.getFullYear())) years.push(now.getFullYear())
  years.sort((a, b) => b - a)

  const viewData = complaints.filter(c => {
    const d = new Date(c.created_at)
    if (view === 'month') return d.getMonth() === month && d.getFullYear() === year
    if (view === 'year')  return d.getFullYear() === year
    return true
  })

  const total     = viewData.length
  const completed = viewData.filter(c => c.status === 'completed').length
  const rejected  = viewData.filter(c => c.status === 'rejected').length
  const active    = total - completed - rejected
  const rate      = total > 0 ? Math.round(completed / total * 100) : 0

  const closedData = complaints.filter(c => {
    if (c.status !== 'completed') return false
    const d = new Date(c.updated_at)
    if (view === 'month') return d.getMonth() === month && d.getFullYear() === year
    if (view === 'year')  return d.getFullYear() === year
    return true
  })
  const avgDays = closedData.length > 0
    ? Math.round(closedData.reduce((s, c) => s + (new Date(c.updated_at) - new Date(c.created_at)) / 86400000, 0) / closedData.length)
    : null

  const prevMonth = month === 0 ? 11 : month - 1
  const prevYear  = month === 0 ? year - 1 : year
  const prevData  = view === 'month'
    ? complaints.filter(c => { const d = new Date(c.created_at); return d.getMonth() === prevMonth && d.getFullYear() === prevYear })
    : []
  const prevTotal     = prevData.length
  const prevCompleted = prevData.filter(c => c.status === 'completed').length
  const prevRate      = prevTotal > 0 ? Math.round(prevCompleted / prevTotal * 100) : 0
  const prevClosedData = complaints.filter(c => {
    if (c.status !== 'completed') return false
    const d = new Date(c.updated_at)
    return d.getMonth() === prevMonth && d.getFullYear() === prevYear
  })
  const prevAvgDays = prevClosedData.length > 0
    ? Math.round(prevClosedData.reduce((s, c) => s + (new Date(c.updated_at) - new Date(c.created_at)) / 86400000, 0) / prevClosedData.length)
    : null

  const slaIn3    = closedData.filter(c => (new Date(c.updated_at) - new Date(c.created_at)) / 86400000 <= 3).length
  const slaIn7    = closedData.filter(c => (new Date(c.updated_at) - new Date(c.created_at)) / 86400000 <= 7).length
  const slaIn14   = closedData.filter(c => (new Date(c.updated_at) - new Date(c.created_at)) / 86400000 <= 14).length
  const slaOver14 = closedData.length - slaIn14
  const slaRate7  = closedData.length > 0 ? Math.round(slaIn7 / closedData.length * 100) : null

  const techMap = {}
  complaints.filter(c => c.status === 'completed' && c.assigned_to).forEach(c => {
    const tech = technicians.find(t => t.id === c.assigned_to)
    const name = tech?.full_name || tech?.email || null
    if (!name) return
    if (!techMap[name]) techMap[name] = { name, completed: 0, totalDays: 0 }
    techMap[name].completed++
    techMap[name].totalDays += (new Date(c.updated_at) - new Date(c.created_at)) / 86400000
  })
  const techLeaderboard = Object.values(techMap)
    .map(t => ({ ...t, avgDays: Math.round(t.totalDays / t.completed) }))
    .sort((a, b) => b.completed - a.completed).slice(0, 5)

  const trend = view === 'all'
    ? years.slice().reverse().map(y => {
        const cs = complaints.filter(c => new Date(c.created_at).getFullYear() === y)
        return { label: String(y + 543), submitted: cs.length, completed: cs.filter(c => c.status === 'completed').length }
      })
    : view === 'year'
    ? Array.from({ length: 12 }, (_, i) => {
        const cs = complaints.filter(c => { const d = new Date(c.created_at); return d.getMonth() === i && d.getFullYear() === year })
        return { label: MONTHS_TH[i], submitted: cs.length, completed: cs.filter(c => c.status === 'completed').length }
      })
    : Array.from({ length: 4 }, (_, i) => {
        const weekStart = i * 7 + 1
        const weekEnd   = i === 3 ? 31 : weekStart + 6
        const cs = complaints.filter(c => { const d = new Date(c.created_at); return d.getMonth() === month && d.getFullYear() === year && d.getDate() >= weekStart && d.getDate() <= weekEnd })
        return { label: `สัปดาห์ ${i + 1}`, submitted: cs.length, completed: cs.filter(c => c.status === 'completed').length }
      })

  const catCount = {}
  viewData.forEach(c => { catCount[c.category] = (catCount[c.category] || 0) + 1 })
  const catDataAll = Object.entries(catCount)
    .map(([cat, count]) => ({ name: CATEGORY_LABEL[cat] ?? cat, emoji: CATEGORY_EMOJI[cat] ?? '📄', count }))
    .sort((a, b) => b.count - a.count)
  const catData = catDataAll.slice(0, 6)
  const otherCount = catDataAll.slice(6).reduce((s, d) => s + d.count, 0)
  const catPieData = otherCount > 0 ? [...catData, { name: 'อื่นๆ', emoji: '📄', count: otherCount }] : catData
  const CAT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#94a3b8']

  const nowMs = now.getTime()
  const overdue = complaints
    .filter(c => !['completed','rejected'].includes(c.status) && (nowMs - new Date(c.created_at)) > 15 * 86400000)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).slice(0, 6)
  const noTechAction = complaints
    .filter(c => c.status === 'received' && (nowMs - new Date(c.updated_at)) > 7 * 86400000)
    .sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at)).slice(0, 6)

  const rateColor = rate >= 70 ? '#10b981' : rate >= 40 ? '#f59e0b' : '#ef4444'
  const viewLabel = view === 'month' ? `${MONTHS_FULL_TH[month]} ${year + 543}` : view === 'year' ? `ปี ${year + 543}` : 'ทั้งหมด'

  return (
    <div className="space-y-5 pb-32">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
            <TrendingUp size={18} style={{ color: 'var(--color-primary)' }} />
            รายงานสรุป
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">{viewLabel} · {tenant?.name}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-xl border border-gray-200 overflow-hidden bg-white text-xs font-medium">
            {[['month','รายเดือน'],['year','รายปี'],['all','ทั้งหมด']].map(([v, label]) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-2 transition-colors ${view === v ? 'text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                style={view === v ? { backgroundColor: 'var(--color-primary)' } : {}}>
                {label}
              </button>
            ))}
          </div>
          {view !== 'all' && (
            <select value={year} onChange={e => setYear(+e.target.value)}
              className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white text-gray-700 focus:outline-none">
              {years.map(y => <option key={y} value={y}>{y + 543}</option>)}
            </select>
          )}
          {view === 'month' && (
            <select value={month} onChange={e => setMonth(+e.target.value)}
              className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white text-gray-700 focus:outline-none">
              {MONTHS_TH.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
          )}
          <button onClick={() => {
            const rows = [
              ['เลขที่','วันที่','ผู้ร้อง','โทรศัพท์','ประเภท','รายละเอียด','สถานที่','สถานะ'],
              ...viewData.map(c => [
                c.id.slice(0,8).toUpperCase(),
                new Date(c.created_at).toLocaleDateString('th-TH'),
                c.reporter_name ?? c.profiles?.full_name ?? '',
                c.phone ?? c.profiles?.phone ?? '',
                CATEGORY_LABEL[c.category] ?? c.category ?? '',
                (c.description ?? '').replace(/\n/g,' '),
                [c.location_name, c.village].filter(Boolean).join(', '),
                STATUS[c.status]?.label ?? c.status,
              ])
            ]
            const csv = '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n')
            const a = document.createElement('a')
            a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
            a.download = `คำร้อง_${viewLabel}_${tenant?.name ?? ''}.csv`
            a.click()
          }} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
            <Download size={15} /> Export CSV
          </button>
          <button onClick={() => handlePrint({ view, month, year, viewLabel, total, completed, rejected, active, rate, avgDays, catData, trend, tenant })}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
            <Printer size={15} /> พิมพ์
          </button>
          {(view !== 'month' || month !== now.getMonth() || year !== now.getFullYear()) && (
            <button onClick={() => { setView('month'); setMonth(now.getMonth()); setYear(now.getFullYear()) }}
              className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-medium bg-white border border-gray-200 text-gray-400 hover:text-red-500 transition-colors">
              <X size={12} /> ล้าง
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'คำร้องที่รับเข้า', value: total,    color: '#64748b', sub: 'รายการ',           delta: view === 'month' ? total - prevTotal : null, unit: '' },
          { label: 'ปิดงานแล้ว',       value: completed, color: '#10b981', sub: 'รายการ',           delta: view === 'month' ? completed - prevCompleted : null, unit: '' },
          { label: 'อัตราปิดงาน',      value: `${rate}%`, color: rateColor, sub: rate >= 70 ? '✅ ดี' : rate >= 40 ? '⚠️ ปานกลาง' : '🔴 ต่ำ', delta: view === 'month' && prevTotal > 0 ? rate - prevRate : null, unit: '%' },
          { label: 'เฉลี่ยวันปิดงาน',  value: avgDays !== null ? avgDays : '—', color: '#8b5cf6', sub: avgDays !== null ? 'วัน' : 'ไม่มีข้อมูล', delta: view === 'month' && avgDays !== null && prevAvgDays !== null ? prevAvgDays - avgDays : null, unit: 'วัน' },
        ].map(({ label, value, color, sub, delta, unit }) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-2xl font-black leading-none" style={{ color }}>{value}</p>
            <p className="text-[13px] text-gray-400 mt-1">{sub}</p>
            <p className="text-xs font-medium text-gray-600 mt-0.5">{label}</p>
            {delta !== null && (
              <p className={`text-[11px] font-semibold mt-1.5 ${delta > 0 ? 'text-green-500' : delta < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                {delta > 0 ? '↑' : delta < 0 ? '↓' : '='} {delta !== 0 ? `${Math.abs(delta)}${unit} จากเดือนก่อน` : 'เท่าเดิม'}
              </p>
            )}
          </div>
        ))}
      </div>

      {closedData.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Clock size={14} className="text-blue-500" /> SLA — ระยะเวลาแก้ไขปัญหา
            </h3>
            {slaRate7 !== null && (
              <span className={`text-sm font-bold px-3 py-1 rounded-full ${slaRate7 >= 70 ? 'bg-green-50 text-green-600' : slaRate7 >= 40 ? 'bg-yellow-50 text-yellow-600' : 'bg-red-50 text-red-500'}`}>
                {slaRate7 >= 70 ? '✅' : slaRate7 >= 40 ? '⚠️' : '🔴'} {slaRate7}% แก้ภายใน 7 วัน
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: '0–3 วัน',  count: slaIn3,            color: '#10b981', bg: '#d1fae5', emoji: '🟢' },
              { label: '4–7 วัน',  count: slaIn7 - slaIn3,   color: '#3b82f6', bg: '#dbeafe', emoji: '🔵' },
              { label: '8–14 วัน', count: slaIn14 - slaIn7,  color: '#f59e0b', bg: '#fef3c7', emoji: '🟡' },
              { label: '15+ วัน',  count: slaOver14,          color: '#ef4444', bg: '#fee2e2', emoji: '🔴' },
            ].map(({ label, count, color, bg, emoji }) => (
              <div key={label} className="rounded-2xl p-4 text-center" style={{ backgroundColor: bg }}>
                <p className="text-xs mb-1">{emoji}</p>
                <p className="text-2xl font-black" style={{ color }}>{count}</p>
                <p className="text-xs font-semibold mt-1" style={{ color }}>{label}</p>
                <p className="text-[11px] mt-0.5" style={{ color, opacity: 0.7 }}>
                  {closedData.length > 0 ? `${Math.round(count / closedData.length * 100)}%` : '—'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">
          {view === 'all' ? 'แนวโน้มรายปี' : view === 'year' ? `แนวโน้มรายเดือน ปี ${year + 543}` : `แนวโน้มรายสัปดาห์ ${MONTHS_FULL_TH[month]} ${year + 543}`}
        </h3>
        {complaints.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-gray-400 text-sm">ยังไม่มีข้อมูล</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={trend} barGap={4} barSize={16}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} allowDecimals={false} />
              <Tooltip formatter={(val, name) => [val, name === 'submitted' ? 'รับเข้า' : 'เสร็จสิ้น']}
                contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6', fontSize: 12 }} />
              <Legend iconType="circle" iconSize={8}
                formatter={v => <span className="text-xs text-gray-600">{v === 'submitted' ? 'รับเข้า' : 'เสร็จสิ้น'}</span>} />
              <Bar dataKey="submitted" name="submitted" fill="var(--color-primary)" radius={[4,4,0,0]} opacity={0.75} />
              <Bar dataKey="completed" name="completed" fill="#10b981" radius={[4,4,0,0]} opacity={0.85} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">
          {view === 'all' ? 'ประเภทคำร้องทั้งหมด' : view === 'year' ? `ประเภทคำร้องปี ${year + 543}` : `ประเภทคำร้อง${MONTHS_FULL_TH[month]}นี้`}
        </h3>
        {catData.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">ไม่มีข้อมูล</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={catPieData} cx="50%" cy="50%" innerRadius={48} outerRadius={78}
                  dataKey="count" nameKey="name" paddingAngle={2}
                  label={({ cx, cy, midAngle, outerRadius, count }) => {
                    const RADIAN = Math.PI / 180
                    const x = cx + (outerRadius + 14) * Math.cos(-midAngle * RADIAN)
                    const y = cy + (outerRadius + 14) * Math.sin(-midAngle * RADIAN)
                    return <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700} fill="#374151">{count}</text>
                  }}
                  labelLine={{ stroke: '#d1d5db', strokeWidth: 1 }}>
                  {catPieData.map((_, i) => <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(value, name) => [`${value} รายการ`, name]}
                  contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6', fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2.5 mt-2">
              {catData.map(({ name, emoji, count }, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-gray-700 font-medium flex items-center gap-2 truncate">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: CAT_COLORS[i % CAT_COLORS.length] }} />
                      <span>{emoji}</span> {name}
                    </span>
                    <span className="text-gray-500 shrink-0 ml-2 font-semibold">{count}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${count / catData[0].count * 100}%`, backgroundColor: CAT_COLORS[i % CAT_COLORS.length], opacity: 0.75 }} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {techLeaderboard.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <Wrench size={14} className="text-orange-500" /> ผลงานช่าง
            <span className="text-xs font-normal text-gray-400 ml-auto">ตลอดทุกช่วงเวลา</span>
          </h3>
          <div className="space-y-3">
            {techLeaderboard.map((t, i) => {
              const medals = ['🥇','🥈','🥉']
              return (
                <div key={t.name} className="flex items-center gap-3">
                  <div className="w-7 text-center text-base shrink-0">{medals[i] ?? `${i + 1}.`}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{t.name}</p>
                    <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1.5">
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${(t.completed / techLeaderboard[0].completed) * 100}%`, backgroundColor: '#f97316' }} />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-gray-800">{t.completed} งาน</p>
                    <p className="text-[11px] text-gray-400">เฉลี่ย {t.avgDays} วัน/งาน</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {view === 'month' && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl border border-orange-100 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
              <Clock size={14} className="text-orange-500" /> รอช่างรับงานเกิน 7 วัน
            </h3>
            <p className="text-xs text-gray-400 mb-4">ค้างเกิน 7 วันหลังรับเรื่อง · ทั้งระบบ {noTechAction.length} รายการ</p>
            {noTechAction.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                <CheckCircle2 size={28} className="text-green-400 mb-2" />
                <p className="text-sm text-green-600 font-medium">ช่างรับงานทุกรายการแล้ว</p>
              </div>
            ) : (
              <div className="space-y-0 divide-y divide-gray-50">
                {noTechAction.map(c => {
                  const days = Math.floor((nowMs - new Date(c.updated_at)) / 86400000)
                  return (
                    <div key={c.id} className="flex items-center gap-3 py-2.5">
                      <span className="text-lg shrink-0">{CATEGORY_EMOJI[c.category] ?? '📄'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-700 truncate">{CATEGORY_LABEL[c.category] ?? c.category}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                          {c.assigned_to_name ? `ช่าง: ${c.assigned_to_name}` : c.assigned_to ? 'มอบหมายแล้ว ยังไม่รับงาน' : 'ยังไม่ได้มอบหมายช่าง'}
                        </p>
                      </div>
                      <span className="text-xs font-bold text-orange-500 shrink-0 bg-orange-50 px-2 py-0.5 rounded-lg">{days} วัน</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
              <AlertTriangle size={14} className="text-amber-500" /> คำร้องค้างเกิน 15 วัน
            </h3>
            <p className="text-xs text-gray-400 mb-4">ค้างเกิน 15 วัน · ทั้งระบบ {overdue.length} รายการ</p>
            {overdue.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                <CheckCircle2 size={28} className="text-green-400 mb-2" />
                <p className="text-sm text-green-600 font-medium">ไม่มีคำร้องค้าง</p>
              </div>
            ) : (
              <div className="space-y-0 divide-y divide-gray-50">
                {overdue.map(c => {
                  const days = Math.floor((nowMs - new Date(c.created_at)) / 86400000)
                  const s = STATUS[c.status]
                  return (
                    <div key={c.id} className="flex items-center gap-3 py-2.5">
                      <span className="text-lg shrink-0">{CATEGORY_EMOJI[c.category] ?? '📄'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-700 truncate">{CATEGORY_LABEL[c.category] ?? c.category}</p>
                        <span className="text-[13px] px-1.5 py-0.5 rounded-full font-medium"
                          style={{ backgroundColor: s?.bg, color: s?.text }}>{s?.label}</span>
                      </div>
                      <span className="text-xs font-bold text-red-500 shrink-0 bg-red-50 px-2 py-0.5 rounded-lg">{days} วัน</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
