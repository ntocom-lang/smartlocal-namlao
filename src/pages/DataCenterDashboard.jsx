import { lazy, Suspense, useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { LayoutGrid, MapPin, Plus, Bell, ArrowLeft, PanelLeftOpen, PanelLeftClose, Tags, ChevronRight, Sun, Moon, ClipboardCheck, Database, HeartPulse, LogOut } from 'lucide-react'
import { supabase, getSessionResilient, signOutSafely } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { useNotifications } from '../contexts/NotificationsContext'
import PortalSwitcher from '../components/layout/PortalSwitcher'
import UserProfileBadge from '../components/layout/UserProfileBadge'
import MobileCategorySheet from '../components/datacenter/MobileCategorySheet'
import { DEFAULT_STALE_DAYS, scoreTone } from '../lib/dataCenterHealth'

const DataCenterOverview = lazy(() => import('../components/datacenter/DataCenterOverview'))
const DataCenterMap = lazy(() => import('../components/datacenter/DataCenterMap'))
const DataCenterEntryForm = lazy(() => import('../components/datacenter/DataCenterEntryForm'))
const DataCenterCategoryManager = lazy(() => import('../components/datacenter/DataCenterCategoryManager'))
const DataCenterQuality = lazy(() => import('../components/datacenter/DataCenterQuality'))

// เมนูซ้ายกางทุกกลุ่มตั้งแต่เปิดหน้าได้ก็ต่อเมื่อประเภทย่อยรวมกันทุกกลุ่มไม่เกินเท่านี้ (ดู sidebarAutoCollapse)
const SIDEBAR_AUTO_EXPAND_MAX_ROWS = 40

const BASE_MODULES = [
  { key: 'overview', label: 'ภาพรวมระบบ',   Icon: LayoutGrid },
  { key: 'map',      label: 'แผนที่ GIS',    Icon: MapPin },
  { key: 'add',      label: 'บันทึกข้อมูลใหม่', Icon: Plus },
  { key: 'quality',  label: 'คุณภาพข้อมูล',   Icon: ClipboardCheck },
]

// ป้ายคะแนนอยู่ในแถบเครื่องมือของโมดูล ใช้สีตามพื้นหลังเนื้อหา
const HEADER_SCORE_CLS = {
  light: {
    good: 'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100',
    warn: 'text-amber-800 bg-amber-50 border-amber-200 hover:bg-amber-100',
    bad: 'text-red-700 bg-red-50 border-red-200 hover:bg-red-100',
  },
  dark: {
    good: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/40 hover:bg-emerald-500/20',
    warn: 'text-amber-300 bg-amber-500/10 border-amber-500/40 hover:bg-amber-500/20',
    bad: 'text-red-300 bg-red-500/10 border-red-500/40 hover:bg-red-500/20',
  },
}
const CATEGORY_MANAGER_MODULE = { key: 'categories', label: 'จัดการหมวดหมู่', Icon: Tags }

// จำธีมที่ผู้ใช้เลือกไว้ — เดิมเป็น useState('light') เฉยๆ ออกจากหน้าแล้วกลับมาต้องกดสลับใหม่ทุกครั้ง
// อ่าน/เขียนใน try/catch เพราะ localStorage โยน exception ได้จริงในโหมดส่วนตัว/เบราว์เซอร์ที่บล็อก site data
const THEME_STORAGE_KEY = 'dataCenterTheme'
function readStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return stored === 'dark' || stored === 'light' ? stored : 'light'
  } catch {
    return 'light'
  }
}

export default function DataCenterDashboard() {
  const navigate = useNavigate()
  const { tenant } = useTenant()
  const { unreadCount } = useNotifications()
  const [profile, setProfile] = useState(null)
  const [activeModule, setActiveModule] = useState('overview')
  const [refreshKey, setRefreshKey] = useState(0)
  const [prefillGroup, setPrefillGroup] = useState(null)
  const [prefillCategory, setPrefillCategory] = useState(null)
  const [editingEntry, setEditingEntry] = useState(null)
  const [mapSidebarOpen, setMapSidebarOpen] = useState(false)
  const sidebarHidden = activeModule === 'map' && !mapSidebarOpen
  // สถิติทั้งหน้ามาจาก RPC data_center_summary ตัวเดียว (นับที่ server) แล้วส่งต่อเป็น prop ให้ลูกทุกตัว
  // — เดิมแต่ละคอมโพเนนต์ดึงทั้งตารางมานับเองคนละรอบ รวม 4 รอบต่อการเข้าหน้า 1 ครั้ง และเพี้ยนเงียบๆ
  // เมื่อข้อมูลเกิน max_rows ของ PostgREST (1000) ดู supabase/migrations/20260829100000_data_center_summary_rpc.sql
  const [summary, setSummary] = useState(null)
  const [summaryError, setSummaryError] = useState(null)
  // แยกจาก refreshKey เพราะ refreshKey ใช้เป็น key ของ Overview/CategoryManager (สั่ง remount ล้างตัวกรอง)
  // งานที่แค่ทำให้ "ตัวเลขเปลี่ยน" เช่นกดเปิด/ปิดใช้งานรายการ ต้องรีเฟรชสถิติโดยไม่ล้างตัวกรองที่ผู้ใช้ตั้งไว้
  const [summaryVersion, setSummaryVersion] = useState(0)
  const [sidebarFilter, setSidebarFilter] = useState({ group: null, category: null })
  // การกาง/พับกลุ่มในเมนูซ้ายที่ผู้ใช้กดเอง: group -> true (กาง) | false (พับ) — กลุ่มที่ไม่อยู่ในนี้ใช้ค่าเริ่มต้นตาม
  // sidebarGroupDefaultExpanded() เก็บเป็น "ค่าที่ผู้ใช้เลือกชัดๆ" ไม่ใช่ "ต่างจากค่าเริ่มต้น" เพราะค่าเริ่มต้นขยับตามกลุ่มที่กรองอยู่
  // ถ้าเก็บแบบหลังไว้ พอย้ายไปกรองกลุ่มอื่น กลุ่มที่ผู้ใช้เคยพับไว้จะกางเองเงียบๆ
  const [groupExpandOverrides, setGroupExpandOverrides] = useState(() => new Map())
  const [theme, setTheme] = useState(readStoredTheme) // ค่าเริ่มต้นยังเป็นโหมดสว่างถ้าไม่เคยเลือกไว้
  // ทรี "หมวดหมู่ข้อมูล" อยู่ใน sidebar ฝั่ง desktop เท่านั้น (hidden md:flex) — มือถือไม่มีทางเปลี่ยนหมวดเลย
  // ต้องมี bottom sheet แยกให้กดเลือกหมวด/ประเภทย่อยแบบเดียวกับเมนูซ้าย
  const [showMobileCategorySheet, setShowMobileCategorySheet] = useState(false)
  // ปุ่ม "ดูบนแผนที่" จากรายการ — เก็บกลุ่ม/ประเภท+พิกัดของรายการที่กดไว้ ส่งต่อให้ DataCenterMap ไปกรอง+
  // pan กล้องไปที่จุดนั้นให้เลย (ไม่ต้องให้ผู้ใช้ไปกรองหมวดเองซ้ำอีกรอบบนแผนที่)
  const [mapFocus, setMapFocus] = useState(null)
  // "สุขภาพข้อมูล" (RPC data_center_health) ดึงครั้งเดียวที่นี่ ใช้ทั้งป้ายคะแนนที่หัวหน้า, แถบเตือนใน Overview
  // และหน้า "คุณภาพข้อมูล" — ไม่ให้แต่ละที่ยิงซ้ำคนละรอบ (หลักเดียวกับ summary ด้านบน)
  const [health, setHealth] = useState(null)
  const [healthError, setHealthError] = useState(null)
  const [healthLoading, setHealthLoading] = useState(false)
  const [healthVersion, setHealthVersion] = useState(0)
  const [staleDays, setStaleDays] = useState(DEFAULT_STALE_DAYS)
  const [qualityTab, setQualityTab] = useState('catalog')
  // กดแก้ไขจากหน้า "คุณภาพข้อมูล" แล้วบันทึก/ยกเลิก ให้กลับไปหน้านั้นต่อ ไม่เด้งไปภาพรวม (แก้ทีละหลายรายการได้ต่อเนื่อง)
  const [formReturn, setFormReturn] = useState('overview')

  const isLight = theme === 'light'

  function toggleGroupExpand(group) {
    setGroupExpandOverrides(prev => {
      const next = new Map(prev)
      next.set(group, !(prev.has(group) ? prev.get(group) : sidebarGroupDefaultExpanded(group)))
      return next
    })
  }

  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // เขียนไม่ได้ (โหมดส่วนตัว/บล็อก site data) — ธีมยังใช้ได้ปกติในเซสชันนี้ แค่ไม่ถูกจำข้ามครั้ง
    }
  }, [theme])

  useEffect(() => {
    // getSessionResilient: เน็ตสะดุดตอนต่ออายุ token ต้องไม่พาออกจากระบบ (ดูเหตุผลที่ src/lib/supabase.js)
    getSessionResilient().then(({ data }) => {
      if (!data.session) { navigate('/auth', { state: { from: '/data-center' } }); return }
      supabase.from('profiles').select('*').eq('id', data.session.user.id).single()
        .then(({ data: p }) => setProfile(p))
    })
  }, [navigate])

  useEffect(() => {
    if (!tenant?.id) return
    let alive = true
    supabase.rpc('data_center_summary', { _municipality_id: tenant.id })
      .then(({ data, error }) => {
        if (!alive) return
        if (error) { setSummaryError(error.message); setSummary(null); return }
        setSummaryError(null)
        setSummary(data ?? null)
      })
    return () => { alive = false }
  }, [tenant?.id, refreshKey, summaryVersion])

  // เปลี่ยนแค่เมื่อข้อมูลเปลี่ยน (summaryVersion/refreshKey) หรือผู้ใช้เปลี่ยนเกณฑ์ "ไม่ได้ตรวจทาน" / กด "ตรวจใหม่"
  // ถ้าฟังก์ชันยังไม่ถูก apply บนฐาน (error) ป้ายคะแนนจะไม่ขึ้นเลย ไม่แสดงค่าปลอม
  useEffect(() => {
    if (!tenant?.id) return
    let alive = true
    supabase.rpc('data_center_health', { _municipality_id: tenant.id, _stale_days: staleDays })
      .then(({ data, error }) => {
        if (!alive) return
        setHealthLoading(false)
        if (error) { setHealthError(error.message); setHealth(null); return }
        setHealthError(null)
        setHealth(data ?? null)
      })
    return () => { alive = false }
  }, [tenant?.id, refreshKey, summaryVersion, staleDays, healthVersion])

  // ทรีหมวดหมู่ในเมนูซ้าย/bottom sheet — นับเฉพาะรายการที่ยัง "ใช้งาน" เท่านั้น ตรงกับ logic เดิม
  // (เดิมกรอง r.status !== 'archived' ทิ้งก่อนนับ กลุ่ม/ประเภทที่เหลือแต่รายการ archived จึงไม่ขึ้นในทรี)
  const categoryTree = useMemo(() => {
    if (!summary?.groups) return []
    return summary.groups
      .map(g => ({
        group: g.group_name,
        total: g.active,
        categories: (g.categories ?? [])
          .filter(c => c.active > 0)
          .map(c => ({ category: c.category, count: c.active }))
          .sort((a, b) => a.category.localeCompare(b.category, 'th')),
      }))
      .filter(g => g.total > 0)
      .sort((a, b) => a.group.localeCompare(b.group, 'th'))
  }, [summary])

  // เมนูซ้ายกางทุกกลุ่มเป็นค่าเริ่มต้น "เฉพาะเมื่อประเภทรวมกันไม่มาก" — เดิมกางหมดเสมอ ที่ 60 กลุ่ม × 60 ประเภท
  // กลุ่มแรกกลุ่มเดียวก็กินพื้นที่เมนูทั้งหมด กลุ่มที่เหลือต้องเลื่อนผ่านประเภทของกลุ่มแรกไปก่อน
  // เกินเพดานนี้ → พับทุกกลุ่ม ยกเว้นกลุ่มที่กำลังกรองอยู่ ต่ำกว่าเพดาน (หน่วยงานที่ข้อมูลยังน้อย) หน้าตาเท่าเดิมทุกประการ
  const sidebarCategoryRows = categoryTree.reduce((n, g) => n + g.categories.length, 0)
  const sidebarAutoCollapse = sidebarCategoryRows > SIDEBAR_AUTO_EXPAND_MAX_ROWS
  const sidebarGroupDefaultExpanded = group => !sidebarAutoCollapse || sidebarFilter.group === group
  const isSidebarGroupExpanded = group => (groupExpandOverrides.has(group) ? groupExpandOverrides.get(group) : sidebarGroupDefaultExpanded(group))

  function goToCategory(group, category) {
    setSidebarFilter({ group: group ?? null, category: category ?? null })
    setActiveModule('overview')
  }

  function goToAddEntry(group, category) {
    setFormReturn('overview')
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
    setActiveModule(formReturn)
    setFormReturn('overview')
  }

  function handleBackToStaff() {
    navigate('/staff')
  }

  async function handleLogout() {
    await signOutSafely('/')
    navigate('/')
  }

  function canManageEntry(entry) {
    if (!entry || !profile) return false
    if (profile.role === 'admin' || profile.role === 'superadmin') return true
    if (profile.role === 'officer') {
      return !!profile.department_id && entry.department_id === profile.department_id
    }
    return ['staff', 'technician'].includes(profile.role) && entry.created_by === profile.id
  }

  function handleEditEntry(entry, returnTo = 'overview') {
    if (!canManageEntry(entry)) {
      window.alert('รายการนี้เป็นของกองอื่นหรือผู้สร้างรายอื่น คุณเปิดดูบนแผนที่ได้แต่แก้ไขไม่ได้')
      return
    }
    setFormReturn(returnTo)
    setEditingEntry(entry)
    setActiveModule('add')
  }

  // รายการในหน้า "คุณภาพข้อมูล" มาจาก RPC ที่ส่งเฉพาะคอลัมน์เบา ฟอร์มแก้ไขต้องใช้แถวเต็ม (รูป/เส้นทาง/รายละเอียด)
  // จึงดึงแถวเดียวตอนกดแก้ไข ไม่ยัดคอลัมน์หนักเข้า RPC ทุกแถว
  async function handleEditEntryById(id) {
    const { data, error } = await supabase.from('data_center_entries').select('*').eq('id', id).maybeSingle()
    if (error || !data) { window.alert('เปิดรายการไม่สำเร็จ' + (error ? ': ' + error.message : ' (อาจถูกลบไปแล้ว)')); return }
    handleEditEntry(data, 'quality')
  }

  function openQuality(tab) {
    setQualityTab(tab)
    setActiveModule('quality')
  }

  function refreshHealth() {
    setHealthLoading(true)
    setHealthVersion(v => v + 1)
  }

  function changeStaleDays(days) {
    setHealthLoading(true)
    setStaleDays(days)
  }

  const isMapModule = activeModule === 'map'
  const isManager = profile?.role === 'admin' || profile?.role === 'superadmin'
  const MODULES = isManager ? [...BASE_MODULES, CATEGORY_MANAGER_MODULE] : BASE_MODULES

  return (
    <div className={`min-h-screen flex flex-col ${isLight ? 'bg-[#eef2f7] text-slate-800' : 'bg-[#070a12] text-slate-100'}`}>
      {/* ใช้ธีมและปุ่มสลับระบบชุดเดียวกับ StaffDashboard */}
      <header className="relative w-full text-white overflow-hidden shrink-0"
        style={{ background: 'linear-gradient(180deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}>
        {tenant?.header_image_url && (
          <div className="absolute inset-0 opacity-25 pointer-events-none"
            style={{ backgroundImage: `url("${tenant.header_image_url}")`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
        )}
        <div className="absolute bottom-0 inset-x-0 h-12 pointer-events-none"
          style={{ background: 'linear-gradient(to top, var(--color-primary-dark), transparent)' }} />
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 px-4 md:px-6 py-3">
          <div className="flex items-center gap-3 min-w-0 flex-1 md:flex-none">
            <button type="button" onClick={() => navigate('/')} aria-label="กลับหน้าแรก"
              className="flex h-11 w-11 shrink-0 items-center justify-center active:opacity-70 transition-opacity">
              {tenant?.logo_url
                ? <img src={tenant.logo_url} alt="" className="w-10 h-10 rounded-full border-2 border-white/40 bg-white/10 object-contain" />
                : <span className="w-10 h-10 rounded-full bg-white/20 border-2 border-white/40 flex items-center justify-center text-lg font-bold">🏛️</span>}
            </button>
            <div className="min-w-0">
              <span className="text-[10px] font-black bg-white/20 text-white px-2 py-0.5 rounded-full tracking-widest uppercase">ระบบเจ้าหน้าที่</span>
              <p className="text-sm font-bold text-white mt-0.5 leading-tight">{tenant?.name}</p>
            </div>
          </div>
          <button type="button" onClick={() => navigate('/notifications')} aria-label="การแจ้งเตือน"
            className="md:hidden relative flex h-11 min-w-11 flex-col items-center justify-center gap-1 text-white/85 hover:text-white">
            <Bell size={18} />
            <span className="text-[9px]">แจ้งเตือน</span>
            {unreadCount > 0 && <span className="absolute top-0 right-0 rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{unreadCount > 9 ? '9+' : unreadCount}</span>}
          </button>
          <div className="hidden md:flex items-center gap-2 flex-wrap justify-end">
            <UserProfileBadge tone="onDark" className="min-h-11" />
            <PortalSwitcher className="flex flex-wrap [&>a]:min-h-11" />
            <button type="button" onClick={handleLogout}
              className="flex min-h-11 items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-white/10 hover:bg-white/20 transition-colors border border-white/20">
              <LogOut size={13} /> ออกจากระบบ
            </button>
          </div>
        </div>
        <PortalSwitcher className="relative z-10 flex flex-wrap px-4 pb-3 md:hidden [&>a]:min-h-11" />
      </header>

      {/* Mobile Category Sheet — เวอร์ชันมือถือของทรี "หมวดหมู่ข้อมูล" ในเมนูซ้าย desktop */}
      {showMobileCategorySheet && (
        <MobileCategorySheet tree={categoryTree} isLight={isLight} sidebarFilter={sidebarFilter}
          onFilter={(group, category) => { goToCategory(group, category); setShowMobileCategorySheet(false) }}
          onAdd={(group, category) => { goToAddEntry(group, category); setShowMobileCategorySheet(false) }}
          onClose={() => setShowMobileCategorySheet(false)} />
      )}

      {/* เมนูซ้ายใช้รูปแบบเดียวกับหน้าเจ้าหน้าที่ */}
      <div className="md:flex relative flex-1 min-h-0">
        {!sidebarHidden && (
          <aside className="hidden md:flex flex-col w-60 shrink-0 shadow-lg text-white" style={{ backgroundColor: '#1a3a5c' }}>
            <nav aria-label="เมนูศูนย์รวมข้อมูลดิจิทัล" className="flex-1 px-3 py-4 overflow-y-auto space-y-0.5">
              <button type="button" onClick={handleBackToStaff}
                className="mb-3 flex min-h-9 w-full items-center gap-3 rounded-lg px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60">
                <ArrowLeft size={16} /> กลับแดชบอร์ดเจ้าหน้าที่
              </button>
              <p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-widest text-white/55">ศูนย์รวมข้อมูลดิจิทัล</p>
              {MODULES.map(({ key, label, Icon }) => {
                const isActive = activeModule === key
                return (
                  <button key={key} onClick={() => {
                    setActiveModule(key)
                    if (key === 'overview') setSidebarFilter({ group: null, category: null })
                    if (key === 'map') setMapFocus(null)
                  }}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex min-h-9 w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60 ${
                      isActive
                        ? 'bg-white/20 text-white shadow-sm'
                        : 'text-white/80 hover:bg-white/10 hover:text-white'
                    }`}>
                    <Icon size={16} strokeWidth={isActive ? 2.2 : 1.8} />
                    <span className="flex-1 text-left text-xs">{label}</span>
                  </button>
                )
              })}

              {/* tree กลุ่ม/ประเภทในเมนูซ้าย */}
              {categoryTree.length > 0 && (
                <div className="mt-4 pt-4 border-t border-white/10">
                  <div className="px-3 pb-2 flex items-center justify-between">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/55">หมวดหมู่ข้อมูล</p>
                    <span className="text-[10px] font-semibold bg-white/10 text-white/80 px-1.5 py-0.5 rounded-full">
                      {categoryTree.reduce((acc, g) => acc + g.total, 0)}
                    </span>
                  </div>

                  {categoryTree.map(({ group, total, categories }) => {
                    const isGroupActive = activeModule === 'overview' && sidebarFilter.group === group && !sidebarFilter.category
                    const isExpanded = isSidebarGroupExpanded(group)
                    return (
                      <div key={group} className="mb-1">
                        <div className={`group flex items-center rounded-lg transition-all ${
                          isGroupActive
                            ? 'bg-white/20 text-white shadow-sm'
                            : 'hover:bg-white/10'
                        }`}>
                          <button type="button" onClick={() => toggleGroupExpand(group)}
                            aria-label={isExpanded ? `ยุบกลุ่ม ${group}` : `กางกลุ่ม ${group}`}
                            aria-expanded={isExpanded}
                            className="shrink-0 p-1.5 pl-2 text-white/55 hover:text-white transition-colors">
                            <ChevronRight size={13} className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                          </button>
                          <button type="button"
                            onClick={() => {
                              goToCategory(group, null)
                              setGroupExpandOverrides(prev => { if (prev.get(group) === true) return prev; const next = new Map(prev); next.set(group, true); return next })
                            }}
                            className={`flex-1 min-w-0 flex min-h-9 items-center justify-between gap-2 py-1.5 text-xs font-semibold text-left transition-colors ${
                              isGroupActive
                                ? 'text-white'
                                : 'text-white/80 hover:text-white'
                            }`}>
                            <span className="break-words">{group}</span>
                            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/70">{total}</span>
                          </button>
                          <button type="button" onClick={() => goToAddEntry(group, null)}
                            aria-label={`เพิ่มข้อมูลในกลุ่ม ${group}`} title={`เพิ่มข้อมูลในกลุ่ม ${group}`}
                            className="shrink-0 p-1 mr-1.5 rounded-lg text-white/45 group-hover:text-white hover:bg-white/10 transition-colors">
                            <Plus size={13} />
                          </button>
                        </div>

                        {isExpanded && categories.map(({ category, count }) => {
                          const isCatActive = activeModule === 'overview' && sidebarFilter.group === group && sidebarFilter.category === category
                          return (
                            <div key={category}
                              className={`group flex items-center rounded-lg transition-all ${
                                isCatActive
                                  ? 'bg-white/20 text-white shadow-sm'
                                  : 'hover:bg-white/10'
                              }`}>
                              <button type="button" onClick={() => goToCategory(group, category)}
                                className={`flex-1 min-w-0 flex min-h-9 items-center justify-between gap-2 pl-7 py-1.5 text-xs text-left transition-colors ${
                                  isCatActive
                                    ? 'text-white font-semibold'
                                    : 'text-white/60 group-hover:text-white'
                                }`}>
                                <span className="break-words">{category}</span>
                                <span className="shrink-0 text-[10px] text-white/50">{count}</span>
                              </button>
                              <button type="button" onClick={() => goToAddEntry(group, category)}
                                aria-label={`เพิ่มข้อมูลในประเภท ${category}`} title={`เพิ่มข้อมูลในประเภท ${category}`}
                                className="shrink-0 p-1 mr-1.5 rounded-md text-white/40 group-hover:text-white hover:bg-white/10 transition-colors">
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


        {/* Main Content */}
        <main className={isMapModule ? 'flex-1 min-w-0 pb-28 md:pb-0 flex flex-col min-h-0' : 'flex-1 min-w-0 px-4 md:px-6 pb-28 md:pb-6 pt-5'}>
          <div className={`flex flex-wrap items-center justify-between gap-3 ${isMapModule ? 'px-4 md:px-6 py-3 shrink-0' : 'max-w-5xl mx-auto mb-4'}`}>
            <div>
              <h1 className="text-lg font-extrabold leading-tight">ศูนย์รวมข้อมูลดิจิทัล</h1>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                {summary?.totals && (
                  <span className={`flex items-center gap-1 text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                    <Database size={12} /> {summary.totals.total} รายการ · {summary.groups?.length ?? 0} กลุ่มข้อมูล
                  </span>
                )}
                {health?.totals?.score != null && (
                  <button type="button" onClick={() => openQuality('health')}
                    title="คะแนนความพร้อมของข้อมูล — กดเพื่อดูรายการที่ต้องดูแลและกฎที่ใช้ตรวจ"
                    className={`flex min-h-11 items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${HEADER_SCORE_CLS[theme][scoreTone(health.totals.score)]}`}>
                    <HeartPulse size={13} /> คุณภาพข้อมูล {health.totals.score}%
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isMapModule && (
                <button type="button" onClick={() => setMapSidebarOpen(o => !o)}
                  className={`hidden md:flex min-h-11 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition-colors ${isLight ? 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50' : 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800'}`}>
                  {mapSidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
                  {mapSidebarOpen ? 'ซ่อนเมนู' : 'แสดงเมนู'}
                </button>
              )}
              {activeModule === 'overview' && categoryTree.length > 0 && (
                <button type="button" onClick={() => setShowMobileCategorySheet(true)} aria-label="เปลี่ยนหมวดหมู่ข้อมูล"
                  className={`md:hidden flex min-h-11 items-center gap-2 rounded-full border px-3 text-xs font-semibold ${isLight ? 'bg-white border-slate-200 text-slate-600' : 'bg-slate-900 border-slate-700 text-slate-200'}`}>
                  <Tags size={16} /> หมวดหมู่
                </button>
              )}
              <button type="button" onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
                className={`flex min-h-11 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition-colors ${isLight ? 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50' : 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800'}`}>
                {isLight ? <Moon size={15} /> : <Sun size={15} />}
                {isLight ? 'โหมดมืด' : 'โหมดสว่าง'}
              </button>
            </div>
          </div>
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
            <div className="max-w-5xl mx-auto">
              <Suspense fallback={
                <div className="flex min-h-64 items-center justify-center">
                  <div className="w-8 h-8 border-4 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin" />
                </div>
              }>
                {activeModule === 'overview' && <DataCenterOverview key={refreshKey} tenant={tenant} profile={profile} theme={theme}
                  summary={summary} summaryError={summaryError}
                  health={health} onOpenQuality={openQuality} canManageEntry={canManageEntry}
                  initialFilterGroup={sidebarFilter.group} initialFilterCategory={sidebarFilter.category}
                  onAddNew={(group, category) => goToAddEntry(group, category)}
                  onEditEntry={handleEditEntry}
                  onSelectCategory={(group, category) => goToCategory(group, category)}
                  onViewOnMap={goToMapFocus}
                  onDataChanged={() => setSummaryVersion(v => v + 1)}
                  onRetrySummary={() => setSummaryVersion(v => v + 1)}
                  onImportSuccess={() => setRefreshKey(k => k + 1)} />}
                {activeModule === 'add' && <DataCenterEntryForm tenant={tenant} profile={profile}
                  summary={summary}
                  initialGroup={prefillGroup} initialCategory={prefillCategory} editingEntry={editingEntry}
                  onSaved={handleSaved}
                  onCancel={() => { setPrefillGroup(null); setPrefillCategory(null); setEditingEntry(null); setActiveModule(formReturn); setFormReturn('overview') }} />}
                {activeModule === 'quality' && <DataCenterQuality tenant={tenant} profile={profile} theme={theme}
                  tab={qualityTab} onTabChange={setQualityTab} summary={summary}
                  health={health} healthError={healthError} healthLoading={healthLoading}
                  staleDays={staleDays} onChangeStaleDays={changeStaleDays} onRefreshHealth={refreshHealth}
                  isManager={isManager} canManageEntry={canManageEntry}
                  onEditEntryById={handleEditEntryById} onViewOnMap={goToMapFocus}
                  onDataChanged={() => setSummaryVersion(v => v + 1)} />}
                {activeModule === 'categories' && isManager && <DataCenterCategoryManager key={refreshKey} tenant={tenant}
                  summary={summary} onDataChanged={() => setSummaryVersion(v => v + 1)} />}
              </Suspense>
            </div>
          )}
        </main>
      </div>


      {/* เมนูมือถือใช้สีเดียวกับเมนูซ้าย และแสดงชื่อครบโดยขึ้นบรรทัดใหม่ */}
      <nav aria-label="เมนูศูนย์รวมข้อมูลดิจิทัลบนมือถือ" className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex items-stretch border-t border-white/10 shadow-lg text-white"
        style={{
          backgroundColor: '#1a3a5c',
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
              aria-current={isActive ? 'page' : undefined}
              className={`flex-1 min-w-0 min-h-16 flex flex-col items-center justify-center gap-1 px-1 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60 ${isActive ? 'bg-white/20 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}>
              <Icon size={18} strokeWidth={isActive ? 2.2 : 1.8} />
              <span className="text-[10px] font-semibold leading-tight text-center break-words w-full">
                {label}
              </span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}

