-- เพิ่มร่องรอยการแก้ไข (updated_at/updated_by) ให้ fleet_fuel_records และ fleet_maintenance
-- เดิม UI มีแค่เพิ่ม/ลบ ไม่มีแก้ไขรายการเดิม — เพิ่มปุ่มแก้ไขที่ frontend ต้องมีร่องรอยตรวจสอบได้
-- ว่าใครแก้ เมื่อไหร่ (บันทึกเกี่ยวข้องกับการเงิน/พัสดุครุภัณฑ์ อยู่ในขอบเขตตรวจสอบของ สตง.)

ALTER TABLE public.fleet_fuel_records
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.profiles(id);

ALTER TABLE public.fleet_maintenance
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.profiles(id);

CREATE OR REPLACE FUNCTION public.fleet_set_updated_meta()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fleet_fuel_updated_meta ON public.fleet_fuel_records;
CREATE TRIGGER trg_fleet_fuel_updated_meta
  BEFORE UPDATE ON public.fleet_fuel_records
  FOR EACH ROW EXECUTE FUNCTION public.fleet_set_updated_meta();

DROP TRIGGER IF EXISTS trg_fleet_maintenance_updated_meta ON public.fleet_maintenance;
CREATE TRIGGER trg_fleet_maintenance_updated_meta
  BEFORE UPDATE ON public.fleet_maintenance
  FOR EACH ROW EXECUTE FUNCTION public.fleet_set_updated_meta();
