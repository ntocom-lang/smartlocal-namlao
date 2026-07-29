-- 148_dev_journal_module.sql
-- เพิ่มมิติ "ส่วนของระบบ" (module) ให้ dev_journal — เมนูหลัก = ส่วนของระบบ (free text
-- ผู้ใช้กำหนดเอง งอกจากข้อมูลที่กรอกจริง ไม่ fix รายการล่วงหน้า), เมนูรอง = category เดิม
-- (ปัญหา/แก้ไข/เรื่องราว/แผนงาน) เพื่อให้ไล่ดูทีละส่วนของระบบทั้งหมดได้

alter table public.dev_journal
  add column if not exists module text;
-- History version aligned with linked Supabase project.
