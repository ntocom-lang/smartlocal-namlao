import { useEffect, useState } from 'react'
import { Copy, Download, Globe, MessageCircle, Share2 } from 'lucide-react'
import { appUrl } from '../lib/basename'
import { formatMm, isStale, localWaterSituation, summaryStats, SYNC_STALE_HOURS } from '../lib/waterSituation'

const dateText = value => new Date(value).toLocaleString('th-TH', {
  timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short',
})

// Render locally at a fixed social-image resolution. No remote image/CORS dependency.
async function infographic(tenant, data, now, refreshFailed, url) {
  await document.fonts.ready
  const canvas = document.createElement('canvas')
  canvas.width = 1080
  canvas.height = 1480
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  const box = (x, y, w, h, fill, radius = 24) => {
    ctx.fillStyle = fill
    ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fill()
  }
  const label = (value, x, y, size = 28, color = '#475569', weight = 400, max = 920) => {
    ctx.fillStyle = color
    ctx.font = `${weight} ${size}px Sarabun, sans-serif`
    ctx.fillText(String(value), x, y, max)
  }
  const local = localWaterSituation(data, tenant)
  const stats = summaryStats({ rain: local.stations.filter(s => s.station_type === 'rain'),
    dams: local.stations.filter(s => s.station_type === 'dam'),
    levels: local.stations.filter(s => s.station_type === 'waterlevel'), now })
  const stale = refreshFailed || !data.synced_at || isStale(data.synced_at, now, SYNC_STALE_HOURS)
  box(0, 0, 1080, 1480, '#eef5f9', 0)
  const gradient = ctx.createLinearGradient(0, 0, 1080, 340)
  gradient.addColorStop(0, '#082f49'); gradient.addColorStop(1, '#0e7490')
  box(0, 0, 1080, 346, gradient, 0)
  // Decorative contour lines, deliberately not a chart of measured water levels.
  ctx.strokeStyle = '#ffffff14'; ctx.lineWidth = 3
  for (let i = 0; i < 5; i++) {
    ctx.beginPath(); ctx.moveTo(670, 40 + i * 45)
    ctx.bezierCurveTo(830, -10 + i * 45, 910, 130 + i * 45, 1100, 65 + i * 45); ctx.stroke()
  }
  label('ข้อมูลน้ำในพื้นที่  /  LOCAL WATER REPORT', 56,  60, 23, '#a5f3fc', 600)
  label('สถานการณ์น้ำ–ฝน', 56, 140,  60, '#ffffff', 700)
  label(tenant.name, 56, 205, 40, '#ffffff', 600)
  label(`อ.${tenant.district || 'ไม่ระบุ'}  จ.${tenant.province || 'ไม่ระบุ'} · เฉพาะตำบลของหน่วยงาน`, 56, 255, 26, '#cffafe')
  label(`สรุป ณ ${dateText(now)} น. (เวลาไทย)`, 56, 307, 26, '#cffafe')
  box(40, 366, 1000, 64, stale ? '#fff1d6' : '#dcecf5', 16)
  label(stale ? 'ข้อมูลอาจไม่เป็นปัจจุบัน • ตรวจสอบเวลาวัดก่อนนำไปใช้' : 'เฉพาะสถานีที่ระบุตำบล อำเภอ และจังหวัดตรงกัน',  60, 407, 27, stale ? '#92400e' : '#075985', 600)

  const cards = [
    { y: 450, color: '#0369a1', pale: '#e0f2fe', title: '01  ฝนสะสม 24 ชั่วโมง',
      value: stats.rain ? `${formatMm(stats.rain.mm)} มม.` : 'ไม่มีข้อมูลปัจจุบัน',
      detail: stats.rain ? `สูงสุดในสถานีของตำบล · ${stats.rain.station.station_name}` : 'ไม่มีค่าฝนที่ยืนยันพื้นที่และเวลาวัดได้',
      time: stats.rain ? `ตรวจวัด ${dateText(stats.rain.station.recorded_at)} น.` : 'ไม่ใช้ค่าจากตำบลข้างเคียงทดแทน',
      note: stats.rain ? `เกณฑ์ฝน: ${stats.rain.level?.label || 'ดูรายละเอียดในเว็บไซต์'}` : 'ไม่มีข้อมูล ไม่ได้หมายความว่าไม่มีฝน' },
    { y: 710, color: '#4338ca', pale: '#eef2ff', title: '02  น้ำในอ่างเก็บน้ำ',
      value: stats.dam ? `${stats.dam.percent.toFixed(1)}%` : 'ไม่มีข้อมูลปัจจุบัน',
      detail: stats.dam ? `ปริมาตรน้ำรวม ÷ ความจุรวม · ${stats.dam.count} แห่งในตำบล` : 'ไม่มีค่าอ่างเก็บน้ำในตำบลสำหรับสรุป',
      time: stats.dam ? 'แต่ละอ่างอาจตรวจวัดต่างเวลา · ดูเวลารายอ่างในลิงก์' : 'ไม่รวมอ่างเก็บน้ำนอกตำบล',
      note: stats.dam ? 'ใช้เฉพาะข้อมูลที่ยังไม่หมดอายุตามเกณฑ์ของระบบ' : 'ไม่มีข้อมูล ไม่ได้หมายความว่าไม่มีน้ำในอ่าง' },
    { y: 970, color: '#0f766e', pale: '#e6f6f2', title: '03  ระดับน้ำเทียบตลิ่ง',
      value: stats.bank ? stats.bank.text : 'ไม่มีข้อมูลปัจจุบัน',
      detail: stats.bank ? `สถานีใกล้ตลิ่งที่สุดในตำบล · ${stats.bank.station.station_name}` : 'ไม่มีค่าระดับน้ำในตำบลสำหรับสรุป',
      time: stats.bank ? `ตรวจวัด ${dateText(stats.bank.station.recorded_at)} น.` : 'ไม่ใช้สถานีระดับน้ำต่างตำบลทดแทน',
      note: 'ค่าจากสถานีตรวจวัด ไม่ครอบคลุมทุกจุดในตำบล' },
  ]
  for (const card of cards) {
    box(40, card.y, 1000, 240, '#ffffff')
    box(40, card.y + 24, 7, 190, card.color, 3)
    box( 60, card.y + 18, 950, 44, card.pale, 12)
    label(card.title, 78, card.y + 50, 27, card.color, 700)
    label(card.value, 70, card.y + 117, card.value.length > 20 ? 40 : 52, '#0f172a', 700)
    label(card.detail, 70, card.y + 159, 27)
    label(card.time, 70, card.y + 194, 25)
    label(card.note, 70, card.y + 225, 23, card.color)
  }
  label('แหล่งข้อมูล: คลังข้อมูลน้ำแห่งชาติ ThaiWater (สสน.)', 56, 1266, 27, '#0f172a', 600)
  label('ภาพสรุป ณ เวลาที่ระบุ • ไม่ใช่ประกาศเตือนภัยของ อปท.', 56, 1309, 26, '#92400e', 600)
  label('ไม่มีข้อมูล ไม่ได้หมายความว่าสถานการณ์ปกติ', 56, 1348, 26)
  label('ตรวจสอบข้อมูลและคำเตือนล่าสุด:', 56, 1398, 24, '#075985', 600)
  label(url, 56, 1438, 24, '#075985')
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('PNG export failed')
  return new File([blob], `water-local-${new Date(now).toISOString().slice(0, 10)}.png`, { type: 'image/png' })
}



function ShareInfographic({ tenant, data, now, refreshFailed, url, text, setStatus, buttonClass }) {
  const [result, setImage] = useState(null)
  const [failed, setFailed] = useState(false)
  const image = result?.data === data && result?.now === now && result?.tenant === tenant && result?.refreshFailed === refreshFailed ? result : null
  useEffect(() => {
    let alive = true
    let objectUrl
    infographic(tenant, data, now, refreshFailed, url).then(file => {
      if (!alive) return
      objectUrl = URL.createObjectURL(file)
      setFailed(false)
      setImage({ file, url: objectUrl, data, now, tenant, refreshFailed })
    }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [tenant, data, now, refreshFailed, url])
  const canShare = image && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [image.file] })
  async function shareImage() {
    try { await navigator.share({ files: [image.file], title: `สถานการณ์น้ำ–ฝน | ${tenant.name}`, text: `${text}\n${url}` }) }
    catch (error) { if (error?.name !== 'AbortError') setStatus('แชร์ภาพไม่ได้ กรุณาดาวน์โหลด PNG แล้วแนบในโพสต์หรือกลุ่ม LINE') }
  }
  return <div className="rounded-xl border border-sky-200 bg-white p-3">
    <h3 className="text-sm font-bold text-slate-800">ภาพสรุปสำหรับชาวบ้าน</h3>
    <p className="my-2 text-xs text-slate-600">PNG ความละเอียด 1080 × 1480 · ภาพแสดงข้อมูล ณ เวลาที่สร้าง</p>
    {image ? <>
      <img src={image.url} alt={`อินโฟกราฟิกสถานการณ์น้ำ–ฝน ${tenant.name} เฉพาะตำบล ข้อความและตัวเลขอยู่ในหัวข้อดูข้อความที่จะแชร์`} className="mx-auto w-full max-w-sm rounded-lg" width="1080" height="1480" />
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={image.url} download={image.file.name} className={`${buttonClass} bg-sky-700 text-white`}><Download size={18} /> ดาวน์โหลดภาพ PNG</a>
        {canShare && <button type="button" onClick={shareImage} className={`${buttonClass} border border-sky-200 text-sky-800`}><Share2 size={18} /> แชร์ภาพผ่านแอป</button>}
      </div>
    </> : <p role="status" className="py-6 text-sm text-slate-600">{failed ? 'สร้างภาพไม่สำเร็จ ใช้การแชร์ลิงก์หรือคัดลอกข้อความด้านล่างได้' : 'กำลังเตรียมภาพสรุป…'}</p>}
    <p className="mt-3 text-xs text-slate-600">ดาวน์โหลดภาพแล้วแนบใน Facebook หรือ LINE ได้ ปุ่มแชร์ลิงก์ด้านล่างจะไม่แนบภาพให้อัตโนมัติ</p>
  </div>
}

// Share only public readings already visible on this tenant's page; never include session/query tokens.
function shareText(tenant, data, now, refreshFailed) {
  const stations = localWaterSituation(data, tenant).stations
  const stats = summaryStats({
    rain: stations.filter(s => s.station_type === 'rain'),
    dams: stations.filter(s => s.station_type === 'dam'),
    levels: stations.filter(s => s.station_type === 'waterlevel'), now,
  })
  const lines = [`สถานการณ์น้ำ–ฝน | ${tenant.name}`, `สรุป ณ ${dateText(now)} น. (เวลาไทย)`]
  if (refreshFailed || !data.synced_at || isStale(data.synced_at, now, SYNC_STALE_HOURS)) {
    lines.push('ข้อมูลอาจไม่เป็นปัจจุบัน กรุณาตรวจสอบเวลาตรวจวัดในหน้ารายละเอียด')
  }
  if (stats.rain) lines.push(`ฝนสะสม 24 ชม. สูงสุดในสถานีที่แสดง: ${formatMm(stats.rain.mm)} มม. (${stats.rain.station.station_name}) — ตรวจวัด ${dateText(stats.rain.station.recorded_at)} น.`)
  if (stats.dam) lines.push(`น้ำในอ่างที่มีข้อมูลปัจจุบัน ${stats.dam.count} แห่ง: ${stats.dam.percent.toFixed(1)}% ของความจุรวม (แต่ละแห่งอาจตรวจวัดต่างเวลา ดูรายละเอียดในลิงก์)`)
  if (stats.bank) lines.push(`สถานีใกล้ตลิ่งที่สุดที่มีข้อมูลปัจจุบัน: ${stats.bank.station.station_name} ${stats.bank.text} — ตรวจวัด ${dateText(stats.bank.station.recorded_at)} น.`)
  if (!stats.any) lines.push('ยังไม่มีค่าตรวจวัดปัจจุบันสำหรับสรุป ไม่ได้หมายความว่าสถานการณ์ปกติ')
  lines.push('เฉพาะสถานีที่ระบุตำบล อำเภอ และจังหวัดตรงกับหน่วยงาน ไม่รวมสถานีข้างเคียง และไม่ครอบคลุมทุกจุดในตำบล', 'แหล่งข้อมูล: ThaiWater (สสน.) · ไม่ใช่ประกาศเตือนภัยของ อปท.', 'ตรวจสอบคำเตือนและข้อมูลล่าสุดในลิงก์:')
  return lines.join('\n')
}

export default function WaterSituationShare({ tenant, data, now, refreshFailed }) {
  const [expanded, setExpanded] = useState(false)
  const [status, setStatus] = useState('')
  const [manualCopy, setManualCopy] = useState(false)
  if (!tenant?.name) return null
  const url = appUrl('/water-situation?scope=local')
  const text = shareText(tenant, data, now, refreshFailed)
  const fullText = `${text}\n${url}`
  const buttonClass = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold'

  async function copy() {
    try {
      await navigator.clipboard.writeText(fullText)
      setManualCopy(false)
      setStatus('คัดลอกแล้ว นำไปวางในโพสต์หรือกลุ่มที่ต้องการได้เลย')
    } catch {
      setManualCopy(true)
      setStatus('คัดลอกอัตโนมัติไม่ได้ กรุณาเลือกข้อความด้านล่างแล้วคัดลอก')
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ title: `สถานการณ์น้ำ–ฝน | ${tenant.name}`, text, url })
      setStatus('')
    } catch (error) {
      if (error?.name !== 'AbortError') {
        setManualCopy(true)
        setStatus('เปิดเมนูแชร์ไม่ได้ กรุณาใช้ปุ่ม Facebook, LINE หรือคัดลอกข้อความ')
      }
    }
  }

  return (
    <section className="rounded-2xl border border-sky-200 bg-sky-50 p-4" aria-label="แชร์สถานการณ์ในพื้นที่">
      <button type="button" aria-expanded={expanded} aria-controls="water-share-options"
        onClick={() => setExpanded(!expanded)} className={`${buttonClass} w-full bg-sky-700 text-white hover:bg-sky-800`}>
        <Share2 size={18} /> แชร์สถานการณ์ในพื้นที่
      </button>
      {expanded && <div id="water-share-options" className="mt-3 space-y-3">
        <ShareInfographic tenant={tenant} data={data} now={now} refreshFailed={refreshFailed} url={url} text={text} setStatus={setStatus} buttonClass={buttonClass} />
        <p className="text-xs leading-relaxed text-slate-600">แชร์เฉพาะข้อมูลในตำบลของ {tenant.name} ไม่รวมสถานีข้างเคียง · ผู้รับเปิดลิงก์เพื่อดูข้อมูลล่าสุด เลือกกลุ่มหรือผู้รับก่อนส่งได้</p>
        <div className="grid grid-cols-2 gap-2">
          <a className={`${buttonClass} bg-blue-700 text-white hover:bg-blue-800`} target="_blank" rel="noopener noreferrer"
            href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`}><Globe size={18} /> Facebook</a>
          <a className={`${buttonClass} bg-green-700 text-white hover:bg-green-800`} target="_blank" rel="noopener noreferrer"
            href={`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`}><MessageCircle size={18} /> LINE / กลุ่ม</a>
          <button type="button" onClick={copy} className={`${buttonClass} border border-sky-200 bg-white text-sky-800`}><Copy size={18} /> คัดลอกข้อความ</button>
          {typeof navigator.share === 'function' && <button type="button" onClick={nativeShare} className={`${buttonClass} border border-sky-200 bg-white text-sky-800`}><Share2 size={18} /> แชร์ผ่านแอปอื่น</button>}
        </div>
        <p className="text-xs text-slate-600">Facebook แชร์ลิงก์ หากต้องการตัวเลขสรุปในโพสต์ ให้คัดลอกข้อความไปวางเพิ่ม</p>
        <details open={manualCopy || undefined}>
          <summary className="cursor-pointer py-3 text-sm font-medium text-sky-800">ดูข้อความที่จะแชร์</summary>
          <textarea aria-label="ข้อความสรุปสำหรับแชร์" readOnly value={fullText} onFocus={e => e.target.select()}
            className="min-h-[220px] w-full rounded-xl border border-sky-200 bg-white p-3 text-sm leading-relaxed text-slate-700" />
        </details>
        <p role="status" className="text-xs text-sky-800">{status}</p>
      </div>}
    </section>
  )
}
