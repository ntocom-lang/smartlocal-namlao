import { useState } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'
import { ListCard } from '../../patientTransport/StaffShell'
import { saveSettings, friendlyError } from '../../../lib/wasteFeeApi'
import { CONFIRMER_ROLES, CONFIRMER_ROLE_LABEL, confirmerRolesOf, validateConfirmerSettings } from '../../../lib/wasteFee'
import { btnPrimary, inp } from '../construction/uiStyles'
import Field from '../licence/Field'
import { fmtDateTime } from './format'

/**
 * แท็บ "ตั้งค่า": ใครยืนยัน/เลิกการลดค่ากำจัด (คัดแยกขยะ) ได้ — ค่าตั้งราย อปท. (waste_fee_settings)
 * ไม่มีแถว = ค่าเริ่มต้น admin + officer ของกองที่ถือเรื่อง · superadmin ยืนยันได้เสมอ
 * แก้ได้เฉพาะ admin/superadmin (RLS) · ผู้จัดการทะเบียนคนอื่นเห็นแบบอ่านอย่างเดียว · ทุกการเปลี่ยนลงประวัติ
 * ⚠️ อำนาจผู้รับรองการคัดแยกต้องยืนยันกับกฎกระทรวง/ข้อบัญญัติของ อปท. ก่อนใช้ออกยอดจริง
 */
export default function WasteFeeSettingsTab({ tenantId, settings, isAdmin, onSaved }) {
  const [roles, setRoles] = useState(() => [...confirmerRolesOf(settings)])
  const [ref, setRef] = useState(settings?.sorting_delegation_ref ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const toggle = role => setRoles(list => (list.includes(role) ? list.filter(r => r !== role) : [...list, role]))

  async function save() {
    const problem = validateConfirmerSettings({ roles, delegationRef: ref })
    if (problem) { setError(problem); return }
    setBusy(true); setError(''); setNotice('')
    const { error: err } = await saveSettings(tenantId, { roles, delegationRef: ref })
    setBusy(false)
    if (err) { setError(friendlyError(err)); return }
    setNotice('บันทึกแล้ว — มีผลกับการยืนยันครั้งถัดไป (การยืนยันที่ผ่านมาไม่เปลี่ยน)')
    onSaved()
  }

  return (
    <ListCard title="ผู้ยืนยันการคัดแยกขยะ (ลดค่ากำจัดกึ่งหนึ่ง)">
      <div className="space-y-3 px-4 py-4 sm:px-5">
        <p className="text-xs leading-relaxed text-gray-600">
          การลดค่ากำจัดเป็นประโยชน์ของประชาชน ระบบไม่ตัดสินเอง — ผู้ที่เลือกไว้ที่นี่เป็นผู้ยืนยันรายบัญชีพร้อมเหตุผล/หลักฐาน
          เจ้าหน้าที่ระดับ officer/staff ต้องสังกัดกองที่ถือเรื่องงานขยะ · ผู้ดูแลระบบกลาง (superadmin) ยืนยันได้เสมอ
        </p>
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
          ก่อนใช้จริง ให้ตรวจข้อบัญญัติของ อปท. และคำสั่งมอบหมายว่าใครมีอำนาจรับรองการคัดแยก แล้วตั้งให้ตรงกัน
        </p>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {notice && <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-900">{notice}</p>}

        <fieldset className="space-y-2" disabled={!isAdmin || busy}>
          <legend className="text-sm font-bold text-gray-800">ยืนยันได้โดย</legend>
          {CONFIRMER_ROLES.map(role => (
            <label key={role} className="flex items-start gap-2 text-sm text-gray-800">
              <input type="checkbox" className="mt-1" checked={roles.includes(role)} onChange={() => toggle(role)} />
              <span>{CONFIRMER_ROLE_LABEL[role]}</span>
            </label>
          ))}
        </fieldset>

        <Field label="อ้างอิงคำสั่งมอบหมายผู้รับรอง (ไม่บังคับ)" hint="เช่น คำสั่ง อปท. ที่ …/2569 ลงวันที่ … — บันทึกคู่กับการยืนยันทุกครั้ง">
          <input className={inp} maxLength={300} value={ref} disabled={!isAdmin || busy} onChange={e => setRef(e.target.value)} />
        </Field>

        {isAdmin ? (
          <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} disabled={busy} onClick={save}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}บันทึกการตั้งค่า
          </button>
        ) : (
          <p className="text-xs text-gray-500">แก้การตั้งค่านี้ได้เฉพาะผู้ดูแลระบบของ อปท.</p>
        )}
        {settings?.updated_at
          ? <p className="text-[11px] text-gray-500">ตั้งค่าล่าสุด {fmtDateTime(settings.updated_at)}</p>
          : <p className="text-[11px] text-gray-500">ยังไม่เคยตั้ง — ใช้ค่าเริ่มต้น (ผู้ดูแลระบบ + officer ของกองที่ถือเรื่อง)</p>}
      </div>
    </ListCard>
  )
}
