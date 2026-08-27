import { supabase } from './supabase'
import { fetchAllRows } from './fetchAllRows'

// complaints.user_id ไม่มี foreign key ไปยัง profiles ใน production —
// embed แบบ `profiles(...)` ตรงๆ จึง resolve ผ่าน complaints_assigned_to_fkey
// แทน (กลายเป็นข้อมูลช่างที่รับมอบหมาย ไม่ใช่ผู้แจ้ง) ต้อง query แยกแล้ว merge เอง
// ยิงทีละก้อน ไม่ส่ง id ทั้งหมดใน request เดียว — ตัวกรอง .in() ของ PostgREST ไปอยู่ใน query
// string ของ URL แบบ ?id=in.(uuid,uuid,...) uuid ละ 37 ตัวอักษร พอผู้แจ้งแตะหลักพันคน URL จะยาว
// เกินเพดานของ proxy/CDN (ปกติ 8KB) แล้วได้ HTTP 414 กลับมาทั้งก้อน — ชื่อผู้แจ้งหายทั้งหน้า
// 200 ตัว ≈ 7.4KB จึงเลือก 150 ให้เหลือที่ว่างสำหรับ header กับพารามิเตอร์อื่น
const ID_CHUNK = 150

function chunk(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

export async function attachReporterProfiles(rows, fields = 'id, full_name, email, phone, role, created_at, avatar_url, job_title, address_province, address_district, address_subdistrict, address_moo, address_detail') {
  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))]
  if (userIds.length === 0) return rows

  const batches = await Promise.all(
    chunk(userIds, ID_CHUNK).map(async (ids) => {
      // fetchAllRows กันอีกชั้นเผื่อ db-max-rows ของโปรเจกต์ถูกตั้งต่ำกว่าขนาดก้อน ซึ่งจะทำให้
      // PostgREST ตัดแถวทิ้งเงียบๆ โดยไม่มี error (ต้องมี .order('id') ให้ pagination ชี้ขาดได้)
      const { data, error } = await fetchAllRows(() =>
        supabase.from('profiles').select(fields).in('id', ids).order('id'),
      )
      if (error) {
        console.error('[reporter profiles] ดึงโปรไฟล์ผู้แจ้งไม่สำเร็จ:', error.message)
        return []
      }
      return data ?? []
    }),
  )

  const byId = Object.fromEntries(batches.flat().map((p) => [p.id, p]))
  return rows.map((r) => ({ ...r, profiles: r.user_id ? (byId[r.user_id] ?? null) : null }))
}
