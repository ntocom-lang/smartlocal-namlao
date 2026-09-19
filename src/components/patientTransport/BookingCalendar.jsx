import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { buttonClass, primaryClass, inputClass, thaiDay, RETURN_MODES, TRIP_STATUS } from '../../lib/patientBooking'

const dayLabels = { past: 'ผ่านแล้ว', unavailable: 'งดบริการ', unverified: 'รอตรวจปฏิทิน', closed: 'วันหยุด', lead_time: 'พ้นกำหนดจองล่วงหน้า', issue: 'รอประสานเหตุขัดข้อง', open: 'เปิดบริการ' }
const tripLabels = { joinable: 'ขอร่วมเที่ยวได้', full: 'เต็ม', busy: 'ไม่เปิดร่วมเที่ยว', completed: 'จบเที่ยวแล้ว', issue: 'รอประสาน' }
const time = value => value ? new Date(value).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }) : '—'
const dateLabel = day => new Date(`${day}T12:00:00+07:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
function monthRange(month) {
  const [year, m] = month.split('-').map(Number)
  return [`${month}-01`, `${month}-${new Date(Date.UTC(year, m, 0)).getUTCDate()}`]
}
function initialMode() { try { return localStorage.getItem('patient-calendar-view') === 'calendar' ? 'calendar' : 'table' } catch { return 'table' } }

export default function BookingCalendar({ tenantId, info, uid, onBook }) {
  const today = thaiDay()
  const [mode, setMode] = useState(initialMode)
  const [month, setMonth] = useState(today.slice(0, 7))
  const [range, setRange] = useState(() => initialMode() === 'calendar' ? monthRange(today.slice(0, 7)) : [today, thaiDay(new Date(`${today}T12:00:00+07:00`).getTime() + 13 * 86400000)])
  const [selected, setSelected] = useState(today)
  const [route, setRoute] = useState('')
  const [onlyJoin, setOnlyJoin] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const key = `${tenantId}/${range.join('/')}`
  useEffect(() => {
    let active = true
    let sequence = 0
    const load = async () => {
      const request = ++sequence
      try {
        const { data, error: failure } = await supabase.rpc('patient_booking_calendar', { p_muni: tenantId, p_from: range[0], p_to: range[1] })
        if (!active || request !== sequence) return
        if (failure) throw failure
        setResult({ key, data }); setError('')
      } catch (failure) { if (active && request === sequence) { setResult(null); setError(failure.message || 'โหลดตารางไม่สำเร็จ') } }
    }
    load()
    const update = () => { if (document.visibilityState === 'visible') load() }
    const timer = window.setInterval(update, 60000)
    window.addEventListener('focus', update)
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', update) }
  }, [tenantId, range, key, refresh])
  function switchMode(value) { setMode(value); if (value === 'calendar') setRange(monthRange(month)); try { localStorage.setItem('patient-calendar-view', value) } catch { /* Storage may be disabled. */ } }
  function changeMonth(value) { if (!value) return; setMonth(value); setRange(monthRange(value)); setSelected(`${value}-01`) }
  const data = result?.key === key ? result.data : null
  const days = data?.days || []
  const matches = t => (!route || t.route_id === route) && (!onlyJoin || t.joinable)
  const visibleDays = days.filter(d => !onlyJoin || d.trips.some(matches))
  const picked = days.find(d => d.date === selected)
  const monthDays = days.filter(d => d.date.startsWith(month))
  const offset = monthDays.length ? new Date(`${monthDays[0].date}T12:00:00Z`).getUTCDay() : 0
  const action = (text, seed) => uid ? <button className={primaryClass} onClick={() => onBook(seed)}>{text}</button> : <Link className={`${buttonClass} inline-flex items-center`} to="/auth" state={{ from: '/patient-transport' }}>เข้าสู่ระบบเพื่อขอจอง</Link>
  const tripDetails = t => <><strong className="block">{t.route_label}</strong><p>เริ่มรับประมาณ {time(t.pickup_at)}{t.return_mode && ` · ${RETURN_MODES[t.return_mode]}`}</p>{t.return_mode && t.return_mode !== 'one_way' && <p>รับกลับประมาณ {time(t.return_at)}</p>}{t.people !== null && <p>ผู้เดินทางรวมผู้ติดตาม {t.people} คน · เหลือ {t.remaining} ที่นั่ง</p>}{t.state && <p className="mt-2 font-semibold text-sky-900">{TRIP_STATUS[t.state]}</p>}{['delayed', 'contact'].includes(t.public_notice) && <p className="my-2 rounded-lg bg-amber-50 p-2 font-semibold">{t.public_notice === 'delayed' ? 'รถล่าช้า · กรุณาดูเวลาประมาณการล่าสุด' : 'กรุณาติดต่อเจ้าหน้าที่ก่อนเดินทาง'}</p>}{(t.estimated_pickup_at || t.estimated_return_at) && <p className="my-2 rounded-lg bg-sky-50 p-2">แจ้งเวลาล่าสุด: {t.estimated_pickup_at && `เริ่มรับ ${time(t.estimated_pickup_at)}`}{t.estimated_return_at && ` · รับกลับ ${time(t.estimated_return_at)}`} (ประมาณการ)</p>}<p className="my-2 font-semibold">{tripLabels[t.status]}</p>{t.joinable && action('ขอร่วมเที่ยวนี้', { day: t.date, route_id: t.route_id, return_mode: t.return_mode, back: t.return_at ? time(t.return_at) : '', share: true, requested_trip_id: t.id })}</>
  const freeDetails = d => !onlyJoin && d.free.length > 0 && <div className="space-y-2 rounded-xl bg-emerald-50 p-3"><strong>ช่วงรถว่างตามแผน</strong>{d.free.map((f, i) => <p key={i}>{time(f.start)}–{time(f.end)}</p>)}{action('ขอจองวันนี้', { day: d.date, ...(route ? { route_id: route } : {}) })}</div>
  return <section className="space-y-4" aria-label="ตารางรถสำหรับประชาชน">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">ดูตารางรถ / ขอร่วมเที่ยว</h2><div className="flex flex-wrap gap-2" aria-label="มุมมองตารางรถ">{[['calendar', 'ปฏิทิน'], ['table', 'ตาราง']].map(([id, label]) => <button key={id} aria-pressed={mode === id} className={mode === id ? primaryClass : buttonClass} onClick={() => switchMode(id)}>{label}</button>)}</div></div>
    <p className="text-sm text-slate-600">เวลาและที่นั่งเป็นข้อมูลจากเที่ยวที่ยืนยันแล้ว คำขอที่รอยืนยันยังไม่กันที่นั่ง ช่วงว่างต้องเผื่อเวลาไปรับ ส่ง และกลับพื้นที่ เจ้าหน้าที่ตรวจคิวก่อนยืนยันทุกครั้ง</p>
    <div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={() => { switchMode('table'); setMonth(today.slice(0, 7)); setSelected(today); setRange([today, thaiDay(new Date(`${today}T12:00:00+07:00`).getTime() + 13 * 86400000)]) }}>ตั้งแต่วันนี้ 14 วัน</button></div>
    <label className="block min-w-0">เดือน<input type="month" className={inputClass} value={month} onChange={e => changeMonth(e.target.value)} /></label>
    <details className="rounded-xl border border-slate-200 px-3"><summary className="flex min-h-11 cursor-pointer items-center font-semibold">กรองวันที่และเส้นทาง{route || range.join() !== monthRange(month).join() ? " · มีตัวกรอง" : ""}</summary><div className="space-y-3 pb-3"><div className="grid min-w-0 gap-3 sm:grid-cols-2"><label className="min-w-0">ตั้งแต่วันที่<input type="date" className={inputClass} value={range[0]} onChange={e => { setRange([e.target.value, range[1]]); if (e.target.value) { setMonth(e.target.value.slice(0, 7)); setSelected(e.target.value) } }} /></label><label className="min-w-0">ถึงวันที่<input type="date" className={inputClass} value={range[1]} onChange={e => setRange([range[0], e.target.value])} /></label></div>
    <label className="block">โรงพยาบาล / เส้นทาง<select className={inputClass} value={route} onChange={e => setRoute(e.target.value)}><option value="">ทุกเส้นทาง</option>{info.routes?.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label></div></details>
    <div className="flex flex-wrap items-center justify-between gap-2"><label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5" checked={onlyJoin} onChange={e => setOnlyJoin(e.target.checked)} />เฉพาะเที่ยวที่ร่วมได้</label><button className={buttonClass} onClick={() => { setError(''); setRefresh(v => v + 1) }}>อัปเดตตารางรถ</button></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3">{error}</p>}
    {!data && !error && <p role="status">กำลังโหลดตารางรถ…</p>}
    {data && !data.enabled && <p>ยังไม่เปิดเผยตารางรถ กรุณาติดต่อเจ้าหน้าที่</p>}
    {data?.enabled && <>
      <p className="text-xs text-slate-500">ข้อมูลล่าสุด {time(data.as_of)} · อัปเดตทุก 1 นาทีเมื่อเปิดหน้านี้</p>
      {mode === 'calendar' ? <>
        <p className="text-sm">เขียว: มีช่วงว่าง · ฟ้า: ร่วมเที่ยวได้ · เทา: ติดภารกิจ/งดบริการ กดวันที่เพื่อดูรายละเอียด</p>
        {/* 312px available at a 320px viewport; seven date targets remain >=44px. */}
        <div className="-mx-3 grid grid-cols-7 sm:mx-0" aria-label="ปฏิทินรายเดือน">
          {['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'].map(d => <div key={d} className="py-2 text-center text-xs">{d}</div>)}
          {Array.from({ length: offset }, (_, i) => <div key={`blank-${i}`} />)}
          {monthDays.map(d => { const joins = d.trips.some(t => t.joinable && matches(t)); const status = joins ? 'ร่วมได้' : d.free.length ? 'มีช่วงว่าง' : d.status === 'open' ? 'ติดภารกิจ' : dayLabels[d.status]; const filtered = onlyJoin && !joins; return <button key={d.date} aria-label={`${dateLabel(d.date)} ${status}`} aria-pressed={selected === d.date} onClick={() => setSelected(d.date)} className={`min-h-[64px] min-w-0 border p-0.5 text-center ${selected === d.date ? 'border-sky-800 ring-2 ring-inset ring-sky-800' : 'border-white'} ${filtered ? 'bg-slate-50 text-slate-400' : joins ? 'bg-sky-100 text-sky-950' : d.free.length ? 'bg-emerald-50 text-emerald-950' : 'bg-slate-100 text-slate-700'}`}><span className="block font-bold">{Number(d.date.slice(-2))}</span><span className="block break-words text-[10px] leading-4">{status}</span></button> })}
        </div>
        {range[1]?.slice(0, 7) !== month && <p className="text-sm">ปฏิทินแสดงเดือนที่เลือก เปลี่ยนเดือนหรือเลือก “ตาราง” เพื่อดูช่วงวันที่ทั้งหมด</p>}
        {picked ? <div className="space-y-3 rounded-2xl border border-slate-200 p-3"><h3 className="font-bold">{dateLabel(picked.date)} · {dayLabels[picked.status]}</h3>{freeDetails(picked)}{picked.trips.filter(matches).map(t => <article key={t.id} className="rounded-xl border border-slate-200 p-3">{tripDetails(t)}</article>)}{!picked.trips.filter(matches).length && <p className="text-sm">ไม่มีเที่ยวตรงกับตัวกรองในวันนี้</p>}</div> : <p>เลือกวันที่ในปฏิทินเพื่อดูรายละเอียด</p>}
      </> : <>
        <table className="block w-full table-fixed sm:table"><caption className="sr-only">เที่ยวรถและช่วงว่างเรียงตามวัน</caption><thead className="hidden sm:table-header-group"><tr><th className="w-1/4 p-3 text-left">วันเดินทาง</th><th className="p-3 text-left">เที่ยวรถ / ช่วงว่าง / ขอจอง</th></tr></thead><tbody className="block sm:table-row-group">{visibleDays.map(d => <tr key={d.date} className="mb-3 block rounded-xl border border-slate-200 sm:table-row"><th scope="row" className="block p-3 text-left align-top sm:table-cell">{dateLabel(d.date)}<span className="block text-sm font-normal">{dayLabels[d.status]}</span></th><td className="block space-y-3 p-3 pt-0 sm:table-cell sm:pt-3">{d.trips.filter(matches).map(t => <article key={t.id} className="rounded-xl bg-slate-50 p-3">{tripDetails(t)}</article>)}{freeDetails(d)}{!d.free.length && !d.trips.filter(matches).length && <p>ไม่มีช่วงว่างหรือเที่ยวตรงกับตัวกรอง</p>}</td></tr>)}</tbody></table>
        {!visibleDays.length && <p>ไม่มีเที่ยวตรงกับตัวกรองในช่วงวันที่เลือก</p>}
      </>}
    </>}
  </section>
}
