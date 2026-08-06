import { useState, useEffect } from 'react'
import {
  Database, Layers, Radio, Globe, Sparkles, Upload, Plus,
  PieChart, BarChart3, TrendingUp, CheckCircle2, MapPin, Route, ShieldCheck, Activity
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import DataCenterImportModal from './DataCenterImportModal'

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

export default function DataCenterOverview({ tenant, profile, onAddNew, onImportSuccess, theme = 'dark' }) {
  const isLight = theme === 'light'
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [showImportModal, setShowImportModal] = useState(false)

  const fetchEntries = () => {
    if (!tenant?.id) return
    setLoading(true)
    supabase.from('data_center_entries')
      .select('id, name, group_name, category, status, latitude, longitude, route_points')
      .eq('municipality_id', tenant.id)
      .then(({ data }) => { setEntries(data ?? []); setLoading(false) })
  }

  useEffect(() => {
    fetchEntries()
  }, [tenant?.id])

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-24 gap-3">
      <div className="relative w-12 h-12 flex items-center justify-center">
        <div className={`absolute inset-0 rounded-full border-4 ${isLight ? 'border-sky-200 border-t-sky-600' : 'border-cyan-500/20 border-t-cyan-400'} animate-spin`} />
        <Database size={20} className={isLight ? 'text-sky-600 animate-pulse' : 'text-cyan-400 animate-pulse'} />
      </div>
      <p className={`text-xs font-mono animate-pulse ${isLight ? 'text-sky-700 font-bold' : 'text-cyan-300/80'}`}>LOADING DIGITAL CORE ANALYTICS...</p>
    </div>
  )

  const totalEntries = entries.length
  const activeEntriesCount = entries.filter(e => e.status !== 'archived').length
  const activeRate = totalEntries ? Math.round((activeEntriesCount / totalEntries) * 100) : 100

  // GIS Types
  const polylineEntries = entries.filter(e => e.route_points && e.route_points.length > 0)
  const pointEntries = entries.filter(e => (e.latitude != null || e.longitude != null) && (!e.route_points || e.route_points.length === 0))

  // Group stats calculation (Fully Dynamic for any future groups)
  const groupMap = {}
  entries.forEach(e => {
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

  // Category breakdown ranking (Fully Dynamic for any future categories)
  const catMap = {}
  entries.forEach(e => {
    const c = e.category || 'ไม่ระบุประเภท'
    if (!catMap[c]) catMap[c] = { group: e.group_name, count: 0 }
    catMap[c].count += 1
  })
  const categoryRankingList = Object.keys(catMap).map(c => ({
    name: c,
    group: catMap[c].group,
    count: catMap[c].count,
    percent: totalEntries ? Math.round((catMap[c].count / totalEntries) * 100) : 0,
    meta: getGroupMeta(catMap[c].group)
  })).sort((a, b) => b.count - a.count)

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
              ภาพรวมระบบสารสนเทศดิจิทัล (Executive Dashboard)
            </h1>
            <p className={`text-xs ${isLight ? 'text-slate-500' : 'text-cyan-200/70'}`}>
              วิเคราะห์สถิติมิติข้อมูลและโครงสร้างพื้นฐานดิจิทัล — {tenant?.name}
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Stat 1: Total Data Points */}
        <div className={`p-4 rounded-2xl border backdrop-blur-xl shadow-lg relative overflow-hidden group transition-all ${
          isLight
            ? 'bg-white/95 border-slate-200 hover:border-sky-400'
            : 'bg-gradient-to-br from-slate-900/90 to-cyan-950/40 border-cyan-500/30 hover:border-cyan-400/60'
        }`}>
          <div className={`absolute top-0 right-0 w-24 h-24 rounded-full blur-2xl pointer-events-none transition-all ${isLight ? 'bg-sky-500/10' : 'bg-cyan-500/10'}`} />
          <div className="flex items-center justify-between">
            <span className={`text-[10px] font-black uppercase tracking-widest ${isLight ? 'text-sky-800' : 'text-cyan-400/70'}`}>TOTAL DATAPOINTS</span>
            <div className={`p-2 rounded-xl border ${isLight ? 'bg-sky-100 text-sky-700 border-sky-200' : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'}`}>
              <Database size={16} />
            </div>
          </div>
          <p className={`text-2xl font-black mt-2 font-mono tracking-tight ${isLight ? 'text-slate-900' : 'text-white cyber-text-glow'}`}>{totalEntries}</p>
          <p className={`text-[11px] mt-1 flex items-center gap-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            <Sparkles size={11} className={isLight ? 'text-sky-600' : 'text-cyan-400'} /> ข้อมูลสถานที่และโครงสร้าง
          </p>
        </div>

        {/* Stat 2: Active Groups */}
        <div className={`p-4 rounded-2xl border backdrop-blur-xl shadow-lg relative overflow-hidden group transition-all ${
          isLight
            ? 'bg-white/95 border-slate-200 hover:border-blue-400'
            : 'bg-gradient-to-br from-slate-900/90 to-blue-950/40 border-blue-500/30 hover:border-blue-400/60'
        }`}>
          <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className={`text-[10px] font-black uppercase tracking-widest ${isLight ? 'text-blue-800' : 'text-blue-400/70'}`}>CATEGORIES</span>
            <div className={`p-2 rounded-xl border ${isLight ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-blue-500/20 text-blue-300 border-blue-500/40'}`}>
              <Layers size={16} />
            </div>
          </div>
          <p className={`text-2xl font-black mt-2 font-mono tracking-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>{groupStatsList.length}</p>
          <p className={`text-[11px] mt-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            หมวดหมู่หลักในเขตเทศบาล
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
          <p className={`text-2xl font-black mt-2 font-mono tracking-tight ${isLight ? 'text-emerald-600' : 'text-emerald-400'}`}>{activeRate}%</p>
          <p className={`text-[11px] mt-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            พร้อมใช้งาน ({activeEntriesCount} รายการ)
          </p>
        </div>

        {/* Stat 4: GIS Polyline & Point Coverage */}
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
          <p className={`text-2xl font-black mt-2 font-mono tracking-tight ${isLight ? 'text-purple-700' : 'text-purple-300'}`}>{pointEntries.length + polylineEntries.length}</p>
          <p className={`text-[11px] mt-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            หมุดพิกัด {pointEntries.length} | เส้นทาง {polylineEntries.length}
          </p>
        </div>
      </div>

      {totalEntries === 0 ? (
        <div className={`flex flex-col items-center justify-center py-20 rounded-2xl border backdrop-blur-xl ${
          isLight ? 'bg-white/90 border-slate-200 text-slate-600' : 'bg-slate-900/70 border-cyan-500/20 text-slate-400'
        }`}>
          <Database size={48} className={isLight ? 'mb-3 text-sky-400/40 animate-pulse' : 'mb-3 text-cyan-400/30 animate-pulse'} />
          <p className={`text-base font-bold ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>ยังไม่มีข้อมูลในศูนย์รวมดิจิทัล</p>
          <p className="text-xs mt-1 opacity-80">กดปุ่ม "บันทึกข้อมูลใหม่" หรือ "นำเข้า KML/GIS" เพื่อเริ่มระบบสถิติเชิงวิเคราะห์</p>
        </div>
      ) : (
        /* Main Analytical Charts Grid */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Chart Card 1: สัดส่วนข้อมูลตามกลุ่มหลัก (Main Group Breakdown Chart) */}
          <div className={`lg:col-span-2 rounded-2xl border p-5 backdrop-blur-xl shadow-xl space-y-4 ${
            isLight ? 'bg-white/95 border-slate-200 text-slate-800' : 'bg-slate-900/90 border-cyan-500/30 text-white'
          }`}>
            <div className="flex items-center justify-between border-b pb-3 border-slate-200/50 dark:border-cyan-500/20">
              <div className="flex items-center gap-2">
                <PieChart size={18} className={isLight ? 'text-sky-600' : 'text-cyan-400'} />
                <h2 className="text-sm font-extrabold tracking-wide">สัดส่วนจำแนกตามกลุ่มหลัก (Main Group Distribution)</h2>
              </div>
              <span className={`text-[10px] font-mono px-2.5 py-0.5 rounded-full border font-bold ${
                isLight ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'
              }`}>
                {groupStatsList.length} กลุ่มข้อมูล
              </span>
            </div>

            <div className="space-y-4 pt-1">
              {groupStatsList.map(g => (
                <div key={g.name} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="flex items-center gap-2">
                      <span className="text-base">{g.meta.emoji}</span>
                      <span className={isLight ? 'text-slate-800 font-bold' : 'text-slate-100 font-bold'}>{g.name}</span>
                      <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded border ${isLight ? 'bg-slate-100 text-slate-600 border-slate-200' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                        {g.catCount} ประเภทย่อย
                      </span>
                    </span>
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-xs font-bold ${isLight ? 'text-sky-700' : 'text-cyan-300'}`}>{g.count} รายการ</span>
                      <span className="font-mono text-[11px] opacity-70">({g.percent}%)</span>
                    </div>
                  </div>

                  {/* Progress Visual Bar */}
                  <div className={`w-full h-3 rounded-full overflow-hidden p-0.5 border ${
                    isLight ? 'bg-slate-100 border-slate-200' : 'bg-slate-950 border-slate-800'
                  }`}>
                    <div
                      className="h-full rounded-full transition-all duration-500 shadow-sm"
                      style={{
                        width: `${Math.max(g.percent, 3)}%`,
                        backgroundColor: g.meta.bg,
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[10px] opacity-75 font-mono pt-0.5">
                    <span>พร้อมใช้งาน: {g.active} / {g.count}</span>
                    <span>พิกัดหมุด: {g.points} | เส้นทาง GIS: {g.routes}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Chart Card 2: ประเภทข้อมูล GIS & ความพร้อมใช้งาน (GIS & Asset Health Gauges) */}
          <div className={`rounded-2xl border p-5 backdrop-blur-xl shadow-xl flex flex-col justify-between space-y-4 ${
            isLight ? 'bg-white/95 border-slate-200 text-slate-800' : 'bg-slate-900/90 border-cyan-500/30 text-white'
          }`}>
            <div className="flex items-center justify-between border-b pb-3 border-slate-200/50 dark:border-cyan-500/20">
              <div className="flex items-center gap-2">
                <Activity size={18} className={isLight ? 'text-sky-600' : 'text-cyan-400'} />
                <h2 className="text-sm font-extrabold tracking-wide">ประเภท GIS & ความพร้อม</h2>
              </div>
              <ShieldCheck size={16} className="text-emerald-500 animate-pulse" />
            </div>

            {/* Visual Donut / Metric Cards */}
            <div className="space-y-3.5 flex-1 flex flex-col justify-center">
              {/* GIS Polyline Routes metric */}
              <div className={`p-3.5 rounded-xl border flex items-center justify-between ${
                isLight ? 'bg-sky-50/70 border-sky-200' : 'bg-cyan-500/10 border-cyan-500/30'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-lg border ${isLight ? 'bg-white text-sky-700 border-sky-200' : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'}`}>
                    <Route size={18} />
                  </div>
                  <div>
                    <p className="text-xs font-bold">เส้นทาง GIS (Polylines)</p>
                    <p className="text-[10px] opacity-70 font-mono">โครงข่ายถนน และสายทางหลัก</p>
                  </div>
                </div>
                <div className="text-right font-mono">
                  <p className={`text-lg font-black ${isLight ? 'text-sky-800' : 'text-cyan-300'}`}>{polylineEntries.length}</p>
                  <p className="text-[10px] opacity-70">{totalEntries ? Math.round((polylineEntries.length / totalEntries) * 100) : 0}% ของคลัง</p>
                </div>
              </div>

              {/* GIS Point Markers metric */}
              <div className={`p-3.5 rounded-xl border flex items-center justify-between ${
                isLight ? 'bg-purple-50/70 border-purple-200' : 'bg-purple-500/10 border-purple-500/30'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-lg border ${isLight ? 'bg-white text-purple-700 border-purple-200' : 'bg-purple-500/20 text-purple-300 border-purple-500/40'}`}>
                    <MapPin size={18} />
                  </div>
                  <div>
                    <p className="text-xs font-bold">พิกัดหมุด (Point Markers)</p>
                    <p className="text-[10px] opacity-70 font-mono">สถานที่และอาคารบริการ</p>
                  </div>
                </div>
                <div className="text-right font-mono">
                  <p className={`text-lg font-black ${isLight ? 'text-purple-800' : 'text-purple-300'}`}>{pointEntries.length}</p>
                  <p className="text-[10px] opacity-70">{totalEntries ? Math.round((pointEntries.length / totalEntries) * 100) : 0}% ของคลัง</p>
                </div>
              </div>

              {/* Active Status gauge */}
              <div className={`p-3.5 rounded-xl border flex items-center justify-between ${
                isLight ? 'bg-emerald-50/70 border-emerald-200' : 'bg-emerald-500/10 border-emerald-500/30'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-lg border ${isLight ? 'bg-white text-emerald-700 border-emerald-200' : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'}`}>
                    <CheckCircle2 size={18} />
                  </div>
                  <div>
                    <p className="text-xs font-bold">สถานะพร้อมใช้งาน (Active)</p>
                    <p className="text-[10px] opacity-70 font-mono">แสดงผลบนระบบประชาชนแล้ว</p>
                  </div>
                </div>
                <div className="text-right font-mono">
                  <p className={`text-lg font-black ${isLight ? 'text-emerald-800' : 'text-emerald-400'}`}>{activeEntriesCount}</p>
                  <p className="text-[10px] opacity-70">{activeRate}% สมบูรณ์</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chart Card 3: จำแนกประเภทย่อย Top Categories Ranking */}
      {totalEntries > 0 && (
        <div className={`rounded-2xl border p-5 backdrop-blur-xl shadow-xl space-y-4 ${
          isLight ? 'bg-white/95 border-slate-200 text-slate-800' : 'bg-slate-900/90 border-cyan-500/30 text-white'
        }`}>
          <div className="flex items-center justify-between border-b pb-3 border-slate-200/50 dark:border-cyan-500/20">
            <div className="flex items-center gap-2">
              <TrendingUp size={18} className={isLight ? 'text-sky-600' : 'text-cyan-400'} />
              <h2 className="text-sm font-extrabold tracking-wide">จำแนกตามประเภทย่อย (Category Ranking Analytics)</h2>
            </div>
            <span className={`text-[10px] font-mono px-2.5 py-0.5 rounded-full border font-bold ${
              isLight ? 'bg-slate-100 text-slate-700' : 'bg-slate-800 text-slate-300 border-slate-700'
            }`}>
              รวม {categoryRankingList.length} ประเภท
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5 pt-1">
            {categoryRankingList.map((c, i) => (
              <div key={c.name} className={`p-3.5 rounded-xl border transition-all hover:scale-[1.02] ${
                isLight ? 'bg-slate-50/80 border-slate-200' : 'bg-slate-950/60 border-slate-800'
              }`}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-md font-bold text-slate-950" style={{ backgroundColor: c.meta.bg }}>
                    #{i + 1}
                  </span>
                  <span className={`text-xs font-mono font-bold ${isLight ? 'text-sky-700' : 'text-cyan-400'}`}>
                    {c.count} รายการ ({c.percent}%)
                  </span>
                </div>
                <p className="text-xs font-bold truncate">{c.name}</p>
                <p className="text-[10px] opacity-70 mt-0.5 truncate">{c.meta.emoji} {c.group}</p>
                
                {/* Category percentage bar */}
                <div className={`w-full h-1.5 rounded-full mt-2 overflow-hidden ${isLight ? 'bg-slate-200' : 'bg-slate-800'}`}>
                  <div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.max(c.percent, 5)}%`, backgroundColor: c.meta.bg }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
