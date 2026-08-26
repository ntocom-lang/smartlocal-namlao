-- 20260828130000_fleet_trip_overlap_guard_and_atomic_override.sql
--
-- แก้ 2 ช่องโหว่ของระบบจองรถที่ตรวจพบตอน audit ก่อนเปิดใช้งานจริง
--
-- [1] จองรถชนกันได้จริงแม้ UI จะเช็คแล้ว (TOCTOU race)
--     เดิมการกันจองซ้ำอยู่ฝั่ง client ล้วน (findVehicleConflicts ใน FleetTrips.jsx)
--     เป็นรูปแบบ check-then-insert ที่ไม่มี lock — เจ้าหน้าที่สองคนกด "ส่งคำขอจอง"
--     รถคันเดียวกันช่วงเวลาเดียวกันพร้อมกัน ต่างคนต่างผ่านการเช็ค แล้ว insert สำเร็จทั้งคู่
--     ยิ่งกว่านั้น RLS ทำให้ client มองไม่เห็นการจองของกองอื่นบนรถส่วนกลาง (is_pool)
--     การเช็คฝั่ง client จึงพลาดการชนคิวข้ามกองตั้งแต่ต้นอยู่แล้ว
--
--     แก้ด้วย trigger ฝั่ง DB ที่ล็อกแถวรถ (FOR UPDATE) ก่อนสแกนช่วงเวลาทับซ้อน
--     บังคับให้คำขอจองรถคันเดียวกันเข้าคิวทีละราย และเป็น SECURITY DEFINER เพื่อให้
--     มองเห็นการจองทุกกอง ไม่ถูก RLS บังหน้า
--
--     เลือก trigger แทน EXCLUDE constraint เพราะ EXCLUDE จะสร้างไม่สำเร็จถ้ามีข้อมูลเดิม
--     ที่ทับซ้อนกันอยู่แล้ว (ยืนยันไม่ได้ในตอนเขียน) — trigger บังคับเฉพาะรายการใหม่
--     ของเดิมยังอยู่ให้ผู้ดูแลตามเคลียร์เองได้ ไม่บล็อกการ deploy
--
-- [2] "จองแทนที่ฉุกเฉิน" ไม่ atomic
--     เดิม FleetTrips.submitOverrideReserve ยิง 2 คำสั่งแยกกันจาก client:
--     UPDATE (ยกเลิกการจองเดิม) แล้วค่อย INSERT (สร้างการจองใหม่)
--     ถ้า INSERT พัง (เน็ตหลุด/RLS/validation) การจองเดิมถูกยกเลิกไปแล้วโดยไม่มีตัวแทน
--     = เจ้าหน้าที่เสียคิวรถฟรีๆ ไม่มีทาง rollback
--
--     แก้ด้วย RPC เดียวที่ทำทั้งสองอย่างใน transaction เดียว + เช็คสิทธิ์ที่ฝั่ง DB
--     (เดิมเช็คแค่ isAdmin ฝั่ง client ซึ่ง bypass ได้) + บันทึก approved_at ให้ครบ

-- ── 1. Trigger กันจองซ้อนช่วงเวลา ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fleet_trips_guard_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_conflict record;
BEGIN
  -- สนใจเฉพาะสถานะที่ยังกินคิวรถอยู่จริง (cancelled/rejected/completed ไม่กินคิว)
  IF NEW.status NOT IN ('pending', 'approved', 'in_progress') THEN
    RETURN NEW;
  END IF;

  -- บันทึกย้อนหลัง (บันทึกการเดินทาง) ไม่มีช่วงเวลาจอง — ไม่มีอะไรให้ชน
  IF NEW.planned_departure IS NULL OR NEW.planned_return IS NULL THEN
    RETURN NEW;
  END IF;

  -- UPDATE ที่ไม่ได้แตะรถหรือช่วงเวลา (อนุมัติ/ปฏิเสธ/ออกเดินทาง/กลับถึง) ให้ผ่านเสมอ
  -- ไม่งั้นข้อมูลเก่าที่ทับซ้อนกันอยู่ก่อนมี trigger นี้จะอนุมัติไม่ได้เลย
  IF TG_OP = 'UPDATE'
     AND NEW.vehicle_id        IS NOT DISTINCT FROM OLD.vehicle_id
     AND NEW.planned_departure IS NOT DISTINCT FROM OLD.planned_departure
     AND NEW.planned_return    IS NOT DISTINCT FROM OLD.planned_return
  THEN
    RETURN NEW;
  END IF;

  -- ล็อกแถวรถ: คำขอจองรถคันเดียวกันจะถูกบังคับให้เข้าคิวทีละราย ปิดช่อง race
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
    RAISE EXCEPTION 'รถคันนี้ถูกจองช่วง % ถึง % ไว้แล้ว กรุณาเปลี่ยนเวลาหรือเลือกรถคันอื่น',
      to_char(v_conflict.planned_departure AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI'),
      to_char(v_conflict.planned_return    AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI')
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_fleet_trips_guard_overlap ON public.fleet_trips;
CREATE TRIGGER trg_fleet_trips_guard_overlap
  BEFORE INSERT OR UPDATE ON public.fleet_trips
  FOR EACH ROW EXECUTE FUNCTION public.fleet_trips_guard_overlap();

-- ── 2. RPC จองแทนที่ฉุกเฉินแบบ atomic ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fleet_override_booking(
  p_municipality_id   uuid,
  p_vehicle_id        uuid,
  p_driver_id         uuid,
  p_department_id     uuid,
  p_planned_departure timestamptz,
  p_planned_return    timestamptz,
  p_destination       text,
  p_purpose           text,
  p_reason            text
)
RETURNS TABLE(new_trip_id uuid, bumped_ids uuid[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_new_id uuid;
  v_bumped uuid[];
  v_actor  text;
  v_note   text;
BEGIN
  -- สิทธิ์จองแทนที่ = ผู้ดูแลเท่านั้น เช็คที่ DB ไม่ใช่แค่ซ่อนปุ่มฝั่ง client
  IF NOT public.fleet_is_manager(p_municipality_id) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์จองแทนที่ฉุกเฉิน' USING ERRCODE = '42501';
  END IF;

  -- เหตุผลเป็นหลักฐานประกอบการยกเลิกคิวของผู้อื่น ต้องมีเสมอ (ตรวจสอบย้อนหลังได้)
  IF coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'ต้องระบุเหตุผลความจำเป็นเร่งด่วน' USING ERRCODE = '22023';
  END IF;
  IF p_planned_departure IS NULL OR p_planned_return IS NULL
     OR p_planned_return <= p_planned_departure THEN
    RAISE EXCEPTION 'ช่วงเวลาไม่ถูกต้อง: เวลากลับต้องหลังเวลาออก' USING ERRCODE = '22023';
  END IF;
  IF coalesce(btrim(p_destination), '') = '' OR coalesce(btrim(p_purpose), '') = '' THEN
    RAISE EXCEPTION 'ต้องระบุปลายทางและวัตถุประสงค์' USING ERRCODE = '22023';
  END IF;

  -- ล็อกรถก่อนแตะข้อมูล กัน override สองรายชนกันเอง
  PERFORM 1 FROM public.fleet_vehicles
   WHERE id = p_vehicle_id AND municipality_id = p_municipality_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบยานพาหนะในสังกัดนี้' USING ERRCODE = '23503';
  END IF;

  -- ฟังก์ชันนี้เป็น SECURITY DEFINER จึงข้าม RLS — ต้องกันข้ามสังกัดเองที่นี่
  -- (FK ยืนยันแค่ว่ากองมีอยู่จริง ไม่ได้ยืนยันว่าเป็นกองของ อปท. นี้)
  IF p_department_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.departments
     WHERE id = p_department_id AND municipality_id = p_municipality_id
  ) THEN
    RAISE EXCEPTION 'กอง/หน่วยงานไม่อยู่ในสังกัดนี้' USING ERRCODE = '23503';
  END IF;

  SELECT full_name INTO v_actor FROM public.profiles WHERE id = auth.uid();
  v_note := '[จองแทนที่ฉุกเฉินโดย ' || coalesce(nullif(btrim(v_actor), ''), 'ผู้ดูแลระบบ') || '] '
            || btrim(p_reason);

  -- ยกเลิกคิวที่ทับซ้อน แล้วสร้างคิวใหม่ใน transaction เดียวกัน
  -- INSERT พังเมื่อไหร่ UPDATE ข้างบน rollback ตามทันที ไม่มีทางเสียคิวฟรี
  WITH bumped AS (
    UPDATE public.fleet_trips t
       SET status = 'cancelled', reject_reason = v_note
     WHERE t.vehicle_id      = p_vehicle_id
       AND t.municipality_id = p_municipality_id
       AND t.status IN ('pending', 'approved')
       AND t.planned_departure IS NOT NULL
       AND t.planned_return    IS NOT NULL
       AND tstzrange(t.planned_departure, t.planned_return, '[)')
           && tstzrange(p_planned_departure, p_planned_return, '[)')
    RETURNING t.id
  )
  SELECT coalesce(array_agg(id), '{}'::uuid[]) INTO v_bumped FROM bumped;

  INSERT INTO public.fleet_trips (
    municipality_id, vehicle_id, driver_id, created_by, department_id,
    trip_date, planned_departure, planned_return, destination, purpose,
    status, approved_by, approved_at, notes
  ) VALUES (
    p_municipality_id, p_vehicle_id, coalesce(p_driver_id, auth.uid()), auth.uid(), p_department_id,
    (p_planned_departure AT TIME ZONE 'Asia/Bangkok')::date,
    p_planned_departure, p_planned_return, btrim(p_destination), btrim(p_purpose),
    'approved', auth.uid(), now(), v_note
  )
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT v_new_id, v_bumped;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.fleet_override_booking(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fleet_override_booking(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, text, text, text
) TO authenticated;
