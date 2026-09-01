import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Plus, X, Loader2, Search, Pencil, Trash2, Bug, Wrench, BookOpen, Map,
  LayoutGrid, LogOut, Folder, Activity, Database, Cpu, ShieldCheck, Sparkles,
  Clock3, CheckCircle2, CircleDot, Layers3, Command, ChevronRight,
} from 'lucide-react'
import { supabase, signOutSafely } from '../lib/supabase'
import { thaiDate } from '../lib/thaiDate'
import { useTenant } from '../contexts/TenantContext'
import SuperAdminPanel from '../components/admin/SuperAdminPanel'
import PortalSwitcher from '../components/layout/PortalSwitcher'
import UserProfileBadge from '../components/layout/UserProfileBadge'
import { DEV_USER_ID } from '../lib/portalAccess'

// สีธีมของหน้านี้ตั้งใจใช้ slate เข้ม (ไม่ใช่ var(--color-primary) ของ tenant) เพราะ
// dev_journal เป็นข้อมูลข้ามทุกเทศบาล ไม่ผูกกับธีมของเทศบาลใดเทศบาลหนึ่ง
const CATEGORIES = [
  { value: 'bug',   label: 'ปัญหา',     Icon: Bug,      color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  { value: 'fix',   label: 'แก้ไข',     Icon: Wrench,   color: '#059669', bg: '#f0fdf4', border: '#bbf7d0' },
  { value: 'story', label: 'เรื่องราว', Icon: BookOpen, color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
  { value: 'plan',  label: 'แผนงาน',   Icon: Map,      color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
]
const catMeta = v => CATEGORIES.find(c => c.value === v) ?? CATEGORIES[0]

const STATUS_LABEL = { open: 'ยังไม่จบ', done: 'เสร็จแล้ว', wontfix: 'ไม่ทำ' }

// ส่วนของระบบที่ตั้งไว้ล่วงหน้า — โผล่เป็นเมนูหลักเสมอแม้ยังไม่มีบันทึกในหมวดนั้น
// (ต่างจากโหมดปกติที่เมนูจะงอกเองจากข้อมูลที่กรอกจริงเท่านั้น) เรียงตามลำดับในอาเรย์นี้เป๊ะ
// (ไม่ sort ตามตัวอักษร) เพิ่ม/ลบ/สลับลำดับชื่อในนี้ได้ตามต้องการ
const SEED_MODULES = ['โครงสร้าง', 'ข้อมูลระบบ']

const EMPTY_FORM = { module: '', topic: '', category: 'bug', title: '', body: '', status: 'open', municipality_id: '' }
const inputCls = 'w-full border border-slate-200 rounded-xl px-3.5 py-3 text-sm text-slate-900 bg-slate-50 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-300 transition-all'

const BUILTIN_DEV_ENTRIES = [
  {
    id: 'centralized-google-maps-picker-spec',
    module: 'ข้อมูลระบบ',
    topic: 'ระบบแผนที่ & พิกัดตำแหน่ง (Google Maps JS API)',
    category: 'story',
    title: 'มาตรฐานการตั้งค่าระบบปักหมุดตำแหน่งกลาง (Centralized Google Maps Picker)',
    status: 'done',
    created_at: '2026-08-01T14:40:00.000Z',
    body: `### 📍 มาตรฐานการตั้งค่าระบบปักหมุดตำแหน่งกลาง (Centralized Google Maps Picker)

---

#### 1. 🏛️ สถาปัตยกรรมแบบรวมศูนย์ (Single Source of Truth)
- **ศูนย์กลางของระบบ**: รวมศูนย์การตั้งค่าระบบปักหมุดตำแหน่งทั้งหมดไว้ที่ \`GoogleMapPicker.jsx\` (\`src/components/common/GoogleMapPicker.jsx\`)
- **การใช้ซ้ำทั่วทั้งแอปพลิเคชัน**: หน้าแจ้งเรื่องร้องเรียนของประชาชน (\`CitizenForm.jsx\`), หน้าเพิ่ม/แก้ไขข้อมูล Data Center ของเจ้าหน้าที่ (\`DataCenterEntryForm.jsx\`), และฟอร์มปักหมุดตำแหน่งทั้งหมดในระบบ จะดึงคอนฟิกกลางไปใช้งานอัตโนมัติ ไม่ต้องแยกแก้หลายจุด

---

#### 2. ⚙️ มาตรฐานพฤติกรรมแผนที่ (Standard Map Picker Specs)
- **หมุดตรึงกลางหน้าจอ (\`fixedCenterPin = true\`)**: หมุดสีแดงตรึงอยู่ตรงกลางหน้าจอเป๊ะๆ ให้ผู้ใช้เลื่อน/ลากแผนที่เพื่อเลือกตำแหน่งได้อย่างแม่นยำและเป็นธรรมชาติ
- **ซ่อนเส้นขอบเขตปกครอง (\`showBoundary = false\`)**: ซ่อนเส้นประสีแดงขอบเขตตำบลบนแผนที่ปักหมุด เพื่อให้หน้าจอแผนที่ภาพถ่ายดาวเทียมสะอาด เคลียร์ 100%
- **แถบสลับประเภทแผนที่ 1 คลิก**: แถบปุ่ม \`[ 🗺️ แผนที่ | 🛰️ ดาวเทียม ]\` บริเวณมุมขวาบน ใช้งานง่าย เข้าถึงได้เร็ว
- **ระบบซูมธรรมชาติ (\`+\` / \`-\`)**: ปรับปรุงการทำงานของระดับการซูม (Zoom Level) และลูกกลิ้งเมาส์/สัมผัส ไม่ให้เด้งกลับที่เดิม
- **ซ่อน Street View**: ปิดการแสดงผลการ์ตูน Pegman (Street View) เพื่อไม่ให้บดบังพื้นที่ปักหมุด

---

#### 3. 🛡️ ความมั่นคงปลอดภัยและการจัดการ API Key
- **Environment Key Isolation**: ดึง \`VITE_GOOGLE_MAPS_API_KEY\` จากไฟล์ \`.env.local\` หรือคอนฟิกของเทศบาล (\`tenant.google_maps_api_key\`)
- **Fallback Engine**: หากยังไม่ใส่ API Key หรือ Key มีปัญหา ระบบจะสลับไปใช้ OpenStreetMap / Esri World Imagery (Leaflet Fallback) อัตโนมัติ ป้องกันหน้าจอสีดำหรือแอปพลิเคชันล่ม`,
  },
  {
    id: 'kml-gis-import-spec',
    module: 'โครงสร้าง',
    topic: 'ศูนย์รวมข้อมูลดิจิทัล (Data Center GIS)',
    category: 'story',
    title: 'คู่มือและสถาปัตยกรรมการนำเข้าไฟล์ KML / GIS / Google Earth (GIS & KML Batch Import Spec)',
    status: 'done',
    created_at: '2026-08-02T21:20:00.000Z',
    body: `### 🗺️ คู่มือและสถาปัตยกรรมการนำเข้าไฟล์ KML / GIS / Google Earth (GIS & KML Batch Import Spec)

---

#### 1. 🏛️ วัตถุประสงค์และสถาปัตยกรรมระบบ (Architecture Overview)
- **โมดูลรองรับ**: ศูนย์รวมข้อมูลดิจิทัล (Digital Data Center - \`/data-center\`)
- **ไฟล์ส่วนประกอบหลัก**:
  - \`src/components/datacenter/DataCenterImportModal.jsx\` (Modal อ่านและแปลงไฟล์พิกัด GIS)
  - \`src/components/datacenter/DataCenterOverview.jsx\` (ปุ่มเรียกใช้นำเข้าไฟล์)
  - \`src/pages/DataCenterDashboard.jsx\` (Dashboard ผู้ดูแลระบบ)
- **รูปแบบไฟล์ที่รองรับ**:
  - **Google Earth (\`.kml\` และ \`.kmz\`)**: ถอดรหัส XML & ZIP อัตโนมัติด้วย \`JSZip\`
  - **GeoJSON (\`.geojson\` และ \`.json\`)**: รองรับ FeatureCollection แบบ Point, LineString และ Polygon
  - **CSV (\`.csv\`)**: อ่านไฟล์ตารางพิกัด ละติจูด/ลองจิจูด

---

#### 2. ⚙️ ขอบเขตการถอดรหัสพิกัด (Parsing Pipeline Specs)
- **KML/KMZ Parsing**:
  - อ่าน XML ด้วย \`DOMParser\` ในเว็บเบราว์เซอร์
  - ดึงข้อมูลพิกัดสถานที่ \`<Placemark>\`: \`<name>\`, \`<description>\` (ตัด HTML tag สะอาด), \`<Point><coordinates>\` (จุด), \`<LineString><coordinates>\` และ \`<Polygon><coordinates>\` (เส้นทาง)
  - อ่านลำดับขั้นโฟลเดอร์ \`<Folder><name>\` เพื่อจัดกลุ่มหลัก (Group Hint) ให้อัตโนมัติ
- **GeoJSON Parsing**:
  - อ่าน \`FeatureCollection\` ถอดพิกัด \`Point\` (\`[lng, lat]\`) และ \`LineString\` (\`[[lng, lat], ...]\`)
- **CSV Parsing**:
  - ตรวจจับคอลัมน์ \`lat\`/\`ละติจูด\` และ \`lng\`/\`ลองจิจูด\` โดยอัตโนมัติ

---

#### 3. 📋 คู่มือขั้นตอนการใช้งานสำหรับผู้ใช้และเจ้าหน้าที่ (Step-by-Step User Guide)
1. **เตรียมไฟล์พิกัด**:
   - **จาก Google Earth**: คลิกขวาโฟลเดอร์/สถานที่ -> *Save Place As...* เซฟเป็นไฟล์ \`.kml\` หรือ \`.kmz\`
   - **จาก QGIS/ArcGIS**: Export เป็นไฟล์ \`.geojson\` หรือ \`.kml\`
   - **จาก Excel**: เซฟเป็นไฟล์ \`.csv\` โดยมีหัวตารางระบุ \`name\`, \`lat\`, \`lng\`
2. **กดนำเข้าในระบบ**:
   - เข้าสู่ระบบบัญชี Admin/Staff -> ไปที่ **ศูนย์ข้อมูลดิจิทัล** (\`/data-center\`)
   - คลิกปุ่มสีฟ้า **\`นำเข้าไฟล์ KML / GIS\`** บริเวณมุมขวาบน
   - เลือกไฟล์พิกัดจากคอมพิวเตอร์
3. **ตรวจสอบพรีวิวและกำหนดหมวดหมู่**:
   - เลือก **กลุ่มหลัก** (เช่น โครงสร้างพื้นฐาน, สาธารณสุข) และ **ประเภทย่อย** (เช่น เสาไฟส่องสว่าง, จุดทิ้งขยะ)
   - ติ๊กเลือกรายการสถานที่ที่ต้องการนำเข้า -> กดปุ่ม **\`นำเข้า X รายการที่เลือก\`**
4. **ตรวจสอบการแสดงผลบนแผนที่**:
   - สลับไปที่แท็บ **"แผนที่" (Map)** ข้อมูลหมุดปักและเส้นทางจะปรากฏบน Google Maps ทันที!`,
  },
]

export default function DevJournal() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const [authChecked, setAuthChecked] = useState(false)
  const [authorized, setAuthorized] = useState(false)

  const [entries, setEntries] = useState([])
  const [municipalities, setMunicipalities] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeModule, setActiveModule] = useState('all')
  const [activeTopic, setActiveTopic] = useState('all')
  const [activeEntryId, setActiveEntryId] = useState(null)
  const [search, setSearch] = useState('')

  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [showModuleManager, setShowModuleManager] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id
      if (uid !== DEV_USER_ID) {
        navigate('/admin/login', { replace: true })
        return
      }
      setAuthorized(true)
      setAuthChecked(true)
    })
  }, [navigate])

  useEffect(() => {
    if (!authorized) return
    reload()
    supabase.from('municipalities').select('id, name').order('name')
      .then(({ data }) => setMunicipalities(data ?? []))
  }, [authorized])

  function reload() {
    setLoading(true)
    supabase.from('dev_journal').select('*').order('created_at', { ascending: false })
      .then(({ data }) => {
        const fetched = data ?? []
        const merged = [...fetched]
        BUILTIN_DEV_ENTRIES.forEach(b => {
          if (!merged.some(e => e.title === b.title || e.id === b.id)) {
            merged.push(b)
          }
        })
        setEntries(merged)
      })
      .catch((err) => console.error('[dev-journal] โหลดบันทึกไม่สำเร็จ:', err?.message ?? err))
      .finally(() => setLoading(false))
  }

  function openCreate() {
    setForm({
      ...EMPTY_FORM,
      module: activeModule !== 'all' ? activeModule : '',
      topic:  activeTopic !== 'all' ? activeTopic : '',
    })
    setEditing({})
  }
  function openEdit(entry) {
    setForm({
      module: entry.module ?? '', topic: entry.topic ?? '', category: entry.category, title: entry.title, body: entry.body,
      status: entry.status, municipality_id: entry.municipality_id ?? '',
    })
    setEditing(entry)
  }

  async function handleSave() {
    if (!form.title.trim() || !form.body.trim()) return
    setSaving(true)
    const payload = {
      module:           form.module.trim() || null,
      topic:            form.topic.trim() || null,
      category:        form.category,
      title:            form.title.trim(),
      body:             form.body.trim(),
      status:           form.status,
      municipality_id:  form.municipality_id || null,
      updated_at:       new Date().toISOString(),
    }
    const { error } = editing?.id
      ? await supabase.from('dev_journal').update(payload).eq('id', editing.id)
      : await supabase.from('dev_journal').insert(payload)
    setSaving(false)
    if (error) { alert('บันทึกไม่สำเร็จ: ' + error.message); return }
    setEditing(null)
    reload()
  }

  async function handleDelete(id) {
    if (!window.confirm('ลบบันทึกนี้ออกจากระบบ?\n\nการลบไม่สามารถย้อนกลับได้')) return
    const { error } = await supabase.from('dev_journal').delete().eq('id', id)
    if (error) { alert('ลบไม่สำเร็จ: ' + error.message); return }
    setEntries(prev => prev.filter(e => e.id !== id))
  }

  if (!authChecked) return null
  if (!authorized) return null

  // SEED_MODULES เรียงตามลำดับที่กำหนดไว้ตายตัว (ไม่ sort) ส่วน module ที่งอกเองจาก
  // ข้อมูลจริงจะถูก sort ตามตัวอักษรแล้วต่อท้ายมาอีกที
  const dynamicModules = Array.from(new Set(entries.map(e => e.module).filter(Boolean).filter(m => !SEED_MODULES.includes(m))))
    .sort((a, b) => a.localeCompare(b, 'th'))
  const modules = [...SEED_MODULES, ...dynamicModules]

  // หัวข้อ (เมนูรอง) คำนวณจากรายการที่กรองด้วยเมนูหลัก (ส่วนของระบบ) แล้วเท่านั้น —
  // เลือก module อื่น หัวข้อที่โชว์จะเปลี่ยนตามไปด้วยเสมอ
  const entriesInModule = entries.filter(e => activeModule === 'all' || e.module === activeModule)
  const topics = Array.from(new Set(entriesInModule.map(e => e.topic).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'th'))

  const filtered = entriesInModule
    .filter(e => activeTopic === 'all' || e.topic === activeTopic)
    .filter(e => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return e.title.toLowerCase().includes(q) || e.body.toLowerCase().includes(q)
    })

  function selectModule(m) {
    setShowModuleManager(false)
    setActiveModule(m)
    setActiveTopic('all') // เปลี่ยนเมนูหลักแล้วต้องล้างหัวข้อเดิม กันหัวข้อของ module อื่นค้าง
    setActiveEntryId(null)
  }
  function selectTopic(m, t) {
    setShowModuleManager(false)
    setActiveModule(m)
    setActiveTopic(t)
    setActiveEntryId(null)
  }
  // เข้าเมนูหลักแล้วยังไม่ได้เลือกหัวข้อ -> โชว์แค่รายการหัวข้อ (สารบัญ) ไม่โชว์เนื้อหาเต็ม
  // พิมพ์ค้นหาจะข้ามหน้าสารบัญไปโชว์ผลลัพธ์ที่ตรงเลย
  const showTopicIndex = activeTopic === 'all' && topics.length > 0 && !search.trim()
  // หัวข้อของแต่ละส่วนของระบบ — ใช้ทำสารบัญในไซด์บาร์ (แสดงทุกหัวข้อของทุก module พร้อมกัน)
  function topicsByModule(m) {
    return Array.from(new Set(entries.filter(e => e.module === m).map(e => e.topic).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, 'th'))
  }

  // เมนูหลัก (ส่วนของระบบ) — ใช้ร่วมกันทั้ง sidebar (PC) และ bottom tab bar (มือถือ)
  const MODULE_ITEMS = [
    { key: 'all', label: 'ทั้งหมด', Icon: LayoutGrid, count: entries.length },
    ...modules.map(m => ({ key: m, label: m, Icon: Folder, count: entries.filter(e => e.module === m).length })),
  ]
  // เมนูรอง (หัวข้อ) — แสดงเป็นแท็บบนสุดของเนื้อหา เฉพาะหัวข้อที่มีอยู่ในเมนูหลักที่เลือกอยู่
  const TOPIC_ITEMS = [
    { key: 'all', label: activeModule === 'all' ? 'ทั้งหมด' : activeModule, count: entriesInModule.length },
    ...topics.map(t => ({ key: t, label: t, count: entriesInModule.filter(e => e.topic === t).length })),
  ]

  const trackedEntries = entries.filter(e => e.category === 'bug' || e.category === 'plan')
  const openCount = trackedEntries.filter(e => e.status === 'open').length
  const doneCount = trackedEntries.filter(e => e.status === 'done').length
  const latestEntry = entries[0]
  const selectedEntry = filtered.find(e => e.id === activeEntryId) ?? filtered[0] ?? null
  const visibleEntries = activeTopic !== 'all' && selectedEntry ? [selectedEntry] : filtered
  const overviewStats = [
    { label: 'บันทึกทั้งหมด', value: entries.length, Icon: Database, tone: 'from-cyan-400 to-blue-500' },
    { label: 'ส่วนของระบบ', value: modules.length, Icon: Layers3, tone: 'from-violet-400 to-indigo-500' },
    { label: 'กำลังดำเนินการ', value: openCount, Icon: CircleDot, tone: 'from-amber-400 to-orange-500' },
    { label: 'เสร็จสมบูรณ์', value: doneCount, Icon: CheckCircle2, tone: 'from-emerald-400 to-teal-500' },
  ]

  return (
    <div className="min-h-screen bg-slate-50 md:flex text-slate-900">
      {/* ─── Sidebar เมนูหลัก: ส่วนของระบบ (PC) ─── */}
      <aside className="hidden md:flex md:w-72 md:h-screen md:sticky md:top-0 md:flex-col md:shrink-0 overflow-hidden relative"
        style={{ background: 'linear-gradient(165deg, #111827 0%, #0f2547 52%, #071426 100%)' }}>
        <div className="absolute -top-20 -right-16 w-52 h-52 rounded-full bg-cyan-400/10 blur-3xl pointer-events-none" />
        <div className="absolute bottom-24 -left-20 w-56 h-56 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />

        <div className="relative px-5 py-5 flex items-center gap-3 border-b border-white/10">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-cyan-400 via-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-950/30 shrink-0">
            <Command size={21} className="text-white" strokeWidth={2.2} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-black text-white leading-tight">Developer Console</p>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]" />
            </div>
            <p className="text-[11px] text-sky-200/55 mt-1">SmartLocal · System Workspace</p>
          </div>
          <button onClick={() => navigate('/admin')} title="กลับหน้าแอดมิน"
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-all shrink-0">
            <ArrowLeft size={16} />
          </button>
        </div>

        <div className="relative mx-4 mt-4 rounded-2xl border border-white/10 bg-white/[0.055] p-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-white/75">
              <Activity size={14} className="text-emerald-400" /> Developer Workspace
            </div>
            <span className="text-[10px] font-bold text-emerald-300 bg-emerald-400/10 border border-emerald-400/20 px-2 py-0.5 rounded-full">ACTIVE</span>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <div className="rounded-xl bg-black/15 px-2.5 py-2">
              <p className="text-lg font-black text-white">{entries.length}</p>
              <p className="text-[10px] text-white/40">บันทึกทั้งหมด</p>
            </div>
            <div className="rounded-xl bg-black/15 px-2.5 py-2">
              <p className="text-lg font-black text-cyan-300">{modules.length}</p>
              <p className="text-[10px] text-white/40">ส่วนของระบบ</p>
            </div>
          </div>
        </div>

        <p className="relative px-5 pt-5 pb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-white/30">System Modules</p>
        <nav className="relative flex-1 px-3 pb-3 space-y-1 overflow-y-auto">
          <button onClick={() => setShowModuleManager(true)}
            className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-violet-200 bg-violet-400/10 border border-violet-300/10 hover:text-white hover:bg-violet-400/20 hover:border-violet-300/20 transition-all">
            <span className="w-8 h-8 rounded-lg bg-violet-400/15 flex items-center justify-center text-violet-300 group-hover:text-white transition-colors">
              <ShieldCheck size={16} />
            </span>
            <span className="flex-1 text-left">จัดการโมดูล</span>
            <ChevronRight size={13} className="opacity-40" />
          </button>
          {MODULE_ITEMS.map(({ key, label, Icon, count }) => {
            const isActive = activeModule === key
            const subTopics = key === 'all' ? [] : topicsByModule(key)
            return (
              <div key={key}>
                <button onClick={() => selectModule(key)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all border ${
                    isActive && activeTopic === 'all'
                      ? 'bg-gradient-to-r from-blue-500/25 to-cyan-400/10 border-cyan-300/20 text-white shadow-lg shadow-blue-950/20'
                      : 'border-transparent text-white/55 hover:text-white hover:bg-white/[0.06]'
                  }`}>
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${isActive ? 'bg-cyan-300/15 text-cyan-300' : 'bg-white/[0.04]'}`}>
                    <Icon size={15} />
                  </span>
                  <span className="flex-1 text-left truncate">{label}</span>
                  {count > 0 && (
                    <span className="text-[10px] font-bold min-w-5 h-5 px-1.5 rounded-full bg-white/10 flex items-center justify-center">{count}</span>
                  )}
                </button>
                {/* สารบัญ — หัวข้อ (เมนูรอง) ของส่วนนี้ แสดงซ้อนไว้เสมอ ไม่ต้องคลิกเปิดก่อน */}
                {subTopics.length > 0 && (
                  <div className="ml-7 pl-3 border-l border-white/10 space-y-0.5 my-1">
                    {subTopics.map(t => {
                      const topicActive = activeModule === key && activeTopic === t
                      const topicCount = entries.filter(e => e.module === key && e.topic === t).length
                      return (
                        <button key={t} onClick={() => selectTopic(key, t)}
                          className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-all truncate ${
                            topicActive ? 'bg-white/10 text-cyan-200' : 'text-white/35 hover:text-white/70 hover:bg-white/[0.04]'
                          }`}>
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${topicActive ? 'bg-cyan-300' : 'bg-white/20'}`} />
                          <span className="flex-1 text-left truncate">{t}</span>
                          {topicCount > 0 && <span className="text-[9px] opacity-70">{topicCount}</span>}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </nav>
        <div className="relative px-3 py-3 border-t border-white/10">
          <button onClick={() => navigate('/admin')}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-white/50 hover:text-white hover:bg-white/[0.06] transition-all">
            <LogOut size={16} />
            กลับหน้าแอดมิน
          </button>
        </div>
      </aside>

      {/* ─── Mobile header ─── */}
      <div className="md:hidden sticky top-0 z-30 px-4 py-3 flex items-center gap-3 shadow-lg shadow-slate-900/10"
        style={{ background: 'linear-gradient(135deg, #0f172a 0%, #14345f 100%)' }}>
        <button onClick={() => navigate('/admin')} className="p-2 rounded-xl bg-white/10 text-white/70 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-black text-white">Developer Console</p>
          <p className="text-[11px] text-cyan-200/60">SmartLocal System Workspace</p>
        </div>
        <button onClick={() => setShowModuleManager(true)}
          aria-label="เปิดหน้าจัดการโมดูล" title="จัดการโมดูล"
          className="w-9 h-9 rounded-xl bg-violet-400/15 border border-violet-300/20 text-violet-200 flex items-center justify-center active:scale-90 transition-all">
          <ShieldCheck size={17} />
        </button>
        <span className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-300 bg-emerald-400/10 border border-emerald-300/20 px-2 py-1 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> ACTIVE
        </span>
      </div>

      {/* ─── Main content ─── */}
      <div className="flex-1 min-w-0 pb-24 md:pb-0 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.08),transparent_30%),linear-gradient(180deg,#f8fafc_0%,#f1f5f9_100%)]">
        <div className="hidden md:flex sticky top-0 z-20 items-center justify-between gap-3 px-7 py-3.5 bg-white/85 backdrop-blur-xl border-b border-slate-200/70">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-slate-900 flex items-center justify-center shadow-sm">
              <Cpu size={17} className="text-cyan-300" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">System Workspace</p>
              <p className="text-sm font-black text-slate-800 truncate">{activeModule === 'all' ? 'ทุกส่วนของระบบ' : activeModule}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <UserProfileBadge tone="onLight" />
            <PortalSwitcher className="flex" tone="onLight" />
            <button onClick={async () => { await signOutSafely('/'); navigate('/') }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors border border-slate-200">
              <LogOut size={13} />
              ออกจากระบบ
            </button>
            <button onClick={openCreate}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-bold text-white bg-gradient-to-r from-blue-600 to-indigo-600 shadow-md shadow-blue-600/20 hover:shadow-blue-600/30 hover:-translate-y-0.5 active:scale-95 transition-all">
              <Plus size={14} /> เพิ่มบันทึกใหม่
            </button>
          </div>
        </div>

        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-5 lg:py-7 space-y-5">
          <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-blue-950 to-indigo-950 text-white p-5 sm:p-6 lg:p-7 shadow-2xl shadow-slate-900/15">
            <div className="absolute -top-28 right-0 w-80 h-80 rounded-full bg-cyan-400/15 blur-3xl pointer-events-none" />
            <div className="absolute -bottom-24 left-1/3 w-72 h-72 rounded-full bg-indigo-500/20 blur-3xl pointer-events-none" />
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-300/80 to-transparent" />

            <div className="relative flex flex-col lg:flex-row lg:items-start justify-between gap-5">
              <div className="max-w-2xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-200">
                  <Sparkles size={12} /> Smart City Engineering
                </div>
                <h1 className="mt-3 text-2xl sm:text-3xl font-black tracking-tight">ศูนย์ควบคุมงานพัฒนาระบบ</h1>
                <p className="mt-2 text-sm text-slate-300 leading-relaxed">
                  บันทึกองค์ความรู้ ติดตามประเด็นทางเทคนิค และบริหารแผนพัฒนา SmartLocal ทุกเทศบาลในพื้นที่เดียว
                </p>
              </div>
              <div className="flex lg:flex-col items-center lg:items-end justify-between gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 backdrop-blur-sm">
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
                  <ShieldCheck size={15} /> โหมดผู้พัฒนา
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-white/45">
                  <Clock3 size={12} />
                  {latestEntry ? `อัปเดตล่าสุด ${thaiDate(latestEntry.updated_at ?? latestEntry.created_at)}` : 'ยังไม่มีบันทึก'}
                </div>
              </div>
            </div>

            <div className="relative grid grid-cols-2 lg:grid-cols-4 gap-2.5 mt-6">
              {overviewStats.map(({ label, value, Icon, tone }) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.065] p-3.5 backdrop-blur-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${tone} flex items-center justify-center shadow-lg`}>
                      <Icon size={15} className="text-white" />
                    </div>
                    <span className="text-2xl font-black tracking-tight">{value}</span>
                  </div>
                  <p className="mt-2 text-[11px] font-semibold text-white/50">{label}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200/80 bg-white/90 backdrop-blur-xl shadow-sm p-3 sm:p-4">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="ค้นหา module, หัวข้อ หรือรายละเอียดทางเทคนิค..."
                className="w-full pl-10 pr-10 py-3 text-sm border border-slate-200 rounded-xl bg-slate-50/80 text-slate-900 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-300 transition-all" />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-600">
                  <X size={14} />
                </button>
              )}
            </div>
            <button onClick={openCreate}
              className="md:hidden shrink-0 flex items-center gap-1.5 px-3.5 py-3 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-blue-600 to-indigo-600 shadow-md active:scale-95 transition-all">
              <Plus size={15} /> ใหม่
            </button>
          </div>

          {/* เมนูรอง: หัวข้อ — โชว์แค่ตอนอยู่หน้าสารบัญ (ยังไม่เลือกหัวข้อ) เพื่อไม่ให้หัวข้ออื่น
              ของ module เดียวกันมาปนกับหน้าที่กำลังดูอยู่ (เช่น ดูหัวข้อ A ไม่ควรเห็นแท็บหัวข้อ B) */}
          {activeTopic === 'all' && TOPIC_ITEMS.length > 1 && (
            <div className="mt-3 pt-3 border-t border-slate-100">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Topic Filters</p>
                <span className="text-[10px] text-slate-400">{filtered.length} รายการ</span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'none' }}>
                {TOPIC_ITEMS.map(({ key, label, count }) => (
                  <button key={key} onClick={() => setActiveTopic(key)}
                    className={`shrink-0 flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl border transition-all ${
                      activeTopic === key
                        ? 'bg-slate-900 border-slate-900 text-white shadow-md'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-blue-300 hover:text-blue-600'
                    }`}>
                    {label} {count > 0 && <span className="opacity-60">{count}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          </section>

          {loading ? (
            <div className="rounded-3xl border border-slate-200 bg-white/80 flex flex-col items-center justify-center py-20 text-slate-400 shadow-sm">
              <Loader2 size={28} className="animate-spin text-blue-500" />
              <p className="text-xs font-semibold mt-3">กำลังโหลด System Journal...</p>
            </div>
          ) : showTopicIndex ? (
            /* สารบัญหัวข้อ — โชว์แค่ชื่อหัวข้อ+จำนวน ไม่โชว์เนื้อหาเต็ม จนกว่าจะคลิกเข้าไป */
            <section>
              <div className="flex items-end justify-between gap-4 mb-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-500">Knowledge Modules</p>
                  <h2 className="text-lg font-black text-slate-900 mt-1">สารบัญองค์ความรู้ระบบ</h2>
                </div>
                <span className="text-xs font-semibold text-slate-400">{topics.length} หัวข้อ</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {topics.map((t, index) => {
                  const topicEntries = entriesInModule.filter(e => e.topic === t)
                  const cats = Array.from(new Set(topicEntries.map(e => e.category)))
                  const latest = topicEntries.reduce((a, b) => (a.created_at > b.created_at ? a : b))
                  return (
                    <button key={t} onClick={() => setActiveTopic(t)}
                      className="group relative min-h-44 text-left bg-white/90 rounded-3xl border border-slate-200/80 shadow-sm hover:shadow-xl hover:shadow-blue-900/10 hover:-translate-y-1 hover:border-blue-200 transition-all p-5 overflow-hidden">
                      <div className="absolute -top-14 -right-12 w-36 h-36 rounded-full bg-gradient-to-br from-blue-100/80 to-indigo-100/30 group-hover:scale-125 transition-transform duration-500" />
                      <span className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-500" />
                      <div className="relative flex items-start justify-between gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-100 border border-white flex items-center justify-center shadow-sm shrink-0">
                          <BookOpen size={18} className="text-indigo-600" />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 shrink-0">{topicEntries.length} บันทึก</span>
                          <ChevronRight size={17} className="text-slate-300 group-hover:text-blue-500 group-hover:translate-x-0.5 transition-all" />
                        </div>
                      </div>
                      <div className="relative mt-4">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">NODE {String(index + 1).padStart(2, '0')}</p>
                        <p className="text-base font-black text-slate-800 mt-1 group-hover:text-blue-700 transition-colors leading-snug line-clamp-2">{t}</p>
                      </div>
                      <div className="relative flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
                        <div className="flex items-center gap-1.5">
                          {cats.map(cat => {
                            const c = catMeta(cat)
                            return <span key={cat} className="w-2 h-2 rounded-full ring-2 ring-white" style={{ backgroundColor: c.color }} title={c.label} />
                          })}
                        </div>
                        <span className="text-[10px] text-slate-400 flex items-center gap-1"><Clock3 size={10} />{thaiDate(latest.created_at)}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>
          ) : filtered.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white/60 flex flex-col items-center justify-center py-20 text-slate-400">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
                <BookOpen size={24} className="text-slate-300" />
              </div>
              <p className="text-sm font-bold text-slate-500">{search ? 'ไม่พบข้อมูลที่ค้นหา' : 'ยังไม่มีบันทึกในส่วนนี้'}</p>
              <p className="text-xs text-slate-400 mt-1">ลองเปลี่ยนคำค้นหา หรือเพิ่มบันทึกใหม่</p>
            </div>
          ) : (
            <section>
              {activeTopic !== 'all' && (
                <div className="flex items-center justify-between gap-4 mb-4">
                  <div>
                    <button onClick={() => { setActiveTopic('all'); setActiveEntryId(null) }}
                      className="flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-700 transition-colors">
                      <ArrowLeft size={13} /> กลับไปสารบัญหัวข้อ
                    </button>
                    <h2 className="text-lg font-black text-slate-900 mt-2">{activeTopic}</h2>
                  </div>
                  <span className="text-xs font-semibold text-slate-400">{filtered.length} บันทึก</span>
                </div>
              )}
              {activeTopic !== 'all' && (
                <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm overflow-hidden" role="tablist" aria-label={`บันทึกในหัวข้อ ${activeTopic}`}>
                  <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                    {filtered.map((entry, index) => {
                      const c = catMeta(entry.category)
                      const isActive = selectedEntry?.id === entry.id
                      return (
                        <button key={entry.id} type="button" role="tab" aria-selected={isActive}
                          onClick={() => setActiveEntryId(entry.id)}
                          className={`group/tab min-w-[220px] max-w-[360px] flex items-center gap-2.5 px-3.5 py-3 rounded-xl text-left transition-all ${
                            isActive
                              ? 'bg-gradient-to-r from-slate-950 via-blue-950 to-indigo-950 text-white shadow-md'
                              : 'bg-slate-50 text-slate-500 hover:bg-blue-50 hover:text-blue-700'
                          }`}>
                          <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-[10px] font-black"
                            style={isActive ? { backgroundColor: `${c.color}35`, color: '#fff' } : { backgroundColor: c.bg, color: c.color }}>
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className={`block text-[10px] font-bold uppercase tracking-wider ${isActive ? 'text-cyan-200/60' : 'text-slate-400'}`}>{c.label}</span>
                            <span className="block text-xs font-bold truncate mt-0.5">{entry.title}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              <div className={`grid grid-cols-1 gap-4 ${activeTopic === 'all' ? 'xl:grid-cols-2' : ''}`}>
                {visibleEntries.map(entry => {
                  const c = catMeta(entry.category)
                  const muni = municipalities.find(m => m.id === entry.municipality_id)
                  return (
                    <article key={entry.id} className="group relative bg-white/95 rounded-3xl shadow-sm hover:shadow-lg border border-slate-200/80 overflow-hidden transition-all">
                      <span className="absolute top-0 left-0 w-1.5 h-full" style={{ background: `linear-gradient(180deg, ${c.color}, ${c.border})` }} />
                      <div className="p-5 pl-6">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg"
                              style={{ backgroundColor: c.bg, color: c.color }}>
                              <c.Icon size={12} /> {c.label}
                            </span>
                            {(entry.category === 'bug' || entry.category === 'plan') && (
                              <span className={`text-[11px] font-bold px-2.5 py-1 rounded-lg ${
                                entry.status === 'done' ? 'bg-emerald-50 text-emerald-700' : entry.status === 'wontfix' ? 'bg-slate-100 text-slate-500' : 'bg-amber-50 text-amber-700'
                              }`}>
                                {STATUS_LABEL[entry.status]}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => openEdit(entry)} title="แก้ไขบันทึก" className="p-2 rounded-xl hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors">
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => handleDelete(entry.id)} title="ลบบันทึก" className="p-2 rounded-xl hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>

                        <h3 className="text-base font-black text-slate-900 mt-4 leading-snug">{entry.title}</h3>
                        <p className="text-sm text-slate-600 mt-2 whitespace-pre-wrap leading-relaxed">{entry.body}</p>

                        <div className="flex items-center gap-2 flex-wrap mt-4 pt-3 border-t border-slate-100">
                          {entry.module && (
                            <button onClick={() => selectModule(entry.module)}
                              className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">
                              <Folder size={10} /> {entry.module}
                            </button>
                          )}
                          {entry.topic && (
                            <button onClick={() => setActiveTopic(entry.topic)}
                              className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors">
                              {entry.topic}
                            </button>
                          )}
                          {muni && <span className="text-[10px] font-semibold text-slate-500">{muni.name}</span>}
                          <span className="ml-auto text-[10px] text-slate-400 flex items-center gap-1"><Clock3 size={10} />{thaiDate(entry.created_at)}</span>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* ─── Bottom tab bar เมนูหลัก: ส่วนของระบบ (มือถือ) ─── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex items-stretch overflow-x-auto"
        style={{
          background: 'linear-gradient(180deg, rgba(15,35,67,0.98) 0%, rgba(7,20,38,0.99) 100%)',
          borderTop: '1px solid rgba(103,232,249,0.16)',
          boxShadow: '0 -8px 30px rgba(15,23,42,0.32)',
          borderTopLeftRadius: '24px',
          borderTopRightRadius: '24px',
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 6px)',
          scrollbarWidth: 'none',
        }}>
        {MODULE_ITEMS.map(({ key, label, Icon }) => {
          const isActive = activeModule === key
          return (
            <button key={key} onClick={() => selectModule(key)}
              className="flex-1 min-w-[76px] flex flex-col items-center justify-center gap-0.5 pt-2 pb-1 transition-all active:scale-90">
              <div className="relative w-10 h-9 rounded-xl flex items-center justify-center transition-all duration-200"
                style={{ background: isActive ? 'linear-gradient(135deg, rgba(34,211,238,0.28), rgba(59,130,246,0.28))' : 'transparent' }}>
                {isActive && (
                  <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-4 h-[3px] rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.8)]" />
                )}
                <Icon size={19} strokeWidth={isActive ? 2.2 : 1.6}
                  style={{ color: isActive ? '#a5f3fc' : 'rgba(255,255,255,0.4)' }} />
              </div>
              <span className="text-[10px] font-bold leading-tight truncate max-w-[70px]"
                style={{ color: isActive ? '#fff' : 'rgba(255,255,255,0.4)' }}>
                {label}
              </span>
            </button>
          )
        })}
        <button onClick={() => setShowModuleManager(true)}
          className="flex-1 min-w-[86px] flex flex-col items-center justify-center gap-0.5 pt-2 pb-1 transition-all active:scale-90">
          <div className="relative w-10 h-9 rounded-xl flex items-center justify-center bg-violet-400/15">
            <ShieldCheck size={19} strokeWidth={1.8} className="text-violet-300" />
          </div>
          <span className="text-[10px] font-bold leading-tight text-violet-200">จัดการโมดูล</span>
        </button>
      </div>

      {showModuleManager && (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-100 md:left-72">
          <header className="shrink-0 border-b border-white/10 px-4 py-3 text-white shadow-lg md:px-6"
            style={{ background: 'linear-gradient(135deg, #0f172a 0%, #172554 55%, #312e81 100%)' }}>
            <div className="mx-auto flex w-full max-w-7xl items-center gap-3">
              <button onClick={() => setShowModuleManager(false)} aria-label="กลับหน้าผู้พัฒนาระบบ"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/10 text-white/75 transition-all hover:bg-white/20 hover:text-white active:scale-90">
                <ArrowLeft size={18} />
              </button>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-400/15 text-violet-200">
                <ShieldCheck size={19} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black">จัดการโมดูล</p>
                <p className="truncate text-[11px] text-violet-200/60">Developer Console · System Configuration</p>
              </div>
              <button onClick={() => setShowModuleManager(false)} aria-label="ปิดหน้าจัดการโมดูล"
                className="hidden h-9 w-9 items-center justify-center rounded-xl text-white/50 transition-colors hover:bg-white/10 hover:text-white md:flex">
                <X size={17} />
              </button>
            </div>
          </header>
          <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
            <div className="mx-auto w-full max-w-5xl rounded-3xl border border-slate-200 bg-white p-4 shadow-xl shadow-slate-900/5 md:p-6">
              <SuperAdminPanel tenant={tenant} />
            </div>
          </main>
        </div>
      )}

      {editing !== null && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-end md:items-center justify-center md:p-5">
          <div className="bg-white w-full md:max-w-2xl md:rounded-3xl rounded-t-3xl max-h-[93vh] flex flex-col overflow-hidden shadow-2xl shadow-slate-950/30 border border-white/20">
            <div className="relative overflow-hidden shrink-0 px-5 py-4 text-white bg-gradient-to-r from-slate-950 via-blue-950 to-indigo-950">
              <div className="absolute -top-12 right-10 w-36 h-36 rounded-full bg-cyan-400/15 blur-2xl" />
              <div className="relative flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center shadow-lg">
                  <Command size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-black">{editing?.id ? 'แก้ไข System Journal' : 'สร้าง System Journal ใหม่'}</p>
                  <p className="text-[11px] text-cyan-100/55 mt-0.5">บันทึกองค์ความรู้และประเด็นทางเทคนิคให้ค้นคืนได้ง่าย</p>
                </div>
                <button onClick={() => setEditing(null)} className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all">
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-600 mb-1.5 block">ส่วนของระบบ</label>
                <input type="text" list="module-suggestions" value={form.module}
                  onChange={e => setForm(f => ({ ...f, module: e.target.value }))}
                  className={inputCls} placeholder="เช่น งานบริการประชาชน, แอดมิน, ฐานข้อมูล/RLS" />
                <datalist id="module-suggestions">
                  {modules.map(m => <option key={m} value={m} />)}
                </datalist>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 mb-1.5 block">หัวข้อย่อย (เมนูรอง)</label>
                <input type="text" list="topic-suggestions" value={form.topic}
                  onChange={e => setForm(f => ({ ...f, topic: e.target.value }))}
                  className={inputCls} placeholder="เช่น แผนที่ Leaflet + Longdo Map (ไทย)" />
                <datalist id="topic-suggestions">
                  {topics.map(t => <option key={t} value={t} />)}
                </datalist>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 mb-2 block">ประเภท</label>
                <div className="grid grid-cols-2 gap-2">
                  {CATEGORIES.map(c => (
                    <button key={c.value} type="button" onClick={() => setForm(f => ({ ...f, category: c.value }))}
                      className="flex items-center gap-2.5 px-3 py-3 rounded-xl border text-left text-xs font-bold transition-all active:scale-95"
                      style={form.category === c.value ? { borderColor: c.color, backgroundColor: c.bg, color: c.color } : { borderColor: '#e5e7eb', color: '#6b7280' }}>
                      <span className="w-7 h-7 rounded-lg bg-white/70 flex items-center justify-center shadow-sm"><c.Icon size={14} /></span> {c.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 mb-1.5 block">หัวข้อ *</label>
                <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  className={inputCls} placeholder="สรุปสั้นๆ" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 mb-1.5 block">เนื้อหา *</label>
                <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} rows={6}
                  className={inputCls + ' resize-none'} placeholder="รายละเอียด..." />
              </div>
              {(form.category === 'bug' || form.category === 'plan') && (
                <div>
                  <label className="text-xs font-bold text-slate-600 mb-1.5 block">สถานะ</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className={inputCls}>
                    {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="text-xs font-bold text-slate-600 mb-1.5 block">เกี่ยวข้องกับเทศบาล</label>
                <select value={form.municipality_id} onChange={e => setForm(f => ({ ...f, municipality_id: e.target.value }))} className={inputCls}>
                  <option value="">ทั้งระบบ / ไม่ระบุ</option>
                  {municipalities.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
            </div>
            <div className="px-5 pb-6 pt-4 border-t border-slate-200 bg-slate-50 shrink-0">
              <button onClick={handleSave} disabled={saving || !form.title.trim() || !form.body.trim()}
                className="w-full py-3.5 rounded-2xl font-bold text-white bg-gradient-to-r from-blue-600 to-indigo-600 shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:shadow-none text-sm active:scale-[0.98] transition-all">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                {editing?.id ? 'บันทึกการแก้ไข' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
