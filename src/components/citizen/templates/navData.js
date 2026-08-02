import { Home, ClipboardList, Bot, CalendarDays, LayoutGrid, Wrench, Briefcase, ShieldCheck } from 'lucide-react'

export function getNavItems(role) {
  const isAdmin = ['admin', 'superadmin', 'viewer'].includes(role)
  const isStaff = ['staff', 'officer', 'council', 'kamnan'].includes(role)
  const isTech  = role === 'technician'

  let roleNavItem = { label: 'ยื่นคำร้อง', icon: ClipboardList, href: '/complaint' }
  if (isTech) {
    roleNavItem = { label: 'งานของฉัน', icon: Wrench, href: '/technician' }
  } else if (isStaff) {
    roleNavItem = { label: 'ระบบเจ้าหน้าที่', icon: Briefcase, href: '/staff' }
  } else if (isAdmin) {
    roleNavItem = { label: 'ระบบเจ้าหน้าที่', icon: ShieldCheck, href: '/admin' }
  }

  return [
    { label: 'หน้าแรก',       icon: Home,         href: '/' },
    roleNavItem,
    { label: 'ถาม AI',        icon: Bot,          href: '/chatbot' },
    { label: 'ปฏิทินกิจกรรม', icon: CalendarDays, href: '/events' },
    { label: 'เมนูอื่นๆ',    icon: LayoutGrid,   href: '/more' },
  ]
}

export const NAV_CITIZEN = getNavItems('citizen')
export const NAV_TECH    = getNavItems('technician')
