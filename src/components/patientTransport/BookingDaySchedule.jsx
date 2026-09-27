import { useState } from 'react'
import { bangkokISO, inputClass, buttonClass, primaryClass, thaiDay } from '../../lib/patientBooking'

const time = value => value ? new Date(value).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }) : ''
const noticeLabels = { normal: 'ไม่มีประกาศเพิ่มเติม', delayed: 'รถล่าช้า', contact: 'ติดต่อเจ้าหน้าที่ก่อนเดินทาง' }
const draftFrom = trip => ({ revision: trip.schedule_revision, notice: trip.public_notice || 'normal', pickup: time(trip.estimated_pickup_at), back: time(trip.estimated_return_at) })

const localDate = value => thaiDay(value)
const snapshot = (trip, passengers, settings) => ({ trip: trip.id, revision: trip.revision, docs_revision: trip.docs_revision,
  schedule_revision: trip.schedule_revision, settings_revision: settings.revision,
  bookings: Object.fromEntries([...passengers].sort((a, b) => a.id.localeCompare(b.id)).map(b => [b.id, b.revision])) })

export function RescheduleJourney({ trip, booking, passengers, settings, busy, onReschedule }) {
  const [draft, setDraft] = useState(() => ({ expected: snapshot(trip, passengers, settings), date: localDate(booking.appointment_at),
    appointment: time(booking.appointment_at), back: time(booking.return_at), scope: 'single', notDeparted: false }))
  const [result, setResult] = useState(null)
  const stale = JSON.stringify(draft.expected) !== JSON.stringify(snapshot(trip, passengers, settings))
  const set = (key, value) => { setDraft(previous => ({ ...previous, [key]: value })); setResult(null) }
  const canMove = ['confirmed', 'outbound'].includes(trip.state) && trip.odometer_end == null && passengers.every(b => b.passenger_step === 0 && !b.return_ready)
  if (!canMove) return <p className="rounded-xl bg-amber-50 p-3">เที่ยวนี้มีการรับ–ส่งแล้ว จึงเลื่อนวันทับประวัติไม่ได้ หากนัดครั้งใหม่ให้รับจองใหม่ ส่วนเวลาล่าช้าแจ้งได้ด้านล่าง</p>
  return <form className="space-y-3 rounded-xl bg-sky-50 p-3" onSubmit={async e => {
    e.preventDefault()
    if (busy || stale) return
    const out = await onReschedule({ p_booking: booking.id, p_scope: draft.scope, p_expected: draft.expected,
      p_appointment: bangkokISO(draft.date, draft.appointment), p_return: booking.return_mode === 'one_way' ? null : bangkokISO(draft.date, draft.back), p_not_departed: draft.notDeparted })
    if (out && !out.saved) setResult(out)
  }}>
    <p className="font-semibold">เปลี่ยนวันและเวลาเดินทาง</p>
    <p className="text-sm">ระบบตรวจรถว่างและย้ายคิวจริงให้พร้อมกันทั้งปฏิทินและงานคนขับ ถ้าคิวใหม่ชน คิวเดิมยังอยู่ เก็บประวัติวันเวลาและเลขหนังสือเดิมไว้ กรุณาพิมพ์เอกสารใหม่หลังเลื่อน</p>
    {passengers.length > 1 && <><label className="block">ผู้เดินทางที่ต้องการเลื่อน<select className={inputClass} value={draft.scope} onChange={e => set('scope', e.target.value)}><option value="single">เฉพาะ {booking.patient_name}</option><option value="all">ทั้งเที่ยว {passengers.length} คน</option></select></label>
      <p className="text-sm">{draft.scope === 'all' ? `เลื่อนทั้งเที่ยว: ${passengers.map(b => b.patient_name).join(' · ')} โดยคงระยะห่างเวลานัดของแต่ละคน` : 'ผู้เดินทางคนอื่นยังใช้วันเวลาเดิม ระบบจะตรวจไม่ให้รถทับกัน'}</p></>}
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <label className="min-w-0">วันเดินทางใหม่<input required type="date" className={inputClass} value={draft.date} onChange={e => set('date', e.target.value)} /></label>
      <label className="min-w-0">เวลานัดแพทย์ใหม่<input required type="time" className={inputClass} value={draft.appointment} onChange={e => set('appointment', e.target.value)} /></label>
      {booking.return_mode !== 'one_way' && <label className="min-w-0">เวลารับกลับใหม่<input required type="time" className={inputClass} value={draft.back} onChange={e => set('back', e.target.value)} /></label>}
    </div>
    <p className="text-sm">เวลาเริ่มรับจะคำนวณจากเวลานัด ระยะทาง และเวลาเผื่อที่ตั้งไว้โดยอัตโนมัติ</p>
    {trip.state === 'outbound' && <label className="flex min-h-11 items-center gap-2 rounded-lg bg-amber-50 p-3"><input required type="checkbox" checked={draft.notDeparted} onChange={e => set('notDeparted', e.target.checked)} />กดออกรถผิด ยืนยันว่าทั้งเที่ยวยังไม่ได้ออกรถจริง</label>}
    {stale && <p role="alert">ข้อมูลคิวเปลี่ยนแล้ว กรุณาปิดและเปิดฟอร์มใหม่ก่อนบันทึก</p>}
    {result && <div role="alert" className="space-y-2 rounded-lg bg-amber-50 p-3"><p className="font-semibold">ยังไม่ได้ย้ายคิว · คิวเดิมยังอยู่</p>{result.errors.map(message => <p key={message}>{message}</p>)}<p>เลือกวันหรือเวลาอื่นแล้วบันทึกใหม่ ระบบจะตรวจคิวให้อีกครั้ง</p>
      {result.suggestions?.map(date => <button key={date} type="button" className={`${buttonClass} mr-2 mt-2`} onClick={() => set('date', date)}>ใช้วันที่ {new Date(`${date}T12:00:00+07:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })} เวลาเดิม</button>)}</div>}
    <button className={primaryClass} disabled={busy || stale || (trip.state === 'outbound' && !draft.notDeparted)}>บันทึกวันเวลาใหม่</button>
  </form>
}

// ฟอร์มแจ้งรถล่าช้า/ปรับเวลาประมาณการ — ใช้ในแผ่นรายละเอียดของกล่องคำขอรถ (BookingInbox.jsx) ใต้ "จัดการเพิ่มเติม"
// การแจ้งเวลาประมาณการยังแยกจากการย้ายคิวจริง เพื่อใช้เมื่อรถกำลังให้บริการแล้ว
export function ScheduleUpdate({ trip, busy, onUpdate }) {
  // Keep the revision belonging to the visible draft; polling must never silently authorize an overwrite.
  const [draft, setDraft] = useState(() => draftFrom(trip))
  const stale = draft.revision !== trip.schedule_revision
  const set = (key, value) => setDraft(previous => ({ ...previous, [key]: value }))
  return <form className="space-y-3 rounded-xl bg-sky-50 p-3" onSubmit={async e => {
    e.preventDefault()
    if (stale || busy) return
    await onUpdate(trip.id, draft.revision, draft.notice, bangkokISO(trip.plan.date, draft.pickup), bangkokISO(trip.plan.date, draft.back))
  }}>
    <p className="font-semibold">แจ้งเวลาเดินทางล่าสุด</p>
    <p className="text-sm">เที่ยวที่เปิดร่วมจะแสดงประกาศนี้ในตารางประชาชน เที่ยวส่วนตัวจะแสดงเฉพาะผู้จองและเจ้าหน้าที่ เวลานี้เป็นประมาณการ ไม่เปลี่ยนช่วงจองรถ หากกระทบเที่ยวอื่นให้ประสานจัดคิว</p>
    <label className="block">ประกาศการเดินทาง<select aria-label="ประกาศการเดินทาง" className={inputClass} value={draft.notice} onChange={e => set('notice', e.target.value)}>{Object.entries(noticeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2"><label className="min-w-0">เริ่มรับประมาณการใหม่<input type="time" className={inputClass} value={draft.pickup} onChange={e => set('pickup', e.target.value)} /></label>{trip.plan.return_mode !== 'one_way' && <label className="min-w-0">รับกลับประมาณการใหม่<input type="time" className={inputClass} value={draft.back} onChange={e => set('back', e.target.value)} /></label>}</div>
    <p className="text-sm">เว้นว่างเพื่อล้างประมาณการและกลับไปใช้เวลาตามแผน</p>
    {stale && <div role="alert" className="space-y-2 rounded-lg bg-amber-50 p-3"><p>ข้อมูลแจ้งเวลาเปลี่ยนแล้ว: {noticeLabels[trip.public_notice]} · เริ่มรับ {time(trip.estimated_pickup_at) || 'ตามแผน'} · รับกลับ {time(trip.estimated_return_at) || 'ตามแผน'}</p><button type="button" className={buttonClass} onClick={() => setDraft(draftFrom(trip))}>ใช้เวลาแจ้งล่าสุด</button></div>}
    <button className={primaryClass} disabled={busy || stale || !Number.isInteger(draft.revision)}>บันทึกประกาศและเวลา</button>
  </form>
}
