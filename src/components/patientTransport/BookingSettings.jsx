import { useState } from 'react'
import { buttonClass, primaryClass, inputClass, minutes, clockTime, orgAbbr, thaiDay } from '../../lib/patientBooking'

export default function BookingSettings({ workspace, busy, onSave }) {
  const [form, setForm] = useState(() => ({ enabled: false, partner_id: '', driver_id: '', coordinator_ids: [], office_start: 510, office_end: 990,
    seats: '', wheelchairs: '', stretchers: '', buffer_minutes: 15, boarding_minutes: 15, routes: [], holidays: [], calendar_checked_through: '',
    unavailable: false, delegation_reference: '', privacy_notice: '', contact_phone: '',
    // อปท. ที่ยังไม่เคยบันทึกตั้งค่า workspace ส่ง settings มาเป็นอ็อบเจกต์ที่ทุกช่องเป็น null (to_jsonb ของแถวว่างใน plpgsql)
    // ถ้ากระจายทับตรงๆ coordinator_ids/routes/holidays กลายเป็น null แล้วหน้าตั้งค่าพังตั้งแต่เปิดครั้งแรก
    ...Object.fromEntries(Object.entries(workspace.settings || {}).filter(([, v]) => v !== null)) }))
  const [attemptedOpen, setAttemptedOpen] = useState(false)
  const set = key => e => setForm(f => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const input = (key, label, props = {}) => <label>{label}<input className={inputClass} value={form[key] ?? ''} onChange={set(key)} {...props} /></label>
  function changeRoute(index, key, value) { setForm(f => ({ ...f, routes: f.routes.map((r, i) => i === index ? { ...r, [key]: value } : r) })) }
  const partner = workspace.partners?.find(p => p.id === form.partner_id)
  const missing = [
    !form.partner_id && 'เลือกเจ้าของรถ', !form.driver_id && 'เลือกคนขับ',
    !form.coordinator_ids.length && 'เลือกผู้ยืนยันคิว (เป็นคนขับคนเดียวกันได้)',
    ['seats', 'wheelchairs', 'stretchers'].some(key => form[key] === '' || form[key] == null) && 'ระบุความจุรถจริง ช่องที่ไม่มีให้ใส่ 0',
    !form.routes.length && 'เพิ่มโรงพยาบาลและเวลาเดินทางอย่างน้อย 1 เส้นทาง',
    !/^0[0-9]{8,9}$/.test(form.contact_phone) && 'ระบุเบอร์ติดต่อหน่วยงาน',
    (!form.calendar_checked_through || form.calendar_checked_through < thaiDay()) && 'ตรวจวันหยุดในส่วนข้อมูลก่อนเปิดบริการ',
    !form.delegation_reference.trim() && 'ระบุข้อมูลการมอบหมายในส่วนข้อมูลก่อนเปิดบริการ',
    !form.privacy_notice.trim() && 'ตรวจข้อความใช้ข้อมูลในส่วนข้อมูลก่อนเปิดบริการ',
  ].filter(Boolean)
  return <form className="space-y-5" onInvalidCapture={e => { const section = e.target.closest('details'); if (section) section.open = true }} onSubmit={e => {
    e.preventDefault()
    if (form.enabled && missing.length) {
      setAttemptedOpen(true)
      e.currentTarget.querySelectorAll('details').forEach(section => { section.open = true })
      return
    }
    setAttemptedOpen(false)
    onSave(workspace.settings?.revision ?? 1, form)
  }}>
    <h2 className="text-xl font-bold">ตั้งค่ารถรับส่งผู้ป่วย</h2>
    {attemptedOpen && form.enabled && missing.length > 0 && <div role="alert" className="rounded-xl bg-red-50 p-3 text-red-800"><p className="font-semibold">ยังเปิดรับจองไม่ได้ กรุณาเติมข้อมูลที่ขาด</p><ul className="mt-2 list-disc pl-5">{missing.map(item => <li key={item}>{item}</li>)}</ul></div>}
    <p className="rounded-xl bg-amber-50 p-3 text-sm">กรอกข้อมูลรถ ผู้รับผิดชอบ และโรงพยาบาลครั้งแรก หลังจากนั้นแก้เฉพาะเมื่อมีการเปลี่ยนแปลง เวลาให้บริการและเวลาเผื่อมีค่าเริ่มต้นให้แล้ว</p>
    <div className="grid gap-4 sm:grid-cols-2">
      <label>กองทุน/หน่วยงานเจ้าของรถ<select className={inputClass} value={form.partner_id || ''} onChange={set('partner_id')}><option value="">เลือกเจ้าของรถจากทะเบียนหน่วยงาน</option>{workspace.partners?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        {/* min_lead_days lives on referral_partners; without this pointer an admin cannot find where to change it. */}
        <span className="mt-1 block text-sm text-slate-600">{partner?.min_lead_days === undefined ? 'เลือกเจ้าของรถเพื่อดูจำนวนวันจองล่วงหน้า' : `ประชาชนต้องจองล่วงหน้าอย่างน้อย ${partner.min_lead_days} วัน`} · แก้จำนวนวันได้ที่หน้าผู้ดูแล เมนู “ประเภทคำขอเอกสาร” → ทะเบียนหน่วยงานรับเรื่องต่อ</span></label>
      <label>บัญชีคนขับ<select aria-label="บัญชีคนขับ" className={inputClass} value={form.driver_id || ''} onChange={set('driver_id')}><option value="">เลือกบัญชีเจ้าหน้าที่ของคนขับ</option>{workspace.people?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      {['office_start', 'office_end'].map((key, i) => <label key={key}>{i ? 'สิ้นสุดบริการ' : 'เริ่มบริการ'}<input className={inputClass} type="time" required value={clockTime(form[key])} onChange={e => setForm(f => ({ ...f, [key]: minutes(e.target.value) }))} /></label>)}
      {input('seats', 'ที่นั่งผู้โดยสาร ไม่รวมคนขับ', { type: 'number', min: 1, max: 15 })}{input('wheelchairs', 'ที่ยึดรถเข็น', { type: 'number', min: 0, max: 4 })}{input('stretchers', 'ที่ยึดเปล', { type: 'number', min: 0, max: 2 })}
      {input('contact_phone', 'เบอร์ติดต่อหน่วยงาน', { type: 'tel', maxLength: 10 })}
    </div>
    <fieldset><legend className="font-semibold">เจ้าหน้าที่ผู้ยืนยันคิว</legend><p className="mt-2 text-sm text-slate-600">เลือกบัญชีเดียวกับคนขับได้ หากมอบหมายให้ทำทั้งสองหน้าที่ ให้เลือกชื่อนั้นเป็นคนขับและติ๊กเป็นผู้ยืนยันคิวด้วย ใช้บัญชีเดียวได้ทั้งจัดคิวและงานคนขับ</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{workspace.people?.map(p => <label key={p.id} className="flex min-h-11 items-center gap-3"><input className="size-5" type="checkbox" checked={form.coordinator_ids.includes(p.id)} onChange={e => setForm(f => ({ ...f, coordinator_ids: e.target.checked ? [...f.coordinator_ids, p.id] : f.coordinator_ids.filter(id => id !== p.id) }))} />{p.name}</label>)}</div></fieldset>
    <fieldset><legend className="font-semibold">เส้นทางโรงพยาบาลและพื้นที่รับ · เวลาเดินทางรวมระหว่างจุดรับ</legend>
      {form.routes.map((r, i) => <div key={r.id} className="my-3 grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-[1fr_140px_auto]">
        <label>ชื่อโรงพยาบาล — พื้นที่รับ<input className={inputClass} value={r.label} required maxLength={200} onChange={e => changeRoute(i, 'label', e.target.value)} /></label>
        <label>นาทีต่อขา<input className={inputClass} type="number" min={5} max={240} required value={r.minutes} onChange={e => changeRoute(i, 'minutes', Number(e.target.value))} /></label>
        <button type="button" className={buttonClass} onClick={() => setForm(f => ({ ...f, routes: f.routes.filter(x => x.id !== r.id) }))}>นำออกจากร่าง</button>
      </div>)}
      <button type="button" className={buttonClass} onClick={() => setForm(f => ({ ...f, routes: [...f.routes, { id: crypto.randomUUID(), label: '', minutes: 30 }] }))}>เพิ่มเส้นทาง</button>
    </fieldset>
    <details className="rounded-xl border border-slate-200 p-3"><summary className="flex min-h-11 cursor-pointer items-center font-semibold">ปรับเวลาเผื่อ · ปกติไม่ต้องแก้</summary><p className="my-2 text-sm">ระบบเผื่อก่อนนัด/หลังเที่ยว {form.buffer_minutes} นาที และขึ้นลงรถ {form.boarding_minutes} นาทีต่อคน เปลี่ยนเฉพาะเมื่อไม่ตรงกับการปฏิบัติงาน</p><div className="grid gap-4 sm:grid-cols-2">
      {input('buffer_minutes', 'เวลาเผื่อก่อนนัด/หลังเที่ยว (นาที)', { type: 'number', min: 5, max: 90, required: true })}
      {input('boarding_minutes', 'เวลาขึ้นลงต่อผู้เดินทาง (นาที)', { type: 'number', min: 5, max: 60, required: true })}
    </div></details>
    <details className="rounded-xl border border-slate-200 p-3"><summary className="flex min-h-11 cursor-pointer items-center font-semibold">ข้อมูลก่อนเปิดบริการ · ตรวจครั้งแรกและเมื่อมีการเปลี่ยนแปลง</summary><div className="mt-3 space-y-4">
      <p className="text-sm text-slate-600">เก็บค่าที่เคยบันทึกไว้ให้ ไม่ต้องกรอกใหม่ทุกครั้ง ส่วนวันหยุดกลับมาตรวจเมื่อพ้นช่วงที่ระบุ</p>
      {input('calendar_checked_through', 'ตรวจปฏิทินวันหยุดครอบคลุมถึง', { type: 'date' })}
      {input('delegation_reference', `อ้างอิงหนังสือที่กองทุนมอบให้ ${orgAbbr()} จัดคิว`, { maxLength: 500 })}    <label className="block">วันหยุดเพิ่มเติม (วันละบรรทัด รูปแบบ YYYY-MM-DD)<textarea className={inputClass} rows={4} value={form.holidays.join('\n')} onChange={e => setForm(f => ({ ...f, holidays: e.target.value.split('\n') }))} /><span className="text-sm text-slate-600">เสาร์–อาทิตย์หยุดอัตโนมัติ ตรวจรายการวันหยุดราชการและวันหยุดท้องถิ่นครั้งเดียวต่อปฏิทิน</span></label>
    <label className="block">ข้อความแจ้งการใช้ข้อมูลที่ผู้รับผิดชอบตรวจรับแล้ว<textarea className={inputClass} required={form.enabled} rows={6} value={form.privacy_notice} onChange={set('privacy_notice')} maxLength={6000} /><span className="text-sm text-slate-600">ระบุวัตถุประสงค์ ผู้รับข้อมูล ข้อมูลที่จำเป็น อายุเก็บข้อมูล และช่องทางใช้สิทธิให้ตรงการปฏิบัติงานจริง</span></label>
    </div></details>
    {missing.length > 0 && <div className="rounded-xl bg-amber-50 p-3"><p className="font-semibold">ข้อมูลที่ต้องเติมก่อนเปิดรับจอง</p><p className="text-sm">หากยังกรอกไม่ครบ ให้เว้น “เปิดรับจองรถออนไลน์” ไว้ก่อนแล้วบันทึกการตั้งค่า</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{missing.map(item => <li key={item}>{item}</li>)}</ul></div>}
    <label className="flex min-h-11 items-center gap-3"><input className="size-5" type="checkbox" checked={form.unavailable} onChange={set('unavailable')} />รถหรือคนขับไม่พร้อม · หยุดยืนยันเที่ยวใหม่</label>
    <label className="flex min-h-11 items-center gap-3"><input className="size-5" type="checkbox" checked={form.enabled} onChange={set('enabled')} />เปิดรับจองรถออนไลน์</label>
    <button className={primaryClass} disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึกการตั้งค่า'}</button>
  </form>
}
