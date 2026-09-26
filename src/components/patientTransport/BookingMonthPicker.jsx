import { buttonClass, clockOf, DAY_BLOCKED, freeTimeChoices } from '../../lib/patientBooking'

const date = value => new Date(`${value}T12:00:00+07:00`)
const label = value => date(value).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' })
export default function BookingMonthPicker({ month, onMonth, days, selected, onSelect, onJoin, info, draft, first, last, loading, failed, onReload, staffEntry }) {
  const start = `${month}-01`
  const total = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate()
  const offset = (date(start).getUTCDay() + 6) % 7
  const move = n => { const d = date(start); d.setUTCMonth(d.getUTCMonth() + n); onMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`) }
  const status = day => {
    if (!day) return { text: failed ? 'โหลดไม่ได้' : 'รอข้อมูล', style: 'bg-slate-50 text-slate-500' }
    if (day.status !== 'open') return { text: day.status === 'closed' ? 'หยุด' : 'จองไม่ได้', style: 'bg-slate-100 text-slate-500' }
    if (day.trips.some(t => t.joinable)) return { text: 'ร่วมได้', style: 'bg-sky-50 text-sky-900' }
    const available = (info.routes || []).some(r => freeTimeChoices({ ...draft, route_id: r.id, return_mode: 'one_way', back: '' }, info, day).length)
    if (available) return { text: day.trips.length ? 'มีเที่ยว' : 'รถว่าง', style: 'bg-emerald-50 text-emerald-900' }
    return { text: day.trips.length ? 'เต็ม' : 'ไม่มีเวลา', style: 'bg-rose-50 text-rose-900' }
  }
  const chosen = days.find(d => d.date === selected)
  return <div className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={buttonClass} disabled={month <= first.slice(0, 7)} onClick={() => move(-1)}>← เดือนก่อน</button>
      <button type="button" className={buttonClass} disabled={month >= last.slice(0, 7)} onClick={() => move(1)}>เดือนถัดไป →</button>
      <button type="button" className={buttonClass} onClick={() => onMonth(first.slice(0, 7))}>เดือนนี้</button>
    </div>
    <div className="grid grid-cols-2 gap-2">
      <label>เดือน<select aria-label="เดือน" value={month.slice(5)} onChange={e => onMonth(`${month.slice(0, 4)}-${e.target.value}`)} className="block min-h-11 w-full min-w-0 rounded-lg border bg-white px-2">
        {Array.from({ length: 12 }, (_, i) => { const m = String(i + 1).padStart(2, '0'), value = `${month.slice(0, 4)}-${m}`; return <option key={m} value={m} disabled={value < first.slice(0, 7) || value > last.slice(0, 7)}>{new Date(2026, i, 1).toLocaleDateString('th-TH', { month: 'long' })}</option> })}
      </select></label>
      <label>ปี พ.ศ.<select aria-label="ปี พ.ศ." value={month.slice(0, 4)} onChange={e => { const value = `${e.target.value}-${month.slice(5)}`; onMonth(value < first.slice(0, 7) ? first.slice(0, 7) : value > last.slice(0, 7) ? last.slice(0, 7) : value) }} className="block min-h-11 w-full rounded-lg border bg-white px-2">
        {Array.from({ length: Number(last.slice(0, 4)) - Number(first.slice(0, 4)) + 1 }, (_, i) => Number(first.slice(0, 4)) + i).map(y => <option key={y} value={y}>{y + 543}</option>)}
      </select></label>
    </div>
    <p className="font-semibold">{date(start).toLocaleDateString('th-TH', { month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' })}</p>
    {loading && <p role="status">กำลังดูวันที่รถว่าง…</p>}
    {failed && <div role="alert">ตรวจวันว่างไม่สำเร็จ <button type="button" className={buttonClass} onClick={onReload}>ลองใหม่</button></div>}
    <div className="hidden min-[440px]:grid grid-cols-7 gap-1 text-center text-xs" aria-hidden="true">{['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'].map(d => <span key={d}>{d}</span>)}</div>
    <div role="group" aria-label="วันที่ไปโรงพยาบาล" className="grid grid-cols-4 min-[440px]:grid-cols-7 gap-1">
      {Array.from({ length: offset }, (_, i) => <span key={`blank-${i}`} className="hidden min-[440px]:block" />)}
      {Array.from({ length: total }, (_, i) => {
        const value = `${month}-${String(i + 1).padStart(2, '0')}`
        const day = days.find(d => d.date === value), state = value < first || value > last ? { text: '—', style: 'bg-slate-50 text-slate-400' } : status(day)
        const pending = day?.pending_count || 0
        return <button key={value} type="button" data-calendar-date={value} aria-label={`${label(value)} ${state.text}${pending ? ` รอยืนยัน ${pending} คำขอ` : ''}`} aria-pressed={selected === value}
          disabled={value < first || value > last || loading || !day} onClick={() => onSelect(value)}
          className={`min-h-16 min-w-0 rounded-lg border p-1 text-center disabled:opacity-40 ${state.style} ${selected === value ? 'ring-2 ring-sky-700 border-sky-700' : 'border-slate-200'}`}>
          <span className="block text-xs min-[440px]:hidden">{['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'][date(value).getUTCDay()]}</span>
          <span className="block font-bold">{i + 1}</span><span className="block text-[10px] sm:text-xs">{state.text}</span>
          {pending > 0 && <span className="block text-[10px] font-semibold text-amber-900">รอ {pending}</span>}
          {!!day?.trips.length && <span className="block text-[10px]">{day.trips.length} เที่ยว</span>}
          <span className="hidden truncate text-xs sm:block">{day?.trips[0]?.route_label}</span>
        </button>
      })}
    </div>
    <p className="text-xs text-slate-600">เขียว: รถว่าง/มีเวลาว่าง · ฟ้า: ขอร่วมได้ · แดง: เต็ม · ตัวเลข “รอ”: คำขอที่เจ้าหน้าที่ยังไม่ยืนยัน</p>
    <p className="text-sm">จองล่วงหน้าได้ถึง {label(last)} · คำขอรอยืนยันยังไม่กันที่นั่ง ส่วนรายการเที่ยวด้านล่างเป็นเที่ยวที่ยืนยันแล้ว</p>
    <details><summary className="min-h-11 cursor-pointer py-2">เลือกวันอื่น</summary><label>วันที่นัดแพทย์<input type="date" className="block min-h-11 w-full rounded-lg border px-2" min={first} max={last} value={selected} onChange={e => { if (e.target.value) onSelect(e.target.value) }} /></label></details>
    {chosen && <div className="space-y-3 rounded-xl bg-slate-50 p-3" aria-label="เที่ยวรถในวันที่เลือก">
      <strong>{label(selected)}</strong>
      {chosen.status !== 'open' && <p>{DAY_BLOCKED[chosen.status] || 'ยังไม่เปิดรับจองวันนี้'}</p>}
      {chosen.pending_count > 0 && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">มี {chosen.pending_count} คำขอรอเจ้าหน้าที่ยืนยัน · ยังไม่กันที่นั่ง</p>}
      {!chosen.trips.length && <p>ยังไม่มีเที่ยวที่ยืนยันในวันนี้</p>}
      {chosen.trips.map(t => <article key={t.id} className="space-y-2 rounded-lg border bg-white p-3">
        <p className="font-semibold break-words">{t.route_label}</p>
        <p className="text-sm">เริ่มรับ {clockOf(t.estimated_pickup_at || t.pickup_at)} น.{t.people != null && ` · ${t.people} คน · เหลือ ${t.remaining} ที่นั่ง`}</p>
        <p className="text-sm">{t.status === 'full' ? 'เที่ยวนี้เต็ม' : t.joinable ? 'เปิดให้ขอร่วมเที่ยว' : 'ไม่เปิดร่วมเที่ยว'}</p>
        {t.joinable && <button type="button" className={buttonClass} onClick={() => onJoin(t)}>ขอร่วมเที่ยวนี้</button>}
      </article>)}
      {(chosen.status === 'open' || staffEntry) && <button type="button" className={buttonClass} onClick={() => onSelect(selected)}>จองเวลาอื่นในวันนี้</button>}
    </div>}
  </div>
}
