import { useState } from 'react'
import { buttonClass, primaryClass, inputClass, minutes, clockTime, orgAbbr } from '../../lib/patientBooking'

export default function BookingSettings({ workspace, busy, onSave }) {
  const [form, setForm] = useState(() => ({ enabled: false, partner_id: '', driver_id: '', coordinator_ids: [], office_start: 510, office_end: 990,
    seats: '', wheelchairs: '', stretchers: '', buffer_minutes: 15, boarding_minutes: 15, routes: [], holidays: [], calendar_checked_through: '',
    unavailable: false, delegation_reference: '', privacy_notice: '', contact_phone: '',
    // อปท. ที่ยังไม่เคยบันทึกตั้งค่า workspace ส่ง settings มาเป็นอ็อบเจกต์ที่ทุกช่องเป็น null (to_jsonb ของแถวว่างใน plpgsql)
    // ถ้ากระจายทับตรงๆ coordinator_ids/routes/holidays กลายเป็น null แล้วหน้าตั้งค่าพังตั้งแต่เปิดครั้งแรก
    ...Object.fromEntries(Object.entries(workspace.settings || {}).filter(([, v]) => v !== null)) }))
  const set = key => e => setForm(f => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const input = (key, label, props = {}) => <label>{label}<input className={inputClass} value={form[key] ?? ''} onChange={set(key)} {...props} /></label>
  function changeRoute(index, key, value) { setForm(f => ({ ...f, routes: f.routes.map((r, i) => i === index ? { ...r, [key]: value } : r) })) }
  const partner = workspace.partners?.find(p => p.id === form.partner_id)
  return <form className="space-y-5" onSubmit={e => { e.preventDefault(); onSave(workspace.settings?.revision ?? 1, form) }}>
    <h2 className="text-xl font-bold">ตั้งค่าครั้งเดียว · กองทุนเป็นเจ้าของรถ {orgAbbr()} จัดคิว</h2>
    <p className="rounded-xl bg-amber-50 p-3 text-sm">ยืนยันความจุจากรถจริง ช่วงเวลาบริการ ปฏิทินวันหยุด และขอบเขตมอบหมายก่อนเปิดรับจอง ไม่ต้องเปิดบริการยืนยันใหม่ทุกวัน</p>
    <div className="grid gap-4 sm:grid-cols-2">
      <label>กองทุน/หน่วยงานเจ้าของรถ<select className={inputClass} value={form.partner_id || ''} onChange={set('partner_id')}><option value="">เลือกเจ้าของรถจากทะเบียนหน่วยงาน</option>{workspace.partners?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        {/* min_lead_days lives on referral_partners; without this pointer an admin cannot find where to change it. */}
        <span className="mt-1 block text-sm text-slate-600">{partner?.min_lead_days === undefined ? 'เลือกเจ้าของรถเพื่อดูจำนวนวันจองล่วงหน้า' : `ประชาชนต้องจองล่วงหน้าอย่างน้อย ${partner.min_lead_days} วัน`} · แก้จำนวนวันได้ที่หน้าผู้ดูแล เมนู “ประเภทคำขอเอกสาร” → ทะเบียนหน่วยงานรับเรื่องต่อ</span></label>
      <label>บัญชีคนขับ<select aria-label="บัญชีคนขับ" className={inputClass} value={form.driver_id || ''} onChange={set('driver_id')}><option value="">เลือกบัญชีเจ้าหน้าที่ของคนขับ</option>{workspace.people?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      {['office_start', 'office_end'].map((key, i) => <label key={key}>{i ? 'สิ้นสุดบริการ' : 'เริ่มบริการ'}<input className={inputClass} type="time" required value={clockTime(form[key])} onChange={e => setForm(f => ({ ...f, [key]: minutes(e.target.value) }))} /></label>)}
      {input('seats', 'ที่นั่งผู้โดยสาร ไม่รวมคนขับ', { type: 'number', min: 1, max: 15 })}{input('wheelchairs', 'ที่ยึดรถเข็น', { type: 'number', min: 0, max: 4 })}{input('stretchers', 'ที่ยึดเปล', { type: 'number', min: 0, max: 2 })}
      {input('buffer_minutes', 'เวลาเผื่อก่อนนัด/หลังเที่ยว (นาที)', { type: 'number', min: 5, max: 90, required: true })}
      {input('boarding_minutes', 'เวลาขึ้นลงต่อผู้เดินทาง (นาที)', { type: 'number', min: 5, max: 60, required: true })}
      {input('contact_phone', 'เบอร์ติดต่อหน่วยงาน', { type: 'tel', maxLength: 10 })}{input('calendar_checked_through', 'ตรวจปฏิทินวันหยุดครอบคลุมถึง', { type: 'date' })}
      {input('delegation_reference', `อ้างอิงหนังสือที่กองทุนมอบให้ ${orgAbbr()} จัดคิว`, { maxLength: 500 })}
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
    <label className="block">วันหยุดเพิ่มเติม (วันละบรรทัด รูปแบบ YYYY-MM-DD)<textarea className={inputClass} rows={4} value={form.holidays.join('\n')} onChange={e => setForm(f => ({ ...f, holidays: e.target.value.split('\n') }))} /><span className="text-sm text-slate-600">เสาร์–อาทิตย์หยุดอัตโนมัติ ตรวจรายการวันหยุดราชการและวันหยุดท้องถิ่นครั้งเดียวต่อปฏิทิน</span></label>
    <label className="block">ข้อความแจ้งการใช้ข้อมูลที่ผู้รับผิดชอบตรวจรับแล้ว<textarea className={inputClass} required={form.enabled} rows={6} value={form.privacy_notice} onChange={set('privacy_notice')} maxLength={6000} /><span className="text-sm text-slate-600">ระบุวัตถุประสงค์ ผู้รับข้อมูล ข้อมูลที่จำเป็น อายุเก็บข้อมูล และช่องทางใช้สิทธิให้ตรงการปฏิบัติงานจริง</span></label>
    <label className="flex min-h-11 items-center gap-3"><input className="size-5" type="checkbox" checked={form.unavailable} onChange={set('unavailable')} />รถหรือคนขับไม่พร้อม · หยุดยืนยันเที่ยวใหม่</label>
    <label className="flex min-h-11 items-center gap-3"><input className="size-5" type="checkbox" checked={form.enabled} onChange={set('enabled')} />ตรวจรับค่าตั้งต้นแล้ว เปิดรับจอง</label>
    <button className={primaryClass} disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึกการตั้งค่า'}</button>
  </form>
}
