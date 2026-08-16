import { supabase } from './supabase'

// Role vocabulary ของทั้งระบบ (profiles.role) — เดิม AdminDashboard.jsx นิยามไว้เอง ส่วน
// ComplaintsManager.jsx ไม่มีเลย ทำให้แสดง/กรอง role เพี้ยนกันคนละจุด (เช่น "ธุรการกอง" เคยถูก
// hardcode เรียกว่า "ช่าง" ในอีกไฟล์) — ย้ายมารวมที่นี่ที่เดียว ใครต้องใช้ import แทนการนิยามเอง
export const ROLE_LABELS = {
  superadmin:  { label: 'Super Admin',   color: '#7c3aed', bg: '#ede9fe' },
  admin:       { label: 'แอดมินระบบ',   color: '#1d4ed8', bg: '#dbeafe' },
  officer:     { label: 'ธุรการกอง',     color: '#0891b2', bg: '#e0f2fe' },
  technician:  { label: 'ปฏิบัติงาน',   color: '#d97706', bg: '#fef3c7' },
  staff:       { label: 'เจ้าหน้าที่',  color: '#0ea5e9', bg: '#e0f2fe' },
  viewer:      { label: 'ผู้บริหาร',    color: '#059669', bg: '#d1fae5' },
  council:     { label: 'สภาเทศบาล',    color: '#f59e0b', bg: '#fff7ed' },
  citizen:     { label: 'ประชาชน',       color: '#374151', bg: '#f3f4f6' },
}

export const ROLE_DESCRIPTIONS = {
  citizen: 'ใช้บริการประชาชน ไม่มีสิทธิ์จัดการงานภายใน',
  staff: 'เจ้าหน้าที่ทั่วไป ใช้เฉพาะเมนูงานที่ได้รับมอบหมาย',
  viewer: 'ผู้บริหาร ดูข้อมูลและภาพรวมเพื่อประกอบการตัดสินใจ',
  council: 'สมาชิกสภา ดูข้อมูลและงานที่เกี่ยวข้องกับสภาเทศบาล',
  officer: 'ธุรการประจำกอง จัดการงานและเอกสารของกองที่สังกัด ไม่จัดการข้ามกอง',
  technician: 'เจ้าหน้าที่ปฏิบัติงานหรือภาคสนาม บันทึกและอัปเดตงานที่รับผิดชอบ',
  admin: 'ผู้ดูแลระบบของเทศบาล จัดการผู้ใช้ การตั้งค่า และงานทุกกองในเทศบาล',
  superadmin: 'ผู้พัฒนาระบบ จัดการได้ทุกเทศบาลและทุกโมดูล',
}

// role ที่ถือว่าเป็น "ผู้ปฏิบัติงาน" รับมอบหมายงาน/คำร้องได้ — ตัด viewer/council (ตำแหน่งกำกับดูแล
// ไม่ใช่ผู้ลงมือทำ), citizen (ประชาชน), superadmin (ระดับแพลตฟอร์ม ไม่ผูกเทศบาลเดียว จริงๆ แล้ว
// municipality_id เป็น null อยู่แล้วด้วย จึงไม่หลุดเข้ามาในผลลัพธ์ต่อให้ใส่ไว้ในนี้) ออก
// ใช้ร่วมกันทั้งหน้า "จัดการประเภทคำร้อง" (ตั้งผู้รับผิดชอบเริ่มต้นต่อหมวด) และหน้ารายละเอียดคำร้อง
// (มอบหมาย/เปลี่ยนผู้รับผิดชอบรายคำร้อง) — เดิม 3 จุดกรอง role ไม่ตรงกัน (บางจุดมีแค่ 'technician'
// จุดเดียว) ทำให้คนที่ตั้งไว้ในหน้าหนึ่งไม่โผล่เป็นตัวเลือกในอีกหน้า
export const ASSIGNABLE_STAFF_ROLES = ['technician', 'officer', 'staff', 'admin']

/**
 * ดึงรายชื่อคนที่ "รับมอบหมายงานได้" ในเทศบาลเดียว พร้อมชื่อกองที่สังกัด (join ตาราง departments ให้
 * แทนการอ่าน profiles.department ซึ่งเป็น text อิสระเก่าที่พิมพ์เพี้ยนกันได้ — ใช้ department_id/
 * departments.name ที่เป็นตัวเดียวกับหน้า "จัดการผู้ใช้และการแต่งตั้ง" ใช้ตั้งค่าจริง)
 * เรียงตามลำดับกอง (sort_order) → หัวหน้ากองก่อน → ชื่อ ก-ฮ พร้อมส่งต่อ groupStaffByDepartment() ได้เลย
 * @param {string} municipalityId
 * @returns {Promise<Array<{ id: string, full_name: string|null, email: string|null, role: string,
 *   department_id: string|null, department_name: string|null, is_dept_head: boolean }>>}
 */
export async function fetchAssignableStaff(municipalityId) {
  if (!municipalityId) return []
  const [{ data: people, error: peopleErr }, { data: depts, error: deptErr }] = await Promise.all([
    supabase.from('profiles')
      .select('id, full_name, email, role, department_id, is_dept_head')
      .eq('municipality_id', municipalityId)
      .in('role', ASSIGNABLE_STAFF_ROLES)
      .order('full_name'),
    supabase.from('departments')
      .select('id, name, sort_order')
      .eq('municipality_id', municipalityId)
      .eq('is_active', true)
      .order('sort_order'),
  ])
  if (peopleErr) { console.error('fetchAssignableStaff (profiles):', peopleErr.message); return [] }
  if (deptErr) console.error('fetchAssignableStaff (departments) — จะแสดงแบบไม่แยกกองแทน:', deptErr.message)

  const deptById = new Map((depts ?? []).map((d) => [d.id, d]))
  const deptSortOf = (p) => deptById.get(p.department_id)?.sort_order ?? 9999
  return (people ?? [])
    .map((p) => ({ ...p, department_name: deptById.get(p.department_id)?.name ?? null }))
    .sort((a, b) => deptSortOf(a) - deptSortOf(b)
      || (b.is_dept_head ? 1 : 0) - (a.is_dept_head ? 1 : 0)
      || (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '', 'th'))
}

/**
 * จัดกลุ่มผลลัพธ์จาก fetchAssignableStaff() เป็น [{ department_name, members }] พร้อม render เป็น
 * <optgroup> ได้ทันที — คนที่ไม่มีกอง (department_id null / กองถูกลบ) ตกกลุ่ม "ไม่ระบุหน่วยงาน" ท้ายสุด
 * เสมอ (ตามลำดับที่ fetchAssignableStaff() sort มาให้แล้ว ฟังก์ชันนี้แค่จัดกลุ่มตามลำดับเดิม ไม่ sort ซ้ำ)
 * @param {Array} people - ผลลัพธ์จาก fetchAssignableStaff()
 * @returns {Array<{ department_name: string, members: Array }>}
 */
export function groupStaffByDepartment(people) {
  const groups = new Map()
  for (const p of people ?? []) {
    const key = p.department_name ?? 'ไม่ระบุหน่วยงาน'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(p)
  }
  return [...groups.entries()].map(([department_name, members]) => ({ department_name, members }))
}
