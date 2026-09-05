-- ผ่อน "บันทึกการใช้รถย้อนหลังต้องมีเหตุผลกำกับ" จากบังคับ → ไม่บังคับ
-- ตามคำสั่งผู้ใช้ 2026-09-05 (ยอมรับความเสี่ยงหลังแจ้งแล้วว่าเดิมเป็นกลไก audit
-- กันบันทึก "เสร็จสิ้น" ที่ข้ามขั้นอนุมัติแล้วไม่มีคำอธิบาย ซึ่งอาจถูก สตง./ป.ป.ช.
-- ตรวจสอบการใช้รถราชการได้ในอนาคต)
--
-- ⚠️ ก่อน apply ต้องยืนยันว่า body บน production ตรงกับ 20260903150000 จริง:
--     SELECT md5(prosrc) FROM pg_proc WHERE proname = 'fleet_guard_trip_write';
--   ค่าที่ตรวจไว้ ณ 2026-09-06 คือ 3cd6b7e379ce24e1a7ca37d40ff3ef05 (ตรง byte-for-byte)
--   โปรเจกต์นี้เคยมี schema drift ถ้าค่าเปลี่ยนไปจากนี้ ให้หยุดและซ่อม drift ก่อน
--
-- ⚠️ body ด้านล่างคัดมาจาก 20260903150000_fleet_trip_cancel_and_self_approval_guard.sql
--   ครบทุกบรรทัด แล้วตัดเฉพาะ IF บังคับเหตุผลออก ห้ามใส่ placeholder เด็ดขาด
--
-- ที่เปลี่ยน: ตัดเงื่อนไข "backdated_reason ห้ามว่าง" ออก — ยังคงจำกัดให้เฉพาะ
-- ผู้ดูแลระบบยานพาหนะ (FLEET_TRIP_BACKDATED_REQUIRES_MANAGER) เหมือนเดิมทุกประการ
-- คอลัมน์ backdated_reason ยังมี CHECK ที่ตารางกำกับอยู่ว่า "ถ้ากรอกต้องยาว 5-500
-- ตัวอักษร" (fleet_trips_backdated_reason_length_check, ดู 20260902190000) — CHECK นี้
-- ยอมให้เป็น NULL อยู่แล้ว จึงไม่ต้องแก้ แต่ฝั่ง client ต้องส่ง NULL ไม่ใช่ '' ตอนเว้นว่าง
-- ไม่งั้นจะชน CHECK นี้แทน (เปลี่ยนจาก error message เดิมเป็น constraint violation ดิบ)

DO $guard$
DECLARE
  v_hash text;
BEGIN
  SELECT md5(prosrc) INTO v_hash FROM pg_proc WHERE proname = 'fleet_guard_trip_write';
  IF v_hash IS DISTINCT FROM '3cd6b7e379ce24e1a7ca37d40ff3ef05' THEN
    RAISE EXCEPTION 'schema drift: fleet_guard_trip_write body ไม่ตรงกับที่คาดไว้ (hash=%), ต้องตรวจก่อน apply', v_hash;
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
  -- จำกัดให้เฉพาะผู้ดูแลระบบยานพาหนะเท่านั้นที่ทำได้ — เหตุผลกำกับเปลี่ยนเป็น "ไม่บังคับ"
  -- แล้ว (เดิมบังคับห้ามว่าง) ตามคำสั่งผู้ใช้ 2026-09-05 ยอมรับความเสี่ยงว่าอาจมีบันทึก
  -- ย้อนหลังที่ไม่มีคำอธิบายกำกับ — ถ้ากรอกมา ยังต้องผ่าน CHECK ที่ตาราง (5-500 ตัวอักษร)
  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL AND NEW.status = 'completed' THEN
    IF NOT public.fleet_is_manager(NEW.municipality_id) THEN
      RAISE EXCEPTION 'FLEET_TRIP_BACKDATED_REQUIRES_MANAGER';
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
