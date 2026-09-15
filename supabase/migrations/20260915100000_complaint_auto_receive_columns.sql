-- 20260915100000_complaint_auto_receive_columns.sql
--
-- [เฟส DDL] ธงรายหมวด "ต้องให้แอดมินรับเรื่องเอง" สำหรับระบบรับเรื่องอัตโนมัติ
-- ตัว trigger/RPC อยู่ไฟล์ถัดไป 20260915100100 — แยกไฟล์ตามกติกา ADD COLUMN แล้วอ้างในไฟล์เดียวกันไม่ได้
--
-- ที่มา: เดิมคำร้องทุกใบค้างสถานะ pending จนกว่าแอดมินจะกด "รับเรื่อง" ทั้งที่ระบบรู้อยู่แล้วว่า
-- หมวดนั้นไปกองไหน ใครรับผิดชอบ (trg_resolve_complaint_routing + complaints_auto_assign)
-- ระหว่างนั้นเรื่องไม่ถึงมือผู้รับผิดชอบเลย (StaffDashboard กรอง pending ออก)
-- เจ้าของระบบให้ระบบรับเรื่องเองเมื่อข้อมูลครบ เว้นหมวดที่ตั้งธงนี้ไว้ (ตัดสินใจ 2569-09-15)
--
-- ค่าตั้งต้น true เฉพาะ corruption (แจ้งการทุจริต) — ทุก อปท. ส่งหมวดนี้ไปสำนักปลัดและมี
-- ผู้รับผิดชอบคนเดียว ถ้าระบบรับเรื่องเอง เรื่องจะถึงมือเจ้าหน้าที่คนนั้นทันทีโดยไม่มีใครกรอง
-- ซึ่งอาจเป็นผู้ถูกร้องเองหรือคนในสำนักเดียวกัน (ผลประโยชน์ทับซ้อน) จึงต้องผ่านแอดมินก่อนเสมอ
-- หมวดอื่นแอดมินเปิด/ปิดเองได้ในหน้า "ประเภทคำร้อง"

ALTER TABLE public.complaint_categories
  ADD COLUMN IF NOT EXISTS requires_manual_intake boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.complaint_categories.requires_manual_intake IS
  'true = คำร้องหมวดนี้ต้องให้แอดมินกดรับเรื่องเอง ระบบไม่รับเรื่องอัตโนมัติ (ค่าตั้งต้น: corruption)';

UPDATE public.complaint_categories
SET requires_manual_intake = true
WHERE value = 'corruption'
  AND requires_manual_intake = false;

-- complaint_categories ใช้ table-level GRANT (ไม่ใช่ column-level แบบ municipalities)
-- คอลัมน์ใหม่จึงอ่าน/แก้ได้ตามสิทธิ์เดิมทันที ไม่ต้อง GRANT เพิ่ม — ตรวจแล้ว 2569-09-15:
--   select grantee, privilege_type from information_schema.table_privileges
--    where table_schema='public' and table_name='complaint_categories';

-- ตรวจหลัง apply:
--   select m.slug, cc.value, cc.requires_manual_intake
--     from public.complaint_categories cc join public.municipalities m on m.id = cc.municipality_id
--    where cc.requires_manual_intake;
--   → ได้เฉพาะแถว corruption ของทุก อปท.
