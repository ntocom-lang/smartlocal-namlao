import { supabase } from './supabase'

// complaints.user_id ไม่มี foreign key ไปยัง profiles ใน production —
// embed แบบ `profiles(...)` ตรงๆ จึง resolve ผ่าน complaints_assigned_to_fkey
// แทน (กลายเป็นข้อมูลช่างที่รับมอบหมาย ไม่ใช่ผู้แจ้ง) ต้อง query แยกแล้ว merge เอง
export async function attachReporterProfiles(rows, fields = 'id, full_name, email, phone, role, created_at, avatar_url, job_title, address_province, address_district, address_subdistrict, address_moo, address_detail') {
  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))]
  if (userIds.length === 0) return rows
  const { data: profiles } = await supabase
    .from('profiles')
    .select(fields)
    .in('id', userIds)
  const byId = Object.fromEntries((profiles ?? []).map((p) => [p.id, p]))
  return rows.map((r) => ({ ...r, profiles: r.user_id ? (byId[r.user_id] ?? null) : null }))
}
