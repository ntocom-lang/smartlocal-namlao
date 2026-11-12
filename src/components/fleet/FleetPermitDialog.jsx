import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, X } from 'lucide-react'
import { recordFleetPaperPermit, voidFleetPaperPermit } from '../../lib/fleetPermitApi'
import {
  PERMIT_PAPER_MAX_BACKDATE_DAYS, PERMIT_REASON_MAX, PERMIT_REASON_MIN, permitBasisOptions, permitMessage, permitSignedOnRange,
} from '../../lib/fleetPermit'
import { todayBangkok } from '../../lib/documentSignatories'
import { thaiDateFromDateInput } from '../../lib/thaiDate'

// กล่องบันทึก/ยกเลิก "การอนุญาตใช้รถจากใบกระดาษ" (โหมดขั้นตอนตามระเบียบ) — เฉพาะผู้ดูแลระบบยานพาหนะ (DB ตรวจสิทธิ์ซ้ำ)
//   mode 'record' = บันทึกว่าผู้มีอำนาจลงนามอนุญาตบนใบกระดาษแล้ว · mode 'void' = ยกเลิกบันทึกที่ผิด (ต้องมีเหตุผล)
// ระบบไม่ตัดสินแทนผู้มีอำนาจ: กล่องนี้แค่จดผลของคน ชื่อ/ตำแหน่งผู้อนุญาตดึงจากทะเบียนผู้ลงนามที่ฝั่ง DB ไม่ให้พิมพ์เอง
// ⚠️ ซ้อนอยู่บนกล่องรายละเอียดทริป (fixed z-[55]) → createPortal ไป body + z-[80] (เท่า SignTripDialog)
//    และ Esc ต้องไม่ลอยไปถึงตัวรับ Esc ระดับ window ของ FleetTrips ที่ปิดทั้งกล่องรายละเอียด (ผู้ใช้จะเสียสิ่งที่เลือกไว้)
// FleetPage เรนเดอร์ FleetTrips สองชุด (มือถือ+เดสก์ท็อป ซ่อนด้วย CSS) — id ของช่องใช้ useId กันชนกัน
export default function FleetPermitDialog({ mode = 'record', tripId, info, permitId = null, onClose, onDone }) {
  const uid = useId()
  const isVoid = mode === 'void'
  const options = permitBasisOptions(info)
  const today = todayBangkok()
  const range = permitSignedOnRange(today)
  const [basis, setBasis] = useState(options[0]?.key ?? 'authority')
  const [signedOn, setSignedOn] = useState(today)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef(null)
  const busyRef = useRef(false)
  const onCloseRef = useRef(onClose)

  useEffect(() => { busyRef.current = busy }, [busy])
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    const opener = document.activeElement
    dialogRef.current?.focus()
    const onKey = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (!busyRef.current) onCloseRef.current()
      }
      if (event.key === 'Tab') {
        const items = [...dialogRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled])')]
        if (!items.length) return
        const first = items[0]
        const last = items[items.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); opener?.focus?.() }
  }, [])

  const reasonLength = reason.trim().length
  const reasonOk = reasonLength >= PERMIT_REASON_MIN && reasonLength <= PERMIT_REASON_MAX
  const dateOk = signedOn >= range.min && signedOn <= range.max
  const canSubmit = !busy && (isVoid ? reasonOk : (dateOk && Boolean(basis)))

  async function submit() {
    if (!canSubmit) return
    setBusy(true)
    setError('')
    const result = isVoid
      ? await voidFleetPaperPermit({ permitId, reason })
      : await recordFleetPaperPermit({ tripId, basis, signedOn })
    setBusy(false)
    if (result?.ok) {
      onDone?.(result)
      return
    }
    setError(permitMessage(result))
  }

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`}
        className="flex max-h-[92vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-2xl outline-none sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 id={`${uid}-title`} className="text-base font-black text-gray-800">
            {isVoid ? 'ยกเลิกบันทึกการอนุญาต' : 'บันทึกการอนุญาต (ใบกระดาษ)'}
          </h2>
          <button type="button" onClick={() => { if (!busy) onClose() }} aria-label="ปิด"
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"><X size={16} /></button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5 text-sm">
          {isVoid ? (
            <>
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800">
                ใช้เมื่อบันทึกไว้ผิดใบหรือผิดผู้อนุญาต ยกเลิกแล้วใบนี้กลับไป “รออนุญาต” และบันทึกเดิมยังเก็บไว้ให้ตรวจย้อน (ลบไม่ได้)
              </p>
              <div>
                <label htmlFor={`${uid}-reason`} className="mb-1 block text-xs font-semibold text-gray-600">
                  เหตุผลที่ยกเลิก * <span className="font-normal text-gray-400">({PERMIT_REASON_MIN}–{PERMIT_REASON_MAX} ตัวอักษร)</span>
                </label>
                <textarea id={`${uid}-reason`} value={reason} maxLength={PERMIT_REASON_MAX} rows={3}
                  onChange={event => setReason(event.target.value)}
                  placeholder="เช่น บันทึกผิดใบ — ผู้มีอำนาจยังไม่ได้ลงนาม"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" />
              </div>
            </>
          ) : (
            <>
              <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs leading-5 text-sky-900">
                ใช้เมื่อผู้อนุญาตลงนามในใบขอใช้รถ (แบบ ๓) ที่เป็นกระดาษแล้ว ระบบไม่ตัดสินแทนผู้มีอำนาจ เพียงจดผลไว้ให้ปลดล็อกปุ่มออกรถและตรวจย้อนได้
                ถ้าผู้มีอำนาจลงนามออนไลน์ ไม่ต้องบันทึกที่นี่
              </p>
              <fieldset>
                <legend className="mb-1.5 text-xs font-semibold text-gray-600">ผู้อนุญาต *</legend>
                <div className="space-y-2">
                  {options.map(option => (
                    <label key={option.key} htmlFor={`${uid}-basis-${option.key}`}
                      className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 ${basis === option.key ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 bg-white'}`}>
                      <input id={`${uid}-basis-${option.key}`} type="radio" name={`${uid}-basis`} value={option.key}
                        checked={basis === option.key} onChange={() => setBasis(option.key)} className="mt-0.5 h-4 w-4 shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-gray-800">{option.label}</span>
                        <span className="block text-xs text-gray-500">{option.who}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div>
                <label htmlFor={`${uid}-date`} className="mb-1 block text-xs font-semibold text-gray-600">วันที่ผู้อนุญาตลงนามบนใบ *</label>
                <input id={`${uid}-date`} type="date" value={signedOn} min={range.min} max={range.max}
                  onChange={event => setSignedOn(event.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" />
                <p className="mt-1 text-[11px] text-gray-400">
                  {signedOn ? thaiDateFromDateInput(signedOn) : ''}{signedOn ? ' · ' : ''}ไม่เกินวันนี้ และย้อนหลังได้ไม่เกิน {PERMIT_PAPER_MAX_BACKDATE_DAYS} วัน
                </p>
              </div>
              <p className="text-[11px] leading-5 text-gray-500">
                ชื่อและตำแหน่งผู้อนุญาตดึงจากทะเบียนผู้ลงนามของหน่วยงาน ณ วันที่ลงนามให้เอง ไม่ต้องพิมพ์
                ถ้าชื่อไม่ตรง ให้ผู้ดูแลระบบแก้ที่เมนู “การลงนามเอกสาร” แท็บ “ผู้ลงนามแต่ละช่อง” ก่อนบันทึก
              </p>
            </>
          )}
          {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-700">⚠️ {error}</p>}
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-gray-100 px-5 pb-5 pt-3">
          <button type="button" onClick={onClose} disabled={busy}
            className="rounded-xl border border-gray-200 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            ปิด
          </button>
          <button type="button" onClick={submit} disabled={!canSubmit}
            className={`inline-flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-50 ${isVoid ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
            {busy && <Loader2 size={15} className="animate-spin" />}
            {isVoid ? 'ยืนยันยกเลิกบันทึก' : 'บันทึกการอนุญาต'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
