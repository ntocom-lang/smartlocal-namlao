import { useState, useEffect } from 'react'
import { Loader2, Save, CheckSquare, Square, CheckCircle2, AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import { MODULE_GROUPS, MANAGED_MODULE_KEYS } from '../../lib/staffModules'

// รายการโมดูลย้ายไปเป็นแหล่งความจริงร่วมกับ StaffDashboard แล้ว (src/lib/staffModules.js)
// เดิมสองไฟล์ถือลิสต์คนละชุด ทำให้ติ๊กปิดบางโมดูลแล้วเมนูฝั่งเจ้าหน้าที่ไม่หายจริง
const ALL_MODULES = MODULE_GROUPS
const ALL_KEYS = MANAGED_MODULE_KEYS

export default function ModuleManager({ tenant }) {
  const { patchTenant } = useTenant()
  const [enabled, setEnabled] = useState(() => tenant?.enabled_modules ?? ALL_KEYS)
  const [saving, setSaving]   = useState(false)
  const [status, setStatus]   = useState(null) // 'saved' | 'error'
  const [dirty, setDirty]     = useState(false)

  // sync ถ้า tenant โหลดช้าหรือเปลี่ยน
  useEffect(() => {
    if (tenant?.enabled_modules != null) {
      setEnabled(tenant.enabled_modules)
      setDirty(false)
    }
  }, [tenant?.id, tenant?.enabled_modules])

  function toggle(key) {
    setEnabled(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    )
    setDirty(true)
    setStatus(null)
  }

  // "เปิด/ปิดทั้งหมด" ต้องแตะเฉพาะคีย์ที่หน้านี้แสดงจริง — คีย์อื่นที่อยู่ใน enabled_modules
  // (ของเก่าอย่าง map/docs-archive หรือโมดูลใหม่ที่ยังไม่ได้เพิ่มเข้าหน้านี้) ต้องคงไว้เสมอ
  // ของเดิม setEnabled(allOn ? [] : ALL_KEYS) เขียนทับทั้ง array ทำให้คีย์ที่หน้านี้ไม่รู้จัก
  // หายจาก DB เงียบๆ ทุกครั้งที่กดปุ่มนี้ — ไม่มีใครเห็นผลจนกว่าจะมีคนเอาคีย์นั้นไปใช้กรองเมนู
  function toggleAll() {
    const allOn = ALL_KEYS.every(k => enabled.includes(k))
    const untouched = enabled.filter(k => !ALL_KEYS.includes(k))
    setEnabled(allOn ? untouched : [...untouched, ...ALL_KEYS])
    setDirty(true)
    setStatus(null)
  }

  async function save() {
    setSaving(true)
    setStatus(null)
    const { error } = await supabase
      .from('municipalities')
      .update({ enabled_modules: enabled })
      .eq('id', tenant.id)
    setSaving(false)
    if (error) {
      setStatus('error')
    } else {
      patchTenant({ enabled_modules: enabled })
      setDirty(false)
      setStatus('saved')
      setTimeout(() => setStatus(null), 2500)
    }
  }

  const allOn = ALL_KEYS.every(k => enabled.includes(k))

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-gray-700">จัดการโมดูล</h2>
          {/* นับเฉพาะคีย์ที่หน้านี้แสดง ไม่งั้นตัวเลขจะเกินตัวหารเมื่อ DB มีคีย์เก่าที่หน้านี้ไม่รู้จักปนอยู่ */}
          <p className="text-xs text-gray-400 mt-0.5">
            {enabled.filter(k => ALL_KEYS.includes(k)).length}/{ALL_KEYS.length} โมดูลเปิดใช้งาน
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleAll}
            className="text-xs px-3 py-1.5 rounded-xl border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 transition-colors font-medium">
            {allOn ? 'ปิดทั้งหมด' : 'เปิดทั้งหมด'}
          </button>
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40"
            style={{ backgroundColor: status === 'saved' ? '#10b981' : status === 'error' ? '#ef4444' : '#7c3aed' }}>
            {saving
              ? <Loader2 size={14} className="animate-spin" />
              : status === 'saved'
                ? <CheckCircle2 size={14} />
                : status === 'error'
                  ? <AlertCircle size={14} />
                  : <Save size={14} />}
            {saving ? 'กำลังบันทึก...' : status === 'saved' ? 'บันทึกแล้ว' : status === 'error' ? 'เกิดข้อผิดพลาด' : 'บันทึก'}
          </button>
        </div>
      </div>

      {status === 'error' && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          <AlertCircle size={15} className="shrink-0" />
          บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง
        </div>
      )}

      {ALL_MODULES.map(({ group, items }) => (
        <div key={group} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-3">{group}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {items.map(({ key, label, desc }) => {
              const active = enabled.includes(key)
              return (
                <button
                  key={key}
                  onClick={() => toggle(key)}
                  className="flex items-start gap-2.5 p-3 rounded-xl border text-left transition-all active:scale-95"
                  style={active
                    ? { backgroundColor: '#f5f3ff', borderColor: '#7c3aed' }
                    : { backgroundColor: '#f9fafb', borderColor: '#e5e7eb' }}>
                  {active
                    ? <CheckSquare size={16} className="text-purple-600 shrink-0 mt-0.5" />
                    : <Square size={16} className="text-gray-300 shrink-0 mt-0.5" />}
                  <div>
                    <p className={`text-xs font-bold ${active ? 'text-purple-700' : 'text-gray-500'}`}>{label}</p>
                    <p className="text-[10px] text-gray-400 leading-snug mt-0.5">{desc}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {dirty && (
        <p className="text-center text-xs text-amber-600 font-medium">
          มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก
        </p>
      )}
    </div>
  )
}
