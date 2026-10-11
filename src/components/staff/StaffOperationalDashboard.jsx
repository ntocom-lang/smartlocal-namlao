import {
  ChevronRight, Plus, LayoutGrid, HeartHandshake, Megaphone, Layers, BookOpen,
  Building2, Banknote, Hammer, GraduationCap, ShieldCheck,
} from 'lucide-react'
import { activeOrgTerms } from '../../lib/orgTerms'
import { PATIENT_TRANSPORT_MODULE_KEY } from '../../lib/patientTransport'
import { MenuGroup } from '../common/MenuTileGrid'

// ไอคอนหัวกลุ่มของหน้าเมนูแบบไอคอน — ผูกตามชื่อกลุ่มใน STANDALONE_GROUPS/MODULE_GROUPS (StaffDashboard.jsx)
// ถ้าเปลี่ยนชื่อกลุ่มแล้วลืมมาแก้ที่นี่ แค่ได้ไอคอนกลางๆ (LayoutGrid) ไม่มีอะไรพัง
const GROUP_ICONS = {
  'งานบริการประชาชน': HeartHandshake,
  'ประชาสัมพันธ์และท่องเที่ยว': Megaphone,
  'แผนงานและทรัพยากรกลาง': Layers,
  'คู่มือ': BookOpen,
  'สำนักปลัด': Building2,
  'กองคลัง': Banknote,
  'กองช่าง': Hammer,
  'กองการศึกษา': GraduationCap,
  'ตรวจสอบภายใน': ShieldCheck,
}

// ตัวเลขบนการ์ด/ไอคอนต้องเป็นตัวเดียวกับ badge ใน sidebar (คำนวณที่ StaffDashboard จุดเดียว) —
// คำร้อง = ใบที่ยังไม่มีใครกดเริ่มดำเนินการ ห้ามนับซ้ำในไฟล์นี้ ไม่งั้นสองจุดจะเลขไม่ตรงกัน
function menuBadges({ pendingCount, newComplaintCount = 0, patientWorkCount = 0 }) {
  return { inbox: pendingCount, complaints: newComplaintCount, [PATIENT_TRANSPORT_MODULE_KEY]: patientWorkCount }
}

// newTab = ไฟล์ static นอก router (เช่น /manual-staff.html) ต้องเปิดแท็บใหม่
// ถ้าไม่ดักตรงนี้จะตกไป setActiveModule('manual-staff') ซึ่งไม่มี branch ไหน render = จอเปล่า
function openModuleItem(item, { navigate, setActiveModule }) {
  if (item.newTab) window.open(item.newTab, '_blank', 'noopener,noreferrer')
  else if (item.externalUrl) navigate(item.externalUrl)
  else setActiveModule(item.key)
}

// หน้า "เมนูทั้งหมด" ของเจ้าหน้าที่บนมือถือ (แท็บ "เมนู" ในแถบล่าง) — กริดไอคอนจัดกลุ่มตามโมดูลที่
// เห็นได้จริง visibleGroups ผ่านตัวกรองสิทธิ์/โมดูลที่เปิดมาจาก StaffDashboard แล้ว (กลุ่มว่างถูกตัดออกแล้ว)
export function StaffMenuGrid({ visibleGroups, setActiveModule, navigate, pendingCount, newComplaintCount, patientWorkCount }) {
  const badges = menuBadges({ pendingCount, newComplaintCount, patientWorkCount })
  const total = visibleGroups.reduce((sum, group) => sum + group.items.length, 0)
  return (
    <div className="space-y-3">
      <header className="min-w-0">
        <h1 className="text-lg font-black text-slate-900">เมนูทั้งหมด</h1>
        <p className="text-[11px] text-slate-500">{total} เมนู · แสดงตามโมดูลและสิทธิ์ของบัญชีนี้</p>
      </header>
      {visibleGroups.map(({ group, items }) => (
        <MenuGroup key={group} title={group} Icon={GROUP_ICONS[group] ?? LayoutGrid} color={items[0]?.color}
          items={items.map(item => ({
            key: item.key, label: item.label, Icon: item.Icon, color: item.color, badge: badges[item.key],
            onClick: () => openModuleItem(item, { navigate, setActiveModule }),
          }))} />
      ))}
    </div>
  )
}

const ROLE_LABELS = {
  superadmin: 'Super Admin', admin: 'แอดมินระบบ', officer: 'หัวหน้ากอง',
  technician: 'ผู้ปฏิบัติงาน', staff: 'เจ้าหน้าที่', viewer: 'ผู้บริหาร',
  // getter เพราะคำเรียกสภาเปลี่ยนตาม org_type และค่านี้ยังไม่พร้อมตอน import — ดู src/lib/orgTerms.js
  get council() { return activeOrgTerms().councilOrg },
}

// หน้านี้เป็น "แผงเมนู" ล้วนๆ ไม่ดึงข้อมูลเอง
//
// ส่วนสรุปตัวเลข (KPI 4 ช่อง) กับรายการ "งานรอรับเรื่อง" ถูกถอดออก 2026-09-02 ตามที่ผู้ใช้สั่ง
// พร้อมกับ query ทั้งหมดที่เลี้ยงมันไว้ (document_requests/complaints นับค้าง + ค้างเกิน 7 วันทำการ)
// — ถ้าจะเอากลับ ให้ดูคอมมิตก่อนหน้า อย่าเขียนใหม่จากศูนย์เพราะของเดิมมีกับดักที่แก้ไปแล้ว 2 จุด:
//   1) เส้นแบ่ง "ค้างเกิน 7 วันทำการ" ต้องแปลงเป็น ISO ตามเวลาเครื่องก่อนส่ง PostgREST
//      (ส่ง 'YYYY-MM-DD' ดิบจะโดนตีความเป็น UTC เพี้ยน 7 ชม.)
//   2) Promise.all ต้องมี .catch ไม่งั้น query ที่ชน timeout 25 วิ ทำแดชบอร์ดค้างสปินเนอร์ถาวร
export default function StaffOperationalDashboard({
  visibleGroups, setActiveModule, profile, pendingCount, newComplaintCount = 0, patientWorkCount = 0, navigate, onCreateManagementEvent,
}) {
  const cardBadges = menuBadges({ pendingCount, newComplaintCount, patientWorkCount })
  const todayTH = new Date().toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  const taskCopy = {
    events: { label: 'เพิ่มกิจกรรมในปฏิทิน', description: 'ส่งกำหนดการให้ผู้บริหารทราบ' },
    report: { label: 'รายงานการทำงาน', description: 'ดูและจัดทำรายงานสรุป' },
    'data-center': { label: 'ศูนย์รวมข้อมูลดิจิทัล', description: 'ดูภาพรวมและสถิติข้อมูลของหน่วยงาน' },
  }
  const visibleItems = visibleGroups.flatMap(group => group.items)
  const taskActions = ['events', 'report', 'data-center']
    .map(key => visibleItems.find(item => item.key === key))
    .filter(Boolean)

  function openTask(item) {
    if (item.key === 'events' && onCreateManagementEvent) onCreateManagementEvent()
    else openModuleItem(item, { navigate, setActiveModule })
  }
  const totalMenus = visibleItems.length
  const totalBadge = Object.values(cardBadges).reduce((sum, n) => sum + (Number(n) > 0 ? Number(n) : 0), 0)

  return (
    <div className="space-y-2">
      <header className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-lg font-black text-slate-900">แดชบอร์ดสำหรับเจ้าหน้าที่</h1>
          {profile?.role && <span className="hidden text-[10px] font-bold text-slate-400 sm:inline">{ROLE_LABELS[profile.role] ?? profile.role}</span>}
        </div>
        <p className="truncate text-[11px] text-slate-400">{todayTH}</p>
      </header>

      <section>
        <div className="mb-1.5 md:mb-2">
          <h2 className="text-sm font-bold text-slate-800">เมนูใช้งานด่วน</h2>
          <p className="text-[10px] text-slate-400">เข้าถึงปฏิทิน รายงาน และแผนที่ได้รวดเร็ว</p>
        </div>
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
          {taskActions.map(item => {
            const { key, Icon, color, bg } = item
            const copy = taskCopy[key]
            const isManagementEvent = key === 'events'
            const itemLabel = copy?.label || item?.label || 'เมนูใช้งาน'
            const itemDesc = copy?.description || item?.description || ''
            return (
              <button key={key} type="button"
                onClick={() => openTask(item)}
                className={`flex min-h-14 items-center gap-2 rounded-xl border bg-white px-2.5 py-2 text-left shadow-sm transition-colors active:scale-[0.99] ${isManagementEvent ? 'col-span-2 border-violet-200 hover:bg-violet-50/60 sm:col-span-1' : 'border-slate-200 hover:bg-slate-50'}`}>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: bg ?? `${color}18` }}>
                  {isManagementEvent ? <Plus size={19} style={{ color }} /> : <Icon size={18} style={{ color }} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-xs font-black text-slate-800">{itemLabel}</p>
                    {isManagementEvent && <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold text-violet-700">แจ้งกำหนดการต่างๆ</span>}
                  </div>
                  {itemDesc && <p className="mt-0.5 hidden truncate text-[10px] text-slate-400 sm:block">{itemDesc}</p>}
                </div>
                <ChevronRight size={15} className="shrink-0 text-slate-300" />
              </button>
            )
          })}
        </div>
      </section>

      {/* มือถือ (< md): เมนูทั้งหมดอยู่ในแท็บ "เมนู" ของแถบล่าง (กริดไอคอน) หน้าแดชบอร์ดเหลือทางลัดด่วน
          กับปุ่มนี้ ไม่วางกริดซ้ำสองที่ — PC ยังใช้แผงการ์ดด้านล่างเหมือนเดิม เพราะมีเมนูซ้ายอยู่แล้ว */}
      <button type="button" onClick={() => setActiveModule('menu')}
        className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm active:scale-[0.99] md:hidden">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><LayoutGrid size={19} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-slate-800">เมนูทั้งหมด</span>
          <span className="block text-[11px] text-slate-500">{totalMenus} เมนูตามสิทธิ์ของบัญชีนี้</span>
        </span>
        {totalBadge > 0 && <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{totalBadge > 99 ? '99+' : totalBadge}</span>}
        <ChevronRight size={16} className="shrink-0 text-slate-300" />
      </button>

      <section className="hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-sm md:block">
        <div className="mb-3">
          <h2 className="text-sm font-bold text-slate-800">เครื่องมือที่ใช้งานได้</h2>
          <p className="text-[10px] text-slate-400">แสดงตามโมดูลและสิทธิ์ของบัญชีนี้</p>
        </div>
        <div className="space-y-2.5">
          {visibleGroups.map(({ group, items }) => (
            <div key={group}>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{group}</p>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-4">
                {items.map((item) => {
                  const { key, label, Icon, color, bg } = item
                  return (
                  <button key={key} type="button"
                    onClick={() => openModuleItem(item, { navigate, setActiveModule })}
                    className="flex min-h-14 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50 active:scale-[0.99]">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: bg ?? `${color}18` }}><Icon size={18} style={{ color }} /></div>
                    <p className="min-w-0 flex-1 text-xs font-bold leading-tight text-slate-700">{label}</p>
                    {cardBadges[key] > 0 && <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[9px] font-bold text-white">{cardBadges[key] > 99 ? '99+' : cardBadges[key]}</span>}
                  </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
