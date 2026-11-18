import { CUSTOM_NUMBER_MAX_LEN, CUSTOM_TEXTAREA_MAX, CUSTOM_TEXT_MAX } from '../../lib/customFormFields'

// ช่องกรอกของประเภทคำขอที่ อปท. ตั้งเอง (ตัวสร้างแบบฟอร์มออนไลน์) — ใช้ในหน้ายื่นคำขอของประชาชน
// ปุ่ม/ช่องสูงอย่างน้อย 44px (กดด้วยนิ้วบนมือถือ 360px ได้) · ตัวอักษร 16px กันเบราว์เซอร์ iOS ซูมเองตอนแตะช่อง
// ไม่ validate ที่นี่ — ผู้เรียกใช้ validateCustomAnswers แล้วส่ง errors กลับมาแสดงใต้ช่อง

const inputCls = 'w-full min-h-12 border rounded-xl px-3 py-3 text-base text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200'

export default function CustomFormFieldsInput({ fields, answers, errors, onChange }) {
  if (!fields?.length) return null
  return (
    <div className="space-y-4" data-testid="custom-form-fields">
      {fields.map(field => {
        const error = errors?.[field.id]
        const value = answers?.[field.id]
        const borderCls = error ? 'border-red-400' : 'border-gray-200'
        const describedBy = [field.help ? `${field.id}-help` : '', error ? `${field.id}-err` : ''].filter(Boolean).join(' ') || undefined
        const labelEl = (
          <span className="text-sm font-semibold text-gray-700 mb-1 block">
            {field.label}{field.required && <span className="text-red-500" aria-label="จำเป็น"> *</span>}
          </span>
        )

        let control
        if (field.type === 'textarea') {
          control = (
            <textarea id={field.id} rows={4} maxLength={CUSTOM_TEXTAREA_MAX} value={value ?? ''}
              onChange={e => onChange(field.id, e.target.value)}
              aria-invalid={Boolean(error)} aria-describedby={describedBy}
              className={`${inputCls} ${borderCls}`} />
          )
        } else if (field.type === 'choice') {
          control = (
            <div role="radiogroup" aria-labelledby={`${field.id}-label`} aria-describedby={describedBy} className="space-y-2">
              {field.options.map(option => (
                <label key={option}
                  className={`flex min-h-12 items-center gap-3 rounded-xl border px-3 py-2.5 text-base text-gray-800 cursor-pointer ${
                    value === option ? 'border-blue-400 bg-blue-50' : `${borderCls} bg-white`}`}>
                  <input type="radio" name={field.id} value={option} checked={value === option}
                    onChange={() => onChange(field.id, option)} className="h-5 w-5 shrink-0" />
                  <span className="leading-snug">{option}</span>
                </label>
              ))}
            </div>
          )
        } else if (field.type === 'checkbox') {
          control = (
            <label className={`flex min-h-12 items-start gap-3 rounded-xl border px-3 py-3 cursor-pointer ${
              value === true ? 'border-blue-400 bg-blue-50' : `${borderCls} bg-white`}`}>
              <input id={field.id} type="checkbox" checked={value === true}
                onChange={e => onChange(field.id, e.target.checked)}
                aria-invalid={Boolean(error)} aria-describedby={describedBy}
                className="mt-0.5 h-5 w-5 shrink-0" />
              <span className="text-base leading-snug text-gray-800">
                {field.label}{field.required && <span className="text-red-500" aria-label="จำเป็น"> *</span>}
              </span>
            </label>
          )
        } else {
          control = (
            <input id={field.id}
              type={field.type === 'date' ? 'date' : 'text'}
              inputMode={field.type === 'number' ? 'decimal' : undefined}
              maxLength={field.type === 'number' ? CUSTOM_NUMBER_MAX_LEN : field.type === 'text' ? CUSTOM_TEXT_MAX : undefined}
              value={value ?? ''}
              onChange={e => onChange(field.id, e.target.value)}
              aria-invalid={Boolean(error)} aria-describedby={describedBy}
              className={`${inputCls} ${borderCls}`} />
          )
        }

        return (
          <div key={field.id}>
            {field.type === 'checkbox' ? null : field.type === 'choice'
              ? <span id={`${field.id}-label`}>{labelEl}</span>
              : <label htmlFor={field.id}>{labelEl}</label>}
            {control}
            {field.help && <p id={`${field.id}-help`} className="mt-1 text-xs text-gray-400 leading-relaxed">{field.help}</p>}
            {error && <p id={`${field.id}-err`} role="alert" className="mt-1 text-xs font-semibold text-red-600">{error}</p>}
          </div>
        )
      })}
    </div>
  )
}
