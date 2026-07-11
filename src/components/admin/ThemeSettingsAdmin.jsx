import { useState } from 'react'
import { Palette, LayoutTemplate, Save, Loader2, CheckCircle2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'

const THEMES = [
  { id: 'blue',    name: 'น้ำเงินราชการ', color: '#1c7cd6' },
  { id: 'navy',    name: 'กรมท่าทหาร',    color: '#1e3a5f' },
  { id: 'sky',     name: 'ฟ้าสดใส',       color: '#0284c7' },
  { id: 'teal',    name: 'เขียวมรกต',     color: '#0d9488' },
  { id: 'cyan',    name: 'น้ำทะเล',       color: '#0e7490' },
  { id: 'green',   name: 'เขียวป่าไม้',   color: '#166534' },
  { id: 'emerald', name: 'เขียวอ่อน',     color: '#059669' },
  { id: 'purple',  name: 'ม่วงราชภัฏ',    color: '#7c3aed' },
  { id: 'indigo',  name: 'คราม',          color: '#4338ca' },
  { id: 'rose',    name: 'แดงกุหลาบ',     color: '#be185d' },
  { id: 'red',     name: 'แดงอิฐ',        color: '#b91c1c' },
  { id: 'orange',  name: 'ส้มสด',         color: '#c2410c' },
  { id: 'amber',   name: 'ทองเหลือง',     color: '#b45309' },
  { id: 'slate',   name: 'เทาราชการ',     color: '#475569' },
  { id: 'zinc',    name: 'เทาเข้ม',       color: '#52525b' },
]

const LAYOUTS = [
  {
    id: 'classic',
    name: 'Classic',
    desc: 'Banner → บริการ → แจ้งซ่อม → ทางลัด',
    bars: ['#94a3b8', '#0ea5e9', '#fbbf24', '#d1fae5', '#e0e7ff'],
  },
  {
    id: 'modern',
    name: 'Modern',
    desc: 'ทางลัด → Banner → บริการ → แจ้งซ่อม',
    bars: ['#e0e7ff', '#94a3b8', 'primary', '#d1fae5'],
  },
  {
    id: 'service_first',
    name: 'บริการก่อน',
    desc: 'บริการโต → แจ้งซ่อม → Banner → ทางลัด',
    bars: ['primary', '#d1fae5', '#94a3b8', '#e0e7ff'],
  },
  {
    id: 'news_first',
    name: 'ข่าวก่อน',
    desc: 'Banner → แจ้งซ่อม → ทางลัด → บริการ',
    bars: ['#94a3b8', '#d1fae5', '#e0e7ff', 'primary'],
  },
]

export default function ThemeSettingsAdmin() {
  const { tenant, patchTenant } = useTenant()

  const [themeColor, setThemeColor]   = useState(() => tenant?.theme_color   || '#1c7cd6')
  const [layoutTheme, setLayoutTheme] = useState(() => tenant?.layout_theme  || 'classic')
  const [colorSaving, setColorSaving] = useState(false)
  const [layoutSaving, setLayoutSaving] = useState(false)
  const [saved, setSaved] = useState(null)

  function flash(key) {
    setSaved(key)
    setTimeout(() => setSaved(null), 2500)
  }

  async function saveColor(e) {
    e.preventDefault()
    setColorSaving(true)
    try {
      const { error } = await supabase
        .from('municipalities').update({ theme_color: themeColor }).eq('id', tenant.id)
      if (error) throw error
      patchTenant({ theme_color: themeColor })
      const r = parseInt(themeColor.slice(1,3), 16)
      const g = parseInt(themeColor.slice(3,5), 16)
      const b = parseInt(themeColor.slice(5,7), 16)
      const dk = v => Math.max(0, Math.floor(v * 0.85)).toString(16).padStart(2, '0')
      document.documentElement.style.setProperty('--color-primary', themeColor)
      document.documentElement.style.setProperty('--color-primary-dark', `#${dk(r)}${dk(g)}${dk(b)}`)
      document.documentElement.style.setProperty('--color-primary-rgb', `${r}, ${g}, ${b}`)
      flash('color')
    } catch (err) {
      alert('บันทึกไม่สำเร็จ: ' + err.message)
    } finally {
      setColorSaving(false)
    }
  }

  async function saveLayout(e) {
    e.preventDefault()
    setLayoutSaving(true)
    try {
      const { error } = await supabase
        .from('municipalities').update({ layout_theme: layoutTheme }).eq('id', tenant.id)
      if (error) throw error
      patchTenant({ layout_theme: layoutTheme })
      flash('layout')
    } catch (err) {
      alert('บันทึกไม่สำเร็จ: ' + err.message)
    } finally {
      setLayoutSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: 'var(--color-primary)', color: '#fff' }}>
          <Palette size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-800">ธีมและรูปแบบ</h1>
          <p className="text-sm text-gray-500">ปรับสีและหน้าตาของระบบให้ต่างจากหน่วยงานอื่น</p>
        </div>
      </div>

      {/* ── ธีมสี ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
          <Palette size={15} /> ธีมสีระบบ
        </h2>
        <p className="text-xs text-gray-400 mb-5 leading-relaxed">
          สีหลักที่ใช้ทั่วทั้งระบบ — ปุ่ม, header gradient, active state · เปลี่ยนแล้วเห็นผลทันทีโดยไม่ต้อง reload
        </p>
        <form onSubmit={saveColor} className="space-y-4">
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
            {THEMES.map(t => {
              const active = themeColor === t.color
              return (
                <button key={t.id} type="button" onClick={() => setThemeColor(t.color)}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-xl border-2 transition-all"
                  style={{
                    borderColor: active ? t.color : 'transparent',
                    backgroundColor: active ? t.color + '12' : '#f9fafb',
                  }}>
                  <div className="w-full h-8 rounded-lg overflow-hidden relative"
                    style={{ background: `linear-gradient(135deg, #0a1628 0%, ${t.color} 60%, ${t.color}bb 100%)` }}>
                    <div className="absolute bottom-1 left-1.5 flex gap-0.5">
                      <div className="w-3 h-3 rounded-full bg-white/30" />
                      <div className="flex flex-col gap-0.5 justify-center">
                        <div className="w-6 h-0.5 rounded bg-white/60" />
                        <div className="w-4 h-0.5 rounded bg-white/40" />
                      </div>
                    </div>
                    {active && (
                      <div className="absolute top-1 right-1 w-3 h-3 rounded-full bg-white flex items-center justify-center">
                        <CheckCircle2 size={8} style={{ color: t.color }} />
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] font-medium text-gray-600 text-center leading-tight">{t.name}</span>
                </button>
              )
            })}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <label className="text-xs font-semibold text-gray-500 shrink-0">สีกำหนดเอง</label>
            <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-1.5">
              <input type="color" value={themeColor} onChange={e => setThemeColor(e.target.value)}
                className="w-7 h-7 rounded-lg border-0 cursor-pointer bg-transparent p-0" />
              <span className="text-xs font-mono text-gray-500">{themeColor.toUpperCase()}</span>
            </div>
          </div>

          <button type="submit" disabled={colorSaving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 active:scale-95 transition-all"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            {colorSaving ? <Loader2 size={15} className="animate-spin" /> : saved === 'color' ? <CheckCircle2 size={15} /> : <Save size={15} />}
            {saved === 'color' ? 'บันทึกสำเร็จ' : 'บันทึกสี'}
          </button>
        </form>
      </div>

      {/* ── รูปแบบหน้าแรก ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
          <LayoutTemplate size={15} /> รูปแบบหน้าแรก
        </h2>
        <p className="text-xs text-gray-400 mb-5 leading-relaxed">
          เลือกการจัดวาง sections ในหน้าแรก — แต่ละรูปแบบเรียงลำดับเนื้อหาต่างกัน
        </p>
        <form onSubmit={saveLayout} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {LAYOUTS.map(opt => {
              const active = layoutTheme === opt.id
              return (
                <button key={opt.id} type="button" onClick={() => setLayoutTheme(opt.id)}
                  className="flex flex-col gap-2 p-3 rounded-xl border-2 text-left transition-all"
                  style={{
                    borderColor: active ? 'var(--color-primary)' : '#e5e7eb',
                    backgroundColor: active ? 'rgba(var(--color-primary-rgb,28,124,214),0.06)' : '#fafafa',
                  }}>
                  {/* mini mockup */}
                  <div className="w-full bg-gray-100 rounded-lg p-2 flex gap-1.5">
                    <div className="flex flex-col gap-1 flex-1">
                      {opt.bars.map((bg, i) => (
                        <div key={i} className="rounded" style={{
                          height: i === 0 ? 10 : i === 2 ? 4 : 7,
                          background: bg === 'primary' ? 'var(--color-primary,#1c7cd6)' : bg,
                          borderRadius: 4,
                        }} />
                      ))}
                    </div>
                    <div className="flex flex-col gap-1 w-6">
                      {[8, 14, 6, 10].map((h, i) => (
                        <div key={i} className="rounded bg-gray-300" style={{ height: h, borderRadius: 3 }} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                      {active && <span style={{ color: 'var(--color-primary)' }}>✓</span>}
                      {opt.name}
                    </p>
                    <p className="text-[10px] text-gray-400 leading-relaxed mt-0.5">{opt.desc}</p>
                  </div>
                </button>
              )
            })}
          </div>

          <button type="submit" disabled={layoutSaving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 active:scale-95 transition-all"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            {layoutSaving ? <Loader2 size={15} className="animate-spin" /> : saved === 'layout' ? <CheckCircle2 size={15} /> : <Save size={15} />}
            {saved === 'layout' ? 'บันทึกสำเร็จ' : 'บันทึกรูปแบบ'}
          </button>
        </form>
      </div>

    </div>
  )
}
