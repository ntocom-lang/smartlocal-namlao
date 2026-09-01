-- เฟส 3/3 ของชุดนี้ (ต้องรัน 20260903120000 และ 20260903140000 ก่อน)
-- ปิดช่องว่างที่เหลือของ fleet_guard_trip_write() และรองรับการยื่นคำขอแทนผู้อื่น
--
-- ⚠️ ก่อน apply ต้องยืนยันว่า body บน production ตรงกับ 20260902200000 จริง:
--     SELECT md5(prosrc) FROM pg_proc WHERE proname = 'fleet_guard_trip_write';
--   ค่าที่ตรวจไว้ ณ 2026-09-01 คือ 508bca285a41ab9376f4df488b7472d6 (ตรง byte-for-byte)
--   โปรเจกต์นี้เคยมี schema drift ถ้าค่าเปลี่ยนไปจากนี้ ให้หยุดและซ่อม drift ก่อน
--
-- ⚠️ body ด้านล่างคัดมาจาก 20260902200000_fleet_trip_backdated_guard.sql ครบทุกบรรทัด
--   แล้วเติมของใหม่ ห้ามใส่ placeholder เด็ดขาด (บทเรียนจาก 20260829120000)
--
-- ที่เพิ่ม:
--   1. ยกเลิกทริปต้องเป็นผู้ขอตัวจริง ผู้บันทึกแทน หรือผู้ดูแล — เดิม whitelist ยอมให้
--      pending/approved -> cancelled โดยไม่ตรวจว่าใครกด เจ้าหน้าที่ในกองเดียวกันจึงยกเลิก
--      คำขอของเพื่อนได้
--   2. ไม่บล็อกการอนุมัติคำขอของตัวเอง — ตัดสินใจโดยเจ้าของระบบ เพราะ อปท. ส่วนใหญ่
--      มีผู้มีอำนาจอนุมัติคนเดียว ใช้วิธีติดธง self_approved ใน audit log แทนการห้าม
--   3. driver_id ต้องเป็นคนใน อปท. เดียวกัน — FK ชี้ profiles(id) เฉยๆ ไม่ได้ผูก tenant
--      ยังไม่บังคับว่าต้องอยู่ใน fleet_drivers เพราะจะทำให้แก้ทริปเก่าไม่ได้ทั้งหมด
--   4. บันทึกออก/กลับ เพิ่มสิทธิ์ให้ผู้ขอตัวจริง (requested_by) นอกเหนือจากผู้ขับและผู้บันทึก

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'fleet_trips'
       AND column_name = 'requested_by'
  ) THEN
    RAISE EXCEPTION 'ต้องรัน 20260903120000 และ 20260903140000 ก่อน';
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
  v_driver_municipality uuid;
  v_old_requester uuid;
  v_new_requester uuid;
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

  -- ผู้ขับต้องเป็นคนในสังกัดเดียวกับทริป (FK ยืนยันแค่ว่าโปรไฟล์มีอยู่จริง)
  -- ตรวจเฉพาะตอนที่ค่าเปลี่ยน เพื่อไม่ให้ทริปเก่าที่ข้อมูลเพี้ยนอยู่แล้วแก้ไขไม่ได้เลย
  IF NEW.driver_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.driver_id IS DISTINCT FROM OLD.driver_id) THEN
    SELECT municipality_id INTO v_driver_municipality
    FROM public.profiles WHERE id = NEW.driver_id;
    IF v_driver_municipality IS NULL OR v_driver_municipality <> NEW.municipality_id THEN
      RAISE EXCEPTION 'FLEET_TRIP_DRIVER_OUTSIDE_TENANT';
    END IF;
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
    -- ทริปที่สร้างก่อนมีคอลัมน์ requested_by จะเป็น NULL ถอยไปใช้ created_by
    v_old_requester := coalesce(OLD.requested_by, OLD.created_by);
    v_new_requester := coalesce(NEW.requested_by, NEW.created_by);

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

    -- หมายเหตุ: ตั้งใจ "ไม่" บล็อกการอนุมัติคำขอของตัวเอง
    -- ตามหลักควบคุมภายใน ผู้อนุมัติควรเป็นคนละคนกับผู้ขอ แต่ อปท. ส่วนใหญ่มีผู้มีอำนาจ
    -- อนุมัติคนเดียว (และคนนั้นก็ต้องขอใช้รถเองด้วย) ถ้าบล็อกที่ DB คำขอจะค้างไม่มีทางออก
    -- จึงใช้วิธี "บันทึกให้เห็น" แทน "ห้าม" — ฝั่งแอปติดธง self_approved ลง audit log
    -- ทุกครั้งที่ผู้อนุมัติกับผู้ขอเป็นคนเดียวกัน เพื่อให้ตรวจสอบย้อนหลังได้
    -- ถ้าภายหลังต้องการบังคับจริง ให้เพิ่ม RAISE ที่ตรงนี้ โดยเทียบ
    -- auth.uid() IN (OLD.created_by, v_old_requester)

    -- ยกเลิกคำขอ = ผู้ขอตัวจริง ผู้บันทึกแทน หรือผู้ดูแลสั่งยกเลิก
    -- คนอื่นในกองยกเลิกแทนไม่ได้
    IF NEW.status = 'cancelled'
       AND NOT v_is_manager
       AND auth.uid() IS DISTINCT FROM OLD.created_by
       AND auth.uid() IS DISTINCT FROM v_old_requester THEN
      RAISE EXCEPTION 'FLEET_TRIP_CANCEL_REQUIRES_OWNER';
    END IF;

    IF NEW.status IN ('in_progress', 'completed')
       AND NOT v_is_manager
       AND auth.uid() IS DISTINCT FROM NEW.driver_id
       AND auth.uid() IS DISTINCT FROM NEW.created_by
       AND auth.uid() IS DISTINCT FROM v_new_requester THEN
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
