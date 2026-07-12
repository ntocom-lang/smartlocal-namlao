import { useState } from 'react'
import { LayoutTemplate, Save, Loader2, CheckCircle2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant, applyTheme } from '../../contexts/TenantContext'

export default function ThemeSettingsAdmin() {
  const { tenant, patchTenant } = useTenant()

  const [uiStyle, setUiStyle] = useState(() => tenant?.ui_style || 'default')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  function flash() { setSaved(true); setTimeout(() => setSaved(false), 2500) }

  async function saveSettings(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const { error } = await supabase
        .from('municipalities').update({ ui_style: uiStyle }).eq('id', tenant.id)
      if (error) throw error
      
      patchTenant({ ui_style: uiStyle })
      applyTheme(tenant?.theme_color || '#1c7cd6', uiStyle)
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
            {[
              { id: 'eco_friendly', name: 'NamlaoTheme', icon: '🟢', desc: 'เรียบง่าย สบายตา' },
              { id: 'kledkaew', name: 'Theme2', icon: '🦕', desc: 'สดใส สนุกสนาน' }
            ].map(style => {
              const active = uiStyle === style.id
              return (
                <button key={style.id} type="button" onClick={() => {
                  setUiStyle(style.id)
                  applyTheme(tenant?.theme_color || '#1c7cd6', style.id)
                }}
                  className="flex flex-col items-center gap-2 p-3 rounded-xl border-2 text-center transition-all"
                  style={{
                    borderColor: active ? 'var(--color-primary)' : '#e5e7eb',
                    backgroundColor: active ? 'rgba(var(--color-primary-rgb,28,124,214),0.06)' : '#fafafa',
                  }}>
                  <span className="text-xl mb-1">{style.icon}</span>
                  <p className="text-xs font-bold text-gray-700 leading-tight">
                    {style.name}
                  </p>
                  <p className="text-[10px] text-gray-400 leading-tight">{style.desc}</p>
                </button>
              )
            })}
          </div>

          <button type="submit" disabled={saving}
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
