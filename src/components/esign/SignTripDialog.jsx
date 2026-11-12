import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, PenLine, Plus, ShieldCheck, Undo2, X } from 'lucide-react'
import AddSignatureDialog from '../profile/AddSignatureDialog'
import { Chip, Notice, ReturnNote } from './EsignBits'
import PinForm from './PinForm'
import { ESIGN_DECISION_LABEL, esignFailureText, esignMessage } from '../../lib/esign'
import { getMySignatures, getMySignerOverview, getTripEsignStatus, returnFleetTrip, signFleetTrip } from '../../lib/esignApi'
import { PIN_INPUT_CLASS, SIGNATURE_CHECKER, isPin, signatureDataUrl } from '../../lib/esignUi'
import { SIGNATURE_MAX_IMAGES } from '../../lib/signatureImage'
import { thaiDateTimeText } from '../../lib/thaiDate'

// กล่องลงนามในใบขออนุญาตใช้ยานพาหนะ (แบบ ๓) — สรุปสิ่งที่จะลงนาม → เลือกแนบลายเซ็น → ใส่รหัสลงนาม 6 หลัก
// ไม่ผูกกับตัวทริปใน FleetTrips: รับแค่ { tripId, slot, summary } เพื่อให้แถบ "รอลงนามของฉัน" (ชุด S3b) เปิดกล่องเดียวกันได้โดยไม่ต้องเปิดทริปก่อน
// ค่าเริ่มต้น: แนบภาพที่ตั้งเป็น "ค่าเริ่มต้น" ให้เอง (ปิดหรือเลือกแบบอื่นได้ทุกครั้ง) — ผู้ลงนามกรอกแค่รหัส
// ยังไม่ได้ตั้งรหัส = ตั้งในกล่องนี้ได้เลย ไม่ต้องไปหน้าโปรไฟล์ก่อน
// ขั้นที่ 2 (ผอ.กองที่ได้รับมอบ ข้อ ๑๒ ว.๔ หรือคนเดียวถือทั้งสองช่อง): ลงช่อง ผอ.สำนัก/กอง สำเร็จแล้วถามสถานะจาก DB (esign_trip_status)
//   ถ้าช่องผู้มีอำนาจ can_sign = true (คนเดิมถือช่องนั้นด้วย) กล่องไม่ปิด แต่เปลี่ยนเป็นขั้นที่ 2 ให้ลงช่องผู้มีอำนาจต่อด้วยรหัส/ภาพชุดเดิม
//   ต้องกดยืนยันครั้งที่สองเองเสมอ ห้ามลงช่องผู้มีอำนาจอัตโนมัติ · รหัสถูกเก็บใน state เฉพาะช่วงสองขั้นนี้ ปิดกล่อง/ลงเสร็จ/error = ล้างทิ้ง
//   onSigned เรียกครั้งเดียวตอนจบ (ลงครบสองช่อง หรือ "ไว้ทีหลัง"/ปิดกล่อง = ผลของช่องแรก) — ผู้เรียกทั้งสามที่ปิดกล่องเองใน onSigned จึงไม่ปิดก่อนขั้นที่ 2
// canReturn มาจาก DB (can_return) · ปุ่มส่งคืนอยู่ในกล่องนี้ เพราะนายก/ปลัดที่ไม่มีสิทธิ์ยานพาหนะเต็มเปิดทริปไม่ได้ เข้าได้ทางนี้ทางเดียว
export default function SignTripDialog({ tripId, slot, slotLabel, summary, canReturn = false, lastReturn = null, onClose, onSigned, onReturned }) {
  const decision = slot === 'authority' ? 'approve' : 'sign'
  const [returning, setReturning] = useState(false)
  const [reason, setReason] = useState('')
  const [overview, setOverview] = useState(null)
  const [loadedAt, setLoadedAt] = useState(0) // เวลาตอนโหลดสถานะรหัส ใช้ตัดสินว่าล็อกหมดอายุหรือยัง (เรนเดอร์ห้ามเรียก Date.now)
  const [library, setLibrary] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [attach, setAttach] = useState(false)
  const [imageId, setImageId] = useState(null)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [stage2, setStage2] = useState(null) // null | { first: ผลลงช่องแรก, label: ชื่อช่องผู้มีอำนาจ }
  const dialogRef = useRef(null)
  const initialized = useRef(false)
  const showAddRef = useRef(false)
  const busyRef = useRef(false)
  // onClose อาจเป็นฟังก์ชันใหม่ทุกรอบเรนเดอร์ของผู้เรียก — เก็บใน ref ไม่ให้ effect ผูกคีย์/ดึงโฟกัสกลับกล่องทุกครั้งที่ผู้เรียกเรนเดอร์ใหม่
  const onCloseRef = useRef(onClose)

  useEffect(() => { showAddRef.current = showAdd }, [showAdd])
  useEffect(() => { busyRef.current = busy }, [busy])
  // ปิดกล่อง (X / ยกเลิก / Esc): ขั้นที่ 2 = ลงช่องแรกสำเร็จไปแล้ว → แจ้งผู้เรียกด้วยผลช่องแรกเพื่อให้รายการรีเฟรช ไม่ใช่ปิดเงียบ
  function handleClose() {
    if (stage2) {
      setPin('')
      onSigned(stage2.first)
      return
    }
    onClose()
  }
  useEffect(() => { onCloseRef.current = handleClose })

  useEffect(() => {
    const opener = document.activeElement
    dialogRef.current?.focus()
    const onKey = event => {
      if (showAddRef.current) return // กล่องเพิ่มลายเซ็นซ้อนอยู่ข้างบน จัดการ Esc/Tab ของมันเอง
      if (event.key === 'Escape') {
        // หน้ายานพาหนะมีตัวรับ Esc ระดับ window ที่ปิดทั้งกล่องรายละเอียดคำขอ — กล่องนี้ซ้อนอยู่ข้างใน ต้องไม่ให้ Esc ลอยขึ้นไปปิดทั้งหมด (ผู้ใช้เสียรหัส/ภาพที่เลือกไว้)
        event.preventDefault()
        event.stopPropagation()
        if (!busyRef.current) onCloseRef.current()
      }
      if (event.key === 'Tab') {
        const items = [...dialogRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex="0"]')]
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

  // กล่องเพิ่มลายเซ็นปิดแล้วคืนค่า overflow เป็นว่าง — ล็อกการเลื่อนหน้าหลังกล่องนี้กลับ
  useEffect(() => {
    if (showAdd) return undefined
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [showAdd])

  useEffect(() => {
    let cancelled = false
    Promise.all([getMySignerOverview(), getMySignatures()]).then(([ov, lib]) => {
      if (cancelled) return
      const failed = [ov, lib].find(result => !result?.ok)
      if (failed) { setLoadError(esignMessage(failed)); setLoading(false); return }
      const items = lib.items ?? []
      setLoadError('')
      setOverview(ov)
      setLoadedAt(Date.now())
      setLibrary(items)
      setImageId(current => (items.some(item => item.id === current) ? current : (items.find(item => item.is_default) ?? items[0])?.id ?? null))
      if (!initialized.current) { initialized.current = true; setAttach(items.length > 0) }
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [reloadKey])

  const reload = useCallback(() => setReloadKey(key => key + 1), [])

  const suspended = Boolean(overview?.suspended)
  const locked = Boolean(overview?.locked_until) && new Date(overview.locked_until).getTime() > loadedAt
  const pinSet = Boolean(overview?.pin_set)
  const canEnterPin = pinSet && !suspended && !locked
  const ready = canEnterPin && isPin(pin) && !busy && (!attach || Boolean(imageId))

  async function handleSign() {
    if (!ready) return
    setBusy(true)
    setError('')
    const result = await signFleetTrip({ tripId, slot, pin, decision: decision === 'approve' ? 'approve' : null, imageId: attach ? imageId : null })
    if (!result?.ok) {
      setBusy(false)
      setPin('')
      setError(esignFailureText(result))
      // สถานะรหัส (ล็อก/ระงับ/ยังไม่ตั้ง) เปลี่ยนไปแล้ว — โหลดใหม่ให้กล่องแสดงตรงกับของจริง
      if (['pin_locked', 'suspended', 'pin_not_set', 'bad_pin'].includes(result?.code)) reload()
      return
    }
    // ช่อง ผอ.สำนัก/กอง ลงแล้ว: คนเดิมถือช่องผู้มีอำนาจด้วยไหม — ถามไม่ได้/ไม่ใช่ = จบแบบเดิม
    if (slot === 'dept_head') {
      let next
      try {
        const status = await getTripEsignStatus(tripId)
        next = status?.ok === false ? null : (status?.slots ?? []).find(item => item.slot === 'authority') ?? null
      } catch { next = null }
      if (next?.can_sign === true) {
        setStage2({ first: result, label: next.label || 'ผู้มีอำนาจสั่งใช้ยานพาหนะ' })
        setBusy(false)
        return
      }
    }
    setBusy(false)
    setPin('')
    onSigned(result)
  }

  // ขั้นที่ 2: ลงช่องผู้มีอำนาจต่อ ใช้รหัส/ภาพชุดเดิม — error (bad_pin ฯลฯ) = ล้างรหัสแล้วให้กรอกใหม่ในขั้นเดิม
  async function handleSignAuthority() {
    if (!stage2 || !ready) return
    setBusy(true)
    setError('')
    const result = await signFleetTrip({ tripId, slot: 'authority', pin, decision: 'approve', imageId: attach ? imageId : null })
    setBusy(false)
    if (!result?.ok) {
      setPin('')
      setError(esignFailureText(result))
      if (['pin_locked', 'suspended', 'pin_not_set', 'bad_pin'].includes(result?.code)) reload()
      return
    }
    setPin('')
    onSigned({ ...result, stamped: Boolean(stage2.first?.stamped || result.stamped) })
  }

  const reasonOk = reason.trim().length >= 3

  async function handleReturn() {
    if (!canReturn || !reasonOk || busy) return
    setBusy(true)
    setError('')
    const result = await returnFleetTrip({ tripId, slot, reason })
    setBusy(false)
    if (!result?.ok) {
      setError(esignMessage(result))
      return
    }
    onReturned?.(result)
  }

  const summaryRows = [
    ['ผู้ขอใช้รถ', summary?.requesterName],
    ['รถ', summary?.vehicleName],
    ['ปลายทาง', summary?.destination],
    ['วัตถุประสงค์', summary?.purpose],
    // ข้อ ๑๒ ว.๕ — มีเฉพาะคำขอของผู้มีรถประจำตำแหน่ง
    ['เหตุผลความจำเป็น (ผู้มีรถประจำตำแหน่ง)', summary?.positionCarReason],
    ['วันเดินทาง', summary?.plannedDeparture ? thaiDateTimeText(summary.plannedDeparture) : null],
  ].filter(([, value]) => value)

  // เรนเดอร์ที่ระดับ body (portal): กล่องนี้เปิดจากในกล่องรายละเอียดคำขอ (fixed z-50) ซึ่งสูงกว่าแถบเมนูล่างของมือถือ (z-50 ตัวมาทีหลัง) ไม่ได้
  // ถ้าซ้อนอยู่ข้างในปุ่ม "ลงนาม" จะถูกแถบเมนูบังบนมือถือ
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="sign-trip-title" data-sign-dialog
        className="flex max-h-[100dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl outline-none sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <h2 id="sign-trip-title" className="min-w-0 text-base font-bold text-gray-800">{returning ? 'ส่งคืนผู้ขอ' : stage2 ? ESIGN_DECISION_LABEL.approve : ESIGN_DECISION_LABEL[decision]}: {stage2 ? stage2.label : slotLabel}</h2>
          <button type="button" onClick={handleClose} disabled={busy} aria-label="ปิด" data-sign-close
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <dl className="space-y-1.5 rounded-xl border border-gray-200 bg-gray-50 p-3.5 text-xs" data-sign-summary>
            {summaryRows.map(([label, value]) => (
              <div key={label} className="flex gap-3">
                <dt className="w-20 shrink-0 text-gray-400">{label}</dt>
                <dd className="min-w-0 flex-1 break-words font-semibold text-gray-800">{value}</dd>
              </div>
            ))}
          </dl>
          <ReturnNote item={lastReturn} />
          {/* ข้อ ๑๒ ว.๕ — ผู้ขอมีรถประจำตำแหน่งแต่ยังไม่กรอกเหตุผล: ลงนามตอนนี้ระบบไม่นับเป็นการอนุญาต และเหตุผลจะถูกล็อก */}
          {!returning && summary?.positionCarRequired && !summary?.positionCarReason && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800" data-sign-position-car>
              ⚠️ ผู้ขอมีรถประจำตำแหน่ง แต่ยังไม่ได้กรอกเหตุผลความจำเป็น — ลงนามตอนนี้ระบบจะไม่นับเป็นการอนุญาต
              ควรส่งคืนให้ผู้ขอกรอกเหตุผลก่อน
            </p>
          )}
          {!returning && (
            <p className="text-xs leading-5 text-gray-500">
              ลงนามด้วยบัญชีและรหัสของคุณเท่านั้น ห้ามลงนามแทนผู้อื่น · ลายเซ็นผูกกับเนื้อหาข้างต้น ถ้าคำขอถูกแก้ภายหลังต้องถอนลายเซ็นแล้วลงนามใหม่
            </p>
          )}

          {stage2 ? (
            <section className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5" aria-labelledby="sign-stage2-title" data-sign-stage2>
              <h3 id="sign-stage2-title" className="flex items-center gap-1.5 text-sm font-bold text-emerald-900">
                <ShieldCheck size={15} aria-hidden="true" /> ลงนามช่อง ผอ.สำนัก/กอง แล้ว — ยังเหลือช่องผู้มีอำนาจ
              </h3>
              <p className="text-xs leading-5 text-emerald-900" data-sign-stage2-note>
                ท่านเป็นผู้ลงนามช่องผู้มีอำนาจของคำขอนี้ด้วย (กรณีได้รับมอบตามข้อ ๑๒ วรรคสี่ ใบพิมพ์จะระบุฐานะท่านว่า &ldquo;ปฏิบัติราชการแทน&rdquo; ผู้บริหารท้องถิ่น)
                {' '}— ลงนามอนุมัติในช่องผู้มีอำนาจต่อได้เลยโดยไม่ต้องใส่รหัสซ้ำ
              </p>
              <p className="text-xs leading-5 text-gray-600">
                เป็นการลงลายมือชื่อแยกอีกครั้งหนึ่ง ต้องกดยืนยันเอง — ถ้ายังไม่พร้อม กด “ไว้ทีหลัง” แล้วกลับมาลงนามช่องนี้ได้จากรายการรอลงนามของท่าน
              </p>
              {!isPin(pin) && (
                <div className="space-y-2" data-sign-stage2-pin>
                  <h4 id="sign-pin2-title" className="text-sm font-bold text-gray-800">รหัสลงนาม 6 หลัก</h4>
                  <input id="esign-sign-pin2" name="esign-sign-pin2" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={6} autoComplete="off"
                    aria-labelledby="sign-pin2-title" data-sign-pin disabled={!canEnterPin} value={pin}
                    onChange={event => setPin(event.target.value.replace(/\D/g, ''))}
                    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); handleSignAuthority() } }}
                    className={PIN_INPUT_CLASS} />
                </div>
              )}
              {(locked || suspended) && (
                <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800" data-sign-blocked>
                  {suspended ? 'การลงนามของคุณถูกระงับอยู่ — ลงนามช่องผู้มีอำนาจต่อไม่ได้' : `ใส่รหัสผิดหลายครั้ง ระบบล็อกการลงนามถึง ${thaiDateTimeText(overview.locked_until)}`}
                </p>
              )}
              {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-xs leading-5 text-red-700" data-sign-error>{error}</p>}
            </section>
          ) : returning ? (
            <section className="space-y-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5" aria-labelledby="sign-return-title" data-sign-return-form>
              <h3 id="sign-return-title" className="text-sm font-bold text-red-900">ไม่ลงนาม ส่งคืนผู้ขอ</h3>
              <p className="text-xs leading-5 text-red-800" data-sign-return-impact>
                ลายเซ็นที่ลงแล้วในใบนี้จะถูกถอน (ประวัติยังอยู่) ผู้ลงนามต้องลงใหม่ตามลำดับเมื่อผู้ขอส่งกลับ · สถานะคำขอและคิวรถไม่เปลี่ยน ผู้ขอเป็นคนเลือกว่าจะแก้หรือยกเลิก
              </p>
              <label className="block text-xs font-semibold text-red-900" htmlFor="sign-return-reason">เหตุผล (3–500 ตัวอักษร) ผู้ขอจะเห็นข้อความนี้
                <textarea id="sign-return-reason" data-sign-return-reason rows={3} maxLength={500} value={reason} disabled={busy}
                  placeholder="เช่น ขอให้แก้วันเดินทางให้ตรงหนังสือเชิญ"
                  onChange={event => setReason(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-red-200 bg-white px-3 py-2.5 text-sm text-gray-800 outline-none" />
              </label>
              {error && <p role="alert" className="text-xs leading-5 text-red-700" data-sign-error>{error}</p>}
            </section>
          ) : loading ? (
            <div className="flex items-center justify-center py-6 text-gray-400"><Loader2 size={18} className="animate-spin" /></div>
          ) : loadError ? (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" data-sign-load-error>⚠️ {loadError}</p>
          ) : suspended ? (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs leading-5 text-red-800" data-sign-blocked>
              การลงนามของคุณถูกระงับอยู่ — ลงนามไม่ได้จนกว่าผู้ดูแลระบบของหน่วยงานจะเปิดคืนให้ (เมนู การลงนามเอกสาร → แท็บลงนามออนไลน์)
            </p>
          ) : !pinSet ? (
            <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3.5" data-sign-setup-pin>
              <h3 className="text-sm font-bold text-gray-800">ตั้งรหัสลงนามก่อน (ทำครั้งเดียว)</h3>
              <PinForm pinSet={false} onDone={() => { setNotice({ ok: true, text: 'ตั้งรหัสลงนามแล้ว — กรอกรหัสด้านล่างเพื่อลงนามต่อได้เลย' }); reload() }} />
            </section>
          ) : (
            <>
              {notice && <Notice notice={notice} />}
              {locked && (
                <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800" data-sign-blocked>
                  ใส่รหัสผิดหลายครั้ง ระบบล็อกการลงนามถึง {thaiDateTimeText(overview.locked_until)}
                </p>
              )}

              <section className="space-y-2.5" aria-labelledby="sign-attach-title">
                <h3 id="sign-attach-title" className="text-sm font-bold text-gray-800">ลายเซ็นบนใบพิมพ์</h3>
                {library.length === 0 ? (
                  <div className="space-y-2 rounded-xl border border-dashed border-gray-300 p-3.5">
                    <p className="text-xs leading-5 text-gray-500" data-sign-no-image>
                      ยังไม่มีลายเซ็นภาพ — ไม่บังคับ ลงนามด้วยรหัสอย่างเดียวได้ แต่ใบพิมพ์จะแสดงเฉพาะชื่อ ตำแหน่ง เวลา และรหัสตรวจสอบ ไม่มีภาพลายเซ็น
                    </p>
                    <button type="button" onClick={() => setShowAdd(true)} data-sign-add-image
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-gray-200 px-3.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                      <PenLine size={15} /> เซ็นหรืออัปโหลดลายเซ็น (บันทึกไว้ใช้ครั้งต่อไป)
                    </button>
                  </div>
                ) : (
                  <>
                    <label className="flex min-h-11 items-center gap-2.5 text-sm font-semibold text-gray-700" htmlFor="sign-attach">
                      <input id="sign-attach" type="checkbox" checked={attach} onChange={event => setAttach(event.target.checked)} data-sign-attach className="h-5 w-5 shrink-0" />
                      แนบลายเซ็นที่บันทึกไว้ในใบนี้
                    </label>
                    {attach && (
                      <div role="radiogroup" aria-label="เลือกลายเซ็นที่จะแนบ" className="grid grid-cols-2 gap-2.5">
                        {library.map(item => (
                          <button key={item.id} type="button" role="radio" aria-checked={imageId === item.id} onClick={() => setImageId(item.id)} data-sign-image-option
                            className={`min-h-11 space-y-1.5 rounded-xl border p-2 text-left ${imageId === item.id ? 'border-emerald-500 bg-emerald-50/50 ring-1 ring-emerald-500' : 'border-gray-200 hover:bg-gray-50'}`}>
                            <span className="flex h-14 items-center justify-center overflow-hidden rounded-lg border border-gray-100 bg-white p-1" style={SIGNATURE_CHECKER}>
                              <img src={signatureDataUrl(item.png_base64)} alt={`ลายเซ็น ${item.label}`} className="max-h-full max-w-full object-contain" />
                            </span>
                            <span className="flex items-center gap-1.5">
                              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-700">{item.label}</span>
                              {item.is_default && <Chip tone="ok">ค่าเริ่มต้น</Chip>}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    {!attach && <p className="text-xs leading-5 text-gray-500">ไม่แนบภาพ — ใบพิมพ์จะแสดงเฉพาะชื่อ ตำแหน่ง เวลา และรหัสตรวจสอบ</p>}
                    {library.length < SIGNATURE_MAX_IMAGES && (
                      <button type="button" onClick={() => setShowAdd(true)} data-sign-add-image
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-600 hover:bg-gray-50">
                        <Plus size={14} /> เพิ่มลายเซ็นใหม่
                      </button>
                    )}
                  </>
                )}
              </section>

              <section className="space-y-2" aria-labelledby="sign-pin-title">
                <h3 id="sign-pin-title" className="text-sm font-bold text-gray-800">รหัสลงนาม 6 หลัก</h3>
                <input id="esign-sign-pin" name="esign-sign-pin" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={6} autoComplete="off"
                  aria-labelledby="sign-pin-title" data-sign-pin disabled={!canEnterPin} value={pin}
                  onChange={event => setPin(event.target.value.replace(/\D/g, ''))}
                  onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); handleSign() } }}
                  className={PIN_INPUT_CLASS} />
              </section>
              {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-xs leading-5 text-red-700" data-sign-error>{error}</p>}
            </>
          )}

          {canReturn && !returning && !stage2 && (
            <button type="button" disabled={busy} data-sign-return-open
              onClick={() => { setError(''); setPin(''); setReturning(true) }}
              className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">
              <Undo2 size={15} aria-hidden="true" /> ไม่ลงนาม ส่งคืนผู้ขอ
            </button>
          )}
        </div>

        {returning ? (
          <div className="flex gap-2 border-t border-gray-100 px-5 py-4">
            <button type="button" onClick={() => { setError(''); setReturning(false) }} disabled={busy} data-sign-return-back
              className="min-h-11 rounded-xl border border-gray-200 px-5 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">กลับ</button>
            <button type="button" onClick={handleReturn} disabled={!reasonOk || busy} data-sign-return-submit
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 px-5 text-sm font-bold text-white disabled:opacity-50">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Undo2 size={15} />} ยืนยันส่งคืนผู้ขอ
            </button>
          </div>
        ) : stage2 ? (
          <div className="flex gap-2 border-t border-gray-100 px-5 py-4">
            <button type="button" onClick={handleClose} disabled={busy} data-sign-stage2-later
              className="min-h-11 rounded-xl border border-gray-200 px-5 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">ไว้ทีหลัง</button>
            <button type="button" onClick={handleSignAuthority} disabled={!ready} data-sign-stage2-submit
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-5 text-sm font-bold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--color-primary)' }}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} อนุมัติ (ลงนาม)
            </button>
          </div>
        ) : (
          <div className="flex gap-2 border-t border-gray-100 px-5 py-4">
            <button type="button" onClick={handleClose} disabled={busy}
              className="min-h-11 rounded-xl border border-gray-200 px-5 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">ยกเลิก</button>
            <button type="button" onClick={handleSign} disabled={!ready} data-sign-submit
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-5 text-sm font-bold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--color-primary)' }}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} {decision === 'approve' ? 'อนุมัติ (ลงนาม)' : 'ลงนาม'}
            </button>
          </div>
        )}
      </div>

      {showAdd && (
        <AddSignatureDialog isFirst={library.length === 0} onClose={() => setShowAdd(false)}
          onSaved={async result => {
            setShowAdd(false)
            if (result?.id) { setImageId(result.id); setAttach(true) }
            reload()
          }} />
      )}
    </div>,
    document.body,
  )
}
