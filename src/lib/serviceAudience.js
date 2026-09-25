// ใครยื่นบริการประเภทนี้ได้ — "ทุกคน" หรือ "เฉพาะผู้มีตำแหน่ง" (ตั้งรายประเภทในหน้าแอดมิน)
//
// ทำไมต้องมี: เจ้าของระบบต้องการเปิดบริการใหม่ให้ผู้มีตำแหน่งใช้ก่อน แล้วค่อยเปิดให้ประชาชน
// เช่น คำร้องไฟฟ้าสาธารณะให้ สท. แจ้งแทนประชาชนในเขตไปก่อน (ตัดสินใจ 2569-09-25)
// เดิมมีแค่สวิตช์เปิด/ปิดซึ่งมีผลกับทุกคนพร้อมกัน
//
// "ผู้มีตำแหน่ง" = บัญชีที่ role ไม่ใช่ประชาชน = ชุดเดียวกับ role ที่เข้าหน้าเจ้าหน้าที่ได้
// (เปลี่ยน role เป็นประชาชนแล้วหน้าจัดการผู้ใช้ล้างตำแหน่งให้เอง จึงไม่มีประชาชนที่ถือตำแหน่ง)
// role ที่ useAuth() คืนมาถูกลดเป็น citizen เองเมื่อเปิดเว็บของ อปท. อื่น — ตรงกับด่านฐานข้อมูล
// ที่เทียบสังกัดด้วย
//
// ⚠️ ที่นี่แค่ซ่อนตัวเลือกให้ตรงกับสิทธิ์ ด่านบังคับจริงอยู่ที่ฐานข้อมูล
// (submit_citizen_complaint_v4 ใน 20260925100100) ลิสต์ role ต้องตรงกันทั้งสองที่
// — tests/service-audience.test.mjs เทียบให้ทุกครั้ง
import { STAFF_PORTAL_ROLES } from './portalAccess.js'

export const SUBMIT_AUDIENCE_PUBLIC = 'public'
export const SUBMIT_AUDIENCE_OFFICIALS = 'officials'

export const OFFICIAL_ROLES = STAFF_PORTAL_ROLES

export function isOfficialRole(role) {
  return OFFICIAL_ROLES.includes(role)
}

/** หมวดคำร้องนี้เปิดให้เฉพาะผู้มีตำแหน่งไหม — ไม่มีค่า (ข้อมูลรุ่นเก่า/ค่าสำรองในโค้ด) = ทุกคน */
export function isOfficialsOnlyCategory(category) {
  return category?.submit_audience === SUBMIT_AUDIENCE_OFFICIALS
}

/** role นี้ยื่นคำร้องหมวดนี้ได้ไหม */
export function canSubmitCategory(category, role) {
  return !isOfficialsOnlyCategory(category) || isOfficialRole(role)
}

/** ตัดหมวดที่ role นี้ยื่นไม่ได้ออกจากลิสต์ — รับ array ของ object ที่มี .submit_audience */
export function withoutOfficialsOnlyCategories(categories, role) {
  if (!Array.isArray(categories) || isOfficialRole(role)) return categories
  return categories.filter(category => !isOfficialsOnlyCategory(category))
}
