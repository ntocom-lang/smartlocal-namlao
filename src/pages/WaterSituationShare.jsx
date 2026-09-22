import { useEffect, useRef, useState } from 'react'
import { Download, Share2, X } from 'lucide-react'
import { waterShareSlides, renderWaterShareSlide } from '../lib/waterShareImages'
import { appUrl } from '../lib/basename'
import { DAM_STALE_HOURS, distanceText, formatMm, isStale, shareWaterSituation, summaryStats, SYNC_STALE_HOURS, toNum } from '../lib/waterSituation'

const dateText = value => new Date(value).toLocaleString('th-TH', {
  timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short',
})

function canShareFiles(files) {
  try { return files.length > 0 && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files }) }
  catch { return false }
}

function ShareInfographic({ tenant, data, now, refreshFailed, url, text, setStatus, buttonClass }) {
  const [result, setResult] = useState(null)
  const [failed, setFailed] = useState(false)
  const [active, setActive] = useState(0)
  const [selected, setSelected] = useState([0])
  const [busy, setBusy] = useState(false)
  const preview = useRef(null)
  function showImage(index) {
    setActive(index)
    preview.current?.scrollIntoView({ behavior: 'auto', block: 'start' })
  }
  const images = result?.data === data && result?.now === now ? result.images : []
  useEffect(() => {
    let alive = true
    const urls = []
    async function generate() {
      const slides = waterShareSlides(data, tenant)
      const rendered = []
      for (const slide of slides) {
        if (!alive) return
        const file = await renderWaterShareSlide(slide, { tenant, data, now, refreshFailed, url })
        if (!alive) return
        const objectUrl = URL.createObjectURL(file)
        urls.push(objectUrl)
        rendered.push({ ...slide, file, url: objectUrl })
      }
      if (alive) { setFailed(false); setResult({ data, now, images: rendered }) }
    }
    generate().catch(() => { if (alive) setFailed(true) })
    return () => { alive = false; urls.forEach(value => URL.revokeObjectURL(value)) }
  }, [tenant, data, now, refreshFailed, url])
  const current = images[active] || images[0]
  const files = selected.map(i => images[i]?.file).filter(Boolean)
  async function share(filesToSend) {
    setBusy(true); setStatus('')
    try { await navigator.share({ files: filesToSend, title: `สถานการณ์น้ำ–ฝน | ${tenant.name}`, text }) }
    catch (error) { if (error?.name !== 'AbortError') setStatus('แชร์ภาพไม่ได้ กรุณาดาวน์โหลดแต่ละภาพ แล้วแนบในกลุ่ม LINE') }
    finally { setBusy(false) }
  }
  return <div className="rounded-xl border border-sky-200 bg-white p-3">
    <h3 className="text-sm font-bold text-slate-800">ภาพสรุปสำหรับชาวบ้าน · 1 ภาพ = 1 เรื่อง</h3>
    <p className="my-2 text-xs text-slate-600">ภาพจัตุรัส 1080 × 1080 · ส่งภาพสรุปก่อน แล้วเลือกเรื่องที่ต้องการส่งต่อ</p>
    {current ? <>
      <div className="mb-3 flex flex-wrap gap-2">
        {canShareFiles([images[0].file]) && <button type="button" disabled={busy} onClick={() => share([images[0].file])} className={`${buttonClass} bg-sky-700 text-white disabled:opacity-50`}><Share2 size={18} /> แชร์ภาพสรุป</button>}
        <a href={images[0].url} download={images[0].file.name} className={`${buttonClass} border border-sky-200 text-sky-800`}><Download size={18} /> ดาวน์โหลดภาพสรุป</a>
      </div>
      <fieldset className="mb-3 rounded-xl border border-sky-100 p-2">
        <legend className="px-1 text-sm font-semibold text-slate-700">เลือกภาพที่จะแชร์ ({files.length}/{images.length})</legend>
        <button type="button" className={`${buttonClass} text-sky-800`} onClick={() => setSelected(selected.length === images.length ? [] : images.map((_, i) => i))}>{selected.length === images.length ? 'ยกเลิกเลือกทั้งหมด' : 'เลือกทั้งชุด'}</button>
        {images.map((image, i) => <div key={image.index} className="flex items-center gap-2 border-t border-slate-100">
          <label className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 py-2 text-sm text-slate-700">
            <input type="checkbox" checked={selected.includes(i)} onChange={() => setSelected(previous => previous.includes(i) ? previous.filter(value => value !== i) : [...previous, i].sort((a, b) => a - b))} />
            <span>{image.index}/{images.length} · {image.title}</span>
          </label>
          <button type="button" onClick={() => showImage(i)} aria-pressed={current === image} aria-label={`ดูภาพ ${image.index} ${image.title}`} className={`${buttonClass} shrink-0 text-sky-800`}>{current === image ? 'กำลังดู' : 'ดูภาพ'}</button>
        </div>)}
        {canShareFiles(files) ? <button type="button" disabled={busy} onClick={() => share(files)} className={`${buttonClass} mt-2 w-full bg-sky-700 text-white disabled:opacity-50`}><Share2 size={18} /> แชร์ภาพที่เลือก ({files.length} ภาพ)</button>
          : <p className="py-2 text-xs text-slate-600">{files.length ? 'อุปกรณ์นี้ไม่รองรับแชร์ไฟล์ที่เลือกโดยตรง ดาวน์โหลดแยกรูปแล้วแนบใน LINE ได้' : 'เลือกอย่างน้อย 1 ภาพเพื่อแชร์'}</p>}
      </fieldset>
      <div ref={preview} style={{ scrollMarginTop: 76 }}>
        <nav aria-label="เปลี่ยนภาพตัวอย่าง" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 p-2">
          <button type="button" disabled={current.index === 1} onClick={() => showImage(current.index - 2)} className={`${buttonClass} bg-white text-sky-800 disabled:opacity-40`}>ก่อนหน้า</button>
          <span aria-live="polite" className="text-sm font-bold text-slate-800">ภาพ {current.index} / {images.length}</span>
          <button type="button" disabled={current.index === images.length} onClick={() => showImage(current.index)} className={`${buttonClass} bg-white text-sky-800 disabled:opacity-40`}>ถัดไป</button>
        </nav>
        <div className="mb-3 flex flex-wrap gap-2" aria-label="เลือกหน้าตัวอย่าง">
          {images.map((image, i) => <button key={image.index} type="button" onClick={() => showImage(i)} aria-label={`เปิดภาพที่ ${image.index}`} aria-current={current === image ? 'page' : undefined}
            className={`${buttonClass} min-w-[44px] border ${current === image ? 'border-sky-700 bg-sky-700 text-white' : 'border-sky-200 bg-white text-sky-800'}`}>{image.index}</button>)}
        </div>
        <p className="mb-2 text-xs text-slate-600">เครื่องหมายถูกใช้เลือกภาพที่จะส่ง · ใช้เลขหน้าหรือปุ่มถัดไปเพื่อดูแต่ละภาพ</p>
        <p className="mb-2 text-sm font-bold text-slate-800">ภาพ {current.index}/{images.length} · {current.title}</p>
      </div>
      <img src={current.url} alt={`ภาพ ${current.index} ${current.title} ของ ${tenant.name}`} className="mx-auto w-full max-w-md rounded-lg" width="1080" height="1080" />
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={current.url} download={current.file.name} className={`${buttonClass} bg-sky-700 text-white`}><Download size={18} /> ดาวน์โหลดภาพนี้ PNG</a>
        {canShareFiles([current.file]) && <button type="button" disabled={busy} onClick={() => share([current.file])} className={`${buttonClass} border border-sky-200 text-sky-800 disabled:opacity-50`}><Share2 size={18} /> แชร์ภาพนี้</button>}
      </div>
    </> : <p role="status" className="py-6 text-sm text-slate-600">{failed ? 'สร้างภาพไม่สำเร็จ ลองปิดแล้วเปิดหน้าต่างแชร์อีกครั้ง' : 'กำลังแบ่งและเตรียมชุดภาพ…'}</p>}
    <p className="mt-3 text-xs text-slate-600">แต่ละภาพมีชื่อพื้นที่ เวลา และแหล่งข้อมูลครบ ส่งต่อแยกภาพได้</p>
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
    lines.push('⚠️ ข้อมูลอาจไม่เป็นปัจจุบัน กรุณาตรวจสอบเวลาตรวจวัดในหน้ารายละเอียด')
  }
  lines.push('【ฝนในพื้นที่】')
  if (stats.rain) lines.push(`ฝนสะสม 24 ชม. สูงสุดในสถานีที่แสดง: ${formatMm(stats.rain.mm)} มม.\nสถานี: ${stats.rain.station.station_name}\nตรวจวัด: ${dateText(stats.rain.station.recorded_at)} น.`)
  else lines.push('ยังไม่มีค่าฝนปัจจุบันสำหรับสรุป\nไม่มีข้อมูล ไม่ได้หมายความว่าไม่มีฝน')
  lines.push('【อ่างเก็บน้ำ】')
  for (const dam of stations.filter(s => s.station_type === 'dam')) {
    const place = [dam.tambon_name && `ต.${dam.tambon_name}`, distanceText(dam.distance_km)].filter(Boolean).join(' · ')
    const title = `${dam.station_name || 'ไม่ระบุชื่ออ่าง'}${place ? ` (${place})` : ''}`
    if (isStale(dam.recorded_at, now, DAM_STALE_HOURS)) {
      lines.push(`• ${title}\n  ไม่มีข้อมูลปัจจุบัน`)
      continue
    }
    const single = summaryStats({ dams: [dam], now }).dam
    const percent = toNum(dam.storage_percent) ?? single?.percent
    lines.push(percent == null ? `• ${title}\n  ไม่มีค่าปริมาณน้ำสำหรับสรุป`
      : `• ${title}\n  น้ำ ${percent.toFixed(1)}% ของความจุ\n  ตรวจวัด: ${dateText(dam.recorded_at)} น.`)
  }
  if (!stations.some(s => s.station_type === 'dam')) lines.push('ไม่มีอ่างเก็บน้ำในขอบเขตที่กำหนด')
  lines.push('【ระดับน้ำ】')
  if (stats.bank) lines.push(`• ${stats.bank.station.station_name}\n  ${stats.bank.text}\n  ตรวจวัด: ${dateText(stats.bank.station.recorded_at)} น.`)
  else lines.push('ไม่มีค่าระดับน้ำปัจจุบันสำหรับสรุป')
  lines.push('【ขอบเขตข้อมูล】\nในตำบล และสถานีข้างเคียงระยะไม่เกิน 5 กม. จากสำนักงาน อปท.\nไม่ครอบคลุมทุกจุดในพื้นที่\nไม่มีข้อมูล ไม่ได้หมายความว่าสถานการณ์ปกติ', '【แหล่งข้อมูล】\nThaiWater (สสน.) · ไม่ใช่ประกาศเตือนภัยของ อปท.', `ตรวจสอบข้อมูลล่าสุด:\n${appUrl('/water-situation?scope=nearby5')}`)
  return lines.join('\n\n')
}

function WaterShareDialog({ tenant, data, now, refreshFailed, close, buttonClass }) {
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
  const fullText = text
  return <dialog ref={dialog} data-water-share-dialog aria-label="แชร์สถานการณ์ในพื้นที่" onCancel={close}
    className="m-auto rounded-2xl border border-sky-200 bg-sky-50 p-0 text-slate-800 shadow-xl backdrop:bg-slate-950/60"
    style={{ width: 'min(640px, calc(100vw - 24px))', maxHeight: '90dvh' }}>
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-sky-100 bg-white px-4 py-2">
        <h2 className="text-base font-bold">แชร์สถานการณ์ในพื้นที่</h2>
        <button type="button" onClick={close} className={`${buttonClass} text-slate-700`} aria-label="ปิดหน้าต่างแชร์"><X size={20} /> ปิด</button>
      </header>
      <div className="space-y-3 p-3 sm:p-4">
        <p className="text-xs text-slate-600">ชุดภาพ ณ เวลาที่เปิดหน้าต่าง หากต้องการข้อมูลใหม่ให้ปิดแล้วเปิดอีกครั้ง</p>
        <ShareInfographic tenant={tenant} data={data} now={now} refreshFailed={refreshFailed} url={url} text={text} setStatus={setStatus} buttonClass={buttonClass} />
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
  const [snapshot, setSnapshot] = useState(null)
  if (!props.tenant?.name) return null
  const buttonClass = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold'
  return <section className="rounded-2xl border border-sky-200 bg-sky-50 p-4" aria-label="แชร์สถานการณ์ในพื้นที่">
    <button type="button" aria-haspopup="dialog" onClick={() => setSnapshot({ ...props, now: Date.now() })} className={`${buttonClass} w-full bg-sky-700 text-white hover:bg-sky-800`}>
      <Share2 size={18} /> แชร์สถานการณ์ในพื้นที่
    </button>
    {snapshot && <WaterShareDialog {...snapshot} close={() => setSnapshot(null)} buttonClass={buttonClass} />}
  </section>
}
