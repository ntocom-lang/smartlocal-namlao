import { useState, useEffect } from 'react'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'
import { Wrench, TrendingUp, AlertTriangle, Printer, X, Clock, CheckCircle2, Download } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { workingDaysBetween, workingDaysSince } from '../../lib/workingDays'
import { GOV_ESERVICE_ORIGIN_CSS, GOV_FONT_LINK, govDocFontCss, govEServiceOriginText, govPageCss } from '../../lib/govDocStyle.js'

// ระยะเวลาดำเนินการของคำร้อง 1 เรื่อง นับเป็น "วันทำการ" (ตัดเสาร์-อาทิตย์และวันหยุดนักขัตฤกษ์)
// เดิมนับเป็นวันปฏิทิน ทำให้เรื่องที่คร่อมสงกรานต์/ปีใหม่ดูเหมือนช้ากว่าความเป็นจริงหลายวัน
const resolutionDays = c => workingDaysBetween(c.created_at, c.updated_at) ?? 0

const STATUS = {
  new:         { label: 'คำร้องใหม่',      color: '#f59e0b', bg: '#fef3c7', text: '#92400e' },
  pending:     { label: 'รอดำเนินการ',    color: '#f59e0b', bg: '#fef3c7', text: '#92400e' },
  received:    { label: 'รับเรื่องแล้ว',   color: '#3b82f6', bg: '#dbeafe', text: '#1e40af' },
  in_progress: { label: 'กำลังดำเนินการ', color: '#8b5cf6', bg: '#ede9fe', text: '#5b21b6' },
  done:        { label: 'รอปิดเรื่อง',     color: '#f97316', bg: '#ffedd5', text: '#9a3412' },
  completed:   { label: 'เสร็จสิ้น',      color: '#10b981', bg: '#d1fae5', text: '#065f46' },
  closed:      { label: 'ปิดเรื่องแล้ว',   color: '#10b981', bg: '#d1fae5', text: '#065f46' },
  rejected:    { label: 'ปฏิเสธ',         color: '#ef4444', bg: '#fee2e2', text: '#991b1b' },
}
const CLOSED_STATUSES = new Set(['completed', 'closed'])
const isClosedStatus = status => CLOSED_STATUSES.has(status)
let CATEGORY_LABEL = {
  road: 'ถนน/ทางสาธารณะ', light: 'ไฟฟ้าส่องสว่าง',
  trash: 'ขยะ/ความสะอาด', water: 'น้ำประปา',
  flood: 'น้ำท่วม/ระบายน้ำ', tree: 'ต้นไม้/สวนสาธารณะ',
  noise: 'เหตุรำคาญ', disease: 'ควบคุมโรคติดต่อ', other: 'อื่นๆ',
}
let CATEGORY_EMOJI = {
  road: '🛣️', light: '💡', trash: '🗑️', water: '🚰',
  flood: '🌊', tree: '🌳', noise: '📢', drain: '🕳️', disease: '🏥',
}
const MONTHS_TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
const MONTHS_FULL_TH = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']

function handlePrint({ view, viewLabel, total, completed, rejected, active, rate, avgDays, catData, trend, tenant }) {
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
  ${GOV_FONT_LINK}
  <style>
    ${govPageCss({ size: 'A4 portrait' })}
    body { ${govDocFontCss()} color: #000; }
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
    .eservice-origin { ${GOV_ESERVICE_ORIGIN_CSS} margin-top: 16px; text-align: right; }
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
  <p>อัตราการปิดงาน <b>${rate}%</b>${avgDays !== null ? ` &nbsp;|&nbsp; เฉลี่ยระยะเวลาดำเนินการ <b>${avgDays} วันทำการ</b>` : ''}</p>
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
  <div class="eservice-origin">${govEServiceOriginText(tenant)}</div>
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
  const [cat, setCat]     = useState('all')

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

  // รายการประเภทสำหรับ dropdown — เอาเฉพาะประเภทที่มีคำร้องจริง เรียงตามจำนวนมาก→น้อย
  const catTotals = {}
  complaints.forEach(c => { if (c.category) catTotals[c.category] = (catTotals[c.category] || 0) + 1 })
  const catOptions = Object.entries(catTotals).sort((a, b) => b[1] - a[1])
  const catLabel = cat === 'all' ? null : (CATEGORY_LABEL[cat] ?? cat)
  const scoped = cat === 'all' ? complaints : complaints.filter(c => c.category === cat)

  const viewData = scoped.filter(c => {
    const d = new Date(c.created_at)
    if (view === 'month') return d.getMonth() === month && d.getFullYear() === year
    if (view === 'year')  return d.getFullYear() === year
    return true
  })

  const total     = viewData.length
  const completed = viewData.filter(c => isClosedStatus(c.status)).length
  const rejected  = viewData.filter(c => c.status === 'rejected').length
  const active    = total - completed - rejected
  const rate      = total > 0 ? Math.round(completed / total * 100) : 0

  const closedData = scoped.filter(c => {
    if (!isClosedStatus(c.status)) return false
    const d = new Date(c.updated_at)
    if (view === 'month') return d.getMonth() === month && d.getFullYear() === year
    if (view === 'year')  return d.getFullYear() === year
    return true
  })
  const avgDays = closedData.length > 0
    ? Math.round(closedData.reduce((s, c) => s + resolutionDays(c), 0) / closedData.length)
    : null

  const prevMonth = month === 0 ? 11 : month - 1
  const prevYear  = month === 0 ? year - 1 : year
  const prevData  = view === 'month'
    ? scoped.filter(c => { const d = new Date(c.created_at); return d.getMonth() === prevMonth && d.getFullYear() === prevYear })
    : []
  const prevTotal     = prevData.length
  const prevCompleted = prevData.filter(c => isClosedStatus(c.status)).length
  const prevRate      = prevTotal > 0 ? Math.round(prevCompleted / prevTotal * 100) : 0
  const prevClosedData = scoped.filter(c => {
    if (!isClosedStatus(c.status)) return false
    const d = new Date(c.updated_at)
    return d.getMonth() === prevMonth && d.getFullYear() === prevYear
  })
  const prevAvgDays = prevClosedData.length > 0
    ? Math.round(prevClosedData.reduce((s, c) => s + resolutionDays(c), 0) / prevClosedData.length)
    : null

  const slaIn3    = closedData.filter(c => resolutionDays(c) <= 3).length
  const slaIn7    = closedData.filter(c => resolutionDays(c) <= 7).length
  const slaIn14   = closedData.filter(c => resolutionDays(c) <= 14).length
  const slaOver14 = closedData.length - slaIn14
  const slaRate7  = closedData.length > 0 ? Math.round(slaIn7 / closedData.length * 100) : null

  const techMap = {}
  scoped.filter(c => isClosedStatus(c.status) && c.assigned_to).forEach(c => {
    const tech = technicians.find(t => t.id === c.assigned_to)
    const name = tech?.full_name || tech?.email || null
    if (!name) return
    if (!techMap[name]) techMap[name] = { name, completed: 0, totalDays: 0 }
    techMap[name].completed++
    techMap[name].totalDays += resolutionDays(c)
  })
  const techLeaderboard = Object.values(techMap)
    .map(t => ({ ...t, avgDays: Math.round(t.totalDays / t.completed) }))
    .sort((a, b) => b.completed - a.completed).slice(0, 5)

  const trend = view === 'all'
    ? years.slice().reverse().map(y => {
        const cs = scoped.filter(c => new Date(c.created_at).getFullYear() === y)
        return { label: String(y + 543), submitted: cs.length, completed: cs.filter(c => isClosedStatus(c.status)).length }
      })
    : view === 'year'
    ? Array.from({ length: 12 }, (_, i) => {
        const cs = scoped.filter(c => { const d = new Date(c.created_at); return d.getMonth() === i && d.getFullYear() === year })
        return { label: MONTHS_TH[i], submitted: cs.length, completed: cs.filter(c => isClosedStatus(c.status)).length }
      })
    : Array.from({ length: 4 }, (_, i) => {
        const weekStart = i * 7 + 1
        const weekEnd   = i === 3 ? 31 : weekStart + 6
        const cs = scoped.filter(c => { const d = new Date(c.created_at); return d.getMonth() === month && d.getFullYear() === year && d.getDate() >= weekStart && d.getDate() <= weekEnd })
        return { label: `สัปดาห์ ${i + 1}`, submitted: cs.length, completed: cs.filter(c => isClosedStatus(c.status)).length }
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

  // เกณฑ์ค้างงานนับเป็นวันทำการเช่นกัน — คำร้องที่ยื่นก่อนวันหยุดยาวจะไม่ถูกตีว่าค้าง
  // ทั้งที่สำนักงานยังไม่ได้เปิดทำการ
  const overdue = scoped
    .filter(c => !['completed', 'closed', 'rejected'].includes(c.status) && workingDaysSince(c.created_at, now) > 15)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).slice(0, 6)
  const noTechAction = scoped
    .filter(c => c.status === 'received' && workingDaysSince(c.updated_at, now) > 7)
    .sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at)).slice(0, 6)

  const rateColor = rate >= 70 ? '#10b981' : rate >= 40 ? '#f59e0b' : '#ef4444'
  const periodLabel = view === 'month' ? `${MONTHS_FULL_TH[month]} ${year + 543}` : view === 'year' ? `ปี ${year + 543}` : 'ทั้งหมด'
  const viewLabel = catLabel ? `${periodLabel} เฉพาะประเภท${catLabel}` : periodLabel

  // เลือกประเภทเดียวแล้ว การ์ดสัดส่วน "ประเภท" ไม่มีความหมาย → สลับไปดูสัดส่วนสถานะแทน
  const statusCount = {}
  viewData.forEach(c => { statusCount[c.status] = (statusCount[c.status] || 0) + 1 })
  const statusData = Object.entries(statusCount)
    .map(([value, count]) => ({ name: STATUS[value]?.label ?? value, color: STATUS[value]?.color ?? '#94a3b8', count }))
    .sort((a, b) => b.count - a.count)
  const breakdown = catLabel
    ? { title: `สถานะคำร้อง${catLabel}`, pie: statusData, list: statusData, colorOf: d => d.color }
    : {
        title: view === 'all' ? 'ประเภทคำร้องทั้งหมด' : view === 'year' ? `ประเภทคำร้องปี ${year + 543}` : `ประเภทคำร้อง${MONTHS_FULL_TH[month]}นี้`,
        pie: catPieData, list: catData, colorOf: (d, i) => CAT_COLORS[i % CAT_COLORS.length],
      }

  function exportCsv() {
    const rows = [
      ['เลขที่', 'วันที่', 'ผู้ร้อง', 'โทรศัพท์', 'ประเภท', 'รายละเอียด', 'สถานที่', 'สถานะ'],
      ...viewData.map(c => [
        c.ref_no || c.complaint_number || c.id.slice(0, 8).toUpperCase(),
        new Date(c.created_at).toLocaleDateString('th-TH'),
        c.reporter_name ?? c.profiles?.full_name ?? '',
        c.phone ?? c.profiles?.phone ?? '',
        CATEGORY_LABEL[c.category] ?? c.category ?? '',
        (c.description ?? '').replace(/\n/g, ' '),
        [c.location_name, c.village].filter(Boolean).join(', '),
        STATUS[c.status]?.label ?? c.status,
      ]),
    ]
    const csv = '﻿' + rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n')
    const link = document.createElement('a')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    link.href = url
    link.download = `คำร้อง_${viewLabel}_${tenant?.name ?? ''}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4 pb-24 md:space-y-5 md:pb-8">
      <section className="relative overflow-hidden rounded-3xl px-5 py-5 text-white shadow-lg shadow-blue-900/10 md:px-6 md:py-6"
        style={{ background: 'linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 56%, #06b6d4 135%)' }}>
        <div className="absolute -right-10 -top-14 h-40 w-40 rounded-full bg-white/10" />
        <div className="absolute -bottom-14 left-1/3 h-32 w-32 rounded-full bg-cyan-300/10" />
        <div className="relative flex items-start gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/20 bg-white/15 shadow-sm backdrop-blur">
            <TrendingUp size={23} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-white/70">Staff Analytics</p>
            <h2 className="mt-0.5 text-xl font-extrabold tracking-tight">รายงานผลการดำเนินงาน</h2>
            <p className="mt-1 truncate text-xs text-white/75">{viewLabel} · {tenant?.name}</p>
          </div>
        </div>
        <div className="relative mt-4 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
          <button onClick={exportCsv}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/15 px-3 text-xs font-bold text-white backdrop-blur transition hover:bg-white/25 active:scale-[0.98]">
            <Download size={15} /> ดาวน์โหลด CSV
          </button>
          <button onClick={() => handlePrint({ view, month, year, viewLabel, total, completed, rejected, active, rate, avgDays, catData, trend, tenant })}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-white px-3 text-xs font-extrabold text-blue-700 shadow-sm transition hover:bg-blue-50 active:scale-[0.98]">
            <Printer size={15} /> พิมพ์รายงาน
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
          {[['month', 'รายเดือน'], ['year', 'รายปี'], ['all', 'ทั้งหมด']].map(([value, label]) => (
            <button key={value} onClick={() => setView(value)}
              className={`min-h-9 rounded-lg px-2 text-xs font-bold transition-all ${view === value ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value={cat} onChange={event => setCat(event.target.value)}
            className={`min-h-10 min-w-0 flex-1 basis-full rounded-xl border bg-white px-3 text-sm font-semibold outline-none focus:border-blue-400 sm:basis-44 ${cat === 'all' ? 'border-slate-200 text-slate-700' : 'border-blue-300 text-blue-700'}`}
            aria-label="กรองตามประเภทคำร้อง">
            <option value="all">ทุกประเภท</option>
            {catOptions.map(([value, count]) => (
              <option key={value} value={value}>
                {CATEGORY_EMOJI[value] ? `${CATEGORY_EMOJI[value]} ` : ''}{CATEGORY_LABEL[value] ?? value} ({count})
              </option>
            ))}
          </select>
          {view === 'month' && (
            <select value={month} onChange={event => setMonth(+event.target.value)}
              className="min-h-10 min-w-0 flex-1 basis-24 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-blue-400">
              {MONTHS_TH.map((label, index) => <option key={label} value={index}>{label}</option>)}
            </select>
          )}
          {view !== 'all' && (
            <select value={year} onChange={event => setYear(+event.target.value)}
              className="min-h-10 min-w-0 flex-1 basis-28 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-blue-400">
              {years.map(value => <option key={value} value={value}>พ.ศ. {value + 543}</option>)}
            </select>
          )}
          {(view !== 'month' || month !== now.getMonth() || year !== now.getFullYear() || cat !== 'all') && (
            <button onClick={() => { setView('month'); setMonth(now.getMonth()); setYear(now.getFullYear()); setCat('all') }}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 transition hover:bg-red-50 hover:text-red-500"
              aria-label="ล้างตัวกรอง" title="ล้างตัวกรอง กลับไปเดือนปัจจุบัน">
              <X size={15} />
            </button>
          )}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
        {[
          { label: 'คำร้องที่รับเข้า', value: total, color: '#2563eb', bg: '#eff6ff', sub: 'รายการ', delta: view === 'month' ? total - prevTotal : null, unit: '' },
          { label: 'ปิดเรื่องแล้ว', value: completed, color: '#059669', bg: '#ecfdf5', sub: 'รายการ', delta: view === 'month' ? completed - prevCompleted : null, unit: '' },
          { label: 'อัตราปิดเรื่อง', value: `${rate}%`, color: rateColor, bg: rate >= 70 ? '#ecfdf5' : rate >= 40 ? '#fffbeb' : '#fef2f2', sub: rate >= 70 ? 'ผลการดำเนินงานดี' : rate >= 40 ? 'ควรติดตาม' : 'ต้องเร่งดำเนินการ', delta: view === 'month' && prevTotal > 0 ? rate - prevRate : null, unit: '%' },
          { label: 'เวลาเฉลี่ยปิดเรื่อง', value: avgDays !== null ? avgDays : '—', color: '#7c3aed', bg: '#f5f3ff', sub: avgDays !== null ? 'วันทำการ' : 'ไม่มีข้อมูล', delta: view === 'month' && avgDays !== null && prevAvgDays !== null ? prevAvgDays - avgDays : null, unit: 'วันทำการ' },
        ].map(({ label, value, color, bg, sub, delta, unit }) => (
          <div key={label} className="relative overflow-hidden rounded-2xl border border-white p-3.5 shadow-sm md:p-4"
            style={{ background: `linear-gradient(145deg, #ffffff 20%, ${bg} 125%)` }}>
            <span className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full shadow-sm" style={{ backgroundColor: color }} />
            <p className="text-2xl font-black leading-none md:text-3xl" style={{ color }}>{value}</p>
            <p className="mt-1 text-[10px] font-semibold text-slate-400">{sub}</p>
            <p className="mt-1 text-[11px] font-bold leading-tight text-slate-700 md:text-xs">{label}</p>
            {delta !== null && (
              <p className={`mt-1.5 text-[10px] font-semibold ${delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-red-500' : 'text-slate-400'}`}>
                {delta > 0 ? '↑' : delta < 0 ? '↓' : '='} {delta !== 0 ? `${Math.abs(delta)}${unit} จากเดือนก่อน` : 'เท่าเดิม'}
              </p>
            )}
          </div>
        ))}
      </div>

      {closedData.length > 0 && (
        <div className="rounded-3xl border border-blue-100 bg-white p-4 shadow-sm md:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-extrabold text-slate-800">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Clock size={15} /></span>
              ระยะเวลาปิดเรื่อง (วันทำการ)
            </h3>
            {slaRate7 !== null && (
              <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${slaRate7 >= 70 ? 'bg-emerald-50 text-emerald-700' : slaRate7 >= 40 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>
                {slaRate7}% ภายใน 7 วันทำการ
              </span>
            )}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: '0–3 วันทำการ',  count: slaIn3,            color: '#10b981', bg: '#d1fae5', emoji: '🟢' },
              { label: '4–7 วันทำการ',  count: slaIn7 - slaIn3,   color: '#3b82f6', bg: '#dbeafe', emoji: '🔵' },
              { label: '8–14 วันทำการ', count: slaIn14 - slaIn7,  color: '#f59e0b', bg: '#fef3c7', emoji: '🟡' },
              { label: '15+ วันทำการ',  count: slaOver14,          color: '#ef4444', bg: '#fee2e2', emoji: '🔴' },
            ].map(({ label, count, color, bg, emoji }) => (
              <div key={label} className="rounded-2xl px-1.5 py-3 text-center" style={{ backgroundColor: bg }}>
                <p className="mb-1 text-[9px]">{emoji}</p>
                <p className="text-xl font-black leading-none md:text-2xl" style={{ color }}>{count}</p>
                <p className="mt-1 text-[10px] font-bold" style={{ color }}>{label}</p>
                <p className="mt-0.5 text-[9px]" style={{ color, opacity: 0.7 }}>
                  {closedData.length > 0 ? `${Math.round(count / closedData.length * 100)}%` : '—'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.25fr_.75fr]">
      <div className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm md:p-5">
        <h3 className="mb-4 text-sm font-extrabold text-slate-800">
          {view === 'all' ? 'แนวโน้มรายปี' : view === 'year' ? `แนวโน้มรายเดือน ปี ${year + 543}` : `แนวโน้มรายสัปดาห์ ${MONTHS_FULL_TH[month]} ${year + 543}`}
        </h3>
        {scoped.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-gray-400 text-sm">ยังไม่มีข้อมูล</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={trend} barGap={4} barSize={16}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} allowDecimals={false} />
              <Tooltip formatter={(val, name) => [val, name === 'submitted' ? 'รับเข้า' : 'เสร็จสิ้น']}
                contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6', fontSize: 12 }} />
              <Legend iconType="circle" iconSize={8}
                formatter={v => <span className="text-xs text-gray-600">{v === 'submitted' ? 'รับเข้า' : 'เสร็จสิ้น'}</span>} />
              <Bar dataKey="submitted" name="submitted" fill="var(--color-primary)" radius={[7,7,0,0]} opacity={0.78} />
              <Bar dataKey="completed" name="completed" fill="#10b981" radius={[7,7,0,0]} opacity={0.9} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm md:p-5">
        <h3 className="mb-4 text-sm font-extrabold text-slate-800">{breakdown.title}</h3>
        {breakdown.list.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">ไม่มีข้อมูล</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={breakdown.pie} cx="50%" cy="50%" innerRadius={48} outerRadius={78}
                  dataKey="count" nameKey="name" paddingAngle={2}
                  label={({ cx, cy, midAngle, outerRadius, count }) => {
                    const RADIAN = Math.PI / 180
                    const x = cx + (outerRadius + 14) * Math.cos(-midAngle * RADIAN)
                    const y = cy + (outerRadius + 14) * Math.sin(-midAngle * RADIAN)
                    return <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700} fill="#374151">{count}</text>
                  }}
                  labelLine={{ stroke: '#d1d5db', strokeWidth: 1 }}>
                  {breakdown.pie.map((d, i) => <Cell key={i} fill={breakdown.colorOf(d, i)} />)}
                </Pie>
                <Tooltip formatter={(value, name) => [`${value} รายการ`, name]}
                  contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6', fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2.5 mt-2">
              {breakdown.list.map((item, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-gray-700 font-medium flex items-center gap-2 truncate">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: breakdown.colorOf(item, i) }} />
                      {item.emoji && <span>{item.emoji}</span>} {item.name}
                    </span>
                    <span className="text-gray-500 shrink-0 ml-2 font-semibold">{item.count}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${item.count / breakdown.list[0].count * 100}%`, backgroundColor: breakdown.colorOf(item, i), opacity: 0.75 }} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      </div>

      {techLeaderboard.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <Wrench size={14} className="text-orange-500" /> ผลงานช่าง
            <span className="text-xs font-normal text-gray-400 ml-auto">ตลอดทุกช่วงเวลา{catLabel ? ` · ${catLabel}` : ''}</span>
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
                    <p className="text-[11px] text-gray-400">เฉลี่ย {t.avgDays} วันทำการ/งาน</p>
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
              <Clock size={14} className="text-orange-500" /> รอช่างรับงานเกิน 7 วันทำการ
            </h3>
            <p className="text-xs text-gray-400 mb-4">ค้างเกิน 7 วันทำการหลังรับเรื่อง · ทั้งระบบ {noTechAction.length} รายการ</p>
            {noTechAction.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                <CheckCircle2 size={28} className="text-green-400 mb-2" />
                <p className="text-sm text-green-600 font-medium">ช่างรับงานทุกรายการแล้ว</p>
              </div>
            ) : (
              <div className="space-y-0 divide-y divide-gray-50">
                {noTechAction.map(c => {
                  const days = workingDaysSince(c.updated_at, now)
                  return (
                    <div key={c.id} className="flex items-center gap-3 py-2.5">
                      <span className="text-lg shrink-0">{CATEGORY_EMOJI[c.category] ?? '📄'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-700 truncate">{CATEGORY_LABEL[c.category] ?? c.category}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                          {c.assigned_to_name ? `ช่าง: ${c.assigned_to_name}` : c.assigned_to ? 'มอบหมายแล้ว ยังไม่รับงาน' : 'ยังไม่ได้มอบหมายช่าง'}
                        </p>
                      </div>
                      <span className="text-xs font-bold text-orange-500 shrink-0 bg-orange-50 px-2 py-0.5 rounded-lg">{days} วันทำการ</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
              <AlertTriangle size={14} className="text-amber-500" /> คำร้องค้างเกิน 15 วันทำการ
            </h3>
            <p className="text-xs text-gray-400 mb-4">ค้างเกิน 15 วันทำการ · ทั้งระบบ {overdue.length} รายการ</p>
            {overdue.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                <CheckCircle2 size={28} className="text-green-400 mb-2" />
                <p className="text-sm text-green-600 font-medium">ไม่มีคำร้องค้าง</p>
              </div>
            ) : (
              <div className="space-y-0 divide-y divide-gray-50">
                {overdue.map(c => {
                  const days = workingDaysSince(c.created_at, now)
                  const s = STATUS[c.status]
                  return (
                    <div key={c.id} className="flex items-center gap-3 py-2.5">
                      <span className="text-lg shrink-0">{CATEGORY_EMOJI[c.category] ?? '📄'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-700 truncate">{CATEGORY_LABEL[c.category] ?? c.category}</p>
                        <span className="text-[13px] px-1.5 py-0.5 rounded-full font-medium"
                          style={{ backgroundColor: s?.bg, color: s?.text }}>{s?.label}</span>
                      </div>
                      <span className="text-xs font-bold text-red-500 shrink-0 bg-red-50 px-2 py-0.5 rounded-lg">{days} วันทำการ</span>
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
