import { useState, useEffect } from 'react'
import { Loader2, Save, CheckSquare, Square, CheckCircle2, AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'

const ALL_MODULES = [
  {
    group: 'บริการประชาชน',
    items: [
      { key: 'complaints', label: 'คำร้อง',        desc: 'ระบบรับเรื่องร้องเรียน' },
      { key: 'docs',       label: 'เอกสาร',         desc: 'จัดการคำขอเอกสารราชการ' },
      { key: 'inbox',      label: 'กล่องงาน',       desc: 'รับ-ส่งคำขอเอกสารจากประชาชน' },
    ],
  },
  {
    group: 'งานภายใน',
    items: [
      { key: 'events',   label: 'กิจกรรม',  desc: 'ปฏิทินกิจกรรมของหน่วยงาน' },
      { key: 'approve',  label: 'อนุมัติ',   desc: 'คำขออนุมัติภายใน' },
      { key: 'projects', label: 'โครงการ',   desc: 'ติดตามโครงการก่อสร้าง' },
    ],
  },
  {
    group: 'ข้อมูลและรายงาน',
    items: [
      { key: 'map',          label: 'แผนที่',      desc: 'แผนที่โครงการและสถานที่' },
      { key: 'report',       label: 'รายงาน',      desc: 'สรุปสถิติและรายงาน' },
    ],
  },
  {
    group: 'เนื้อหาและชุมชน',
    items: [
      { key: 'tourism',           label: 'เที่ยว กิน พัก ชอบ', desc: 'จัดการสถานที่ท่องเที่ยว ร้านค้า ที่พัก' },
      { key: 'tourism-reviews',   label: 'รีวิวสถานที่',        desc: 'ตรวจสอบและลบรีวิวที่ไม่เหมาะสม' },
      { key: 'business-register', label: 'ลงทะเบียนธุรกิจ',    desc: 'อนุมัติ/จัดการคำขอลงทะเบียนธุรกิจ' },
    ],
  },
]

const ALL_KEYS = ALL_MODULES.flatMap(g => g.items.map(m => m.key))

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

  function toggleAll() {
    const allOn = ALL_KEYS.every(k => enabled.includes(k))
    setEnabled(allOn ? [] : ALL_KEYS)
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
          <p className="text-xs text-gray-400 mt-0.5">{enabled.length}/{ALL_KEYS.length} โมดูลเปิดใช้งาน</p>
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
