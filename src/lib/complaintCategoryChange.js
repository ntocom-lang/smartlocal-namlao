// แก้ประเภทคำร้องที่ยื่นแล้ว (กองตามประเภทใหม่) + ย้ายเรื่องค้างเมื่อแอดมินแก้กองของประเภท — ตัวช่วยฝั่งหน้าเว็บ
// กติกาจริงอยู่ที่ DB: 20261211100000_complaint_change_category.sql (ฝั่งนี้แค่ซ่อนปุ่ม/กรองตัวเลือกให้ตรง — DB ตรวจซ้ำเสมอ)
//
// ทำไมเป็น "แก้ประเภท" ไม่ใช่ "โอนกอง": trigger guard_complaint_routing_scope() ตั้งกองตามประเภททุกครั้ง
// โอนกองตรงๆ จะถูกดีดกลับ (เจ้าของระบบเลือก 2569-11-18 หลังเคส ES-69-0034 ใบพิมพ์ติดชื่อกองช่าง)
//
// ⚠️ ไฟล์นี้ต้องไม่ import supabase — เทสต์รันด้วย node ตรงๆ

import { isComplaintWorker } from './complaintWorkflow.js'

export const CHANGE_CATEGORY_ROLES = ['admin', 'superadmin', 'officer']
// ต้องตรงกับเงื่อนไขใน complaint_reroute_apply() — เรื่องที่จบแล้วแก้ได้เฉพาะแอดมิน (เจ้าของระบบสั่ง 2569-11-18
// หลังเคส ES-69-0034 ทุ่งแค้ว) ผู้รับผิดชอบ/สถานะคงเดิม และต้องมี closed_at (DB ตรวจ)
export const CHANGE_CATEGORY_LOCKED_STATUSES = ['closed', 'completed', 'done', 'rejected']
const FINISHED_EDITOR_ROLES = ['admin', 'superadmin']

/** เรื่องนี้จบแล้วหรือยัง (ใช้บอกผู้ใช้ว่าสถานะ/ผู้รับผิดชอบจะคงเดิม) */
export function isFinishedForCategoryChange(complaint) {
  return CHANGE_CATEGORY_LOCKED_STATUSES.includes(complaint?.status)
}
// หมวดที่ล็อกให้แอดมินรับเรื่องเสมอ (#756) — หัวหน้ากองย้ายเข้า/ออกไม่ได้
export const ADMIN_ONLY_CATEGORY = 'corruption'

/**
 * ผู้ใช้คนนี้เห็นปุ่ม "แก้ประเภทคำร้อง" ไหม
 * @param {object} complaint ต้องมี status, category, assigned_to
 * @param {string} userId
 * @param {string} role
 * @param {Record<string, {is_adhoc?: boolean}>} categoryMeta
 * @param {{departmentScoped?: boolean}} [opts] หน้าเจ้าหน้าที่ของหัวหน้ากองที่กรองเฉพาะเรื่องของกองแล้ว
 */
export function canChangeComplaintCategory(complaint, userId, role, categoryMeta = {}, opts = {}) {
  if (!complaint || !CHANGE_CATEGORY_ROLES.includes(role)) return false
  if (isFinishedForCategoryChange(complaint) && !FINISHED_EDITOR_ROLES.includes(role)) return false
  if (categoryMeta?.[complaint.category]?.is_adhoc) return false
  if (role === 'officer' && complaint.category === ADMIN_ONLY_CATEGORY) return false
  return isComplaintWorker(complaint, userId, role, opts)
}

/**
 * ตัวเลือกประเภทปลายทาง — เฉพาะที่เปิดใช้ ไม่ใช่เฉพาะกิจ มีกองรับผิดชอบ
 * ประเภทเดิมขึ้นเป็นตัวเลือกแรกเฉพาะเมื่อกองของเรื่องไม่ตรงกองปัจจุบันของประเภท (ประเภทถูกแต่กองค้าง)
 * @param {Array<{value: string, label?: string, department_id?: string|null, is_active?: boolean, is_adhoc?: boolean, sort_order?: number}>} categories
 * @param {Array<{id: string, name?: string}>} departments
 * @param {string} currentCategory
 * @param {string} role
 * @param {string|null} [currentDepartmentId] กองปัจจุบันของคำร้อง
 * @returns {Array<{value: string, label: string, departmentName: string, resync?: boolean}>}
 */
export function categoryChangeChoices(categories = [], departments = [], currentCategory = '', role = '', currentDepartmentId = null) {
  const deptName = new Map(departments.map((d) => [d.id, String(d.name ?? '').trim()]))
  const seen = new Set()
  const out = []
  // แถวของประเภทเดิมที่ trigger จะเลือก (is_active DESC, sort_order) — ตรงกับ guard_complaint_routing_scope()
  const currentRow = categories
    .filter((cat) => cat?.value === currentCategory)
    .sort((a, b) => Number(!!b.is_active) - Number(!!a.is_active) || (a.sort_order ?? 0) - (b.sort_order ?? 0))[0]
  const resync = currentRow?.department_id && currentDepartmentId && currentRow.department_id !== currentDepartmentId
    && !(role === 'officer' && currentCategory === ADMIN_ONLY_CATEGORY)
    ? [{
        value: currentCategory,
        label: `${String(currentRow.label ?? currentCategory).trim() || currentCategory} (ประเภทเดิม · ย้ายไปกองปัจจุบันของประเภท)`,
        departmentName: deptName.get(currentRow.department_id) || 'ไม่ทราบชื่อกอง',
        resync: true,
      }]
    : []
  for (const cat of categories) {
    if (!cat?.value || seen.has(cat.value)) continue
    if (!cat.is_active || cat.is_adhoc || !cat.department_id) continue
    if (cat.value === currentCategory) continue
    if (role === 'officer' && cat.value === ADMIN_ONLY_CATEGORY) continue
    seen.add(cat.value)
    out.push({
      value: cat.value,
      label: String(cat.label ?? cat.value).trim() || cat.value,
      departmentName: deptName.get(cat.department_id) || 'ไม่ทราบชื่อกอง',
    })
  }
  return [...resync, ...out.sort((a, b) => a.label.localeCompare(b.label, 'th'))]
}

/**
 * ผลจาก change_complaint_category() → ข้อความสั้นให้เจ้าหน้าที่อ่าน
 * @param {{department?: string, department_changed?: boolean, assigned_to?: string|null, status?: string} | null} result
 */
export function describeCategoryChange(result) {
  if (!result) return 'แก้ประเภทแล้ว'
  const parts = ['แก้ประเภทแล้ว']
  if (result.department_changed && result.department) parts.push(`ย้ายไป${result.department}`)
  if (!result.assigned_to && !CHANGE_CATEGORY_LOCKED_STATUSES.includes(result.status)) parts.push('รอแอดมินรับเรื่อง/มอบหมายผู้รับผิดชอบ')
  return parts.join(' · ')
}

/**
 * ข้อความถามแอดมินหลังแก้กองของประเภท ('' = ไม่ต้องถาม)
 * @param {{count?: number, department?: string|null}} preview ผล reroute_category_open_complaints(p_apply=false)
 * @param {string} categoryLabel
 */
export function rerouteConfirmText(preview, categoryLabel) {
  const count = Number(preview?.count ?? 0)
  if (!Number.isFinite(count) || count <= 0) return ''
  const dept = preview?.department || 'กองใหม่'
  return `ประเภท “${categoryLabel}” มีคำร้องที่ยังไม่เสร็จ ${count} เรื่องที่ยังอยู่กองเดิม\n`
    + `ย้ายไป${dept}ด้วยไหม?\n\n`
    + '• ใบพิมพ์และช่องลงนามจะเป็นของกองใหม่\n'
    + '• ผู้รับผิดชอบที่ไม่ได้อยู่กองใหม่จะถูกถอด เรื่องกลับคิวแอดมินให้มอบหมายใหม่\n'
    + '• เรื่องที่ดำเนินการเสร็จ/ปฏิเสธแล้วไม่ย้าย (เอกสารที่ออกไปแล้วคงเดิม)\n\n'
    + 'กด "ยกเลิก" = เรื่องเดิมอยู่กองเดิม มีผลเฉพาะคำร้องใหม่'
}
