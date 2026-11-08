// ตรรกะวงจรโครงการก่อสร้าง (ตั้งงบ → ปิดโครงการ) — PR-B ของแผนวงจรโครงการก่อสร้าง (เจ้าของระบบอนุมัติ 2569-11-07/08)
//
// หลัก: "กฎอยู่ในโค้ดที่เดียว ฐานข้อมูลเก็บแค่ข้อเท็จจริง"
//   - ฐานข้อมูล (PR-A #652: 20261108100000/100100/100200) เก็บวันที่ เลขที่หนังสือ ยอดเงิน ที่คนบันทึกจากเอกสารจริง
//   - ไฟล์นี้คำนวณ "วันครบกำหนดตามระเบียบ" + เตือน + เสนอขั้นถัดไป · คำนวณล้วน ไม่ต่อฐานข้อมูล ไม่ import supabase/React
//
// ⚠️ ต้องตรงกับ migration 20261108100200 ทุกตัวอักษร (tests/construction-lifecycle.test.mjs เทียบให้):
//   STAGES / stageOrd / statusOfStage / stageForStatus = civil_stage_ord / civil_status_of_stage / civil_stage_for_status
//   stageChangeRule = กติกาใน RPC civil_set_project_stage (ตัวตัดสินจริงคือฐานข้อมูล ตรงนี้ใช้ซ่อนปุ่ม/บอกล่วงหน้าว่าต้องกรอกอะไร)
//   แก้ฝั่งใดฝั่งหนึ่งต้องแก้อีกฝั่งในงานเดียวกัน
//
// ⚠️ ระบบไม่ตัดสินแทนคน: ผลตรวจรับ ค่าปรับ ขยายเวลา แก้ไข/บอกเลิกสัญญา คืนหลักประกัน ประเมินผู้ประกอบการ
//    = ผู้มีอำนาจตัดสิน · ไฟล์นี้แค่ "เตือน" และ "ประมาณการ" (ยอดค่าปรับทางการใช้ตัวคำนวณของ e-GP)
//
// วิธีนับวัน (ค้างยืนยันกับเจ้าหน้าที่พัสดุ — ดูหัวข้อ Compliance ในแผน)
//   - "ภายใน X วันทำการ นับแต่/นับถัดจาก" → addWorkingDays(วันเกิดเหตุ, X): วันทำการถัดไปเป็นวันที่ 1
//     (ข้อ 181 เขียน "นับถัดจาก" ชัด ส่วน 176(5)/178(4) เขียน "นับแต่" — สมมติฐานเดียวกันทั้งหมด ต้องยืนยัน)
//   - "ภายใน X วัน" (วันปฏิทิน) → addDays(วันเกิดเหตุ, X)
//   - "เลยกำหนด" ตัดสินด้วยวันปฏิทิน (วันนี้ > วันครบกำหนด) · "เหลือกี่วัน" ใช้วันทำการเฉพาะกำหนดที่นับเป็นวันทำการ
//     (workingDaysBetween ให้ 0 ในวันเสาร์ถัดจากกำหนดวันศุกร์ ถ้าใช้ตัวนับวันทำการอย่างเดียวจะไม่เตือนว่าเลยกำหนด)
//   - วันหยุดมาจาก workingDays.js (static 2568–2569 + ตาราง public_holidays) ปีที่ไม่มีข้อมูลถอยไปตัดแค่เสาร์-อาทิตย์
//
// ที่มา (อ่านจากเอกสารทางการแล้ว — รายละเอียด/ลิงก์อยู่ในแผนและความจำ reference_construction_procurement_rules)
//   พ.ร.บ.จัดซื้อจัดจ้างฯ 2560 · ระเบียบ กค. จัดซื้อจัดจ้างฯ 2560 (+ฉบับที่ 3 พ.ศ. 2569) · หนังสือ กค (กวจ) 0405.2/ว 117 ·
//   แบบสัญญาจ้างก่อสร้าง · หลักเกณฑ์ราคากลางงานก่อสร้าง 2569 · ระเบียบ มท. การเงิน อปท. 2566 (ข้อ 59–61, 97)
//   ข้อที่มี verify: true = ยังไม่ได้ยืนยันวิธีนับ/ตัวบทฉบับปัจจุบัน หน้าจอต้องแสดงคำกำกับ

import { addDays, bangkokIsoDate } from './complaintReportPeriods.js'
import { daysBetween, effectiveEndDate, isIsoDate } from './constructionReport.js'
import { addWorkingDays, missingHolidayYears, workingDaysBetween } from './workingDays.js'

// ── ขั้นของโครงการ (ชุดเดียวกับ CHECK civil_projects.stage) ──────────────────────────

/** ขั้นทั้ง 12 ค่า ตามลำดับใน CHECK ของ migration 20261108100000 */
export const STAGES = [
  'budgeted', 'designing', 'procuring', 'contracted', 'started', 'construction',
  'final_inspection', 'warranty', 'closed', 'suspended', 'cancelled', 'terminated',
]

/** เส้นหลัก 9 ขั้น (ลำดับ = civil_stage_ord) */
export const MAIN_STAGES = STAGES.slice(0, 9)

/** ขั้นที่ "ระงับชั่วคราว" แล้วจำไว้ได้ (CHECK civil_projects.stage_before_hold) — ปิดแล้วระงับไม่ได้ */
export const HOLDABLE_STAGES = MAIN_STAGES.slice(0, 8)

export const STAGE_LABELS = {
  budgeted: 'ตั้งงบประมาณ',
  designing: 'ออกแบบ/กำหนดราคากลาง',
  procuring: 'จัดซื้อจัดจ้าง',
  contracted: 'ลงนามสัญญา',
  started: 'เริ่มงาน',
  construction: 'ก่อสร้าง',
  final_inspection: 'ตรวจรับงวดสุดท้าย',
  warranty: 'ประกันผลงาน',
  closed: 'ปิดโครงการ',
  suspended: 'ระงับชั่วคราว',
  cancelled: 'ยกเลิก (ก่อนทำสัญญา)',
  terminated: 'บอกเลิกสัญญา',
}

/** = civil_stage_ord: เส้นหลัก 1–9 · นอกเส้นหลัก null */
export function stageOrd(stage) {
  const i = MAIN_STAGES.indexOf(stage)
  return i === -1 ? null : i + 1
}

/** = civil_status_of_stage: ขั้น → สถานะเดิม 6 ค่า (หมุดศูนย์ข้อมูล/หน้าช่างยังอ่าน status) */
export const STATUS_OF_STAGE = {
  budgeted: 'planned',
  designing: 'planned',
  procuring: 'approved',
  contracted: 'approved',
  started: 'in_progress',
  construction: 'in_progress',
  final_inspection: 'in_progress',
  warranty: 'completed',
  closed: 'completed',
  suspended: 'suspended',
  cancelled: 'cancelled',
  terminated: 'cancelled',
}
export const statusOfStage = stage => STATUS_OF_STAGE[stage] ?? null

/** = civil_stage_for_status: สถานะเดิม → ขั้นตัวแทน (เติมค่าแถวเดิม / เมนูเดิมแก้ status)
 *  completed → warranty ไม่ใช่ closed โดยตั้งใจ — "ปิด" แปลว่าคืนหลักประกันแล้ว ซึ่งระบบไม่รู้ */
export const STAGE_FOR_STATUS = {
  planned: 'budgeted',
  approved: 'procuring',
  in_progress: 'construction',
  completed: 'warranty',
  suspended: 'suspended',
  cancelled: 'cancelled',
}
export const stageForStatus = status => STAGE_FOR_STATUS[status] ?? null

/** ขั้นที่ใช้วัดจริงของโครงการ — ระงับอยู่ใช้ขั้นที่จำไว้ */
export const baseStage = project => (project?.stage === 'suspended' ? (project.stage_before_hold ?? null) : (project?.stage ?? null))

// ── ค่าที่ฐานข้อมูลตรวจ (CHECK) — เทสต์เทียบกับ migration ─────────────────────────────

export const WORK_GROUPS = { building: 'งานอาคาร', road_bridge: 'งานทาง สะพาน และท่อเหลี่ยม', irrigation: 'งานชลประทาน' }
export const PRICE_KINDS = { lump_sum: 'ราคาเหมารวม', unit_price: 'ราคาต่อหน่วย' }
/** ชนิดหลักประกัน — รายการตามระเบียบ กค. ข้อ 167 "ต้องยืนยันกับฉบับปัจจุบัน" · none = สัญญาไม่มีหลักประกัน */
export const GUARANTEE_TYPES = {
  cash: 'เงินสด',
  cheque_draft: 'เช็คหรือดราฟท์ที่ธนาคารเซ็นสั่งจ่าย',
  bank_guarantee: 'หนังสือค้ำประกันของธนาคาร',
  e_guarantee: 'หนังสือค้ำประกันอิเล็กทรอนิกส์',
  gov_bond: 'พันธบัตรรัฐบาลไทย',
  other: 'อื่น ๆ',
  none: 'ไม่มีหลักประกัน',
}
export const PEOPLE_GROUP_KEYS = ['committee', 'supervisor', 'contractor_rep', 'price_committee']
export const CHANGE_KINDS = {
  extend_time: 'ขยายเวลาทำการตามสัญญา',
  waive_fine: 'งดค่าปรับ',
  reduce_fine: 'ลดค่าปรับ',
  amend_contract: 'แก้ไขสัญญา',
}
export const DEFECT_KINDS = { during_warranty: 'ตรวจระหว่างระยะประกัน', final_before_expiry: 'ตรวจครั้งสุดท้ายก่อนครบระยะประกัน' }
export const DEFECT_RESULTS = { ok: 'ไม่พบความชำรุดบกพร่อง', defect: 'พบความชำรุดบกพร่อง' }
export const INSPECTION_RESULTS = { accepted: 'ตรวจรับ', rejected: 'ไม่ตรวจรับ' }

/** รูปแบบคีย์จุดตรวจ = CHECK civil_project_milestones.key */
export const MILESTONE_KEY_PATTERN = /^[a-z][a-z0-9_]{1,62}$/

// ── แคตาล็อกจุดตรวจ (milestone) ─────────────────────────────────────────────────
// 1 คีย์ = 1 แถวต่อโครงการ (unique project+key) · done_on = วันที่เกิดขึ้นจริง · amount/link ตามที่ระบุ
// managerOnly = ฐานข้อมูลยอมให้เฉพาะผู้จัดการโครงการบันทึก (civil_milestones_guard) — ต้องตรงกับ SQL
// เพิ่มคีย์ใหม่ได้โดยไม่ต้องแก้ฐานข้อมูล (ฐานข้อมูลตรวจแค่รูปแบบ) ยกเว้นคีย์ managerOnly ต้องแก้ trigger ด้วย

const B_PROC = 'ระเบียบกระทรวงการคลังว่าด้วยการจัดซื้อจัดจ้างและการบริหารพัสดุภาครัฐ พ.ศ. 2560'
const B_PRICE = 'หลักเกณฑ์และวิธีการกำหนดราคากลางงานก่อสร้าง (19 พ.ค. 2569) แนวทางและวิธีปฏิบัติ'
const B_FIN = 'ระเบียบกระทรวงมหาดไทยว่าด้วยการรับเงิน การเบิกจ่ายเงิน การฝากเงิน การเก็บรักษาเงิน และการตรวจเงินขององค์กรปกครองส่วนท้องถิ่น พ.ศ. 2566'
const B_ACT = 'พ.ร.บ.การจัดซื้อจัดจ้างและการบริหารพัสดุภาครัฐ พ.ศ. 2560'
const B_CONTRACT = 'แบบสัญญาจ้างก่อสร้าง'
const B_W117 = 'หนังสือ กค (กวจ) 0405.2/ว 117 ลว. 12 มี.ค. 2562'
const B_OPEVAL = 'ระเบียบกระทรวงการคลังฯ (ฉบับที่ 3) พ.ศ. 2569 หมวด 7'

export const MILESTONES = [
  // 1 ตั้งงบ — แหล่งงบเลือก 1 คีย์ (done_on = วันประกาศใช้/วันสภาอนุมัติ · amount = วงเงิน)
  { key: 'budget_annual', stage: 'budgeted', label: 'งบประมาณรายจ่ายประจำปี (ข้อบัญญัติ/เทศบัญญัติ)', budgetSource: true },
  { key: 'budget_supplementary', stage: 'budgeted', label: 'งบประมาณรายจ่ายเพิ่มเติม', budgetSource: true },
  { key: 'budget_accumulated', stage: 'budgeted', label: 'เงินสะสม (วันที่สภาอนุมัติ)', basis: `${B_FIN} ข้อ 97`, budgetSource: true },
  { key: 'budget_subsidy', stage: 'budgeted', label: 'เงินอุดหนุนเฉพาะกิจ', budgetSource: true },
  { key: 'budget_carryover', stage: 'budgeted', label: 'เงินกันไว้เบิกเหลื่อมปี (วันที่อนุมัติกันเงิน)', basis: `${B_FIN} ข้อ 59–61`, budgetSource: true },
  { key: 'local_plan_ref', stage: 'budgeted', label: 'อ้างอิงแผนพัฒนาท้องถิ่น (ปี/ยุทธศาสตร์/ลำดับโครงการ)',
    basis: 'ระเบียบกระทรวงมหาดไทยว่าด้วยการจัดทำแผนพัฒนาขององค์กรปกครองส่วนท้องถิ่น พ.ศ. 2548 ข้อ 25' },
  // 2 ออกแบบ/ราคากลาง
  { key: 'designer_certified', stage: 'designing', label: 'ผู้ออกแบบรับรองรายการและปริมาณงาน', basis: `${B_PRICE} ข้อ 15` },
  { key: 'price_committee_order', stage: 'designing', label: 'คำสั่งแต่งตั้งคณะกรรมการกำหนดราคากลาง', basis: `${B_PRICE} ข้อ 16, 16.1` },
  { key: 'egp_price_calc', stage: 'designing', label: 'เลขโครงการในระบบคำนวณราคากลางงานก่อสร้างอิเล็กทรอนิกส์ (e-GP)',
    basis: 'หนังสือกรมบัญชีกลาง ที่ กค 0433.2/ว 1367 ลว. 31 ต.ค. 2565 (ต้องยืนยันว่ายังใช้หลังหลักเกณฑ์ 2569)', verify: true },
  { key: 'median_price_approved', stage: 'designing', label: 'หัวหน้าหน่วยงานเห็นชอบราคากลาง (ยอด = ราคากลาง)', basis: `${B_PRICE} ข้อ 16.2` },
  { key: 'median_price_reviewed', stage: 'designing', label: 'ทบทวนราคากลาง (ยอด = ราคากลางหลังทบทวน)', basis: `${B_PRICE} ข้อ 18` },
  // 3 จัดซื้อจัดจ้าง (เอกสารออกจาก e-GP — บันทึกเลขที่/วันที่)
  { key: 'procurement_report', stage: 'procuring', label: 'รายงานขอจ้าง' },
  { key: 'inspection_committee_order', stage: 'procuring', label: 'คำสั่งแต่งตั้งคณะกรรมการตรวจรับพัสดุ' },
  { key: 'invitation_published', stage: 'procuring', label: 'ประกาศเชิญชวน (เลขโครงการ e-GP)' },
  { key: 'median_price_published', stage: 'procuring', label: 'ประกาศราคากลางและ BOQ (เว็บไซต์หน่วยงาน + เว็บไซต์กรมบัญชีกลาง)', basis: `${B_PRICE} ข้อ 20` },
  { key: 'bid_price', stage: 'procuring', label: 'ราคาของผู้ที่จะจ้าง (ยอด)' },
  { key: 'oag_notified_15pct', stage: 'procuring', label: 'หนังสือแจ้ง สตง. กรณีราคาต่างจากราคากลางตั้งแต่ร้อยละ 15', basis: `${B_PRICE} ข้อ 16` },
  { key: 'winner_announced', stage: 'procuring', label: 'ประกาศผลผู้ชนะการเสนอราคา', basis: `${B_ACT} มาตรา 117` },
  { key: 'appeal_filed', stage: 'procuring', label: 'มีผู้ยื่นอุทธรณ์', basis: `${B_ACT} มาตรา 117` },
  // 4 ลงนามสัญญา
  { key: 'contract_copy_oag', stage: 'contracted', label: 'ส่งสำเนาสัญญาให้ สตง.', basis: `${B_PROC} ข้อ 164` },
  { key: 'contract_copy_revenue', stage: 'contracted', label: 'ส่งสำเนาสัญญาให้กรมสรรพากร', basis: `${B_PROC} ข้อ 164` },
  { key: 'supervisor_order', stage: 'contracted', label: 'คำสั่งแต่งตั้งผู้ควบคุมงาน', basis: `${B_PROC} ข้อ 177` },
  { key: 'contractor_work_plan', stage: 'contracted', label: 'แผนการทำงานของผู้รับจ้าง', basis: `${B_CONTRACT} ข้อ 7` },
  // 5 เริ่มงาน
  { key: 'site_handover', stage: 'started', label: 'ส่งมอบพื้นที่ก่อสร้าง' },
  { key: 'start_report', stage: 'started', label: 'รายงานของผู้ควบคุมงาน ณ วันเริ่มงานตามสัญญา', basis: `${B_PROC} ข้อ 178(4)` },
  // 7 ตรวจรับงวดสุดท้าย
  { key: 'retention_returned', stage: 'final_inspection', label: 'คืนเงินประกันผลงาน', basis: `${B_CONTRACT} ข้อ 6` },
  // 9 ปิดโครงการ
  { key: 'obligation_ended', stage: 'closed', label: 'วันพ้นข้อผูกพันตามสัญญา' },
  { key: 'guarantee_returned', stage: 'closed', label: 'คืนหลักประกันสัญญา', basis: `${B_PROC} ข้อ 170(2)`, managerOnly: true },
  { key: 'operator_eval_done', stage: 'closed', label: 'ประเมินผลการปฏิบัติงานของผู้ประกอบการใน e-GP แล้ว', basis: B_OPEVAL },
]
export const MILESTONE_BY_KEY = Object.fromEntries(MILESTONES.map(m => [m.key, m]))
/** คีย์ที่ฐานข้อมูลจำกัดให้ผู้จัดการโครงการบันทึก (ตรงกับ civil_milestones_guard) */
export const MANAGER_ONLY_MILESTONES = MILESTONES.filter(m => m.managerOnly).map(m => m.key)

// ── ค่าเกณฑ์ ─────────────────────────────────────────────────────────────────────
export const RULES = {
  priceCommitteeMin: 3,            // ประธาน 1 + กรรมการ ≥ 2 (ราคากลาง ข้อ 16.1)
  priceCalcMin: 1_000_000,         // ว 1367: งาน 1–20 ล้านใช้ระบบคำนวณราคากลางอิเล็กทรอนิกส์ (ต้องยืนยัน)
  priceCalcMax: 20_000_000,
  medianPublishDays: 30,           // ข้อ 18 วันปฏิทินนับถัดจากวันเห็นชอบ
  oagPriceGapPct: 15,              // ข้อ 16 (ต่อท้าย 16.2) ฐาน = ราคากลาง
  appealWorkingDays: 7,            // ม.117
  contractCopyMin: 1_000_000,      // ข้อ 164
  contractCopyDays: 30,
  supervisorReportWorkingDays: 3,  // ข้อ 178(4)
  inspectionWorkingDays: 3,        // ข้อ 176(5)
  fineNoticeWorkingDays: 7,        // ข้อ 181
  changeRequestDays: 15,           // ข้อ 182
  fineTerminatePct: 10,            // ข้อ 183 "เกินร้อยละสิบ"
  fineMinPerDay: 100,              // ข้อ 162 งานจ้าง ขั้นต่ำวันละ 100 บาท
  fineRatePctMin: 0.01,            // ข้อ 162 ร้อยละ 0.01–0.10 ต่อวัน (สาธารณูปโภคกระทบจราจร 0.25)
  fineRatePctMax: 0.25,
  guaranteeReturnDays: 15,         // ข้อ 170(2)
  warrantyLeadLong: 30,            // ว 117: ประกัน ≥ 6 เดือน
  warrantyLeadShort: 15,           // ว 117: ประกัน < 6 เดือน
  carryoverVoucherDaysBeforeFyEnd: 30, // ระเบียบการเงิน ข้อ 60
  budgetWarnDays: 90,              // เริ่มเตือนเรื่องงบก่อนสิ้นปีงบ (ค่าที่ระบบตั้งเอง ไม่ใช่ระเบียบ)
  soonWorkingDays: 3,              // เตือน "ใกล้ครบ" สำหรับกำหนดแบบวันทำการ (ค่าที่ระบบตั้งเอง)
  soonCalendarDays: 7,             // เตือน "ใกล้ครบ" สำหรับกำหนดแบบวันปฏิทิน (ค่าที่ระบบตั้งเอง)
}

// ── ตัวช่วยวันที่ (ISO ล้วน ไม่พึ่งโซนเวลาเครื่อง) ─────────────────────────────────────

const iso = value => (isIsoDate(value) ? value : null)
const numOrNull = value => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
const maxIso = (...values) => values.filter(isIsoDate).sort().at(-1) ?? null

/** บวกเดือนแบบปฏิทิน (31 ม.ค. + 1 เดือน = 28/29 ก.พ.) */
export function addMonths(isoDate, n) {
  if (!isIsoDate(isoDate) || !Number.isInteger(n)) return null
  const y = Number(isoDate.slice(0, 4))
  const m = Number(isoDate.slice(5, 7)) - 1 + n
  const d = Number(isoDate.slice(8, 10))
  const ty = y + Math.floor(m / 12)
  const tm = ((m % 12) + 12) % 12
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate()
  return `${String(ty).padStart(4, '0')}-${String(tm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

/** ปีงบประมาณ พ.ศ. → วันเริ่ม/สิ้นสุด (ปีงบ 2570 = 1 ต.ค. 2569 – 30 ก.ย. 2570) */
export function fiscalYearRange(fiscalYearBe) {
  const fy = Number(fiscalYearBe)
  if (!Number.isInteger(fy) || fy < 2400) return null
  const ce = fy - 543
  return { start: `${ce - 1}-10-01`, end: `${ce}-09-30` }
}

// ── ข้อมูลโครงการ (bundle) ───────────────────────────────────────────────────────
// ทุกฟังก์ชันด้านล่างรับ bundle รูปเดียวกัน (หน้าจอ PR-C โหลดครั้งเดียวแล้วส่งต่อ):
//   { project, contract, milestones[], people[], installments[], changes[], defects[], events[] }
// ช่องตามชื่อคอลัมน์ในฐานข้อมูลตรงๆ ขาดช่องไหน = ยังไม่บันทึก (ไม่เดาค่า)

const milestoneOf = (bundle, key) => (bundle?.milestones ?? []).find(m => m?.key === key) ?? null
const doneOn = (bundle, key) => iso(milestoneOf(bundle, key)?.done_on)
const isDone = (bundle, key) => doneOn(bundle, key) !== null

/** แหล่งงบที่บันทึกไว้ (คีย์แรกตามลำดับแคตาล็อก) */
export function budgetSource(bundle) {
  const m = MILESTONES.filter(x => x.budgetSource).map(x => milestoneOf(bundle, x.key)).find(Boolean)
  return m ? { key: m.key, label: MILESTONE_BY_KEY[m.key].label, on: iso(m.done_on), amount: numOrNull(m.amount), refNo: m.ref_no ?? null } : null
}

const sortedInstallments = bundle => [...(bundle?.installments ?? [])]
  .filter(i => Number.isInteger(Number(i?.installment_no)))
  .sort((a, b) => Number(a.installment_no) - Number(b.installment_no))

/** งวดสุดท้าย = เลขงวดเท่ากับจำนวนงวดในสัญญา ถ้าไม่ได้ระบุจำนวนงวดใช้งวดเลขมากสุดที่บันทึกไว้ */
export function finalInstallment(bundle) {
  const rows = sortedInstallments(bundle)
  const total = numOrNull(bundle?.contract?.installments_total)
  if (total) return rows.find(r => Number(r.installment_no) === total) ?? null
  return rows.at(-1) ?? null
}

const guaranteeIsNone = bundle => bundle?.contract?.guarantee_type === 'none'

// ── เวลาตามสัญญา ───────────────────────────────────────────────────────────────

/**
 * วันเริ่ม/สิ้นสุดตามสัญญา
 *   วันที่คนบันทึกไว้ (civil_projects.start_date/end_date) ชนะเสมอ — คัดจากสัญญาจริง
 *   ไม่มี → คำนวณจากหนังสือแจ้งให้เริ่มทำงาน + "เริ่มภายใน/แล้วเสร็จภายใน N วัน" (computed = true, verify = true:
 *   ถ้อยคำนับวันในสัญญาแต่ละฉบับต่างกันได้ ระบบนับแบบ "นับถัดจากวันได้รับหนังสือ" = วันหนังสือ + N)
 *   วันสิ้นสุดที่ใช้จริง = วันสิ้นสุดใหม่จากการขยายเวลาที่อนุมัติแล้วล่าสุด / extended_until (ที่ยาวกว่า)
 */
export function contractSchedule(bundle) {
  const p = bundle?.project ?? {}
  const c = bundle?.contract ?? {}
  const ntp = iso(c.notice_to_proceed_date)
  const startWithin = numOrNull(c.start_within_days)
  const finishWithin = numOrNull(c.finish_within_days)
  const startBy = ntp && startWithin !== null ? addDays(ntp, startWithin) : null
  const finishBy = ntp && finishWithin ? addDays(ntp, finishWithin) : null
  const start = iso(p.start_date) ?? startBy
  const end = iso(p.end_date) ?? finishBy
  const approvedExtension = (bundle?.changes ?? [])
    .filter(ch => ch?.kind === 'extend_time' && ch?.decision === 'approved')
    .map(ch => iso(ch.new_end_date))
  const extendedUntil = maxIso(c.extended_until, ...approvedExtension)
  return {
    noticeToProceed: ntp,
    startBy,
    finishBy,
    start,
    end,
    effectiveEnd: effectiveEndDate({ end_date: end, extended_until: extendedUntil }),
    computedStart: !iso(p.start_date) && Boolean(startBy),
    computedEnd: !iso(p.end_date) && Boolean(finishBy),
  }
}

/**
 * ระยะประกันความชำรุดบกพร่อง + ช่วงตรวจครั้งสุดท้าย (ว 117: ภายใน 30 วันก่อนครบ ถ้าประกัน ≥ 6 เดือน / 15 วัน ถ้า < 6 เดือน)
 *   วันเริ่ม: ที่บันทึกไว้ · ไม่มี → วันถัดจากวันส่งมอบงวดสุดท้ายที่ตรวจรับแล้ว (แบบสัญญา ข้อ 8 "นับถัดจากวันที่ได้รับมอบงาน"
 *     + ข้อ 176(6) — ข้อหารือ กค (กวจ) 0405.4/38770 ยังเปิดต้นฉบับไม่ได้ → verify)
 *   วันครบ: ที่บันทึกไว้ · ไม่มี → วันเริ่ม + N เดือน − 1 วัน · ไม่มีค่าเริ่มต้นของระยะประกัน (กรอกตามสัญญา)
 */
export function warrantyWindow(bundle) {
  const c = bundle?.contract ?? {}
  const months = numOrNull(c.warranty_months)
  const last = finalInstallment(bundle)
  const derivedStart = last?.inspection_result === 'accepted' && iso(last.delivered_on) ? addDays(last.delivered_on, 1) : null
  const start = iso(c.warranty_starts_on) ?? derivedStart
  const derivedEnd = start && months !== null && months > 0 ? addDays(addMonths(start, months), -1) : null
  const end = iso(c.warranty_ends_on) ?? derivedEnd
  if (!end) return { start, end: null, months, leadDays: null, opensOn: null, computedStart: !iso(c.warranty_starts_on) && Boolean(start), computedEnd: false }
  let long
  if (start) long = addDays(addMonths(start, 6), -1) <= end
  else long = months === null ? true : months >= 6   // ไม่รู้ระยะ → ใช้ช่วงยาว (เตือนเร็วกว่า ปลอดภัยกว่า)
  const leadDays = long ? RULES.warrantyLeadLong : RULES.warrantyLeadShort
  return {
    start,
    end,
    months,
    leadDays,
    opensOn: addDays(end, -leadDays),
    computedStart: !iso(c.warranty_starts_on) && Boolean(start),
    computedEnd: !iso(c.warranty_ends_on),
  }
}

// ── กำหนดเวลาตามระเบียบ ─────────────────────────────────────────────────────────

/**
 * สร้างรายการกำหนดเวลา 1 จุด
 *   kind  'working' = นับวันทำการ · 'calendar' = วันปฏิทิน
 *   mode  'task' = มีคนต้องทำให้ทัน · 'gate' = ต้องรอให้พ้นก่อน (เช่น ระยะอุทธรณ์)
 *   party 'office' = เจ้าหน้าที่/กรรมการ · 'contractor' = ผู้รับจ้าง (ระบบแค่บันทึกว่าทันไหม)
 *   state done · late_done (ทำแล้วแต่เลยกำหนด) · open · due_today · overdue · waiting/passed (gate)
 */
function deadline({ key, label, basis, due, kind, done = null, today, mode = 'task', party = 'office', verify = false, installmentNo = null, opensOn = null }) {
  if (!isIsoDate(due)) return null
  let state
  if (mode === 'gate') state = today > due ? 'passed' : 'waiting'
  else if (done) state = done > due ? 'late_done' : 'done'
  else if (today > due) state = 'overdue'
  else if (today === due) state = 'due_today'
  else state = 'open'
  const active = state === 'open' || state === 'due_today' || state === 'overdue' || state === 'waiting'
  const daysLeft = !active ? null : kind === 'working' ? workingDaysBetween(today, due) : daysBetween(today, due)
  return { key, label, basis, due, kind, mode, party, verify, installmentNo, opensOn, doneOn: done, state, daysLeft }
}

/**
 * วันครบกำหนดตามระเบียบทั้งหมดของโครงการ — แสดงเฉพาะจุดที่ "มีวันตั้งต้นแล้ว" (ยังไม่เกิดเหตุ = ยังไม่มีกำหนด)
 * @returns {Array<object>} เรียงตามวันครบกำหนด
 */
export function deadlines(bundle, today = bangkokIsoDate()) {
  const out = []
  const push = d => { if (d) out.push(d) }
  const p = bundle?.project ?? {}
  const c = bundle?.contract ?? {}
  const sched = contractSchedule(bundle)

  // ราคากลาง: เห็นชอบ/ทบทวนแล้ว 30 วันปฏิทินนับถัดจากวันเห็นชอบ ต้องประกาศ ไม่งั้นทบทวน (ข้อ 18)
  const priceBase = maxIso(doneOn(bundle, 'median_price_approved'), doneOn(bundle, 'median_price_reviewed'))
  if (priceBase) {
    const published = [doneOn(bundle, 'invitation_published'), doneOn(bundle, 'median_price_published')]
      .filter(d => d && d >= priceBase).sort()[0] ?? null
    push(deadline({ key: 'median_price_publish', label: 'ประกาศเชิญชวนพร้อมราคากลาง (เกินกำหนดต้องทบทวนราคากลาง)',
      basis: `${B_PRICE} ข้อ 18`, due: addDays(priceBase, RULES.medianPublishDays), kind: 'calendar', done: published, today }))
  }

  // ระยะอุทธรณ์ 7 วันทำการนับแต่วันประกาศผล — ลงนามสัญญาได้เมื่อพ้นแล้ว (ม.117 · ข้อ 161)
  const winner = doneOn(bundle, 'winner_announced')
  if (winner) {
    push(deadline({ key: 'appeal_period', label: 'พ้นระยะอุทธรณ์ (ลงนามสัญญาได้หลังวันนี้)', basis: `${B_ACT} มาตรา 117 · ${B_PROC} ข้อ 161`,
      due: addWorkingDays(winner, RULES.appealWorkingDays), kind: 'working', mode: 'gate', today, verify: true }))
  }

  // สัญญา ≥ 1 ล้าน ส่งสำเนาให้ สตง. และกรมสรรพากรภายใน 30 วัน (ข้อ 164)
  const contractDate = iso(c.contract_date)
  const contractAmount = numOrNull(p.contract_amount)
  if (contractDate && contractAmount !== null && contractAmount >= RULES.contractCopyMin) {
    const due = addDays(contractDate, RULES.contractCopyDays)
    push(deadline({ key: 'contract_copy_oag', label: 'ส่งสำเนาสัญญาให้ สตง.', basis: `${B_PROC} ข้อ 164`, due, kind: 'calendar', done: doneOn(bundle, 'contract_copy_oag'), today }))
    push(deadline({ key: 'contract_copy_revenue', label: 'ส่งสำเนาสัญญาให้กรมสรรพากร', basis: `${B_PROC} ข้อ 164`, due, kind: 'calendar', done: doneOn(bundle, 'contract_copy_revenue'), today }))
  }

  // รายงานผู้ควบคุมงาน ณ วันเริ่มงานตามสัญญา ภายใน 3 วันทำการ (ข้อ 178(4))
  if (sched.start) {
    push(deadline({ key: 'start_report', label: 'ผู้ควบคุมงานรายงาน ณ วันเริ่มงานตามสัญญา', basis: `${B_PROC} ข้อ 178(4)`,
      due: addWorkingDays(sched.start, RULES.supervisorReportWorkingDays), kind: 'working', done: doneOn(bundle, 'start_report'), today, verify: sched.computedStart }))
  }

  // รายงวด
  for (const inst of sortedInstallments(bundle)) {
    const no = Number(inst.installment_no)
    if (iso(inst.due_on)) {
      push(deadline({ key: 'installment_due_report', label: `ผู้ควบคุมงานรายงาน ณ วันครบกำหนดส่งมอบงวดที่ ${no}`, basis: `${B_PROC} ข้อ 178(4)`,
        due: addWorkingDays(inst.due_on, RULES.supervisorReportWorkingDays), kind: 'working', done: iso(inst.due_report_on), today, installmentNo: no }))
    }
    if (iso(inst.chair_acknowledged_on)) {
      push(deadline({ key: 'installment_inspection', label: `คณะกรรมการตรวจรับงวดที่ ${no}`, basis: `${B_PROC} ข้อ 176(5)`,
        due: addWorkingDays(inst.chair_acknowledged_on, RULES.inspectionWorkingDays), kind: 'working', done: iso(inst.inspected_on), today, installmentNo: no }))
    }
  }

  // ส่งมอบงานล่าช้ากว่าวันสิ้นสุดสัญญา → แจ้งสิทธิเรียกค่าปรับภายใน 7 วันทำการนับถัดจากวันครบกำหนด (ข้อ 181)
  const late = lateDelivery(bundle, today)
  if (late) {
    const noticed = sortedInstallments(bundle).map(i => iso(i.fine_notice_date)).filter(Boolean).sort()[0] ?? null
    push(deadline({ key: 'fine_notice', label: 'แจ้งผู้รับจ้างเรื่องสิทธิเรียกค่าปรับ', basis: `${B_PROC} ข้อ 181`,
      due: addWorkingDays(late.end, RULES.fineNoticeWorkingDays), kind: 'working', done: noticed, today }))
  }

  // ผู้รับจ้างแจ้งเหตุขอขยายเวลา/งดลดค่าปรับภายใน 15 วันนับถัดจากเหตุสิ้นสุด (ข้อ 182) — ข้อมูลประกอบการพิจารณา
  for (const ch of bundle?.changes ?? []) {
    if (ch?.kind === 'amend_contract' || !iso(ch?.cause_ended_on)) continue
    push(deadline({ key: 'change_request', label: `ผู้รับจ้างแจ้งขอ${CHANGE_KINDS[ch.kind] ?? 'ขยายเวลา'}`, basis: `${B_PROC} ข้อ 182`,
      due: addDays(ch.cause_ended_on, RULES.changeRequestDays), kind: 'calendar', done: iso(ch.request_received_on), today, party: 'contractor' }))
  }

  // ตรวจความชำรุดครั้งสุดท้ายก่อนครบระยะประกัน (ว 117)
  const w = warrantyWindow(bundle)
  if (w.end) {
    const finalCheck = (bundle?.defects ?? []).filter(d => d?.kind === 'final_before_expiry').map(d => iso(d.inspected_on)).filter(Boolean).sort().at(-1) ?? null
    push(deadline({ key: 'warranty_final_inspection', label: `ตรวจความชำรุดบกพร่องครั้งสุดท้าย (ภายใน ${w.leadDays} วันก่อนครบระยะประกัน)`,
      basis: B_W117, due: w.end, kind: 'calendar', done: finalCheck, today, opensOn: w.opensOn, verify: w.computedStart || w.computedEnd }))
  }

  // ผู้รับจ้างเข้าแก้ไขความชำรุดตามกำหนดในหนังสือแจ้ง
  for (const d of bundle?.defects ?? []) {
    if (d?.result !== 'defect' || !iso(d.fix_due_on)) continue
    push(deadline({ key: 'defect_fix', label: `ผู้รับจ้างแก้ไขความชำรุดบกพร่อง (ตรวจพบ ${d.inspected_on})`, basis: `${B_PROC} ข้อ 184–186`,
      due: d.fix_due_on, kind: 'calendar', done: iso(d.fixed_on), today, party: 'contractor' }))
  }

  // คืนหลักประกันสัญญาภายใน 15 วันนับถัดจากวันพ้นข้อผูกพัน (ข้อ 170(2))
  if (!guaranteeIsNone(bundle)) {
    const obligation = doneOn(bundle, 'obligation_ended') ?? w.end
    if (obligation) {
      push(deadline({ key: 'guarantee_return', label: 'คืนหลักประกันสัญญา', basis: `${B_PROC} ข้อ 170(2)`,
        due: addDays(obligation, RULES.guaranteeReturnDays), kind: 'calendar', done: doneOn(bundle, 'guarantee_returned'), today,
        verify: !doneOn(bundle, 'obligation_ended') }))
    }
  }

  return out.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0))
}

/** ส่งมอบงานล่าช้าหรือไม่ (เทียบวันส่งมอบงวดสุดท้ายกับวันสิ้นสุดที่ใช้จริง) */
function lateDelivery(bundle, today) {
  const end = contractSchedule(bundle).effectiveEnd
  if (!end) return null
  const delivered = iso(finalInstallment(bundle)?.delivered_on)
  const until = delivered ?? today
  if (!(until > end)) return null
  return { end, deliveredOn: delivered, until }
}

// ── ค่าปรับ (ประมาณการเพื่อเตือนเกณฑ์ 10% เท่านั้น) ────────────────────────────────────

/**
 * ประมาณการค่าปรับ = วันล่าช้า × (ค่าปรับต่อวัน + ค่าควบคุมงานต่อวัน) ตามสัญญา
 *   วันล่าช้า นับจากวันสิ้นสุดที่ใช้จริงถึงวันส่งมอบงวดสุดท้าย (ยังไม่ส่ง = ถึงวันนี้)
 *   ⚠️ ไม่ใช่ยอดทางการ: ยอดจริงคำนวณใน e-GP (หักวันที่ราชการทำให้ล่าช้า/งด/ลดค่าปรับที่อนุมัติ ฯลฯ) ระบบไม่เรียก/ไม่หักเอง
 *   overThreshold = เกินร้อยละ 10 ของวงเงินค่าจ้าง → ต้องพิจารณาบอกเลิกสัญญา (ข้อ 183)
 */
export function fineEstimate(bundle, today = bangkokIsoDate()) {
  const c = bundle?.contract ?? {}
  const base = numOrNull(bundle?.project?.contract_amount)
  const finePerDay = numOrNull(c.fine_per_day) ?? 0
  const supervisionPerDay = numOrNull(c.supervision_fee_per_day) ?? 0
  const perDay = finePerDay + supervisionPerDay
  const late = lateDelivery(bundle, today)
  const lateDays = late ? daysBetween(late.end, late.until) : 0
  const amount = lateDays * perDay
  const pct = base ? (amount / base) * 100 : null
  const thresholdDays = base && perDay > 0 ? Math.floor((base * RULES.fineTerminatePct) / 100 / perDay) : null
  return {
    estimate: true,
    lateDays,
    deliveredOn: late?.deliveredOn ?? null,
    perDay,
    amount,
    pct,
    thresholdPct: RULES.fineTerminatePct,
    overThreshold: pct !== null && pct > RULES.fineTerminatePct,
    daysToThreshold: thresholdDays === null ? null : thresholdDays - lateDays,
    basis: `${B_PROC} ข้อ 162, 181, 183`,
  }
}

// ── คำเตือน ─────────────────────────────────────────────────────────────────────

const LEVEL_RANK = { error: 0, warn: 1, info: 2 }
const alert = (level, code, message, extra = {}) => ({ level, code, message, basis: null, due: null, verify: false, ...extra })
const sortAlerts = list => list.sort((a, b) =>
  (LEVEL_RANK[a.level] - LEVEL_RANK[b.level]) || String(a.due ?? '9999').localeCompare(String(b.due ?? '9999')))

/** ราคากลางล่าสุด (ทบทวนแล้วใช้ค่าหลังทบทวน) */
export function medianPrice(bundle) {
  const reviewed = milestoneOf(bundle, 'median_price_reviewed')
  const approved = milestoneOf(bundle, 'median_price_approved')
  return numOrNull(iso(reviewed?.done_on) ? reviewed.amount : null) ?? numOrNull(approved?.amount)
}

/**
 * คำเตือนชุดราคากลาง (ขั้นออกแบบ–จัดซื้อจัดจ้าง)
 *   กรรมการ < 3 คน · วงเงิน 1–20 ล้านแต่ไม่มีเลขโครงการระบบราคากลาง e-GP · เห็นชอบ + 30 วันยังไม่ประกาศ ·
 *   |ราคาผู้ที่จะจ้าง − ราคากลาง| / ราคากลาง ≥ 15% ยังไม่บันทึกหนังสือแจ้ง สตง. · เห็นชอบราคากลางก่อนผู้ออกแบบรับรอง
 */
export function priceAlerts(bundle, today = bangkokIsoDate()) {
  const out = []
  const p = bundle?.project ?? {}
  const ord = stageOrd(baseStage(p)) ?? 0
  const inPriceWork = ord >= 2 || isDone(bundle, 'price_committee_order') || isDone(bundle, 'median_price_approved')
  if (!inPriceWork) return out

  const committee = (bundle?.people ?? []).filter(x => x?.grp === 'price_committee').length
  if (committee < RULES.priceCommitteeMin) {
    out.push(alert('warn', 'price_committee_size', `คณะกรรมการกำหนดราคากลางมี ${committee} คน — ต้องมีประธาน 1 คนและกรรมการอย่างน้อย 2 คน`,
      { basis: `${B_PRICE} ข้อ 16.1` }))
  }

  const budget = numOrNull(p.budget_amount)
  if (budget !== null && budget >= RULES.priceCalcMin && budget <= RULES.priceCalcMax && !milestoneOf(bundle, 'egp_price_calc')?.ref_no) {
    out.push(alert('warn', 'price_calc_egp', 'วงเงิน 1–20 ล้านบาท ต้องคำนวณราคากลางในระบบคำนวณราคากลางงานก่อสร้างอิเล็กทรอนิกส์ (e-GP) — ยังไม่ได้บันทึกเลขโครงการ',
      { basis: MILESTONE_BY_KEY.egp_price_calc.basis, verify: true }))
  }

  if (isDone(bundle, 'median_price_approved') && !isDone(bundle, 'designer_certified')) {
    out.push(alert('warn', 'designer_not_certified', 'ยังไม่ได้บันทึกว่าผู้ออกแบบรับรองรายการและปริมาณงาน', { basis: `${B_PRICE} ข้อ 15` }))
  }

  const publish = deadlines(bundle, today).find(d => d.key === 'median_price_publish')
  if (publish?.state === 'overdue') {
    out.push(alert('error', 'median_price_stale', `ราคากลางเห็นชอบเกิน ${RULES.medianPublishDays} วันแล้วยังไม่ประกาศ — ต้องทบทวนราคากลางก่อนประกาศ`,
      { basis: publish.basis, due: publish.due }))
  } else if (publish && (publish.state === 'open' || publish.state === 'due_today') && publish.daysLeft <= RULES.soonCalendarDays) {
    out.push(alert('warn', 'median_price_publish_soon', `ต้องประกาศภายใน ${publish.due} (เหลือ ${publish.daysLeft} วัน) ไม่งั้นต้องทบทวนราคากลาง`,
      { basis: publish.basis, due: publish.due }))
  }

  const median = medianPrice(bundle)
  const bid = numOrNull(milestoneOf(bundle, 'bid_price')?.amount) ?? numOrNull(p.contract_amount)
  if (median && bid !== null) {
    const gapPct = (Math.abs(bid - median) / median) * 100
    // เทียบแบบปัดเศษ 6 ตำแหน่ง กันเลขลอยตัว (850,000 กับ 1,000,000 ต้องได้ 15 พอดี ไม่ใช่ 14.9999999)
    if (Math.round(gapPct * 1e6) / 1e6 >= RULES.oagPriceGapPct && !isDone(bundle, 'oag_notified_15pct')) {
      out.push(alert('warn', 'price_gap_oag', `ราคาผู้ที่จะจ้างต่างจากราคากลาง ${gapPct.toFixed(2)}% (ตั้งแต่ร้อยละ 15) — คณะกรรมการกำหนดราคากลางต้องแจ้ง สตง. โดยเร็ว`,
        { basis: `${B_PRICE} ข้อ 16`, gapPct }))
    }
  }
  return out
}

/**
 * คำเตือนเรื่องงบประมาณของหลายโครงการในปีงบเดียว (กระดานภาพรวม)
 *   - งบปีนี้ยังไม่ก่อหนี้ผูกพัน ใกล้สิ้นปีงบ → ไม่ทันต้องเสนอสภาอนุมัติกันเงิน (ข้อ 61)
 *   - ก่อหนี้แล้วแต่เบิกไม่ทันสิ้นปี → วางฎีกากันเงินก่อนสิ้นปีไม่น้อยกว่า 30 วัน (ข้อ 59–60)
 *     ลงนามสัญญาในช่วง 30 วันสุดท้ายของปีงบ → ขอผู้บริหารขยายเวลาวางฎีกาได้ถึงวันทำการสุดท้ายของปี (ข้อ 60)
 *   - เงินสะสม: ก่อหนี้ผูกพันภายในไม่เกินหนึ่งปีถัดไปหลังสภาอนุมัติ (ข้อ 97) — วิธีนับต้องยืนยัน ระบบเตือนตามวันที่เร็วที่สุด
 * @param {object[]} bundles
 * @param {number|string} fiscalYear ปีงบ พ.ศ.
 */
export function budgetAlerts(bundles, fiscalYear, today = bangkokIsoDate()) {
  const range = fiscalYearRange(fiscalYear)
  if (!range) return []
  const out = []
  const voucherDue = addDays(range.end, -RULES.carryoverVoucherDaysBeforeFyEnd)
  const lastWorkingDay = addWorkingDays(addDays(range.end, 1), -1)
  for (const bundle of bundles ?? []) {
    const p = bundle?.project ?? {}
    const stage = baseStage(p)
    if (p.stage === 'cancelled' || p.stage === 'terminated' || p.stage === 'closed') continue
    const tag = { projectId: p.id ?? null, projectTitle: p.title ?? null }
    const source = budgetSource(bundle)
    const contractDate = iso(bundle?.contract?.contract_date)
    const committed = Boolean(contractDate) || (stageOrd(stage) ?? 0) >= 4

    if (source?.key === 'budget_accumulated' && source.on && !committed) {
      const due = addDays(addMonths(source.on, 12), -1)
      const left = daysBetween(today, due)
      if (left <= RULES.budgetWarnDays) {
        out.push(alert(left < 0 ? 'error' : 'warn', 'accumulated_commit', `เงินสะสม (สภาอนุมัติ ${source.on}) ยังไม่ก่อหนี้ผูกพัน — ไม่ทันกำหนดเงินสะสมพับไป`,
          { ...tag, due, basis: `${B_FIN} ข้อ 97`, verify: true }))
      }
      continue
    }

    if (String(p.fiscal_year ?? '') !== String(fiscalYear)) continue
    if (source && source.key !== 'budget_annual' && source.key !== 'budget_supplementary') continue

    if (!committed) {
      const left = daysBetween(today, range.end)
      if (today >= range.start && left <= RULES.budgetWarnDays) {
        out.push(alert(left < 0 ? 'error' : 'warn', 'not_committed', `ยังไม่ลงนามสัญญา (ก่อหนี้ผูกพัน) — ไม่ทันสิ้นปีงบ ${fiscalYear} ต้องเสนอสภาอนุมัติกันเงิน มิฉะนั้นงบพับไป`,
          { ...tag, due: range.end, basis: `${B_FIN} ข้อ 59, 61` }))
      }
      continue
    }

    if (!contractDate || contractDate > range.end) continue
    const end = contractSchedule(bundle).effectiveEnd
    const unpaid = sortedInstallments(bundle).some(i => !iso(i.paid_on) || i.paid_on > range.end)
    const needCarry = (end && end > range.end) || unpaid || sortedInstallments(bundle).length === 0
    if (!needCarry || isDone(bundle, 'budget_carryover')) continue
    if (contractDate > voucherDue) {
      out.push(alert('warn', 'carryover_late_contract', `ลงนามสัญญาในช่วง ${RULES.carryoverVoucherDaysBeforeFyEnd} วันสุดท้ายของปีงบ — ต้องขอผู้บริหารขยายเวลาวางฎีกากันเงินได้ถึงวันทำการสุดท้ายของปี`,
        { ...tag, due: lastWorkingDay, basis: `${B_FIN} ข้อ 60` }))
    } else if (daysBetween(today, voucherDue) <= RULES.budgetWarnDays) {
      out.push(alert(today > voucherDue ? 'error' : 'warn', 'carryover_voucher', `เบิกจ่ายไม่ทันสิ้นปีงบ — วางฎีกาขอกันเงินก่อนสิ้นปีไม่น้อยกว่า ${RULES.carryoverVoucherDaysBeforeFyEnd} วัน`,
        { ...tag, due: voucherDue, basis: `${B_FIN} ข้อ 59–60` }))
    }
  }
  return sortAlerts(out)
}

/**
 * คำเตือนทั้งหมดของโครงการเดียว (แถบ "ต้องดูแล")
 *   กำหนดเวลาที่เลยแล้ว/ใกล้ครบ + ชุดราคากลาง + ลงนามก่อนพ้นอุทธรณ์ + ค่าปรับเกิน 10% + หลักประกัน + ความชำรุด
 */
export function projectAlerts(bundle, today = bangkokIsoDate()) {
  const out = []
  const p = bundle?.project ?? {}
  const c = bundle?.contract ?? {}
  if (p.stage === 'cancelled') return out
  const list = deadlines(bundle, today)

  for (const d of list) {
    const extra = { due: d.due, basis: d.basis, verify: d.verify, deadlineKey: d.key, installmentNo: d.installmentNo }
    if (d.party === 'contractor') {
      if (d.state === 'late_done') out.push(alert('info', `${d.key}_late`, `${d.label} เกินกำหนด (${d.doneOn} > ${d.due}) — ข้อมูลประกอบการพิจารณาของผู้มีอำนาจ`, extra))
      else if (d.state === 'overdue') out.push(alert('warn', `${d.key}_overdue`, `${d.label} เลยกำหนด ${d.due} แล้ว`, extra))
      continue
    }
    if (d.mode === 'gate') continue
    if (d.state === 'overdue') {
      out.push(alert('error', `${d.key}_overdue`, `${d.label} — เลยกำหนด ${d.due}`, extra))
    } else if (d.state === 'due_today') {
      out.push(alert('warn', `${d.key}_today`, `${d.label} — ครบกำหนดวันนี้`, extra))
    } else if (d.state === 'open') {
      const soon = d.kind === 'working' ? d.daysLeft <= RULES.soonWorkingDays : d.daysLeft <= RULES.soonCalendarDays
      const notYetOpen = d.opensOn && today < d.opensOn
      if (soon && !notYetOpen) out.push(alert('warn', `${d.key}_soon`, `${d.label} — ภายใน ${d.due} (เหลือ ${d.daysLeft} วัน${d.kind === 'working' ? 'ทำการ' : ''})`, extra))
    }
  }

  out.push(...priceAlerts(bundle, today))

  const appeal = list.find(d => d.key === 'appeal_period')
  const contractDate = iso(c.contract_date)
  if (appeal && contractDate && contractDate <= appeal.due) {
    out.push(alert('error', 'signed_before_appeal_end', `ลงนามสัญญา ${contractDate} ก่อนพ้นระยะอุทธรณ์ (${appeal.due})`, { due: appeal.due, basis: appeal.basis, verify: true }))
  }
  if (isDone(bundle, 'appeal_filed') && !contractDate) {
    out.push(alert('info', 'appeal_filed', 'มีผู้ยื่นอุทธรณ์ — รอผลการพิจารณาอุทธรณ์ก่อนลงนามสัญญา', { basis: `${B_ACT} มาตรา 117` }))
  }

  const contractAmount = numOrNull(p.contract_amount)
  const finePerDay = numOrNull(c.fine_per_day)
  if (contractAmount && finePerDay !== null && finePerDay > 0) {
    const ratePct = (finePerDay / contractAmount) * 100
    if (finePerDay < RULES.fineMinPerDay || ratePct < RULES.fineRatePctMin - 1e-9 || ratePct > RULES.fineRatePctMax + 1e-9) {
      out.push(alert('info', 'fine_rate_check', `อัตราค่าปรับ ${finePerDay.toLocaleString('th-TH')} บาท/วัน (ร้อยละ ${ratePct.toFixed(3)} ของค่าจ้าง) — ตรวจกับสัญญาและข้อ 162 อีกครั้ง`,
        { basis: `${B_PROC} ข้อ 162` }))
    }
  }

  const fine = fineEstimate(bundle, today)
  if (fine.lateDays > 0) {
    if (fine.overThreshold) {
      out.push(alert('error', 'fine_over_threshold', `ค่าปรับประมาณการเกินร้อยละ ${RULES.fineTerminatePct} ของค่าจ้าง (${fine.pct.toFixed(2)}%) — ต้องพิจารณาบอกเลิกสัญญา`,
        { basis: `${B_PROC} ข้อ 183` }))
    } else if (fine.daysToThreshold !== null && fine.daysToThreshold <= 30) {
      out.push(alert('warn', 'fine_near_threshold', `ค่าปรับประมาณการ ${fine.pct.toFixed(2)}% อีก ${fine.daysToThreshold} วันจะเกินร้อยละ ${RULES.fineTerminatePct}`,
        { basis: `${B_PROC} ข้อ 183` }))
    }
    const last = finalInstallment(bundle)
    if (last?.inspection_result === 'accepted' && !last.fine_reserved) {
      out.push(alert('warn', 'fine_not_reserved', 'รับมอบงานที่ส่งล่าช้าโดยยังไม่ได้บันทึกการสงวนสิทธิเรียกค่าปรับ', { basis: `${B_PROC} ข้อ 181` }))
    }
  }

  const expires = iso(c.guarantee_expires_on)
  if (expires && !guaranteeIsNone(bundle) && !isDone(bundle, 'guarantee_returned')) {
    const coverEnd = warrantyWindow(bundle).end ?? contractSchedule(bundle).effectiveEnd
    if (coverEnd && expires < coverEnd) {
      out.push(alert('warn', 'guarantee_short', `หลักประกันสัญญาหมดอายุ ${expires} ก่อนพ้นข้อผูกพัน (${coverEnd}) — ต้องให้ผู้รับจ้างต่ออายุ/เพิ่มหลักประกัน`,
        { due: expires, basis: `${B_PROC} ข้อ 171` }))
    } else if (daysBetween(today, expires) <= 30) {
      out.push(alert(today > expires ? 'error' : 'warn', 'guarantee_expiring', `หลักประกันสัญญาหมดอายุ ${expires}`, { due: expires, basis: `${B_PROC} ข้อ 171` }))
    }
  }

  for (const d of bundle?.defects ?? []) {
    if (d?.result !== 'defect') continue
    if (!iso(d.notice_date)) out.push(alert('warn', 'defect_not_noticed', `ตรวจพบความชำรุด ${d.inspected_on} ยังไม่ได้บันทึกหนังสือแจ้งผู้รับจ้าง`, { basis: `${B_PROC} ข้อ 184–186` }))
    else if (!iso(d.guarantor_notified_on)) out.push(alert('warn', 'defect_guarantor', `ตรวจพบความชำรุด ${d.inspected_on} ยังไม่ได้บันทึกการแจ้งผู้ค้ำประกัน`, { basis: `${B_PROC} ข้อ 184–186` }))
  }

  // ตารางวันหยุดปีที่ยังไม่มีข้อมูล → กำหนดแบบวันทำการนับแค่ตัดเสาร์-อาทิตย์ (คลาดได้)
  const years = [...new Set(list.filter(d => d.kind === 'working' && d.state !== 'done').map(d => Number(d.due.slice(0, 4))))]
  const missing = years.filter(y => missingHolidayYears(y, y).length > 0)
  if (missing.length) {
    out.push(alert('info', 'holidays_missing', `ยังไม่มีตารางวันหยุดราชการของปี ค.ศ. ${missing.join(', ')} — วันครบกำหนดแบบวันทำการนับตัดเฉพาะเสาร์-อาทิตย์ ให้แอดมินกรอกวันหยุด`))
  }

  return sortAlerts(out)
}

// ── เปลี่ยนขั้น (= RPC civil_set_project_stage) ────────────────────────────────────

export const STAGE_ERRORS = {
  unknown: stage => `ไม่รู้จักขั้นโครงการ "${stage ?? '<NULL>'}"`,
  tooLong: 'เหตุผลยาวเกิน 4,000 ตัวอักษร หรือเลขที่หนังสือยาวเกิน 200 ตัวอักษร',
  noWrite: 'ไม่มีสิทธิ์เปลี่ยนขั้นโครงการนี้',
  same: 'โครงการอยู่ขั้นนี้อยู่แล้ว (มีคนเปลี่ยนไปก่อนหรือไม่ — โหลดข้อมูลล่าสุด)',
  suspendClosed: 'ระงับได้เฉพาะโครงการที่ยังดำเนินอยู่ (ไม่ใช่ปิดแล้ว/ยกเลิก/บอกเลิก)',
  holdUnknown: 'โครงการนี้ถูกระงับไว้ก่อนระบบจะจำขั้นเดิม — ให้ "กลับมาดำเนินการ" ที่ขั้นที่ถูกต้องก่อน แล้วค่อยยกเลิก/บอกเลิกสัญญา',
  cancelAfterContract: 'ยกเลิกได้เฉพาะโครงการที่ยังไม่ลงนามสัญญา — ลงนามแล้วให้ใช้ "บอกเลิกสัญญา"',
  terminateRange: 'บอกเลิกสัญญาได้เฉพาะช่วงหลังลงนามสัญญาจนถึงก่อนตรวจรับงวดสุดท้ายเสร็จ',
  invalid: (from, to) => `เปลี่ยนจากขั้น "${from}" ไปขั้น "${to}" ไม่ได้`,
  needManage: 'การเปลี่ยนขั้นนี้ต้องให้หัวหน้ากองหรือผู้ดูแลระบบเป็นผู้ทำ',
  needReason: 'ต้องระบุเหตุผลของการเปลี่ยนขั้นนี้',
  needRef: 'ต้องระบุเลขที่หนังสือ/คำสั่งที่เป็นเหตุของการเปลี่ยนขั้นนี้',
}

// btrim ของ Postgres ตัดเฉพาะช่องว่าง (ไม่ตัดขึ้นบรรทัด/แท็บ) และ length นับตัวอักษร — เลียนแบบให้ตรงกัน
const sqlBtrim = s => (s === null || s === undefined ? '' : String(s)).replace(/^ +| +$/g, '')
const sqlLength = s => [...s].length

/**
 * กติกาเปลี่ยนขั้นของโครงการ (ไม่ดูสิทธิ์/เหตุผล) — ลำดับเงื่อนไขตาม RPC civil_set_project_stage ทุกบรรทัด
 * @param {{ from: string, to: string, hold?: string|null, guaranteeReturned?: boolean, guaranteeNone?: boolean }} args
 * @returns {{ ok: true, needManage: boolean, needReason: boolean, needRef: boolean, newHold: string|null } | { ok: false, error: string }}
 */
export function stageChangeRule({ from, to, hold = null, guaranteeReturned = false, guaranteeNone = false }) {
  if (!STAGES.includes(to)) return { ok: false, error: STAGE_ERRORS.unknown(to) }
  if (to === from) return { ok: false, error: STAGE_ERRORS.same }
  const oldOrd = stageOrd(from)
  const newOrd = stageOrd(to)
  const base = from === 'suspended' ? hold : from
  const baseOrd = stageOrd(base)
  let needManage = true
  let needReason = true
  let needRef = false
  let newHold = null

  if (oldOrd !== null && newOrd === oldOrd + 1) {
    needReason = false
    needManage = to === 'warranty' || to === 'closed'
    if (to === 'closed' && !(guaranteeReturned || guaranteeNone)) needReason = true
  } else if (oldOrd !== null && newOrd !== null) {
    // ข้ามขั้น / ถอยขั้น: ผู้จัดการ + เหตุผล
  } else if (to === 'suspended') {
    if (oldOrd === null || from === 'closed') return { ok: false, error: STAGE_ERRORS.suspendClosed }
    needRef = true
    newHold = from
  } else if (from === 'suspended' && newOrd !== null) {
    // กลับมาดำเนินการ: ผู้จัดการ + เหตุผล
  } else if ((to === 'cancelled' || to === 'terminated') && from === 'suspended' && !hold) {
    return { ok: false, error: STAGE_ERRORS.holdUnknown }
  } else if (to === 'cancelled') {
    if (baseOrd === null || baseOrd > 3) return { ok: false, error: STAGE_ERRORS.cancelAfterContract }
    needRef = true
  } else if (to === 'terminated') {
    if (baseOrd === null || baseOrd < 4 || baseOrd > 7) return { ok: false, error: STAGE_ERRORS.terminateRange }
    needRef = true
  } else if ((from === 'cancelled' || from === 'terminated') && newOrd !== null) {
    // เปิดโครงการใหม่ (แก้การกดผิด): ผู้จัดการ + เหตุผล
  } else {
    return { ok: false, error: STAGE_ERRORS.invalid(from, to) }
  }
  return { ok: true, needManage, needReason, needRef, newHold }
}

/**
 * ตรวจครบชุดก่อนเรียก RPC (ลำดับเดียวกับ RPC) — ใช้บอกผู้ใช้ล่วงหน้า ฐานข้อมูลตรวจซ้ำอยู่ดี
 * @param {{ project: object, to: string, access: { write?: boolean, manage?: boolean }, reason?: string, refNo?: string,
 *           guaranteeReturned?: boolean, guaranteeNone?: boolean }} args
 * @returns {{ ok: boolean, error?: string, newHold?: string|null, needManage?: boolean, needReason?: boolean, needRef?: boolean }}
 */
export function checkStageChange({ project, to, access = {}, reason = null, refNo = null, guaranteeReturned = false, guaranteeNone = false }) {
  if (!STAGES.includes(to)) return { ok: false, error: STAGE_ERRORS.unknown(to) }
  const r = sqlBtrim(reason)
  const ref = sqlBtrim(refNo)
  if (sqlLength(r) > 4000 || sqlLength(ref) > 200) return { ok: false, error: STAGE_ERRORS.tooLong }
  const manage = Boolean(access.manage)
  if (!(manage || access.write)) return { ok: false, error: STAGE_ERRORS.noWrite }
  const rule = stageChangeRule({ from: project?.stage, to, hold: project?.stage_before_hold ?? null, guaranteeReturned, guaranteeNone })
  if (!rule.ok) return rule
  if (rule.needManage && !manage) return { ...rule, ok: false, error: STAGE_ERRORS.needManage }
  if (rule.needReason && !r) return { ...rule, ok: false, error: STAGE_ERRORS.needReason }
  if (rule.needRef && !ref) return { ...rule, ok: false, error: STAGE_ERRORS.needRef }
  return rule
}

/** ข้อเท็จจริงที่ RPC ใช้ตัดสินตอน "ปิดโครงการ" อ่านจาก bundle */
export const closeFacts = bundle => ({ guaranteeReturned: isDone(bundle, 'guarantee_returned'), guaranteeNone: guaranteeIsNone(bundle) })

/**
 * ปุ่มเปลี่ยนขั้นที่ผู้ใช้คนนี้กดได้ (ซ่อนปุ่มที่กดไปก็ไม่ผ่าน) · ต้องกรอกเหตุผล/เลขหนังสือหรือไม่บอกใน needReason/needRef
 * @param {object} bundle
 * @param {{ write?: boolean, manage?: boolean }} access จาก projectAccess() ใน constructionReport.js
 */
export function stageActions(bundle, access = {}) {
  const project = bundle?.project
  if (!project || !(access.write || access.manage)) return []
  const facts = closeFacts(bundle)
  return STAGES.map(to => ({ to, label: STAGE_LABELS[to], rule: stageChangeRule({ from: project.stage, to, hold: project.stage_before_hold ?? null, ...facts }) }))
    .filter(x => x.rule.ok && (!x.rule.needManage || access.manage))
    .map(({ to, label, rule }) => ({ to, label, needManage: rule.needManage, needReason: rule.needReason, needRef: rule.needRef,
      kind: kindOfChange(project.stage, to) }))
}

const kindOfChange = (from, to) => {
  const a = stageOrd(from)
  const b = stageOrd(to)
  if (to === 'suspended') return 'suspend'
  if (to === 'cancelled') return 'cancel'
  if (to === 'terminated') return 'terminate'
  if (from === 'suspended') return 'resume'
  if (from === 'cancelled' || from === 'terminated') return 'reopen'
  if (a !== null && b === a + 1) return 'next'
  return b > a ? 'skip' : 'back'
}

// ── เสนอขั้นถัดไป ────────────────────────────────────────────────────────────────

/**
 * รายการตรวจก่อนปิดโครงการ — ปุ่มปิดเปิดเมื่อครบ (ผู้จัดการปิดข้ามได้พร้อมเหตุผล — RPC บังคับเหตุผลถ้ายังไม่คืนหลักประกัน)
 */
export function closeChecklist(bundle, today = bangkokIsoDate()) {
  const c = bundle?.contract ?? {}
  const p = bundle?.project ?? {}
  const w = warrantyWindow(bundle)
  const last = finalInstallment(bundle)
  const defects = (bundle?.defects ?? []).filter(d => d?.result === 'defect')
  const hasWarranty = Boolean(w.end) || (numOrNull(c.warranty_months) ?? 0) > 0
  const items = [
    { key: 'final_accepted', label: 'ตรวจรับงวดสุดท้ายแล้ว', ok: last?.inspection_result === 'accepted', required: true, basis: `${B_PROC} ข้อ 176` },
    { key: 'warranty_final_inspection', label: 'ตรวจความชำรุดครั้งสุดท้ายก่อนครบระยะประกันแล้ว',
      ok: (bundle?.defects ?? []).some(d => d?.kind === 'final_before_expiry'), required: hasWarranty, basis: B_W117 },
    { key: 'defects_fixed', label: 'ความชำรุดที่ตรวจพบแก้ไขครบแล้ว', ok: defects.every(d => iso(d.fixed_on)), required: defects.length > 0, basis: `${B_PROC} ข้อ 184–186` },
    { key: 'obligation_ended', label: 'พ้นข้อผูกพันตามสัญญาแล้ว',
      ok: isDone(bundle, 'obligation_ended') || Boolean(w.end && today > w.end), required: true },
    { key: 'retention_returned', label: 'คืนเงินประกันผลงานแล้ว', ok: isDone(bundle, 'retention_returned'),
      required: (numOrNull(c.retention_pct) ?? 0) > 0, basis: `${B_CONTRACT} ข้อ 6` },
    { key: 'guarantee_returned', label: 'คืนหลักประกันสัญญาแล้ว', ok: isDone(bundle, 'guarantee_returned') || guaranteeIsNone(bundle),
      required: true, basis: `${B_PROC} ข้อ 170(2)` },
    { key: 'operator_eval_done', label: 'ประเมินผู้ประกอบการใน e-GP แล้ว', ok: isDone(bundle, 'operator_eval_done'),
      required: Boolean(p.operator_eval_required), basis: B_OPEVAL },
  ]
  const missing = items.filter(i => i.required && !i.ok)
  return { ready: missing.length === 0, items, missing: missing.map(i => i.label), needReason: !(closeFacts(bundle).guaranteeReturned || closeFacts(bundle).guaranteeNone) }
}

/**
 * เสนอขั้นถัดไปตามเส้นหลักเมื่อจุดตรวจของขั้นปัจจุบันครบ — คนกดยืนยันครั้งเดียว
 *   started → construction ฐานข้อมูลเลื่อนเองเมื่อล็อกรายงานประจำสัปดาห์แรก (auto = true ไม่ต้องมีปุ่ม)
 * @returns {null | { from, to, label, ready, missing: string[], auto: boolean, needManage: boolean, needReason: boolean }}
 */
export function stageSuggestion(bundle, today = bangkokIsoDate()) {
  const p = bundle?.project
  const ord = stageOrd(p?.stage)
  if (!p || ord === null || ord >= 9) return null
  const to = MAIN_STAGES[ord]
  const c = bundle?.contract ?? {}
  const missing = []
  const need = (ok, label) => { if (!ok) missing.push(label) }
  const last = finalInstallment(bundle)
  let auto = false

  switch (p.stage) {
    case 'budgeted':
      need(budgetSource(bundle), 'แหล่งงบประมาณ')
      break
    case 'designing':
      need(isDone(bundle, 'designer_certified'), MILESTONE_BY_KEY.designer_certified.label)
      need((bundle?.people ?? []).filter(x => x?.grp === 'price_committee').length >= RULES.priceCommitteeMin, 'คณะกรรมการกำหนดราคากลางอย่างน้อย 3 คน')
      need(isDone(bundle, 'median_price_approved'), MILESTONE_BY_KEY.median_price_approved.label)
      break
    case 'procuring': {
      need(iso(c.contract_date), 'วันที่ลงนามสัญญา')
      const appeal = deadlines(bundle, today).find(d => d.key === 'appeal_period')
      if (appeal && iso(c.contract_date)) need(c.contract_date > appeal.due, `ลงนามหลังพ้นระยะอุทธรณ์ (${appeal.due})`)
      break
    }
    case 'contracted':
      need(iso(c.notice_to_proceed_date), 'หนังสือแจ้งให้เริ่มทำงาน (เลขที่/วันที่ จาก e-GP)')
      break
    case 'started':
      auto = true
      need(false, 'ล็อกรายงานผลการก่อสร้างประจำสัปดาห์ครั้งแรก (ระบบเลื่อนขั้นให้เอง)')
      break
    case 'construction':
      need(last && iso(last.delivered_on), 'ผู้รับจ้างส่งมอบงานงวดสุดท้าย')
      break
    case 'final_inspection':
      need(last?.inspection_result === 'accepted', 'ผลตรวจรับงวดสุดท้าย = ตรวจรับ')
      break
    case 'warranty':
      missing.push(...closeChecklist(bundle, today).missing)
      break
    default:
      break
  }
  const rule = stageChangeRule({ from: p.stage, to, ...closeFacts(bundle) })
  return { from: p.stage, to, label: STAGE_LABELS[to], ready: missing.length === 0 && !auto, missing, auto,
    needManage: rule.ok ? rule.needManage : true, needReason: rule.ok ? rule.needReason : true }
}

// ── เหตุที่ใช้ประกอบการประเมินผู้ประกอบการ (ฉบับที่ 3 พ.ศ. 2569 หมวด 7) ────────────────────────
/**
 * ระบบเก็บ "เหตุ" ให้คณะกรรมการใช้ประเมิน — ไม่ให้คะแนนเอง (การประเมินและแจ้งผลทำใน e-GP)
 * เหตุ: ค่าปรับเกินร้อยละ 10 · บอกเลิกสัญญา · ไม่เข้าแก้ไขความชำรุดตามกำหนดในหนังสือแจ้ง
 */
export function operatorEvalEvents(bundle, today = bangkokIsoDate()) {
  const out = []
  const fine = fineEstimate(bundle, today)
  if (fine.overThreshold) out.push({ key: 'fine_over_threshold', label: `ค่าปรับเกินร้อยละ ${RULES.fineTerminatePct} ของค่าจ้าง (ประมาณการ ${fine.pct.toFixed(2)}%)`, on: null, basis: B_OPEVAL })
  if (bundle?.project?.stage === 'terminated') {
    const ev = (bundle?.events ?? []).filter(e => e?.to_stage === 'terminated').map(e => e.ref_date ?? String(e.created_at ?? '').slice(0, 10)).sort().at(-1)
    out.push({ key: 'terminated', label: 'บอกเลิกสัญญา', on: iso(ev) ?? null, basis: B_OPEVAL })
  }
  for (const d of bundle?.defects ?? []) {
    if (d?.result !== 'defect' || !iso(d.fix_due_on)) continue
    const fixed = iso(d.fixed_on)
    if ((fixed && fixed > d.fix_due_on) || (!fixed && today > d.fix_due_on)) {
      out.push({ key: 'defect_not_fixed', label: `ไม่แก้ไขความชำรุดภายในกำหนด ${d.fix_due_on}${fixed ? ` (แก้เสร็จ ${fixed})` : ''}`, on: d.fix_due_on, basis: B_OPEVAL })
    }
  }
  return out
}

// ── เส้นขั้นสำหรับหน้าจอ (แบบ buildTrackSteps ใน complaintTrack.js) ──────────────────────

/**
 * จุดขั้น 9 จุดของเส้นหลัก + จุดหยุด (ยกเลิก/บอกเลิก)
 *   state: done · now · todo · hold (ระงับอยู่ที่ขั้นนี้) · stop
 *   at: เวลาที่เข้าสู่ขั้นนั้นครั้งล่าสุดจากประวัติ (civil_project_events)
 */
export function buildProjectSteps(project, events = []) {
  const stage = project?.stage
  const evs = [...(events ?? [])].sort((a, b) => String(a?.created_at ?? '').localeCompare(String(b?.created_at ?? '')))
  const enteredAt = key => evs.filter(e => e?.to_stage === key).map(e => e.created_at).at(-1) ?? null
  let reached = stageOrd(stage)
  let mark = 'now'
  let stop = null
  if (stage === 'suspended') {
    reached = stageOrd(project?.stage_before_hold)
    mark = 'hold'
  } else if (stage === 'cancelled' || stage === 'terminated') {
    const last = evs.filter(e => e?.to_stage === stage).at(-1)
    reached = stageOrd(last?.from_stage === 'suspended' ? project?.stage_before_hold : last?.from_stage)
    mark = 'stop-from'
    stop = { key: stage, label: STAGE_LABELS[stage], state: 'stop', at: last?.created_at ?? null }
  }
  const steps = MAIN_STAGES.map((key, i) => {
    const n = i + 1
    let state = 'todo'
    if (reached !== null && n < reached) state = 'done'
    else if (reached !== null && n === reached) state = mark === 'stop-from' ? 'done' : (stage === 'closed' ? 'done' : mark)
    return { key, label: STAGE_LABELS[key], state, at: state === 'todo' ? null : enteredAt(key) }
  })
  return stop ? [...steps.filter(s => s.state !== 'todo'), stop] : steps
}
