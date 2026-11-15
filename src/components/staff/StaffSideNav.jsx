import { useCallback } from 'react'
import { ChartColumn, LayoutDashboard } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import CollapsibleNavGroup from '../common/CollapsibleNavGroup'
import NavQuickFind from '../common/NavQuickFind'
import { recordNavUse } from '../../lib/navUsage'
import { EXECUTIVE_MENU_ITEM } from '../../lib/staffNavGroups'

// เมนูซ้าย PC ของระบบเจ้าหน้าที่ — ใช้ร่วม /staff กับห้องผู้บริหาร (/executive)
// ปักใต้หัวจอ: sticky + self-start (ไม่ยืดตามแถว) + ความสูง = ที่เหลือใต้หัวในตัวเลื่อน (style จาก useStickyChrome)
// nav ข้างในเลื่อนเองได้ — ความกว้าง w-60 คงเดิม พื้นที่เนื้อหาไม่เปลี่ยน (ตารางกล่องงานพึ่งความกว้างนี้)
// onHome = กด "แดชบอร์ด" · onExecutive = กด "ห้องผู้บริหาร" (ไม่ส่ง = ไม่แสดงปุ่ม; คนที่เปิดห้องไม่ได้ไม่เห็น)
// executiveActive = อยู่ในห้องผู้บริหารเอง (ไฮไลต์ ไม่ใช่ปุ่มหลอกที่กดแล้วไม่ไปไหน)
// ลำดับ: ช่องค้นหา (กด "/" โฟกัส) → แดชบอร์ด/ห้องผู้บริหาร → "ใช้บ่อย" → กลุ่มเมนู (กางทั้งหมด พับได้) — เจ้าของระบบเลือก 2569-11-15
// เมนูย่อยสูงขั้นต่ำ 36px (min-h-9) ให้ราว 22 แถวพอดีจอโน้ตบุค (ยังเกินขั้นต่ำเป้าหมายแตะ 24px ของ WCAG 2.5.8) · ลิ้นชักมือถือคง ≥44px
export default function StaffSideNav({
  groups, activeKey, homeActive = false, executiveActive = false, badges, workErrors, style,
  onHome, onExecutive, onSelect,
}) {
  const { session } = useAuth()
  const userId = session?.user?.id ?? null
  // ทุกทางที่กดเมนูโมดูล (กลุ่ม/ใช้บ่อย/ผลค้นหา) ผ่านตัวนี้ → นับการใช้ (แดชบอร์ด/ห้องผู้บริหารไม่ผ่านตัวนี้ ไม่ถูกนับ)
  const pick = useCallback((item) => { recordNavUse(userId, item.key); onSelect(item) }, [userId, onSelect])

  const rowCls = (active) => `flex min-h-9 w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60 ${active ? 'bg-white/20 text-white shadow-sm' : 'text-white/80 hover:bg-white/10 hover:text-white'}`
  // เมนูย่อย: ตัวบาง/จางกว่าหัวกลุ่ม (white/75 บน #1a3a5c ผ่าน WCAG AA) · active = พื้นจาง + ตัวหนา (แถบอำพันวาดโดย NavSubRow)
  const subCls = (active) => `flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60 ${active ? 'bg-white/15 font-semibold text-white' : 'font-normal text-white/75 hover:bg-white/10 hover:text-white'}`
  const renderItem = (item) => {
    const { key, label, Icon } = item
    const isActive = activeKey === key
    const badge = badges?.[key] > 0 ? badges[key] : null
    return (
      <button type="button" aria-current={isActive ? 'page' : undefined} onClick={() => pick(item)} className={subCls(isActive)}>
        <Icon size={15} strokeWidth={1.6} aria-hidden="true" className="shrink-0" />
        <span className="min-w-0 flex-1 break-words text-left leading-snug">{label}</span>
        {badge && (
          <span className="shrink-0 rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-slate-900">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>
    )
  }

  return (
    <aside data-staff-aside className="hidden md:flex flex-col w-60 shrink-0 shadow-lg sticky self-start"
      style={{ backgroundColor: '#1a3a5c', ...style }}>
      <nav className="flex-1 px-3 pb-4 overflow-y-auto">
        <NavQuickFind groups={groups} activeKey={activeKey} userId={userId} renderItem={renderItem} onSelect={pick}
          variant="pc" shortcut wrapperClassName="sticky top-0 z-10 -mx-3 px-3 pb-2 pt-4" wrapperStyle={{ backgroundColor: '#1a3a5c' }}
          pinned={(
            <div className="mt-1">
              <button type="button" onClick={onHome} aria-current={homeActive ? 'page' : undefined} className={`mb-2 ${rowCls(homeActive)}`}>
                <LayoutDashboard size={18} strokeWidth={homeActive ? 2.2 : 1.8} />
                <span className="flex-1 text-left text-sm">แดชบอร์ด</span>
              </button>
              {onExecutive && (
                <button type="button" data-staff-exec-link aria-current={executiveActive ? 'page' : undefined} onClick={onExecutive}
                  className={`mb-2 ${rowCls(executiveActive)}`}>
                  <ChartColumn size={18} strokeWidth={executiveActive ? 2.2 : 1.8} />
                  <span className="flex-1 text-left text-sm">{EXECUTIVE_MENU_ITEM.label}</span>
                </button>
              )}
            </div>
          )}>
          {/* ศูนย์รวมข้อมูลดิจิทัลอยู่ในกลุ่ม "แผนงานและทรัพยากรกลาง" ของ STANDALONE_GROUPS (ไม่ hardcode ปุ่มซ้ำตรงนี้) */}
          {groups.map(({ group, Icon, accent, items }, index) => (
            <CollapsibleNavGroup key={group} label={group} Icon={Icon} accent={accent} items={items} badges={badges}
              workErrors={workErrors} activeKey={activeKey} divider={index > 0} renderItem={renderItem} />
          ))}
        </NavQuickFind>
      </nav>
    </aside>
  )
}
