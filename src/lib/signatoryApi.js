// เรียกฐานข้อมูลของทะเบียนผู้ลงนาม — แยกจาก documentSignatories.js เพราะไฟล์นั้นต้องไม่ import supabase (เทสต์ node ล้วน import ตรง)
import { supabase } from './supabase'
import { adminUpdateUser } from './adminUpdateUser'
import { SIGNATORY_SCOPE } from './documentSignatories'

// ต้องมี profile ติดมาด้วย: หน้าจอแสดงชื่อและตำแหน่งที่จะพิมพ์จริง แม้ผู้ลงนามไม่ได้อยู่ในรายชื่อบุคลากรที่เลือกได้
const ACTIVE_SIGNATORY_SELECT = '*,profile:profiles!document_signatories_profile_id_fkey(full_name,job_title,position:positions(name))'

export function fetchActiveSignatories(municipalityId) {
  return supabase.from('document_signatories').select(ACTIVE_SIGNATORY_SELECT)
    .eq('municipality_id', municipalityId).eq('document_type', SIGNATORY_SCOPE).eq('is_active', true)
}

// ทางเดียวที่บันทึกผู้ลงนาม · บันทึกทุกครั้ง = ปิดแถวเดิมแล้วสร้างแถวใหม่ (ประวัติอยู่ครบ เอกสารที่เสร็จแล้วคงชื่อเดิม)
// ต้องส่งครบทุก argument แม้ตัวที่หน้าจอไม่ให้กรอกแล้ว: PostgREST เลือกฟังก์ชันจากชุดชื่อ argument
// ที่ส่งไป ถ้าละตัวที่มี DEFAULT ไว้จะเสี่ยงได้ PGRST202 "Could not find the function ... in the
// schema cache" ซึ่งอ่านไม่ออกว่าเกิดจากอะไร ในโปรเจกต์นี้ยังไม่มี RPC ตัวไหนละ argument เลย
//
// effectiveFrom ส่ง null เมื่อมีผลวันนี้ — ให้ DB coalesce เป็นวันนี้ตามเวลา Asia/Bangkok จะได้ไม่ต้อง
// พึ่งนาฬิกาของเครื่องผู้ใช้ ส่งวันจริงเฉพาะตอนแอดมินเลือกย้อนหลัง (DB ตรวจซ้ำว่าไม่เกิน 30 วัน)
// ส่วนเลขที่คำสั่ง/วันสิ้นสุดไม่ใช้แล้ว ผู้ดูแลเปลี่ยนตัวผู้ลงนามเองเมื่อมีคำสั่งใหม่
export function saveSignatory({
  municipalityId, slot, profileId = null, manualName = null, titleOverride = null, effectiveFrom = null, vehicleDefault = false,
}) {
  return supabase.rpc('set_document_signatory_v4', {
    p_municipality_id: municipalityId,
    p_signatory_role: slot.role,
    p_department_id: slot.departmentId ?? null,
    p_profile_id: profileId,
    p_manual_name: manualName,
    p_title_override: titleOverride,
    p_authority_reference: null,
    p_effective_from: effectiveFrom,
    p_effective_to: null,
    // ชื่อแถวเป็นตัวระบุแถวสำหรับบทบาทที่แอดมินสร้างเอง บทบาทของระบบต้องส่ง null
    p_custom_label: slot.customLabel ?? null,
    p_is_vehicle_order_default: vehicleDefault,
  })
}

export function clearSignatory({ municipalityId, slot }) {
  return supabase.rpc('clear_document_signatory_v2', {
    p_municipality_id: municipalityId,
    p_signatory_role: slot.role,
    p_department_id: slot.departmentId ?? null,
    p_custom_label: slot.customLabel ?? null,
  })
}

// บันทึกตามรายการจาก signatoryChangeFor ทีละช่อง คืน { key: ข้อความผิดพลาด | null } — ช่องหนึ่งล้มต้องไม่ทำให้ช่องอื่นไม่ถูกบันทึก
// ผูกบัญชี มีผลวันนี้ และคงเครื่องหมายผู้มีอำนาจสั่งใช้รถของแถวเดิมไว้ · titleOverride ส่งมาเฉพาะคนที่ตำแหน่งไม่ตรงช่อง เช่น "รักษาราชการแทน..."
export async function applySignatoryChanges(municipalityId, changes) {
  const results = {}
  for (const change of changes) {
    const { error } = await saveSignatory({
      municipalityId, slot: change.slot, profileId: change.person.id, titleOverride: change.titleOverride ?? null, vehicleDefault: change.vehicleDefault,
    })
    results[change.key] = error ? error.message : null
  }
  return results
}

// งานต่อเนื่องหลังบันทึกการแต่งตั้งสำเร็จ: เอาติ๊กหัวหน้าของคนเดิมออก ตั้งผู้ลงนาม และเอาชื่อออกจากช่องตามที่แอดมินเลือก
// คืน problems = ข้อความของข้อที่ไม่สำเร็จ (ว่าง = สำเร็จหมด) — การแต่งตั้งบันทึกไปแล้ว ข้อนี้ล้มต้องไม่ย้อนการแต่งตั้ง
export async function finishAppointment({ municipalityId, offers = [], clearHeads = [], clearSlots = [] }) {
  const problems = []
  const clearedHeadIds = []
  for (const head of clearHeads) {
    const { error } = await adminUpdateUser(head.id, { is_dept_head: false })
    if (error) problems.push(`เอาสถานะหัวหน้ากองของ ${head.full_name || 'คนเดิม'} ออกไม่สำเร็จ (${error.message})`)
    else clearedHeadIds.push(head.id)
  }
  const results = await applySignatoryChanges(municipalityId, offers)
  for (const offer of offers) {
    if (results[offer.key]) problems.push(`ตั้งผู้ลงนามช่อง “${offer.label}” ไม่สำเร็จ (${results[offer.key]})`)
  }
  for (const slot of clearSlots) {
    const { error } = await clearSignatory({ municipalityId, slot })
    if (error) problems.push(`เอาชื่อออกจากช่อง “${slot.label}” ไม่สำเร็จ (${error.message})`)
  }
  return { problems, clearedHeadIds }
}

// คนอื่นในกองที่ติ๊กเป็นหัวหน้าอยู่ — ตั้งหัวหน้าคนใหม่แล้วต้องเห็นและเอาคนเดิมออกได้ในขั้นตอนเดียว
// ไม่งั้นกองนี้จะมีหัวหน้าสองคน และคนเดิมยังอนุมัติกิจกรรมของกองได้ต่อ (ไม่กระทบการลงนาม ซึ่งอ่านจากทะเบียน)
export async function fetchOtherDepartmentHeads(departmentId, excludeId) {
  if (!departmentId) return []
  const { data, error } = await supabase.from('profiles').select('id,full_name,role')
    .eq('department_id', departmentId).eq('is_dept_head', true).neq('id', excludeId)
  return error ? [] : (data ?? [])
}
