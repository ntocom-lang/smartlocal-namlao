// uuid ของบัญชีผู้พัฒนา (ntocom@gmail.com) — ต้องตรงกับ supabase/migrations/147_dev_journal.sql
// ใช้กรองเมนู "ผู้พัฒนาระบบ" ให้เห็นเฉพาะบัญชีนี้ ไม่ผูกกับ role เพราะ superadmin ของแต่ละ
// เทศบาลเป็นคนละคนกัน ความปลอดภัยจริงอยู่ที่ RLS ของตาราง dev_journal
export const DEV_USER_ID = 'b3e7c083-05ee-4664-ba42-e866729923ef'

// ตรงกับ RequireAuth staffOnly / adminOnly ใน App.jsx — ปุ่มที่โชว์ต้องไม่กว้างกว่าด่าน route
export const STAFF_PORTAL_ROLES = ['staff', 'officer', 'admin', 'superadmin', 'viewer', 'council', 'technician']
export const ADMIN_PORTAL_ROLES = ['admin', 'superadmin', 'viewer']

export function isDevUser(userId) {
  return userId === DEV_USER_ID
}

export function canAccessStaffPortal(role) {
  return STAFF_PORTAL_ROLES.includes(role)
}

export function canAccessAdminPortal(role) {
  return ADMIN_PORTAL_ROLES.includes(role)
}

export function currentPortal(pathname) {
  if (pathname.startsWith('/dev-journal')) return 'dev'
  if (pathname.startsWith('/admin') && !pathname.startsWith('/admin/login')) return 'admin'
  if (pathname.startsWith('/staff')) return 'staff'
  return 'citizen'
}
