import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react'
import {
  CUSTOM_FIELDS_MAX, CUSTOM_FIELD_TYPES, CUSTOM_HELP_MAX, CUSTOM_LABEL_MAX,
  CUSTOM_OPTIONS_MAX, CUSTOM_OPTIONS_MIN, CUSTOM_OPTION_MAX,
  newFieldId, sanitizeFieldDefs,
} from '../../lib/customFormFields'

// โมดัลตั้ง "ช่องกรอก" ของประเภทคำขอที่ อปท. เพิ่มเอง — ไม่เขียนฐานข้อมูลเอง
// กด "ตกลง" แล้วคืนนิยามช่องที่ผ่าน sanitizeFieldDefs ให้ DocumentTypeAssignments เก็บลง state
// เขียนลงฐานพร้อมปุ่ม "บันทึกการเปลี่ยนแปลง" เดิมของหน้า (ไม่เพิ่มทางเขียนใหม่)

const inputCls = 'w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-1 focus:ring-blue-300'

// state ในโมดัลเก็บ "ตัวเลือก" เป็นข้อความหลายบรรทัด (บรรทัดละ 1 ตัวเลือก) เพื่อให้พิมพ์ Enter ได้ลื่น
// แปลงเป็นอาร์เรย์ตอนกดตกลงเท่านั้น
function toDraft(field) {
  return {
    id: field.id,
    label: field.label,
    type: field.type,
    required: field.required === true,
    help: field.help ?? '',
    optionsText: (field.options ?? []).join('\n'),
  }
}

function fromDraft(draft) {
  return {
    id: draft.id,
    label: draft.label,
    type: draft.type,
    required: draft.required,
    help: draft.help,
    options: draft.type === 'choice' ? draft.optionsText.split('\n') : undefined,
  }
}

function problemOf(draft) {
  if (!draft.label.trim()) return 'ยังไม่ได้ตั้งชื่อช่อง'
  if (draft.type === 'choice') {
    const count = new Set(draft.optionsText.split('\n').map(line => line.trim()).filter(Boolean)).size
    if (count < CUSTOM_OPTIONS_MIN) return `ต้องมีตัวเลือกอย่างน้อย ${CUSTOM_OPTIONS_MIN} ข้อ`
  }
  return ''
}

export default function CustomFormFieldsEditor({ typeLabel, fields, onCancel, onConfirm }) {
  const [drafts, setDrafts] = useState(() => (fields ?? []).map(toDraft))

  function patch(index, change) {
    setDrafts(prev => prev.map((draft, i) => (i === index ? { ...draft, ...change } : draft)))
  }
  function move(index, delta) {
    setDrafts(prev => {
      const target = index + delta
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }
  function remove(index) {
    setDrafts(prev => prev.filter((_, i) => i !== index))
  }
  function add() {
    setDrafts(prev => (prev.length >= CUSTOM_FIELDS_MAX ? prev : [
      ...prev,
      { id: newFieldId(prev.map(d => d.id)), label: '', type: 'text', required: false, help: '', optionsText: '' },
    ]))
  }

  const problems = drafts.map(problemOf)
  const hasProblem = problems.some(Boolean)

  function confirm() {
    if (hasProblem) return
    onConfirm(sanitizeFieldDefs(drafts.map(fromDraft)))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-0 md:p-4" role="dialog" aria-modal="true"
      aria-label={`ช่องกรอกของ ${typeLabel}`}>
      <div className="bg-white w-full md:max-w-2xl md:rounded-2xl rounded-t-2xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-800">ช่องกรอกของ &ldquo;{typeLabel}&rdquo;</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-gray-400">
              ประชาชนจะเห็นช่องเหล่านี้ต่อจากข้อมูลผู้ยื่น (ชื่อ เบอร์โทร ที่อยู่ วัตถุประสงค์) และคำตอบจะพิมพ์ลงใบคำขอ A4
              พร้อมช่องลงนามเจ้าหน้าที่ — ตั้งชื่อช่องให้สั้น คำตอบรวมทุกช่องพิมพ์ได้ราว 13 บรรทัดต่อแผ่น
              ถ้าเกินตารางจะต่อหน้า 2 · คำขอที่ยื่นไปแล้วไม่เปลี่ยนตามที่แก้ที่นี่
            </p>
          </div>
          <button type="button" onClick={onCancel} aria-label="ปิดโดยไม่บันทึก"
            className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {drafts.length === 0 && (
            <p className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-xs text-gray-500">
              ยังไม่มีช่องกรอก — ประชาชนจะเห็นแค่ฟอร์มกลาง (ผู้ยื่น วัตถุประสงค์) กด &ldquo;เพิ่มช่อง&rdquo; เพื่อเริ่ม
            </p>
          )}
          {drafts.map((draft, index) => (
            <div key={draft.id} className="rounded-xl border border-gray-200 bg-gray-50/60 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-6 shrink-0 text-right text-xs font-bold text-gray-400 tabular-nums">{index + 1}</span>
                <input type="text" value={draft.label} maxLength={CUSTOM_LABEL_MAX}
                  onChange={e => patch(index, { label: e.target.value })}
                  placeholder="ชื่อช่อง เช่น วันที่ต้องการใช้สถานที่"
                  aria-label={`ชื่อช่องที่ ${index + 1}`}
                  className={inputCls} />
                <div className="flex shrink-0 items-center">
                  <button type="button" onClick={() => move(index, -1)} disabled={index === 0}
                    aria-label={`เลื่อนช่องที่ ${index + 1} ขึ้น`}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-white hover:text-gray-700 disabled:opacity-30">
                    <ArrowUp size={15} />
                  </button>
                  <button type="button" onClick={() => move(index, 1)} disabled={index === drafts.length - 1}
                    aria-label={`เลื่อนช่องที่ ${index + 1} ลง`}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-white hover:text-gray-700 disabled:opacity-30">
                    <ArrowDown size={15} />
                  </button>
                  <button type="button" onClick={() => remove(index)}
                    aria-label={`ลบช่องที่ ${index + 1}`}
                    className="rounded-lg p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-500">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pl-8">
                <select value={draft.type} onChange={e => patch(index, { type: e.target.value })}
                  aria-label={`ชนิดช่องที่ ${index + 1}`}
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-900 bg-white focus:outline-none focus:ring-1 focus:ring-blue-300">
                  {Object.entries(CUSTOM_FIELD_TYPES).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-xs text-gray-600">
                  <input type="checkbox" checked={draft.required} onChange={e => patch(index, { required: e.target.checked })} />
                  บังคับกรอก
                </label>
              </div>

              <div className="pl-8">
                <input type="text" value={draft.help} maxLength={CUSTOM_HELP_MAX}
                  onChange={e => patch(index, { help: e.target.value })}
                  placeholder="คำอธิบายใต้ช่อง (ไม่บังคับ)"
                  aria-label={`คำอธิบายช่องที่ ${index + 1}`}
                  className={inputCls + ' text-xs'} />
              </div>

              {draft.type === 'choice' && (
                <div className="pl-8">
                  <textarea value={draft.optionsText} rows={4}
                    onChange={e => patch(index, { optionsText: e.target.value })}
                    placeholder={'ตัวเลือก บรรทัดละ 1 ข้อ เช่น\nในอาคาร\nนอกอาคาร'}
                    aria-label={`ตัวเลือกของช่องที่ ${index + 1}`}
                    className={inputCls + ' text-xs'} />
                  <p className="mt-0.5 text-[10px] text-gray-400">
                    {CUSTOM_OPTIONS_MIN}–{CUSTOM_OPTIONS_MAX} ข้อ · ข้อละไม่เกิน {CUSTOM_OPTION_MAX} ตัวอักษร
                  </p>
                </div>
              )}

              {problems[index] && (
                <p className="pl-8 text-[11px] font-semibold text-red-600">{problems[index]}</p>
              )}
            </div>
          ))}

          <button type="button" onClick={add} disabled={drafts.length >= CUSTOM_FIELDS_MAX}
            className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-40">
            <Plus size={13} /> เพิ่มช่อง ({drafts.length}/{CUSTOM_FIELDS_MAX})
          </button>
        </div>

        <div className="flex gap-2 px-5 py-3 border-t border-gray-100 shrink-0">
          <button type="button" onClick={onCancel}
            className="px-4 py-2.5 rounded-xl text-sm text-gray-600 bg-white border border-gray-200 hover:bg-gray-50">
            ยกเลิก
          </button>
          <button type="button" onClick={confirm} disabled={hasProblem}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40">
            ตกลง
          </button>
        </div>
        <p className="px-5 pb-3 text-[10px] text-gray-400">
          ตกลงแล้วยังไม่บันทึกลงระบบ — ต้องกด &ldquo;บันทึกการเปลี่ยนแปลง&rdquo; ที่หน้าตั้งค่าอีกครั้ง
        </p>
      </div>
    </div>
  )
}
