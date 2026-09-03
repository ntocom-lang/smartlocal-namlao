-- fleet_vehicles: ทรัพย์สินต้อง "ผูกกอง" หรือ "ใช้ร่วมกันทุกกอง" อย่างใดอย่างหนึ่งเสมอ
--
-- เหตุผล: RLS ของโมดูลยานพาหนะตัดสินสิทธิ์อ่านผ่าน public.fleet_can_read_asset()
-- (supabase/migrations/20260816130000_harden_fleet_assets_and_documents.sql) ซึ่งสำหรับ
-- fleet_staff ใช้เงื่อนไข (v.department_id = p.department_id OR v.is_pool)
-- ถ้ารถมี department_id IS NULL และ is_pool = false ผลลัพธ์จะเป็น (NULL OR false) = NULL
-- ไม่ใช่ TRUE → เจ้าหน้าที่ยานพาหนะทุกคนมองไม่เห็นรถคันนั้น เห็นแต่ผู้ดูแล
-- อาการนี้ไล่หาสาเหตุยากเพราะข้อมูลยังอยู่ครบและไม่มี error ใดๆ
--
-- ฝั่งนำเข้า CSV กันกรณีนี้อยู่แล้ว (src/components/fleet/FleetImportModal.jsx —
-- "if (!departmentId && !isPool)") แต่ฟอร์มเพิ่มทีละคันไม่ได้บังคับ จึงยังเล็ดลอดเข้ามาได้
-- migration นี้ย้ายกฎเดิมนั้นลงมาเป็น constraint ที่ฐานข้อมูล เพื่อปิดทุกช่องทางพร้อมกัน

BEGIN;

-- 1) ล้างข้อมูลเดิมที่ติดสถานะ "มองไม่เห็น" ก่อน ไม่งั้น ADD CONSTRAINT จะล้ม
--    ตีความเป็นทรัพย์สินส่วนกลาง เพราะเป็นทางเลือกที่ทำให้ข้อมูลกลับมาเห็นได้
--    โดยไม่ต้องเดาว่าเจ้าของจริงคือกองไหน (ผู้ดูแลแก้เป็นกองที่ถูกต้องภายหลังได้)
UPDATE public.fleet_vehicles
SET is_pool = true
WHERE department_id IS NULL
  AND is_pool IS DISTINCT FROM true;

-- 2) กันไม่ให้เกิดซ้ำจากทุกช่องทาง (ฟอร์ม, CSV, SQL ตรง)
ALTER TABLE public.fleet_vehicles
  DROP CONSTRAINT IF EXISTS fleet_vehicles_department_or_pool;

ALTER TABLE public.fleet_vehicles
  ADD CONSTRAINT fleet_vehicles_department_or_pool
  CHECK (department_id IS NOT NULL OR is_pool);

COMMENT ON CONSTRAINT fleet_vehicles_department_or_pool ON public.fleet_vehicles IS
  'ต้องระบุกอง หรือเป็นของกลาง (is_pool) อย่างใดอย่างหนึ่ง — ไม่ระบุทั้งคู่จะทำให้ fleet_staff มองไม่เห็นรายการนี้';

COMMIT;
