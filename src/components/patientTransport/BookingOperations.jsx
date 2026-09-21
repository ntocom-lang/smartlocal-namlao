import { useState } from 'react'
import { ListCard } from './StaffShell'
import { thaiDateFromDateInput } from '../../lib/thaiDate'
import { BOOKING_STATUS, BOOKING_STEPS, TRIP_STATUS, RETURN_MODES, MOBILITY, DRIVER_STEPS, bookingStep, driverProgress, driverNext, dateTime, clockOf, whenLabel, thaiDay, bangkokISO, buttonClass, primaryClass, inputClass, previousOdometer } from '../../lib/patientBooking'

// ป้ายสถานะสีแบบเดียวกับการ์ดในแท็บ "การใช้รถ" ของยานพาหนะ — ผู้จองต้องเห็นสถานะก่อนอ่านรายละเอียด
const BOOKING_CHIP = { submitted: 'bg-amber-100 text-amber-900', confirmed: 'bg-sky-100 text-sky-900', completed: 'bg-emerald-100 text-emerald-900', cancelled: 'bg-slate-200 text-slate-700' }

// แถบขั้นตอน 4 ขั้นของคำขอ — ภาษาเดียวกับแถบสถานะของ "คำขอบริการ/เอกสาร" ที่ประชาชนเคยเห็นแล้ว
function StepBar({ step }) {
  return <ol className="my-3 flex items-start gap-1" aria-label={`ขั้นตอนของคำขอ · ${BOOKING_STEPS[step - 1] || ''}`}>
    {BOOKING_STEPS.map((label, index) => {
      const at = index + 1
      const reached = step >= at
      return <li key={label} className="flex-1">
        <div className="flex items-center">
          <span className={`h-1 flex-1 ${index === 0 ? 'bg-transparent' : reached ? 'bg-sky-700' : 'bg-slate-200'}`} />
          <span className={`mx-1 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${reached ? 'bg-sky-700 text-white' : 'bg-slate-200 text-slate-500'}`}>{reached ? '✓' : at}</span>
          <span className={`h-1 flex-1 ${index === BOOKING_STEPS.length - 1 ? 'bg-transparent' : step > at ? 'bg-sky-700' : 'bg-slate-200'}`} />
        </div>
        <span className={`mt-1 block text-center text-[11px] leading-tight ${reached ? 'font-bold text-sky-900' : 'text-slate-500'}`}>{label}</span>
      </li>
    })}
  </ol>
}

export function BookingCards({ bookings, trips, onAction, busy }) {
  if (!bookings.length) return <p className="rounded-xl border border-slate-200 p-4 text-slate-600">ยังไม่มีการจอง</p>
  return <div className="space-y-4">{bookings.map(b => {
    const trip = b.status === 'cancelled' ? null : trips.find(t => t.id === b.trip_id)
    const step = bookingStep(b, trip)
    return <article key={b.id} className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-1 flex flex-wrap items-center gap-2"><h3 className="font-bold">{b.patient_name}</h3><span className={`rounded-full px-3 py-1 text-xs font-bold ${BOOKING_CHIP[b.status] || 'bg-slate-100'}`}>{BOOKING_STATUS[b.status]}</span></div>
      <p>{b.route_label} · นัด {dateTime(b.appointment_at)}</p>
      <p className="text-xs text-slate-500">เลขที่คำขอ {b.id.slice(0, 8).toUpperCase()}</p>
      {step > 0 && <StepBar step={step} />}
      {/* บรรทัดเดียวที่บอกว่า "ตอนนี้ถึงไหนและต้องรออะไร" — ของเดิมให้ผู้จองอ่านสถานะเที่ยวเอาความหมายเอง */}
      {step === 1 && <p className="rounded-xl bg-amber-50 p-3">รอเจ้าหน้าที่ยืนยันรถ · ยังไม่ได้กันที่นั่งให้</p>}
      {step === 4 && <p className="rounded-xl bg-emerald-50 p-3">เดินทางเสร็จแล้ว ขอบคุณที่ใช้บริการ</p>}
      {b.requested_trip_id && b.status === 'submitted' && <p className="font-semibold text-sky-800">ขอร่วมเที่ยว รอเจ้าหน้าที่ตรวจยืนยัน</p>}
      {trip && <div className="my-3 rounded-xl bg-sky-50 p-3"><strong>{TRIP_STATUS[trip.state]}</strong><p>รถจะมารับประมาณ {dateTime(trip.estimated_pickup_at || trip.plan.pickup_at)}</p>{trip.public_notice === 'delayed' && <p className="font-semibold text-amber-800">รถล่าช้า · กรุณาตรวจเวลาล่าสุด</p>}{trip.public_notice === 'contact' && <p className="font-semibold text-amber-800">กรุณาติดต่อเจ้าหน้าที่ก่อนเดินทาง</p>}{trip.estimated_return_at && <p>แจ้งรับกลับล่าสุด {dateTime(trip.estimated_return_at)} (ประมาณการ)</p>}<p className="text-sm">{RETURN_MODES[b.return_mode]} · {MOBILITY[b.mobility]}{b.companions ? ` · ผู้ติดตาม ${b.companions} คน` : ''}</p></div>}
      {b.cancel_requested && <p className="my-2 rounded-xl bg-amber-50 p-3">ขอยกเลิกแล้ว รอเจ้าหน้าที่ประสานก่อนเปลี่ยนเที่ยว</p>}
      {b.return_ready && <p className="my-2 rounded-xl bg-sky-50 p-3">แจ้งพร้อมกลับแล้ว ไม่ได้หมายความว่ารถจะมาถึงทันที</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {b.status === 'confirmed' && b.passenger_step === 2 && b.return_mode !== 'one_way' && !b.return_ready && <button className={buttonClass} disabled={busy} onClick={() => onAction(b, 'ready_return')}>พร้อมให้มารับกลับ</button>}
        {['submitted', 'confirmed'].includes(b.status) && !b.cancel_requested && <button className={buttonClass} disabled={busy} onClick={() => onAction(b, 'cancel')}>{b.status === 'submitted' ? 'ยกเลิกคำขอ' : 'ขอประสานยกเลิก'}</button>}
      </div>
    </article>
  })}</div>
}

// รายงานและประวัติ — สรุปรายเดือนสำหรับแนบเบิก และรายการเหตุการณ์ย้อนหลัง
export function QueueReport({ workspace, busy, onMonthReport }) {
  return <ListCard title="รายงานและประวัติ" count={workspace.events.length}>
    <div className="space-y-3 p-4 sm:p-5">
      <MonthReport busy={busy} onPrint={onMonthReport} />
      <p>จบแล้ว {workspace.trips.filter(t => t.state === 'completed').length} เที่ยว · รอดำเนินการ {workspace.trips.filter(t => !['completed', 'cancelled'].includes(t.state)).length} เที่ยว (เที่ยวปิดใน 30 วันล่าสุด)</p>
      {workspace.events.map((e, i) => <div key={`${e.created_at}-${i}`} className="border-b border-slate-200 py-3"><strong>{e.action}</strong> · {dateTime(e.created_at)}<p className="text-sm">{e.detail?.note || `รายการ ${e.entity_id.slice(0, 8)}`}</p></div>)}
    </div>
  </ListCard>
}

// saveLabel: แผ่นแก้ปัญหาของกล่องคำขอรถใช้ "บันทึกและยืนยันรถ" เพราะบันทึกแล้วระบบยืนยันต่อให้ทันที
export function AmendBooking({ booking, routes, busy, onBack, onSave, saveLabel = 'ยืนยันข้อมูลที่ประสานแล้ว' }) {
  const hhmm = value => value ? new Date(value).toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }) : ''
  const [form, setForm] = useState({ day: thaiDay(booking.appointment_at), time: hhmm(booking.appointment_at), back: hhmm(booking.return_at), route_id: booking.route_id, pickup: booking.pickup, in_area: booking.in_area, return_mode: booking.return_mode, note: '' })
  const change = key => e => setForm(f => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  return <form className="space-y-3 rounded-xl border-2 border-sky-700 p-4" onSubmit={e => { e.preventDefault(); onSave({ appointment_at: bangkokISO(form.day, form.time), return_at: form.return_mode === 'one_way' ? null : bangkokISO(form.day, form.back), route_id: form.route_id, pickup: form.pickup, in_area: form.in_area, return_mode: form.return_mode }, form.note) }}>
    <h3 className="font-bold">แก้ข้อมูลตามที่ประสานกับ {booking.patient_name}</h3><div className="grid gap-3 sm:grid-cols-2">
      <label>วันนัด<input className={inputClass} type="date" required value={form.day} onChange={change('day')} /></label><label>เวลานัด<input className={inputClass} type="time" required value={form.time} onChange={change('time')} /></label>
      <label>เส้นทาง<select className={inputClass} value={form.route_id} onChange={change('route_id')}>{routes.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
      <label>ขากลับ<select className={inputClass} value={form.return_mode} onChange={change('return_mode')}>{Object.entries(RETURN_MODES).map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>
      {form.return_mode !== 'one_way' && <label>เวลาพร้อมรับกลับ<input className={inputClass} type="time" value={form.back} onChange={change('back')} /></label>}
      <label>จุดรับ<input className={inputClass} required maxLength={500} value={form.pickup} onChange={change('pickup')} /></label>
    </div><label className="flex min-h-11 items-center gap-3"><input className="size-5" type="checkbox" checked={form.in_area} onChange={change('in_area')} />ตรวจสอบว่าอยู่ในพื้นที่แล้ว</label>
    <label className="block">เหตุผลและผลประสาน<input className={inputClass} required maxLength={500} value={form.note} onChange={change('note')} /></label>
    <div className="flex flex-wrap gap-2"><button className={primaryClass} disabled={busy}>{saveLabel}</button><button type="button" className={buttonClass} onClick={onBack} disabled={busy}>ปิด</button></div>
  </form>
}

// แถบขั้นของเที่ยวบนการ์ดคนขับ — ทำแล้วเขียวมีติ๊ก ขั้นที่กำลังจะกดมีกรอบ คนขับจะรู้ว่าอยู่ตรงไหนของงาน
function DriverStepBar({ trip }) {
  const labels = DRIVER_STEPS[trip.plan?.return_mode === 'one_way' ? 'one_way' : 'round']
  const done = driverProgress(trip)
  return <ol className="flex gap-1" aria-label={`ขั้นของเที่ยว · ทำแล้ว ${Math.min(done, labels.length)} จาก ${labels.length}`}>
    {labels.map((text, index) => <li key={text} className={`flex-1 rounded-lg px-1 py-1.5 text-center text-xs font-bold ${index < done ? 'bg-emerald-600 text-white' : index === done ? 'border-2 border-sky-800 bg-white text-sky-900' : 'bg-slate-100 text-slate-500'}`}>
      {index < done && <span aria-hidden="true">✓ </span>}{text}
    </li>)}
  </ol>
}

// แจ้งเหตุขัดข้อง: ปุ่มเล็ก กดแล้วค่อยมีตัวเลือก (เดิมช่องพิมพ์ค้างอยู่บนหน้าตลอดและใช้ร่วมทุกเที่ยว)
// ตัวเลือกสำเร็จรูปให้คนขับกดแทนพิมพ์ · ⚠️ แจ้งแล้วเที่ยวหยุดรอจนเจ้าหน้าที่ประสานแก้
// ล่าช้าเฉย ๆ จึงไม่อยู่ในตัวเลือก ให้โทรแจ้งแทน ไม่งั้นเที่ยวค้างทั้งที่ยังวิ่งต่อได้
const ISSUE_CHOICES = ['ผู้ป่วยไม่ได้ขึ้นรถ', 'ติดต่อผู้ป่วยไม่ได้', 'รถเสีย / รถมีปัญหา', 'อุบัติเหตุ']
function IssueReport({ busy, contactPhone, onReport }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const close = () => { setOpen(false); setNote('') }
  if (!open) return <button type="button" className="min-h-11 text-sm font-semibold text-red-700 underline disabled:opacity-50" disabled={busy} onClick={() => setOpen(true)}>แจ้งเหตุขัดข้อง</button>
  return <div className="space-y-3 rounded-xl border-2 border-red-200 bg-red-50 p-3">
    <p className="font-bold text-red-800">แจ้งเหตุขัดข้องให้เจ้าหน้าที่</p>
    <p className="text-sm">เที่ยวจะหยุดไว้จนเจ้าหน้าที่ประสานแก้{contactPhone && <> · ถ้าแค่ล่าช้า ไม่ต้องแจ้งที่นี่ <a className="font-semibold text-sky-800 underline" href={`tel:${contactPhone}`}>โทร {contactPhone}</a></>}</p>
    <div className="grid grid-cols-2 gap-2">{ISSUE_CHOICES.map(text => <button key={text} type="button" aria-pressed={note === text} onClick={() => setNote(text)}
      className={`min-h-12 rounded-xl border-2 px-2 text-sm font-semibold ${note === text ? 'border-red-800 bg-red-700 text-white' : 'border-slate-300 bg-white text-slate-900'}`}>{text}</button>)}</div>
    <label className="block text-sm">ข้อความที่จะส่ง<input className={inputClass} value={note} maxLength={500} onChange={e => setNote(e.target.value)} placeholder="กดเลือกด้านบน หรือพิมพ์เอง" /></label>
    <div className="flex gap-2">
      <button type="button" className={buttonClass} disabled={busy} onClick={close}>ปิด</button>
      <button type="button" className="min-h-11 flex-1 rounded-xl bg-red-700 px-4 text-sm font-bold text-white disabled:opacity-50" disabled={busy || !note.trim()} onClick={async () => { if (await onReport(note.trim())) close() }}>ส่งให้เจ้าหน้าที่</button>
    </div>
  </div>
}

// การ์ดเที่ยวของคนขับ: เวลา · โรงพยาบาล · ผู้เดินทาง (โทร/นำทาง) · แถบขั้น · ปุ่มใหญ่ปุ่มเดียว
// upcoming = เที่ยวที่ยังไม่ถึงวัน แสดงไว้ให้เตรียมตัว/โทรนัด แต่ไม่มีปุ่มบันทึก กันกดผิดเที่ยว
function DriverCard({ trip: t, bookings, busy, upcoming, contactPhone, onAdvance, onAction }) {
  const people = bookings.filter(b => b.trip_id === t.id && b.status !== 'cancelled')
  const label = driverNext(t, bookings)
  const pickupAt = t.estimated_pickup_at || t.plan?.pickup_at
  const backAt = t.estimated_return_at || t.plan?.return_at
  return <article data-trip={t.id} aria-label={`เที่ยว ${t.plan?.route_label} ${clockOf(pickupAt)} น.`} className={`space-y-3 rounded-2xl border-2 bg-white p-4 ${upcoming ? 'border-slate-200' : 'border-sky-700'}`}>
    {/* ป้ายสถานะอยู่บรรทัดบนสุด — วางข้างหัวการ์ดแล้วจอมือถือตัดเวลาและชื่อโรงพยาบาลขึ้นบรรทัดใหม่ */}
    <div className="space-y-0.5">
      <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-bold ${t.state === 'issue' ? 'bg-red-100 text-red-800' : 'bg-sky-100 text-sky-900'}`}>{TRIP_STATUS[t.state]}</span>
      <p className="text-lg font-bold">{whenLabel(pickupAt)} · ออกรับ {clockOf(pickupAt)} น.</p>
      <p className="font-semibold">🏥 {t.plan?.route_label}</p>
      <p className="text-sm text-slate-600">{RETURN_MODES[t.plan?.return_mode]}{t.plan?.return_mode !== 'one_way' && backAt ? ` · รับกลับประมาณ ${clockOf(backAt)} น.` : ''}</p>
    </div>
    {t.helper_name && <p className="text-sm">ผู้ช่วยเคลื่อนย้าย: <strong>{t.helper_name}</strong></p>}
    <ol className="space-y-2">{people.map((b, index) => {
      const pin = Number.isFinite(b.pickup_lat) && Number.isFinite(b.pickup_lng) && Math.abs(b.pickup_lat) <= 90 && Math.abs(b.pickup_lng) <= 180
      return <li key={b.id} className="rounded-xl bg-slate-50 p-3">
        <p className="font-bold">{people.length > 1 ? `${index + 1}. ` : ''}{b.patient_name}</p>
        <p className="text-sm">{MOBILITY[b.mobility]} · ผู้ติดตาม {b.companions} คน</p>
        <p className="text-sm">จุดรับ: {b.pickup}</p>
        {b.cancel_requested && <p className="text-sm font-semibold text-amber-800">ผู้จองขอยกเลิก รอเจ้าหน้าที่ประสาน · ถ้าไม่ได้ขึ้นรถ กด “แจ้งเหตุขัดข้อง”</p>}
        {b.return_ready && t.state === 'hospital' && <p className="text-sm font-bold text-sky-800">🔔 แจ้งพร้อมให้รับกลับแล้ว</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          {b.phone && <a href={`tel:${b.phone}`} className={`${buttonClass} inline-flex items-center`}>📞 โทร {b.phone}</a>}
          {pin && <a href={`https://www.google.com/maps/dir/?api=1&destination=${b.pickup_lat},${b.pickup_lng}`} target="_blank" rel="noopener noreferrer" className={`${buttonClass} inline-flex items-center`}>📍 นำทางไปจุดรับ</a>}
        </div>
      </li>
    })}</ol>
    {upcoming && <p className="text-sm text-slate-600">ปุ่มบันทึกจะขึ้นในวันเดินทาง</p>}
    {!upcoming && <>
      <DriverStepBar trip={t} />
      {t.state === 'issue'
        ? <p className="rounded-xl bg-amber-50 p-3">แจ้งเหตุขัดข้องแล้ว: {t.issue_note || '—'} · รอเจ้าหน้าที่ประสาน แล้วปุ่มจะกลับมาเอง</p>
        : label && <>
          <button type="button" className="min-h-14 w-full rounded-2xl bg-sky-800 px-4 text-lg font-bold text-white disabled:opacity-50" disabled={busy} onClick={() => onAdvance(t, label)}>{label}</button>
          {/* ปุ่มนี้บันทึกผู้เดินทางทุกคนพร้อมกัน — คนที่ไม่ได้ขึ้นรถต้องแจ้งก่อน ไม่งั้นจะถูกบันทึกว่าไปด้วย */}
          {t.state === 'outbound' && people.length > 0 && <p className="text-sm text-slate-600">{people.length > 1 ? 'กดเมื่อส่งครบทุกคนแล้ว · ' : ''}ถ้ามีผู้ป่วยไม่ได้ขึ้นรถ กด “แจ้งเหตุขัดข้อง” แทน</p>}
        </>}
      {t.state !== 'issue' && <IssueReport busy={busy} contactPhone={contactPhone} onReport={note => onAction(t, 'issue', note)} />}
    </>}
  </article>
}

// งานคนขับ — เจ้าของระบบสั่ง 2569-09-21 ให้ง่ายที่สุด: การ์ดเที่ยวละใบ ปุ่มใหญ่ปุ่มเดียวบอกขั้นถัดไป
// ไป-กลับ 4 ครั้ง · ขาเดียว 2 ครั้ง (เดิม 8/4 ครั้ง + ช่องเลขไมล์และช่องเหตุขัดข้องค้างอยู่ทุกการ์ด)
// ปุ่มขึ้นเฉพาะเที่ยวของวันนี้ (หรือเลยวันแล้วยังไม่จบ) · เลขไมล์ถามครั้งเดียวหลังจบงาน ใส่ทีหลังได้
export function DriverTrips({ workspace, uid, busy, contactPhone, onAdvance, onAction, onOdometer }) {
  const mine = workspace.trips.filter(t => t.driver_id === uid)
  const byPickup = (a, b) => String(a.plan?.pickup_at || '').localeCompare(String(b.plan?.pickup_at || ''))
  const today = thaiDay()
  const active = mine.filter(t => !['completed', 'cancelled'].includes(t.state)).sort(byPickup)
  const now = active.filter(t => (t.plan?.date || today) <= today)
  const later = active.filter(t => (t.plan?.date || today) > today)
  // จบเที่ยวแล้วแต่ยังไม่มีเลขไมล์กลับ — ค้างไว้ตรงนี้จนกว่าจะใส่ (ผลตรวจ #227 ข้อ 4)
  const awaitingOdometer = mine.filter(t => t.state === 'completed' && (!Number.isFinite(t.odometer_end) || t.odometer_issue)).sort(byPickup)
  const recorded = mine.filter(t => t.state === 'completed' && Number.isFinite(t.odometer_end) && !t.odometer_issue).sort(byPickup).reverse()
  return <div className="space-y-4">
    <div><h2 className="text-xl font-bold">งานคนขับ</h2><p className="text-sm font-semibold text-amber-800">กดบันทึกเมื่อจอดรถในที่ปลอดภัย</p></div>
    {!now.length && <p className="rounded-xl border border-slate-200 bg-white p-4 text-slate-600">วันนี้ไม่มีเที่ยวที่ต้องออก{later.length ? ` · เที่ยวถัดไป ${later.length} เที่ยวอยู่ด้านล่าง` : ''}</p>}
    {now.map(t => <DriverCard key={t.id} trip={t} bookings={workspace.bookings} busy={busy} contactPhone={contactPhone} onAdvance={onAdvance} onAction={onAction} />)}
    {awaitingOdometer.length > 0 && <section aria-label="จบแล้ว รอเติมเลขไมล์" className="space-y-3">
      <h3 className="font-bold">จบแล้ว รอเติมเลขไมล์ ({awaitingOdometer.length})</h3>
      {awaitingOdometer.map(t => <article key={t.id} data-trip={t.id} className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
        <p className="font-semibold">🏥 {t.plan?.route_label}</p><p className="text-sm">{dateTime(t.plan?.pickup_at)}</p>
        <OdometerForm quick trip={t} trips={workspace.trips} busy={busy} onSave={onOdometer} />
      </article>)}
    </section>}
    {later.length > 0 && <section aria-label="เที่ยวถัดไป" className="space-y-3">
      <h3 className="font-bold">เที่ยวถัดไป ({later.length})</h3>
      {later.map(t => <DriverCard key={t.id} upcoming trip={t} bookings={workspace.bookings} busy={busy} />)}
    </section>}
    {recorded.length > 0 && <details className="rounded-xl border border-slate-200 bg-white p-3"><summary className="min-h-11 cursor-pointer font-semibold">แก้เลขไมล์เที่ยวที่จบแล้ว (30 วันล่าสุด)</summary>
      {recorded.map(t => <article key={t.id} className="my-3 border-t p-3"><p>{t.plan?.route_label} · {dateTime(t.plan?.pickup_at)}</p><OdometerForm trip={t} trips={workspace.trips} busy={busy} onSave={onOdometer} /></article>)}
    </details>}
  </div>
}

// หนังสือนำส่งถึงกองทุน 1 ฉบับต่อเที่ยว — เลขที่/วันที่มาจากทะเบียนหนังสือส่งของสารบรรณ ระบบออกเลขเองไม่ได้
// พิมพ์ได้ก่อนมีเลข (ช่อง "ที่" เว้นเส้นประให้เขียนมือ) เพราะบางแห่งลงเลขหลังผู้บริหารลงนาม
export function TripFundDocs({ trip, busy, onRecordLetter, onPrintLetter }) {
  const edit = useTripDraft(trip, { letterNo: trip.forward_letter_no || '', letterDate: trip.forward_letter_date || thaiDay() })
  const { letterNo, letterDate } = edit.values
  const [open, setOpen] = useState(false)
  return <div className="mt-4 rounded-xl border border-slate-200 p-3">
    <p className="font-semibold">เอกสารส่งกองทุน</p><p className="text-sm text-slate-600">หนังสือนำส่ง 1 ใบ พร้อมใบคำขอรับสวัสดิการคนละ 1 ใบ · ผู้ป่วย 1 คนได้ครบ 2 ใบ</p>
    {trip.forward_letter_no && !open
      ? <p className="text-sm">ที่ {trip.forward_letter_no} ลงวันที่ {thaiDateFromDateInput(trip.forward_letter_date)}</p>
      : <p className="text-sm text-slate-600">ยังไม่ได้บันทึกเลขที่หนังสือ พิมพ์ได้ก่อนแล้วเขียนเลขด้วยมือ</p>}
    {open && <form className="mt-3 grid gap-3 sm:grid-cols-[1fr_180px_auto]" onSubmit={async e => { e.preventDefault(); if (!edit.conflict && await onRecordLetter(edit.snapshot, letterNo, letterDate)) { edit.reset(); setOpen(false) } }}>
      <label>เลขที่หนังสือ<input className={inputClass} required maxLength={60} value={letterNo} onChange={e => edit.change("letterNo", e.target.value)} placeholder="เช่น พร 72301/123" /></label>
      <label>ลงวันที่<input className={inputClass} type="date" required value={letterDate} onChange={e => edit.change("letterDate", e.target.value)} /></label>
      <DraftConflict edit={edit} busy={busy} latest={`เลขหนังสือ ${trip.forward_letter_no || "—"} · ${trip.forward_letter_date || "—"}`} /><button className={`${primaryClass} self-end`} disabled={busy || edit.conflict}>บันทึกเลขหนังสือ</button>
    </form>}
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" className={buttonClass} disabled={busy} onClick={() => onPrintLetter(trip)}>พิมพ์หนังสือนำส่ง + ใบคำขอรับสวัสดิการ</button>
      {!open && <button type="button" className={buttonClass} disabled={busy} onClick={() => setOpen(true)}>{trip.forward_letter_no ? 'แก้เลขหนังสือ' : 'กรอกเลขหนังสือ'}</button>}
    </div>
  </div>
}

// เลขไมล์ต่อเที่ยว — ระบบเติมเลขไมล์ออกจากเลขไมล์กลับของเที่ยวก่อนหน้าให้เอง คนขับกรอกแค่ตอนกลับ
// ไม่บังคับก่อนจบเที่ยว เจ้าหน้าที่จัดคิวแก้แทนได้ภายหลัง (ไม่เพิ่มขั้นตอนบังคับให้คนขับ)
// Freeze the revision with the user's draft. Polling must never bless old inputs with a new revision.
function useTripDraft(trip, latest) {
  const [draft, setDraft] = useState(null)
  const conflict = !!draft && draft.revision !== trip.docs_revision
  return { values: draft?.values || latest, conflict,
    snapshot: { ...trip, docs_revision: draft?.revision ?? trip.docs_revision },
    change: (key, value) => setDraft(d => ({ revision: d?.revision ?? trip.docs_revision, values: { ...(d?.values || latest), [key]: value } })),
    reset: () => setDraft(null),
    accept: () => setDraft(d => d ? { ...d, revision: trip.docs_revision } : d),
  }
}
function DraftConflict({ edit, busy, latest }) {
  if (!edit.conflict) return null
  return <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 sm:col-span-full">
    <p className="font-semibold">มีข้อมูลใหม่ระหว่างที่คุณกรอก</p><p>ค่าล่าสุด: {latest}</p><p>ค่าที่คุณกรอกยังอยู่ในช่องด้านบน กรุณาตรวจเทียบก่อนบันทึก</p>
    <div className="mt-2 flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={busy} onClick={edit.reset}>ใช้ค่าล่าสุด</button><button type="button" className={buttonClass} disabled={busy} onClick={edit.accept}>ยืนยันใช้ค่าที่ฉันแก้</button></div>
  </div>
}
// quick: หน้าคนขับหลังจบงาน — ถามแค่เลขไมล์กลับช่องเดียว เลขไมล์ออกที่ระบบเติมให้แสดงเป็นตัวหนังสือ (กด "แก้" ได้)
// ช่อง "มาตรวัดมีปัญหา" ขึ้นเมื่อระยะผิดปกติหรือกดแก้เท่านั้น ของเดิมวาง 2 ช่อง + ช่องติ๊กค้างบนการ์ดทุกเที่ยว
export function OdometerForm({ trip, trips, busy, onSave, quick }) {
  const edit = useTripDraft(trip, { start: trip.odometer_start ?? previousOdometer(trip, trips), end: trip.odometer_end ?? '', issue: trip.odometer_issue || false, reason: '' })
  const [full, setFull] = useState(false)
  const { start, end, issue, reason } = edit.values
  const distance = start !== '' && end !== '' ? Number(end) - Number(start) : null
  const abnormal = distance !== null && (distance < 0 || distance > 2000)
  const correction = (trip.odometer_start != null && Number(start) !== trip.odometer_start) || (trip.odometer_end != null && (end === '' || Number(end) !== trip.odometer_end)) || trip.odometer_issue
  const needsReason = correction || issue
  const compact = quick && !full && start !== '' && start != null && !needsReason
  return <form className={`mt-3 grid gap-3 rounded-xl bg-slate-50 p-3 ${compact ? 'sm:grid-cols-[1fr_auto]' : 'sm:grid-cols-[1fr_1fr_auto]'}`} onSubmit={async e => { e.preventDefault(); if (!edit.conflict && await onSave(edit.snapshot, start === '' ? null : Number(start), end === '' ? null : Number(end), issue, reason)) edit.reset() }}>
    {compact
      ? <p className="sm:col-span-full">เลขไมล์ออก <strong>{start}</strong> ({trip.odometer_start != null ? 'บันทึกไว้แล้ว' : 'ต่อจากเที่ยวก่อน'}) <button type="button" className="ml-1 min-h-11 font-semibold text-sky-800 underline" onClick={() => setFull(true)}>แก้</button></p>
      : <label>เลขไมล์ออก<input className={inputClass} name="odometer_start" type="number" inputMode="numeric" min={0} max={2147483647} required={!issue} value={start} onChange={e => edit.change('start', e.target.value)} /></label>}
    <label>เลขไมล์กลับ<input className={inputClass} name="odometer_end" type="number" inputMode="numeric" min={0} max={2147483647} value={end} onChange={e => edit.change('end', e.target.value)} placeholder="กรอกเมื่อกลับถึงพื้นที่" /></label>
    <button className={`${compact ? primaryClass : buttonClass} self-end`} disabled={busy || edit.conflict || (abnormal && !issue)}>{compact ? 'บันทึกเลขไมล์กลับ' : 'บันทึกเลขไมล์'}</button>
    {(!compact || abnormal) && <label className="flex min-h-11 items-center gap-2 sm:col-span-full"><input className="size-5" type="checkbox" checked={issue} onChange={e => edit.change('issue', e.target.checked)} />มาตรวัดมีปัญหา / ระยะทางรอตรวจสอบ</label>}
    {needsReason && <label className="sm:col-span-full">เหตุผลที่แก้เลขไมล์<select aria-label="เหตุผลที่แก้เลขไมล์" className={inputClass} required value={reason} onChange={e => edit.change('reason', e.target.value)}><option value="">เลือกเหตุผล</option>{['กรอกผิด', 'ตรวจเลขจากมาตรวัดแล้ว', 'เปลี่ยนมาตรวัด', 'มาตรวัดมีปัญหา', 'ตรวจสอบแก้ไขแล้ว'].map(r => <option key={r}>{r}</option>)}</select></label>}
    {(issue || abnormal) ? <p className="text-sm text-amber-900 sm:col-span-full">{issue ? 'บันทึกได้ ระยะทางรอตรวจสอบและยังไม่นับในยอดรวม' : 'เลขไมล์ผิดปกติ หากมาตรวัดมีปัญหาให้เลือกช่องด้านบนและระบุเหตุผล'}</p> : distance !== null && <p className="text-sm sm:col-span-full">ระยะทาง {distance} กม.</p>}
    {trip.odometer_note && <p className="text-sm sm:col-span-full">เหตุผลที่บันทึกไว้: {trip.odometer_note}</p>}
    {quick && <p className="text-sm text-slate-600 sm:col-span-full">ใส่ทีหลังได้ · เที่ยวนี้จะรออยู่ตรงนี้จนกว่าจะใส่เลขไมล์กลับ</p>}
    <DraftConflict edit={edit} busy={busy} latest={`เลขไมล์ออก ${trip.odometer_start ?? '—'} · กลับ ${trip.odometer_end ?? '—'}${trip.odometer_issue ? ' · รอตรวจสอบ' : ''}`} />
  </form>
}

// สรุปรายเดือนไว้แนบเบิกกับกองทุน — จำนวนผู้เดินทางเท่านั้น ไม่มีชื่อ
function MonthReport({ busy, onPrint }) {
  const [month, setMonth] = useState(thaiDay().slice(0, 7))
  return <form className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 p-3" onSubmit={e => { e.preventDefault(); onPrint(`${month}-01`) }}>
    <label className="min-w-0">สรุปการใช้รถประจำเดือน<input className={inputClass} type="month" required value={month} onChange={e => setMonth(e.target.value)} /></label>
    <button className={primaryClass} disabled={busy || !month}>พิมพ์สรุปรายเดือน</button>
  </form>
}
