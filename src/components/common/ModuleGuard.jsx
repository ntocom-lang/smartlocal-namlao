import { useLocation, Link } from 'react-router-dom'
import { PackageX, ArrowLeft } from 'lucide-react'
import { useTenant } from '../../contexts/TenantContext'
import { moduleForPath } from '../../lib/staffModules'

// กันไม่ให้เข้าหน้าของโมดูลที่ อปท. นี้ไม่ได้เปิดใช้งาน
//
// โมดูลคือ "แพ็กเกจที่ขายให้ อปท. เป็นเรื่องๆ" การซ่อนเมนูอย่างเดียวไม่พอ เพราะลิงก์เก่าที่ประชาชน
// bookmark ไว้ ผลค้นหาจาก Google และลิงก์ในไลน์กลุ่มยังพาเข้าหน้าที่หน่วยงานไม่ได้ซื้อได้อยู่ดี
//
// ครอบ <Routes> ทั้งก้อนจุดเดียวแทนการใส่ทีละ <Route> ด้วยเหตุผล 2 ข้อ:
//   1) route มี 39 เส้น ใส่ทีละอันแล้วพลาดหนึ่งเส้นคือรูรั่วที่ไม่มีใครเห็นจนกว่าลูกค้าจะเจอ
//   2) route ที่เพิ่มทีหลังจะถูกคุมอัตโนมัติจากตาราง MODULE_ROUTES ไม่ต้องมาแก้ 2 ที่
//
// ระหว่าง tenant ยังโหลดไม่เสร็จ isModuleEnabled() คืน true ไว้ก่อน หน้าจึง render ตามปกติ
// ไม่กะพริบเป็นจอ "ไม่ได้เปิดใช้งาน" หนึ่งเฟรมแล้วค่อยกลับมา
export default function ModuleGuard({ children }) {
  const { pathname } = useLocation()
  const { isModuleEnabled } = useTenant()
  const moduleKey = moduleForPath(pathname)

  if (!moduleKey || isModuleEnabled(moduleKey)) return children

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm text-center">
        <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
          <PackageX size={28} className="text-gray-400" strokeWidth={1.75} />
        </div>
        <h1 className="text-base font-bold text-gray-700">ยังไม่ได้เปิดใช้งานบริการนี้</h1>
        <p className="text-sm text-gray-500 mt-2 leading-relaxed">
          หน่วยงานยังไม่ได้เปิดให้บริการส่วนนี้ผ่านเว็บไซต์
          หากต้องการใช้บริการ กรุณาติดต่อสำนักงานโดยตรง
        </p>
        <Link to="/"
          className="mt-6 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold text-white"
          style={{ backgroundColor: 'var(--color-primary)' }}>
          <ArrowLeft size={15} /> กลับหน้าแรก
        </Link>
      </div>
    </div>
  )
}
