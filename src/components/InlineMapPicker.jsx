import { useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, Maximize2, Minimize2 } from 'lucide-react'
import LeafletMapPicker from './common/LeafletMapPicker'

export default function InlineMapPicker({
  value,
  onChange,
  defaultCenter,
  // ปุ่มยืนยันต้องอยู่บนตัวแผนที่ — ถ้าวางไว้ใต้แผนที่ในหน้าที่เรียกใช้ จะถูก portal เต็มจอบังจนกดไม่ได้
  onConfirm,
  confirmDisabled = false,
  confirmLabel = 'ใช้ตำแหน่งนี้',
  confirmClassName = 'bg-blue-600',
  // ส่งต่อให้ตัวปักหมุด — เตือนเมื่อหมุดดูเหมือนอยู่นอกเขต อปท. (ค่าเริ่มต้นปิด เปิดเฉพาะหน้าประชาชนที่จุดต้องอยู่ในเขต)
  warnOutsideBoundary = false,
}) {
  const [fullscreen, setFullscreen] = useState(false)
  // ตัวปักหมุดบอกว่ากำลังแสดงคำเตือนนอกเขตอยู่ไหม — แถวคำเตือนสูงราว 66px ที่จอ 360px (3 บรรทัด) ต้องหักจากความสูงแผนที่
  // ตอนเต็มจอ เฉพาะตอนที่แสดงอยู่เท่านั้น ไม่หักถาวรเพื่อไม่ให้เสียพื้นที่แผนที่ในกรณีปกติ (วัดแล้วถ้าไม่หัก ล้นขอบจอ 63px)
  const [warningShown, setWarningShown] = useState(false)

  const confirmButton = onConfirm ? (
    <button type="button" disabled={confirmDisabled} onClick={onConfirm}
      className={`flex items-center gap-1.5 rounded-full px-3.5 py-2.5 text-xs font-bold text-white shadow-lg transition-transform active:scale-95 disabled:opacity-60 ${confirmClassName}`}>
      <CheckCircle2 size={16} /> {confirmLabel}
    </button>
  ) : null

  const content = (
    <div className={fullscreen ? 'flex h-full min-h-0 flex-col bg-white' : 'relative'}>
      {fullscreen && (
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3">
          <p className="font-bold text-gray-800">เลือกตำแหน่งบนแผนที่</p>
          <button type="button" onClick={() => setFullscreen(false)} className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-semibold text-gray-600">
            <Minimize2 size={15} /> ย่อแผนที่
          </button>
        </div>
      )}
      <div className={fullscreen ? 'min-h-0 flex-1 overflow-auto p-4' : ''}>
        {/* เต็มจอ: หัว + ช่องค้นหา + กล่องที่อยู่ + ระยะห่าง กินราว 220px — หักไม่พอกล่องที่อยู่จะตกขอบจอ
            dvh ไม่นับแถบที่อยู่ของเบราว์เซอร์มือถือ (100vh นับรวม จึงล้นบนมือถือจริง) ใช้ vh เป็นค่าสำรองเครื่องเก่า */}
        <LeafletMapPicker
          initialPos={value}
          fallbackPos={defaultCenter}
          onLocationSelect={onChange}
          modal={false}
          skipGeolocation
          overlayAction={confirmButton}
          warnOutsideBoundary={warnOutsideBoundary}
          onOutsideChange={setWarningShown}
          mapClassName={fullscreen
            ? (warningShown
              ? 'w-full h-[calc(100vh-300px)] supports-[height:100dvh]:h-[calc(100dvh-300px)] min-h-[260px]'
              : 'w-full h-[calc(100vh-230px)] supports-[height:100dvh]:h-[calc(100dvh-230px)] min-h-[260px]')
            : 'w-full h-80 min-h-[320px]'}
        />
      </div>
      {!fullscreen && (
        <button type="button" onClick={() => setFullscreen(true)}
          className="absolute right-3 top-[58px] z-20 flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 shadow"
          title="ขยายเต็มจอ">
          <Maximize2 size={16} />
        </button>
      )}
    </div>
  )

  if (!fullscreen) return content
  return createPortal(<div className="fixed inset-0 z-9999 bg-white">{content}</div>, document.body)
}
