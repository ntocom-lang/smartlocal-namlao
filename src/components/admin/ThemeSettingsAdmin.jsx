import { useState } from 'react'
import { Palette, LayoutTemplate, Save, Loader2, CheckCircle2, Plus, Trash2, Star } from 'lucide-react'
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

function applyColorToDOM(hex) {
  const r = parseInt(hex.slice(1,3), 16)
  const g = parseInt(hex.slice(3,5), 16)
  const b = parseInt(hex.slice(5,7), 16)
  const dk = v => Math.max(0, Math.floor(v * 0.85)).toString(16).padStart(2, '0')
  document.documentElement.style.setProperty('--color-primary', hex)
  document.documentElement.style.setProperty('--color-primary-dark', `#${dk(r)}${dk(g)}${dk(b)}`)
  document.documentElement.style.setProperty('--color-primary-rgb', `${r}, ${g}, ${b}`)
}

function LayoutMiniPreview({ bars, color }) {
  return (
    <div className="w-full bg-gray-100 rounded-lg p-2 flex gap-1.5">
      <div className="flex flex-col gap-1 flex-1">
        {bars.map((bg, i) => (
          <div key={i} className="rounded" style={{
            height: i === 0 ? 10 : i === 2 ? 4 : 7,
            background: bg === 'primary' ? (color || 'var(--color-primary,#1c7cd6)') : bg,
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
  )
}

export default function ThemeSettingsAdmin() {
  const { tenant, patchTenant } = useTenant()

  const [themeColor,   setThemeColor]   = useState(() => tenant?.theme_color   || '#1c7cd6')
  const [layoutTheme,  setLayoutTheme]  = useState(() => tenant?.layout_theme  || 'classic')
  const [showPosts,    setShowPosts]    = useState(() => tenant?.show_posts_highlight !== false)
  const [presets,      setPresets]      = useState(() => tenant?.theme_presets || [])
  const [colorSaving,  setColorSaving]  = useState(false)
  const [layoutSaving, setLayoutSaving] = useState(false)
  const [presetName,   setPresetName]   = useState('')
  const [presetSaving, setPresetSaving] = useState(false)
  const [applying,     setApplying]     = useState(null)
  const [deleting,     setDeleting]     = useState(null)
  const [saved,        setSaved]        = useState(null)
  const [activePresetId, setActivePresetId] = useState(() => {
    try { return localStorage.getItem(`sl_active_preset_${tenant?.id}`) } catch { return null }
  })

  function flash(key) { setSaved(key); setTimeout(() => setSaved(null), 2500) }

  async function saveColor(e) {
    e.preventDefault()
    setColorSaving(true)
    try {
      // ถ้ามี preset active อยู่ → อัปเดตสีใน preset นั้นด้วย
      let updatedPresets = presets
      if (activePresetId) {
        updatedPresets = presets.map(p =>
          String(p.id) === activePresetId ? { ...p, color: themeColor } : p
        )
      }
      const updatePayload = { theme_color: themeColor }
      if (activePresetId) updatePayload.theme_presets = updatedPresets

      const { error } = await supabase
        .from('municipalities').update(updatePayload).eq('id', tenant.id)
      if (error) throw error
      if (activePresetId) {
        setPresets(updatedPresets)
        patchTenant({ theme_color: themeColor, theme_presets: updatedPresets })
      } else {
        patchTenant({ theme_color: themeColor })
      }
      applyColorToDOM(themeColor)
      flash('color')
    } catch (err) { alert('บันทึกไม่สำเร็จ: ' + err.message) }
    finally { setColorSaving(false) }
  }

  async function saveLayout(e) {
    e.preventDefault()
    setLayoutSaving(true)
    try {
      // ถ้ามี preset active อยู่ → อัปเดต layout + showPosts ใน preset นั้นด้วย
      let updatedPresets = presets
      if (activePresetId) {
        updatedPresets = presets.map(p =>
          String(p.id) === activePresetId ? { ...p, layout: layoutTheme, showPosts } : p
        )
      }
      const updatePayload = { layout_theme: layoutTheme, show_posts_highlight: showPosts }
      if (activePresetId) updatePayload.theme_presets = updatedPresets

      const { error } = await supabase
        .from('municipalities').update(updatePayload).eq('id', tenant.id)
      if (error) throw error
      if (activePresetId) {
        setPresets(updatedPresets)
        patchTenant({ layout_theme: layoutTheme, show_posts_highlight: showPosts, theme_presets: updatedPresets })
      } else {
        patchTenant({ layout_theme: layoutTheme, show_posts_highlight: showPosts })
      }
      flash('layout')
    } catch (err) { alert('บันทึกไม่สำเร็จ: ' + err.message) }
    finally { setLayoutSaving(false) }
  }

  async function savePreset(e) {
    e.preventDefault()
    const name = presetName.trim()
    if (!name) return
    setPresetSaving(true)
    try {
      const newPreset = { id: Date.now(), name, color: themeColor, layout: layoutTheme, showPosts }
      const next = [...presets, newPreset]
      const { error } = await supabase
        .from('municipalities').update({ theme_presets: next }).eq('id', tenant.id)
      if (error) throw error
      setPresets(next)
      patchTenant({ theme_presets: next })
      setPresetName('')
      flash('preset-save')
    } catch (err) { alert('บันทึกไม่สำเร็จ: ' + err.message) }
    finally { setPresetSaving(false) }
  }

  async function applyPreset(preset) {
    setApplying(preset.id)
    try {
      // ถ้า preset มี showPosts อย่างชัดเจน → ใช้ค่านั้น, ถ้าไม่มี → คงค่าเดิมของหน่วยงาน
      const hasShowPosts = 'showPosts' in preset
      const presetShowPosts = hasShowPosts ? preset.showPosts : showPosts

      const updatePayload = { theme_color: preset.color, layout_theme: preset.layout }
      if (hasShowPosts) updatePayload.show_posts_highlight = presetShowPosts

      const { error } = await supabase
        .from('municipalities')
        .update(updatePayload)
        .eq('id', tenant.id)
      if (error) throw error
      setThemeColor(preset.color)
      setLayoutTheme(preset.layout)
      setShowPosts(presetShowPosts)
      patchTenant({ theme_color: preset.color, layout_theme: preset.layout, ...(hasShowPosts ? { show_posts_highlight: presetShowPosts } : {}) })
      applyColorToDOM(preset.color)
      try { localStorage.setItem(`sl_active_preset_${tenant.id}`, String(preset.id)) } catch {}
      setActivePresetId(String(preset.id))
      flash('apply-' + preset.id)
    } catch (err) { alert('ใช้ธีมไม่สำเร็จ: ' + err.message) }
    finally { setApplying(null) }
  }


  async function deletePreset(id) {
    setDeleting(id)
    try {
      const next = presets.filter(p => p.id !== id)
      const { error } = await supabase
        .from('municipalities').update({ theme_presets: next }).eq('id', tenant.id)
      if (error) throw error
      setPresets(next)
      patchTenant({ theme_presets: next })
    } catch (err) { alert('ลบไม่สำเร็จ: ' + err.message) }
    finally { setDeleting(null) }
  }

  const currentLayoutData = LAYOUTS.find(l => l.id === layoutTheme) || LAYOUTS[0]

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

      {/* ── Preset ที่บันทึกไว้ ── */}
      {presets.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
            <Star size={15} /> ธีมที่บันทึกไว้
          </h2>
          <div className="space-y-2">
            {presets.map(p => {
              const layoutData = LAYOUTS.find(l => l.id === p.layout) || LAYOUTS[0]
              const isActive = activePresetId === String(p.id)
              const isApplying = applying === p.id
              const justApplied = saved === 'apply-' + p.id
              return (
                <div key={p.id}
                  className="flex items-center gap-3 p-3 rounded-xl border transition-all"
                  style={{
                    borderColor: isActive ? p.color : '#f3f4f6',
                    backgroundColor: isActive ? p.color + '08' : '#fafafa',
                  }}>
                  {/* color dot */}
                  <div className="w-8 h-8 rounded-lg shrink-0 shadow-sm border border-white/60"
                    style={{ background: `linear-gradient(135deg, #0a1628 0%, ${p.color} 100%)` }} />
                  {/* info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-800 truncate">{p.name}</p>
                    <p className="text-[11px] text-gray-400">{layoutData.name} · {p.color.toUpperCase()}</p>
                  </div>
                  {/* actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isActive && !justApplied && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
                        style={{ backgroundColor: p.color }}>ใช้งานอยู่</span>
                    )}
                    {!isActive && (
                      <button onClick={() => applyPreset(p)} disabled={!!applying}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-all disabled:opacity-50"
                        style={{ backgroundColor: p.color }}>
                        {isApplying ? <Loader2 size={12} className="animate-spin" /> : justApplied ? <CheckCircle2 size={12} /> : null}
                        {justApplied ? 'ใช้แล้ว' : 'ใช้ธีมนี้'}
                      </button>
                    )}
                    <button onClick={() => deletePreset(p.id)} disabled={deleting === p.id}
                      className="p-1.5 rounded-lg text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors">
                      {deleting === p.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── ธีมสี ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
          <Palette size={15} /> ธีมสีระบบ
        </h2>
        <p className="text-xs text-gray-400 mb-5 leading-relaxed">
          สีหลักที่ใช้ทั่วทั้งระบบ — เปลี่ยนแล้วเห็นผลทันทีโดยไม่ต้อง reload
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
                  <LayoutMiniPreview bars={opt.bars} color={themeColor} />
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
          {/* toggle show posts */}
          <label className="flex items-center gap-3 cursor-pointer select-none py-1">
            <div onClick={() => setShowPosts(v => !v)}
              className="relative w-10 h-5.5 rounded-full transition-colors shrink-0"
              style={{ backgroundColor: showPosts ? 'var(--color-primary)' : '#d1d5db', height: 22 }}>
              <div className="absolute top-0.5 w-4.5 h-4.5 bg-white rounded-full shadow transition-all"
                style={{ width: 18, height: 18, left: showPosts ? 'calc(100% - 20px)' : 2 }} />
            </div>
            <span className="text-sm text-gray-700 font-medium">แสดงข่าวสำคัญและกิจกรรมในหน้าแรก</span>
          </label>

          <button type="submit" disabled={layoutSaving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 active:scale-95 transition-all"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            {layoutSaving ? <Loader2 size={15} className="animate-spin" /> : saved === 'layout' ? <CheckCircle2 size={15} /> : <Save size={15} />}
            {saved === 'layout' ? 'บันทึกสำเร็จ' : 'บันทึกรูปแบบ'}
          </button>
        </form>
      </div>

      {/* ── บันทึกเป็น Preset ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
          <Plus size={15} /> บันทึกการตั้งค่านี้เป็นธีม
        </h2>
        <p className="text-xs text-gray-400 mb-4 leading-relaxed">
          บันทึกสีและรูปแบบที่เลือกอยู่ตอนนี้เป็น preset ตั้งชื่อไว้ — เรียกใช้ได้ทันทีในอนาคต
        </p>

        {/* Preview ของ preset ที่จะบันทึก */}
        <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100 mb-4">
          <div className="w-8 h-8 rounded-lg shrink-0 shadow-sm"
            style={{ background: `linear-gradient(135deg, #0a1628 0%, ${themeColor} 100%)` }} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-gray-700">{currentLayoutData.name}</p>
            <p className="text-[11px] text-gray-400">{themeColor.toUpperCase()}</p>
          </div>
          <div className="w-28 shrink-0">
            <LayoutMiniPreview bars={currentLayoutData.bars} color={themeColor} />
          </div>
        </div>

        <form onSubmit={savePreset} className="flex gap-2">
          <input
            type="text"
            value={presetName}
            onChange={e => setPresetName(e.target.value)}
            placeholder="ตั้งชื่อธีม เช่น ธีม แบบที่ 1"
            maxLength={40}
            className="flex-1 px-4 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 transition-all"
          />
          <button type="submit" disabled={presetSaving || !presetName.trim()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40 active:scale-95 transition-all shrink-0"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            {presetSaving ? <Loader2 size={15} className="animate-spin" /> : saved === 'preset-save' ? <CheckCircle2 size={15} /> : <Plus size={15} />}
            {saved === 'preset-save' ? 'บันทึกแล้ว' : 'บันทึก'}
          </button>
        </form>
      </div>

    </div>
  )
}
