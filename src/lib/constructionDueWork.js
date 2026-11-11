// นับ "งานโครงการก่อสร้างที่ถึงคิวคน" สำหรับการ์ด "ต้องทำตอนนี้" + ป้ายเมนูโครงการก่อสร้างบนหน้าแรกเจ้าหน้าที่ — คำนวณล้วน ไม่ต่อฐานข้อมูล
//
// ไม่มีกติกา/ตัวเลขระเบียบของตัวเอง: ทุกอย่างมาจาก constructionLifecycle.js (projectAlerts) ชุดเดียวกับแถบ "ต้องดูแล" ของแท็บภาพรวม
// ขอบเขตโครงการเดียวกับแท็บภาพรวม (LifecycleOverview): ไม่นับโครงการที่ขั้น FINISHED_STAGES (ปิดแล้ว/ยกเลิก)
//
// นับ 2 อย่าง (ไม่ซ้อนกัน):
//   awaitingInspection  งวดที่ส่งมอบแล้วแต่ยังไม่ตรวจรับ — ลูกบอลอยู่ที่คณะกรรมการตรวจรับ (ข้อ 176(5) + ว 681)
//   overdue             กำหนดตามระเบียบที่ "เลยแล้ว" ซึ่งเป็นงานของเจ้าหน้าที่/กรรมการ และวันครบกำหนดไม่ต้องยืนยันตัวบทเพิ่ม
//                       ตัดออก: คำเตือนที่ verify (ระบบยังไม่ได้ยืนยันวิธีนับ — เป็นข้อควรระวัง ไม่ใช่งานค้างที่ยืนยันได้)
//                               ฝั่งผู้รับจ้าง (ระดับ warn) · กำหนดตรวจรับงวด installment_inspection (นับแล้วใน awaitingInspection)
// ⚠️ ระบบไม่ตัดสินแทนคน: ตัวเลขนี้แค่บอกว่า "มีเรื่องรอ" ไม่ได้บอกว่าผิดระเบียบ — หน้าจอห้ามใช้คำว่าผิด/ละเมิด
import { bangkokIsoDate } from './complaintReportPeriods.js'
import { projectAlerts } from './constructionLifecycle.js'
import { FINISHED_STAGES } from '../components/staff/construction/lifecycleFormat.js'

// ชุดข้อมูลวงจรที่โครงการยังไม่มีแถว (ตารางว่าง) — รูปเดียวกับ EMPTY ใน constructionLifecycleApi.js
const EMPTY_LIFE = () => ({ contract: null, people: [], milestones: [], installments: [], changes: [], defects: [], documents: [], events: [] })

const filled = value => String(value ?? '').trim() !== ''

/** โครงการ + ข้อมูลวงจร (ผลของ fetchLifecycleData().byProject) → rows รูปเดียวกับ rows ใน ConstructionProjectsModule */
export function buildDueRows(projects, byProject) {
  return (projects ?? []).map(project => ({ project, bundle: { project, ...EMPTY_LIFE(), ...(byProject?.[project.id] ?? {}) } }))
}

/** คำเตือนนี้เป็น "กำหนดที่เลยแล้ว" ที่นับเป็นงานค้างได้ไหม (ดูเงื่อนไขในหัวไฟล์) */
export function isCountableOverdue(alert) {
  if (!alert || alert.level !== 'error' || !alert.deadlineKey || alert.verify) return false
  if (alert.code !== `${alert.deadlineKey}_overdue`) return false
  return alert.deadlineKey !== 'installment_inspection'
}

/**
 * @param {Array<{ project: object, bundle: object }>} rows
 * @param {string} today วันนี้ตามเวลาไทย (YYYY-MM-DD) — ผู้เรียกส่งมา ไม่อ่านนาฬิกาเครื่องในนี้ถ้าส่งมาแล้ว
 * @returns {{ awaitingInspection: number, overdue: number, total: number }}
 */
export function constructionDueWork(rows, today = bangkokIsoDate()) {
  let awaitingInspection = 0
  let overdue = 0
  for (const row of rows ?? []) {
    if (!row?.project || FINISHED_STAGES.includes(row.project.stage)) continue
    const bundle = row.bundle ?? { project: row.project }
    for (const inst of bundle.installments ?? []) {
      if (filled(inst?.delivered_on) && !filled(inst?.inspected_on)) awaitingInspection += 1
    }
    for (const alert of projectAlerts(bundle, today)) if (isCountableOverdue(alert)) overdue += 1
  }
  return { awaitingInspection, overdue, total: awaitingInspection + overdue }
}
