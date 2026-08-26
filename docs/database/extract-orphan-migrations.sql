-- ดึง SQL เต็มของ migration 2 ตัวที่อยู่ใน DB จริงแต่ไม่มีไฟล์ต้นทางใน repo
--
--   20260816153459  restrict_google_cloud_columns_public_select
--       ปิดไม่ให้ anon อ่าน municipalities.google_cloud_email / google_project_id
--       = การแข็งค่าความปลอดภัย ถ้าหายไปแล้วสร้าง DB ใหม่ คอลัมน์นี้จะกลับมาเปิดสาธารณะ
--
--   20260823232242  fleet_role_read_municipality_profiles
--       RLS policy ให้ผู้ใช้ที่มี fleet_role อ่านชื่อเพื่อนร่วมเทศบาลได้
--       = ตัวที่ทำให้ dropdown "ผู้ใช้รถ" และการเห็นการจองของคนอื่นทำงาน
--       ถ้าหายไป ระบบยานพาหนะจะพังทันทีบน DB ที่สร้างใหม่
--
-- อีก 23 ตัวที่เหลือจับคู่กับไฟล์ local ได้ครบแล้ว (ดูตารางสรุปที่ผมส่งให้)
-- จึง revert ได้อย่างปลอดภัย แต่ 2 ตัวนี้ต้องเก็บเป็นไฟล์ก่อน
--
-- วิธีใช้: รันแล้วคัดลอกค่าในคอลัมน์ sql_text ของแต่ละแถวส่งกลับมา
-- (ถ้า SQL Editor ตัดข้อความ ให้กดที่เซลล์เพื่อดูค่าเต็ม หรือ export เป็น CSV)

SELECT
  version,
  name,
  length(array_to_string(statements, E';\n')) AS sql_length,
  array_to_string(statements, E';\n') AS sql_text
FROM supabase_migrations.schema_migrations
WHERE version IN ('20260816153459', '20260823232242')
ORDER BY version;
