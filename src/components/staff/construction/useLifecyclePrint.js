// ปุ่มพิมพ์ใบวงจรโครงการ (P8–P12) ใช้ร่วม 3 คอมโพเนนต์ — หา tenant เองจาก TenantContext เพื่อไม่ต้องเจาะ prop ผ่าน ProjectLifecycleSheet
//   tenant = ชื่อ/ที่อยู่ อปท. ที่ใบพิมพ์ต้องใช้ · ผู้ลงนามกับชื่อกองโหลดตอนกดพิมพ์ (openLifecyclePrint) ไม่ใช่ตอนเปิดหน้า
// ⚠️ ห่อ useTenant ด้วย try/catch: เทสต์ SSR ของหน้าจอวงจรโครงการ (tests/construction-*-ui.test.mjs) เรนเดอร์คอมโพเนนต์โดยไม่มี TenantProvider
//    useTenant() throw ตอนไม่มี provider — useContext ถูกเรียกก่อน throw เสมอ ลำดับ hook จึงคงที่ · ในแอปจริงมี provider ครอบเสมอ
//    ไม่มี tenant = ปุ่มพิมพ์ปิดไว้ (printable=false) แทนที่จะพิมพ์ใบที่ไม่มีชื่อหน่วยงาน
import { useCallback } from 'react'
import { useTenant } from '../../../contexts/TenantContext'
import { openLifecyclePrint } from '../../../lib/constructionLifecyclePrint'

// ปุ่มพิมพ์ขนาดเล็ก (ปุ่มรอง) หน้าตาเดียวกับ btnGhost แต่เล็กกว่า — ใช้ร่วม 3 คอมโพเนนต์
export const PRINT_BUTTON_CLASS = 'inline-flex min-h-9 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50'

export default function useLifecyclePrint(project) {
  let tenant = null
  // eslint-disable-next-line react-hooks/rules-of-hooks -- เหตุผลตามหัวไฟล์: useContext ถูกเรียกทุกครั้งก่อน throw ลำดับ hook ไม่เปลี่ยน
  try { tenant = useTenant().tenant ?? null } catch { tenant = null }
  const municipalityId = project?.municipality_id ?? tenant?.id ?? null
  const departmentId = project?.department_id ?? null
  // build = ({ tenant, signatories, departmentName, emblemUrl }) => html
  const print = useCallback(
    build => openLifecyclePrint(ctx => build({ tenant, ...ctx }), { municipalityId, departmentId }),
    [tenant, municipalityId, departmentId],
  )
  return { print, printable: Boolean(tenant) }
}
