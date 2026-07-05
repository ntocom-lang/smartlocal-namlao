-- เพิ่ม timestamp columns + ปรับ constraints สำหรับ reservation system
-- (migration 093 อาจหรืออาจยังไม่ได้รัน — ใช้ IF NOT EXISTS ทั้งหมด)

ALTER TABLE public.fleet_trips
  ADD COLUMN IF NOT EXISTS started_at        timestamptz,
  ADD COLUMN IF NOT EXISTS returned_at       timestamptz,
  ADD COLUMN IF NOT EXISTS planned_departure  timestamptz,
  ADD COLUMN IF NOT EXISTS planned_return     timestamptz;

-- odometer_start ไม่ต้อง NOT NULL สำหรับการจองล่วงหน้า
ALTER TABLE public.fleet_trips
  ALTER COLUMN odometer_start DROP NOT NULL;

-- ย้ายข้อมูลเก่า: สร้าง started_at จาก trip_date + depart_time
UPDATE public.fleet_trips
  SET started_at = (trip_date + COALESCE(depart_time, '00:00:00'::time))::timestamptz
  WHERE started_at IS NULL AND trip_date IS NOT NULL;

-- ย้ายข้อมูลเก่า: สร้าง returned_at จาก trip_date + return_time
UPDATE public.fleet_trips
  SET returned_at = (trip_date + return_time)::timestamptz
  WHERE returned_at IS NULL AND return_time IS NOT NULL;

-- อัปเดต status constraint ให้รองรับ in_progress, cancelled
ALTER TABLE public.fleet_trips DROP CONSTRAINT IF EXISTS fleet_trips_status_check;
ALTER TABLE public.fleet_trips
  ADD CONSTRAINT fleet_trips_status_check
  CHECK (status IN ('draft','pending','approved','rejected','cancelled','in_progress','completed'));
