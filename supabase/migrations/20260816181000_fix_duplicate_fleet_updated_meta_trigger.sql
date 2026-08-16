-- แก้ไขความผิดพลาด: migration ก่อนหน้า (20260816180000_fleet_records_edit_audit) สร้างคอลัมน์/trigger
-- updated_at+updated_by ซ้ำกับของเดิมที่มีอยู่แล้ว (fleet_set_updated_at ตั้งแต่ migration 20260816130000)
-- ผลคือมี BEFORE UPDATE trigger ซ้อนกัน 2 ตัวต่อตาราง — รวบให้เหลือตัวเดียวโดยขยาย
-- fleet_set_updated_at() เดิมให้ตั้ง updated_by ด้วย แล้วลบ trigger/function ที่เพิ่มซ้ำทิ้ง

CREATE OR REPLACE FUNCTION public.fleet_set_updated_at()
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

DROP TRIGGER IF EXISTS trg_fleet_fuel_updated_meta ON public.fleet_fuel_records;
DROP TRIGGER IF EXISTS trg_fleet_maintenance_updated_meta ON public.fleet_maintenance;
DROP FUNCTION IF EXISTS public.fleet_set_updated_meta();

-- ล้างร่องรอย "แก้ไข" ปลอมที่เกิดจาก UPDATE ของ migration หลังบ้านก่อนหน้านี้ (updated_by เป็น NULL แปลว่าไม่ใช่ผู้ใช้จริงแก้)
UPDATE public.fleet_fuel_records SET updated_at = NULL, updated_by = NULL WHERE updated_by IS NULL AND updated_at IS NOT NULL;
UPDATE public.fleet_maintenance   SET updated_at = NULL, updated_by = NULL WHERE updated_by IS NULL AND updated_at IS NOT NULL;
