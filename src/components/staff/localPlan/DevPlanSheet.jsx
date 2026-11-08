// ตั้ง/แก้แผนพัฒนาท้องถิ่น + ประกาศใช้ / ยกเลิกประกาศ (ผู้จัดการแผนเท่านั้น — คนอื่นเปิดดูได้อย่างเดียว)
// ช่องที่ล็อกหลังประกาศ (ชื่อแผน/ช่วงปี) เป็น disabled พร้อมเหตุผล — ฐานข้อมูลยังเป็นตัวกันสุดท้าย (local_dev_plans_guard)
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { bangkokIsoDate, thaiShortDate } from '../../../lib/complaintReportPeriods'
import { friendlyError, saveDevPlan, setDevPlanStatus } from '../../../lib/localPlanApi'
import { fiscalYearOfIso, menuLabel } from '../../../lib/localPlanView'
import { Sheet } from '../../patientTransport/StaffShell'
import { Field, Section } from '../construction/ui'
import { btnGhost, btnPrimary, inp } from '../construction/uiStyles'
import PlanHistory from './PlanHistory'
import PublishBox from './PublishBox'

/** ค่าเริ่มต้นของแผนฉบับใหม่: ปีเริ่ม = ปีงบถัดไป (ถ้ามีแผนอยู่แล้วต่อจากปีสุดท้าย) · ปีสิ้นสุด = ปีเริ่ม + 4 */
function defaultYears(existingPlans) {
  const last = Math.max(0, ...existingPlans.map(p => Number(p.year_to)))
  // ไม่มีแผนเดิม = ปีงบถัดไป: ข้อ 18 ให้ทำแผนเสร็จก่อนปีงบที่แผนเริ่มใช้ แผนจึงจัดทำล่วงหน้าเสมอ (พ.ย. 2569 = ปีงบ 2570 → 2571–2575)
  const from = last > 0 ? last + 1 : fiscalYearOfIso(bangkokIsoDate()) + 1
  return { year_from: String(from), year_to: String(from + 4) }
}

/**
 * plan = null → ตั้งแผนใหม่ · มีแผน → แก้ + กล่องประกาศ
 * focus: 'edit' | 'publish' | 'unpublish' — ส่วนที่เปิดไว้ตอนเข้ามา (ปุ่มบนหัวหน้า)
 * onSaved(planId) — โหลดข้อมูลใหม่แล้วปิด/คงแผ่น
 */
export default function DevPlanSheet({ tenant, plan, plans, isManager, focus = 'edit', onClose, onSaved }) {
  const isNew = !plan
  const published = plan?.status === 'published'
  const [form, setForm] = useState(() => (plan ? {
    title: plan.title ?? '', year_from: String(plan.year_from), year_to: String(plan.year_to), is_current: Boolean(plan.is_current), note: plan.note ?? '',
  } : { title: 'แผนพัฒนาท้องถิ่น', ...defaultYears(plans), is_current: plans.length === 0 || !plans.some(p => p.is_current), note: '' }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [box, setBox] = useState(focus === 'publish' || focus === 'unpublish' ? focus : null)
  const [historyKey, setHistoryKey] = useState(0)
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }))
  const canEdit = isManager

  const validate = () => {
    if (published) return ''
    if (!form.title.trim()) return 'ระบุชื่อแผน'
    const a = Number(form.year_from)
    const b = Number(form.year_to)
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 2500 || b > 2700) return 'ปีต้องเป็นปีงบประมาณ พ.ศ. (เช่น 2571)'
    if (b < a) return 'ปีสิ้นสุดต้องไม่ก่อนปีเริ่ม'
    if (b - a > 9) return 'ช่วงปีของแผนยาวได้ไม่เกิน 10 ปี'
    return ''
  }

  const save = async () => {
    const problem = validate()
    if (problem) return setError(problem)
    setBusy(true); setError('')
    const { plan: saved, error: saveError } = await saveDevPlan(tenant.id, form, plan)
    setBusy(false)
    if (saveError) return setError(friendlyError(saveError))
    setHistoryKey(k => k + 1)
    onSaved(saved.id, { keepOpen: isNew ? false : true })
  }

  const publishNow = async ({ publishedOn, announceRefNo }) => {
    const { error: rpcError } = await setDevPlanStatus({ planId: plan.id, status: 'published', publishedOn, announceRefNo })
    if (rpcError) return friendlyError(rpcError)
    setBox(null)
    onSaved(plan.id, { keepOpen: false })
    return ''
  }
  const unpublishNow = async ({ reason }) => {
    const { error: rpcError } = await setDevPlanStatus({ planId: plan.id, status: 'draft', reason })
    if (rpcError) return friendlyError(rpcError)
    setBox(null)
    onSaved(plan.id, { keepOpen: false })
    return ''
  }

  return (
    <Sheet title={isNew ? 'ตั้งแผนพัฒนาท้องถิ่น' : menuLabel(plan)} subtitle={isNew ? 'แผนฉบับใหม่' : (published ? `ประกาศใช้แล้ว ${plan.published_on ? thaiShortDate(plan.published_on) : ''}` : 'ฉบับร่าง')} onClose={onClose} busy={busy}>
      <div className="space-y-3 text-gray-800">
        {!canEdit && <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600">ดูได้อย่างเดียว — แก้ได้เฉพาะนักวิเคราะห์นโยบายและแผนที่ได้รับสิทธิ์ หรือแอดมิน</p>}
        <Field label="ชื่อแผน">
          <input className={inp} value={form.title} maxLength={300} disabled={!canEdit || published} onChange={e => set('title', e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ปีงบประมาณเริ่ม (พ.ศ.)">
            <input className={inp} inputMode="numeric" value={form.year_from} disabled={!canEdit || published} onChange={e => set('year_from', e.target.value.replace(/\D/g, '').slice(0, 4))} />
          </Field>
          <Field label="ปีงบประมาณสิ้นสุด (พ.ศ.)">
            <input className={inp} inputMode="numeric" value={form.year_to} disabled={!canEdit || published} onChange={e => set('year_to', e.target.value.replace(/\D/g, '').slice(0, 4))} />
          </Field>
        </div>
        {published && <p className="text-xs text-gray-500">แผนที่ประกาศใช้แล้วแก้ชื่อแผนและช่วงปีไม่ได้ — แก้ได้เฉพาะหมายเหตุและฉบับที่เมนูแสดง</p>}
        <label className="flex min-h-11 items-start gap-2 rounded-xl border border-gray-200 p-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={form.is_current} disabled={!canEdit} onChange={e => set('is_current', e.target.checked)} />
          <span>
            <span className="font-semibold">ให้เมนูแสดงแผนฉบับนี้</span>
            <span className="block text-xs text-gray-500">ชื่อเมนูอ่านช่วงปีจากแผนฉบับนี้ · มีได้ฉบับเดียว ติ๊กแล้วฉบับที่เคยแสดงถูกปลดให้เอง (แผนที่ยังเป็นร่าง เช่น ฉบับถัดไปที่กำลังจัดทำ ก็ให้เมนูแสดงได้)</span>
          </span>
        </label>
        <Field label="หมายเหตุ">
          <textarea className={inp} rows={3} value={form.note} maxLength={4000} disabled={!canEdit} onChange={e => set('note', e.target.value)} />
        </Field>

        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {canEdit && (
          <div className="flex gap-2">
            <button type="button" className={`${btnPrimary} flex-1`} style={{ backgroundColor: 'var(--color-primary)' }} onClick={save} disabled={busy}>
              {busy && <Loader2 size={16} className="animate-spin" />}{isNew ? 'ตั้งแผน' : 'บันทึก'}
            </button>
            <button type="button" className={btnGhost} onClick={onClose} disabled={busy}>ปิด</button>
          </div>
        )}

        {!isNew && canEdit && (
          <Section title={published ? 'ยกเลิกประกาศ' : 'ประกาศใช้แผน'} open={box !== null}>
            {box ? (
              <PublishBox mode={published ? 'unpublish' : 'publish'} subject="แผนพัฒนา" onSubmit={published ? unpublishNow : publishNow} onCancel={() => setBox(null)}
                hint={published
                  ? 'ยกเลิกไม่ได้ถ้ามีโครงการที่เพิ่มจากการเพิ่มเติม/เปลี่ยนแปลงแผนแล้ว หรือมีแผนการดำเนินงานที่ประกาศแล้วอ้างแผนนี้'
                  : 'ประกาศแล้ว โครงการเดิมของแผนล็อกชื่อ/รหัส/ยุทธศาสตร์/วงเงิน และเพิ่มโครงการใหม่ได้เฉพาะตามการเพิ่มเติม/เปลี่ยนแปลงแผน (ข้อ 22) · ก่อนประกาศ โครงการทุกแถวต้องมีครั้งที่เพิ่มเติม = 0'} />
            ) : (
              <button type="button" className={btnGhost} onClick={() => setBox(published ? 'unpublish' : 'publish')}>{published ? 'ยกเลิกประกาศ…' : 'ประกาศใช้แผน…'}</button>
            )}
          </Section>
        )}

        {!isNew && <PlanHistory tenantId={tenant.id} entityId={plan.id} reloadKey={historyKey} title="ประวัติแผน" />}
      </div>
    </Sheet>
  )
}
