import { useEffect, useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { NAV_COLLAPSED_EVENT, readCollapsedGroups, setGroupCollapsed } from '../../lib/navUsage'
import { isHotBadge, softTileStyle, BADGE_BASE, BADGE_TONES } from '../../lib/navTileColor'

// เมนูซ้ายแบบ 3 ระดับ (เจ้าของระบบสั่ง 2569-11-15) ใช้ร่วมเมนูซ้าย PC/ลิ้นชักมือถือ โดยไม่เปลี่ยนการกรองสิทธิ์ของผู้เรียก
//   1) แดชบอร์ด/ห้องผู้บริหาร = แถวเต็มตัวหนา (อยู่ที่ผู้เรียก)
//   2) หัวกลุ่ม (ไฟล์นี้) = เส้นคั่นบน + ไอคอนในกล่องมน + ตัวหนาสีขาวเต็ม + ลูกศรท้ายแถว
//   3) เมนูย่อย = ย่อหน้าตามเส้นนำแนวตั้ง ตัวบาง/จางกว่า (หน้าตาแถวอยู่ที่ renderItem ของผู้เรียก) · แถว active มีแถบสีอำพันที่เส้นนำ
// ค่าเริ่มต้น "กางทั้งหมด" (เดิม #674/#677 ซ่อนเมนูที่ไม่มีเรื่องจนดูเหมือนไม่มีเมนู) · กดหัวกลุ่ม = พับ/กาง จำต่อกลุ่มในเครื่อง
// ยอดรวมที่หัวกลุ่ม + พับแล้วซ่อนเมนูย่อยทั้งหมด (เจ้าของระบบสั่ง 2569-11-16 · ยกเลิกข้อตัดสิน #677 ที่ห้ามรวมยอด
//   และให้เมนูที่มีเรื่องค้างโผล่ตอนพับ) — หัวกลุ่มแสดงผลรวมป้ายตัวเลขของเมนูย่อยทุกตัวเสมอ ทั้งตอนกางและตอนพับ
//   ⚠️ รวมได้เพราะแต่ละเมนูนับจากคนละตาราง (คำร้อง/คำขอ/รถผู้ป่วย ฯลฯ) — เมนูใหม่ที่นับเรื่องชุดเดียวกับเมนูอื่นในกลุ่มเดียวกัน
//   จะทำยอดหัวกลุ่มนับซ้ำ ต้องแยกกลุ่มหรือไม่ใส่ป้ายตัวเลข
//   ตอนพับ เมนูที่กำลังเปิดอยู่ก็ซ่อนด้วย → หัวกลุ่มมีพื้นจาง + แถบอำพันแทน ให้รู้ว่าหน้าที่เปิดอยู่ในกลุ่มนี้
//   ตรวจงานไม่ได้ = ข้อความ "ตรวจงานไม่ได้" ที่หัวกลุ่ม (คงเดิม) จึงไม่หายไปกับการพับ

// แบบพรีเมียม (เจ้าของระบบอนุมัติ 2569-11-16) → เจ้าของระบบสั่ง 2569-11-16: โทนนุ่มสบายตา
// (เดิมกระเบื้องพื้นสีทึบ+ไอคอนขาว+ไฮไลต์ขอบบน+เงา "สว่างไป บางคนแสบตา") ตอนนี้ = พื้นโปร่ง 18% ของสีเมนู + ขอบ 1px + ไอคอนสีอ่อน
// สีผ่าน softTileStyle() ที่ navTileColor.js — ห้ามใส่สีพื้นกระเบื้องตรงๆ ข้ามตัวนี้ (เทสต์วัด contrast ของไอคอนบนพื้นโปร่งทุกสีเมนู)

// กระเบื้องไอคอนหนึ่งช่อง · color ไม่มี = เทาหินชนวน · size = ความกว้าง/สูง px (ไอคอนข้างใน 60%)
// active = วงขาวบางรอบกระเบื้อง (เมนูที่เปิดอยู่เห็นชัดแม้ไม่ดูสีพื้นแถว)
export function NavIconTile({ Icon, color, size = 22, active = false, ...rest }) {
  return (
    <span aria-hidden="true" data-nav-tile className="flex shrink-0 items-center justify-center rounded-[7px] border border-solid"
      style={{
        width: size, height: size, ...softTileStyle(color),
        boxShadow: active ? '0 0 0 1.5px rgba(255,255,255,0.22)' : undefined,
      }} {...rest}>
      {Icon && <Icon size={Math.round(size * 0.6)} strokeWidth={2} />}
    </span>
  )
}

// กล่องไอคอนหัวกลุ่ม · ไม่มี Icon = จุดวงกลม · accent = สีกระเบื้อง (ไม่มี = พื้นจางแบบเดิม)
export function NavGroupIcon({ Icon, accent }) {
  if (accent && Icon) return <NavIconTile Icon={Icon} color={accent} size={24} data-nav-group-icon="" />
  return (
    <span aria-hidden="true" data-nav-group-icon className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/15 text-white">
      {Icon ? <Icon size={16} strokeWidth={1.9} /> : <span className="h-1.5 w-1.5 rounded-full bg-white/80" />}
    </span>
  )
}

// ป้ายตัวเลขเรื่องค้าง (ใช้ร่วมเมนู PC กับลิ้นชักมือถือ) · < 10 อำพัน ตัว #fcd34d · ≥ 10 แดง ตัว #fca5a5
// เจ้าของระบบสั่ง 2569-11-16: โทนนุ่มสบายตา — เดิมไล่เฉดทึบ+เงาดำ (อำพันตัวเข้ม/แดงตัวขาว) ตอนนี้สีอ่อนบนพื้นเข้ม + วงใน 1px · ตัวหนาเท่าเดิม
// ⚠️ พื้นป้ายต้องมีชั้นทึบ BADGE_BASE รองใต้สีโปร่ง: ถ้าโปร่งล้วน ป้ายที่อยู่บนแถว active (แคปซูลสว่างกว่าแผง) เหลือ 3.0:1
//   และแดงบนแผงประชาชนเหลือ 3.8:1 · ชั้นทึบทำให้ค่าคงที่ทุกพื้น — อำพัน 8.0:1 · แดง 6.4:1 (วัดในเทสต์ nav-usage)
// ไม่กะพริบ/ไม่เด้ง — เมนูเปิดค้างทั้งวัน ของขยับจะรบกวนสายตา
export function NavBadge({ count, ...rest }) {
  const n = Number(count)
  if (!(n > 0)) return null
  const hot = isHotBadge(n)
  const tone = BADGE_TONES[hot ? 'hot' : 'normal']
  return (
    <span data-nav-badge={hot ? 'hot' : 'normal'} {...rest}
      style={{ backgroundColor: BADGE_BASE, backgroundImage: `linear-gradient(${tone.tint}, ${tone.tint})`, color: tone.text, boxShadow: `inset 0 0 0 1px ${tone.ring}` }}
      className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-bold leading-none tabular-nums">
      {n > 99 ? '99+' : n}
      <span className="sr-only"> รายการรอ</span>
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
  // ยอดรวมของเมนูย่อยทุกตัว (ป้ายตัวเลขเดียวกับเมนูย่อย: < 10 อำพัน · ≥ 10 แดง)
  const groupTotal = rows.reduce((sum, row) => sum + (row.hasWork ? Number(badges?.[row.item.key]) : 0), 0)
  const activeInside = collapsed && rows.some(row => row.isActive)
  // aria-controls รับหลาย ID ได้ — พับแล้วซ่อนทุกแถว
  const controlledIds = rows.map(row => row.id).join(' ')

  const toggle = () => { setCollapsed(!collapsed); setGroupCollapsed(label, !collapsed) }

  return (
    <div data-nav-group={label} data-department-nav={label} className={divider ? 'relative mt-3 pt-3' : 'mt-3'}>
      {/* เส้นคั่นไล่เฉดสีกลุ่ม → จางหาย (แทนเส้นเทาเรียบเดิม) · ไม่มี accent = เส้นขาวจาง
          เจ้าของระบบสั่ง 2569-11-16: โทนนุ่มสบายตา — ต้นเส้นจาก accent ทึบ → 8c (≈55%) กลางเส้น 66 → 33 */}
      {divider && (
        <span aria-hidden="true" data-nav-group-rule className="absolute inset-x-0 top-0 h-px"
          style={{ backgroundImage: accent ? `linear-gradient(90deg, ${accent}8c 0%, ${accent}33 45%, transparent 100%)` : 'linear-gradient(90deg, rgba(255,255,255,0.18), rgba(255,255,255,0.04))' }} />
      )}
      <button type="button" aria-expanded={!collapsed} aria-controls={controlledIds || undefined}
        title={collapsed ? 'กางเมนูย่อยของกลุ่มนี้' : 'พับเมนูย่อยของกลุ่มนี้'}
        onClick={toggle} data-nav-group-active={activeInside ? '' : undefined}
        className={`relative mb-1 flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] font-bold leading-snug text-white/85 transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60 md:min-h-9 ${activeInside ? 'bg-white/[0.06]' : ''}`}>
        {activeInside && <span aria-hidden="true" className="absolute bottom-1.5 left-0 top-1.5 w-0.5 rounded-full bg-amber-300" />}
        <NavGroupIcon Icon={Icon} accent={accent} />
        <span className="min-w-0 flex-1 break-words">{label}{activeInside && <span className="sr-only"> (หน้าที่เปิดอยู่อยู่ในกลุ่มนี้)</span>}</span>
        <NavBadge count={groupTotal} data-nav-group-total="" />
        {workError && <span role="status" className="shrink-0 text-[10px] font-normal text-amber-300">ตรวจงานไม่ได้</span>}
        <ChevronDown size={16} aria-hidden="true" className={`shrink-0 text-white/70 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
      </button>
      <NavSubList>
        {rows.map(({ item, id, isActive }) => (
          <NavSubRow key={item.key} id={id} data-nav-item={item.key} active={isActive}
            hidden={collapsed}>
            {renderItem(item)}
          </NavSubRow>
        ))}
      </NavSubList>
    </div>
  )
}
