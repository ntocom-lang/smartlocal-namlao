-- แก้บั๊ก: public.fleet_set_updated_at() เป็น shared BEFORE UPDATE trigger function
-- ผูกอยู่กับ 4 ตาราง (fleet_vehicles, fleet_fuel_records, fleet_trips, fleet_maintenance)
-- ตั้งแต่ migration 20260816130000
--
-- ต่อมา migration 20260816181000 ได้ CREATE OR REPLACE ฟังก์ชันเดียวกันนี้ให้เซ็ต
-- NEW.updated_by := auth.uid() เพิ่ม โดยตั้งใจใช้กับ fleet_fuel_records/fleet_maintenance
-- เท่านั้น (ตามที่ระบุใน migration 20260816180000) แต่ fleet_vehicles และ fleet_trips
-- ไม่มีคอลัมน์ updated_by จึงทำให้ UPDATE บน 2 ตารางนี้พังทั้งหมดด้วย error:
--   record "new" has no field "updated_by"
-- (กระทบปุ่มอนุมัติ/ปฏิเสธ/แก้ไขการจองในหน้าระบบยานพาหนะ)
--
-- แก้โดยแยกฟังก์ชันกลับเป็น 2 ตัวตามเจตนาเดิม:
--   fleet_set_updated_at()   -> ใช้กับ fleet_vehicles, fleet_trips (updated_at อย่างเดียว)
--   fleet_set_updated_meta() -> ใช้กับ fleet_fuel_records, fleet_maintenance (updated_at + updated_by)

CREATE OR REPLACE FUNCTION public.fleet_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fleet_set_updated_meta()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$function$;

-- ตารางที่มีคอลัมน์ updated_by จริง -> ย้ายไปใช้ฟังก์ชันเฉพาะ
DROP TRIGGER IF EXISTS trg_fleet_fuel_records_updated_at ON public.fleet_fuel_records;
CREATE TRIGGER trg_fleet_fuel_records_updated_at
  BEFORE UPDATE ON public.fleet_fuel_records
  FOR EACH ROW EXECUTE FUNCTION public.fleet_set_updated_meta();

DROP TRIGGER IF EXISTS trg_fleet_maintenance_updated_at ON public.fleet_maintenance;
CREATE TRIGGER trg_fleet_maintenance_updated_at
  BEFORE UPDATE ON public.fleet_maintenance
  FOR EACH ROW EXECUTE FUNCTION public.fleet_set_updated_meta();

-- fleet_vehicles, fleet_trips ยังคงใช้ trigger เดิม (trg_fleet_vehicles_updated_at,
-- trg_fleet_trips_updated_at) ซึ่งตอนนี้ชี้กลับไปที่ fleet_set_updated_at() ที่เซ็ตแค่
-- updated_at แล้ว — ไม่ต้องแก้ trigger ของ 2 ตารางนี้ เพราะ CREATE OR REPLACE FUNCTION
-- ด้านบนอัปเดต body ให้ trigger ที่ผูกอยู่แล้วโดยอัตโนมัติ
