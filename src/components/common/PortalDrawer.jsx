import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { LayoutDashboard, X } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { ROLE_LABELS } from '../../lib/staffRoster'

// เมนูซ้ายแบบลิ้นชักเลื่อนออกจากซ้าย — ใช้ร่วม 3 ที่ (เฉพาะมือถือ md:hidden):
//   - หน้าเจ้าหน้าที่ (StaffDashboard.jsx)
//   - แผงควบคุมแอดมิน (AdminDashboard.jsx)
//   - ศูนย์รวมข้อมูลดิจิทัล (DataCenterDashboard.jsx)
// บน PC ทั้งสามหน้ามีเมนูซ้ายถาวรอยู่แล้ว (aside) ไฟล์นี้ไม่แตะมัน
//
// เนื้อหาใช้กลุ่มเมนูชุดเดียวกับเมนูซ้าย PC ของหน้านั้น (ผู้เรียกกรองสิทธิ์/โมดูลที่เปิดมาให้แล้ว) จึงไม่มีเมนูหลอก
// หรือเมนูที่ขาดไป · ตัวเลขแดงมาจากชุดเดียวกับแถบล่าง/กริด (badges ส่งมาจากผู้เรียก)
// ผู้เรียกเป็นคนตัดสินว่ากดเมนูแล้วทำอะไร (onSelect) — ลิ้นชักไม่รู้จักโมดูลใดโดยเฉพาะ
// groups: [{ group, accent?, items: [{ key, label, Icon, ... }] }] · accent (ถ้ามี) = จุดสีหน้าหัวกลุ่ม
//
// สีดึงจากธีมของแต่ละ อปท. (--color-primary / --color-primary-dark) ไม่ฮาร์ดโค้ด · ส่วนไล่เฉดใช้ color-mix
// แยกเป็น backgroundImage ต่างหากจาก backgroundColor: ถ้า WebView รุ่นเก่าไม่รู้จัก color-mix บรรทัด
// backgroundImage จะถูกทิ้งทั้งบรรทัดแล้วเหลือ backgroundColor สีทึบ (ตัวหนังสือขาวยังอ่านได้) แทนที่จะโปร่งใสหายไปทั้งแผง
//
// z-index 55/60: ต้องอยู่เหนือแถบล่างของหน้าแอดมิน (z-50) ไม่งั้นแถบล่างทับชิปผู้ใช้ท้ายลิ้นชัก

const PANEL_STYLE = {
  backgroundColor: 'var(--color-primary-dark)',
  backgroundImage: 'linear-gradient(180deg, var(--color-primary-dark) 0%, color-mix(in srgb, var(--color-primary-dark) 45%, #020617) 100%)',
}
const ACTIVE_STYLE = {
  backgroundColor: 'var(--color-primary)',
  backgroundImage: 'linear-gradient(90deg, var(--color-primary) 0%, color-mix(in srgb, var(--color-primary) 55%, #6366f1) 100%)',
  boxShadow: '0 8px 18px -8px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.22)',
}
const DEFAULT_HOME = { key: 'home', label: 'แดชบอร์ด', Icon: LayoutDashboard }

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

function DrawerItem({ item, active, badge, onSelect }) {
  const count = Number(badge) > 0 ? Number(badge) : 0
  const Icon = item.Icon
  return (
    <button type="button" data-drawer-item={item.key} aria-current={active ? 'page' : undefined}
      onClick={() => onSelect(item)}
      className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/70 ${active ? 'text-white' : 'text-white/80 active:bg-white/10'}`}
      style={active ? ACTIVE_STYLE : undefined}>
      <Icon size={19} strokeWidth={active ? 2.2 : 1.7} aria-hidden="true" className="shrink-0" />
      <span data-drawer-label className="min-w-0 flex-1 leading-snug">{item.label}</span>
      {count > 0 && (
        <span data-drawer-badge className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold leading-none text-white">
          {count > 99 ? '99+' : count}
          <span className="sr-only"> รายการรอ</span>
        </span>
      )}
    </button>
  )
}

// count (ถ้ามี) = ชิปตัวเลขท้ายหัวกลุ่ม เช่น จำนวนรายการทั้งหมดของ "หมวดหมู่ข้อมูล"
export function GroupLabel({ children, accent, count }) {
  return (
    <div className="flex items-center gap-2 px-3 pb-1.5 pt-4">
      {accent && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: accent }} />}
      <span className="text-[11px] font-bold tracking-wide text-white/60">{children}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-white/15" />
      {count != null && <span className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white/80">{count}</span>}
    </div>
  )
}

// children = เนื้อหาต่อท้ายกลุ่มเมนู ในกรอบเลื่อนเดียวกัน — ใช้กับของที่ไม่ใช่ปุ่มเมนูธรรมดา
// (ทรีหมวดหมู่ของหน้าศูนย์ข้อมูล ซึ่งกาง/พับได้และมีปุ่มเพิ่มข้อมูลต่อแถว) ผู้ส่งต้องปิดลิ้นชักเองเมื่อเลือกปลายทาง
export default function PortalDrawer({
  open, onClose, tenant, portalLabel, ariaLabel, homeItem = DEFAULT_HOME, homeGroupLabel = 'ภาพรวม', extraItems = [],
  groups, activeKey, badges, onSelect, children,
}) {
  const { role, displayName, avatarUrl } = useAuth()
  const panelRef = useRef(null)
  const closeRef = useRef(null)
  const returnFocusTo = useRef(null)
  const touch = useRef(null)

  // เปิด: จำปุ่มที่กดมา + ย้ายโฟกัสเข้าลิ้นชัก · ปิด: คืนโฟกัสให้ปุ่มเดิม (คนใช้คีย์บอร์ด/โปรแกรมอ่านหน้าจอไม่หลง)
  useEffect(() => {
    if (!open) return undefined
    returnFocusTo.current = document.activeElement
    closeRef.current?.focus()
    const onKeyDown = (e) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab' || !panelRef.current) return
      // วนโฟกัสอยู่ในลิ้นชัก ไม่หลุดไปปุ่มหลังฉากที่มองไม่เห็น
      const nodes = [...panelRef.current.querySelectorAll(FOCUSABLE)]
      if (!nodes.length) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      returnFocusTo.current?.focus?.()
    }
  }, [open, onClose])

  // ปัดซ้ายเพื่อปิด — นับเฉพาะการปัดแนวนอนชัดเจน (กันไปชนกับการเลื่อนรายการขึ้นลง)
  const onTouchStart = (e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }
  const onTouchEnd = (e) => {
    const start = touch.current
    touch.current = null
    if (!start) return
    const dx = e.changedTouches[0].clientX - start.x
    const dy = e.changedTouches[0].clientY - start.y
    if (dx < -60 && Math.abs(dy) < 40) onClose()
  }

  const roleLabel = ROLE_LABELS[role]?.label ?? (role === 'superadmin' ? 'Super Admin' : 'ผู้ใช้งาน')

  return (
    <div className="md:hidden">
      {/* ฉากหลัง: touch-none กันนิ้วเลื่อนหน้าด้านหลังตอนลิ้นชักเปิด */}
      <div aria-hidden="true" onClick={onClose} data-drawer-backdrop
        className={`fixed inset-0 z-[55] touch-none bg-slate-950/55 backdrop-blur-[2px] transition-opacity duration-200 ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`} />
      {/* ปิดอยู่ = invisible (ถอดออกจากลำดับ Tab และจากโปรแกรมอ่านหน้าจอ)
          ⚠️ visibility ต้อง "แสดงทันที" ตอนเปิด (0s) และ "หน่วงจนเลื่อนออกสุดค่อยซ่อน" ตอนปิด (200ms) —
          ถ้าให้ transition เท่ากันทั้งสองทาง ตอนเปิดจะยังเป็น hidden ในจังหวะที่สั่ง focus() โฟกัสเลยไม่เข้า
          (เทสต์ tests/portal-drawer-layout.playwright.mjs จับได้) */}
      <aside id="portal-drawer" ref={panelRef} role="dialog" aria-modal="true" aria-label={ariaLabel}
        onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
        className={`fixed inset-y-0 left-0 z-[60] flex w-[min(86vw,320px)] flex-col text-white shadow-2xl motion-reduce:[transition:none] ${open ? 'visible translate-x-0 [transition:transform_200ms,visibility_0s]' : 'invisible -translate-x-full [transition:transform_200ms,visibility_0s_linear_200ms]'}`}
        style={PANEL_STYLE}>
        <div className="flex items-center gap-3 px-4 pb-3 pt-4">
          {tenant?.logo_url
            ? <img src={tenant.logo_url} alt="" className="h-11 w-11 shrink-0 rounded-full border border-white/25 bg-white/10 object-contain p-0.5" />
            : <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/30 bg-white/15 text-lg font-bold">{tenant?.name?.[0] ?? '?'}</div>}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold leading-tight">{tenant?.name ?? 'SmartLocal'}</p>
            <span className="mt-1 inline-block rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest">{portalLabel}</span>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="ปิดเมนู"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white/80 outline-none active:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="เมนูโมดูล" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 [scrollbar-color:rgba(255,255,255,0.35)_transparent] [scrollbar-width:thin]">
          <GroupLabel>{homeGroupLabel}</GroupLabel>
          <DrawerItem item={homeItem} active={activeKey === homeItem.key} onSelect={onSelect} />
          {/* ทางลัดเพิ่มใต้ "ภาพรวม" (เช่น แอดมิน → แดชบอร์ดเจ้าหน้าที่ ตามเมนูซ้าย PC) — ไม่ใช่กลุ่มเมนูโมดูล */}
          {extraItems.map(item => <DrawerItem key={item.key} item={item} active={activeKey === item.key} onSelect={onSelect} />)}
          {groups.map(({ group, accent, items }) => (
            <div key={group}>
              <GroupLabel accent={accent}>{group}</GroupLabel>
              <div className="space-y-0.5">
                {items.map(item => (
                  <DrawerItem key={item.key} item={item} active={activeKey === item.key}
                    badge={badges?.[item.key]} onSelect={onSelect} />
                ))}
              </div>
            </div>
          ))}
          {children}
        </nav>

        {/* ชิปผู้ใช้ — แตะไปหน้าโปรไฟล์ (ปุ่มรูปโปรไฟล์บนหัวจอพาไปที่เดียวกัน) · ใต้ safe-area บน iPhone */}
        <div className="px-3 pt-1" style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' }}>
          <Link to="/profile" onClick={onClose} data-drawer-user
            className="flex min-h-14 items-center gap-3 rounded-2xl border border-white/15 bg-white/10 px-3 py-2 outline-none active:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/70">
            {avatarUrl
              ? <img src={avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full border border-white/40 object-cover" />
              : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/40 bg-white/20 text-sm font-bold">{(displayName || '?')[0].toUpperCase()}</span>}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-bold leading-tight">{displayName || 'ไม่ทราบชื่อ'}</span>
              <span className="block truncate text-[11px] leading-tight text-white/70">{roleLabel} · แตะเพื่อดูโปรไฟล์</span>
            </span>
          </Link>
        </div>
      </aside>
    </div>
  )
}
