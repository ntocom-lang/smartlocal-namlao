// หน้าตรวจสอบเอกสารลงนามออนไลน์สาธารณะ (/v/<รหัส>) — ตัวช่วยล้วน ไม่แตะ DOM/supabase เทสต์รันด้วย node
//
// ข้อมูลทั้งหมดมาจาก esign_verify() (anon เรียกได้ จำกัดถี่ 30 ครั้ง/5 นาที) ซึ่งตอบ "ไม่พบ" แบบเดียวกันทุกกรณี
// และ "ไม่ส่งภาพลายเซ็น/เนื้อหาคำขอ/ปลายทาง/เหตุผล" มาตั้งแต่ฝั่ง DB — หน้านี้จึงไม่มีทางแสดงของเหล่านั้นได้ต่อให้โค้ดผิด
import { ESIGN_DECISION_LABEL } from './esign.js'

const CODE_RE = /^[0-9a-f]{32}$/

export const isVerifyCode = value => CODE_RE.test(String(value ?? ''))

/**
 * ข้อความสรุปสถานะของเอกสาร — tone ใช้เลือกสีและไอคอน (ไม่ใช่สัญญาณเดียว: มีข้อความกำกับเสมอ)
 *   ok = ลงนามครบและเนื้อหาตรง · warn = ยังไม่ครบ/คำขอปิดไปแล้ว · bad = เนื้อหาไม่ตรงกับที่ลงนาม · mute = ยังไม่มีลายเซ็น
 */
export function verifySummary(data) {
  const required = Number(data?.required) || 0
  const done = Number(data?.signed_count) || 0
  const closed = data?.trip_status === 'cancelled' ? 'ยกเลิก' : data?.trip_status === 'rejected' ? 'ไม่อนุมัติ' : ''
  let base
  switch (data?.state) {
    case 'modified':
      base = { tone: 'bad', title: 'เนื้อหาไม่ตรงกับที่ลงนามไว้', detail: 'ห้ามใช้เอกสารนี้ — แจ้งหน่วยงานให้ตรวจสอบ' }
      break
    case 'complete':
      base = { tone: 'ok', title: 'ลงนามออนไลน์ครบทุกช่อง', detail: 'เนื้อหาตรงกับที่ลงนามไว้' }
      break
    case 'partial':
      base = { tone: 'warn', title: `ลงนามออนไลน์แล้ว ${done} จาก ${required} ช่อง`, detail: 'ช่องที่เหลือยังไม่ลงนามออนไลน์ (อาจเซ็นสดบนกระดาษ)' }
      break
    default:
      base = { tone: 'mute', title: 'ยังไม่มีการลงนามออนไลน์', detail: 'เอกสารนี้ตั้งให้ลงนามออนไลน์ แต่ยังไม่มีผู้ลงนาม' }
  }
  // คำขอที่ปิดไปแล้วต้องเห็นชัด ไม่ให้ลายเซ็นครบดูเหมือนเอกสารใช้ได้
  if (closed) return { ...base, tone: base.tone === 'bad' ? 'bad' : 'warn', closedNote: `คำขอนี้${closed}แล้ว — ไม่ใช่เอกสารที่ใช้อนุมัติการใช้รถ` }
  return base
}

/** แถวช่องลงนามของหน้า: ช่องที่ยังไม่ลงนามมีเฉพาะป้ายช่อง */
export function verifySlotRows(data) {
  return (Array.isArray(data?.slots) ? data.slots : []).map(slot => ({
    key: slot.slot,
    label: slot.label || slot.slot,
    signed: Boolean(slot.signed),
    signerName: slot.signed ? (slot.signer_name || '') : '',
    // ตำแหน่งที่ลงนามจริง (signed_as) มาก่อน — ตรงกับที่พิมพ์บนใบ ไม่ใช่ตำแหน่งในโปรไฟล์ที่อาจเปลี่ยนไปแล้ว
    position: slot.signed ? (slot.signed_as || slot.signer_position || '') : '',
    decisionLabel: slot.signed ? (ESIGN_DECISION_LABEL[slot.decision] ?? 'ลงนาม') : '',
    signedAt: slot.signed ? slot.signed_at : null,
  }))
}

export const VERIFY_BUSY_MESSAGE = 'เปิดดูถี่เกินไป กรุณารอสักครู่แล้วลองใหม่'
/** esign_verify ยกข้อผิดพลาดรหัส PT429 เมื่อเปิดถี่เกินโควตา */
export const isVerifyBusy = error => error?.code === 'PT429' || /ถี่เกินไป/.test(String(error?.message ?? ''))

export const VERIFY_NOTE = 'หน้านี้แสดงเฉพาะสถานะและชื่อผู้ลงนาม ไม่แสดงภาพลายเซ็นหรือเนื้อหาคำขอ — ให้เทียบกับใบที่ถืออยู่ ถ้าไม่ตรงอย่าใช้เอกสาร'
