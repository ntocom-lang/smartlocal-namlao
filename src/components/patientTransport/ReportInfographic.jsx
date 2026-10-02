import { useEffect, useMemo, useState } from 'react'
import { Ambulance, Download, Share2 } from 'lucide-react'
import { buttonClass, primaryClass, monthReportSummary } from '../../lib/patientBooking'

const COLORS = { ink: '#16324f', green: '#059669', blue: '#0284c7', paper: '#f0f7fc', muted: '#52647a' }
const PIE_COLORS = ['#7c3aed', '#ea580c', '#0891b2', '#db2777', '#b45309', '#0f766e', '#4f46e5', '#64748b']
const PIE_NOTE = 'คิดจากเที่ยวทั้งหมดในเดือนที่เลือก · เปอร์เซ็นต์ปัดเศษไม่เกิน 1 ตำแหน่ง'
const SOURCE = 'แหล่งข้อมูล: ระบบรถรับ–ส่งผู้ป่วย SmartLocal · ตามวันเดินทาง · ไม่รวมเที่ยวที่ยกเลิก'
const RULE = 'ผู้เดินทางนับคนละ 1 ครั้งต่อเที่ยว · ระยะทางนับเฉพาะเที่ยวที่จบและเลขไมล์ใช้ได้'

function reportModel(tenantName, month, trips) {
  const rows = trips.filter(t => t.state !== 'cancelled')
  const hospitals = new Map()
  for (const trip of rows) {
    const name = trip.route_label?.trim() || 'ไม่ระบุโรงพยาบาล'
    const group = hospitals.get(name) || { name, completed: 0, pending: 0 }
    group[trip.state === 'completed' ? 'completed' : 'pending']++
    hospitals.set(name, group)
  }
  const sorted = [...hospitals.values()].sort((a, b) => b.completed + b.pending - a.completed - a.pending || a.name.localeCompare(b.name, 'th'))
  // ภาพเดียวต้องอ่านได้: เมื่อเกิน 8 แห่ง รวมที่เหลืออย่างชัดเจน โดยยังนับทุกเที่ยว
  const groups = sorted.length <= 8 ? sorted : [...sorted.slice(0, 7), sorted.slice(7).reduce((group, row) => ({ ...group, completed: group.completed + row.completed, pending: group.pending + row.pending }), { name: `อื่น ๆ (รวม ${sorted.length - 7} โรงพยาบาล)`, completed: 0, pending: 0 })]
  let cumulative = 0
  const slices = groups.map((group, index) => {
    const count = group.completed + group.pending
    const start = cumulative / rows.length
    cumulative += count
    return { name: group.name, count, start, end: cumulative / rows.length, color: PIE_COLORS[index], percent: (count / rows.length * 100).toLocaleString('th-TH', { maximumFractionDigits: 1 }) }
  })
  const summary = monthReportSummary(rows)
  const monthLabel = new Date(`${month}-01T00:00:00+07:00`).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', month: 'long', year: 'numeric' })
  const graphNote = sorted.length > 8 ? 'แสดง 7 โรงพยาบาลที่มีเที่ยวมากที่สุด และรวมแห่งที่เหลือในกลุ่มอื่น ๆ' : 'เปรียบเทียบจำนวนเที่ยวทั้งหมดในเดือนที่เลือก'
  const metrics = [
    { label: 'จบเที่ยวแล้ว', value: `${summary.completed} เที่ยว`, hint: 'ให้บริการเสร็จแล้ว', color: '#047857', background: '#e7f7ef' },
    { label: 'เที่ยวที่ยังไม่จบ', value: `${summary.pending} เที่ยว`, hint: 'ยืนยันแล้ว / กำลังให้บริการ / เหตุขัดข้อง', color: '#0369a1', background: '#e8f5fd' },
    { label: 'ให้บริการผู้เดินทาง', value: `${summary.passengers} ครั้ง`, hint: `นับคนละ 1 ครั้งต่อเที่ยว · ผู้ติดตาม ${summary.companions} ครั้ง`, color: '#4338ca', background: '#eeedfc' },
    { label: 'ระยะทางที่บันทึกแล้ว', value: `${summary.distance.toLocaleString('th-TH')} กม.`, hint: !summary.completed ? 'ยังไม่มีเที่ยวที่จบในเดือนนี้' : summary.missingDistance ? `ยังไม่มีระยะทางที่ใช้ได้ ${summary.missingDistance} เที่ยวที่จบ` : 'มีระยะทางครบทุกเที่ยวที่จบ', color: '#92400e', background: '#fff5df' },
  ]
  return { tenantName, month, monthLabel, groups, slices, graphNote, metrics, total: rows.length, max: Math.max(1, ...groups.map(g => g.completed + g.pending)) }
}

function shareText(model) {
  return [
    `รถรับ–ส่งผู้ป่วย | ${model.tenantName}`,
    `【สรุปเดือน${model.monthLabel}】\nเที่ยวทั้งหมด ${model.total} เที่ยว\n${model.metrics.map(m => `${m.label}: ${m.value}`).join('\n')}`,
    `【เที่ยวรถแยกตามโรงพยาบาล】\n${model.groups.length ? model.groups.map(g => `${g.name}: จบ ${g.completed} เที่ยว · ยังไม่จบ ${g.pending} เที่ยว`).join('\n') : 'ไม่มีเที่ยวรถในเดือนนี้'}\n${model.graphNote}`,
    `【สัดส่วนเที่ยวรถตามโรงพยาบาล】\n${model.slices.length ? model.slices.map(slice => `${slice.name}: ${slice.count} เที่ยว (${slice.percent}%)`).join('\n') : 'ไม่มีเที่ยวรถในเดือนนี้'}\n${PIE_NOTE}`,
    `【วิธีนับ】\n${RULE}\n${model.metrics[3].hint}`,
    `【แหล่งข้อมูล】\n${SOURCE}\nจากข้อมูลที่โหลดในหน้ารายงาน`,
  ].join('\n\n')
}

// วาดจากข้อมูลรวมที่ใช้บนจอเท่านั้น ไม่จับภาพ DOM ที่มีชื่อผู้ป่วย โทรศัพท์ หรือจุดรับ
async function infographicFile(model) {
  await document.fonts.ready
  const canvas = document.createElement('canvas')
  canvas.width = 1080
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas unavailable')
  const font = (size, bold = false) => `${bold ? '700' : '400'} ${size}px Tahoma, Arial, sans-serif`
  const segments = value => typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(value)].map(s => s.segment) : Array.from(value)
  const lines = (value, width, size, bold = false) => {
    context.font = font(size, bold)
    const result = []; let line = ''
    for (const char of segments(String(value))) {
      if (line && context.measureText(line + char).width > width) { result.push(line.trim()); line = char }
      else line += char
    }
    if (line) result.push(line.trim())
    return result
  }
  const agencyLines = lines(model.tenantName, 944, 32, true)
  const graphRows = model.groups.map(group => ({ ...group, lines: lines(group.name, 944, 30, true) }))
  const chartHeight = graphRows.length ? graphRows.reduce((height, row) => height + row.lines.length * 42 + 146.4, 0) : 100
  const pieLegendHeight = model.slices.reduce((height, slice) => height + lines(slice.name, 508, 28, true).length * 39.2 + 83.6, 0)
  const piePlotHeight = Math.max(280, pieLegendHeight)
  const pieHeight = model.slices.length ? 78 + piePlotHeight + 80 : 160
  const headerHeight = 232 + agencyLines.length * 42
  // ขนาดภาพโตตามข้อความภาษาไทยและจำนวนโรงพยาบาล ไม่ตัดชื่อหรือคำอธิบายทิ้ง
  const lastLine = 'จากข้อมูลที่โหลดในหน้ารายงาน · ภาพสรุปนี้ไม่มีข้อมูลระบุตัวผู้ป่วย'
  const footerHeight = [model.graphNote, RULE, SOURCE, lastLine].reduce((height, value) => height + lines(value, 944, 24).length * 33.6, 0) + 160
  canvas.height = Math.ceil(headerHeight + 590 + pieHeight + chartHeight + footerHeight)
  const text = (value, x, y, width, size = 28, color = COLORS.ink, bold = false) => {
    context.font = font(size, bold); context.fillStyle = color
    for (const line of lines(value, width, size, bold)) { context.fillText(line, x, y); y += size * 1.4 }
    return y
  }
  const box = (x, y, width, height, color) => { context.fillStyle = color; context.fillRect(x, y, width, height) }
  box(0, 0, 1080, canvas.height, '#ffffff')
  box(0, 0, 1080, headerHeight, COLORS.ink)
  box(64, 48, 8, 80, '#38bdf8')
  text('รถรับ–ส่งผู้ป่วย', 96, 94, 880, 52, '#ffffff', true)
  text(`สรุปการให้บริการ · ${model.monthLabel}`, 96, 150, 880, 32, '#bae6fd')
  text(model.tenantName, 64, 210, 944, 32, '#ffffff', true)
  let y = headerHeight + 38
  for (let index = 0; index < model.metrics.length; index++) {
    const metric = model.metrics[index]
    const x = index % 2 ? 556 : 64
    const top = y + Math.floor(index / 2) * 202
    box(x, top, 460, 182, metric.background)
    text(metric.label, x + 24, top + 42, 412, 29, metric.color, true)
    text(metric.value, x + 24, top + 104, 412, 48, metric.color, true)
    text(metric.hint, x + 24, top + 141, 412, 23, COLORS.muted)
  }
  y += 424
  text('สัดส่วนเที่ยวรถแยกตามโรงพยาบาล', 64, y + 38, 944, 33, COLORS.ink, true)
  if (model.slices.length) {
    const top = y + 78
    const cx = 254; const cy = top + piePlotHeight / 2
    for (const slice of model.slices) {
      context.beginPath()
      if (model.slices.length > 1) context.moveTo(cx, cy)
      context.arc(cx, cy, 140, slice.start * Math.PI * 2 - Math.PI / 2, slice.end * Math.PI * 2 - Math.PI / 2)
      context.closePath(); context.fillStyle = slice.color; context.fill()
      context.strokeStyle = '#ffffff'; context.lineWidth = 2; context.stroke()
    }
    let legendY = top
    for (const slice of model.slices) {
      box(472, legendY + 4, 24, 24, slice.color)
      legendY = text(slice.name, 508, legendY + 24, 508, 28, COLORS.ink, true)
      legendY = text(`${slice.count} เที่ยว · ${slice.percent}%`, 508, legendY + 8, 508, 24, COLORS.muted) + 18
    }
    text(PIE_NOTE, 64, top + piePlotHeight + 40, 944, 24, COLORS.muted)
  } else text('ไม่มีเที่ยวรถในเดือนที่เลือก จึงยังไม่มีสัดส่วนให้แสดง', 64, y + 94, 944, 26, COLORS.muted)
  y += pieHeight
  text(`เที่ยวรถแยกตามโรงพยาบาล · ${model.total} เที่ยว`, 64, y + 38, 944, 33, COLORS.ink, true)
  y += 76
  box(64, y - 20, 24, 24, COLORS.green); text('จบเที่ยวแล้ว', 100, y, 390, 26)
  box(556, y - 20, 24, 24, COLORS.blue); text('เที่ยวที่ยังไม่จบ', 592, y, 424, 26)
  y += 52
  if (!graphRows.length) { text('ไม่มีเที่ยวรถในเดือนที่เลือก', 64, y + 36, 944, 32, COLORS.muted); y += 100 }
  for (const group of graphRows) {
    y = text(group.name, 64, y + 28, 944, 30, COLORS.ink, true)
    box(64, y, 944, 28, '#e9eef4')
    const completedWidth = group.completed / model.max * 944
    const pendingWidth = group.pending / model.max * 944
    if (completedWidth) box(64, y, completedWidth, 28, COLORS.green)
    if (pendingWidth) box(64 + completedWidth, y, pendingWidth, 28, COLORS.blue)
    y = text(`จบ ${group.completed} เที่ยว · ยังไม่จบ ${group.pending} เที่ยว · รวม ${group.completed + group.pending} เที่ยว`, 64, y + 66, 944, 26, COLORS.muted) + 16
  }
  y = text(model.graphNote, 64, y + 20, 944, 24, COLORS.muted)
  box(64, y + 8, 944, 2, '#dbe5ef')
  y = text(RULE, 64, y + 52, 944, 24, COLORS.muted)
  y = text(SOURCE, 64, y + 12, 944, 24, COLORS.muted)
  text(lastLine, 64, y + 12, 944, 24, COLORS.muted)
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Cannot create PNG')
  return new File([blob], `patient-transport-${model.month}.png`, { type: 'image/png' })
}


function piePath(start, end) {
  const point = fraction => [100 + 86 * Math.cos(fraction * Math.PI * 2 - Math.PI / 2), 100 + 86 * Math.sin(fraction * Math.PI * 2 - Math.PI / 2)]
  const [x1, y1] = point(start); const [x2, y2] = point(end)
  return `M 100 100 L ${x1} ${y1} A 86 86 0 ${end - start > 0.5 ? 1 : 0} 1 ${x2} ${y2} Z`
}

export default function ReportInfographic({ tenantName, month, trips }) {
  const model = useMemo(() => reportModel(tenantName || 'หน่วยงาน', month, trips), [tenantName, month, trips])
  const key = JSON.stringify(model)
  const [prepared, setPrepared] = useState(null)
  const [retry, setRetry] = useState(0)
  const [sharing, setSharing] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    let active = true
    infographicFile(model).then(file => { if (active) setPrepared({ key, file }) }).catch(() => { if (active) setPrepared({ key, error: 'เตรียมภาพไม่สำเร็จ กรุณาลองอีกครั้ง' }) })
    return () => { active = false }
  }, [model, key, retry])
  const file = prepared?.key === key ? prepared.file : null
  const error = prepared?.key === key ? prepared.error : ''
  const download = () => {
    if (!file) return
    const url = URL.createObjectURL(file)
    const link = document.createElement('a'); link.href = url; link.download = file.name; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
  const share = async () => {
    if (!file || sharing) return
    setMessage('')
    try {
      if (!navigator.share || !navigator.canShare?.({ files: [file] })) {
        setMessage('เครื่องนี้ไม่รองรับแชร์ภาพโดยตรง กดดาวน์โหลด PNG แล้วแนบภาพใน LINE หรือ Facebook ได้')
        return
      }
      setSharing(true)
      // ภาพเตรียมล่วงหน้าแล้ว เรียก share ในการกดครั้งนี้โดยตรงเพื่อรักษา user activation
      await navigator.share({ files: [file], title: `รถรับ–ส่งผู้ป่วย | ${model.tenantName}`, text: shareText(model) })
    } catch (cause) {
      if (cause?.name !== 'AbortError') setMessage('เปิดเมนูแชร์ไม่สำเร็จ ลองอีกครั้ง หรือดาวน์โหลด PNG แล้วแนบภาพในแอป')
    } finally { setSharing(false) }
  }
  return <div className="my-4 space-y-3" data-report-visuals>
    <section aria-label="อินโฟกราฟิกสรุปรถรับส่งผู้ป่วย" className="overflow-hidden rounded-2xl border border-sky-200 bg-white">
      <header className="bg-[#16324f] p-4 text-white sm:p-5">
        <div className="flex items-center gap-3"><Ambulance className="size-8 shrink-0 text-sky-300" /><div className="min-w-0"><h3 className="text-xl font-bold">รถรับ–ส่งผู้ป่วย</h3><p className="mt-1 text-sm text-sky-100">สรุปเดือน{model.monthLabel} · {model.total} เที่ยว</p></div></div>
        <p className="mt-3 break-words text-sm text-sky-100">{model.tenantName}</p>
      </header>
      <div className="space-y-5 p-3 sm:p-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{model.metrics.map(metric => <div key={metric.label} data-report-summary={metric.label} className="min-w-0 rounded-xl p-3" style={{ backgroundColor: metric.background }}><h4 className="text-sm font-semibold" style={{ color: metric.color }}>{metric.label}</h4><p className="my-1 text-xl font-bold" style={{ color: metric.color }}>{metric.value}</p><p className="text-xs text-slate-600">{metric.hint}</p></div>)}</div>
        <section aria-label="กราฟวงกลมเที่ยวรถแยกตามโรงพยาบาล">
          <h4 className="font-bold text-slate-900">สัดส่วนเที่ยวรถแยกตามโรงพยาบาล</h4>
          <p className="mt-1 text-xs text-slate-500">รวมทั้งเที่ยวที่จบและยังไม่จบ · ทั้งหมด {model.total} เที่ยว</p>
          {model.slices.length ? <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row">
            <svg viewBox="0 0 200 200" role="img" aria-label={`สัดส่วนเที่ยวรถแต่ละโรงพยาบาล รวม ${model.total} เที่ยว`} className="w-full max-w-[240px] shrink-0">
              <title>สัดส่วนจำนวนเที่ยวรถแยกตามโรงพยาบาล</title>
              {model.slices.map(slice => slice.count === model.total ? <circle key={slice.name} cx="100" cy="100" r="86" fill={slice.color} data-pie-hospital={slice.name}><title>{slice.name} {slice.count} เที่ยว {slice.percent}%</title></circle> : <path key={slice.name} d={piePath(slice.start, slice.end)} fill={slice.color} stroke="white" strokeWidth="1.5" data-pie-hospital={slice.name}><title>{slice.name} {slice.count} เที่ยว {slice.percent}%</title></path>)}
            </svg>
            <ul className="w-full min-w-0 space-y-3">{model.slices.map(slice => <li key={slice.name} data-pie-legend={slice.name} className="flex items-start gap-2 text-sm"><span className="mt-1 size-3 shrink-0 rounded-sm" style={{ backgroundColor: slice.color }} /><div className="min-w-0"><p className="break-words font-semibold text-slate-800">{slice.name}</p><p className="text-slate-600">{slice.count} เที่ยว · {slice.percent}%</p></div></li>)}</ul>
          </div> : <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">ไม่มีเที่ยวรถในเดือนที่เลือก จึงยังไม่มีสัดส่วนให้แสดง</p>}
          <p className="mt-3 text-xs text-slate-500">{PIE_NOTE}</p>
          <p className="mt-1 text-xs text-slate-500">{model.graphNote}</p>
        </section>
        <section aria-label="กราฟแท่งเที่ยวรถแยกตามโรงพยาบาล">
          <h4 className="font-bold text-slate-900">เที่ยวรถแยกตามโรงพยาบาล</h4>
          <p className="mt-1 text-xs text-slate-500">หน่วย: เที่ยว · เรียงจากมากไปน้อย · ไม่ใช่จำนวนผู้เดินทาง</p>
          <div className="my-3 flex flex-wrap gap-x-4 gap-y-2 text-xs"><span className="flex items-center gap-2"><i className="size-3 rounded-sm bg-emerald-600" />จบเที่ยวแล้ว</span><span className="flex items-center gap-2"><i className="size-3 rounded-sm bg-sky-600" />เที่ยวที่ยังไม่จบ</span></div>
          {!model.groups.length && <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">ไม่มีเที่ยวรถในเดือนที่เลือก</p>}
          <div className="space-y-4">{model.groups.map(group => <div key={group.name} data-report-hospital={group.name}>
            <div className="mb-1 flex items-start justify-between gap-3 text-sm"><p className="min-w-0 break-words font-semibold text-slate-800">{group.name}</p><span className="shrink-0 text-slate-500">{group.completed + group.pending} เที่ยว</span></div>
            <div role="img" aria-label={`${group.name}: จบ ${group.completed} เที่ยว ยังไม่จบ ${group.pending} เที่ยว`} className="flex h-5 overflow-hidden rounded bg-slate-100"><span className="bg-emerald-600" style={{ width: `${group.completed / model.max * 100}%` }} /><span className="bg-sky-600" style={{ width: `${group.pending / model.max * 100}%` }} /></div>
            <p className="mt-1 text-xs text-slate-600">จบ {group.completed} · ยังไม่จบ {group.pending}</p>
          </div>)}</div>
          {model.groups.length > 0 && <div className="mt-1 flex justify-between text-[11px] text-slate-500"><span>0</span><span>มากที่สุด {model.max} เที่ยว</span></div>}
          <p className="mt-3 text-xs text-slate-500">{model.graphNote}</p>
        </section>
        <footer className="space-y-2 border-t border-slate-200 pt-3 text-xs text-slate-500"><p>{RULE}</p><p>{SOURCE}</p><p>ภาพสรุปนี้ไม่มีชื่อ เบอร์โทร ที่อยู่ หรือพิกัดของผู้ป่วย</p></footer>
      </div>
    </section>
    <div className="flex flex-wrap gap-2"><button type="button" className={`${buttonClass} flex items-center justify-center gap-2 max-sm:w-full`} disabled={!file} onClick={download}><Download size={16} />ดาวน์โหลดอินโฟกราฟิก PNG</button><button type="button" className={`${primaryClass} flex items-center justify-center gap-2 max-sm:w-full`} disabled={!file || sharing} onClick={share}><Share2 size={16} />{sharing ? 'กำลังเปิดเมนูแชร์...' : 'แชร์อินโฟกราฟิก'}</button></div>
    {!file && !error && <p role="status" className="text-sm text-slate-500">กำลังเตรียมภาพสำหรับดาวน์โหลดและแชร์...</p>}
    {error && <div role="alert" className="text-sm text-rose-700">{error} <button type="button" className={buttonClass} onClick={() => setRetry(value => value + 1)}>ลองเตรียมภาพใหม่</button></div>}
    {message && <p role="status" className="rounded-xl bg-sky-50 p-3 text-sm text-sky-900">{message}</p>}
  </div>
}
