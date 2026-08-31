-- เฟส 1/2 ของ "บันทึกการใช้รถย้อนหลังต้องมีเหตุผลกำกับ"
-- ไฟล์นี้เพิ่มคอลัมน์อย่างเดียว ห้ามอ้างคอลัมน์นี้ในไฟล์เดียวกัน (เจอ 42703 มาแล้วในโปรเจกต์นี้)
-- ตัวบังคับใช้อยู่ใน 20260902200000_fleet_trip_backdated_guard.sql
--
-- ที่มา: รายการที่บันทึกย้อนหลังถูกสร้างเป็น completed ทันทีโดยไม่ผ่านขั้นอนุมัติ
-- ใบขออนุญาตใช้รถส่วนกลาง (แบบ 3) ที่พิมพ์จากรายการแบบนี้จึงไม่มีผู้อนุมัติ
-- ต้องมีเหตุผลกำกับไว้ให้ตรวจสอบย้อนหลังได้ว่าทำไมจึงไม่ได้ขออนุญาตล่วงหน้า

ALTER TABLE public.fleet_trips
  ADD COLUMN IF NOT EXISTS backdated_reason text;

COMMENT ON COLUMN public.fleet_trips.backdated_reason IS
  'เหตุผลที่บันทึกการใช้รถย้อนหลังโดยไม่ผ่านขั้นขออนุญาตล่วงหน้า บังคับกรอกเมื่อ INSERT status=completed จากฝั่งผู้ใช้';

ALTER TABLE public.fleet_trips
  DROP CONSTRAINT IF EXISTS fleet_trips_backdated_reason_length_check;
ALTER TABLE public.fleet_trips
  ADD CONSTRAINT fleet_trips_backdated_reason_length_check
  CHECK (
    backdated_reason IS NULL
    OR char_length(btrim(backdated_reason)) BETWEEN 5 AND 500
  ) NOT VALID;
