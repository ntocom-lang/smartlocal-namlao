import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import MapPicker from '../MapPicker'
import { RETURN_MODES, MOBILITY, DAY_BLOCKED, inputClass, buttonClass, primaryClass, thaiDay, bangkokISO, clockTime, journeyWindow, orgAbbr, bookingTimingAdvice, normalizeBookingPhone } from '../../lib/patientBooking'

/**
 * ฟอร์มขอจองรถ — หน้าเดียวจบ ยกรูปแบบมาจาก "ใบขออนุญาตใช้รถส่วนกลาง (แบบ 3)" ของโมดูลยานพาหนะ
 * ซึ่งเจ้าหน้าที่ใช้ได้คล่องทั้งที่มีช่องมากกว่านี้ เพราะ (1) เลื่อนกรอกรวดเดียวไม่มี "1 จาก 3"
 * (2) ระบบเติมค่าที่เดาได้ให้ก่อน (3) มีปุ่มส่งปุ่มเดียวอยู่ล่างสุด
 *
 * ของเดิมเป็นวิซาร์ด 3 ขั้น ปุ่ม "ต่อไป" เป็นสีเทากดไม่ได้จนกว่าจะกรอกครบโดยไม่บอกว่าขาดอะไร
 * และใช้ช่องวันที่/เวลาของเบราว์เซอร์ซึ่งขึ้นเป็น "09/20/2026" กับ "--:-- --" แบบอเมริกัน
 * ผู้สูงอายุอ่านไม่ออกและไปต่อไม่ถูก — ไฟล์นี้จึงเลือกวันจากปุ่มวันที่ว่างจริง และเลือกเวลาจากรายการไทย
 */
const shiftDay = days => thaiDay(Date.now() + days * 86400000)
const dayClock = value => clockTime(((value % 1440) + 1440) % 1440)
// เที่ยงวันตามเวลาไทยกันวันเคลื่อนตอนแปลงโซนเวลา
const noon = day => new Date(`${day}T12:00:00+07:00`)
const fullDate = day => day ? noon(day).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'ยังไม่ได้เลือก'
const chipDate = day => noon(day).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
const chipDay = day => noon(day).toLocaleDateString('th-TH', { weekday: 'long' })
const QUICK_DAYS = 6
const STEP_MINUTES = 15

export default function BookingForm({ tenantId, initial = {}, info, profileName, profilePhone, staffEntry, onSubmit, onBack, busy, submitError = '' }) {
  const { tenant } = useTenant()
  const [showMap, setShowMap] = useState(false)
  const [missing, setMissing] = useState([])
  const [phoneNotice, setPhoneNotice] = useState('')
  // in_area เริ่มเป็น false เสมอ ผู้จองต้องติ๊กเอง (ดูเหตุผลที่ถอดช่องนี้ออกไม่ได้ ที่หัวข้อ 3)
  const [form, setForm] = useState({ requester_name: staffEntry ? '' : profileName || '', phone: staffEntry ? '' : profilePhone || '', patient_name: '', relation: 'self', pickup: '', in_area: false,
    day: '', time: '', route_id: info.routes?.length === 1 ? info.routes[0].id : (info.routes?.[0]?.id || ''), mobility: 'walk', companions: 0, share: false,
    return_mode: 'wait', back: '', is_emergency: true, consent: false, representative_authorized: false,
    pickup_lat: null, pickup_lng: null, ...initial })
  const [pickedDay, setPickedDay] = useState(!!initial.day)
  const id = useRef(crypto.randomUUID()) // Stable on uncertain response; retry the same operation.
  const leadDays = staffEntry ? 0 : Number(info.min_lead_days) || 0
  const first = shiftDay(leadDays)
  const last = shiftDay(leadDays + 44)
  // ปฏิทินสาธารณะรู้วันหยุด ระยะจองล่วงหน้า วันที่ยังไม่ตรวจ และเหตุขัดข้องอยู่แล้ว
  // โหลดเป็นช่วงครั้งเดียวเพื่อใช้ทั้ง "ปุ่มวันที่ว่าง" และตรวจสถานะวันที่เลือก
  const [calendar, setCalendar] = useState(null)
  const [farDay, setFarDay] = useState(null)
  useEffect(() => {
    if (!tenantId) return
    let active = true
    supabase.rpc('patient_booking_calendar', { p_muni: tenantId, p_from: first, p_to: last }).then(({ data, error }) => {
      if (active) setCalendar({ from: first, to: last, days: error ? [] : (data?.days || []), failed: !!error })
    })
    return () => { active = false }
  }, [tenantId, first, last])
  useEffect(() => {
    if (!tenantId || !form.day || (form.day >= first && form.day <= last)) { setFarDay(null); return }
    let active = true
    supabase.rpc('patient_booking_calendar', { p_muni: tenantId, p_from: form.day, p_to: form.day }).then(({ data, error }) => {
      if (active) setFarDay({ date: form.day, status: data?.days?.[0]?.status, failed: !!error })
    })
    return () => { active = false }
  }, [tenantId, form.day, first, last])
  const days = calendar?.days || []
  const openDays = days.filter(d => d.status === 'open')
  const firstOpen = openDays[0]?.date
  // เติมวันที่จองได้เร็วที่สุดให้ก่อน ผู้จองส่วนใหญ่ต้องการวันที่ใกล้ที่สุดที่ได้อยู่แล้ว
  useEffect(() => { if (!pickedDay && firstOpen) setForm(f => (f.day === firstOpen ? f : { ...f, day: firstOpen })) }, [pickedDay, firstOpen])
  const dayInfo = form.day >= first && form.day <= last ? days.find(d => d.date === form.day) : (farDay?.date === form.day ? farDay : null)
  const dayBlocked = !form.day ? ''
    : form.day < first ? (leadDays ? `ต้องจองล่วงหน้าอย่างน้อย ${leadDays} วัน คือตั้งแต่ ${fullDate(first)} เป็นต้นไป` : 'วันที่เลือกผ่านมาแล้ว กรุณาเลือกวันถัดไป')
    : form.day > shiftDay(180) ? 'จองล่วงหน้าได้ไม่เกิน 180 วัน'
    : dayInfo?.status && dayInfo.status !== 'open' ? DAY_BLOCKED[dayInfo.status] : ''
  const timingAdvice = bookingTimingAdvice(form, info)
  const span = journeyWindow(form, info)
  const outsideHours = span && (span.start < info.office_start || (span.end !== null && span.end > info.office_end))
    ? `เวลานัดนี้รถต้องออกจากพื้นที่ประมาณ ${dayClock(span.start)}${span.end === null ? '' : ` และกลับถึงประมาณ ${dayClock(span.end)}`} ซึ่งอยู่นอกเวลาบริการ ${clockTime(info.office_start)}–${clockTime(info.office_end)} กรุณาเลือกเวลานัดอื่นหรือติดต่อเจ้าหน้าที่เพื่อประสานล่วงหน้า` : ''
  const invalidReturn = form.return_mode !== 'one_way' && form.back && form.time && form.back < form.time
  const stop = invalidReturn || (!staffEntry && (dayBlocked || outsideHours))
  // รายการเวลาเป็นช่วงที่จองได้จริง (เผื่อเวลาเดินทางแล้ว) ไม่ใช่ทุกเวลาในวัน
  const slotFrom = timingAdvice?.possible ? timingAdvice.earliest : info.office_start
  const slotTo = timingAdvice?.possible ? timingAdvice.latest : info.office_end
  const slots = useMemo(() => {
    const out = []
    for (let m = Math.ceil(slotFrom / STEP_MINUTES) * STEP_MINUTES; m <= slotTo; m += STEP_MINUTES) out.push(clockTime(m))
    return out
  }, [slotFrom, slotTo])
  const timeChoices = form.time && !slots.includes(form.time) ? [form.time, ...slots] : slots
  const submissionAdvice = /ข้อความใช้ข้อมูลเปลี่ยน/.test(submitError)
    ? 'อ่านข้อความการใช้ข้อมูลในหัวข้อ 4 อีกครั้ง ตรวจว่าคุณยังยินยอม แล้วกดส่งคำขอเดิมอีกครั้ง'
    : /รับกลับ/.test(submitError) ? 'ตรวจ “คาดว่าพร้อมรับกลับ” ให้ไม่ก่อนเวลานัดและอยู่ในวันเดียวกัน'
    : /วันนัด|วันหยุด|ล่วงหน้า/.test(submitError) ? 'ตรวจวันที่นัดกับช่วงวันรับจองที่แสดง หากวันนัดเปลี่ยนไม่ได้ ให้ติดต่อเจ้าหน้าที่'
    : /ร่วมเที่ยว|ที่นั่ง|เต็ม|เที่ยว.*เปลี่ยน|คิว/.test(submitError) ? 'เที่ยวที่เลือกอาจเปลี่ยนหลังเปิดหน้า ให้ตรวจ “ดูตารางรถ” อีกครั้งหรือติดต่อเจ้าหน้าที่เพื่อหาเที่ยวที่เหมาะสม'
    : /ปิดรับ|ไม่เปิด|ไม่พร้อม/.test(submitError) ? 'หน่วยงานยังรับคำขอนี้ไม่ได้ กรุณาติดต่อเจ้าหน้าที่ตามเบอร์ด้านล่างเพื่อประสานการเดินทาง'
    : /อนุญาต|กระทำแทน/.test(submitError) ? 'ตรวจช่องยืนยันสิทธิ์จองแทนในหัวข้อ 4 โดยยืนยันเฉพาะเมื่อได้รับอนุญาตหรือมีอำนาจกระทำแทนจริง'
    : 'ตรวจการเชื่อมต่อแล้วกดส่งซ้ำจากหน้านี้ได้ ระบบใช้รหัสคำขอเดิมเพื่อป้องกันคำขอซ้ำ หากยังไม่สำเร็จให้ติดต่อเจ้าหน้าที่พร้อมข้อความนี้'
  const contact = info.contact_phone && <p className="mt-2 text-sm">ติดต่อเจ้าหน้าที่ <a className="font-semibold underline" href={`tel:${info.contact_phone}`}>{info.contact_phone}</a></p>
  // ปุ่มส่งกดได้เสมอ ถ้าขาดอะไรให้บอกเป็นภาษาไทยว่าขาดอะไร แทนปุ่มสีเทาที่ไม่บอกเหตุผล
  function incomplete() {
    const list = []
    if (!form.day) list.push({ label: 'วันที่ไปโรงพยาบาล', advice: 'กดเลือกวันจากปุ่มด้านบน หรือกด “เลือกวันอื่น” แล้วระบุวันตามใบนัด' })
    if (!form.time) list.push({ label: 'เวลานัดแพทย์', advice: 'เลือกเวลานัดตามใบนัดแพทย์ ไม่ใช่เวลาที่ต้องการให้รถมารับ' })
    if (!form.route_id) list.push({ label: 'โรงพยาบาลและพื้นที่จุดรับ', advice: 'เลือกโรงพยาบาลปลายทางจากรายการ' })
    if (!String(form.requester_name).trim()) list.push({ label: 'ชื่อ–สกุลผู้จอง', advice: 'กรอกชื่อและนามสกุลของผู้ที่ติดต่อกลับได้' })
    if (!/^0[0-9]{8,9}$/.test(form.phone)) list.push({ label: 'เบอร์ติดต่อกลับ', advice: 'กรอกเบอร์โทรที่ขึ้นต้นด้วย 0 จำนวน 9–10 หลัก ใช้ตัวเลขติดกัน ไม่เว้นวรรคหรือใส่ขีด' })
    if (form.relation !== 'self' && !String(form.patient_name).trim()) list.push({ label: 'ชื่อ–สกุลผู้เดินทาง', advice: 'กรอกชื่อผู้ป่วยที่จะเดินทางจริง' })
    if (!String(form.pickup).trim()) list.push({ label: 'จุดรับและจุดสังเกต', advice: 'บอกบ้านเลขที่ หมู่บ้าน และจุดสังเกตให้คนขับหาเจอ' })
    if (!form.in_area) list.push({ label: 'ยืนยันว่าจุดรับอยู่ในเขตพื้นที่ให้บริการ', advice: 'ติ๊กช่องนี้เมื่อจุดรับอยู่ในเขต หากไม่อยู่ในเขตหรือไม่แน่ใจ ให้ติดต่อเจ้าหน้าที่ก่อน อย่าส่งคำขอทิ้งไว้เพราะระบบจะจัดรถให้ไม่ได้' })
    if (form.is_emergency) list.push({ label: 'ยืนยันว่าเป็นการเดินทางตามนัด ไม่ใช่เหตุฉุกเฉิน', advice: 'อ่านข้อความข้างช่องแล้วติ๊กยืนยันเฉพาะเมื่อเป็นจริง หากเป็นเหตุฉุกเฉินให้โทร 1669' })
    if (form.relation !== 'self' && !form.representative_authorized) list.push({ label: 'ยืนยันสิทธิ์จองแทน', advice: 'อ่านข้อความข้างช่องแล้วติ๊กยืนยันเฉพาะเมื่อเป็นจริง หากยังยืนยันไม่ได้ ให้ติดต่อเจ้าหน้าที่ก่อนส่งคำขอ' })
    if (!form.consent) list.push({ label: 'ยืนยันการใช้ข้อมูล', advice: 'อ่านข้อความข้างช่องแล้วติ๊กยืนยันเฉพาะเมื่อเป็นจริง หากยังยืนยันไม่ได้ ให้ติดต่อเจ้าหน้าที่ก่อนส่งคำขอ' })
    return list
  }
  const change = key => e => { if (key === 'phone') setPhoneNotice(''); setMissing([]); setForm(f => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })) }
  const field = (key, label, type = 'text', extra = {}) => <label className="block">{label}<input className={inputClass} type={type} value={form[key]} onChange={change(key)} {...extra} /></label>
  const select = (key, label, values) => <label className="block">{label}<select aria-label={label} className={inputClass} value={form[key]} onChange={change(key)}>{Object.entries(values).map(([v, text]) => <option key={v} value={v}>{text}</option>)}</select></label>
  const timeSelect = (key, label) => <label className="block">{label}<select aria-label={label} className={inputClass} value={form[key]} onChange={change(key)}>
    <option value="">— เลือกเวลา —</option>{timeChoices.map(t => <option key={t} value={t}>{t} น.</option>)}</select></label>
  const payload = () => ({ ...form, patient_name: form.relation === 'self' ? form.requester_name : form.patient_name,
    pickup_lat: form.pickup_lat ?? '', pickup_lng: form.pickup_lng ?? '',
    companions: Number(form.companions), appointment_at: bangkokISO(form.day, form.time),
    return_at: form.return_mode === 'one_way' ? null : bangkokISO(form.day, form.back),
    privacy_notice: info.privacy_notice, owner_name: info.owner_name, consent_version: info.consent_version })
  function submit(event) {
    event.preventDefault()
    const list = incomplete()
    setMissing(list)
    if (list.length || stop) return
    onSubmit(id.current, payload())
  }
  return <form noValidate onSubmit={submit} className="space-y-5">
    <button type="button" className={buttonClass} disabled={busy} onClick={onBack}>← ย้อนกลับ</button>
    <h2 className="text-xl font-bold">ขอจองรถรับ–ส่งผู้ป่วย</h2>
    <p className="rounded-xl bg-amber-50 p-3">เจ็บป่วยฉุกเฉิน <a className="font-bold underline" href="tel:1669">โทร 1669</a> อย่ารอคิวจองรถ</p>
    {initial.requested_trip_id && <p className="rounded-xl bg-sky-50 p-3">ขอนั่งรถเที่ยวที่เลือก กรุณาระบุเวลานัดจริง ระบบจะตรวจเวลาและที่นั่งอีกครั้งก่อนส่ง เจ้าหน้าที่ต้องยืนยันก่อนเดินทาง</p>}
    {staffEntry && <p className="rounded-xl bg-sky-50 p-3">รับเรื่องแทนทางโทรศัพท์/หน้าเคาน์เตอร์ ใช้ข้อมูลชุดเดียวกับการจองออนไลน์</p>}

    <section className="space-y-3" aria-label="วันที่ไปโรงพยาบาล">
      <h3 className="text-base font-bold">1 · วันที่ไปโรงพยาบาล</h3>
      {openDays.length > 0 && <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {openDays.slice(0, QUICK_DAYS).map(d => <button key={d.date} type="button" aria-pressed={form.day === d.date}
          className={`min-h-16 rounded-xl border px-3 py-2 text-center ${form.day === d.date ? 'border-sky-800 bg-sky-800 text-white' : 'border-slate-300 bg-white'}`}
          onClick={() => { setPickedDay(true); setMissing([]); setForm(f => ({ ...f, day: d.date })) }}>
          <span className="block font-bold">{chipDay(d.date)}</span><span className="block text-sm">{chipDate(d.date)}</span></button>)}
      </div>}
      <p className="rounded-xl bg-sky-50 p-3">วันที่เลือก: <strong>{fullDate(form.day)}</strong></p>
      <details className="rounded-xl border border-slate-200 px-3">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">เลือกวันอื่น</summary>
        <div className="space-y-2 pb-3">
          {field('day', 'วันที่นัดแพทย์', 'date', { min: first, max: shiftDay(180), onChange: e => { if (!e.target.value) return; setPickedDay(true); setMissing([]); setForm(f => ({ ...f, day: e.target.value })) } })}
          <p className="text-sm text-slate-600">{staffEntry ? 'เจ้าหน้าที่รับเรื่องแทนได้ทุกวันที่ประสานแล้ว' : `จองได้ตั้งแต่ ${fullDate(first)} เป็นต้นไป${leadDays ? ` (ล่วงหน้าอย่างน้อย ${leadDays} วัน)` : ''} เว้นวันหยุดของหน่วยงาน`}</p>
        </div>
      </details>
      {calendar?.failed && <p role="status" className="rounded-xl bg-amber-50 p-3">ตรวจวันว่างไม่สำเร็จ อาจเป็นปัญหาการเชื่อมต่อ · วิธีแก้: ตรวจอินเทอร์เน็ตแล้วลองใหม่ หรือกรอกต่อได้ ระบบจะตรวจอีกครั้งตอนส่งคำขอ</p>}
    </section>

    <section className="space-y-3" aria-label="เวลานัดและปลายทาง">
      <h3 className="text-base font-bold">2 · เวลานัดและโรงพยาบาล</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        {timeSelect('time', 'เวลานัดแพทย์')}
        <label className="block">โรงพยาบาลและพื้นที่จุดรับ<select aria-label="โรงพยาบาลและพื้นที่จุดรับ" className={inputClass} value={form.route_id} onChange={change('route_id')}><option value="">เลือกเส้นทาง</option>{info.routes?.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
        {select('return_mode', 'ขากลับ', RETURN_MODES)}
        {form.return_mode !== 'one_way' && timeSelect('back', 'คาดว่าพร้อมรับกลับ (ยังไม่ทราบเว้นว่างได้)')}
      </div>
      {timingAdvice && <section aria-label="คำแนะนำจากข้อมูลการเดินทาง" className="space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-4">
        <h3 className="font-semibold">ระบบช่วยคำนวณการเดินทาง</h3>
        {timingAdvice.possible
          ? <p className="text-sm">เส้นทางนี้ไป-กลับใช้เวลาประมาณ {timingAdvice.travel} นาที · เวลานัดที่รถไปส่งทันคือ <strong>{clockTime(timingAdvice.earliest)}–{clockTime(timingAdvice.latest)} น.</strong> (รายการเวลาข้างบนให้เลือกเฉพาะช่วงนี้แล้ว)</p>
          : <p className="text-sm">ระยะเวลาเดินทางยาวกว่าช่วงให้บริการ แม้ยังไม่รวมเวลาที่โรงพยาบาล · ให้ติดต่อเจ้าหน้าที่เพื่อประสานแผนเดินทาง</p>}
        {span && <p className="text-sm">จากเวลาที่เลือก: รถเริ่มไปรับประมาณ <strong>{dayClock(span.start)} น.</strong>{span.end !== null && <> · กลับถึงพื้นที่ประมาณ <strong>{dayClock(span.end)} น.</strong></>}</p>}
        <p className="text-sm text-slate-600">เป็นประมาณการ ยังไม่รวมผลตรวจคิวว่าง ใช้เวลานัดจริงตามใบนัด หากเวลานัดจริงไม่มีในรายการให้ติดต่อเจ้าหน้าที่</p>
      </section>}
      {dayInfo?.status === 'open' && !stop && form.time && <p role="status" className="rounded-xl bg-emerald-50 p-3">วันนี้เปิดรับจอง เจ้าหน้าที่จะตรวจคิวและแจ้งเวลารถมารับอีกครั้ง</p>}
      {form.return_mode !== 'one_way' && !form.back && <p className="rounded-xl bg-sky-50 p-3 text-sm">ยังไม่ระบุเวลารับกลับ: ส่งคำขอได้ เจ้าหน้าที่จะประสานเวลาเพิ่มเติมก่อนยืนยันรถ</p>}
    </section>

    <section className="space-y-3" aria-label="ผู้เดินทางและจุดรับ">
      <h3 className="text-base font-bold">3 · ผู้เดินทางและจุดรับ</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        {field('requester_name', 'ชื่อ–สกุลผู้จอง', 'text', { maxLength: 200 })}
        {field('phone', 'เบอร์ติดต่อกลับ', 'tel', { maxLength: 30, inputMode: 'tel', onBlur: () => {
          const phone = normalizeBookingPhone(form.phone)
          if (phone !== form.phone) { setForm(f => ({ ...f, phone })); setPhoneNotice(`จัดรูปแบบเบอร์โทรเป็น ${phone} แล้ว กรุณาตรวจว่าถูกต้อง`) }
        } })}
        {phoneNotice && <p role="status" className="text-sm text-sky-800">{phoneNotice}</p>}
        {select('relation', 'ผู้จองเป็น', { self: 'ผู้ป่วยจองเอง', relative: 'ญาติจองแทน', caregiver: 'ผู้ดูแลจองแทน' })}
        {form.relation !== 'self' && field('patient_name', 'ชื่อ–สกุลผู้เดินทาง', 'text', { maxLength: 200 })}
      </div>
      {field('pickup', 'จุดรับและจุดสังเกต', 'text', { maxLength: 500 })}
      {/* ⚠️ ช่องนี้ถอดออกจากฝั่งประชาชนไม่ได้: patient_booking_submit_join ตรวจแผนตั้งแต่ตอนส่ง
          ถ้า in_area เป็น false คำขอ "ขอนั่งรถคันนี้ไปด้วย" จะถูกปฏิเสธทันทีด้วยข้อความ
          "ต้องตรวจสอบพื้นที่รับบริการ" และคำขอธรรมดาก็ค้างรอให้เจ้าหน้าที่มาติ๊กให้ทุกใบ
          จึงคงไว้แต่เปลี่ยนถ้อยคำ: ของเดิมเขียนว่า "หากไม่แน่ใจให้เจ้าหน้าที่ตรวจสอบ" ซึ่งชวนให้ไม่ติ๊ก
          แล้วคำขอก็เงียบไปโดยไม่มีใครรู้ว่าติดอะไร */}
      <label className="flex min-h-11 gap-3"><input className="mt-1 size-5 shrink-0" type="checkbox" checked={form.in_area} onChange={change('in_area')} />{staffEntry ? 'ตรวจแล้วว่าจุดรับอยู่ในเขตพื้นที่' : 'จุดรับอยู่ในเขตพื้นที่ให้บริการ'}</label>
      {!staffEntry && <p className="text-sm text-slate-600">ถ้าไม่อยู่ในเขตหรือไม่แน่ใจ ให้ติดต่อเจ้าหน้าที่ก่อนส่งคำขอ{info.contact_phone && <> ที่ <a className="font-semibold underline" href={`tel:${info.contact_phone}`}>{info.contact_phone}</a></>} เจ้าหน้าที่จะตรวจอีกครั้งก่อนยืนยันรถ</p>}
      <details className="rounded-xl border border-slate-200 px-3">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">ตัวเลือกเพิ่มเติม (ไม่ระบุก็จองได้)</summary>
        <div className="space-y-3 pb-3">
          <div className="grid gap-4 sm:grid-cols-2">
            {select('mobility', 'การเคลื่อนไหว', MOBILITY)}
            {select('companions', 'ผู้ติดตาม', { 0: 'ไม่มี', 1: '1 คน', 2: '2 คน', 3: '3 คน', 4: '4 คน', 5: '5 คน' })}
          </div>
          {/* หมุดเป็นทางเลือก — ผู้สูงอายุที่ปักหมุดไม่เป็นยังจองได้ด้วยข้อความอย่างเดียว (เจ้าของระบบสั่ง 2569-09-19) */}
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="font-semibold">ปักหมุดจุดรับ</p>
            <p className="text-sm text-slate-600">ปักหมุดแล้วคนขับกดนำทางไปที่บ้านได้เลย ไม่ปักก็จองได้ เจ้าหน้าที่จะโทรถามเส้นทางแทน</p>
            {form.pickup_lat === null
              ? <button type="button" className={`${buttonClass} mt-3`} onClick={() => setShowMap(true)}>ปักหมุดจากแผนที่</button>
              : <div className="mt-3 flex flex-wrap items-center gap-3">
                  <span className="rounded-lg bg-emerald-50 px-3 py-2 text-sm">ปักหมุดแล้ว · {form.pickup_lat.toFixed(5)}, {form.pickup_lng.toFixed(5)}</span>
                  <button type="button" className={buttonClass} onClick={() => setShowMap(true)}>แก้หมุด</button>
                  <button type="button" className={buttonClass} onClick={() => setForm(f => ({ ...f, pickup_lat: null, pickup_lng: null }))}>เอาหมุดออก</button>
                </div>}
          </div>
          <label className="flex min-h-11 gap-3"><input className="mt-1 size-5 shrink-0" type="checkbox" checked={form.share} onChange={change('share')} />สะดวกร่วมเที่ยว หากเวลาและเส้นทางเหมาะสม</label>
        </div>
      </details>
      {showMap && <MapPicker
        initialPos={form.pickup_lat === null ? null : { lat: form.pickup_lat, lng: form.pickup_lng }}
        fallbackPos={tenant?.latitude ? { lat: tenant.latitude, lng: tenant.longitude } : null}
        onConfirm={({ lat, lng, address }) => {
          // เติมที่อยู่จากแผนที่ให้เฉพาะตอนช่องยังว่าง ไม่ทับสิ่งที่ผู้จองพิมพ์เอง
          setForm(f => ({ ...f, pickup_lat: lat, pickup_lng: lng, pickup: f.pickup || address || '' }))
          setShowMap(false)
        }}
        onClose={() => setShowMap(false)} />}
    </section>

    <section className="space-y-3" aria-label="ตรวจสอบก่อนส่ง">
      <h3 className="text-base font-bold">4 · ตรวจสอบก่อนส่ง</h3>
      <dl className="grid gap-3 rounded-xl bg-sky-50 p-4 sm:grid-cols-2"><div><dt>ผู้เดินทาง</dt><dd className="font-bold">{payload().patient_name || 'ยังไม่ได้กรอก'}</dd></div><div><dt>วันเวลานัด</dt><dd className="font-bold">{fullDate(form.day)} {form.time ? `${form.time} น.` : ''}</dd></div><div><dt>ปลายทาง/จุดรับ</dt><dd>{info.routes?.find(r => r.id === form.route_id)?.label || 'ยังไม่ได้เลือก'} · {form.pickup || 'ยังไม่ได้กรอกจุดรับ'}</dd></div><div><dt>ขากลับ</dt><dd>{RETURN_MODES[form.return_mode]} {form.back || 'ยังไม่ทราบเวลา'}</dd></div></dl>
      <div className="whitespace-pre-wrap rounded-xl border border-slate-200 p-4 text-sm">{info.privacy_notice}<p className="mt-3 font-bold">เจ้าของรถและผู้รับข้อมูล: {info.owner_name}</p></div>
      <label className="flex min-h-11 gap-3"><input className="mt-1 size-5 shrink-0" type="checkbox" checked={!form.is_emergency} onChange={e => { setMissing([]); setForm(f => ({ ...f, is_emergency: !e.target.checked })) }} />เป็นการเดินทางตามนัด ไม่ใช่เหตุฉุกเฉิน</label>
      {form.relation !== 'self' && <label className="flex min-h-11 gap-3"><input className="mt-1 size-5 shrink-0" type="checkbox" checked={form.representative_authorized} onChange={change('representative_authorized')} />ได้รับอนุญาตจากผู้ป่วย หรือมีอำนาจกระทำการแทนผู้ป่วยแล้ว</label>}
      <label className="flex min-h-11 gap-3"><input className="mt-1 size-5 shrink-0" type="checkbox" checked={form.consent} onChange={change('consent')} />ยืนยันการใช้ข้อมูลตามข้อความข้างต้น และข้อมูลจองถูกต้อง</label>
      <p className="text-sm text-slate-600">ส่งคำขอแล้วต้องรอเจ้าหน้าที่ {orgAbbr()} ยืนยันรถและเวลารับ</p>
    </section>

    {(dayBlocked || outsideHours) && <div role="alert" className={`space-y-2 rounded-xl p-3 ${staffEntry ? 'bg-amber-50' : 'bg-red-50 text-red-900'}`}>
      {dayBlocked && <div><p className="font-semibold">จองวันที่เลือกไม่ได้: {dayBlocked}</p><p className="mt-1 text-sm"><strong>วิธีแก้: </strong>{dayInfo?.status === 'unavailable' || dayInfo?.status === 'issue' ? 'ติดต่อเจ้าหน้าที่เพื่อประสานรถ หรือเลือกวันอื่นจากปุ่มวันที่ด้านบน' : 'กดเลือกวันจากปุ่มวันที่ว่างด้านบน ซึ่งเป็นวันที่จองได้จริงทั้งหมด'}</p></div>}
      {outsideHours && <div><p className="font-semibold">เวลารถรับ–ส่งเกินช่วงให้บริการ</p><p>{outsideHours}</p><p className="mt-1 text-sm"><strong>วิธีแก้: </strong>ตรวจ “เวลานัดแพทย์” และ “คาดว่าพร้อมรับกลับ” ให้ตรงตามจริง ระบบเผื่อเวลาเดินทางและรับ–ส่งแล้ว หากเวลาถูกต้องแต่ยังเกินช่วงบริการ ให้ติดต่อเจ้าหน้าที่ ไม่ต้องเปลี่ยนเวลานัดให้ผิดจากใบนัด</p></div>}
      {staffEntry ? <p className="text-sm">รับเรื่องแทนต่อได้ แต่ต้องประสานวันเวลากับผู้จองและคนขับก่อนยืนยันคิว</p>
        : <p className="text-sm">กรุณาแก้วันหรือเวลานัด{info.contact_phone && <> · ติดต่อเจ้าหน้าที่ <a className="font-semibold underline" href={`tel:${info.contact_phone}`}>{info.contact_phone}</a></>}</p>}
    </div>}
    {invalidReturn && <div role="alert" className="rounded-xl bg-red-50 p-3 text-red-900"><p className="font-semibold">เวลาพร้อมรับกลับ {form.back} อยู่ก่อนเวลานัด {form.time}</p><p><strong>วิธีแก้: </strong>แก้ “คาดว่าพร้อมรับกลับ” ให้ไม่ก่อนเวลานัด หากยังไม่ทราบให้เลือก “— เลือกเวลา —” เพื่อให้เจ้าหน้าที่ประสาน</p></div>}
    {missing.length > 0 && <div role="alert" className="space-y-2 rounded-xl bg-red-50 p-3 text-red-900">
      <p className="font-semibold">ยังส่งคำขอไม่ได้ เพราะยังไม่ได้กรอก {missing.length} อย่าง</p>
      <ul className="space-y-2">{missing.map(item => <li key={item.label}><strong>{item.label}</strong><span className="block text-sm">{item.advice}</span></li>)}</ul>
    </div>}
    {submitError && <div role="alert" className="rounded-xl bg-red-50 p-3 text-red-900"><p className="font-semibold">ส่งคำขอยังไม่สำเร็จ</p><p>{submitError}</p><p className="mt-2"><strong>วิธีแก้: </strong>{submissionAdvice}</p>{contact}</div>}
    <button className={`${primaryClass} w-full text-base sm:w-auto`} disabled={busy}>{busy ? 'กำลังส่ง…' : 'ส่งคำขอจองรถ'}</button>
  </form>
}
