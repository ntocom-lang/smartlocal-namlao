// เรียกฐานข้อมูลของงาน "มอบหมายผู้ไปแทน" — แยกจาก eventAssignment.js (ตรรกะล้วนที่เทสต์ node import ตรง)
// และจากไฟล์คอมโพเนนต์ (ไฟล์คอมโพเนนต์ต้อง export แต่คอมโพเนนต์ ไม่งั้น fast refresh ของ Vite ใช้ไม่ได้)
import { supabase } from './supabase'
import { toAssigneePayload } from './eventAssignment'

// รายชื่อไม่เปลี่ยนบ่อย โหลดครั้งเดียวต่อ อปท. ต่อการเปิดเว็บ — พลาดแล้วลบออกให้ลองใหม่ได้ครั้งหน้า
const candidateCache = new Map()

export function loadAssigneeCandidates(tenantId) {
  if (!candidateCache.has(tenantId)) {
    const request = supabase.rpc('list_event_assignee_candidates', { p_municipality_id: tenantId })
      .then(({ data, error }) => {
        if (error) throw error
        return data ?? []
      })
    request.catch(() => candidateCache.delete(tenantId))
    candidateCache.set(tenantId, request)
  }
  return candidateCache.get(tenantId)
}

// บันทึก/เปลี่ยน/ล้างการมอบหมาย — ไม่มีผู้รับมอบหมาย = ล้าง (ไม่ต้องส่งภารกิจ)
// สิทธิ์ การตรวจข้อมูล และประวัติ ตัดสินที่ RPC set_event_assignments ฝั่งเซิร์ฟเวอร์ทั้งหมด
export async function saveEventAssignments(eventId, value) {
  const people = toAssigneePayload(value?.assignees)
  return supabase.rpc('set_event_assignments', {
    p_event_id: eventId,
    p_task: people.length ? value.task : null,
    p_on_behalf_of: people.length ? (String(value.onBehalfOf ?? '').trim() || null) : null,
    p_assignees: people,
  })
}
