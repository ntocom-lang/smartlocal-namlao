import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CalendarClock, CheckCircle2, ChevronRight, Loader2, MapPin, Phone, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchProfile } from '../lib/profileFetch'
import { useTenant } from '../contexts/TenantContext'
import { useAuth } from '../contexts/AuthContext'
import {
  QUEUE_BOOKING_MODULE_KEY, bangkokToday, bookableDates, bookingStatus, canCancelBooking,
  hhmm, openingText, slotRange, thaiLongDay, thaiShortDay,
} from '../lib/queueBooking'

const SERVICE_COLS = 'id, name, description, location, open_weekdays, start_time, end_time, slot_minutes, per_slot_quota, book_ahead_days'
const BOOKING_COLS = 'id, service_id, booking_date, slot_time, queue_no, status, note, queue_services(name, location, slot_minutes)'

const inp = 'w-full px-3 py-3 text-base text-gray-900 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-transparent'
const primaryBtn = 'flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl px-4 text-base font-bold text-white transition-all active:scale-[0.98] disabled:opacity-50'
const lightBtn = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50'

function StatusPill({ status }) {
  const s = bookingStatus(status)
  return <span className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold" style={{ backgroundColor: s.bg, color: s.color }}>{s.label}</span>
}

/**
 * จองคิวรับบริการ — ฝั่งประชาชน (ต้องล็อกอิน)
 *
 * ขั้นตอน: เลือกบริการ → เลือกวัน → เลือกช่วงเวลา → ยืนยัน (เบอร์โทร + หมายเหตุ) → ได้เลขคิว
 * ตัวตัดสินจริง (โควตา วันเปิด เวลาผ่านแล้ว 1 คนต่อ 1 คิวต่อวัน) อยู่ที่ RPC book_queue_slot — หน้านี้แค่แสดงช่องที่ฐานข้อมูลบอกว่าจองได้
 * และแสดงข้อความภาษาไทยของ RPC ตรงๆ ถ้าถูกปฏิเสธ · ทุกอย่างเขียนผ่าน RPC (ตารางไม่เปิดให้เขียนตรง)
 */
export default function QueueBooking() {
  const navigate = useNavigate()
  const { tenant, isModuleEnabled } = useTenant()
  const { session } = useAuth()
  const uid = session?.user?.id
  const tenantId = tenant?.id
  const moduleOn = !isModuleEnabled || isModuleEnabled(QUEUE_BOOKING_MODULE_KEY)

  const [services, setServices] = useState(null)   // null = ยังไม่โหลด
  const [loadError, setLoadError] = useState('')
  const [bookings, setBookings] = useState([])
  const [view, setView] = useState('home')          // home | book | done
  const [step, setStep] = useState('service')       // service | date | slot | confirm
  const [service, setService] = useState(null)
  const [date, setDate] = useState('')
  const [slots, setSlots] = useState(null)          // null = กำลังโหลด
  const [slotTime, setSlotTime] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [result, setResult] = useState(null)
  const today = bangkokToday()

  // โหลดคิวของฉันใหม่ = เพิ่มตัวนับ (effect ด้านล่างดึงข้อมูลเอง — ไม่เรียก setState ตรงๆ ใน effect)
  const [bookingsKey, setBookingsKey] = useState(0)
  const loadBookings = useCallback(() => setBookingsKey(k => k + 1), [])

  useEffect(() => {
    if (!tenantId || !uid || !moduleOn) return undefined
    let alive = true
    supabase.from('queue_services').select(SERVICE_COLS)
      .eq('municipality_id', tenantId).eq('is_active', true).order('name')
      .then(({ data, error: err }) => {
        if (!alive) return
        if (err) { setLoadError(err.message); setServices([]); return }
        setLoadError('')
        setServices(data ?? [])
      })
    // เบอร์โทรเติมจากโปรไฟล์ (แก้ได้ตอนยืนยัน) — ฝั่งฐานข้อมูลก็ใช้เบอร์โปรไฟล์เป็นค่าสำรองอยู่แล้ว
    fetchProfile(uid).then(({ data }) => {
      if (alive && data?.phone) setPhone(String(data.phone).replace(/\D/g, '').slice(0, 10))
    })
    return () => { alive = false }
  }, [tenantId, uid, moduleOn])

  useEffect(() => {
    if (!uid || !moduleOn) return undefined
    let alive = true
    supabase.from('queue_bookings').select(BOOKING_COLS)
      .eq('citizen_id', uid).order('booking_date', { ascending: false }).order('slot_time', { ascending: false }).limit(100)
      .then(({ data, error: err }) => {
        if (!alive) return
        if (err) { setError(err.message); return }
        setBookings(data ?? [])
      })
    return () => { alive = false }
  }, [uid, moduleOn, bookingsKey])

  // โหลดช่องเวลาเมื่อเลือกบริการ+วันแล้ว
  useEffect(() => {
    if (view !== 'book' || step !== 'slot' || !service || !date) return undefined
    let alive = true
    supabase.rpc('queue_slot_availability', { p_service_id: service.id, p_date: date }).then(({ data, error: err }) => {
      if (!alive) return
      if (err) { setError(err.message); setSlots([]); return }
      setSlots(data ?? [])
    })
    return () => { alive = false }
  }, [view, step, service, date])

  const upcoming = useMemo(() => bookings.filter(b => canCancelBooking(b, today))
    .sort((a, b) => String(a.booking_date).localeCompare(String(b.booking_date)) || String(a.slot_time).localeCompare(String(b.slot_time))), [bookings, today])
  const history = useMemo(() => bookings.filter(b => !upcoming.includes(b)), [bookings, upcoming])
  const dates = useMemo(() => (service ? bookableDates(service, today) : []), [service, today])

  function startBooking() {
    setError(''); setNotice(''); setService(null); setDate(''); setSlotTime(''); setNote('')
    setStep('service'); setView('book')
  }

  function chooseService(s) { setService(s); setDate(''); setSlotTime(''); setError(''); setStep('date') }
  function chooseDate(d) { setDate(d); setSlotTime(''); setSlots(null); setError(''); setStep('slot') }
  function chooseSlot(t) { setSlotTime(t); setError(''); setStep('confirm') }

  function back() {
    setError('')
    if (step === 'confirm') setStep('slot')
    else if (step === 'slot') setStep('date')
    else if (step === 'date') setStep('service')
    else setView('home')
  }

  async function submit() {
    const digits = phone.replace(/\D/g, '')
    if (digits && !/^0\d{8,9}$/.test(digits)) { setError('เบอร์โทรไม่ถูกต้อง (ตัวเลข 9–10 หลัก ขึ้นต้นด้วย 0)'); return }
    setBusy(true); setError('')
    const { data, error: err } = await supabase.rpc('book_queue_slot', {
      p_service_id: service.id, p_date: date, p_slot_time: slotTime,
      p_phone: digits || null, p_note: note.trim() || null,
    })
    setBusy(false)
    if (err) {
      // ช่องเต็ม/ผ่านไปแล้ว: ข้อความจาก RPC ตรงๆ + พากลับไปเลือกช่วงเวลาใหม่ (รายการช่องโหลดซ้ำเอง)
      setError(err.message)
      if (/เต็ม|ผ่านไปแล้ว/.test(err.message)) { setSlots(null); setStep('slot') }
      return
    }
    setResult(data)
    setView('done')
    loadBookings()
  }

  async function cancelBooking(b) {
    if (!window.confirm(`ยกเลิกคิวที่ ${b.queue_no} ของ${b.queue_services?.name ?? 'บริการ'}\n${thaiLongDay(b.booking_date)} เวลา ${hhmm(b.slot_time)} น. ใช่หรือไม่?`)) return
    setBusy(true); setError(''); setNotice('')
    const { error: err } = await supabase.rpc('cancel_queue_booking', { p_booking_id: b.id })
    setBusy(false)
    if (err) { setError(err.message); return }
    setNotice('ยกเลิกคิวแล้ว')
    loadBookings()
  }

  const header = (title, onBack) => (
    <>
      <div className="md:hidden sticky top-0 z-30 bg-gray-50/95 px-4 pb-2 pt-3 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <button onClick={onBack} aria-label="ย้อนกลับ" className="-ml-1 rounded-xl p-2 text-gray-500 transition-colors hover:bg-gray-200/60"><ArrowLeft size={20} /></button>
          <h1 className="text-base font-bold text-gray-800">{title}</h1>
        </div>
      </div>
      <div className="mb-2 hidden items-center gap-3 border-b border-gray-100 px-4 pb-5 pt-8 md:flex">
        <button onClick={onBack} aria-label="ย้อนกลับ" className="-ml-1 rounded-xl p-2 text-gray-500 transition-colors hover:bg-gray-200/60"><ArrowLeft size={20} /></button>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-700"><CalendarClock size={22} /></div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{title}</h1>
          <p className="mt-0.5 text-sm text-gray-500">จองวัน-เวลามารับบริการที่หน่วยงานล่วงหน้า ไม่ต้องรอคิวนาน</p>
        </div>
      </div>
    </>
  )

  // ── โมดูลปิด / ยังไม่ล็อกอิน ───────────────────────────────────────────────
  if (!moduleOn) {
    return (
      <div className="mx-auto max-w-lg pb-28 md:pb-8">
        {header('จองคิวรับบริการ', () => navigate('/'))}
        <div className="px-4 pt-3">
          <div className="rounded-2xl border border-gray-100 bg-white p-6 text-center">
            <CalendarClock size={32} className="mx-auto text-gray-300" />
            <p className="mt-2 text-sm font-semibold text-gray-700">หน่วยงานยังไม่เปิดให้จองคิวออนไลน์</p>
            <p className="mt-1 text-xs text-gray-500">กรุณาติดต่อสอบถามที่หน่วยงานโดยตรง</p>
          </div>
        </div>
      </div>
    )
  }

  if (session === undefined) {
    return <div className="flex justify-center py-24"><Loader2 size={28} className="animate-spin text-gray-300" /></div>
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-lg pb-28 md:pb-8">
        {header('จองคิวรับบริการ', () => navigate('/'))}
        <div className="px-4 pt-3">
          <div className="space-y-3 rounded-2xl border border-blue-100 bg-blue-50 p-5 text-center">
            <p className="text-sm font-bold text-blue-800">เข้าสู่ระบบเพื่อจองคิว</p>
            <p className="text-xs text-blue-600">ระบบใช้บัญชีของท่านเพื่อแสดงคิวของท่านเอง และกันการจองซ้ำ</p>
            <button onClick={() => navigate('/auth', { state: { from: '/queue-booking' } })}
              className="rounded-xl px-6 py-3 text-sm font-bold text-white" style={{ backgroundColor: 'var(--color-primary)' }}>
              เข้าสู่ระบบ
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── จองสำเร็จ ───────────────────────────────────────────────────────────────
  if (view === 'done' && result) {
    const svc = services?.find(s => s.id === service?.id)
    return (
      <div className="mx-auto max-w-lg pb-28 md:pb-8">
        {header('จองคิวสำเร็จ', () => setView('home'))}
        <div className="space-y-4 px-4 pt-3">
          <section aria-label="จองคิวสำเร็จ" className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
            <CheckCircle2 size={44} className="mx-auto text-emerald-600" />
            <h2 className="text-lg font-bold text-gray-800">จองคิวสำเร็จ</h2>
            <div className="rounded-2xl bg-white p-4">
              <p className="text-xs text-gray-500">เลขคิวของท่าน</p>
              <p className="text-5xl font-black" style={{ color: 'var(--color-primary)' }}>{result.queue_no}</p>
            </div>
            <div className="space-y-1 text-sm text-gray-700">
              <p className="font-bold">{result.service_name}</p>
              <p>{thaiLongDay(result.booking_date)}</p>
              <p>เวลา {svc ? slotRange(result.slot_time, svc.slot_minutes) : hhmm(result.slot_time)} น.</p>
              {result.location && <p className="flex items-center justify-center gap-1 text-gray-500"><MapPin size={14} />{result.location}</p>}
            </div>
            <p className="text-xs text-gray-500">แสดงเลขคิวนี้ที่เจ้าหน้าที่เมื่อมาถึง · ยกเลิกได้ที่หน้า &quot;คิวของฉัน&quot; ก่อนวันนัด</p>
          </section>
          <button className={primaryBtn} style={{ backgroundColor: 'var(--color-primary)' }} onClick={() => setView('home')}>ดูคิวของฉัน</button>
          <button className={`${lightBtn} w-full`} onClick={startBooking}>จองคิวบริการอื่นเพิ่ม</button>
        </div>
      </div>
    )
  }

  // ── ขั้นตอนจอง ──────────────────────────────────────────────────────────────
  if (view === 'book') {
    const STEP_NO = { service: 1, date: 2, slot: 3, confirm: 4 }
    return (
      <div className="mx-auto max-w-lg pb-28 md:pb-8">
        {header('จองคิวใหม่', back)}
        <div className="space-y-4 px-4 pt-3">
          <p className="text-xs font-semibold text-gray-400">ขั้นที่ {STEP_NO[step]} จาก 4 · {{ service: 'เลือกบริการ', date: 'เลือกวัน', slot: 'เลือกช่วงเวลา', confirm: 'ยืนยันการจอง' }[step]}</p>
          {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">{error}</div>}

          {step === 'service' && (
            services === null ? (
              <div className="space-y-3">{[0, 1].map(i => <div key={i} className="h-24 animate-pulse rounded-2xl bg-gray-100" />)}</div>
            ) : loadError ? (
              <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">โหลดรายการบริการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</div>
            ) : services.length === 0 ? (
              <div className="rounded-2xl border border-gray-100 bg-white p-6 text-center">
                <CalendarClock size={32} className="mx-auto text-gray-300" />
                <p className="mt-2 text-sm font-semibold text-gray-700">ยังไม่มีบริการที่เปิดให้จองคิว</p>
                <p className="mt-1 text-xs text-gray-500">สอบถามที่หน่วยงานโดยตรง</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {services.map(s => (
                  <li key={s.id}>
                    <button onClick={() => chooseService(s)}
                      className="flex min-h-[72px] w-full items-center gap-3 rounded-2xl border border-gray-100 bg-white p-4 text-left shadow-sm transition-all hover:shadow-md active:scale-[0.99]">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><CalendarClock size={22} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-base font-bold text-gray-800">{s.name}</span>
                        {s.location && <span className="mt-0.5 flex items-center gap-1 text-xs text-gray-500"><MapPin size={12} />{s.location}</span>}
                        <span className="mt-0.5 block text-xs text-gray-500">{openingText(s)}</span>
                      </span>
                      <ChevronRight size={18} className="shrink-0 text-gray-300" />
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}

          {step === 'date' && service && (
            <section className="space-y-3">
              <div className="rounded-2xl border border-gray-100 bg-white p-4">
                <p className="text-sm font-bold text-gray-800">{service.name}</p>
                {service.description && <p className="mt-1 text-xs text-gray-500">{service.description}</p>}
              </div>
              {dates.length === 0 ? (
                <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">บริการนี้ไม่มีวันที่เปิดให้จองในช่วงนี้</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {dates.map(d => (
                    <button key={d} onClick={() => chooseDate(d)}
                      className="min-h-[52px] rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-800 hover:bg-gray-50 active:scale-[0.98]">
                      {thaiShortDay(d)}{d === today && <span className="ml-1 text-xs font-bold" style={{ color: 'var(--color-primary)' }}>วันนี้</span>}
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {step === 'slot' && service && (
            <section className="space-y-3">
              <p className="text-sm font-bold text-gray-800">{service.name} · {thaiLongDay(date)}</p>
              {slots === null ? (
                <div className="grid grid-cols-2 gap-2">{[0, 1, 2, 3].map(i => <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />)}</div>
              ) : slots.length === 0 ? (
                <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">ไม่มีช่วงเวลาให้เลือกในวันนี้</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {slots.map(s => {
                    const left = Math.max(0, Number(s.quota) - Number(s.taken))
                    return (
                      <button key={s.slot_time} disabled={!s.bookable} onClick={() => chooseSlot(s.slot_time)}
                        className="min-h-[64px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-center hover:bg-gray-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-gray-50 disabled:opacity-50">
                        <span className="block text-sm font-bold text-gray-800">{slotRange(s.slot_time, service.slot_minutes)}</span>
                        <span className={`block text-xs font-semibold ${s.bookable ? 'text-emerald-700' : 'text-gray-500'}`}>
                          {s.bookable ? `เหลือ ${left} ที่` : left === 0 ? 'เต็ม' : 'ปิดรับ'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </section>
          )}

          {step === 'confirm' && service && (
            <section className="space-y-4">
              <div className="space-y-1 rounded-2xl border border-gray-100 bg-white p-4 text-sm text-gray-700">
                <p className="text-base font-bold text-gray-800">{service.name}</p>
                <p>{thaiLongDay(date)}</p>
                <p>เวลา {slotRange(slotTime, service.slot_minutes)} น.</p>
                {service.location && <p className="flex items-center gap-1 text-gray-500"><MapPin size={14} />{service.location}</p>}
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-gray-500">เบอร์โทรติดต่อกลับ (แก้ได้)</span>
                <input className={inp} type="tel" inputMode="numeric" maxLength={10} autoComplete="tel"
                  value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, ''))} placeholder="เช่น 0812345678" />
                <span className="mt-1 block text-xs text-gray-500">ชื่อและเบอร์โทรนี้เจ้าหน้าที่ผู้รับผิดชอบบริการใช้ติดต่อเรื่องคิวนี้เท่านั้น</span>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-gray-500">หมายเหตุ / เรื่องที่จะมาติดต่อ (ไม่บังคับ)</span>
                <textarea className={inp} rows={3} maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="เช่น ขอรับเงินเบี้ยยังชีพ" />
              </label>
              <button disabled={busy} onClick={submit} className={primaryBtn} style={{ backgroundColor: 'var(--color-primary)' }}>
                {busy ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />} ยืนยันจองคิว
              </button>
            </section>
          )}
        </div>
      </div>
    )
  }

  // ── หน้าหลัก: ปุ่มจอง + คิวของฉัน ─────────────────────────────────────────────
  const row = (b) => (
    <li key={b.id} className="flex items-start gap-3 rounded-2xl border border-gray-100 bg-white p-3.5 shadow-sm">
      <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-gray-50">
        <span className="text-[10px] font-semibold text-gray-400">คิวที่</span>
        <span className="text-xl font-black text-gray-800">{b.queue_no}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-bold text-gray-800">{b.queue_services?.name ?? 'บริการ'}</p>
          <StatusPill status={b.status} />
        </div>
        <p className="mt-0.5 text-xs text-gray-600">{thaiLongDay(b.booking_date)} · {slotRange(b.slot_time, b.queue_services?.slot_minutes)} น.</p>
        {b.queue_services?.location && <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-500"><MapPin size={12} />{b.queue_services.location}</p>}
      </div>
      {canCancelBooking(b, today) && (
        <button disabled={busy} onClick={() => cancelBooking(b)}
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-xl border border-rose-200 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">
          <X size={14} /> ยกเลิกคิว
        </button>
      )}
    </li>
  )

  return (
    <div className="mx-auto max-w-lg pb-28 md:pb-8">
      {header('จองคิวรับบริการ', () => navigate('/'))}
      <div className="space-y-4 px-4 pt-3">
        {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">{error}</div>}
        {notice && <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">{notice}</p>}

        <button onClick={startBooking} disabled={services !== null && services.length === 0} className={primaryBtn} style={{ backgroundColor: 'var(--color-primary)' }}>
          <CalendarClock size={20} /> จองคิวใหม่
        </button>
        {services !== null && services.length === 0 && !loadError && (
          <p className="text-center text-xs text-gray-500">หน่วยงานยังไม่ได้เปิดรับจองคิวบริการใดๆ</p>
        )}

        <section aria-label="คิวของฉัน" className="space-y-2">
          <h2 className="text-base font-bold text-gray-800">คิวของฉัน ({upcoming.length})</h2>
          {upcoming.length === 0
            ? <p className="rounded-2xl border border-gray-100 bg-white p-5 text-center text-sm text-gray-500">ยังไม่มีคิวที่รอรับบริการ</p>
            : <ul className="space-y-2">{upcoming.map(row)}</ul>}
        </section>

        {history.length > 0 && (
          <section aria-label="ประวัติการจอง" className="space-y-2">
            <h2 className="pt-2 text-base font-bold text-gray-800">ประวัติการจอง ({history.length})</h2>
            <ul className="space-y-2">{history.map(row)}</ul>
          </section>
        )}

        <p className="flex items-center gap-1.5 text-xs text-gray-400"><Phone size={12} /> จองได้ 1 คิวต่อบริการต่อวัน · มีคิวรอรับบริการได้ไม่เกิน 5 คิว</p>
      </div>
    </div>
  )
}
