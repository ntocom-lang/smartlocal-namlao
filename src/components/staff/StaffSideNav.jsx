import { ChartColumn, LayoutDashboard } from 'lucide-react'
import CollapsibleNavGroup from '../common/CollapsibleNavGroup'
import { EXECUTIVE_MENU_ITEM } from '../../lib/staffNavGroups'

// เมนูซ้าย PC ของระบบเจ้าหน้าที่ — ใช้ร่วม /staff กับห้องผู้บริหาร (/executive)
// ปักใต้หัวจอ: sticky + self-start (ไม่ยืดตามแถว) + ความสูง = ที่เหลือใต้หัวในตัวเลื่อน (style จาก useStickyChrome)
// nav ข้างในเลื่อนเองได้ — ความกว้าง w-60 คงเดิม พื้นที่เนื้อหาไม่เปลี่ยน (ตารางกล่องงานพึ่งความกว้างนี้)
// onHome = กด "แดชบอร์ด" · onExecutive = กด "ห้องผู้บริหาร" (ไม่ส่ง = ไม่แสดงปุ่ม; คนที่เปิดห้องไม่ได้ไม่เห็น)
// executiveActive = อยู่ในห้องผู้บริหารเอง (ไฮไลต์ ไม่ใช่ปุ่มหลอกที่กดแล้วไม่ไปไหน)
export default function StaffSideNav({
  groups, activeKey, homeActive = false, executiveActive = false, badges, workErrors, style,
  onHome, onExecutive, onSelect,
}) {
  const rowCls = (active) => `flex min-h-9 w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60 ${active ? 'bg-white/20 text-white shadow-sm' : 'text-white/80 hover:bg-white/10 hover:text-white'}`
  return (
    <aside data-staff-aside className="hidden md:flex flex-col w-60 shrink-0 shadow-lg sticky self-start"
      style={{ backgroundColor: '#1a3a5c', ...style }}>
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <button type="button" onClick={onHome} aria-current={homeActive ? 'page' : undefined} className={`mb-2 ${rowCls(homeActive)}`}>
          <LayoutDashboard size={16} strokeWidth={homeActive ? 2.2 : 1.8} />
          <span className="flex-1 text-left text-xs">แดชบอร์ด</span>
        </button>
        {onExecutive && (
          <button type="button" data-staff-exec-link aria-current={executiveActive ? 'page' : undefined} onClick={onExecutive}
            className={`mb-2 ${rowCls(executiveActive)}`}>
            <ChartColumn size={16} strokeWidth={executiveActive ? 2.2 : 1.8} />
            <span className="flex-1 text-left text-xs">{EXECUTIVE_MENU_ITEM.label}</span>
          </button>
        )}
        {/* ศูนย์รวมข้อมูลดิจิทัลอยู่ในกลุ่ม "แผนงานและทรัพยากรกลาง" ของ STANDALONE_GROUPS (ไม่ hardcode ปุ่มซ้ำตรงนี้) */}
        {groups.map(({ group, items }) => (
          <CollapsibleNavGroup key={group} label={group} items={items} badges={badges} workErrors={workErrors}
            renderItem={(item) => {
              const { key, label, Icon } = item
              const isActive = activeKey === key
              const badge = badges?.[key] > 0 ? badges[key] : null
              return (
                <button type="button" aria-current={isActive ? 'page' : undefined} onClick={() => onSelect(item)}
                  className={`${rowCls(isActive)} min-h-11`}>
                  <Icon size={16} strokeWidth={isActive ? 2.2 : 1.8} />
                  <span className="flex-1 text-left text-xs">{label}</span>
                  {badge && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-slate-900 bg-amber-400">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </button>
              )
            }} />
        ))}
      </nav>
    </aside>
  )
}
