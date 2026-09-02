import { supabase } from './supabase'

// ทะเบียนผู้ลงนามกลางของ อปท. — ตาราง document_signatories เก็บได้ 1 แถวที่ active
// ต่อบทบาทต่อหน่วยงาน (บังคับด้วย document_signatories_one_active_scope_idx)
// ทุกเอกสารในระบบใช้ผู้ลงนามชุดเดียวกันนี้: แบบพิมพ์คำร้อง (prepare_complaint_print)
// และใบขออนุญาตใช้รถส่วนกลาง แบบ 3 (FleetTrips)
//
// ค่าคอลัมน์ document_type ยังเป็น 'complaint' ตามชื่อสมัยที่ผู้ลงนามใช้กับคำร้อง
// อย่างเดียว ไม่ใช่ตัวแยกประเภทเอกสารอีกต่อไป — ผูกไว้เป็นค่าคงที่ตัวเดียวตรงนี้
// เพื่อไม่ให้ magic string กระจายไปตามโมดูล ถ้าวันหนึ่งต้องแยกผู้ลงนามรายเอกสารจริง
// ต้องแก้ CHECK constraint + RPC set_document_signatory_v2 ที่ hardcode ค่านี้ไว้ด้วย
export const SIGNATORY_SCOPE = 'complaint'

// select ที่ join โปรไฟล์มาให้พร้อมพิมพ์ — ต้องระบุชื่อ FK ให้ชัดเพราะตารางนี้มี
// FK ไป profiles สองเส้น (profile_id กับ created_by) PostgREST จะเลือกไม่ถูกถ้าไม่ระบุ
export const SIGNATORY_WITH_PROFILE_SELECT =
  'manual_name,title_override,effective_from,effective_to,profile:profiles!document_signatories_profile_id_fkey(full_name,job_title,position:positions(name))'

// en-CA ให้รูปแบบ YYYY-MM-DD ตรงกับที่ Postgres รับพอดี และต้องอิงเวลาไทยเสมอ
// ไม่ใช่ timezone ของเครื่องผู้ใช้ เพราะฝั่ง DB เทียบกับ timezone('Asia/Bangkok', now())
export function todayBangkok() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())
}

// effective_from/effective_to เก็บเป็น date ไม่ใช่ timestamptz จึงเทียบเป็นสตริงได้ตรงๆ
export function isSignatoryActiveToday(row, today = todayBangkok()) {
  if (!row) return false
  return (!row.effective_from || row.effective_from <= today)
    && (!row.effective_to || row.effective_to >= today)
}

// เลือกแถวที่ "มีผลวันนี้" — คิดฝั่ง client เพราะแถวมีไม่กี่แถวต่อหน่วยงาน
export function resolveActiveSignatory(rows) {
  const today = todayBangkok()
  return (rows ?? []).find(row => isSignatoryActiveToday(row, today)) ?? null
}

// อ่านผู้ลงนามพร้อมโปรไฟล์สำหรับเอาไปพิมพ์เอกสาร — คืน { data, error } ตาม convention
// ของ supabase-js เพื่อให้ผู้เรียกตัดสินใจเรื่อง error เอง
// departmentId = null คือผู้ลงนามระดับหน่วยงาน (นายก/ปลัด), ระบุ uuid คือหัวหน้ากองนั้น
export async function fetchSignatories(municipalityId, { role, departmentId = null } = {}) {
  let query = supabase.from('document_signatories')
    .select(SIGNATORY_WITH_PROFILE_SELECT)
    .eq('municipality_id', municipalityId)
    .eq('document_type', SIGNATORY_SCOPE)
    .eq('is_active', true)
  if (role) query = query.eq('signatory_role', role)
  query = departmentId ? query.eq('department_id', departmentId) : query.is('department_id', null)
  return query
}
