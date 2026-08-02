import { Home, ClipboardList, Search, Bell, LayoutGrid, Wrench, Briefcase, ShieldCheck } from 'lucide-react'

export function getNavItems(role) {
  const isAdmin = ['admin', 'superadmin', 'viewer'].includes(role)
  const isStaff = ['staff', 'officer', 'council', 'kamnan'].includes(role)
  const isTech  = role === 'technician'

  let roleNavItem = { label: 'ยื่นคำร้อง', icon: ClipboardList, href: '/doc-request' }
  if (isTech) {
    roleNavItem = { label: 'งานของฉัน', icon: Wrench, href: '/technician' }
  } else if (isStaff) {
    roleNavItem = { label: 'ระบบเจ้าหน้าที่', icon: Briefcase, href: '/staff' }
  } else if (isAdmin) {
    roleNavItem = { label: 'แอดมิน', icon: ShieldCheck, href: '/admin' }
  }

  return [
    { label: 'หน้าแรก',   icon: Home,       href: '/' },
    roleNavItem,
    { label: 'ค้นหา/AI',  icon: Search,     href: '/chatbot' },
    { label: 'แจ้งเตือน', icon: Bell,       href: '/notifications' },
    { label: 'เมนูอื่นๆ', icon: LayoutGrid, href: '/more' },
  ]
}

export const NAV_CITIZEN = getNavItems('citizen')
export const NAV_TECH    = getNavItems('technician')
