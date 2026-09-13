import { useState, useEffect } from 'react'
import { Pencil, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { DEPARTMENT_COLORS, departmentColor } from '../../lib/departmentColors'

const inp = 'w-full px-3 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent'

const EMPTY_FORM = { name: '', short_name: '', color: null }

// จัดการกอง/หน่วยงานกลางของเทศบาล — ใช้ร่วมกันทั้งระบบ (จัดการเจ้าหน้าที่, ยานพาหนะ, งบประมาณ ฯลฯ)
// ดึงมาจาก DeptTab เดิมใน FleetSetup.jsx (ตาราง departments เดิมชื่อ fleet_departments)
export default function DepartmentManager({ tenant }) {
  const [depts, setDepts] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm]     = useState(EMPTY_FORM)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(null)

  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('departments').select('id, code, name, short_name, color')
      .eq('municipality_id', tenant.id).eq('is_active', true).order('sort_order')
      .then(({ data }) => setDepts(data ?? []))
      .finally(() => setLoading(false))
  }, [tenant?.id])

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  async function handleSave() {
    if (!form.name.trim()) return alert('กรุณากรอกชื่อกอง')
    setSaving(true)
    if (editId) {
      const { data, error } = await supabase.from('departments')
        .update({ name: form.name.trim(), short_name: form.short_name.trim() || null, color: form.color })
        .eq('id', editId).select().single()
      if (!error) {
        setDepts(prev => prev.map(d => d.id === editId ? data : d))
        cancelEdit()
      } else {
        alert('บันทึกไม่สำเร็จ: ' + error.message)
      }
    } else {
      const code = 'dept_' + Date.now().toString(36)
      // color เป็น null ได้ = "อัตโนมัติ" — trigger departments_fill_color ใน DB เลือกสีจากชื่อกอง
      // หรือสีแรกที่ยังว่างให้ แถวที่ .select() กลับมาจึงมีสีจริงแล้ว ไม่ต้องคำนวณซ้ำฝั่งหน้าจอ
      const { data, error } = await supabase.from('departments').insert({
        municipality_id: tenant.id, name: form.name.trim(),
        short_name: form.short_name.trim() || null, code,
        sort_order: depts.length,
        color: form.color,
      }).select().single()
      if (!error) {
        setDepts(prev => [...prev, data])
        setForm(EMPTY_FORM)
      } else {
        alert('เพิ่มไม่สำเร็จ: ' + error.message)
      }
    }
    setSaving(false)
  }

  async function handleDelete(d) {
    if (!confirm(`ลบกอง "${d.name}"?\n\nข้อมูลที่ผูกกับกองนี้ (เจ้าหน้าที่, ยานพาหนะ ฯลฯ) จะยังคงอยู่ แต่ไม่มีกองกำกับ`)) return
    setDeleting(d.id)
    const { error } = await supabase.from('departments').delete().eq('id', d.id)
    if (!error) {
      setDepts(prev => prev.filter(x => x.id !== d.id))
      if (editId === d.id) cancelEdit()
    } else {
      alert('ลบไม่สำเร็จ: ' + error.message)
    }
    setDeleting(null)
  }

  function startEdit(d) {
    setEditId(d.id)
    setForm({ name: d.name, short_name: d.short_name ?? '', color: d.color ?? null })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditId(null)
    setForm(EMPTY_FORM)
  }

  // กองอื่นที่ใช้สีนั้นอยู่ (ไม่นับกองที่กำลังแก้) — บอกแอดมินว่าเลือกแล้วจะซ้ำกับใคร ไม่ได้ห้ามเลือก
  // เพราะ อปท. ที่มีกองเกิน 9 กองต้องใช้สีซ้ำอยู่แล้ว
  function usedBy(key) {
    return depts.filter(d => d.color === key && d.id !== editId).map(d => d.name)
  }

  if (loading) return (
    <div className="flex justify-center py-10">
      <div className="w-5 h-5 border-4 border-gray-200 rounded-full animate-spin" style={{ borderTopColor: 'var(--color-primary)' }} />
    </div>
  )

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h3 className="font-semibold text-gray-700">จัดการกอง/หน่วยงาน</h3>
        <p className="text-xs text-gray-400 mt-0.5">ใช้ร่วมกันทั้งระบบ — เจ้าหน้าที่, ยานพาหนะ, งบประมาณ ดึงรายชื่อกองจากหน้านี้ที่เดียว</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <p className="text-sm font-bold text-gray-700">{editId ? 'แก้ไขกอง' : 'เพิ่มกอง/หน่วยงาน'}</p>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="text-xs font-semibold text-gray-600 mb-1 block">ชื่อกอง *</label>
            <input value={form.name} onChange={set('name')} placeholder="กองช่าง" className={inp}
              onKeyDown={e => e.key === 'Enter' && handleSave()} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">ชื่อย่อ</label>
            <input value={form.short_name} onChange={set('short_name')} placeholder="กช." className={inp}
              onKeyDown={e => e.key === 'Enter' && handleSave()} />
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">สีประจำกอง</label>
          <p className="text-[11px] text-gray-400 mb-2">ใช้เป็นแถบสีบน-ล่างของข้อความแจ้งเตือนในกลุ่ม Telegram ให้เจ้าหน้าที่เห็นงานของกองตัวเองได้ง่าย</p>
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="สีประจำกอง">
            {/* "อัตโนมัติ" มีเฉพาะตอนเพิ่มกอง — trigger ใน DB เลือกให้ตอน INSERT เท่านั้น
                ตอนแก้ไขถ้าปล่อยว่างจะค้างเป็นว่างและข้อความจะได้แถบขาว จึงให้เลือกสีจริงเสมอ */}
            {!editId && (
              <button type="button" role="radio" aria-checked={form.color === null}
                onClick={() => setForm(f => ({ ...f, color: null }))}
                className={`h-9 px-3 rounded-lg text-xs font-semibold border transition-colors ${
                  form.color === null ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}>
                อัตโนมัติ
              </button>
            )}
            {DEPARTMENT_COLORS.map(c => {
              const selected = form.color === c.key
              const others = usedBy(c.key)
              const hint = others.length ? `${c.label} — ใช้แล้วโดย ${others.join(', ')}` : c.label
              return (
                <button key={c.key} type="button" role="radio" aria-checked={selected}
                  aria-label={hint} title={hint}
                  onClick={() => setForm(f => ({ ...f, color: c.key }))}
                  className={`relative w-9 h-9 rounded-lg flex items-center justify-center text-lg border-2 transition-all ${
                    selected ? 'border-gray-800 scale-110' : 'border-transparent hover:border-gray-300'
                  }`}>
                  <span aria-hidden="true">{c.emoji}</span>
                  {others.length > 0 && !selected && (
                    <span aria-hidden="true" className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-gray-400" />
                  )}
                </button>
              )
            })}
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5">จุดเทามุมขวาบน = มีกองอื่นใช้สีนี้แล้ว (เลือกซ้ำได้)</p>
        </div>
        <div className="flex gap-2">
          {editId && (
            <button onClick={cancelEdit}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 text-gray-600">
              ยกเลิก
            </button>
          )}
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            {saving ? 'กำลังบันทึก...' : editId ? 'อัปเดต' : 'เพิ่มกอง'}
          </button>
        </div>
      </div>

      {depts.length === 0 && (
        <p className="text-center text-sm text-gray-400 py-6">ยังไม่มีกอง กรอกชื่อกองด้านบนแล้วกด "เพิ่มกอง"</p>
      )}

      <div className="space-y-2">
        {depts.map(d => (
          <div key={d.id} className={`flex items-center justify-between bg-white rounded-xl border px-4 py-3 transition-colors ${
            editId === d.id ? 'border-blue-300 bg-blue-50/40' : 'border-gray-100'
          }`}>
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-lg leading-none shrink-0" title={departmentColor(d.color)?.label ?? 'ยังไม่ได้เลือกสี'}
                aria-label={`สี${departmentColor(d.color)?.label ?? ' ยังไม่ได้เลือก'}`}>
                {departmentColor(d.color)?.emoji ?? '⬜'}
              </span>
              <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800">{d.name}</p>
              {(d.short_name || d.code) && (
                <p className="text-[10px] text-gray-400">{d.short_name ? `${d.short_name} · ` : ''}{d.code}</p>
              )}
              </div>
            </div>
            <div className="flex gap-1">
              <button onClick={() => startEdit(d)} disabled={!!deleting}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
                <Pencil size={13} />
              </button>
              <button onClick={() => handleDelete(d)} disabled={!!deleting}
                className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors">
                {deleting === d.id
                  ? <div className="w-3 h-3 border-2 border-red-300 border-t-transparent rounded-full animate-spin" />
                  : <X size={13} />}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
