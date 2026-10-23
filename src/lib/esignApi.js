// ลงนามออนไลน์รายเรื่อง — เรียกฟังก์ชันฐานข้อมูล (แยกจาก esign.js เพื่อให้ตัวช่วยล้วนทดสอบใน Node ได้โดยไม่ต้องพึ่ง supabase client)
import { supabase } from './supabase'
import { ESIGN_DOC_FLEET } from './esign'

// เรียกฟังก์ชัน DB ทุกตัวผ่านที่นี่: ส่งครบทุก argument เสมอ (PostgREST เลือกฟังก์ชันจากชุดชื่อ argument ที่ส่งไป
// ถ้าละตัวที่มี DEFAULT จะเสี่ยง PGRST202 — ดูหมายเหตุใน components/admin/SignatorySettings.jsx)
// ฟังก์ชันตอบเป็น jsonb {ok, code?} — error ระดับระบบ (เครือข่าย/โควตายิงรัว PT429) แปลงเป็นรูปเดียวกัน
async function callEsign(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) {
    if (error.code === 'PT429') return { ok: false, code: 'rate_limited' }
    return { ok: false, code: 'error', message: error.message }
  }
  return data
}

export const getEsignGateStatus = municipalityId =>
  callEsign('esign_gate_status', { p_municipality_id: municipalityId })

// ประกาศ/หนังสือให้ความเห็นชอบไม่บังคับกรอก — ช่องว่างส่งเป็น null (วันที่ว่าง '' ส่งไปจะตก date cast error) ทุกช่องว่าง = ล้างที่เคยบันทึก
const orNull = value => (String(value ?? '').trim() || null)

export const setEsignPolicy = ({ municipalityId, announcementNo, announcementDate, approvalRef, announcementUrl }) =>
  callEsign('set_esign_policy', {
    p_municipality_id: municipalityId,
    p_announcement_no: orNull(announcementNo),
    p_announcement_date: orNull(announcementDate),
    p_approval_ref: orNull(approvalRef),
    p_announcement_url: orNull(announcementUrl),
  })

export const confirmEsignTrial = municipalityId =>
  callEsign('esign_confirm_trial', { p_municipality_id: municipalityId })

// modes = {requester:'online'|'wet', ...} หรือ null = ปิดทั้งเรื่อง
export const setEsignDocType = (municipalityId, modes) =>
  callEsign('set_esign_doc_type', {
    p_municipality_id: municipalityId,
    p_doc_type: ESIGN_DOC_FLEET,
    p_slot_modes: modes,
  })

export const reinstateEsignSigner = userId =>
  callEsign('esign_reinstate_signer', { p_user_id: userId })

// ── ลายเซ็นของฉัน (หน้าโปรไฟล์) — ฐานข้อมูลชุด S1 (ภาพ) และชุด A (รหัสลงนาม) ─────────────────────────────
export const getMySignerOverview = () => callEsign('esign_my_signer_overview', {})

export const getMySignatures = () => callEsign('esign_my_signatures', {})

// pngBase64 = base64 ล้วนของ PNG (ไม่มี data: prefix) จาก signatureCanvas.js
export const addMySignature = ({ label, pngBase64, makeDefault }) =>
  callEsign('esign_my_signature_add', {
    p_label: label,
    p_png_base64: pngBase64,
    p_make_default: Boolean(makeDefault),
  })

export const setDefaultSignature = id => callEsign('esign_my_signature_set_default', { p_id: id })

export const deleteMySignature = id => callEsign('esign_my_signature_delete', { p_id: id })

export const getMySignatureHistory = (limit = 10) => callEsign('esign_my_signature_history', { p_limit: limit })

// ตั้งรหัสครั้งแรก: currentPin = null + ackDuty = true · เปลี่ยนรหัส: ต้องส่งรหัสเดิม
export const setEsignPin = ({ pin, currentPin = null, ackDuty = false }) =>
  callEsign('set_esign_pin', {
    p_pin: pin,
    p_current_pin: currentPin || null,
    p_ack_duty: Boolean(ackDuty),
  })

export const suspendMyEsign = reason => callEsign('esign_suspend_me', { p_reason: String(reason ?? '').trim() || null })

// ── แผงลงนามในหน้ารายละเอียดทริป (ฐานข้อมูลชุด S3a: ..20261023110000_esign_trip_panel_functions.sql) ──
export const getTripEsignStatus = tripId => callEsign('esign_trip_status', { p_trip_id: tripId })

// imageId = ภาพจากคลังของฉัน · ไม่แนบภาพ = null · decision: ช่องผู้มีอำนาจส่ง 'approve' ช่องอื่นส่ง null (DB กำหนดเอง)
// ไม่ส่ง p_png_base64 (ภาพที่วาดตอนลงนามโดยไม่เข้าคลัง) — หน้าจอให้บันทึกเข้าคลังก่อนเสมอ ผู้ใช้เลือกใช้ซ้ำได้ ไม่ต้องเซ็นใหม่ทุกใบ
export const signFleetTrip = ({ tripId, slot, pin, decision = null, imageId = null }) =>
  callEsign('esign_sign_fleet_trip_stamped', {
    p_trip_id: tripId,
    p_slot: slot,
    p_pin: pin,
    p_decision: decision,
    p_image_id: imageId,
    p_png_base64: null,
  })

// slot = null ถอนทุกช่องเพื่อแก้คำขอ (ผู้ดูแลรถ/ผู้ขอตัวจริงเท่านั้น) · ระบุช่อง = ถอนช่องนั้นและช่องหลังในสาย
export const revokeFleetTripSignatures = ({ tripId, reason, slot = null }) =>
  callEsign('esign_revoke_fleet_trip', { p_trip_id: tripId, p_reason: String(reason ?? '').trim(), p_slot: slot })

export const getMyPendingSignatures = () => callEsign('esign_my_pending', {})
