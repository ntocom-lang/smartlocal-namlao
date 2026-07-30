import { useEffect, useState, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, GeoJSON, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Loader2, Database, MessageSquareWarning, Construction, Minimize2, Maximize2, X, MapPin, Route, Layers } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const LONGDO_KEY = import.meta.env.VITE_LONGDO_KEY

// โหมดชั้นแผนที่ — รองรับ Google Maps (ถนนแบบละเอียดภาษาไทย), Google Hybrid, Longdo Map และ OpenStreetMap
const TILE_MODES = {
  google_street: {
    label: 'Google Maps (ถนนละเอียด)',
    url: 'https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    subdomains: ['0', '1', '2', '3'],
    attribution: '&copy; Google Maps',
  },
  google_hybrid: {
    label: 'Google Hybrid (ดาวเทียม+ถนน)',
    url: 'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    subdomains: ['0', '1', '2', '3'],
    attribution: '&copy; Google Maps',
  },
  ...(LONGDO_KEY ? {
    longdo: {
      label: 'Longdo Map (ภาษาไทย)',
      url: `https://ms.longdo.com/mmmap/tile.php?zoom={z}&x={x}&y={y}&key=${LONGDO_KEY}`,
      subdomains: ['a'],
      attribution: '&copy; Longdo Map',
    }
  } : {}),
  osm: {
    label: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c'],
    attribution: '&copy; OpenStreetMap',
  },
}

// แผนที่รวมพิกัดชุดเดียวกัน ใช้ทั้งฝั่งเจ้าหน้าที่และฝั่งประชาชน ไม่ต้องแก้ 2 ที่

// ไอคอน/สีต่อกลุ่มหลัก — เพิ่มกลุ่มใหม่ที่ไม่อยู่ในนี้ได้ จะใช้สี fallback อัตโนมัติ
// กลุ่ม "คำร้อง"/"สถานประกอบการ"/"โครงการก่อสร้าง" มาจากฟีเจอร์เดิมของระบบ (RPC data_center_unified_pins
// รวมเข้ามาด้วยอัตโนมัติ) ไม่ใช่แค่ที่กรอกผ่านศูนย์ข้อมูลดิจิทัลโดยตรง
const GROUP_META = {
  'สาธารณสุข':        { emoji: '⛑️', color: '#dc2626' },
  'สถานที่สำคัญ':      { emoji: '📍', color: '#059669' },
  'สถานประกอบการ':     { emoji: '🏢', color: '#d97706' },
  'การจัดการขยะ':      { emoji: '🗑️', color: '#7c3aed' },
  // pinColor: สีพื้นหลังหมุดบนแผนที่โดยเฉพาะ (อ่อนกว่า color ปกติ) — เพราะอิโมจิ 🏫 มีสีน้ำเงินอยู่ในตัว
  // ถ้าใช้สีเดียวกับพื้นหลังเข้ม (#2563eb) จะกลืนมองไม่เห็นตัวโรงเรียน — color เดิมยังใช้กับข้อความ/หัวการ์ดที่อื่นตามปกติ
  'สถานศึกษา':         { emoji: '🏫', color: '#2563eb', pinColor: '#93c5fd' },
  'โครงสร้างพื้นฐาน':   { emoji: '🏗️', color: '#0891b2' },
  'สถานที่หลบภัย':     { emoji: '⛺', color: '#b91c1c' },
  'พื้นที่สีเขียว':     { emoji: '🌳', color: '#16a34a' },
  'คำร้อง':            { emoji: '📣', color: '#ef4444' },
  'โครงการก่อสร้าง':    { emoji: '🚧', color: '#7c3aed' },
}
const FALLBACK = { emoji: '📌', color: '#475569' }
const groupMeta = g => GROUP_META[g] ?? FALLBACK

// ไอคอนเฉพาะประเภทย่อย (key ตรงกับ e.category ที่พิมพ์ในฟอร์มเป๊ะๆ) — ใส่เฉพาะที่อยากแยกให้ต่างจากไอคอนกลุ่มหลัก
// ไม่ต้องใส่ครบทุกประเภท ถ้าไม่มีในนี้จะ fallback ไปใช้ไอคอนของกลุ่มหลัก (meta.emoji) แทนอัตโนมัติ
const CATEGORY_EMOJI_OVERRIDE = {
  'โรงเรียน': '🏫',
  'แหล่งเรียนรู้ภูมิปัญญาท้องถิ่น': '🏺',
  'แหล่งเรียนรู้พอเพียง': '🌾',
}
const markerEmoji = e => CATEGORY_EMOJI_OVERRIDE[e.category] ?? groupMeta(e.group_name).emoji

// ฝั่งประชาชนบังคับเห็นเฉพาะ "คำร้อง"/"โครงการ" ที่เสร็จสิ้น/จบงานแล้วเท่านั้น (ไม่มีตัวเลือกสถานะ)
// ฝั่งเจ้าหน้าที่ (allowStatusFilter=true) เลือกดูสถานะอื่นได้ด้วยผ่านตัวกรองสถานะ — ค่าเริ่มต้นยังเป็น "เสร็จสิ้นแล้ว" เหมือนกัน
// สถานะจริงในตาราง complaints ใช้ทั้ง 'closed' และ 'done' แทนความหมาย "เสร็จสิ้น"
const COMPLETED_COMPLAINT_STATUSES = ['closed', 'done']
// ตาราง civil_projects ใช้ status = 'completed' แทนความหมาย "จบงาน"
const COMPLETED_PROJECT_STATUSES = ['completed']

const STATUS_FILTER_OPTIONS = [
  { value: 'completed',   label: 'เสร็จสิ้นแล้ว' },
  { value: 'in_progress', label: 'กำลังดำเนินการ' },
  { value: 'all',         label: 'ทั้งหมด' },
]
// ใช้กรองเฉพาะแถวจากตาราง complaints/civil_projects เท่านั้น — แหล่งข้อมูลอื่น (data_center_entries ฯลฯ)
// ไม่มีแนวคิด "เสร็จสิ้น/กำลังดำเนินการ" แบบนี้ จึงไม่ถูกกรองด้วยตัวเลือกนี้
function matchesStatusFilter(entry, statusFilter) {
  if (entry.source_table !== 'complaints' && entry.source_table !== 'civil_projects') return true
  if (statusFilter === 'all') return true
  const completedSet = entry.source_table === 'complaints' ? COMPLETED_COMPLAINT_STATUSES : COMPLETED_PROJECT_STATUSES
  const isCompleted = completedSet.includes(entry.status)
  return statusFilter === 'completed' ? isCompleted : !isCompleted
}

// ป้ายชื่อไทยของ category — อ้างอิงจาก CATEGORY_LABEL เดิมใน ComplaintsManager.jsx (คำร้อง)
// และ ROUTE_STYLE เดิมใน MapDashboardAdmin.jsx (โครงการ) เพื่อไม่ให้ชื่อขัดกันระหว่างหน้า
const COMPLAINT_CATEGORY_LABEL = {
  road: 'ถนน/ทางสาธารณะ', light: 'ไฟฟ้าสาธารณะ',
  trash: 'ขยะ/ความสะอาด', water: 'น้ำประปา',
  flood: 'น้ำท่วม/ระบายน้ำ', tree: 'ต้นไม้/สวนสาธารณะ',
  noise: 'เหตุรำคาญ', drain: 'ท่อระบายน้ำ',
  waste_water: 'น้ำเสีย', building: 'ตรวจสอบอาคาร',
  mosquito: 'พ่นยุง', canal: 'ลอกคลอง',
  animals: 'สุนัขจรจัด', water_supply: 'สนับสนุนน้ำอุปโภค',
  borrow_equipment: 'ยืมพัสดุ', grievance: 'ร้องทุกข์/ร้องเรียน',
  corruption: 'แจ้งการทุจริต', tax: 'ภาษีและค่าธรรมเนียม',
  disease: 'ควบคุมโรคติดต่อ', other: 'อื่นๆ',
}
const PROJECT_TYPE_LABEL = {
  road: 'ถนน (ไม่ระบุ)', road_concrete: 'ถนน ค.ส.ล.', road_asphalt: 'ลาดยางแอสฟัลท์',
  road_slurry: 'ฉาบผิวสเลอรี่ซิล', road_gravel: 'ถนนหินคลุก',
  drain: 'รางระบายน้ำ', dredge: 'ขุดลอก', canal: 'รางน้ำ/ลำเหมือง',
  pipe_water: 'ท่อน้ำประปา', waterway: 'รางส่งน้ำ',
  building: 'อาคาร/สิ่งก่อสร้าง', light: 'ไฟฟ้าสาธารณะ', park: 'สวนสาธารณะ', other: 'อื่นๆ',
}
const categoryLabel = e => {
  if (e.source_table === 'complaints') return COMPLAINT_CATEGORY_LABEL[e.category] ?? e.category
  if (e.source_table === 'civil_projects') return PROJECT_TYPE_LABEL[e.category] ?? e.category
  return e.category
}
// กุญแจสำหรับกรองระดับ "ประเภทย่อยในกลุ่ม" — ผูกกับกลุ่มด้วย เพราะป้ายชื่อประเภทอาจซ้ำกันข้ามกลุ่มได้
const categoryKey = e => `${e.group_name}::${categoryLabel(e)}`

// ลิงก์ออกไปเปิด Google Maps พร้อมปักหมุดตรงพิกัดเป๊ะๆ (URL scheme ทางการของ Google, ไม่ต้องใช้ API key/ผูกบัตรเครดิต)
const googleMapsUrl = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`

function makeDivIcon(emoji, color, size = 30) {
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;background:${color};border:2px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:${size * 0.5}px;box-shadow:0 2px 8px rgba(0,0,0,0.28)">${emoji}</div>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -(size / 2)],
  })
}

// เส้นเขตปกครองระดับตำบล/เทศบาล — ไฟล์ static ต่อเทศบาล (public/boundaries/{slug}.geojson)
// ที่มา: HDX COD-AB Thailand (แปลงจากข้อมูลกรมแผนที่ทหาร) ไม่มีไฟล์ก็แค่ไม่แสดง ไม่ error
function MunicipalityBoundary({ slug }) {
  const [geojson, setGeojson] = useState(null)
  useEffect(() => {
    if (!slug) { setGeojson(null); return }
    fetch(`/boundaries/${slug}.geojson`)
      .then(res => (res.ok ? res.json() : null))
      .then(setGeojson)
      .catch(() => setGeojson(null))
  }, [slug])
  if (!geojson) return null
  return (
    <GeoJSON data={geojson} interactive={false}
      style={{ color: '#f97316', weight: 2, dashArray: '4 6', fillColor: '#86efac', fillOpacity: 0.25 }} />
  )
}

function FitBoundsOnLoad({ points, fallback }) {
  const map = useMap()
  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current) return
    fitted.current = true
    if (points.length > 0) {
      map.fitBounds(L.latLngBounds(points.map(p => [p.latitude, p.longitude])), { padding: [40, 40], maxZoom: 16 })
    } else if (fallback) {
      map.setView(fallback, 13)
    }
  }, [points.length]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

// จัดกลุ่ม entries ที่กรองมาแล้วเป็น [{ group, total, categories: [{category, count}] }] เรียงตามตัวอักษรไทย
// ใช้ป้ายชื่อไทย (categoryLabel) แทนรหัส category ดิบ แล้วรวมจำนวนตามป้ายชื่อ (กันชื่อซ้ำเวลามีหลายรหัสแปลผลเดียวกัน)
function buildGroupSummary(list) {
  const gs = Array.from(new Set(list.map(e => e.group_name))).sort((a, b) => a.localeCompare(b, 'th'))
  return gs.map(g => {
    const inGroup = list.filter(e => e.group_name === g)
    const labeled = inGroup.map(e => categoryLabel(e)).filter(Boolean)
    const cats = Array.from(new Set(labeled)).sort((a, b) => a.localeCompare(b, 'th'))
    return {
      group: g,
      total: inGroup.length,
      categories: cats.map(c => ({ category: c, count: labeled.filter(l => l === c).length })),
    }
  })
}

// เนื้อหาแท็บ + การ์ดสรุป — ใช้ร่วมกันทั้งแถบขวาบน PC และแผงล่างบนมือถือ ไม่ต้องแก้ 2 ที่
// showSourceTabs=false (ฝั่งประชาชน): ซ่อนเฉพาะปุ่ม "คำร้อง"/"โครงการ" — แถบ "ศูนย์ข้อมูลดิจิทัล" ยังต้องอยู่เสมอ
// (เดิมซ่อนทั้งแถบไปด้วยโดยไม่ตั้งใจ ทำให้ประชาชนไม่เห็นหัวข้ออะไรเลย)
function SummaryPanel({ activeTab, setActiveTab, activeSummary, activeGroups, toggleGroup, activeCategories, toggleCategory, showSourceTabs, routeCategoryKeys, showRoutes, setShowRoutes }) {
  return (
    <>
      <div className="flex border-b border-gray-100 shrink-0">
        <button onClick={() => setActiveTab('dce')}
          className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-bold transition-colors"
          style={activeTab === 'dce'
            ? { color: '#1e88c7', borderBottom: '2px solid #1e88c7' }
            : { color: '#9ca3af' }}>
          <Database size={14} /> ศูนย์ข้อมูลดิจิทัล
        </button>
        {showSourceTabs && (
          <>
            <button onClick={() => setActiveTab('complaints')}
              className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-bold transition-colors"
              style={activeTab === 'complaints'
                ? { color: '#1e88c7', borderBottom: '2px solid #1e88c7' }
                : { color: '#9ca3af' }}>
              <MessageSquareWarning size={14} /> คำร้อง
            </button>
            <button onClick={() => setActiveTab('projects')}
              className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-bold transition-colors"
              style={activeTab === 'projects'
                ? { color: '#1e88c7', borderBottom: '2px solid #1e88c7' }
                : { color: '#9ca3af' }}>
              <Construction size={14} /> โครงการ
            </button>
          </>
        )}
      </div>

      <div className="p-3 space-y-3">
        {activeSummary.length === 0 ? (
          <p className="text-xs text-gray-300 text-center py-10">ยังไม่มีข้อมูลในหมวดนี้</p>
        ) : activeSummary.map(({ group, total, categories }) => {
          const meta = groupMeta(group)
          // กลุ่มที่ตอนนี้เป็นเส้นทาง (ถนน) ล้วน 100% (ไม่มีจุดปักหมุดแบบอื่นปนอยู่เลย) ให้หัวการ์ดกลุ่ม
          // สะท้อน/สั่งงาน showRoutes เหมือนแถวประเภทย่อยข้างล่าง กันปุ่มกดแล้วไม่มีผล (activeGroups
          // ไม่มีผลกับ entry ที่เป็นเส้นทางอยู่แล้ว) ถ้ามีจุดปนอยู่ด้วยยังใช้ toggleGroup ตามปกติ
          const isRouteOnlyGroup = categories.length > 0 && categories.every(c => routeCategoryKeys.has(`${group}::${c.category}`))
          const on = isRouteOnlyGroup ? showRoutes : (activeGroups === null || activeGroups.has(group))
          const onGroupToggle = isRouteOnlyGroup ? () => setShowRoutes(v => !v) : () => toggleGroup(group)
          // ฝั่งประชาชนไม่ต้องเห็นรายประเภทของถนน (สายหลัก/สายรอง) ซ้ำกับปุ่มลอย 🛣️ — มีปุ่มเดียวพอ
          // ฝั่งเจ้าหน้าที่ (showSourceTabs=true) ยังเห็นไว้เผื่อเช็คจำนวนข้อมูลที่กรอกครบ/ไม่ครบ
          const visibleCategories = categories.filter(c => showSourceTabs || !routeCategoryKeys.has(`${group}::${c.category}`))
          return (
            <div key={group} className="rounded-2xl border border-gray-100 overflow-hidden">
              <button onClick={onGroupToggle}
                className="w-full flex items-center justify-between px-3 py-2.5 transition-colors"
                style={{ backgroundColor: on ? meta.color : '#f3f4f6' }}>
                <span className="flex items-center gap-2 text-sm font-bold" style={{ color: on ? '#fff' : '#9ca3af' }}>
                  <span>{meta.emoji}</span> {group}
                </span>
                {/* ไม่มีรายประเภทให้กางดู (ฝั่งประชาชนถูกซ่อนไว้) ก็ไม่ต้องโชว์จำนวนรวม กันงงว่านับอะไรบ้าง */}
                {visibleCategories.length > 0 && (
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-white/25"
                    style={{ color: on ? '#fff' : '#9ca3af' }}>{total} แห่ง</span>
                )}
              </button>
              {visibleCategories.length > 0 && (
                <div className="px-3 py-2 space-y-1">
                  {visibleCategories.map(({ category, count }) => {
                    const key = `${group}::${category}`
                    // ประเภทที่เป็นเส้นทาง (ถนน) ควบคุมด้วยปุ่ม 🛣️ ลอยบนแผนที่ตัวเดียวกัน ไม่ผ่านระบบ
                    // activeCategories ปกติ (ดู DataCenterMapView visible filter) — แถวนี้เลยต้องสะท้อน/สั่งงาน
                    // showRoutes แทน ไม่งั้นจะกดแล้วแผนที่ไม่ขยับ (ดูเหมือน toggle ติดแต่ไม่มีผลจริง)
                    const isRouteCategory = routeCategoryKeys.has(key)
                    const catOn = isRouteCategory ? showRoutes : activeCategories.has(key)
                    const onToggle = isRouteCategory ? () => setShowRoutes(v => !v) : () => toggleCategory(key)
                    return (
                      <button key={category} onClick={onToggle}
                        className="w-full flex items-center justify-between text-xs rounded-lg px-2 py-1.5 transition-colors"
                        style={catOn
                          ? { backgroundColor: `${meta.color}1a`, color: meta.color }
                          : { backgroundColor: 'transparent', color: '#4b5563' }}>
                        <span className="font-medium">{category}</span>
                        <span className="font-semibold">{count} แห่ง</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

export default function DataCenterMapView({ tenant, allowStatusFilter = false }) {
  const [allRows, setAllRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeGroups, setActiveGroups] = useState(null) // null = เปิดไว้ทั้งหมดตั้งแต่แรก (หัวข้อหลัก เช่น คำร้อง/โครงการ)
  // หัวข้อรอง (ประเภทย่อยในการ์ด) เริ่มต้นปิดไว้ก่อน (Set ว่าง) ต้องกดเปิดเองทีละประเภท
  const [activeCategories, setActiveCategories] = useState(() => new Set())
  const [activeTab, setActiveTab] = useState('dce') // 'dce' | 'complaints' | 'projects'
  // แผงสรุปแบบ bottom sheet บนมือถือ — เริ่มกางไว้ก่อน กดย่อ/ปิดได้ (ไม่มีผลกับ PC ที่ใช้แถบขวาแทน)
  const [sheetExpanded, setSheetExpanded] = useState(true)
  // ฝั่งประชาชนไม่มีปุ่มเลือก บังคับ 'completed' เสมอ — ฝั่งเจ้าหน้าที่เลือกเปลี่ยนได้ผ่าน allowStatusFilter
  const [statusFilter, setStatusFilter] = useState('completed')
  const effectiveStatusFilter = allowStatusFilter ? statusFilter : 'completed'
  // ปุ่มลอยเปิด/ปิดเส้นทาง (ถนน) ทั้งหมดพร้อมกัน — ไม่ต้องไปติ๊กทีละประเภทในแถบขวา
  const [showRoutes, setShowRoutes] = useState(true)
  const [tileMode, setTileMode] = useState('google_street')

  useEffect(() => {
    if (!tenant?.id) return
    setLoading(true)
    // RPC เดียวกันทั้งฝั่งเจ้าหน้าที่และประชาชน — รวมพิกัดจากทั้งศูนย์ข้อมูลดิจิทัลเอง และฟีเจอร์เดิม
    // (คำร้อง/สถานประกอบการ/โครงสร้างพื้นฐาน/โครงการก่อสร้าง) — กรองสถานะทำที่ฝั่ง client แทน เพื่อสลับได้ทันทีไม่ต้อง fetch ใหม่
    supabase.rpc('data_center_unified_pins', { _municipality_id: tenant.id })
      .then(({ data, error }) => {
        if (error) { console.error('data_center_unified_pins:', error.message); setAllRows([]); setLoading(false); return }
        setAllRows((data ?? []).filter(p => p.latitude != null && p.longitude != null))
        setLoading(false)
      })
  }, [tenant?.id])

  const entries = allRows.filter(e => matchesStatusFilter(e, effectiveStatusFilter))
  const groups = Array.from(new Set(entries.map(e => e.group_name))).sort((a, b) => a.localeCompare(b, 'th'))
  // เส้นทาง (ถนน) คุมด้วยปุ่ม showRoutes เดี่ยวๆ เลย ไม่ผ่านระบบกรุ๊ป/ประเภทย่อยแบบจุดทั่วไป
  // เพราะอยากให้กดปุ่มเดียวเห็นถนนทันที ไม่ต้องไปกดติ๊กประเภทในแถบขวาเพิ่มอีกที
  const visible = entries.filter(e => {
    if (e.route_points?.length >= 2) return showRoutes
    return (activeGroups === null || activeGroups.has(e.group_name)) && activeCategories.has(categoryKey(e))
  })
  // ประเภทย่อยไหนที่เป็นเส้นทางล้วน (ถนนสายหลัก/สายรอง) ใช้บอก SummaryPanel ว่าแถวนี้ต้องผูกกับ
  // showRoutes แทน activeCategories ปกติ — กันปุ่มในแถบขวาโชว์ toggle หลอกๆ ที่ไม่มีผลกับแผนที่จริง
  const routeCategoryKeys = new Set(entries.filter(e => e.route_points?.length >= 2).map(categoryKey))
  const fallbackCenter = tenant?.latitude && tenant?.longitude ? [tenant.latitude, tenant.longitude] : [13.7563, 100.5018]

  // แถบขวา: แยก 3 แท็บตามแหล่งข้อมูล — ศูนย์ข้อมูลดิจิทัล (กรอกเอง) / คำร้อง / โครงการ แยกกันคนละแถบ
  const dceEntries = entries.filter(e => e.source_table === 'data_center_entries')
  const complaintEntries = entries.filter(e => e.source_table === 'complaints')
  const projectEntries = entries.filter(e => e.source_table === 'civil_projects')
  const dceSummary = buildGroupSummary(dceEntries)
  const complaintSummary = buildGroupSummary(complaintEntries)
  const projectSummary = buildGroupSummary(projectEntries)
  // ฝั่งประชาชน (allowStatusFilter=false) ไม่มีแท็บคำร้อง/โครงการให้กด ล็อกไว้ที่ dce เสมอไม่ว่า activeTab จะเป็นอะไร
  const effectiveTab = allowStatusFilter ? activeTab : 'dce'
  const activeSummary = effectiveTab === 'dce' ? dceSummary : effectiveTab === 'complaints' ? complaintSummary : projectSummary

  function toggleGroup(g) {
    setActiveGroups(prev => {
      const base = prev ?? new Set(groups)
      const next = new Set(base)
      next.has(g) ? next.delete(g) : next.add(g)
      return next
    })
  }

  function toggleCategory(key) {
    setActiveCategories(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const currentTile = TILE_MODES[tileMode] || TILE_MODES.google_street

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* ตัวกรองสถานะ — เฉพาะฝั่งเจ้าหน้าที่ (allowStatusFilter) เท่านั้น มีผลแค่รายการคำร้อง/โครงการ */}
      {allowStatusFilter && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-2.5 bg-white border-b border-gray-100 shrink-0">
          <span className="text-[11px] font-bold text-gray-400 pr-1">สถานะคำร้อง/โครงการ</span>
          {STATUS_FILTER_OPTIONS.map(opt => {
            const on = statusFilter === opt.value
            return (
              <button key={opt.value} onClick={() => setStatusFilter(opt.value)}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all"
                style={on ? { backgroundColor: '#1e88c7', borderColor: '#1e88c7', color: '#fff' } : { backgroundColor: '#f9fafb', borderColor: '#e5e7eb', color: '#6b7280' }}>
                {opt.label}
              </button>
            )
          })}
        </div>
      )}

      {/* PC: แผนที่ฝั่งซ้าย + แถบข้อมูลฝั่งขวา (ตาม layout เทศบาลนครนนทบุรี) / มือถือ: แผนที่เต็มจอ + แผงสรุปลอยด้านล่าง */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
        <div className="flex-1 min-w-0 min-h-0 relative">
          {loading ? (
            <div className="w-full h-full flex items-center justify-center py-20">
              <Loader2 size={28} className="animate-spin text-gray-300" />
            </div>
          ) : (
            <MapContainer center={fallbackCenter} zoom={13} style={{ width: '100%', height: '100%', minHeight: '70vh' }} scrollWheelZoom>
              <TileLayer
                key={tileMode}
                attribution={currentTile.attribution}
                url={currentTile.url}
                subdomains={currentTile.subdomains || ['0', '1', '2', '3']}
              />
              <MunicipalityBoundary slug={tenant?.slug} />
              <FitBoundsOnLoad points={visible} fallback={fallbackCenter} />
              {/* ปุ่มลอยมุมขวาบน: สลับชั้นแผนที่ Google / Hybrid / Longdo / OSM */}
              <div className="absolute z-1000 top-2.5 right-2.5 flex flex-col gap-2">
                <button type="button"
                  title={`สลับชั้นแผนที่ (ปัจจุบัน: ${currentTile.label})`}
                  onClick={() => setTileMode(m => {
                    if (m === 'google_street') return 'google_hybrid'
                    if (m === 'google_hybrid') return LONGDO_KEY ? 'longdo' : 'osm'
                    if (m === 'longdo') return 'osm'
                    return 'google_street'
                  })}
                  className="px-3 py-1.5 rounded-full shadow-md border flex items-center gap-1.5 bg-white text-xs font-bold text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <Layers size={14} className="text-blue-600" />
                  <span>{currentTile.label}</span>
                </button>
                {entries.some(e => e.route_points?.length >= 2) && (
                  <button type="button" title={showRoutes ? 'ซ่อนเส้นทางถนนทั้งหมด' : 'แสดงเส้นทางถนนทั้งหมด'}
                    onClick={() => setShowRoutes(v => !v)}
                    className="w-9 h-9 rounded-full shadow-md border flex items-center justify-center transition-colors"
                    style={showRoutes
                      ? { backgroundColor: '#1e88c7', borderColor: '#1e88c7', color: '#fff' }
                      : { backgroundColor: '#fff', borderColor: '#e5e7eb', color: '#9ca3af' }}>
                    <Route size={16} />
                  </button>
                )}
              </div>
              {visible.map(e => {
                const meta = groupMeta(e.group_name)
                const isRoute = e.route_points?.length >= 2
                const popupContent = (
                  <Popup>
                    <div className="text-xs">
                      <p className="font-bold text-gray-800">{e.title || categoryLabel(e) || e.group_name}</p>
                      {/* ฝั่งประชาชนเห็นแค่ชื่อ — กลุ่ม/ประเภท/รายละเอียด/พิกัดเป็นข้อมูลสำหรับเจ้าหน้าที่เท่านั้น */}
                      {allowStatusFilter && (
                        <>
                          <p className="text-gray-500 mt-0.5">{e.group_name}{e.category ? ` · ${categoryLabel(e)}` : ''}</p>
                          {e.description && <p className="text-gray-400 mt-1">{e.description}</p>}
                          <p className="text-gray-400 mt-1 font-mono">{e.latitude.toFixed(6)}, {e.longitude.toFixed(6)}</p>
                        </>
                      )}
                      <a href={googleMapsUrl(e.latitude, e.longitude)} target="_blank" rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full"
                        style={{ backgroundColor: '#eef2f7', color: '#1e88c7' }}>
                        <MapPin size={12} /> แสดงบน Google Maps
                      </a>
                    </div>
                  </Popup>
                )
                return isRoute ? (
                  <Polyline key={`${e.source_table}-${e.source_id}`} positions={e.route_points.map(p => [p.lat, p.lng])}
                    pathOptions={{ color: e.route_color || meta.color, weight: e.category === 'ถนนสายหลัก' ? 5 : 2, opacity: 0.85 }}>
                    {popupContent}
                  </Polyline>
                ) : (
                  <Marker key={`${e.source_table}-${e.source_id}`} position={[e.latitude, e.longitude]} icon={makeDivIcon(markerEmoji(e), meta.pinColor ?? meta.color)}>
                    {popupContent}
                  </Marker>
                )
              })}
            </MapContainer>
          )}

          {/* มือถือ/แท็บเล็ต: แผงสรุปแบบ bottom sheet ลอยเหนือแผนที่ (ตาม layout เทศบาลนครนนทบุรี) — absolute
              ผูกกับกรอบแผนที่ ไม่ใช่ fixed กับจอ กันชนกับแถบเมนูล่างของแดชบอร์ดเจ้าหน้าที่ตอนฝังในหน้านั้น */}
          {/* z-1001: ต้องสูงกว่า z-index ของ control ในตัว Leaflet เอง (~1000) ไม่งั้นแผงจะโดนบังแบบเงียบๆ */}
          {groups.length > 0 && (
            <div className="lg:hidden absolute bottom-0 left-0 right-0 z-1001 bg-white rounded-t-2xl overflow-hidden flex flex-col"
              style={{ boxShadow: '0 -6px 24px rgba(0,0,0,0.18)', maxHeight: sheetExpanded ? '55%' : 'auto' }}>
              <button onClick={() => setSheetExpanded(v => !v)} aria-label={sheetExpanded ? 'ย่อแผงสรุป' : 'ขยายแผงสรุป'}
                className="w-full flex justify-center pt-2 pb-1 shrink-0">
                <span className="w-10 h-1 rounded-full bg-gray-300" />
              </button>
              <div className="flex items-center justify-between px-4 pb-2 shrink-0">
                <p className="text-sm font-bold text-gray-700 truncate">สรุปข้อมูล{tenant?.name ? ` ${tenant.name}` : ''}</p>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => setSheetExpanded(v => !v)} aria-label={sheetExpanded ? 'ย่อ' : 'ขยาย'}
                    className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
                    {sheetExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                  </button>
                  <button onClick={() => setSheetExpanded(false)} aria-label="ปิด" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
                    <X size={14} />
                  </button>
                </div>
              </div>
              {sheetExpanded && (
                <div className="overflow-y-auto min-h-0 border-t border-gray-100">
                  <SummaryPanel activeTab={effectiveTab} setActiveTab={setActiveTab} activeSummary={activeSummary}
                    activeGroups={activeGroups} toggleGroup={toggleGroup}
                    activeCategories={activeCategories} toggleCategory={toggleCategory} showSourceTabs={allowStatusFilter}
                    routeCategoryKeys={routeCategoryKeys} showRoutes={showRoutes} setShowRoutes={setShowRoutes} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* แถบขวา — เฉพาะจอ PC ขึ้นไป */}
        <aside className="hidden lg:flex lg:flex-col lg:w-[380px] shrink-0 border-l border-gray-200 bg-white overflow-y-auto">
          <SummaryPanel activeTab={effectiveTab} setActiveTab={setActiveTab} activeSummary={activeSummary}
            activeGroups={activeGroups} toggleGroup={toggleGroup}
            activeCategories={activeCategories} toggleCategory={toggleCategory} showSourceTabs={allowStatusFilter}
            routeCategoryKeys={routeCategoryKeys} showRoutes={showRoutes} setShowRoutes={setShowRoutes} />
        </aside>
      </div>
    </div>
  )
}
