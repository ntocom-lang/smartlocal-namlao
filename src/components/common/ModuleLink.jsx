import { Link } from 'react-router-dom'
import { useTenant } from '../../contexts/TenantContext'
import { moduleForPath } from '../../lib/staffModules'

// ลิงก์ที่หายไปทั้งอันเมื่อปลายทางเป็นหน้าของโมดูลที่ อปท. ไม่ได้เปิดใช้งาน
//
// ใช้แทน <Link> ในจุดที่เป็นลิงก์เดี่ยวๆ ในธีม (การ์ดทางลัด แถบเมนู) ซึ่งห่อด้วย withModule ไม่ได้
// เพราะไม่ใช่คอมโพเนนต์ของตัวเอง — โมดูลที่คุมมันอ่านจาก MODULE_ROUTES ตาม to ที่ส่งมา ไม่ต้องระบุเอง
export default function ModuleLink({ to, children, ...rest }) {
  const { isModuleEnabled } = useTenant()
  const moduleKey = moduleForPath(typeof to === 'string' ? to : '')
  if (moduleKey && !isModuleEnabled(moduleKey)) return null
  return <Link to={to} {...rest}>{children}</Link>
}
