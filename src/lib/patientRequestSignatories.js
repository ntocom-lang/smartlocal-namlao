// ผู้ลงนามท้ายใบคำขอรถรับ-ส่งผู้ป่วยที่เจ้าหน้าที่พิมพ์ (ผอ.กองสวัสดิการสังคม / ปลัด / นายก)
//
// ชื่อและตำแหน่งดึงจากทะเบียน "ผู้ลงนามเอกสาร" (document_signatories) ตัวเดียวกับใบคำร้องและใบคำขอบริการอื่น
// ด้วยกติกาเลือกแถวเดียวกับ loadPrintSignatories ใน StaffDashboard.jsx: ปลัด/นายก = แถวระดับหน่วยงาน
// ผอ.กอง = แถวของกองที่ถือเรื่อง (pickSignatory) ที่ใช้ร่วมกับ prepare_complaint_print ฝั่งฐานข้อมูล
//
// ⚠️ ต่างจากใบคำร้อง/ใบคำขออื่นตรงที่ "คำขอรถรับ-ส่งในระบบจองคิวไม่มีกองผูกอยู่กับแถว" จึงต้องหากองที่ถือเรื่องเอง
// เจ้าของระบบสั่ง 2569-10-06: กองสวัสดิการสังคม (ที่ทุ่งแค้ว) · อปท. ไหนไม่มีกองนี้ ให้ใช้สำนักปลัดแทน
// กติกาหากองเดียวกับตัวเดินเรื่องคำขอรถรับ-ส่งแบบเดิมในฐานข้อมูล (route_document_request_department:
// resolve_work_department 'welfare' / ชื่อมี "สวัสดิการ" → ถอยไป 'general' / "สำนักปลัด") ห้ามเปลี่ยนเองโดยไม่ถาม
//
// ไม่มีการลงลายมือชื่อในใบ — ใบเวียนเซ็นด้วยปากกา ชื่อที่พิมพ์คือชื่อในวงเล็บใต้เส้นเท่านั้น (govStaffSignBlock.js)

import { pickSignatory, signatoryName, signatoryTitle } from './documentSignatories.js'

const lower = value => String(value ?? '').trim().toLowerCase()

/**
 * กองที่ถือเรื่องรถรับ-ส่งผู้ป่วย: รหัส welfare ก่อน แล้วชื่อที่มีคำว่า "สวัสดิการ" ถ้าไม่มีทั้งสองใช้สำนักปลัด (รหัส general หรือชื่อ "สำนักปลัด")
 * ไม่เจอเลยคืน null — ใบจะได้ตำแหน่งสำรองกลาง ไม่ใช่ช่องหาย
 * @param {Array<{id: string, code?: string, name?: string}>} departments เรียงตาม sort_order มาแล้ว
 */
export function pickPatientRequestDepartment(departments) {
  const rows = (departments ?? []).filter(dept => dept?.id && String(dept.name ?? '').trim())
  const byCode = code => rows.find(dept => lower(dept.code) === code)
  const byName = text => rows.find(dept => String(dept.name).includes(text))
  return byCode('welfare') ?? byName('สวัสดิการ') ?? byCode('general') ?? byName('สำนักปลัด') ?? null
}

/**
 * @param {{departments: Array, registry: Array, at?: string|null}} args registry = แถว document_signatories
 *   (SIGNATORY_REGISTRY_SELECT) รวมแถวที่ปิดแล้ว · at = bookingLetterMoment() ได้ผู้ลงนามที่ดำรงตำแหน่งตอนเรื่องเสร็จ
 *   (เจ้าของระบบสั่ง 2569-10-06 เรื่องที่เสร็จแล้วคงชื่อเดิม เรื่องที่ค้างใช้คนใหม่) ไม่ส่ง = ผู้ลงนามวันนี้
 * @returns {{departmentName: string, signatories: {department_head: object|null, clerk: object|null, mayor: object|null}}}
 *   พร้อมส่งเข้า formSheet / govStaffSignBlockHtml ได้ทันที แต่ละช่อง null = พิมพ์เส้นประให้เขียนมือ
 */
export function resolvePatientRequestSignatories({ departments, registry, at = null }) {
  const department = pickPatientRequestDepartment(departments)
  const toSignatory = row => (row ? { name: signatoryName(row), title: signatoryTitle(row) } : null)
  return {
    departmentName: department?.name ?? '',
    signatories: {
      department_head: toSignatory(department
        ? pickSignatory(registry, { role: 'department_head', departmentId: department.id, at })
        : null),
      clerk: toSignatory(pickSignatory(registry, { role: 'clerk', at })),
      mayor: toSignatory(pickSignatory(registry, { role: 'mayor', at })),
    },
  }
}
