-- เฟส 2/3 ของการอนุมัติคำขอใช้รถอัตโนมัติ (ต้องรัน 20260913140000 ก่อน)
--
-- ⚠️ body ด้านล่างคัดจาก production ด้วย pg_get_functiondef ครบทุกบรรทัด (2026-09-13)
--   แล้วเติมของใหม่ ห้ามใส่ placeholder เด็ดขาด (บทเรียนจาก 20260829120000)
--   DO block ด้านล่างหยุด migration ทันทีถ้า body บน production ไม่ตรงกับที่คัดมา
--
-- ที่เพิ่ม
--   1. ปิดช่องโหว่: ผู้ใช้ที่ไม่ใช่ผู้ดูแลสร้างทริปได้แค่สถานะ draft/pending
--      เดิม policy fleet_trips_insert ไม่ตรวจสถานะ และ guard ตรวจสิทธิ์อนุมัติเฉพาะตอน UPDATE
--      fleet_staff จึงยิง insert ที่ status = 'approved' ตรงผ่าน API แล้วข้ามขั้นอนุมัติได้
--      ต้องปิดก่อนเปิดอนุมัติอัตโนมัติ ไม่งั้นการที่ client ได้รายการ approved กลับไป
--      จะแยกไม่ออกว่าระบบตัดสินหรือ client ปลอมมา
--      ทางสร้างทริปที่มีอยู่ไม่พัง: ยื่นคำขอส่ง pending · บันทึกย้อนหลังส่ง completed (ผู้ดูแลเท่านั้น
--      มีด่านของตัวเองอยู่แล้ว) · fleet_override_booking ส่ง approved (ผู้ดูแลเท่านั้น)
--   2. สถานะ waitlisted ("รอจัดสรรรถ") ย้ายไป approved / rejected / cancelled ได้
--      อนุมัติ/ปฏิเสธต้องเป็นผู้ดูแล ยกเลิกใช้กติกาเจ้าของคำขอเดิม
--   3. approval_method ไม่รับค่าจาก client เลย — กดอนุมัติ = manual เสมอ ส่วน auto ตั้งได้ที่
--      fleet_trips_guard_overlap ที่เดียว (trigger นั้นรันหลังตัวนี้ เพราะ BEFORE trigger
--      เรียงตามชื่อ trg_fleet_guard_trip_write < trg_fleet_trips_guard_overlap)
--      ถ้าไม่ล็อก ผู้ดูแลที่กดอนุมัติเองจะส่ง 'auto' มาปลอมว่าระบบเป็นคนอนุมัติได้

DO $guard$
DECLARE
  v_hash text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'fleet_trips' AND column_name = 'approval_method'
  ) THEN
    RAISE EXCEPTION 'ต้องรัน 20260913140000 ก่อน';
  END IF;

  SELECT md5(prosrc) INTO v_hash FROM pg_proc WHERE proname = 'fleet_guard_trip_write';
  IF v_hash IS DISTINCT FROM '235b676b0fca11673baa0034b7540e3e' THEN
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

  -- [ใหม่ 2026-09-13] สร้างทริปด้วยสถานะอื่นนอกจาก draft/pending ต้องเป็นผู้ดูแล
  -- (completed มีด่านของตัวเองข้างบนพร้อมข้อความเฉพาะ จึงไม่นับซ้ำที่นี่)
  -- คำขอปกติส่ง pending แล้วให้ fleet_trips_guard_overlap ตัดสินเป็น approved/waitlisted
  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL
     AND NEW.status NOT IN ('draft', 'pending', 'completed')
     AND NOT public.fleet_is_manager(NEW.municipality_id) THEN
    RAISE EXCEPTION 'FLEET_TRIP_INSERT_STATUS_REQUIRES_MANAGER: %', NEW.status;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    -- ทริปที่สร้างก่อนมีคอลัมน์ requested_by จะเป็น NULL ถอยไปใช้ created_by
    v_old_requester := coalesce(OLD.requested_by, OLD.created_by);
    v_new_requester := coalesce(NEW.requested_by, NEW.created_by);

    IF NOT (
      (OLD.status = 'draft' AND NEW.status IN ('pending', 'cancelled'))
      OR (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected', 'cancelled'))
      -- [ใหม่ 2026-09-13] รอจัดสรรรถ: ผู้ดูแลเปลี่ยนรถ/เวลาแล้วอนุมัติ หรือปฏิเสธ หรือผู้ขอยกเลิกเอง
      -- การอนุมัติจะถูก fleet_trips_guard_overlap ตรวจคิวซ้ำก่อนเสมอ
      OR (OLD.status = 'waitlisted' AND NEW.status IN ('approved', 'rejected', 'cancelled'))
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

  -- [ใหม่ 2026-09-13] approval_method ไม่รับค่าจาก client
  -- กลายเป็น approved ณ ตรงนี้ได้ทางเดียวคือมีคนสั่ง (กดอนุมัติ / จองแทนที่) = manual
  -- ส่วน auto ตั้งภายหลังโดย fleet_trips_guard_overlap ตอน INSERT ที่ส่งมาเป็น pending เท่านั้น
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved') THEN
    NEW.approval_method := 'manual';
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.approval_method := OLD.approval_method;
  ELSE
    NEW.approval_method := NULL;
  END IF;

  RETURN NEW;
END;
$function$;
