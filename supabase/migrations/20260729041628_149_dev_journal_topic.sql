-- 149_dev_journal_topic.sql
-- เพิ่มมิติ "หัวข้อ" (topic) ให้ dev_journal — เมนูรองของแต่ละ "ส่วนของระบบ" (module)
-- เช่น module = "ข้อมูลระบบ" -> topic = "แผนที่ Leaflet + Longdo Map (ไทย)"
-- คนละมิติกับ category (ปัญหา/แก้ไข/เรื่องราว/แผนงาน) ซึ่งยังใช้เป็น tag แยกต่างหากเหมือนเดิม

alter table public.dev_journal
  add column if not exists topic text;
-- History version aligned with linked Supabase project.
