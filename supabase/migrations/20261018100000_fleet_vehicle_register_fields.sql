-- ข้อมูลทะเบียนยานพาหนะตามแบบ ๑ / แบบ ๒ — ระเบียบกระทรวงมหาดไทยว่าด้วยการใช้และรักษายานพาหนะ
-- ขององค์กรปกครองส่วนท้องถิ่น พ.ศ. ๒๕๖๙ ข้อ ๗: จัดทำบัญชียานพาหนะแยกประเภทเป็นรถยนต์ประจำตำแหน่ง
-- (แบบ ๑) และยานพาหนะส่วนกลาง (แบบ ๒) พร้อมหลักฐานการได้มาและการจำหน่ายจ่ายโอน
-- เจ้าของระบบอนุมัติ 2026-10-18
--
-- คอลัมน์ในแบบที่ระบบยังไม่มี: ขนาด (ซีซี) · ราคา · วันได้มา · วันจำหน่าย · ประเภทตามระเบียบ
-- (ชื่อ ยี่ห้อ/รุ่น รุ่นปี ทะเบียน สังกัด มีอยู่แล้ว) ทุกช่องไม่บังคับ — ช่องที่ยังไม่กรอก
-- ใบพิมพ์เว้นว่างให้เขียนเอง ไม่ใช่บันทึกไม่ได้
--
-- regulation_category แยกจาก is_pool โดยเจตนา: is_pool = "ทุกกองเบิกใช้ได้" (สิทธิ์การมองเห็น)
-- ส่วนนี้คือประเภทตามระเบียบ รถที่ผูกกองเดียวก็ยังเป็น "ยานพาหนะส่วนกลาง" ตามนิยามข้อ ๕
-- ค่าเริ่มต้น central เพราะรถทุกคันในระบบ ณ วันนี้เป็นรถส่วนกลาง (ไม่มีรถประจำตำแหน่ง)
--
-- ไม่มีข้อมูลส่วนบุคคล · สิทธิ์ตามตารางเดิม (column privilege มาจาก table-level grant ไม่ต้อง GRANT เพิ่ม)

ALTER TABLE public.fleet_vehicles
  ADD COLUMN IF NOT EXISTS regulation_category text NOT NULL DEFAULT 'central',
  ADD COLUMN IF NOT EXISTS engine_cc integer,
  ADD COLUMN IF NOT EXISTS purchase_price numeric(14,2),
  ADD COLUMN IF NOT EXISTS acquired_date date,
  ADD COLUMN IF NOT EXISTS disposed_date date;

ALTER TABLE public.fleet_vehicles
  DROP CONSTRAINT IF EXISTS fleet_vehicles_regulation_category_check,
  ADD CONSTRAINT fleet_vehicles_regulation_category_check
    CHECK (regulation_category IN ('central', 'position')),
  DROP CONSTRAINT IF EXISTS fleet_vehicles_engine_cc_check,
  ADD CONSTRAINT fleet_vehicles_engine_cc_check
    CHECK (engine_cc IS NULL OR engine_cc BETWEEN 1 AND 100000),
  DROP CONSTRAINT IF EXISTS fleet_vehicles_purchase_price_check,
  ADD CONSTRAINT fleet_vehicles_purchase_price_check
    CHECK (purchase_price IS NULL OR purchase_price >= 0),
  DROP CONSTRAINT IF EXISTS fleet_vehicles_disposed_after_acquired,
  ADD CONSTRAINT fleet_vehicles_disposed_after_acquired
    CHECK (disposed_date IS NULL OR acquired_date IS NULL OR disposed_date >= acquired_date);

COMMENT ON COLUMN public.fleet_vehicles.regulation_category IS
  'ประเภทตามระเบียบ มท. ยานพาหนะ อปท. 2569 ข้อ 7: central = ยานพาหนะส่วนกลาง (แบบ 2), position = รถยนต์ประจำตำแหน่ง (แบบ 1) — คนละเรื่องกับ is_pool';
COMMENT ON COLUMN public.fleet_vehicles.engine_cc IS 'ขนาดเครื่องยนต์ (ซีซี) ช่อง "แบบ/รุ่นปี/ขนาด (ซีซี)" ของแบบ 1/2';
COMMENT ON COLUMN public.fleet_vehicles.purchase_price IS 'ราคาที่ได้มา (บาท) ช่อง "ราคา" ของแบบ 1/2';
COMMENT ON COLUMN public.fleet_vehicles.acquired_date IS 'วันได้มา ช่อง "วันได้มา" ของแบบ 1/2';
COMMENT ON COLUMN public.fleet_vehicles.disposed_date IS 'วันจำหน่าย ช่อง "วันจำหน่าย" ของแบบ 1/2 — รถที่จำหน่ายแล้วยังอยู่ในทะเบียน (ข้อ 7 ให้แสดงหลักฐานการจำหน่าย)';
