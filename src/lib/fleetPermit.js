// โหมดขั้นตอนขอใช้รถราย อปท. (P1 + P3) — ตัวช่วยฝั่งหน้าจอ คำนวณล้วน ไม่ import supabase (ทดสอบใน Node ได้)
// ฐานข้อมูล: supabase/migrations/20261121100000_fleet_permit_tables.sql, ..100100_fleet_permit_functions.sql
//           P3 (ข้อ ๑๒ ว.๕ ผู้มีรถประจำตำแหน่ง): 20261123100000_fleet_position_car_columns.sql, ..100100_fleet_position_car_functions.sql
// สองโหมด (อปท. เลือกที่เมนู "การลงนามเอกสาร" แท็บ "ขั้นตอนขอใช้รถ"):
//   queue      = แบบเดิม (ค่าเริ่มต้น) คิวรถอนุมัติอัตโนมัติ ออกรถได้ทันที — หน้าจอไม่เปลี่ยนอะไรเลย
//   regulation = บังคับให้ได้รับอนุญาตก่อนออกรถ ตามข้อ ๑๒ ของระเบียบ มท. ว่าด้วยการใช้และรักษายานพาหนะของ อปท. พ.ศ. ๒๕๖๙
// ⚠️ ข้อความบนหน้าจอ/คู่มือห้ามรับรองผลทางระเบียบหรือกฎหมายของหน่วยงาน — ระบบแค่บังคับลำดับ "ได้รับอนุญาตก่อนออกรถ"
//    ผู้ตัดสินคือคน ระบบบันทึกผลไว้ให้ตรวจย้อน · tests/fleet-permit-lib.test.mjs ตรวจวลีต้องห้ามในไฟล์หน้าจอด้วย
import { thaiDateFromDateInput, thaiDateTimeText } from './thaiDate.js'

export const PERMIT_REGULATION_REF = 'ข้อ ๑๒ ของระเบียบ มท. ว่าด้วยการใช้และรักษายานพาหนะของ อปท. พ.ศ. ๒๕๖๙'

// fleet_trip_permit_info รับได้ไม่เกินก้อนละ 300 ใบ (too_many) · ใบที่ยังไม่จบ = ยังมีเรื่องอนุญาต/ออกรถให้ดู
export const PERMIT_INFO_MAX_IDS = 300
export const PERMIT_OPEN_STATUSES = ['pending', 'waitlisted', 'approved', 'in_progress']
// fleet_record_paper_permit รับวันที่ลงนามย้อนหลังไม่เกิน 60 วัน (p_signed_on < วันนี้ - 60 = bad_date) — tests เทียบกับ SQL
export const PERMIT_PAPER_MAX_BACKDATE_DAYS = 60
export const PERMIT_REASON_MIN = 3
export const PERMIT_REASON_MAX = 500
// เหตุผลความจำเป็นของผู้มีรถประจำตำแหน่ง (fleet_trips.position_car_reason CHECK 5–500 หลังตัดช่องว่าง) — tests เทียบกับ SQL
export const POSITION_CAR_REASON_MIN = 5
export const POSITION_CAR_REASON_MAX = 500

export const PERMIT_MODE_OPTIONS = [
  {
    key: 'queue',
    label: 'คิวอัตโนมัติ (แบบเดิม)',
    summary: 'ระบบกันคิวรถให้อัตโนมัติ และบันทึกออกรถได้ทันที',
    detail: 'การอนุญาตตามระเบียบอยู่ที่ใบขอใช้รถ (แบบ ๓) ซึ่งหน่วยงานดำเนินการเอง ระบบไม่ได้ตรวจว่าได้รับอนุญาตก่อนออกรถหรือยัง',
  },
  {
    key: 'regulation',
    label: 'บังคับอนุญาตก่อนออกรถ (ข้อ ๑๒)',
    summary: 'คิวรถยังกันให้อัตโนมัติเหมือนเดิม แต่ระบบไม่ให้บันทึกออกรถจนกว่าจะได้รับอนุญาต',
    detail: 'ได้รับอนุญาตเมื่อผู้มีอำนาจลงนามออนไลน์ในช่องผู้มีอำนาจสั่งใช้ หรือผู้ดูแลระบบยานพาหนะบันทึกว่าผู้มีอำนาจลงนามในใบกระดาษแล้ว '
      + `เป็นการบังคับให้ได้รับอนุญาตก่อนออกรถ ตาม${PERMIT_REGULATION_REF}`,
  },
]

// สถานะการอนุญาตที่แสดงเป็นป้าย (not_required = โหมด queue ไม่แสดงอะไร)
export const PERMIT_STATE_LABEL = {
  waiting: 'รออนุญาต',
  authorized: 'อนุญาตแล้ว',
  returned: 'ถูกส่งคืนผู้ขอ',
  modified: 'แก้คำขอหลังอนุญาต',
  reason_required: 'ต้องระบุเหตุผล (รถประจำตำแหน่ง)',
  mayor_required: 'ต้องให้นายกอนุญาต',
}
export const PERMIT_STATE_CLR = {
  waiting: '#d97706',
  authorized: '#059669',
  returned: '#dc2626',
  modified: '#dc2626',
  reason_required: '#dc2626',
  mayor_required: '#dc2626',
}
export const PERMIT_VIA_LABEL = { esign: 'ลงนามออนไลน์', paper: 'ใบกระดาษ' }
export const PERMIT_BASIS_LABEL = {
  authority: 'ผู้มีอำนาจสั่งใช้ตามแบบ ๓',
  delegated_dept_head: 'ผอ.สำนัก/กองที่ได้รับมอบหมาย (ข้อ ๑๒ วรรคสี่)',
}

// เหตุที่ใบนี้ไม่ใช้การมอบให้ ผอ.กองอนุมัติ ทั้งที่ อปท. เปิดการมอบไว้ (fleet_trip_permit_approver → v_fallback)
// tests/fleet-permit-lib.test.mjs อ่านรหัสทุกตัวจาก migration แล้วเทียบกับตารางนี้
export const PERMIT_FALLBACK_REASON = {
  self_request: 'ผอ.กองเป็นผู้ขอเอง จึงต้องให้ผู้มีอำนาจอนุญาต',
  no_dept_head: 'กองของผู้ขอยังไม่ได้ตั้งผู้ลงนามในทะเบียน จึงส่งให้ผู้มีอำนาจอนุญาต',
  no_department: 'คำขอนี้ไม่ได้ระบุกอง จึงส่งให้ผู้มีอำนาจอนุญาต',
  requester_is_executive: 'ผู้ขอเป็นผู้บริหารท้องถิ่น จึงส่งให้ผู้มีอำนาจอนุญาตตามแบบ ๓',
  delegation_not_in_effect: 'วันที่ลงนามอยู่ก่อนวันที่คำสั่งมอบหมาย ผอ.สำนัก/กองจึงยังไม่มีอำนาจอนุมัติแทน ต้องให้ผู้มีอำนาจตามแบบ ๓ อนุญาต',
  position_car_holder: 'ผู้ขอมีรถประจำตำแหน่ง จึงต้องให้นายก (ผู้บริหารท้องถิ่น) อนุญาตตามข้อ ๑๒ วรรคห้า ไม่ใช้การมอบให้ ผอ.สำนัก/กอง',
}
export const permitFallbackText = reason => (reason ? (PERMIT_FALLBACK_REASON[reason] ?? '') : '')

// รหัสผลลัพธ์จากฟังก์ชัน DB (คอลัมน์ code) → ข้อความไทย · tests อ่านรหัสทุกตัวจาก migration แล้วเทียบกับตารางนี้
// rate_limited / error มาจากฝั่งหน้าจอ (fleetPermitApi) ไม่อยู่ใน SQL
export const PERMIT_MESSAGES = {
  forbidden: 'ไม่มีสิทธิ์ทำรายการนี้ (ตั้งค่าได้เฉพาะผู้ดูแลระบบของหน่วยงาน · บันทึกการอนุญาตได้เฉพาะผู้ดูแลระบบยานพาหนะ)',
  bad_mode: 'เลือกขั้นตอนขอใช้รถไม่ถูกต้อง กรุณาเลือกใหม่',
  bad_delegation_ref: 'เลขที่คำสั่งมอบหมายต้องไม่เกิน 200 ตัวอักษร',
  bad_delegation_date: 'วันที่คำสั่งมอบหมายต้องไม่เกินวันนี้',
  delegation_evidence_required: 'การมอบให้ ผอ.สำนัก/กองอนุมัติ ต้องกรอกเลขที่และวันที่คำสั่งมอบหมายก่อนบันทึก',
  gate_authority_missing: 'ยังเปิดโหมดบังคับอนุญาตไม่ได้ — ต้องตั้งผู้ลงนามช่อง “นายก” ในทะเบียนผู้ลงนามก่อน (เมนู “การลงนามเอกสาร” แท็บ “ผู้ลงนามแต่ละช่อง”) ไม่งั้นจะไม่มีใครอนุญาตได้ และทุกคำขอจะออกรถไม่ได้',
  too_many: 'ขอข้อมูลการอนุญาตพร้อมกันมากเกินไป กรุณารีเฟรชหน้าแล้วลองใหม่',
  not_required: 'คำขอนี้ใช้ขั้นตอนแบบคิวอัตโนมัติ ไม่ต้องบันทึกการอนุญาต',
  bad_status: 'บันทึกหรือยกเลิกการอนุญาตได้เฉพาะคำขอที่ยังไม่ออกเดินทาง (รออนุมัติ รอจัดสรรรถ หรืออนุมัติแล้ว)',
  already_authorized: 'คำขอนี้ได้รับอนุญาตแล้ว ไม่ต้องบันทึกซ้ำ — รีเฟรชหน้าเพื่อดูสถานะล่าสุด',
  bad_date: `วันที่ลงนามต้องไม่เกินวันนี้ และย้อนหลังได้ไม่เกิน ${PERMIT_PAPER_MAX_BACKDATE_DAYS} วัน`,
  delegation_not_applicable: 'ใบนี้ใช้การมอบให้ ผอ.สำนัก/กองอนุมัติไม่ได้ กรุณาเลือก “ผู้มีอำนาจสั่งใช้ตามแบบ ๓”',
  bad_basis: 'เลือกผู้อนุญาตไม่ถูกต้อง กรุณาเลือกใหม่',
  signatory_missing: 'ยังไม่ได้ตั้งผู้ลงนามช่องนี้ในทะเบียน — ให้ผู้ดูแลระบบของหน่วยงานตั้งที่เมนู “การลงนามเอกสาร” แท็บ “ผู้ลงนามแต่ละช่อง” ก่อน',
  not_found: 'ไม่พบบันทึกการอนุญาตนี้ อาจถูกยกเลิกหรือคำขอถูกลบไปแล้ว',
  already_voided: 'บันทึกนี้ถูกยกเลิกไปแล้ว',
  bad_reason: `เหตุผลต้องยาว ${PERMIT_REASON_MIN}–${PERMIT_REASON_MAX} ตัวอักษร`,
  reason_required: 'ผู้ขอมีรถประจำตำแหน่ง — ต้องกรอกเหตุผลความจำเป็นในคำขอก่อน (แก้คำขอแล้วกรอกช่อง “เหตุผลความจำเป็น”) จึงจะบันทึกการอนุญาตได้',
  mayor_required: 'ผู้ขอมีรถประจำตำแหน่ง — ผู้มีอำนาจสั่งใช้ในคำขอต้องเป็นนายก (แก้คำขอแล้วเลือกผู้มีอำนาจเป็นนายก) จึงจะบันทึกการอนุญาตได้',
  rate_limited: 'ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
  error: 'ทำรายการไม่สำเร็จ กรุณาลองใหม่',
}

// mayor_required ที่มาจาก "การอนุญาตเดิมไม่ได้มาจากนายก" (state.non_mayor_permit — เช่นเปลี่ยนรถทีหลัง) ทางแก้คือถอน/ยกเลิก
// ไม่ใช่แก้ผู้มีอำนาจในคำขอ (ผู้มีอำนาจเป็นนายกอยู่แล้ว) — ข้อความ mayor_required ปกติจึงบอกผิดทาง
export const PERMIT_NON_MAYOR_PERMIT_TEXT = 'ผู้ขอมีรถประจำตำแหน่ง — มีการอนุญาตเดิมที่ไม่ได้มาจากนายกค้างอยู่ จึงบันทึกเพิ่มไม่ได้ '
  + 'ให้ยกเลิกบันทึกใบกระดาษเดิม หรือถอนลายเซ็นช่องผู้มีอำนาจเดิมก่อน แล้วจึงบันทึกการอนุญาตของนายก'

// ข้อความ error ที่ trigger บน fleet_trips โยน (RAISE EXCEPTION 'FLEET_PERMIT_…: …') — FleetTrips รวมเข้า tripErrorMessage
// ⚠️ FLEET_PERMIT_REQUIRED ขึ้นเมื่อกดบันทึกออกรถก่อนได้รับอนุญาต (ปุ่มปิดไว้อยู่แล้ว ข้อความนี้เผื่อหน้าค้าง/เครื่องที่ข้อมูลเก่า)
export const PERMIT_TRIP_EXCEPTIONS = {
  FLEET_PERMIT_REQUIRED: 'บันทึกออกรถไม่ได้ — คำขอนี้ยังไม่ได้รับอนุญาตจากผู้มีอำนาจ (หน่วยงานนี้ใช้ขั้นตอนบังคับอนุญาตก่อนออกรถ) '
    + 'ให้ผู้มีอำนาจลงนามออนไลน์ หรือให้ผู้ดูแลระบบยานพาหนะบันทึกการอนุญาตจากใบกระดาษ แล้วรีเฟรชหน้าก่อนลองอีกครั้ง',
  FLEET_PERMIT_APPEND_ONLY: 'บันทึกการอนุญาตแก้ไขหรือลบไม่ได้ ให้ยกเลิกบันทึกพร้อมเหตุผลแทน',
  FLEET_POSITION_REASON_LOCKED: 'แก้เหตุผลความจำเป็นไม่ได้ — คำขอนี้มีการลงนามหรือบันทึกการอนุญาตแล้ว (ผู้อนุญาตเห็นเหตุผลเดิม) '
    + 'ให้ถอนลายเซ็นหรือยกเลิกบันทึกการอนุญาตก่อน แล้วขออนุญาตใหม่',
  FLEET_HOLDER_POSITION_TENANT: 'ตำแหน่งผู้ถือรถประจำตำแหน่งต้องเป็นตำแหน่งของหน่วยงานเดียวกับรถ กรุณาเลือกใหม่',
}

// ผลจาก RPC → ข้อความ · delegation_not_applicable แนบเหตุจาก fallback_reason ให้ด้วย (ผู้บันทึกจะรู้ว่าต้องแก้อะไร)
// mayor_required + non_mayor_permit (หน้าจอแนบจากสถานะของใบ — RPC บันทึกไม่ได้ส่งมา) = ข้อความให้ถอน/ยกเลิกของเดิม
export function permitMessage(result) {
  if (!result) return PERMIT_MESSAGES.error
  const code = typeof result === 'string' ? result : result.code
  if (code === 'mayor_required' && typeof result === 'object' && result.non_mayor_permit === true) return PERMIT_NON_MAYOR_PERMIT_TEXT
  const base = PERMIT_MESSAGES[code] ?? result.message ?? PERMIT_MESSAGES.error
  const why = typeof result === 'object' ? permitFallbackText(result.fallback_reason) : ''
  return why ? `${base} (${why})` : base
}

// ปุ่มบันทึกออกรถต้องปิดไหม — เฉพาะใบโหมด regulation ที่ยังไม่ authorized
// info ว่าง/ยังโหลดไม่เสร็จ/ดึงไม่ได้ = ไม่บล็อกฝั่งหน้าจอ: ด่านจริงคือ trigger ใน DB (ถ้าปฏิเสธ หน้าจอแสดงข้อความไทยจาก PERMIT_TRIP_EXCEPTIONS)
// การบล็อกเมื่อ "ไม่รู้" จะทำให้ อปท. โหมด queue ที่ RPC ล้มเหลวออกรถไม่ได้ทั้งที่ไม่เกี่ยวกับโหมดนี้เลย
export function permitBlocksDepart(info) {
  if (!info || typeof info !== 'object') return false
  return info.permit_mode === 'regulation' && info.state !== 'authorized'
}

// ป้ายข้างสถานะคิว — โหมด queue/ไม่มีข้อมูล = null (ไม่แสดงอะไร)
// tripStatus: ใบที่ออกรถไปแล้ว (in_progress) ไม่ขึ้นป้าย ว.๕ ย้อนหลัง — ผูกผู้ถือรถทีหลังทำให้ DB คำนวณใบที่ออกไปแล้ว
// เป็น reason_required/mayor_required ได้ (ตั้งใจให้คำนวณสด) แต่การอนุญาตตอนออกรถผ่านด่านไปแล้ว ป้ายจะทำให้เข้าใจผิด
const POSITION_CAR_STATES = new Set(['reason_required', 'mayor_required'])
export function permitBadge(info, tripStatus) {
  if (!info || info.permit_mode !== 'regulation') return null
  if (tripStatus === 'in_progress' && POSITION_CAR_STATES.has(info.state)) return null
  const label = PERMIT_STATE_LABEL[info.state]
  return label ? { label, color: PERMIT_STATE_CLR[info.state] } : null
}

// ชื่อ + ฐานะผู้อนุญาตที่คาดหวัง · ยังไม่ได้ตั้งผู้ลงนามในทะเบียน = บอกตรงๆ ไม่แต่งชื่อ
export function permitApproverText(approver) {
  if (!approver || typeof approver !== 'object') return ''
  const name = String(approver.name ?? '').trim()
  // ผู้ได้รับมอบ (ข้อ ๑๒ ว.๔): DB ตอบฐานะเต็ม "<ตำแหน่ง ผอ.> ปฏิบัติราชการแทน<ตำแหน่งนายก>" มาใน acting_title — แสดงฐานะนี้แทนตำแหน่งเปล่า
  const title = String(approver.acting_title ?? '').trim() || String(approver.title ?? '').trim()
  if (!approver.registry_id || !name) {
    return `${title || 'ผู้มีอำนาจสั่งใช้ยานพาหนะ'} (ยังไม่ได้ตั้งผู้ลงนามในทะเบียน)`
  }
  return title ? `${name} (${title})` : name
}

// ฐานะ "ปฏิบัติราชการแทน" บนใบพิมพ์ — ประกอบแบบเดียวกับ fleet_permit_acting_title ใน DB (ไม่มีเว้นวรรคหลังคำว่าแทน)
// เจ้าของระบบสั่ง 2569-11-12: ไม่พิมพ์เลขที่คำสั่งมอบหมายบนใบ · ไม่รู้ตำแหน่งนายก = คำกลาง "ผู้บริหารท้องถิ่น" เหมือนฝั่ง DB
export function permitActingTitle(deptHeadTitle, mayorTitle) {
  const own = String(deptHeadTitle ?? '').trim() || 'ผู้อำนวยการสำนัก/กอง'
  const head = String(mayorTitle ?? '').trim() || 'ผู้บริหารท้องถิ่น'
  return `${own} ปฏิบัติราชการแทน${head}`
}

// ผู้อนุญาตที่ใบพิมพ์แบบ 3 (เซ็นสด/ยังไม่ลงนามออนไลน์ช่องอนุญาต) ต้องพิมพ์แทนนายก — คืน { name, title } หรือ null = ใช้ผู้มีอำนาจตามเดิม
//   ใบที่ได้รับอนุญาตแล้ว: เฉพาะใบกระดาษที่บันทึกว่า ผอ.ลงนามในฐานะผู้ได้รับมอบ (basis=delegated_dept_head) ใช้ชื่อ/ตำแหน่งจากบันทึกนั้น
//     (ลงนามออนไลน์แล้วใช้ signedAs จากลายเซ็นในใบอยู่แล้ว · อนุญาตด้วยฐาน authority = ผู้มีอำนาจตามเดิม ทั้งที่ approver ยังเป็น ผอ.ได้)
//   ใบที่ยังไม่ได้รับอนุญาต: approver เป็น delegated_dept_head = ผอ. (ใช้ acting_title จาก DB ไม่มี = ประกอบเอง)
//   โหมด queue / ไม่มีข้อมูล / ผู้อนุญาตเป็นนายก = null (ใบเดิมทุกไบต์)
export function permitPrintAuthority({ info, mayorTitle = '' } = {}) {
  if (!info || typeof info !== 'object' || info.permit_mode !== 'regulation') return null
  if (info.state === 'authorized') {
    if (info.via !== 'paper' || info.basis !== 'delegated_dept_head') return null
    const name = String(info.signer_name ?? '').trim()
    if (!name) return null
    return { name, title: permitActingTitle(info.signer_title, mayorTitle) }
  }
  const approver = info.approver
  if (approver?.kind !== 'delegated_dept_head') return null
  const name = String(approver.name ?? '').trim()
  if (!approver.registry_id || !name) return null
  return { name, title: String(approver.acting_title ?? '').trim() || permitActingTitle(approver.title, mayorTitle) }
}

// ข้อความสั้นใต้ปุ่มออกรถ — "รออนุญาตจาก …"
export function permitDepartHint(info) {
  if (!permitBlocksDepart(info)) return ''
  if (info.state === 'returned') return 'ถูกส่งคืนผู้ขอ — ต้องลงนามใหม่และได้รับอนุญาตก่อนออกรถ'
  if (info.state === 'modified') return 'คำขอถูกแก้หลังได้รับอนุญาต — ต้องขออนุญาตใหม่ก่อนออกรถ'
  if (info.state === 'reason_required') return 'ผู้ขอมีรถประจำตำแหน่ง — ต้องกรอกเหตุผลความจำเป็นก่อน'
  if (info.state === 'mayor_required') {
    return info.non_mayor_permit
      ? 'ผู้ขอมีรถประจำตำแหน่ง — การอนุญาตเดิมไม่ได้มาจากนายก ต้องถอน/ยกเลิกแล้วให้นายกอนุญาต'
      : 'ผู้ขอมีรถประจำตำแหน่ง — ผู้มีอำนาจสั่งใช้ต้องเป็นนายก'
  }
  const approver = info.approver
  const name = String(approver?.name ?? '').trim()
  const who = approver?.registry_id && name ? name : (String(approver?.title ?? '').trim() || 'ผู้มีอำนาจ')
  return `รออนุญาตจาก ${who}`
}

// ข้อความอธิบายส่วน "การอนุญาตใช้รถ" ตอนรอ — รอใคร ในฐานะอะไร และเหตุที่ไม่ใช้การมอบ (ถ้ามี)
export function permitWaitingLines(info) {
  if (!info || info.permit_mode !== 'regulation' || info.state === 'authorized') return []
  const lines = []
  if (info.state === 'returned') {
    lines.push('ใบนี้ถูกส่งคืนผู้ขอ — ผู้ขอแก้ไขและลงนามใหม่ ผู้มีอำนาจจึงอนุญาตต่อได้')
  }
  if (info.state === 'modified') {
    // ใบกระดาษผูกกับเนื้อหาคำขอ (ปลายทาง วัตถุประสงค์ จำนวนคน กำหนดไป-กลับ ฯลฯ) ตอนบันทึก — แก้แล้วการอนุญาตเดิมไม่นับ
    const who = String(info.signer_name ?? '').trim()
    lines.push(`มีบันทึกการอนุญาตจากใบกระดาษ${who ? ` (${who})` : ''} แต่คำขอถูกแก้ไขหลังบันทึก การอนุญาตเดิมจึงใช้ไม่ได้ — ให้ผู้มีอำนาจลงนามใบที่แก้แล้ว แล้วบันทึกใหม่`)
  }
  const car = positionCarText(info.position_car)
  if (info.state === 'reason_required') {
    lines.push(`ผู้ขอมีรถประจำตำแหน่ง${car ? ` ${car}` : ''} — ใช้ยานพาหนะส่วนกลางได้เฉพาะจำเป็นเฉพาะคราว ต้องกรอกเหตุผลความจำเป็นในคำขอก่อน (${PERMIT_POSITION_CAR_REF})`)
  }
  if (info.state === 'mayor_required') {
    lines.push(info.non_mayor_permit
      // การอนุญาตเดิมมาจาก ผอ.ที่ได้รับมอบ ตอนใบยังไม่เข้า ว.๕ (เช่น เปลี่ยนรถทีหลัง) — DB ไม่นับจนกว่าจะถอน/ยกเลิก
      ? `ผู้ขอมีรถประจำตำแหน่ง${car ? ` ${car}` : ''} — การอนุญาตที่มีอยู่ไม่ได้มาจากนายก จึงใช้ไม่ได้ ให้ถอนลายเซ็นหรือยกเลิกบันทึกใบกระดาษ แล้วขออนุญาตจากนายก (${PERMIT_POSITION_CAR_REF})`
      : `ผู้ขอมีรถประจำตำแหน่ง${car ? ` ${car}` : ''} — ต้องขออนุญาตจากนายก (ผู้บริหารท้องถิ่น) ให้แก้คำขอเลือกผู้มีอำนาจสั่งใช้เป็นนายก (${PERMIT_POSITION_CAR_REF})`)
  }
  const approver = info.approver
  if (approver) {
    const text = permitApproverText(approver)
    lines.push(approver.kind === 'delegated_dept_head'
      ? `รออนุญาตจาก ${text} ในฐานะผู้ได้รับมอบหมายให้อนุมัติแทนผู้บริหารท้องถิ่น`
      : `รออนุญาตจาก ${text}`)
    if (approver.kind === 'delegated_dept_head' && approver.delegation_ref) {
      const dateText = thaiDateFromDateInput(approver.delegation_date)
      lines.push(`ตามคำสั่งมอบหมาย ${approver.delegation_ref}${dateText ? ` ลงวันที่ ${dateText}` : ''}`)
    }
    const why = permitFallbackText(approver.fallback_reason)
    if (why) lines.push(why)
  }
  return lines
}

// ── P3 ข้อ ๑๒ ว.๕ ผู้มีรถประจำตำแหน่ง ─────────────────────────────────────────────────────────────
export const PERMIT_POSITION_CAR_REF = 'ข้อ ๑๒ วรรคห้า'

// position_car จาก DB = { vehicle_id, license_plate, name, position_name } → "ทะเบียน กข 1 (ตำแหน่ง ปลัด อบต.)"
export function positionCarText(car) {
  if (!car || typeof car !== 'object') return ''
  const plate = String(car.license_plate ?? '').trim()
  const position = String(car.position_name ?? '').trim()
  if (!plate && !position) return ''
  return `${plate ? `ทะเบียน ${plate}` : ''}${position ? `${plate ? ' ' : ''}(ตำแหน่ง ${position})` : ''}`
}

// แถบเตือนในฟอร์มขอใช้รถ — ใช้เฉพาะ อปท. โหมด regulation ที่ fleet_position_car_check ตอบ position_car มา
// requesterIsMayor: ผู้ขอเป็นนายก = ทาง สก.๑ (ว.๖) ไม่ต้องล็อกผู้มีอำนาจ แต่ยังต้องกรอกเหตุผล
export function positionCarNotice(car, { self = true, requesterIsMayor = false } = {}) {
  const text = positionCarText(car)
  if (!text) return ''
  const who = self ? 'ท่านมีรถประจำตำแหน่ง' : 'ผู้ขอมีรถประจำตำแหน่ง'
  const need = requesterIsMayor
    ? 'ต้องระบุเหตุผลความจำเป็น'
    : 'ต้องระบุเหตุผลความจำเป็น และนายก (ผู้บริหารท้องถิ่น) เป็นผู้อนุญาต'
  return `${who} ${text} — ใช้ยานพาหนะส่วนกลางได้เฉพาะจำเป็นเฉพาะคราว ${need} (${PERMIT_POSITION_CAR_REF})`
}

// ใบที่ต้องแก้คำขอก่อน (กรอกเหตุผล / เปลี่ยนผู้มีอำนาจเป็นนายก) — บันทึกใบกระดาษไม่ได้จนกว่าจะแก้
export function permitNeedsRequestFix(info) {
  return Boolean(info) && POSITION_CAR_STATES.has(info.state)
}

// ตรวจเหตุผลในฟอร์ม → '' = ผ่าน · ตรงกับ CHECK ใน DB (ตัดช่องว่างหัวท้ายก่อนนับ)
export function positionCarReasonError(value) {
  const length = String(value ?? '').trim().length
  if (length === 0) return 'กรุณากรอกเหตุผลความจำเป็นในการใช้ยานพาหนะส่วนกลาง (ผู้มีรถประจำตำแหน่ง)'
  if (length < POSITION_CAR_REASON_MIN || length > POSITION_CAR_REASON_MAX) {
    return `เหตุผลความจำเป็นต้องยาว ${POSITION_CAR_REASON_MIN}–${POSITION_CAR_REASON_MAX} ตัวอักษร`
  }
  return ''
}

// ข้อความตอนได้รับอนุญาตแล้ว — ช่องทาง ใคร เมื่อไร ใครบันทึก (ใบกระดาษ) และคำสั่งมอบหมาย (ถ้าอนุญาตในฐานะผู้ได้รับมอบ)
export function permitAuthorizedLines(info) {
  if (!info || info.permit_mode !== 'regulation' || info.state !== 'authorized') return []
  const who = [String(info.signer_name ?? '').trim(), String(info.signer_title ?? '').trim()].filter(Boolean)
  const signer = who.length === 2 ? `${who[0]} (${who[1]})` : (who[0] ?? '—')
  const lines = []
  if (info.via === 'esign') {
    const slot = info.slot === 'sk1' ? ' (บันทึกรับรอง สก.๑)' : ''
    const at = thaiDateTimeText(info.signed_at)
    lines.push(`${PERMIT_VIA_LABEL.esign}${slot} โดย ${signer}${at ? ` เมื่อ ${at}` : ''}`)
  } else {
    const day = thaiDateFromDateInput(info.signed_on)
    lines.push(`${PERMIT_VIA_LABEL.paper} ผู้อนุญาต ${signer}${day ? ` ลงนามวันที่ ${day}` : ''}`)
    const by = String(info.recorded_by_name ?? '').trim()
    const at = thaiDateTimeText(info.recorded_at)
    if (by || at) lines.push(`บันทึกโดย ${by || '—'}${at ? ` เมื่อ ${at}` : ''}`)
    if (info.basis === 'delegated_dept_head') {
      const dateText = thaiDateFromDateInput(info.delegation_date)
      lines.push(`อนุญาตในฐานะ ${PERMIT_BASIS_LABEL.delegated_dept_head}${info.delegation_ref ? ` ตามคำสั่งมอบหมาย ${info.delegation_ref}` : ''}${dateText ? ` ลงวันที่ ${dateText}` : ''}`)
    }
  }
  return lines
}

// ช่วงวันที่ลงนามที่ผู้ดูแลเลือกได้ในกล่องบันทึกใบกระดาษ (YYYY-MM-DD) — ตรงกับที่ DB รับ: ไม่เกินวันนี้ ย้อนหลังไม่เกิน 60 วัน
// ใช้ UTC ล้วนคำนวณวัน ไม่พึ่ง timezone เครื่อง · today มาจาก todayBangkok() (ผู้เรียกส่งเข้ามา เพื่อให้ฟังก์ชันนี้ล้วน)
export function permitSignedOnRange(today) {
  const match = String(today ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return { min: '', max: '' }
  const back = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) - PERMIT_PAPER_MAX_BACKDATE_DAYS))
  return { min: back.toISOString().slice(0, 10), max: today }
}

// รายการ id ที่ต้องถาม fleet_trip_permit_info — เฉพาะใบ regulation ที่ยังไม่จบ
// ใบที่ select ไม่มีคอลัมน์ permit_mode (ฐานที่ยังไม่ apply) หรือเป็น queue ไม่ถูกนับ ⇒ อปท. โหมด queue ไม่ยิง RPC เลย
export function permitInfoIds(trips) {
  const seen = new Set()
  for (const trip of trips ?? []) {
    if (trip?.permit_mode === 'regulation' && trip.id && PERMIT_OPEN_STATUSES.includes(trip.status)) seen.add(trip.id)
  }
  return [...seen]
}

export function chunkIds(ids, size = PERMIT_INFO_MAX_IDS) {
  const out = []
  for (let index = 0; index < ids.length; index += size) out.push(ids.slice(index, index + size))
  return out
}

// ผล RPC (หลายก้อน) → Map trip_id → info · ก้อนที่ล้มเหลวข้ามไป (ไม่รู้ = ไม่บล็อกฝั่งหน้าจอ ดู permitBlocksDepart)
export function permitInfoMap(results) {
  const map = new Map()
  for (const result of results ?? []) {
    if (result?.ok !== true || !Array.isArray(result.items)) continue
    for (const item of result.items) if (item?.trip_id) map.set(item.trip_id, item)
  }
  return map
}

// ใบที่ผู้ใช้เปิดบันทึกการอนุญาตได้ (ปุ่มโผล่จาก can_record ที่ DB ตอบ) — ตัวเลือกผู้อนุญาตในกล่อง
// authority มีเสมอ · delegated_dept_head เฉพาะเมื่อ approver.kind เป็นผู้ได้รับมอบ (ตรงกับที่ DB ยอมรับ)
export function permitBasisOptions(info) {
  const approver = info?.approver
  const delegated = approver?.kind === 'delegated_dept_head'
  const options = [{
    key: 'authority',
    label: PERMIT_BASIS_LABEL.authority,
    // กรณีมอบ ไม่เดาชื่อ: ผู้มีอำนาจตามแบบ ๓ ของใบอาจถูกเลือกไว้ในคำขอ ให้ DB ดึงจากทะเบียนตอนบันทึก
    who: delegated ? 'ผู้มีอำนาจสั่งใช้ตามแบบ ๓' : permitApproverText(approver),
  }]
  if (delegated) {
    options.push({ key: 'delegated_dept_head', label: PERMIT_BASIS_LABEL.delegated_dept_head, who: permitApproverText(approver) })
  }
  return options
}
