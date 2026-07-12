import { Home, ClipboardList, FileSearch, Bell, LayoutGrid, Wrench, CalendarDays } from 'lucide-react'

export const NAV_CITIZEN = [
  { label: 'หน้าแรก',      icon: Home,          href: '/' },
  { label: 'ร้องเรียน',    icon: ClipboardList, href: '/complaint' },
  { label: 'คำร้อง',      icon: FileSearch,    href: '/my-complaints' },
  { label: 'ปฏิทิน',       icon: CalendarDays, href: '/events' },
  { label: 'เมนูอื่นๆ',    icon: LayoutGrid,    href: '/more' },
]

export const NAV_TECH = [
  { label: 'หน้าแรก',      icon: Home,          href: '/' },
  { label: 'งานของฉัน',    icon: Wrench,        href: '/technician' },
  { label: 'คำร้องของฉัน', icon: FileSearch,    href: '/my-complaints' },
  { label: 'การแจ้งเตือน', icon: Bell,          href: '/notifications' },
  { label: 'เมนูอื่นๆ',    icon: LayoutGrid,    href: '/more' },
]
