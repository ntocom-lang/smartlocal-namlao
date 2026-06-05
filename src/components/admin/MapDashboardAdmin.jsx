import { useEffect, useState, useCallback } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
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

const INFRA_CAT_LABEL = {
  road: 'ถนน', drainage: 'ระบายน้ำ', electrical: 'ไฟฟ้า',
  waterway: 'ลำเหมือง', building: 'อาคาร', irrigation: 'ชลประทาน', other: 'อื่นๆ',
}

const STATUS_TH = {
  pending: 'รอดำเนินการ', received: 'รับเรื่องแล้ว', in_progress: 'กำลังดำเนินการ',
  completed: 'เสร็จสิ้น', rejected: 'ปฏิเสธ',
  planned: 'วางแผนไว้', recorded: 'บันทึกแล้ว', approved: 'อนุมัติแล้ว',
}

// ─── Legend ──────────────────────────────────────────────────────────────────
const LEGEND = [
  { color: '#ef4444', label: 'คำร้อง — รอดำเนินการ' },
  { color: '#f97316', label: 'คำร้อง — กำลังดำเนินการ' },
  { color: '#10b981', label: 'คำร้อง — เสร็จสิ้น' },
  { color: '#3b82f6', label: 'ร้านค้า — รอการอนุมัติ' },
  { color: '#f59e0b', label: 'ร้านค้า — อนุมัติแล้ว' },
  { color: '#7c3aed', label: 'โครงการใหม่ (ตรวจรับงาน)' },
  { color: '#0891b2', label: 'งานซ่อม (หน้างาน)' },
]

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
  const [infraWorks, setInfraWorks] = useState([])
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState(null)

  // filter toggles
  const [showComplaints, setShowComplaints] = useState(true)
  const [showBiz, setShowBiz] = useState(true)
  const [showInfra, setShowInfra] = useState(true)
  const [showCompleted, setShowCompleted] = useState(true)

  const centerLat = tenant?.latitude  ?? 18.2
  const centerLng = tenant?.longitude ?? 100.8

  const fetchAll = useCallback(async () => {
    if (!tenant?.id) return
    setLoading(true)
    const [cmpRes, bizRes, infraRes] = await Promise.all([
      supabase
        .from('complaints')
        .select('id, latitude, longitude, category, form_type, status, detail, created_at, location_name, village, reporter_name')
        .eq('municipality_id', tenant.id)
        .not('latitude', 'is', null)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('business_registrations')
        .select('*')
        .eq('municipality_id', tenant.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('infrastructure_works')
        .select('*')
        .eq('municipality_id', tenant.id)
        .order('work_date', { ascending: false }),
    ])
    setComplaints(cmpRes.data ?? [])
    setBizRegs(bizRes.data ?? [])
    setInfraWorks(infraRes.data ?? [])
    setLoading(false)
  }, [tenant?.id])

  useEffect(() => { fetchAll() }, [fetchAll])

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
    if (!showCompleted && c.status === 'completed') return false
    return true
  })
  const filteredBiz = bizRegs.filter(b => showBiz && b.latitude)
  const filteredInfra = infraWorks.filter(w => showInfra && w.latitude)

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

      {/* Filter toggles */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setShowComplaints(v => !v)}
          className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${showComplaints ? 'bg-red-500 text-white border-red-500' : 'bg-white text-gray-500 border-gray-200'}`}>
          <span className="w-2 h-2 rounded-full bg-current" /> คำร้อง ({complaints.length})
        </button>
        <button onClick={() => setShowCompleted(v => !v)}
          disabled={!showComplaints}
          className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all disabled:opacity-40 ${showCompleted ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white text-gray-500 border-gray-200'}`}>
          แสดงงานเสร็จ
        </button>
        <button onClick={() => setShowBiz(v => !v)}
          className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${showBiz ? 'bg-amber-400 text-white border-amber-400' : 'bg-white text-gray-500 border-gray-200'}`}>
          <span className="w-2 h-2 rounded-full bg-current" /> ร้านค้า ({bizRegs.length})
        </button>
        <button onClick={() => setShowInfra(v => !v)}
          className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${showInfra ? 'bg-violet-500 text-white border-violet-500' : 'bg-white text-gray-500 border-gray-200'}`}>
          <span className="w-2 h-2 rounded-full bg-current" /> งานโยธา ({infraWorks.length})
        </button>
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
                  </div>
                </Popup>
              </CircleMarker>
            ))}

            {/* ── งานโยธา (แยกสีตาม work_type) ── */}
            {filteredInfra.map((w) => (
              <CircleMarker
                key={w.id}
                center={[w.latitude, w.longitude]}
                radius={w.work_type === 'new_project' ? 10 : 8}
                pathOptions={{
                  color: '#fff',
                  weight: 2,
                  fillColor: w.work_type === 'new_project' ? '#7c3aed' : '#0891b2',
                  fillOpacity: 0.9,
                }}
              >
                <Popup>
                  <div className="text-sm min-w-[200px]">
                    <p className="font-bold text-gray-800 mb-0.5">
                      {w.work_type === 'new_project' ? '🏗️' : '🔧'} {w.title}
                    </p>
                    <p className="text-xs font-semibold mb-1"
                       style={{ color: w.work_type === 'new_project' ? '#7c3aed' : '#0891b2' }}>
                      {w.work_type === 'new_project' ? 'โครงการใหม่' : 'งานซ่อม'}
                    </p>
                    <p className="text-gray-500 text-xs">{INFRA_CAT_LABEL[w.category] ?? w.category}</p>
                    {w.contractor && <p className="text-xs text-gray-500 mt-0.5">🏢 {w.contractor}</p>}
                    {w.contract_no && <p className="text-xs text-gray-400">สัญญา: {w.contract_no}</p>}
                    {w.description && (
                      <p className="text-gray-500 text-xs mt-1 line-clamp-2">{w.description}</p>
                    )}
                    {w.budget && (
                      <p className="text-xs text-violet-600 mt-1">
                        💰 {Number(w.budget).toLocaleString('th-TH')} บาท
                      </p>
                    )}
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700">
                        {STATUS_TH[w.status] ?? w.status}
                      </span>
                      <span className="text-xs text-gray-400">
                        {new Date(w.work_date).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })}
                      </span>
                    </div>
                    {w.location_name && (
                      <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                        <MapPin size={10} /> {w.location_name}
                      </p>
                    )}
                  </div>
                </Popup>
              </CircleMarker>
            ))}
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
