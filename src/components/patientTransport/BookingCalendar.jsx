import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { buttonClass, primaryClass, inputClass, thaiDay, RETURN_MODES, TRIP_STATUS } from '../../lib/patientBooking'

// คนใช้หน้านี้คือผู้ป่วย ผู้สูงอายุ และญาติที่ใช้มือถือไม่คล่อง จึงยึด 3 ข้อ
// (1) ตอบคำถามเดียวที่เขาเปิดหน้านี้มาถาม — "วันไหนจองรถได้" — ให้เห็นทันทีโดยไม่ต้องตั้งค่าอะไรก่อน
//     ของเดิมต้องเลื่อนผ่านปุ่มกับคำอธิบาย 790px กว่าจะเจอข้อมูลบรรทัดแรกบนจอมือถือ
// (2) วันที่ทำอะไรไม่ได้ (วันหยุด/จองไม่ทัน) ไม่ปนอยู่ในรายการหลัก ยุบไว้ให้กดดูแทน
//     ของเดิมแสดงครบ 14 วันเท่ากันหมด การ์ด "ไม่มีช่วงว่าง" กินที่เท่ากับวันที่จองได้จริง
// (3) ใช้ภาษาพูด ไม่ใช่ศัพท์ระบบ — "จองไม่ทันแล้ว" ไม่ใช่ "พ้นกำหนดจองล่วงหน้า"
const dayLabels = { past: 'ผ่านมาแล้ว', unavailable: 'รถไม่พร้อมให้บริการ', unverified: 'ยังไม่เปิดให้จองวันนี้', closed: 'วันหยุด ไม่มีรถ', lead_time: 'จองไม่ทันแล้ว ต้องจองล่วงหน้า', issue: 'มีเหตุขัดข้อง', open: 'จองได้' }
const tripLabels = { joinable: 'ขอนั่งไปด้วยได้', full: 'ที่นั่งเต็มแล้ว', busy: 'เที่ยวนี้รับเพิ่มไม่ได้', completed: 'ไปแล้ว', issue: 'มีเหตุขัดข้อง' }
const WINDOW_DAYS = 14
const time = value => value ? new Date(value).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }) : '—'
// เที่ยงวันตามเวลาไทยกันวันเคลื่อนตอนแปลงโซนเวลา ใช้กับทุกป้ายวันที่ในไฟล์นี้
const noon = day => new Date(`${day}T12:00:00+07:00`)
const dateLabel = day => noon(day).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
const shortLabel = day => noon(day).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
const dayName = day => noon(day).toLocaleDateString('th-TH', { weekday: 'long' })
// ชื่อเดือนภาษาไทย + พ.ศ. แทนช่อง <input type="month"> ที่ขึ้นว่า "September 2026"
// ช่องนั้นใช้ภาษาและปฏิทินของเครื่อง สั่งให้เป็นไทยไม่ได้ ชาวบ้านอ่านแล้วไม่ตรงกับ 2569 ที่อยู่ข้างล่าง
const monthLabel = month => noon(`${month}-01`).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })
const addDays = (day, step) => thaiDay(noon(day).getTime() + step * 86400000)
function monthRange(month) {
  const [year, m] = month.split('-').map(Number)
  return [`${month}-01`, `${month}-${new Date(Date.UTC(year, m, 0)).getUTCDate()}`]
}
function shiftMonth(month, step) {
  const [year, m] = month.split('-').map(Number)
  const moved = new Date(Date.UTC(year, m - 1 + step, 1))
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, '0')}`
}
function initialMode() { try { return localStorage.getItem('patient-calendar-view') === 'calendar' ? 'calendar' : 'table' } catch { return 'table' } }

export default function BookingCalendar({ tenantId, info, uid, onBook }) {
  const today = thaiDay()
  const [mode, setMode] = useState(initialMode)
  const [month, setMonth] = useState(today.slice(0, 7))
  const [range, setRange] = useState(() => initialMode() === 'calendar' ? monthRange(today.slice(0, 7)) : [today, addDays(today, WINDOW_DAYS - 1)])
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
  function switchMode(value) {
    setMode(value)
    setRange(value === 'calendar' ? monthRange(month) : [today, addDays(today, WINDOW_DAYS - 1)])
    try { localStorage.setItem('patient-calendar-view', value) } catch { /* Storage may be disabled. */ }
  }
  // เลื่อนทีละ 14 วันด้วยปุ่มเดียว แทนการให้ชาวบ้านกรอกช่วงวันที่เอง (ช่องวันที่ยังอยู่ใต้ "ดูวันอื่น")
  function moveWindow(step) {
    const moved = addDays(range[0], step * WINDOW_DAYS)
    const from = moved < today ? today : moved
    setRange([from, addDays(from, WINDOW_DAYS - 1)])
    setMonth(from.slice(0, 7)); setSelected(from)
  }
  function changeMonth(value) { if (!value) return; setMonth(value); setRange(monthRange(value)); setSelected(`${value}-01`) }
  const data = result?.key === key ? result.data : null
  const days = data?.days || []
  const matches = t => (!route || t.route_id === route) && (!onlyJoin || t.joinable)
  const dayTrips = d => d.trips.filter(matches)
  // "ทำอะไรได้" = จองช่วงว่างได้ หรือมีเที่ยวให้ดู/ขอนั่งไปด้วย — วันที่เหลือไม่ต้องกินพื้นที่ในรายการหลัก
  const canDo = d => (!onlyJoin && d.free.length > 0) || dayTrips(d).length > 0
  const listDays = days.filter(canDo)
  const quietDays = days.filter(d => !canDo(d))
  const firstFree = days.find(d => d.free.length > 0)
  const firstJoin = days.flatMap(d => dayTrips(d).filter(t => t.joinable))[0]
  const picked = days.find(d => d.date === selected)
  const monthDays = days.filter(d => d.date.startsWith(month))
  const offset = monthDays.length ? new Date(`${monthDays[0].date}T12:00:00Z`).getUTCDay() : 0
  const filtered = !!route || onlyJoin || (mode === 'table' && range[0] !== today)
  const action = (text, seed, compact) => uid
    ? <button className={compact ? `${primaryClass} shrink-0` : `${primaryClass} w-full text-base sm:w-auto`} aria-label={text} onClick={() => onBook(seed)}>{compact ? 'จอง' : text}</button>
    : <Link className={compact ? `${buttonClass} inline-flex shrink-0 items-center` : `${buttonClass} inline-flex w-full items-center justify-center text-base sm:w-auto`} to="/auth" state={{ from: '/patient-transport' }}>เข้าสู่ระบบ{compact ? '' : 'เพื่อขอจอง'}</Link>
  const tripDetails = t => <>
    <strong className="block text-base">{t.route_label}</strong>
    <p>ออกรับประมาณ {time(t.pickup_at)} น.{t.return_mode && ` · ${RETURN_MODES[t.return_mode]}`}</p>
    {t.return_mode && t.return_mode !== 'one_way' && <p>รับกลับประมาณ {time(t.return_at)} น.</p>}
    {t.remaining !== null && t.remaining !== undefined && <p>เหลือ {t.remaining} ที่นั่ง</p>}
    {['delayed', 'contact'].includes(t.public_notice) && <p className="my-2 rounded-lg bg-amber-50 p-2 font-semibold">{t.public_notice === 'delayed' ? 'รถล่าช้า · ดูเวลาล่าสุดด้านล่าง' : 'กรุณาติดต่อเจ้าหน้าที่ก่อนเดินทาง'}</p>}
    {(t.estimated_pickup_at || t.estimated_return_at) && <p className="my-2 rounded-lg bg-sky-50 p-2">เวลาล่าสุด: {t.estimated_pickup_at && `ออกรับ ${time(t.estimated_pickup_at)} น.`}{t.estimated_return_at && ` · รับกลับ ${time(t.estimated_return_at)} น.`} (ประมาณ)</p>}
    <p className="my-2 font-semibold text-sky-900">{tripLabels[t.status]}{t.state && t.state !== 'confirmed' ? ` · ${TRIP_STATUS[t.state]}` : ''}</p>
    {t.joinable && action('ขอนั่งรถคันนี้ไปด้วย', { day: t.date, route_id: t.route_id, return_mode: t.return_mode, back: t.return_at ? time(t.return_at) : '', share: true, requested_trip_id: t.id })}
  </>
  const freeDetails = d => !onlyJoin && d.free.length > 0 && <div className="space-y-2 rounded-xl bg-emerald-50 p-3">
    <strong>เวลาที่รถว่าง</strong>
    {d.free.map((f, i) => <p key={i}>{time(f.start)}–{time(f.end)} น.</p>)}
    {action(`จองวันที่ ${shortLabel(d.date)}`, { day: d.date, ...(route ? { route_id: route } : {}) })}
  </div>
  // วันที่ว่างเฉยๆ ไม่มีอะไรให้อ่าน ใช้บรรทัดเดียวพอ — การ์ดเต็มใบเก็บไว้ให้วันที่มีเที่ยวรถจริง
  // 10 วันว่างติดกันแบบการ์ดเต็มใบสูงรวมกว่า 2,000px ทั้งที่เนื้อหาซ้ำกันทุกใบ
  const dayCard = d => {
    const trips = dayTrips(d)
    if (!trips.length) return <li key={d.date} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 p-3">
      <div className="min-w-0">
        <strong className="block">{dayName(d.date)}ที่ {dateLabel(d.date)}</strong>
        <span className="block text-sm text-slate-600">รถว่าง {d.free.map(f => `${time(f.start)}–${time(f.end)}`).join(' · ')} น.</span>
      </div>
      {action(`จองวันที่ ${shortLabel(d.date)}`, { day: d.date, ...(route ? { route_id: route } : {}) }, true)}
    </li>
    return <li key={d.date} className="space-y-3 rounded-2xl border border-slate-200 p-3">
      <h3 className="text-base font-bold">{dayName(d.date)}ที่ {dateLabel(d.date)}{d.status !== 'open' && <span className="block text-sm font-normal text-slate-600">{dayLabels[d.status]}</span>}</h3>
      {freeDetails(d)}
      {trips.map(t => <article key={t.id} className="rounded-xl bg-slate-50 p-3">{tripDetails(t)}</article>)}
    </li>
  }
  return <section className="space-y-4" aria-label="ตารางรถสำหรับประชาชน">
    <h2 className="text-xl font-bold">วันที่จองรถได้</h2>
    {error && <div role="alert" className="space-y-2 rounded-xl bg-red-50 p-3"><p>{error}</p><button className={buttonClass} onClick={() => { setError(''); setRefresh(v => v + 1) }}>ลองอีกครั้ง</button></div>}
    {!data && !error && <p role="status">กำลังโหลดตารางรถ…</p>}
    {data && !data.enabled && <p>ยังไม่เปิดเผยตารางรถ กรุณาติดต่อเจ้าหน้าที่</p>}
    {data?.enabled && <>
      {/* คำตอบสำเร็จรูป — ระบบหาวันที่จองได้ให้เลย ไม่ต้องให้ชาวบ้านไล่อ่านเอง */}
      <div className="space-y-3 rounded-2xl border-2 border-sky-800 bg-sky-50 p-4">
        {firstFree ? <>
          <p className="font-semibold text-sky-900">จองรถได้เร็วที่สุด</p>
          <p className="text-xl font-bold">{dayName(firstFree.date)}ที่ {dateLabel(firstFree.date)}</p>
          {action(`จองวันที่ ${shortLabel(firstFree.date)}`, { day: firstFree.date, ...(route ? { route_id: route } : {}) })}
        </> : <>
          <p className="font-bold">ช่วงวันที่กำลังดูอยู่นี้ ยังไม่มีวันที่จองได้</p>
          <button className={`${buttonClass} w-full text-base sm:w-auto`} onClick={() => moveWindow(1)}>ดู {WINDOW_DAYS} วันถัดไป</button>
        </>}
        {firstJoin && <p className="text-sm">มีรถไป{firstJoin.route_label} วันที่ {shortLabel(firstJoin.date)} ขอนั่งไปด้วยได้ ดูในรายการข้างล่าง</p>}
        {info.contact_phone && <p className="text-sm">ถามเจ้าหน้าที่ <a className="font-bold underline" href={`tel:${info.contact_phone}`}>{info.contact_phone}</a></p>}
      </div>
      {mode === 'calendar' ? <>
        <div className="flex items-center justify-between gap-2">
          <button className={buttonClass} onClick={() => changeMonth(shiftMonth(month, -1))}>‹ ก่อนหน้า</button>
          <strong className="text-base">{monthLabel(month)}</strong>
          <button className={buttonClass} onClick={() => changeMonth(shiftMonth(month, 1))}>ถัดไป ›</button>
        </div>
        <p className="text-sm">เขียว: จองได้ · ฟ้า: ขอนั่งไปด้วยได้ · เทา: ไม่มีรถ — กดที่วันเพื่อดูรายละเอียด</p>
        {/* 312px available at a 320px viewport; seven date targets remain >=44px. */}
        <div className="-mx-3 grid grid-cols-7 sm:mx-0" aria-label="ปฏิทินรายเดือน">
          {['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'].map(d => <div key={d} className="py-2 text-center text-xs">{d}</div>)}
          {Array.from({ length: offset }, (_, i) => <div key={`blank-${i}`} />)}
          {monthDays.map(d => { const joins = d.trips.some(t => t.joinable && matches(t)); const status = joins ? 'นั่งไปด้วยได้' : d.free.length ? 'จองได้' : d.status === 'open' ? 'รถไม่ว่าง' : dayLabels[d.status]; const dim = onlyJoin && !joins; return <button key={d.date} aria-label={`${dateLabel(d.date)} ${status}`} aria-pressed={selected === d.date} onClick={() => setSelected(d.date)} className={`min-h-[64px] min-w-0 border p-0.5 text-center ${selected === d.date ? 'border-sky-800 ring-2 ring-inset ring-sky-800' : 'border-white'} ${dim ? 'bg-slate-50 text-slate-400' : joins ? 'bg-sky-100 text-sky-950' : d.free.length ? 'bg-emerald-50 text-emerald-950' : 'bg-slate-100 text-slate-700'}`}><span className="block font-bold">{Number(d.date.slice(-2))}</span><span className="block break-words text-[10px] leading-4">{status}</span></button> })}
        </div>
        {picked ? <div className="space-y-3 rounded-2xl border border-slate-200 p-3"><h3 className="font-bold">{dayName(picked.date)}ที่ {dateLabel(picked.date)} · {dayLabels[picked.status]}</h3>{freeDetails(picked)}{dayTrips(picked).map(t => <article key={t.id} className="rounded-xl border border-slate-200 p-3">{tripDetails(t)}</article>)}{!dayTrips(picked).length && !(!onlyJoin && picked.free.length) && <p className="text-sm">วันนี้ไม่มีรถว่าง</p>}</div> : <p>กดที่วันในปฏิทินเพื่อดูรายละเอียด</p>}
      </> : <>
        <div className="flex items-center justify-between gap-2">
          <button className={buttonClass} disabled={range[0] <= today} onClick={() => moveWindow(-1)}>‹ ก่อนหน้า</button>
          <strong className="text-center text-sm">{shortLabel(range[0])} – {dateLabel(range[1])}</strong>
          <button className={buttonClass} onClick={() => moveWindow(1)}>ถัดไป ›</button>
        </div>
        {listDays.length ? <ul className="space-y-3">{listDays.map(dayCard)}</ul> : <p className="rounded-xl border border-slate-200 p-4">ช่วงวันที่นี้ไม่มีรถว่างและไม่มีเที่ยวให้ร่วม</p>}
        {quietDays.length > 0 && <details className="rounded-xl border border-slate-200 px-3">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold">วันที่จองไม่ได้ {quietDays.length} วัน</summary>
          <ul className="space-y-1 pb-3 text-sm">{quietDays.map(d => <li key={d.date}>{dateLabel(d.date)} · {d.status === 'open' ? 'รถไม่ว่าง' : dayLabels[d.status]}</li>)}</ul>
        </details>}
      </>}
    </>}
    {/* ตัวควบคุมอยู่นอกบล็อกข้อมูล — ถ้าอยู่ข้างใน กล่องที่ผู้ใช้เปิดค้างไว้จะถูกสร้างใหม่และหุบเองทุกครั้งที่เปลี่ยนช่วงวัน */}
    {(!data || data.enabled) && <>
      <details className="rounded-xl border border-slate-200 px-3">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">ดูวันอื่น / เลือกโรงพยาบาล{filtered ? ' · มีตัวกรอง' : ''}</summary>
        <div className="space-y-3 pb-3">
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <label className="min-w-0">ตั้งแต่วันที่<input type="date" className={inputClass} value={range[0]} onChange={e => { if (e.target.value) { setRange([e.target.value, range[1]]); setMonth(e.target.value.slice(0, 7)); setSelected(e.target.value) } }} /></label>
            <label className="min-w-0">ถึงวันที่<input type="date" className={inputClass} value={range[1]} onChange={e => { if (e.target.value) setRange([range[0], e.target.value]) }} /></label>
          </div>
          <label className="block">โรงพยาบาล / เส้นทาง<select className={inputClass} value={route} onChange={e => setRoute(e.target.value)}><option value="">ทุกเส้นทาง</option>{info.routes?.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5" checked={onlyJoin} onChange={e => setOnlyJoin(e.target.checked)} />เฉพาะเที่ยวที่ร่วมได้</label>
          <div className="flex flex-wrap gap-2" aria-label="มุมมองตารางรถ">{[['calendar', 'ปฏิทิน'], ['table', 'ตาราง']].map(([id, label]) => <button key={id} aria-pressed={mode === id} className={mode === id ? primaryClass : buttonClass} onClick={() => switchMode(id)}>{label}</button>)}</div>
        </div>
      </details>
      {data?.enabled && <p className="text-xs text-slate-500">ข้อมูลล่าสุด {time(data.as_of)} น. · หน้านี้อัปเดตเองทุก 1 นาที</p>}
      <details className="rounded-xl border border-slate-200 px-3">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">ข้อควรรู้ก่อนจอง</summary>
        <p className="pb-3 text-sm text-slate-600">เวลาและที่นั่งเป็นข้อมูลจากเที่ยวที่ยืนยันแล้ว คำขอที่รอยืนยันยังไม่กันที่นั่ง ช่วงว่างต้องเผื่อเวลาไปรับ ส่ง และกลับพื้นที่ เจ้าหน้าที่ตรวจคิวก่อนยืนยันทุกครั้ง</p>
      </details>
    </>}
  </section>
}
