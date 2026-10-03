-- 20261003200000_data_center_verified_columns.sql
--
-- เฟส 1 ของงาน "ศูนย์รวมข้อมูลดิจิทัล: ทะเบียนชุดข้อมูล + สุขภาพข้อมูล + ข้อมูลเปิด" (DDL เท่านั้น)
-- ตามกติกา docs/ai/NOTES.md ข้อ 3: ADD COLUMN แยกไฟล์จากฟังก์ชันที่อ้างคอลัมน์นั้น
-- ฟังก์ชัน/trigger อยู่ใน 20261003200100_data_center_health_and_catalog.sql
--
-- verified_at / verified_by = "เจ้าหน้าที่ตรวจทานแล้วว่ารายการนี้ยังถูกต้อง" โดยไม่ต้องแก้เนื้อหา
-- ใช้ปิดป้าย "ไม่ได้ตรวจทานนาน" ในหน้า "คุณภาพข้อมูล" — ต่างจาก updated_at ที่เปลี่ยนเฉพาะเมื่อ
-- เนื้อหาเปลี่ยนจริง (ดู trigger data_center_touch_updated_at ในไฟล์ถัดไป)
--
-- verified_by ผูก auth.users แบบ ON DELETE SET NULL เพื่อไม่ให้การลบบัญชีผู้ใช้ถูกบล็อกเพราะคอลัมน์นี้
-- (ต่างจาก created_by เดิมที่ไม่มี ON DELETE)
--
-- RLS: ไม่ต้องแก้ นโยบาย UPDATE เดิมของ data_center_entries คุมอยู่แล้ว (admin ทั้ง อปท. / officer เฉพาะกองตัวเอง /
-- staff-technician เฉพาะที่ตัวเองสร้าง) และ trigger protect_department_record_scope ไม่ขวางคอลัมน์ใหม่นี้
-- ตารางนี้ไม่ได้ใช้ column-level GRANT (ต่างจาก municipalities) คอลัมน์ใหม่จึงใช้สิทธิ์ระดับตารางเดิมได้เลย

ALTER TABLE public.data_center_entries
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.data_center_entries.verified_at IS
  'เวลาที่เจ้าหน้าที่กด "ยืนยันว่ายังถูกต้อง" (ไม่ได้แก้เนื้อหา) — NULL = ยังไม่เคยกดยืนยัน';
COMMENT ON COLUMN public.data_center_entries.verified_by IS
  'ผู้กดยืนยันล่าสุด (auth.users.id) — NULL เมื่อยังไม่เคยยืนยันหรือบัญชีถูกลบ';

NOTIFY pgrst, 'reload schema';
