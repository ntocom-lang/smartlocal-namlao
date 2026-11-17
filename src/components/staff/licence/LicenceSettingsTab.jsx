import { useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { friendlyError, saveSettings } from '../../../lib/licenceRegistryApi'
import { DEFAULT_REMIND_DAYS, REMIND_DAYS_MAX_COUNT, REMIND_DAY_MAX, normalizeRemindDays, validateRemindDays } from '../../../lib/licenceRegistry'
import { btnPrimary, chip, inp, lbl } from '../construction/uiStyles'

/**
 * แท็บ "ตั้งค่า" (เฉพาะแอดมิน — ตัวบังคับจริงคือ RLS ของ licence_settings)
 *   กองที่ถือเรื่อง: ไม่เลือก = ระบบใช้กองสาธารณสุขที่มีคนสังกัด ไม่งั้นสำนักปลัด
 *   วันเตือน: เตือนครั้งเดียวต่อหลัก ผ่านกลุ่ม Telegram ของ อปท. เป็นตัวเลขเท่านั้น (ไม่มีชื่อผู้ประกอบการ)
 */
export default function LicenceSettingsTab({ tenantId, settings, departments, onSaved }) {
  const [ownerId, setOwnerId] = useState(settings?.owner_department_id ?? '')
  const [days, setDays] = useState(() => normalizeRemindDays(settings?.remind_days) .length ? normalizeRemindDays(settings.remind_days) : [...DEFAULT_REMIND_DAYS])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  function addDay() {
    const n = Number(draft)
    if (draft.trim() === '' || !Number.isInteger(n) || n < 0 || n > REMIND_DAY_MAX) { setError(`วันเตือนต้องเป็นจำนวนเต็ม 0–${REMIND_DAY_MAX}`); return }
    if (days.includes(n)) { setError('มีวันเตือนนี้อยู่แล้ว'); return }
    if (days.length >= REMIND_DAYS_MAX_COUNT) { setError(`ตั้งวันเตือนได้สูงสุด ${REMIND_DAYS_MAX_COUNT} ค่า`); return }
    setError(''); setSaved(false); setDays(normalizeRemindDays([...days, n])); setDraft('')
  }

  async function save() {
    const problem = validateRemindDays(days)
    if (problem) { setError(problem); return }
    setBusy(true); setError('')
    const { error: err } = await saveSettings(tenantId, { ownerDepartmentId: ownerId, remindDays: days })
    setBusy(false)
    if (err) { setError(friendlyError(err)); return }
    setSaved(true)
    onSaved()
  }

  return (
    <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <h2 className="text-base font-bold text-gray-900">ตั้งค่าทะเบียนใบอนุญาต</h2>
      <label className="block">
        <span className={lbl}>กองที่ถือเรื่องใบอนุญาต</span>
        <select className={inp} value={ownerId} onChange={e => { setOwnerId(e.target.value); setSaved(false) }}>
          <option value="">ให้ระบบเลือก (กองสาธารณสุขที่มีคนสังกัด ไม่งั้นสำนักปลัด)</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <span className="mt-1 block text-[11px] text-gray-500">เจ้าหน้าที่ของกองนี้ และแอดมินของ อปท. ใช้เมนูทะเบียนใบอนุญาตได้</span>
      </label>
      <div>
        <span className={lbl}>เตือนล่วงหน้ากี่วันก่อนวันหมดอายุ/วันครบกำหนดค่าธรรมเนียม</span>
        <div className="flex flex-wrap gap-2">
          {days.map(d => (
            <span key={d} className={`${chip(true)} inline-flex items-center gap-1`} style={{ backgroundColor: 'var(--color-primary)' }}>
              {d === 0 ? 'วันครบกำหนด' : `${d} วัน`}
              <button type="button" aria-label={`ลบวันเตือน ${d}`} className="rounded-full p-0.5 hover:bg-white/25" onClick={() => { setDays(days.filter(x => x !== d)); setSaved(false) }}><X size={12} /></button>
            </span>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input className={`${inp} !w-28`} inputMode="numeric" placeholder="เช่น 45" aria-label="เพิ่มวันเตือน" value={draft}
            onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addDay() } }} />
          <button type="button" className="min-h-11 rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={addDay}>เพิ่มวันเตือน</button>
        </div>
        <span className="mt-1 block text-[11px] text-gray-500">
          0–{REMIND_DAY_MAX} วัน สูงสุด {REMIND_DAYS_MAX_COUNT} ค่า (0 = วันครบกำหนด) · ระบบเตือนครั้งเดียวต่อหลักไปที่กลุ่ม Telegram ของ อปท. เป็นจำนวนใบเท่านั้น ไม่มีชื่อผู้ประกอบการ
          · ยังไม่ตั้ง = ใช้ {DEFAULT_REMIND_DAYS.join('/')} วัน
        </span>
      </div>
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {saved && !error && <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">บันทึกค่าตั้งแล้ว</p>}
      <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} disabled={busy} onClick={save}>
        {busy && <Loader2 size={15} className="animate-spin" />}บันทึกค่าตั้ง
      </button>
    </section>
  )
}
