import { Link } from 'react-router-dom'
import { tileIconStyle } from '../../lib/menuTileColor'

// เมนูแบบไอคอน (กริดไอคอนไล่สี + ชื่อใต้ไอคอน + ตัวเลขติดมุม) ใช้ร่วมกัน 2 ที่:
//   - หน้า "เมนูทั้งหมด" ของเจ้าหน้าที่บนมือถือ (StaffOperationalDashboard.jsx → StaffMenuGrid)
//   - หน้า "เมนูทั้งหมด" ของประชาชน (MorePage.jsx)
// อยู่ชิ้นเดียวเพื่อให้หน้าตา ขนาดปุ่มกด และการอ่านออกเสียงเหมือนกันทั้งสองฝั่ง แก้ที่เดียวจบ
//
// ผู้เรียกต้อง "กรองเมนูที่ไม่มีสิทธิ์/โมดูลปิดออกก่อน" แล้วค่อยส่ง items เข้ามา — จำนวน "N เมนู" ที่หัวกลุ่ม
// นับจาก items.length ตรงๆ และกลุ่มที่ไม่เหลือเมนูจะไม่ถูกวาดเลย (ไม่มีหัวกลุ่มเปล่า)
//
// item: { key, label, Icon, color(hex), badge?, desc?, danger?,
//         to? (route ภายใน) | href?+external? (ลิงก์นอก/tel:) | onClick? | ไม่มีเลย = ป้ายสถานะ กดไม่ได้ }
//
// ⚠️ desc (คำอธิบายใต้ชื่อเมนูที่ประชาชนเคยเห็นในรายการเดิม) ไม่โชว์บนจอเพราะที่แคบ แต่คงไว้ให้โปรแกรม
//    อ่านหน้าจออ่านต่อท้ายชื่อ (sr-only) — ชื่อต้องมาก่อนเสมอ ไม่งั้นผิด WCAG 2.5.3 (label in name)

const SIZES = {
  // เจ้าหน้าที่: ไอคอน 56px ชื่อ 11px — 4 คอลัมน์ที่จอ ≥ 380px
  sm: { box: 'h-14 w-14', icon: 24, label: 'text-[11px]' },
  // ประชาชน: ไอคอน 64px ชื่อ 12px — 3 คอลัมน์ ปุ่มใหญ่กว่า เพราะมีผู้สูงอายุใช้จริง
  lg: { box: 'h-16 w-16', icon: 28, label: 'text-xs' },
}

// layout ของกลุ่ม = ขนาดไอคอน + จำนวนคอลัมน์ (ไม่ export เป็นค่าคงที่ — eslint react-refresh ไม่ให้ไฟล์คอมโพเนนต์ export อย่างอื่น)
const LAYOUTS = {
  // เจ้าหน้าที่: 4 คอลัมน์ที่จอ ≥ 380px (ต่ำกว่านั้น 3 คอลัมน์ ชื่อเมนูไทยยาวจะไม่ตกเกิน 3 บรรทัด)
  staff: { size: 'sm', grid: 'grid grid-cols-3 gap-x-1 gap-y-3 min-[380px]:grid-cols-4 sm:grid-cols-5 md:grid-cols-6' },
  // ประชาชน: 3 คอลัมน์ ปุ่มใหญ่
  citizen: { size: 'lg', grid: 'grid grid-cols-3 gap-x-1 gap-y-4 md:grid-cols-4' },
  // แถวทางลัด "เมนูที่ใช้งานบ่อย" ของประชาชน: 4 ปุ่มพอดีแถวเดียว
  quick: { size: 'sm', grid: 'grid grid-cols-4 gap-x-1 gap-y-3' },
}

const ROOT = 'group relative flex min-w-0 flex-col items-center rounded-2xl px-0.5 py-2 text-center outline-none transition-transform focus-visible:ring-2 focus-visible:ring-sky-500'

export function MenuTile({ item, size = 'sm' }) {
  const { label, desc, Icon, color, badge, danger, to, href, external, onClick } = item
  const s = SIZES[size] ?? SIZES.sm
  const count = Number(badge) > 0 ? Number(badge) : 0
  const interactive = Boolean(to || href || onClick)

  const body = (
    <>
      <span className="relative inline-flex">
        <span className={`flex items-center justify-center rounded-2xl text-white ${s.box} ${interactive ? 'transition-transform group-active:scale-95' : 'opacity-80'}`}
          style={tileIconStyle(danger ? '#dc2626' : color)}>
          <Icon size={s.icon} strokeWidth={2} aria-hidden="true" />
        </span>
        {count > 0 && (
          <span aria-hidden="true" data-menu-badge
            className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-red-500 px-1 text-[10px] font-bold leading-none text-white shadow-sm">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </span>
      <span data-menu-label className={`mt-2 block w-full break-words text-balance font-semibold leading-snug ${s.label} ${danger ? 'text-red-600' : 'text-slate-700'}`}>
        {label}
      </span>
      {desc && <span className="sr-only"> — {desc}</span>}
      {count > 0 && <span className="sr-only"> — {count} รายการรอ</span>}
    </>
  )

  const common = { 'data-menu-tile': item.key, className: `${ROOT} ${interactive ? 'active:bg-slate-50' : ''}` }

  if (to) return <Link to={to} {...common}>{body}</Link>
  if (href) {
    return (
      <a href={href} {...common}
        target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}>
        {body}
      </a>
    )
  }
  if (onClick) return <button type="button" onClick={onClick} {...common}>{body}</button>
  return <div {...common}>{body}</div>
}

// การ์ดกลุ่ม: หัว (ไอคอนเล็ก + ชื่อกลุ่ม + "N เมนู") แล้วตามด้วยกริดไอคอน
export function MenuGroup({ title, Icon, color, items, layout = 'staff' }) {
  if (!items?.length) return null
  const { size, grid } = LAYOUTS[layout] ?? LAYOUTS.staff
  return (
    <section data-menu-group className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-100 md:break-inside-avoid-column">
      <div className="mb-3 flex items-center gap-2.5">
        {Icon && (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600"
            style={color ? { backgroundColor: `${color}1f`, color } : undefined}>
            <Icon size={16} aria-hidden="true" />
          </span>
        )}
        <h2 className="min-w-0 flex-1 text-sm font-bold leading-tight text-slate-800">{title}</h2>
        <span data-menu-count className="shrink-0 text-xs text-slate-500">{items.length} เมนู</span>
      </div>
      <div className={grid}>
        {items.map(item => <MenuTile key={item.key} item={item} size={size} />)}
      </div>
    </section>
  )
}
