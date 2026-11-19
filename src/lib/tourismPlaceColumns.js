// คอลัมน์ของ tourism_places ที่หน้าสาธารณะ (ผู้ไม่ล็อกอินเปิดได้) ดึง — ทุกคอลัมน์ ยกเว้น created_by (uuid เจ้าหน้าที่ผู้สร้างร้าน)
// เตรียมไว้สำหรับร่าง docs/database/parked-tourism-places-anon-column-grant.sql (ถอน SELECT ทั้งตารางของ anon แล้วให้รายคอลัมน์)
// ร่างนั้นพักไว้ 2026-11-19 รอทำพร้อมงานกวาด uuid ทั้งระบบ — ตอนนี้ anon ยังอ่านได้ทั้งตาราง
// (tests/business-registrations-rls-db.test.mjs เทียบรายชื่อนี้กับ GRANT ในร่างให้)
//
// ⚠️ หน้าสาธารณะห้ามกลับไปใช้ select('*') กับ tourism_places — วันที่รันร่างนั้น anon จะไม่มีสิทธิ์ทั้งตาราง
//    PostgREST ตอบ 42501 ทั้งคำสั่ง หน้าท่องเที่ยวว่างทุก อปท. · เพิ่มคอลัมน์สาธารณะใหม่ = เพิ่มชื่อที่นี่ + ในร่าง
export const TOURISM_PLACE_PUBLIC_COLUMN_LIST = Object.freeze([
  'id', 'municipality_id', 'name', 'category', 'image_url', 'description', 'is_active', 'display_order', 'created_at',
  'address', 'maps_url', 'gallery', 'phone', 'service_type', 'online_service', 'online_url', 'has_delivery', 'department_id',
  'latitude', 'longitude', 'opening_hours', 'hours_note', 'facebook_url', 'line_id', 'is_featured', 'village_no',
  'price_range', 'updated_at',
])

/** สตริงสำหรับ supabase.from('tourism_places').select(...) ฝั่งสาธารณะ */
export const TOURISM_PLACE_PUBLIC_COLUMNS = TOURISM_PLACE_PUBLIC_COLUMN_LIST.join(', ')
