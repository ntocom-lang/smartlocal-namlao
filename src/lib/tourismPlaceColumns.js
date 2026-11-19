// คอลัมน์ของ tourism_places ที่หน้าสาธารณะ (ผู้ไม่ล็อกอินเปิดได้) ดึง — ทุกคอลัมน์ ยกเว้น created_by (uuid เจ้าหน้าที่ผู้สร้างร้าน)
// รายชื่อจริงอยู่ที่ src/lib/anonColumns.js (แหล่งความจริงเดียวของคอลัมน์ที่ anon อ่านได้ 11 ตาราง) — ไฟล์นี้คงชื่อ export เดิมไว้
// migration 20261219100000_anon_hide_user_uuid_columns.sql ถอน SELECT ทั้งตารางของ anon แล้วให้รายคอลัมน์
// (tests/anon-columns.test.mjs + business-registrations-rls-db.test.mjs เทียบรายชื่อนี้กับ migration ให้)
//
// ⚠️ หน้าสาธารณะห้ามกลับไปใช้ select('*') กับ tourism_places — วันที่ถอนสิทธิ์ anon จะไม่มีสิทธิ์ทั้งตาราง
//    PostgREST ตอบ 42501 ทั้งคำสั่ง หน้าท่องเที่ยวว่างทุก อปท. · เพิ่มคอลัมน์สาธารณะใหม่ = เพิ่มชื่อใน anonColumns.js + migration GRANT
import { ANON_COLUMN_LIST, anonColumns } from './anonColumns.js'

export const TOURISM_PLACE_PUBLIC_COLUMN_LIST = ANON_COLUMN_LIST.tourism_places

/** สตริงสำหรับ supabase.from('tourism_places').select(...) ฝั่งสาธารณะ */
export const TOURISM_PLACE_PUBLIC_COLUMNS = anonColumns('tourism_places')
