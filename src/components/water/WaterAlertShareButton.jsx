import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, Loader2, Share2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { buildPosterModel } from '../../lib/waterAlertPoster'

// ปุ่ม "แชร์ภาพแจ้งเตือน" ข้างแถบแจ้งเตือนน้ำ-ฝน (หน้าแรก + หน้า /water-situation)
// ภาพ 1080×1350 PNG วาดจากข้อมูลชุดเดียวกับแถบ (buildAlerts) — ไม่มีเรื่องเข้าเกณฑ์หัวภาพ (อ่าง >100% / ฝนหนักมาก) = ไม่มีปุ่ม
// ไม่ยิง RPC ตอนโหลดหน้า: สายด่วนของ อปท. อ่านเฉพาะตอนกดเปิดหน้าต่างภาพ (ไม่เพิ่มภาระหน้าแรก)
//
// เตรียมไฟล์ PNG ไว้ล่วงหน้า (ตอนเปิดหน้าต่าง) ไม่ใช่ตอนกดแชร์: navigator.share() ต้องถูกเรียกทันทีที่ผู้ใช้เพิ่งกด
// ถ้ารอเครือข่าย/วาดภาพก่อนแล้วค่อยเรียก เบราว์เซอร์จะปฏิเสธ (แบบเดียวกับ ComplaintNewsDialog)
// แชร์ไฟล์ไม่ได้ (เดสก์ท็อป/เบราว์เซอร์เก่า) = ปุ่มดาวน์โหลดแทน

function canShareFiles(files) {
  try { return files.length > 0 && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files }) }
  catch { return false }
}

const buttonBase = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold disabled:opacity-50'

/**
 * @param {{ rain: object[], ews: object[], levels: object[], dams: object[], warnings?: object[], tenant: object, now: number, className?: string }} props
 */
export default function WaterAlertShareButton({ rain, ews, levels, dams, warnings, tenant, now, className = '' }) {
  const input = { rain, ews, levels, dams, warnings, tenant, now }
  const model = buildPosterModel(input)
  // ถ่ายข้อมูลไว้ตอนกดเปิด (snapshot) — ภาพไม่วาดซ้ำทุกครั้งที่แถบรีเฟรช และตัวเลขในภาพตรงกับที่ผู้ใช้เห็นตอนกด
  const [snapshot, setSnapshot] = useState(null)
  if (!model) return null

  return (
    <>
      <button type="button" onClick={() => setSnapshot(input)}
        className={`${buttonBase} border-2 border-amber-500 bg-white text-amber-900 hover:bg-amber-50 ${className}`}>
        <Share2 size={18} aria-hidden="true" /> แชร์ภาพแจ้งเตือน
      </button>
      {snapshot && <PosterDialog snapshot={snapshot} onClose={() => setSnapshot(null)} />}
    </>
  )
}

function PosterDialog({ snapshot, onClose }) {
  const [state, setState] = useState({ status: 'loading', url: null, file: null, model: null })
  const [message, setMessage] = useState('')
  const [sharing, setSharing] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let alive = true
    let objectUrl = null
    ;(async () => {
      try {
        const current = snapshot
        let contacts = []
        // สายด่วน 2 อันดับแรกของสมุด urgent — อ่านไม่ได้ = ภาพไม่มีสายด่วน (ไม่ใช้เบอร์สำรอง)
        if (current.tenant?.id) {
          try {
            const { data } = await supabase.rpc('get_public_emergency_contacts', { _municipality_id: current.tenant.id, _book: 'urgent' })
            contacts = Array.isArray(data) ? data : []
          } catch { contacts = [] }
        }
        const model = buildPosterModel({ ...current, contacts })
        if (!model) throw new Error('no-topic')
        const { renderWaterAlertPoster } = await import('../../lib/waterAlertPosterImage')
        const { blob, file } = await renderWaterAlertPoster(model, { logoUrl: current.tenant?.logo_url ?? null })
        objectUrl = URL.createObjectURL(blob)
        if (alive) setState({ status: 'ready', url: objectUrl, file, model })
      } catch {
        if (alive) setState({ status: 'error', url: null, file: null, model: null })
      }
    })()
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [snapshot, retry])

  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const { status, url, file, model } = state
  const canShare = status === 'ready' && canShareFiles([file])

  async function share() {
    setSharing(true); setMessage('')
    try { await navigator.share({ files: [file], title: 'แจ้งเตือนสถานการณ์น้ำ–ฝน', text: model.shareText }) }
    catch (error) { if (error?.name !== 'AbortError') setMessage('แชร์ภาพไม่ได้ กรุณาดาวน์โหลดภาพแล้วแนบในกลุ่ม LINE หรือ Facebook') }
    finally { setSharing(false) }
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4"
      onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label="ภาพแจ้งเตือนสถานการณ์น้ำ–ฝนสำหรับแชร์"
        className="max-h-[94vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-4 shadow-xl sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <p className="text-base font-bold text-gray-800">ภาพแจ้งเตือนสำหรับแชร์</p>
          <button type="button" onClick={onClose} aria-label="ปิด" className="-mr-2 -mt-2 flex h-11 w-11 items-center justify-center rounded-full hover:bg-gray-100">
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {status === 'loading' && (
          <p role="status" className="mt-6 flex items-center gap-2 text-sm text-gray-600">
            <Loader2 size={16} className="animate-spin" aria-hidden="true" /> กำลังเตรียมภาพ...
          </p>
        )}
        {status === 'error' && (
          <p role="alert" className="mt-6 text-sm text-red-700">
            เตรียมภาพไม่สำเร็จ{' '}
            <button type="button" className="min-h-[44px] font-bold underline" onClick={() => { setState({ status: 'loading', url: null, file: null, model: null }); setRetry(value => value + 1) }}>ลองใหม่</button>
          </p>
        )}
        {status === 'ready' && (
          <>
            <img src={url} alt={model.altText} width="1080" height="1350" className="mx-auto mt-3 w-full rounded-xl border border-gray-200" />
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              {canShare && (
                <button type="button" disabled={sharing} onClick={share} className={`${buttonBase} flex-1 bg-amber-600 text-white hover:bg-amber-700`}>
                  <Share2 size={18} aria-hidden="true" /> แชร์ภาพ
                </button>
              )}
              <a href={url} download={file.name} className={`${buttonBase} flex-1 border border-gray-300 bg-white text-gray-700 hover:bg-gray-50`}>
                <Download size={18} aria-hidden="true" /> ดาวน์โหลดภาพ PNG
              </a>
            </div>
            {message && <p role="alert" className="mt-2 text-sm text-red-700">{message}</p>}
            {!canShare && <p className="mt-2 text-xs text-gray-600">อุปกรณ์นี้แชร์ไฟล์ตรงไม่ได้ ดาวน์โหลดภาพแล้วแนบใน LINE หรือ Facebook ได้</p>}
            <p className="mt-2 text-xs leading-relaxed text-gray-600">ภาพนี้ระบบสร้างจากข้อมูล ThaiWater (สสน.) ไม่ใช่ประกาศของหน่วยงาน</p>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
