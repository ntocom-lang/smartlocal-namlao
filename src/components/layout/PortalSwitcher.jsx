import { Link, useLocation } from 'react-router-dom'
import { Home, Briefcase, LayoutDashboard, Terminal } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import {
  canAccessAdminPortal,
  canAccessStaffPortal,
  currentPortal,
  isDevUser,
} from '../../lib/portalAccess'

const TONE = {
  onDark: {
    idle: {
      backgroundColor: 'rgba(255,255,255,0.16)',
      color: '#fff',
      borderColor: 'rgba(255,255,255,0.22)',
    },
    active: {
      backgroundColor: '#fff',
      color: 'var(--color-primary)',
      borderColor: 'transparent',
    },
  },
  onLight: {
    idle: {
      backgroundColor: 'rgba(15,23,42,0.06)',
      color: '#334155',
      borderColor: 'rgba(15,23,42,0.12)',
    },
    active: {
      backgroundColor: 'var(--color-primary)',
      color: '#fff',
      borderColor: 'transparent',
    },
  },
}

export default function PortalSwitcher({ className = 'hidden md:flex', tone = 'onDark' }) {
  const { session, role } = useAuth()
  const location = useLocation()
  const uid = session?.user?.id
  const canStaff = canAccessStaffPortal(role)
  const canAdmin = canAccessAdminPortal(role)
  const canDev = isDevUser(uid)

  if (!session || (!canStaff && !canAdmin && !canDev)) return null

  const current = currentPortal(location.pathname)
  const palette = TONE[tone] ?? TONE.onDark

  const items = [
    { key: 'citizen', to: '/',           label: 'เว็บหลัก',     title: 'เว็บหลัก',              Icon: Home },
    canStaff && { key: 'staff', to: '/staff',       label: 'เจ้าหน้าที่', title: 'สำหรับเจ้าหน้าที่',     Icon: Briefcase },
    canAdmin && { key: 'admin', to: '/admin',       label: role === 'viewer' ? 'รายงาน' : 'Admin', title: role === 'viewer' ? 'รายงาน' : 'แผงควบคุม Admin', Icon: LayoutDashboard },
    canDev   && { key: 'dev',   to: '/dev-journal', label: 'ผู้พัฒนา',    title: 'ผู้พัฒนาระบบ',        Icon: Terminal },
  ].filter(Boolean)

  if (items.length < 2) return null

  return (
    <nav aria-label="สลับมุมมองระบบ" className={`items-center gap-1.5 flex-nowrap ${className}`}>
      {items.map(({ key, to, label, title, Icon }) => {
        const active = current === key
        return (
          <Link
            key={key}
            to={to}
            title={title}
            aria-current={active ? 'page' : undefined}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border shrink-0 transition-colors hover:opacity-90"
            style={active ? palette.active : palette.idle}
          >
            <Icon size={14} />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
