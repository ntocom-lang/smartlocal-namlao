import { useEffect, useRef, useState } from 'react'
import { Copy, Download, Globe, MessageCircle, Share2 } from 'lucide-react'
import { appUrl } from '../lib/basename'
import { formatMm, isStale, localWaterSituation, summaryStats, SYNC_STALE_HOURS } from '../lib/waterSituation'

const dateText = value => new Date(value).toLocaleString('th-TH', {
  timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short',
})

// // Export the same React cards as the page, preserving their gauges, scales and timestamps.
async function infographic(node, now) {
  await document.fonts.ready
  const { default: html2canvas } = await import('html2canvas')
  const canvas = await html2canvas(node, {
    scale: 3, backgroundColor: '#eef5f9', logging: false,
    onclone: doc => {
      // html2canvas does not parse Tailwind 4 oklch colors. Resolve the cloned
      // palette to sRGB using the browser; do not change the live page's styles.
      const pixel = doc.createElement('canvas').getContext('2d', { willReadFrequently: true })
      const root = doc.documentElement
      const computed = doc.defaultView.getComputedStyle(root)
      for (const property of computed) {
        const value = computed.getPropertyValue(property)
        if (property.startsWith('--color-') && /oklch|oklab/.test(value)) {
          pixel.clearRect(0, 0, 1, 1); pixel.fillStyle = value; pixel.fillRect(0, 0, 1, 1)
          const [r, g, b, a] = pixel.getImageData(0, 0, 1, 1).data
          root.style.setProperty(property, `rgba(${r},${g},${b},${a / 255})`)
        }
      }
      const capture = doc.querySelector('[data-water-share-capture]')
      capture.style.position = 'static'
      capture.style.left = 'auto'
      capture.querySelectorAll('a').forEach(a => { a.style.display = 'none' })
      capture.querySelectorAll('*').forEach(el => {
        el.style.transition = 'none'; el.style.animation = 'none'
        const styles = doc.defaultView.getComputedStyle(el)
        for (const property of styles) {
          if (property.startsWith('--')) continue
          const value = styles.getPropertyValue(property)
          if (/oklch|oklab|color-mix/.test(value)) {
            const rgb = color => {
              pixel.clearRect(0, 0, 1, 1); pixel.fillStyle = color; pixel.fillRect(0, 0, 1, 1)
              const [r, g, b, a] = pixel.getImageData(0, 0, 1, 1).data
              return `rgba(${r},${g},${b},${a / 255})`
            }
            el.style.setProperty(property, /color$|^fill$|^stroke$/.test(property)
              ? rgb(value) : value.replace(/oklch\([^)]*\)|oklab\([^)]*\)/g, rgb))
          }
        }
      })
      // SVG padding would otherwise be applied twice when html2canvas rasterizes it.
      capture.querySelectorAll('svg').forEach(svg => {
        const styles = doc.defaultView.getComputedStyle(svg)
        const padding = parseFloat(styles.paddingLeft)
        const width = parseFloat(styles.width)
        const height = parseFloat(styles.height)
        const view = svg.viewBox.baseVal
        if (padding > 0 && width > 0 && height > 0 && view.width > 0) {
          const extraX = view.width * padding / width
          const extraY = view.height * padding / height
          svg.setAttribute('viewBox', `${view.x - extraX} ${view.y - extraY} ${view.width + extraX * 2} ${view.height + extraY * 2}`)
          svg.style.padding = '0'
          svg.style.width = `${width + padding * 2}px`
          svg.style.height = `${height + padding * 2}px`
        }
      })
    },
  })
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('PNG export failed')
  return { file: new File([blob], `water-local-${new Date(now).toISOString().slice(0, 10)}.png`, { type: 'image/png' }), width: canvas.width, height: canvas.height }
}
function ShareInfographic({ tenant, data, now, refreshFailed, url, text, setStatus, buttonClass, renderCards: Cards }) {
  const capture = useRef(null)
  const [result, setImage] = useState(null)
  const [failed, setFailed] = useState(false)
  const image = result?.data === data && result?.now === now && result?.tenant === tenant && result?.refreshFailed === refreshFailed ? result : null
  useEffect(() => {
    let alive = true
    let objectUrl
    infographic(capture.current, now).then(({ file, width, height }) => {
      if (!alive) return
      objectUrl = URL.createObjectURL(file)
      setFailed(false)
      setImage({ file, width, height, url: objectUrl, data, now, tenant, refreshFailed })
    }).catch(error => { console.warn('Water infographic export failed', error); if (alive) setFailed(true) })
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [tenant, data, now, refreshFailed, url])
  const canShare = image && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [image.file] })
  async function shareImage() {
    try { await navigator.share({ files: [image.file], title: `สถานการณ์น้ำ–ฝน | ${tenant.name}`, text: `${text}\n${url}` }) }
    catch (error) { if (error?.name !== 'AbortError') setStatus('แชร์ภาพไม่ได้ กรุณาดาวน์โหลด PNG แล้วแนบในโพสต์หรือกลุ่ม LINE') }
  }
  return <div className="rounded-xl border border-sky-200 bg-white p-3">
    <div ref={capture} data-water-share-capture className="water-page" aria-hidden="true" inert
      style={{ position: 'fixed', left: -10000, top: 0, width: 390, padding: 8, background: '#eef5f9', color: '#0f172a', fontFamily: 'Sarabun, sans-serif' }}>
      <header style={{ padding: '10px 8px 14px' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>สถานการณ์น้ำ–ฝน · {tenant.name}</h2>
        <p style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>เฉพาะข้อมูลในตำบล · สรุป ณ {dateText(now)} น.</p>
        {(refreshFailed || !data.synced_at || isStale(data.synced_at, now, SYNC_STALE_HOURS)) &&
          <p style={{ fontSize: 12, color: '#92400e', marginTop: 6 }}>ข้อมูลอาจไม่เป็นปัจจุบัน โปรดตรวจสอบเวลาตรวจวัด</p>}
      </header>
      <Cards tenant={tenant} data={data} now={now} />
      <footer style={{ padding: '14px 8px 8px', fontSize: 10, lineHeight: 1.5, color: '#475569' }}>
        <p style={{ fontWeight: 700 }}>แหล่งข้อมูล: คลังข้อมูลน้ำแห่งชาติ ThaiWater (สสน.)</p>
        <p style={{ color: '#92400e', fontWeight: 700 }}>ภาพสรุป ณ เวลาที่ระบุ · ไม่ใช่ประกาศเตือนภัยของ อปท.</p>
        <p>ไม่มีข้อมูล ไม่ได้หมายความว่าสถานการณ์ปกติ</p>
        <p>ข้อมูลสถานีไม่ครอบคลุมทุกจุดในตำบล</p>
        <p style={{ marginTop: 6, color: '#0369a1', fontWeight: 700 }}>ตรวจสอบข้อมูลและคำเตือนล่าสุด:</p>
        <p style={{ color: '#0369a1', overflowWrap: 'anywhere' }}>{url}</p>
      </footer>
    </div>
    <h3 className="text-sm font-bold text-slate-800">ภาพสรุปสำหรับชาวบ้าน</h3>
    <p className="my-2 text-xs text-slate-600">PNG ความละเอียด 3 เท่า · ใช้การ์ดเดียวกับหน้าสถานการณ์</p>
    {image ? <>
      <img src={image.url} alt={`อินโฟกราฟิกสถานการณ์น้ำ–ฝน ${tenant.name} เฉพาะตำบล ข้อความและตัวเลขอยู่ในหัวข้อดูข้อความที่จะแชร์`} className="mx-auto w-full max-w-sm rounded-lg" width={image.width} height={image.height} />
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

export default function WaterSituationShare({ tenant, data, now, refreshFailed, renderCards }) {
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
        <ShareInfographic tenant={tenant} data={data} now={now} refreshFailed={refreshFailed} url={url} text={text} setStatus={setStatus} buttonClass={buttonClass} renderCards={renderCards} />
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
