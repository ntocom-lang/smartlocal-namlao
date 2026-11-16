import { useEffect, useId, useState } from 'react'
import { ChartColumn, LayoutDashboard, Search } from 'lucide-react'
import { NavBadge, NavGroupIcon, NavIconTile } from '../common/CollapsibleNavGroup'
import { NAV_COLLAPSED_EVENT, groupBadgeTotal, readCollapsedGroups, setGroupCollapsed } from '../../lib/navUsage'
import { NAV_ACTIVE_CAPSULE } from '../../lib/navTileColor'
import { EXECUTIVE_MENU_ITEM } from '../../lib/staffNavGroups'

// เมนูซ้าย PC ของระบบเจ้าหน้าที่ "โหมดย่อ" = เหลือแต่ไอคอน กว้าง 64px (เจ้าของระบบอนุมัติ 2569-11-16)
// เหตุผล: ตารางกล่องงานกว้าง 1106px แต่พื้นที่ข้างเมนู w-60 เหลือ 1022px → ย่อเมนูได้ที่คืน ~176px
// StaffSideNav เลือกวาดไฟล์นี้แทนเมนูเต็มเมื่อกดปุ่ม "ย่อเมนู" (จำต่อเครื่อง) — ลิ้นชักมือถือ/แอดมิน/ประชาชน/ผู้พัฒนาไม่ใช้ไฟล์นี้
// ใช้สถานะพับกลุ่มชุดเดียวกับโหมดเต็ม (setGroupCollapsed + NAV_COLLAPSED_EVENT) · ยอดรวมกลุ่มใช้ groupBadgeTotal ตัวเดียวกับ CollapsibleNavGroup
// ไม่มี "ใช้บ่อย"/ปุ่มปิดทั้งหมด/ช่องค้นหา — ปุ่มแว่นขยายด้านบนขยายเมนูแล้วโฟกัสช่องค้นหา (onSearch ของ StaffSideNav)
// ทุกปุ่มมี title + aria-label เป็นชื่อเมนู (+ " · ค้าง N เรื่อง") เพราะไม่มีตัวหนังสือให้อ่าน · ป้ายตัวเลขมุมกระเบื้อง = NavBadge compact ชุดเดิม

// เจ้าของระบบสั่ง 2569-11-16: ชื่อเมนูบรรทัดเดียว → เมนูเต็มใช้ชื่อสั้น (navLabel) · โหมดย่อใช้ "ชื่อเต็ม" (label/group) ใน title/aria-label เพราะ tooltip มีที่ว่าง ห้ามใช้ navText ที่นี่
const withWork = (label, n) => (n > 0 ? `${label} · ค้าง ${n} เรื่อง` : label)

const btnBase = 'relative flex h-10 w-full items-center justify-center rounded-[10px] transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70'

// ปุ่มไอคอนหนึ่งปุ่ม · badge = ตัวเลขมุมบนขวาของกระเบื้อง (ไม่มี/0 = ไม่แสดง) · adornment = ของที่วางบนปุ่มนอกกระเบื้อง (แถบ active ของหัวกลุ่ม)
function RailButton({ label, active = false, badge = 0, error = false, adornment, children, ...rest }) {
  return (
    <button type="button" title={label} aria-label={label} aria-current={active ? 'page' : undefined}
      style={active ? NAV_ACTIVE_CAPSULE : undefined}
      className={`${btnBase} ${active ? '' : 'hover:bg-white/[0.06]'}`} {...rest}>
      {adornment}
      <span className="relative flex">
        {children}
        {badge > 0 && (
          <span className="absolute -right-1.5 -top-1.5 z-10"><NavBadge count={badge} compact /></span>
        )}
        {error && <span aria-hidden="true" data-nav-rail-error className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-amber-300 ring-1 ring-[#1a3a5c]" />}
      </span>
    </button>
  )
}

export default function StaffNavRail({
  id, groups, activeKey, homeActive = false, executiveActive = false, badges, workErrors, onHome, onExecutive, onPick, onSearch,
}) {
  const baseId = useId()
  // สถานะพับกลุ่มชุดเดียวกับโหมดเต็ม: อ่านจาก localStorage แล้วฟังอีเวนต์เดียวกับ CollapsibleNavGroup
  const [collapsedSet, setCollapsedSet] = useState(() => readCollapsedGroups())
  useEffect(() => {
    const sync = () => setCollapsedSet(readCollapsedGroups())
    window.addEventListener(NAV_COLLAPSED_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener(NAV_COLLAPSED_EVENT, sync); window.removeEventListener('storage', sync) }
  }, [])

  return (
    <nav id={id} aria-label="เมนูแบบย่อ (เหลือแต่ไอคอน)"
      className="flex-1 overflow-y-auto px-1 pb-3 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {/* 1) ค้นหา = กล่องโปร่งแบบช่องค้นหา → กดแล้วขยายเมนูและโฟกัสช่องค้นหา */}
      <button type="button" data-nav-rail-search title="ค้นหาเมนู (กด / ได้ทุกที่)" aria-label="ค้นหาเมนู" onClick={onSearch}
        className={`${btnBase} h-11 hover:bg-white/[0.06]`}>
        <span aria-hidden="true" className="flex h-9 w-10 items-center justify-center rounded-[10px] border border-white/20 bg-white/[0.09] text-white/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
          <Search size={15} />
        </span>
      </button>

      {/* 2) แดชบอร์ด + ห้องผู้บริหาร (ถ้ามี onExecutive) */}
      <div className="mt-1 space-y-1">
        <RailButton label="แดชบอร์ด" active={homeActive} onClick={onHome}>
          <NavIconTile Icon={LayoutDashboard} color="#475569" size={26} active={homeActive} />
        </RailButton>
        {onExecutive && (
          <RailButton label={EXECUTIVE_MENU_ITEM.label} active={executiveActive} onClick={onExecutive} data-staff-exec-link>
            <NavIconTile Icon={ChartColumn} color={EXECUTIVE_MENU_ITEM.color} size={26} active={executiveActive} />
          </RailButton>
        )}
      </div>

      {/* 3) ต่อกลุ่ม: เส้นคั่นบาง → หัวกลุ่ม (ไอคอน + ยอดรวม) → เมนูย่อยเป็นกระเบื้อง (กลุ่มที่พับ = เหลือหัวกลุ่มอย่างเดียว) */}
      {groups.map(({ group, Icon, accent, items }, index) => {
        const collapsed = collapsedSet.has(group)
        const total = groupBadgeTotal(items, badges)
        const workError = items.some(item => Boolean(workErrors?.[item.key]))
        const activeInside = collapsed && items.some(item => activeKey != null && activeKey === item.key)
        const listId = `${baseId}-g${index}`
        const label = `${withWork(group, total)}${workError ? ' · ตรวจงานไม่ได้' : ''}`
        return (
          <div key={group} data-nav-rail-group={group} className="mt-2">
            <span aria-hidden="true" data-nav-group-rule className="mx-auto mb-1 block h-px w-8"
              style={{ backgroundImage: accent ? `linear-gradient(90deg, ${accent}55 0%, transparent 100%)` : 'linear-gradient(90deg, rgba(255,255,255,0.18), transparent)' }} />
            <RailButton label={label} badge={total} error={workError}
              aria-expanded={!collapsed} aria-controls={items.length ? listId : undefined}
              data-nav-group-active={activeInside ? '' : undefined}
              onClick={() => setGroupCollapsed(group, !collapsed)}
              adornment={activeInside ? <span aria-hidden="true" className="absolute bottom-1.5 left-0 top-1.5 w-0.5 rounded-full bg-amber-300" /> : null}>
              <NavGroupIcon Icon={Icon} accent={accent} />
            </RailButton>
            <div id={listId} hidden={collapsed} className="mt-0.5 space-y-0.5 rounded-[10px] bg-white/[0.04] py-0.5">
              {items.map((item) => {
                const isActive = activeKey != null && activeKey === item.key
                const n = Number(badges?.[item.key])
                const count = Number.isFinite(n) && n > 0 ? n : 0
                return (
                  <RailButton key={item.key} data-rail-item={item.key} label={withWork(item.label, count)} active={isActive} badge={count}
                    onClick={() => onPick(item)}>
                    <NavIconTile Icon={item.Icon} color={item.color} size={22} active={isActive} />
                  </RailButton>
                )
              })}
            </div>
          </div>
        )
      })}
    </nav>
  )
}
