// มอบหมายผู้ไปแทนในกิจกรรมปฏิทิน (เจ้าของระบบสั่ง 2569-10-01) — ตรรกะล้วน
// ไฟล์นี้ห้าม import supabase เทสต์ node (tests/event-assignment.test.mjs) import ตรง
//
// ⚠️ บันทึกเพื่อแจ้งให้ทราบภายในเท่านั้น ไม่ใช่คำสั่งมอบหมาย/มอบอำนาจตามกฎหมาย
// สิทธิ์จริงตัดสินที่ RPC set_event_assignments (migration 20261001120100) ฝั่งหน้าจอแค่ซ่อน/แสดงปุ่ม

// ต้องตรงกับด่าน "สูงสุด 5 คน" ใน set_event_assignments
export const MAX_ASSIGNEES = 5

// ค่า value ต้องตรงกับ CHECK event_assignments_task_chk
export const ASSIGNMENT_TASKS = [
  { value: 'attend',  label: 'ไปประชุมแทน' },
  { value: 'preside', label: 'เป็นประธาน/เปิดงานแทน' },
  { value: 'join',    label: 'ร่วมงานแทน' },
]
const TASK_LABEL = Object.fromEntries(ASSIGNMENT_TASKS.map((t) => [t.value, t.label]))

export function taskLabel(task) {
  return TASK_LABEL[task] ?? ''
}

// กลุ่มในรายการเลือก — key ต้องตรงกับ group_key ที่ list_event_assignee_candidates คืน
// label ของสภาเปลี่ยนตามประเภท อปท. จึงรับจากผู้เรียก (terminology.councilOrg)
export const CANDIDATE_GROUPS = [
  { key: 'executive', label: 'ผู้บริหาร' },
  { key: 'admin',     label: 'ปลัดและหัวหน้าส่วนราชการ' },
  { key: 'council',   label: 'สภา' },
  { key: 'staff',     label: 'เจ้าหน้าที่' },
]

export function groupCandidates(rows, councilLabel) {
  const groups = CANDIDATE_GROUPS.map((g) => ({
    ...g,
    label: g.key === 'council' && councilLabel ? councilLabel : g.label,
    members: [],
  }))
  const byKey = Object.fromEntries(groups.map((g) => [g.key, g]))
  for (const row of rows ?? []) (byKey[row.group_key] ?? byKey.staff).members.push(row)
  return groups.filter((g) => g.members.length > 0)
}

// ระบบเดาภารกิจให้จากประเภทกิจกรรม คนแก้ได้ใน 1 คลิก — ประชุม/อบรมคือ "ไปประชุมแทน"
// ที่เหลือ (งานประเพณี งานบุญ พิธีเปิด) นายกมักถูกเชิญเป็นประธาน
export function defaultTaskForCategory(category) {
  return category === 'ประชุม' || category === 'อบรม' ? 'attend' : 'preside'
}

// "แทนใคร" — กิจกรรมกลุ่มผู้บริหารคือแทนนายก กลุ่มสภาคือแทนประธานสภา ที่เหลือให้คนเลือกเอง
export function defaultOnBehalfOf(audiences, terms) {
  const list = Array.isArray(audiences) ? audiences : []
  if (list.includes('management')) return terms?.mayor ?? ''
  if (list.includes('council')) return terms?.councilPresident ?? ''
  return ''
}

// ตัวเลือกด่วนของช่อง "แทน" (ไม่ซ้ำ ไม่ว่าง) — นอกนั้นพิมพ์เอง
export function onBehalfChoices(terms) {
  return [...new Set([terms?.mayor, terms?.clerk, terms?.councilPresident].filter(Boolean))]
}

function assignmentList(assignments) {
  return Array.isArray(assignments) ? assignments.filter((a) => a && String(a.name ?? '').trim()) : []
}

// "นายเอ (รองนายกเทศมนตรี), นายบี — ไปประชุมแทนนายกเทศมนตรี"
// ภารกิจ/แทนใครเป็นค่าเดียวทั้งกิจกรรม (RPC บันทึกค่าเดียวกันทุกแถว) จึงอ่านจากแถวแรก
export function assignmentSummary(assignments) {
  const list = assignmentList(assignments)
  if (list.length === 0) return ''
  const people = list.map((a) => (a.title ? `${a.name} (${a.title})` : a.name)).join(', ')
  const task = taskLabel(list[0].task)
  if (!task) return people
  return `${people} — ${task}${String(list[0].on_behalf_of ?? '').trim()}`
}

// ผู้ใช้คนนี้เป็นหนึ่งในผู้รับมอบหมายไหม — ใช้ขึ้นป้าย "คุณได้รับมอบหมาย"
export function isAssignedTo(ev, userId) {
  return !!userId && assignmentList(ev?.assignments).some((a) => a.profile_id === userId)
}

const INTERNAL_ROLES = ['viewer', 'council', 'officer', 'staff', 'technician']

// ใครเห็นปุ่ม "มอบหมายผู้ไปแทน" — ต้องตรงกับด่านใน set_event_assignments:
// คนแก้ไขกิจกรรมได้ (แอดมิน / คนสร้าง / หัวหน้ากองของกิจกรรม) + ผู้บริหาร (viewer) บนกิจกรรมกลุ่ม "ผู้บริหาร"
// role มาจาก AuthContext ซึ่งลดเป็น citizen ให้แล้วเมื่อเป็นบัญชีของ อปท. อื่น
export function canAssignEvent(ev, role, userId, scope) {
  if (!ev) return false
  // รายการส่วนตัว ("เฉพาะฉัน") ไม่มีการมอบหมาย — อยู่คนละตารางกับ events RPC จะหากิจกรรมไม่เจอ
  // (ev.is_personal มาจาก toPersonalEvent ใน personalEvents.js เช็กตรงนี้เพราะไฟล์นั้น import ไฟล์นี้อยู่แล้ว)
  if (ev.is_personal === true) return false
  if (role === 'superadmin' || role === 'admin') return true
  if (!INTERNAL_ROLES.includes(role)) return false
  if (userId && ev.created_by === userId) return true
  if (scope?.is_dept_head && scope?.department_id && ev.department_id === scope.department_id) return true
  return role === 'viewer' && (ev.audiences ?? []).includes('management')
}

// ค่าเริ่มต้นของฟอร์มจากกิจกรรมที่บันทึกไว้แล้ว
export function assignmentFormFromEvent(ev) {
  const list = assignmentList(ev?.assignments)
  return {
    assignees: list.map((a) => ({ profile_id: a.profile_id ?? null, name: a.name ?? '', title: a.title ?? '' })),
    task: list[0]?.task ?? '',
    onBehalfOf: list[0]?.on_behalf_of ?? '',
  }
}

export const EMPTY_ASSIGNMENT = { assignees: [], task: '', onBehalfOf: '' }

// พารามิเตอร์ p_assignees ของ RPC — คนมีบัญชีส่งแค่ profile_id (เซิร์ฟเวอร์เติมชื่อ/ตำแหน่งจากฐานข้อมูลเอง
// กันการแอบอ้างชื่อ) คนพิมพ์เองส่งชื่อ + ตำแหน่ง
export function toAssigneePayload(assignees) {
  return (assignees ?? []).map((a) => (a.profile_id
    ? { profile_id: a.profile_id }
    : { name: String(a.name ?? '').trim(), title: String(a.title ?? '').trim() || null }))
}

// ตัวเทียบว่าการมอบหมายในฟอร์มเปลี่ยนจากที่บันทึกไว้ไหม — ไม่เปลี่ยนก็ไม่ต้องเรียก RPC
// ไม่มีผู้รับมอบหมายแล้ว ภารกิจ/แทนใครไม่มีความหมาย ให้ถือว่าเท่ากันหมด
export function assignmentKey(form) {
  const people = toAssigneePayload(form?.assignees)
  if (people.length === 0) return '[]'
  return JSON.stringify({ people, task: form?.task || '', behalf: String(form?.onBehalfOf ?? '').trim() })
}

// ตรวจก่อนบันทึก (ซ้ำกับเซิร์ฟเวอร์) จะได้บอกผู้ใช้ก่อนกิจกรรมถูกบันทึก — คืนข้อความผิดพลาด หรือ '' ถ้าผ่าน
export function validateAssignment(form) {
  const list = form?.assignees ?? []
  if (list.length === 0) return ''
  if (list.length > MAX_ASSIGNEES) return `มอบหมายได้สูงสุด ${MAX_ASSIGNEES} คนต่อกิจกรรม`
  if (!TASK_LABEL[form?.task]) return 'กรุณาเลือกภารกิจที่มอบหมาย (ไปประชุม / เป็นประธาน / ร่วมงาน)'
  if (String(form?.onBehalfOf ?? '').trim().length > 120) return 'ช่อง "แทน" ยาวเกิน 120 ตัวอักษร'
  for (const a of list) {
    if (a.profile_id) continue
    const name = String(a.name ?? '').trim()
    if (!name || name.length > 120) return 'กรุณาพิมพ์ชื่อผู้รับมอบหมาย (ไม่เกิน 120 ตัวอักษร)'
    if (String(a.title ?? '').trim().length > 120) return 'ตำแหน่งยาวเกิน 120 ตัวอักษร'
  }
  const ids = list.filter((a) => a.profile_id).map((a) => a.profile_id)
  if (new Set(ids).size !== ids.length) return 'เลือกบุคคลเดียวกันซ้ำ'
  return ''
}

// "บันทึกโดย … เมื่อ …" ใต้ข้อความมอบหมาย — ใครเป็นคนแจ้ง ตรวจย้อนได้
export function assignmentRecordedLine(assignments) {
  const first = assignmentList(assignments)[0]
  if (!first) return ''
  const by = String(first.assigned_by_name ?? '').trim()
  const at = first.assigned_at ? new Date(first.assigned_at) : null
  const when = at && !Number.isNaN(at.getTime())
    ? at.toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
    : ''
  if (!by && !when) return ''
  return `บันทึก${by ? `โดย ${by}` : ''}${when ? ` เมื่อ ${when} น.` : ''}`
}
