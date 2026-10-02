import { useEffect, useState } from 'react'
import ReportInfographic from './ReportInfographic'
import { Printer } from 'lucide-react'
import { ListCard, Pills, Sheet } from './StaffShell'
import { thaiDateFromDateInput } from '../../lib/thaiDate'
import { useTenant } from '../../contexts/TenantContext'
import { supabase } from '../../lib/supabase'
import { BOOKING_STATUS, BOOKING_STEPS, TRIP_STATUS, RETURN_MODES, MOBILITY, DRIVER_STEPS, bookingStep, driverProgress, driverNext, dateTime, clockOf, whenLabel, thaiDay, bangkokISO, buttonClass, primaryClass, inputClass, previousOdometer, pickupForBooking, returnForBooking, reportEvent } from '../../lib/patientBooking'

// ป้ายสถานะสีแบบเดียวกับการ์ดในแท็บ "การใช้รถ" ของยานพาหนะ — ผู้จองต้องเห็นสถานะก่อนอ่านรายละเอียด
const BOOKING_CHIP = { submitted: 'bg-amber-100 text-amber-900', confirmed: 'bg-sky-100 text-sky-900', completed: 'bg-emerald-100 text-emerald-900', cancelled: 'bg-slate-200 text-slate-700' }

// The citizen only receives their own bookings and a cancellation reason, not staff events.
// Link a closed duplicate only when one live booking matches the recorded reason.
function linkedConfirmedBooking(booking, allBookings = []) {
  if (booking.status !== 'cancelled') return null
  if (!booking.cancel_note?.startsWith('คำขอนี้ซ้ำกับคิวที่ยืนยันแล้ว')) return null
  const matches = allBookings.filter(item => item.id !== booking.id && ['confirmed', 'completed'].includes(item.status) && item.patient_name === booking.patient_name &&
    item.phone === booking.phone && item.route_id === booking.route_id && item.created_by === booking.created_by)
  return matches.length === 1 ? matches[0] : null
}

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

export function BookingCards({ bookings, allBookings = bookings, trips, onAction, busy }) {
  if (!bookings.length) return <p className="rounded-xl border border-slate-200 p-4 text-slate-600">ยังไม่มีการจอง</p>
  return <div className="space-y-4">{bookings.map(b => {
    const trip = b.status === 'cancelled' ? null : trips.find(t => t.id === b.trip_id)
    const step = bookingStep(b, trip)
    const linked = linkedConfirmedBooking(b, allBookings)
    return <article key={b.id} className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-1 flex flex-wrap items-center gap-2"><h3 className="font-bold">{b.patient_name}</h3><span className={`rounded-full px-3 py-1 text-xs font-bold ${BOOKING_CHIP[b.status] || 'bg-slate-100'}`}>{BOOKING_STATUS[b.status]}</span></div>
      {linked ? <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
        <p className="font-bold text-sky-950">คิวที่ใช้เดินทาง: นัด {dateTime(linked.appointment_at)} · เลขที่ {linked.id.slice(0, 8).toUpperCase()}</p>
        <p className="text-sm text-slate-700">{linked.route_label || b.route_label} · {BOOKING_STATUS[linked.status]}</p>
        <p className="text-sm text-slate-600">คำขอนี้ปิดเป็นคิวซ้ำ · นัดเดิม {dateTime(b.appointment_at)}</p>
      </div> : <p>{b.route_label} · {b.status === 'cancelled' ? 'นัดเดิม (ยกเลิก)' : 'นัด'} {dateTime(b.appointment_at)}</p>}
      <p className="text-xs text-slate-500">เลขที่คำขอ {b.id.slice(0, 8).toUpperCase()}</p>
      {step > 0 && <StepBar step={step} />}
      {/* บรรทัดเดียวที่บอกว่า "ตอนนี้ถึงไหนและต้องรออะไร" — ของเดิมให้ผู้จองอ่านสถานะเที่ยวเอาความหมายเอง */}
      {step === 1 && <p className="rounded-xl bg-amber-50 p-3">รอเจ้าหน้าที่ยืนยันรถ · ยังไม่ได้กันที่นั่งให้</p>}
      {step === 4 && <p className="rounded-xl bg-emerald-50 p-3">เดินทางเสร็จแล้ว ขอบคุณที่ใช้บริการ</p>}
      {b.requested_trip_id && b.status === 'submitted' && <p className="font-semibold text-sky-800">ขอร่วมเที่ยว รอเจ้าหน้าที่ตรวจยืนยัน</p>}
      {trip && <div className="my-3 rounded-xl bg-sky-50 p-3"><strong>{TRIP_STATUS[trip.state]}</strong><p>รถจะมารับคุณประมาณ {dateTime(pickupForBooking(trip, b))}</p>{trip.public_notice === 'delayed' && <p className="font-semibold text-amber-800">รถล่าช้า · กรุณาตรวจเวลาล่าสุด</p>}{trip.public_notice === 'contact' && <p className="font-semibold text-amber-800">กรุณาติดต่อเจ้าหน้าที่ก่อนเดินทาง</p>}{b.return_mode !== 'one_way' && <p>รับกลับประมาณ {dateTime(returnForBooking(trip, b))} (อาจปรับตามเวลาจริง)</p>}<p className="text-sm">{RETURN_MODES[b.return_mode]} · {MOBILITY[b.mobility]}{b.companions ? ` · ผู้ติดตาม ${b.companions} คน` : ''}</p></div>}
      {/* เหตุผลที่เจ้าหน้าที่บันทึกตอนกดยกเลิก — ของเดิมขึ้นแค่ป้าย “ยกเลิกแล้ว” ผู้จองต้องโทรถามเองว่าทำไมไม่ได้รถ
          ฐานข้อมูลส่ง cancel_note มาเฉพาะคำขอที่ถูกยกเลิกและมีเหตุผลที่เจ้าหน้าที่เขียนไว้ (20260922130000) */}
      {b.status === 'cancelled' && b.cancel_note && <p className="my-2 rounded-xl bg-amber-50 p-3"><strong>เจ้าหน้าที่แจ้งเหตุผลที่ยกเลิก</strong><br />{b.cancel_note}</p>}
      {b.cancel_requested && <p className="my-2 rounded-xl bg-amber-50 p-3">ขอยกเลิกแล้ว รอเจ้าหน้าที่ประสานก่อนเปลี่ยนเที่ยว</p>}
      {b.return_ready && <p className="my-2 rounded-xl bg-sky-50 p-3">แจ้งพร้อมกลับแล้ว ไม่ได้หมายความว่ารถจะมาถึงทันที</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {b.status === 'confirmed' && ['outbound', 'hospital'].includes(trip?.state) && b.return_mode !== 'one_way' && !b.return_ready && <button className={buttonClass} disabled={busy} onClick={() => onAction(b, 'ready_return')}>พร้อมให้มารับกลับ</button>}
        {['submitted', 'confirmed'].includes(b.status) && !b.cancel_requested && <button className={buttonClass} disabled={busy} onClick={() => onAction(b, 'cancel')}>{b.status === 'submitted' ? 'ยกเลิกคำขอ' : 'ขอประสานยกเลิก'}</button>}
      </div>
    </article>
  })}</div>
}

// สรุปเดือนที่เลือกแยกจากประวัติทุกเดือน: หนึ่งเที่ยวมีได้หลายเหตุการณ์
export function QueueReport({ workspace, busy, onMonthReport }) {
  const { tenant } = useTenant()
  const [month, setMonth] = useState(thaiDay().slice(0, 7))
  const [monthly, setMonthly] = useState(null)
  const [monthError, setMonthError] = useState('')
  const [monthRetry, setMonthRetry] = useState(0)
  const [tripPage, setTripPage] = useState(1)
  const [page, setPage] = useState(1)
  const [history, setHistory] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!tenant?.id || !month) return
    let active = true
    supabase.rpc('patient_booking_month_report', { p_muni: tenant.id, p_month: `${month}-01` }).then(({ data, error: failure }) => {
      if (!active) return
      if (failure || !data) { setMonthly(null); setMonthError('โหลดสรุปเดือนนี้ไม่สำเร็จ กรุณาลองอีกครั้ง') }
      else { setMonthly({ month, tenantId: tenant.id, trips: data.trips }); setMonthError('') }
    })
    return () => { active = false }
  }, [tenant?.id, month, workspace, monthRetry])
  useEffect(() => {
    if (!tenant?.id) return
    let active = true
    supabase.rpc('patient_booking_events_page', { p_muni: tenant.id, p_page: page }).then(({ data, error: requestError }) => {
      if (!active) return
      if (requestError || !data) { setError('โหลดประวัติไม่สำเร็จ กรุณาลองอีกครั้ง'); setHistory(null) }
      else {
        setHistory({ ...data, tenantId: tenant.id }); setError('')
        const lastPage = Math.max(1, Math.ceil(data.total / 20))
        if (page > lastPage) setPage(lastPage)
      }
      setLoading(false)
    })
    return () => { active = false }
  }, [tenant?.id, page, workspace, retry])
  const currentMonth = monthly?.month === month && monthly?.tenantId === tenant?.id
  const trips = currentMonth ? monthly.trips : []
  const monthLabel = month ? new Date(`${month}-01T00:00:00+07:00`).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', month: 'long', year: 'numeric' }) : ''
  const total = history?.tenantId === tenant?.id ? history.total : 0
  const pages = Math.max(1, Math.ceil(total / 20))
  const events = history?.tenantId === tenant?.id && history?.page === page ? history.events : []
  const changePage = next => { setLoading(true); setHistory(null); setPage(next) }
  const tripPages = Math.max(1, Math.ceil(trips.length / 20))
  const visibleTripPage = Math.min(tripPage, tripPages)
  return <section className="space-y-4" aria-label="รายงานรถรับส่งผู้ป่วย">
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-label="สรุปการใช้รถประจำเดือน">
      <h2 className="text-lg font-bold text-slate-900">สรุปการใช้รถประจำเดือน</h2>
      <p className="mb-4 text-sm text-slate-600">เลือกเดือนเพื่อดูจำนวนเที่ยว ผู้เดินทาง และระยะทาง แล้วพิมพ์สรุปได้ทันที</p>
      <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); onMonthReport(`${month}-01`) }}>
        <label className="min-w-0 flex-1 sm:max-w-xs">เดือนที่ต้องการดู<input className={inputClass} type="month" required value={month} onChange={e => { setMonth(e.target.value); setMonthly(null); setMonthError(''); setTripPage(1) }} /></label>
        <button className={`${primaryClass} max-sm:w-full`} disabled={busy || !month || !currentMonth}>พิมพ์สรุปรายเดือน</button>
      </form>
      <p className="my-4 font-semibold">{month ? `ข้อมูลเดือน${monthLabel}` : 'กรุณาเลือกเดือน'} · ตามวันเดินทาง · ไม่รวมเที่ยวที่ยกเลิก</p>
      {month && !monthError && !currentMonth && <p role="status">กำลังโหลดสรุปรายเดือน...</p>}
      {monthError && <div role="alert" className="rounded-xl bg-rose-50 p-3 text-rose-800">{monthError} <button className={buttonClass} onClick={() => { setMonthly(null); setMonthError(''); setMonthRetry(value => value + 1) }}>ลองอีกครั้ง</button></div>}
      {currentMonth && <>
        <ReportInfographic tenantName={tenant?.name} month={month} trips={trips} />
        <h3 className="mb-1 mt-5 font-bold">รายการเที่ยวเดือนนี้ · {trips.length} เที่ยว</h3>
        <p className="mb-3 text-sm text-slate-600">หนึ่งเที่ยวอาจมีผู้เดินทางหลายคน · คำขอที่ยังรอยืนยันรถยังไม่นับเป็นเที่ยว</p>
        {!trips.length && <p className="rounded-xl bg-slate-50 p-4 text-slate-600">ไม่มีเที่ยวรถในเดือนที่เลือก ลองเลือกเดือนอื่น</p>}
        <div className="space-y-3">{trips.slice((visibleTripPage - 1) * 20, visibleTripPage * 20).map(t => <article key={t.trip_id} data-report-trip className="rounded-xl border border-slate-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-bold">{thaiDateFromDateInput(t.date)} · รับประมาณ {clockOf(t.pickup_at) || 'ยังไม่ระบุ'}</h4><span className={`rounded-full px-3 py-1 text-xs font-bold ${t.state === 'completed' ? 'bg-emerald-100 text-emerald-900' : t.state === 'issue' ? 'bg-rose-100 text-rose-800' : 'bg-sky-100 text-sky-900'}`}>{TRIP_STATUS[t.state] || 'รอตรวจสถานะ'}</span></div>
          <p className="mt-1 break-words font-semibold text-sky-900">{t.route_label || 'ยังไม่ระบุโรงพยาบาล'}</p>
          <div className="mt-2 grid gap-1 text-sm sm:grid-cols-2"><p>ผู้เดินทาง {t.passengers} คน · ผู้ติดตาม {t.companions} คน</p><p>คนขับ: {t.driver_name || 'ยังไม่ระบุ'}</p><p>ระยะทาง: {t.odometer_issue ? 'มาตรวัดผิดปกติ' : t.distance == null ? 'ยังไม่บันทึกครบ' : `${t.distance.toLocaleString('th-TH')} กม.`}</p><p className="text-slate-500">เที่ยวรถเลขที่ {t.trip_id.slice(0, 8).toUpperCase()}</p></div>
        </article>)}</div>
        {tripPages > 1 && <nav aria-label="แบ่งหน้ารายการเที่ยว" className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm"><span>หน้า {visibleTripPage}/{tripPages} · ครั้งละ 20 เที่ยว</span><div className="flex gap-2"><button className={buttonClass} disabled={visibleTripPage <= 1} onClick={() => setTripPage(visibleTripPage - 1)}>ก่อนหน้า</button><button className={buttonClass} disabled={visibleTripPage >= tripPages} onClick={() => setTripPage(visibleTripPage + 1)}>ถัดไป</button></div></nav>}
      </>}
    </section>
    <details className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <summary className="min-h-11 cursor-pointer font-bold text-slate-900">ประวัติการทำรายการทุกเดือน · {total} เหตุการณ์ <span className="text-sm font-normal text-slate-500">(กดดู / ซ่อน)</span></summary>
      <p className="mb-3 text-sm text-slate-600">บันทึกสิ่งที่เกิดขึ้นกับคำขอหรือเที่ยวรถ · หนึ่งคำขอมีหลายเหตุการณ์ จำนวนนี้จึงไม่ใช่จำนวนเที่ยวหรือผู้เดินทาง</p>
      {loading && <p role="status">กำลังโหลดประวัติ...</p>}
      {error && <div role="alert" className="rounded-xl bg-rose-50 p-3 text-rose-800">{error} <button type="button" className={buttonClass} onClick={() => { setLoading(true); setRetry(value => value + 1) }}>ลองอีกครั้ง</button></div>}
      {!loading && !error && total === 0 && <p>ยังไม่มีประวัติการทำรายการ</p>}
      {!loading && !error && events.map(e => {
        const info = reportEvent(e, workspace)
        return <article key={e.id} data-report-event className="border-b border-slate-200 py-3">
          <div className="flex flex-wrap items-start justify-between gap-1"><h3 className="font-semibold text-slate-900">{info.label}</h3><time className="text-sm text-slate-500" dateTime={e.created_at}>{dateTime(e.created_at)}</time></div>
          {info.subject && <p className="mt-1 break-words text-sky-900">{info.subject}</p>}
          {info.note && <p className="mt-1 break-words text-sm">หมายเหตุ: {info.note}</p>}
          <p className="mt-1 text-xs text-slate-500">{info.reference}</p>
        </article>
      })}
      {!error && total > 0 && <nav aria-label="แบ่งหน้าประวัติ" className="flex flex-wrap items-center justify-between gap-2 pt-3 text-sm">
        <span>แสดง {(page - 1) * 20 + 1}–{Math.min(page * 20, total)} จาก {total} รายการ · หน้า {page}/{pages}</span>
        <div className="flex gap-2"><button type="button" className={buttonClass} disabled={loading || page <= 1} onClick={() => changePage(page - 1)}>ก่อนหน้า</button><button type="button" className={buttonClass} disabled={loading || page >= pages} onClick={() => changePage(page + 1)}>ถัดไป</button></div>
      </nav>}
      <p className="mt-3 text-xs text-slate-500">ประวัติเก่าอาจแสดงเฉพาะเลขอ้างอิง หากชื่อผู้เดินทางไม่อยู่ในชุดข้อมูลปัจจุบัน</p>
    </details>
  </section>
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
// bare = วางในแผ่นรายละเอียดของตารางจอ PC (แผ่นมีกรอบของตัวเองแล้ว)
function DriverCard({ trip: t, bookings, busy, upcoming, contactPhone, onAdvance, onAction, driverAssignment, canOperate = true, bare = false }) {
  const people = bookings.filter(b => b.trip_id === t.id && b.status !== 'cancelled')
  const label = driverNext(t, bookings)
  const pickupAt = t.estimated_pickup_at || t.plan?.pickup_at
  const backAt = t.estimated_return_at || t.plan?.return_at
  return <article data-trip={t.id} aria-label={`เที่ยว ${t.plan?.route_label} ${clockOf(pickupAt)} น.`} className={bare ? 'space-y-3' : `space-y-3 rounded-2xl border-2 bg-white p-4 ${upcoming ? 'border-slate-200' : 'border-sky-700'}`}>
    {/* ป้ายสถานะอยู่บรรทัดบนสุด — วางข้างหัวการ์ดแล้วจอมือถือตัดเวลาและชื่อโรงพยาบาลขึ้นบรรทัดใหม่ */}
    <div className="space-y-0.5">
      <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-bold ${t.state === 'issue' ? 'bg-red-100 text-red-800' : 'bg-sky-100 text-sky-900'}`}>{TRIP_STATUS[t.state]}</span>
      <p className="text-lg font-bold">{whenLabel(pickupAt)} · ออกรับ {clockOf(pickupAt)} น.</p>
      <p className="font-semibold">🏥 {t.plan?.route_label}</p>
      <p className="text-sm">คนขับประจำเที่ยว: <strong>{t.driver_name || 'รอโหลดชื่อ'}</strong></p>
      <p className="text-sm text-slate-600">{RETURN_MODES[t.plan?.return_mode]}{t.plan?.return_mode !== 'one_way' && backAt ? ` · รับกลับประมาณ ${clockOf(backAt)} น.` : ''}</p>
      {t.plan?.multiwave && <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm">
        <strong>แผนวิ่งรถวันนี้</strong>
        <ol className="mt-1 list-inside list-decimal">{t.plan.outbound_waves?.map((w, i) => <li key={`out-${i}`}>รับรอบ {i + 1} เริ่ม {clockOf(w.pickup_at)} น. · นัด {clockOf(w.appointment_start)}–{clockOf(w.appointment_end)} น.</li>)}</ol>
        <ol className="list-inside list-decimal">{t.plan.return_waves?.map((w, i) => <li key={`back-${i}`}>รับกลับรอบ {i + 1} ประมาณ {clockOf(w.return_start)} น.</li>)}</ol>
      </div>}
    </div>
    {t.helper_name && <p className="text-sm">ผู้ช่วยเคลื่อนย้าย: <strong>{t.helper_name}</strong></p>}
    <ol className="space-y-2">{people.map((b, index) => {
      const pin = Number.isFinite(b.pickup_lat) && Number.isFinite(b.pickup_lng) && Math.abs(b.pickup_lat) <= 90 && Math.abs(b.pickup_lng) <= 180
      return <li key={b.id} className="rounded-xl bg-slate-50 p-3">
        <p className="font-bold">{people.length > 1 ? `${index + 1}. ` : ''}{b.patient_name}</p>
        <p className="text-sm">{MOBILITY[b.mobility]} · ผู้ติดตาม {b.companions} คน</p>
        {t.plan?.multiwave && <p className="text-sm font-semibold text-sky-900">มารับประมาณ {clockOf(pickupForBooking(t, b))} น.{b.return_mode !== 'one_way' ? ` · รับกลับประมาณ ${clockOf(returnForBooking(t, b))} น.` : ''}</p>}
        <p className="text-sm">จุดรับ: {b.pickup}</p>
        {b.cancel_requested && <p className="text-sm font-semibold text-amber-800">ผู้จองขอยกเลิก รอเจ้าหน้าที่ประสาน · ถ้าไม่ได้ขึ้นรถ กด “แจ้งเหตุขัดข้อง”</p>}
        {b.return_ready && ['outbound', 'hospital'].includes(t.state) && <p className="text-sm font-bold text-sky-800">🔔 แจ้งพร้อมให้รับกลับแล้ว</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          {b.phone && <a href={`tel:${b.phone}`} className={`${buttonClass} inline-flex items-center`}>📞 โทร {b.phone}</a>}
          {pin && <a href={`https://www.google.com/maps/dir/?api=1&destination=${b.pickup_lat},${b.pickup_lng}`} target="_blank" rel="noopener noreferrer" className={`${buttonClass} inline-flex items-center`}>📍 นำทางไปจุดรับ</a>}
        </div>
      </li>
    })}</ol>
    {upcoming && <p className="text-sm text-slate-600">ปุ่มบันทึกจะขึ้นในวันเดินทาง</p>}
    {!upcoming && canOperate && <>
      <DriverStepBar trip={t} />
      <p className="text-sm text-slate-600">บันทึกตอนออกรถและกลับถึงสำนักงานเมื่อมีอินเทอร์เน็ต ไม่ต้องกดระหว่างทาง</p>
      {t.state === 'issue'
        ? <p className="rounded-xl bg-amber-50 p-3">แจ้งเหตุขัดข้องแล้ว: {t.issue_note || '—'} · รอเจ้าหน้าที่ประสาน แล้วปุ่มจะกลับมาเอง</p>
        : label && <>
          <button type="button" className="min-h-14 w-full rounded-2xl bg-sky-800 px-4 text-lg font-bold text-white disabled:opacity-50" disabled={busy} onClick={() => onAdvance(t, label)}>{label}</button>
          {/* ปุ่มนี้บันทึกผู้เดินทางทุกคนพร้อมกัน — คนที่ไม่ได้ขึ้นรถต้องแจ้งก่อน ไม่งั้นจะถูกบันทึกว่าไปด้วย */}
          {t.state === 'outbound' && people.length > 0 && <p className="text-sm text-slate-600">{people.length > 1 ? 'กดจบงานเมื่อส่งครบทุกคนและรถกลับแล้ว · ' : ''}ถ้ามีผู้ป่วยไม่ได้ขึ้นรถ กด “แจ้งเหตุขัดข้อง” แทน</p>}
        </>}
      {t.state !== 'issue' && <IssueReport busy={busy} contactPhone={contactPhone} onReport={note => onAction(t, 'issue', note)} />}
    </>}
    <DriverHistory trip={t} />
    {driverAssignment}
  </article>
}

const assignmentExpected = trips => Object.fromEntries([...trips].sort((a, b) => a.id.localeCompare(b.id)).map(t => [t.id, {
  revision: t.revision, docs_revision: t.docs_revision, driver_id: t.driver_id,
}]))

function DriverHistory({ trip }) {
  if (!trip.driver_history?.length) return null
  return <details className="rounded-xl border p-3 text-sm"><summary className="min-h-11 cursor-pointer font-semibold">ประวัติคนขับ</summary>
    <ol className="space-y-2">{trip.driver_history.map((h, i) => <li key={`${h.at}:${i}`}>
      <p>{dateTime(h.at)} · {h.phase === 'in_journey' ? 'ส่งมอบระหว่างเที่ยว' : 'เปลี่ยนก่อนออกรถ'}</p>
      <p>{h.before?.name || 'คนขับเดิม'} → <strong>{h.after?.name || 'คนขับใหม่'}</strong></p>
    </li>)}</ol>
  </details>
}

function DriverAssignment({ trips, people, busy, onReassign, onDone, batch = false }) {
  const [snapshot] = useState(() => assignmentExpected(trips))
  const [driver, setDriver] = useState('')
  const [handover, setHandover] = useState(false)
  const [review, setReview] = useState(false)
  const current = assignmentExpected(trips)
  const stale = JSON.stringify(current) !== JSON.stringify(snapshot)
  const target = people.find(p => p.id === driver)
  const active = trips.some(t => t.state !== 'confirmed' && !(t.state === 'issue' && t.state_before_issue === 'confirmed'))
  const many = batch
  return <div className="space-y-3 rounded-xl border-2 border-sky-300 bg-sky-50 p-3">
    <p className="font-bold">{many ? `จัดคนขับแทนวันนี้ · ${trips.length} เที่ยว` : 'เปลี่ยนคนขับเที่ยวนี้'}</p>
    <p className="text-sm">คนขับเดิม: {trips[0].driver_name} · {many ? `วันที่ ${thaiDateFromDateInput(trips[0].plan.date)}` : `โรงพยาบาล ${trips[0].plan?.route_label}`}</p>
    <label className="block">คนขับแทน<select aria-label="คนขับแทน" className={inputClass} value={driver} disabled={busy} onChange={e => { setDriver(e.target.value); setReview(false) }}>
      <option value="">เลือกเจ้าหน้าที่ของหน่วยงาน</option>{people.filter(p => p.id !== trips[0].driver_id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select></label>
    {active && <label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="size-5" checked={handover} onChange={e => setHandover(e.target.checked)} />ประสานส่งมอบรถและผู้ป่วยระหว่างเที่ยวแล้ว</label>}
    {stale && <p role="alert">เที่ยวเปลี่ยนแล้ว กรุณาปิดฟอร์มและเปิดใหม่เพื่อตรวจข้อมูลล่าสุด</p>}
    {many && <ul className="space-y-1 text-sm">{trips.map(t => <li key={t.id}>{clockOf(t.plan?.pickup_at)} น. · {t.plan?.route_label}</li>)}</ul>}
    {review ? <div className="space-y-2 rounded-lg bg-white p-3"><p>ยืนยันมอบหมาย <strong>{target?.name}</strong> ขับแทน {many ? `${trips.length} เที่ยวในวันนี้` : 'เที่ยวนี้'}?</p>
      <p className="text-sm">ระบบจะแจ้งผู้เกี่ยวข้อง เก็บชื่อคนขับเดิมในประวัติ และให้พิมพ์เอกสารใหม่</p>
      <button type="button" className={primaryClass} disabled={!target || busy || stale || (active && !handover)} onClick={async () => {
        const result = await onReassign({ trip: many ? null : trips[0].id, day: many ? trips[0].plan.date : null,
          fromDriver: trips[0].driver_id, driver, expected: snapshot, midtrip: handover })
        if (result) onDone()
      }}>ยืนยันเปลี่ยนคนขับ</button></div> : <button type="button" className={primaryClass} disabled={!target || busy || stale || (active && !handover)} onClick={() => setReview(true)}>ตรวจและเปลี่ยนคนขับ</button>}
    <button type="button" className={buttonClass} disabled={busy} onClick={onDone}>ปิดฟอร์ม</button>
  </div>
}

// จบเที่ยวแล้วแต่ยังไม่มีเลขไมล์กลับ — การ์ดเดียวกันทั้งในรายการบนมือถือและในแผ่นรายละเอียดของตารางจอ PC
function AwaitingOdometer({ trip: t, trips, busy, onSave }) {
  return <article data-trip={t.id} className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
    <p className="font-semibold">🏥 {t.plan?.route_label}</p><p className="text-sm">{dateTime(t.plan?.pickup_at)}</p>
    <p className="text-sm">คนขับ: {t.driver_name}</p><DriverHistory trip={t} />
    <OdometerForm quick trip={t} trips={trips} busy={busy} onSave={onSave} />
  </article>
}

// จอ PC (ตั้งแต่ md = 768px ของ Tailwind) ใช้ตาราง จอเล็กใช้การ์ดปุ่มใหญ่ — สลับด้วย JS ไม่ได้ซ่อนด้วย CSS แบบกล่องคำขอรถ
// เพราะการ์ดคนขับมีฟอร์มที่เก็บค่าที่กรอกค้าง (เลขไมล์ เปลี่ยนคนขับ) วาดสองชุดพร้อมกันจะได้ฟอร์มซ้ำที่ค่าไม่ตรงกัน
const DESK_QUERY = '(min-width: 768px)'
function useDesk() {
  const [desk, setDesk] = useState(() => window.matchMedia(DESK_QUERY).matches)
  useEffect(() => {
    const media = window.matchMedia(DESK_QUERY)
    const update = () => setDesk(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return desk
}

// ── จอ PC: ตารางงานคนขับแบบกล่องคำขอรถ (เจ้าของระบบสั่ง 2569-09-30) ──
// 1 แถว = 1 เที่ยว ชุดเดียวกับการ์ดบนมือถือ · คลิกแถวเปิดแผ่นลอยทับที่มีทุกอย่างของการ์ด (โทร นำทาง แจ้งเหตุขัดข้อง
// ประวัติคนขับ เปลี่ยนคนขับ เลขไมล์) ปิดแล้วกลับมาที่แถวเดิม
// เรียงงานที่ต้องทำก่อน: เหตุขัดข้อง → กำลังให้บริการ → ต้องออกวันนี้/เลยวัน → รอเลขไมล์ → เที่ยวถัดไป → จบแล้ว (ล่าสุดก่อน)
// ⚠️ คอลัมน์ "ดำเนินการ" ต้องปักขวาเสมอ ชื่อยาวดันตารางให้ล้นพื้นที่ได้ ถอดแล้วปุ่มหลักถูกตัด (บทเรียน #134)
const RUNNING = ['outbound', 'hospital', 'returning']
const DESK_PILLS = [
  ['all', 'ทั้งหมด', '#64748b'],
  ['now', 'วันนี้', '#7c3aed'],
  ['odometer', 'รอเลขไมล์', '#d97706'],
  ['later', 'เที่ยวถัดไป', '#0284c7'],
  ['done', 'จบแล้ว', '#059669'],
]
const DESK_EMPTY = { now: 'วันนี้ไม่มีเที่ยวที่ต้องออก', odometer: 'ไม่มีเที่ยวที่รอเลขไมล์', later: 'ยังไม่มีเที่ยวถัดไป', done: 'ยังไม่มีเที่ยวที่จบแล้วใน 30 วันล่าสุด' }
const pickupOf = t => t.estimated_pickup_at || t.plan?.pickup_at
const deskText = ({ trip: t, riders }) => [t.plan?.route_label, t.driver_name, t.helper_name, whenLabel(pickupOf(t)), dateTime(pickupOf(t)),
  ...riders.flatMap(b => [b.patient_name, b.phone, b.pickup])].join(' ').toLowerCase()

function deskStatus({ trip: t, kind }) {
  if (t.state === 'issue') return ['เหตุขัดข้อง', 'bg-red-100 text-red-800']
  if (RUNNING.includes(t.state)) return [TRIP_STATUS[t.state], 'bg-violet-100 text-violet-900']
  if (kind === 'odometer') return [Number.isFinite(t.odometer_end) ? 'เลขไมล์รอตรวจสอบ' : 'รอเลขไมล์', 'bg-amber-100 text-amber-900']
  if (t.state === 'completed') return [TRIP_STATUS.completed, 'bg-emerald-100 text-emerald-900']
  return [TRIP_STATUS[t.state] || t.state, 'bg-sky-100 text-sky-900']
}

// ปุ่มเดียวของแถว — ปุ่มทึบ = งานที่ต้องทำ ปุ่มกรอบเทา = แค่เปิดดู (แบบกล่องคำขอรถ)
// ปุ่มออกรถขึ้นเฉพาะเที่ยวที่การ์ดมือถือมีปุ่มใหญ่ คือเที่ยววันนี้ (หรือเลยวันแล้วยังไม่จบ) ของบัญชีที่บันทึกได้
function deskAction({ trip: t, kind, operate }) {
  const next = kind === 'now' && operate && t.state !== 'issue' ? driverNext(t) : ''
  if (next) return { id: 'advance', label: next, color: '#075985' }
  if (kind === 'odometer') return { id: 'open', label: Number.isFinite(t.odometer_end) ? 'ตรวจเลขไมล์' : 'ใส่เลขไมล์กลับ', color: '#b45309' }
  return { id: 'open', label: kind === 'done' ? 'แก้เลขไมล์' : 'ดูรายละเอียด' }
}

// กล่องทวนก่อนบันทึกจากแถว — รูปแบบเดียวกับกล่องทวน "ยืนยันรถ" ของกล่องคำขอรถ
function reviewAdvance({ trip: t, riders }, label) {
  const at = pickupOf(t)
  return window.confirm([
    `บันทึก “${label}” เที่ยวนี้หรือไม่?`, '',
    `• โรงพยาบาล: ${t.plan?.route_label || '—'}`,
    `• ออกรับ: ${whenLabel(at)} ${clockOf(at)} น.`,
    `• ผู้เดินทาง: ${riders.map(b => b.patient_name).join(', ') || '—'}`,
    `• คนขับ: ${t.driver_name || '—'}`,
    ...(t.state === 'confirmed' ? [] : ['', 'ระบบจะบันทึกว่าส่งผู้เดินทางครบทุกคนและรถกลับแล้ว ถ้ามีผู้ป่วยไม่ได้ขึ้นรถ ให้กด “ยกเลิก” แล้วคลิกแถวนี้เพื่อแจ้งเหตุขัดข้องแทน']),
    '', 'ตรวจแล้วกด “ตกลง” เพื่อบันทึก หรือกด “ยกเลิก” เพื่อกลับไปตรวจ',
  ].join('\n'))
}

function DriverDesk({ rows, workspace, busy, error, canAssign, contactPhone, adminNote, assignmentFor, coverFields, onCover, onCloseCover, onCloseTrip, onAdvance, onAction, onOdometer }) {
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState(null)
  const words = search.trim().toLowerCase()
  const shown = rows.filter(r => (filter === 'all' || r.kind === filter) && (!words || deskText(r).includes(words)))
  const count = id => id === 'all' ? rows.length : rows.filter(r => r.kind === id).length
  const open = rows.find(r => r.trip.id === openId)
  const close = () => { setOpenId(null); onCloseTrip() }
  // ออกรถ/จบงานจากแถวต้องผ่านกล่องทวนก่อน (เจ้าของระบบเลือกแบบ ก 2569-09-30) — แถวตารางอยู่ชิดกัน กดผิดแถว
  // ระบบแจ้ง "สถานะเที่ยวรถเปลี่ยนแล้ว" ถึงผู้จองของเที่ยวนั้นทันที (ptb_notice ใน patient_booking_action) และคนขับย้อนเองไม่ได้
  // ไม่สำเร็จ = เปิดแผ่นของแถวนั้นให้เห็นข้อความผิดพลาดตรงหน้า (แบบกล่องคำขอรถ)
  // จบงานแล้ว = เปิดแผ่นต่อที่ช่องเลขไมล์กลับ แถวย้ายไปกลุ่ม "รอเลขไมล์" แล้วไม่ต้องไล่หา (ปิดแผ่นไว้ใส่ทีหลังได้)
  async function press(row) {
    const action = deskAction(row)
    if (action.id !== 'advance') { setOpenId(row.trip.id); return }
    if (!reviewAdvance(row, action.label)) return
    const out = await onAdvance(row.trip, action.label)
    if (!out || (out.done && row.trip.state !== 'confirmed')) setOpenId(row.trip.id)
  }
  // บันทึกเลขไมล์สำเร็จ = ปิดแผ่นกลับไปที่ตาราง แถวเปลี่ยนเป็น "จบเที่ยวแล้ว"
  const saveOdometer = async (...args) => { const saved = await onOdometer(...args); if (saved) close(); return saved }
  const th = 'whitespace-nowrap border-r border-white/10 px-2 py-2.5 text-[11px] font-bold text-white'
  const cell = 'border-r border-gray-200 px-2 py-2.5'
  const chip = 'whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold'
  const openAt = open && pickupOf(open.trip)
  return <div className="space-y-4">
    <p className="text-sm font-semibold text-amber-800">กดบันทึกเมื่อจอดรถในที่ปลอดภัย</p>
    {adminNote}
    <ListCard title="งานคนขับ" count={rows.length} search={search} onSearch={setSearch} searchLabel="ค้นหาผู้ป่วย โรงพยาบาล คนขับ"
      action={canAssign && <button type="button" className={buttonClass} onClick={onCover}>จัดคนขับแทนวันนี้</button>}
      pills={<Pills value={filter} onChange={setFilter} label="กรองงานคนขับ" items={DESK_PILLS.map(([id, label, color]) => ({ id, label, color, count: count(id) }))} />}>
      <div className="p-4 sm:p-5">
        {!rows.length && <p className="py-10 text-center text-sm font-semibold text-gray-400">ยังไม่มีเที่ยวที่ต้องขับ · เที่ยวที่ยืนยันรถแล้วจะขึ้นที่นี่</p>}
        {rows.length > 0 && !shown.length && <p className="py-10 text-center text-sm font-semibold text-gray-400">{words ? 'ไม่พบเที่ยวที่ค้นหา' : `${DESK_EMPTY[filter]} · กดป้าย “ทั้งหมด” เพื่อดูทุกเที่ยว`}</p>}
        {shown.length > 0 && <div className="overflow-x-auto border border-gray-300 shadow-sm" style={{ borderRadius: 4 }}>
          <table className="w-full min-w-[880px] border-collapse text-sm">
            <thead><tr style={{ backgroundColor: '#1a3a5c' }}>
              <th className={`w-10 text-center ${th}`}>ที่</th>
              <th className={`text-center ${th}`}>วันเวลาออกรับ</th>
              <th className={`text-left ${th}`}>โรงพยาบาล / ขากลับ</th>
              <th className={`text-left ${th}`}>ผู้เดินทาง</th>
              <th className={`text-left ${th}`}>คนขับ</th>
              <th className={`text-center ${th}`}>สถานะ</th>
              <th className="sticky right-0 z-10 min-w-[170px] whitespace-nowrap px-2 py-2.5 text-center text-[11px] font-bold text-white shadow-[-6px_0_6px_-4px_rgba(0,0,0,0.15)]" style={{ background: 'inherit' }}>ดำเนินการ</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-200">{shown.map((row, index) => {
              const { trip: t, kind, riders } = row
              const at = pickupOf(t)
              const back = t.estimated_return_at || t.plan?.return_at
              const action = deskAction(row)
              const [status, tone] = deskStatus(row)
              const distance = kind === 'done' && Number.isFinite(t.odometer_start) && Number.isFinite(t.odometer_end) ? t.odometer_end - t.odometer_start : null
              const shade = index % 2 === 0 ? '#fff' : '#f5f8fc'
              return <tr key={t.id} data-trip={t.id} className="cursor-pointer align-top transition-colors" style={{ backgroundColor: shade }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = '#dbeafe'} onMouseLeave={e => e.currentTarget.style.backgroundColor = shade}
                onClick={() => setOpenId(t.id)}>
                <td className={`${cell} text-center text-xs text-gray-500`}>{index + 1}</td>
                <td className={`${cell} whitespace-nowrap text-center`}><span className="block font-semibold">{whenLabel(at)}</span><span className="block">ออกรับ {clockOf(at)} น.</span>{t.plan?.return_mode !== 'one_way' && back && <span className="block text-[11px] text-gray-500">รับกลับประมาณ {clockOf(back)} น.</span>}</td>
                <td className={cell}><span className="block max-w-[220px] truncate font-semibold" title={t.plan?.route_label}>{t.plan?.route_label || '—'}</span><span className="block text-[11px] text-gray-500">{RETURN_MODES[t.plan?.return_mode]}{t.plan?.multiwave ? ' · รับหลายรอบ' : ''}</span></td>
                <td className={cell}>{riders.length ? riders.map((b, i) => <span key={b.id} className={`block ${i ? 'mt-1.5' : ''}`}><span className="block font-semibold">{b.patient_name}</span><span className="block text-[11px] text-gray-500">{MOBILITY[b.mobility]} · ผู้ติดตาม {b.companions} คน</span></span>)
                  // ฐานข้อมูลไม่ส่งข้อมูลผู้เดินทางให้คนขับเมื่อเที่ยวจบแล้ว (patient_booking_workspace) — บอกเหตุ ไม่ใช่ขีดว่างเหมือนไม่มีคนนั่ง
                  : <span className="text-[11px] text-gray-400">{t.state === 'completed' ? 'ไม่แสดงหลังจบเที่ยว' : '—'}</span>}</td>
                <td className={cell}><span className="block max-w-[150px] truncate" title={t.driver_name || ''}>{t.driver_name || '—'}</span>{t.helper_name && <span className="block max-w-[150px] truncate text-[11px] text-gray-500" title={t.helper_name}>ผู้ช่วย {t.helper_name}</span>}</td>
                <td className={`${cell} text-center`}><span className="inline-flex flex-wrap justify-center gap-1">
                  <span className={`${chip} ${tone}`}>{status}</span>
                  {['now', 'later'].includes(kind) && riders.some(b => b.cancel_requested) && <span className={`${chip} bg-amber-100 text-amber-900`}>ขอยกเลิก</span>}
                  {['outbound', 'hospital'].includes(t.state) && riders.some(b => b.return_ready) && <span className={`${chip} bg-sky-100 text-sky-900`}>พร้อมรับกลับ</span>}
                </span>{distance !== null && <span className="mt-1 block text-[11px] text-gray-500">ระยะทาง {distance} กม.</span>}</td>
                <td className="sticky right-0 z-10 px-2 py-2.5 text-center shadow-[-6px_0_6px_-4px_rgba(0,0,0,0.15)]" style={{ background: 'inherit' }}>
                  <button type="button" disabled={busy} onClick={e => { e.stopPropagation(); press(row) }}
                    className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-bold disabled:opacity-50 ${action.color ? 'border-transparent text-white' : 'border-slate-300 bg-white text-slate-700'}`}
                    style={action.color ? { backgroundColor: action.color } : undefined}>{action.label}</button>
                </td>
              </tr>
            })}</tbody>
          </table>
        </div>}
      </div>
    </ListCard>
    {open && <Sheet key={open.trip.id} wide title={open.trip.plan?.route_label || 'เที่ยวรถ'} subtitle={`${deskStatus(open)[0]} · ${whenLabel(openAt)} ออกรับ ${clockOf(openAt)} น.`} onClose={close} busy={busy}>
      {error && <div role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{error}</div>}
      {['now', 'later'].includes(open.kind) && <DriverCard bare trip={open.trip} bookings={workspace.bookings} busy={busy} upcoming={open.kind === 'later'} canOperate={open.operate}
        contactPhone={contactPhone} onAdvance={onAdvance} onAction={onAction} driverAssignment={assignmentFor(open.trip)} />}
      {open.kind === 'odometer' && <AwaitingOdometer trip={open.trip} trips={workspace.trips} busy={busy} onSave={saveOdometer} />}
      {open.kind === 'done' && <article data-trip={open.trip.id} className="space-y-3">
        <p className="text-sm">{dateTime(open.trip.plan?.pickup_at)} · คนขับ {open.trip.driver_name || '—'}</p>
        <DriverHistory trip={open.trip} />
        <OdometerForm trip={open.trip} trips={workspace.trips} busy={busy} onSave={saveOdometer} />
      </article>}
    </Sheet>}
    {coverFields && <Sheet title="จัดคนขับแทน" subtitle="เปลี่ยนคนขับทุกเที่ยวที่ยังไม่ออกรถของวันที่เลือก" onClose={onCloseCover} busy={busy}>
      {error && <div role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{error}</div>}
      {coverFields}
    </Sheet>}
  </div>
}

// งานคนขับ — เจ้าของระบบสั่ง 2569-09-21 ให้ง่ายที่สุด: การ์ดเที่ยวละใบ ปุ่มใหญ่ปุ่มเดียวบอกขั้นถัดไป
// ทุกเที่ยว 2 ครั้ง: ออกรถ และกลับแล้ว · จบงาน
// ปุ่มขึ้นเฉพาะเที่ยวของวันนี้ (หรือเลยวันแล้วยังไม่จบ) · เลขไมล์ถามครั้งเดียวหลังจบงาน ใส่ทีหลังได้
// จอ PC เป็นตาราง (DriverDesk ด้านบน) ใช้ชุดเที่ยวเดียวกับการ์ดมือถือ — การ์ดมือถือไม่เปลี่ยน
export function DriverTrips({ workspace, uid, isAdmin, canAssign, busy, error, contactPhone, onAdvance, onAction, onOdometer, onReassign }) {
  const desk = useDesk()
  const [assignment, setAssignment] = useState(null)
  const mine = workspace.trips.filter(t => canAssign || t.driver_id === uid)
  const canOperate = t => isAdmin || t.driver_id === uid
  const byPickup = (a, b) => String(a.plan?.pickup_at || '').localeCompare(String(b.plan?.pickup_at || ''))
  const today = thaiDay()
  const active = mine.filter(t => !['completed', 'cancelled'].includes(t.state)).sort(byPickup)
  const now = active.filter(t => t.state !== 'confirmed' || (t.plan?.date || today) <= today).sort((a, b) => Number(a.state === 'confirmed') - Number(b.state === 'confirmed') || byPickup(a, b))
  const later = active.filter(t => t.state === 'confirmed' && (t.plan?.date || today) > today)
  // จบเที่ยวแล้วแต่ยังไม่มีเลขไมล์กลับ — ค้างไว้ตรงนี้จนกว่าจะใส่ (ผลตรวจ #227 ข้อ 4)
  const awaitingOdometer = mine.filter(t => canOperate(t) && t.state === 'completed' && (!Number.isFinite(t.odometer_end) || t.odometer_issue)).sort(byPickup)
  const recorded = mine.filter(t => canOperate(t) && t.state === 'completed' && Number.isFinite(t.odometer_end) && !t.odometer_issue).sort(byPickup).reverse()
  const daily = (workspace.trips || []).filter(t => t.state === 'confirmed' && t.plan?.date === assignment?.day && t.driver_id === assignment?.fromDriver).sort(byPickup)
  const assignmentFor = t => !canAssign || ['completed','cancelled'].includes(t.state) ? null : <div className="space-y-2">
    {assignment?.trip === t.id ? <DriverAssignment key={t.id} trips={[t]} people={workspace.people || []} busy={busy} onReassign={onReassign} onDone={() => setAssignment(null)} />
      : <button type="button" className={buttonClass} disabled={busy} onClick={() => setAssignment({ trip: t.id })}>เปลี่ยนคนขับเที่ยวนี้</button>}
  </div>
  const adminNote = isAdmin && <p className="rounded-xl bg-amber-50 p-3 text-sm">แอดมินเห็นทุกเที่ยวและบันทึกออกรถ จบเที่ยว หรือเลขไมล์แทนได้ ระบบเก็บชื่อบัญชีผู้กดไว้ คนขับจริงยังเป็นชื่อที่แสดงบนเที่ยว</p>
  // จัดคนขับแทนทั้งวัน — มือถือกางใต้ปุ่ม จอ PC เปิดเป็นแผ่นลอยทับ ใช้ช่องกรอกชุดเดียวกัน
  const toggleCover = () => setAssignment(assignment?.day ? null : { day: thaiDay(), fromDriver: workspace.settings?.driver_id })
  const coverFields = assignment?.day && <>
    <label className="block">วันที่ต้องจัดคนขับแทน<input type="date" className={inputClass} value={assignment.day} onChange={e => setAssignment({ day: e.target.value, fromDriver: workspace.settings?.driver_id })} /></label>
    <label className="block">คนขับเดิมที่ต้องการจัดแทน<select className={inputClass} value={assignment.fromDriver || ''} onChange={e => setAssignment({ ...assignment, fromDriver: e.target.value })}>{(workspace.people || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    {daily.length ? <DriverAssignment key={`${assignment.day}:${assignment.fromDriver}`} batch trips={daily} people={workspace.people || []} busy={busy} onReassign={onReassign} onDone={() => setAssignment(null)} /> : <p>วันที่เลือกไม่มีเที่ยวที่ยังไม่ออกรถของคนขับนี้</p>}
  </>
  if (desk) {
    const urgency = t => t.state === 'issue' ? 0 : RUNNING.includes(t.state) ? 1 : 2
    const rows = [
      ...[...now].sort((a, b) => urgency(a) - urgency(b) || byPickup(a, b)).map(trip => ({ kind: 'now', trip })),
      ...awaitingOdometer.map(trip => ({ kind: 'odometer', trip })),
      ...later.map(trip => ({ kind: 'later', trip })),
      ...recorded.map(trip => ({ kind: 'done', trip })),
    ].map(row => ({ ...row, operate: canOperate(row.trip), riders: workspace.bookings.filter(b => b.trip_id === row.trip.id && b.status !== 'cancelled') }))
    return <DriverDesk rows={rows} workspace={workspace} busy={busy} error={error} canAssign={canAssign} contactPhone={contactPhone} adminNote={adminNote}
      assignmentFor={assignmentFor} coverFields={coverFields} onCover={toggleCover} onCloseCover={() => setAssignment(null)}
      onCloseTrip={() => setAssignment(current => current?.trip ? null : current)} onAdvance={onAdvance} onAction={onAction} onOdometer={onOdometer} />
  }
  return <div className="space-y-4">
    <div><h2 className="text-xl font-bold">งานคนขับ</h2><p className="text-sm font-semibold text-amber-800">กดบันทึกเมื่อจอดรถในที่ปลอดภัย</p></div>
    {adminNote}
    {canAssign && <div className="rounded-xl border bg-white p-3"><button type="button" className={buttonClass} onClick={toggleCover}>จัดคนขับแทนวันนี้</button>
      {coverFields && <div className="mt-3 space-y-3">{coverFields}</div>}
    </div>}
    {!now.length && <p className="rounded-xl border border-slate-200 bg-white p-4 text-slate-600">วันนี้ไม่มีเที่ยวที่ต้องออก{later.length ? ` · เที่ยวถัดไป ${later.length} เที่ยวอยู่ด้านล่าง` : ''}</p>}
    {now.map(t => <DriverCard key={t.id} trip={t} bookings={workspace.bookings} busy={busy} canOperate={canOperate(t)} contactPhone={contactPhone} onAdvance={onAdvance} onAction={onAction} driverAssignment={assignmentFor(t)} />)}
    {awaitingOdometer.length > 0 && <section aria-label="จบแล้ว รอเติมเลขไมล์" className="space-y-3">
      <h3 className="font-bold">จบแล้ว รอเติมเลขไมล์ ({awaitingOdometer.length})</h3>
      {awaitingOdometer.map(t => <AwaitingOdometer key={t.id} trip={t} trips={workspace.trips} busy={busy} onSave={onOdometer} />)}
    </section>}
    {later.length > 0 && <section aria-label="เที่ยวถัดไป" className="space-y-3">
      <h3 className="font-bold">เที่ยวถัดไป ({later.length})</h3>
      {later.map(t => <DriverCard key={t.id} upcoming trip={t} bookings={workspace.bookings} busy={busy} driverAssignment={assignmentFor(t)} />)}
    </section>}
    {recorded.length > 0 && <details className="rounded-xl border border-slate-200 bg-white p-3"><summary className="min-h-11 cursor-pointer font-semibold">แก้เลขไมล์เที่ยวที่จบแล้ว (30 วันล่าสุด)</summary>
      {recorded.map(t => <article key={t.id} className="my-3 border-t p-3"><p>{t.plan?.route_label} · {dateTime(t.plan?.pickup_at)}</p><OdometerForm trip={t} trips={workspace.trips} busy={busy} onSave={onOdometer} /></article>)}
    </details>}
  </div>
}

// ปุ่มพิมพ์ทุกปุ่มพิมพ์ "ทั้งเที่ยว" ชุดเดียว (ใบคำขอทุกคน + หนังสือนำส่ง 1 ใบ) ไม่ว่าจะกดจากแผ่นของคนไหน
// เจ้าของระบบสั่ง 2569-10-01 (แบบ ก): เดิมหน้าจอไม่บอก เจ้าหน้าที่เปิดแผ่นของแต่ละคนแล้วกดพิมพ์ซ้ำ ได้กระดาษเกินมาทั้งชุด
// riders = tripPassengers() ตัวเดียวกับที่ใบพิมพ์ใช้ (ส่งมาจาก BookingInbox) จำนวนแผ่นบนจอจึงเท่ากระดาษที่ออกจริง
// ไฟล์นี้ใช้ร่วมกับหน้าประชาชน (BookingCards) จึงไม่ import โมดูลใบพิมพ์มาเอง
// ⚠️ ระบบไม่ได้จำว่าพิมพ์ไปแล้ว ข้อความนี้กันคนเดียวกันพิมพ์ซ้ำ ไม่กันเจ้าหน้าที่คนละคนต่างคนต่างพิมพ์
export function TripPrintNote({ riders }) {
  const count = riders?.length || 0
  if (!count) return null
  if (count === 1) return <p className="text-sm text-slate-600">ใบคำขอจากประชาชนถึงนายก 1 ใบ + หนังสือนำส่งจาก อปท. ถึงกองทุน 1 ใบ = 2 แผ่น</p>
  return <div role="note" aria-label="พิมพ์เอกสารทั้งเที่ยว" className="rounded-lg border border-sky-300 bg-white p-3 text-sm text-slate-800">
    <p className="flex items-start gap-1.5 font-bold text-sky-950"><Printer size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span>เที่ยวนี้ไปด้วยกัน {count} คน: {riders.map(r => r.patient_name).join(' · ')}</span></p>
    <p className="mt-1">กดพิมพ์ที่คนไหนก็ได้ ได้ชุดเดียวกันครบทั้งเที่ยว</p>
    <p className="mt-1">ใบคำขอ {count} ใบ + หนังสือนำส่ง 1 ใบ = {count + 1} แผ่น · <strong>พิมพ์ครั้งเดียวพอ</strong></p>
  </div>
}

// หนังสือนำส่งถึงกองทุน 1 ฉบับต่อเที่ยว — เลขที่/วันที่มาจากทะเบียนหนังสือส่งของสารบรรณ ระบบออกเลขเองไม่ได้
// พิมพ์ได้ก่อนมีเลข (ช่อง "ที่" เว้นเส้นประให้เขียนมือ) เพราะบางแห่งลงเลขหลังผู้บริหารลงนาม
// riders = ผู้เดินทางที่ใบพิมพ์ของเที่ยวจะออกให้ (ดู TripPrintNote)
export function TripFundDocs({ trip, riders = [], busy, onRecordLetter, onPrintLetter }) {
  const edit = useTripDraft(trip, { letterNo: trip.forward_letter_no || '', letterDate: trip.forward_letter_date || thaiDay() })
  const { letterNo, letterDate } = edit.values
  const [open, setOpen] = useState(false)
  return <div className="mt-4 rounded-xl border border-slate-200 p-3">
    <p className="font-semibold">เอกสารคำขอและนำส่งกองทุน</p>
    <div className={riders.length > 1 ? 'my-2' : ''}><TripPrintNote riders={riders} /></div>
    {trip.forward_letter_no && !open
      ? <p className="text-sm">ที่ {trip.forward_letter_no} ลงวันที่ {thaiDateFromDateInput(trip.forward_letter_date)}</p>
      : <p className="text-sm text-slate-600">ยังไม่ได้บันทึกเลขที่หนังสือ พิมพ์ได้ก่อนแล้วเขียนเลขด้วยมือ</p>}
    {open && <form className="mt-3 grid gap-3 sm:grid-cols-[1fr_180px_auto]" onSubmit={async e => { e.preventDefault(); if (!edit.conflict && await onRecordLetter(edit.snapshot, letterNo, letterDate)) { edit.reset(); setOpen(false) } }}>
      <label>เลขที่หนังสือ<input className={inputClass} required maxLength={60} value={letterNo} onChange={e => edit.change("letterNo", e.target.value)} placeholder="เช่น พร 72301/123" /></label>
      <label>ลงวันที่<input className={inputClass} type="date" required value={letterDate} onChange={e => edit.change("letterDate", e.target.value)} /></label>
      <DraftConflict edit={edit} busy={busy} latest={`เลขหนังสือ ${trip.forward_letter_no || "—"} · ${trip.forward_letter_date || "—"}`} /><button className={`${primaryClass} self-end`} disabled={busy || edit.conflict}>บันทึกเลขหนังสือ</button>
    </form>}
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" className={buttonClass} disabled={busy} onClick={() => onPrintLetter(trip)}>พิมพ์ใบคำขอถึงนายก + หนังสือนำส่งกองทุน</button>
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
  const showReason = correction || issue
  const compact = quick && !full && start !== '' && start != null && !showReason
  return <form className={`mt-3 grid gap-3 rounded-xl bg-slate-50 p-3 ${compact ? 'sm:grid-cols-[1fr_auto]' : 'sm:grid-cols-[1fr_1fr_auto]'}`} onSubmit={async e => { e.preventDefault(); if (!edit.conflict && await onSave(edit.snapshot, start === '' ? null : Number(start), end === '' ? null : Number(end), issue, reason)) edit.reset() }}>
    {compact
      ? <p className="sm:col-span-full">เลขไมล์ออก <strong>{start}</strong> ({trip.odometer_start != null ? 'บันทึกไว้แล้ว' : 'ต่อจากเที่ยวก่อน'}) <button type="button" className="ml-1 min-h-11 font-semibold text-sky-800 underline" onClick={() => setFull(true)}>แก้</button></p>
      : <label>เลขไมล์ออก<input className={inputClass} name="odometer_start" type="number" inputMode="numeric" min={0} max={2147483647} required={!issue} value={start} onChange={e => edit.change('start', e.target.value)} /></label>}
    <label>เลขไมล์กลับ<input className={inputClass} name="odometer_end" type="number" inputMode="numeric" min={0} max={2147483647} value={end} onChange={e => edit.change('end', e.target.value)} placeholder="กรอกเมื่อกลับถึงพื้นที่" /></label>
    <button className={`${compact ? primaryClass : buttonClass} self-end`} disabled={busy || edit.conflict || (abnormal && !issue)}>{compact ? 'บันทึกเลขไมล์กลับ' : 'บันทึกเลขไมล์'}</button>
    {(!compact || abnormal) && <label className="flex min-h-11 items-center gap-2 sm:col-span-full"><input className="size-5" type="checkbox" checked={issue} onChange={e => edit.change('issue', e.target.checked)} />มาตรวัดมีปัญหา / ระยะทางรอตรวจสอบ</label>}
    {showReason && <label className="sm:col-span-full">เหตุผลที่แก้เลขไมล์ (ไม่บังคับ)<select aria-label="เหตุผลที่แก้เลขไมล์" className={inputClass} value={reason} onChange={e => edit.change('reason', e.target.value)}><option value="">ไม่ระบุเหตุผล</option>{['กรอกผิด', 'ตรวจเลขจากมาตรวัดแล้ว', 'เปลี่ยนมาตรวัด', 'มาตรวัดมีปัญหา', 'ตรวจสอบแก้ไขแล้ว'].map(r => <option key={r}>{r}</option>)}</select></label>}
    {(issue || abnormal) ? <p className="text-sm text-amber-900 sm:col-span-full">{issue ? 'บันทึกได้ ระยะทางรอตรวจสอบและยังไม่นับในยอดรวม' : 'เลขไมล์ผิดปกติ หากมาตรวัดมีปัญหาให้เลือกช่องด้านบนเพื่อบันทึกรอตรวจสอบ'}</p> : distance !== null && <p className="text-sm sm:col-span-full">ระยะทาง {distance} กม.</p>}
    {trip.odometer_note && <p className="text-sm sm:col-span-full">เหตุผลที่บันทึกไว้: {trip.odometer_note}</p>}
    {quick && <p className="text-sm text-slate-600 sm:col-span-full">ใส่ทีหลังได้ · เที่ยวนี้จะรออยู่ตรงนี้จนกว่าจะใส่เลขไมล์กลับ</p>}
    <DraftConflict edit={edit} busy={busy} latest={`เลขไมล์ออก ${trip.odometer_start ?? '—'} · กลับ ${trip.odometer_end ?? '—'}${trip.odometer_issue ? ' · รอตรวจสอบ' : ''}`} />
  </form>
}
