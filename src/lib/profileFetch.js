import { supabase } from './supabase'

// อ่านโปรไฟล์ของผู้ใช้แบบรวมศูนย์ กันการยิงซ้ำซ้อนตอนโหลดหน้า
//
// ทุกครั้งที่เปิดแอปพร้อม session มีสองที่ที่อ่าน public.profiles ของ user คนเดียวกันพร้อมกัน
// คนละคำสั่ง: AuthContext (เอา role/municipality_id ไปตัดสินสิทธิ์) กับ checkAndFixProfile ใน
// App.jsx (เอา phone/full_name/avatar_url ไปเช็คว่าต้องเตือนให้กรอกอะไรเพิ่มไหม) กลายเป็นสอง
// round-trip ที่ผ่าน RLS ของ Postgres ทั้งคู่ ทั้งที่เป็นแถวเดียวกันเป๊ะ — บนมือถือสัญญาณช้า
// ผู้ใช้รอนานขึ้นโดยไม่ได้อะไรเพิ่ม และ อปท. ที่ใช้ Supabase free tier ก็เปลืองโควตาฟรีๆ
//
// รวม column ที่ทั้งสองฝั่งต้องใช้ไว้ชุดเดียว แล้วแชร์ promise ที่ยัง "บินอยู่" ให้ผู้เรียกที่มาใน
// จังหวะเดียวกัน — ไม่ได้ cache ผลลัพธ์ไว้ข้ามเวลา (พอ request จบก็ลบทิ้ง) การอ่านรอบถัดไปจึงยัง
// ได้ข้อมูลสดเสมอ ไม่มีปัญหาข้อมูลเก่าค้างหลัง admin เปลี่ยน role ให้
const PROFILE_COLUMNS = 'role, municipality_id, full_name, avatar_url, phone'

const inFlight = new Map()

/**
 * อ่านโปรไฟล์ 1 แถว — คืน { data, error } เสมอ ไม่เคย reject
 *
 * ที่ต้องไม่ reject เพราะ client ตัวนี้ครอบ fetch ด้วย timeout 25 วิไว้ใน supabase.js พอ abort
 * แล้วมันจะโยน error จริง ไม่ใช่คืน { data, error } ตามปกติของ PostgREST ผู้เรียกที่ใช้
 * `const { data, error } = await ...` ตรงๆ จะโยนต่อออกไปเป็น unhandled rejection
 *
 * @param {string} uid auth.users.id ของผู้ใช้
 */
export function fetchProfile(uid) {
  const pending = inFlight.get(uid)
  if (pending) return pending

  const request = (async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select(PROFILE_COLUMNS)
        .eq('id', uid)
        .maybeSingle()
      return { data, error }
    } catch (err) {
      return { data: null, error: err instanceof Error ? err : new Error(String(err)) }
    }
  })()

  inFlight.set(uid, request)
  request.finally(() => {
    // เช็คก่อนลบ เผื่อมีรอบใหม่ทับเข้ามาแล้ว จะได้ไม่ไปลบของรอบใหม่ทิ้ง
    if (inFlight.get(uid) === request) inFlight.delete(uid)
  })
  return request
}
