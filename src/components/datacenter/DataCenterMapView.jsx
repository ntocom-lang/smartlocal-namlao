import { useEffect, useState, useMemo } from 'react'
import { Loader2, Database, MessageSquareWarning, Construction, Minimize2, Maximize2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import GoogleMapCanvas from '../common/GoogleMapCanvas'

function TrafficLightIcon({ size = 20, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="8" y="2.5" width="8" height="19" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="6" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18" r="1.5" fill="currentColor" stroke="none" />
      <path d="M5 4.5h3M5 12h3M5 19.5h3" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M16 4.5h3M16 12h3M16 19.5h3" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
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

// ตัวเลือกสถานะโครงการสำหรับปุ่ม "ปรับสถานะแบบเร็ว" ในป๊อปอัพ — อ้างอิงจาก STATUS_CFG เดิมใน
// CivilProjectAdmin.jsx (ต้องตรงกันทุกคำ ไม่งั้นสถานะที่ตั้งจากแผนที่จะอ่านค่าไม่ตรงกับหน้าโครงการหลัก)
const CIVIL_PROJECT_STATUS_OPTIONS = [
  { value: 'planned',     label: 'วางแผน' },
  { value: 'approved',    label: 'อนุมัติแล้ว' },
  { value: 'in_progress', label: 'กำลังดำเนินการ' },
  { value: 'completed',   label: 'แล้วเสร็จ' },
  { value: 'cancelled',   label: 'ยกเลิก' },
  { value: 'suspended',   label: 'ระงับชั่วคราว' },
]

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
          // กลุ่มที่เป็นเส้นทาง (ถนน) ล้วน ไม่ต้องขึ้นเป็นการ์ดในแถบสรุปเลย ทั้งฝั่งเจ้าหน้าที่และประชาชน
          // เพราะควบคุมด้วยปุ่มลอย 🛣️ บนแผนที่แล้วจุดเดียวพอ ไม่ต้องมีอีกจุดควบคุม/แสดงผลซ้ำกัน
          if (isRouteOnlyGroup) return null
          const on = activeGroups === null || activeGroups.has(group)
          const onGroupToggle = () => toggleGroup(group)
          const visibleCategories = categories.filter(c => !routeCategoryKeys.has(`${group}::${c.category}`))
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

export default function DataCenterMapView({ tenant, allowStatusFilter = false, currentUserRole }) {
  const [allRows, setAllRows] = useState([])
  // งานเขียนข้อมูลที่รวมมาจาก "แผนที่" เดิม (ยุบรวมเป็นแผนที่เดียวแล้ว) — อนุมัติ/ปฏิเสธคำขอธุรกิจ
  // (เฉพาะ admin/superadmin ตรงกับสิทธิ์เดิมของ MapDashboardAdmin) และปรับสถานะโครงการก่อสร้างแบบเร็ว
  const [approvingBizId, setApprovingBizId] = useState(null)
  const [savingProjectId, setSavingProjectId] = useState(null)
  const [quickStatusDraft, setQuickStatusDraft] = useState({}) // { [projectId]: draftStatus }
  const [selectedEntry, setSelectedEntry] = useState(null)
  const [boundaryGeoJson, setBoundaryGeoJson] = useState(null)
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

  useEffect(() => {
    if (!tenant?.id) return
    let active = true

    supabase.rpc('data_center_unified_pins', { _municipality_id: tenant.id })
      .then(({ data, error }) => {
        if (!active) return
        if (error) { console.error('data_center_unified_pins:', error.message); setAllRows([]); setLoading(false); return }
        const clean = (data ?? []).filter(p => p.latitude != null && p.longitude != null)
        setAllRows(clean)
        setLoading(false)
      })

    return () => { active = false }
  }, [tenant?.id])

  useEffect(() => {
    if (!tenant?.slug) return
    let active = true
    fetch(`/boundaries/${tenant.slug}.geojson`)
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (active) setBoundaryGeoJson(data) })
      .catch(() => { if (active) setBoundaryGeoJson(null) })
    return () => { active = false }
  }, [tenant?.slug])

  // อนุมัติ/ปฏิเสธคำขอลงทะเบียนธุรกิจแบบเร็วจากป๊อปอัพ (ย้ายมาจาก MapDashboardAdmin เดิม) — แค่ปรับสถานะ
  // ไม่ได้สร้างรายการ tourism_places ให้อัตโนมัติ (พฤติกรรมเดิมของปุ่มด่วนนี้เป็นแบบนี้อยู่แล้ว) ถ้าต้องการ
  // แก้รายละเอียด/รูปก่อนเผยแพร่ ต้องไปที่หน้า "เที่ยว กิน พัก OTOP" > "คำขอลงทะเบียน" เหมือนเดิม
  async function approveBiz(id, approved) {
    setApprovingBizId(id)
    const { data: { session } } = await supabase.auth.getSession()
    const { error } = await supabase.from('business_registrations').update({
      status: approved ? 'approved' : 'rejected',
      approved_by: session?.user?.id,
      approved_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) { alert('บันทึกไม่สำเร็จ: ' + error.message); setApprovingBizId(null); return }
    setAllRows(prev => prev.map(e => (e.source_table === 'business_registrations' && e.source_id === id)
      ? { ...e, status: approved ? 'approved' : 'rejected' } : e))
    setApprovingBizId(null)
  }

  async function saveQuickStatus(id, newStatus) {
    setSavingProjectId(id)
    const { error } = await supabase.from('civil_projects').update({ status: newStatus }).eq('id', id)
    if (error) { alert('บันทึกไม่สำเร็จ: ' + error.message); setSavingProjectId(null); return }
    setAllRows(prev => prev.map(e => (e.source_table === 'civil_projects' && e.source_id === id)
      ? { ...e, status: newStatus } : e))
    setQuickStatusDraft(prev => { const next = { ...prev }; delete next[id]; return next })
    setSavingProjectId(null)
  }

  const boundaryBbox = useMemo(() => {
    const coords = boundaryGeoJson?.features?.[0]?.geometry?.coordinates?.[0]
    if (!Array.isArray(coords) || coords.length < 3) return null
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
    coords.forEach(pt => {
      const lng = Number(pt[0]), lat = Number(pt[1])
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
    })
    return { minLat: minLat - 0.015, maxLat: maxLat + 0.015, minLng: minLng - 0.015, maxLng: maxLng + 0.015 }
  }, [boundaryGeoJson])

  const entries = allRows.filter(e => matchesStatusFilter(e, effectiveStatusFilter))
  const groups = Array.from(new Set(entries.map(e => e.group_name))).sort((a, b) => a.localeCompare(b, 'th'))
  const visible = entries.filter(e => {
    if (e.route_points?.length >= 2) {
      if (!showRoutes) return false
      if (boundaryBbox) {
        const hasPointInBounds = e.route_points.some(pt =>
          pt.lat >= boundaryBbox.minLat && pt.lat <= boundaryBbox.maxLat &&
          pt.lng >= boundaryBbox.minLng && pt.lng <= boundaryBbox.maxLng
        )
        if (!hasPointInBounds) return false
      }
      return true
    }
    return (activeGroups === null || activeGroups.has(e.group_name)) && activeCategories.has(categoryKey(e))
  })
  // ประเภทย่อยไหนที่เป็นเส้นทางล้วน (ถนนสายหลัก/สายรอง) ใช้บอก SummaryPanel ว่าแถวนี้ต้องผูกกับ
  // showRoutes แทน activeCategories ปกติ — กันปุ่มในแถบขวาโชว์ toggle หลอกๆ ที่ไม่มีผลกับแผนที่จริง
  const routeCategoryKeys = new Set(entries.filter(e => e.route_points?.length >= 2).map(categoryKey))
  const fallbackCenter = tenant?.latitude && tenant?.longitude ? { lat: Number(tenant.latitude), lng: Number(tenant.longitude) } : { lat: 13.7563, lng: 100.5018 }

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
            <GoogleMapCanvas
              center={fallbackCenter}
              zoom={13}
              mapTypeId="roadmap"
              boundaryGeoJson={boundaryGeoJson}
              className="w-full h-full min-h-[70vh]"
              markers={visible.filter(e => !(e.route_points?.length >= 2)).map(e => {
                const meta = groupMeta(e.group_name)
                return {
                  id: `${e.source_table}-${e.source_id}`,
                  position: { lat: Number(e.latitude), lng: Number(e.longitude) },
                  title: e.title || categoryLabel(e) || e.group_name,
                  color: meta.pinColor ?? meta.color,
                  label: markerEmoji(e),
                  entry: e,
                }
              })}
              polylines={visible.filter(e => e.route_points?.length >= 2).map(e => ({
                id: `${e.source_table}-${e.source_id}`,
                path: e.route_points,
                color: e.route_color || groupMeta(e.group_name).color,
                weight: e.category === 'ถนนสายหลัก' ? 5 : 3,
                opacity: 0.88,
                entry: e,
              }))}
              onFeatureClick={feature => setSelectedEntry(feature.entry)}
            />
          )}

          {entries.some(e => e.route_points?.length >= 2) && (
            <button type="button" title={showRoutes ? 'ซ่อนเส้นทางถนน' : 'แสดงเส้นทางถนน'}
              onClick={() => setShowRoutes(v => !v)}
              className="absolute right-3 top-14 z-20 w-10 h-10 rounded-full shadow-md border flex items-center justify-center transition-all active:scale-95"
              style={showRoutes
                ? { backgroundColor: '#1e88c7', borderColor: '#1e88c7', color: '#ffffff' }
                : { backgroundColor: '#ffffff', borderColor: '#e5e7eb', color: '#1e88c7' }}>
              <TrafficLightIcon size={20} />
            </button>
          )}

          {selectedEntry && (selectedEntry.source_table === 'business_registrations' || selectedEntry.source_table === 'civil_projects') && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 w-[min(340px,calc(100%-32px))] rounded-2xl border border-gray-200 bg-white p-3 text-xs shadow-2xl backdrop-blur-xs">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <p className="font-bold text-gray-800 truncate">{selectedEntry.title || categoryLabel(selectedEntry) || selectedEntry.group_name}</p>
                <button type="button" onClick={() => setSelectedEntry(null)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"><X size={14} /></button>
              </div>
              {selectedEntry.source_table === 'business_registrations' && selectedEntry.status === 'pending'
                && ['admin', 'superadmin'].includes(currentUserRole) && (
                <div className="flex gap-1.5">
                  <button type="button" disabled={approvingBizId === selectedEntry.source_id} onClick={() => approveBiz(selectedEntry.source_id, true)}
                    className="flex-1 rounded-xl bg-green-600 py-1.5 font-bold text-white shadow-xs active:scale-95 disabled:opacity-50">{approvingBizId === selectedEntry.source_id ? 'กำลังบันทึก...' : 'อนุมัติ'}</button>
                  <button type="button" disabled={approvingBizId === selectedEntry.source_id} onClick={() => approveBiz(selectedEntry.source_id, false)}
                    className="flex-1 rounded-xl bg-red-600 py-1.5 font-bold text-white shadow-xs active:scale-95 disabled:opacity-50">ปฏิเสธ</button>
                </div>
              )}
              {selectedEntry.source_table === 'civil_projects' && currentUserRole && currentUserRole !== 'citizen' && (
                <div className="flex items-center gap-1.5">
                  <select value={quickStatusDraft[selectedEntry.source_id] ?? selectedEntry.status} disabled={savingProjectId === selectedEntry.source_id}
                    onChange={event => setQuickStatusDraft(prev => ({ ...prev, [selectedEntry.source_id]: event.target.value }))}
                    className="flex-1 rounded-xl border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 outline-none">
                    {CIVIL_PROJECT_STATUS_OPTIONS.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}
                  </select>
                  <button type="button" disabled={savingProjectId === selectedEntry.source_id || (quickStatusDraft[selectedEntry.source_id] ?? selectedEntry.status) === selectedEntry.status}
                    onClick={() => saveQuickStatus(selectedEntry.source_id, quickStatusDraft[selectedEntry.source_id] ?? selectedEntry.status)}
                    className="rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs disabled:opacity-40">บันทึก</button>
                </div>
              )}
            </div>
          )}

          {/* มือถือ/แท็บเล็ต: แผงสรุปแบบ bottom sheet ลอยเหนือแผนที่ (ตาม layout เทศบาลนครนนทบุรี) — absolute
              ผูกกับกรอบแผนที่ ไม่ใช่ fixed กับจอ กันชนกับแถบเมนูล่างของแดชบอร์ดเจ้าหน้าที่ตอนฝังในหน้านั้น */}
          {/* วาง bottom sheet เหนือ Google Maps และ controls เพื่อให้แตะใช้งานได้เสมอ */}
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
