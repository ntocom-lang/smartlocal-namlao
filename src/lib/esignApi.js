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

export const setEsignPolicy = ({ municipalityId, announcementNo, announcementDate, approvalRef, announcementUrl }) =>
  callEsign('set_esign_policy', {
    p_municipality_id: municipalityId,
    p_announcement_no: announcementNo,
    p_announcement_date: announcementDate,
    p_approval_ref: approvalRef,
    p_announcement_url: announcementUrl?.trim() ? announcementUrl.trim() : null,
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
