import { ChevronRight, Plus } from 'lucide-react'
import { activeOrgTerms } from '../../lib/orgTerms'

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
  visibleGroups, setActiveModule, profile, pendingCount, navigate, onCreateManagementEvent,
}) {
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

  // newTab = ไฟล์ static นอก router (เช่น /manual-staff.html) ต้องเปิดแท็บใหม่
  // ถ้าไม่ดักตรงนี้จะตกไป setActiveModule('manual-staff') ซึ่งไม่มี branch ไหน render = จอเปล่า
  function openTask(item) {
    if (item.key === 'events' && onCreateManagementEvent) onCreateManagementEvent()
    else if (item.newTab) window.open(item.newTab, '_blank', 'noopener,noreferrer')
    else if (item.externalUrl) navigate(item.externalUrl)
    else setActiveModule(item.key)
  }

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

      <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="mb-3">
          <h2 className="text-sm font-bold text-slate-800">เครื่องมือที่ใช้งานได้</h2>
          <p className="text-[10px] text-slate-400">แสดงตามโมดูลและสิทธิ์ของบัญชีนี้</p>
        </div>
        <div className="space-y-2.5">
          {visibleGroups.map(({ group, items }) => (
            <div key={group}>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{group}</p>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-4">
                {items.map(({ key, label, Icon, color, bg, externalUrl, newTab }) => (
                  <button key={key} type="button"
                    onClick={() => newTab ? window.open(newTab, '_blank', 'noopener,noreferrer') : externalUrl ? navigate(externalUrl) : setActiveModule(key)}
                    className="flex min-h-14 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50 active:scale-[0.99]">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: bg ?? `${color}18` }}><Icon size={18} style={{ color }} /></div>
                    <p className="min-w-0 flex-1 text-xs font-bold leading-tight text-slate-700">{label}</p>
                    {key === 'inbox' && pendingCount > 0 && <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[9px] font-bold text-white">{pendingCount > 99 ? '99+' : pendingCount}</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
