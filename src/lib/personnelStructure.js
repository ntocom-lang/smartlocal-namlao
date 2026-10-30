export const SHARED_POSITION_LABEL = 'ใช้ได้ทุกกอง (ส่วนกลาง)'
export const ALL_DEPARTMENTS = ''
export const UNASSIGNED_DEPARTMENT = 'none'

export function departmentFilterParams(filterDepartment) {
  if (filterDepartment === UNASSIGNED_DEPARTMENT) {
    return { p_department_id: null, p_without_department: true }
  }
  return {
    p_department_id: filterDepartment || null,
    p_without_department: false,
  }
}

// การแต่งตั้งไม่ควรยกระดับสิทธิ์เงียบ ๆ ตำแหน่งเป็นเพียงคำแนะนำเรื่องสิทธิ์
// บัญชีประชาชนที่ถูกเพิ่มเป็นบุคลากรจึงเริ่มที่ staff ซึ่งเป็นสิทธิ์ต่ำสุดของเจ้าหน้าที่
// ส่วนบัญชีบุคลากรเดิมคง role ไว้จนกว่าแอดมินจะเปลี่ยนที่แท็บ "สิทธิ์การใช้งาน"
export function leastPrivilegeRole(currentRole) {
  return !currentRole || currentRole === 'citizen' ? 'staff' : currentRole
}

export function resolvedDepartmentId(position, selectedDepartmentId, currentDepartmentId = null) {
  return position?.department_id || selectedDepartmentId || currentDepartmentId || null
}

export function shouldKeepDepartmentHead(user, nextDepartmentId) {
  return Boolean(user?.is_dept_head && user.department_id && user.department_id === nextDepartmentId)
}

export function positionMatchesDepartment(position, departmentId) {
  if (!position || !departmentId) return false
  return !position.department_id || position.department_id === departmentId
}

export function normalizePositionName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('th')
}

// กองเป็นของคน ไม่ใช่ของตำแหน่ง (เจ้าของระบบอนุมัติ 2569-10-30): ตำแหน่งสายงานอย่างธุรการ/จ้างเหมา
// มีแทบทุกกอง จึง "ใช้ได้ทุกกอง" เป็นค่าตั้งต้น ล็อกกองเฉพาะหัวหน้าหน่วยงานระดับกองที่มีได้กองเดียว
// "หัวหน้าฝ่าย..." ไม่นับ เพราะฝ่ายชื่อเดียวกันมีได้หลายกอง
// ต้องตรงกับ public.is_unit_head_position_name() ใน 20261030110000_position_shared_by_default.sql
export const UNIT_HEAD_POSITION_PATTERN =
  String.raw`^\s*(รอง)?ผู้อำนวยการ\s*(กอง|สำนัก)|^\s*หัวหน้า\s*สำนัก|^\s*หัวหน้า\s*หน่วย\s*ตรวจสอบภายใน`
const UNIT_HEAD_POSITION_RE = new RegExp(UNIT_HEAD_POSITION_PATTERN)

export function isUnitHeadPositionName(name) {
  return UNIT_HEAD_POSITION_RE.test(String(name || ''))
}

// กองที่ระบบเติมให้ตอนเลือกตำแหน่ง: ตำแหน่งล็อกกอง = กองนั้น / ใช้ได้ทุกกอง = กองแนะนำ
// (department_hint) เมื่อชื่อตรงกับชื่อเต็มหรือชื่อย่อของกองเพียงกองเดียว ไม่ตรง = ไม่เดา
export function suggestedDepartmentId(position, departments = []) {
  if (!position) return null
  if (position.department_id) return position.department_id
  const hint = normalizePositionName(position.department_hint)
  if (!hint) return null
  const matches = departments.filter((department) => normalizePositionName(department.name) === hint
    || (department.short_name && normalizePositionName(department.short_name) === hint))
  return matches.length === 1 ? matches[0].id : null
}

// ปลดล็อกตำแหน่งให้ใช้ได้ทุกกอง ผ่าน RPC เดียวกับหน้าแบบตำแหน่ง ผู้ถือทุกคนคงกองเดิม
// กองเดิมกลายเป็นกองแนะนำ และมี audit_logs ฝั่ง DB — ต้องอ่านจำนวนผู้ถือจริงก่อนส่ง
// เพราะ RPC ปฏิเสธเมื่อจำนวนไม่ตรง (กันกดจากข้อมูลเก่า)
export async function makePositionShared(client, tenantId, position) {
  const { data: holders, error: countError } = await client.rpc('get_position_holder_counts', {
    p_municipality_id: tenantId,
  })
  if (countError) return { error: countError }
  const holderCount = Number((holders ?? []).find((row) => row.position_id === position.id)?.holder_count ?? 0)
  const { error } = await client.rpc('admin_save_position', {
    p_position_id: position.id,
    p_changes: { department_id: null },
    p_expected_department_id: position.department_id ?? null,
    p_confirm_move: true,
    p_expected_holder_count: holderCount,
  })
  return { error, holderCount }
}

export function groupPositionsByDepartment(positions, departments) {
  const knownDepartmentIds = new Set(departments.map((department) => department.id))
  const groups = departments.map((department) => ({
    key: department.id,
    label: department.is_active === false ? `${department.name} (ปิดใช้งาน)` : department.name,
    department,
    items: positions.filter((position) => position.department_id === department.id),
  }))
  groups.push({
    key: UNASSIGNED_DEPARTMENT,
    label: SHARED_POSITION_LABEL,
    department: null,
    items: positions.filter((position) => !position.department_id || !knownDepartmentIds.has(position.department_id)),
  })
  return groups
}
