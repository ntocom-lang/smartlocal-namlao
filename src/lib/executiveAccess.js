// ใครเห็น/เปิด "ห้องผู้บริหาร" เป็นหน้าแรก — ฟังก์ชันบริสุทธิ์ (JS ล้วน เทสต์ด้วย node ได้)
//
// นายก/รองนายก = role 'viewer' · ปลัด = role 'officer' ที่ตำแหน่งอยู่หมวด 'top_admin' (positions.category)
// แอดมินเปิดห้องนี้ดูได้ (สวิตช์บนหัวหน้าแรก) แต่หน้าแรกเริ่มต้นของแอดมินยังเป็นหน้าเจ้าหน้าที่เดิม
// ⚠️ นี่เป็นแค่ "หน้าไหนขึ้นก่อน" ไม่ใช่ด่านสิทธิ์ — สิทธิ์ข้อมูลตัดสินที่ RPC/RLS ฝั่งฐานข้อมูลเสมอ

export const EXEC_HOME_ADMIN_ROLES = Object.freeze(['admin', 'superadmin'])

/** true = เปิดหน้าแรกเป็นห้องผู้บริหารเป็นค่าเริ่มต้น */
export function isExecutiveHomeDefault({ role, positionCategory } = {}) {
  return role === 'viewer' || (role === 'officer' && positionCategory === 'top_admin')
}

/** true = มีสวิตช์ "ห้องผู้บริหาร | งานของฉัน" บนหัวหน้าแรก (ค่าเริ่มต้นของผู้บริหาร + แอดมินที่เปิดดูได้) */
export function canOpenExecutiveHome({ role, positionCategory } = {}) {
  return isExecutiveHomeDefault({ role, positionCategory }) || EXEC_HOME_ADMIN_ROLES.includes(role)
}

export const EXEC_HOME_VIEWS = Object.freeze(['executive', 'mine'])

/**
 * หน้าที่จะแสดงจริง: ผู้ใช้เลือกไว้ (จำในเครื่อง) ชนะค่าเริ่มต้น แต่เลือกห้องผู้บริหารไม่ได้ถ้าไม่มีสิทธิ์เปิด
 * @param {{ role?: string, positionCategory?: string|null }} who
 * @param {string|null|undefined} saved  ค่าที่จำไว้ ('executive' | 'mine') — ค่าอื่นถือว่าไม่เคยเลือก
 * @returns {'executive'|'mine'}
 */
export function resolveHomeView(who, saved) {
  if (!canOpenExecutiveHome(who)) return 'mine'
  if (EXEC_HOME_VIEWS.includes(saved)) return saved
  return isExecutiveHomeDefault(who) ? 'executive' : 'mine'
}

// ── จำหน้าที่เลือกไว้ในเครื่อง (ต่อบัญชี) — localStorage อาจใช้ไม่ได้ (โหมดส่วนตัว/บล็อก) ทุกจุดห่อ try/catch
// ใช้ไม่ได้ = ไม่จำ (ได้ค่าเริ่มต้นของบทบาท) ไม่ใช่หน้าพัง ผู้เรียกส่ง storage เข้ามาเอง (null ได้) เทสต์ด้วย node ได้
const homeViewKey = (profileId) => `smartlocal:staff-home-view:${profileId}`

export function readHomeView(storage, profileId) {
  if (!storage || !profileId) return null
  try {
    const value = storage.getItem(homeViewKey(profileId))
    return EXEC_HOME_VIEWS.includes(value) ? value : null
  } catch {
    return null
  }
}

export function writeHomeView(storage, profileId, view) {
  if (!storage || !profileId || !EXEC_HOME_VIEWS.includes(view)) return
  try {
    storage.setItem(homeViewKey(profileId), view)
  } catch { /* เก็บไม่ได้ก็ใช้ได้เฉพาะรอบนี้ */ }
}
