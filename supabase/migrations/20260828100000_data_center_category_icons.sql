-- 20260828100000_data_center_category_icons.sql
--
-- ต่อยอดจาก 20260828090000_data_center_group_icons.sql — เดิมตั้งไอคอนได้แค่ระดับ "กลุ่มหลัก"
-- (group_name) ทำให้ทุกรายการในกลุ่มเดียวกันใช้ไอคอนเดียวกันหมด ผู้ใช้ต้องการแยกไอคอนราย
-- "ประเภทย่อย" (data_center_entries.category) เช่นกลุ่ม "สิ่งแวดล้อมและมลพิษ" = 🌱 แต่ประเภทย่อย
-- "ฟาร์มเลี้ยงสัตว์ (ขนาดใหญ่)" = 🐄
--
-- ระบบไม่มีตาราง categories แยก (group_name/category เป็น text column บน data_center_entries ตรงๆ)
-- จึงเก็บเป็น override ในตารางเดิมนี้โดยเพิ่มคอลัมน์ category
--
-- category = '' (สตริงว่าง) หมายถึงไอคอนระดับกลุ่มหลัก — จงใจใช้ '' แทน NULL ด้วย 2 เหตุผล:
--   1) UNIQUE ของ Postgres ไม่ dedupe NULL — ถ้าใช้ NULL จะเพิ่มไอคอนระดับกลุ่มซ้ำได้ไม่จำกัด
--      ต้องไปใช้ unique expression index coalesce(category,'') แทน
--   2) PostgREST/supabase-js ส่ง on_conflict เป็นชื่อคอลัมน์เท่านั้น อ้าง expression index ไม่ได้
--      upsert() ฝั่ง client จึงต้องพึ่ง plain UNIQUE constraint แบบนี้
ALTER TABLE public.data_center_group_icons
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT '';

ALTER TABLE public.data_center_group_icons
  DROP CONSTRAINT IF EXISTS data_center_group_icons_municipality_id_group_name_key;

ALTER TABLE public.data_center_group_icons
  ADD CONSTRAINT data_center_group_icons_muni_group_category_key
  UNIQUE (municipality_id, group_name, category);

-- RLS 4 policies เดิม (public read / admin insert-update-delete scoped by municipality) ไม่ต้องแก้
-- เพราะไม่ได้อ้างถึงคอลัมน์ category
