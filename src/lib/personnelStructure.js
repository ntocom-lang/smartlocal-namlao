export const SHARED_POSITION_LABEL = 'ใช้ได้ทุกกอง (ส่วนกลาง)'
export const EXECUTIVE_POSITION_LABEL = 'ผู้บริหาร · ปลัด · สภา'
export const EXECUTIVE_POSITION_GROUP = 'executive'
// ตำแหน่งระดับองค์กรที่ไม่ได้อยู่ใต้กองใด — ถ้าไม่มีกองหลักให้รวมไว้กลุ่มบนสุด ไม่ปนกับตำแหน่งทั่วไป
const EXECUTIVE_CATEGORIES = new Set(['political_exec', 'top_admin', 'council'])
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

// จัดกลุ่มตาม "กองหลัก" ของตำแหน่ง = กองที่ล็อก หรือกองที่มักสังกัด (department_hint) ที่ตรงกองเดียว
// แยกจากการล็อก: ตำแหน่งใช้ได้ทุกกองก็อยู่ใต้กองของมันได้ (ดู item.department_id ว่าล็อกหรือไม่)
// เดิมจัดกลุ่มตามกองที่ล็อกอย่างเดียว ตำแหน่งใช้ได้ทุกกองเลยกองรวมเป็นก้อนเดียว
// แอดมินที่อยากจัดให้เป็นกองๆ จึงไปล็อกกองแทน (ทุ่งแค้ว 2569-10-30) ซึ่งทำให้คนกองอื่นใช้ตำแหน่งนั้นไม่ได้
// ใช้ทั้งหน้าแบบตำแหน่งและช่องเลือกตำแหน่งตอนแต่งตั้ง ลำดับ: ผู้บริหาร → กองตาม sort_order → ใช้ได้ทุกกอง
export function groupPositionsByDepartment(positions, departments) {
  const homeOf = new Map(positions.map((position) => [position.id, suggestedDepartmentId(position, departments)]))
  const knownDepartmentIds = new Set(departments.map((department) => department.id))
  const groups = departments.map((department) => ({
    key: department.id,
    label: department.is_active === false ? `${department.name} (ปิดใช้งาน)` : department.name,
    department,
    items: positions.filter((position) => homeOf.get(position.id) === department.id),
  }))
  const homeless = positions.filter((position) => !knownDepartmentIds.has(homeOf.get(position.id)))
  const executives = homeless.filter((position) => EXECUTIVE_CATEGORIES.has(position.category))
  if (executives.length > 0) {
    groups.unshift({ key: EXECUTIVE_POSITION_GROUP, label: EXECUTIVE_POSITION_LABEL, department: null, items: executives })
  }
  groups.push({
    key: UNASSIGNED_DEPARTMENT,
    label: SHARED_POSITION_LABEL,
    department: null,
    items: homeless.filter((position) => !EXECUTIVE_CATEGORIES.has(position.category)),
  })
  return groups
}
