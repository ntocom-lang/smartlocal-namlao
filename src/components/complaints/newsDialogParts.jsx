import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Download, Share2 } from 'lucide-react'
import { copyText } from '../../lib/complaintTrack'
import { newsShareText, svgDataUrl } from '../../lib/complaintNewsImage'

// คอมโพเนนต์ที่กล่องภาพข่าวรายเรื่อง (ComplaintNewsDialog) กับกล่องภาพข่าวรวม (ComplaintNewsBatchDialog) ใช้ร่วมกัน
// ตัวโหลดรูปและ hook อยู่ที่ newsDialogData.js · ในภาพไม่มีชื่อ/เบอร์/ที่อยู่/พิกัดของผู้แจ้ง (กติกาอยู่ที่ src/lib/complaintNewsImage.js)

/** กรอบกล่อง (portal + พื้นหลังมืด) ใช้ร่วมกันทั้งตัวจริงและสถานะกำลังโหลด/โหลดไม่ได้ของโหมด exec */
export function DialogShell({ onClose, children }) {
  // portal แยก DOM แต่ event ของ React ยังไหลตามต้นไม้คอมโพเนนต์ — ปิดเฉพาะคลิกที่พื้นหลังจริง และไม่ให้ไหลต่อขึ้นไป (แบบเดียวกับ FinishComplaintDialog)
  function handleBackdropClick(e) {
    e.stopPropagation()
    if (e.target === e.currentTarget) onClose?.()
  }
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4" onClick={handleBackdropClick}>
      <div className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl">
        {children}
      </div>
    </div>,
    document.body,
  )
}

const buttonClass = 'flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50'

/** คอลัมน์ขวาของกล่อง: ปุ่มดาวน์โหลด/แชร์/คัดลอกข้อความ + ภาพตัวอย่าง (ภาพที่เห็น = ไฟล์ PNG ที่ดาวน์โหลด) */
export function NewsOutputPanel({ image, model, tenantName, file, error, onRetry }) {
  const [sharing, setSharing] = useState(false)
  const [message, setMessage] = useState('')
  const canShareFile = !!file && typeof navigator !== 'undefined' && typeof navigator.share === 'function' && !!navigator.canShare?.({ files: [file] })
  const shareText = newsShareText(model)

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

  return (
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
          <button type="button" className="font-bold underline" onClick={onRetry}>ลองใหม่</button>
        </p>
      )}
      {file && !canShareFile && <p className="text-[11px] text-gray-500">เครื่องนี้แชร์ภาพโดยตรงไม่ได้ กดดาวน์โหลดแล้วแนบใน LINE หรือ Facebook</p>}
      {message && <p role="status" className="rounded-xl bg-sky-50 p-3 text-xs text-sky-900">{message}</p>}
      {image && image.fitsA4 === false && (
        // ภาพข่าวต้องจบ A4 แผ่นเดียว (เจ้าของระบบสั่ง 2569-11-12) — ระบบย่อรูป/ลดของประกอบให้สุดแล้วยังล้น ไม่ตัดข้อความหรือรูปทิ้งเอง ให้คนเลือก
        <p role="status" className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
          ภาพนี้ยาวเกิน 1 แผ่น A4 — ลองเลือกรูปให้เหลือ 1–2 รูป ปิดรูปนายก หรือย่อข้อความข่าว
        </p>
      )}
      {image && (
        <img src={svgDataUrl(image.svg)} alt={`ตัวอย่างภาพข่าว ${model.headline}`} width={image.width} height={image.height}
          className="mx-auto block h-auto w-full max-w-sm rounded-xl border border-gray-200" />
      )}
    </div>
  )
}
