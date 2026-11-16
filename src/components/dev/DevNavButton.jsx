import { NavIconTile } from '../common/CollapsibleNavGroup'
import { DEV_ACTIVE_CAPSULE } from '../../lib/navTileColor'

// ปุ่มเมนูซ้ายของหน้าผู้พัฒนา (DevJournal + DevAdvisor) ใช้ร่วม PC aside กับลิ้นชักมือถือ — PR4 2569-11-16
// กระเบื้องไอคอนสี + แคปซูลเรืองฟ้า→ม่วงตอน active · ตัวเลขใช้ monospace ให้เข้าโทนเทอร์มินัล
// ชื่อเมนูขึ้นบรรทัดใหม่ได้ (ห้ามตัดเป็น …) เพราะชื่อส่วนของระบบผู้พัฒนาตั้งเองได้ยาวเท่าไรก็ได้
export default function DevNavButton({ Icon, label, color, count, active = false, onClick, ...rest }) {
  const showCount = typeof count === 'number' && count >= 0
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined}
      className={`flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sky-300/70 ${active ? 'font-semibold text-white' : 'text-white/80 hover:bg-white/[0.06] hover:text-white'}`}
      style={active ? DEV_ACTIVE_CAPSULE : undefined} {...rest}>
      <NavIconTile Icon={Icon} color={color} size={26} active={active} />
      <span className="min-w-0 flex-1 break-words leading-snug">{label}</span>
      {showCount && (
        <span className="shrink-0 rounded-md bg-white/[0.08] px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-sky-200 ring-1 ring-inset ring-white/10">{count}</span>
      )}
    </button>
  )
}
