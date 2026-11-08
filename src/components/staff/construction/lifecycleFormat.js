// ค่าคงที่/ตัวช่วยแสดงผลของหน้าวงจรโครงการก่อสร้าง (แยกจากไฟล์คอมโพเนนต์เพราะไฟล์คอมโพเนนต์ export ค่าอื่นไม่ได้ — fast refresh)
// กฎเกณฑ์ทั้งหมดอยู่ที่ src/lib/constructionLifecycle.js ที่นี่มีแค่ "ชื่อสั้น สี และการจัดข้อความ"
import { bangkokIsoDate, thaiShortDate } from '../../../lib/complaintReportPeriods'

/** ชื่อสั้นบนการ์ดนับตามขั้น */
export const STAGE_SHORT = {
  budgeted: 'ตั้งงบ',
  designing: 'ออกแบบ/ราคากลาง',
  procuring: 'จัดซื้อจัดจ้าง',
  contracted: 'ลงนามสัญญา',
  started: 'เริ่มงาน',
  construction: 'ก่อสร้าง',
  final_inspection: 'ตรวจรับงวดสุดท้าย',
  warranty: 'ประกันผลงาน',
  closed: 'ปิดแล้ว',
  suspended: 'ระงับ',
  cancelled: 'ยกเลิก',
  terminated: 'บอกเลิกสัญญา',
}

export const STAGE_COLORS = {
  budgeted: '#64748b',
  designing: '#64748b',
  procuring: '#7c3aed',
  contracted: '#2563eb',
  started: '#2563eb',
  construction: '#0f766e',
  final_inspection: '#b45309',
  warranty: '#0369a1',
  closed: '#15803d',
  suspended: '#d97706',
  cancelled: '#6b7280',
  terminated: '#b91c1c',
}

/** ขั้นที่โครงการ "จบแล้ว/หยุด" — ไม่ต้องเตือนกำหนดเวลา */
export const FINISHED_STAGES = ['closed', 'cancelled']
export const HALTED_STAGES = ['suspended', 'cancelled', 'terminated']

/** กำหนดเวลา (deadlines()) ไปแสดงใต้ขั้นไหน — คีย์ที่ซ้ำกับจุดตรวจ (contract_copy_*, start_report) ไปรวมในแถวจุดตรวจเดียวกัน */
export const DEADLINE_STAGES = {
  median_price_publish: ['designing', 'procuring'],
  appeal_period: ['procuring'],
  contract_copy_oag: ['contracted'],
  contract_copy_revenue: ['contracted'],
  start_report: ['started'],
  installment_due_report: ['construction', 'final_inspection'],
  installment_inspection: ['construction', 'final_inspection'],
  fine_notice: ['construction', 'final_inspection'],
  change_request: ['construction', 'final_inspection'],
  warranty_final_inspection: ['warranty'],
  defect_fix: ['warranty'],
  guarantee_return: ['warranty', 'closed'],
}

export const LEVEL_TEXT = { error: 'text-red-700', warn: 'text-amber-700', info: 'text-sky-700' }
export const LEVEL_BG = { error: 'bg-red-50 text-red-800', warn: 'bg-amber-50 text-amber-800', info: 'bg-sky-50 text-sky-800' }

export const VERIFY_TEXT = 'ต้องยืนยันกับระเบียบฉบับปัจจุบัน'

/** ตัวเลขเงิน 1,250,000 / 1,250,000.50 · ไม่มีค่า = — */
export function moneyTh(value) {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  return Number.isFinite(n) ? n.toLocaleString('th-TH', { maximumFractionDigits: 2 }) : '—'
}

/** วันที่ ISO (หรือเวลา timestamp) → "8 พ.ย. 2569" · ไม่มี/ผิดรูป = — */
export function thaiDay(value) {
  if (!value) return '—'
  const iso = String(value).length > 10 ? bangkokIsoDate(value) : String(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? thaiShortDate(iso) : '—'
}

/** ข้อความจาก lib (คำเตือน/รายการที่ขาด) ฝังวันที่ ISO ไว้ — แปลงเป็นวันที่ไทยก่อนแสดง ("2026-10-29" → "29 ต.ค. 2569") */
export const thaiText = text => String(text ?? '').replace(/\b\d{4}-\d{2}-\d{2}\b/g, m => thaiDay(m))

/** ข้อความสถานะของกำหนดเวลา 1 จุด (ผลจาก deadlines()) */
export function deadlineStatusText(d) {
  const unit = d.kind === 'working' ? ' วันทำการ' : ' วัน'
  switch (d.state) {
    case 'done': return `ทำแล้ว ${thaiDay(d.doneOn)}`
    case 'late_done': return `ทำแล้ว ${thaiDay(d.doneOn)} (เลยกำหนด)`
    case 'overdue': return 'เลยกำหนดแล้ว'
    case 'due_today': return 'ครบกำหนดวันนี้'
    case 'open': return d.daysLeft === null ? '' : `เหลือ ${d.daysLeft}${unit}`
    case 'waiting': return d.daysLeft === null ? 'ยังอยู่ในระยะรอ' : `ยังอยู่ในระยะรอ (อีก ${d.daysLeft}${unit})`
    case 'passed': return 'พ้นระยะรอแล้ว'
    default: return ''
  }
}

export const DEADLINE_TONE = {
  overdue: 'bg-red-50/70',
  due_today: 'bg-amber-50/70',
  late_done: 'bg-amber-50/40',
}

/** ป้ายชนิดการเปลี่ยนขั้นบนปุ่ม */
export function actionLabel(action) {
  switch (action.kind) {
    case 'next': return `เลื่อนเป็น "${action.label}"`
    case 'skip': return `ข้ามไป "${action.label}"`
    case 'back': return `ถอยกลับไป "${action.label}"`
    case 'suspend': return 'ระงับโครงการชั่วคราว'
    case 'resume': return `กลับมาดำเนินการ (ขั้น "${action.label}")`
    case 'cancel': return 'ยกเลิกโครงการ (ก่อนทำสัญญา)'
    case 'terminate': return 'บอกเลิกสัญญา'
    case 'reopen': return `เปิดโครงการใหม่ที่ขั้น "${action.label}"`
    default: return action.label
  }
}

export const isDangerAction = action => action.kind === 'cancel' || action.kind === 'terminate'
