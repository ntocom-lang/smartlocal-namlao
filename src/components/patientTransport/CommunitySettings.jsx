import { useState } from 'react'
import { buttonClass, primaryClass, inputClass, clockTime, minutes } from '../../lib/patientBooking'

const draftFrom = rules => ({ revision: rules?.revision ?? 1, enabled: !!rules?.enabled,
  start: Number.isFinite(rules?.window_start) ? clockTime(rules.window_start) : '',
  end: Number.isFinite(rules?.window_end) ? clockTime(rules.window_end) : '',
  places: rules?.places || [], activities: rules?.activities || [], rules_reference: rules?.rules_reference || '' })

export default function CommunitySettings({ rules, busy, onSave }) {
  const [draft, setDraft] = useState(() => draftFrom(rules))
  const [saved, setSaved] = useState(false)
  const stale = draft.revision !== (rules?.revision ?? 1)
  const change = (key, value) => { setSaved(false); setDraft(d => ({ ...d, [key]: value })) }
  const updateRow = (key, index, field, value) => change(key, draft[key].map((row, i) => i === index ? { ...row, [field]: value } : row))
  const missing = !draft.start || !draft.end || draft.end <= draft.start || !draft.places.length || !draft.activities.length || !draft.rules_reference.trim()
  return <form aria-label="ตั้งค่าบริการชุมชน" className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5" onSubmit={async e => {
    e.preventDefault()
    if (busy || stale || (draft.enabled && missing)) return
    const ok = await onSave(draft.revision, { enabled: draft.enabled, window_start: draft.start ? minutes(draft.start) : null,
      window_end: draft.end ? minutes(draft.end) : null, places: draft.places.map(p => ({ ...p, label: p.label.trim(), minutes: Number(p.minutes) })),
      activities: draft.activities.map(a => ({ ...a, label: a.label.trim() })), rules_reference: draft.rules_reference.trim() })
    if (ok) setSaved(true)
  }}>
    <h2 className="text-xl font-bold">ตั้งค่ารถรับ–ส่งชุมชน</h2>
    <p className="rounded-xl bg-amber-50 p-3 text-sm">ต้องยืนยันกิจกรรมและอำนาจใช้รถกับข้อบังคับกองทุนฉบับปัจจุบัน รวมทั้งคำสั่งมอบหมายคนขับในวันหยุด/นอกเวลา ก่อนเปิดบริการจริง ระบบจัดคิวและแจ้งข้อมูล ไม่อนุมัติสิทธิหรือค่าใช้จ่ายแทนผู้มีอำนาจ</p>
    <p className="text-sm">ตั้งค่าครั้งเดียว แก้เฉพาะเมื่อมีการเปลี่ยนแปลง · ใช้รถและคนขับชุดเดียวกับผู้ป่วย เปิดรับคำขอได้ทุกวัน และไม่ร่วมเที่ยว</p>
    {stale && <div role="alert" className="rounded-xl bg-amber-50 p-3">{saved ? 'บันทึกกฎแล้ว' : 'กฎถูกเปลี่ยนระหว่างแก้ไข ร่างนี้ยังไม่ถูกเขียนทับ'} <button type="button" className={buttonClass} disabled={busy} onClick={() => { setDraft(draftFrom(rules)); setSaved(false) }}>โหลดกฎล่าสุด</button></div>}
    <div className="grid gap-3 sm:grid-cols-2">
      <label>เริ่มเวลาที่ต้องถึง<input type="time" className={inputClass} value={draft.start} required={draft.enabled || !!draft.end} onChange={e => change('start', e.target.value)} /></label>
      <label>สิ้นสุดเวลาที่ต้องถึง<input type="time" className={inputClass} value={draft.end} required={draft.enabled || !!draft.start} min={draft.start || undefined} onChange={e => change('end', e.target.value)} /></label>
    </div>
    <p className="text-sm text-slate-600">ช่วงนี้เป็นเวลาที่ต้องถึงปลายทาง รถอาจออกก่อนหรือกลับหลังช่วงนี้ตามระยะทางและจำนวนผู้เดินทาง ไม่มีค่าเริ่มต้นให้เดา</p>
    <fieldset className="space-y-3"><legend className="font-bold">สถานที่ชุมชนและเวลาเดินทาง</legend>
      {draft.places.map((p, index) => <div key={p.id} className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[1fr_10rem_auto]">
        <label>สถานที่ชุมชน {index + 1}<input required maxLength={200} className={inputClass} value={p.label} onChange={e => updateRow('places', index, 'label', e.target.value)} /></label>
        <label>เวลาเดินทาง (นาที)<input required type="number" min={5} max={240} step={1} className={inputClass} value={p.minutes} onChange={e => updateRow('places', index, 'minutes', e.target.value)} /></label>
        <button type="button" className={`${buttonClass} self-end`} disabled={busy} onClick={() => change('places', draft.places.filter((_, i) => i !== index))}>นำสถานที่ {index + 1} ออก</button>
      </div>)}
      <button type="button" className={buttonClass} disabled={busy || draft.places.length >= 100} onClick={() => change('places', [...draft.places, { id: `place_${crypto.randomUUID()}`, label: '', minutes: '' }])}>+ เพิ่มสถานที่ชุมชน</button>
    </fieldset>
    <fieldset className="space-y-3"><legend className="font-bold">กิจกรรมที่กองทุนอนุญาต</legend>
      {draft.activities.map((a, index) => <div key={a.code} className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1">กิจกรรมชุมชน {index + 1}<input required maxLength={200} className={inputClass} value={a.label} onChange={e => updateRow('activities', index, 'label', e.target.value)} /></label>
        <button type="button" className={buttonClass} disabled={busy} onClick={() => change('activities', draft.activities.filter((_, i) => i !== index))}>นำกิจกรรม {index + 1} ออก</button>
      </div>)}
      <button type="button" className={buttonClass} disabled={busy || draft.activities.length >= 100} onClick={() => change('activities', [...draft.activities, { code: `activity_${crypto.randomUUID()}`, label: '' }])}>+ เพิ่มกิจกรรมชุมชน</button>
    </fieldset>
    <label className="block">ข้อบังคับ/มติที่อนุญาตใช้รถ<textarea className={inputClass} rows={3} maxLength={2000} required={draft.enabled} value={draft.rules_reference} onChange={e => change('rules_reference', e.target.value)} /></label>
    <label className="flex min-h-11 items-center gap-3"><input className="size-5" type="checkbox" checked={draft.enabled} onChange={e => change('enabled', e.target.checked)} />เปิดรับคำขอชุมชนใหม่</label>
    <p className="text-sm">ปิดรับคำขอใหม่แล้ว เที่ยวที่รับไว้ยังดำเนินต่อได้ ไม่มีการยกเลิกหรือลบข้อมูลเดิม</p>
    {draft.enabled && missing && <p role="alert" className="text-red-800">ต้องระบุช่วงเวลา สถานที่ กิจกรรม และข้อบังคับให้ครบก่อนเปิดบริการ</p>}
    <button className={primaryClass} disabled={busy || stale || (draft.enabled && missing)}>บันทึกกฎบริการชุมชน</button>
  </form>
}
