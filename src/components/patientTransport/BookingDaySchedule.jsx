import { useState } from 'react'
import { bangkokISO, inputClass, buttonClass, primaryClass } from '../../lib/patientBooking'

const time = value => value ? new Date(value).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }) : ''
const noticeLabels = { normal: 'ไม่มีประกาศเพิ่มเติม', delayed: 'รถล่าช้า', contact: 'ติดต่อเจ้าหน้าที่ก่อนเดินทาง' }
const draftFrom = trip => ({ revision: trip.schedule_revision, notice: trip.public_notice || 'normal', pickup: time(trip.estimated_pickup_at), back: time(trip.estimated_return_at) })

// ฟอร์มแจ้งรถล่าช้า/ปรับเวลาประมาณการ — ใช้ในแผ่นรายละเอียดของกล่องคำขอรถ (BookingInbox.jsx) ใต้ "จัดการเพิ่มเติม"
// หน้า "ตารางออกรถประจำวัน" ที่เคยอยู่ในไฟล์นี้ถอดออกแล้ว 2569-09-21 (รวมเข้ากล่องคำขอรถ) จึงเหลือฟอร์มนี้ตัวเดียว
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
