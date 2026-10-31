import { useState } from 'react'
import { Loader2, Trash2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { DEPARTMENT_COLORS } from '../../lib/departmentColors'
import { createDepartment, positionSearchKey } from '../../lib/personnelStructure'

const inputCls = 'min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200'

// หน้าต่างเพิ่ม/แก้/ลบกอง 1 กอง เปิดจากแท็บ "กองและตำแหน่ง" — เดิมเป็นฟอร์มค้างบนหน้าตลอด (DepartmentManager)
// กินที่ 300px และทำให้รายชื่อกองซ้ำกับหัวกลุ่มตำแหน่ง (เจ้าของระบบสั่งแก้ 2569-10-31 เพราะหน้ายาว 3-4 จอ)
// กองใช้ร่วมกันทั้งระบบ: การแต่งตั้ง คำร้องที่ส่งเข้ากอง ยานพาหนะ และแถวผู้ลงนามของแต่ละกอง
// ไม่ปิดเมื่อแตะฉากหลังโดยตั้งใจ แบบเดียวกับหน้าต่างแก้ตำแหน่ง — กรอกค้างแล้วเผลอแตะนอกกล่องจะไม่หาย
export default function DepartmentDialog({ tenant, department = null, departments = [], onClose, onSaved }) {
  const isEdit = Boolean(department?.id)
  const [form, setForm] = useState({
    name: department?.name ?? '',
    short_name: department?.short_name ?? '',
    color: department?.color ?? null,
  })
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const name = form.name.trim().replace(/\s+/g, ' ')
  const others = departments.filter(item => item.id !== department?.id)
  const duplicate = Boolean(name) && others.some(item => positionSearchKey(item.name) === positionSearchKey(name))
  const reason = !name ? 'ใส่ชื่อกองก่อน' : duplicate ? `มีกองชื่อ “${name}” อยู่แล้ว` : ''

  // กองอื่นที่ใช้สีนั้นอยู่ — บอกให้รู้ ไม่ได้ห้าม เพราะ อปท. ที่มีกองเกิน 9 กองต้องใช้สีซ้ำอยู่แล้ว
  const usedBy = key => others.filter(item => item.color === key).map(item => item.name)

  async function save() {
    if (reason || busy || !tenant?.id) return
    setBusy('save')
    setError('')
    const shortName = form.short_name.trim() || null
    const { data, error: saveError } = isEdit
      ? await supabase.from('departments')
        .update({ name, short_name: shortName, color: form.color })
        .eq('id', department.id).select().single()
      : await createDepartment(supabase, tenant.id, {
        name, shortName, color: form.color, sortOrder: departments.filter(item => item.is_active !== false).length,
      })
    setBusy('')
    if (saveError) {
      setError(saveError.code === '23505' ? `มีกองชื่อ “${name}” อยู่แล้ว` : 'บันทึกไม่สำเร็จ: ' + saveError.message)
      return
    }
    onSaved?.(data)
  }

  async function remove() {
    if (!isEdit || busy) return
    if (!window.confirm(`ลบกอง "${department.name}"?\n\nข้อมูลที่ผูกกับกองนี้ (เจ้าหน้าที่, ยานพาหนะ ฯลฯ) จะยังคงอยู่ แต่ไม่มีกองกำกับ`)) return
    setBusy('delete')
    setError('')
    const { error: deleteError } = await supabase.from('departments').delete().eq('id', department.id)
    setBusy('')
    if (deleteError) {
      setError('ลบไม่สำเร็จ: ' + deleteError.message)
      return
    }
    onSaved?.(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center"
      role="dialog" aria-modal="true" aria-labelledby="department-dialog-title" data-department-dialog>
      <div className="flex max-h-[93vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl md:max-w-md md:rounded-3xl">
        <div className="flex shrink-0 items-center gap-3 border-b border-gray-100 px-4 py-3">
          <button type="button" onClick={onClose} disabled={Boolean(busy)} aria-label="ปิด"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100"><X size={18} /></button>
          <p id="department-dialog-title" className="font-bold text-gray-800">{isEdit ? 'แก้ไขกอง' : 'เพิ่มกอง/หน่วยงาน'}</p>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label htmlFor="department-name" className="mb-1 block text-xs font-semibold text-gray-600">ชื่อกอง *</label>
              <input id="department-name" value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))}
                onKeyDown={event => event.key === 'Enter' && save()} placeholder="กองช่าง" maxLength={120} className={inputCls} />
            </div>
            <div>
              <label htmlFor="department-short-name" className="mb-1 block text-xs font-semibold text-gray-600">ชื่อย่อ</label>
              <input id="department-short-name" value={form.short_name} onChange={event => setForm(current => ({ ...current, short_name: event.target.value }))}
                onKeyDown={event => event.key === 'Enter' && save()} placeholder="กช." maxLength={30} className={inputCls} />
            </div>
          </div>
          <div>
            <p id="department-color-label" className="mb-1 text-xs font-semibold text-gray-600">สีประจำกอง</p>
            <p className="mb-2 text-xs leading-5 text-gray-500">ใช้เป็นแถบสีของข้อความแจ้งเตือนในกลุ่ม Telegram ให้เจ้าหน้าที่เห็นงานของกองตัวเองได้ง่าย</p>
            <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-labelledby="department-color-label">
              {/* "อัตโนมัติ" มีเฉพาะตอนเพิ่มกอง — trigger ใน DB เลือกให้ตอน INSERT เท่านั้น
                  ตอนแก้ไขถ้าปล่อยว่างจะค้างเป็นว่างและข้อความจะได้แถบขาว จึงให้เลือกสีจริงเสมอ */}
              {!isEdit && (
                <button type="button" role="radio" aria-checked={form.color === null}
                  onClick={() => setForm(current => ({ ...current, color: null }))}
                  className={`min-h-11 rounded-xl border px-3 text-sm font-semibold transition-colors ${
                    form.color === null ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  อัตโนมัติ
                </button>
              )}
              {DEPARTMENT_COLORS.map(color => {
                const selected = form.color === color.key
                const sharing = usedBy(color.key)
                const hint = sharing.length ? `${color.label} — ใช้แล้วโดย ${sharing.join(', ')}` : color.label
                return (
                  <button key={color.key} type="button" role="radio" aria-checked={selected} aria-label={hint} title={hint}
                    onClick={() => setForm(current => ({ ...current, color: color.key }))}
                    className={`relative flex h-11 w-11 items-center justify-center rounded-xl border-2 text-lg transition-all ${
                      selected ? 'scale-105 border-gray-800' : 'border-transparent hover:border-gray-300'}`}>
                    <span aria-hidden="true">{color.emoji}</span>
                    {sharing.length > 0 && !selected && (
                      <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-gray-400" />
                    )}
                  </button>
                )
              })}
            </div>
            <p className="mt-1.5 text-xs text-gray-500">จุดเทามุมขวาบน = มีกองอื่นใช้สีนี้แล้ว (เลือกซ้ำได้)</p>
          </div>
          {isEdit && (
            <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-600">
              แค่เปลี่ยนชื่อกองให้แก้ชื่อที่นี่ อย่าลบแล้วสร้างใหม่ — ลบกองแล้วเจ้าหน้าที่และข้อมูลที่ผูกกับกองนี้ยังอยู่ แต่จะไม่มีกองกำกับ
            </p>
          )}
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">{error}</p>}
          {name && duplicate && <p className="text-xs font-semibold leading-5 text-amber-800" data-department-reason>{reason}</p>}
        </div>
        <div className="flex shrink-0 gap-2 border-t border-gray-100 px-4 pb-6 pt-3">
          {isEdit && (
            <button type="button" onClick={remove} disabled={Boolean(busy)} data-department-delete
              className="flex min-h-11 items-center gap-1.5 rounded-xl bg-red-50 px-4 text-sm font-bold text-red-600 hover:bg-red-100 disabled:opacity-50">
              {busy === 'delete' ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} ลบกองนี้
            </button>
          )}
          <button type="button" onClick={save} disabled={Boolean(reason) || Boolean(busy)} data-department-save
            className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 text-sm font-bold text-white disabled:opacity-50">
            {busy === 'save' && <Loader2 size={16} className="animate-spin" />}
            {isEdit ? 'บันทึกการแก้ไข' : 'เพิ่มกอง'}
          </button>
        </div>
      </div>
    </div>
  )
}
