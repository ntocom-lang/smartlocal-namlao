import { useState } from 'react'
import { thaiDateFromDateInput } from '../../lib/thaiDate'
import { BOOKING_STATUS, TRIP_STATUS, RETURN_MODES, MOBILITY, suggestGroups, dateTime, thaiDay, bangkokISO, buttonClass, primaryClass, inputClass, nextTripAction, nextPassengerAction, previousOdometer, bookingPlanGuidance } from '../../lib/patientBooking'

export function BookingCards({ bookings, trips, onAction, busy }) {
  if (!bookings.length) return <p className="py-8 text-slate-600">ยังไม่มีการจอง</p>
  return <div className="space-y-4">{bookings.map(b => {
    const trip = b.status === 'cancelled' ? null : trips.find(t => t.id === b.trip_id)
    return <article key={b.id} className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">รหัส {b.id.slice(0, 8)}</p><h3 className="font-bold">{b.patient_name} · {BOOKING_STATUS[b.status]}</h3>
      <p>{b.route_label} · นัด {dateTime(b.appointment_at)}</p>
      {b.requested_trip_id && b.status === 'submitted' && <p className="font-semibold text-sky-800">ขอร่วมเที่ยว รอเจ้าหน้าที่ตรวจยืนยัน</p>}
      <p>{RETURN_MODES[b.return_mode]} · {MOBILITY[b.mobility]}</p>
      {trip && <div className="my-3 rounded-xl bg-sky-50 p-3"><strong>{TRIP_STATUS[trip.state]}</strong><p>เริ่มรับโดยประมาณ {dateTime(trip.plan.pickup_at)}</p>{trip.public_notice === 'delayed' && <p className="font-semibold text-amber-800">รถล่าช้า · กรุณาตรวจเวลาล่าสุด</p>}{trip.public_notice === 'contact' && <p className="font-semibold text-amber-800">กรุณาติดต่อเจ้าหน้าที่ก่อนเดินทาง</p>}{trip.estimated_pickup_at && <p>แจ้งเริ่มรับล่าสุด {dateTime(trip.estimated_pickup_at)} (ประมาณการ)</p>}{trip.estimated_return_at && <p>แจ้งรับกลับล่าสุด {dateTime(trip.estimated_return_at)} (ประมาณการ)</p>}<p className="text-sm">เจ้าหน้าที่ประสานเวลารับแต่ละจุดตามแผน</p></div>}
      {b.cancel_requested && <p className="my-2 rounded-xl bg-amber-50 p-3">ขอยกเลิกแล้ว รอเจ้าหน้าที่ประสานก่อนเปลี่ยนเที่ยว</p>}
      {b.return_ready && <p className="my-2 rounded-xl bg-sky-50 p-3">แจ้งพร้อมกลับแล้ว ไม่ได้หมายความว่ารถจะมาถึงทันที</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {b.status === 'confirmed' && b.passenger_step === 2 && b.return_mode !== 'one_way' && !b.return_ready && <button className={buttonClass} disabled={busy} onClick={() => onAction(b, 'ready_return')}>พร้อมให้มารับกลับ</button>}
        {['submitted', 'confirmed'].includes(b.status) && !b.cancel_requested && <button className={buttonClass} disabled={busy} onClick={() => onAction(b, 'cancel')}>{b.status === 'submitted' ? 'ยกเลิกคำขอ' : 'ขอประสานยกเลิก'}</button>}
      </div>
    </article>
  })}</div>
}

export function CoordinatorQueue({ workspace, onPreview, onConfirm, onAction, onAmend, onRecordLetter, onPrintLetter, onOdometer, onMonthReport, busy, preview, clearPreview }) {
  const [tab, setTab] = useState('pending')
  const [helper, setHelper] = useState('')
  const [selected, setSelected] = useState([])
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState(null)
  const groups = [...workspace.bookings.filter(b => b.status === 'submitted' && b.requested_trip_id).map(b => [b]), ...suggestGroups(workspace.bookings.filter(b => !b.requested_trip_id), workspace.settings)]
  async function inspect(ids) { setSelected(ids); clearPreview(); await onPreview(ids, helper) }
  return <div className="space-y-4">
    <h2 className="text-xl font-bold">ระบบเตรียมแผน เจ้าหน้าที่ตรวจยืนยัน</h2>
    <div className="flex flex-wrap gap-2">{[['pending', `รอจัดคิว (${groups.length} แผน)`], ['trips', 'เที่ยวที่ยืนยันแล้ว'], ['report', 'รายงานและประวัติ']].map(([id, label]) => <button key={id} className={tab === id ? primaryClass : buttonClass} onClick={() => setTab(id)}>{label}</button>)}</div>
    {tab === 'pending' && <>
      <label className="block">เหตุผลที่ผู้จองแจ้งยกเลิก (ใช้เมื่อยกเลิกแทน)<input className={inputClass} value={note} maxLength={500} onChange={e => setNote(e.target.value)} /></label>
      {editing && <AmendBooking key={editing.id} booking={editing} routes={workspace.settings?.routes || []} busy={busy} onBack={() => setEditing(null)} onSave={async (values, reason) => { if (await onAmend(editing, values, reason)) setEditing(null) }} />}
      <label className="block">ผู้ช่วยเคลื่อนย้ายที่พร้อมประจำเที่ยว (เฉพาะรถเข็น/เปล)<input className={inputClass} value={helper} maxLength={200} onChange={e => { setHelper(e.target.value); clearPreview() }} placeholder="ระบุชื่อเมื่อยืนยันผู้ช่วยแล้ว" /></label>
      {preview && <section className="rounded-2xl border-2 border-sky-700 bg-sky-50 p-4" aria-live="polite">
        {preview.join_trip_id && <p className="mb-2 font-semibold">เพิ่มในเที่ยวเดิม: ประสานเวลารับใหม่กับผู้เดินทางเดิมก่อนยืนยัน ระบบจะแจ้งแผนล่าสุดให้ทุกคน</p>}
        <h3 className="font-bold">ผลตรวจจากระบบ · {preview.booking_ids.length} ผู้เดินทาง</h3><p>{preview.route_label} · {RETURN_MODES[preview.return_mode]}</p><p>เริ่มรับ {dateTime(preview.pickup_at)}</p>
        {preview.blocks.map((b, i) => <p key={i}>กันรถ {dateTime(b.start)} – {dateTime(b.end)}</p>)}
        {preview.errors.length ? <div className="my-3 space-y-3"><p className="font-semibold text-red-800">ยังยืนยันไม่ได้ · แก้รายการด้านล่างแล้วกดตรวจแผนอีกครั้ง</p><ul className="space-y-3">{preview.errors.map(e => {
          const issue = bookingPlanGuidance(e, preview, workspace)
          return <li key={e} className="rounded-xl border border-red-200 bg-white p-3 [overflow-wrap:anywhere]"><p className="font-semibold text-red-800">{issue.message}</p>{issue.detail && <p className="mt-1 text-sm text-slate-800">{issue.detail}</p>}<p className="mt-2 text-sm text-slate-800"><strong>วิธีแก้: </strong>{issue.advice}</p></li>
        })}</ul></div> : <p className="my-3">ไม่พบคิวทับซ้อน กรุณาตรวจจุดรับและความเหมาะสมก่อนยืนยัน</p>}
        <button className={primaryClass} disabled={busy || preview.errors.length > 0} onClick={() => onConfirm(selected, preview, helper)}>ตรวจแล้ว ยืนยันเที่ยวนี้</button>
      </section>}
      {!groups.length && <p className="py-6 text-slate-500">ไม่มีคำขอรอจัดคิว</p>}
      {groups.map(g => <article key={g[0].id} className="rounded-2xl border border-slate-200 p-4"><h3 className="font-bold">{g[0].requested_trip_id ? 'ขอร่วมเที่ยวที่ยืนยันแล้ว' : g.length > 1 ? 'เสนอร่วมเที่ยว' : 'เที่ยวเดี่ยว'} · {g[0].route_label}</h3>
        {g.map(b => <div key={b.id} className="border-b border-slate-100 py-3"><strong>{b.patient_name}</strong><p>{dateTime(b.appointment_at)} · {b.pickup}</p><p className="text-sm text-slate-600">{MOBILITY[b.mobility]} · ผู้ติดตาม {b.companions} คน · กลับ {dateTime(b.return_at)}</p>
          <div className="mt-2 flex flex-wrap gap-2">{g.length > 1 && <button className={buttonClass} disabled={busy} onClick={() => inspect([b.id])}>ตรวจเป็นเที่ยวเดี่ยว</button>}<button className={buttonClass} disabled={busy} onClick={() => { setEditing(b); clearPreview() }}>แก้ข้อมูลหลังประสาน</button><button className={buttonClass} disabled={busy || !note.trim()} onClick={() => onAction(b, 'cancel', note)}>ยกเลิกตามคำขอผู้จอง</button></div>
        </div>)}<button className={`${primaryClass} mt-3`} disabled={busy} onClick={() => inspect(g.map(b => b.id))}>ตรวจแผนและเวลาว่าง</button>
      </article>)}
    </>}
    {tab === 'trips' && <><label className="block">เหตุผลประสาน/แก้ไขเที่ยว<input className={inputClass} value={note} maxLength={500} onChange={e => setNote(e.target.value)} /></label>
      {workspace.trips.map(t => <article key={t.id} className="rounded-2xl border border-slate-200 p-4"><h3 className="font-bold">{TRIP_STATUS[t.state]} · {t.plan.route_label}</h3><p>เริ่มรับ {dateTime(t.plan.pickup_at)} · {RETURN_MODES[t.plan.return_mode]}</p>
        {workspace.bookings.filter(b => b.trip_id === t.id).map(b => <div key={b.id} className="my-2"><p>{b.patient_name} · {BOOKING_STATUS[b.status]} {b.cancel_requested && '· ขอยกเลิก'} {b.return_ready && '· พร้อมกลับ'}</p>{b.status === 'confirmed' && [0, 2].includes(b.passenger_step) && <button className={buttonClass} disabled={busy || !note.trim()} onClick={() => onAction(b, 'cancel_passenger', note)}>ประสานแผนดูแลต่อแล้ว นำรายนี้ออกจากเที่ยว</button>}</div>)}
        {t.issue_note && <p className="my-2 rounded-xl bg-amber-50 p-3">{t.issue_note}</p>}
        <div className="mt-3 flex flex-wrap gap-2">{t.state === 'issue' && <button className={primaryClass} disabled={busy || !note.trim()} onClick={() => onAction(t, 'resolve', note)}>ประสานแก้ไขแล้ว กลับดำเนินงาน</button>}
          {(t.state === 'confirmed' || (t.state === 'issue' && t.state_before_issue === 'confirmed')) && <button className={buttonClass} disabled={busy || !note.trim()} onClick={() => onAction(t, 'release', note)}>คืนคิวเพื่อจัดแผนใหม่</button>}
        </div>
        {t.state !== 'cancelled' && <TripFundDocs trip={t} busy={busy} onRecordLetter={onRecordLetter} onPrintLetter={onPrintLetter} />}
        {t.state !== 'cancelled' && <OdometerForm trip={t} trips={workspace.trips} busy={busy} onSave={onOdometer} />}
      </article>)}
    </>}
    {tab === 'report' && <><MonthReport busy={busy} onPrint={onMonthReport} /><p>จบแล้ว {workspace.trips.filter(t => t.state === 'completed').length} เที่ยว · รอดำเนินการ {workspace.trips.filter(t => !['completed', 'cancelled'].includes(t.state)).length} เที่ยว (เที่ยวปิดใน 30 วันล่าสุด)</p>
      {workspace.events.map((e, i) => <div key={`${e.created_at}-${i}`} className="border-b border-slate-200 py-3"><strong>{e.action}</strong> · {dateTime(e.created_at)}<p className="text-sm">{e.detail?.note || `รายการ ${e.entity_id.slice(0, 8)}`}</p></div>)}
    </>}
  </div>
}

function AmendBooking({ booking, routes, busy, onBack, onSave }) {
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
    <div className="flex flex-wrap gap-2"><button className={primaryClass} disabled={busy}>ยืนยันข้อมูลที่ประสานแล้ว</button><button type="button" className={buttonClass} onClick={onBack} disabled={busy}>ปิด</button></div>
  </form>
}

export function DriverTrips({ workspace, uid, onAction, onOdometer, busy }) {
  const [note, setNote] = useState('')
  const trips = workspace.trips.filter(t => t.driver_id === uid && !['completed', 'cancelled'].includes(t.state))
  // จบเที่ยวแล้วแต่ยังไม่มีเลขไมล์กลับ — เดิมหายจากหน้าคนขับทันทีที่กดจบ ต้องให้เจ้าหน้าที่กรอกแทน (ผลตรวจ #227 ข้อ 4)
  const awaitingOdometer = workspace.trips.filter(t => t.driver_id === uid && t.state === 'completed' && (!Number.isFinite(t.odometer_end) || t.odometer_issue))
  return <div className="space-y-4"><h2 className="text-xl font-bold">เที่ยวของคนขับ</h2><p className="rounded-xl bg-amber-50 p-3">กดบันทึกเมื่อจอดรถในที่ปลอดภัย</p>
    {!trips.length && <p>ยังไม่มีเที่ยวที่ได้รับมอบหมาย</p>}
    <label className="block">เหตุขัดข้อง/ล่าช้า<input className={inputClass} value={note} maxLength={500} onChange={e => setNote(e.target.value)} /></label>
    {trips.map(t => <article key={t.id} className="rounded-2xl border border-slate-200 p-4"><h3 className="font-bold">{TRIP_STATUS[t.state]} · {t.plan.route_label}</h3><p>เริ่มรับ {dateTime(t.plan.pickup_at)}</p><p>{RETURN_MODES[t.plan.return_mode]}</p>
      {t.helper_name && <p>ผู้ช่วยประจำเที่ยว: {t.helper_name}</p>}
      {workspace.bookings.filter(b => b.trip_id === t.id && b.status !== 'cancelled').map(b => <div key={b.id} className="my-3 rounded-xl bg-slate-50 p-3"><strong>{b.patient_name}</strong><p>{b.pickup}</p><p>{MOBILITY[b.mobility]} · ผู้ติดตาม {b.companions} คน</p><a href={`tel:${b.phone}`} className="inline-flex min-h-11 items-center font-semibold text-sky-800 underline">โทรติดต่อผู้จอง</a>{b.pickup_lat != null && <a href={`https://www.google.com/maps/dir/?api=1&destination=${b.pickup_lat},${b.pickup_lng}`} target="_blank" rel="noopener noreferrer" className="ml-4 inline-flex min-h-11 items-center font-semibold text-sky-800 underline">นำทางไปจุดรับ</a>}
        {b.return_ready && <p>แจ้งพร้อมกลับแล้ว</p>}{b.cancel_requested && <p className="text-amber-800">ขอยกเลิก ให้เจ้าหน้าที่ประสานก่อนเปลี่ยนเที่ยว</p>}
        {nextPassengerAction(b, t) && <button className={`${buttonClass} mt-2 block w-full`} disabled={busy} onClick={() => onAction(b, 'passenger_next')}>{nextPassengerAction(b, t)}</button>}
      </div>)}
      {nextTripAction(t) && <button className={`${primaryClass} w-full`} disabled={busy} onClick={() => onAction(t, 'trip_next')}>{nextTripAction(t)}</button>}
      {t.state !== 'issue' && <button className={`${buttonClass} mt-3 w-full`} disabled={busy || !note.trim()} onClick={() => onAction(t, 'issue', note)}>แจ้งเหตุขัดข้องให้เจ้าหน้าที่</button>}
      {t.state === 'issue' && <p className="rounded-xl bg-amber-50 p-3">รอเจ้าหน้าที่ประสานแผน ก่อนดำเนินการต่อ</p>}
      <OdometerForm trip={t} trips={workspace.trips} busy={busy} onSave={onOdometer} />
    </article>)}
    <details className="rounded-xl border border-slate-200 p-3"><summary className="min-h-11 cursor-pointer font-semibold">แก้เลขไมล์เที่ยวที่จบแล้ว (30 วันล่าสุด)</summary>{workspace.trips.filter(t => t.driver_id === uid && t.state === 'completed' && Number.isFinite(t.odometer_end) && !t.odometer_issue).map(t => <article key={t.id} className="my-3 border-t p-3"><p>{t.plan.route_label} · {dateTime(t.plan.pickup_at)}</p><OdometerForm trip={t} trips={workspace.trips} busy={busy} onSave={onOdometer} /></article>)}</details>
    {awaitingOdometer.length > 0 && <section className="space-y-3" aria-label="จบแล้ว รอเติมเลขไมล์">
      <h3 className="font-bold">จบแล้ว รอเติมเลขไมล์ ({awaitingOdometer.length})</h3>
      {awaitingOdometer.map(t => <article key={t.id} className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="font-semibold">{t.plan.route_label}</p><p>เริ่มรับ {dateTime(t.plan.pickup_at)}</p>
        <OdometerForm trip={t} trips={workspace.trips} busy={busy} onSave={onOdometer} /></article>)}
    </section>}
  </div>
}

// หนังสือนำส่งถึงกองทุน 1 ฉบับต่อเที่ยว — เลขที่/วันที่มาจากทะเบียนหนังสือส่งของสารบรรณ ระบบออกเลขเองไม่ได้
// พิมพ์ได้ก่อนมีเลข (ช่อง "ที่" เว้นเส้นประให้เขียนมือ) เพราะบางแห่งลงเลขหลังผู้บริหารลงนาม
function TripFundDocs({ trip, busy, onRecordLetter, onPrintLetter }) {
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
  return <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 sm:col-span-3">
    <p className="font-semibold">มีข้อมูลใหม่ระหว่างที่คุณกรอก</p><p>ค่าล่าสุด: {latest}</p><p>ค่าที่คุณกรอกยังอยู่ในช่องด้านบน กรุณาตรวจเทียบก่อนบันทึก</p>
    <div className="mt-2 flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={busy} onClick={edit.reset}>ใช้ค่าล่าสุด</button><button type="button" className={buttonClass} disabled={busy} onClick={edit.accept}>ยืนยันใช้ค่าที่ฉันแก้</button></div>
  </div>
}
function OdometerForm({ trip, trips, busy, onSave }) {
  const edit = useTripDraft(trip, { start: trip.odometer_start ?? previousOdometer(trip, trips), end: trip.odometer_end ?? '', issue: trip.odometer_issue || false, reason: '' })
  const { start, end, issue, reason } = edit.values
  const distance = start !== '' && end !== '' ? Number(end) - Number(start) : null
  const abnormal = distance !== null && (distance < 0 || distance > 2000)
  const correction = (trip.odometer_start != null && Number(start) !== trip.odometer_start) || (trip.odometer_end != null && (end === '' || Number(end) !== trip.odometer_end)) || trip.odometer_issue
  const needsReason = correction || issue
  return <form className="mt-3 grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={async e => { e.preventDefault(); if (!edit.conflict && await onSave(edit.snapshot, start === '' ? null : Number(start), end === '' ? null : Number(end), issue, reason)) edit.reset() }}>
    <label>เลขไมล์ออก<input className={inputClass} name="odometer_start" type="number" inputMode="numeric" min={0} max={2147483647} required={!issue} value={start} onChange={e => edit.change('start', e.target.value)} /></label>
    <label>เลขไมล์กลับ<input className={inputClass} name="odometer_end" type="number" inputMode="numeric" min={0} max={2147483647} value={end} onChange={e => edit.change('end', e.target.value)} placeholder="กรอกเมื่อกลับถึงพื้นที่" /></label>
    <button className={`${buttonClass} self-end`} disabled={busy || edit.conflict || (abnormal && !issue)}>บันทึกเลขไมล์</button>
    <label className="flex min-h-11 items-center gap-2 sm:col-span-3"><input className="size-5" type="checkbox" checked={issue} onChange={e => edit.change('issue', e.target.checked)} />มาตรวัดมีปัญหา / ระยะทางรอตรวจสอบ</label>
    {needsReason && <label className="sm:col-span-3">เหตุผลที่แก้เลขไมล์<select aria-label="เหตุผลที่แก้เลขไมล์" className={inputClass} required value={reason} onChange={e => edit.change('reason', e.target.value)}><option value="">เลือกเหตุผล</option>{['กรอกผิด', 'ตรวจเลขจากมาตรวัดแล้ว', 'เปลี่ยนมาตรวัด', 'มาตรวัดมีปัญหา', 'ตรวจสอบแก้ไขแล้ว'].map(r => <option key={r}>{r}</option>)}</select></label>}
    {(issue || abnormal) ? <p className="text-sm text-amber-900 sm:col-span-3">{issue ? 'บันทึกได้ ระยะทางรอตรวจสอบและยังไม่นับในยอดรวม' : 'เลขไมล์ผิดปกติ หากมาตรวัดมีปัญหาให้เลือกช่องด้านบนและระบุเหตุผล'}</p> : distance !== null && <p className="text-sm sm:col-span-3">ระยะทาง {distance} กม.</p>}
    {trip.odometer_note && <p className="text-sm sm:col-span-3">เหตุผลที่บันทึกไว้: {trip.odometer_note}</p>}
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
