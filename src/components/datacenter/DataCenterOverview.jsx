import { useState, useEffect, useCallback } from 'react'
import {
  Database, Layers, Radio, Globe, Sparkles, Upload, Plus, BarChart3, MapPin,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Pencil, Eye, EyeOff, Search, Filter, AlertCircle,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import DataCenterImportModal from './DataCenterImportModal'

const TABLE_PAGE_SIZES = [20, 50, 100]

// bg เดิมของ getGroupMeta เป็นสีทึบ (ใช้กับแท่ง/ป้าย #อันดับ) — ตารางรายการต้องการป้ายกลุ่มแบบโปร่งแสง
// (bg จาง + ตัวอักษรสีทึบ) แปลง hex → rgba(alpha) เอาเอง กันต้องผูกชุดสีที่สองแยกจาก getGroupMeta
function withAlpha(hex, alpha) {
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function SortHeader({ label, sortKey, activeKey, dir, onSort, className = '' }) {
  const active = activeKey === sortKey
  return (
    <th className={`px-3.5 py-3 font-extrabold select-none uppercase tracking-wider text-[11px] ${className}`}>
      <button type="button" onClick={() => onSort(sortKey)}
        className={`flex items-center gap-1 transition-colors ${active ? 'text-cyan-300 font-bold' : 'text-slate-400 hover:text-slate-200'}`}>
        {label}
        {active ? (dir === 'asc' ? <ChevronUp size={13} className="text-cyan-400" /> : <ChevronDown size={13} className="text-cyan-400" />) : <ChevronDown size={13} className="opacity-0" />}
      </button>
    </th>
  )
}

const GROUP_COLORS = {
  'โครงสร้างพื้นฐาน': { bg: '#3b82f6', border: '#60a5fa', text: '#dbeafe', emoji: '🛣️' },
  'สถานศึกษา':       { bg: '#8b5cf6', border: '#a78bfa', text: '#f3e8ff', emoji: '🏫' },
  'สาธารณสุข':       { bg: '#ef4444', border: '#f87171', text: '#fee2e2', emoji: '🏥' },
  'การท่องเที่ยว':     { bg: '#f59e0b', border: '#fbbf24', text: '#fef3c7', emoji: '🏞️' },
  'สิ่งแวดล้อม':      { bg: '#10b981', border: '#34d399', text: '#d1fae5', emoji: '🌱' },
}

const PRESET_PALETTES = [
  { bg: '#3b82f6', border: '#60a5fa', text: '#dbeafe' }, // Blue
  { bg: '#8b5cf6', border: '#a78bfa', text: '#f3e8ff' }, // Purple
  { bg: '#ef4444', border: '#f87171', text: '#fee2e2' }, // Red
  { bg: '#f59e0b', border: '#fbbf24', text: '#fef3c7' }, // Amber
  { bg: '#10b981', border: '#34d399', text: '#d1fae5' }, // Emerald
  { bg: '#ec4899', border: '#f472b6', text: '#fce7f3' }, // Pink
  { bg: '#06b6d4', border: '#22d3ee', text: '#cffafe' }, // Cyan
  { bg: '#6366f1', border: '#818cf8', text: '#e0e7ff' }, // Indigo
  { bg: '#84cc16', border: '#a3e635', text: '#ecfccb' }, // Lime
  { bg: '#14b8a6', border: '#2dd4bf', text: '#ccfbf1' }, // Teal
]

const KEYWORD_EMOJIS = [
  { keywords: ['โครงสร้าง', 'คมนาคม', 'ถนน', 'สะพาน', 'โยธา'], emoji: '🛣️' },
  { keywords: ['ศึกษา', 'เรียน', 'โรงเรียน', 'ศูนย์เด็ก', 'การศึกษา'], emoji: '🏫' },
  { keywords: ['สาธารณสุข', 'หมอ', 'พยาบาล', 'อนามัย', 'การแพทย์', 'โรงพยาบาล'], emoji: '🏥' },
  { keywords: ['เที่ยว', 'ท่องเที่ยว', 'จุดชมวิว', 'สวน'], emoji: '🏞️' },
  { keywords: ['สิ่งแวดล้อม', 'ขยะ', 'มลพิษ', 'ป่าไม้', 'ทรัพยากร'], emoji: '🌱' },
  { keywords: ['เกษตร', 'ไร่', 'นา', 'พืช', 'ปศุสัตว์'], emoji: '🌾' },
  { keywords: ['น้ำ', 'ประปา', 'ชลประทาน', 'คลอง', 'แหล่งน้ำ'], emoji: '💧' },
  { keywords: ['สวัสดิการ', 'สังคม', 'ชุมชน', 'ผู้สูงอายุ'], emoji: '🤝' },
  { keywords: ['ปลอดภัย', 'กู้ภัย', 'ป้องกัน', 'ดับเพลิง', 'บรรเทา'], emoji: '🛡️' },
  { keywords: ['เศรษฐกิจ', 'ตลาด', 'พาณิชย์', 'การค้า'], emoji: '🛒' },
  { keywords: ['วัฒนธรรม', 'วัด', 'ศาสนา', 'ประเพณี'], emoji: '🛕' },
]

function getGroupMeta(name) {
  if (!name) return { bg: '#64748b', border: '#94a3b8', text: '#f1f5f9', emoji: '📍' }
  if (GROUP_COLORS[name]) return GROUP_COLORS[name]

  // Dynamic emoji selection based on keywords
  let emoji = '📍'
  for (const item of KEYWORD_EMOJIS) {
    if (item.keywords.some(k => name.toLowerCase().includes(k))) {
      emoji = item.emoji
      break
    }
  }

  // Consistent color selection using string hash for any new group added in the future
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const paletteIndex = Math.abs(hash) % PRESET_PALETTES.length
  const palette = PRESET_PALETTES[paletteIndex]

  return { ...palette, emoji }
}

export default function DataCenterOverview({
  tenant,
  profile,
  onAddNew,
  onEditEntry,
  onImportSuccess,
  onSelectCategory,
  onViewOnMap,
  theme = 'dark',
  initialFilterGroup = null,
  initialFilterCategory = null,
}) {
  const isLight = theme === 'light'
  const tenantId = tenant?.id
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [showImportModal, setShowImportModal] = useState(false)

  // desktop table: ค้นหา/กรอง/เรียง/แบ่งหน้าอิสระจากสไลด์เมนูซ้าย (sync ค่าเริ่มต้นมาจากมันตอน filter เปลี่ยน)
  const [tableSearch, setTableSearch] = useState('')
  const [tableFilterGroup, setTableFilterGroup] = useState(initialFilterGroup ?? 'all')
  const [tableFilterCategory, setTableFilterCategory] = useState(initialFilterCategory ?? 'all')
  const [tableFilterStatus, setTableFilterStatus] = useState('all')
  const [tableSortKey, setTableSortKey] = useState('name')
  const [tableSortDir, setTableSortDir] = useState('asc')
  const [tablePage, setTablePage] = useState(1)
  const [tablePageSize, setTablePageSize] = useState(TABLE_PAGE_SIZES[0])

  const fetchEntries = useCallback(() => {
    if (!tenantId) return
    setLoading(true)
    supabase.from('data_center_entries')
      .select('id, name, group_name, category, status, latitude, longitude, description, photo_urls, external_url, route_points, route_color, department_id, created_by')
      .eq('municipality_id', tenantId)
      .then(({ data }) => { setEntries(data ?? []); setLoading(false) })
  }, [tenantId])

  useEffect(() => {
    queueMicrotask(fetchEntries)
  }, [fetchEntries])

  // เมนูซ้ายเปลี่ยนหมวด → sync ตารางให้กรองตามทันที (ไม่งั้นกดเมนูซ้ายแล้วตารางยังโชว์ของเดิม)
  // ปรับ state ระหว่าง render ตามแพทเทิร์นที่ React แนะนำ (ไม่ใช้ useEffect ตั้ง state ตรงๆ กันเรนเดอร์ซ้อน)
  const [prevSidebarFilter, setPrevSidebarFilter] = useState({ group: initialFilterGroup, category: initialFilterCategory })
  if (prevSidebarFilter.group !== initialFilterGroup || prevSidebarFilter.category !== initialFilterCategory) {
    setPrevSidebarFilter({ group: initialFilterGroup, category: initialFilterCategory })
    setTableFilterGroup(initialFilterGroup ?? 'all')
    setTableFilterCategory(initialFilterCategory ?? 'all')
    setTablePage(1)
  }

  async function toggleStatus(entry) {
    const nextStatus = entry.status === 'active' ? 'archived' : 'active'
    setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: nextStatus } : e))
    const { error } = await supabase.from('data_center_entries').update({ status: nextStatus }).eq('id', entry.id)
    if (error) {
      setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: entry.status } : e))
      alert('บันทึกไม่สำเร็จ: ' + error.message)
    }
  }

  function sortByColumn(key) {
    if (tableSortKey === key) setTableSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setTableSortKey(key); setTableSortDir('asc') }
  }

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-24 gap-3">
      <div className="relative w-12 h-12 flex items-center justify-center">
        <div className={`absolute inset-0 rounded-full border-4 ${isLight ? 'border-sky-200 border-t-sky-600' : 'border-cyan-500/20 border-t-cyan-400'} animate-spin`} />
        <Database size={20} className={isLight ? 'text-sky-600 animate-pulse' : 'text-cyan-400 animate-pulse'} />
      </div>
      <p className={`text-xs font-mono animate-pulse ${isLight ? 'text-sky-700 font-bold' : 'text-cyan-300/80'}`}>LOADING DIGITAL CORE ANALYTICS...</p>
    </div>
  )

  const hasActiveFilter = Boolean(initialFilterGroup || initialFilterCategory)
  const filteredEntries = entries.filter(entry => {
    if (initialFilterGroup && entry.group_name !== initialFilterGroup) return false
    if (initialFilterCategory && entry.category !== initialFilterCategory) return false
    return true
  })
  const filterLabel = initialFilterCategory || initialFilterGroup || 'ข้อมูลทั้งหมด'
  const totalEntries = filteredEntries.length
  const activeEntriesCount = filteredEntries.filter(e => e.status !== 'archived').length
  const activeRate = totalEntries ? Math.round((activeEntriesCount / totalEntries) * 100) : 100

  // GIS Types
  const polylineEntries = filteredEntries.filter(e => e.route_points && e.route_points.length > 0)
  const pointEntries = filteredEntries.filter(e => (e.latitude != null || e.longitude != null) && (!e.route_points || e.route_points.length === 0))

  // Group stats calculation (Fully Dynamic for any future groups)
  const groupMap = {}
  filteredEntries.forEach(e => {
    const g = e.group_name || 'อื่นๆ'
    if (!groupMap[g]) groupMap[g] = { count: 0, active: 0, points: 0, routes: 0, categories: new Set() }
    groupMap[g].count += 1
    if (e.status !== 'archived') groupMap[g].active += 1
    if (e.route_points && e.route_points.length > 0) groupMap[g].routes += 1
    else if (e.latitude != null) groupMap[g].points += 1
    if (e.category) groupMap[g].categories.add(e.category)
  })

  const groupStatsList = Object.keys(groupMap).map(g => ({
    name: g,
    count: groupMap[g].count,
    active: groupMap[g].active,
    points: groupMap[g].points,
    routes: groupMap[g].routes,
    catCount: groupMap[g].categories.size,
    percent: totalEntries ? Math.round((groupMap[g].count / totalEntries) * 100) : 0,
    meta: getGroupMeta(g)
  })).sort((a, b) => b.count - a.count)

  // รายการจริง (ตาราง desktop + การ์ด mobile) — อิสระจากตัวกรองเมนูซ้าย ผู้ใช้เปลี่ยนเป็น "ทุกกลุ่ม" ดูทั้งหมดได้เอง
  const allGroups = Array.from(new Set(entries.map(e => e.group_name))).sort((a, b) => a.localeCompare(b, 'th'))
  const tableCategoryOptions = Array.from(new Set(
    entries.filter(e => tableFilterGroup === 'all' || e.group_name === tableFilterGroup).map(e => e.category)
  )).sort((a, b) => a.localeCompare(b, 'th'))

  const tableFiltered = entries.filter(e => {
    if (tableFilterGroup !== 'all' && e.group_name !== tableFilterGroup) return false
    if (tableFilterCategory !== 'all' && e.category !== tableFilterCategory) return false
    if (tableFilterStatus !== 'all' && (e.status ?? 'active') !== tableFilterStatus) return false
    if (tableSearch.trim() && !(e.name ?? '').toLowerCase().includes(tableSearch.trim().toLowerCase())) return false
    return true
  })
  const tableSorted = [...tableFiltered].sort((a, b) => {
    let av = a[tableSortKey] ?? '', bv = b[tableSortKey] ?? ''
    if (typeof av === 'string') av = av.toLowerCase()
    if (typeof bv === 'string') bv = bv.toLowerCase()
    const cmp = av < bv ? -1 : av > bv ? 1 : 0
    return tableSortDir === 'asc' ? cmp : -cmp
  })
  const tableTotalPages = Math.max(1, Math.ceil(tableSorted.length / tablePageSize))
  const tableCurrentPage = Math.min(tablePage, tableTotalPages)
  const tablePageItems = tableSorted.slice((tableCurrentPage - 1) * tablePageSize, tableCurrentPage * tablePageSize)

  return (
    <div className="space-y-6">
      {showImportModal && (
        <DataCenterImportModal
          tenant={tenant}
          profile={profile}
          onClose={() => setShowImportModal(false)}
          onImportComplete={() => {
            setShowImportModal(false)
            fetchEntries()
            onImportSuccess?.()
          }}
        />
      )}

      {/* Cyber Action Bar */}
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4.5 rounded-2xl backdrop-blur-xl border shadow-xl ${
        isLight
          ? 'bg-white/90 border-slate-200 shadow-sky-950/5 text-slate-800'
          : 'bg-slate-900/80 border-cyan-500/30 shadow-cyan-950/40 text-white'
      }`}>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shadow-inner ${
            isLight ? 'bg-sky-100 border-sky-300 text-sky-700' : 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
          }`}>
            <BarChart3 size={21} className={isLight ? 'text-sky-600' : 'drop-shadow-[0_0_8px_rgba(0,240,255,0.6)]'} />
          </div>
          <div>
            <h1 className={`text-lg font-black tracking-wide ${
              isLight ? 'text-slate-900' : 'text-transparent bg-clip-text bg-gradient-to-r from-white via-cyan-100 to-cyan-400'
            }`}>
              {hasActiveFilter ? filterLabel : 'ภาพรวมระบบสารสนเทศดิจิทัล (Executive Dashboard)'}
            </h1>
            <p className={`text-xs ${isLight ? 'text-slate-500' : 'text-cyan-200/70'}`}>
              {hasActiveFilter
                ? `กำลังแสดงข้อมูลเฉพาะ ${[initialFilterGroup, initialFilterCategory].filter(Boolean).join(' › ')} — ${totalEntries} รายการ`
                : `วิเคราะห์สถิติมิติข้อมูลและโครงสร้างพื้นฐานดิจิทัล — ${tenant?.name}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button onClick={() => setShowImportModal(true)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all active:scale-95 shadow-sm ${
              isLight
                ? 'text-sky-800 bg-sky-50 border-sky-200 hover:bg-sky-100'
                : 'text-cyan-300 bg-cyan-500/10 border-cyan-500/40 hover:bg-cyan-500/20 shadow-cyan-500/10'
            }`}>
            <Upload size={14} className={isLight ? 'text-sky-600' : 'text-cyan-400'} />
            <span>นำเข้า KML / GIS</span>
          </button>
          <button onClick={() => onAddNew()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-slate-950 bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 shadow-lg shadow-cyan-500/25 active:scale-95 transition-all hover:scale-105">
            <Plus size={15} strokeWidth={2.5} />
            <span>บันทึกข้อมูลใหม่</span>
          </button>
        </div>
      </div>

      {/* Cyber HUD Stats Panel */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {/* Stat 1: Total Data Points */}
        <div className={`p-3 rounded-xl border backdrop-blur-xl shadow-lg relative overflow-hidden group transition-all ${
          isLight
            ? 'bg-white/95 border-slate-200 hover:border-sky-400'
            : 'bg-gradient-to-br from-slate-900/90 to-cyan-950/40 border-cyan-500/30 hover:border-cyan-400/60'
        }`}>
          <div className={`absolute top-0 right-0 w-16 h-16 rounded-full blur-2xl pointer-events-none transition-all ${isLight ? 'bg-sky-500/10' : 'bg-cyan-500/10'}`} />
          <div className="flex items-center justify-between">
            <span className={`text-[9px] font-black uppercase tracking-widest ${isLight ? 'text-sky-800' : 'text-cyan-400/70'}`}>TOTAL DATAPOINTS</span>
            <div className={`p-1.5 rounded-lg border ${isLight ? 'bg-sky-100 text-sky-700 border-sky-200' : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'}`}>
              <Database size={13} />
            </div>
          </div>
          <p className={`text-lg font-black mt-1 font-mono tracking-tight ${isLight ? 'text-slate-900' : 'text-white cyber-text-glow'}`}>{totalEntries}</p>
          <p className={`text-[10px] mt-0.5 flex items-center gap-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            <Sparkles size={10} className={isLight ? 'text-sky-600' : 'text-cyan-400'} /> ข้อมูลสถานที่และโครงสร้าง
          </p>
        </div>

        {/* Stat 2: Active Groups */}
        <div className={`p-3 rounded-xl border backdrop-blur-xl shadow-lg relative overflow-hidden group transition-all ${
          isLight
            ? 'bg-white/95 border-slate-200 hover:border-blue-400'
            : 'bg-gradient-to-br from-slate-900/90 to-blue-950/40 border-blue-500/30 hover:border-blue-400/60'
        }`}>
          <div className="absolute top-0 right-0 w-16 h-16 bg-blue-500/10 rounded-full blur-2xl pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className={`text-[9px] font-black uppercase tracking-widest ${isLight ? 'text-blue-800' : 'text-blue-400/70'}`}>CATEGORIES</span>
            <div className={`p-1.5 rounded-lg border ${isLight ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-blue-500/20 text-blue-300 border-blue-500/40'}`}>
              <Layers size={13} />
            </div>
          </div>
          <p className={`text-lg font-black mt-1 font-mono tracking-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>{groupStatsList.length}</p>
          <p className={`text-[10px] mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            หมวดหมู่หลักในเขตเทศบาล
          </p>
        </div>

        {/* Stat 3: Active Status Rate */}
        <div className={`p-3 rounded-xl border backdrop-blur-xl shadow-lg relative overflow-hidden group transition-all ${
          isLight
            ? 'bg-white/95 border-slate-200 hover:border-emerald-400'
            : 'bg-gradient-to-br from-slate-900/90 to-emerald-950/40 border-emerald-500/30 hover:border-emerald-400/60'
        }`}>
          <div className="absolute top-0 right-0 w-16 h-16 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className={`text-[9px] font-black uppercase tracking-widest ${isLight ? 'text-emerald-800' : 'text-emerald-400/70'}`}>OPERATIONAL RATE</span>
            <div className={`p-1.5 rounded-lg border ${isLight ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'}`}>
              <Radio size={13} className="animate-pulse" />
            </div>
          </div>
          <p className={`text-lg font-black mt-1 font-mono tracking-tight ${isLight ? 'text-emerald-600' : 'text-emerald-400'}`}>{activeRate}%</p>
          <p className={`text-[10px] mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            พร้อมใช้งาน ({activeEntriesCount} รายการ)
          </p>
        </div>

        {/* Stat 4: GIS Polyline & Point Coverage */}
        <div className={`p-3 rounded-xl border backdrop-blur-xl shadow-lg relative overflow-hidden group transition-all ${
          isLight
            ? 'bg-white/95 border-slate-200 hover:border-purple-400'
            : 'bg-gradient-to-br from-slate-900/90 to-purple-950/40 border-purple-500/30 hover:border-purple-400/60'
        }`}>
          <div className="absolute top-0 right-0 w-16 h-16 bg-purple-500/10 rounded-full blur-2xl pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className={`text-[9px] font-black uppercase tracking-widest ${isLight ? 'text-purple-800' : 'text-purple-400/70'}`}>GIS MAPPED</span>
            <div className={`p-1.5 rounded-lg border ${isLight ? 'bg-purple-100 text-purple-700 border-purple-200' : 'bg-purple-500/20 text-purple-300 border-purple-500/40'}`}>
              <Globe size={13} />
            </div>
          </div>
          <p className={`text-lg font-black mt-1 font-mono tracking-tight ${isLight ? 'text-purple-700' : 'text-purple-300'}`}>{pointEntries.length + polylineEntries.length}</p>
          <p className={`text-[10px] mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            หมุดพิกัด {pointEntries.length} | เส้นทาง {polylineEntries.length}
          </p>
        </div>
      </div>

      {entries.length === 0 && (
        <div className={`flex flex-col items-center justify-center py-20 rounded-2xl border backdrop-blur-xl ${
          isLight ? 'bg-white/90 border-slate-200 text-slate-600' : 'bg-slate-900/70 border-cyan-500/20 text-slate-400'
        }`}>
          <Database size={48} className={isLight ? 'mb-3 text-sky-400/40 animate-pulse' : 'mb-3 text-cyan-400/30 animate-pulse'} />
          <p className={`text-base font-bold ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>ยังไม่มีข้อมูลในศูนย์รวมดิจิทัล</p>
          <p className="text-xs mt-1 opacity-80">กดปุ่ม "บันทึกข้อมูลใหม่" หรือ "นำเข้า KML/GIS" เพื่อเริ่มสร้างคลังข้อมูลดิจิทัล</p>
        </div>
      )}

      {/* โหมดเลือกหมวด — แสดงแค่ "กลุ่ม/จำนวน" เท่านั้น ไม่ดึงรายการมาโชว์เลย ความสูงคงที่ไม่ว่าจะมีกี่ร้อยรายการ
          ก็ไม่ยาวขึ้น (ต่างจากดีไซน์เดิมที่เอาทุกรายการมากางในหน้าเดียว) กดการ์ดแล้วค่อยเจาะเข้ารายการทีหลัง */}
      {entries.length > 0 && !hasActiveFilter && (
        <div className={`rounded-2xl border p-5 backdrop-blur-xl shadow-xl ${
          isLight ? 'bg-white/95 border-slate-200 text-slate-800' : 'bg-slate-900/90 border-cyan-500/30 text-white'
        }`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-extrabold tracking-wide">เลือกหมวดหมู่เพื่อดูรายการ</h2>
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border font-bold ${isLight ? 'bg-slate-100 text-slate-700 border-slate-200' : 'bg-slate-800 text-slate-300 border-slate-700'}`}>
              {groupStatsList.length} กลุ่มข้อมูล
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {groupStatsList.map(g => (
              <div key={g.name} className={`group relative rounded-xl border transition-all hover:scale-[1.02] ${
                isLight ? 'bg-slate-50/80 border-slate-200 hover:border-slate-300' : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
              }`}>
                <button type="button" onClick={() => onSelectCategory?.(g.name, null)} className="w-full text-left p-3.5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-2xl">{g.meta.emoji}</span>
                    <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: withAlpha(g.meta.bg, 0.15), color: g.meta.bg }}>
                      {g.count} รายการ
                    </span>
                  </div>
                  <p className="text-xs font-bold truncate pr-6">{g.name}</p>
                  <p className={`text-[10px] mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{g.catCount} ประเภทย่อย</p>
                </button>
                <button type="button" onClick={() => onAddNew(g.name)} aria-label={`เพิ่มข้อมูลในกลุ่ม ${g.name}`} title={`เพิ่มข้อมูลในกลุ่ม ${g.name}`}
                  className={`absolute top-3 right-3 p-1 rounded-lg border opacity-0 group-hover:opacity-100 transition-opacity ${
                    isLight ? 'bg-white border-slate-200 text-slate-500 hover:text-sky-700' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-cyan-300'
                  }`}>
                  <Plus size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* โหมดดูรายการ — เจาะเข้ามาจากการ์ดหมวดด้านบน (หรือเมนูซ้าย/bottom sheet มือถือ) จำกัดด้วยตัวกรอง
          group/category เสมอ จึงมีขอบเขตจำนวนรายการที่ต้องแสดงต่อครั้งชัดเจน ไม่มีทางยาวเท่าข้อมูลทั้งระบบ */}
      {entries.length > 0 && hasActiveFilter && onEditEntry && (
        <>
          <div className={`rounded-2xl border p-3.5 backdrop-blur-xl shadow-xl flex flex-wrap items-center gap-3 ${
            isLight ? 'bg-white/95 border-slate-200 text-slate-800' : 'bg-slate-900/90 border-cyan-500/30 text-white'
          }`}>
            <button type="button" onClick={() => onSelectCategory?.(null, null)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors shrink-0 ${
                isLight ? 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}>
              <ChevronLeft size={14} /> ทุกหมวดหมู่
            </button>
            <div className="relative flex-1 min-w-60">
              <Search size={14} className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${isLight ? 'text-sky-600' : 'text-cyan-400'}`} />
              <input value={tableSearch}
                onChange={e => { setTableSearch(e.target.value); setTablePage(1) }}
                placeholder="ค้นหาชื่อสถานที่..."
                className={`w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border focus:outline-none focus:ring-1 transition-all ${
                  isLight ? 'bg-white border-slate-300 text-slate-900 placeholder-slate-400 focus:border-sky-500 focus:ring-sky-400' : 'bg-slate-900 border-cyan-500/30 text-white placeholder-slate-500 focus:border-cyan-400 focus:ring-cyan-400'
                }`} />
            </div>
            <div className="flex items-center gap-2">
              <Filter size={13} className={isLight ? 'text-sky-600' : 'text-cyan-400/70'} />
              <select value={tableFilterGroup}
                onChange={e => { setTableFilterGroup(e.target.value); setTableFilterCategory('all'); setTablePage(1) }}
                className={`text-xs px-2.5 py-1.5 rounded-xl border focus:outline-none ${isLight ? 'bg-white border-slate-300 text-slate-800 focus:border-sky-500' : 'bg-slate-900 border-slate-700 text-slate-200 focus:border-cyan-400'}`}>
                <option value="all">ทุกกลุ่มหลัก</option>
                {allGroups.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
              <select value={tableFilterCategory}
                onChange={e => { setTableFilterCategory(e.target.value); setTablePage(1) }}
                className={`text-xs px-2.5 py-1.5 rounded-xl border focus:outline-none ${isLight ? 'bg-white border-slate-300 text-slate-800 focus:border-sky-500' : 'bg-slate-900 border-slate-700 text-slate-200 focus:border-cyan-400'}`}>
                <option value="all">ทุกประเภทย่อย</option>
                {tableCategoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={tableFilterStatus}
                onChange={e => { setTableFilterStatus(e.target.value); setTablePage(1) }}
                className={`text-xs px-2.5 py-1.5 rounded-xl border focus:outline-none ${isLight ? 'bg-white border-slate-300 text-slate-800 focus:border-sky-500' : 'bg-slate-900 border-slate-700 text-slate-200 focus:border-cyan-400'}`}>
                <option value="all">ทุกสถานะ</option>
                <option value="active">ใช้งาน (Active)</option>
                <option value="archived">ไม่ใช้งาน (Archived)</option>
              </select>
            </div>
            <button onClick={() => onAddNew(initialFilterGroup, initialFilterCategory)}
              className="ml-auto flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold text-slate-950 bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 shadow-lg shadow-cyan-500/25 active:scale-95 transition-all shrink-0">
              <Plus size={14} strokeWidth={2.5} /> เพิ่มในหมวดนี้
            </button>
          </div>

          {/* Mobile flat list */}
          <div className={`md:hidden rounded-2xl border backdrop-blur-xl shadow-xl overflow-hidden ${
            isLight ? 'bg-white/95 border-slate-200 text-slate-800' : 'bg-slate-900/90 border-cyan-500/30 text-white'
          }`}>
            {tablePageItems.length === 0 ? (
              <div className={`text-center py-14 ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
                <AlertCircle size={26} className={`mx-auto mb-2 opacity-40 ${isLight ? 'text-sky-500' : 'text-cyan-400'}`} />
                <p className="font-mono text-xs">ไม่พบข้อมูลตามเงื่อนไขที่กรอง</p>
              </div>
            ) : (
              <div className={`divide-y ${isLight ? 'divide-slate-200/70' : 'divide-slate-800/60'}`}>
                {tablePageItems.map(entry => {
                  const isActive = entry.status !== 'archived'
                  const meta = getGroupMeta(entry.group_name)
                  return (
                    <div key={entry.id} className="flex items-center gap-2 px-3.5 py-3">
                      <button type="button" onClick={() => onEditEntry(entry)} className="flex-1 min-w-0 text-left">
                        <p className="text-xs font-bold truncate flex items-center gap-1.5">
                          <span>{meta.emoji}</span>
                          <span className="truncate">{entry.name || '(ไม่มีชื่อ)'}</span>
                        </p>
                        <p className={`text-[10px] mt-0.5 truncate ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{entry.category}</p>
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        {onViewOnMap && (
                          <button type="button" onClick={() => onViewOnMap(entry)} aria-label="ดูบนแผนที่" title="ดูบนแผนที่"
                            className={`p-1.5 rounded-lg border ${isLight ? 'bg-white border-slate-200 text-slate-500 hover:text-sky-700' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-cyan-300'}`}>
                            <MapPin size={13} />
                          </button>
                        )}
                        <button type="button" onClick={() => onEditEntry(entry)} aria-label="แก้ไข" title="แก้ไข"
                          className={`p-1.5 rounded-lg border ${isLight ? 'bg-white border-slate-200 text-slate-500 hover:text-sky-700' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-cyan-300'}`}>
                          <Pencil size={13} />
                        </button>
                        <button type="button" onClick={() => toggleStatus(entry)} aria-label={isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'} title={isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                          className={`p-1.5 rounded-lg border ${
                            isActive
                              ? (isLight ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400')
                              : (isLight ? 'bg-slate-100 border-slate-200 text-slate-400' : 'bg-slate-800 border-slate-700 text-slate-500')
                          }`}>
                          {isActive ? <Eye size={13} /> : <EyeOff size={13} />}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            <div className={`flex items-center justify-between gap-3 px-3.5 py-2.5 border-t text-xs ${isLight ? 'bg-slate-50 border-slate-200 text-slate-600' : 'bg-slate-950/80 border-cyan-500/20 text-slate-300'}`}>
              <span className="font-mono text-[11px]">{tableSorted.length} รายการ</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px]">หน้า {tableCurrentPage}/{tableTotalPages}</span>
                <button onClick={() => setTablePage(p => Math.max(1, p - 1))} disabled={tableCurrentPage <= 1}
                  className={`p-1 rounded-lg border disabled:opacity-30 ${isLight ? 'bg-white border-slate-300 text-slate-700' : 'bg-slate-900 border-slate-800 text-slate-300'}`}>
                  <ChevronLeft size={14} />
                </button>
                <button onClick={() => setTablePage(p => Math.min(tableTotalPages, p + 1))} disabled={tableCurrentPage >= tableTotalPages}
                  className={`p-1 rounded-lg border disabled:opacity-30 ${isLight ? 'bg-white border-slate-300 text-slate-700' : 'bg-slate-900 border-slate-800 text-slate-300'}`}>
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>

          {/* Desktop Cyber HUD Data Table */}
          <div className={`hidden md:block rounded-2xl border shadow-2xl backdrop-blur-xl overflow-hidden ${
            isLight ? 'bg-white/95 border-slate-200 text-slate-800' : 'bg-slate-900/90 border-cyan-500/30 text-white'
          }`}>
            <div className={`flex items-center justify-end px-4 py-2 border-b text-xs font-mono ${isLight ? 'bg-slate-50/90 border-slate-200 text-slate-600' : 'bg-slate-950/60 border-cyan-500/20 text-cyan-400/80'}`}>
              FOUND: <span className={`font-bold ml-1 ${isLight ? 'text-sky-700' : 'text-cyan-300'}`}>{tableSorted.length}</span>&nbsp;/ {entries.length}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className={`border-b text-left ${isLight ? 'bg-slate-100/90 border-slate-200 text-slate-600' : 'bg-slate-950/80 border-cyan-500/20 text-slate-400'}`}>
                    <th className="w-14 px-3.5 py-3 font-extrabold text-center uppercase tracking-wider text-[11px]">#</th>
                    <SortHeader label="ชื่อสถานที่ / รายการ" sortKey="name" activeKey={tableSortKey} dir={tableSortDir} onSort={sortByColumn} />
                    <SortHeader label="กลุ่มหลัก" sortKey="group_name" activeKey={tableSortKey} dir={tableSortDir} onSort={sortByColumn} />
                    <SortHeader label="ประเภทย่อย" sortKey="category" activeKey={tableSortKey} dir={tableSortDir} onSort={sortByColumn} />
                    <th className="px-3.5 py-3 font-extrabold uppercase tracking-wider text-[11px]">พิกัด GIS</th>
                    <SortHeader label="สถานะ" sortKey="status" activeKey={tableSortKey} dir={tableSortDir} onSort={sortByColumn} className="text-center" />
                    <th className="w-32 px-3.5 py-3 font-extrabold uppercase tracking-wider text-[11px] text-center">จัดการ</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isLight ? 'divide-slate-200/70' : 'divide-slate-800/60'}`}>
                  {tablePageItems.length === 0 ? (
                    <tr>
                      <td colSpan={7} className={`text-center py-16 ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
                        <AlertCircle size={28} className={`mx-auto mb-2 opacity-40 ${isLight ? 'text-sky-500' : 'text-cyan-400'}`} />
                        <p className="font-mono text-xs">ไม่พบข้อมูลตามเงื่อนไขที่กรอง</p>
                      </td>
                    </tr>
                  ) : tablePageItems.map((entry, i) => {
                    const isActive = entry.status !== 'archived'
                    const meta = getGroupMeta(entry.group_name)
                    return (
                      <tr key={entry.id} className={`transition-colors group ${isLight ? 'hover:bg-sky-50/60' : 'hover:bg-cyan-500/5'}`}>
                        <td className={`px-3.5 py-3 text-center font-mono font-bold ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
                          {(tableCurrentPage - 1) * tablePageSize + i + 1}
                        </td>
                        <td className={`px-3.5 py-3 font-semibold transition-colors ${isLight ? 'text-slate-900 group-hover:text-sky-700' : 'text-slate-100 group-hover:text-cyan-300'}`}>
                          <div className="flex items-center gap-2">
                            <span>{meta.emoji}</span>
                            <span>{entry.name || <span className={`italic ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>(ไม่มีชื่อ)</span>}</span>
                          </div>
                        </td>
                        <td className="px-3.5 py-3 font-medium">
                          <span className="inline-block px-2.5 py-0.5 rounded-lg border text-[11px] font-semibold"
                            style={{ backgroundColor: withAlpha(meta.bg, 0.15), color: meta.bg, borderColor: withAlpha(meta.bg, 0.35) }}>
                            {entry.group_name}
                          </span>
                        </td>
                        <td className={isLight ? 'px-3.5 py-3 text-slate-600' : 'px-3.5 py-3 text-slate-400'}>{entry.category}</td>
                        <td className={`px-3.5 py-3 font-mono text-[11px] ${isLight ? 'text-sky-800' : 'text-cyan-400/80'}`}>
                          {entry.route_points?.length
                            ? `เส้นทาง ${entry.route_points.length} จุด`
                            : entry.latitude != null ? `${Number(entry.latitude).toFixed(5)}, ${Number(entry.longitude).toFixed(5)}` : '—'}
                        </td>
                        <td className="px-3.5 py-3 text-center">
                          <span className={`inline-flex items-center gap-1.5 text-[10px] font-black px-2.5 py-1 rounded-full border shadow-sm ${
                            isActive
                              ? (isLight ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400')
                              : (isLight ? 'bg-slate-100 border-slate-200 text-slate-400' : 'bg-slate-800 border-slate-700 text-slate-500')
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                            {isActive ? 'ใช้งาน' : 'ไม่ใช้งาน'}
                          </span>
                        </td>
                        <td className="px-3.5 py-3">
                          <div className="flex items-center justify-center gap-1.5">
                            {onViewOnMap && (
                              <button type="button" onClick={() => onViewOnMap(entry)} aria-label="ดูบนแผนที่"
                                className={`p-1.5 rounded-xl border transition-colors ${
                                  isLight ? 'bg-white border-slate-200 text-slate-600 hover:text-sky-700 hover:border-sky-300' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-cyan-300 hover:border-cyan-500/40'
                                }`}>
                                <MapPin size={13} />
                              </button>
                            )}
                            <button type="button" onClick={() => onEditEntry(entry)} aria-label="แก้ไข"
                              className={`p-1.5 rounded-xl border transition-colors ${
                                isLight ? 'bg-white border-slate-200 text-slate-600 hover:text-sky-700 hover:border-sky-300' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-cyan-300 hover:border-cyan-500/40'
                              }`}>
                              <Pencil size={13} />
                            </button>
                            <button type="button" onClick={() => toggleStatus(entry)} aria-label={isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                              className={`p-1.5 rounded-xl border transition-colors ${
                                isActive
                                  ? (isLight ? 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100' : 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/20')
                                  : (isLight ? 'bg-slate-100 border-slate-200 text-slate-400 hover:text-slate-600' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300')
                              }`}>
                              {isActive ? <Eye size={13} /> : <EyeOff size={13} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t text-xs ${isLight ? 'bg-slate-50 border-slate-200 text-slate-600' : 'bg-slate-950/80 border-cyan-500/20 text-slate-300'}`}>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] opacity-70">ROWS PER PAGE:</span>
                <select value={tablePageSize}
                  onChange={e => { setTablePageSize(Number(e.target.value)); setTablePage(1) }}
                  className={`text-xs px-2 py-1 rounded-lg border font-mono focus:outline-none ${isLight ? 'bg-white border-slate-300 text-sky-800 focus:border-sky-500' : 'bg-slate-900 border-slate-700 text-cyan-300 focus:border-cyan-400'}`}>
                  {TABLE_PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs">
                  PAGE <span className={`font-bold ${isLight ? 'text-sky-700' : 'text-cyan-400'}`}>{tableCurrentPage}</span> / {tableTotalPages}
                </span>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setTablePage(p => Math.max(1, p - 1))} disabled={tableCurrentPage <= 1}
                    className={`p-1.5 rounded-xl border disabled:opacity-30 transition-colors ${isLight ? 'bg-white border-slate-300 text-slate-700 hover:border-sky-400 hover:text-sky-700' : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-cyan-500/40 hover:text-cyan-300'}`}>
                    <ChevronLeft size={15} />
                  </button>
                  <button onClick={() => setTablePage(p => Math.min(tableTotalPages, p + 1))} disabled={tableCurrentPage >= tableTotalPages}
                    className={`p-1.5 rounded-xl border disabled:opacity-30 transition-colors ${isLight ? 'bg-white border-slate-300 text-slate-700 hover:border-sky-400 hover:text-sky-700' : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-cyan-500/40 hover:text-cyan-300'}`}>
                    <ChevronRight size={15} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
