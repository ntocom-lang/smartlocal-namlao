import { lazy, Suspense, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { LayoutGrid, MapPin, Plus, Bell, ArrowLeft, PanelLeftOpen, PanelLeftClose, Tags, ChevronRight, Activity, Cpu, ShieldCheck, Sun, Moon, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import DataCenter3DCanvas from '../components/datacenter/DataCenter3DCanvas'

const DataCenterOverview = lazy(() => import('../components/datacenter/DataCenterOverview'))
const DataCenterMap = lazy(() => import('../components/datacenter/DataCenterMap'))
const DataCenterEntryForm = lazy(() => import('../components/datacenter/DataCenterEntryForm'))
const DataCenterCategoryManager = lazy(() => import('../components/datacenter/DataCenterCategoryManager'))

const BASE_MODULES = [
  { key: 'overview', label: 'ภาพรวมระบบ',   Icon: LayoutGrid },
  { key: 'map',      label: 'แผนที่ GIS',    Icon: MapPin },
  { key: 'add',      label: 'บันทึกข้อมูลใหม่', Icon: Plus },
]
const CATEGORY_MANAGER_MODULE = { key: 'categories', label: 'จัดการหมวดหมู่', Icon: Tags }

export default function DataCenterDashboard() {
  const navigate = useNavigate()
  const { tenant } = useTenant()
  const [profile, setProfile] = useState(null)
  const [activeModule, setActiveModule] = useState('overview')
  const [refreshKey, setRefreshKey] = useState(0)
  const [prefillGroup, setPrefillGroup] = useState(null)
  const [prefillCategory, setPrefillCategory] = useState(null)
  const [editingEntry, setEditingEntry] = useState(null)
  const [mapSidebarOpen, setMapSidebarOpen] = useState(false)
  const sidebarHidden = activeModule === 'map' && !mapSidebarOpen
  const [categoryTree, setCategoryTree] = useState([])
  const [sidebarFilter, setSidebarFilter] = useState({ group: null, category: null })
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set())
  const [theme, setTheme] = useState('light') // Default to Light Mode per user request
  // ทรี "หมวดหมู่ข้อมูล" อยู่ใน sidebar ฝั่ง desktop เท่านั้น (hidden md:flex) — มือถือไม่มีทางเปลี่ยนหมวดเลย
  // ต้องมี bottom sheet แยกให้กดเลือกหมวด/ประเภทย่อยแบบเดียวกับเมนูซ้าย
  const [showMobileCategorySheet, setShowMobileCategorySheet] = useState(false)
  // ปุ่ม "ดูบนแผนที่" จากรายการ — เก็บกลุ่ม/ประเภท+พิกัดของรายการที่กดไว้ ส่งต่อให้ DataCenterMap ไปกรอง+
  // pan กล้องไปที่จุดนั้นให้เลย (ไม่ต้องให้ผู้ใช้ไปกรองหมวดเองซ้ำอีกรอบบนแผนที่)
  const [mapFocus, setMapFocus] = useState(null)

  const isLight = theme === 'light'

  function toggleGroupExpand(group) {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      next.has(group) ? next.delete(group) : next.add(group)
      return next
    })
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { navigate('/auth', { state: { from: '/data-center' } }); return }
      supabase.from('profiles').select('*').eq('id', data.session.user.id).single()
        .then(({ data: p }) => setProfile(p))
    })
  }, [navigate])

  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('data_center_entries').select('group_name, category, status').eq('municipality_id', tenant.id)
      .then(({ data }) => {
        const groupMap = new Map()
        for (const row of (data ?? []).filter(r => r.status !== 'archived')) {
          if (!groupMap.has(row.group_name)) groupMap.set(row.group_name, { total: 0, categories: new Map() })
          const g = groupMap.get(row.group_name)
          g.total += 1
          g.categories.set(row.category, (g.categories.get(row.category) ?? 0) + 1)
        }
        const tree = Array.from(groupMap.entries())
          .map(([group, { total, categories }]) => ({
            group, total,
            categories: Array.from(categories.entries())
              .map(([category, count]) => ({ category, count }))
              .sort((a, b) => a.category.localeCompare(b.category, 'th')),
          }))
          .sort((a, b) => a.group.localeCompare(b.group, 'th'))
        setCategoryTree(tree)
      })
  }, [tenant?.id, refreshKey])

  function goToCategory(group, category) {
    setSidebarFilter({ group: group ?? null, category: category ?? null })
    setActiveModule('overview')
  }

  function goToAddEntry(group, category) {
    setPrefillGroup(group ?? null)
    setPrefillCategory(category ?? null)
    setActiveModule('add')
  }

  // ปุ่ม "ดูบนแผนที่" จากรายการใน Overview — เด้งไปแท็บแผนที่พร้อมกรองเฉพาะกลุ่ม/ประเภทของรายการนั้น
  // และ pan กล้องไปที่พิกัดจริงให้เลย (data_center_entries บังคับมี lat/lng เสมอ ต่อให้เป็นเส้นทางก็มีจุดอ้างอิง)
  function goToMapFocus(entry) {
    setMapFocus({
      group: entry.group_name ?? null,
      category: entry.category ?? null,
      lat: entry.latitude != null ? Number(entry.latitude) : null,
      lng: entry.longitude != null ? Number(entry.longitude) : null,
    })
    setActiveModule('map')
  }

  function handleSaved() {
    setRefreshKey(k => k + 1)
    setPrefillGroup(null)
    setPrefillCategory(null)
    setEditingEntry(null)
    setActiveModule('overview')
  }

  function handleBackToStaff() {
    navigate('/staff')
  }

  function canManageEntry(entry) {
    if (!entry || !profile) return false
    if (profile.role === 'admin' || profile.role === 'superadmin') return true
    if (profile.role === 'officer') {
      return !!profile.department_id && entry.department_id === profile.department_id
    }
    return ['staff', 'technician'].includes(profile.role) && entry.created_by === profile.id
  }

  function handleEditEntry(entry) {
    if (!canManageEntry(entry)) {
      window.alert('รายการนี้เป็นของกองอื่นหรือผู้สร้างรายอื่น คุณเปิดดูบนแผนที่ได้แต่แก้ไขไม่ได้')
      return
    }
    setEditingEntry(entry)
    setActiveModule('add')
  }

  const isMapModule = activeModule === 'map'
  const isManager = profile?.role === 'admin' || profile?.role === 'superadmin'
  const MODULES = isManager ? [...BASE_MODULES, CATEGORY_MANAGER_MODULE] : BASE_MODULES

  return (
    <div className={isMapModule ? (isLight ? 'min-h-screen flex flex-col bg-[#eef4f9]' : 'min-h-screen flex flex-col bg-[#070a12]') : (isLight ? 'min-h-full bg-[#f0f4f8] text-slate-800' : 'min-h-full bg-[#070a12] text-slate-100')}>
      {/* Mobile Cyber Header */}
      <header className={`md:hidden px-4 pt-3 pb-3 relative overflow-hidden shrink-0 border-b ${isLight ? 'bg-gradient-to-r from-sky-900 via-indigo-900 to-slate-900 text-white border-cyan-400/30' : 'bg-gradient-to-b from-slate-900 to-[#070a12] text-white border-cyan-500/20'}`}>
        <div className="absolute inset-0 opacity-40 pointer-events-none">
          <DataCenter3DCanvas height="100%" theme={theme} />
        </div>
        <div className="flex items-center gap-3 relative z-10">
          <button onClick={handleBackToStaff} aria-label="กลับหน้าเจ้าหน้าที่" className="shrink-0 active:scale-95 transition-transform">
            <div className="w-10 h-10 rounded-xl border border-cyan-400/40 bg-slate-900/80 text-cyan-300 flex items-center justify-center shadow-lg shadow-cyan-500/10">
              <ArrowLeft size={18} />
            </div>
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
              <p className="font-extrabold text-sm leading-tight text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-blue-300 truncate">
                ศูนย์รวมข้อมูลดิจิทัล
              </p>
            </div>
            <p className="text-cyan-200/80 text-[11px] mt-0.5 truncate">{tenant?.name ?? 'Digital Data Center'}</p>
          </div>

          {activeModule === 'overview' && categoryTree.length > 0 && (
            <button onClick={() => setShowMobileCategorySheet(true)} aria-label="เปลี่ยนหมวดหมู่ข้อมูล"
              className="p-2 rounded-xl bg-cyan-500/20 border border-cyan-400/40 text-cyan-300 hover:text-white transition-all active:scale-90 shrink-0">
              <Tags size={18} />
            </button>
          )}
          <button onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')} aria-label="เปลี่ยนธีม" className="p-2 rounded-xl bg-cyan-500/20 border border-cyan-400/40 text-cyan-300 hover:text-white transition-all active:scale-90 shrink-0">
            {isLight ? <Moon size={18} /> : <Sun size={18} className="text-amber-400" />}
          </button>
          <button onClick={() => navigate('/notifications')} aria-label="การแจ้งเตือน" className="p-2 rounded-xl bg-slate-800/60 border border-slate-700 text-cyan-300 hover:text-white transition-colors shrink-0">
            <Bell size={18} />
          </button>
        </div>
      </header>

      {/* Mobile Category Sheet — เวอร์ชันมือถือของทรี "หมวดหมู่ข้อมูล" ในเมนูซ้าย desktop */}
      {showMobileCategorySheet && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setShowMobileCategorySheet(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div onClick={e => e.stopPropagation()}
            className={`relative rounded-t-3xl max-h-[75vh] overflow-y-auto p-4 shadow-2xl ${
              isLight ? 'bg-white text-slate-800' : 'bg-[#0b1329] text-slate-100 border-t border-cyan-500/30'
            }`}
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)' }}>
            <div className="flex items-center justify-between mb-3">
              <p className={`text-xs font-black uppercase tracking-widest ${isLight ? 'text-sky-700' : 'text-cyan-400/80'}`}>เลือกหมวดหมู่ข้อมูล</p>
              <button onClick={() => setShowMobileCategorySheet(false)} aria-label="ปิด"
                className={`p-1.5 rounded-lg ${isLight ? 'text-slate-500 bg-slate-100' : 'text-slate-400 bg-slate-800'}`}>
                <X size={16} />
              </button>
            </div>

            <button onClick={() => { goToCategory(null, null); setShowMobileCategorySheet(false) }}
              className={`w-full flex items-center justify-between rounded-xl px-3.5 py-3 mb-2 text-sm font-bold transition-colors ${
                !sidebarFilter.group
                  ? (isLight ? 'bg-sky-100 text-sky-800 border border-sky-300' : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40')
                  : (isLight ? 'bg-slate-50 text-slate-700 border border-slate-200' : 'bg-slate-800/50 text-slate-300 border border-transparent')
              }`}>
              <span>ภาพรวมทั้งหมด</span>
              <span className="font-mono text-xs">{categoryTree.reduce((acc, g) => acc + g.total, 0)}</span>
            </button>

            {categoryTree.map(({ group, total, categories }) => (
              <div key={group} className="mb-2">
                <button onClick={() => { goToCategory(group, null); setShowMobileCategorySheet(false) }}
                  className={`w-full flex items-center justify-between rounded-xl px-3.5 py-3 text-sm font-bold transition-colors ${
                    sidebarFilter.group === group && !sidebarFilter.category
                      ? (isLight ? 'bg-sky-100 text-sky-800 border border-sky-300' : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40')
                      : (isLight ? 'bg-slate-50 text-slate-700 border border-slate-200' : 'bg-slate-800/40 text-slate-200 border border-transparent')
                  }`}>
                  <span>{group}</span>
                  <span className="font-mono text-xs opacity-80">{total}</span>
                </button>
                {categories.length > 0 && (
                  <div className="pl-3 mt-1 space-y-1">
                    {categories.map(({ category, count }) => (
                      <button key={category} onClick={() => { goToCategory(group, category); setShowMobileCategorySheet(false) }}
                        className={`w-full flex items-center justify-between rounded-lg px-3 py-2 text-xs transition-colors ${
                          sidebarFilter.group === group && sidebarFilter.category === category
                            ? (isLight ? 'bg-sky-50 text-sky-700 font-bold' : 'bg-cyan-500/15 text-cyan-300 font-bold')
                            : (isLight ? 'text-slate-500' : 'text-slate-400')
                        }`}>
                        <span className="truncate">{category}</span>
                        <span className="font-mono shrink-0 ml-2">{count}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Desktop Cyber Command Header */}
      <header className={`hidden md:block relative w-full overflow-hidden shrink-0 border-b ${isLight ? 'bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white border-cyan-400/30' : 'bg-gradient-to-b from-[#0b1120] to-[#070a12] text-white border-cyan-500/20'}`}>
        {/* Background 3D Canvas Visualizer */}
        <div className="absolute inset-0 opacity-50 pointer-events-none">
          <DataCenter3DCanvas height="100%" theme={theme} />
        </div>

        <div className="relative z-10 flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-4">
            <button onClick={handleBackToStaff} aria-label="กลับหน้าเจ้าหน้าที่" className="shrink-0 active:scale-95 transition-transform group">
              <div className="w-10 h-10 rounded-xl bg-slate-900/80 border border-cyan-400/30 group-hover:border-cyan-400 text-cyan-300 flex items-center justify-center shadow-lg shadow-cyan-500/10 transition-colors">
                <ArrowLeft size={18} />
              </div>
            </button>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 px-2 py-0.5 rounded-full tracking-widest uppercase flex items-center gap-1 shadow-sm shadow-cyan-500/20">
                  <Activity size={10} className="animate-pulse text-cyan-400" />
                  DATA CORE v2.0
                </span>
                <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                  <ShieldCheck size={10} /> SYSTEM ONLINE
                </span>
              </div>
              <p className="text-base font-black tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-white via-cyan-100 to-cyan-300 mt-1 leading-tight">
                ศูนย์รวมข้อมูลดิจิทัล — {tenant?.name}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Theme Switcher Button */}
            <button onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
              className="px-3 py-1.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/40 text-cyan-300 text-xs font-extrabold flex items-center gap-2 transition-all shadow-md active:scale-95 hover:scale-105">
              {isLight ? <Moon size={15} className="text-cyan-300" /> : <Sun size={15} className="text-amber-400 animate-spin-slow" />}
              <span>{isLight ? 'โหมดมืด (Dark)' : 'โหมดสว่าง (Light)'}</span>
            </button>

            {profile && (
              <div className="flex items-center gap-3 pl-2 border-l border-cyan-500/30">
                <div className="text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <Cpu size={12} className="text-cyan-400" />
                    <p className="text-xs font-bold text-slate-200">{profile.full_name}</p>
                  </div>
                  <p className="text-[10px] font-mono text-cyan-300/70 capitalize">{profile.role ?? 'User'}</p>
                </div>
                <button onClick={handleBackToStaff} aria-label="กลับหน้าเจ้าหน้าที่"
                  className="px-3 py-1.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 transition-all border border-cyan-500/30 text-cyan-300 text-xs font-semibold flex items-center gap-1.5 shadow-sm shadow-cyan-500/20 hover:scale-105">
                  <ArrowLeft size={14} />
                  <span>หน้าหลัก</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>



      {/* Desktop cyber sidebar + main */}
      <div className={isMapModule ? 'md:flex relative flex-1 min-h-0' : 'md:flex relative'}>
        {!sidebarHidden && (
          <aside className="hidden md:flex flex-col w-60 shrink-0 shadow-2xl bg-[#0b1329]/95 border-r border-cyan-500/25 backdrop-blur-xl text-slate-100">
            <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-1 sidebar-nav">
              <div className="px-3 pb-2 text-[10px] font-black uppercase tracking-widest text-cyan-400/60 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                SYSTEM NAVIGATION
              </div>
              {MODULES.map(({ key, label, Icon }) => {
                const isActive = activeModule === key
                return (
                  <button key={key} onClick={() => {
                    setActiveModule(key)
                    if (key === 'overview') setSidebarFilter({ group: null, category: null })
                    if (key === 'map') setMapFocus(null)
                  }}
                    className={`group relative flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2 text-sm font-extrabold transition-all duration-200 focus-visible:outline-none ${
                      isActive
                        ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-300 border border-cyan-500/40 shadow-lg shadow-cyan-500/10'
                        : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 border border-transparent'
                    }`}>
                    {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-6 rounded-r-full bg-cyan-400 shadow-md shadow-cyan-400/50" />}
                    <Icon size={17} className={isActive ? 'text-cyan-400 drop-shadow-[0_0_8px_rgba(0,240,255,0.6)]' : 'text-slate-400 group-hover:text-cyan-300'} />
                    <span className="flex-1 text-left">{label}</span>
                  </button>
                )
              })}

              {/* tree กลุ่ม/ประเภทในเมนูซ้าย */}
              {categoryTree.length > 0 && (
                <div className="mt-4 pt-4 border-t border-cyan-500/20">
                  <div className="px-3 pb-2 flex items-center justify-between">
                    <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400/60">หมวดหมู่ข้อมูล</p>
                    <span className="text-[10px] font-mono bg-cyan-500/10 text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-500/30">
                      {categoryTree.reduce((acc, g) => acc + g.total, 0)}
                    </span>
                  </div>

                  {categoryTree.map(({ group, total, categories }) => {
                    const isGroupActive = activeModule === 'overview' && sidebarFilter.group === group && !sidebarFilter.category
                    const isExpanded = !collapsedGroups.has(group)
                    return (
                      <div key={group} className="mb-1">
                        <div className={`group flex items-center rounded-xl transition-all ${
                          isGroupActive
                            ? 'bg-cyan-500/20 border border-cyan-500/40'
                            : 'hover:bg-slate-800/50'
                        }`}>
                          <button type="button" onClick={() => toggleGroupExpand(group)}
                            aria-label={isExpanded ? `ยุบกลุ่ม ${group}` : `กางกลุ่ม ${group}`}
                            className="shrink-0 p-1.5 pl-2 text-cyan-400/60 hover:text-cyan-300 transition-colors">
                            <ChevronRight size={13} className={`transition-transform ${isExpanded ? 'rotate-90 text-cyan-400' : ''}`} />
                          </button>
                          <button type="button"
                            onClick={() => {
                              goToCategory(group, null)
                              setCollapsedGroups(prev => { if (!prev.has(group)) return prev; const next = new Set(prev); next.delete(group); return next })
                            }}
                            className={`flex-1 min-w-0 flex items-center justify-between gap-2 py-1.5 text-[13px] font-semibold text-left transition-colors ${
                              isGroupActive
                                ? 'text-cyan-200 font-bold'
                                : 'text-slate-300 hover:text-cyan-200'
                            }`}>
                            <span className="truncate">{group}</span>
                            <span className="shrink-0 text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-cyan-400 border border-slate-700">{total}</span>
                          </button>
                          <button type="button" onClick={() => goToAddEntry(group, null)}
                            aria-label={`เพิ่มข้อมูลในกลุ่ม ${group}`} title={`เพิ่มข้อมูลในกลุ่ม ${group}`}
                            className="shrink-0 p-1 mr-1.5 rounded-lg text-slate-500 group-hover:text-cyan-400 hover:bg-cyan-500/20 transition-colors">
                            <Plus size={13} />
                          </button>
                        </div>

                        {isExpanded && categories.map(({ category, count }) => {
                          const isCatActive = activeModule === 'overview' && sidebarFilter.group === group && sidebarFilter.category === category
                          return (
                            <div key={category}
                              className={`group flex items-center rounded-lg transition-all ${
                                isCatActive
                                  ? 'bg-cyan-500/15 border-l-2 border-cyan-400'
                                  : 'hover:bg-slate-800/40'
                              }`}>
                              <button type="button" onClick={() => goToCategory(group, category)}
                                className={`flex-1 min-w-0 flex items-center justify-between gap-2 pl-7 py-1.5 text-xs text-left transition-colors ${
                                  isCatActive
                                    ? 'text-cyan-300 font-bold'
                                    : 'text-slate-400 group-hover:text-slate-200'
                                }`}>
                                <span className="truncate">{category}</span>
                                <span className="shrink-0 text-[10px] font-mono text-slate-500">{count}</span>
                              </button>
                              <button type="button" onClick={() => goToAddEntry(group, category)}
                                aria-label={`เพิ่มข้อมูลในประเภท ${category}`} title={`เพิ่มข้อมูลในประเภท ${category}`}
                                className="shrink-0 p-1 mr-1.5 rounded-md text-slate-600 group-hover:text-cyan-400 hover:bg-cyan-500/20 transition-colors">
                                <Plus size={12} />
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              )}
            </nav>
          </aside>
        )}


        {/* ปุ่มพับ/กางเมนูซ้ายหน้าแผนที่ */}
        {activeModule === 'map' && (
          <button onClick={() => setMapSidebarOpen(o => !o)} aria-label={mapSidebarOpen ? 'ซ่อนเมนู' : 'แสดงเมนู'}
            className={`hidden md:flex absolute top-3 left-3 z-30 items-center justify-center w-9 h-9 rounded-xl shadow-xl border transition-all ${isLight ? 'bg-white/95 border-slate-200 text-sky-700 hover:bg-slate-50' : 'bg-slate-900/90 border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/20'}`}>
            {mapSidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
        )}

        {/* Main Content */}
        <main className={isMapModule ? 'flex-1 min-w-0 pb-24 md:pb-0 flex flex-col min-h-0' : 'flex-1 min-w-0 px-4 md:px-6 pb-24 md:pb-6 pt-5'}>
          {isMapModule ? (
            <Suspense fallback={
              <div className="flex min-h-64 items-center justify-center">
                <div className="w-8 h-8 border-4 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin" />
              </div>
            }>
              <DataCenterMap key={`${refreshKey}-${mapFocus?.group ?? ''}-${mapFocus?.category ?? ''}-${mapFocus?.lat ?? ''}-${mapFocus?.lng ?? ''}`}
                tenant={tenant} currentUserRole={profile?.role}
                initialGroup={mapFocus?.group} initialCategory={mapFocus?.category}
                focusLat={mapFocus?.lat} focusLng={mapFocus?.lng} />
            </Suspense>
          ) : (
            <div className="max-w-6xl mx-auto">
              <Suspense fallback={
                <div className="flex min-h-64 items-center justify-center">
                  <div className="w-8 h-8 border-4 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin" />
                </div>
              }>
                {activeModule === 'overview' && <DataCenterOverview key={refreshKey} tenant={tenant} profile={profile} theme={theme}
                  initialFilterGroup={sidebarFilter.group} initialFilterCategory={sidebarFilter.category}
                  onAddNew={(group, category) => goToAddEntry(group, category)}
                  onEditEntry={handleEditEntry}
                  onSelectCategory={(group, category) => goToCategory(group, category)}
                  onViewOnMap={goToMapFocus}
                  onImportSuccess={() => setRefreshKey(k => k + 1)} />}
                {activeModule === 'add' && <DataCenterEntryForm tenant={tenant} profile={profile}
                  initialGroup={prefillGroup} initialCategory={prefillCategory} editingEntry={editingEntry}
                  onSaved={handleSaved}
                  onCancel={() => { setPrefillGroup(null); setPrefillCategory(null); setEditingEntry(null); setActiveModule('overview') }} />}
                {activeModule === 'categories' && isManager && <DataCenterCategoryManager key={refreshKey} tenant={tenant} />}
              </Suspense>
            </div>
          )}
        </main>
      </div>


      {/* Cyber Mobile Bottom Bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex items-stretch bg-slate-900/95 backdrop-blur-xl border-t border-cyan-500/30 shadow-[0_-8px_30px_rgba(0,0,0,0.5)]"
        style={{
          borderTopLeftRadius: '20px',
          borderTopRightRadius: '20px',
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 6px)',
        }}>
        {MODULES.map(({ key, label, Icon }) => {
          const isActive = activeModule === key
          return (
            <button key={key} onClick={() => {
              setActiveModule(key)
              if (key === 'overview') setSidebarFilter({ group: null, category: null })
              if (key === 'map') setMapFocus(null)
            }}
              className="flex-1 flex flex-col items-center justify-center gap-1 pt-2 pb-1 transition-all active:scale-95">
              <div className={`relative w-10 h-8 rounded-xl flex items-center justify-center transition-all duration-300 ${isActive ? 'bg-gradient-to-r from-cyan-500/30 to-blue-500/30 border border-cyan-400/50 shadow-md shadow-cyan-500/20' : ''}`}>
                {isActive && <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-4 h-[3px] rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(0,240,255,0.8)]" />}
                <Icon size={18} strokeWidth={isActive ? 2.3 : 1.6} className={isActive ? 'text-cyan-300 drop-shadow-[0_0_6px_rgba(0,240,255,0.6)]' : 'text-slate-400'} />
              </div>
              <span className={`text-[10px] font-bold leading-tight truncate max-w-[75px] ${isActive ? 'text-cyan-300' : 'text-slate-400'}`}>
                {label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

