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
// ส่วนบัญชีบุคลากรเดิมคง role ไว้จนกว่าแอดมินจะเปลี่ยนในฟอร์มเจ้าหน้าที่
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

// หัวหน้าหน่วยงาน "ตัวจริง" ของกอง — ใช้ติ๊ก "เป็นหัวหน้ากอง" ให้เองและเสนอผู้ลงนาม (เจ้าของระบบอนุมัติ 2569-10-30)
// ต่างจาก isUnitHeadPositionName (กฎล็อกกอง ต้องตรงกับฟังก์ชันฝั่ง DB) ตรงที่ไม่นับ "รอง..." และ "ผู้ช่วย..."
// เพราะรองผู้อำนวยการล็อกกองได้ แต่ไม่ใช่คนลงนามช่องหัวหน้ากอง
// แบบตำแหน่งมาตรฐานมี category = dept_head ส่วนตำแหน่งที่สร้างจากปุ่มเพิ่มบุคลากรเป็น category ทั่วไปเสมอ จึงต้องดูชื่อด้วย
export function isDepartmentHeadPosition(position) {
  const name = String((typeof position === 'string' ? position : position?.name) || '')
  if (!name.trim() || /^\s*(รอง|ผู้ช่วย)/.test(name)) return false
  return position?.category === 'dept_head' || isUnitHeadPositionName(name)
}

// บทบาทที่แนะนำตามตำแหน่ง — ตำแหน่งที่สร้างจากปุ่มเพิ่มบุคลากรมี role = staff เสมอ แม้ชื่อเป็นผู้อำนวยการกอง
// ถ้าเชื่อค่าในตาราง หัวหน้ากองคนใหม่จะไม่เคยถูกเสนอสิทธิ์ที่ต้องใช้จริง
export function recommendedRoleForPosition(position) {
  if (!position) return null
  return isDepartmentHeadPosition(position) ? 'officer' : (position.role ?? null)
}

// เสนอสิทธิ์หัวหน้ากองเฉพาะบัญชีที่สิทธิ์ต่ำกว่า — ผู้บริหาร สภา และแอดมินเป็นคนละสายงาน ระบบไม่ไปเปลี่ยนให้
export function canOfferOfficerRole(currentRole) {
  return !currentRole || ['citizen', 'staff', 'technician'].includes(currentRole)
}

// เอาติ๊กหัวหน้าของคนเดิมออกได้ไหม — ตรงกับที่ admin_update_user ปฏิเสธ:
// แก้บัญชีตัวเอง · แก้ Super Admin · แอดมินแก้แอดมินด้วยกัน (ถ้าไม่กันตรงนี้ แอดมินจะกดแล้วเจอข้อความภาษาอังกฤษจากฐานข้อมูล)
export function canClearDepartmentHead(head, currentUserId, currentUserRole) {
  return head?.id !== currentUserId && head?.role !== 'superadmin'
    && (currentUserRole === 'superadmin' || head?.role !== 'admin')
}

// ── ฟอร์มเจ้าหน้าที่หน้าเดียว (เจ้าของระบบอนุมัติ 2569-10-31): พิมพ์ตำแหน่งและกองใหม่ในฟอร์มได้ ไม่ต้องไปสร้างที่แท็บอื่นก่อน ──
// แอดมินพิมพ์ย่อ "ผอ." บ่อย ถ้าไม่ขยายจะหาตำแหน่งเดิมไม่เจอ แล้วได้ตำแหน่งซ้ำที่ขึ้นหน้าบุคลากรฝั่งประชาชนด้วย
export function positionSearchKey(value) {
  return normalizePositionName(value).replace(/\s+/g, '').replace(/^ผอ\.?/, 'ผู้อำนวยการ')
}

export function prettyPositionName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').replace(/^ผอ\.?\s*/, 'ผู้อำนวยการ')
}

// กองที่ชื่ออยู่ในชื่อตำแหน่งเพียงกองเดียว เช่น ผู้อำนวยการกองคลัง → กองคลัง · ไม่เจอหรือเจอหลายกอง = ไม่เดา
export function departmentFromPositionName(name, departments = []) {
  const key = positionSearchKey(name)
  const found = departments.filter((department) => key.includes(positionSearchKey(department.name)))
  return found.length === 1 ? found[0].id : null
}

// ตำแหน่งหัวหน้าของกองที่ยังไม่มีในระบบ เช่น ผู้อำนวยการกองสาธารณสุข → เสนอเพิ่ม "กองสาธารณสุข" แอดมินแก้ชื่อหรือเลือกกองอื่นได้
export function proposedDepartmentName(name) {
  if (!isDepartmentHeadPosition(name)) return ''
  return String(name).match(/(กอง|สำนัก|หน่วย)\S+/)?.[0] ?? ''
}

// ชื่อตำแหน่งหัวหน้าที่เสนอเมื่อกดตั้งผู้ลงนามของกองที่ยังไม่มีตำแหน่ง · ชื่อกองไม่ขึ้นต้นด้วยกอง/สำนัก/หน่วย = ไม่เดา
export function defaultHeadPositionName(department) {
  const name = String(department?.name ?? '').trim()
  if (/^สำนักปลัด/.test(name) || /^หน่วย/.test(name)) return `หัวหน้า${name}`
  return /^(กอง|สำนัก)/.test(name) ? `ผู้อำนวยการ${name}` : ''
}

// หมวดและสิทธิ์แนะนำของตำแหน่งที่พิมพ์ใหม่ ไม่งั้นหัวหน้าหรือผู้บริหารที่สร้างจากฟอร์มจะตกไปอยู่หมวดเจ้าหน้าที่
// ค่าตรงกับตำแหน่งมาตรฐาน (20260729171006_positions_personnel.sql) · ไม่เคยแนะนำแอดมินระบบ
export function positionTraitsFromName(name) {
  const text = String(name || '').trim()
  if (/^(นายก(?!รัฐมนตรี)|รองนายก|ที่ปรึกษานายก|เลขานุการนายก)/.test(text)) return { category: 'political_exec', role: 'viewer' }
  if (/^(ประธานสภา|รองประธานสภา|เลขานุการสภา|สมาชิกสภา)/.test(text)) return { category: 'council', role: 'council' }
  if (/^(ปลัด|รองปลัด)/.test(text)) return { category: 'top_admin', role: 'officer' }
  if (isDepartmentHeadPosition(text)) return { category: 'dept_head', role: 'officer' }
  if (/^(นายช่าง|ช่าง|พนักงานขับ)/.test(text)) return { category: 'field_technician', role: 'technician' }
  return { category: 'operating_staff', role: 'staff' }
}

// ระดับผู้บริหาร ไม่จำเป็นต้องสังกัดกอง
export function isExecutivePosition(position) {
  const category = position?.category ?? positionTraitsFromName(position?.name).category
  return EXECUTIVE_CATEGORIES.has(category)
}

// ค่าเริ่มต้นของ "เป็นหัวหน้ากอง" ตามที่แอดมินเลือกอยู่ — เอาออกหรือติ๊กเองได้ ระบบไม่บังคับ
//   ตำแหน่งและกองไม่เปลี่ยน = ค่าเดิม (แก้เบอร์โทรแล้วติ๊กต้องไม่ขยับ)
//   เปลี่ยนตำแหน่งในกองเดิม = ตำแหน่งหัวหน้าติ๊กให้ · ออกจากตำแหน่งหัวหน้าเอาออก · ตำแหน่งธรรมดาทั้งคู่คงค่าเดิม
//   ย้ายกอง = ดูจากตำแหน่งเท่านั้น ไม่พกสถานะหัวหน้าจากกองเดิมไป
export function defaultDepartmentHead({ person, previousPosition, position, departmentId }) {
  if (!departmentId) return false
  const sameDepartment = person?.department_id === departmentId
  if (!position) return sameDepartment && Boolean(person?.is_dept_head)
  const positionIsHead = isDepartmentHeadPosition(position)
  const samePosition = previousPosition?.id && previousPosition.id === position.id
  if (samePosition && sameDepartment) return Boolean(person?.is_dept_head)
  if (!sameDepartment) return positionIsHead
  return positionIsHead || (!isDepartmentHeadPosition(previousPosition) && Boolean(person?.is_dept_head))
}

// สิทธิ์ที่ฟอร์มเสนอเมื่อการแต่งตั้งเปลี่ยน: เสนอเพิ่มตามตำแหน่งหัวหน้าหรือผู้บริหาร ไม่ลดเอง และไม่เคยเสนอแอดมินระบบ
// ทุกข้อขึ้นให้เห็นก่อนบันทึก ไม่มีการยกระดับเงียบๆ · คนที่ไม่ได้เปลี่ยนการแต่งตั้ง สิทธิ์ไม่ขยับ
export function proposedRoleForAppointment({ currentRole, position, asHead, appointmentChanged }) {
  const current = currentRole || 'citizen'
  if (!appointmentChanged || !position) return current
  if (['admin', 'superadmin'].includes(current)) return current
  if (asHead && canOfferOfficerRole(current)) return 'officer'
  if (isExecutivePosition(position) && ['citizen', 'staff'].includes(current)) {
    const suggested = position.role ?? positionTraitsFromName(position.name).role
    return ['admin', 'superadmin'].includes(suggested) ? 'staff' : suggested
  }
  return leastPrivilegeRole(current)
}

// รหัสกองสุ่มแบบเดียวกับหน้าจัดการกอง · สีปล่อยว่างให้ trigger departments_fill_color เลือก
export function createDepartment(client, tenantId, { name, sortOrder = 0 }) {
  return client.from('departments').insert({
    municipality_id: tenantId,
    name,
    short_name: null,
    code: `dept_${Date.now().toString(36)}`,
    sort_order: sortOrder,
    color: null,
  }).select('id, code, name, short_name').single()
}

// ใช้ได้ทุกกองเป็นค่าตั้งต้นโดยจำกองนี้ไว้เป็นกองแนะนำ ล็อกกองเฉพาะหัวหน้าหน่วยงาน
export function createPosition(client, tenantId, { name, departmentId = null, departmentName = null }) {
  const traits = positionTraitsFromName(name)
  const locked = Boolean(departmentId) && isUnitHeadPositionName(name)
  return client.from('positions').insert({
    municipality_id: tenantId,
    department_id: locked ? departmentId : null,
    department_hint: departmentName,
    name,
    category: traits.category,
    role: traits.role,
    sort_order: 0,
  }).select('id, name, role, category, department_id, department_hint, sort_order').single()
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
