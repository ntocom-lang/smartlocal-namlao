import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Bell, ChevronDown, FileSignature, LogOut, Settings, ShieldCheck, UserRound, UsersRound } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useNotifications } from '../../contexts/NotificationsContext'
import { ROLE_LABELS } from '../../lib/staffRoster'
import { canAccessStaffPortal } from '../../lib/portalAccess'
import { signOutSafely } from '../../lib/supabase'

// เมนูชุดเดียวกันทุกพอร์ทัล/ขนาดจอ คงชื่อ export เดิมให้หน้าเจ้าหน้าที่ใช้ต่อได้
// วางเมนูใน body เพื่อไม่ถูก overflow-hidden ของหัวจอตัด แล้วจำกัดให้อยู่ในจอ
export default function StaffAccountMenu({ onLogout, onSystemSettings, tone = 'onDark', compact = false, showRole = true, className = '' }) {
  const { session, role, displayName, avatarUrl } = useAuth()
  const { unreadCount } = useNotifications()
  const location = useLocation()
  const navigate = useNavigate()
  const [openedAt, setOpenedAt] = useState(null)
  const [failedAvatar, setFailedAvatar] = useState(null)
  const buttonRef = useRef(null)
  const menuRef = useRef(null)
  const focusLastRef = useRef(false)
  const menuId = useId()
  // เปลี่ยนหน้าแล้วปิดทันที แม้หัวจอยัง mount อยู่
  const open = !!session && openedAt === location.key
  const hasAvatar = avatarUrl && failedAvatar !== avatarUrl
  const isLight = tone === 'onLight'
  const roleLabel = ROLE_LABELS[role]?.label ?? (role === 'superadmin' ? 'Super Admin' : 'ผู้ใช้งาน')
  const name = displayName || 'ผู้ใช้งาน'
  const initial = Array.from(name)[0].toUpperCase()

  useLayoutEffect(() => {
    if (!open) return undefined
    const place = () => {
      const button = buttonRef.current
      const menu = menuRef.current
      if (!button || !menu) return
      const view = window.visualViewport
      const leftEdge = (view?.offsetLeft ?? 0) + 8
      const topEdge = (view?.offsetTop ?? 0) + 8
      const rightEdge = leftEdge + (view?.width ?? document.documentElement.clientWidth) - 16
      const bottomEdge = topEdge + (view?.height ?? window.innerHeight) - 16
      const rect = button.getBoundingClientRect()
      const width = Math.min(320, rightEdge - leftEdge)
      const below = bottomEdge - rect.bottom - 8
      const above = rect.top - topEdge - 8
      const upwards = below < Math.min(menu.scrollHeight, 240) && above > below
      const maxHeight = Math.max(44, upwards ? above : below)
      menu.style.width = `${width}px`
      menu.style.maxHeight = `${maxHeight}px`
      menu.style.left = `${Math.max(leftEdge, Math.min(rect.right - width, rightEdge - width))}px`
      menu.style.top = `${Math.max(topEdge, upwards ? rect.top - 8 - Math.min(menu.scrollHeight, maxHeight) : rect.bottom + 8)}px`
    }
    place()
    const items = menuRef.current.querySelectorAll('[role="menuitem"]')
    items[focusLastRef.current ? items.length - 1 : 0]?.focus({ preventScroll: true })
    focusLastRef.current = false
    const move = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      // เปลี่ยน breakpoint จนปุ่มเดิมถูกซ่อน หรือเลื่อนหัวจอพ้นจอแล้ว ปิดเมนูของปุ่มนั้น
      if (!rect?.width || rect.bottom <= 0 || rect.top >= window.innerHeight) setOpenedAt(null)
      else place()
    }
    window.addEventListener('resize', move)
    window.addEventListener('scroll', move, true)
    window.visualViewport?.addEventListener('resize', move)
    window.visualViewport?.addEventListener('scroll', move)
    return () => {
      window.removeEventListener('resize', move)
      window.removeEventListener('scroll', move, true)
      window.visualViewport?.removeEventListener('resize', move)
      window.visualViewport?.removeEventListener('scroll', move)
    }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const closeOutside = (e) => {
      if (!buttonRef.current?.contains(e.target) && !menuRef.current?.contains(e.target)) setOpenedAt(null)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('focusin', closeOutside)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('focusin', closeOutside)
    }
  }, [open])

  if (!session) return null

  function menuKeyDown(e) {
    const items = [...menuRef.current.querySelectorAll('[role="menuitem"]')]
    const at = items.indexOf(document.activeElement)
    if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation() }
      // คืนโฟกัสไปปุ่มก่อนปล่อย Tab ให้เบราว์เซอร์ไปยังรายการถัดไปตามลำดับหัวจอจริง
      buttonRef.current?.focus({ preventScroll: true })
      setOpenedAt(null)
      return
    }
    const target = e.key === 'ArrowDown' ? (at + 1) % items.length
      : e.key === 'ArrowUp' ? (at - 1 + items.length) % items.length
        : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null
    if (target !== null) {
      e.preventDefault()
      items[target]?.focus({ preventScroll: true })
      items[target]?.scrollIntoView({ block: 'nearest' })
    }
  }

  async function logout() {
    setOpenedAt(null)
    if (onLogout) await onLogout()
    else { await signOutSafely('/'); navigate('/') }
  }

  const avatar = (large = false) => (
    <span aria-hidden="true" className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white/60 font-bold ${large ? 'h-14 w-14 bg-white/15 text-xl' : `h-9 w-9 text-sm ${isLight ? 'border-slate-200 bg-slate-200 text-slate-700' : 'bg-white/15 text-white'}`}`}>
      {hasAvatar ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" onError={() => setFailedAvatar(avatarUrl)} /> : initial}
    </span>
  )
  const itemCls = 'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-700 outline-none transition-colors hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400 [&>svg]:shrink-0 [&>svg]:text-slate-500'
  const close = () => setOpenedAt(null)

  return (
    <div className={`shrink-0 ${className}`}>
      <button ref={buttonRef} type="button" data-account-menu-button
        aria-label={`เมนูบัญชีของ ${name}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        title={`บัญชีของคุณ: ${name}`} onClick={() => setOpenedAt(open ? null : location.key)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            focusLastRef.current = e.key === 'ArrowUp'
            setOpenedAt(location.key)
          }
        }}
        className={`group flex min-h-11 min-w-11 select-none items-center justify-center gap-2.5 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${compact ? 'p-0.5' : 'px-2 py-1'} ${isLight ? 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100 focus-visible:ring-slate-500' : 'border-white/25 bg-white/10 text-white hover:bg-white/20 focus-visible:ring-white'}`}>
        {avatar()}
        {!compact && <>
          <span className="min-w-0 text-left">
            <span className="block max-w-[10rem] truncate text-xs font-bold leading-tight sm:max-w-[13rem]">{name}</span>
            {showRole && <span className={`mt-0.5 block text-[10px] leading-tight ${isLight ? 'text-slate-500' : 'text-white/75'}`}>{roleLabel}</span>}
          </span>
          <ChevronDown size={14} aria-hidden="true" className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </>}
      </button>
      {open && createPortal(
        <div ref={menuRef} id={menuId} role="menu" aria-label="เมนูบัญชี" data-account-menu onKeyDown={menuKeyDown}
          className="fixed z-[80] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-1.5 text-slate-800 shadow-2xl"
          style={{ width: 'min(20rem, calc(100vw - 1rem))' }}>
          <div role="presentation" className="relative overflow-hidden rounded-xl px-4 py-5 text-white"
            style={{ background: 'linear-gradient(125deg, var(--color-primary, #0f766e), #334eac)' }}>
            <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full opacity-10" width="320" height="120">
              <defs><pattern id={`${menuId}-pattern`} width="28" height="28" patternUnits="userSpaceOnUse"><path d="M14 2v24M2 14h24M5 5l18 18M5 23L23 5" stroke="white" fill="none" /><circle cx="14" cy="14" r="7" stroke="white" fill="none" /></pattern></defs>
              <rect width="100%" height="100%" fill={`url(#${menuId}-pattern)`} />
            </svg>
            <div className="relative flex items-center gap-3">
              {avatar(true)}
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-bold leading-snug">{name}</p>
                <span className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/15 px-2 py-1 text-xs">
                  <UsersRound size={13} aria-hidden="true" className="shrink-0" /> {roleLabel}
                </span>
              </div>
            </div>
          </div>
          <div role="presentation" className="space-y-0.5 px-1 py-2">
            <Link to="/profile" role="menuitem" data-account-profile onClick={close} className={itemCls}><UserRound size={18} aria-hidden="true" />โปรไฟล์ของฉัน</Link>
            {canAccessStaffPortal(role) && <Link to="/profile#signature" role="menuitem" data-account-signature onClick={close} className={itemCls}><FileSignature size={18} aria-hidden="true" />ลายเซ็นของฉัน</Link>}
            <Link to="/notifications" role="menuitem" data-account-notifications onClick={close} className={itemCls}>
              <Bell size={18} aria-hidden="true" /><span className="flex-1">การแจ้งเตือน</span>
              {unreadCount > 0 && <span className="rounded-full bg-red-50 px-2 text-xs font-bold text-red-600">{unreadCount > 99 ? '99+' : unreadCount}</span>}
            </Link>
            <Link to="/profile#security" role="menuitem" data-account-security onClick={close} className={itemCls}><ShieldCheck size={18} aria-hidden="true" />ความปลอดภัย</Link>
            {(role === 'admin' || role === 'superadmin') && <Link to="/admin" state={{ page: 'system-settings' }} role="menuitem" data-account-settings
              onClick={e => { close(); if (onSystemSettings) { e.preventDefault(); onSystemSettings() } }} className={itemCls}><Settings size={18} aria-hidden="true" />ตั้งค่าระบบ</Link>}
          </div>
          <div role="separator" className="mx-3 border-t border-slate-200" />
          <div role="presentation" className="p-1 pt-2">
            <button type="button" role="menuitem" data-account-logout onClick={logout} className={`${itemCls} text-red-600 hover:bg-red-50 focus-visible:bg-red-50 [&>svg]:text-red-500`}><LogOut size={18} aria-hidden="true" />ออกจากระบบ</button>
          </div>
        </div>, document.body,
      )}
    </div>
  )
}
