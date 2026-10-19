import {
  ChevronRight, Plus, LayoutGrid, HeartHandshake, Megaphone, Layers, BookOpen,
  Building2, Banknote, Hammer, GraduationCap, ShieldCheck, CheckCircle2, Loader2, TriangleAlert, Zap,
  CircleAlert, Clock, CalendarClock, Users,
} from 'lucide-react'
import { activeOrgTerms } from '../../lib/orgTerms'
import { PATIENT_TRANSPORT_MODULE_KEY } from '../../lib/patientTransport'
import { pickShortcuts, readUsage, safeLocalStorage } from '../../lib/staffHomeFrequent'
import { useHomeRpc } from '../../lib/staffHomeData'
import { bucketComplaintDue, groupMyEvents, normalizeWorkload, todoState } from '../../lib/staffHomeSummary'
import { todoCount as waterAnnouncementTodoCount } from '../../lib/waterAnnouncements'
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

// การ์ด "ต้องทำตอนนี้" — เฉพาะโมดูลที่มีตัวเลขงานค้างอยู่แล้วใน badge (ไม่มี query เพิ่ม ตัวเลขตรงกับเมนูซ้ายเสมอ)
// เรียงตามลำดับนี้ตายตัว ไม่เรียงตามยอด: ตำแหน่งที่คงที่ทำให้คนจำที่ได้ ยอดสลับกันไปมาทำให้ต้องอ่านใหม่ทุกครั้ง
const WORK_CARDS = [
  { key: 'inbox', hint: () => 'รอรับเรื่อง' },
  { key: 'complaints', hint: ({ isAdmin }) => (isAdmin ? 'รอรับเรื่อง' : 'มอบหมายให้คุณ · ยังไม่เริ่มดำเนินการ') },
  { key: PATIENT_TRANSPORT_MODULE_KEY, hint: () => 'รอดำเนินการ' },
]

// ทางลัดตั้งต้นเมื่อยังไม่มีประวัติการใช้งาน (คนใหม่/เครื่องใหม่) — คัดมาจากชุดเดิมของหน้านี้
const DEFAULT_SHORTCUTS = ['events', 'report', 'data-center']
const SHORTCUT_LIMIT = 4

function WorkRow({ item, count, hint, onOpen }) {
  const { Icon, color, bg, label } = item
  return (
    <button type="button" data-home-work={item.key} onClick={onOpen}
      className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm hover:bg-slate-50 active:scale-[0.99]">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: bg ?? `${color}18` }}>
        <Icon size={19} style={{ color }} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-slate-800">{label}</span>
        <span className="block text-[11px] text-slate-500">{hint}</span>
      </span>
      <span data-home-work-count className="text-2xl font-black tabular-nums text-slate-900">
        {count > 999 ? '999+' : count}
        <span className="sr-only"> รายการ</span>
      </span>
      <ChevronRight size={16} className="shrink-0 text-slate-300" aria-hidden="true" />
    </button>
  )
}

const TONES = {
  red: { box: 'border-red-200 bg-red-50 text-red-900', icon: 'text-red-600' },
  amber: { box: 'border-amber-200 bg-amber-50 text-amber-900', icon: 'text-amber-600' },
}

// แถวเตือนกำหนดเสร็จ — สีไม่ใช่สัญญาณเดียว (มีไอคอนต่างกัน + ข้อความกำกับ) คนตาบอดสี/พิมพ์ขาวดำยังแยกออก
function AttentionRow({ tone, Icon, count, text, hint, onOpen, testId }) {
  const t = TONES[tone]
  return (
    <button type="button" data-home-attention={testId} onClick={onOpen}
      className={`flex min-h-14 w-full items-center gap-3 rounded-2xl border px-3 py-2 text-left shadow-sm active:scale-[0.99] ${t.box}`}>
      <Icon size={22} className={`shrink-0 ${t.icon}`} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold">{text}</span>
        <span className="block text-[11px] opacity-80">{hint}</span>
      </span>
      <span className="text-2xl font-black tabular-nums">{count}<span className="sr-only"> ใบ</span></span>
      <ChevronRight size={16} className="shrink-0 opacity-50" aria-hidden="true" />
    </button>
  )
}

function EventRow({ event, onOpen }) {
  return (
    <button type="button" data-home-event={event.id} onClick={onOpen}
      className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50 active:scale-[0.99]">
      <span className="w-11 shrink-0 text-center text-xs font-bold tabular-nums text-emerald-700">
        {event.time ?? (event.ongoing ? 'ต่อเนื่อง' : 'ทั้งวัน')}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-800">{event.title}</span>
        <span className="block truncate text-[11px] text-slate-500">
          {[event.task, event.location].filter(Boolean).join(' · ') || 'อยู่ในรายการที่ได้รับมอบหมาย'}
        </span>
      </span>
      <ChevronRight size={15} className="shrink-0 text-slate-300" aria-hidden="true" />
    </button>
  )
}

// "กองของฉัน" — เฉพาะหัวหน้ากอง (role officer ที่สังกัดกอง) เจ้าของระบบเลือกให้เห็นภาระรายคน (2569-10-12)
// เป็นภาระที่ "ถืออยู่ตอนนี้" ไม่ใช่การประเมินผล: เรียงตามชื่อ (ไม่เรียงตามภาระ), ไม่มีแถบเทียบ/คะแนน/อันดับ,
// ไม่มีเลขคำร้องหรือชื่อประชาชน — การประเมินอยู่ที่เมนู "ผลการปฏิบัติงาน" ซึ่งมีถ้อยคำและสิทธิ์ของมันเอง
function DeptWorkload({ state, complaintsItem, onOpenComplaints }) {
  if (state.status === 'loading') {
    return (
      <div role="status" data-home-dept-loading className="flex min-h-12 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
        <Loader2 size={16} className="animate-spin" aria-hidden="true" /> กำลังโหลดภาระงานของกอง…
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div data-home-dept-error className="flex min-h-12 items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <TriangleAlert size={16} className="shrink-0" aria-hidden="true" /> โหลดภาระงานของกองไม่สำเร็จ — เปิดหน้านี้ใหม่อีกครั้ง
      </div>
    )
  }
  const w = normalizeWorkload(state.data)
  return (
    <div data-home-dept className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700"><Users size={16} aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-bold text-slate-800">กองของฉัน{w.departmentName ? ` · ${w.departmentName}` : ''}</h3>
          <p className="text-[10px] text-slate-400">คำร้องที่แต่ละคนถืออยู่ตอนนี้ — ไม่ใช่การประเมินผล</p>
        </div>
      </div>
      {w.unassigned > 0 && complaintsItem && (
        <button type="button" data-home-unassigned={w.unassigned} onClick={onOpenComplaints}
          className="mt-2 flex min-h-11 w-full items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs font-semibold text-amber-900 active:scale-[0.99]">
          <CircleAlert size={16} className="shrink-0 text-amber-600" aria-hidden="true" />
          <span className="min-w-0 flex-1">ยังไม่มอบหมายให้ใคร {w.unassigned} ใบ</span>
          <ChevronRight size={15} className="shrink-0 opacity-50" aria-hidden="true" />
        </button>
      )}
      {w.members.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">ยังไม่มีเจ้าหน้าที่สังกัดกองนี้ในระบบ</p>
      ) : (
        <div className="mt-2 text-xs" role="table" aria-label="ภาระงานคำร้องรายคนในกอง">
          <div role="row" className="grid grid-cols-[minmax(0,1fr)_3.25rem_3.25rem_3.25rem] items-end gap-1 border-b border-slate-100 pb-1 text-[10px] text-slate-400">
            <span role="columnheader">ชื่อ</span>
            <span role="columnheader" className="text-right">ถืออยู่</span>
            <span role="columnheader" className="text-right">ยังไม่เริ่ม</span>
            <span role="columnheader" className="text-right">เลยกำหนด</span>
          </div>
          {w.members.map(m => (
            <div key={m.id} role="row" data-home-member={m.id}
              className="grid min-h-9 grid-cols-[minmax(0,1fr)_3.25rem_3.25rem_3.25rem] items-center gap-1 border-b border-slate-50 py-1 last:border-0">
              <span role="cell" className="truncate font-medium text-slate-700">{m.name ?? '(ไม่ระบุชื่อ)'}</span>
              <span role="cell" className="text-right tabular-nums text-slate-800">{m.open}</span>
              <span role="cell" className="text-right tabular-nums text-slate-800">{m.unstarted}</span>
              <span role="cell" className={`text-right tabular-nums ${m.overdue > 0 ? 'font-bold text-red-600' : 'text-slate-400'}`}>
                {m.overdue}
                {m.overdue > 0 && <span className="sr-only"> ใบเลยกำหนด</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// หน้านี้ดึงข้อมูลน้อยที่สุด: ตัวเลขงานรอรับเรื่อง 3 ตัวมาจาก badge ที่ StaffDashboard คำนวณอยู่แล้ว (ไม่มี query เพิ่ม)
// ที่เพิ่มคือ RPC เบา 1–2 ตัวตอนเปิดหน้า (staffHomeData.js — ไม่ poll มีแคช 30 วิ):
//   staff_home_summary  → กำหนดเสร็จของคำร้องที่ฉันถือ + กิจกรรมที่มอบหมายให้ฉัน (ทุกบทบาทที่เป็นบุคลากร)
//   staff_dept_workload → ภาระรายคนของกอง (เฉพาะหัวหน้ากอง)
//
// KPI 4 ช่อง + "งานรอรับเรื่อง" เดิมถูกถอดออก 2026-09-02 ตามที่ผู้ใช้สั่ง พร้อม query ที่เลี้ยงมัน — รุ่นนี้ไม่ได้เอาของเดิมกลับมา
// (ไม่มีกราฟ/ตัวเลขสถิติรวม) ถ้าจะเอากลับให้ดูคอมมิตก่อนหน้า อย่าเขียนใหม่จากศูนย์ เพราะของเดิมมีกับดักที่แก้ไปแล้ว 2 จุด:
//   1) เส้นแบ่ง "ค้างเกิน 7 วันทำการ" ต้องแปลงเป็น ISO ตามเวลาเครื่องก่อนส่ง PostgREST
//      (ส่ง 'YYYY-MM-DD' ดิบจะโดนตีความเป็น UTC เพี้ยน 7 ชม.) — รุ่นนี้เลี่ยงโดยให้ฐานข้อมูลบอก "วันนี้" ตามเวลาไทยมาเอง
//   2) Promise.all ต้องมี .catch ไม่งั้น query ที่ชน timeout 25 วิ ทำแดชบอร์ดค้างสปินเนอร์ถาวร
//
// workStatus: { [moduleKey]: 'loading' | 'ok' | 'error' } — บอกว่าเลข 0 เป็นศูนย์จริงหรือแค่ยังไม่รู้
// ⚠️ ห้ามโชว์ "ไม่มีงานค้าง" จากเลข 0 อย่างเดียว: ตอนโหลด/query พัง ค่าเริ่มต้นคือ 0 ซึ่งแปลว่า "ไม่รู้"
//    ไม่ใช่ "ไม่มี" (บทเรียนเดียวกับ badge ใน StaffDashboard — ไฟเขียวปลอมอันตรายกว่าไม่มีไฟ)
//    ตัดสินรวมที่ todoState() ใน src/lib/staffHomeSummary.js จุดเดียว
export default function StaffOperationalDashboard({
  visibleGroups, setActiveModule, profile, tenantId, pendingCount, newComplaintCount = 0, patientWorkCount = 0,
  workStatus = {}, navigate, onCreateManagementEvent,
}) {
  const cardBadges = menuBadges({ pendingCount, newComplaintCount, patientWorkCount })
  const todayTH = new Date().toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const isAdmin = ['admin', 'superadmin'].includes(profile?.role)
  const visibleItems = visibleGroups.flatMap(group => group.items)
  const itemByKey = new Map(visibleItems.map(item => [item.key, item]))

  const open = item => openModuleItem(item, { navigate, setActiveModule })

  // ── ต้องทำตอนนี้ ──
  const workCards = WORK_CARDS
    .map(card => ({ ...card, item: itemByKey.get(card.key), status: workStatus[card.key] ?? 'ok', count: Number(cardBadges[card.key]) || 0 }))
    .filter(card => card.item)
  const pendingCards = workCards.filter(card => card.status === 'ok' && card.count > 0)
  const failedCards = workCards.filter(card => card.status === 'error')

  // สรุปกำหนดเสร็จ + กิจกรรมที่มอบหมาย — ดึงเฉพาะเมื่อบัญชีนี้เห็นโมดูลที่เกี่ยวข้องจริง (ปิดโมดูล = ไม่ยิง RPC)
  const complaintsItem = itemByKey.get('complaints')
  const eventsItem = itemByKey.get('events')
  const profileId = profile?.id
  const summary = useHomeRpc({ rpc: 'staff_home_summary', tenantId, profileId, enabled: Boolean(complaintsItem || eventsItem) })
  const summaryOk = summary.status === 'ok'
  const due = bucketComplaintDue(complaintsItem && summaryOk ? summary.data?.complaint_due : [], summary.data?.today)
  const myEvents = groupMyEvents(eventsItem && summaryOk ? summary.data?.my_events : [], summary.data?.today)
  const eventCount = myEvents.today.length + myEvents.tomorrow.length

  // ร่างประกาศน้ำ-ฝนที่รอ "ฉัน" ยืนยัน (เฟส 2 · PR 2.2) — ร่างหมดความหมายใน 3 ชม. ถ้าผู้มีสิทธิ์ไม่เห็นก็ไม่มีประกาศ จึงขึ้นตรงนี้
  // ดึงเฉพาะเมื่อบัญชีนี้เห็นเมนู "เหตุการณ์น้ำ-ฝน" (อปท. เปิดโมดูล) · ไม่ใช่ผู้ยืนยัน/ไม่มีร่าง/ยังไม่เปิดประกาศ = ไม่มีแถวนี้และไม่กระทบงานอื่น
  // โหลดพลาด = ไม่ขึ้นแถวนี้ (ไม่บล็อกไฟเขียว "ไม่มีงานค้าง" ของงานอื่น) — ผู้ยืนยันยังเปิดดูร่างได้จากเมนูโดยตรง
  const waterItem = itemByKey.get('water-events')
  const waterTodo = useHomeRpc({ rpc: 'water_announcement_todo', tenantId, profileId, enabled: Boolean(waterItem) })
  const waterPending = waterTodo.status === 'ok' && waterAnnouncementTodoCount(waterTodo.data) > 0

  // ภาระงานของกอง — เฉพาะหัวหน้ากอง (RPC ปฏิเสธบทบาทอื่นอยู่แล้ว ที่นี่แค่ไม่ยิงโดยไม่จำเป็น)
  const isDeptHead = profile?.role === 'officer' && Boolean(profile?.department_id) && Boolean(complaintsItem)
  const dept = useHomeRpc({ rpc: 'staff_dept_workload', tenantId, profileId, enabled: isDeptHead })

  const state = todoState({
    badgeStatuses: [...workCards.map(card => card.status), waterTodo.status === 'loading' ? 'loading' : null],
    badgeCounts: [...workCards.map(card => card.count), waterPending ? 1 : 0],
    summaryStatus: summary.status === 'idle' ? null : summary.status,
    due,
  })
  const hasTodo = workCards.length > 0 || summary.status !== 'idle' || waterPending
  const hasAttention = due.overdue > 0 || due.soon > 0
  const nothingShownYet = pendingCards.length === 0 && failedCards.length === 0 && !hasAttention && !waterPending

  // ── ใช้บ่อย ── อ่านตอน mount (ออกจากหน้าแรกแล้วกลับมา component ถูกสร้างใหม่ จึงได้ลำดับล่าสุดเสมอ)
  // ไม่ใช้ useMemo: อ่าน localStorage ก้อนเล็กๆ + เรียงไม่เกิน 40 รายการ ถูกกว่าที่จะคอยดูแล dependency
  const shortcutKeys = pickShortcuts(readUsage(safeLocalStorage(), tenantId, profileId), {
    allowedKeys: visibleItems.map(item => item.key),
    // การ์ด "ต้องทำตอนนี้" ที่กำลังโชว์อยู่แล้ว ไม่ต้องมีปุ่มซ้ำอีกอัน
    exclude: [...pendingCards.map(card => card.key), ...(hasAttention ? ['complaints'] : [])],
    defaults: DEFAULT_SHORTCUTS,
    limit: SHORTCUT_LIMIT,
  })
  const shortcutItems = shortcutKeys.map(key => itemByKey.get(key)).filter(Boolean)
    .map(item => ({
      key: item.key, label: item.label, Icon: item.Icon, color: item.color, badge: cardBadges[item.key],
      onClick: () => open(item),
    }))

  const canCreateEvent = Boolean(eventsItem && onCreateManagementEvent)
  const hasShortcuts = canCreateEvent || shortcutItems.length > 0
  const hasLeft = hasTodo || eventCount > 0 || isDeptHead

  const totalMenus = visibleItems.length
  const totalBadge = Object.values(cardBadges).reduce((sum, n) => sum + (Number(n) > 0 ? Number(n) : 0), 0)

  return (
    <div className="space-y-3">
      <header className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-lg font-black text-slate-900">แดชบอร์ดสำหรับเจ้าหน้าที่</h1>
          {profile?.role && <span className="hidden text-[10px] font-bold text-slate-400 sm:inline">{ROLE_LABELS[profile.role] ?? profile.role}</span>}
        </div>
        <p className="truncate text-[11px] text-slate-400">{todayTH}</p>
      </header>

      <div className={hasLeft && hasShortcuts ? 'space-y-3 xl:grid xl:grid-cols-3 xl:items-start xl:gap-3 xl:space-y-0' : 'space-y-3'}>
        {hasLeft && (
          <div className={`space-y-3 ${hasShortcuts ? 'xl:col-span-2' : ''}`}>
            {hasTodo && (
              <section data-home-todo aria-labelledby="home-todo-title">
                <div className="mb-1.5">
                  <h2 id="home-todo-title" className="text-sm font-bold text-slate-800">ต้องทำตอนนี้</h2>
                  <p className="text-[10px] text-slate-400">เฉพาะงานที่รอคุณอยู่ · ตัวเลขเดียวกับป้ายบนเมนู</p>
                </div>
                <div className="space-y-2">
                  {due.overdue > 0 && (
                    <AttentionRow tone="red" Icon={CircleAlert} testId="overdue" count={due.overdue} onOpen={() => open(complaintsItem)}
                      text="คำร้องของคุณที่เลยกำหนดแล้ว" hint="ควรเร่งดำเนินการหรือแจ้งเหตุที่ล่าช้า" />
                  )}
                  {due.soon > 0 && (
                    <AttentionRow tone="amber" Icon={Clock} testId="soon" count={due.soon} onOpen={() => open(complaintsItem)}
                      text="คำร้องของคุณที่ใกล้ครบกำหนด" hint="ครบกำหนดภายใน 1 วันทำการ" />
                  )}
                  {waterPending && (
                    <WorkRow item={{ ...waterItem, label: 'ประกาศน้ำ-ฝนรอคุณยืนยัน' }} count={1} hint="ร่างประกาศรอคุณตัดสิน · ยืนยันได้ภายใน 3 ชั่วโมง" onOpen={() => open(waterItem)} />
                  )}
                  {pendingCards.map(card => (
                    <WorkRow key={card.key} item={card.item} count={card.count} hint={card.hint({ isAdmin })} onOpen={() => open(card.item)} />
                  ))}
                  {failedCards.map(card => (
                    <button key={card.key} type="button" data-home-work-error={card.key} onClick={() => open(card.item)}
                      className="flex min-h-12 w-full items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs text-amber-900 active:scale-[0.99]">
                      <TriangleAlert size={16} className="shrink-0" aria-hidden="true" />
                      <span className="min-w-0 flex-1">โหลดตัวเลข “{card.item.label}” ไม่สำเร็จ — กดเพื่อเปิดดูโดยตรง</span>
                      <ChevronRight size={15} className="shrink-0 opacity-60" aria-hidden="true" />
                    </button>
                  ))}
                  {summary.status === 'error' && (
                    <div data-home-summary-error className="flex min-h-12 items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      <TriangleAlert size={16} className="shrink-0" aria-hidden="true" />
                      <span className="min-w-0 flex-1">ตรวจกำหนดเสร็จและกิจกรรมที่ได้รับมอบหมายไม่สำเร็จ — เปิดหน้านี้ใหม่อีกครั้ง</span>
                    </div>
                  )}
                  {state === 'loading' && nothingShownYet && (
                    <div role="status" data-home-loading className="flex min-h-12 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                      <Loader2 size={16} className="animate-spin" aria-hidden="true" /> กำลังตรวจงานค้าง…
                    </div>
                  )}
                  {state === 'clear' && (
                    <div data-home-clear className="flex min-h-12 items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
                      <CheckCircle2 size={18} className="shrink-0" aria-hidden="true" /> ไม่มีงานค้างตอนนี้
                    </div>
                  )}
                  {state === 'holding' && (
                    <button type="button" data-home-holding={due.open} onClick={() => open(complaintsItem)}
                      className="flex min-h-12 w-full items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-left text-sm text-emerald-900 active:scale-[0.99]">
                      <CheckCircle2 size={18} className="shrink-0 text-emerald-700" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">ไม่มีงานเร่งด่วน</span>
                        <span className="block text-[11px] opacity-80">ยังถือคำร้องอยู่ {due.open} ใบ ที่ยังไม่ถึงกำหนด</span>
                      </span>
                      <ChevronRight size={15} className="shrink-0 opacity-50" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </section>
            )}

            {eventCount > 0 && (
              <section data-home-events aria-labelledby="home-events-title">
                <div className="mb-1.5 flex items-center gap-1.5">
                  <CalendarClock size={15} className="text-emerald-600" aria-hidden="true" />
                  <h2 id="home-events-title" className="text-sm font-bold text-slate-800">กิจกรรมที่ได้รับมอบหมาย</h2>
                </div>
                <div className="space-y-1.5">
                  {myEvents.today.length > 0 && <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">วันนี้</p>}
                  {myEvents.today.map(ev => <EventRow key={ev.id} event={ev} onOpen={() => open(eventsItem)} />)}
                  {myEvents.tomorrow.length > 0 && <p className="pt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">พรุ่งนี้</p>}
                  {myEvents.tomorrow.map(ev => <EventRow key={ev.id} event={ev} onOpen={() => open(eventsItem)} />)}
                </div>
              </section>
            )}

            {isDeptHead && (
              <section data-home-dept-section aria-label="กองของฉัน">
                <DeptWorkload state={dept} complaintsItem={complaintsItem} onOpenComplaints={() => open(complaintsItem)} />
              </section>
            )}
          </div>
        )}

        {hasShortcuts && (
          <section data-home-shortcuts className="space-y-2" aria-label="ทางลัด">
            {canCreateEvent && (
              <button type="button" data-home-create-event onClick={onCreateManagementEvent}
                className="flex min-h-14 w-full items-center gap-2.5 rounded-2xl border border-violet-200 bg-white px-3 py-2 text-left shadow-sm hover:bg-violet-50/60 active:scale-[0.99]">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: eventsItem.bg ?? `${eventsItem.color}18` }}>
                  <Plus size={20} style={{ color: eventsItem.color }} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-slate-800">เพิ่มกิจกรรมในปฏิทิน</span>
                  <span className="block text-[11px] text-slate-500">ส่งกำหนดการให้ผู้บริหารทราบ</span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-slate-300" aria-hidden="true" />
              </button>
            )}
            {shortcutItems.length > 0 && (
              <MenuGroup title="ใช้บ่อย" Icon={Zap} color="#f59e0b" items={shortcutItems} layout="quick" />
            )}
          </section>
        )}
      </div>

      {/* มือถือ (< md): เมนูทั้งหมดอยู่ในแท็บ "เมนู" ของแถบล่าง (กริดไอคอน) หน้าแดชบอร์ดมีแค่ปุ่มนี้
          ไม่วางกริดซ้ำสองที่ */}
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

      {/* PC: เมนูซ้ายมีครบอยู่แล้ว การ์ดชุดนี้จึงพับเก็บไว้ท้ายหน้า (เดิมกางเต็มหน้า ซ้ำกับเมนูซ้ายทุกอัน
          ทำให้หน้าแรกไม่มีข้อมูลอะไรที่เมนูซ้ายไม่มี) — ไม่ได้ลบ ใครเคยกดจากตรงนี้ยังกดได้ */}
      <details data-home-all-tools className="group hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:block">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-bold text-slate-800 [&::-webkit-details-marker]:hidden">
          <LayoutGrid size={16} className="text-slate-500" aria-hidden="true" />
          เครื่องมือทั้งหมด
          <span className="text-xs font-normal text-slate-500">{totalMenus} เมนู · แสดงตามโมดูลและสิทธิ์ของบัญชีนี้</span>
          <ChevronRight size={16} className="ml-auto text-slate-400 transition-transform group-open:rotate-90" aria-hidden="true" />
        </summary>
        <div className="space-y-2.5 border-t border-slate-100 p-3">
          {visibleGroups.map(({ group, items }) => (
            <div key={group}>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{group}</p>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-4">
                {items.map((item) => {
                  const { key, label, Icon, color, bg } = item
                  return (
                  <button key={key} type="button" data-home-tool={key}
                    onClick={() => open(item)}
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
      </details>
    </div>
  )
}
