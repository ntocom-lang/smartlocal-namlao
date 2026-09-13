-- เฟส 3/3 ของการอนุมัติคำขอใช้รถอัตโนมัติ (ต้องรัน 20260913140000 และ 20260913140100 ก่อน)
--
-- ⚠️ body เดิมคัดจาก production ด้วย pg_get_functiondef (2026-09-13) แล้วเติมของใหม่
--   DO block หยุด migration ถ้า body บน production ไม่ตรงกับที่คัดมา
--
-- ที่เปลี่ยน
--   1. คำขอใหม่ที่ส่งมาเป็น pending ให้ระบบตัดสินคิวเอง ภายใต้ล็อกแถวรถเดิม (FOR UPDATE)
--      - รถว่าง  → approved ทันที, approval_method = auto, approved_by = NULL
--      - คิวชน   → waitlisted ("รอจัดสรรรถ") แทนการ RAISE ให้ผู้ดูแลเปลี่ยนรถ/เวลา
--      approved_by ต้องเป็น NULL เพราะไม่มีคนอนุมัติ ถ้าใส่ auth.uid() จะกลายเป็น "ผู้ขออนุมัติตัวเอง"
--      และใบแบบ 3 จะติ๊กช่อง "อนุมัติ" ให้เอง ([fleetTripPrint.js] ติ๊กเมื่อมี approved_by)
--      ปล่อย NULL ช่องนั้นจะเว้นว่างให้ผู้มีอำนาจติ๊กและลงนามบนกระดาษตามเดิม
--   2. UPDATE ที่ย้ายจากสถานะที่ไม่กินคิว (waitlisted) เข้าสถานะที่กินคิว ต้องตรวจคิวใหม่
--      แม้รถและเวลาไม่เปลี่ยน — เดิมข้ามการตรวจเมื่อรถ/เวลาไม่เปลี่ยน ถ้าไม่แก้ ผู้ดูแลกดอนุมัติ
--      รายการรอจัดสรรรถได้ทันทีทั้งที่คิวยังชนอยู่ = รถคันเดียวถูกอนุมัติให้สองคนพร้อมกัน
--   UPDATE และสถานะอื่นยัง RAISE 23P01 เหมือนเดิมทุกประการ
--
-- ⚠️ พึ่งลำดับ trigger: BEFORE trigger ของตารางเดียวกันรันตามลำดับชื่อ
--   trg_fleet_guard_trip_write → trg_fleet_trip_requester_snapshot → trg_fleet_trips_guard_overlap
--   guard รันก่อนตอนสถานะยังเป็น pending จึงไม่เติม approved_by/approval_method ให้
--   ถ้าเปลี่ยนชื่อ trigger ตัวใดตัวหนึ่ง การอนุมัติอัตโนมัติจะเพี้ยนแบบเงียบ
--   (มีเทสต์ใน tests/fleet-workflow.playwright.mjs คุมไว้)
--
-- แถว pending ที่มีอยู่ก่อน migration นี้ไม่ถูกแตะ ผู้ดูแลกดอนุมัติเองตามเดิม

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

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'fleet_guard_trip_write'
       AND position('FLEET_TRIP_INSERT_STATUS_REQUIRES_MANAGER' in prosrc) > 0
  ) THEN
    RAISE EXCEPTION 'ต้องรัน 20260913140100 ก่อน (ต้องปิดช่อง insert approved ตรงๆ ก่อนเปิดอนุมัติอัตโนมัติ)';
  END IF;

  SELECT md5(prosrc) INTO v_hash FROM pg_proc WHERE proname = 'fleet_trips_guard_overlap';
  IF v_hash IS DISTINCT FROM 'f4b749b868aed72b7f68470231647c86' THEN
    RAISE EXCEPTION 'schema drift: fleet_trips_guard_overlap body ไม่ตรงกับที่คาดไว้ (hash=%), ต้องตรวจก่อน apply', v_hash;
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.fleet_trips_guard_overlap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conflict record;
  v_auto_decide boolean;
BEGIN
  -- [ใหม่ 2026-09-13] คำขอใหม่ที่ส่งมาเป็น pending = ให้ระบบตัดสินคิวเอง
  v_auto_decide := TG_OP = 'INSERT' AND NEW.status = 'pending';

  -- สนใจเฉพาะสถานะที่ยังกินคิวรถอยู่จริง (cancelled/rejected/completed ไม่กินคิว)
  -- waitlisted ก็ไม่กินคิว — เป็นคำขอที่ชนคิวอยู่แล้ว ไม่งั้นจะไปบล็อกคิวของคนที่ได้รถไปแล้วซ้ำ
  IF NEW.status NOT IN ('pending', 'approved', 'in_progress') THEN
    RETURN NEW;
  END IF;

  -- บันทึกย้อนหลัง (บันทึกการเดินทาง) ไม่มีช่วงเวลาจอง — ไม่มีอะไรให้ชน
  IF NEW.planned_departure IS NULL OR NEW.planned_return IS NULL THEN
    RETURN NEW;
  END IF;

  -- UPDATE ที่ไม่ได้แตะรถหรือช่วงเวลา (อนุมัติ/ปฏิเสธ/ออกเดินทาง/กลับถึง) ให้ผ่านเสมอ
  -- ไม่งั้นข้อมูลเก่าที่ทับซ้อนกันอยู่ก่อนมี trigger นี้จะอนุมัติไม่ได้เลย
  -- [ใหม่ 2026-09-13] ยกเว้นเมื่อสถานะเดิมไม่ได้กินคิว (waitlisted) — ต้องตรวจคิวใหม่เสมอ
  IF TG_OP = 'UPDATE'
     AND OLD.status IN ('pending', 'approved', 'in_progress')
     AND NEW.vehicle_id        IS NOT DISTINCT FROM OLD.vehicle_id
     AND NEW.planned_departure IS NOT DISTINCT FROM OLD.planned_departure
     AND NEW.planned_return    IS NOT DISTINCT FROM OLD.planned_return
  THEN
    RETURN NEW;
  END IF;

  -- ล็อกแถวรถ: คำขอจองรถคันเดียวกันจะถูกบังคับให้เข้าคิวทีละราย ปิดช่อง race
  -- การตัดสินอนุมัติอัตโนมัติอยู่ภายใต้ล็อกเดียวกัน คำขอสองรายการที่ยื่นพร้อมกันจึงได้รถ
  -- แค่รายการเดียว อีกรายการจะเห็นคิวของรายการแรกแล้วตกเป็น waitlisted
  PERFORM 1 FROM public.fleet_vehicles WHERE id = NEW.vehicle_id FOR UPDATE;

  SELECT t.id, t.planned_departure, t.planned_return
    INTO v_conflict
  FROM public.fleet_trips t
  WHERE t.vehicle_id = NEW.vehicle_id
    AND t.id <> NEW.id
    AND t.status IN ('pending', 'approved', 'in_progress')
    AND t.planned_departure IS NOT NULL
    AND t.planned_return    IS NOT NULL
    AND tstzrange(t.planned_departure, t.planned_return, '[)')
        && tstzrange(NEW.planned_departure, NEW.planned_return, '[)')
  LIMIT 1;

  IF FOUND THEN
    IF v_auto_decide THEN
      -- ไม่ RAISE: เก็บคำขอไว้ให้ผู้ดูแลจัดสรรรถ ฝั่งแอปแจ้ง Telegram (fleet_trip_waitlisted)
      NEW.status := 'waitlisted';
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'รถคันนี้ถูกจองช่วง % ถึง % ไว้แล้ว กรุณาเปลี่ยนเวลาหรือเลือกรถคันอื่น',
      to_char(v_conflict.planned_departure AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI'),
      to_char(v_conflict.planned_return    AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI')
      USING ERRCODE = '23P01';
  END IF;

  IF v_auto_decide THEN
    NEW.status := 'approved';
    NEW.approved_at := now();
    NEW.approved_by := NULL;
    NEW.approval_method := 'auto';
  END IF;

  RETURN NEW;
END;
$function$;
