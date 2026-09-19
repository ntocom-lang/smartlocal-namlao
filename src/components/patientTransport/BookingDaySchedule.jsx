import { useState } from 'react'
import { thaiDay, dateTime, bangkokISO, TRIP_STATUS, RETURN_MODES, MOBILITY, inputClass, buttonClass, primaryClass } from '../../lib/patientBooking'

const time = value => value ? new Date(value).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }) : ''
const noticeLabels = { normal: 'ไม่มีประกาศเพิ่มเติม', delayed: 'รถล่าช้า', contact: 'ติดต่อเจ้าหน้าที่ก่อนเดินทาง' }
const draftFrom = trip => ({ revision: trip.schedule_revision, notice: trip.public_notice || 'normal', pickup: time(trip.estimated_pickup_at), back: time(trip.estimated_return_at) })

function ScheduleUpdate({ trip, busy, onUpdate }) {
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

export default function BookingDaySchedule({ workspace, busy, onQueue, onUpdate }) {
  const [day, setDay] = useState(thaiDay)
  const [editing, setEditing] = useState(null)
  const trips = workspace.trips.filter(t => t.plan?.date === day && t.state !== 'cancelled')
  const pending = workspace.bookings.filter(b => b.status === 'submitted' && thaiDay(b.appointment_at) === day)
  const blocks = trips.flatMap(trip => (trip.plan.blocks || []).map((block, index) => ({ trip, block, index }))).sort((a, b) => a.block.start.localeCompare(b.block.start))
  const moveDay = step => { setDay(thaiDay(new Date(`${day}T12:00:00+07:00`).getTime() + step * 86400000)); setEditing(null) }
  return <section aria-label="ตารางออกรถเจ้าหน้าที่" className="space-y-4">
    <h2 className="text-xl font-bold">ตารางออกรถประจำวัน</h2>
    <p className="text-sm text-slate-600">ใช้เที่ยวที่ยืนยันแล้วโดยอัตโนมัติ อัปเดตเมื่อคนขับบันทึกสถานะ และโหลดข้อมูลใหม่ทุก 1 นาทีขณะเปิดหน้านี้</p>
    <div className="grid grid-cols-3 items-end gap-2 sm:flex sm:flex-wrap"><button className={buttonClass} onClick={() => moveDay(-1)}>วันก่อนหน้า</button><label className="order-first col-span-3 min-w-0 sm:order-none sm:flex-1">วันออกรถ<input type="date" className={inputClass} value={day} onChange={e => { if (e.target.value) { setDay(e.target.value); setEditing(null) } }} /></label><button className={buttonClass} onClick={() => moveDay(1)}>วันถัดไป</button><button className={buttonClass} onClick={() => { setDay(thaiDay()); setEditing(null) }}>วันนี้</button></div>
    <div className="rounded-xl bg-sky-50 p-3"><strong>{trips.length} เที่ยวที่ยืนยันแล้ว · {pending.length} คำขอรอยืนยัน</strong><p className="text-sm">ช่วงที่ไม่แสดงเที่ยวไม่ได้ยืนยันว่ารถพร้อม ต้องตรวจวันหยุด เวลาให้บริการ และคิวก่อนรับงาน</p></div>
    <section aria-label="คำขอรอยืนยันของวัน" className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3"><h3 className="font-semibold">คำขอรอยืนยัน · ยังไม่กันรถหรือที่นั่ง</h3>{pending.length ? <><table className="hidden w-full border-collapse text-sm lg:table"><thead><tr className="text-left text-slate-700"><th className="px-2 py-1 font-semibold">เวลานัด</th><th className="px-2 py-1 font-semibold">ผู้เดินทาง</th><th className="px-2 py-1 font-semibold">ปลายทาง</th><th className="px-2 py-1 font-semibold">หมายเหตุ</th></tr></thead><tbody>{pending.map(b => <tr key={b.id} className="border-t border-amber-200"><td className="whitespace-nowrap px-2 py-1">{time(b.appointment_at)} น.</td><td className="px-2 py-1">{b.patient_name}</td><td className="px-2 py-1">{b.route_label}</td><td className="px-2 py-1">{b.requested_trip_id ? 'ขอร่วมเที่ยว' : ''}</td></tr>)}</tbody></table><ul className="space-y-2 lg:hidden">{pending.map(b => <li key={b.id}>{time(b.appointment_at)} น. นัด · {b.patient_name} · {b.route_label}{b.requested_trip_id ? ' · ขอร่วมเที่ยว' : ''}</li>)}</ul><button className={buttonClass} disabled={busy} onClick={onQueue}>ไปจัดคิวคำขอ</button></> : <p>ไม่มีคำขอรอยืนยันในวันนี้</p>}</section>
    <section aria-label="เที่ยวที่ยืนยันตามเวลา" className="space-y-3"><h3 className="font-semibold">ช่วงใช้รถตามแผน</h3>{!blocks.length && <p className="rounded-xl border p-4">ยังไม่มีเที่ยวที่ยืนยันในวันนี้</p>}{blocks.map(({ trip, block, index }) => {
      const passengers = workspace.bookings.filter(b => b.trip_id === trip.id && ['confirmed', 'completed'].includes(b.status))
      const driver = trip.driver_name || workspace.people?.find(p => p.id === trip.driver_id)?.name
      return <article key={`${trip.id}/${index}`} className="rounded-xl border border-slate-200 border-l-4 border-l-sky-700 p-4">
        <p className="font-bold text-sky-900">{time(block.start)}–{time(block.end)} น. · {trip.plan.return_mode === 'later' ? index === 0 ? 'ขาไปและกลับพื้นที่' : 'ไปรับกลับและส่งถึงจุดหมาย' : RETURN_MODES[trip.plan.return_mode]}</p>
        <h4 className="mt-1 font-bold">{trip.plan.route_label}</h4><p>{TRIP_STATUS[trip.state]} · รหัสเที่ยว {trip.id.slice(0, 8)}</p>
        <p>ผู้เดินทางรวมผู้ติดตาม {passengers.reduce((sum, b) => sum + 1 + b.companions, 0)} คน · {driver ? `คนขับ ${driver}` : 'มอบหมายคนขับแล้ว'}</p>
        <p className="text-sm">เริ่มรับตามแผน {time(trip.plan.pickup_at)} น.{trip.plan.return_mode !== 'one_way' && ` · รับกลับ ${time(trip.plan.return_at) || 'รอประสาน'} น.`}</p>
        {(trip.public_notice !== 'normal' || trip.estimated_pickup_at || trip.estimated_return_at) && trip.public_notice && <p className="my-2 rounded-lg bg-amber-50 p-2">{noticeLabels[trip.public_notice]} · เริ่มรับ {time(trip.estimated_pickup_at) || 'ตามแผน'} · รับกลับ {time(trip.estimated_return_at) || 'ตามแผน'}</p>}
        {index === 0 && <details className="mt-2"><summary className="flex min-h-11 cursor-pointer items-center font-semibold">ดูผู้เดินทาง จุดรับ และจัดการเที่ยว</summary><div className="space-y-3 pt-2">
          <ul className="space-y-3">{passengers.map(b => <li key={b.id} className="rounded-lg bg-slate-50 p-3"><strong>{b.patient_name}</strong><p>{MOBILITY[b.mobility]} · ผู้ติดตาม {b.companions} คน</p><p>จุดรับ: {b.pickup}</p>{Number.isFinite(b.pickup_lat) && Number.isFinite(b.pickup_lng) && Math.abs(b.pickup_lat) <= 90 && Math.abs(b.pickup_lng) <= 180 && <a href={`https://www.google.com/maps/dir/?api=1&destination=${b.pickup_lat},${b.pickup_lng}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sky-800 underline">นำทางไปจุดรับ</a>}<p>นัด {dateTime(b.appointment_at)}</p>{b.phone && <a className="inline-flex min-h-11 items-center text-sky-800 underline" href={`tel:${b.phone}`}>โทร {b.phone}</a>}{b.cancel_requested && <p className="font-semibold text-amber-800">ขอประสานยกเลิก</p>}{b.return_ready && <p className="font-semibold text-sky-800">แจ้งพร้อมรับกลับแล้ว</p>}</li>)}</ul>
          {trip.issue_note && <p className="rounded-lg bg-amber-50 p-3">บันทึกภายใน: {trip.issue_note}</p>}
          <button className={buttonClass} disabled={busy} onClick={onQueue}>ไปจัดการคิวและเที่ยวรถ</button>
          {!['completed', 'cancelled'].includes(trip.state) && <button className={buttonClass} disabled={busy} onClick={() => setEditing(editing === trip.id ? null : trip.id)}>{editing === trip.id ? 'ปิดการแจ้งเวลา' : 'แจ้งล่าช้า / ปรับเวลาประมาณการ'}</button>}
          {editing === trip.id && <ScheduleUpdate trip={trip} busy={busy} onUpdate={async (...args) => { const saved = await onUpdate(...args); if (saved) setEditing(null); return saved }} />}
        </div></details>}
      </article>
    })}</section>
  </section>
}
