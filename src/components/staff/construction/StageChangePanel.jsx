// กล่องยืนยันการเปลี่ยนขั้นโครงการ (อยู่ในหน้าเดียวกับแผ่นโครงการ ไม่เปิดหน้าต่างซ้อน)
// ตรวจก่อนส่งด้วย checkStageChange() ชุดเดียวกับ RPC civil_set_project_stage — ฐานข้อมูลตรวจซ้ำอยู่ดี ข้อความผิดพลาดจากฐานแสดงตรงๆ
// ⚠️ ระบบแค่ "บันทึกสิ่งที่ผู้มีอำนาจสั่งแล้ว" ไม่ได้ยกเลิก/บอกเลิกสัญญา/อนุมัติแทนใคร
import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Circle, Loader2 } from 'lucide-react'
import { checkStageChange, closeChecklist, closeFacts } from '../../../lib/constructionLifecycle'
import { setProjectStage } from '../../../lib/constructionLifecycleApi'
import { Field } from './ui'
import { btnGhost, btnPrimary, inp } from './uiStyles'
import { actionLabel, isDangerAction } from './lifecycleFormat'

/** รายการตรวจก่อนปิดโครงการ (จาก closeChecklist) */
export function CloseChecklist({ bundle, today }) {
  const list = closeChecklist(bundle, today)
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <p className="mb-1.5 text-xs font-bold text-gray-700">รายการตรวจก่อนปิดโครงการ</p>
      <ul className="space-y-1">
        {list.items.map(item => (
          <li key={item.key} className="flex items-start gap-2 text-xs">
            {item.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" aria-label="ครบ" role="img" />
              : <Circle size={14} className={`mt-0.5 shrink-0 ${item.required ? 'text-red-400' : 'text-gray-300'}`} aria-label="ยังไม่ครบ" role="img" />}
            <span className={item.ok ? 'text-gray-600' : item.required ? 'font-semibold text-gray-900' : 'text-gray-500'}>
              {item.label}{!item.required && !item.ok ? ' (ไม่บังคับสำหรับโครงการนี้)' : ''}
            </span>
          </li>
        ))}
      </ul>
      {!list.ready && <p className="mt-2 text-xs text-amber-700">ยังมีรายการที่ไม่ครบ — หัวหน้ากองปิดข้ามได้โดยระบุเหตุผล และเหตุผลจะอยู่ในประวัติโครงการ</p>}
    </div>
  )
}

export default function StageChangePanel({ project, bundle, access, action, today, onCancel, onDone }) {
  const [reason, setReason] = useState('')
  const [refNo, setRefNo] = useState('')
  const [refDate, setRefDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const danger = isDangerAction(action)

  const submit = async () => {
    setError('')
    const verdict = checkStageChange({ project, to: action.to, access, reason, refNo, ...closeFacts(bundle) })
    if (!verdict.ok) return setError(verdict.error)
    setBusy(true)
    const result = await setProjectStage({ projectId: project.id, stage: action.to, reason, refNo, refDate: refDate || null })
    setBusy(false)
    if (result.error) return setError(result.message)
    onDone(action)
  }

  return (
    <div className={`space-y-3 rounded-2xl border p-4 ${danger ? 'border-red-200 bg-red-50/50' : 'border-gray-200 bg-gray-50'}`} role="group" aria-label={`ยืนยัน: ${actionLabel(action)}`}>
      <p className="text-sm font-bold text-gray-900">{actionLabel(action)}</p>
      {danger && (
        <p className="flex items-start gap-2 rounded-xl bg-white px-3 py-2 text-xs text-red-700">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>ระบบเพียงบันทึกสิ่งที่ผู้มีอำนาจสั่งไว้แล้วเท่านั้น — ไม่ได้{action.kind === 'terminate' ? 'บอกเลิกสัญญา' : 'ยกเลิกโครงการ'}แทนใคร ต้องมีคำสั่ง/หนังสือที่ลงนามแล้ว และระบุเลขที่ด้านล่าง</span>
        </p>
      )}
      {action.to === 'closed' && <CloseChecklist bundle={bundle} today={today} />}
      <div className="grid gap-3 sm:grid-cols-2">
        {action.needRef && (
          <>
            <Field label="เลขที่หนังสือ / คำสั่ง *"><input className={inp} value={refNo} maxLength={200} onChange={e => setRefNo(e.target.value)} /></Field>
            <Field label="ลงวันที่"><input type="date" className={inp} value={refDate} onChange={e => setRefDate(e.target.value)} /></Field>
          </>
        )}
        <Field label={action.needReason ? 'เหตุผล *' : 'เหตุผล (ไม่บังคับ)'} className="sm:col-span-2">
          <textarea className={inp} rows={3} maxLength={4000} value={reason} onChange={e => setReason(e.target.value)} />
        </Field>
      </div>
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={submit} className={btnPrimary} style={{ backgroundColor: danger ? '#b91c1c' : 'var(--color-primary)' }}>
          {busy && <Loader2 size={16} className="animate-spin" />}ยืนยัน
        </button>
        <button type="button" className={btnGhost} disabled={busy} onClick={onCancel}>ยกเลิก</button>
      </div>
    </div>
  )
}
