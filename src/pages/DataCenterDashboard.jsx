import { lazy, Suspense, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { LayoutGrid, MapPin, Plus, Bell, Database, X, PanelLeftOpen, PanelLeftClose, Tags } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'

const DataCenterOverview = lazy(() => import('../components/datacenter/DataCenterOverview'))
const DataCenterMap = lazy(() => import('../components/datacenter/DataCenterMap'))
const DataCenterEntryForm = lazy(() => import('../components/datacenter/DataCenterEntryForm'))
const DataCenterCategoryManager = lazy(() => import('../components/datacenter/DataCenterCategoryManager'))

const BASE_MODULES = [
  { key: 'overview', label: 'ภาพรวม',       Icon: LayoutGrid },
  { key: 'map',      label: 'แผนที่',        Icon: MapPin },
  { key: 'add',      label: 'เพิ่มข้อมูลใหม่', Icon: Plus },
]
// จัดการหมวดหมู่ (รวม/แก้ชื่อกลุ่ม-ประเภทที่พิมพ์ไม่ตรงกัน) — เฉพาะ admin/superadmin เพราะเป็นการแก้ข้อมูลย้อนหลังทีเดียวหลายรายการ
const CATEGORY_MANAGER_MODULE = { key: 'categories', label: 'จัดการหมวดหมู่', Icon: Tags }

export default function DataCenterDashboard() {
  const navigate = useNavigate()
  const { tenant } = useTenant()
  const [profile, setProfile] = useState(null)
  const [activeModule, setActiveModule] = useState('overview')
  const [refreshKey, setRefreshKey] = useState(0)
  // กดปุ่ม + ที่การ์ดกลุ่มใน "ภาพรวม" จะพกกลุ่มหลักติดไปเติมในฟอร์มให้เลย ไม่ต้องพิมพ์ซ้ำ
  const [prefillGroup, setPrefillGroup] = useState(null)
  // กดรายการในหน้า "ภาพรวม" เพื่อแก้ไข — เก็บ entry ที่กำลังแก้ไว้ ส่งให้ฟอร์มเดียวกันแต่สลับเป็นโหมดแก้ไข
  const [editingEntry, setEditingEntry] = useState(null)
  // เมนูซ้ายพับอัตโนมัติเฉพาะตอนอยู่หน้าแผนที่ (ขอพื้นที่เต็มจอ) หน้าอื่นแสดงปกติเสมอ
  const [mapSidebarOpen, setMapSidebarOpen] = useState(false)
  const sidebarHidden = activeModule === 'map' && !mapSidebarOpen

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { navigate('/auth', { state: { from: '/data-center' } }); return }
      supabase.from('profiles').select('*').eq('id', data.session.user.id).single()
        .then(({ data: p }) => setProfile(p))
    })
  }, [navigate])

  function handleSaved() {
    setRefreshKey(k => k + 1)
    setPrefillGroup(null)
    setEditingEntry(null)
    setActiveModule('overview')
  }

  function handleCloseTab() {
    window.close()
  }

  const isMapModule = activeModule === 'map'
  const isManager = profile?.role === 'admin' || profile?.role === 'superadmin'
  const MODULES = isManager ? [...BASE_MODULES, CATEGORY_MANAGER_MODULE] : BASE_MODULES

  return (
    <div className={isMapModule ? 'min-h-screen flex flex-col' : 'min-h-full'} style={{ backgroundColor: '#eef2f7' }}>
      {/* Mobile header */}
      <header className="md:hidden text-white px-4 pt-3 pb-4 relative overflow-hidden shrink-0"
        style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)' }}>
        <div className="flex items-center gap-3 relative z-10">
          <button onClick={() => navigate('/data-center')} className="shrink-0 active:opacity-70 transition-opacity">
            {tenant?.logo_url
              ? <img src={tenant.logo_url} alt="โลโก้" className="w-11 h-11 rounded-full object-contain bg-white/10 p-0.5 border border-white/20" />
              : <div className="w-11 h-11 rounded-full border-2 border-white/40 bg-white/20 flex items-center justify-center"><Database size={18} /></div>}
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm leading-tight truncate">ศูนย์รวมข้อมูลดิจิทัล</p>
            <p className="text-white/60 text-[11px] mt-0.5">{tenant?.name ?? 'Data Center'}</p>
          </div>
          <button onClick={() => navigate('/notifications')} aria-label="การแจ้งเตือน" className="p-1.5 text-white/85 hover:text-white transition-colors shrink-0">
            <Bell size={19} />
          </button>
        </div>
      </header>

      {/* PC header */}
      <header className="hidden md:block relative w-full text-white overflow-hidden shrink-0"
        style={{ background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)' }}>
        <div className="relative z-10 flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/data-center')} className="shrink-0 active:opacity-70 transition-opacity hover:scale-105 transition-transform">
              <div className="w-10 h-10 rounded-full bg-white/10 border-2 border-white/25 flex items-center justify-center">
                <Database size={18} />
              </div>
            </button>
            <div>
              <span className="text-[10px] font-black bg-white/15 text-white px-2 py-0.5 rounded-full tracking-widest uppercase">Data Center</span>
              <p className="text-sm font-bold text-white mt-0.5 leading-tight">ศูนย์รวมข้อมูลดิจิทัล — {tenant?.name}</p>
            </div>
          </div>
          {profile && (
            <div className="flex items-center gap-2">
              <div className="text-right">
                <p className="text-xs font-bold text-white">{profile.full_name}</p>
              </div>
              <button onClick={handleCloseTab} aria-label="ปิดหน้าต่าง"
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors border border-white/20">
                <X size={15} />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Desktop sidebar + main */}
      <div className={isMapModule ? 'md:flex relative flex-1 min-h-0' : 'md:flex relative'}>
        {!sidebarHidden && (
          <aside className="hidden md:flex flex-col w-56 shrink-0 shadow-lg"
            style={{ backgroundColor: '#1a3a5c' }}>
            <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-0.5">
              {MODULES.map(({ key, label, Icon }) => {
                const isActive = activeModule === key
                return (
                  <button key={key} onClick={() => setActiveModule(key)}
                    className={`flex min-h-9 w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60 ${isActive ? 'bg-white/20 text-white shadow-sm' : 'text-white/80 hover:bg-white/10 hover:text-white'}`}>
                    <Icon size={16} strokeWidth={isActive ? 2.2 : 1.8} />
                    <span className="flex-1 text-left text-xs">{label}</span>
                  </button>
                )
              })}
            </nav>
          </aside>
        )}

        {/* ปุ่มพับ/กางเมนูซ้าย — โผล่เฉพาะหน้าแผนที่ (หน้าอื่นเมนูซ้ายแสดงตลอด ไม่ต้องมีปุ่มนี้) */}
        {activeModule === 'map' && (
          <button onClick={() => setMapSidebarOpen(o => !o)} aria-label={mapSidebarOpen ? 'ซ่อนเมนู' : 'แสดงเมนู'}
            className="hidden md:flex absolute top-3 left-3 z-30 items-center justify-center w-9 h-9 rounded-full bg-white shadow-lg border border-gray-200 hover:bg-gray-50 transition-colors">
            {mapSidebarOpen ? <PanelLeftClose size={16} className="text-gray-600" /> : <PanelLeftOpen size={16} className="text-gray-600" />}
          </button>
        )}

        {/* Main — โมดูล "แผนที่" ขอเต็มพื้นที่แบบเดียวกับหน้าแผนที่ฝั่งประชาชน ไม่มี padding/max-width มาบีบ */}
        <main className={isMapModule ? 'flex-1 min-w-0 pb-24 md:pb-0 flex flex-col min-h-0' : 'flex-1 min-w-0 px-4 md:px-6 pb-24 md:pb-6 pt-5'}>
          {isMapModule ? (
            <Suspense fallback={
              <div className="flex min-h-64 items-center justify-center">
                <div className="w-6 h-6 border-4 border-gray-200 rounded-full animate-spin" style={{ borderTopColor: '#3b82f6' }} />
              </div>
            }>
              <DataCenterMap key={refreshKey} tenant={tenant} />
            </Suspense>
          ) : (
            <div className="max-w-5xl mx-auto">
              <Suspense fallback={
                <div className="flex min-h-64 items-center justify-center">
                  <div className="w-6 h-6 border-4 border-gray-200 rounded-full animate-spin" style={{ borderTopColor: '#3b82f6' }} />
                </div>
              }>
                {activeModule === 'overview' && <DataCenterOverview key={refreshKey} tenant={tenant}
                  onAddNew={group => { setPrefillGroup(group ?? null); setActiveModule('add') }}
                  onEditEntry={entry => { setEditingEntry(entry); setActiveModule('add') }} />}
                {activeModule === 'add' && <DataCenterEntryForm tenant={tenant} profile={profile} initialGroup={prefillGroup} editingEntry={editingEntry}
                  onSaved={handleSaved} onCancel={() => { setPrefillGroup(null); setEditingEntry(null); setActiveModule('overview') }} />}
                {activeModule === 'categories' && isManager && <DataCenterCategoryManager key={refreshKey} tenant={tenant} />}
              </Suspense>
            </div>
          )}
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex items-stretch"
        style={{
          background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
          borderTop: '2px solid rgba(255,255,255,0.1)',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.3)',
          borderTopLeftRadius: '20px',
          borderTopRightRadius: '20px',
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 6px)',
        }}>
        {MODULES.map(({ key, label, Icon }) => {
          const isActive = activeModule === key
          return (
            <button key={key} onClick={() => setActiveModule(key)}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 pt-2 pb-1 transition-all active:scale-90">
              <div className="relative w-10 h-9 rounded-xl flex items-center justify-center transition-all duration-200"
                style={{ backgroundColor: isActive ? 'rgba(255,255,255,0.15)' : 'transparent' }}>
                {isActive && <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-4 h-[3px] rounded-full bg-white" />}
                <Icon size={19} strokeWidth={isActive ? 2.2 : 1.6} style={{ color: isActive ? '#fff' : 'rgba(255,255,255,0.4)' }} />
              </div>
              <span className="text-[10px] font-bold leading-tight truncate max-w-[70px]"
                style={{ color: isActive ? '#fff' : 'rgba(255,255,255,0.4)' }}>
                {label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
