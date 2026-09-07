-- เฟส 3/3 — กันข้อมูลข้ามสังกัดของคอลัมน์ใหม่ (ต้องรัน 20260908150100 ก่อน)
--
-- FK ธรรมดาบอกได้แค่ว่า "กอง/ผู้ขายมีอยู่จริง" แต่ไม่ได้บอกว่าอยู่ อปท. เดียวกับบันทึกนั้น
-- ถ้าไม่กัน ผู้ใช้ที่ยิง PostgREST ตรงๆ จะผูกค่าน้ำมันของตัวเองไปตัดงบกองของ อปท. อื่นได้
-- (รูปแบบเดียวกับที่ fleet_override_booking ตรวจ department/driver ไว้แล้ว)

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'fleet_fuel_records'
       AND column_name = 'vendor_id'
  ) THEN
    RAISE EXCEPTION 'ต้องรัน 20260908150100_fleet_fuel_accounting_columns.sql ก่อน';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.fleet_guard_fuel_accounting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.department_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.departments
     WHERE id = NEW.department_id AND municipality_id = NEW.municipality_id
  ) THEN
    RAISE EXCEPTION 'FLEET_FUEL_DEPARTMENT_TENANT_MISMATCH';
  END IF;

  IF NEW.vendor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.fleet_vendors
     WHERE id = NEW.vendor_id AND municipality_id = NEW.municipality_id
  ) THEN
    RAISE EXCEPTION 'FLEET_FUEL_VENDOR_TENANT_MISMATCH';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_fleet_fuel_guard_accounting ON public.fleet_fuel_records;
CREATE TRIGGER trg_fleet_fuel_guard_accounting
BEFORE INSERT OR UPDATE OF department_id, vendor_id
ON public.fleet_fuel_records
FOR EACH ROW
EXECUTE FUNCTION public.fleet_guard_fuel_accounting();
