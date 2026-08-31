-- เก็บข้อมูลใบขออนุญาตใช้รถส่วนกลาง (แบบ 3) ให้ตรวจสอบย้อนหลังได้
-- requester_position เป็น snapshot ณ วันยื่น ไม่อ่านตำแหน่งปัจจุบันย้อนหลังแล้วทำให้เอกสารเก่าเปลี่ยน

ALTER TABLE public.fleet_trips
  ADD COLUMN IF NOT EXISTS requester_position text;

COMMENT ON COLUMN public.fleet_trips.requester_position IS
  'Snapshot ตำแหน่งผู้ขอใช้รถ ณ วันที่สร้างรายการ สำหรับใบขออนุญาตใช้รถส่วนกลาง แบบ 3';
COMMENT ON COLUMN public.fleet_trips.passengers IS
  'จำนวนผู้ร่วมเดินทางรวมผู้ขอ แต่ไม่รวมพนักงานขับรถ';

ALTER TABLE public.fleet_trips
  DROP CONSTRAINT IF EXISTS fleet_trips_passengers_range_check;
ALTER TABLE public.fleet_trips
  ADD CONSTRAINT fleet_trips_passengers_range_check
  CHECK (passengers BETWEEN 1 AND 100) NOT VALID;

ALTER TABLE public.fleet_trips
  DROP CONSTRAINT IF EXISTS fleet_trips_requester_position_length_check;
ALTER TABLE public.fleet_trips
  ADD CONSTRAINT fleet_trips_requester_position_length_check
  CHECK (
    requester_position IS NULL
    OR char_length(btrim(requester_position)) BETWEEN 1 AND 200
  ) NOT VALID;

-- ยืนยันตัวผู้ขอจาก auth.uid() และเก็บตำแหน่งจากข้อมูลบุคลากรที่ผู้ใช้แก้เองไม่ได้
-- UPDATE ต้องรักษา snapshot เดิมไว้ เพื่อไม่ให้เอกสารเก่าเปลี่ยนตามตำแหน่งปัจจุบัน
CREATE OR REPLACE FUNCTION public.fleet_set_trip_requester_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_position text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.created_by := OLD.created_by;
    NEW.requester_position := OLD.requester_position;
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    NEW.created_by := auth.uid();
  END IF;

  SELECT coalesce(nullif(btrim(p.job_title), ''), nullif(btrim(pos.name), ''))
    INTO v_position
    FROM public.profiles p
    LEFT JOIN public.positions pos ON pos.id = p.position_id
   WHERE p.id = NEW.created_by
     AND p.municipality_id = NEW.municipality_id;

  NEW.requester_position := coalesce(v_position, nullif(btrim(NEW.requester_position), ''));
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_fleet_trip_requester_snapshot ON public.fleet_trips;
CREATE TRIGGER trg_fleet_trip_requester_snapshot
BEFORE INSERT OR UPDATE OF created_by, requester_position
ON public.fleet_trips
FOR EACH ROW
EXECUTE FUNCTION public.fleet_set_trip_requester_snapshot();

-- overload ใหม่ของ emergency override เพื่อบันทึกผู้โดยสารและตำแหน่งผู้ขอใน transaction เดียวกัน
-- เก็บ signature เดิมไว้ชั่วคราวเพื่อให้ client รุ่นเก่ายังทำงานได้ระหว่าง rollout
CREATE OR REPLACE FUNCTION public.fleet_override_booking(
  p_municipality_id    uuid,
  p_vehicle_id         uuid,
  p_driver_id          uuid,
  p_department_id      uuid,
  p_planned_departure  timestamptz,
  p_planned_return     timestamptz,
  p_destination        text,
  p_purpose            text,
  p_reason             text,
  p_passengers         smallint,
  p_requester_position text
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
  IF NOT public.fleet_is_manager(p_municipality_id) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์จองแทนที่ฉุกเฉิน' USING ERRCODE = '42501';
  END IF;
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
  IF p_passengers IS NULL OR p_passengers NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'จำนวนผู้ร่วมเดินทางต้องอยู่ระหว่าง 1 ถึง 100 คน' USING ERRCODE = '22023';
  END IF;
  IF p_requester_position IS NOT NULL
     AND char_length(btrim(p_requester_position)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'ตำแหน่งผู้ขอต้องมีความยาว 1 ถึง 200 ตัวอักษร' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.fleet_vehicles
   WHERE id = p_vehicle_id AND municipality_id = p_municipality_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบยานพาหนะในสังกัดนี้' USING ERRCODE = '23503';
  END IF;

  IF p_department_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.departments
     WHERE id = p_department_id AND municipality_id = p_municipality_id
  ) THEN
    RAISE EXCEPTION 'กอง/หน่วยงานไม่อยู่ในสังกัดนี้' USING ERRCODE = '23503';
  END IF;

  IF p_driver_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = p_driver_id AND municipality_id = p_municipality_id
  ) THEN
    RAISE EXCEPTION 'ผู้ขับรถ/ผู้ใช้รถไม่อยู่ในสังกัดนี้' USING ERRCODE = '23503';
  END IF;

  SELECT full_name INTO v_actor FROM public.profiles WHERE id = auth.uid();
  v_note := '[จองแทนที่ฉุกเฉินโดย ' || coalesce(nullif(btrim(v_actor), ''), 'ผู้ดูแลระบบ') || '] '
            || btrim(p_reason);

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
    passengers, requester_position, status, approved_by, approved_at, notes
  ) VALUES (
    p_municipality_id, p_vehicle_id, coalesce(p_driver_id, auth.uid()), auth.uid(), p_department_id,
    (p_planned_departure AT TIME ZONE 'Asia/Bangkok')::date,
    p_planned_departure, p_planned_return, btrim(p_destination), btrim(p_purpose),
    p_passengers, nullif(btrim(p_requester_position), ''),
    'approved', auth.uid(), now(), v_note
  )
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT v_new_id, v_bumped;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.fleet_override_booking(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, text, text, text, smallint, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fleet_override_booking(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, text, text, text, smallint, text
) TO authenticated;
