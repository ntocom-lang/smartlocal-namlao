// ตัวดึงข้อมูลของเมนู "ผลการปฏิบัติงาน" — แยกจาก staffPerformance.js ที่เป็นตัวคำนวณล้วน
// (ไฟล์นั้นห้าม import supabase เพื่อให้เทสต์รันด้วย node ได้)
//
// สิทธิ์จริงตัดสินที่ RPC staff_performance_rows ฝั่งฐานข้อมูล — ฝั่งนี้แค่ไม่เสนอตัวเลือกที่กดแล้วถูกปฏิเสธ

import { supabase } from './supabase'
import { fetchAllRows } from './fetchAllRows'
import { fetchAssignableStaff } from './staffRoster'
import { SIGNATORY_REGISTRY_SELECT, SIGNATORY_SCOPE } from './documentSignatories'

/**
 * บทบาทที่เปิดเมนูนี้ได้ — ผู้บริหาร (viewer) อยู่ในสายการประเมิน (แบบประเมินส่วนที่ 6–8)
 * ส่วนสมาชิกสภา (council) ไม่อยู่ในสายบังคับบัญชาหรือแบบประเมิน จึงไม่เห็น
 */
export const PERFORMANCE_ROLES = ['technician', 'staff', 'officer', 'admin', 'superadmin', 'viewer']

/** เลือกดูของคนอื่นได้: หัวหน้ากอง (เฉพาะคนในกอง) แอดมิน และผู้บริหาร */
export function canViewOthers(role) {
  return ['officer', 'admin', 'superadmin', 'viewer'].includes(role)
}

/**
 * รายชื่อที่เลือกได้ — ช่าง/เจ้าหน้าที่เห็นแค่ตัวเอง, หัวหน้ากองเห็นคนในกอง, แอดมิน/ผู้บริหารเห็นทุกคน
 * ผู้บริหารไม่มีคำร้องของตัวเอง จึงไม่ใส่ตัวเองในรายชื่อ · RLS ของ profiles ตัดขอบเขตซ้ำอีกชั้นอยู่แล้ว
 */
export async function loadPeople(tenantId, me) {
  const self = { id: me.id, full_name: me.full_name, department_id: me.department_id ?? null, department_name: null }
  if (!canViewOthers(me.role)) return [self]
  const people = await fetchAssignableStaff(tenantId)
  if (me.role === 'viewer') return people
  const scoped = me.role === 'officer'
    ? people.filter(p => p.id === me.id || (me.department_id && p.department_id === me.department_id))
    : people
  return scoped.some(p => p.id === me.id) ? scoped : [self, ...scoped]
}

/** ชื่อ ตำแหน่ง สังกัด สำหรับหัวรายงาน — ตำแหน่งใช้ job_title ก่อน ไม่มีจึงใช้ชื่อตามผังตำแหน่ง */
export async function loadPersonCard(personId) {
  const { data: p, error } = await supabase.from('profiles')
    .select('id, full_name, job_title, position_id, department_id')
    .eq('id', personId).maybeSingle()
  if (error || !p) return { id: personId, name: '', title: '', departmentId: null, departmentName: '' }
  const [positionRes, departmentRes] = await Promise.all([
    !p.job_title && p.position_id
      ? supabase.from('positions').select('name').eq('id', p.position_id).maybeSingle()
      : Promise.resolve({ data: null }),
    p.department_id
      ? supabase.from('departments').select('name').eq('id', p.department_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  return {
    id: p.id,
    name: p.full_name?.trim() || '',
    title: p.job_title?.trim() || positionRes.data?.name?.trim() || '',
    departmentId: p.department_id,
    departmentName: departmentRes.data?.name?.trim() || '',
  }
}

/**
 * แถวคำร้องของคนนั้นในช่วง [from, to] — แบ่งหน้าเพราะ PostgREST ตัดผลที่ max_rows
 * แล้วเทียบกับยอดนับจากฐานข้อมูล ถ้าไม่เท่ากันต้องเตือน ไม่ใช่รายงานตัวเลขขาดเงียบๆ
 * @returns {Promise<{ rows: any[], error: any, incomplete: boolean }>}
 */
export async function loadPerformanceRows(personId, from, to) {
  const args = { p_person_id: personId, p_from: from, p_to: to }
  const [{ data, error, truncated }, countRes] = await Promise.all([
    fetchAllRows(() => supabase.rpc('staff_performance_rows', args).order('created_at').order('id')),
    supabase.rpc('staff_performance_rows', args, { count: 'exact', head: true }),
  ])
  if (error) return { rows: [], error, incomplete: false }
  const rows = data ?? []
  const incomplete = truncated || (countRes.count != null && countRes.count !== rows.length)
  return { rows, error: null, incomplete }
}

/** ชื่อหมวดคำร้องรวมหมวดที่ปิดใช้แล้ว (งานเก่าในหมวดนั้นยังต้องมีชื่อ) */
export async function loadCategoryLabels(tenantId) {
  const { data } = await supabase.from('complaint_categories')
    .select('value, label').eq('municipality_id', tenantId)
  return Object.fromEntries((data ?? []).map(c => [c.value, c.label]))
}

/**
 * ทะเบียนผู้ลงนาม (ใช้หาผู้รับรอง) — ต้องมี profile_id ไว้ตรวจว่าเจ้าตัวเป็นหัวหน้ากองเองหรือไม่
 * ชื่อที่อ่านไม่ได้ตาม RLS ของ profiles จะว่าง แล้วใบพิมพ์เว้นช่องให้เขียนมือ (เหมือนใบอื่นในระบบ)
 */
export async function loadSignatoryRegistry(tenantId) {
  const { data } = await supabase.from('document_signatories')
    .select(`${SIGNATORY_REGISTRY_SELECT},profile_id`)
    .eq('municipality_id', tenantId)
    .eq('document_type', SIGNATORY_SCOPE)
    .eq('is_active', true)
  return data ?? []
}
