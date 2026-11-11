import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Copy, Download, Loader2, Megaphone, Share2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { fetchImageAsDataUrl } from '../../lib/driveStorage'
import { appUrl } from '../../lib/basename'
import { copyText } from '../../lib/complaintTrack'
import {
  MAX_NEWS_PHOTOS, buildNewsModel, buildNewsSvg, createCanvasMeasure, defaultShowDuration, draftHeadline,
  newsShareText, svgDataUrl, svgToPngFile,
} from '../../lib/complaintNewsImage'

// กล่องสร้าง "ภาพข่าวประชาสัมพันธ์" ของคำร้องที่ดำเนินการแล้ว (เจ้าของระบบอนุมัติ 2569-11-11)
// ภาพที่เห็นในกล่อง = ไฟล์ PNG ที่ดาวน์โหลด/แชร์ (สตริง SVG ก้อนเดียวกัน ดู src/lib/complaintNewsImage.js)
// ในภาพไม่มีชื่อ/เบอร์/ที่อยู่/พิกัด/รายละเอียดเรื่องของผู้แจ้ง — มีแค่ที่เจ้าหน้าที่เห็นและแก้ในกล่องนี้
//
// เตรียมไฟล์ PNG ไว้ล่วงหน้า ไม่ใช่ตอนกดปุ่ม: navigator.share() ต้องถูกเรียกในจังหวะที่ผู้ใช้เพิ่งกด
// (แบบเดียวกับ ComplaintMonthlyInfographic)

const MAX_CANDIDATES = 12
const KEEP_SIDE = 1400

// ย่อรูปก่อนฝังใน SVG — รูปมือถือหลาย MB ฝังตรงๆ ทำให้ภาพตัวอย่างและการแปลงเป็น PNG ช้า ภาพข่าวใช้ไม่เกินครึ่งความกว้าง 1080 อยู่แล้ว
// ย่อไม่ได้ (เบราว์เซอร์ถอดรหัสไม่ได้ ฯลฯ) = ใช้ตัวเดิม ไม่ล้ม
async function shrinkDataUrl(dataUrl) {
  try {
    const image = new Image()
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = dataUrl })
    const scale = Math.min(1, KEEP_SIDE / Math.max(image.naturalWidth, image.naturalHeight))
    if (scale >= 1 && dataUrl.length < 600000) return dataUrl
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) return dataUrl
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.86)
  } catch {
    return dataUrl
  }
}

async function loadImage(ref) {
  const result = await fetchImageAsDataUrl(ref)
  if (result.error || !result.dataUrl) return { dataUrl: null }
  return { dataUrl: await shrinkDataUrl(result.dataUrl) }
}

export default function ComplaintNewsDialog({ complaint: c, tenant, departmentName = '', categoryLabel = '', closedAt = null, onClose }) {
  const tenantName = tenant?.name ?? ''
  const reportUrl = useMemo(() => appUrl('/complaint'), [])
  const workRefs = useMemo(() => (c.work_photos ?? []).filter(Boolean).slice(0, MAX_CANDIDATES), [c.work_photos])
  const reporterRefs = useMemo(() => (c.attachments ?? []).filter(Boolean).slice(0, MAX_CANDIDATES), [c.attachments])

  const [headline, setHeadline] = useState(() => draftHeadline({ departmentName, tenantName, categoryLabel, village: c.village }))
  const [timelineRow, setTimelineRow] = useState(null)
  const [detailEdit, setDetailEdit] = useState(null)
  const [statusOn, setStatusOn] = useState(true)
  const [durationEdit, setDurationEdit] = useState(null)
  // รูปที่เลือก: ใช้ "กลุ่ม:ลำดับ" เป็นคีย์ (รูปผลงานติ๊กไว้ก่อน สูงสุด 4 · รูปผู้แจ้งไม่ติ๊กไว้ก่อน)
  const [picked, setPicked] = useState(() => new Set(workRefs.slice(0, MAX_NEWS_PHOTOS).map((_, i) => `w:${i}`)))
  const [loaded, setLoaded] = useState({})
  const [logo, setLogo] = useState(null)
  const [prepared, setPrepared] = useState(null)
  const [retry, setRetry] = useState(0)
  const [sharing, setSharing] = useState(false)
  const [message, setMessage] = useState('')

  // บันทึกผลตอนปิดงาน = แถว complaint_timeline สถานะ closed ล่าสุดของเรื่องนี้ (finish_complaint เขียนไว้ทุกครั้ง)
  useEffect(() => {
    let alive = true
    supabase.from('complaint_timeline')
      .select('note, created_at')
      .eq('complaint_id', c.id)
      .eq('status', 'closed')
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data, error }) => {
        if (!alive) return
        if (error) console.error('complaint_timeline load error:', error.message)
        setTimelineRow(data?.[0] ?? null)
      }, () => {})
    return () => { alive = false }
  }, [c.id])

  // โลโก้ + รูปทั้งหมดที่เลือกได้ — โหลดไม่ได้ = ข้าม (โลโก้ไม่ขึ้นก็ไม่ error)
  useEffect(() => {
    let alive = true
    if (tenant?.logo_url) loadImage(tenant.logo_url).then(result => { if (alive) setLogo(result.dataUrl) })
    const refs = [...workRefs.map((ref, i) => [`w:${i}`, ref]), ...reporterRefs.map((ref, i) => [`a:${i}`, ref])]
    for (const [key, ref] of refs) {
      loadImage(ref).then(result => { if (alive) setLoaded(prev => ({ ...prev, [key]: result })) })
    }
    return () => { alive = false }
  }, [tenant?.logo_url, workRefs, reporterRefs])

  const detail = detailEdit ?? timelineRow?.note ?? c.technician_note ?? ''
  const closed = closedAt ?? timelineRow?.created_at ?? c.closed_at
  const durationOn = durationEdit ?? defaultShowDuration({ closedAt: closed, dueDate: c.due_date })

  const model = useMemo(() => buildNewsModel({
    complaint: c, tenantName, departmentName, categoryLabel, closedAt: closed, createdAt: c.created_at, dueDate: c.due_date,
    showStatus: statusOn, showDuration: durationOn, headline, detail, reportUrl,
  }), [c, tenantName, departmentName, categoryLabel, closed, statusOn, durationOn, headline, detail, reportUrl])
  const deferredModel = useDeferredValue(model)

  const photoDataUrls = useMemo(() => {
    const keys = [...workRefs.map((_, i) => `w:${i}`), ...reporterRefs.map((_, i) => `a:${i}`)]
    return keys.filter(key => picked.has(key)).map(key => loaded[key]?.dataUrl ?? null)
  }, [picked, loaded, workRefs, reporterRefs])

  const image = useMemo(() => {
    try {
      return buildNewsSvg(deferredModel, createCanvasMeasure(), { logoDataUrl: logo, photoDataUrls })
    } catch {
      return null
    }
  }, [deferredModel, logo, photoDataUrls])
  const imageKey = image ? image.svg : ''
  const fileName = `news-${String(c.ref_no ?? c.id).replace(/[^A-Za-z0-9_-]+/g, '-')}.png`

  useEffect(() => {
    if (!image) return undefined
    let active = true
    svgToPngFile(image.svg, image.width, image.height, fileName)
      .then(file => { if (active) setPrepared({ key: imageKey, file }) })
      .catch(() => { if (active) setPrepared({ key: imageKey, error: 'เตรียมไฟล์ภาพไม่สำเร็จ กรุณาลองอีกครั้ง' }) })
    return () => { active = false }
  }, [image, imageKey, fileName, retry])

  const file = prepared?.key === imageKey ? prepared.file ?? null : null
  const error = prepared?.key === imageKey ? prepared.error ?? '' : ''
  const canShareFile = !!file && typeof navigator !== 'undefined' && typeof navigator.share === 'function' && !!navigator.canShare?.({ files: [file] })
  const shareText = newsShareText(model)

  function toggle(key) {
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else if (next.size < MAX_NEWS_PHOTOS) next.add(key)
      return next
    })
  }

  function download() {
    if (!file) return
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = file.name
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }

  async function share() {
    if (!file || sharing) return
    setMessage('')
    try {
      setSharing(true)
      await navigator.share({ files: [file], title: `ข่าวประชาสัมพันธ์ | ${tenantName}`, text: shareText })
    } catch (cause) {
      if (cause?.name !== 'AbortError') setMessage('เปิดเมนูแชร์ไม่สำเร็จ ลองอีกครั้ง หรือกดดาวน์โหลดภาพแล้วแนบในแอป')
    } finally {
      setSharing(false)
    }
  }

  async function copy() {
    setMessage((await copyText([model.headline, model.detail].filter(Boolean).join('\n\n'))) ? 'คัดลอกข้อความแล้ว' : 'คัดลอกไม่สำเร็จ ลองเลือกข้อความแล้วคัดลอกเอง')
  }

  // portal แยก DOM แต่ event ของ React ยังไหลตามต้นไม้คอมโพเนนต์ — ปิดเฉพาะคลิกที่พื้นหลังจริง และไม่ให้ไหลต่อขึ้นไป (แบบเดียวกับ FinishComplaintDialog)
  function handleBackdropClick(e) {
    e.stopPropagation()
    if (e.target === e.currentTarget) onClose?.()
  }

  const failedCount = Object.values(loaded).filter(item => !item.dataUrl).length
  const stillLoading = workRefs.length + reporterRefs.length - Object.keys(loaded).length
  const buttonClass = 'flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50'

  const photoGroup = (refs, prefix) => (
    <div className="grid grid-cols-4 gap-1.5">
      {refs.map((_, i) => {
        const key = `${prefix}:${i}`
        const item = loaded[key]
        const on = picked.has(key)
        const blocked = !on && picked.size >= MAX_NEWS_PHOTOS
        return (
          <label key={key} className={`relative aspect-square overflow-hidden rounded-xl border-2 bg-gray-100 ${on ? 'border-orange-500' : 'border-transparent'} ${blocked || (item && !item.dataUrl) ? 'opacity-40' : 'cursor-pointer'}`}>
            {item?.dataUrl
              ? <img src={item.dataUrl} alt="" className="h-full w-full object-cover" />
              : <span className="flex h-full w-full items-center justify-center text-[10px] text-gray-500">{item ? 'โหลดไม่ได้' : <Loader2 size={14} className="animate-spin" />}</span>}
            <input type="checkbox" className="absolute left-1 top-1 h-4 w-4 accent-orange-600" checked={on}
              disabled={blocked || !item?.dataUrl} onChange={() => toggle(key)} aria-label={`เลือกรูปที่ ${i + 1}`} />
          </label>
        )
      })}
    </div>
  )

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4" onClick={handleBackdropClick}>
      <div className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-base font-bold text-gray-800"><Megaphone size={16} style={{ color: '#c2410c' }} /> ภาพข่าวประชาสัมพันธ์</p>
            <p className="mt-0.5 text-xs text-gray-500">ดาวน์โหลดหรือแชร์ลง LINE/เพจได้ · ในภาพไม่มีชื่อ เบอร์ หรือที่อยู่ของผู้แจ้ง</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-gray-100" aria-label="ปิด"><X size={18} className="text-gray-500" /></button>
        </div>

        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="news-headline" className="text-xs font-semibold text-gray-600">ข้อความข่าว <span className="font-normal text-gray-400">(ระบบร่างให้ แก้ได้)</span></label>
              <textarea id="news-headline" value={headline} onChange={e => setHeadline(e.target.value)} rows={4} maxLength={400}
                className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-200" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="news-detail" className="text-xs font-semibold text-gray-600">รายละเอียด <span className="font-normal text-gray-400">(บันทึกผลตอนปิดงาน · เว้นว่างได้)</span></label>
              <textarea id="news-detail" value={detail} onChange={e => setDetailEdit(e.target.value)} rows={3} maxLength={1000}
                className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-200" />
            </div>

            <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={statusOn} onChange={e => setStatusOn(e.target.checked)} />
                แสดง "ดำเนินการแล้ว"
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={model.showDuration} disabled={!model.durationLabel}
                  onChange={e => setDurationEdit(e.target.checked)} />
                แสดง "{model.durationLabel || 'ใช้เวลา — วันทำการ'}"
              </label>
              <p className="text-[11px] text-gray-500">ระบบติ๊กให้เองเมื่อเสร็จทันกำหนด · เกินกำหนดจะไม่ติ๊กไว้ก่อน</p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-600">
                รูปในภาพ ({picked.size}/{MAX_NEWS_PHOTOS}) <span className="font-normal text-gray-400">· รูปหลังดำเนินการ</span>
              </p>
              {workRefs.length > 0 ? photoGroup(workRefs, 'w') : <p className="text-xs text-gray-500">ยังไม่มีรูปหลังดำเนินการ</p>}
              {reporterRefs.length > 0 && (
                <div className="space-y-2 pt-1">
                  <p className="text-xs font-semibold text-gray-600">รูปจากผู้แจ้ง</p>
                  <p className="flex gap-1.5 rounded-xl border border-orange-200 bg-orange-50 p-2.5 text-xs font-medium text-orange-800">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>เลือกรูปจากผู้แจ้ง: ตรวจก่อนว่าไม่มีหน้าคน ป้ายทะเบียน หรือเลขที่บ้าน รูปนี้ผู้แจ้งส่งมาเพื่อแจ้งเรื่อง ไม่ได้ส่งมาเพื่อลงเพจ</span>
                  </p>
                  {photoGroup(reporterRefs, 'a')}
                </div>
              )}
              {stillLoading > 0 && <p role="status" className="text-[11px] text-gray-500">กำลังโหลดรูป...</p>}
              {failedCount > 0 && <p className="text-[11px] text-red-600">มี {failedCount} รูปที่โหลดไม่สำเร็จ ระบบข้ามรูปนั้นให้</p>}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonClass} disabled={!file} onClick={download}><Download size={16} aria-hidden="true" />ดาวน์โหลด PNG</button>
              {canShareFile && (
                <button type="button" className={buttonClass} disabled={sharing} onClick={share}>
                  <Share2 size={16} aria-hidden="true" />{sharing ? 'กำลังเปิดเมนูแชร์...' : 'แชร์'}
                </button>
              )}
              <button type="button" className={buttonClass} onClick={copy}><Copy size={16} aria-hidden="true" />คัดลอกข้อความ</button>
            </div>
            {!file && !error && <p role="status" className="text-xs text-gray-500">กำลังเตรียมไฟล์ภาพ...</p>}
            {error && (
              <p role="alert" className="text-xs text-red-700">{error}{' '}
                <button type="button" className="font-bold underline" onClick={() => setRetry(value => value + 1)}>ลองใหม่</button>
              </p>
            )}
            {file && !canShareFile && <p className="text-[11px] text-gray-500">เครื่องนี้แชร์ภาพโดยตรงไม่ได้ กดดาวน์โหลดแล้วแนบใน LINE หรือ Facebook</p>}
            {message && <p role="status" className="rounded-xl bg-sky-50 p-3 text-xs text-sky-900">{message}</p>}
            {image && (
              <img src={svgDataUrl(image.svg)} alt={`ตัวอย่างภาพข่าว ${model.headline}`} width={image.width} height={image.height}
                className="mx-auto block h-auto w-full max-w-sm rounded-xl border border-gray-200" />
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
