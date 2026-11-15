import { ChevronRight, ExternalLink, LayoutGrid, LogOut, Settings2, Users } from 'lucide-react'
import NavQuickFind from '../common/NavQuickFind'
import { NavIconTile } from '../common/CollapsibleNavGroup'
import { ADMIN_ACTIVE_CAPSULE, ADMIN_NAV_BG } from '../../lib/navTileColor'

// เมนูซ้าย PC ของแผงควบคุมแอดมิน (/admin) — แยกออกจาก AdminDashboard.jsx (PR2 เมนูพรีเมียม 2569-11-16)
// โทนหินชนวน + คราม ตั้งใจให้ต่างจากฝั่งเจ้าหน้าที่ (กรมท่า) — admin ใช้ทั้งสองฝั่ง ต้องรู้ตัวว่าอยู่ใน "โหมดตั้งค่า"
// ตามกติกา 3 ส่วน: ฝั่งแอดมินมีแค่ตั้งค่า+สิทธิ์ งานประจำวันอยู่ฝั่งเจ้าหน้าที่ (ป้ายบนสุดบอกไว้)
// ความกว้าง w-64 คงเดิม · groups = adminMenuGroups ที่ผู้เรียกกรองสิทธิ์ (show) มาแล้ว — ที่นี่ไม่สร้างเมนูเอง
// onOpen(item) = ผู้เรียกตัดสินว่ากดแล้วไปไหน (สลับหน้า / navigate / แท็บใหม่) ชุดเดียวกับลิ้นชักมือถือ
// ช่องค้นหาใช้ NavQuickFind ตัวเดียวกับเจ้าหน้าที่ แต่ปิด "ใช้บ่อย" (favorites={false})
// ป้ายบอกโหมดบนสุดของเมนู — ใช้ทั้งเมนูซ้าย PC และลิ้นชักมือถือ (PortalDrawer notice)
export function AdminZoneNotice({ className = '' }) {
  return (
    <p data-admin-zone className={`flex items-start gap-2 rounded-[10px] border border-indigo-300/35 bg-indigo-400/[0.14] px-2.5 py-2 text-xs leading-snug text-indigo-50 ${className}`}>
      <Settings2 size={15} aria-hidden="true" className="mt-px shrink-0 text-indigo-200" />
      <span><b className="font-semibold">โหมดตั้งค่าระบบ</b> — งานประจำวันอยู่ฝั่งเจ้าหน้าที่</span>
    </p>
  )
}

export default function AdminSideNav({ groups, activeKey, homeActive, showStaffLink, onHome, onStaff, onOpen, onLogout }) {
  const rowBase = 'flex min-h-9 w-full items-center gap-3 rounded-[10px] px-2.5 py-1.5 text-left text-sm transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-200/80'
  const rowCls = (active) => `${rowBase} ${active ? 'font-semibold text-white' : 'font-medium text-white/80 hover:bg-white/[0.07] hover:text-white'}`

  // แถวเมนูหนึ่งแถว (ใช้ทั้งในกลุ่มและผลค้นหา) — คู่มือ = ลิงก์แท็บใหม่ (คลิกกลาง/คัดลอกลิงก์ได้) · หน้าแยก = ลูกศรขวา
  const renderItem = (item) => {
    const { key, label, Icon, color, isExternal, href, isDevLink, navTo } = item
    const active = activeKey === key
    const inner = (
      <>
        <NavIconTile Icon={Icon} color={color} size={22} active={active} />
        <span className="min-w-0 flex-1 break-words leading-snug">{label}</span>
        {isExternal && <ExternalLink size={12} aria-hidden="true" className="shrink-0 opacity-50" />}
        {!isExternal && (isDevLink || navTo) && <ChevronRight size={13} aria-hidden="true" className="shrink-0 opacity-50" />}
      </>
    )
    if (isExternal) return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={rowCls(false)}>
        {inner}<span className="sr-only"> (เปิดแท็บใหม่)</span>
      </a>
    )
    return (
      <button type="button" aria-current={active ? 'page' : undefined} onClick={() => onOpen(item)}
        className={rowCls(active)} style={active ? ADMIN_ACTIVE_CAPSULE : undefined}>
        {inner}
      </button>
    )
  }

  return (
    <aside data-admin-aside className="hidden md:flex flex-col w-64 shrink-0 shadow-xl" style={ADMIN_NAV_BG}>
      <nav aria-label="เมนูผู้ดูแลระบบ" className="flex-1 overflow-y-auto px-3 pb-3 pt-3">
        <AdminZoneNotice className="mb-3" />
        <NavQuickFind groups={groups} activeKey={activeKey} userId={null} favorites={false} shortcut variant="pc"
          renderItem={renderItem} onSelect={onOpen} wrapperClassName="pb-1"
          pinned={(
            <div className="mt-2 space-y-1">
              <button type="button" onClick={onHome} aria-current={homeActive ? 'page' : undefined}
                className={`${rowCls(homeActive)} font-semibold`} style={homeActive ? ADMIN_ACTIVE_CAPSULE : undefined}>
                <NavIconTile Icon={LayoutGrid} color="#475569" size={26} active={homeActive} />
                <span className="flex-1">หน้าหลัก</span>
              </button>
              {showStaffLink && (
                <button type="button" onClick={onStaff} className={rowCls(false)}>
                  <NavIconTile Icon={Users} color="#1a3a5c" size={26} />
                  <span className="flex-1">ไปแดชบอร์ดเจ้าหน้าที่</span>
                  <ChevronRight size={13} aria-hidden="true" className="shrink-0 opacity-50" />
                </button>
              )}
            </div>
          )}>
          {groups.map(({ group, accent, items }) => (
            <section key={group} data-admin-group={group} className="mt-4">
              {/* หัวกลุ่ม: ตัวไทยปกติ 12px (เดิมตัวพิมพ์ใหญ่ 10px จางจนอ่านยาก) + เส้นไล่เฉดสีกลุ่ม */}
              <div className="mb-1 flex items-center gap-2 px-2.5">
                <h2 className="min-w-0 text-xs font-semibold text-indigo-100/90">{group}</h2>
                <span aria-hidden="true" className="h-px min-w-4 flex-1"
                  style={{ backgroundImage: `linear-gradient(90deg, ${accent ?? '#a5b4fc'} 0%, transparent 100%)` }} />
              </div>
              <div className="space-y-0.5">
                {items.map(item => <div key={item.key} data-admin-item={item.key}>{renderItem(item)}</div>)}
              </div>
            </section>
          ))}
        </NavQuickFind>
      </nav>
      <div className="shrink-0 border-t border-white/[0.08] px-2 py-3">
        <button type="button" onClick={onLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200/80">
          <LogOut size={16} aria-hidden="true" />
          ออกจากระบบ
        </button>
      </div>
    </aside>
  )
}
