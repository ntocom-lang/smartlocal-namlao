import { useState } from 'react'
import { LayoutTemplate, Save, Loader2, CheckCircle2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant, applyTheme } from '../../contexts/TenantContext'

// thungkaew-Theme (ui_style: 'service_hub') คือเทมเพลตที่สร้างให้ทุ่งแค้วโดยเฉพาะ เลียนแบบโครงสร้าง
// ธีมคู่แข่งที่ส่งภาพมาอ้างอิง — ไม่ผูกสีตายตัว ใช้ theme_color เดิมของแต่ละ อปท. เอง
// (เดิมเคยมี preset "thungkaew-Theme" อีกตัวที่เป็นโครง NamlaoTheme+สีเขียว แยกกับตัวนี้ ทำให้สับสนว่า
// มี 2 ธีมชื่อทุ่งแค้ว — รวมเหลือตัวเดียวแล้วตามที่ตกลงกัน)
const PRESETS = [
  { key: 'namlao',    id: 'eco_friendly', name: 'NamlaoTheme',     icon: '🟢', desc: 'เรียบง่าย สบายตา', color: null },
  { key: 'theme2',    id: 'kledkaew',     name: 'Kledkaew',        icon: '🌿', desc: 'สดใส สนุกสนาน',    color: null },
  { key: 'servicehub', id: 'service_hub', name: 'thungkaew-Theme', icon: '🌾', desc: 'เน้นสถิติ/บริการ',  color: null },
]

export default function ThemeSettingsAdmin() {
  const { tenant, patchTenant } = useTenant()

  const [selectedKey, setSelectedKey] = useState(() =>
    PRESETS.find(p => p.id === tenant?.ui_style && (!p.color || p.color === tenant?.theme_color))?.key
    ?? PRESETS.find(p => p.id === tenant?.ui_style)?.key
    ?? null
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  function flash() { setSaved(true); setTimeout(() => setSaved(false), 2500) }

  function pick(preset) {
    setSelectedKey(preset.key)
    applyTheme(preset.color || tenant?.theme_color || '#1c7cd6', preset.id)
  }

  async function saveSettings(e) {
    e.preventDefault()
    const preset = PRESETS.find(p => p.key === selectedKey)
    if (!preset) return
    setSaving(true)
    try {
      const payload = preset.color
        ? { ui_style: preset.id, theme_color: preset.color }
        : { ui_style: preset.id }
      const { error } = await supabase
        .from('municipalities').update(payload).eq('id', tenant.id)
      if (error) throw error

      patchTenant(payload)
      applyTheme(payload.theme_color || tenant?.theme_color || '#1c7cd6', preset.id)
      flash()
    } catch (err) { alert('บันทึกไม่สำเร็จ: ' + err.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: 'var(--color-primary)', color: '#fff' }}>
          <LayoutTemplate size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-800">ธีมโครงสร้างแอป (App Template)</h1>
          <p className="text-sm text-gray-500">เลือกโครงสร้างและดีไซน์หลักของระบบ</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <form onSubmit={saveSettings} className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {PRESETS.map(preset => {
              const active = selectedKey === preset.key
              return (
                <button key={preset.key} type="button" onClick={() => pick(preset)}
                  className="flex flex-col items-center gap-2 p-3 rounded-xl border-2 text-center transition-all"
                  style={{
                    borderColor: active ? 'var(--color-primary)' : '#e5e7eb',
                    backgroundColor: active ? 'rgba(var(--color-primary-rgb,28,124,214),0.06)' : '#fafafa',
                  }}>
                  <span className="text-xl mb-1">{preset.icon}</span>
                  <p className="text-xs font-bold text-gray-700 leading-tight">
                    {preset.name}
                  </p>
                  <p className="text-[10px] text-gray-400 leading-tight">{preset.desc}</p>
                </button>
              )
            })}
          </div>

          <button type="submit" disabled={saving || !selectedKey}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 active:scale-95 transition-all"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : saved ? <CheckCircle2 size={15} /> : <Save size={15} />}
            {saved ? 'บันทึกสำเร็จ' : 'บันทึกรูปแบบ'}
          </button>
        </form>
      </div>
    </div>
  )
}
