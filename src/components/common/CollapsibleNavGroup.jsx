import { useEffect, useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { NAV_COLLAPSED_EVENT, readCollapsedGroups, setGroupCollapsed } from '../../lib/navUsage'

// เมนูซ้ายแบบ 3 ระดับ (เจ้าของระบบสั่ง 2569-11-15) ใช้ร่วมเมนูซ้าย PC/ลิ้นชักมือถือ โดยไม่เปลี่ยนการกรองสิทธิ์ของผู้เรียก
//   1) แดชบอร์ด/ห้องผู้บริหาร = แถวเต็มตัวหนา (อยู่ที่ผู้เรียก)
//   2) หัวกลุ่ม (ไฟล์นี้) = เส้นคั่นบน + ไอคอนในกล่องมน + ตัวหนาสีขาวเต็ม + ลูกศรท้ายแถว
//   3) เมนูย่อย = ย่อหน้าตามเส้นนำแนวตั้ง ตัวบาง/จางกว่า (หน้าตาแถวอยู่ที่ renderItem ของผู้เรียก) · แถว active มีแถบสีอำพันที่เส้นนำ
// ค่าเริ่มต้น "กางทั้งหมด" (เดิม #674/#677 ซ่อนเมนูที่ไม่มีเรื่องจนดูเหมือนไม่มีเมนู) · กดหัวกลุ่ม = พับ/กาง จำต่อกลุ่มในเครื่อง
// ตอน "พับ" ยังคงพฤติกรรมเดิมของ #677: เมนูที่มีเรื่องค้าง/ตรวจงานไม่ได้ (และเมนูที่กำลังเปิดอยู่) ยังมองเห็น
// ห้ามบวกยอดรวมที่หัวกลุ่ม (ข้อตัดสิน #677) — มีแค่จุดสีอำพันบอกว่ากลุ่มที่พับมีเรื่องค้าง

// กล่องไอคอนหัวกลุ่ม · ไม่มี Icon = จุดวงกลม · accent (ถ้ามี) = สีกล่อง
export function NavGroupIcon({ Icon, accent }) {
  return (
    <span aria-hidden="true" data-nav-group-icon className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/15 text-white"
      style={accent ? { backgroundColor: accent } : undefined}>
      {Icon ? <Icon size={16} strokeWidth={1.9} /> : <span className="h-1.5 w-1.5 rounded-full bg-white/80" />}
    </span>
  )
}

// รายการเมนูย่อยทั้งชุดใต้หัวกลุ่ม — เส้นนำแนวตั้งตรงกลางไอคอนกลุ่ม (ไอคอน 24px เริ่มที่ px-3 = กึ่งกลาง 24px)
export function NavSubList({ children, className = '', ...rest }) {
  return <div className={`ml-[23px] space-y-0.5 border-l border-white/15 pl-2 ${className}`} {...rest}>{children}</div>
}

// แถวเมนูย่อยหนึ่งแถว + แถบ active ที่เส้นนำ (ทับเส้นบางเป็นเส้นหนา 2px สีอำพัน — รู้ว่าอยู่ใต้กลุ่มไหน)
export function NavSubRow({ active, children, ...rest }) {
  return (
    <div className="relative" {...rest}>
      {active && <span aria-hidden="true" data-nav-active-bar className="absolute -left-[9px] bottom-1 top-1 w-0.5 rounded-full bg-amber-300" />}
      {children}
    </div>
  )
}

export default function CollapsibleNavGroup({ label, Icon, accent, items, badges, workErrors, activeKey, divider = false, renderItem }) {
  const groupId = useId()
  const [collapsed, setCollapsed] = useState(() => readCollapsedGroups().has(label))

  // อินสแตนซ์อื่นในหน้าเดียวกัน (เมนู PC กับลิ้นชักมือถือ) หรือแท็บอื่นเปลี่ยนสถานะ → อ่านใหม่
  useEffect(() => {
    const sync = () => setCollapsed(readCollapsedGroups().has(label))
    window.addEventListener(NAV_COLLAPSED_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener(NAV_COLLAPSED_EVENT, sync); window.removeEventListener('storage', sync) }
  }, [label])

  const rows = items.map((item, index) => ({
    item, id: `${groupId}-${index}`,
    hasWork: Number(badges?.[item.key]) > 0,
    hasError: Boolean(workErrors?.[item.key]),
    isActive: activeKey != null && activeKey === item.key,
  }))
  const workError = rows.some(row => row.hasError)
  // รายการที่พับแล้วซ่อนได้ = ไม่มีเรื่องค้าง/ไม่ใช่ที่ตรวจงานไม่ได้/ไม่ใช่หน้าที่เปิดอยู่
  const hideable = rows.filter(row => !row.hasWork && !row.hasError && !row.isActive)
  // aria-controls รับหลาย ID ได้ จึงคงลำดับเมนูเดิมโดยไม่ทำสำเนาปุ่มซ้ำ
  const controlledIds = hideable.map(row => row.id).join(' ')
  const pendingWhileCollapsed = collapsed && hideable.length > 0 && rows.some(row => row.hasWork || row.hasError)

  const toggle = () => { setCollapsed(!collapsed); setGroupCollapsed(label, !collapsed) }

  return (
    <div data-nav-group={label} data-department-nav={label} className={divider ? 'mt-3 border-t border-white/10 pt-3' : 'mt-3'}>
      <button type="button" aria-expanded={!collapsed} aria-controls={controlledIds || undefined}
        title={collapsed ? 'กางเมนูย่อยของกลุ่มนี้' : 'พับเมนูย่อยของกลุ่มนี้'}
        onClick={toggle}
        className="mb-1 flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] font-bold leading-snug text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60 md:min-h-9">
        <NavGroupIcon Icon={Icon} accent={accent} />
        <span className="min-w-0 flex-1 break-words">{label}</span>
        {pendingWhileCollapsed && (
          <span data-nav-group-dot className="shrink-0">
            <span aria-hidden="true" className="block h-2 w-2 rounded-full bg-amber-400" />
            <span className="sr-only">มีเรื่องค้างในกลุ่มนี้</span>
          </span>
        )}
        {workError && <span role="status" className="shrink-0 text-[10px] font-normal text-amber-300">ตรวจงานไม่ได้</span>}
        <ChevronDown size={16} aria-hidden="true" className={`shrink-0 text-white/70 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
      </button>
      <NavSubList>
        {rows.map(({ item, id, hasWork, hasError, isActive }) => (
          <NavSubRow key={item.key} id={id} data-nav-item={item.key} active={isActive}
            hidden={collapsed && !hasWork && !hasError && !isActive}>
            {renderItem(item)}
          </NavSubRow>
        ))}
      </NavSubList>
    </div>
  )
}
