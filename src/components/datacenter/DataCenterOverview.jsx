import { useState, useEffect } from 'react'
import {
  Loader2, Plus, MapPinned, ChevronDown, ChevronUp, Pencil, ChevronLeft, ChevronRight,
  Upload, Eye, EyeOff, Search, Database, Layers, Radio, Globe, ShieldCheck, Sparkles, Filter, AlertCircle
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import DataCenterImportModal from './DataCenterImportModal'

const PAGE_SIZE = 8
const TABLE_PAGE_SIZES = [20, 50, 100]

const GROUP_META = {
  'สาธารณสุข':        { emoji: '⛑️', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)', border: 'rgba(239, 68, 68, 0.3)' },
  'สถานที่สำคัญ':      { emoji: '📍', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(16, 185, 129, 0.3)' },
  'สถานประกอบการ':     { emoji: '🏢', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)', border: 'rgba(245, 158, 11, 0.3)' },
  'การจัดการขยะ':      { emoji: '🗑️', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.15)', border: 'rgba(139, 92, 246, 0.3)' },
  'สถานศึกษา':         { emoji: '🏫', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)', border: 'rgba(59, 130, 246, 0.3)' },
  'โครงสร้างพื้นฐาน':   { emoji: '🏗️', color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.15)', border: 'rgba(6, 182, 212, 0.3)' },
  'สถานที่หลบภัย':     { emoji: '⛺', color: '#ec4899', bg: 'rgba(236, 72, 153, 0.15)', border: 'rgba(236, 72, 153, 0.3)' },
  'พื้นที่สีเขียว':     { emoji: '🌳', color: '#22c55e', bg: 'rgba(34, 197, 94, 0.15)', border: 'rgba(34, 197, 94, 0.3)' },
}
const FALLBACK_META = { emoji: '📌', color: '#00f0ff', bg: 'rgba(0, 240, 255, 0.15)', border: 'rgba(0, 240, 255, 0.3)' }
const groupMeta = g => GROUP_META[g] ?? FALLBACK_META

function SortHeader({ label, sortKey, activeKey, dir, onSort, className = '' }) {
  const active = activeKey === sortKey
  return (
    <th className={`px-3.5 py-3 font-extrabold select-none uppercase tracking-wider text-[11px] ${className}`}>
      <button type="button" onClick={() => onSort(sortKey)}
        className={`flex items-center gap-1 transition-colors ${active ? 'text-cyan-300 font-bold' : 'text-slate-400 hover:text-slate-200'}`}>
        {label}
        {active ? (dir === 'asc' ? <ChevronUp size={13} className="text-cyan-400" /> : <ChevronDown size={13} className="text-cyan-400" />) : <ChevronDown size={13} className="opacity-0 group-hover:opacity-40" />}
      </button>
    </th>
  )
}

export default function DataCenterOverview({ tenant, profile, onAddNew, onEditEntry, onImportSuccess, initialFilterGroup, initialFilterCategory, theme = 'dark' }) {
  const isLight = theme === 'light'

  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [openCategory, setOpenCategory] = useState(null)
  const [pageByCategory, setPageByCategory] = useState({})
  const [showImportModal, setShowImportModal] = useState(false)
  const [tableSearch, setTableSearch] = useState('')
  const [tableFilterGroup, setTableFilterGroup] = useState('all')
  const [tableFilterCategory, setTableFilterCategory] = useState('all')
  const [tableFilterStatus, setTableFilterStatus] = useState('all')
  const [tableSortKey, setTableSortKey] = useState('name')
  const [tableSortDir, setTableSortDir] = useState('asc')
  const [tablePage, setTablePage] = useState(1)
  const [tablePageSize, setTablePageSize] = useState(TABLE_PAGE_SIZES[0])

  const fetchEntries = () => {
    if (!tenant?.id) return
    setLoading(true)
    supabase.from('data_center_entries')
      .select('id, name, group_name, category, status, latitude, longitude, description, photo_urls, external_url, route_points, route_color')
      .eq('municipality_id', tenant.id)
      .then(({ data }) => { setEntries(data ?? []); setLoading(false) })
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

  useEffect(() => {
    fetchEntries()
  }, [tenant?.id])

  const [prevSidebarFilter, setPrevSidebarFilter] = useState({ group: initialFilterGroup, category: initialFilterCategory })
  if (prevSidebarFilter.group !== initialFilterGroup || prevSidebarFilter.category !== initialFilterCategory) {
    setPrevSidebarFilter({ group: initialFilterGroup, category: initialFilterCategory })
    if (initialFilterGroup) {
      setTableFilterGroup(initialFilterGroup)
      setTableFilterCategory(initialFilterCategory ?? 'all')
      setTablePage(1)
    }
  }

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-24 gap-3">
      <div className="relative w-12 h-12 flex items-center justify-center">
        <div className={`absolute inset-0 rounded-full border-4 ${isLight ? 'border-sky-200 border-t-sky-600' : 'border-cyan-500/20 border-t-cyan-400'} animate-spin`} />
        <Database size={20} className={isLight ? 'text-sky-600 animate-pulse' : 'text-cyan-400 animate-pulse'} />
      </div>
      <p className={`text-xs font-mono animate-pulse ${isLight ? 'text-sky-700 font-bold' : 'text-cyan-300/80'}`}>LOADING DIGITAL CORE DATA...</p>
    </div>
  )

  const groups = Array.from(new Set(entries.map(e => e.group_name))).sort((a, b) => a.localeCompare(b, 'th'))
  const activeEntriesCount = entries.filter(e => e.status !== 'archived').length
  const activeRate = entries.length ? Math.round((activeEntriesCount / entries.length) * 100) : 100
  const mappedGisCount = entries.filter(e => e.latitude != null || (e.route_points && e.route_points.length > 0)).length

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

  function sortByColumn(key) {
    if (tableSortKey === key) setTableSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setTableSortKey(key); setTableSortDir('asc') }
  }

  function toggleCategory(key) {
    setOpenCategory(prev => {
      const next = prev === key ? null : key
      if (next) setPageByCategory(p => ({ ...p, [key]: 1 }))
      return next
    })
  }

  function goToPage(key, page) {
    setPageByCategory(p => ({ ...p, [key]: page }))
  }

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
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl backdrop-blur-xl border shadow-xl ${
        isLight
          ? 'bg-white/90 border-slate-200 shadow-sky-950/5 text-slate-800'
          : 'bg-slate-900/80 border-cyan-500/30 shadow-cyan-950/40 text-white'
      }`}>
        <div>
          <div className="flex items-center gap-2.5">
            <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shadow-inner ${
              isLight ? 'bg-sky-100 border-sky-300 text-sky-700' : 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
            }`}>
              <Database size={19} className={isLight ? 'text-sky-600' : 'drop-shadow-[0_0_8px_rgba(0,240,255,0.6)]'} />
            </div>
            <div>
              <h1 className={`text-lg font-black tracking-wide ${
                isLight ? 'text-slate-900' : 'text-transparent bg-clip-text bg-gradient-to-r from-white via-cyan-100 to-cyan-400'
              }`}>
                ศูนย์รวมข้อมูลดิจิทัล
              </h1>
              <p className={`text-xs ${isLight ? 'text-slate-500' : 'text-cyan-200/70'}`}>ระบบบริหารจัดการพิกัดและโครงสร้างพื้นฐานดิจิทัล — {tenant?.name}</p>
            </div>
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Stat 1: Total Data Points */}
        <div className={`p-4 rounded-2xl border backdrop-blur-xl shadow-lg relative overflow-hidden group transition-all ${
          isLight
            ? 'bg-white/95 border-slate-200 hover:border-sky-400'
            : 'bg-gradient-to-br from-slate-900/90 to-cyan-950/40 border-cyan-500/30 hover:border-cyan-400/60'
        }`}>
          <div className={`absolute top-0 right-0 w-24 h-24 rounded-full blur-2xl pointer-events-none transition-all ${isLight ? 'bg-sky-500/10 group-hover:bg-sky-500/20' : 'bg-cyan-500/10 group-hover:bg-cyan-500/20'}`} />
          <div className="flex items-center justify-between">
            <span className={`text-[10px] font-black uppercase tracking-widest ${isLight ? 'text-sky-800' : 'text-cyan-400/70'}`}>TOTAL DATAPOINTS</span>
            <div className={`p-2 rounded-xl border ${isLight ? 'bg-sky-100 text-sky-700 border-sky-200' : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'}`}>
              <Database size={16} />
            </div>
          </div>
          <p className={`text-2xl font-black mt-2 font-mono tracking-tight ${isLight ? 'text-slate-900' : 'text-white cyber-text-glow'}`}>{entries.length}</p>
          <p className={`text-[11px] mt-1 flex items-center gap-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            <Sparkles size={11} className={isLight ? 'text-sky-600' : 'text-cyan-400'} /> รายการทั้งหมดในคลัง
          </p>
        </div>

        {/* Stat 2: Active Groups */}
        <div className={`p-4 rounded-2xl border backdrop-blur-xl shadow-lg relative overflow-hidden group transition-all ${
          isLight
            ? 'bg-white/95 border-slate-200 hover:border-blue-400'
            : 'bg-gradient-to-br from-slate-900/90 to-blue-950/40 border-blue-500/30 hover:border-blue-400/60'
        }`}>
          <div className={`absolute top-0 right-0 w-24 h-24 rounded-full blur-2xl pointer-events-none transition-all ${isLight ? 'bg-blue-500/10' : 'bg-blue-500/10'}`} />
          <div className="flex items-center justify-between">
            <span className={`text-[10px] font-black uppercase tracking-widest ${isLight ? 'text-blue-800' : 'text-blue-400/70'}`}>CATEGORIES</span>
            <div className={`p-2 rounded-xl border ${isLight ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-blue-500/20 text-blue-300 border-blue-500/40'}`}>
              <Layers size={16} />
            </div>
          </div>
          <p className={`text-2xl font-black mt-2 font-mono tracking-tight ${isLight ? 'text-slate-900' : 'text-white drop-shadow-[0_0_10px_rgba(59,130,246,0.5)]'}`}>{groups.length}</p>
          <p className={`text-[11px] mt-1 flex items-center gap-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            <span>กลุ่มหลักในเขตเทศบาล</span>
          </p>
        </div>

        {/* Stat 3: Active Status Rate */}
        <div className={`p-4 rounded-2xl border backdrop-blur-xl shadow-lg relative overflow-hidden group transition-all ${
          isLight
            ? 'bg-white/95 border-slate-200 hover:border-emerald-400'
            : 'bg-gradient-to-br from-slate-900/90 to-emerald-950/40 border-emerald-500/30 hover:border-emerald-400/60'
        }`}>
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className={`text-[10px] font-black uppercase tracking-widest ${isLight ? 'text-emerald-800' : 'text-emerald-400/70'}`}>OPERATIONAL RATE</span>
            <div className={`p-2 rounded-xl border ${isLight ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'}`}>
              <Radio size={16} className="animate-pulse" />
            </div>
          </div>
          <p className={`text-2xl font-black mt-2 font-mono tracking-tight ${isLight ? 'text-emerald-600' : 'text-emerald-400 drop-shadow-[0_0_10px_rgba(16,185,129,0.5)]'}`}>{activeRate}%</p>
          <p className={`text-[11px] mt-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            พร้อมใช้งานบนแผนที่ ({activeEntriesCount} รายการ)
          </p>
        </div>

        {/* Stat 4: GIS Spatial Coverage */}
        <div className={`p-4 rounded-2xl border backdrop-blur-xl shadow-lg relative overflow-hidden group transition-all ${
          isLight
            ? 'bg-white/95 border-slate-200 hover:border-purple-400'
            : 'bg-gradient-to-br from-slate-900/90 to-purple-950/40 border-purple-500/30 hover:border-purple-400/60'
        }`}>
          <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/10 rounded-full blur-2xl pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className={`text-[10px] font-black uppercase tracking-widest ${isLight ? 'text-purple-800' : 'text-purple-400/70'}`}>GIS MAPPED</span>
            <div className={`p-2 rounded-xl border ${isLight ? 'bg-purple-100 text-purple-700 border-purple-200' : 'bg-purple-500/20 text-purple-300 border-purple-500/40'}`}>
              <Globe size={16} />
            </div>
          </div>
          <p className={`text-2xl font-black mt-2 font-mono tracking-tight ${isLight ? 'text-purple-700' : 'text-purple-300 drop-shadow-[0_0_10px_rgba(168,85,247,0.5)]'}`}>{mappedGisCount}</p>
          <p className={`text-[11px] mt-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            มีพิกัดหมุด / เส้นทาง GIS
          </p>
        </div>
      </div>

      {groups.length === 0 && (
        <div className={`flex flex-col items-center justify-center py-20 rounded-2xl border backdrop-blur-xl ${
          isLight ? 'bg-white/90 border-slate-200 text-slate-600' : 'bg-slate-900/70 border-cyan-500/20 text-slate-400'
        }`}>
          <MapPinned size={48} className={isLight ? 'mb-3 text-sky-400/40 animate-pulse' : 'mb-3 text-cyan-400/30 animate-pulse'} />
          <p className={`text-base font-bold ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>ยังไม่มีข้อมูลในศูนย์รวมดิจิทัล</p>
          <p className="text-xs mt-1 opacity-80">กดปุ่ม "บันทึกข้อมูลใหม่" หรือ "นำเข้า KML/GIS" เพื่อเริ่มสร้างคลังข้อมูลดิจิทัล</p>
        </div>
      )}

      {/* Mobile Cyber Cards View */}
      {groups.length > 0 && (
        <div className="md:hidden grid grid-cols-1 sm:grid-cols-2 gap-4">
          {groups.map(g => {
            const meta = groupMeta(g)
            const inGroup = entries.filter(e => e.group_name === g)
            const byCategory = Array.from(new Set(inGroup.map(e => e.category))).sort((a, b) => a.localeCompare(b, 'th'))
            return (
              <div key={g} className={`rounded-2xl p-4 border shadow-xl backdrop-blur-xl transition-all ${
                isLight ? 'bg-white/95 border-slate-200 hover:border-sky-300' : 'bg-slate-900/90 border-slate-800 hover:border-cyan-500/40'
              }`}>
                <div className={`flex items-center justify-between mb-3 pb-2 border-b ${isLight ? 'border-slate-100' : 'border-slate-800'}`}>
                  <p className={`font-extrabold flex items-center gap-2 text-sm ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                    <span className="text-base">{meta.emoji}</span> {g}
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full border shadow-sm" style={{ backgroundColor: meta.bg, color: meta.color, borderColor: meta.border }}>
                      {inGroup.length} รายการ
                    </span>
                    <button onClick={() => onAddNew(g)} aria-label={`เพิ่มข้อมูลในกลุ่ม ${g}`}
                      className={`w-7 h-7 rounded-xl border flex items-center justify-center transition-colors ${
                        isLight ? 'bg-sky-50 border-sky-200 text-sky-700 hover:bg-sky-100' : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20'
                      }`}>
                      <Plus size={14} />
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {byCategory.map(c => {
                    const key = `${g}::${c}`
                    const isOpen = openCategory === key
                    const inCategory = inGroup.filter(e => e.category === c)
                    return (
                      <div key={c}>
                        <button onClick={() => toggleCategory(key)}
                          className={`w-full flex items-center justify-between text-xs rounded-xl px-2.5 py-2 border transition-colors ${
                            isLight
                              ? 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
                              : 'bg-slate-800/50 hover:bg-slate-800 border-slate-700/50 text-slate-300'
                          }`}>
                          <span className="flex items-center gap-1.5 font-semibold">
                            <ChevronDown size={13} className={`transition-transform ${isOpen ? 'rotate-180' : ''} ${isLight ? 'text-sky-600' : 'text-cyan-400'}`} />
                            {c}
                          </span>
                          <span className={`font-mono font-bold px-2 py-0.5 rounded-md border text-[11px] ${
                            isLight ? 'bg-white text-sky-800 border-slate-200' : 'bg-slate-900 text-cyan-400 border-slate-700'
                          }`}>{inCategory.length}</span>
                        </button>
                        {isOpen && (() => {
                          const page = pageByCategory[key] ?? 1
                          const totalPages = Math.max(1, Math.ceil(inCategory.length / PAGE_SIZE))
                          const pageItems = inCategory.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
                          return (
                            <div className="pl-3 pr-1 pt-1.5 pb-1 space-y-1">
                              {pageItems.map(entry => {
                                const isActive = entry.status !== 'archived'
                                return (
                                  <div key={entry.id}
                                    className={`w-full flex items-center justify-between text-xs px-2.5 py-2 rounded-xl border transition-colors group ${
                                      isLight
                                        ? `bg-white border-slate-200 ${isActive ? 'text-slate-800' : 'text-slate-400'}`
                                        : `bg-slate-950/60 border-slate-800/80 ${isActive ? 'text-slate-200' : 'text-slate-500'}`
                                    }`}>
                                    <button type="button" onClick={() => onEditEntry(entry)}
                                      className="flex-1 min-w-0 flex items-center gap-1.5 text-left">
                                      <span className="truncate font-medium">{entry.name}</span>
                                      <Pencil size={11} className={`shrink-0 ${isLight ? 'text-slate-400 group-hover:text-sky-600' : 'text-slate-500 group-hover:text-cyan-400'}`} />
                                    </button>
                                    <button type="button" onClick={() => toggleStatus(entry)}
                                      className={`shrink-0 ml-2 flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border transition-all ${
                                        isActive
                                          ? (isLight ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400')
                                          : (isLight ? 'bg-slate-100 border-slate-200 text-slate-400' : 'bg-slate-800 border-slate-700 text-slate-500')
                                      }`}>
                                      {isActive ? <Eye size={10} /> : <EyeOff size={10} />}
                                      {isActive ? 'ใช้งาน' : 'ซ่อน'}
                                    </button>
                                  </div>
                                )
                              })}
                              {totalPages > 1 && (
                                <div className="flex items-center justify-center gap-3 pt-2">
                                  <button onClick={() => goToPage(key, page - 1)} disabled={page <= 1}
                                    className={`p-1 rounded-lg border disabled:opacity-30 ${isLight ? 'bg-white border-slate-200 text-slate-600' : 'bg-slate-800 border-slate-700 text-slate-300'}`}>
                                    <ChevronLeft size={13} />
                                  </button>
                                  <span className={`text-[11px] font-mono ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>หน้า {page}/{totalPages}</span>
                                  <button onClick={() => goToPage(key, page + 1)} disabled={page >= totalPages}
                                    className={`p-1 rounded-lg border disabled:opacity-30 ${isLight ? 'bg-white border-slate-200 text-slate-600' : 'bg-slate-800 border-slate-700 text-slate-300'}`}>
                                    <ChevronRight size={13} />
                                  </button>
                                </div>
                              )}
                            </div>
                          )
                        })()}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Desktop Cyber HUD Data Table */}
      {groups.length > 0 && (
        <div className={`hidden md:block rounded-2xl border shadow-2xl backdrop-blur-xl overflow-hidden ${
          isLight ? 'bg-white/95 border-slate-200 text-slate-800' : 'bg-slate-900/90 border-cyan-500/30 text-white'
        }`}>
          {/* Cyber Search & Filter Toolbar */}
          <div className={`flex flex-wrap items-center gap-3 p-4 border-b ${
            isLight ? 'bg-slate-50/90 border-slate-200' : 'bg-slate-950/60 border-cyan-500/20'
          }`}>
            <div className="relative flex-1 min-w-[240px] max-w-sm">
              <Search size={14} className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${isLight ? 'text-sky-600' : 'text-cyan-400'}`} />
              <input value={tableSearch}
                onChange={e => { setTableSearch(e.target.value); setTablePage(1) }}
                placeholder="ค้นหาชื่อสถานที่ หรือข้อมูลพิกัด..."
                className={`w-full pl-9 pr-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-1 transition-all ${
                  isLight
                    ? 'bg-white border-slate-300 text-slate-900 placeholder-slate-400 focus:border-sky-500 focus:ring-sky-400'
                    : 'bg-slate-900 border-cyan-500/30 text-white placeholder-slate-500 focus:border-cyan-400 focus:ring-cyan-400'
                }`} />
            </div>

            <div className="flex items-center gap-2">
              <Filter size={13} className={isLight ? 'text-sky-600' : 'text-cyan-400/70'} />
              <select value={tableFilterGroup}
                onChange={e => { setTableFilterGroup(e.target.value); setTableFilterCategory('all'); setTablePage(1) }}
                className={`text-xs px-3 py-2 rounded-xl border focus:outline-none ${
                  isLight ? 'bg-white border-slate-300 text-slate-800 focus:border-sky-500' : 'bg-slate-900 border-slate-700 text-slate-200 focus:border-cyan-400'
                }`}>
                <option value="all">ทุกกลุ่มหลัก</option>
                {groups.map(g => <option key={g} value={g}>{g}</option>)}
              </select>

              <select value={tableFilterCategory}
                onChange={e => { setTableFilterCategory(e.target.value); setTablePage(1) }}
                className={`text-xs px-3 py-2 rounded-xl border focus:outline-none ${
                  isLight ? 'bg-white border-slate-300 text-slate-800 focus:border-sky-500' : 'bg-slate-900 border-slate-700 text-slate-200 focus:border-cyan-400'
                }`}>
                <option value="all">ทุกประเภทย่อย</option>
                {tableCategoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>

              <select value={tableFilterStatus}
                onChange={e => { setTableFilterStatus(e.target.value); setTablePage(1) }}
                className={`text-xs px-3 py-2 rounded-xl border focus:outline-none ${
                  isLight ? 'bg-white border-slate-300 text-slate-800 focus:border-sky-500' : 'bg-slate-900 border-slate-700 text-slate-200 focus:border-cyan-400'
                }`}>
                <option value="all">ทุกสถานะ</option>
                <option value="active">ใช้งาน (Active)</option>
                <option value="archived">ไม่ใช้งาน (Archived)</option>
              </select>
            </div>

            <div className={`ml-auto text-xs font-mono px-3 py-1 rounded-xl border ${
              isLight ? 'bg-sky-50 border-sky-200 text-sky-900' : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400/80'
            }`}>
              FOUND: <span className={`font-bold ${isLight ? 'text-sky-700' : 'text-cyan-300'}`}>{tableSorted.length}</span> / {entries.length}
            </div>
          </div>

          {/* Table view */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className={`border-b text-left ${
                  isLight ? 'bg-slate-100/90 border-slate-200 text-slate-600' : 'bg-slate-950/80 border-cyan-500/20 text-slate-400'
                }`}>
                  <th className="w-14 px-3.5 py-3 font-extrabold text-center uppercase tracking-wider text-[11px]">#</th>
                  <SortHeader label="ชื่อสถานที่ / รายการ" sortKey="name" activeKey={tableSortKey} dir={tableSortDir} onSort={sortByColumn} />
                  <SortHeader label="กลุ่มหลัก" sortKey="group_name" activeKey={tableSortKey} dir={tableSortDir} onSort={sortByColumn} />
                  <SortHeader label="ประเภทย่อย" sortKey="category" activeKey={tableSortKey} dir={tableSortDir} onSort={sortByColumn} />
                  <th className="px-3.5 py-3 font-extrabold uppercase tracking-wider text-[11px]">พิกัด GIS</th>
                  <SortHeader label="สถานะ" sortKey="status" activeKey={tableSortKey} dir={tableSortDir} onSort={sortByColumn} className="text-center" />
                  <th className="w-28 px-3.5 py-3 font-extrabold uppercase tracking-wider text-[11px] text-center">จัดการ</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isLight ? 'divide-slate-200/70' : 'divide-slate-800/60'}`}>
                {tablePageItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className={`text-center py-16 ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
                      <AlertCircle size={28} className={`mx-auto mb-2 opacity-40 ${isLight ? 'text-sky-500' : 'text-cyan-400'}`} />
                      <p className="font-mono text-xs">NO DATA MATCHES CURRENT FILTER QUERY</p>
                    </td>
                  </tr>
                ) : tablePageItems.map((entry, i) => {
                  const isActive = entry.status !== 'archived'
                  const meta = groupMeta(entry.group_name)
                  return (
                    <tr key={entry.id} className={`transition-colors group ${
                      isLight ? 'hover:bg-sky-50/60' : 'hover:bg-cyan-500/5'
                    }`}>
                      <td className={`px-3.5 py-3 text-center font-mono font-bold ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
                        {(tableCurrentPage - 1) * tablePageSize + i + 1}
                      </td>
                      <td className={`px-3.5 py-3 font-semibold transition-colors ${
                        isLight ? 'text-slate-900 group-hover:text-sky-700' : 'text-slate-100 group-hover:text-cyan-300'
                      }`}>
                        <div className="flex items-center gap-2">
                          <span>{meta.emoji}</span>
                          <span>{entry.name || <span className={`italic ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>(ไม่มีชื่อ)</span>}</span>
                        </div>
                      </td>
                      <td className="px-3.5 py-3 font-medium">
                        <span className="inline-block px-2.5 py-0.5 rounded-lg border text-[11px] font-semibold"
                          style={{ backgroundColor: meta.bg, color: meta.color, borderColor: meta.border }}>
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
                          {isActive ? 'ใช้งาน (Active)' : 'ไม่ใช้งาน'}
                        </span>
                      </td>
                      <td className="px-3.5 py-3">
                        <div className="flex items-center justify-center gap-1.5">
                          <button type="button" onClick={() => onEditEntry(entry)} aria-label="แก้ไข"
                            className={`p-1.5 rounded-xl border transition-colors ${
                              isLight
                                ? 'bg-white border-slate-200 text-slate-600 hover:text-sky-700 hover:border-sky-300'
                                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-cyan-300 hover:border-cyan-500/40'
                            }`}>
                            <Pencil size={13} />
                          </button>
                          <button type="button" onClick={() => toggleStatus(entry)}
                            aria-label={isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
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

          {/* Cyber Pagination Footer */}
          <div className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t text-xs ${
            isLight ? 'bg-slate-50 border-slate-200 text-slate-600' : 'bg-slate-950/80 border-cyan-500/20 text-slate-300'
          }`}>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] opacity-70">ROWS PER PAGE:</span>
              <select value={tablePageSize}
                onChange={e => { setTablePageSize(Number(e.target.value)); setTablePage(1) }}
                className={`text-xs px-2 py-1 rounded-lg border font-mono focus:outline-none ${
                  isLight ? 'bg-white border-slate-300 text-sky-800 focus:border-sky-500' : 'bg-slate-900 border-slate-700 text-cyan-300 focus:border-cyan-400'
                }`}>
                {TABLE_PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>

            <div className="flex items-center gap-3">
              <span className="font-mono text-xs">
                PAGE <span className={`font-bold ${isLight ? 'text-sky-700' : 'text-cyan-400'}`}>{tableCurrentPage}</span> / {tableTotalPages}
              </span>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setTablePage(p => Math.max(1, p - 1))} disabled={tableCurrentPage <= 1}
                  className={`p-1.5 rounded-xl border disabled:opacity-30 transition-colors ${
                    isLight
                      ? 'bg-white border-slate-300 text-slate-700 hover:border-sky-400 hover:text-sky-700'
                      : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-cyan-500/40 hover:text-cyan-300'
                  }`}>
                  <ChevronLeft size={15} />
                </button>
                <button onClick={() => setTablePage(p => Math.min(tableTotalPages, p + 1))} disabled={tableCurrentPage >= tableTotalPages}
                  className={`p-1.5 rounded-xl border disabled:opacity-30 transition-colors ${
                    isLight
                      ? 'bg-white border-slate-300 text-slate-700 hover:border-sky-400 hover:text-sky-700'
                      : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-cyan-500/40 hover:text-cyan-300'
                  }`}>
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


