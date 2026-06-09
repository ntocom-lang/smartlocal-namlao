import { useState } from 'react'
import { Loader2, Save, CheckSquare, Square } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const ALL_MODULES = [
  {
    group: 'บริการประชาชน',
    items: [
      { key: 'inbox',      label: 'กล่องงาน',    desc: 'รับ-ส่งคำขอเอกสารจากประชาชน' },
      { key: 'docs',       label: 'เอกสาร',       desc: 'จัดการคำขอเอกสารราชการ' },
      { key: 'complaints', label: 'คำร้อง',        desc: 'ระบบรับเรื่องร้องเรียน' },
    ],
  },
  {
    group: 'งานภายใน',
    items: [
      { key: 'events',   label: 'กิจกรรม',  desc: 'ปฏิทินกิจกรรมของหน่วยงาน' },
      { key: 'approve',  label: 'อนุมัติ',   desc: 'คำขออนุมัติภายใน' },
      { key: 'projects', label: 'โครงการ',  desc: 'ติดตามโครงการก่อสร้าง' },
    ],
  },
  {
    group: 'ข้อมูลและรายงาน',
    items: [
      { key: 'docs-archive', label: 'คลังเอกสาร', desc: 'เก็บเอกสารดิจิทัลภายในองค์กร' },
      { key: 'map',          label: 'แผนที่',      desc: 'แผนที่โครงการและสถานที่' },
      { key: 'report',       label: 'รายงาน',     desc: 'สรุปสถิติและรายงาน' },
    ],
  },
]

const ALL_KEYS = ALL_MODULES.flatMap(g => g.items.map(m => m.key))

export default function ModuleManager({ tenant }) {
  const [enabled, setEnabled] = useState(tenant?.enabled_modules ?? ALL_KEYS)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)

  function toggle(key) {
    setEnabled(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    )
    setSaved(false)
  }

  async function save() {
    setSaving(true)
    await supabase
      .from('municipalities')
      .update({ enabled_modules: enabled })
      .eq('id', tenant.id)
    setSaving(false)
    setSaved(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-gray-700">จัดการโมดูล</h2>
          <p className="text-xs text-gray-400 mt-0.5">{enabled.length}/{ALL_KEYS.length} โมดูลเปิดใช้งาน</p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white transition-colors disabled:opacity-50"
          style={{ backgroundColor: saved ? '#10b981' : '#7c3aed' }}>
          {saving
            ? <Loader2 size={14} className="animate-spin" />
            : <Save size={14} />}
          {saved ? 'บันทึกแล้ว' : 'บันทึก'}
        </button>
      </div>

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
                  className="flex items-start gap-2.5 p-3 rounded-xl border text-left transition-all"
                  style={active
                    ? { backgroundColor: '#f5f3ff', borderColor: '#7c3aed' }
                    : { backgroundColor: '#f9fafb', borderColor: '#e5e7eb' }}>
                  {active
                    ? <CheckSquare size={16} className="text-purple-600 shrink-0 mt-0.5" />
                    : <Square size={16} className="text-gray-300 shrink-0 mt-0.5" />}
                  <div>
                    <p className={`text-xs font-bold ${active ? 'text-purple-700' : 'text-gray-500'}`}>{label}</p>
                    <p className="text-[10px] text-gray-400 leading-snug">{desc}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
