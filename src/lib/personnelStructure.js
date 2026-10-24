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
    label: 'ส่วนกลาง / ยังไม่ผูกกอง',
    department: null,
    items: positions.filter((position) => !position.department_id || !knownDepartmentIds.has(position.department_id)),
  })
  return groups
}
