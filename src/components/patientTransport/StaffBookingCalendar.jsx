import { useMemo, useState } from 'react'
import { BOOKING_STATUS, RETURN_MODES, TRIP_STATUS, bookingLastDay, buttonClass, clockOf, thaiDay } from '../../lib/patientBooking'

const date = day => new Date(`${day}T12:00:00+07:00`)
const dayLabel = day => date(day).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const monthLabel = month => date(`${month}-01`).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', month: 'long', year: 'numeric' })
const monthDays = month => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate()
const nextMonth = (month, delta) => {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
const peopleIn = riders => riders.reduce((sum, b) => sum + 1 + Number(b.companions || 0), 0)

export default function StaffBookingCalendar({ workspace }) {
  const today = thaiDay()
  const firstMonth = today.slice(0, 7)
  const lastMonth = bookingLastDay(today).slice(0, 7)
  const [month, setMonth] = useState(firstMonth)
  const [selected, setSelected] = useState(today)
  const [mode, setMode] = useState('calendar')
  const days = useMemo(() => {
    const result = new Map()
    const entry = day => {
      if (!result.has(day)) result.set(day, { pending: [], trips: [], riders: [] })
      return result.get(day)
    }
    for (const b of workspace.bookings || []) {
      if (!b.appointment_at || b.status === 'cancelled') continue
      const day = thaiDay(b.appointment_at)
      if (b.status === 'submitted') entry(day).pending.push(b)
      else if (b.trip_id && ['confirmed', 'completed'].includes(b.status)) entry(day).riders.push(b)
    }
    for (const trip of workspace.trips || []) {
      const day = trip.plan?.date
      if (day && trip.state !== 'cancelled') entry(day).trips.push(trip)
    }
    return result
  }, [workspace.bookings, workspace.trips])
  const allDates = Array.from({ length: monthDays(month) }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
  const offset = (date(allDates[0]).getUTCDay() + 6) % 7
  const selectedData = days.get(selected) || { pending: [], trips: [], riders: [] }
  const monthlyRows = allDates.flatMap(day => {
    const data = days.get(day)
    if (!data) return []
    return [
      ...data.pending.map(booking => ({ day, kind: 'pending', at: booking.appointment_at, booking })),
      ...data.trips.map(trip => ({ day, kind: 'trip', at: trip.estimated_pickup_at || trip.plan?.pickup_at, trip, riders: data.riders.filter(b => b.trip_id === trip.id) })),
    ]
  }).sort((a, b) => a.day.localeCompare(b.day) || String(a.at || '').localeCompare(String(b.at || '')))
  const chooseMonth = value => {
    if (value < firstMonth || value > lastMonth) return
    setMonth(value)
    setSelected(value === firstMonth ? today : `${value}-01`)
  }
  const shortDate = day => date(day).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'short', day: 'numeric', month: 'short' })
  const rowContent = row => row.kind === 'pending' ? <>
    <strong>{row.booking.patient_name}</strong><span>เวลานัด {clockOf(row.booking.appointment_at)} น. · {row.booking.route_label}</span>
    <span>จุดรับ {row.booking.pickup} · {RETURN_MODES[row.booking.return_mode] || row.booking.return_mode}</span>
  </> : <>
    <strong>{row.trip.plan?.route_label || row.riders[0]?.route_label || 'เที่ยวรถ'}</strong>
    <span>เริ่มรับ {clockOf(row.at)} น. · {TRIP_STATUS[row.trip.state] || row.trip.state}</span>
    <span>{peopleIn(row.riders)} คน · {row.riders.map(b => b.patient_name).join(', ') || 'ยังไม่มีผู้เดินทางในรายการ'}</span>
  </>
  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-label="ปฏิทินงานรถรับส่งผู้ป่วย">
    <div><h2 className="text-lg font-bold">ปฏิทินจองรถ</h2><p className="text-sm text-slate-600">ดูคำขอที่รอยืนยันและเที่ยวรถของแต่ละวัน · จัดการคิวในแท็บ “คำขอรถ”</p></div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="รูปแบบปฏิทิน">
      <button type="button" className={buttonClass} aria-pressed={mode === 'calendar'} onClick={() => setMode('calendar')}>ปฏิทินรายเดือน</button>
      <button type="button" className={buttonClass} aria-pressed={mode === 'table'} onClick={() => setMode('table')}>ตารางรายการ</button>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={buttonClass} disabled={month <= firstMonth} onClick={() => chooseMonth(nextMonth(month, -1))}>← เดือนก่อน</button>
      <button type="button" className={buttonClass} disabled={month >= lastMonth} onClick={() => chooseMonth(nextMonth(month, 1))}>เดือนถัดไป →</button>
      <button type="button" className={buttonClass} onClick={() => chooseMonth(firstMonth)}>เดือนนี้</button>
    </div>
    <div className="grid grid-cols-2 gap-2">
      <label>เดือน<select aria-label="เดือน" value={month.slice(5)} onChange={e => chooseMonth(`${month.slice(0, 4)}-${e.target.value}`)} className="block min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-2">
        {Array.from({ length: 12 }, (_, i) => { const value = `${month.slice(0, 4)}-${String(i + 1).padStart(2, '0')}`; return <option key={value} value={value.slice(5)} disabled={value < firstMonth || value > lastMonth}>{date(`${value}-01`).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', month: 'long' })}</option> })}
      </select></label>
      <label>ปี พ.ศ.<select aria-label="ปี พ.ศ." value={month.slice(0, 4)} onChange={e => { const value = `${e.target.value}-${month.slice(5)}`; chooseMonth(value < firstMonth ? firstMonth : value > lastMonth ? lastMonth : value) }} className="block min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-2">
        {Array.from({ length: Number(lastMonth.slice(0, 4)) - Number(firstMonth.slice(0, 4)) + 1 }, (_, i) => Number(firstMonth.slice(0, 4)) + i).map(year => <option key={year} value={year}>{year + 543}</option>)}
      </select></label>
    </div>
    <h3 className="font-semibold">{monthLabel(month)} · {monthlyRows.length} รายการ</h3>
    {workspace.limited && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-900">รายการมีจำนวนมากเกินขอบเขตที่โหลด ปฏิทินอาจแสดงไม่ครบ กรุณาตรวจในแท็บคำขอรถ</p>}
    {mode === 'calendar' ? <>
      <div className="hidden min-[440px]:grid grid-cols-7 gap-1 text-center text-xs" aria-hidden="true">{['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'].map(text => <span key={text}>{text}</span>)}</div>
      <div className="grid grid-cols-4 gap-1 min-[440px]:grid-cols-7" role="group" aria-label="วันที่ในเดือน">
        {Array.from({ length: offset }, (_, i) => <span key={`blank-${i}`} className="hidden min-[440px]:block" />)}
        {allDates.map(day => {
          const data = days.get(day)
          const pending = data?.pending.length || 0, trips = data?.trips.length || 0
          return <button key={day} type="button" aria-label={`${dayLabel(day)} ${pending} คำขอรอยืนยัน ${trips} เที่ยวรถ`} aria-pressed={selected === day}
            data-staff-calendar-date={day} onClick={() => setSelected(day)}
            className={`min-h-20 min-w-0 rounded-lg border p-1 text-center text-xs ${selected === day ? 'border-sky-700 ring-2 ring-sky-700' : 'border-slate-200'} ${trips ? 'bg-sky-50' : pending ? 'bg-amber-50' : 'bg-white'}`}>
            <span className="block min-[440px]:hidden">{['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'][date(day).getUTCDay()]}</span><strong className="block text-base">{Number(day.slice(-2))}</strong>
            {pending > 0 && <span className="block text-amber-800">รอ {pending}</span>}
            {trips > 0 && <span className="block text-sky-900">{trips} เที่ยว</span>}
            {!pending && !trips && <span className="block text-slate-500">—</span>}
          </button>
        })}
      </div>
      <div role="region" className="space-y-3 rounded-xl bg-slate-50 p-3" aria-label="รายการในวันที่เลือก">
        <h4 className="font-bold">{dayLabel(selected)} · รอยืนยัน {selectedData.pending.length} · เที่ยวรถ {selectedData.trips.length}</h4>
        {!selectedData.pending.length && !selectedData.trips.length && <p>ยังไม่มีคำขอหรือเที่ยวรถในวันนี้</p>}
        {selectedData.pending.map(booking => <article key={booking.id} className="space-y-1 rounded-lg border bg-white p-3"><p className="font-semibold text-amber-900">รอยืนยันรถ · {booking.patient_name}</p><p>นัด {clockOf(booking.appointment_at)} น. · {booking.route_label}</p><p className="text-sm">จุดรับ {booking.pickup} · {RETURN_MODES[booking.return_mode] || booking.return_mode}</p></article>)}
        {selectedData.trips.map(trip => {
          const riders = selectedData.riders.filter(b => b.trip_id === trip.id)
          return <article key={trip.id} className="space-y-1 rounded-lg border bg-white p-3"><p className="font-semibold text-sky-900">{TRIP_STATUS[trip.state] || trip.state} · {trip.plan?.route_label || riders[0]?.route_label || 'เที่ยวรถ'}</p>
            <p>เริ่มรับ {clockOf(trip.estimated_pickup_at || trip.plan?.pickup_at)} น. · {peopleIn(riders)} คน</p><p className="text-sm">{riders.map(b => b.patient_name).join(', ') || 'ยังไม่มีผู้เดินทางในรายการ'}</p></article>
        })}
      </div>
    </> : <div role="region" className="space-y-2" aria-label="ตารางรายการรายเดือน">
      {!monthlyRows.length && <p className="rounded-lg bg-slate-50 p-4">เดือนนี้ยังไม่มีคำขอหรือเที่ยวรถ</p>}
      {monthlyRows.map(row => <article key={row.kind === 'pending' ? row.booking.id : row.trip.id} className="grid gap-1 rounded-lg border p-3 sm:grid-cols-[8rem_1fr]">
        <span className="font-semibold">{shortDate(row.day)}</span><div className="flex min-w-0 flex-col gap-1 text-sm"><span className={row.kind === 'pending' ? 'font-semibold text-amber-900' : 'font-semibold text-sky-900'}>{row.kind === 'pending' ? BOOKING_STATUS.submitted : 'เที่ยวรถ'}</span>{rowContent(row)}</div>
      </article>)}
    </div>}
    <p className="text-xs text-slate-600">แสดงคำขอที่ยังรอยืนยัน เที่ยวที่ยืนยันหรือกำลังดำเนินการ และรายการที่เพิ่งเสร็จใน 30 วันล่าสุด · กด “โหลดข้อมูลล่าสุด” ด้านบนเพื่อตรวจคิวอีกครั้ง</p>
  </section>
}
