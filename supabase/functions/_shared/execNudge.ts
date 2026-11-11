// ตรรกะล้วนของ "ส่งให้กองเร่งรัด" (ห้องผู้บริหาร E3-2) — ใช้ใน exec-nudge-notify และเทสต์ node import ตรง
// ห้ามแตะ Deno/fetch/Supabase ในไฟล์นี้ เทสต์รันด้วย node (type stripping) ได้ทันที
//
// ข้อมูลเข้ามาจาก exec_nudge_payload(nudge_id) (migration 20261117100100) เท่านั้น — ไม่มีชื่อผู้ร้อง รายละเอียด ที่อยู่
// เบอร์ หรือผู้รับผิดชอบ ⇒ ข้อความ Telegram ประกอบจากฟิลด์ชุดนั้นได้อย่างเดียว (PDPA: ลบย้อนหลังจาก Telegram ไม่ได้)
//
// เส้นทางส่ง (เจ้าของระบบเลือก 2026-11-11):
//   ผอ.กองที่ผูก Telegram ส่วนตัว ≥1 คน → DM (ไม่เคารพ dm_muted — ผอ.กองปิดรับเร่งรัดไม่ได้ ไม่มีหมวดนี้ใน dm_muted)
//   ไม่มี ผอ.กอง / ไม่มีใครผูก / DM ส่งไม่ถึงทุกคน → เข้ากลุ่ม Telegram ของ อปท.
//   ไม่มีกลุ่มด้วย → none (หน้าเว็บบอกผู้บริหารตรงๆ ว่าส่งไม่ถึง ให้แจ้งกองช่องทางอื่น)
//   sendable=false (เรื่องอ่อนไหว/ปิดแล้ว/parked/หาย) → none ไม่ส่งอะไรเลย (ด่านชั้นที่สองต่อจาก exec_nudge)
//   requester_is_head (ผู้สั่งเป็น ผอ.กองของกองนั้นเอง) → none ไม่ตกไปกลุ่ม

export type NudgePayload = {
  sendable: boolean
  nudge: {
    id: string
    municipality_id: string
    item_kind: 'complaint' | 'document_request' | string
    item_id: string
    item_ref: string | null
    delivery: string
    nudged_by: string | null
    requested_by: string | null
    nudged_by_position: string
    nudged_at: string
    attempt_count: number
  }
  item: {
    ref: string
    status: string | null
    due: string | null
    created: string | null
    cat: string | null
    cat_label: string | null
  } | null
  department: { id: string; name: string | null; short_name: string | null } | null
  heads: string[]
  requester_is_head: boolean
}

export type Delivery = 'dm' | 'group' | 'none' | 'failed'

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

/** บทบาทบุคลากรที่รับ DM ได้ — ชุดเดียวกับเงื่อนไข heads ใน exec_nudge_payload (ตรวจซ้ำกันข้อมูลผิดพลาด) */
export const HEAD_ROLES = new Set(['officer', 'staff', 'admin', 'technician'])

/** delivery_note ในตารางจำกัด 300 ตัว */
export const NOTE_MAX = 300

export function clean(value: unknown, max = 200): string {
  return String(value ?? '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

export function esc(value: unknown, max = 200): string {
  return clean(value, max).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function note(text: unknown): string {
  return clean(text, NOTE_MAX)
}

// ต้องตรงกับ STATUS ใน ComplaintsManager.jsx (เฉพาะสถานะ "ค้าง" — เร่งได้แต่เรื่องค้าง)
const COMPLAINT_STATUS: Record<string, string> = {
  new: 'คำร้องใหม่', pending: 'คำร้องใหม่', received: 'รับเรื่องแล้ว', in_progress: 'กำลังดำเนินการ',
}
// ต้องตรงกับ STATUS ใน MyDocRequests.jsx
const DOCUMENT_STATUS: Record<string, string> = {
  pending: 'รอดำเนินการ', processing: 'กำลังดำเนินการ',
}

// ⚠️ สำเนาของ BASE_DOCUMENT_TYPES ใน src/lib/documentTypes.js (ชื่อล้วน ไม่มีอีโมจิ) — edge function import โค้ดเว็บไม่ได้
// เทสต์ tests/exec-nudge-notify.test.mjs เทียบทีละประเภท เพิ่มประเภทใหม่แล้วลืมแก้ที่นี่ = เทสต์ล้ม
// ประเภทที่ อปท. เพิ่มเอง (fee_schedule._custom_types) อ่านจาก municipalities ตอนส่ง
export const DOCUMENT_TYPE_LABEL: Record<string, string> = {
  tax_notice: 'ค่าธรรมเนียม/ภาษี',
  waste_collection: 'ค่าธรรมเนียมขยะ',
  waste_collection_request: 'ขอรับบริการเก็บขนขยะมูลฝอย',
  waste_collection_cancel: 'ขอยกเลิกการเก็บขนขยะมูลฝอย',
  water_supply_request: 'ขออนุญาตใช้น้ำประปา',
  water_meter_change: 'ขออนุญาตเปลี่ยนมาตรน้ำประปา',
  water_supply_cancel: 'ขอยกเลิกใช้น้ำประปา',
  public_assistance_request: 'ขอรับการช่วยเหลือประชาชน',
  asset_borrow_request: 'ขอยืมพัสดุ/ครุภัณฑ์',
  patient_transport_request: 'ขออนุเคราะห์รถรับ-ส่งผู้ป่วย',
  building_permit: 'ขออนุญาตก่อสร้างบ้าน',
  cctv_footage_request: 'ขอภาพจากกล้องวงจรปิด',
  // ถอดจากลิสต์ยื่นใหม่แล้วแต่คำขอเก่ายังค้างได้
  residence_cert: 'ใบรับรองการอยู่อาศัย',
  personal_cert: 'หนังสือรับรองบุคคล',
}

export function documentTypeLabel(value: unknown, feeSchedule: unknown): string {
  const key = clean(value, 60)
  if (DOCUMENT_TYPE_LABEL[key]) return DOCUMENT_TYPE_LABEL[key]
  const custom = (feeSchedule as { _custom_types?: unknown } | null)?._custom_types
  if (Array.isArray(custom)) {
    const hit = custom.find((t) => clean((t as Record<string, unknown>)?.value, 60) === key) as
      Record<string, unknown> | undefined
    if (hit && clean(hit.label, 80)) return clean(hit.label, 80)
  }
  return key || 'ไม่ระบุประเภท'
}

/** วันที่แบบไทยสั้น "12 พ.ย. 2569" — อ่านเป็นเวลาไทยเสมอ (เครื่อง edge เป็น UTC) */
export function thaiDate(value: unknown): string {
  const v = clean(value, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return '-'
  const d = new Date(`${v}T00:00:00+07:00`)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' })
}

/** จำนวนวันปฏิทินที่เลยกำหนด (วันนี้ตามเวลาไทย − due) · ไม่ใช่วันทำการ — ข้อความบอกตรงๆ ว่า "วัน" */
export function daysOverdue(due: unknown, now: Date): number | null {
  const v = clean(due, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${v}T00:00:00Z`)) / 86_400_000)
  return Number.isFinite(diff) ? diff : null
}

export function deptName(payload: NudgePayload): string {
  const d = payload.department
  return clean(d?.short_name, 80) || clean(d?.name, 120) || ''
}

/**
 * ด่านก่อนส่ง — คืนเหตุผลที่ "ไม่ส่ง" (ลงผล none) หรือ null = ไปต่อ
 * ลำดับสำคัญ: sendable มาก่อนทุกอย่าง (เรื่องอ่อนไหวต้องไม่หลุดแม้ข้อมูลส่วนอื่นผิด)
 */
export function skipReason(payload: NudgePayload | null): string | null {
  if (!payload || payload.sendable !== true || !payload.item) {
    return 'ไม่ส่ง: เรื่องเสร็จ/ปิดแล้ว หรือเป็นหมวดที่เร่งรายเรื่องผ่านระบบไม่ได้'
  }
  if (payload.requester_is_head === true) {
    return 'ไม่ส่ง: ผู้สั่งเร่งเป็นหัวหน้าของกองที่ถือเรื่องนี้เอง'
  }
  return null
}

/** ข้อความ Telegram — DM ถึง ผอ.กอง หรือกลุ่ม อปท. (กลุ่มขึ้นชื่อกองให้รู้ว่าถึงใคร) */
export function buildNudgeMessage(args: {
  payload: NudgePayload
  audience: 'dm' | 'group'
  tenantName: string
  feeSchedule: unknown
  now: Date
  /** เหตุที่ตกมากลุ่ม — แสดงท้ายข้อความกลุ่มให้ทุกคนเข้าใจว่าทำไมไม่ส่งส่วนตัว */
  groupReason?: string
}): string {
  const { payload, audience, tenantName, feeSchedule, now, groupReason } = args
  const item = payload.item!
  const isComplaint = payload.nudge.item_kind === 'complaint'
  const kindLabel = isComplaint ? 'คำร้อง' : 'คำขอ E-Service'
  const typeLabel = isComplaint
    ? clean(item.cat_label, 80) || clean(item.cat, 60) || 'ไม่ระบุหมวด'
    : documentTypeLabel(item.cat, feeSchedule)
  const status = isComplaint
    ? COMPLAINT_STATUS[clean(item.status, 30)] ?? clean(item.status, 30)
    : DOCUMENT_STATUS[clean(item.status, 30)] ?? clean(item.status, 30)
  const late = daysOverdue(item.due, now)
  const dept = deptName(payload)
  const position = clean(payload.nudge.nudged_by_position, 120) || 'ผู้บริหาร'

  const lines = [
    `⏰ <b>ผู้บริหารขอให้เร่งรัด</b>`,
    `${esc(position)} ขอให้${dept ? ` <b>${esc(dept)}</b> ` : 'กองที่ถือเรื่อง'}เร่งรัดเรื่องที่เลยกำหนดต่อไปนี้`,
    '',
    `เรื่อง: ${esc(kindLabel)} เลขที่ <b>${esc(item.ref, 40)}</b>`,
    `${isComplaint ? 'หมวด' : 'ประเภท'}: ${esc(typeLabel, 80)}`,
    `สถานะ: ${esc(status || '-', 40)}`,
    `กำหนดเสร็จ: ${esc(thaiDate(item.due))}${late !== null && late > 0 ? ` (เลยมา ${late} วัน)` : ''}`,
    `รับเรื่อง: ${esc(thaiDate(item.created))}`,
  ]
  if (audience === 'group') {
    lines.push('', `ถึง: หัวหน้า${esc(dept || 'กองที่ถือเรื่อง')}${groupReason ? ` — ${esc(groupReason, 120)}` : ''}`)
  }
  lines.push('', `เปิดดูรายละเอียดและรายงานผลในระบบ ${esc(tenantName || 'SmartLocal', 120)} (หน้าเจ้าหน้าที่)`)
  return lines.join('\n')
}

/** ป้ายผลส่งที่ลงช่อง delivery_note — ภาษาคน หน้าเว็บแสดงตรงได้ */
export function deliveryNote(args: {
  delivery: Delivery
  dmSent?: number
  headsTotal?: number
  linkedHeads?: number
  dmFailed?: number
  reason?: string
}): string {
  const { delivery, dmSent = 0, headsTotal = 0, linkedHeads = 0, dmFailed = 0, reason } = args
  if (delivery === 'dm') {
    const extra = headsTotal > dmSent ? ` (จาก ${headsTotal} คน ที่เหลือยังไม่ได้เชื่อม Telegram หรือส่งไม่ถึง)` : ''
    return note(`ส่งถึงหัวหน้ากองทาง Telegram ส่วนตัว ${dmSent} คน${extra}`)
  }
  if (delivery === 'group') {
    const why = headsTotal === 0
      ? 'กองนี้ยังไม่ได้กำหนดหัวหน้ากองในระบบ'
      : linkedHeads === 0
        ? 'หัวหน้ากองยังไม่ได้เชื่อม Telegram ส่วนตัว'
        : `ส่งส่วนตัวไม่สำเร็จ ${dmFailed} คน`
    return note(`ส่งเข้ากลุ่ม Telegram ของหน่วยงานแทน (${why})`)
  }
  return note(reason ?? '')
}

/** เหตุที่ตกมากลุ่ม (แสดงในข้อความกลุ่ม) */
export function groupReason(headsTotal: number, linkedHeads: number): string {
  if (headsTotal === 0) return 'กองนี้ยังไม่ได้กำหนดหัวหน้ากองในระบบ'
  if (linkedHeads === 0) return 'หัวหน้ากองยังไม่ได้เชื่อม Telegram ส่วนตัว'
  return 'ส่งทาง Telegram ส่วนตัวไม่สำเร็จ'
}
