import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, PenLine, Plus, ShieldCheck, X } from 'lucide-react'
import AddSignatureDialog from '../profile/AddSignatureDialog'
import { Chip, Notice } from './EsignBits'
import PinForm from './PinForm'
import { ESIGN_DECISION_LABEL, esignFailureText, esignMessage } from '../../lib/esign'
import { getMySignatures, getMySignerOverview, signFleetTrip } from '../../lib/esignApi'
import { PIN_INPUT_CLASS, SIGNATURE_CHECKER, isPin, signatureDataUrl } from '../../lib/esignUi'
import { SIGNATURE_MAX_IMAGES } from '../../lib/signatureImage'
import { thaiDateTimeText } from '../../lib/thaiDate'

// กล่องลงนามในใบขออนุญาตใช้ยานพาหนะ (แบบ ๓) — สรุปสิ่งที่จะลงนาม → เลือกแนบลายเซ็น → ใส่รหัสลงนาม 6 หลัก
// ไม่ผูกกับตัวทริปใน FleetTrips: รับแค่ { tripId, slot, summary } เพื่อให้แถบ "รอลงนามของฉัน" (ชุด S3b) เปิดกล่องเดียวกันได้โดยไม่ต้องเปิดทริปก่อน
// ค่าเริ่มต้น: แนบภาพที่ตั้งเป็น "ค่าเริ่มต้น" ให้เอง (ปิดหรือเลือกแบบอื่นได้ทุกครั้ง) — ผู้ลงนามกรอกแค่รหัส
// ยังไม่ได้ตั้งรหัส = ตั้งในกล่องนี้ได้เลย ไม่ต้องไปหน้าโปรไฟล์ก่อน
export default function SignTripDialog({ tripId, slot, slotLabel, summary, onClose, onSigned }) {
  const decision = slot === 'authority' ? 'approve' : 'sign'
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
  const dialogRef = useRef(null)
  const initialized = useRef(false)
  const showAddRef = useRef(false)
  const busyRef = useRef(false)
  // onClose อาจเป็นฟังก์ชันใหม่ทุกรอบเรนเดอร์ของผู้เรียก — เก็บใน ref ไม่ให้ effect ผูกคีย์/ดึงโฟกัสกลับกล่องทุกครั้งที่ผู้เรียกเรนเดอร์ใหม่
  const onCloseRef = useRef(onClose)

  useEffect(() => { showAddRef.current = showAdd }, [showAdd])
  useEffect(() => { busyRef.current = busy }, [busy])
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

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
        const items = [...dialogRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex="0"]')]
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
    setBusy(false)
    if (!result?.ok) {
      setPin('')
      setError(esignFailureText(result))
      // สถานะรหัส (ล็อก/ระงับ/ยังไม่ตั้ง) เปลี่ยนไปแล้ว — โหลดใหม่ให้กล่องแสดงตรงกับของจริง
      if (['pin_locked', 'suspended', 'pin_not_set', 'bad_pin'].includes(result?.code)) reload()
      return
    }
    onSigned(result)
  }

  const summaryRows = [
    ['ผู้ขอใช้รถ', summary?.requesterName],
    ['รถ', summary?.vehicleName],
    ['ปลายทาง', summary?.destination],
    ['วัตถุประสงค์', summary?.purpose],
    ['วันเดินทาง', summary?.plannedDeparture ? thaiDateTimeText(summary.plannedDeparture) : null],
  ].filter(([, value]) => value)

  // เรนเดอร์ที่ระดับ body (portal): กล่องนี้เปิดจากในกล่องรายละเอียดคำขอ (fixed z-50) ซึ่งสูงกว่าแถบเมนูล่างของมือถือ (z-50 ตัวมาทีหลัง) ไม่ได้
  // ถ้าซ้อนอยู่ข้างในปุ่ม "ลงนาม" จะถูกแถบเมนูบังบนมือถือ
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="sign-trip-title" data-sign-dialog
        className="flex max-h-[100dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl outline-none sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <h2 id="sign-trip-title" className="min-w-0 text-base font-bold text-gray-800">{ESIGN_DECISION_LABEL[decision]}: {slotLabel}</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="ปิด" data-sign-close
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
          <p className="text-xs leading-5 text-gray-500">
            ลงนามด้วยบัญชีและรหัสของคุณเท่านั้น ห้ามลงนามแทนผู้อื่น · ลายเซ็นผูกกับเนื้อหาข้างต้น ถ้าคำขอถูกแก้ภายหลังต้องถอนลายเซ็นแล้วลงนามใหม่
          </p>

          {loading ? (
            <div className="flex items-center justify-center py-6 text-gray-400"><Loader2 size={18} className="animate-spin" /></div>
          ) : loadError ? (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" data-sign-load-error>⚠️ {loadError}</p>
          ) : suspended ? (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs leading-5 text-red-800" data-sign-blocked>
              การลงนามของคุณถูกระงับอยู่ — ลงนามไม่ได้จนกว่าผู้ดูแลระบบของหน่วยงานจะเปิดคืนให้ (เมนู ผู้ดูแล → ลงนามออนไลน์)
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
        </div>

        <div className="flex gap-2 border-t border-gray-100 px-5 py-4">
          <button type="button" onClick={onClose} disabled={busy}
            className="min-h-11 rounded-xl border border-gray-200 px-5 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">ยกเลิก</button>
          <button type="button" onClick={handleSign} disabled={!ready} data-sign-submit
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-5 text-sm font-bold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--color-primary)' }}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} {decision === 'approve' ? 'อนุมัติ (ลงนาม)' : 'ลงนาม'}
          </button>
        </div>
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
