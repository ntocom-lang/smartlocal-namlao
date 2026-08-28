import { useTenant } from '../contexts/TenantContext'

// ห่อคอมโพเนนต์ให้ "ไม่ render เลย" ถ้า อปท. นี้ไม่ได้เปิดโมดูลนั้น
//
// ใช้กับแถบ/การ์ดในหน้าแรกที่กระจายอยู่ใน 7 ธีม — ห่อที่ตัวคอมโพเนนต์เองครั้งเดียว ทุกธีมที่ import
// มันไปใช้จึงได้พฤติกรรมเดียวกันทันที ไม่ต้องไล่ใส่เงื่อนไขใน Home.jsx ทั้ง 7 ไฟล์ (และธีมที่ 8
// ที่จะทำในอนาคตก็ได้ไปด้วยฟรีๆ)
//
// ทำเป็น wrapper แทนการ return null ในตัวคอมโพเนนต์เอง เพราะแถบพวกนี้เรียก useState/useEffect
// ต่อจากบรรทัดแรก การใส่ early return ก่อน hooks เหล่านั้นจะผิดกฎ Rules of Hooks
export function withModule(moduleKey, Component) {
  function ModuleGated(props) {
    const { isModuleEnabled } = useTenant()
    if (!isModuleEnabled(moduleKey)) return null
    return <Component {...props} />
  }
  ModuleGated.displayName = `withModule(${moduleKey})(${Component.displayName || Component.name || 'Component'})`
  return ModuleGated
}
