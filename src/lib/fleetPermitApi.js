// โหมดขั้นตอนขอใช้รถ — เรียกฟังก์ชันฐานข้อมูล (แยกจาก fleetPermit.js เพื่อให้ตัวช่วยล้วนทดสอบใน Node ได้โดยไม่ต้องพึ่ง supabase client)
// ฐานข้อมูล: supabase/migrations/20261121100100_fleet_permit_functions.sql
import { supabase } from './supabase'
import { PERMIT_INFO_MAX_IDS, chunkIds } from './fleetPermit'
import { notifyTelegram } from './notifyTelegram'

// เรียกฟังก์ชัน DB ทุกตัวผ่านที่นี่: ส่งครบทุก argument เสมอ (PostgREST เลือกฟังก์ชันจากชุดชื่อ argument ที่ส่งไป
// ถ้าละตัวที่มี DEFAULT จะเสี่ยง PGRST202) · ฟังก์ชันตอบเป็น jsonb {ok, code?}
// error ระดับระบบ (เครือข่าย/โควตายิงรัว PT429) แปลงเป็นรูปเดียวกัน — แบบเดียวกับ esignApi.js
async function callPermit(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) {
    if (error.code === 'PT429') return { ok: false, code: 'rate_limited' }
    return { ok: false, code: 'error', message: error.message }
  }
  return data
}

// วันที่ว่าง '' ส่งไปจะตก date cast error — ช่องว่างส่งเป็น null (ล้างค่าที่เคยบันทึก)
const orNull = value => (String(value ?? '').trim() || null)

// → { ok, permit_mode, delegate_dept_heads, delegation_ref, delegation_date, updated_at, updated_by_name, can_edit }
export const getFleetPermitSettings = municipalityId =>
  callPermit('fleet_permit_settings_get', { p_municipality_id: municipalityId })

export const setFleetPermitSettings = ({ municipalityId, permitMode, delegateDeptHeads, delegationRef, delegationDate }) =>
  callPermit('fleet_permit_settings_set', {
    p_municipality_id: municipalityId,
    p_permit_mode: permitMode,
    p_delegate_dept_heads: Boolean(delegateDeptHeads),
    p_delegation_ref: orNull(delegationRef),
    p_delegation_date: orNull(delegationDate),
  })

// ขอสถานะรายใบ — ไม่เกินก้อนละ 300 (DB ตอบ too_many) ผู้เรียกแบ่งก้อนก่อนด้วย chunkIds แล้วส่งทีละก้อนผ่านฟังก์ชันนี้
export const getFleetTripPermitInfo = tripIds =>
  callPermit('fleet_trip_permit_info', { p_trip_ids: (tripIds ?? []).slice(0, PERMIT_INFO_MAX_IDS) })

// แบ่งก้อนแล้วถามพร้อมกัน → รายการผลลัพธ์ต่อก้อน (ใช้กับ permitInfoMap)
// FleetPage เรนเดอร์ FleetTrips สองชุดพร้อมกัน (มือถือ+เดสก์ท็อป) และ realtime ทำให้โหลดซ้ำรัว — คำถามชุด id เดียวกันที่กำลังบินอยู่ใช้คำตอบร่วมกัน
// ไม่แคชต่อหลังตอบ (สถานะอนุญาตเปลี่ยนได้ทุกเมื่อ ต้องได้ค่าล่าสุดทุกรอบโหลดจริง)
const inflight = new Map()
export function getFleetTripPermitInfoBatches(tripIds) {
  const ids = tripIds ?? []
  const key = [...ids].sort().join(',')
  const hit = inflight.get(key)
  if (hit) return hit
  const request = Promise.all(chunkIds(ids).map(getFleetTripPermitInfo))
    .finally(() => { if (inflight.get(key) === request) inflight.delete(key) })
  inflight.set(key, request)
  return request
}

// basis: 'authority' | 'delegated_dept_head' · signedOn: YYYY-MM-DD (วันที่ผู้มีอำนาจลงนามบนใบกระดาษ)
// ชื่อ/ฐานะผู้อนุญาตไม่ส่งไปจากหน้าจอ — DB ดึงจากทะเบียนผู้ลงนาม
// สำเร็จ → แจ้ง "ได้รับอนุญาตแล้ว ออกรถได้" (กลุ่ม + ส่วนตัวถึงผู้ขอ/ผู้ขับ) ไม่รอผล — Edge ตรวจสถานะจริงก่อนส่ง
export const recordFleetPaperPermit = async ({ tripId, basis, signedOn }) => {
  const result = await callPermit('fleet_record_paper_permit', { p_trip_id: tripId, p_basis: basis, p_signed_on: signedOn })
  if (result?.ok) {
    notifyTelegram('fleet_trip_authorized', tripId)
    notifyTelegram('fleet_trip_authorized_dm', tripId)
  }
  return result
}

export const voidFleetPaperPermit = ({ permitId, reason }) =>
  callPermit('fleet_void_paper_permit', { p_permit_id: permitId, p_reason: String(reason ?? '').trim() })

// P3 ข้อ ๑๒ ว.๕ — ผู้ขอคนนี้มีรถประจำตำแหน่งไหม (ถามตอนเปิดฟอร์ม/เปลี่ยนผู้ขอหรือรถ)
// → { ok, permit_mode, position_car: { vehicle_id, license_plate, name, position_name } | null }
// requestedBy ว่าง = ตัวผู้เรียก · vehicleId ว่าง = ยังไม่เลือกรถ (DB ส่ง null ได้)
// ฐานข้อมูล: supabase/migrations/20261123100100_fleet_position_car_functions.sql
export const checkFleetPositionCar = ({ municipalityId, requestedBy, vehicleId }) =>
  callPermit('fleet_position_car_check', {
    p_municipality_id: municipalityId,
    p_requested_by: requestedBy || null,
    p_vehicle_id: vehicleId || null,
  })
