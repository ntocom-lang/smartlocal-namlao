import { useEffect, useState, useCallback } from 'react'
import { MapContainer, TileLayer, CircleMarker, Marker, Popup, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../../lib/supabase'
import { RefreshCw, Loader2, CheckCircle2, XCircle, MapPin } from 'lucide-react'

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

// ─── Shape icons (diamond = ร้านค้า, triangle = โครงการ) ─────────────────────
function shapeIcon(shape, color) {
  const w = 18, h = shape === 'diamond' ? 18 : 16
  const svg = shape === 'diamond'
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polygon points="9,1 17,9 9,17 1,9" fill="${color}" stroke="white" stroke-width="2.5"/></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polygon points="9,1 17,15 1,15" fill="${color}" stroke="white" stroke-width="2.5"/></svg>`
  return L.divIcon({ html: svg, className: '', iconSize: [w, h], iconAnchor: [w / 2, h / 2] })
}

// ─── Recenter helper ─────────────────────────────────────────────────────────
function RecenterMap({ lat, lng }) {
  const map = useMap()
  useEffect(() => {
    if (lat && lng) map.setView([lat, lng], 13)
  }, [lat, lng, map])
  return null
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function MapDashboardAdmin({ tenant, currentUserRole }) {
  const [complaints, setComplaints] = useState([])
  const [bizRegs, setBizRegs] = useState([])
  const [civilProjects, setCivilProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState(null)

  // filter toggles
  const [showComplaints, setShowComplaints] = useState(true)
  const [showBiz, setShowBiz]               = useState(true)
  const [showInfra, setShowInfra]           = useState(true)
  const [filterCmpStatus,   setFilterCmpStatus]   = useState('all')
  const [filterCmpCat,      setFilterCmpCat]       = useState('all')
  const [filterProjStatus,  setFilterProjStatus]   = useState('all')
  const [filterProjType,    setFilterProjType]     = useState('all')
  const [showLabels, setShowLabels]                = useState(false)

  function clearFilters() {
    setShowComplaints(true); setShowBiz(true); setShowInfra(true)
    setFilterCmpStatus('all'); setFilterCmpCat('all')
    setFilterProjStatus('all'); setFilterProjType('all')
  }
  const isFiltered = !showComplaints || !showBiz || !showInfra
    || filterCmpStatus !== 'all' || filterCmpCat !== 'all'
    || filterProjStatus !== 'all' || filterProjType !== 'all'

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
        .select('id, title, project_type, status, progress_pct, latitude, longitude, village, budget_amount, created_at, start_date, fiscal_year')
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

  const filteredComplaints = complaints.filter(c => {
    if (!showComplaints) return false
    if (filterCmpStatus !== 'all' && c.status !== filterCmpStatus) return false
    if (filterCmpCat    !== 'all' && c.category !== filterCmpCat)   return false
    return true
  })
  const filteredBiz = bizRegs.filter(b => showBiz && b.latitude)
  const filteredInfra = civilProjects.filter(w => {
    if (!showInfra) return false
    if (filterProjStatus !== 'all' && w.status       !== filterProjStatus) return false
    if (filterProjType   !== 'all' && w.project_type !== filterProjType)   return false
    return true
  })

  const totalPins = filteredComplaints.length + filteredBiz.length + filteredInfra.length
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

      {/* Filter panel */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 space-y-2.5">

        {/* Row 1: ชั้นข้อมูล — visual shape cards */}
        <div className="flex flex-wrap gap-2">
          {[
            { key: 'cmp',  label: 'คำร้อง',  count: complaints.length,     active: showComplaints, toggle: () => setShowComplaints(v => !v), color: '#ef4444',
              shape: <circle cx="7" cy="7" r="5.5" fill="currentColor" stroke="white" strokeWidth="1.5"/> },
            { key: 'biz',  label: 'ร้านค้า', count: bizRegs.length,         active: showBiz,        toggle: () => setShowBiz(v => !v),        color: '#f59e0b',
              shape: <polygon points="7,1 13,7 7,13 1,7" fill="currentColor" stroke="white" strokeWidth="1.5"/> },
            { key: 'proj', label: 'โครงการ', count: civilProjects.length,   active: showInfra,      toggle: () => setShowInfra(v => !v),      color: '#8b5cf6',
              shape: <polygon points="7,1 13,13 1,13" fill="currentColor" stroke="white" strokeWidth="1.5"/> },
          ].map(({ key, label, count, active, toggle, color, shape }) => (
            <button key={key} onClick={toggle}
              className={`flex items-center gap-2 pl-3 pr-4 py-2 rounded-xl border transition-all ${active ? 'shadow-sm' : 'opacity-50 grayscale'}`}
              style={active ? { backgroundColor: color + '12', borderColor: color + '50' } : { backgroundColor: '#f9fafb', borderColor: '#e5e7eb' }}>
              <svg width="14" height="14" viewBox="0 0 14 14" style={{ color: active ? color : '#9ca3af' }}>
                {shape}
              </svg>
              <span className="text-xs font-semibold" style={{ color: active ? color : '#6b7280' }}>{label}</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white min-w-[20px] text-center"
                style={{ backgroundColor: active ? color : '#9ca3af' }}>
                {count}
              </span>
            </button>
          ))}
        </div>

        {/* Row 2: กรองคำร้อง */}
        {showComplaints && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide w-20 shrink-0">สถานะ</span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { v: 'all',         label: 'ทั้งหมด' },
                  { v: 'pending',     label: 'รอดำเนินการ' },
                  { v: 'in_progress', label: 'กำลังดำเนินการ' },
                  { v: 'completed',   label: 'เสร็จสิ้น' },
                  { v: 'rejected',    label: 'ปฏิเสธ' },
                ].map(({ v, label }) => (
                  <button key={v} onClick={() => setFilterCmpStatus(v)}
                    className={`text-xs font-semibold px-3 py-1 rounded-full border transition-all ${filterCmpStatus === v ? 'bg-red-500 border-red-500 text-white' : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-x-3">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide w-20 shrink-0">ประเภท</span>
              <select value={filterCmpCat} onChange={e => setFilterCmpCat(e.target.value)}
                className="text-xs font-medium px-3 py-1.5 rounded-xl border border-gray-200 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-300 min-w-[160px]">
                <option value="all">ทุกประเภท</option>
                {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Row 3: กรองโครงการ */}
        {showInfra && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide w-20 shrink-0">สถานะ</span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { v: 'all',         label: 'ทั้งหมด' },
                  { v: 'planned',     label: 'วางแผน' },
                  { v: 'approved',    label: 'อนุมัติแล้ว' },
                  { v: 'in_progress', label: 'กำลังดำเนินการ' },
                  { v: 'completed',   label: 'แล้วเสร็จ' },
                ].map(({ v, label }) => (
                  <button key={v} onClick={() => setFilterProjStatus(v)}
                    className={`text-xs font-semibold px-3 py-1 rounded-full border transition-all ${filterProjStatus === v ? 'bg-violet-500 border-violet-500 text-white' : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-x-3">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide w-20 shrink-0">ประเภท</span>
              <select value={filterProjType} onChange={e => setFilterProjType(e.target.value)}
                className="text-xs font-medium px-3 py-1.5 rounded-xl border border-gray-200 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-300 min-w-[160px]">
                <option value="all">ทุกประเภท</option>
                <option value="road">ถนน</option>
                <option value="drain">ระบบระบายน้ำ</option>
                <option value="waterway">รางส่งน้ำ</option>
                <option value="building">อาคาร/สิ่งก่อสร้าง</option>
                <option value="light">ไฟฟ้าสาธารณะ</option>
                <option value="park">สวนสาธารณะ/ภูมิทัศน์</option>
                <option value="other">อื่นๆ</option>
              </select>
            </div>
          </div>
        )}

        {/* Row 4: แสดงชื่อ + ล้าง */}
        <div className="flex items-center justify-between pt-0.5">
          <button onClick={() => setShowLabels(v => !v)}
            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full border transition-all ${showLabels ? 'bg-blue-500 border-blue-500 text-white' : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'}`}>
            🏷️ แสดงชื่อ
          </button>
          {isFiltered && (
            <button onClick={clearFilters}
              className="text-xs font-semibold px-3 py-1 rounded-full border border-gray-300 text-gray-500 hover:bg-gray-100 transition-colors">
              ✕ ล้างตัวกรอง
            </button>
          )}
        </div>
      </div>

      {/* Map */}
      <div className="rounded-2xl overflow-hidden shadow-md border border-gray-200"
           style={{ height: '520px' }}>
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
              attribution='&copy; <a href="https://www.openstreetmap.org">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <RecenterMap lat={centerLat} lng={centerLng} />

            {/* ── คำร้อง ── */}
            {filteredComplaints.map((c) => (
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
                    <p className="font-bold text-gray-800 mb-1">
                      {FORM_TYPE_LABEL[c.form_type] ?? '📝 คำร้อง'}
                    </p>
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
            {filteredInfra.map((w) => {
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
                      <p className="font-bold text-gray-800 mb-0.5">🏗️ {w.title}</p>
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
    </div>
  )
}
