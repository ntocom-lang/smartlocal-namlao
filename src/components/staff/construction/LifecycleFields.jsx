// ช่องกรอกที่สร้างจากสเปกใน src/lib/constructionInstallmentForm.js (INSTALLMENT_GROUPS / CHANGE_FIELDS / DEFECT_FIELDS)
// ใช้ร่วมกันของฟอร์มงวดงาน / ขยายเวลา-แก้สัญญา / ตรวจความชำรุด — ใช้ Field + inp เดิมของโมดูล ไม่ออกแบบหน้าตาใหม่
// ช่องที่ผู้ใช้คนนี้แก้ไม่ได้ (ผลตรวจรับ/ผลพิจารณา/ช่องที่ล็อกหลังมีผล) แสดงเป็นข้อความอย่างเดียว — ฐานข้อมูลบังคับซ้ำที่ trigger civil_manage_columns_guard
import { Field } from './ui'
import { inp, lbl } from './uiStyles'
import { moneyTh, thaiDay } from './lifecycleFormat'

/** ค่าที่แสดงแบบอ่านอย่างเดียว */
function shown(spec, value) {
  if (spec.type === 'bool') return value ? 'ใช่' : 'ไม่'
  if (value === null || value === undefined || value === '') return '—'
  if (spec.type === 'select') return spec.options[value] ?? String(value)
  if (spec.type === 'date') return thaiDay(value)
  if (spec.type === 'money') return moneyTh(value)
  if (spec.type === 'pct') return `${Number(value)}%`
  return String(value)
}

function SpecInput({ spec, value, onChange }) {
  const set = v => onChange(spec.key, v)
  switch (spec.type) {
    case 'longtext':
      return <textarea className={inp} rows={2} maxLength={4000} value={value} onChange={e => set(e.target.value)} />
    case 'select':
      return (
        <select className={inp} value={value} onChange={e => set(e.target.value)}>
          <option value="">— ไม่ระบุ —</option>
          {Object.entries(spec.options).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      )
    case 'date':
      return <input className={inp} type="date" value={value} onChange={e => set(e.target.value)} />
    case 'money':
    case 'pct':
      return <input className={inp} type="text" inputMode="decimal" value={value} onChange={e => set(e.target.value)} />
    case 'int':
      return <input className={inp} type="text" inputMode="numeric" value={value} onChange={e => set(e.target.value)} />
    default:
      return <input className={inp} type="text" maxLength={200} value={value} onChange={e => set(e.target.value)} />
  }
}

/**
 * specs      สเปกช่อง (จาก lib)
 * draft      ค่าในฟอร์ม · onChange(key, value)
 * locked     Set ของคีย์ที่แสดงอย่างเดียว · hidden = Set ของคีย์ที่ไม่แสดงเลย
 * extras     { [key]: ReactNode } ปุ่ม/ข้อความเสริมใต้ช่อง (เช่น "ใช้ค่าที่ระบบคำนวณ")
 */
export default function SpecGrid({ specs, draft, onChange, locked = new Set(), hidden = new Set(), extras = {} }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {specs.filter(spec => !hidden.has(spec.key)).map(spec => {
        const wide = spec.type === 'longtext' ? 'sm:col-span-2' : ''
        const readOnly = spec.readOnly || locked.has(spec.key)
        const hint = spec.hint ? <span className="mt-1 block text-[11px] text-gray-400">{spec.hint}</span> : null
        if (readOnly) {
          return (
            <div key={spec.key} className={wide}>
              <span className={lbl}>{spec.label}</span>
              <p className="min-h-6 whitespace-pre-wrap break-words text-sm font-semibold text-gray-800">{shown(spec, draft[spec.key])}</p>
            </div>
          )
        }
        if (spec.type === 'bool') {
          return (
            <label key={spec.key} className={`flex min-h-11 items-center gap-2 text-sm text-gray-800 ${wide}`}>
              <input type="checkbox" className="size-5" checked={Boolean(draft[spec.key])} onChange={e => onChange(spec.key, e.target.checked)} />
              {spec.label}
            </label>
          )
        }
        return (
          <div key={spec.key} className={wide}>
            <Field label={spec.label}><SpecInput spec={spec} value={draft[spec.key]} onChange={onChange} /></Field>
            {hint}
            {extras[spec.key]}
          </div>
        )
      })}
    </div>
  )
}
