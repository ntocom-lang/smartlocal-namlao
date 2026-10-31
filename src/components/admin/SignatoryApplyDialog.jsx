import { useState } from 'react'
import { ArrowRight, CheckCircle2, Loader2 } from 'lucide-react'
import SigningDialogShell from './SigningDialogShell'
import { SIGNING_EFFECT_TEXT } from '../../lib/documentSignatories'
import { applySignatoryChanges } from '../../lib/signatoryApi'

// กล่องยืนยันการตั้งผู้ลงนามตามการแต่งตั้ง — ใช้ทั้งปุ่มรวมและปุ่มรายช่อง
// ระบบเตรียมชื่อให้ แต่ไม่บันทึกแทน (อำนาจลงนาม + ชื่อบนเรื่องค้างเปลี่ยนตาม เป็นเส้นที่ห้ามทำอัตโนมัติใน docs/ai/DOMAIN.md)
// จึงต้องให้เห็นชื่อเดิม → ชื่อใหม่ และตำแหน่งที่จะพิมพ์จริงก่อนกด

function changeTag(change) {
  if (!change.current) return { text: 'ตั้งใหม่', tone: 'bg-indigo-50 text-indigo-700' }
  if (change.sameName) return { text: 'คนเดิม เพิ่มบัญชีให้ลงนามในระบบได้', tone: 'bg-emerald-50 text-emerald-700' }
  return { text: 'เปลี่ยนคน', tone: 'bg-amber-50 text-amber-800' }
}

function ChangeRow({ change, checked, single, done, error, disabled, onToggle }) {
  const tag = changeTag(change)
  const { person, current } = change
  const titleDiffers = person.title && change.appointedTitle && person.title !== change.appointedTitle
  // แถวที่ไม่มีช่องติ๊ก (ช่องเดียว / ตั้งสำเร็จแล้ว) ไม่ใช่ป้ายกำกับของอะไร
  const Wrapper = single || done ? 'div' : 'label'
  return (
    <li data-apply-row={change.key} data-apply-state={done ? 'done' : error ? 'failed' : checked ? 'on' : 'off'}
      className={`rounded-2xl border p-3 ${done ? 'border-emerald-200 bg-emerald-50/50' : checked ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-200 bg-white'}`}>
      <Wrapper className={`flex items-start gap-3 ${single || done ? '' : 'cursor-pointer'}`}>
        {done ? <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-600" />
          : !single && (
            <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle}
              aria-label={`ตั้งผู้ลงนามช่อง ${change.label}`} className="mt-0.5 h-5 w-5 shrink-0 accent-indigo-600" />
          )}
        <span className="min-w-0 flex-1 space-y-1.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-slate-800">{change.label}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${done ? 'bg-emerald-100 text-emerald-700' : tag.tone}`}>
              {done ? 'ตั้งแล้ว' : tag.text}
            </span>
          </span>
          <span className="flex flex-col gap-1 text-sm leading-5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2">
            <span className="text-slate-500">
              {current
                ? <>เดิม {current.name}{current.manual ? ' (พิมพ์ชื่อเอง)' : ''}</>
                : 'เดิมยังไม่มีผู้ลงนาม'}
            </span>
            <ArrowRight size={14} className="hidden shrink-0 text-slate-400 sm:block" />
            <span className="font-bold text-slate-900">ใหม่ {person.name}</span>
          </span>
          {person.title ? (
            <span className="block text-xs leading-5 text-slate-600">ตำแหน่งที่พิมพ์ใต้ชื่อ: {person.title}</span>
          ) : (
            <span className="block text-xs font-semibold leading-5 text-amber-800" data-apply-no-title>
              คนนี้ยังไม่มีตำแหน่งในระบบ ใบจะไม่มีตำแหน่งใต้ชื่อ — ตั้งตำแหน่งที่หน้าจัดการผู้ใช้ก่อน
            </span>
          )}
          {titleDiffers && (
            <span className="block text-xs leading-5 text-amber-800" data-apply-title-differs>
              ต่างจากตำแหน่งที่แต่งตั้ง ({change.appointedTitle}) — ถ้าใบควรพิมพ์ตามการแต่งตั้ง ตั้งเสร็จแล้วกด “แก้” ที่ช่องนี้เพื่อพิมพ์ตำแหน่งเอง
            </span>
          )}
          {!done && !single && !change.defaultChecked && (
            <span className="block text-xs leading-5 text-slate-500" data-apply-deliberate>
              ตอนนี้ตั้งคนอื่นไว้ ระบบจึงไม่ติ๊กให้ — ติ๊กเองถ้าจะเปลี่ยนเป็นคนตามการแต่งตั้ง
            </span>
          )}
          {error && <span role="alert" className="block text-xs font-semibold leading-5 text-rose-700">บันทึกไม่สำเร็จ: {error}</span>}
        </span>
      </Wrapper>
    </li>
  )
}

export default function SignatoryApplyDialog({ municipalityId, changes, onClose, onApplied }) {
  const single = changes.length === 1
  const [checked, setChecked] = useState(() => Object.fromEntries(
    changes.map(change => [change.key, single || change.defaultChecked])))
  const [busy, setBusy] = useState(false)
  const [doneKeys, setDoneKeys] = useState([])
  const [errors, setErrors] = useState({})

  const pending = changes.filter(change => checked[change.key] && !doneKeys.includes(change.key))
  const hasFailure = Object.values(errors).some(Boolean)

  async function confirm() {
    if (!pending.length) return
    setBusy(true)
    const results = await applySignatoryChanges(municipalityId, pending)
    const succeeded = pending.filter(change => !results[change.key]).map(change => change.key)
    const nextDone = [...doneKeys, ...succeeded]
    setBusy(false)
    if (succeeded.length === pending.length) {
      onApplied(nextDone.length)
      return
    }
    setDoneKeys(nextDone)
    setErrors(results)
  }

  // ปิดหลังบันทึกไปแล้วบางช่อง ต้องโหลดรายการใหม่ ไม่งั้นตารางข้างหลังยังแสดงชื่อเดิมของช่องที่สำเร็จแล้ว
  const close = () => (doneKeys.length ? onApplied(doneKeys.length) : onClose())

  return (
    <SigningDialogShell testId="signatory-apply-dialog"
      title={single ? `ตั้งผู้ลงนามช่อง “${changes[0].label}”` : 'ตั้งผู้ลงนามตามการแต่งตั้ง'}
      subtitle={single ? 'ตรวจชื่อแล้วกดยืนยัน' : 'ตรวจชื่อแล้วกดยืนยัน ระบบบันทึกเฉพาะช่องที่ติ๊ก'}
      closeDisabled={busy} onClose={close}
      footer={(
        <div className="space-y-2.5">
          <p className="text-xs font-semibold leading-5 text-slate-600">{SIGNING_EFFECT_TEXT}</p>
          <div className="flex gap-2">
            <button type="button" onClick={close} disabled={busy}
              className="min-h-11 flex-1 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              {doneKeys.length ? 'ปิด' : 'ยกเลิก'}
            </button>
            <button type="button" onClick={confirm} disabled={busy || !pending.length} data-apply-confirm
              className="flex min-h-11 flex-[1.5] items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-40">
              {busy && <Loader2 size={16} className="animate-spin" />}
              {hasFailure ? `ลองใหม่ ${pending.length} ช่อง` : pending.length ? `ยืนยัน ตั้ง ${pending.length} ช่อง` : 'ยังไม่ได้เลือกช่อง'}
            </button>
          </div>
        </div>
      )}>
      <ul className="space-y-2.5">
        {changes.map(change => (
          <ChangeRow key={change.key} change={change} single={single}
            checked={Boolean(checked[change.key])}
            done={doneKeys.includes(change.key)}
            error={errors[change.key]}
            disabled={busy}
            onToggle={() => setChecked(current => ({ ...current, [change.key]: !current[change.key] }))} />
        ))}
      </ul>
    </SigningDialogShell>
  )
}
