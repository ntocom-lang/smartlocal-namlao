import { useEffect, useMemo, useState } from 'react'
import { Download, Share2 } from 'lucide-react'
import {
  buildInfographicModel, buildInfographicSvg, createCanvasMeasure, svgDataUrl, svgToPngFile,
} from '../../lib/complaintMonthlyInfographic'

// ภาพสรุปเรื่องร้องเรียนประจำเดือนสำหรับเผยแพร่ (LINE/Facebook) — วาดจากยอดรวมที่หน้าสถิติคำนวณไว้แล้ว
// ภาพที่เห็นบนหน้ากับไฟล์ PNG ที่ดาวน์โหลดมาจากสตริง SVG ก้อนเดียวกัน (ดู src/lib/complaintMonthlyInfographic.js)
//
// เตรียมไฟล์ PNG ไว้ล่วงหน้าตั้งแต่ภาพขึ้นจอ ไม่ใช่ตอนกดปุ่ม: navigator.share() ต้องถูกเรียกในจังหวะที่ผู้ใช้เพิ่งกด
// ถ้าต้องรอวาดภาพก่อน เบราว์เซอร์มือถือจะปฏิเสธการแชร์ (แบบเดียวกับ ReportInfographic ของรถรับ-ส่งผู้ป่วย)
export default function ComplaintMonthlyInfographic({ summary, tenantName }) {
  const image = useMemo(() => {
    try {
      return buildInfographicSvg(buildInfographicModel(summary, { tenantName }), createCanvasMeasure())
    } catch {
      return null
    }
  }, [summary, tenantName])
  const imageKey = image ? image.svg : ''
  const fileName = `complaints-${summary.period.key}.png`

  const [prepared, setPrepared] = useState(null)
  const [retry, setRetry] = useState(0)
  const [sharing, setSharing] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!image) return undefined
    let active = true
    svgToPngFile(image.svg, image.width, image.height, fileName)
      .then(file => { if (active) setPrepared({ key: imageKey, file }) })
      .catch(() => { if (active) setPrepared({ key: imageKey, error: 'เตรียมไฟล์ภาพไม่สำเร็จ กรุณาลองอีกครั้ง' }) })
    return () => { active = false }
  }, [image, imageKey, fileName, retry])

  // ไฟล์ที่เตรียมไว้ใช้ได้ก็ต่อเมื่อเป็นของภาพปัจจุบัน — สลับเดือนแล้วห้ามดาวน์โหลดภาพของเดือนเก่าใต้หัวข้อเดือนใหม่
  const file = prepared?.key === imageKey ? prepared.file ?? null : null
  const error = prepared?.key === imageKey ? prepared.error ?? '' : ''

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
      if (!navigator.share || !navigator.canShare?.({ files: [file] })) {
        setMessage('เครื่องนี้ไม่รองรับแชร์ภาพโดยตรง กดดาวน์โหลดภาพแล้วแนบใน LINE หรือ Facebook ได้')
        return
      }
      setSharing(true)
      await navigator.share({
        files: [file],
        title: `สรุปเรื่องร้องเรียน เดือน${summary.period.label} | ${tenantName}`,
        text: summary.sentences.join('\n'),
      })
    } catch (cause) {
      if (cause?.name !== 'AbortError') setMessage('เปิดเมนูแชร์ไม่สำเร็จ ลองอีกครั้ง หรือดาวน์โหลดภาพแล้วแนบในแอป')
    } finally {
      setSharing(false)
    }
  }

  if (!image) return null

  const buttonClass = 'flex min-h-11 items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 max-sm:w-full'
  return (
    <section aria-label="ภาพสรุปประจำเดือนสำหรับเผยแพร่" className="bg-white rounded-2xl border border-gray-100 p-3 md:p-4 print:hidden">
      <p className="text-sm font-bold text-gray-700">ภาพสรุปประจำเดือน</p>
      <p className="text-xs text-gray-500 mt-0.5">ดาวน์โหลดไปโพสต์ใน LINE หรือ Facebook ได้ · ระบบวาดจากตัวเลขรวม ไม่มีข้อมูลระบุตัวบุคคล</p>
      <img
        src={svgDataUrl(image.svg)}
        alt={summary.sentences.join(' ')}
        width={image.width}
        height={image.height}
        className="mt-3 mx-auto block h-auto w-full max-w-md rounded-xl border border-gray-200"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={buttonClass} disabled={!file} onClick={download}>
          <Download size={16} aria-hidden="true" />ดาวน์โหลดภาพ (PNG)
        </button>
        <button type="button" className={buttonClass} disabled={!file || sharing} onClick={share}>
          <Share2 size={16} aria-hidden="true" />{sharing ? 'กำลังเปิดเมนูแชร์...' : 'แชร์ภาพ'}
        </button>
      </div>
      {!file && !error && <p role="status" className="mt-2 text-xs text-gray-500">กำลังเตรียมไฟล์ภาพ...</p>}
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}{' '}
          <button type="button" className="font-bold underline" onClick={() => setRetry(value => value + 1)}>ลองใหม่</button>
        </p>
      )}
      {message && <p role="status" className="mt-2 rounded-xl bg-sky-50 p-3 text-xs text-sky-900">{message}</p>}
    </section>
  )
}
