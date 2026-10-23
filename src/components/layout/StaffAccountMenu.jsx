import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, FileSignature, LogOut, UserRound } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { ROLE_LABELS } from '../../lib/staffRoster'

// เมนูบัญชีบนหัวจอ PC ของหน้าเจ้าหน้าที่ — ปุ่มหน้าตาเดียวกับ UserProfileBadge (ชื่อ + ตำแหน่ง + รูป)
// แต่กดแล้วเปิดเมนู "โปรไฟล์ของฉัน / ออกจากระบบ" แทนที่จะพาไปหน้าโปรไฟล์ทันที
// ปุ่ม "ออกจากระบบ" เดิมวางเด่นอยู่บนหัวจอ ทั้งที่การออกจากระบบเป็นของที่ไม่ควรกดพลาด (ออกจากทุกอุปกรณ์)
// ไม่แก้ UserProfileBadge เพราะใช้ร่วมอีกหลายหน้า (ประชาชน/แอดมิน) — ไฟล์นี้ใช้เฉพาะหน้าเจ้าหน้าที่
//
// รายการ "ลายเซ็นของฉัน" พาไป /profile#signature (ส่วนลายเซ็นในหน้าโปรไฟล์ เปิดและเลื่อนมาให้เอง) — รหัสลงนาม/ภาพลายเซ็น/ประวัติอยู่ที่นั่น
//
// แป้นพิมพ์: เปิดแล้วโฟกัสรายการแรก · ↑ ↓ Home End เลื่อนรายการ · Esc ปิดแล้วคืนโฟกัสปุ่ม · Tab ปิดเมนู
export default function StaffAccountMenu({ onLogout }) {
  const { session, role, displayName, avatarUrl } = useAuth()
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const buttonRef = useRef(null)
  const menuRef = useRef(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return undefined
    const items = () => [...(menuRef.current?.querySelectorAll('[role="menuitem"]') ?? [])]
    items()[0]?.focus()
    const onPointerDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false) }
    const onKeyDown = (e) => {
      if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); return }
      if (e.key === 'Tab') { setOpen(false); return }
      const list = items()
      const at = list.indexOf(document.activeElement)
      if (e.key === 'ArrowDown') { e.preventDefault(); list[(at + 1) % list.length]?.focus() }
      else if (e.key === 'ArrowUp') { e.preventDefault(); list[(at - 1 + list.length) % list.length]?.focus() }
      else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus() }
      else if (e.key === 'End') { e.preventDefault(); list.at(-1)?.focus() }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (!session) return null

  const roleLabel = ROLE_LABELS[role]?.label ?? (role === 'superadmin' ? 'Super Admin' : 'ผู้ใช้งาน')
  const initialChar = (displayName || '?')[0].toUpperCase()
  const itemCls = 'flex min-h-11 w-full items-center gap-2.5 px-4 py-2 text-left text-sm font-semibold outline-none transition-colors focus-visible:bg-slate-100'

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button ref={buttonRef} type="button" data-account-menu-button
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        title={`บัญชีของคุณ: ${displayName || 'ผู้ใช้งาน'}`}
        onClick={() => setOpen(v => !v)}
        className="group flex min-h-11 select-none items-center gap-2.5 rounded-full border border-white/20 bg-white/5 px-3 py-1 text-white transition-all hover:border-white/40 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
        <span className="min-w-0 text-right">
          <span className="block max-w-[10rem] truncate text-xs font-bold leading-tight sm:max-w-[13rem]">{displayName || 'ไม่ทราบชื่อ'}</span>
          <span className="mt-0.5 block max-w-[10rem] truncate text-[10px] leading-tight text-white/75 sm:max-w-[13rem]">{roleLabel}</span>
        </span>
        {avatarUrl
          ? <img src={avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full border border-white/40 object-cover" />
          : <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/40 bg-white/20 text-xs font-bold">{initialChar}</span>}
        <ChevronDown size={14} aria-hidden="true" className={`shrink-0 text-white/70 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div ref={menuRef} id={menuId} role="menu" aria-label="เมนูบัญชี" data-account-menu
          className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-2xl bg-white py-1.5 text-slate-800 shadow-xl ring-1 ring-black/10">
          <div className="border-b border-slate-100 px-4 pb-2 pt-1.5">
            <p className="truncate text-sm font-bold">{displayName || 'ไม่ทราบชื่อ'}</p>
            <p className="truncate text-xs text-slate-500">{roleLabel}</p>
          </div>
          <Link to="/profile" role="menuitem" data-account-profile onClick={() => setOpen(false)}
            className={`${itemCls} text-slate-700 hover:bg-slate-50`}>
            <UserRound size={16} aria-hidden="true" /> โปรไฟล์ของฉัน
          </Link>
          <Link to="/profile#signature" role="menuitem" data-account-signature onClick={() => setOpen(false)}
            className={`${itemCls} text-slate-700 hover:bg-slate-50`}>
            <FileSignature size={16} aria-hidden="true" /> ลายเซ็นของฉัน
          </Link>
          <div className="my-1 border-t border-slate-100" />
          <button type="button" role="menuitem" data-account-logout
            onClick={() => { setOpen(false); onLogout() }}
            className={`${itemCls} text-red-600 hover:bg-red-50 focus-visible:bg-red-50`}>
            <LogOut size={16} aria-hidden="true" /> ออกจากระบบ
          </button>
        </div>
      )}
    </div>
  )
}
