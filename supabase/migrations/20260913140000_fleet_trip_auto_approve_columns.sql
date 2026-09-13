-- เฟส 1/3 ของการอนุมัติคำขอใช้รถอัตโนมัติ — เพิ่มคอลัมน์และสถานะใหม่เท่านั้น
-- (ฟังก์ชันที่อ้างคอลัมน์/สถานะนี้อยู่ใน 20260913140100 และ 20260913140200 แยกไฟล์ตามกติกา
--  ADD COLUMN แล้วอ้างในไฟล์เดียวกันจะพังด้วย 42703)
--
-- ทำไมอนุมัติอัตโนมัติได้
-- ปุ่ม "อนุมัติ" ในระบบเป็นแค่การกันคิวรถ ไม่ใช่การอนุญาตใช้รถตามระเบียบ — การอนุญาตจริงคือ
-- ลายเซ็นผู้มีอำนาจบนใบขออนุญาตใช้รถ (แบบ 3) ซึ่งเจ้าของระบบยืนยันว่ายังเซ็นกระดาษทุกครั้ง
-- (2026-09-13) ระบบจึงอนุมัติคิวให้เองได้เมื่อรถว่าง โดย "ไม่ใส่ชื่อคนอนุมัติ" (approved_by = NULL)
-- ใบแบบ 3 จะพิมพ์ช่อง "อนุมัติ" เว้นว่างไว้ให้ผู้มีอำนาจติ๊กและลงนามเองตามเดิม
-- ⚠️ ถ้าวันหนึ่งเลิกเซ็นกระดาษ การอนุมัติอัตโนมัติจะไม่มีผู้มีอำนาจคนไหนอนุญาตเลย ต้องทบทวนใหม่

-- วิธีที่รายการถูกอนุมัติ — แยก "ระบบกันคิวให้" ออกจาก "คนกดอนุมัติ" ให้ตรวจย้อนหลังได้
-- NULL = รายการก่อนมีคอลัมน์นี้ (ไม่รู้ว่าอนุมัติด้วยวิธีไหน ห้ามเดาย้อนหลัง)
ALTER TABLE public.fleet_trips
  ADD COLUMN IF NOT EXISTS approval_method text;

COMMENT ON COLUMN public.fleet_trips.approval_method IS
  'auto = ระบบอนุมัติคิวให้เองเพราะรถว่าง (approved_by เป็น NULL) · manual = ผู้ดูแลกดอนุมัติ · NULL = รายการก่อน 2026-09-13';

ALTER TABLE public.fleet_trips
  DROP CONSTRAINT IF EXISTS fleet_trips_approval_method_check;
ALTER TABLE public.fleet_trips
  ADD CONSTRAINT fleet_trips_approval_method_check
  CHECK (approval_method IS NULL OR approval_method IN ('manual', 'auto'))
  NOT VALID;

-- waitlisted = "รอจัดสรรรถ" — คำขอที่รถคันนั้นมีคิวอยู่แล้วในช่วงเวลาเดียวกัน
-- ไม่กินคิวรถ (ไม่งั้นคำขอที่ชนกันจะไปบล็อกคิวของคนที่ได้รถไปแล้วซ้ำอีกชั้น)
-- รอผู้ดูแลเปลี่ยนรถ/เลื่อนเวลาแล้วอนุมัติ หรือปฏิเสธ
ALTER TABLE public.fleet_trips
  DROP CONSTRAINT IF EXISTS fleet_trips_status_check;
ALTER TABLE public.fleet_trips
  ADD CONSTRAINT fleet_trips_status_check
  CHECK (status IN ('draft', 'pending', 'waitlisted', 'approved', 'rejected', 'cancelled', 'in_progress', 'completed'))
  NOT VALID;
