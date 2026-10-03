import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import BookingMonthPicker from './BookingMonthPicker'
import { RETURN_MODES, DAY_BLOCKED, inputClass, buttonClass, primaryClass, thaiDay, bookingLastDay, clockTime, clockOf,
  bangkokISO, freeTimeChoices, communityPayload, normalizeBookingPhone, dateTime, orgAbbr } from '../../lib/patientBooking'

const policyKey = info => JSON.stringify([info?.community?.rules_version, info?.community?.privacy_notice, info?.owner_name])

export default function CommunityBookingForm({ tenantId, info, initial, profileName, profilePhone, lastBooking, staffEntry = false,
  busy, submitError = '', onBack, onSubmit, saveLabel = 'ยืนยันส่งคำขอ' }) {
  const [id] = useState(() => crypto.randomUUID())
  const [original] = useState(() => initial || null)
  const [today] = useState(thaiDay)
  const lastDay = bookingLastDay(today), c = info?.community
  const [form, setForm] = useState(() => {
    const b = initial || (!staffEntry && lastBooking?.entry_channel === 'online' && lastBooking.service_type === 'community' ? lastBooking : null)
    return { requester_name: b?.requester_name || (staffEntry ? '' : profileName || ''), phone: b?.phone || (staffEntry ? '' : profilePhone || ''),
      group_label: b?.group_label || '', party_size: b?.party_size || 1, pickup: b?.pickup || '', in_area: initial ? !!initial.in_area : true,
      pickup_lat: b?.pickup_lat ?? null, pickup_lng: b?.pickup_lng ?? null, purpose_code: b?.purpose_code || '', route_id: b?.route_id || '',
      day: initial?.appointment_at ? thaiDay(initial.appointment_at) : '', time: initial ? clockOf(initial.appointment_at) : '',
      return_mode: initial?.return_mode || 'one_way', back: initial ? clockOf(initial.return_at) : '', reason: '' }
  })
  const [month, setMonth] = useState(() => form.day.slice(0, 7) || today.slice(0, 7))
  const [calendar, setCalendar] = useState(null), [loadError, setLoadError] = useState(''), [retry, setRetry] = useState(0)
  const [missing, setMissing] = useState([]), [review, setReview] = useState(null), [consent, setConsent] = useState(false)
  const stale = !!original && original.revision !== initial?.revision
  useEffect(() => {
    let live = true
    const to = `${month}-${String(new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate()).padStart(2, '0')}`
    supabase.rpc('patient_booking_calendar', { p_muni: tenantId, p_from: month + '-01', p_to: to }).then(({ data, error }) => {
      if (!live) return
      if (error) { setLoadError(error.message || 'ตรวจเวลารถไม่สำเร็จ'); return }
      setCalendar({ tenantId, month, days: data?.days || [] }); setLoadError('')
    })
    return () => { live = false }
  }, [tenantId, month, retry])
  const ready = calendar?.tenantId === tenantId && calendar.month === month
  const days = ready ? calendar.days : []
  const day = days.find(d => d.date === form.day)
  const draft = useMemo(() => ({ ...form, service_type: 'community' }), [form])
  const times = freeTimeChoices(draft, info, day, 15, staffEntry)
  const place = c?.places?.find(p => p.id === form.route_id), activity = c?.activities?.find(a => a.code === form.purpose_code)
  const change = (key, value) => { setForm(f => ({ ...f, [key]: value })); setMissing([]) }
  const snapshot = () => communityPayload({ ...form, appointment_at: bangkokISO(form.day, form.time),
    return_at: form.return_mode === 'one_way' ? null : bangkokISO(form.day, form.back),
    party_size: Number(form.party_size), requester_name: form.requester_name.trim(), phone: form.phone.trim(),
    group_label: form.group_label.trim(), pickup: form.pickup.trim() }, info)
  function submit(e) {
    e.preventDefault()
    const errors = [
      !form.day && 'เลือกวันเดินทาง', !ready && 'รอตรวจเวลารถให้เสร็จ หรือกดโหลดใหม่เมื่อโหลดไม่สำเร็จ',
      !place && 'เลือกสถานที่ชุมชนที่ตั้งเวลาเดินทางไว้', !activity && 'เลือกกิจกรรมที่กองทุนอนุญาต',
      !form.time && 'เลือกเวลาที่ต้องถึง', form.time && !times.includes(form.time) && !staffEntry && 'คิวรถเปลี่ยนแล้ว กรุณาเลือกเวลาอื่น',
      form.time && c && (form.time < clockTime(c.window_start) || form.time > clockTime(c.window_end)) && 'เวลาที่ต้องถึงอยู่นอกช่วงบริการชุมชน',
      !staffEntry && day?.status !== 'open' && (DAY_BLOCKED[day?.status] || 'ยังตรวจวันว่างไม่ได้'),
      !form.group_label.trim() && 'ระบุชื่อกลุ่มหรือกิจกรรม', !form.requester_name.trim() && 'ระบุชื่อผู้ติดต่อ',
      !/^0[0-9]{8,9}$/.test(form.phone) && 'ระบุเบอร์ติดต่อขึ้นต้นด้วย 0 จำนวน 9–10 หลัก',
      (!Number.isInteger(Number(form.party_size)) || Number(form.party_size) < 1 || Number(form.party_size) > 15) && 'จำนวนผู้เดินทางต้องเป็น 1 ถึง 15 คน',
      !form.pickup.trim() && 'ระบุจุดรับ', !form.in_area && 'ต้องตรวจว่าจุดรับอยู่ในเขตพื้นที่ให้บริการ',
      form.return_mode !== 'one_way' && (!form.back || form.back < form.time) && 'ระบุเวลารับกลับไม่ก่อนเวลาที่ต้องถึง',
      original && !form.reason.trim() && 'ระบุเหตุผลที่ประสานกับผู้จองแล้ว', stale && 'ข้อมูลคำขอเปลี่ยนแล้ว ปิดและเปิดฟอร์มใหม่',
    ].filter(Boolean)
    setMissing(errors)
    if (errors.length) return
    setConsent(false); setReview({ payload: snapshot(), policy: policyKey(info) })
  }
  if (!c?.privacy_notice || !Number.isFinite(c.window_start) || !Number.isFinite(c.window_end)) return <section className="space-y-3"><button className={buttonClass} onClick={onBack}>← ย้อนกลับ</button><p role="alert">ยังไม่มีข้อมูลบริการชุมชนครบถ้วน กรุณาติดต่อผู้ดูแลเพื่อตั้งค่าและโหลดข้อมูลล่าสุด</p></section>
  const reviewStale = review && (review.policy !== policyKey(info) || stale)
  return <form aria-label={original ? 'แก้คำขอชุมชน' : 'ขอรถรับ–ส่งชุมชน'} noValidate onSubmit={submit} className="space-y-4">
    <button type="button" className={buttonClass} disabled={busy} onClick={onBack}>← ย้อนกลับ</button>
    <h2 className="text-xl font-bold">{original ? 'แก้คำขอชุมชนหลังประสานผู้จอง' : staffEntry ? 'รับจองชุมชนแทนทางโทรศัพท์/หน้าเคาน์เตอร์' : 'ขอรถรับ–ส่งชุมชน'}</h2>
    <p className="rounded-xl bg-sky-50 p-3">สำหรับกลุ่มที่เดินขึ้นลงรถได้เอง ไม่รองรับรถเข็น/เปล และไม่ร่วมเที่ยวกับผู้ป่วย · เจ้าหน้าที่ตรวจและยืนยันรถอีกครั้ง</p>
    {!c.enabled && original && <p className="rounded-xl bg-amber-50 p-3">ปิดรับคำขอใหม่แล้ว คำขอที่รับไว้ยังแก้และดำเนินต่อได้ตามสิทธิ์</p>}
    <section aria-label="กิจกรรมและผู้เดินทาง" className="space-y-3 rounded-2xl border bg-white p-4">
      <h3 className="font-bold">1. กิจกรรมและกลุ่มผู้เดินทาง</h3>
      <label className="block">กิจกรรมชุมชน<select aria-label="กิจกรรมชุมชน" className={inputClass} value={form.purpose_code} onChange={e => change('purpose_code', e.target.value)}><option value="">เลือกกิจกรรม</option>{c.activities.map(a => <option key={a.code} value={a.code}>{a.label}</option>)}</select></label>
      <label className="block">ชื่อกลุ่ม/กิจกรรม<input className={inputClass} maxLength={200} value={form.group_label} onChange={e => change('group_label', e.target.value)} /></label>
      <label className="block">จำนวนผู้เดินทางทั้งหมด (รวมผู้จองที่ไปด้วย)<input type="number" min={1} max={15} step={1} className={inputClass} value={form.party_size} onChange={e => change('party_size', e.target.value)} /></label>
    </section>
    <section aria-label="วันเวลาและสถานที่ชุมชน" className="space-y-3 rounded-2xl border bg-white p-4">
      <h3 className="font-bold">2. สถานที่และวันเวลา</h3>
      <label className="block">สถานที่ชุมชน<select aria-label="สถานที่ชุมชน" className={inputClass} value={form.route_id} onChange={e => change('route_id', e.target.value)}><option value="">เลือกสถานที่</option>{c.places.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
      <BookingMonthPicker serviceType="community" month={month} onMonth={value => { setMonth(value); change('day', ''); change('time', '') }}
        days={days} selected={form.day} onSelect={value => { setMonth(value.slice(0, 7)); change('day', value); change('time', '') }} info={info} draft={draft}
        first={today} last={lastDay} loading={!ready && !loadError} failed={!!loadError} onReload={() => { setLoadError(''); setRetry(n => n + 1) }} staffEntry={staffEntry} />
      <p>เวลาที่ต้องถึง {clockTime(c.window_start)}–{clockTime(c.window_end)} น. · เปิดทุกวันรวมวันหยุด</p>
      <label className="block">เวลาที่ต้องถึง{staffEntry ? <input type="time" className={inputClass} min={clockTime(c.window_start)} max={clockTime(Math.min(c.window_end, 1439))} value={form.time} onChange={e => change('time', e.target.value)} />
        : <select aria-label="เวลาที่ต้องถึง" className={inputClass} value={form.time} onChange={e => change('time', e.target.value)}><option value="">เลือกเวลาที่ต้องถึง</option>{times.map(t => <option key={t} value={t}>{t} น.</option>)}</select>}</label>
      {!!form.day && ready && !times.length && <p role="status" className="rounded-xl bg-amber-50 p-3">ยังไม่มีเวลาที่รถว่างพอสำหรับสถานที่และจำนวนคนนี้ ตรวจสถานที่หรือเลือกวันอื่น{staffEntry ? ' · รับเรื่องไว้ให้เจ้าหน้าที่ประสานได้ แต่ยังไม่ยืนยันรถ' : ''}</p>}
      <label className="block">รูปแบบรับกลับ<select aria-label="รูปแบบรับกลับ" className={inputClass} value={form.return_mode} onChange={e => change('return_mode', e.target.value)}>{Object.entries(RETURN_MODES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {form.return_mode !== 'one_way' && <label className="block">เวลาที่พร้อมให้รับกลับ<input type="time" className={inputClass} min={form.time || undefined} value={form.back} onChange={e => change('back', e.target.value)} /></label>}
      <p className="text-sm text-slate-600">ระบบเผื่อเวลาเดินทางและขึ้นลงรถตามจำนวนคน เวลาว่างเป็นข้อมูลตามแผน ยังไม่ใช่การกันรถให้</p>
    </section>
    <section aria-label="ผู้ติดต่อและจุดรับชุมชน" className="space-y-3 rounded-2xl border bg-white p-4">
      <h3 className="font-bold">3. ผู้ติดต่อและจุดรับ</h3>
      <label className="block">ชื่อ–สกุลผู้ติดต่อ<input autoComplete="name" className={inputClass} maxLength={200} value={form.requester_name} onChange={e => change('requester_name', e.target.value)} /></label>
      <label className="block">เบอร์ติดต่อกลับ<input type="tel" autoComplete="tel" className={inputClass} maxLength={20} value={form.phone} onChange={e => change('phone', e.target.value)} onBlur={() => change('phone', normalizeBookingPhone(form.phone))} /></label>
      <label className="block">จุดรับ (บ้านเลขที่/หมู่บ้าน/จุดสังเกต)<textarea aria-label="จุดรับ (บ้านเลขที่/หมู่บ้าน/จุดสังเกต)" className={inputClass} rows={3} maxLength={500} value={form.pickup} onChange={e => { change('pickup', e.target.value); change('pickup_lat', null); change('pickup_lng', null) }} /></label>
      <label className="flex min-h-11 items-center gap-3"><input className="size-5" type="checkbox" checked={form.in_area} onChange={e => change('in_area', e.target.checked)} />จุดรับอยู่ในเขตพื้นที่ให้บริการของ{orgAbbr()}</label>
      {original && <label className="block">เหตุผลที่ประสานกับผู้จองแล้ว<textarea className={inputClass} rows={2} maxLength={500} value={form.reason} onChange={e => change('reason', e.target.value)} /></label>}
    </section>
    {submitError && <p role="alert" className="rounded-xl bg-amber-50 p-3">{submitError} · หากเครือข่ายขัดข้อง ส่งซ้ำด้วยรายการเดิมได้ ระบบป้องกันคำขอซ้ำ</p>}
    {missing.length > 0 && <div role="alert" className="rounded-xl bg-red-50 p-3 text-red-800"><p className="font-bold">ตรวจข้อมูลต่อไปนี้ก่อนส่ง</p><ul className="list-disc pl-5">{missing.map(text => <li key={text}>{text}</li>)}</ul></div>}
    <button className={`${primaryClass} w-full`} disabled={busy || stale}>ตรวจทานคำขอชุมชน</button>
    {review && <div className="fixed inset-0 z-200 flex items-end bg-black/40" onClick={busy ? undefined : () => setReview(null)}>
      <section role="dialog" aria-modal="true" aria-label="ตรวจทานคำขอชุมชน" className="mx-auto max-h-[92vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-t-3xl bg-white p-5 pb-8" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold">ตรวจทานคำขอชุมชนก่อนส่ง</h2>
        <dl className="divide-y rounded-xl border">{[
          ['กิจกรรม', activity?.label], ['ชื่อกลุ่ม', form.group_label], ['ผู้เดินทาง', `${form.party_size} คน`], ['สถานที่', place?.label],
          ['เวลาที่ต้องถึง', dateTime(review.payload.appointment_at)], ['รับกลับ', form.return_mode === 'one_way' ? 'ขาไปอย่างเดียว' : dateTime(review.payload.return_at)],
          ['ผู้ติดต่อ', form.requester_name], ['เบอร์โทร', form.phone], ['จุดรับ', form.pickup],
        ].map(([label, value]) => <div key={label} className="flex gap-3 p-3"><dt className="w-24 shrink-0 text-sm text-slate-500">{label}</dt><dd className="min-w-0 break-words">{value}</dd></div>)}</dl>
        <p className="rounded-xl bg-slate-50 p-3">เมื่อกดส่ง รับรองว่ากิจกรรมและจำนวนคนถูกต้อง ผู้เดินทางเดินขึ้นลงรถได้เอง จุดรับอยู่ในเขต และได้แจ้งข้อมูลให้ผู้ติดต่อทราบแล้ว การส่งคำขอยังไม่ใช่การยืนยันรถ</p>
        <details className="rounded-xl border p-3"><summary className="min-h-11 cursor-pointer font-semibold">อ่านข้อความการใช้ข้อมูลทั้งหมด</summary><p className="whitespace-pre-wrap">{c.privacy_notice}</p><p className="mt-2 font-semibold">เจ้าของรถและผู้รับข้อมูล: {info.owner_name}</p></details>
        <label className="flex min-h-11 gap-3 rounded-xl bg-sky-50 p-3"><input className="mt-1 size-5 shrink-0" type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />{staffEntry ? 'แจ้งผู้จองแล้ว และผู้จองยินยอมให้ใช้ข้อมูลตามข้อความข้างต้น' : 'ยินยอมให้ใช้ข้อมูลตามข้อความข้างต้น'}</label>
        {reviewStale && <p role="alert">กฎหรือข้อมูลคำขอเปลี่ยนแล้ว กรุณากลับไปตรวจทานใหม่</p>}
        <div className="flex gap-2"><button type="button" className={`${buttonClass} flex-1`} disabled={busy} onClick={() => setReview(null)}>← กลับไปแก้ไข</button>
          <button type="button" className={`${primaryClass} flex-1`} disabled={busy || !consent || reviewStale} onClick={async () => {
            if (await onSubmit(original?.id || id, review.payload, form.reason.trim(), original?.revision)) setReview(null)
          }}>{busy ? 'กำลังส่ง…' : saveLabel}</button></div>
      </section>
    </div>}
  </form>
}
