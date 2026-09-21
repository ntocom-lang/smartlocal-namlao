import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import MapPicker from '../MapPicker'
import BookingReviewSheet from './BookingReviewSheet'
import { RETURN_MODES, MOBILITY, DAY_BLOCKED, inputClass, buttonClass, thaiDay, bangkokISO, clockTime, minutes, freeTimeChoices, latestReturnClock, orgAbbr, normalizeBookingPhone } from '../../lib/patientBooking'

/**
 * ฟอร์มขอจองรถ — หน้าเดียวจบ แล้วจบด้วยหน้าทวนก่อนส่งแบบ "คำร้อง" (BookingReviewSheet)
 *
 * เจ้าของระบบสั่ง 2569-09-21 ว่าต้องง่ายแบบหน้าคำร้อง/คำขอบริการ และ "ให้ประชาชนพิมพ์น้อยที่สุด"
 * ฟอร์มนี้จึงเป็น "ปุ่มตัวเลือก" ทั้งหมด ไม่มี dropdown ไม่มีช่องวันที่/เวลาแบบเบราว์เซอร์
 * (ของเดิมขึ้นเป็น "09/20/2026" กับ "--:-- --" ผู้สูงอายุอ่านไม่ออกและไปต่อไม่ถูก)
 * เหลือที่ต้องพิมพ์แค่บ้านเลขที่/จุดสังเกต ส่วนที่เหลือกดเลือกหรือระบบเติมให้
 *
 * แต่ละเรื่องอยู่ในกล่องมีกรอบของตัวเองพร้อมเลขขั้น (เจ้าของระบบบอกว่าของเดิม "มองแล้วปนกันไปหมด")
 *
 * สองอย่างที่ระบบทำให้เองเพื่อให้กดน้อยลงและเจ้าหน้าที่ไม่ต้องตามแก้
 * 1. เวลานัดขึ้นเฉพาะเวลาที่ "รถว่างจริง" (freeTimeChoices ใช้ช่อง free ของ patient_booking_calendar)
 *    ประชาชนจึงเลือกเวลาที่ยืนยันไม่ได้ไม่ได้ตั้งแต่ต้น
 * 2. จองครั้งต่อไปเติมข้อมูลจากการจองครั้งก่อนของคนคนนั้นเอง เหลือเลือกวัน–เวลาแล้วส่ง
 */
const shiftDay = days => thaiDay(Date.now() + days * 86400000)
const noon = day => new Date(`${day}T12:00:00+07:00`)
const fullDate = day => day ? noon(day).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'ยังไม่ได้เลือก'
const chipDate = day => noon(day).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
const chipDay = day => noon(day).toLocaleDateString('th-TH', { weekday: 'long' })
const QUICK_DAYS = 6

// ปุ่มตัวเลือก 1 ปุ่ม — ตัวโตพอกดด้วยนิ้ว ติ๊กถูกให้เห็นชัดเมื่อเลือกอยู่ และบอกสถานะด้วย aria-pressed
function Chip({ chosen, onClick, children, disabled, compact }) {
  return <button type="button" aria-pressed={chosen} disabled={disabled} onClick={onClick}
    className={`${compact ? 'min-h-12' : 'min-h-14'} rounded-xl border-2 px-3 py-2 text-base font-semibold ${chosen ? 'border-sky-900 bg-sky-800 text-white' : 'border-slate-300 bg-white text-slate-900'} disabled:opacity-50`}>
    {chosen && <span aria-hidden="true">✓ </span>}{children}
  </button>
}
// กลุ่มตัวเลือกพร้อมหัวข้อ — ใช้ fieldset/legend เพื่อให้อ่านออกว่าปุ่มชุดนี้ตอบคำถามอะไร
// กล่องที่ชื่อกล่องบอกคำถามอยู่แล้วให้ซ่อนหัวข้อซ้ำด้วย hideLabel (เครื่องอ่านหน้าจอยังได้ยินเหมือนเดิม)
function Choice({ label, hint, items, value, onChange, cols = 'grid-cols-2', compact, hideLabel }) {
  return <fieldset className="space-y-2">
    <legend className={hideLabel ? 'sr-only' : 'text-base font-bold'}>{label}</legend>
    {hint && <p className="text-sm text-slate-600">{hint}</p>}
    <div className={`grid gap-2 ${cols}`}>
      {items.map(item => <Chip key={String(item.value)} compact={compact} chosen={value === item.value} onClick={() => onChange(item.value)}>
        {item.label}{item.note && <span className="block text-xs font-normal">{item.note}</span>}
      </Chip>)}
    </div>
  </fieldset>
}

// กล่องของแต่ละเรื่อง — เจ้าของระบบบอก 2569-09-21 ว่าของเดิม "มองแล้วปนกันไปหมด"
// จึงแยกเป็นกล่องมีกรอบทีละเรื่อง มีเลขขั้นที่หัวกล่อง เปลี่ยนเป็นถูกเขียวเมื่อเลือกแล้ว
// และเป็นกรอบแดงเมื่อกดส่งแล้วกล่องนั้นยังไม่ครบ ผู้ใช้จะได้รู้ว่าต้องกลับไปแก้ตรงไหน
function Section({ step, title, hint, done, warn, children }) {
  return <section aria-label={title} className={`space-y-3 rounded-2xl border-2 bg-white p-4 shadow-sm ${warn ? 'border-red-400' : done ? 'border-emerald-400' : 'border-slate-200'}`}>
    <div className="flex items-start gap-3">
      <span className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${warn ? 'bg-red-600' : done ? 'bg-emerald-600' : 'bg-sky-800'}`}>{done ? '✓' : step}</span>
      <div className="min-w-0"><h3 className="text-base font-bold">{title}</h3>{hint && <p className="text-sm text-slate-600">{hint}</p>}</div>
    </div>
    {children}
  </section>
}

// แยกจุดรับเดิมกลับเป็น "สถานที่" + "บ้านเลขที่/จุดสังเกต" เพื่อให้เติมของครั้งก่อนมาแล้วยังแก้ทีละส่วนได้
// (ระบบบันทึกจุดรับเป็นข้อความเดียวโดยต่อสองส่วนด้วย " · ")
function splitPickup(text = '') {
  const parts = String(text).split(' · ')
  return parts.length > 1 ? { place: parts[0], spot: parts.slice(1).join(' · ') } : { place: '', spot: String(text) }
}

// ค่าที่ยกมาจากการจองครั้งก่อนของผู้จองคนเดียวกัน — คนไปฟอกไต/ตามนัดประจำจะได้ไม่ต้องกรอกซ้ำทุกครั้ง
function seedFromLast(last) {
  if (!last) return {}
  return {
    requester_name: last.requester_name || '', phone: last.phone || '',
    relation: last.relation || 'self', patient_name: last.relation === 'self' ? '' : (last.patient_name || ''),
    route_id: last.route_id || '', return_mode: last.return_mode || 'wait',
    mobility: last.mobility || 'walk', companions: Number(last.companions) || 0, share: !!last.share,
    pickup_lat: last.pickup_lat ?? null, pickup_lng: last.pickup_lng ?? null, ...splitPickup(last.pickup || ''),
  }
}

export default function BookingForm({ tenantId, initial = {}, info, profileName, profilePhone, lastBooking, staffEntry, onSubmit, onBack, busy, submitError = '' }) {
  const { tenant } = useTenant()
  const [showMap, setShowMap] = useState(false)
  const [missing, setMissing] = useState([])
  const [review, setReview] = useState(false)
  const [phoneNotice, setPhoneNotice] = useState('')
  const [showBack, setShowBack] = useState(false)
  // ดีฟอลต์ให้เลือกเวลาทีละ 30 นาที — เวลานัดของโรงพยาบาลส่วนใหญ่ลงตัวครึ่งชั่วโมง
  // ถ้าไล่ทีละ 15 นาทีตั้งแต่แรก ปุ่มเวลาจะยาวเกือบ 10 แถวจนต้องเลื่อนหา
  const [allTimes, setAllTimes] = useState(false)
  const [locations, setLocations] = useState(null)
  const last = staffEntry ? null : lastBooking
  const [form, setForm] = useState({
    requester_name: staffEntry ? '' : profileName || '', phone: staffEntry ? '' : profilePhone || '',
    patient_name: '', relation: 'self', place: '', spot: '', pickup_lat: null, pickup_lng: null,
    day: '', time: '', route_id: info.routes?.[0]?.id || '', mobility: 'walk', companions: 0, share: false,
    return_mode: 'wait', back: '', ...seedFromLast(last), ...initial,
  })
  const id = useRef(crypto.randomUUID()) // Stable on uncertain response; retry the same operation.
  const leadDays = staffEntry ? 0 : Number(info.min_lead_days) || 0
  const first = shiftDay(leadDays)
  const lastDay = shiftDay(leadDays + 44)
  // ปฏิทินสาธารณะรู้วันหยุด ระยะจองล่วงหน้า เหตุขัดข้อง และ "ช่วงที่รถว่าง" ของแต่ละวันอยู่แล้ว
  const [calendar, setCalendar] = useState(null)
  const [farDay, setFarDay] = useState(null)
  useEffect(() => {
    if (!tenantId) return
    let active = true
    supabase.rpc('patient_booking_calendar', { p_muni: tenantId, p_from: first, p_to: lastDay }).then(({ data, error }) => {
      if (active) setCalendar({ days: error ? [] : (data?.days || []), failed: !!error })
    })
    return () => { active = false }
  }, [tenantId, first, lastDay])
  // วันที่อยู่นอกช่วงที่โหลดไว้ (ผู้ใช้กด "เลือกวันอื่น" ไปไกล) ถามปฏิทินเฉพาะวันนั้นเพิ่ม
  // ค่าเก่าไม่ต้องล้าง เพราะ dayInfo ใช้เฉพาะเมื่อ farDay.date ตรงกับวันที่เลือกอยู่
  useEffect(() => {
    if (!tenantId || !form.day || (form.day >= first && form.day <= lastDay)) return
    let active = true
    supabase.rpc('patient_booking_calendar', { p_muni: tenantId, p_from: form.day, p_to: form.day }).then(({ data, error }) => {
      if (active) setFarDay(data?.days?.[0] ? { ...data.days[0], failed: !!error } : { date: form.day, status: undefined, failed: !!error })
    })
    return () => { active = false }
  }, [tenantId, form.day, first, lastDay])
  // ทะเบียนสถานที่ของ อปท. ชุดเดียวกับที่หน้าคำร้องใช้ (ตาราง locations) — เลือกหมู่บ้านแทนพิมพ์เอง
  useEffect(() => {
    if (!tenantId) return
    let active = true
    supabase.from('locations').select('id, name').eq('municipality_id', tenantId).order('sort_order')
      .then(({ data }) => { if (active) setLocations(data || []) })
    return () => { active = false }
  }, [tenantId])
  const places = useMemo(() => (locations || []).map(l => l.name), [locations])
  // สถานที่ของครั้งก่อนที่ไม่มีในทะเบียน (อปท. แก้ทะเบียนภายหลัง) ต้องยังขึ้นเป็นปุ่มให้เห็นและแก้ได้
  // ไม่ใช่หายไปเงียบ ๆ ทั้งที่ค่ายังอยู่ในคำขอ
  const placeChoices = useMemo(() => (form.place && !places.includes(form.place) ? [form.place, ...places] : places), [places, form.place])

  const days = useMemo(() => calendar?.days || [], [calendar])
  const { route_id: routeId, return_mode: returnMode, back } = form
  // วันที่จองได้ = วันที่เปิดรับจองและยังมีเวลาที่รถว่างให้เลือกจริง (เจ้าหน้าที่รับเรื่องแทนดูแค่วันเปิด)
  const bookable = useMemo(() => {
    const draft = { route_id: routeId, return_mode: returnMode, back }
    return days.filter(d => staffEntry ? d.status === 'open' : freeTimeChoices(draft, info, d).length > 0)
  }, [days, staffEntry, routeId, returnMode, back, info])
  // วันที่ใช้จริง = วันที่ผู้ใช้เลือก หรือวันแรกที่จองได้ (เติมให้โดยไม่ต้องใช้ effect เขียน state ทับ)
  const day = form.day || bookable[0]?.date || ''
  const dayInfo = day >= first && day <= lastDay ? days.find(d => d.date === day) : (farDay?.date === day ? farDay : null)
  const step = allTimes || (form.time && minutes(form.time) % 30) ? 15 : 30
  const times = useMemo(() => {
    const draft = { route_id: routeId, return_mode: returnMode, back }
    // เจ้าหน้าที่รับเรื่องแทนเห็นทุกเวลาในเวลาบริการ (ประสานกับคนขับเองได้) จึงใช้ช่วงว่างสมมติเต็มวัน
    const wholeDay = day && Number.isFinite(info.office_start) && Number.isFinite(info.office_end)
      ? { date: day, status: 'open', free: [{ start: bangkokISO(day, clockTime(info.office_start)), end: bangkokISO(day, clockTime(info.office_end)) }] }
      : null
    const source = staffEntry ? wholeDay : (dayInfo?.status === 'open' ? dayInfo : null)
    return source ? freeTimeChoices(draft, info, source, step) : []
  }, [staffEntry, dayInfo, day, routeId, returnMode, back, info, step])
  const dayBlocked = !day ? ''
    : day < first ? (leadDays ? `ต้องจองล่วงหน้าอย่างน้อย ${leadDays} วัน คือตั้งแต่ ${fullDate(first)} เป็นต้นไป` : 'วันที่เลือกผ่านมาแล้ว กรุณาเลือกวันถัดไป')
    : day > shiftDay(180) ? 'จองล่วงหน้าได้ไม่เกิน 180 วัน'
    : dayInfo?.status && dayInfo.status !== 'open' ? DAY_BLOCKED[dayInfo.status] : ''
  const backLatest = latestReturnClock(form, info)
  // ตัวเลือก "คาดว่าเสร็จประมาณ" ทีละชั่วโมง ใช้เมื่อผู้จองทราบเวลา จะทำให้มีเวลานัดให้เลือกมากขึ้น
  const backChoices = useMemo(() => {
    const out = [{ value: '', label: 'ยังไม่ทราบ', note: backLatest ? `กันรถถึง ${backLatest} น.` : '' }]
    if (!form.time || !backLatest) return out
    for (let at = Math.ceil(minutes(form.time) / 60) * 60; at <= minutes(backLatest); at += 60) out.push({ value: clockTime(at), label: `${clockTime(at)} น.` })
    return out
  }, [form.time, backLatest])
  const noTimes = !!day && !dayBlocked && times.length === 0
  const timeMissing = !!form.time && times.length > 0 && !times.includes(form.time)
  const pickupText = () => [form.place, form.spot.trim()].filter(Boolean).join(' · ')
  const routeLabel = info.routes?.find(r => r.id === form.route_id)?.label || ''
  const change = key => e => { setMissing([]); setForm(f => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })) }
  const set = (key, value) => { setMissing([]); setForm(f => ({ ...f, [key]: value })) }
  const stop = !staffEntry && !!dayBlocked
  const contact = info.contact_phone && <p className="mt-2 text-sm">ติดต่อเจ้าหน้าที่ <a className="font-semibold underline" href={`tel:${info.contact_phone}`}>{info.contact_phone}</a></p>
  const submissionAdvice = /ข้อความใช้ข้อมูลเปลี่ยน/.test(submitError)
    ? 'ข้อความการใช้ข้อมูลของหน่วยงานเปลี่ยนระหว่างกรอก กดส่งคำขอใหม่อีกครั้งเพื่ออ่านข้อความล่าสุด'
    : /รับกลับ/.test(submitError) ? 'ตรวจ “คาดว่าเสร็จประมาณ” ให้ไม่ก่อนเวลานัดและอยู่ในวันเดียวกัน'
    : /วันนัด|วันหยุด|ล่วงหน้า/.test(submitError) ? 'เลือกวันจากปุ่มวันที่รถว่างในข้อ 1 หากวันนัดเปลี่ยนไม่ได้ ให้ติดต่อเจ้าหน้าที่'
    : /ที่นั่ง|เต็ม|คิว|เที่ยว/.test(submitError) ? 'คิวรถอาจเปลี่ยนหลังเปิดหน้านี้ กดเลือกวันหรือเวลาใหม่อีกครั้ง'
    : /ปิดรับ|ไม่เปิด|ไม่พร้อม/.test(submitError) ? 'หน่วยงานยังรับคำขอนี้ไม่ได้ กรุณาติดต่อเจ้าหน้าที่ตามเบอร์ด้านล่าง'
    : 'ตรวจการเชื่อมต่อแล้วกดส่งซ้ำได้ ระบบใช้รหัสคำขอเดิมเพื่อป้องกันคำขอซ้ำ หากยังไม่สำเร็จให้ติดต่อเจ้าหน้าที่พร้อมข้อความนี้'

  // ปุ่มส่งกดได้เสมอ ถ้าขาดอะไรให้บอกเป็นภาษาไทยว่าขาดอะไร แทนปุ่มสีเทาที่ไม่บอกเหตุผล
  // key ใช้ทำกรอบแดงที่กล่องซึ่งยังไม่ครบ ผู้ใช้จะได้รู้ว่าต้องกลับไปแก้กล่องไหน
  function incomplete() {
    const list = []
    if (!day) list.push({ key: 'day', label: 'วันที่ไปโรงพยาบาล', advice: 'กดเลือกวันจากปุ่มวันที่รถว่างในข้อ 1' })
    if (!form.time || timeMissing) list.push({ key: 'time', label: 'เวลานัดแพทย์', advice: 'กดเลือกเวลาตามใบนัดแพทย์ในข้อ 2 ถ้าไม่มีเวลาที่ต้องการให้เลือกวันอื่น' })
    if (!form.route_id) list.push({ key: 'route', label: 'โรงพยาบาลที่จะไป', advice: 'กดเลือกโรงพยาบาลปลายทางในข้อ 3' })
    if (!String(form.requester_name).trim()) list.push({ key: 'who', label: 'ชื่อ–สกุลผู้จอง', advice: 'กรอกชื่อและนามสกุลของผู้ที่ติดต่อกลับได้ในข้อ 5' })
    if (!/^0[0-9]{8,9}$/.test(form.phone)) list.push({ key: 'who', label: 'เบอร์ติดต่อกลับ', advice: 'กรอกเบอร์โทรที่ขึ้นต้นด้วย 0 จำนวน 9–10 หลักในข้อ 5' })
    if (form.relation !== 'self' && !String(form.patient_name).trim()) list.push({ key: 'who', label: 'ชื่อ–สกุลผู้เดินทาง', advice: 'กรอกชื่อผู้ป่วยที่จะเดินทางในข้อ 5' })
    if (!pickupText()) list.push({ key: 'pickup', label: 'จุดรับ', advice: places.length ? 'กดเลือกหมู่บ้าน/สถานที่ หรือพิมพ์บ้านเลขที่และจุดสังเกตในข้อ 6' : 'พิมพ์บ้านเลขที่ หมู่บ้าน และจุดสังเกตของจุดรับในข้อ 6' })
    return list
  }
  const payload = () => ({
    requester_name: String(form.requester_name).trim(), phone: String(form.phone).trim(),
    patient_name: String(form.relation === 'self' ? form.requester_name : form.patient_name).trim(),
    relation: form.relation, pickup: pickupText(),
    // in_area มาจากคำรับรองในหน้าทวนก่อนส่ง ("จุดรับอยู่ในเขตพื้นที่ให้บริการของ…") ที่ผู้จองอ่านแล้วกดยืนยัน
    // ⚠️ ส่งค่านี้เป็น false ไม่ได้ ptb_plan จะตีกลับว่า "ต้องตรวจสอบพื้นที่รับบริการ" และคำขอจะค้างรอ
    // ให้เจ้าหน้าที่มาติ๊กให้ทุกใบ (เคยลองถอดออกแล้วพังทั้งเส้นทาง — บันทึกไว้ 2569-09-20)
    in_area: true,
    pickup_lat: form.pickup_lat ?? '', pickup_lng: form.pickup_lng ?? '',
    route_id: form.route_id, mobility: form.mobility, companions: Number(form.companions),
    share: !!form.share, return_mode: form.return_mode,
    appointment_at: bangkokISO(day, form.time),
    return_at: form.return_mode === 'one_way' ? null : bangkokISO(day, form.back || backLatest),
    is_emergency: false, consent: true, representative_authorized: form.relation !== 'self',
    privacy_notice: info.privacy_notice, owner_name: info.owner_name, consent_version: info.consent_version,
  })
  function submit(event) {
    event.preventDefault()
    const list = incomplete()
    setMissing(list)
    if (list.length || stop) return
    setReview(true)
  }
  const filledTraveler = !!String(form.requester_name).trim() && /^0[0-9]{8,9}$/.test(form.phone) && (form.relation === 'self' || !!String(form.patient_name).trim())
  const warn = key => missing.some(item => item.key === key)
  return <form noValidate onSubmit={submit} className="space-y-4">
    <button type="button" className={buttonClass} disabled={busy} onClick={onBack}>← ย้อนกลับ</button>
    <h2 className="text-xl font-bold">{staffEntry ? 'รับจองแทนทางโทรศัพท์/หน้าเคาน์เตอร์' : 'ขอรถไปโรงพยาบาล'}</h2>
    <p className="rounded-xl bg-amber-50 p-3">เจ็บป่วยฉุกเฉิน <a className="font-bold underline" href="tel:1669">โทร 1669</a> อย่ารอคิวจองรถ</p>
    {last && <p role="status" className="rounded-xl bg-sky-50 p-3">เติมข้อมูลจากการจองครั้งก่อนให้แล้ว ({last.route_label}) ตรวจแล้วแก้ได้ทุกช่อง</p>}

    <Section step={1} title="วันที่ไปโรงพยาบาล" done={!!day && !dayBlocked} warn={warn('day')}
      hint={staffEntry ? 'วันที่หน่วยงานเปิดให้บริการ' : 'ขึ้นเฉพาะวันที่รถว่างและจองได้จริง'}>
      <Choice label="วันที่ไปโรงพยาบาล" hideLabel value={day} onChange={value => set('day', value)}
        items={bookable.slice(0, QUICK_DAYS).map(d => ({ value: d.date, label: chipDay(d.date), note: chipDate(d.date) }))} />
      {!bookable.length && <div role="status" className="rounded-xl bg-amber-50 p-3">ยังไม่มีวันที่รถว่างในช่วงนี้ · เลือกวันอื่นด้านล่างหรือติดต่อเจ้าหน้าที่{contact}</div>}
      <p className="rounded-xl bg-slate-100 p-3">วันที่เลือก: <strong>{fullDate(day)}</strong></p>
      <details className="rounded-xl border border-slate-200 px-3">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">เลือกวันอื่น</summary>
        <div className="space-y-2 pb-3">
          <label className="block">วันที่นัดแพทย์<input className={inputClass} type="date" value={day} min={first} max={shiftDay(180)}
            onChange={e => { if (!e.target.value) return; set('day', e.target.value) }} /></label>
          <p className="text-sm text-slate-600">{staffEntry ? 'เจ้าหน้าที่รับเรื่องแทนได้ทุกวันที่ประสานแล้ว' : `จองได้ตั้งแต่ ${fullDate(first)} เป็นต้นไป${leadDays ? ` (ล่วงหน้าอย่างน้อย ${leadDays} วัน)` : ''} เว้นวันหยุดของหน่วยงาน`}</p>
        </div>
      </details>
      {calendar?.failed && <p role="status" className="rounded-xl bg-amber-50 p-3">ตรวจวันว่างไม่สำเร็จ อาจเป็นปัญหาการเชื่อมต่อ · ตรวจอินเทอร์เน็ตแล้วลองใหม่ หรือกรอกต่อได้ ระบบจะตรวจอีกครั้งตอนส่งคำขอ</p>}
      {dayBlocked && <div role="alert" className={`rounded-xl p-3 ${staffEntry ? 'bg-amber-50' : 'bg-red-50 text-red-900'}`}>
        <p className="font-semibold">วันที่เลือกจองไม่ได้: {dayBlocked}</p>
        <p className="mt-1 text-sm">{staffEntry ? 'รับเรื่องแทนต่อได้ แต่ต้องประสานวันเวลากับผู้จองและคนขับก่อนยืนยันคิว' : 'กดเลือกวันจากปุ่มวันที่รถว่างด้านบน'}</p>
      </div>}
    </Section>

    <Section step={2} title="เวลานัดแพทย์" done={!!form.time && !timeMissing} warn={warn('time')}
      hint={staffEntry ? 'ทุกเวลาในช่วงให้บริการ ระบบจะตรวจคิวซ้ำตอนยืนยันรถ' : 'ขึ้นเฉพาะเวลาที่รถว่างและไปส่งทัน'}>
      <Choice label="เวลานัดแพทย์" hideLabel value={form.time} onChange={value => set('time', value)} cols="grid-cols-3 sm:grid-cols-4"
        compact items={times.map(time => ({ value: time, label: `${time} น.` }))} />
      {times.length > 0 && step === 30 && <button type="button" className={buttonClass} onClick={() => setAllTimes(true)}>ดูเวลาทุก 15 นาที</button>}
      {noTimes && <div role="alert" className="rounded-xl bg-amber-50 p-3">
        <p className="font-semibold">วันที่เลือกรถไม่ว่างแล้ว</p>
        <p className="mt-1 text-sm">กดเลือกวันอื่นในข้อ 1{form.return_mode !== 'one_way' && ' หรือถ้าทราบว่าจะเสร็จประมาณกี่โมง ให้เลือก “คาดว่าเสร็จประมาณ” ในข้อ 4 จะมีเวลาให้เลือกมากขึ้น'}</p>
      </div>}
      {timeMissing && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-900">เวลา {form.time} น. ที่เลือกไว้ไม่ว่างแล้ว กรุณากดเลือกเวลาใหม่</p>}
    </Section>

    <Section step={3} title="โรงพยาบาลที่จะไป" done={!!form.route_id} warn={warn('route')}>
      <Choice label="โรงพยาบาลที่จะไป" hideLabel value={form.route_id} onChange={value => set('route_id', value)}
        cols={info.routes?.length === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}
        items={(info.routes || []).map(r => ({ value: r.id, label: r.label, note: Number.isFinite(Number(r.minutes)) ? `ทางเดียวประมาณ ${r.minutes} นาที` : '' }))} />
    </Section>

    <Section step={4} title="ขากลับ" done hint="ระบบเลือก “ให้รถรอรับกลับ” ไว้ให้ก่อน เปลี่ยนได้">
      <Choice label="ขากลับ" hideLabel value={form.return_mode} onChange={value => { set('return_mode', value); if (value === 'one_way') set('back', '') }} cols="grid-cols-1 sm:grid-cols-3"
        items={[
          { value: 'wait', label: 'ให้รถรอรับกลับ', note: 'รถรออยู่ที่โรงพยาบาลจนเสร็จ' },
          { value: 'later', label: 'ให้รถมารับกลับทีหลัง', note: 'รถกลับไปก่อนแล้วมารับ' },
          { value: 'one_way', label: 'ไปอย่างเดียว', note: 'ไม่ต้องรับกลับ' },
        ]} />
      {form.return_mode !== 'one_way' && <>
        <p className="rounded-xl bg-slate-100 p-3">เวลารับกลับ: <strong>{form.back ? `${form.back} น.` : `ยังไม่ทราบ — ระบบกันรถไว้ถึง ${backLatest || 'เวลาปิดบริการ'} น.`}</strong></p>
        <button type="button" className={buttonClass} onClick={() => setShowBack(v => !v)}>{showBack ? 'ปิดตัวเลือกเวลารับกลับ' : 'ระบุเวลาที่คาดว่าเสร็จ (ถ้าทราบ)'}</button>
        {(showBack || noTimes) && <Choice label="คาดว่าเสร็จประมาณ" value={form.back} onChange={value => set('back', value)} cols="grid-cols-3 sm:grid-cols-4" compact items={backChoices} />}
      </>}
    </Section>

    <Section step={5} title="ผู้เดินทางและเบอร์ติดต่อ" done={filledTraveler} warn={warn('who')}>
      <Choice label="ผู้เดินทาง" hideLabel value={form.relation === 'self' ? 'self' : 'other'} cols="grid-cols-2"
        onChange={value => set('relation', value === 'self' ? 'self' : (form.relation === 'self' ? 'relative' : form.relation))}
        items={[{ value: 'self', label: 'จองให้ตัวเอง' }, { value: 'other', label: 'จองให้คนอื่น' }]} />
      {form.relation !== 'self' && <>
        <Choice label="ผู้จองเป็น" value={form.relation} onChange={value => set('relation', value)}
          items={[{ value: 'relative', label: 'ญาติ' }, { value: 'caregiver', label: 'ผู้ดูแล' }]} />
        <label className="block">ชื่อ–สกุลผู้เดินทาง<input className={inputClass} maxLength={200} value={form.patient_name} onChange={change('patient_name')} /></label>
      </>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">ชื่อ–สกุลผู้จอง<input className={inputClass} maxLength={200} value={form.requester_name} onChange={change('requester_name')} /></label>
        <label className="block">เบอร์ติดต่อกลับ<input className={inputClass} type="tel" inputMode="tel" maxLength={30} value={form.phone} onChange={change('phone')} onBlur={() => {
          const phone = normalizeBookingPhone(form.phone)
          if (phone !== form.phone) { setForm(f => ({ ...f, phone })); setPhoneNotice(`จัดรูปแบบเบอร์โทรเป็น ${phone} แล้ว กรุณาตรวจว่าถูกต้อง`) }
        }} /></label>
      </div>
      {phoneNotice && <p role="status" className="text-sm text-sky-800">{phoneNotice}</p>}
    </Section>

    <Section step={6} title="จุดรับ" done={!!pickupText()} warn={warn('pickup')} hint="บอกให้ชัดว่าคนขับต้องไปรับที่ไหน">
      {placeChoices.length > 0 && <Choice label="หมู่บ้าน/สถานที่" value={form.place} onChange={value => set('place', value === form.place ? '' : value)}
        hint="กดเลือกจากทะเบียนสถานที่ของหน่วยงาน กดซ้ำเพื่อยกเลิกการเลือก" items={placeChoices.map(name => ({ value: name, label: name }))} />}
      <label className="block">{places.length ? 'บ้านเลขที่ / จุดสังเกต' : 'จุดรับและจุดสังเกต'}
        <input className={inputClass} maxLength={400} value={form.spot} onChange={change('spot')} placeholder={places.length ? 'เช่น บ้านเลขที่ 99 ข้างวัด' : 'เช่น บ้านเลขที่ 99 หมู่ 4 ข้างวัด'} />
      </label>
      {/* หมุดไม่บังคับตามที่เจ้าของระบบสั่งไว้ 2569-09-19 (ผู้สูงอายุปักไม่เป็น) แต่ต้องขึ้นให้เห็นเต็มความกว้าง
          แบบปุ่มปักหมุดของหน้าคำร้อง เพราะคนขับใช้หมุดนี้กดนำทางไปรับ (เจ้าของระบบสั่ง 2569-09-21) */}
      {form.pickup_lat === null
        ? <button type="button" className={`${buttonClass} min-h-14 w-full text-base`} onClick={() => setShowMap(true)}>📍 ปักหมุดจากแผนที่</button>
        : <div className="space-y-2">
          <button type="button" className="min-h-14 w-full rounded-xl border border-emerald-600 bg-emerald-600 px-4 text-base font-semibold text-white" onClick={() => setShowMap(true)}>
            ✓ ปักหมุดแล้ว {form.pickup_lat.toFixed(5)}, {form.pickup_lng.toFixed(5)} · แก้หมุด
          </button>
          <button type="button" className={buttonClass} onClick={() => setForm(f => ({ ...f, pickup_lat: null, pickup_lng: null }))}>เอาหมุดออก</button>
        </div>}
      <p className="text-sm text-slate-600">{form.pickup_lat === null ? 'ปักหมุดช่วยให้คนขับไปรับถูกจุด ถ้าไม่ปักเจ้าหน้าที่จะโทรถามทาง' : 'คนขับกดนำทางไปหมุดนี้ได้เลย'}</p>
    </Section>

    {/* กางให้เห็นทั้งหมด ไม่ซ่อนในกล่องพับ (เจ้าของระบบสั่ง 2569-09-21) — ค่าปกติเลือกไว้ให้แล้ว
        คนที่ไม่ต้องแก้ก็เลื่อนผ่านได้ แต่คนที่ใช้รถเข็นหรือมีผู้ติดตามจะเห็นเองโดยไม่ต้องรู้ว่ามีที่ซ่อนอยู่ */}
    <Section step={7} title="ข้อมูลเพิ่มเติม" hint="ระบบเลือกค่าปกติไว้ให้แล้ว ถ้าตรงอยู่แล้วไม่ต้องแก้">
      <Choice label="การเคลื่อนไหว" value={form.mobility} onChange={value => set('mobility', value)} cols="grid-cols-3"
        items={Object.entries(MOBILITY).map(([value, label]) => ({ value, label }))} />
      <Choice label="ผู้ติดตาม" value={Number(form.companions)} onChange={value => set('companions', value)} cols="grid-cols-5" compact
        items={[0, 1, 2, 3, 4].map(n => ({ value: n, label: n === 0 ? 'ไม่มี' : `${n} คน` }))} />
      <label className="flex min-h-11 gap-3 rounded-xl border border-slate-200 p-3"><input className="mt-1 size-5 shrink-0" type="checkbox" checked={form.share} onChange={change('share')} />
        นั่งรถคันเดียวกับผู้ป่วยคนอื่นที่ไปโรงพยาบาลเดียวกันได้ (ช่วยให้ได้คิวเร็วขึ้น)</label>
    </Section>

    {missing.length > 0 && <div role="alert" className="space-y-2 rounded-xl bg-red-50 p-3 text-red-900">
      <p className="font-semibold">ยังส่งคำขอไม่ได้ เพราะยังไม่ได้กรอก {missing.length} อย่าง</p>
      <ul className="space-y-2">{missing.map(item => <li key={item.label}><strong>{item.label}</strong><span className="block text-sm">{item.advice}</span></li>)}</ul>
    </div>}
    {submitError && <div role="alert" className="rounded-xl bg-red-50 p-3 text-red-900"><p className="font-semibold">ส่งคำขอยังไม่สำเร็จ</p><p>{submitError}</p><p className="mt-2"><strong>วิธีแก้: </strong>{submissionAdvice}</p>{contact}</div>}
    <button className="min-h-14 w-full rounded-xl bg-emerald-700 px-4 text-base font-bold text-white disabled:opacity-50" disabled={busy}>{busy ? 'กำลังส่ง…' : 'ส่งคำขอ'}</button>
    <p className="text-sm text-slate-600">ส่งคำขอแล้วรอเจ้าหน้าที่ {orgAbbr()} ยืนยันรถและเวลารับ ติดตามได้ในหน้า “คำขอของฉัน”</p>

    {showMap && <MapPicker
      initialPos={form.pickup_lat === null ? null : { lat: form.pickup_lat, lng: form.pickup_lng }}
      fallbackPos={tenant?.latitude ? { lat: tenant.latitude, lng: tenant.longitude } : null}
      onConfirm={({ lat, lng, address }) => {
        // เติมที่อยู่จากแผนที่ให้เฉพาะตอนช่องยังว่าง ไม่ทับสิ่งที่ผู้จองพิมพ์เอง
        setForm(f => ({ ...f, pickup_lat: lat, pickup_lng: lng, spot: f.spot || address || '' }))
        setShowMap(false)
      }}
      onClose={() => setShowMap(false)} />}
    {review && <BookingReviewSheet
      privacyNotice={info.privacy_notice} ownerName={info.owner_name} forOther={form.relation !== 'self'} staffEntry={staffEntry}
      // ส่งไม่สำเร็จต้องปิดแผ่นนี้ ไม่งั้นแผ่นบังกล่อง "ส่งคำขอยังไม่สำเร็จ" ที่อยู่ด้านหลัง ผู้จองไม่รู้ว่าต้องทำอะไรต่อ
      submitting={busy} onBack={() => setReview(false)} onConfirm={async () => { if (!(await onSubmit(id.current, payload()))) setReview(false) }}
      summary={[
        { label: 'วันนัด', value: fullDate(day) },
        { label: 'เวลานัด', value: form.time && `${form.time} น.` },
        { label: 'โรงพยาบาล', value: routeLabel },
        { label: 'ผู้เดินทาง', value: `${payload().patient_name}${form.mobility === 'walk' ? '' : ` · ${MOBILITY[form.mobility]}`}${Number(form.companions) ? ` · ผู้ติดตาม ${form.companions} คน` : ''}` },
        { label: 'จุดรับ', value: `${pickupText()}${form.pickup_lat === null ? ' · ไม่ได้ปักหมุด' : ' · ปักหมุดแล้ว'}` },
        { label: 'ขากลับ', value: `${RETURN_MODES[form.return_mode]}${form.return_mode === 'one_way' ? '' : ` · ${form.back ? `คาดว่าเสร็จ ${form.back} น.` : `ยังไม่ทราบเวลา (กันรถถึง ${backLatest} น.)`}`}` },
        { label: 'เบอร์ติดต่อ', value: form.phone },
      ]} />}
  </form>
}
