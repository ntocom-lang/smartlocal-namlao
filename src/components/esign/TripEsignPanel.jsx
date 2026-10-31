import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Clock, FileSignature, Loader2, Lock, PenLine, ShieldAlert, Undo2 } from 'lucide-react'
import { Chip, Notice } from './EsignBits'
import SignTripDialog from './SignTripDialog'
import { ESIGN_DECISION_LABEL, ESIGN_DRIVER_NOTE, ESIGN_FLEET_SLOTS, esignDepartWarning, esignFallbackText, esignMessage, esignRevokeTargets } from '../../lib/esign'
import { getTripEsignStatus, revokeFleetTripSignatures } from '../../lib/esignApi'
import { SMALL_BUTTON_CLASS } from '../../lib/esignUi'
import { clearHomeRpcCache } from '../../lib/staffHomeData'
import { thaiDateTimeText } from '../../lib/thaiDate'

// แผง "ลงนามออนไลน์" ในหน้ารายละเอียดคำขอใช้รถ (แบบ ๓) — แสดงเฉพาะทริปที่ อปท. เปิดโหมดออนไลน์ไว้ตอนสร้างคำขอ (trip.esign_slots ไม่ว่าง)
// ทุกอย่างที่แผงตัดสินมาจาก esign_trip_status ฝั่ง DB: ใครถึงตา (can_sign) · ใครถอนได้ (can_revoke / can_revoke_all) · ทริปล็อกไหม (locked)
// หน้าจอไม่เดาสิทธิ์เอง — ถ้าเดาผิดจะมีปุ่มที่กดแล้วขึ้น "ไม่มีสิทธิ์" หรือปุ่มที่ควรมีกลับหายไป
const SLOT_LABEL = Object.fromEntries(ESIGN_FLEET_SLOTS.map(slot => [slot.key, slot.label]))

// ช่องที่ตกเป็นเซ็นสดเพราะผู้ลงนามไม่พร้อมตอนสร้างคำขอ — บอกเหตุผลรายช่อง และบอกว่าแก้แล้วมีผลกับใบถัดไป ไม่ใช่ใบนี้
function FallbackList({ slots }) {
  return (
    <div className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5" data-trip-esign-fallback>
      <ul className="space-y-1 text-xs leading-5 text-amber-900">
        {slots.map(slot => (
          <li key={slot.slot} data-trip-esign-fallback-slot={slot.slot}>
            <span className="font-semibold">{slot.label}</span>: เซ็นสดบนกระดาษ — {esignFallbackText(slot.fallback)}
          </li>
        ))}
      </ul>
      <p className="text-xs leading-5 text-amber-800">ผู้ลงนามตั้งรหัสหรือเปิดคืนแล้ว คำขอใบถัดไปลงนามออนไลน์ได้ ใบนี้เซ็นสดต่อ</p>
    </div>
  )
}

function SlotRow({ slot, trip, onSign, onAskRevoke }) {
  const signed = slot.signed
  const signature = slot.signature
  return (
    <li className="space-y-2 rounded-xl border border-gray-200 p-3" data-esign-slot={slot.slot} data-esign-slot-state={signed ? 'signed' : slot.can_sign ? 'mine' : 'waiting'}>
      <div className="flex items-start gap-2">
        {signed ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" /> : <Clock size={16} className="mt-0.5 shrink-0 text-gray-400" />}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs font-bold text-gray-800">{slot.label}</p>
          {signed ? (
            <>
              <p className="text-xs text-gray-700">
                {ESIGN_DECISION_LABEL[signature.decision] ?? 'ลงนาม'}แล้วโดย <span className="font-semibold">{signature.signer_name}</span>
                {signature.signer_position ? ` · ${signature.signer_position}` : ''}
              </p>
              <p className="text-[11px] text-gray-400">{thaiDateTimeText(signature.signed_at)}</p>
              <div className="flex flex-wrap gap-1.5">
                {signature.mine && <Chip tone="ok">ลายเซ็นของฉัน</Chip>}
                {signature.with_image && <Chip tone="mute">แนบภาพลายเซ็น</Chip>}
                {!signature.content_matches && <Chip tone="bad">เนื้อหาถูกแก้หลังลงนาม</Chip>}
              </div>
            </>
          ) : slot.can_sign ? (
            <p className="text-xs font-semibold text-amber-700">ถึงคิวของคุณ — ตรวจเนื้อหาแล้วลงนามได้เลย</p>
          ) : slot.blocked ? (
            <p className="text-xs leading-5 text-red-600">ลงนามออนไลน์ไม่ได้: {esignMessage({ code: slot.blocked })}</p>
          ) : slot.waiting_for_previous ? (
            <p className="text-xs text-gray-500">รอผู้ลงนามช่องก่อนหน้า{slot.expected_name ? ` · ผู้ลงนามช่องนี้: ${slot.expected_name}` : ''}</p>
          ) : (
            <p className="text-xs text-gray-500">{trip.closed ? 'คำขอนี้ปิดแล้ว ลงนามไม่ได้' : `รอ ${slot.expected_name || 'ผู้ลงนาม'} ลงนาม`}</p>
          )}
        </div>
      </div>
      {(slot.can_sign || slot.can_revoke) && (
        <div className="flex flex-wrap gap-2">
          {slot.can_sign && (
            <button type="button" onClick={() => onSign(slot)} data-sign-slot-button
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-bold text-white" style={{ backgroundColor: 'var(--color-primary)' }}>
              <PenLine size={15} /> {slot.slot === 'authority' ? 'อนุมัติ (ลงนาม)' : 'ลงนาม'}
            </button>
          )}
          {slot.can_revoke && (
            <button type="button" onClick={() => onAskRevoke(slot.slot)} data-revoke-slot={slot.slot}
              className={`${SMALL_BUTTON_CLASS} border-red-200 text-red-600 hover:bg-red-50`}>
              <Undo2 size={13} /> ถอนลายเซ็น
            </button>
          )}
        </div>
      )}
    </li>
  )
}

export default function TripEsignPanel({ trip, onChanged }) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [signing, setSigning] = useState(null)
  const [revoke, setRevoke] = useState(null) // { slot: 'dept_head' | null (ทั้งหมด), reason, busy, error }
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    let cancelled = false
    getTripEsignStatus(trip.id).then(result => {
      if (cancelled) return
      if (result?.found === false) { setStatus({ found: false }); setLoadError(''); setLoading(false); return }
      if (result?.ok === false) { setLoadError(esignMessage(result)); setLoading(false); return }
      setStatus(result)
      setLoadError('')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [trip.id, reloadKey])

  const reload = useCallback(() => setReloadKey(key => key + 1), [])
  const closeDialog = useCallback(() => setSigning(null), [])

  if (loading && !status) {
    return <div className="flex items-center gap-2 rounded-xl border border-gray-200 px-3.5 py-3 text-xs text-gray-400" data-trip-esign-loading><Loader2 size={14} className="animate-spin" /> กำลังโหลดสถานะลงนามออนไลน์…</div>
  }
  if (loadError) {
    return <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700" data-trip-esign-error>⚠️ ดูสถานะลงนามออนไลน์ไม่ได้: {loadError}</p>
  }
  // ผู้เปิดดูไม่ใช่ผู้ที่เกี่ยวข้อง/ไม่มีสิทธิ์ดูคำขอนี้ (DB ตอบ "ไม่พบ") — ไม่แสดงแผงเลย ไม่บอกว่ามีโหมดออนไลน์อยู่
  if (!status?.found) return null

  const online = (status.slots ?? []).filter(slot => slot.mode === 'online' && slot.applicable)
  const wet = (status.slots ?? []).filter(slot => slot.mode !== 'online' && slot.applicable)
  // เฟส 2: ช่องที่หน่วยงานเปิดออนไลน์ แต่ผู้ลงนามไม่พร้อมตอนสร้างคำขอ จึงเซ็นสด (เหตุผลตรึงไว้ที่ทริป)
  const fallbacks = wet.filter(slot => slot.fallback)
  const plainWet = wet.filter(slot => !slot.fallback)
  const closed = ['rejected', 'cancelled'].includes(status.trip_status)

  if (status.mode !== 'online') {
    if (!fallbacks.length) return null
    return (
      <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4" aria-labelledby="trip-esign-title" data-trip-esign data-trip-esign-all-wet>
        <div className="flex flex-wrap items-center gap-2">
          <FileSignature size={16} className="text-gray-500" />
          <h3 id="trip-esign-title" className="text-sm font-bold text-gray-800">ลงนามออนไลน์</h3>
          <Chip tone="mute">ใบนี้เซ็นสด</Chip>
        </div>
        <p className="text-xs leading-5 text-gray-600">
          หน่วยงานเปิดลงนามออนไลน์ไว้ แต่ตอนสร้างคำขอนี้ผู้ลงนามยังไม่พร้อม ใบนี้จึงเซ็นสดทุกช่อง — พิมพ์ใบไปเวียนเซ็นตามเดิม
        </p>
        <FallbackList slots={fallbacks} />
      </section>
    )
  }
  const summary = {
    requesterName: trip.requester?.full_name || trip.creator?.full_name,
    vehicleName: trip.vehicle?.name,
    destination: trip.destination,
    purpose: trip.purpose,
    plannedDeparture: trip.planned_departure,
  }

  const revokeNames = revoke
    ? esignRevokeTargets(revoke.slot).filter(key => online.some(slot => slot.slot === key && slot.signed)).map(key => SLOT_LABEL[key])
    : []
  const reasonOk = revoke ? revoke.reason.trim().length >= 3 : false

  async function handleRevoke() {
    if (!revoke || !reasonOk) return
    setRevoke(current => ({ ...current, busy: true, error: '' }))
    const result = await revokeFleetTripSignatures({ tripId: trip.id, reason: revoke.reason, slot: revoke.slot })
    if (!result?.ok) { setRevoke(current => ({ ...current, busy: false, error: esignMessage(result) })); return }
    setRevoke(null)
    clearHomeRpcCache('esign_my_pending') // ถอนแล้วใครถึงคิวลงนามเปลี่ยน — กลับหน้าแรกภายใน 30 วินาทีต้องไม่เห็นรายการเก่า
    setNotice({ ok: true, text: result.revoked > 0 ? `ถอนลายเซ็นแล้ว ${result.revoked} ช่อง — แก้คำขอได้ แล้วให้ผู้ลงนามลงนามใหม่` : 'ไม่มีลายเซ็นที่ต้องถอนแล้ว' })
    reload()
    onChanged?.()
  }

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4" aria-labelledby="trip-esign-title" data-trip-esign>
      <div className="flex flex-wrap items-center gap-2">
        <FileSignature size={16} className="text-gray-500" />
        <h3 id="trip-esign-title" className="text-sm font-bold text-gray-800">ลงนามออนไลน์</h3>
        <Chip tone={status.complete ? 'ok' : 'mute'}>{status.complete ? 'ลงนามครบแล้ว' : `ลงนามแล้ว ${status.signed_count}/${status.required} ช่อง`}</Chip>
      </div>

      {closed && <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500" data-trip-esign-closed>คำขอนี้ถูกปฏิเสธหรือยกเลิกแล้ว ลงนามเพิ่มไม่ได้</p>}
      {status.integrity === 'modified' && (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs leading-5 text-red-700" data-trip-esign-modified>
          <ShieldAlert size={15} className="mt-0.5 shrink-0" /> เนื้อหาคำขอไม่ตรงกับที่ลงนามไว้ — แจ้งผู้ดูแลระบบให้ตรวจสอบ
        </p>
      )}

      <Notice notice={notice} />

      <ul className="space-y-2">
        {online.map(slot => (
          <SlotRow key={slot.slot} slot={slot} trip={{ closed }} onSign={setSigning} onAskRevoke={key => { setNotice(null); setRevoke({ slot: key, reason: '', busy: false, error: '' }) }} />
        ))}
      </ul>
      {fallbacks.length > 0 && <FallbackList slots={fallbacks} />}
      <p className="text-[11px] leading-5 text-gray-400" data-trip-esign-wet>
        {plainWet.length > 0 ? `ช่องที่ยังเซ็นสดบนกระดาษ: ${plainWet.map(slot => slot.label).join(' · ')} · ` : ''}{ESIGN_DRIVER_NOTE}
      </p>

      {status.locked && (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3" data-trip-esign-locked>
          <p className="flex items-start gap-2 text-xs leading-5 text-amber-900">
            <Lock size={14} className="mt-0.5 shrink-0" />
            <span>คำขอนี้มีลายเซ็นแล้ว จึงแก้ปลายทาง วัตถุประสงค์ วันเวลา จำนวนผู้ร่วมเดินทาง ตำแหน่งผู้ขอ หรือผู้ลงนามไม่ได้ — ถ้าต้องแก้ ให้ถอนลายเซ็นก่อน (เปลี่ยนรถหรือผู้ขับรถทำได้ตามปกติ)</span>
          </p>
          {status.can_revoke_all && !revoke && (
            <button type="button" onClick={() => { setNotice(null); setRevoke({ slot: null, reason: '', busy: false, error: '' }) }} data-revoke-all
              className={`${SMALL_BUTTON_CLASS} border-amber-300 bg-white text-amber-900 hover:bg-amber-100`}>
              <Undo2 size={13} /> ถอนลายเซ็นทั้งหมดเพื่อแก้คำขอ
            </button>
          )}
        </div>
      )}

      {revoke && (
        <div className="space-y-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5" data-revoke-form>
          <p className="text-xs font-bold text-red-900">{revoke.slot ? `ถอนลายเซ็น: ${SLOT_LABEL[revoke.slot]}` : 'ถอนลายเซ็นทั้งหมดเพื่อแก้คำขอ'}</p>
          <p className="text-xs leading-5 text-red-800" data-revoke-impact>
            {revokeNames.length > 0
              ? `จะถอนลายเซ็นของ: ${revokeNames.join(' · ')}${revokeNames.length > 1 ? ' — ช่องหลังในสายถอนตามไปด้วย เพราะผู้ลงนามช่องนั้นเห็นเนื้อหาชุดเดิม' : ''}`
              : 'ไม่มีลายเซ็นที่ต้องถอน'}
            {' '}· ถอนแล้วลายเซ็นเดิมยังเก็บไว้เป็นหลักฐาน (ไม่ถูกลบ) และบันทึกเหตุผลกับชื่อผู้ถอนไว้
          </p>
          <label className="block text-xs font-semibold text-red-900" htmlFor="revoke-reason">เหตุผล (3–500 ตัวอักษร)
            <input id="revoke-reason" data-revoke-reason maxLength={500} value={revoke.reason} placeholder="เช่น แก้วันเดินทางให้ตรงหนังสือเชิญ"
              onChange={event => setRevoke(current => ({ ...current, reason: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-red-200 bg-white px-3 py-2.5 text-sm text-gray-800 outline-none" />
          </label>
          {revoke.error && <p role="alert" className="text-xs text-red-700" data-revoke-error>{revoke.error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={handleRevoke} disabled={!reasonOk || revoke.busy || revokeNames.length === 0} data-confirm-revoke
              className={`${SMALL_BUTTON_CLASS} border-red-300 bg-red-600 text-white`}>
              {revoke.busy && <Loader2 size={13} className="animate-spin" />} ยืนยันถอนลายเซ็น
            </button>
            <button type="button" onClick={() => setRevoke(null)} disabled={revoke.busy} className={`${SMALL_BUTTON_CLASS} border-gray-200 bg-white text-gray-600`}>ยกเลิก</button>
          </div>
        </div>
      )}

      {signing && (
        <SignTripDialog tripId={trip.id} slot={signing.slot} slotLabel={signing.label} summary={summary} onClose={closeDialog}
          onSigned={result => {
            setSigning(null)
            clearHomeRpcCache('esign_my_pending') // ลงนามแล้วใบนี้ต้องหายจากการ์ด "รอลงนามของฉัน" ที่แคชไว้บนหน้าแรก
            setNotice({ ok: true, text: `${ESIGN_DECISION_LABEL[signing.slot === 'authority' ? 'approve' : 'sign']}แล้ว${result.stamped ? ' พร้อมแนบภาพลายเซ็น' : ''}${result.complete ? ' — ลงนามครบทุกช่องแล้ว' : ''}` })
            reload()
            onChanged?.()
          }} />
      )}
    </section>
  )
}

// เตือน "ไม่บล็อก" ในหน้าต่างบันทึกออกเดินทาง: ช่องผู้มีอำนาจเป็นออนไลน์แต่ยังไม่ลงนาม
// ออกรถต้องไม่ถูกขวาง (รถออกก่อนเอกสารเสร็จเกิดจริงทุกวัน และคนขับยืนรออยู่หน้ารถ) แต่ต้องให้คนกดเห็นว่าใบนี้ยังขาดอะไร
// อ่านสถานะไม่ได้ = เงียบ: ตัวเตือนนี้เป็นของเสริม ห้ามทำให้ขั้นตอนออกรถดูเหมือนพัง
export function DepartEsignNotice({ tripId }) {
  const [warning, setWarning] = useState(null)
  useEffect(() => {
    let cancelled = false
    getTripEsignStatus(tripId).then(result => { if (!cancelled) setWarning(esignDepartWarning(result)) })
    return () => { cancelled = true }
  }, [tripId])
  if (!warning) return null
  const who = warning.blocked
    ? `ผู้มีอำนาจลงนามออนไลน์ไม่ได้: ${esignMessage({ code: warning.blocked })}`
    : warning.expectedName ? `รอ ${warning.expectedName} ลงนาม` : null
  return (
    <div role="status" data-depart-esign-warning className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900">
      <p className="font-bold">⚠️ ใบขออนุญาตใช้รถนี้ลงนามออนไลน์ยังไม่ครบ — ยังขาด: {warning.missing.join(' · ')}</p>
      {who && <p>{who}</p>}
      <p>ออกเดินทางได้ตามปกติ (ระบบไม่บล็อก) แต่ใบนี้จะยังไม่มีลายเซ็นออนไลน์ครบ — ตามให้ผู้ลงนามลงนามภายหลังได้จากหน้ารายละเอียดคำขอ</p>
    </div>
  )
}
