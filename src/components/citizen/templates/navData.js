import { Home, ClipboardList, FileBarChart, CalendarDays, LayoutGrid, Wrench, Briefcase, ShieldCheck } from 'lucide-react'
import { moduleForPath } from '../../../lib/staffModules'

// เมนูล่างของหน้าประชาชน ใช้ร่วมกันทั้ง 7 ธีม
//
// isModuleEnabled: ส่งมาจาก BottomNav ของแต่ละธีม (useTenant) เพื่อตัดเมนูของโมดูลที่ อปท. นี้
// ไม่ได้ซื้อออก — โมดูลคือแพ็กเกจที่ขายเป็นเรื่องๆ ถ้าไม่กรองตรงนี้ ปุ่ม "ยื่นคำร้อง" จะยังอยู่กลางจอ
// ทั้งที่หน่วยงานปิดบริการไปแล้ว กดแล้วเจอหน้า "ยังไม่ได้เปิดใช้งาน" ซึ่งดูเหมือนระบบพัง
// ไม่ส่งมา = ไม่กรอง (ค่าเริ่มต้นปลอดภัย ใช้กับที่เรียกนอก React context)
export function getNavItems(role, isModuleEnabled = null) {
  const isAdmin = ['admin', 'superadmin', 'viewer'].includes(role)
  const isStaff = ['staff', 'officer', 'council'].includes(role)
  const isTech  = role === 'technician'

  let roleNavItem = { label: 'ยื่นคำร้อง', icon: ClipboardList, href: '/complaint' }
  if (isTech) {
    roleNavItem = { label: 'งานของฉัน', icon: Wrench, href: '/technician' }
  } else if (isStaff) {
    roleNavItem = { label: 'ระบบเจ้าหน้าที่', icon: Briefcase, href: '/staff' }
  } else if (isAdmin) {
    roleNavItem = { label: 'ระบบเจ้าหน้าที่', icon: ShieldCheck, href: '/staff' }
  }

  const items = [
    { label: 'หน้าแรก',       icon: Home,         href: '/' },
    roleNavItem,
    { label: 'รายงาน',        icon: FileBarChart, href: '/reports/complaints' },
    { label: 'ปฏิทินกิจกรรม', icon: CalendarDays, href: '/events' },
    { label: 'เมนูอื่นๆ',    icon: LayoutGrid,   href: '/more' },
  ]
  if (!isModuleEnabled) return items

  // เมนูล่างของแต่ละธีมวางปุ่มกลางเป็นปุ่มเด่น การตัดออกเฉยๆ ทำให้เหลือ 4 ช่องซึ่งยังใช้ได้ปกติ
  // (ทุกธีม render ด้วย flex justify-around ไม่ได้ fix ที่ 5 ช่อง)
  return items.filter(item => {
    const key = moduleForPath(item.href)
    return !key || isModuleEnabled(key)
  })
}

export const NAV_CITIZEN = getNavItems('citizen')
export const NAV_TECH    = getNavItems('technician')
