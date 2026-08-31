-- เฟส 2/2 ของ "บันทึกการใช้รถย้อนหลังต้องมีเหตุผลกำกับ" (ต้องรัน 20260902190000 ก่อน)
--
-- ช่องโหว่ที่ปิด: guard เดิมตรวจ "การเปลี่ยนสถานะ" เฉพาะตอน UPDATE เท่านั้น การ INSERT
-- แถวใหม่ที่ status='completed' ตรงๆ (ปุ่ม "บันทึกการใช้รถย้อนหลัง") จึงข้ามทั้งขั้นอนุมัติ
-- และการตรวจสิทธิ์ผู้อนุมัติไปทั้งหมด เจ้าหน้าที่ทั่วไปสร้างประวัติการใช้รถที่ "เสร็จสิ้นแล้ว"
-- ได้เองโดยไม่มีใครอนุมัติและไม่มีเหตุผลกำกับ
--
-- ทางแก้: INSERT ที่ status='completed' จากฝั่งผู้ใช้ (auth.uid() IS NOT NULL) ต้องเป็น
-- ผู้ดูแลระบบยานพาหนะ และต้องมี backdated_reason เสมอ
--   - service_role / งานนำเข้าข้อมูล (auth.uid() IS NULL) ไม่ถูกบังคับ เพื่อไม่ให้ backfill พัง
--   - fleet_override_booking INSERT ด้วย status='approved' ไม่ใช่ 'completed' จึงไม่โดนกฎนี้
--     (ฟังก์ชันนั้นตรวจ fleet_is_manager ของตัวเองอยู่แล้ว)
--
-- ⚠️ CREATE OR REPLACE ต้องมี body เดิมครบทุกบรรทัด ห้ามใส่ placeholder เด็ดขาด

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'fleet_trips'
       AND column_name = 'backdated_reason'
  ) THEN
    RAISE EXCEPTION 'ต้องรัน 20260902190000_fleet_trip_backdated_reason_column.sql ก่อน';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.fleet_guard_trip_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_asset_kind text;
  v_asset_municipality uuid;
  v_is_manager boolean;
BEGIN
  SELECT asset_kind, municipality_id
    INTO v_asset_kind, v_asset_municipality
  FROM public.fleet_vehicles
  WHERE id = NEW.vehicle_id;

  IF v_asset_municipality IS NULL OR v_asset_municipality <> NEW.municipality_id THEN
    RAISE EXCEPTION 'FLEET_ASSET_TENANT_MISMATCH';
  END IF;

  IF v_asset_kind <> 'vehicle' THEN
    RAISE EXCEPTION 'FLEET_TRIP_REQUIRES_VEHICLE';
  END IF;

  -- service_role/import ไม่มี auth.uid(); ฝั่งผู้ใช้จริงห้ามปลอม created_by
  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL THEN
    NEW.created_by := auth.uid();
  END IF;

  -- บันทึกการใช้รถย้อนหลัง = สร้างแถวที่ "เสร็จสิ้นแล้ว" โดยไม่ผ่านขั้นอนุมัติ
  -- จำกัดให้เฉพาะผู้ดูแลระบบยานพาหนะ และต้องมีเหตุผลกำกับไว้ให้ตรวจสอบย้อนหลังได้เสมอ
  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL AND NEW.status = 'completed' THEN
    IF NOT public.fleet_is_manager(NEW.municipality_id) THEN
      RAISE EXCEPTION 'FLEET_TRIP_BACKDATED_REQUIRES_MANAGER';
    END IF;
    IF coalesce(btrim(NEW.backdated_reason), '') = '' THEN
      RAISE EXCEPTION 'FLEET_TRIP_BACKDATED_REQUIRES_REASON';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NOT (
      (OLD.status = 'draft' AND NEW.status IN ('pending', 'cancelled'))
      OR (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected', 'cancelled'))
      OR (OLD.status = 'approved' AND NEW.status IN ('in_progress', 'cancelled'))
      OR (OLD.status = 'in_progress' AND NEW.status = 'completed')
    ) THEN
      RAISE EXCEPTION 'FLEET_TRIP_INVALID_STATUS_TRANSITION: % -> %', OLD.status, NEW.status;
    END IF;

    -- service_role ไม่มี auth.uid() แต่ยังต้องผ่าน tenant/asset guard ด้านบน
    v_is_manager := auth.uid() IS NULL OR public.fleet_is_manager(NEW.municipality_id);

    IF NEW.status IN ('approved', 'rejected') AND NOT v_is_manager THEN
      RAISE EXCEPTION 'FLEET_TRIP_APPROVAL_REQUIRES_MANAGER';
    END IF;

    IF NEW.status IN ('in_progress', 'completed')
       AND NOT v_is_manager
       AND auth.uid() IS DISTINCT FROM NEW.driver_id
       AND auth.uid() IS DISTINCT FROM NEW.created_by THEN
      RAISE EXCEPTION 'FLEET_TRIP_PROGRESS_REQUIRES_OWNER';
    END IF;
  END IF;

  IF NEW.status = 'approved' AND NEW.approved_at IS NULL THEN
    NEW.approved_at := now();
    NEW.approved_by := COALESCE(NEW.approved_by, auth.uid());
  END IF;

  RETURN NEW;
END;
$function$;
