import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import MapPicker from '../MapPicker'
import { RETURN_MODES, MOBILITY, DAY_BLOCKED, inputClass, buttonClass, primaryClass, thaiDay, bangkokISO, clockTime, journeyWindow, orgAbbr } from '../../lib/patientBooking'

const shiftDay = days => thaiDay(Date.now() + days * 86400000)
const dayClock = value => clockTime(((value % 1440) + 1440) % 1440)

export default function BookingForm({ tenantId, initial = {}, info, profileName, profilePhone, staffEntry, onSubmit, onBack, busy }) {
  const { tenant } = useTenant()
  const [showMap, setShowMap] = useState(false)
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({ requester_name: staffEntry ? '' : profileName || '', phone: staffEntry ? '' : profilePhone || '', patient_name: '', relation: 'self', pickup: '', in_area: false,
    day: thaiDay(), time: '', route_id: info.routes?.[0]?.id || '', mobility: 'walk', companions: 0, share: false,
    return_mode: 'wait', back: '', is_emergency: true, consent: false, representative_authorized: false,
    pickup_lat: null, pickup_lng: null, ...initial })
  const id = useRef(crypto.randomUUID()) // Stable on uncertain response; retry the same operation.
  // The public calendar already knows holidays, lead time, unchecked calendar days and open incidents.
  // Asking it here keeps those requests out of the queue instead of leaving staff to phone people back.
  const [dayState, setDayState] = useState(null)
  useEffect(() => {
    if (!tenantId || !form.day) { setDayState(null); return }
    let active = true
    supabase.rpc('patient_booking_calendar', { p_muni: tenantId, p_from: form.day, p_to: form.day }).then(({ data, error }) => {
      if (!active) return
      setDayState(error ? { day: form.day, failed: true } : { day: form.day, status: data?.days?.[0]?.status })
    })
    return () => { active = false }
  }, [tenantId, form.day])
  const leadDays = staffEntry ? 0 : Number(info.min_lead_days) || 0
  const day = dayState?.day === form.day ? dayState : null
  const dayBlocked = form.day < shiftDay(leadDays) ? (leadDays ? `ต้องจองล่วงหน้าอย่างน้อย ${leadDays} วัน คือตั้งแต่ ${shiftDay(leadDays)} เป็นต้นไป` : 'วันที่เลือกผ่านมาแล้ว กรุณาเลือกวันถัดไป')
    : form.day > shiftDay(180) ? 'จองล่วงหน้าได้ไม่เกิน 180 วัน'
    : day?.status && day.status !== 'open' ? DAY_BLOCKED[day.status] : ''
  const span = journeyWindow(form, info)
  const outsideHours = span && (span.start < info.office_start || (span.end !== null && span.end > info.office_end))
    ? `เวลานัดนี้รถต้องออกจากพื้นที่ประมาณ ${dayClock(span.start)}${span.end === null ? '' : ` และกลับถึงประมาณ ${dayClock(span.end)}`} ซึ่งอยู่นอกเวลาบริการ ${clockTime(info.office_start)}–${clockTime(info.office_end)} กรุณาเลือกเวลานัดอื่นหรือติดต่อเจ้าหน้าที่เพื่อประสานล่วงหน้า` : ''
  const stop = !staffEntry && (dayBlocked || outsideHours)
  const change = key => e => setForm(f => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const field = (key, label, type = 'text', extra = {}) => <label className="block">{label}<input className={inputClass} type={type} value={form[key]} onChange={change(key)} {...extra} /></label>
  const select = (key, label, values) => <label className="block">{label}<select aria-label={label} className={inputClass} value={form[key]} onChange={change(key)}>{Object.entries(values).map(([v, text]) => <option key={v} value={v}>{text}</option>)}</select></label>
  const payload = () => ({ ...form, patient_name: form.relation === 'self' ? form.requester_name : form.patient_name,
    pickup_lat: form.pickup_lat ?? '', pickup_lng: form.pickup_lng ?? '',
    companions: Number(form.companions), appointment_at: bangkokISO(form.day, form.time),
    return_at: form.return_mode === 'one_way' ? null : bangkokISO(form.day, form.back),
    privacy_notice: info.privacy_notice, owner_name: info.owner_name, consent_version: info.consent_version })
  return <form onSubmit={e => { e.preventDefault(); if (step < 3) setStep(step + 1); else onSubmit(id.current, payload()) }} className="space-y-5">
    <button type="button" className={buttonClass} disabled={busy} onClick={() => step > 1 ? setStep(step - 1) : onBack()}>← ย้อนกลับ</button>
    <h2 className="text-xl font-bold">{step} จาก 3 · {['นัดหมายและการเดินทาง', 'ผู้เดินทางและจุดรับ', 'ตรวจสอบก่อนส่ง'][step - 1]}</h2>
    {initial.requested_trip_id && <p className="rounded-xl bg-sky-50 p-3">ขอร่วมเที่ยวที่เลือก กรุณาระบุเวลานัดจริง ระบบจะตรวจเวลาและที่นั่งอีกครั้งก่อนส่ง เจ้าหน้าที่ต้องยืนยันก่อนเดินทาง</p>}
    {staffEntry && <p className="rounded-xl bg-sky-50 p-3">รับเรื่องแทนทางโทรศัพท์/หน้าเคาน์เตอร์ ใช้ข้อมูลชุดเดียวกับการจองออนไลน์</p>}
    {step === 1 && <>
      <div className="grid gap-4 sm:grid-cols-2">{field('day', 'วันที่นัดแพทย์', 'date', { required: true, min: shiftDay(leadDays), max: shiftDay(180) })}{field('time', 'เวลานัดแพทย์', 'time', { required: true })}
        <label>โรงพยาบาลและพื้นที่จุดรับ<select className={inputClass} value={form.route_id} onChange={change('route_id')} required><option value="">เลือกเส้นทาง</option>{info.routes?.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
        {select('return_mode', 'ขากลับ', RETURN_MODES)}{form.return_mode !== 'one_way' && field('back', 'คาดว่าพร้อมรับกลับ (ยังไม่ทราบเว้นว่างได้)', 'time')}
      </div>
      <p className="text-sm text-slate-600">เวลารถมารับจะแจ้งหลังยืนยันคิว {staffEntry ? 'เจ้าหน้าที่รับเรื่องแทนได้ทุกวันที่ประสานแล้ว' : `จองได้ตั้งแต่ ${shiftDay(leadDays)} เป็นต้นไป${leadDays ? ` (ล่วงหน้าอย่างน้อย ${leadDays} วัน)` : ''} เว้นวันหยุดของหน่วยงาน`}</p>
      {day?.status === 'open' && !outsideHours && <p role="status" className="rounded-xl bg-emerald-50 p-3">วันนี้เปิดรับจอง เจ้าหน้าที่จะตรวจคิวและแจ้งเวลารถมารับอีกครั้ง</p>}
      <label className="flex min-h-11 items-start gap-3"><input className="mt-1 size-5 shrink-0" type="checkbox" required checked={!form.is_emergency} onChange={e => setForm(f => ({ ...f, is_emergency: !e.target.checked }))} />เป็นการเดินทางตามนัด ไม่ใช่เหตุฉุกเฉิน</label>
      <p className="rounded-xl bg-amber-50 p-3">เจ็บป่วยฉุกเฉิน <a className="font-bold underline" href="tel:1669">โทร 1669</a> อย่ารอคิวจองรถ</p>
    </>}
    {step === 2 && <>
      <div className="grid gap-4 sm:grid-cols-2">{field('requester_name', 'ชื่อ–สกุลผู้จอง', 'text', { required: true, maxLength: 200 })}
        {field('phone', 'เบอร์ติดต่อกลับ', 'tel', { required: true, pattern: '0[0-9]{8,9}', maxLength: 10 })}
        {select('relation', 'ผู้จองเป็น', { self: 'ผู้ป่วยจองเอง', relative: 'ญาติจองแทน', caregiver: 'ผู้ดูแลจองแทน' })}
        {form.relation !== 'self' && field('patient_name', 'ชื่อ–สกุลผู้เดินทาง', 'text', { required: true, maxLength: 200 })}
        {select('mobility', 'การเคลื่อนไหว', MOBILITY)}
        {select('companions', 'ผู้ติดตาม', { 0: 'ไม่มี', 1: '1 คน', 2: '2 คน', 3: '3 คน', 4: '4 คน', 5: '5 คน' })}
      </div>
      {/* หมุดเป็นทางเลือก — ผู้สูงอายุที่ปักหมุดไม่เป็นยังจองได้ด้วยข้อความอย่างเดียว (เจ้าของระบบสั่ง 2569-09-19) */}
      <div className="rounded-xl border border-slate-200 p-3">
        <p className="font-semibold">ปักหมุดจุดรับ (ถ้าสะดวก)</p>
        <p className="text-sm text-slate-600">ปักหมุดแล้วคนขับกดนำทางไปที่บ้านได้เลย ไม่ปักก็จองได้ เจ้าหน้าที่จะโทรถามเส้นทางแทน</p>
        {form.pickup_lat === null
          ? <button type="button" className={`${buttonClass} mt-3`} onClick={() => setShowMap(true)}>ปักหมุดจากแผนที่</button>
          : <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="rounded-lg bg-emerald-50 px-3 py-2 text-sm">ปักหมุดแล้ว · {form.pickup_lat.toFixed(5)}, {form.pickup_lng.toFixed(5)}</span>
              <button type="button" className={buttonClass} onClick={() => setShowMap(true)}>แก้หมุด</button>
              <button type="button" className={buttonClass} onClick={() => setForm(f => ({ ...f, pickup_lat: null, pickup_lng: null }))}>เอาหมุดออก</button>
            </div>}
      </div>
      <div>{field('pickup', 'จุดรับและจุดสังเกต', 'text', { required: true, maxLength: 500 })}</div>
      {showMap && <MapPicker
        initialPos={form.pickup_lat === null ? null : { lat: form.pickup_lat, lng: form.pickup_lng }}
        fallbackPos={tenant?.latitude ? { lat: tenant.latitude, lng: tenant.longitude } : null}
        onConfirm={({ lat, lng, address }) => {
          // เติมที่อยู่จากแผนที่ให้เฉพาะตอนช่องยังว่าง ไม่ทับสิ่งที่ผู้จองพิมพ์เอง
          setForm(f => ({ ...f, pickup_lat: lat, pickup_lng: lng, pickup: f.pickup || address || '' }))
          setShowMap(false)
        }}
        onClose={() => setShowMap(false)} />}
      <label className="flex min-h-11 gap-3"><input className="mt-1 size-5 shrink-0" type="checkbox" checked={form.in_area} onChange={change('in_area')} />ผู้เดินทางอยู่ในเขตพื้นที่ (หากไม่แน่ใจให้เจ้าหน้าที่ตรวจสอบ)</label>
      <label className="flex min-h-11 gap-3"><input className="mt-1 size-5 shrink-0" type="checkbox" checked={form.share} onChange={change('share')} />สะดวกร่วมเที่ยว หากเวลาและเส้นทางเหมาะสม</label>
    </>}
    {step === 3 && <>
      <dl className="grid gap-3 rounded-xl bg-sky-50 p-4 sm:grid-cols-2"><div><dt>ผู้เดินทาง</dt><dd className="font-bold">{payload().patient_name}</dd></div><div><dt>วันเวลานัด</dt><dd className="font-bold">{form.day} {form.time}</dd></div><div><dt>ปลายทาง/จุดรับ</dt><dd>{info.routes.find(r => r.id === form.route_id)?.label} · {form.pickup}</dd></div><div><dt>ขากลับ</dt><dd>{RETURN_MODES[form.return_mode]} {form.back || 'ยังไม่ทราบเวลา'}</dd></div></dl>
      <div className="whitespace-pre-wrap rounded-xl border border-slate-200 p-4 text-sm">{info.privacy_notice}<p className="mt-3 font-bold">เจ้าของรถและผู้รับข้อมูล: {info.owner_name}</p></div>
      {form.relation !== 'self' && <label className="flex min-h-11 gap-3"><input className="mt-1 size-5 shrink-0" type="checkbox" required checked={form.representative_authorized} onChange={change('representative_authorized')} />ได้รับอนุญาตจากผู้ป่วย หรือมีอำนาจกระทำการแทนผู้ป่วยแล้ว</label>}
      <label className="flex min-h-11 gap-3"><input className="mt-1 size-5 shrink-0" type="checkbox" required checked={form.consent} onChange={change('consent')} />ยืนยันการใช้ข้อมูลตามข้อความข้างต้น และข้อมูลจองถูกต้อง</label>
      <p className="text-sm text-slate-600">ส่งคำขอแล้วต้องรอเจ้าหน้าที่ {orgAbbr()} ยืนยันรถและเวลารับ</p>
    </>}
    {(dayBlocked || outsideHours) && <div role="alert" className={`space-y-2 rounded-xl p-3 ${staffEntry ? 'bg-amber-50' : 'bg-red-50 text-red-900'}`}>
      {dayBlocked && <p>{dayBlocked}</p>}{outsideHours && <p>{outsideHours}</p>}
      {staffEntry ? <p className="text-sm">รับเรื่องแทนต่อได้ แต่ต้องประสานวันเวลากับผู้จองและคนขับก่อนยืนยันคิว</p>
        : <p className="text-sm">กรุณาแก้วันหรือเวลานัด หรือดูวันว่างจาก “ดูตารางรถ”{info.contact_phone && <> · ติดต่อเจ้าหน้าที่ <a className="font-semibold underline" href={`tel:${info.contact_phone}`}>{info.contact_phone}</a></>}</p>}
    </div>}
    {day?.failed && <p role="status" className="rounded-xl bg-amber-50 p-3">ตรวจวันว่างไม่สำเร็จ ระบบจะตรวจอีกครั้งตอนส่งคำขอ</p>}
    <button className={primaryClass} disabled={busy || !!stop}>{busy ? 'กำลังส่ง…' : step < 3 ? 'ต่อไป' : 'ส่งคำขอจองรถ'}</button>
  </form>
}
