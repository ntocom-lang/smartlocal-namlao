import { useRef, useState } from 'react'
import { RETURN_MODES, MOBILITY, inputClass, buttonClass, primaryClass, thaiDay, bangkokISO } from '../../lib/patientBooking'

export default function BookingForm({ initial = {}, info, profileName, profilePhone, staffEntry, onSubmit, onBack, busy }) {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({ requester_name: staffEntry ? '' : profileName || '', phone: staffEntry ? '' : profilePhone || '', patient_name: '', relation: 'self', pickup: '', in_area: false,
    day: thaiDay(), time: '', route_id: info.routes?.[0]?.id || '', mobility: 'walk', companions: 1, share: false,
    return_mode: 'wait', back: '', is_emergency: true, consent: false, representative_authorized: false, ...initial })
  const id = useRef(crypto.randomUUID()) // Stable on uncertain response; retry the same operation.
  const change = key => e => setForm(f => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const field = (key, label, type = 'text', extra = {}) => <label className="block">{label}<input className={inputClass} type={type} value={form[key]} onChange={change(key)} {...extra} /></label>
  const select = (key, label, values) => <label className="block">{label}<select aria-label={label} className={inputClass} value={form[key]} onChange={change(key)}>{Object.entries(values).map(([v, text]) => <option key={v} value={v}>{text}</option>)}</select></label>
  const payload = () => ({ ...form, patient_name: form.relation === 'self' ? form.requester_name : form.patient_name,
    companions: Number(form.companions), appointment_at: bangkokISO(form.day, form.time),
    return_at: form.return_mode === 'one_way' ? null : bangkokISO(form.day, form.back),
    privacy_notice: info.privacy_notice, owner_name: info.owner_name, consent_version: info.consent_version })
  return <form onSubmit={e => { e.preventDefault(); if (step < 3) setStep(step + 1); else onSubmit(id.current, payload()) }} className="space-y-5">
    <button type="button" className={buttonClass} disabled={busy} onClick={() => step > 1 ? setStep(step - 1) : onBack()}>← ย้อนกลับ</button>
    <h2 className="text-xl font-bold">{step} จาก 3 · {['นัดหมายและการเดินทาง', 'ผู้เดินทางและจุดรับ', 'ตรวจสอบก่อนส่ง'][step - 1]}</h2>
    {initial.requested_trip_id && <p className="rounded-xl bg-sky-50 p-3">ขอร่วมเที่ยวที่เลือก กรุณาระบุเวลานัดจริง ระบบจะตรวจเวลาและที่นั่งอีกครั้งก่อนส่ง เจ้าหน้าที่ต้องยืนยันก่อนเดินทาง</p>}
    {staffEntry && <p className="rounded-xl bg-sky-50 p-3">รับเรื่องแทนทางโทรศัพท์/หน้าเคาน์เตอร์ ใช้ข้อมูลชุดเดียวกับการจองออนไลน์</p>}
    {step === 1 && <>
      <div className="grid gap-4 sm:grid-cols-2">{field('day', 'วันที่นัดแพทย์', 'date', { required: true, min: thaiDay() })}{field('time', 'เวลานัดแพทย์', 'time', { required: true })}
        <label>โรงพยาบาลและพื้นที่จุดรับ<select className={inputClass} value={form.route_id} onChange={change('route_id')} required><option value="">เลือกเส้นทาง</option>{info.routes?.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
        {select('return_mode', 'ขากลับ', RETURN_MODES)}{form.return_mode !== 'one_way' && field('back', 'คาดว่าพร้อมรับกลับ (ยังไม่ทราบเว้นว่างได้)', 'time')}
      </div>
      <p className="text-sm text-slate-600">เวลารถมารับจะแจ้งหลังยืนยันคิว {staffEntry ? '' : `กรุณาจองล่วงหน้าอย่างน้อย ${info.min_lead_days} วัน`}</p>
      <label className="flex min-h-11 items-start gap-3"><input className="mt-1 size-5 shrink-0" type="checkbox" required checked={!form.is_emergency} onChange={e => setForm(f => ({ ...f, is_emergency: !e.target.checked }))} />เป็นการเดินทางตามนัด ไม่ใช่เหตุฉุกเฉิน</label>
      <p className="rounded-xl bg-amber-50 p-3">เจ็บป่วยฉุกเฉิน <a className="font-bold underline" href="tel:1669">โทร 1669</a> อย่ารอคิวจองรถ</p>
    </>}
    {step === 2 && <>
      <div className="grid gap-4 sm:grid-cols-2">{field('requester_name', 'ชื่อ–สกุลผู้จอง', 'text', { required: true, maxLength: 200 })}
        {field('phone', 'เบอร์ติดต่อกลับ', 'tel', { required: true, pattern: '0[0-9]{8,9}', maxLength: 10 })}
        {select('relation', 'ผู้จองเป็น', { self: 'ผู้ป่วยจองเอง', relative: 'ญาติจองแทน', caregiver: 'ผู้ดูแลจองแทน' })}
        {form.relation !== 'self' && field('patient_name', 'ชื่อ–สกุลผู้เดินทาง', 'text', { required: true, maxLength: 200 })}
        {field('pickup', 'จุดรับและจุดสังเกต', 'text', { required: true, maxLength: 500 })}{select('mobility', 'การเคลื่อนไหว', MOBILITY)}
        {select('companions', 'ผู้ติดตาม', { 0: 'ไม่มี', 1: '1 คน', 2: '2 คน', 3: '3 คน', 4: '4 คน', 5: '5 คน' })}
      </div>
      <label className="flex min-h-11 gap-3"><input className="mt-1 size-5 shrink-0" type="checkbox" checked={form.in_area} onChange={change('in_area')} />ผู้เดินทางอยู่ในเขตพื้นที่ (หากไม่แน่ใจให้เจ้าหน้าที่ตรวจสอบ)</label>
      <label className="flex min-h-11 gap-3"><input className="mt-1 size-5 shrink-0" type="checkbox" checked={form.share} onChange={change('share')} />สะดวกร่วมเที่ยว หากเวลาและเส้นทางเหมาะสม</label>
    </>}
    {step === 3 && <>
      <dl className="grid gap-3 rounded-xl bg-sky-50 p-4 sm:grid-cols-2"><div><dt>ผู้เดินทาง</dt><dd className="font-bold">{payload().patient_name}</dd></div><div><dt>วันเวลานัด</dt><dd className="font-bold">{form.day} {form.time}</dd></div><div><dt>ปลายทาง/จุดรับ</dt><dd>{info.routes.find(r => r.id === form.route_id)?.label} · {form.pickup}</dd></div><div><dt>ขากลับ</dt><dd>{RETURN_MODES[form.return_mode]} {form.back || 'ยังไม่ทราบเวลา'}</dd></div></dl>
      <div className="whitespace-pre-wrap rounded-xl border border-slate-200 p-4 text-sm">{info.privacy_notice}<p className="mt-3 font-bold">เจ้าของรถและผู้รับข้อมูล: {info.owner_name}</p></div>
      {form.relation !== 'self' && <label className="flex min-h-11 gap-3"><input className="mt-1 size-5 shrink-0" type="checkbox" required checked={form.representative_authorized} onChange={change('representative_authorized')} />ได้รับอนุญาตจากผู้ป่วย หรือมีอำนาจกระทำการแทนผู้ป่วยแล้ว</label>}
      <label className="flex min-h-11 gap-3"><input className="mt-1 size-5 shrink-0" type="checkbox" required checked={form.consent} onChange={change('consent')} />ยืนยันการใช้ข้อมูลตามข้อความข้างต้น และข้อมูลจองถูกต้อง</label>
      <p className="text-sm text-slate-600">ส่งคำขอแล้วต้องรอเจ้าหน้าที่ อบต. ยืนยันรถและเวลารับ</p>
    </>}
    <button className={primaryClass} disabled={busy}>{busy ? 'กำลังส่ง…' : step < 3 ? 'ต่อไป' : 'ส่งคำขอจองรถ'}</button>
  </form>
}
