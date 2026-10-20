-- ทะเบียนคุมยานพาหนะส่วนกลาง — เอกสารแนบท้ายคำสั่งของ อปท. ที่ระบุ "หน่วยงานผู้ครอบครอง" และ
-- "ผู้รับผิดชอบควบคุม/ดูแล" ของรถแต่ละคัน (ต้นฉบับตัวอย่าง: อบต.ทุ่งแค้ว คำสั่งที่ 401/2569)
-- เจ้าของระบบอนุมัติ 2026-10-20
--
-- ไม่ใช่แบบ ๑–๖ ท้ายระเบียบ มท. ยานพาหนะ อปท. ๒๕๖๙ — เป็นเอกสารแนบคำสั่งของ อปท. เอง
-- ที่มาทางระเบียบยังต้องยืนยัน (ไม่อ้างเลขข้อในโค้ดหรือบนใบพิมพ์)
--
-- 3 ช่องใหม่ ทุกช่องไม่บังคับ — ช่องที่ยังไม่กรอกพิมพ์เป็นช่องว่างให้เขียนมือ ไม่ใช่บันทึกไม่ได้
--   custodian_department_id  หน่วยงานผู้ครอบครอง (กอง/สำนัก)
--   custodian_name           ชื่อผู้รับผิดชอบ (พิมพ์เอง ตามที่คำสั่งระบุ)
--   custodian_position       ตำแหน่งของผู้รับผิดชอบ
--
-- ทำไมไม่ใช้ department_id เดิม: ช่องนั้นหมายถึง "ใครเบิกใช้ได้" (ผูกกับ is_pool และสิทธิ์
-- fleet_can_read_asset ฟอร์มรถล้างค่าทิ้งเมื่อติ๊ก "ใช้ร่วมทุกกอง") ส่วนช่องใหม่คือ "ใครครอบครอง"
-- คนละเรื่องกัน รถน้ำเลาทั้ง 7 คันเป็นรถใช้ร่วมทุกกอง department_id จึงว่างทั้งหมด
--
-- ทำไม custodian_department_id ไม่มี FOREIGN KEY: fleet_vehicles มี FK ไป departments อยู่แล้ว 1 เส้น
-- (department_id) ถ้าเพิ่มอีกเส้น PostgREST จะตอบ PGRST201 "more than one relationship" กับทุกคำขอที่
-- ฝัง departments(...) ลงใน fleet_vehicles — ใช้อยู่หลายจุด (รายการรถ รายงาน หน้าภาพรวม) จะพังพร้อมกัน
-- ฝั่งหน้าจอจึงจับคู่ id กับรายชื่อกองของ อปท. ตัวเอง ค่าที่ไม่ตรงกองไหน (กองถูกลบ/id ผิด อปท.)
-- ตกไปกลุ่ม "ยังไม่ระบุหน่วยงานผู้ครอบครอง" ในใบพิมพ์ ไม่ทำให้รถหายจากทะเบียน
--
-- ชื่อ/ตำแหน่งเป็นข้อมูลของเจ้าหน้าที่ อปท. ตามคำสั่งมอบหมายงาน ไม่ใช่ข้อมูลประชาชน
-- สิทธิ์ตามตารางเดิม (column privilege มาจาก table-level grant ไม่ต้อง GRANT เพิ่ม)

ALTER TABLE public.fleet_vehicles
  ADD COLUMN IF NOT EXISTS custodian_department_id uuid,
  ADD COLUMN IF NOT EXISTS custodian_name text,
  ADD COLUMN IF NOT EXISTS custodian_position text;

ALTER TABLE public.fleet_vehicles
  DROP CONSTRAINT IF EXISTS fleet_vehicles_custodian_name_check,
  ADD CONSTRAINT fleet_vehicles_custodian_name_check
    CHECK (custodian_name IS NULL OR char_length(btrim(custodian_name)) BETWEEN 1 AND 200),
  DROP CONSTRAINT IF EXISTS fleet_vehicles_custodian_position_check,
  ADD CONSTRAINT fleet_vehicles_custodian_position_check
    CHECK (custodian_position IS NULL OR char_length(btrim(custodian_position)) BETWEEN 1 AND 200);

COMMENT ON COLUMN public.fleet_vehicles.custodian_department_id IS
  'หน่วยงานผู้ครอบครองยานพาหนะส่วนกลาง (departments.id) หัวกลุ่มของ "ทะเบียนคุมยานพาหนะส่วนกลาง" — คนละเรื่องกับ department_id/is_pool (ใครเบิกใช้ได้) ไม่มี FK โดยเจตนา ดูหัวไฟล์';
COMMENT ON COLUMN public.fleet_vehicles.custodian_name IS
  'ชื่อผู้รับผิดชอบควบคุม/ดูแลยานพาหนะส่วนกลาง ตามคำสั่งของ อปท. (พิมพ์เอง ระบบไม่เดาจากผู้ขับ)';
COMMENT ON COLUMN public.fleet_vehicles.custodian_position IS
  'ตำแหน่งของผู้รับผิดชอบควบคุม/ดูแลยานพาหนะส่วนกลาง ตามคำสั่งของ อปท.';
