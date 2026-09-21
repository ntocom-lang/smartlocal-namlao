import { useEffect, useRef, useState } from 'react'
import { Download, Share2, X } from 'lucide-react'
import { appUrl } from '../lib/basename'
import { DAM_STALE_HOURS, distanceText, formatMm, isStale, shareWaterSituation, summaryStats, SYNC_STALE_HOURS, toNum } from '../lib/waterSituation'

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
      const modal = doc.querySelector('[data-water-share-dialog]')
      if (modal) {
        modal.setAttribute('open', '')
        Object.assign(modal.style, { position: 'static', display: 'block', maxHeight: 'none', overflow: 'visible' })
      }
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
        <p style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>ในตำบล + ใกล้เคียง ≤ 5 กม. จากสำนักงาน · สรุป ณ {dateText(now)} น.</p>
        {(refreshFailed || !data.synced_at || isStale(data.synced_at, now, SYNC_STALE_HOURS)) &&
          <p style={{ fontSize: 12, color: '#92400e', marginTop: 6 }}>ข้อมูลอาจไม่เป็นปัจจุบัน โปรดตรวจสอบเวลาตรวจวัด</p>}
      </header>
      <Cards tenant={tenant} data={data} now={now} />
      <footer style={{ padding: '14px 8px 8px', fontSize: 10, lineHeight: 1.5, color: '#475569' }}>
        <p style={{ fontWeight: 700 }}>แหล่งข้อมูล: คลังข้อมูลน้ำแห่งชาติ ThaiWater (สสน.)</p>
        <p style={{ color: '#92400e', fontWeight: 700 }}>ภาพสรุป ณ เวลาที่ระบุ · ไม่ใช่ประกาศเตือนภัยของ อปท.</p>
        <p>ไม่มีข้อมูล ไม่ได้หมายความว่าสถานการณ์ปกติ</p>
        <p>ข้อมูลสถานีไม่ครอบคลุมทุกจุดในพื้นที่</p>
        <p style={{ marginTop: 6, color: '#0369a1', fontWeight: 700 }}>ตรวจสอบข้อมูลและคำเตือนล่าสุด:</p>
        <p style={{ color: '#0369a1', overflowWrap: 'anywhere' }}>{url}</p>
      </footer>
    </div>
    <h3 className="text-sm font-bold text-slate-800">ภาพสรุปสำหรับชาวบ้าน</h3>
    <p className="my-2 text-xs text-slate-600">PNG ความละเอียด 3 เท่า · ใช้การ์ดเดียวกับหน้าสถานการณ์</p>
    {image ? <>
      <img src={image.url} alt={`อินโฟกราฟิกสถานการณ์น้ำ–ฝน ${tenant.name} ในตำบลและใกล้เคียงไม่เกิน 5 กม. ข้อความและตัวเลขอยู่ในหัวข้อดูข้อความที่จะแชร์`} className="mx-auto w-full max-w-sm rounded-lg" width={image.width} height={image.height} />
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={image.url} download={image.file.name} className={`${buttonClass} bg-sky-700 text-white`}><Download size={18} /> ดาวน์โหลดภาพ PNG</a>
        {canShare && <button type="button" onClick={shareImage} className={`${buttonClass} border border-sky-200 text-sky-800`}><Share2 size={18} /> แชร์ภาพผ่านแอป</button>}
      </div>
    </> : <p role="status" className="py-6 text-sm text-slate-600">{failed ? 'สร้างภาพไม่สำเร็จ ลองปิดแล้วเปิดภาพสรุปอีกครั้ง หรือเลือกข้อความด้านล่างไปใช้ได้' : 'กำลังเตรียมภาพสรุป…'}</p>}
    <p className="mt-3 text-xs text-slate-600">ดาวน์โหลดภาพแล้วแนบใน Facebook หรือ LINE ได้</p>
  </div>
}

// Share only public readings already visible on this tenant's page; never include session/query tokens.
function shareText(tenant, data, now, refreshFailed) {
  const stations = shareWaterSituation(data, tenant).stations
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
  for (const dam of stations.filter(s => s.station_type === 'dam')) {
    const place = [dam.tambon_name && `ต.${dam.tambon_name}`, distanceText(dam.distance_km)].filter(Boolean).join(' · ')
    const title = `${dam.station_name || 'ไม่ระบุชื่ออ่าง'}${place ? ` (${place})` : ''}`
    if (isStale(dam.recorded_at, now, DAM_STALE_HOURS)) {
      lines.push(`${title}: ไม่มีข้อมูลปัจจุบัน`)
      continue
    }
    const single = summaryStats({ dams: [dam], now }).dam
    const percent = toNum(dam.storage_percent) ?? single?.percent
    lines.push(percent == null ? `${title}: ไม่มีค่าปริมาณน้ำสำหรับสรุป`
      : `${title}: ${percent.toFixed(1)}% ของความจุ — ตรวจวัด ${dateText(dam.recorded_at)} น.`)
  }
  if (stats.bank) lines.push(`สถานีใกล้ตลิ่งที่สุดที่มีข้อมูลปัจจุบัน: ${stats.bank.station.station_name} ${stats.bank.text} — ตรวจวัด ${dateText(stats.bank.station.recorded_at)} น.`)
  if (!stats.any) lines.push('ยังไม่มีค่าตรวจวัดปัจจุบันสำหรับสรุป ไม่ได้หมายความว่าสถานการณ์ปกติ')
  lines.push('รวมสถานีในตำบล และสถานีข้างเคียงระยะไม่เกิน 5 กม. จากสำนักงาน อปท. ไม่ครอบคลุมทุกจุดในพื้นที่', 'แหล่งข้อมูล: ThaiWater (สสน.) · ไม่ใช่ประกาศเตือนภัยของ อปท.', 'ตรวจสอบคำเตือนและข้อมูลล่าสุดในลิงก์:')
  return lines.join('\n')
}

function WaterShareDialog({ tenant, data, now, refreshFailed, renderCards, close, buttonClass }) {
  const dialog = useRef(null)
  const [status, setStatus] = useState('')
  useEffect(() => {
    const node = dialog.current
    const previous = document.activeElement
    const overflow = document.body.style.overflow
    node.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      node.close()
      document.body.style.overflow = overflow
      previous?.focus({ preventScroll: true })
    }
  }, [])
  const url = appUrl('/water-situation?scope=nearby5')
  const text = shareText(tenant, data, now, refreshFailed)
  const fullText = `${text}\n${url}`
  return <dialog ref={dialog} data-water-share-dialog aria-label="แชร์สถานการณ์ในพื้นที่" onCancel={close}
    className="m-auto rounded-2xl border border-sky-200 bg-sky-50 p-0 text-slate-800 shadow-xl backdrop:bg-slate-950/60"
    style={{ width: 'min(640px, calc(100vw - 24px))', maxHeight: '90dvh' }}>
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-sky-100 bg-white px-4 py-2">
        <h2 className="text-base font-bold">แชร์สถานการณ์ในพื้นที่</h2>
        <button type="button" onClick={close} className={`${buttonClass} text-slate-700`} aria-label="ปิดหน้าต่างแชร์"><X size={20} /> ปิด</button>
      </header>
      <div className="space-y-3 p-3 sm:p-4">
        <ShareInfographic tenant={tenant} data={data} now={now} refreshFailed={refreshFailed} url={url} text={text} setStatus={setStatus} buttonClass={buttonClass} renderCards={renderCards} />
        <details>
          <summary className="cursor-pointer py-3 text-sm font-medium text-sky-800">ดูข้อความที่จะแชร์</summary>
          <textarea aria-label="ข้อความสรุปสำหรับแชร์" readOnly value={fullText} onFocus={e => e.target.select()}
            className="min-h-[220px] w-full rounded-xl border border-sky-200 bg-white p-3 text-sm leading-relaxed text-slate-700" />
        </details>
        <p role="status" className="text-xs text-sky-800">{status}</p>
      </div>
    </dialog>
}

export default function WaterSituationShare(props) {
  const [expanded, setExpanded] = useState(false)
  if (!props.tenant?.name) return null
  const buttonClass = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold'
  return <section className="rounded-2xl border border-sky-200 bg-sky-50 p-4" aria-label="แชร์สถานการณ์ในพื้นที่">
    <button type="button" aria-haspopup="dialog" onClick={() => setExpanded(true)} className={`${buttonClass} w-full bg-sky-700 text-white hover:bg-sky-800`}>
      <Share2 size={18} /> แชร์สถานการณ์ในพื้นที่
    </button>
    {expanded && <WaterShareDialog {...props} close={() => setExpanded(false)} buttonClass={buttonClass} />}
  </section>
}
