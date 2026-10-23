import { useEffect, useRef, useState } from 'react'
import { Eraser, ImageUp, Loader2, PenLine, Undo2, X } from 'lucide-react'
import SignaturePad from './SignaturePad'
import { esignMessage } from '../../lib/esign'
import { addMySignature } from '../../lib/esignApi'
import { fileToSignature } from '../../lib/signatureCanvas'
import { SIGNATURE_PEN_COLORS, SIGNATURE_PEN_WIDTHS, signatureClientMessage } from '../../lib/signatureImage'

// กล่อง "เพิ่มลายเซ็น" — 2 วิธี: เซ็นสดบนหน้าจอ / อัปโหลดรูป (ระบบลบพื้นขาวให้)
// ปิดได้ด้วยปุ่มปิด/ยกเลิก/Esc เท่านั้น ไม่ปิดเมื่อแตะพื้นหลัง (เซ็นเสร็จแล้วนิ้วหลุดไปโดนขอบ ลายเซ็นจะหายหมด)
const CHECKER = {
  backgroundImage: 'linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), '
    + 'linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
}

export default function AddSignatureDialog({ onClose, onSaved, isFirst }) {
  const [tab, setTab] = useState('draw')
  const [color, setColor] = useState(SIGNATURE_PEN_COLORS[0].hex)
  const [pen, setPen] = useState('M')
  const [hasInk, setHasInk] = useState(false)
  const [uploaded, setUploaded] = useState(null)
  const [reading, setReading] = useState(false)
  const [label, setLabel] = useState('ลายเซ็นของฉัน')
  const [makeDefault, setMakeDefault] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const padRef = useRef(null)
  const dialogRef = useRef(null)
  const openerRef = useRef(null)

  useEffect(() => {
    openerRef.current = document.activeElement
    const first = dialogRef.current?.querySelector('[data-first-focus]')
    first?.focus()
    const onKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      if (event.key === 'Tab') {
        const items = [...dialogRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]')]
        if (!items.length) return
        const firstItem = items[0]
        const lastItem = items[items.length - 1]
        if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem.focus() }
        else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      openerRef.current?.focus?.()
    }
  }, [onClose])

  async function handleFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError('')
    setUploaded(null)
    setReading(true)
    const result = await fileToSignature(file)
    setReading(false)
    if (!result.ok) { setError(signatureClientMessage(result.code)); return }
    setUploaded(result)
  }

  const ready = tab === 'draw' ? hasInk : Boolean(uploaded)

  async function handleSave() {
    setError('')
    setBusy(true)
    try {
      const signature = tab === 'draw' ? await padRef.current.toSignature() : uploaded
      if (!signature?.ok) { setError(signatureClientMessage(signature?.code)); return }
      const result = await addMySignature({ label: label.trim() || 'ลายเซ็นของฉัน', pngBase64: signature.base64, makeDefault: isFirst || makeDefault })
      if (!result?.ok) { setError(esignMessage(result)); return }
      await onSaved(result)
    } finally {
      setBusy(false)
    }
  }

  const tabClass = active => `flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
    active ? 'bg-white text-gray-800 shadow-xs' : 'text-gray-500 hover:text-gray-700'}`

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="add-signature-title" data-add-signature-dialog
        className="flex max-h-[100dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <h2 id="add-signature-title" className="text-base font-bold text-gray-800">เพิ่มลายเซ็น</h2>
          <button type="button" onClick={onClose} aria-label="ปิด" data-first-focus
            className="flex h-11 w-11 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <div role="tablist" aria-label="วิธีเพิ่มลายเซ็น" className="flex gap-1 rounded-xl bg-gray-100 p-1">
            <button type="button" role="tab" aria-selected={tab === 'draw'} onClick={() => { setTab('draw'); setError('') }} className={tabClass(tab === 'draw')} data-tab-draw>
              <PenLine size={15} /> เซ็นสด
            </button>
            <button type="button" role="tab" aria-selected={tab === 'upload'} onClick={() => { setTab('upload'); setError('') }} className={tabClass(tab === 'upload')} data-tab-upload>
              <ImageUp size={15} /> อัปโหลดรูป
            </button>
          </div>

          {tab === 'draw' ? (
            <div className="space-y-3">
              <SignaturePad ref={padRef} color={color} pen={pen} onInkChange={setHasInk} />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="flex items-center gap-1" role="group" aria-label="สีปากกา">
                  <span className="mr-1 text-xs font-semibold text-gray-500">สีปากกา</span>
                  {SIGNATURE_PEN_COLORS.map(item => (
                    <button key={item.key} type="button" aria-label={item.label} aria-pressed={color === item.hex} onClick={() => setColor(item.hex)}
                      className={`flex h-11 w-11 items-center justify-center rounded-full ${color === item.hex ? 'ring-2 ring-offset-1 ring-gray-500' : ''}`}>
                      <span className="h-6 w-6 rounded-full border border-white shadow-sm" style={{ backgroundColor: item.hex }} />
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1" role="group" aria-label="ความหนาเส้น">
                  {SIGNATURE_PEN_WIDTHS.map(item => (
                    <button key={item.key} type="button" aria-pressed={pen === item.key} onClick={() => setPen(item.key)}
                      className={`h-11 min-w-11 rounded-lg border px-2 text-xs font-bold ${pen === item.key ? 'border-gray-700 bg-gray-800 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className="ml-auto flex items-center gap-1">
                  <button type="button" onClick={() => padRef.current?.undo()} disabled={!hasInk} aria-label="ย้อนเส้นล่าสุด"
                    className="flex h-11 items-center gap-1 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                    <Undo2 size={14} /> ย้อน
                  </button>
                  <button type="button" onClick={() => padRef.current?.clear()} disabled={!hasInk}
                    className="flex h-11 items-center gap-1 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                    <Eraser size={14} /> ล้าง
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center hover:bg-gray-100">
                {reading ? <Loader2 size={24} className="animate-spin text-gray-400" /> : <ImageUp size={26} className="text-gray-400" />}
                <span className="text-sm font-semibold text-gray-700">{reading ? 'กำลังประมวลผลภาพ…' : 'เลือกไฟล์ภาพลายเซ็น (PNG / JPG)'}</span>
                <span className="text-xs text-gray-400">ถ่ายหรือสแกนลายเซ็นบนกระดาษขาว ให้ลายเซ็นใหญ่เต็มกรอบ แสงสม่ำเสมอ ระบบลบพื้นขาวให้เอง</span>
                <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={handleFile} data-signature-file />
              </label>
              {uploaded && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-gray-500">ตัวอย่างหลังลบพื้น (ลายตารางคือส่วนโปร่งใส)</p>
                  <div className="flex items-center justify-center rounded-xl border border-gray-200 p-3" style={CHECKER}>
                    <img src={`data:image/png;base64,${uploaded.base64}`} alt="ตัวอย่างลายเซ็นที่อัปโหลด" className="max-h-32 max-w-full" data-upload-preview />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="block text-xs font-semibold text-gray-600" htmlFor="signature-label">ชื่อเรียกลายเซ็นนี้
              <input id="signature-label" value={label} maxLength={40} onChange={event => setLabel(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800 outline-none focus:border-gray-400" />
            </label>
            {!isFirst && (
              <label className="flex min-h-11 items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={makeDefault} onChange={event => setMakeDefault(event.target.checked)} className="h-4 w-4" />
                ตั้งเป็นค่าเริ่มต้น
              </label>
            )}
          </div>
          {isFirst && <p className="text-xs text-gray-400">แบบแรกจะเป็นค่าเริ่มต้นโดยอัตโนมัติ — ตอนลงนามระบบแนบให้เอง (เปลี่ยนหรือปิดได้ทุกครั้ง)</p>}

          {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700" data-signature-error>{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 bg-gray-50 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-600 hover:bg-gray-100">ยกเลิก</button>
          <button type="button" onClick={handleSave} disabled={!ready || busy || reading} data-save-signature
            className="flex min-h-11 items-center gap-2 rounded-xl px-5 text-sm font-bold text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            {busy && <Loader2 size={15} className="animate-spin" />} บันทึกลายเซ็น
          </button>
        </div>
      </div>
    </div>
  )
}
