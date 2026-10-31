-- 20261031100000_esign_fallback_column.sql
--
-- [เฟส DDL] ลงนามออนไลน์ เฟส 2 (เจ้าของระบบอนุมัติ 2569-10-31 "ลุยเฟส 2") — เพิ่มคอลัมน์ที่ fleet_trips เท่านั้น
-- ฟังก์ชันที่เขียน/อ่านคอลัมน์นี้อยู่ไฟล์ถัดไป (20261031100100) แยกไฟล์ตาม docs/ai/NOTES.md ข้อ 3
--
-- esign_fallback  ช่องที่ อปท. เปิดออนไลน์ไว้ แต่ตอนสร้างคำขอผู้ลงนามยังไม่พร้อม ระบบจึงให้ช่องนั้นเซ็นสดแทน
--                 ค่าคือ {"ช่อง": "เหตุผล"} เช่น {"dept_head":"pin_not_set","authority":"signatory_not_linked"}
--                 NULL = ไม่มีช่องไหนถูกเปลี่ยน (ทริปเก่าทุกใบ ทริปเซ็นสดล้วน และทริปที่ผู้ลงนามพร้อมครบ)
--                 ตรึงตอน INSERT พร้อม esign_slots — ผู้ลงนามมาตั้งรหัสทีหลัง ใบนี้ยังเซ็นสดช่องนั้นต่อ (เจ้าของระบบเลือก)
--
-- ⚠️ client เขียนเองไม่ได้ (trigger trg_fleet_trips_esign_guard เขียนทับทุกครั้ง)
-- ⚠️ ไม่ต้อง GRANT เพิ่ม: fleet_trips ใช้สิทธิ์ระดับตาราง (NOTES.md ข้อ 4)
-- ⚠️ หน้าเว็บอ่านค่านี้ผ่าน esign_trip_status เท่านั้น ไม่ใส่ใน SELECT ของรายการทริป
--    (ถ้าเว็บขึ้นก่อน migration รายการทริปจะพังทั้งหน้า)
-- ผลต่อของที่ใช้งานอยู่: ไม่มี — คอลัมน์ใหม่เป็น NULL ทุกแถว

DO $guard$
BEGIN
  IF to_regclass('public.fleet_trips') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบ public.fleet_trips — ตารางยานพาหนะต้องมาก่อน';
  END IF;
END;
$guard$;

ALTER TABLE public.fleet_trips
  ADD COLUMN IF NOT EXISTS esign_fallback jsonb;

COMMENT ON COLUMN public.fleet_trips.esign_fallback IS
  'ช่องที่เปิดออนไลน์แต่ผู้ลงนามยังไม่พร้อมตอนสร้างคำขอ จึงเซ็นสดแทน {ช่อง: เหตุผล} — trigger trg_fleet_trips_esign_guard เป็นผู้เขียนเพียงผู้เดียว';

-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   select count(*) filter (where esign_fallback is not null) from public.fleet_trips;   → 0
