import { supabase } from './supabase'

// ทางเดียวที่แก้ฟิลด์ privileged ของ profiles ได้ (role, municipality_id, department_id,
// position_id, is_dept_head, fleet_role) — ตั้งแต่ trg_guard_profile_privileged_update
// (20260730180100_158_harden_user_role_management.sql) บล็อก direct table update ไปแล้ว
// ใช้ร่วมกันทั้ง AdminDashboard.jsx (จัดการผู้ใช้งานทั่วไป) และ FleetSetup.jsx (สิทธิ์ยานพาหนะ)
export async function adminUpdateUser(userId, changes) {
  const res = await supabase.rpc('admin_update_user', { p_user_id: userId, p_changes: changes })
  if (res.error && (res.error.code === 'PGRST202' || res.error.message?.includes('Could not find the function') || res.status === 404)) {
    console.warn('[adminUpdateUser] RPC not found on DB, falling back to direct profiles table update:', res.error.message)
    return supabase.from('profiles').update(changes).eq('id', userId)
  }
  return res
}
