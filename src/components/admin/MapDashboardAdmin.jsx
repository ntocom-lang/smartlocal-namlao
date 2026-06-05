import { useEffect, useState, useCallback, useRef } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../../lib/supabase'
import { RefreshCw, Loader2, CheckCircle2, XCircle, MapPin, Maximize2, Minimize2 } from 'lucide-react'

// ─── pin config ──────────────────────────────────────────────────────────────
const COMPLAINT_STATUS_COLOR = {
  pending:     '#ef4444',
  received:    '#f97316',
  in_progress: '#f97316',
  completed:   '#10b981',
  rejected:    '#9ca3af',
}

const FORM_TYPE_LABEL = {
  infrastructure: '🔧 ซ่อมโครงสร้าง',
  water_support:  '💧 ขอสนับสนุนน้ำ',
  environment:    '🌿 สิ่งแวดล้อม',
  legacy:         '📝 คำร้องเดิม',
}

const CATEGORY_LABEL = {
  road: 'ถนน/สะพาน', light: 'ไฟฟ้า', drain: 'ท่อระบายน้ำ', canal: 'ลำเหมือง',
  building: 'สิ่งก่อสร้าง', water_drought: 'ขอน้ำแล้ง', water_tank: 'ถังน้ำหมด',
  water_flood: 'ขอน้ำอุทกภัย', trash: 'ขยะ', tree: 'ต้นไม้', env_hazard: 'จุดเสี่ยง',
  env_fire: 'ควันไฟ', mosquito: 'ยุง', pollution: 'มลพิษ', other: 'อื่นๆ',
}

const BIZ_TYPE_LABEL = {
  shop: '🛍️ ร้านค้า', food: '🍽️ อาหาร', stay: '🏨 ที่พัก',
  otop: '🏺 OTOP', tourism: '📍 ท่องเที่ยว', service: '🔧 บริการ', other: '📝 อื่นๆ',
}

const PROJECT_TYPE_LABEL = {
  road: 'ถนน/สะพาน', drain: 'ระบายน้ำ', bridge: 'สะพาน', light: 'ไฟฟ้า',
  waterway: 'ลำเหมือง', building: 'อาคาร', irrigation: 'ชลประทาน',
  water_supply: 'ประปา', other: 'อื่นๆ',
}

const CIVIL_STATUS_COLOR = {
  planned:     '#9ca3af',
  approved:    '#3b82f6',
  in_progress: '#f97316',
  completed:   '#10b981',
  cancelled:   '#ef4444',
  suspended:   '#f59e0b',
}

const CIVIL_STATUS_TH = {
  planned: 'วางแผน', approved: 'อนุมัติแล้ว', in_progress: 'กำลังดำเนินการ',
  completed: 'แล้วเสร็จ', cancelled: 'ยกเลิก', suspended: 'ระงับชั่วคราว',
}

const STATUS_TH = {
  pending: 'รอดำเนินการ', received: 'รับเรื่องแล้ว', in_progress: 'กำลังดำเนินการ',
  completed: 'เสร็จสิ้น', rejected: 'ปฏิเสธ',
}

// ─── Legend ──────────────────────────────────────────────────────────────────
const LEGEND = [
  { color: '#ef4444', label: 'คำร้อง — รอดำเนินการ' },
  { color: '#f97316', label: 'คำร้อง — กำลังดำเนินการ' },
  { color: '#10b981', label: 'คำร้อง — เสร็จสิ้น' },
  { color: '#3b82f6', label: 'ร้านค้า — รอการอนุมัติ' },
  { color: '#f59e0b', label: 'ร้านค้า — อนุมัติแล้ว' },
  { color: '#9ca3af', label: 'โครงการ — วางแผน' },
  { color: '#f97316', label: 'โครงการ — กำลังดำเนินการ' },
  { color: '#10b981', label: 'โครงการ — แล้วเสร็จ' },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────
function gmapsUrl(lat, lng) {
  return `https://www.google.com/maps?q=${lat},${lng}`
}

function GmapsBtn({ lat, lng }) {
  return (
    <a
      href={gmapsUrl(lat, lng)}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-xs font-semibold border transition-colors"
      style={{ color: '#1a73e8', borderColor: '#dadce0', backgroundColor: '#f8f9fa' }}
      onClick={e => e.stopPropagation()}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="#1a73e8">
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
      </svg>
      แสดงบน Google Maps
    </a>
  )
}


// ─── Recenter helper ─────────────────────────────────────────────────────────
function RecenterMap({ lat, lng }) {
  const map = useMap()
  useEffect(() => {
    if (lat && lng) map.setView([lat, lng], 13)
  }, [lat, lng, map])
  return null
}

// ─── Fullscreen resize helper ─────────────────────────────────────────────────
function FullscreenResizer() {
  const map = useMap()
  useEffect(() => {
    function onFsChange() { setTimeout(() => map.invalidateSize(), 150) }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [map])
  return null
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function MapDashboardAdmin({ tenant, currentUserRole }) {
  const [complaints, setComplaints] = useState([])
  const [bizRegs, setBizRegs] = useState([])
  const [civilProjects, setCivilProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState(null)

  // layer toggles — แยก 5 ประเภทตามหน้าแรก
  const [showRepair, setShowRepair] = useState(true)  // แจ้งซ่อมโครงสร้าง
  const [showWater,  setShowWater]  = useState(true)  // ขอสนับสนุนน้ำ
  const [showEnv,    setShowEnv]    = useState(true)  // สิ่งแวดล้อม
  const [showBiz,    setShowBiz]    = useState(true)  // ร้านค้า/ท่องเที่ยว
  const [showProj,   setShowProj]   = useState(true)  // โครงการ (civil_projects)
  const [filterStatus,     setFilterStatus]     = useState('all')
  const [filterCmpCat,     setFilterCmpCat]     = useState('all')
  const [filterProjStatus, setFilterProjStatus] = useState('all')
  const [filterProjType,   setFilterProjType]   = useState('all')
  const [showLabels, setShowLabels] = useState(false)

  function clearFilters() {
    setShowRepair(true); setShowWater(true); setShowEnv(true)
    setShowBiz(true);    setShowProj(true)
    setFilterStatus('all'); setFilterCmpCat('all')
    setFilterProjStatus('all'); setFilterProjType('all')
  }
  const isFiltered = !showRepair || !showWater || !showEnv || !showBiz || !showProj
    || filterStatus !== 'all' || filterCmpCat !== 'all'
    || filterProjStatus !== 'all' || filterProjType !== 'all'

  const [selectedItem, setSelectedItem] = useState(null) // { type: 'civil'|'complaint', data }
  const [mapType, setMapType] = useState('normal')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const mapWrapRef = useRef(null)

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      mapWrapRef.current?.requestFullscreen?.()
    } else {
      document.exitFullscreen?.()
    }
  }

  useEffect(() => {
    function onFsChange() { setIsFullscreen(!!document.fullscreenElement) }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  const centerLat = tenant?.latitude  ?? 18.2
  const centerLng = tenant?.longitude ?? 100.8

  const tenantId = tenant?.id
  const [refreshTick, setRefreshTick] = useState(0)
  const fetchAll = useCallback(() => {
    setLoading(true)
    setRefreshTick(n => n + 1)
  }, [])

  useEffect(() => {
    if (!tenantId) return
    let cancelled = false
    Promise.all([
      supabase
        .from('complaints')
        .select('id, latitude, longitude, category, form_type, status, detail, created_at, location_name, village, reporter_name')
        .eq('municipality_id', tenantId)
        .not('latitude', 'is', null)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('business_registrations')
        .select('*')
        .eq('municipality_id', tenantId)
        .order('created_at', { ascending: false }),
      supabase
        .from('civil_projects')
        .select('id, title, project_no, project_type, status, progress_pct, latitude, longitude, village, budget_amount, contract_amount, paid_amount, contractor_name, contract_no, description, photos, created_at, start_date, end_date, fiscal_year')
        .eq('municipality_id', tenantId)
        .not('latitude', 'is', null)
        .order('created_at', { ascending: false })
        .limit(500),
    ]).then(([cmpRes, bizRes, infraRes]) => {
      if (!cancelled) {
        setComplaints(cmpRes.data ?? [])
        setBizRegs(bizRes.data ?? [])
        setCivilProjects(infraRes.data ?? [])
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [tenantId, refreshTick])

  async function approveBiz(id, approved) {
    setApproving(id)
    const { data: { session } } = await supabase.auth.getSession()
    await supabase.from('business_registrations').update({
      status: approved ? 'approved' : 'rejected',
      approved_by: session?.user?.id,
      approved_at: new Date().toISOString(),
    }).eq('id', id)
    setBizRegs(prev => prev.map(b => b.id === id
      ? { ...b, status: approved ? 'approved' : 'rejected' }
      : b
    ))
    setApproving(null)
  }

  // count ต้นฉบับสำหรับ badge บน card
  const repairCount = complaints.filter(c => c.form_type === 'infrastructure' || c.form_type === 'legacy').length
  const waterCount  = complaints.filter(c => c.form_type === 'water_support').length
  const envCount    = complaints.filter(c => c.form_type === 'environment').length

  const filteredRepair = complaints.filter(c => {
    if (!showRepair) return false
    if (c.form_type !== 'infrastructure' && c.form_type !== 'legacy') return false
    if (filterStatus !== 'all' && c.status !== filterStatus) return false
    if (filterCmpCat !== 'all' && c.category !== filterCmpCat) return false
    return true
  })
  const filteredWater = complaints.filter(c => {
    if (!showWater) return false
    if (c.form_type !== 'water_support') return false
    if (filterStatus !== 'all' && c.status !== filterStatus) return false
    return true
  })
  const filteredEnv = complaints.filter(c => {
    if (!showEnv) return false
    if (c.form_type !== 'environment') return false
    if (filterStatus !== 'all' && c.status !== filterStatus) return false
    return true
  })
  const filteredBiz = bizRegs.filter(b => {
    if (!showBiz || !b.latitude) return false
    if (filterStatus !== 'all' && b.status !== filterStatus) return false
    return true
  })
  const filteredProj = civilProjects.filter(w => {
    if (!showProj) return false
    if (filterProjStatus !== 'all' && w.status       !== filterProjStatus) return false
    if (filterProjType   !== 'all' && w.project_type !== filterProjType)   return false
    return true
  })

  const totalPins = filteredRepair.length + filteredWater.length + filteredEnv.length
    + filteredBiz.length + filteredProj.length
  const pendingBiz = bizRegs.filter(b => b.status === 'pending')

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-800">แผนที่ข้อมูลพื้นที่</h2>
          <p className="text-sm text-gray-400">{loading ? 'กำลังโหลด...' : `${totalPins} หมุดบนแผนที่`}</p>
        </div>
        <button onClick={fetchAll} disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50 transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          รีเฟรช
        </button>
      </div>

      {/* Filter panel — Government style */}
      <div className="bg-white border border-gray-300 overflow-hidden shadow-sm"
        style={{ borderRadius: '4px', borderTop: '3px solid var(--color-primary)' }}>

        {/* ── หัวข้อ: ชั้นข้อมูล ── */}
        <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200">
          <span className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">ชั้นข้อมูลบนแผนที่</span>
          <span className="text-[10px] text-gray-400">คลิกเพื่อเปิด / ปิด</span>
        </div>

        {/* ชั้นข้อมูล 5 ประเภท */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 border-b border-gray-200">
          {[
            { key: 'repair', active: showRepair, toggle: () => setShowRepair(v => !v), color: '#ef4444', count: repairCount, label: 'แจ้งซ่อมโครงสร้างพื้นฐาน', sub: 'สายด่วนโยธา' },
            { key: 'water',  active: showWater,  toggle: () => setShowWater(v => !v),  color: '#3b82f6', count: waterCount,  label: 'ขอสนับสนุนน้ำอุปโภค',       sub: 'ภัยแล้ง / ภัยพิบัติ' },
            { key: 'env',    active: showEnv,    toggle: () => setShowEnv(v => !v),    color: '#10b981', count: envCount,    label: 'สิ่งแวดล้อม / จุดเสี่ยงภัย', sub: 'Smart Environment' },
            { key: 'biz',    active: showBiz,    toggle: () => setShowBiz(v => !v),    color: '#f59e0b', count: bizRegs.length,       label: 'ร้านค้า / ท่องเที่ยว',        sub: 'Smart Economy' },
            { key: 'proj',   active: showProj,   toggle: () => setShowProj(v => !v),   color: '#8b5cf6', count: civilProjects.length, label: 'โครงการกองช่าง',             sub: 'งานก่อสร้าง / ซ่อมแซม' },
          ].map(({ key, active, toggle, color, count, label, sub }) => (
            <label key={key}
              className="flex items-center gap-3 px-3 py-2.5 cursor-pointer select-none transition-colors border-b sm:border-b-0 sm:border-r border-gray-100 last:border-0"
              style={{ backgroundColor: active ? '#fff' : '#f9fafb' }}>
              <input type="checkbox" checked={active} onChange={toggle} className="sr-only" />
              {/* custom checkbox */}
              <div className="w-4 h-4 border-2 flex items-center justify-center shrink-0 transition-all"
                style={active ? { borderColor: color, backgroundColor: color } : { borderColor: '#d1d5db', backgroundColor: '#fff' }}>
                {active && (
                  <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                    <path d="M1 3.5L3.2 5.8L8 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
              {/* color bar */}
              <div className="w-1 h-8 shrink-0 rounded-sm transition-colors"
                style={{ backgroundColor: active ? color : '#e5e7eb' }} />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-gray-800 leading-tight truncate">{label}</p>
                <p className="text-[10px] text-gray-500 leading-tight">{sub}</p>
              </div>
              <span className="text-[10px] font-bold px-1.5 py-0.5 text-white shrink-0 min-w-[22px] text-center"
                style={{ backgroundColor: active ? color : '#9ca3af', borderRadius: '2px' }}>
                {count}
              </span>
            </label>
          ))}
        </div>

        {/* ── กรองตามประเภทและสถานะ ── */}
        {(showRepair || showWater || showEnv || showBiz || showProj) && (
          <>
            <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
              <span className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">กรองตามประเภท</span>
            </div>
            <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap gap-x-6 gap-y-2.5">
              {showRepair && (
                <div className="flex items-center gap-2.5">
                  <span className="text-[11px] font-bold text-gray-600 shrink-0 w-24">ประเภทคำร้อง</span>
                  <select value={filterCmpCat} onChange={e => setFilterCmpCat(e.target.value)}
                    className="text-xs font-medium px-2.5 py-1.5 border border-gray-300 bg-white text-gray-800 focus:outline-none"
                    style={{ borderRadius: '2px', minWidth: '160px' }}>
                    <option value="all">— ทุกประเภท —</option>
                    {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
              )}
              {(showRepair || showWater || showEnv || showBiz) && (
                <div className="flex items-center gap-2.5">
                  <span className="text-[11px] font-bold text-gray-600 shrink-0 w-24">สถานะคำร้อง</span>
                  <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                    className="text-xs font-medium px-2.5 py-1.5 border border-gray-300 bg-white text-gray-800 focus:outline-none"
                    style={{ borderRadius: '2px', minWidth: '160px' }}>
                    <option value="all">— ทุกสถานะ —</option>
                    <option value="pending">รอดำเนินการ</option>
                    <option value="received">รับเรื่องแล้ว</option>
                    <option value="in_progress">กำลังดำเนินการ</option>
                    <option value="rejected">ปฏิเสธ</option>
                    <option value="cancelled">ยกเลิก</option>
                    <option value="suspended">ระงับชั่วคราว</option>
                  </select>
                </div>
              )}
              {showProj && (
                <div className="flex items-center gap-2.5">
                  <span className="text-[11px] font-bold text-gray-600 shrink-0 w-24">ประเภทโครงการ</span>
                  <select value={filterProjType} onChange={e => setFilterProjType(e.target.value)}
                    className="text-xs font-medium px-2.5 py-1.5 border border-gray-300 bg-white text-gray-800 focus:outline-none"
                    style={{ borderRadius: '2px', minWidth: '160px' }}>
                    <option value="all">— ทุกประเภท —</option>
                    <option value="road">ถนน / สะพาน</option>
                    <option value="drain">ระบบระบายน้ำ</option>
                    <option value="waterway">รางส่งน้ำ / ลำเหมือง</option>
                    <option value="building">อาคาร / สิ่งก่อสร้าง</option>
                    <option value="light">ไฟฟ้าสาธารณะ</option>
                    <option value="park">สวนสาธารณะ / ภูมิทัศน์</option>
                    <option value="other">อื่น ๆ</option>
                  </select>
                </div>
              )}
              {showProj && (
                <div className="flex items-center gap-2.5">
                  <span className="text-[11px] font-bold text-gray-600 shrink-0 w-24">สถานะโครงการ</span>
                  <select value={filterProjStatus} onChange={e => setFilterProjStatus(e.target.value)}
                    className="text-xs font-medium px-2.5 py-1.5 border border-gray-300 bg-white text-gray-800 focus:outline-none"
                    style={{ borderRadius: '2px', minWidth: '160px' }}>
                    <option value="all">— ทุกสถานะ —</option>
                    <option value="planned">วางแผน</option>
                    <option value="approved">อนุมัติแล้ว</option>
                    <option value="in_progress">กำลังดำเนินการ</option>
                    <option value="completed">แล้วเสร็จ</option>
                    <option value="cancelled">ยกเลิก</option>
                    <option value="suspended">ระงับชั่วคราว</option>
                  </select>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── แถบล่าง: แสดงชื่อ + ล้างตัวกรอง ── */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50">
          <label className="flex items-center gap-2 cursor-pointer select-none group">
            <input type="checkbox" checked={showLabels} onChange={() => setShowLabels(v => !v)} className="sr-only" />
            <div className="w-4 h-4 border-2 flex items-center justify-center shrink-0 transition-all"
              style={showLabels
                ? { borderColor: 'var(--color-primary)', backgroundColor: 'var(--color-primary)' }
                : { borderColor: '#d1d5db', backgroundColor: '#fff' }}>
              {showLabels && (
                <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                  <path d="M1 3.5L3.2 5.8L8 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <span className="text-xs font-medium text-gray-700 group-hover:text-gray-900">แสดงชื่อ / ป้ายกำกับบนแผนที่</span>
          </label>
          {isFiltered && (
            <button onClick={clearFilters}
              className="text-xs font-semibold px-3 py-1.5 border border-gray-300 bg-white text-gray-600 hover:bg-gray-100 transition-colors"
              style={{ borderRadius: '2px' }}>
              ล้างตัวกรองทั้งหมด
            </button>
          )}
        </div>
      </div>

      {/* Map */}
      <div ref={mapWrapRef}
           className="relative overflow-hidden shadow-sm border border-gray-300 bg-gray-100"
           style={{ height: isFullscreen ? '100vh' : '520px', borderRadius: isFullscreen ? 0 : '4px' }}>

        {/* ── ปุ่มควบคุมแผนที่ ── */}
        {!loading && (
          <div className="absolute top-3 right-3 z-1000 flex items-center gap-1.5">
            {/* มุมมอง */}
            <div className="flex overflow-hidden shadow-md border border-gray-300 bg-white"
                 style={{ borderRadius: '3px' }}>
              {[
                { v: 'normal',    label: 'แผนที่' },
                { v: 'satellite', label: 'ดาวเทียม' },
              ].map(({ v, label }, i) => (
                <button key={v} onClick={() => setMapType(v)}
                  className="px-3 py-1.5 text-xs font-semibold transition-colors"
                  style={mapType === v
                    ? { backgroundColor: 'var(--color-primary)', color: '#fff', borderRight: i === 0 ? '1px solid rgba(255,255,255,0.3)' : 'none' }
                    : { backgroundColor: '#fff', color: '#374151', borderRight: i === 0 ? '1px solid #d1d5db' : 'none' }}>
                  {label}
                </button>
              ))}
            </div>
            {/* เต็มหน้าจอ */}
            <button onClick={toggleFullscreen}
              title={isFullscreen ? 'ออกจากเต็มหน้าจอ' : 'ขยายเต็มหน้าจอ'}
              className="flex items-center justify-center shadow-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors"
              style={{ width: '30px', height: '30px', borderRadius: '3px' }}>
              {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          </div>
        )}

        {loading ? (
          <div className="w-full h-full bg-gray-100 flex items-center justify-center">
            <Loader2 size={28} className="animate-spin text-gray-400" />
          </div>
        ) : (
          <MapContainer
            center={[centerLat, centerLng]}
            zoom={13}
            style={{ width: '100%', height: '100%' }}
            scrollWheelZoom
          >
            <TileLayer
              key={mapType}
              attribution={mapType === 'satellite'
                ? 'Tiles &copy; Esri &mdash; Esri, i-cubed, USDA, USGS, AEX, GeoEye'
                : '&copy; <a href="https://www.openstreetmap.org">OpenStreetMap</a>'}
              url={mapType === 'satellite'
                ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
                : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'}
            />
            <RecenterMap lat={centerLat} lng={centerLng} />
            <FullscreenResizer />

            {/* ── คำร้อง (3 ประเภทฟอร์ม) ── */}
            {[...filteredRepair, ...filteredWater, ...filteredEnv].map((c) => (
              <CircleMarker
                key={c.id}
                center={[c.latitude, c.longitude]}
                radius={c.status === 'completed' ? 7 : 9}
                pathOptions={{
                  color: '#fff',
                  weight: 2,
                  fillColor: COMPLAINT_STATUS_COLOR[c.status] ?? '#ef4444',
                  fillOpacity: 0.9,
                }}
              >
                {showLabels && (
                  <Tooltip permanent direction="top" offset={[0, -10]}
                    className="bg-white! text-gray-700! text-[10px]! font-semibold! border-gray-200! shadow-sm! px-1.5! py-0.5! rounded-lg!">
                    {CATEGORY_LABEL[c.category] ?? FORM_TYPE_LABEL[c.form_type] ?? 'คำร้อง'}
                  </Tooltip>
                )}
                <Popup>
                  <div className="text-sm min-w-[200px]">
                    <button
                      onClick={() => setSelectedItem({ type: 'complaint', data: c })}
                      className="font-bold text-left w-full mb-1 hover:underline flex items-center gap-1"
                      style={{ color: 'var(--color-primary)' }}>
                      {FORM_TYPE_LABEL[c.form_type] ?? '📝 คำร้อง'}
                      <span className="text-[10px] opacity-60">→</span>
                    </button>
                    <p className="text-gray-600">{CATEGORY_LABEL[c.category] ?? c.category}</p>
                    {c.detail && (
                      <p className="text-gray-500 text-xs mt-1 leading-relaxed line-clamp-3">{c.detail}</p>
                    )}
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{
                          backgroundColor: COMPLAINT_STATUS_COLOR[c.status] + '20',
                          color: COMPLAINT_STATUS_COLOR[c.status],
                        }}>
                        {STATUS_TH[c.status] ?? c.status}
                      </span>
                      <span className="text-xs text-gray-400">
                        {new Date(c.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short' })}
                      </span>
                    </div>
                    {(c.location_name || c.village) && (
                      <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                        <MapPin size={10} /> {c.location_name ?? c.village}
                      </p>
                    )}
                    <GmapsBtn lat={c.latitude} lng={c.longitude} />
                  </div>
                </Popup>
              </CircleMarker>
            ))}

            {/* ── ร้านค้า/ท่องเที่ยว ── */}
            {filteredBiz.map((b) => (
              <CircleMarker
                key={b.id}
                center={[b.latitude, b.longitude]}
                radius={8}
                pathOptions={{
                  color: '#fff',
                  weight: 2,
                  fillColor: b.status === 'approved' ? '#f59e0b' : b.status === 'rejected' ? '#9ca3af' : '#3b82f6',
                  fillOpacity: 0.9,
                }}
              >
                {showLabels && (
                  <Tooltip permanent direction="top" offset={[0, -10]}
                    className="bg-white! text-gray-700! text-[10px]! font-semibold! border-gray-200! shadow-sm! px-1.5! py-0.5! rounded-lg!">
                    {b.business_name}
                  </Tooltip>
                )}
                <Popup>
                  <div className="text-sm min-w-[200px]">
                    <p className="font-bold text-gray-800 mb-0.5">{b.business_name}</p>
                    <p className="text-gray-500 text-xs">{BIZ_TYPE_LABEL[b.business_type] ?? b.business_type}</p>
                    {b.description && (
                      <p className="text-gray-500 text-xs mt-1 line-clamp-2">{b.description}</p>
                    )}
                    {b.phone && <p className="text-xs text-gray-600 mt-1">📞 {b.phone}</p>}
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{
                          backgroundColor: b.status === 'approved' ? '#fef3c7' : b.status === 'rejected' ? '#f3f4f6' : '#dbeafe',
                          color: b.status === 'approved' ? '#d97706' : b.status === 'rejected' ? '#6b7280' : '#1d4ed8',
                        }}>
                        {STATUS_TH[b.status] ?? b.status}
                      </span>
                    </div>
                    {b.status === 'pending' && (currentUserRole === 'admin' || currentUserRole === 'superadmin') && (
                      <div className="flex gap-1.5 mt-2">
                        <button
                          onClick={() => approveBiz(b.id, true)}
                          disabled={approving === b.id}
                          className="flex-1 flex items-center justify-center gap-1 py-1 rounded-lg text-xs font-bold text-white bg-green-500 hover:bg-green-600 disabled:opacity-50">
                          {approving === b.id ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle2 size={10} />}
                          อนุมัติ
                        </button>
                        <button
                          onClick={() => approveBiz(b.id, false)}
                          disabled={approving === b.id}
                          className="flex-1 flex items-center justify-center gap-1 py-1 rounded-lg text-xs font-bold text-white bg-red-400 hover:bg-red-500 disabled:opacity-50">
                          <XCircle size={10} /> ปฏิเสธ
                        </button>
                      </div>
                    )}
                    <GmapsBtn lat={b.latitude} lng={b.longitude} />
                  </div>
                </Popup>
              </CircleMarker>
            ))}

            {/* ── โครงการ (แยกสีตาม status) ── */}
            {filteredProj.map((w) => {
              const statusColor = CIVIL_STATUS_COLOR[w.status] ?? '#9ca3af'
              return (
                <CircleMarker
                  key={w.id}
                  center={[w.latitude, w.longitude]}
                  radius={w.status === 'in_progress' ? 10 : 8}
                  pathOptions={{
                    color: '#fff',
                    weight: 2,
                    fillColor: statusColor,
                    fillOpacity: 0.9,
                  }}
                >
                  {showLabels && (
                    <Tooltip permanent direction="top" offset={[0, -10]}
                      className="bg-white! text-gray-700! text-[10px]! font-semibold! border-gray-200! shadow-sm! px-1.5! py-0.5! rounded-lg!">
                      {w.title.length > 24 ? w.title.slice(0, 24) + '…' : w.title}
                    </Tooltip>
                  )}
                  <Popup>
                    <div className="text-sm min-w-[200px]">
                      <button
                        onClick={() => setSelectedItem({ type: 'civil', data: w })}
                        className="font-bold text-left w-full mb-0.5 hover:underline flex items-center gap-1"
                        style={{ color: 'var(--color-primary)' }}>
                        🏗️ {w.title}
                        <span className="text-[10px] opacity-60">→</span>
                      </button>
                      <p className="text-gray-500 text-xs mb-1">{PROJECT_TYPE_LABEL[w.project_type] ?? w.project_type}</p>
                      {w.progress_pct > 0 && (
                        <div className="mb-1.5">
                          <div className="flex justify-between text-[10px] text-gray-400 mb-0.5">
                            <span>ความคืบหน้า</span>
                            <span>{w.progress_pct}%</span>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all"
                              style={{ width: `${w.progress_pct}%`, backgroundColor: statusColor }} />
                          </div>
                        </div>
                      )}
                      {w.budget_amount && (
                        <p className="text-xs text-violet-600 mb-1">
                          💰 {Number(w.budget_amount).toLocaleString('th-TH')} บาท
                        </p>
                      )}
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: statusColor + '20', color: statusColor }}>
                          {CIVIL_STATUS_TH[w.status] ?? w.status}
                        </span>
                        {w.fiscal_year && (
                          <span className="text-xs text-gray-400">ปี {w.fiscal_year}</span>
                        )}
                      </div>
                      {w.village && (
                        <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                          <MapPin size={10} /> {w.village}
                        </p>
                      )}
                      <GmapsBtn lat={w.latitude} lng={w.longitude} />
                    </div>
                  </Popup>
                </CircleMarker>
              )
            })}
          </MapContainer>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-5 gap-y-2 px-1">
        {LEGEND.map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full shrink-0 border-2 border-white shadow-sm"
                  style={{ backgroundColor: color }} />
            <span className="text-xs text-gray-500">{label}</span>
          </div>
        ))}
      </div>

      {/* Pending business approvals panel */}
      {pendingBiz.length > 0 && (currentUserRole === 'admin' || currentUserRole === 'superadmin') && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-blue-100 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            <h3 className="text-sm font-bold text-blue-800">
              รอการอนุมัติ — ร้านค้า/ท่องเที่ยว ({pendingBiz.length} รายการ)
            </h3>
          </div>
          <div className="divide-y divide-blue-100">
            {pendingBiz.map((b) => (
              <div key={b.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800">{b.business_name}</p>
                  <p className="text-xs text-gray-500">
                    {BIZ_TYPE_LABEL[b.business_type] ?? b.business_type}
                    {b.phone && ` · ${b.phone}`}
                  </p>
                  {b.address && <p className="text-xs text-gray-400 truncate">{b.address}</p>}
                </div>
                {b.images?.[0] && (
                  <img src={b.images[0]} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0" />
                )}
                <div className="flex flex-col gap-1.5 shrink-0">
                  <button
                    onClick={() => approveBiz(b.id, true)}
                    disabled={approving === b.id}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-green-500 hover:bg-green-600 disabled:opacity-50 transition-colors">
                    {approving === b.id ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                    อนุมัติ
                  </button>
                  <button
                    onClick={() => approveBiz(b.id, false)}
                    disabled={approving === b.id}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold text-red-500 bg-red-50 hover:bg-red-100 disabled:opacity-50 transition-colors">
                    <XCircle size={11} /> ปฏิเสธ
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* ── Detail Modal ── */}
      {selectedItem && (() => {
        const iscivil = selectedItem.type === 'civil'
        const d = selectedItem.data
        const statusColor = iscivil
          ? (CIVIL_STATUS_COLOR[d.status] ?? '#9ca3af')
          : (COMPLAINT_STATUS_COLOR[d.status] ?? '#9ca3af')
        const statusLabel = iscivil
          ? (CIVIL_STATUS_TH[d.status] ?? d.status)
          : (STATUS_TH[d.status] ?? d.status)
        const effectivePct = iscivil
          ? (!d.progress_pct && d.status === 'completed' ? 100 : d.progress_pct ?? 0)
          : 0

        return (
          <div className="fixed inset-0 z-9999 flex items-end md:items-center justify-center"
            onClick={() => setSelectedItem(null)}>
            <div className="absolute inset-0 bg-black/50" />
            <div className="relative bg-white w-full md:max-w-lg max-h-[88vh] overflow-y-auto shadow-2xl"
              style={{ borderRadius: '4px 4px 0 0', borderTop: '3px solid var(--color-primary)' }}
              onClick={e => e.stopPropagation()}>

              {/* Header */}
              <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-gray-200">
                <div className="flex-1 min-w-0 pr-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-bold text-white"
                      style={{ backgroundColor: statusColor, borderRadius: '2px' }}>
                      {statusLabel}
                    </span>
                    {iscivil && d.fiscal_year && (
                      <span className="text-[11px] text-gray-400 font-medium">ปีงบ {d.fiscal_year}</span>
                    )}
                  </div>
                  <h3 className="text-base font-bold text-gray-800 leading-snug">
                    {iscivil ? `🏗️ ${d.title}` : (FORM_TYPE_LABEL[d.form_type] ?? '📝 คำร้อง')}
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {iscivil ? (PROJECT_TYPE_LABEL[d.project_type] ?? d.project_type) : (CATEGORY_LABEL[d.category] ?? d.category)}
                    {!iscivil && d.created_at && (
                      <> · {new Date(d.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}</>
                    )}
                  </p>
                </div>
                <button onClick={() => setSelectedItem(null)}
                  className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>

              {/* Body */}
              <div className="px-5 py-4 space-y-3">
                {iscivil ? (
                  <>
                    {/* Progress */}
                    <div className="bg-gray-50 border border-gray-200 p-3" style={{ borderRadius: '3px' }}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-gray-600">ความคืบหน้าโครงการ</span>
                        <span className="text-sm font-bold" style={{ color: statusColor }}>{effectivePct}%</span>
                      </div>
                      <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all"
                          style={{ width: `${effectivePct}%`, backgroundColor: statusColor }} />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* ที่ตั้งโครงการ */}
                      <div className="border border-gray-200 p-3" style={{ borderRadius: '3px' }}>
                        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                          ที่ตั้งโครงการ
                        </p>
                        {d.village && (
                          <p className="text-xs text-gray-700 mb-0.5">
                            หมู่บ้าน/ชุมชน: <span className="font-semibold">{d.village}</span>
                          </p>
                        )}
                        {d.latitude && d.longitude && (
                          <a href={gmapsUrl(d.latitude, d.longitude)} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1 mt-1.5 text-[11px] font-mono text-blue-600 hover:underline">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="#1a73e8"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
                            {d.latitude.toFixed(6)}, {d.longitude.toFixed(6)}
                          </a>
                        )}
                      </div>

                      {/* ระยะเวลา */}
                      <div className="border border-gray-200 p-3" style={{ borderRadius: '3px' }}>
                        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                          ระยะเวลา
                        </p>
                        {d.start_date && (
                          <MiniRow label="วันที่เริ่มต้น"
                            value={new Date(d.start_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })} />
                        )}
                        {d.end_date && (
                          <MiniRow label="วันที่สิ้นสุด"
                            value={new Date(d.end_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })} />
                        )}
                        {d.created_at && (
                          <MiniRow label="วันที่บันทึก"
                            value={new Date(d.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })} />
                        )}
                      </div>

                      {/* งบประมาณ */}
                      {(d.budget_amount || d.contract_amount || d.paid_amount) && (
                        <div className="border border-gray-200 p-3" style={{ borderRadius: '3px' }}>
                          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                            งบประมาณ
                          </p>
                          {d.budget_amount && (
                            <MiniRow label="วงเงินงบประมาณ" value={`฿${Number(d.budget_amount).toLocaleString('th-TH')}`} highlight />
                          )}
                          {d.contract_amount && (
                            <MiniRow label="ค่าสัญญา" value={`฿${Number(d.contract_amount).toLocaleString('th-TH')}`} />
                          )}
                          {d.paid_amount && (
                            <MiniRow label="เบิกจ่ายแล้ว" value={`฿${Number(d.paid_amount).toLocaleString('th-TH')}`} />
                          )}
                        </div>
                      )}

                      {/* ผู้รับจ้าง */}
                      {(d.contractor_name || d.contract_no) && (
                        <div className="border border-gray-200 p-3" style={{ borderRadius: '3px' }}>
                          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
                            ผู้รับจ้าง
                          </p>
                          {d.contractor_name && <MiniRow label="ชื่อผู้รับจ้าง" value={d.contractor_name} />}
                          {d.contract_no && <MiniRow label="เลขที่สัญญา" value={d.contract_no} />}
                        </div>
                      )}
                    </div>

                    {/* รายละเอียด */}
                    {d.description && (
                      <div className="border border-gray-200 p-3" style={{ borderRadius: '3px' }}>
                        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">รายละเอียด</p>
                        <p className="text-sm text-gray-700 leading-relaxed">{d.description}</p>
                      </div>
                    )}

                    {/* รูปภาพ */}
                    {d.photos?.length > 0 && (
                      <div className="border border-gray-200 p-3" style={{ borderRadius: '3px' }}>
                        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">รูปภาพโครงการ</p>
                        <div className="grid grid-cols-3 gap-1.5">
                          {d.photos.slice(0, 6).map((url, i) => (
                            <a key={i} href={url} target="_blank" rel="noreferrer">
                              <img src={url} alt="" className="w-full aspect-square object-cover rounded" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {d.reporter_name && <Row label="ผู้แจ้ง" value={d.reporter_name} />}
                    {d.location_name && <Row label="สถานที่" value={d.location_name} />}
                    {d.village && <Row label="หมู่บ้าน" value={d.village} />}
                    {d.detail && (
                      <div className="py-2.5">
                        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">รายละเอียด</p>
                        <p className="text-sm text-gray-700 leading-relaxed">{d.detail}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Footer actions */}
              <div className="px-5 pb-5 pt-3 border-t border-gray-100 flex gap-2 flex-wrap">
                <a href={gmapsUrl(d.latitude, d.longitude)} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition-colors"
                  style={{ borderRadius: '2px' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="#1a73e8"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
                  Google Maps
                </a>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function Row({ label, value, highlight }) {
  return (
    <div className="flex items-baseline gap-3 py-2.5">
      <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide w-28 shrink-0">{label}</span>
      <span className="text-sm font-semibold" style={{ color: highlight ? 'var(--color-primary)' : '#1f2937' }}>{value}</span>
    </div>
  )
}

function MiniRow({ label, value, highlight }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="text-[10px] text-gray-400 w-20 shrink-0">{label}</span>
      <span className="text-xs font-semibold" style={{ color: highlight ? 'var(--color-primary)' : '#374151' }}>{value}</span>
    </div>
  )
}
