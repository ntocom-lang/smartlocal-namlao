import { useState, useEffect, useMemo } from 'react'
import { LayoutTemplate, Save, Loader2, CheckCircle2, Building2, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant, applyTheme } from '../../contexts/TenantContext'

// รายการ App Template ทั้ง 7 ธีมในระบบ (src/components/citizen/templates/)
// ควบคุมผ่านฟิลด์ municipalities.ui_style ไม่ผูกสีตายตัว ใช้ theme_color เดิมของแต่ละ อปท.
const PRESETS = [
  { key: 'eco_friendly',   id: 'eco_friendly',   name: 'EcoFriendly',   icon: '🟢', desc: 'เรียบง่าย สบายตา', color: null },
  { key: 'clean_minimal',  id: 'clean_minimal',  name: 'CleanMinimal',  icon: '⚪', desc: 'มินิมอล เรียบหรู', color: null },
  { key: 'wave_fluid',     id: 'wave_fluid',     name: 'WaveFluid',     icon: '🌊', desc: 'เส้นสายโค้งมน',   color: null },
  { key: 'civic_friendly', id: 'civic_friendly', name: 'CivicFriendly', icon: '🏛️', desc: 'ทางการ เข้าถึงง่าย', color: null },
  { key: 'smart_modern',   id: 'smart_modern',   name: 'SmartModern',   icon: '⚡', desc: 'โมเดิร์น ทันสมัย',  color: null },
  { key: 'kledkaew',       id: 'kledkaew',       name: 'Kledkaew',      icon: '🌿', desc: 'สดใส สนุกสนาน',    color: null },
  { key: 'service_hub',    id: 'service_hub',    name: 'ServiceHub',    icon: '🌾', desc: 'เน้นสถิติ/บริการ',  color: null },
]

export default function ThemeSettingsAdmin() {
  const { tenant, patchTenant } = useTenant()

  const [municipalities, setMunicipalities] = useState([])
  const [loadingMunis, setLoadingMunis] = useState(false)

  const currentUiStyle = tenant?.ui_style || 'eco_friendly'

  const [selectedKey, setSelectedKey] = useState(() =>
    PRESETS.find(p => p.id === currentUiStyle && (!p.color || p.color === tenant?.theme_color))?.key
    ?? PRESETS.find(p => p.id === currentUiStyle)?.key
    ?? 'eco_friendly'
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [activeMuniList, setActiveMuniList] = useState(null)

  // ดึงรายการ อปท. ทั้งหมดเพื่อนับและแสดงสถิติการใช้งาน
  useEffect(() => {
    setLoadingMunis(true)
    supabase.from('municipalities').select('id, name, slug, website_url, ui_style').order('name')
      .then(({ data }) => {
        if (data) setMunicipalities(data)
      })
      .finally(() => setLoadingMunis(false))
  }, [])

  // จัดกลุ่ม อปท. ตาม ui_style
  const usageByStyle = useMemo(() => {
    const map = {}
    PRESETS.forEach(p => { map[p.id] = [] })
    municipalities.forEach(m => {
      const style = m.ui_style || 'eco_friendly'
      if (!map[style]) map[style] = []
      map[style].push(m)
    })
    return map
  }, [municipalities])

  function getMuniUrl(m) {
    if (!m || !m.slug) return '/'
    const { hostname, protocol, port } = window.location
    const portSuffix = port ? `:${port}` : ''

    // เมื่ออยู่บน Custom Domain (เช่น namlao.rk-networks.com)
    if (!hostname.endsWith('.vercel.app') && hostname !== 'localhost' && hostname !== '127.0.0.1' && !hostname.match(/^\d/)) {
      const parts = hostname.split('.')
      if (parts.length >= 2) {
        const baseDomain = parts.slice(1).join('.')
        return `${protocol}//${m.slug}.${baseDomain}${portSuffix}/`
      }
    }

    // เมื่ออยู่บน Localhost หรือสภาพแวดล้อมอื่นๆ ให้ชี้ไปยังโดเมน Production หลัก (rk-networks.com) โดยตรง
    return `https://${m.slug}.rk-networks.com/`
  }

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

      // อัปเดต state รายการ อปท. ในหน้าจอทันที
      setMunicipalities(prev => prev.map(m => m.id === tenant.id ? { ...m, ui_style: preset.id } : m))
      flash()
    } catch (err) { alert('บันทึกไม่สำเร็จ: ' + err.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: 'var(--color-primary)', color: '#fff' }}>
            <LayoutTemplate size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-800">ธีมโครงสร้างแอป (App Template)</h1>
            <p className="text-sm text-gray-500">
              อปท. ปัจจุบัน: <strong className="text-gray-700">{tenant?.name || 'ไม่ระบุ'}</strong>
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <form onSubmit={saveSettings} className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
            {PRESETS.map(preset => {
              const active = selectedKey === preset.key
              const isCurrent = preset.id === currentUiStyle
              const munisUsing = usageByStyle[preset.id] || []

              return (
                <button key={preset.key} type="button" onClick={() => pick(preset)}
                  className="relative flex flex-col items-center p-3.5 rounded-2xl border-2 text-center transition-all group"
                  style={{
                    borderColor: active ? 'var(--color-primary)' : '#e5e7eb',
                    backgroundColor: active ? 'rgba(var(--color-primary-rgb,28,124,214),0.05)' : '#ffffff',
                  }}>
                  
                  {/* ป้ายบอกว่านี่คือธีมที่ใช้งานอยู่ในปัจจุบัน */}
                  {isCurrent && (
                    <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-green-100 text-green-700 border border-green-200 flex items-center gap-0.5 shadow-2xs">
                      <Check size={10} /> ใช้อยู่
                    </span>
                  )}

                  <span className="text-2xl mb-1.5 mt-1">{preset.icon}</span>
                  <p className="text-xs font-bold text-gray-800 leading-tight">
                    {preset.name}
                  </p>
                  <p className="text-[11px] text-gray-400 leading-tight mt-0.5">{preset.desc}</p>

                  {/* สถิติจำนวน อปท. ที่ใช้งาน */}
                  <div className="mt-3 pt-2.5 border-t border-gray-100 w-full flex flex-col items-center gap-1">
                    <span 
                      onClick={(e) => {
                        if (munisUsing.length > 0) {
                          e.stopPropagation()
                          setActiveMuniList({ name: preset.name, list: munisUsing })
                        }
                      }}
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 transition-all ${
                        munisUsing.length > 0 
                          ? 'bg-blue-50 text-blue-700 border border-blue-100 hover:bg-blue-100 cursor-pointer shadow-2xs' 
                          : 'bg-gray-50 text-gray-400'
                      }`}
                      title={munisUsing.length > 0 ? "คลิกเพื่อดูรายชื่อ อปท. ทั้งหมด" : ""}
                    >
                      <Building2 size={11} /> {munisUsing.length} อปท.
                    </span>

                    {/* รายชื่อ อปท. ที่ใช้งาน (คลิกดูเต็มได้) */}
                    {munisUsing.length > 0 && (
                      <div 
                        onClick={(e) => {
                          e.stopPropagation()
                          setActiveMuniList({ name: preset.name, list: munisUsing })
                        }}
                        className="text-[9px] text-gray-500 line-clamp-1 max-w-full px-1 hover:text-blue-600 hover:underline cursor-pointer transition-colors" 
                        title="คลิกเพื่อดูรายชื่อ อปท. ทั้งหมด"
                      >
                        {munisUsing.map(m => m.name).join(', ')}
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          <button type="submit" disabled={saving || !selectedKey}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 active:scale-95 transition-all shadow-sm"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : saved ? <CheckCircle2 size={15} /> : <Save size={15} />}
            {saved ? 'บันทึกสำเร็จ' : 'บันทึกรูปแบบ'}
          </button>
        </form>
      </div>

      {/* Modal แสดงรายชื่อ อปท. ทั้งหมดที่ใช้ธีมนี้ */}
      {activeMuniList && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-2xs"
          onClick={() => setActiveMuniList(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 border border-gray-100 space-y-4"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Building2 size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-800">อปท. ที่ใช้ธีม {activeMuniList.name}</h3>
                  <p className="text-[11px] text-gray-400">ทั้งหมด {activeMuniList.list.length} หน่วยงาน (คลิกเพื่อเปิดดูหน้าเว็บ)</p>
                </div>
              </div>
              <button onClick={() => setActiveMuniList(null)} 
                className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
                ✕
              </button>
            </div>

            <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
              {activeMuniList.list.map((m, idx) => {
                const targetHref = getMuniUrl(m)
                const isCurrentTenant = m.id === tenant?.id

                return (
                  <a
                    key={m.id}
                    href={targetHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 hover:bg-blue-50/70 border border-gray-100 hover:border-blue-200 text-xs text-gray-700 hover:text-blue-700 transition-all group"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 pr-2">
                      <span className="w-5 h-5 rounded-full bg-white border border-gray-200 group-hover:border-blue-300 text-gray-400 group-hover:text-blue-600 font-bold flex items-center justify-center text-[10px] shrink-0">
                        {idx + 1}
                      </span>
                      <span className="font-semibold truncate">{m.name}</span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {isCurrentTenant && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                          หน่วยงานนี้
                        </span>
                      )}
                      <span className="text-[10px] text-blue-500 font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                        เปิดเว็บ ↗
                      </span>
                    </div>
                  </a>
                )
              })}
            </div>

            <button onClick={() => setActiveMuniList(null)}
              className="w-full py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-700 transition-colors">
              ปิด
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
