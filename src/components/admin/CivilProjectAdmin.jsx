import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  MapPin, Plus, X, Loader2, Trash2, Pencil, ChevronLeft,
  Image, AlertTriangle, CheckCircle2, Calendar, Banknote, Building2,
  Search, Clock, Upload, ChevronRight, Camera, Navigation, Copy, Check, Layers, Maximize2, Minimize2,
} from 'lucide-react'
import { MapContainer, TileLayer, Marker, Tooltip, Polyline, CircleMarker } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../../lib/supabase'
import MapPicker from '../MapPicker'
import InlineMapPicker from '../InlineMapPicker'
import InlinePolylinePicker from '../InlinePolylinePicker'

// Fix leaflet default marker icon
const defaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

const THIS_YEAR = new Date().getFullYear() + 543
const ROUTE_STYLE = {
  road:          { color: '#374151', weight: 5, dashArray: null },
  road_concrete: { color: '#6b7280', weight: 6, dashArray: null },
  road_asphalt:  { color: '#292524', weight: 5, dashArray: null },
  road_slurry:   { color: '#92400e', weight: 4, dashArray: '12, 4' },
  road_gravel:   { color: '#d97706', weight: 4, dashArray: '3, 6' },
  drain:         { color: '#3b82f6', weight: 4, dashArray: '10, 5' },
  dredge:        { color: '#06b6d4', weight: 4, dashArray: '2, 4' },
  canal:         { color: '#0369a1', weight: 4, dashArray: '15,5,3,5' },
  pipe_water:    { color: '#1d4ed8', weight: 3, dashArray: '5, 3' },
  waterway:      { color: '#0ea5e9', weight: 4, dashArray: '3, 7' },
}
const LINEAR_TYPES = Object.keys(ROUTE_STYLE)
const ROUTE_DASH = Object.fromEntries(Object.entries(ROUTE_STYLE).map(([k, v]) => [k, v.dashArray]))

const ROUTE_COLORS = [
  { hex: '#3b82f6', label: 'น้ำเงิน' },
  { hex: '#22c55e', label: 'เขียว' },
  { hex: '#ef4444', label: 'แดง' },
  { hex: '#f97316', label: 'ส้ม' },
  { hex: '#a855f7', label: 'ม่วง' },
  { hex: '#eab308', label: 'เหลือง' },
  { hex: '#06b6d4', label: 'ฟ้า' },
  { hex: '#ec4899', label: 'ชมพู' },
  { hex: '#92400e', label: 'น้ำตาล' },
  { hex: '#1f2937', label: 'ดำ' },
]
const FISCAL_YEARS = Array.from({ length: 8 }, (_, i) => String(THIS_YEAR - 3 + i))

const STATUS_CFG = {
  planned:     { label: 'วางแผน',          color: '#64748b', bg: '#f1f5f9', text: '#475569', autoProgress: 0,    canEdit: false, needsReason: false },
  approved:    { label: 'อนุมัติแล้ว',      color: '#3b82f6', bg: '#dbeafe', text: '#1e40af', autoProgress: 0,    canEdit: false, needsReason: false },
  in_progress: { label: 'กำลังดำเนินการ',  color: '#f97316', bg: '#ffedd5', text: '#9a3412', autoProgress: null, canEdit: true,  needsReason: false },
  completed:   { label: 'แล้วเสร็จ',       color: '#10b981', bg: '#d1fae5', text: '#065f46', autoProgress: 100,  canEdit: false, needsReason: false },
  cancelled:   { label: 'ยกเลิก',          color: '#ef4444', bg: '#fee2e2', text: '#991b1b', autoProgress: null, canEdit: false, needsReason: true  },
  suspended:   { label: 'ระงับชั่วคราว',   color: '#f59e0b', bg: '#fef3c7', text: '#92400e', autoProgress: null, canEdit: false, needsReason: true  },
}

const PROJECT_TYPES = [
  // ถนน
  { value: 'road_concrete', label: 'ถนน ค.ส.ล.',          icon: '🛣️', group: 'ถนน' },
  { value: 'road_asphalt',  label: 'ลาดยางแอสฟัลท์',       icon: '🛣️', group: 'ถนน' },
  { value: 'road_slurry',   label: 'ฉาบผิวสเลอรี่ซิล',     icon: '🛣️', group: 'ถนน' },
  { value: 'road_gravel',   label: 'หินคลุก',               icon: '🛣️', group: 'ถนน' },
  // น้ำ
  { value: 'drain',         label: 'รางระบายน้ำ',           icon: '🌊', group: 'น้ำ' },
  { value: 'dredge',        label: 'ขุดลอก',                icon: '⛏️', group: 'น้ำ' },
  { value: 'canal',         label: 'รางน้ำ/ลำเหมือง',       icon: '💧', group: 'น้ำ' },
  { value: 'pipe_water',    label: 'ท่อน้ำประปา',            icon: '🚰', group: 'น้ำ' },
  // อื่นๆ
  { value: 'building',      label: 'อาคาร/สิ่งก่อสร้าง',   icon: '🏗️', group: '' },
  { value: 'light',         label: 'ไฟฟ้าสาธารณะ',         icon: '💡', group: '' },
  { value: 'park',          label: 'สวนสาธารณะ/ภูมิทัศน์', icon: '🌳', group: '' },
  { value: 'other',         label: 'อื่นๆ',                 icon: '📝', group: '' },
]

const DEPARTMENTS = [
  { value: 'civil',   label: 'กองช่าง' },
  { value: 'sp',      label: 'สำนักปลัด' },
  { value: 'edu',     label: 'กองการศึกษา' },
  { value: 'finance', label: 'กองคลัง' },
  { value: 'other',   label: 'หน่วยงานอื่น' },
]

const EMPTY_FORM = {
  project_no: '', fiscal_year: String(THIS_YEAR), title: '', description: '',
  project_type: 'road_concrete', status: 'planned', department: 'civil', progress_pct: 0,
  village: '', subdistrict: '', district: '', province: '', location_desc: '',
  budget_amount: '', contract_amount: '', paid_amount: '',
  contractor_name: '', contract_no: '',
  start_date: '', end_date: '',
  cancel_reason: '', note: '', route_color: ROUTE_STYLE.road_concrete.color,
}

function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status]
  if (!cfg) return null
  return (
    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
          style={{ backgroundColor: cfg.bg, color: cfg.text }}>
      {cfg.label}
    </span>
  )
}

function ProgressBar({ pct, status }) {
  const color = STATUS_CFG[status]?.color ?? '#3b82f6'
  const displayPct = status === 'completed' ? 100 : (pct || 0)
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all"
             style={{ width: `${displayPct}%`, backgroundColor: color }} />
      </div>
      <span className="text-[10px] font-bold text-gray-400 shrink-0">{displayPct}%</span>
    </div>
  )
}

function Field({ label, required, children, half }) {
  return (
    <div className={half ? '' : 'col-span-2'}>
      {label && (
        <label className="block text-xs font-semibold text-gray-500 mb-1">
          {label}{required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
      )}
      {children}
    </div>
  )
}

/* ── Detail info row ── */
function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between py-1.5">
      <span className="text-sm text-gray-400">{label}</span>
      <span className="text-sm font-medium text-gray-700 text-right">{value || '-'}</span>
    </div>
  )
}

/* ── Detail Map with layer switcher ── */
const TILE_STREET = {
  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}
const TILE_SATELLITE = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution: '&copy; Esri',
}
const TILE_LABELS = {
  url: 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png',
  subdomains: 'abcd',
}

function LayerControl({ mode, setMode, onExpand, isFullscreen }) {
  return (
    <div className="absolute top-2 right-2 z-1000 flex flex-col gap-1.5">
      <button type="button" onClick={onExpand}
        className="w-8 h-8 bg-white rounded-lg shadow border border-gray-100 flex items-center justify-center hover:bg-gray-50 transition-colors">
        {isFullscreen ? <Minimize2 size={15} className="text-gray-600" /> : <Maximize2 size={15} className="text-gray-600" />}
      </button>
      <button type="button" onClick={() => setMode(m => m === 'street' ? 'satellite' : 'street')}
        className="w-8 h-8 bg-white rounded-lg shadow border border-gray-100 flex items-center justify-center hover:bg-gray-50 transition-colors"
        title={mode === 'street' ? 'เปลี่ยนเป็นดาวเทียม' : 'เปลี่ยนเป็นแผนที่ปกติ'}>
        <Layers size={15} className="text-gray-600" />
      </button>
    </div>
  )
}

function DetailMap({ lat, lng, title, routePoints, routeColor = '#3b82f6', projectType }) {
  const [tileMode, setTileMode]   = useState('street')
  const [copied, setCopied]       = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const tile = tileMode === 'satellite' ? TILE_SATELLITE : TILE_STREET

  const handleCopy = () => {
    navigator.clipboard.writeText(`${lat.toFixed(6)}, ${lng.toFixed(6)}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const navButtons = (
    <div className="absolute bottom-3 left-3 z-1000 flex items-center gap-2">
      <a href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`}
        target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl shadow-lg text-sm font-bold transition-colors">
        <Navigation size={14} /> นำทาง
      </a>
      <a href={`https://www.google.com/maps?q=${lat},${lng}`}
        target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-gray-50 text-gray-700 rounded-xl shadow-lg border border-gray-200 text-sm font-bold transition-colors">
        <MapPin size={14} /> แสดงบน Google Maps
      </a>
    </div>
  )

  const hasRoute = routePoints?.length >= 2

  function markerColor(i) {
    if (i === 0) return '#22c55e'
    if (i === routePoints.length - 1) return '#ef4444'
    return routeColor
  }

  const center = hasRoute
    ? [routePoints[Math.floor(routePoints.length / 2)].lat, routePoints[Math.floor(routePoints.length / 2)].lng]
    : [lat, lng]

  const mapContent = (zoom) => (
    <>
      <TileLayer key={tileMode} url={tile.url} attribution={tile.attribution} />
      {tileMode === 'satellite' && (
        <TileLayer key="labels" url={TILE_LABELS.url} subdomains={TILE_LABELS.subdomains} attribution="" />
      )}
      {hasRoute ? (
        <>
          <Polyline positions={routePoints.map(p => [p.lat, p.lng])}
            pathOptions={{ color: routeColor, weight: 5, opacity: 0.85, ...(ROUTE_DASH[projectType] && { dashArray: ROUTE_DASH[projectType] }) }} />
          {null}
        </>
      ) : (
        <Marker position={[lat, lng]} icon={defaultIcon}>
          <Tooltip permanent direction="top" offset={[0, -36]}
            className="bg-white! border! border-gray-200! shadow-md! rounded-lg! px-3! py-1.5! text-sm! font-medium! text-gray-700!">
            {title}
          </Tooltip>
        </Marker>
      )}
    </>
  )

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3">
        <MapPin size={16} className="text-blue-500" />
        <h3 className="font-bold text-gray-700">ที่ตั้งบนแผนที่</h3>
        <button onClick={handleCopy}
          className="ml-auto flex items-center gap-1.5 text-sm font-mono font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1 rounded-xl border border-blue-100 transition-colors"
          title="คัดลอกพิกัด">
          {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
          {copied ? 'คัดลอกแล้ว' : `${lat.toFixed(6)}, ${lng.toFixed(6)}`}
        </button>
      </div>
      <div style={{ height: 300, position: 'relative' }}>
        <MapContainer center={center} zoom={15} style={{ width: '100%', height: '100%' }} scrollWheelZoom zoomControl>
          {mapContent(15)}
        </MapContainer>
        <LayerControl mode={tileMode} setMode={setTileMode} onExpand={() => setFullscreen(true)} isFullscreen={false} />
        {navButtons}
      </div>

      {fullscreen && createPortal(
        <div className="fixed inset-0 z-9999 flex flex-col bg-black">
          <div className="flex items-center justify-between px-4 py-3 bg-gray-900 text-white shrink-0">
            <span className="text-sm font-semibold truncate">{title}</span>
            <button type="button" onClick={() => setFullscreen(false)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-medium transition-colors shrink-0">
              <Minimize2 size={14} /> ย่อแผนที่
            </button>
          </div>
          <div className="relative flex-1">
            <MapContainer center={center} zoom={16} style={{ width: '100%', height: '100%' }} scrollWheelZoom zoomControl>
              {mapContent(16)}
            </MapContainer>
            <LayerControl mode={tileMode} setMode={setTileMode} onExpand={() => setFullscreen(false)} isFullscreen />
            {navButtons}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

const inputCls = 'w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-300'
const selectCls = inputCls

export default function CivilProjectAdmin({ tenant, currentUserRole }) {
  const [view, setView]     = useState('list')   // 'list' | 'detail' | 'form'
  const [editId, setEditId] = useState(null)
  const [projects, setProjects] = useState(null) // null = กำลังโหลด
  const loading = projects === null
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterYear, setFilterYear]     = useState('all')
  const [filterType, setFilterType]     = useState('all')
  const [searchQuery, setSearchQuery]   = useState('')

  const [selectedProject, setSelectedProject] = useState(null)

  const [form, setForm]                 = useState({ ...EMPTY_FORM })
  const [geo, setGeo]                   = useState({ lat: null, lng: null })
  const [routePoints, setRoutePoints]   = useState([])
  const [photos, setPhotos]             = useState([])
  const [existingPhotos, setExisting]   = useState([])
  const [showMap, setShowMap]           = useState(false)
  const [locations, setLocations]       = useState([])
  const [submitting, setSubmitting]     = useState(false)
  const [formError, setFormError]       = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  // Detail-view photo upload
  const [detailPhotoFile, setDetailPhotoFile]     = useState(null)
  const [detailPhotoDesc, setDetailPhotoDesc]     = useState('')
  const [detailPhotoPhase, setDetailPhotoPhase]   = useState('after')
  const [uploadingPhoto, setUploadingPhoto]       = useState(false)

  // Progress log
  const [progressNote, setProgressNote]   = useState('')
  const [progressStatus, setProgressStatus] = useState('planned')
  const [progressPct, setProgressPct]     = useState(0)
  const [savingProgress, setSavingProgress] = useState(false)

  const isReadOnly = currentUserRole === 'viewer' || currentUserRole === 'council'
  const canDelete  = currentUserRole === 'admin' || currentUserRole === 'superadmin'

  const tenantId = tenant?.id
  const [refreshTick, setRefreshTick] = useState(0)
  const fetchProjects = useCallback(() => {
    setProjects(null)
    setRefreshTick(n => n + 1)
  }, [])

  useEffect(() => {
    if (!tenantId) return
    let cancelled = false
    let q = supabase.from('civil_projects').select('*').eq('municipality_id', tenantId)
    if (filterStatus !== 'all') q = q.eq('status', filterStatus)
    if (filterYear  !== 'all') q = q.eq('fiscal_year', filterYear)
    if (filterType  !== 'all') q = q.eq('project_type', filterType)
    if (searchQuery.trim()) q = q.ilike('title', `%${searchQuery.trim()}%`)
    q.order('created_at', { ascending: false }).limit(200).then(({ data }) => {
      if (!cancelled) setProjects(data ?? [])
    })
    
    // Fetch locations for village dropdown
    supabase.from('locations').select('id, name').eq('municipality_id', tenantId).order('sort_order').then(({ data }) => {
      if (!cancelled) setLocations(data ?? [])
    })

    return () => { cancelled = true }
  }, [tenantId, filterStatus, filterYear, filterType, searchQuery, refreshTick])

  function handleStatusChange(newStatus) {
    const cfg = STATUS_CFG[newStatus]
    setForm(p => ({
      ...p,
      status: newStatus,
      progress_pct: cfg.autoProgress !== null ? cfg.autoProgress : p.progress_pct,
    }))
  }

  function openCreate() {
    let sd = '', dt = '', pv = tenant?.province || ''
    
    const addressStr = tenant?.address || 'เลขที่ 101 หมู่ที่ 5 ตำบลน้ำเลา\nอำเภอร้องกวาง จังหวัดแพร่ 54140'
    const s = addressStr.match(/ตำบล\s*([^\s\n]+)/)
    const d = addressStr.match(/อำเภอ\s*([^\s\n]+)/)
    const p = addressStr.match(/จังหวัด\s*([^\s\n0-9]+)/)
    
    if (s) sd = s[1]
    if (d) dt = d[1]
    if (p && !pv) pv = p[1]

    if (!sd && tenant?.name?.includes('ตำบล')) {
      sd = tenant.name.split('ตำบล')[1].trim()
    }

    setEditId(null)
    setForm({ ...EMPTY_FORM, subdistrict: sd, district: dt, province: pv })
    setGeo({ lat: null, lng: null })
    setRoutePoints([])
    setPhotos([])
    setExisting([])
    setFormError(null)
    setView('form')
  }

  function openEdit(p) {
    setEditId(p.id)
    setForm({
      project_no: p.project_no ?? '', fiscal_year: p.fiscal_year, title: p.title,
      description: p.description ?? '', project_type: p.project_type,
      status: p.status, department: p.department ?? 'civil', progress_pct: p.status === 'completed' ? 100 : (p.progress_pct || 0),
      village: p.village ?? '', subdistrict: p.subdistrict ?? '',
      district: p.district ?? '', province: p.province ?? '',
      location_desc: p.location_desc ?? '',
      budget_amount: p.budget_amount ?? '', contract_amount: p.contract_amount ?? '',
      paid_amount: p.paid_amount ?? '', contractor_name: p.contractor_name ?? '',
      contract_no: p.contract_no ?? '', start_date: p.start_date ?? '',
      end_date: p.end_date ?? '', cancel_reason: p.cancel_reason ?? '', note: p.note ?? '',
      route_color: p.route_color || '#3b82f6',
    })
    setGeo({ lat: p.latitude ?? null, lng: p.longitude ?? null })
    setRoutePoints(p.route_points ?? [])
    setExisting(p.photos ?? [])
    setPhotos([])
    setFormError(null)
    setView('form')
  }

  function openDetail(p) {
    setSelectedProject(p)
    setProgressStatus(p.status)
    setProgressPct(p.status === 'completed' ? 100 : (p.progress_pct || 0))
    setProgressNote('')
    setDetailPhotoFile(null)
    setDetailPhotoDesc('')
    setView('detail')
  }

  async function uploadPhotos(newPhotos, id) {
    const urls = []
    for (const item of newPhotos) {
      const ext  = item.file.name.split('.').pop()
      const path = `civil/${id}/${Date.now()}.${ext}`
      const { error } = await supabase.storage.from('complaint-attachments').upload(path, item.file)
      if (!error) {
        const { data } = supabase.storage.from('complaint-attachments').getPublicUrl(path)
        urls.push(data.publicUrl)
      }
    }
    return urls
  }

  function addPhotos(e) {
    const files = Array.from(e.target.files ?? [])
    const items = files.map(f => ({ file: f, preview: URL.createObjectURL(f) }))
    setPhotos(prev => [...prev, ...items].slice(0, 5))
    e.target.value = ''
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim())     { setFormError('กรุณาระบุชื่อโครงการ'); return }
    if (!form.fiscal_year)      { setFormError('กรุณาเลือกปีงบประมาณ'); return }
    const needsReason = STATUS_CFG[form.status]?.needsReason
    if (needsReason && !form.cancel_reason.trim()) {
      setFormError('กรุณาระบุสาเหตุของการยกเลิก/ระงับโครงการ')
      return
    }
    setFormError(null)
    setSubmitting(true)
    const { data: { session } } = await supabase.auth.getSession()
    const id       = editId ?? crypto.randomUUID()
    const newUrls  = await uploadPhotos(photos, id)
    const allPhotos = [...existingPhotos, ...newUrls]
    // road projects: use midpoint of route as primary lat/lng
    let primaryLat = geo.lat, primaryLng = geo.lng
    if (form.project_type === 'road' && routePoints.length > 0) {
      const mid = routePoints[Math.floor(routePoints.length / 2)]
      primaryLat = mid.lat
      primaryLng = mid.lng
    }

    const record = {
      municipality_id: tenant.id,
      created_by:      session.user.id,
      project_no:      form.project_no?.trim()      || null,
      fiscal_year:     form.fiscal_year,
      title:           form.title.trim(),
      description:     form.description?.trim()     || null,
      project_type:    form.project_type,
      status:          form.status,
      department:      form.department,
      progress_pct:    Number(form.progress_pct),
      village:         form.village?.trim()         || null,
      subdistrict:     form.subdistrict?.trim()     || null,
      district:        form.district?.trim()        || null,
      province:        form.province?.trim()        || null,
      location_desc:   form.location_desc?.trim()   || null,
      latitude:        primaryLat ?? null,
      longitude:       primaryLng ?? null,
      route_points:    LINEAR_TYPES.includes(form.project_type) && routePoints.length >= 2 ? routePoints : null,
      route_color:     LINEAR_TYPES.includes(form.project_type) ? (form.route_color || '#3b82f6') : null,
      budget_amount:   form.budget_amount   ? parseFloat(form.budget_amount)   : null,
      contract_amount: form.contract_amount ? parseFloat(form.contract_amount) : null,
      paid_amount:     form.paid_amount     ? parseFloat(form.paid_amount)     : null,
      contractor_name: form.contractor_name?.trim() || null,
      contract_no:     form.contract_no?.trim()     || null,
      start_date:      form.start_date || null,
      end_date:        form.end_date   || null,
      cancel_reason:   form.cancel_reason?.trim()   || null,
      photos:          allPhotos,
      note:            form.note?.trim()            || null,
      updated_at:      new Date().toISOString(),
    }
    let dbErr
    if (editId) {
      const { error } = await supabase.from('civil_projects').update(record).eq('id', editId)
      dbErr = error
    } else {
      const { error } = await supabase.from('civil_projects').insert({ id, ...record })
      dbErr = error
    }
    setSubmitting(false)
    if (dbErr) { setFormError(`บันทึกไม่สำเร็จ: ${dbErr.message}`); return }

    // If editing from detail view, refresh and go back to detail
    if (editId) {
      const { data: updated } = await supabase.from('civil_projects').select('*').eq('id', editId).single()
      if (updated) {
        setSelectedProject(updated)
        setView('detail')
      } else {
        setView('list')
      }
    } else {
      setView('list')
    }
    setEditId(null)
    fetchProjects()
  }

  async function deleteProject(id) {
    await supabase.from('civil_projects').delete().eq('id', id)
    setDeleteConfirm(null)
    setView('list')
    fetchProjects()
  }

  // Photo upload from detail view
  async function handleDetailPhotoUpload() {
    if (!detailPhotoFile || !selectedProject) return
    setUploadingPhoto(true)
    const ext = detailPhotoFile.name.split('.').pop()
    const path = `civil/${selectedProject.id}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('complaint-attachments').upload(path, detailPhotoFile)
    if (!error) {
      const { data: urlData } = supabase.storage.from('complaint-attachments').getPublicUrl(path)
      const newPhotos = [...(selectedProject.photos ?? []), urlData.publicUrl]
      await supabase.from('civil_projects').update({ photos: newPhotos, updated_at: new Date().toISOString() }).eq('id', selectedProject.id)
      setSelectedProject(p => ({ ...p, photos: newPhotos }))
      setDetailPhotoFile(null)
      setDetailPhotoDesc('')
    }
    setUploadingPhoto(false)
  }

  // Save progress update from detail view
  async function handleSaveProgress() {
    if (!selectedProject) return
    setSavingProgress(true)
    const updates = {
      status: progressStatus,
      progress_pct: Number(progressPct),
      note: progressNote.trim() ? `${selectedProject.note ? selectedProject.note + '\n' : ''}[${new Date().toLocaleDateString('th-TH')}] ${progressNote.trim()}` : selectedProject.note,
      updated_at: new Date().toISOString(),
    }
    await supabase.from('civil_projects').update(updates).eq('id', selectedProject.id)
    setSelectedProject(p => ({ ...p, ...updates }))
    setProgressNote('')
    setSavingProgress(false)
    fetchProjects()
  }

  const typeLabel = (t) => PROJECT_TYPES.find(x => x.value === t)?.label ?? t
  const deptLabel = (d) => DEPARTMENTS.find(x => x.value === d)?.label ?? d
  const fmt = (n) => n != null ? Number(n).toLocaleString('th-TH') : '—'
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : ''

  const locationStr = (p) => {
    const parts = [p.village, p.subdistrict, p.district, p.province].filter(Boolean)
    return parts.join(', ') || '-'
  }

  // ─── LIST VIEW ──────────────────────────────────────────────────────────────
  if (view === 'list') return (
    <div className="space-y-5">

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-5 shadow-xl max-w-xs w-full space-y-4">
            <p className="font-bold text-gray-800">ลบโครงการนี้?</p>
            <p className="text-sm text-gray-500 truncate">{deleteConfirm.title}</p>
            <div className="flex gap-2">
              <button onClick={() => deleteProject(deleteConfirm.id)}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-red-500 hover:bg-red-600">ลบ</button>
              <button onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2.5 rounded-xl text-sm text-gray-500 bg-gray-100 hover:bg-gray-200">ยกเลิก</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-800">รายการโครงการ</h2>
          <p className="text-sm text-gray-400 mt-0.5">ทั้งหมด {(projects ?? []).length} โครงการ</p>
        </div>
        {!isReadOnly && (
          <button onClick={openCreate}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold text-white"
            style={{ backgroundColor: '#3b82f6' }}>
            <Plus size={14} /> เพิ่มโครงการ
          </button>
        )}
      </div>

      {/* Filter row */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[160px]">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="ค้นหาชื่อโครงการ..."
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
            />
          </div>
          <div className="min-w-[140px]">
            <select value={filterYear} onChange={e => setFilterYear(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200">
              <option value="all">ทุกปีงบประมาณ</option>
              {FISCAL_YEARS.map(y => <option key={y} value={y}>พ.ศ. {y}</option>)}
            </select>
          </div>
          <div className="min-w-[140px]">
            <select value={filterType} onChange={e => setFilterType(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200">
              <option value="all">ทุกประเภท</option>
              <optgroup label="ถนน">
                {PROJECT_TYPES.filter(t => t.group === 'ถนน').map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </optgroup>
              <optgroup label="น้ำ">
                {PROJECT_TYPES.filter(t => t.group === 'น้ำ').map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </optgroup>
              <optgroup label="อื่นๆ">
                {PROJECT_TYPES.filter(t => t.group === '').map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </optgroup>
            </select>
          </div>
          <div className="min-w-[130px]">
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200">
              <option value="all">ทุกสถานะ</option>
              {Object.entries(STATUS_CFG).map(([v, c]) => <option key={v} value={v}>{c.label}</option>)}
            </select>
          </div>
          <button onClick={fetchProjects}
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-bold text-white"
            style={{ backgroundColor: '#3b82f6' }}>
            <Search size={14} /> ค้นหา
          </button>
        </div>
      </div>

      {/* Data table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 size={22} className="animate-spin text-gray-300" />
          </div>
        ) : (projects ?? []).length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Building2 size={36} className="mx-auto mb-2 opacity-20" />
            <p className="text-sm">ยังไม่มีโครงการ</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 whitespace-nowrap">เลขที่โครงการ</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 whitespace-nowrap">ชื่อโครงการ</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 whitespace-nowrap">ประเภท</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 whitespace-nowrap">สถานะ</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 whitespace-nowrap">ปีงบประมาณ</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 whitespace-nowrap">วงเงิน</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 whitespace-nowrap">พื้นที่</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 whitespace-nowrap" style={{ minWidth: 140 }}>ความคืบหน้า</th>
                </tr>
              </thead>
              <tbody>
                {(projects ?? []).map(p => (
                  <tr key={p.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <button onClick={() => openDetail(p)}
                        className="text-blue-500 hover:text-blue-700 font-semibold hover:underline text-left">
                        {p.project_no || '-'}
                      </button>
                    </td>
                    <td className="px-4 py-3.5 max-w-[240px]">
                      <button onClick={() => openDetail(p)}
                        className="text-left hover:text-blue-600 transition-colors">
                        <p className="font-semibold text-gray-800 truncate">{p.title}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{deptLabel(p.department)}</p>
                      </button>
                    </td>
                    <td className="px-4 py-3.5 text-gray-600 whitespace-nowrap">{typeLabel(p.project_type)}</td>
                    <td className="px-4 py-3.5"><StatusBadge status={p.status} /></td>
                    <td className="px-4 py-3.5 text-gray-600 whitespace-nowrap">{p.fiscal_year}</td>
                    <td className="px-4 py-3.5 text-gray-700 font-medium whitespace-nowrap">
                      {p.budget_amount ? `฿${fmt(p.budget_amount)}` : '-'}
                    </td>
                    <td className="px-4 py-3.5 text-gray-500 text-xs max-w-[180px]">
                      <span className="truncate block">{locationStr(p)}</span>
                    </td>
                    <td className="px-4 py-3.5" style={{ minWidth: 140 }}>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all"
                               style={{ width: `${p.status === 'completed' ? 100 : (p.progress_pct || 0)}%`, backgroundColor: STATUS_CFG[p.status]?.color ?? '#3b82f6' }} />
                        </div>
                        <span className="text-xs font-bold text-gray-500 shrink-0">{p.status === 'completed' ? 100 : (p.progress_pct || 0)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )

  // ─── DETAIL VIEW ────────────────────────────────────────────────────────────
  if (view === 'detail' && selectedProject) {
    const p = selectedProject
    return (
      <div className="space-y-5 max-w-4xl">

        {/* Delete confirm */}
        {deleteConfirm && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl p-5 shadow-xl max-w-xs w-full space-y-4">
              <p className="font-bold text-gray-800">ลบโครงการนี้?</p>
              <p className="text-sm text-gray-500 truncate">{deleteConfirm.title}</p>
              <div className="flex gap-2">
                <button onClick={() => deleteProject(deleteConfirm.id)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-red-500 hover:bg-red-600">ลบ</button>
                <button onClick={() => setDeleteConfirm(null)}
                  className="flex-1 py-2.5 rounded-xl text-sm text-gray-500 bg-gray-100 hover:bg-gray-200">ยกเลิก</button>
              </div>
            </div>
          </div>
        )}

        {/* Breadcrumb + Edit button */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm text-gray-400 mb-2 flex-wrap">
              <button onClick={() => setView('list')} className="hover:text-blue-500 transition-colors">รายการโครงการ</button>
              <ChevronRight size={14} />
              {p.project_no && <span className="text-gray-500">{p.project_no}</span>}
            </div>
            <h2 className="text-xl font-bold text-gray-800 leading-snug">{p.title}</h2>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <StatusBadge status={p.status} />
              <span className="text-sm text-gray-500">{deptLabel(p.department)}</span>
              <span className="text-sm text-gray-400">ปีงบประมาณ {p.fiscal_year}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!isReadOnly && (
              <button onClick={() => openEdit(p)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-blue-600 border border-blue-200 bg-white hover:bg-blue-50 transition-colors">
                <Pencil size={14} /> แก้ไข
              </button>
            )}
            {canDelete && (
              <button onClick={() => setDeleteConfirm(p)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-red-500 border border-red-200 bg-white hover:bg-red-50 transition-colors">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Progress card */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-gray-600">ความคืบหน้าโครงการ</span>
            <span className="text-lg font-bold" style={{ color: STATUS_CFG[p.status]?.color ?? '#3b82f6' }}>{p.status === 'completed' ? 100 : (p.progress_pct || 0)}%</span>
          </div>
          <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all"
                 style={{ width: `${p.status === 'completed' ? 100 : (p.progress_pct || 0)}%`, backgroundColor: STATUS_CFG[p.status]?.color ?? '#3b82f6' }} />
          </div>
        </div>

        {/* Info cards grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* ที่ตั้งโครงการ */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <MapPin size={16} className="text-blue-500" />
              <h3 className="font-bold text-gray-700">ที่ตั้งโครงการ</h3>
            </div>
            <div className="space-y-0.5 text-sm">
              {p.village && <p className="text-gray-600"><span className="text-gray-400">หมู่บ้าน/ชุมชน:</span> {p.village}</p>}
              {p.district && <p className="text-gray-600"><span className="text-gray-400">อำเภอ:</span> <b>{p.district}</b></p>}
              {p.province && <p className="text-gray-600"><span className="text-gray-400">จังหวัด:</span> {p.province}</p>}
              {p.latitude && p.longitude && (
                <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-gray-400 font-mono flex items-center gap-1">
                    <MapPin size={12} />
                    {Number(p.latitude).toFixed(6)}, {Number(p.longitude).toFixed(6)}
                  </p>
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${p.latitude},${p.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 text-xs font-bold hover:bg-blue-100 transition-colors"
                  >
                    <Navigation size={12} />
                    นำทาง
                  </a>
                </div>
              )}
              {!p.village && !p.district && !p.province && <p className="text-gray-400 text-xs">ยังไม่ระบุที่ตั้ง</p>}
            </div>
          </div>

          {/* ระยะเวลา */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <Calendar size={16} className="text-blue-500" />
              <h3 className="font-bold text-gray-700">ระยะเวลา</h3>
            </div>
            <div className="space-y-1">
              <InfoRow label="วันที่เริ่มต้น" value={fmtDate(p.start_date)} />
              <InfoRow label="วันที่สิ้นสุด" value={fmtDate(p.end_date)} />
              <div className="border-t border-gray-50 mt-2 pt-2">
                <InfoRow label="บันทึกโดย" value="ผู้ดูแลระบบ" />
                <InfoRow label="วันที่บันทึก" value={fmtDate(p.created_at)} />
              </div>
            </div>
          </div>

          {/* งบประมาณ */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <Banknote size={16} className="text-blue-500" />
              <h3 className="font-bold text-gray-700">งบประมาณ</h3>
            </div>
            <div className="space-y-1">
              <InfoRow label="วงเงินงบประมาณ" value={p.budget_amount ? `฿${fmt(p.budget_amount)}` : '-'} />
              {p.contract_amount && <InfoRow label="ราคาสัญญา" value={`฿${fmt(p.contract_amount)}`} />}
              {p.paid_amount && <InfoRow label="เบิกจ่ายแล้ว" value={`฿${fmt(p.paid_amount)}`} />}
            </div>
          </div>

          {/* ผู้รับจ้าง */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <Building2 size={16} className="text-blue-500" />
              <h3 className="font-bold text-gray-700">ผู้รับจ้าง</h3>
            </div>
            <div className="space-y-1">
              <InfoRow label="ชื่อผู้รับจ้าง" value={p.contractor_name} />
              <InfoRow label="เลขที่สัญญา" value={p.contract_no} />
            </div>
          </div>
        </div>

        {/* Map card */}
        {p.latitude && p.longitude && (
          <DetailMap lat={Number(p.latitude)} lng={Number(p.longitude)} title={p.title} routePoints={p.route_points} routeColor={p.route_color} projectType={p.project_type} />
        )}

        {/* Description */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="font-bold text-gray-700 mb-2">รายละเอียดโครงการ</h3>
          <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">
            {p.description || <span className="text-gray-400">ยังไม่มีรายละเอียด</span>}
          </p>
        </div>

        {/* Photos */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Camera size={16} className="text-blue-500" />
            <h3 className="font-bold text-gray-700">รูปภาพโครงการ ({(p.photos ?? []).length})</h3>
          </div>

          {/* Upload row */}
          {!isReadOnly && (
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <select value={detailPhotoPhase} onChange={e => setDetailPhotoPhase(e.target.value)}
                className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none">
                <option value="before">ก่อนดำเนินการ</option>
                <option value="during">ระหว่างดำเนินการ</option>
                <option value="after">หลังดำเนินการ</option>
              </select>
              <input type="text" value={detailPhotoDesc} onChange={e => setDetailPhotoDesc(e.target.value)}
                placeholder="คำอธิบายรูป (ไม่บังคับ)"
                className="flex-1 min-w-[200px] bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200" />
              <label className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white cursor-pointer hover:opacity-90 transition-opacity"
                style={{ backgroundColor: '#3b82f6' }}>
                <Upload size={14} />
                {uploadingPhoto ? 'กำลังอัพโหลด...' : 'อัพโหลดรูป'}
                <input type="file" accept="image/*" className="hidden"
                  onChange={e => { setDetailPhotoFile(e.target.files?.[0] ?? null); e.target.value = '' }}
                  disabled={uploadingPhoto} />
              </label>
            </div>
          )}

          {/* Photo preview for pending upload */}
          {detailPhotoFile && (
            <div className="flex items-center gap-3 mb-4 bg-blue-50 rounded-xl px-4 py-2.5">
              <span className="text-sm text-blue-700 truncate flex-1">{detailPhotoFile.name}</span>
              <button onClick={handleDetailPhotoUpload} disabled={uploadingPhoto}
                className="text-sm font-bold text-blue-600 hover:text-blue-800 disabled:opacity-50">
                {uploadingPhoto ? <Loader2 size={14} className="animate-spin" /> : 'ยืนยันอัพโหลด'}
              </button>
              <button onClick={() => setDetailPhotoFile(null)} className="text-gray-400 hover:text-red-500">
                <X size={14} />
              </button>
            </div>
          )}

          {/* Photos grid */}
          {(p.photos ?? []).length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {p.photos.map((url, i) => (
                <div key={i} className="aspect-video rounded-xl overflow-hidden bg-gray-100">
                  <img src={url} alt="" className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-sm text-blue-400 py-6">ยังไม่มีรูปภาพ</p>
          )}
        </div>

        {/* Progress log */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={16} className="text-blue-500" />
            <h3 className="font-bold text-gray-700">บันทึกความคืบหน้า</h3>
          </div>

          {!isReadOnly && (
            <div className="space-y-3">
              <textarea
                value={progressNote}
                onChange={e => setProgressNote(e.target.value)}
                placeholder="บันทึกความคืบหน้า..."
                rows={3}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none"
              />
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">สถานะ:</span>
                  <select value={progressStatus} onChange={e => {
                      const newStatus = e.target.value;
                      setProgressStatus(newStatus);
                      if (STATUS_CFG[newStatus]?.autoProgress !== null) {
                        setProgressPct(STATUS_CFG[newStatus].autoProgress);
                      }
                    }}
                    className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-1.5 text-sm font-semibold text-blue-700 focus:outline-none">
                    {Object.entries(STATUS_CFG).map(([v, c]) => <option key={v} value={v}>{c.label}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">ความคืบหน้า:</span>
                  <input type="number" min="0" max="100" value={progressPct}
                    onChange={e => setProgressPct(Math.min(100, Math.max(0, Number(e.target.value))))}
                    className="w-16 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-sm text-center text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200" />
                  <span className="text-sm text-gray-400">%</span>
                </div>
                <button onClick={handleSaveProgress} disabled={savingProgress}
                  className="ml-auto flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                  style={{ backgroundColor: '#6366f1' }}>
                  {savingProgress ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  บันทึก
                </button>
              </div>
            </div>
          )}

          {/* Notes display */}
          {p.note ? (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="space-y-2">
                {p.note.split('\n').filter(Boolean).map((line, i) => (
                  <p key={i} className="text-sm text-gray-600">{line}</p>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-center text-sm text-blue-400 py-4 mt-2">ยังไม่มีการบันทึกความคืบหน้า</p>
          )}
        </div>
      </div>
    )
  }

  // ─── FORM VIEW ──────────────────────────────────────────────────────────────
  const statusCfg = STATUS_CFG[form.status]
  const needsReason = statusCfg?.needsReason

  return (
    <div className="space-y-4 max-w-2xl">


      {/* Form header */}
      <div className="flex items-center gap-3">
        <button onClick={() => {
          if (editId && selectedProject) {
            setView('detail')
          } else {
            setView('list')
          }
        }}
          className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400 transition-colors">
          <ChevronLeft size={18} />
        </button>
        <div>
          <h2 className="font-bold text-gray-800">{editId ? 'แก้ไขโครงการ' : 'เพิ่มโครงการใหม่'}</h2>
          <p className="text-xs text-gray-400">กรอกข้อมูลโครงการให้ครบถ้วน</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">

        {/* ── ข้อมูลพื้นฐาน ── */}
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <h3 className="text-sm font-bold text-gray-700 border-b border-gray-100 pb-2">ข้อมูลพื้นฐาน</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="เลขที่โครงการ" half>
              <input value={form.project_no} onChange={e => setForm(p => ({ ...p, project_no: e.target.value }))}
                placeholder="เช่น 2568-001" className={inputCls} />
            </Field>
            <Field label="ปีงบประมาณ" required half>
              <select value={form.fiscal_year} onChange={e => setForm(p => ({ ...p, fiscal_year: e.target.value }))} className={selectCls}>
                {FISCAL_YEARS.map(y => <option key={y} value={y}>พ.ศ. {y}</option>)}
              </select>
            </Field>
            <Field label="ชื่อโครงการ" required>
              <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} required
                placeholder="ชื่อโครงการเต็ม" className={inputCls} />
            </Field>
            <Field label="รายละเอียดโครงการ">
              <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                rows={3} placeholder="อธิบายรายละเอียดโครงการ"
                className={inputCls + ' resize-none'} />
            </Field>
            <Field label="กอง/หน่วยงาน" required half>
              <select value={form.department} onChange={e => setForm(p => ({ ...p, department: e.target.value }))} className={selectCls}>
                {DEPARTMENTS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </Field>
            <Field label="ประเภทโครงการ" required half>
              <select value={form.project_type}
                onChange={e => {
                  const type = e.target.value
                  const defaultColor = ROUTE_STYLE[type]?.color
                  setForm(p => ({ ...p, project_type: type, ...(defaultColor && { route_color: defaultColor }) }))
                }}
                className={selectCls}>
                <optgroup label="ถนน">
                  {PROJECT_TYPES.filter(t => t.group === 'ถนน').map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </optgroup>
                <optgroup label="น้ำ">
                  {PROJECT_TYPES.filter(t => t.group === 'น้ำ').map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </optgroup>
                <optgroup label="อื่นๆ">
                  {PROJECT_TYPES.filter(t => t.group === '').map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </optgroup>
              </select>
            </Field>
            <Field label="สถานะ" required half>
              <select value={form.status} onChange={e => handleStatusChange(e.target.value)} className={selectCls}>
                {Object.entries(STATUS_CFG).map(([v, c]) => <option key={v} value={v}>{c.label}</option>)}
              </select>
            </Field>
            <Field label={`ความคืบหน้า (${form.progress_pct}%)`} half>
              <input type="number" min="0" max="100"
                value={form.progress_pct}
                disabled={!statusCfg?.canEdit}
                onChange={e => setForm(p => ({ ...p, progress_pct: Math.min(100, Math.max(0, Number(e.target.value))) }))}
                className={inputCls + (!statusCfg?.canEdit ? ' opacity-50 cursor-not-allowed' : '')} />
              <div className="mt-1.5">
                <ProgressBar pct={form.progress_pct} status={form.status} />
              </div>
            </Field>
          </div>
          {needsReason && (
            <Field label="สาเหตุที่ยกเลิก / ระงับโครงการ" required>
              <textarea value={form.cancel_reason}
                onChange={e => setForm(p => ({ ...p, cancel_reason: e.target.value }))} rows={2}
                placeholder="อธิบายปัญหา/สาเหตุที่ทำให้โครงการหยุดชะงัก"
                className={inputCls + ' resize-none border-red-200 focus:ring-red-200'} />
            </Field>
          )}
        </section>

        {/* ── ที่ตั้งโครงการ ── */}
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <h3 className="text-sm font-bold text-gray-700 border-b border-gray-100 pb-2">ที่ตั้งโครงการ</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="หมู่บ้าน/ชุมชน" half>
              <select value={form.village} onChange={e => setForm(p => ({ ...p, village: e.target.value }))} className={selectCls}>
                <option value="">- เลือกหมู่บ้าน/ชุมชน -</option>
                {locations.map(l => (
                  <option key={l.id} value={l.name}>{l.name}</option>
                ))}
              </select>
            </Field>
            <Field label="ตำบล" half>
              <input value={form.subdistrict} onChange={e => setForm(p => ({ ...p, subdistrict: e.target.value }))}
                className={inputCls} />
            </Field>
            <Field label="อำเภอ" half>
              <input value={form.district} onChange={e => setForm(p => ({ ...p, district: e.target.value }))}
                className={inputCls} />
            </Field>
            <Field label="จังหวัด" half>
              <input value={form.province} onChange={e => setForm(p => ({ ...p, province: e.target.value }))}
                className={inputCls} />
            </Field>
            <Field label="คำอธิบายที่ตั้ง">
              <input value={form.location_desc} onChange={e => setForm(p => ({ ...p, location_desc: e.target.value }))}
                placeholder="เช่น บริเวณสำนักงานเทศบาล" className={inputCls} />
            </Field>
          </div>

          {/* GPS / Route */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-2">
              {LINEAR_TYPES.includes(form.project_type) ? 'แนวเส้นทางโครงการ' : 'พิกัดที่ตั้ง'}
            </label>

            {/* Color picker — แสดงเฉพาะ linear types */}
            {LINEAR_TYPES.includes(form.project_type) && (
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="text-xs text-gray-500 shrink-0">สีเส้นทาง:</span>
                {ROUTE_COLORS.map(({ hex, label }) => (
                  <button key={hex} type="button" title={label}
                    onClick={() => setForm(p => ({ ...p, route_color: hex }))}
                    className="w-6 h-6 rounded-full transition-all"
                    style={{
                      backgroundColor: hex,
                      outline: form.route_color === hex ? `3px solid ${hex}` : '2px solid transparent',
                      outlineOffset: '2px',
                    }} />
                ))}
                <label className="relative w-6 h-6 rounded-full overflow-hidden cursor-pointer border border-gray-300" title="เลือกสีเอง"
                  style={{ background: 'conic-gradient(red,yellow,lime,cyan,blue,magenta,red)' }}>
                  <input type="color" value={form.route_color || '#3b82f6'}
                    onChange={e => setForm(p => ({ ...p, route_color: e.target.value }))}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
                </label>
                <span className="text-xs font-mono text-gray-400">{form.route_color}</span>
              </div>
            )}

            {LINEAR_TYPES.includes(form.project_type) ? (
              <InlinePolylinePicker
                value={routePoints}
                onChange={setRoutePoints}
                color={form.route_color || '#3b82f6'}
                dashArray={ROUTE_DASH[form.project_type] ?? null}
                defaultCenter={tenant?.latitude ? { lat: tenant.latitude, lng: tenant.longitude } : null}
              />
            ) : (
              <>
                <InlineMapPicker
                  value={geo.lat ? { lat: geo.lat, lng: geo.lng } : null}
                  onChange={({ lat, lng }) => setGeo({ lat, lng })}
                  defaultCenter={tenant?.latitude ? { lat: tenant.latitude, lng: tenant.longitude } : null}
                />
                {geo.lat && (
                  <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 mt-2">
                    <MapPin size={13} className="text-blue-500 shrink-0" />
                    <span className="text-xs font-mono text-blue-700">{geo.lat.toFixed(7)}, {geo.lng.toFixed(7)}</span>
                    <button type="button" onClick={() => setGeo({ lat: null, lng: null })}
                      className="ml-auto text-red-400 hover:text-red-600 text-xs font-semibold flex items-center gap-1">
                      <Trash2 size={11} /> ล้าง
                    </button>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <input type="number" step="any" value={geo.lat ?? ''}
                    onChange={e => setGeo(p => ({ ...p, lat: e.target.value ? parseFloat(e.target.value) : null }))}
                    placeholder="ละติจูด" className={inputCls} />
                  <input type="number" step="any" value={geo.lng ?? ''}
                    onChange={e => setGeo(p => ({ ...p, lng: e.target.value ? parseFloat(e.target.value) : null }))}
                    placeholder="ลองจิจูด" className={inputCls} />
                </div>
              </>
            )}
          </div>
        </section>

        {/* ── งบประมาณและสัญญา ── */}
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <h3 className="text-sm font-bold text-gray-700 border-b border-gray-100 pb-2">งบประมาณและสัญญา</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="วงเงินงบประมาณ (บาท)" required half>
              <input type="number" step="0.01" value={form.budget_amount}
                onChange={e => setForm(p => ({ ...p, budget_amount: e.target.value }))}
                placeholder="0.00" className={inputCls} />
            </Field>
            <Field label="ราคาสัญญา (บาท)" half>
              <input type="number" step="0.01" value={form.contract_amount}
                onChange={e => setForm(p => ({ ...p, contract_amount: e.target.value }))}
                placeholder="0.00" className={inputCls} />
            </Field>
            <Field label="เบิกจ่ายแล้ว (บาท)" half>
              <input type="number" step="0.01" value={form.paid_amount}
                onChange={e => setForm(p => ({ ...p, paid_amount: e.target.value }))}
                placeholder="0.00" className={inputCls} />
            </Field>
            <div /> {/* spacer */}
            <Field label="ชื่อผู้รับจ้าง" half>
              <input value={form.contractor_name} onChange={e => setForm(p => ({ ...p, contractor_name: e.target.value }))}
                className={inputCls} />
            </Field>
            <Field label="เลขที่สัญญา" half>
              <input value={form.contract_no} onChange={e => setForm(p => ({ ...p, contract_no: e.target.value }))}
                className={inputCls} />
            </Field>
          </div>
        </section>

        {/* ── ระยะเวลาดำเนินการ ── */}
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <h3 className="text-sm font-bold text-gray-700 border-b border-gray-100 pb-2">ระยะเวลาดำเนินการ</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="วันที่เริ่มต้น" half>
              <input type="date" value={form.start_date}
                onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))}
                className={inputCls} />
            </Field>
            <Field label="วันที่สิ้นสุด" half>
              <input type="date" value={form.end_date}
                onChange={e => setForm(p => ({ ...p, end_date: e.target.value }))}
                className={inputCls} />
            </Field>
          </div>
        </section>

        {/* ── รูปภาพและหมายเหตุ ── */}
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <h3 className="text-sm font-bold text-gray-700 border-b border-gray-100 pb-2">รูปภาพและหมายเหตุ</h3>

          {existingPhotos.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-1.5">รูปภาพที่มีอยู่</p>
              <div className="grid grid-cols-5 gap-1.5">
                {existingPhotos.map((url, i) => (
                  <div key={i} className="relative aspect-square rounded-xl overflow-hidden bg-gray-100">
                    <img src={url} alt="" className="w-full h-full object-cover" />
                    <button type="button" onClick={() => setExisting(p => p.filter((_, j) => j !== i))}
                      className="absolute top-0.5 right-0.5 bg-black/50 rounded-full p-0.5">
                      <X size={9} className="text-white" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 cursor-pointer border border-dashed border-gray-200 rounded-xl px-4 py-2.5 hover:bg-gray-50 transition-colors">
            <Image size={14} className="text-gray-400" />
            <span className="text-xs text-gray-500">เพิ่มรูปภาพ (ไม่เกิน 5 รูป)</span>
            <input type="file" accept="image/*" multiple className="hidden" onChange={addPhotos} />
          </label>
          {photos.length > 0 && (
            <div className="grid grid-cols-5 gap-1.5">
              {photos.map((p, i) => (
                <div key={i} className="relative aspect-square rounded-xl overflow-hidden bg-gray-100">
                  <img src={p.preview} alt="" className="w-full h-full object-cover" />
                  <button type="button" onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                    className="absolute top-0.5 right-0.5 bg-black/50 rounded-full p-0.5">
                    <X size={9} className="text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <Field label="หมายเหตุ">
            <textarea value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))}
              rows={3} placeholder="หมายเหตุเพิ่มเติม"
              className={inputCls + ' resize-none'} />
          </Field>
        </section>

        {/* Error + Submit */}
        {formError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600 flex items-center gap-2">
            <AlertTriangle size={14} className="shrink-0" />
            {formError}
          </div>
        )}

        <div className="flex gap-3 pb-6">
          <button type="submit" disabled={submitting}
            className="flex-1 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ backgroundColor: '#7c3aed' }}>
            {submitting
              ? <><Loader2 size={14} className="animate-spin" /> กำลังบันทึก...</>
              : <><CheckCircle2 size={14} /> บันทึกโครงการ</>}
          </button>
          <button type="button" onClick={() => {
            if (editId && selectedProject) {
              setView('detail')
            } else {
              setView('list')
            }
          }}
            className="px-5 py-3 rounded-xl text-sm text-gray-500 bg-gray-100 hover:bg-gray-200 font-medium">
            ยกเลิก
          </button>
        </div>
      </form>
    </div>
  )
}
