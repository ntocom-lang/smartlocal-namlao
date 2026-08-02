import { Home, ClipboardList, Search, Bell, LayoutGrid, Wrench, CalendarDays, FileSearch } from 'lucide-react'

export const NAV_CITIZEN = [
  { label: 'หน้าแรก',      icon: Home,          href: '/' },
  { label: 'ยื่นคำร้อง',    icon: ClipboardList, href: '/complaint' },
  { label: 'ค้นหา',        icon: Search,        href: '/search' },
  { label: 'ปฏิทินกิจกรรม', icon: CalendarDays, href: '/events' },
  { label: 'เมนูอื่นๆ',    icon: LayoutGrid,    href: '/more' },
]

export const NAV_TECH = [
  { label: 'หน้าแรก',      icon: Home,          href: '/' },
  { label: 'งานของฉัน',    icon: Wrench,        href: '/technician' },
  { label: 'คำร้องของฉัน', icon: FileSearch,    href: '/my-complaints' },
  { label: 'การแจ้งเตือน', icon: Bell,          href: '/notifications' },
  { label: 'เมนูอื่นๆ',    icon: LayoutGrid,    href: '/more' },
]
