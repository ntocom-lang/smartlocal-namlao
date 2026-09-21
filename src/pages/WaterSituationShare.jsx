import { useState } from 'react'
import { Copy, Globe, MessageCircle, Share2 } from 'lucide-react'
import { appUrl } from '../lib/basename'
import { formatMm, isStale, summaryStats, SYNC_STALE_HOURS } from '../lib/waterSituation'

const dateText = value => new Date(value).toLocaleString('th-TH', {
  timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short',
})

// Share only public readings already visible on this tenant's page; never include session/query tokens.
function shareText(tenant, data, now, refreshFailed) {
  const stations = data.stations ?? []
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
  lines.push('ข้อมูลจากสถานีใกล้พื้นที่ ไม่ครอบคลุมทุกจุด', 'แหล่งข้อมูล: ThaiWater (สสน.) · ไม่ใช่ประกาศเตือนภัยของ อปท.', 'ตรวจสอบคำเตือนและข้อมูลล่าสุดในลิงก์:')
  return lines.join('\n')
}

export default function WaterSituationShare({ tenant, data, now, refreshFailed }) {
  const [expanded, setExpanded] = useState(false)
  const [status, setStatus] = useState('')
  const [manualCopy, setManualCopy] = useState(false)
  if (!tenant?.name) return null
  const url = appUrl('/water-situation')
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
        <p className="text-xs leading-relaxed text-slate-600">แชร์ข้อมูลของ {tenant.name} ให้ชาวบ้าน · ผู้รับเปิดลิงก์เพื่อดูข้อมูลล่าสุด เลือกกลุ่มหรือผู้รับก่อนส่งได้</p>
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

