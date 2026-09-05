-- เฟส 2/2: CHECK + COMMENT ของ fleet_vehicles.fuel_rate_standard_kml
-- แยกไฟล์ตามกติกาใน docs/ai/NOTES.md ข้อ 3 (ADD COLUMN แล้วอ้างคอลัมน์นั้นในไฟล์เดียวกัน
-- พังด้วย 42703 ทั้งที่ ALTER อยู่บรรทัดก่อนหน้า)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'fleet_vehicles'
       AND column_name = 'fuel_rate_standard_kml'
  ) THEN
    RAISE EXCEPTION 'ต้องรัน 20260906170000_fleet_vehicle_fuel_rate_column.sql ก่อน';
  END IF;
END $$;

COMMENT ON COLUMN public.fleet_vehicles.fuel_rate_standard_kml IS
  'อัตราสิ้นเปลืองที่ทางราชการกำหนดสำหรับรถคันนี้ (กม./ลิตร) ใช้พิมพ์ช่อง "อัตราที่กำหนด" '
  'ในบันทึกข้อความรายงานการใช้น้ำมันเชื้อเพลิงรายเดือน — คนละเรื่องกับ efficiency_min/max '
  'ซึ่งเป็นเกณฑ์จับค่ากรอกผิดปกติ · NULL = ยังไม่ได้กำหนด';

ALTER TABLE public.fleet_vehicles
  DROP CONSTRAINT IF EXISTS fleet_vehicles_fuel_rate_standard_check;
ALTER TABLE public.fleet_vehicles
  ADD CONSTRAINT fleet_vehicles_fuel_rate_standard_check
  CHECK (fuel_rate_standard_kml IS NULL OR fuel_rate_standard_kml > 0);
