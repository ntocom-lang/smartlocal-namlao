import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Database, Layers, Radio, Globe, Sparkles, Upload, Plus, BarChart3, MapPin,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Pencil, Eye, EyeOff, Search, Filter, AlertCircle,
  Download, AlertTriangle, RefreshCw, Loader2, Building2,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import DataCenterImportModal from './DataCenterImportModal'
import GroupIconPicker from './GroupIconPicker'
import { resolveGroupEmoji, resolveEntryEmoji, fetchGroupIconOverrides, saveGroupIconOverride, iconKey } from '../../lib/dataCenterGroupIcon'

const TABLE_PAGE_SIZES = [10, 20, 50, 100]

// bg เดิมของ getGroupMeta เป็นสีทึบ (ใช้กับแท่ง/ป้าย #อันดับ) — ตารางรายการต้องการป้ายกลุ่มแบบโปร่งแสง
// (bg จาง + ตัวอักษรสีทึบ) แปลง hex → rgba(alpha) เอาเอง กันต้องผูกชุดสีที่สองแยกจาก getGroupMeta
function withAlpha(hex, alpha) {
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function formatThaiDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ตัวกรอง ilike ของ PostgREST ตีความ % และ _ เป็น wildcard — escape กันคำค้นที่มีอักขระนี้
// ไปแมตช์ผิดขอบเขตที่ผู้ใช้ตั้งใจพิมพ์ (ไม่ใช่ช่องโหว่ SQL injection เพราะ parameterized อยู่แล้ว)
function escapeIlikeTerm(term) {
  return term.replace(/[%_\\]/g, m => '\\' + m)
}

// pattern เดียวกับ src/components/fleet/FleetReport.jsx — BOM นำหน้ากัน Excel ไทยอ่านเพี้ยน
function downloadCSV(rows, filename) {
  const csv = '﻿' + rows.map(r =>
    r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')
  ).join('\n')
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })),
    download: filename,
  })
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
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

// อิโมจิย้ายไปใช้ resolveGroupEmoji() ร่วมกับแผนที่ (src/lib/dataCenterGroupIcon.js) แล้ว — เหลือแค่สี
// (bg/border/text) ที่ยังคำนวณแยกในไฟล์นี้ เพราะเป็นสไตล์เฉพาะของการ์ด/ป้ายในหน้ารายการ ไม่ต้องตรงกับแผนที่
// overrides: { [group_name]: emoji } จาก data_center_group_icons ของเทศบาลนี้ (แอดมินตั้งเอง)
function getGroupMeta(name, overrides = {}) {
  const emoji = resolveGroupEmoji(name, overrides)
  if (!name) return { bg: '#64748b', border: '#94a3b8', text: '#f1f5f9', emoji }
  if (GROUP_COLORS[name]) return { ...GROUP_COLORS[name], emoji }

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
  // สถิติทั้งก้อนมาจาก RPC data_center_summary ที่ DataCenterDashboard เรียกไว้ครั้งเดียว
  // คอมโพเนนต์นี้ไม่ดึงข้อมูลมานับเองอีกแล้ว (ยกเว้น fetchListPage ที่เป็นหน้ารายการจริง)
  summary = null,
  summaryError = null,
  onDataChanged,
  onRetrySummary,
  theme = 'dark',
  initialFilterGroup = null,
  initialFilterCategory = null,
}) {
  const isLight = theme === 'light'
  const tenantId = tenant?.id
  const hasActiveFilter = Boolean(initialFilterGroup || initialFilterCategory)

  // ไอคอนกลุ่มหลักที่แอดมินตั้งเอง (data_center_group_icons) — ใช้ร่วมกับแผนที่ผ่าน
  // resolveGroupEmoji() กันอิโมจิไม่ตรงกันระหว่าง 2 หน้า ดู src/lib/dataCenterGroupIcon.js
  const [groupIconOverrides, setGroupIconOverrides] = useState({})
  const canEditGroupIcon = ['admin', 'superadmin'].includes(profile?.role)
  const [editingGroupIcon, setEditingGroupIcon] = useState(false)
  const [groupIconDraft, setGroupIconDraft] = useState('')
  const [savingGroupIcon, setSavingGroupIcon] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)

  // desktop table: ค้นหา/กรอง/เรียง/แบ่งหน้าอิสระจากสไลด์เมนูซ้าย (sync ค่าเริ่มต้นมาจากมันตอน filter เปลี่ยน)
  const [tableSearch, setTableSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [tableFilterGroup, setTableFilterGroup] = useState(initialFilterGroup ?? 'all')
  const [tableFilterCategory, setTableFilterCategory] = useState(initialFilterCategory ?? 'all')
  const [tableFilterStatus, setTableFilterStatus] = useState('all')
  const [tableSortKey, setTableSortKey] = useState('name')
  const [tableSortDir, setTableSortDir] = useState('asc')
  const [tablePage, setTablePage] = useState(1)
  const [tablePageSize, setTablePageSize] = useState(20) // ค่าเริ่มต้นเดิม — TABLE_PAGE_SIZES เพิ่ม 10 เข้ามาแค่เป็นตัวเลือก ไม่ใช่ default ใหม่
  const [exporting, setExporting] = useState(false)

  // แถวจริงของหน้าปัจจุบัน (ตาราง desktop + การ์ด mobile) — ต่างจาก entries ด้านบน
  // ตรงที่กรอง/เรียง/แบ่งหน้าที่ server ไม่ใช่ในเบราว์เซอร์ กันโหลดข้อมูลหนัก (photo_urls/description ฯลฯ)
  // ของทั้งเทศบาลมาทั้งก้อนเวลามีเป็นพันแถว
  const [listRows, setListRows] = useState([])
  const [listTotal, setListTotal] = useState(0)
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState(null)

  useEffect(() => {
    if (!tenantId) return
    fetchGroupIconOverrides(supabase, tenantId).then(setGroupIconOverrides)
  }, [tenantId])

  // debounce คำค้นก่อนยิง query กันยิงรัวทุกตัวอักษรที่พิมพ์
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(tableSearch.trim()), 300)
    return () => clearTimeout(t)
  }, [tableSearch])

  // เมนูซ้ายเปลี่ยนหมวด → sync ตารางให้กรองตามทันที (ไม่งั้นกดเมนูซ้ายแล้วตารางยังโชว์ของเดิม)
  // ปรับ state ระหว่าง render ตามแพทเทิร์นที่ React แนะนำ (ไม่ใช้ useEffect ตั้ง state ตรงๆ กันเรนเดอร์ซ้อน)
  const [prevSidebarFilter, setPrevSidebarFilter] = useState({ group: initialFilterGroup, category: initialFilterCategory })
  if (prevSidebarFilter.group !== initialFilterGroup || prevSidebarFilter.category !== initialFilterCategory) {
    setPrevSidebarFilter({ group: initialFilterGroup, category: initialFilterCategory })
    setTableFilterGroup(initialFilterGroup ?? 'all')
    setTableFilterCategory(initialFilterCategory ?? 'all')
    setTablePage(1)
  }

  // หน้ารายการจริง (เฉพาะตอนเจาะเข้าโหมดดูรายการ) — กรอง/เรียง/แบ่งหน้าที่ server ทั้งหมด
  // listRequestRef กัน race condition: เปลี่ยนตัวกรองรัวๆ แล้ว response เก่ามาถึงทีหลัง response ใหม่ จะไม่ทับข้อมูลล่าสุด
  const listRequestRef = useRef(0)
  const fetchListPage = useCallback(() => {
    if (!tenantId || !hasActiveFilter || !onEditEntry) { setListRows([]); setListTotal(0); return }
    const requestId = ++listRequestRef.current
    setListLoading(true)
    setListError(null)
    let query = supabase.from('data_center_entries')
      .select('id, name, group_name, category, status, latitude, longitude, description, photo_urls, external_url, route_points, route_color, department_id, created_by, created_at', { count: 'exact' })
      .eq('municipality_id', tenantId)
    if (tableFilterGroup !== 'all') query = query.eq('group_name', tableFilterGroup)
    if (tableFilterCategory !== 'all') query = query.eq('category', tableFilterCategory)
    if (tableFilterStatus !== 'all') query = query.eq('status', tableFilterStatus)
    if (debouncedSearch) query = query.ilike('name', `%${escapeIlikeTerm(debouncedSearch)}%`)
    query = query.order(tableSortKey, { ascending: tableSortDir === 'asc' })
    // "ทั้งหมด" ไม่ใส่ .range() เลย — ให้ limit เริ่มต้นของ PostgREST (โดยปกติ 1000 แถว) เป็นเพดานกันเผื่อ
    // ไม่ใช่การดึงไม่จำกัดจริงๆ ผู้ใช้ต้องกดเลือกเองด้วย ไม่ใช่ค่าเริ่มต้นของหน้า
    if (tablePageSize !== 'all') {
      query = query.range((tablePage - 1) * tablePageSize, tablePage * tablePageSize - 1)
    }
    query.then(({ data, count, error }) => {
      if (requestId !== listRequestRef.current) return // มี request ใหม่กว่าแทรกไปแล้ว ทิ้ง response นี้
      if (error) { setListError(error.message); setListRows([]); setListTotal(0) }
      else { setListRows(data ?? []); setListTotal(count ?? 0) }
      setListLoading(false)
    })
  }, [tenantId, hasActiveFilter, onEditEntry, tableFilterGroup, tableFilterCategory, tableFilterStatus, debouncedSearch, tableSortKey, tableSortDir, tablePage, tablePageSize])

  useEffect(() => {
    queueMicrotask(fetchListPage)
  }, [fetchListPage])

  async function toggleStatus(entry) {
    const nextStatus = entry.status === 'active' ? 'archived' : 'active'
    setListRows(prev => prev.map(e => e.id === entry.id ? { ...e, status: nextStatus } : e))
    const { error } = await supabase.from('data_center_entries').update({ status: nextStatus }).eq('id', entry.id)
    if (error) {
      setListRows(prev => prev.map(e => e.id === entry.id ? { ...e, status: entry.status } : e))
      alert('บันทึกไม่สำเร็จ: ' + error.message)
      return
    }
    // ตัวเลขบนการ์ดสถิติ/ทรีเมนูซ้ายมาจาก summary ที่ parent ถืออยู่ ต้องบอกให้ดึงใหม่
    // (ใช้ callback แยก ไม่ใช่ refreshKey เพราะ refreshKey จะ remount แล้วล้างตัวกรอง/หน้าที่ผู้ใช้เปิดค้างไว้)
    onDataChanged?.()
  }

  function sortByColumn(key) {
    if (tableSortKey === key) setTableSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setTableSortKey(key); setTableSortDir('asc') }
    setTablePage(1)
  }

  // ส่งออก CSV ตามตัวกรอง/คำค้น/การเรียงปัจจุบันของตาราง (ไม่ใช่แค่หน้าที่กำลังโชว์) จำกัด 5,000 แถวกันไฟล์บวมเกินจำเป็น
  async function handleExportCSV() {
    if (!tenantId || exporting) return
    setExporting(true)
    let query = supabase.from('data_center_entries')
      .select('name, group_name, category, status, latitude, longitude, route_points, created_at')
      .eq('municipality_id', tenantId)
    if (tableFilterGroup !== 'all') query = query.eq('group_name', tableFilterGroup)
    if (tableFilterCategory !== 'all') query = query.eq('category', tableFilterCategory)
    if (tableFilterStatus !== 'all') query = query.eq('status', tableFilterStatus)
    if (debouncedSearch) query = query.ilike('name', `%${escapeIlikeTerm(debouncedSearch)}%`)
    query = query.order(tableSortKey, { ascending: tableSortDir === 'asc' }).limit(5000)
    const { data, error } = await query
    setExporting(false)
    if (error) { alert('ส่งออกไม่สำเร็จ: ' + error.message); return }
    downloadCSV([
      ['ชื่อสถานที่', 'กลุ่มหลัก', 'ประเภทย่อย', 'สถานะ', 'พิกัด/เส้นทาง', 'บันทึกเมื่อ'],
      ...(data ?? []).map(e => [
        e.name ?? '',
        e.group_name ?? '',
        e.category ?? '',
        e.status === 'archived' ? 'ไม่ใช้งาน' : 'ใช้งาน',
        e.route_points?.length ? `เส้นทาง ${e.route_points.length} จุด` : (e.latitude != null ? `${e.latitude}, ${e.longitude}` : ''),
        formatThaiDate(e.created_at),
      ]),
    ], `ศูนย์ข้อมูลดิจิทัล_${filterLabel}_${new Date().toISOString().slice(0, 10)}.csv`)
  }

  if (!summary && !summaryError) return (
    <div className="flex flex-col items-center justify-center py-24 gap-3">
      <div className="relative w-12 h-12 flex items-center justify-center">
        <div className={`absolute inset-0 rounded-full border-4 ${isLight ? 'border-sky-200 border-t-sky-600' : 'border-cyan-500/20 border-t-cyan-400'} animate-spin`} />
        <Database size={20} className={isLight ? 'text-sky-600 animate-pulse' : 'text-cyan-400 animate-pulse'} />
      </div>
      <p className={`text-xs font-mono animate-pulse ${isLight ? 'text-sky-700 font-bold' : 'text-cyan-300/80'}`}>LOADING DIGITAL CORE ANALYTICS...</p>
    </div>
  )

  // ── สถิติทั้งหมด derive จาก summary (นับมาจาก server แล้ว) ──────────────────────────
  // scopedGroups = กลุ่ม/ประเภทที่อยู่ในขอบเขตตัวกรองเมนูซ้ายปัจจุบัน ให้ผลเท่ากับ filteredEntries เดิม
  //   ไม่มีตัวกรอง        → ทุกกลุ่ม
  //   กรองกลุ่มหลัก       → เฉพาะกลุ่มนั้น
  //   กรองถึงประเภทย่อย  → เฉพาะกลุ่มนั้น และยุบตัวเลขให้เหลือของประเภทย่อยนั้นตัวเดียว
  const allSummaryGroups = summary?.groups ?? []
  const scopedGroups = (initialFilterGroup
    ? allSummaryGroups.filter(g => g.group_name === initialFilterGroup)
    : allSummaryGroups
  ).map(g => {
    if (!initialFilterCategory) return g
    const c = (g.categories ?? []).find(x => x.category === initialFilterCategory)
    return c ? { ...c, group_name: g.group_name, categories: [c] } : null
  }).filter(Boolean)

  const sumBy = key => scopedGroups.reduce((acc, g) => acc + (g[key] ?? 0), 0)
  const filterLabel = initialFilterCategory || initialFilterGroup || 'ข้อมูลทั้งหมด'
  // ไอคอนที่ระบบจะเลือกให้กลุ่มนี้ถ้าไม่ตั้งเอง — ตัด override ของกลุ่มนี้ทิ้งก่อนคำนวณ
  // ใช้โชว์ตัวอย่างในโหมด "อัตโนมัติ" ของ GroupIconPicker
  const autoGroupEmoji = (() => {
    if (!initialFilterGroup) return '📍'
    const withoutSelf = { ...groupIconOverrides }
    delete withoutSelf[iconKey(initialFilterGroup, '')]
    return resolveGroupEmoji(initialFilterGroup, withoutSelf)
  })()
  const totalEntries = sumBy('total')
  const activeEntriesCount = sumBy('active')
  const activeRate = totalEntries ? Math.round((activeEntriesCount / totalEntries) * 100) : 100
  const recentCount = sumBy('recent_30d')

  // GIS Types — latitude/longitude เป็น NOT NULL ทุกแถว "จุดพิกัด" จึงหมายถึงแถวที่ไม่ใช่เส้นทาง
  const polylineCount = sumBy('routes')
  const pointCount = sumBy('points')

  const groupStatsList = scopedGroups.map(g => ({
    name: g.group_name,
    count: g.total,
    active: g.active,
    points: g.points,
    routes: g.routes,
    catCount: (g.categories ?? []).length,
    percent: totalEntries ? Math.round((g.total / totalEntries) * 100) : 0,
    meta: getGroupMeta(g.group_name, groupIconOverrides),
  })).sort((a, b) => b.count - a.count)

  // Department breakdown — RPC join ชื่อกองมาให้แล้ว (name เป็น null ได้ถ้า RLS ของ departments
  // ไม่ให้เห็นแถวนั้น) ส่วนนี้แสดงเฉพาะตอนไม่มีตัวกรอง จึงใช้ยอดรวมทั้งเทศบาลตรงๆ
  const deptStatsList = (summary?.departments ?? []).map(d => ({
    id: d.department_id ?? 'none',
    name: d.department_id ? (d.name || 'ไม่ทราบชื่อกอง') : 'ไม่ระบุกอง',
    count: d.total,
    percent: totalEntries ? Math.round((d.total / totalEntries) * 100) : 0,
  })).sort((a, b) => b.count - a.count)

  // ตัวเลือกในดรอปดาวน์ของตาราง — อิสระจากตัวกรองเมนูซ้าย ผู้ใช้เปลี่ยนเป็น "ทุกกลุ่ม" ดูทั้งหมดได้เอง
  // จึงอ่านจาก allSummaryGroups (ทั้งเทศบาล) ไม่ใช่ scopedGroups
  const allGroups = allSummaryGroups.map(g => g.group_name).sort((a, b) => a.localeCompare(b, 'th'))
  const tableCategoryOptions = Array.from(new Set(
    allSummaryGroups
      .filter(g => tableFilterGroup === 'all' || g.group_name === tableFilterGroup)
      .flatMap(g => (g.categories ?? []).map(c => c.category))
  )).sort((a, b) => a.localeCompare(b, 'th'))

  // กรอง/เรียง/แบ่งหน้าแล้วที่ server (fetchListPage) — เหลือแค่ derive ตัวเลขหน้าไว้แสดงผล
  // effectivePageSize กัน tablePageSize === 'all' (string) เข้าไปคำนวณเลขคณิตตรงๆ แล้วได้ NaN
  const effectivePageSize = tablePageSize === 'all' ? Math.max(listTotal, 1) : tablePageSize
  const tableTotalPages = Math.max(1, Math.ceil(listTotal / effectivePageSize))
  const tableCurrentPage = Math.min(tablePage, tableTotalPages)
  const tablePageItems = listRows

  return (
    <div className="space-y-6">
      {showImportModal && (
        <DataCenterImportModal
          tenant={tenant}
          profile={profile}
          onClose={() => setShowImportModal(false)}
          onImportComplete={() => {
            setShowImportModal(false)
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
          {/* ดูข้อมูลเฉพาะกลุ่มหลัก (เช่นกดจากการ์ดหมวดหมู่) — โชว์อิโมจิของกลุ่มนั้นแทนไอคอนแดชบอร์ด
              ทั่วไป พร้อมปุ่มแก้ไข (admin/superadmin เท่านั้น) แก้แล้วมีผลกับหน้ารายการ+แผนที่ทันที
              เพราะดึงจากตาราง data_center_group_icons ตัวเดียวกัน */}
          {hasActiveFilter && initialFilterGroup ? (
            <div className="relative shrink-0">
              <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shadow-inner text-xl ${
                isLight ? 'bg-sky-100 border-sky-300' : 'bg-cyan-500/20 border-cyan-500/40'
              }`}>
                {resolveGroupEmoji(initialFilterGroup, groupIconOverrides)}
              </div>
              {canEditGroupIcon && (
                <button type="button" title="แก้ไขไอคอนกลุ่มนี้"
                  onClick={() => { setGroupIconDraft(groupIconOverrides[iconKey(initialFilterGroup, '')] ?? ''); setEditingGroupIcon((v) => !v) }}
                  className={`absolute -bottom-1.5 -right-1.5 w-5 h-5 rounded-full border flex items-center justify-center shadow-sm ${
                    isLight ? 'bg-white border-slate-300 text-slate-500 hover:text-sky-600' : 'bg-slate-800 border-cyan-500/40 text-cyan-300 hover:text-cyan-100'
                  }`}>
                  <Pencil size={10} />
                </button>
              )}
              {editingGroupIcon && (
                <div className={`absolute z-20 top-full left-0 mt-2 w-80 px-3 pb-3 pt-2.5 rounded-xl border shadow-xl ${
                  isLight ? 'bg-white border-slate-200' : 'bg-slate-800 border-cyan-500/30'
                }`}>
                  <p className={`text-[11px] font-bold ${isLight ? 'text-slate-600' : 'text-cyan-200/80'}`}>
                    ไอคอนกลุ่ม "{initialFilterGroup}"
                  </p>
                  <p className={`text-[10px] ${isLight ? 'text-slate-400' : 'text-cyan-200/50'}`}>
                    แยกไอคอนรายประเภทย่อยได้ที่เมนู "จัดการหมวดหมู่"
                  </p>
                  <GroupIconPicker
                    value={groupIconDraft} saving={savingGroupIcon} isLight={isLight}
                    autoEmoji={autoGroupEmoji}
                    onChange={setGroupIconDraft}
                    onCancel={() => setEditingGroupIcon(false)}
                    onConfirm={async () => {
                      setSavingGroupIcon(true)
                      const { error } = await saveGroupIconOverride(supabase, {
                        municipalityId: tenantId, groupName: initialFilterGroup,
                        category: '', emoji: groupIconDraft, userId: profile?.id,
                      })
                      setSavingGroupIcon(false)
                      if (error) { alert('บันทึกไม่สำเร็จ: ' + error.message); return }
                      setGroupIconOverrides((prev) => {
                        const next = { ...prev }
                        const key = iconKey(initialFilterGroup, '')
                        if (groupIconDraft.trim()) next[key] = groupIconDraft.trim()
                        else delete next[key]
                        return next
                      })
                      setEditingGroupIcon(false)
                    }} />
                </div>
              )}
            </div>
          ) : (
            <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shadow-inner ${
              isLight ? 'bg-sky-100 border-sky-300 text-sky-700' : 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
            }`}>
              <BarChart3 size={21} className={isLight ? 'text-sky-600' : 'drop-shadow-[0_0_8px_rgba(0,240,255,0.6)]'} />
            </div>
          )}
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

      {summaryError && (
        <div className={`flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl border backdrop-blur-xl ${
          isLight ? 'bg-red-50 border-red-200 text-red-800' : 'bg-red-950/40 border-red-500/40 text-red-200'
        }`}>
          <div className="flex items-center gap-2 text-xs font-bold">
            <AlertTriangle size={16} className="shrink-0" />
            <span>โหลดข้อมูลไม่สำเร็จ: {summaryError}</span>
          </div>
          <button onClick={() => onRetrySummary?.()}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors shrink-0 ${
              isLight ? 'bg-white border-red-300 text-red-700 hover:bg-red-100' : 'bg-red-900/40 border-red-500/40 text-red-200 hover:bg-red-900/60'
            }`}>
            <RefreshCw size={13} /> ลองใหม่
          </button>
        </div>
      )}

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
          {recentCount > 0 && (
            <p className={`text-[9px] mt-1 font-bold ${isLight ? 'text-emerald-700' : 'text-emerald-400'}`}>
              +{recentCount} รายการใหม่ใน 30 วันล่าสุด
            </p>
          )}
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
          <p className={`text-lg font-black mt-1 font-mono tracking-tight ${isLight ? 'text-purple-700' : 'text-purple-300'}`}>{pointCount + polylineCount}</p>
          <p className={`text-[10px] mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            หมุดพิกัด {pointCount} | เส้นทาง {polylineCount}
          </p>
        </div>
      </div>

      {(summary?.totals?.total ?? 0) === 0 && !summaryError && (
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
      {(summary?.totals?.total ?? 0) > 0 && !hasActiveFilter && (
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
                  <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: withAlpha(g.meta.bg, 0.15) }} title={`${g.percent}% ของข้อมูลทั้งหมด`}>
                    <div className="h-full rounded-full" style={{ width: `${g.percent}%`, backgroundColor: g.meta.bg }} />
                  </div>
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

      {/* Department breakdown — เสริมมุมมองความรับผิดชอบต่อกอง/สำนัก แยกจากกลุ่มข้อมูล (group_name) ด้านบน */}
      {(summary?.totals?.total ?? 0) > 0 && !hasActiveFilter && deptStatsList.length > 0 && (
        <div className={`rounded-2xl border p-5 backdrop-blur-xl shadow-xl ${
          isLight ? 'bg-white/95 border-slate-200 text-slate-800' : 'bg-slate-900/90 border-cyan-500/30 text-white'
        }`}>
          <div className="flex items-center gap-2 mb-4">
            <Building2 size={16} className={isLight ? 'text-sky-600' : 'text-cyan-400'} />
            <h2 className="text-sm font-extrabold tracking-wide">แยกตามกอง/สำนักที่บันทึก</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3">
            {deptStatsList.map(d => (
              <div key={d.id} className="min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-semibold truncate">{d.name}</span>
                  <span className={`text-[11px] font-mono font-bold shrink-0 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{d.count} รายการ</span>
                </div>
                <div className={`h-1.5 rounded-full overflow-hidden ${isLight ? 'bg-sky-100' : 'bg-slate-800'}`} title={`${d.percent}% ของข้อมูลทั้งหมด`}>
                  <div className={`h-full rounded-full ${isLight ? 'bg-sky-500' : 'bg-cyan-400'}`} style={{ width: `${d.percent}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* โหมดดูรายการ — เจาะเข้ามาจากการ์ดหมวดด้านบน (หรือเมนูซ้าย/bottom sheet มือถือ) จำกัดด้วยตัวกรอง
          group/category เสมอ จึงมีขอบเขตจำนวนรายการที่ต้องแสดงต่อครั้งชัดเจน ไม่มีทางยาวเท่าข้อมูลทั้งระบบ */}
      {(summary?.totals?.total ?? 0) > 0 && hasActiveFilter && onEditEntry && (
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
            <button onClick={handleExportCSV} disabled={exporting}
              className={`ml-auto flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold border transition-all active:scale-95 shrink-0 disabled:opacity-50 ${
                isLight ? 'text-slate-700 bg-slate-50 border-slate-200 hover:bg-slate-100' : 'text-slate-200 bg-slate-800 border-slate-700 hover:bg-slate-700'
              }`}>
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              <span>{exporting ? 'กำลังส่งออก...' : 'ส่งออก CSV'}</span>
            </button>
            <button onClick={() => onAddNew(initialFilterGroup, initialFilterCategory)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold text-slate-950 bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 shadow-lg shadow-cyan-500/25 active:scale-95 transition-all shrink-0">
              <Plus size={14} strokeWidth={2.5} /> เพิ่มในหมวดนี้
            </button>
          </div>

          {/* Mobile flat list */}
          <div className={`md:hidden rounded-2xl border backdrop-blur-xl shadow-xl overflow-hidden ${
            isLight ? 'bg-white/95 border-slate-200 text-slate-800' : 'bg-slate-900/90 border-cyan-500/30 text-white'
          }`}>
            {listLoading ? (
              <div className={`text-center py-14 ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
                <Loader2 size={22} className={`mx-auto mb-2 animate-spin ${isLight ? 'text-sky-500' : 'text-cyan-400'}`} />
                <p className="font-mono text-xs">กำลังโหลด...</p>
              </div>
            ) : listError ? (
              <div className={`text-center py-14 ${isLight ? 'text-red-500' : 'text-red-300'}`}>
                <AlertTriangle size={26} className="mx-auto mb-2 opacity-70" />
                <p className="font-mono text-xs mb-2">โหลดรายการไม่สำเร็จ: {listError}</p>
                <button onClick={fetchListPage} className={`inline-flex items-center gap-1 px-3 py-1 rounded-lg border text-xs font-bold ${isLight ? 'bg-white border-red-300 text-red-700' : 'bg-red-900/40 border-red-500/40 text-red-200'}`}>
                  <RefreshCw size={12} /> ลองใหม่
                </button>
              </div>
            ) : tablePageItems.length === 0 ? (
              <div className={`text-center py-14 ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
                <AlertCircle size={26} className={`mx-auto mb-2 opacity-40 ${isLight ? 'text-sky-500' : 'text-cyan-400'}`} />
                <p className="font-mono text-xs">ไม่พบข้อมูลตามเงื่อนไขที่กรอง</p>
              </div>
            ) : (
              <div className={`divide-y ${isLight ? 'divide-slate-200/70' : 'divide-slate-800/60'}`}>
                {tablePageItems.map(entry => {
                  const isActive = entry.status !== 'archived'
                  // ไอคอนของแถวใช้ระดับ "ประเภทย่อย" ก่อนเสมอ (ทับไอคอนกลุ่มหลัก)
                  const entryEmoji = resolveEntryEmoji(entry.group_name, entry.category, groupIconOverrides)
                  return (
                    <div key={entry.id} className="flex items-center gap-2 px-3.5 py-3">
                      <button type="button" onClick={() => onEditEntry(entry)} className="flex-1 min-w-0 text-left">
                        <p className="text-xs font-bold truncate flex items-center gap-1.5">
                          <span>{entryEmoji}</span>
                          <span className="truncate">{entry.name || '(ไม่มีชื่อ)'}</span>
                        </p>
                        <p className={`text-[10px] mt-0.5 truncate ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{entry.category} · {formatThaiDate(entry.created_at)}</p>
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
              <span className="font-mono text-[11px]">{listTotal} รายการ</span>
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
              FOUND: <span className={`font-bold ml-1 ${isLight ? 'text-sky-700' : 'text-cyan-300'}`}>{listTotal}</span>&nbsp;/ {summary?.totals?.total ?? 0}
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
                    <SortHeader label="บันทึกเมื่อ" sortKey="created_at" activeKey={tableSortKey} dir={tableSortDir} onSort={sortByColumn} />
                    <th className="w-32 px-3.5 py-3 font-extrabold uppercase tracking-wider text-[11px] text-center">จัดการ</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isLight ? 'divide-slate-200/70' : 'divide-slate-800/60'}`}>
                  {listLoading ? (
                    <tr>
                      <td colSpan={8} className={`text-center py-16 ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
                        <Loader2 size={26} className={`mx-auto mb-2 animate-spin ${isLight ? 'text-sky-500' : 'text-cyan-400'}`} />
                        <p className="font-mono text-xs">กำลังโหลด...</p>
                      </td>
                    </tr>
                  ) : listError ? (
                    <tr>
                      <td colSpan={8} className={`text-center py-16 ${isLight ? 'text-red-500' : 'text-red-300'}`}>
                        <AlertTriangle size={26} className="mx-auto mb-2 opacity-70" />
                        <p className="font-mono text-xs mb-2">โหลดรายการไม่สำเร็จ: {listError}</p>
                        <button onClick={fetchListPage} className={`inline-flex items-center gap-1 px-3 py-1 rounded-lg border text-xs font-bold ${isLight ? 'bg-white border-red-300 text-red-700' : 'bg-red-900/40 border-red-500/40 text-red-200'}`}>
                          <RefreshCw size={12} /> ลองใหม่
                        </button>
                      </td>
                    </tr>
                  ) : tablePageItems.length === 0 ? (
                    <tr>
                      <td colSpan={8} className={`text-center py-16 ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
                        <AlertCircle size={28} className={`mx-auto mb-2 opacity-40 ${isLight ? 'text-sky-500' : 'text-cyan-400'}`} />
                        <p className="font-mono text-xs">ไม่พบข้อมูลตามเงื่อนไขที่กรอง</p>
                      </td>
                    </tr>
                  ) : tablePageItems.map((entry, i) => {
                    const isActive = entry.status !== 'archived'
                    const meta = getGroupMeta(entry.group_name, groupIconOverrides)
                    // ไอคอนของแถวใช้ระดับ "ประเภทย่อย" ก่อนเสมอ (ทับไอคอนกลุ่มหลัก) — meta เหลือไว้ใช้แค่สีป้ายกลุ่ม
                    const entryEmoji = resolveEntryEmoji(entry.group_name, entry.category, groupIconOverrides)
                    return (
                      <tr key={entry.id} className={`transition-colors group ${isLight ? 'hover:bg-sky-50/60' : 'hover:bg-cyan-500/5'}`}>
                        <td className={`px-3.5 py-3 text-center font-mono font-bold ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
                          {(tableCurrentPage - 1) * effectivePageSize + i + 1}
                        </td>
                        <td className={`px-3.5 py-3 font-semibold transition-colors ${isLight ? 'text-slate-900 group-hover:text-sky-700' : 'text-slate-100 group-hover:text-cyan-300'}`}>
                          <div className="flex items-center gap-2">
                            <span>{entryEmoji}</span>
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
                        <td className={`px-3.5 py-3 font-mono text-[11px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{formatThaiDate(entry.created_at)}</td>
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
                  onChange={e => { setTablePageSize(e.target.value === 'all' ? 'all' : Number(e.target.value)); setTablePage(1) }}
                  className={`text-xs px-2 py-1 rounded-lg border font-mono focus:outline-none ${isLight ? 'bg-white border-slate-300 text-sky-800 focus:border-sky-500' : 'bg-slate-900 border-slate-700 text-cyan-300 focus:border-cyan-400'}`}>
                  {TABLE_PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
                  <option value="all">ทั้งหมด</option>
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
