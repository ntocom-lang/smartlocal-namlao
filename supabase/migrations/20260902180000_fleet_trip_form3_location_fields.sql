-- ช่อง "ในท้องที่" และ "จังหวัด" ตามใบขออนุญาตใช้รถส่วนกลาง แบบ 3
-- แยกจาก destination เพื่อให้พิมพ์เอกสารได้ตรงช่องและไม่ต้องเดา/ตัดข้อความย้อนหลัง

ALTER TABLE public.fleet_trips
  ADD COLUMN IF NOT EXISTS destination_locality text,
  ADD COLUMN IF NOT EXISTS destination_province text;

COMMENT ON COLUMN public.fleet_trips.destination_locality IS
  'ท้องที่ของปลายทางตามใบขออนุญาตใช้รถส่วนกลาง แบบ 3';
COMMENT ON COLUMN public.fleet_trips.destination_province IS
  'จังหวัดของปลายทางตามใบขออนุญาตใช้รถส่วนกลาง แบบ 3';

ALTER TABLE public.fleet_trips
  DROP CONSTRAINT IF EXISTS fleet_trips_destination_locality_length_check;
ALTER TABLE public.fleet_trips
  ADD CONSTRAINT fleet_trips_destination_locality_length_check
  CHECK (
    destination_locality IS NULL
    OR char_length(btrim(destination_locality)) BETWEEN 1 AND 200
  ) NOT VALID;

ALTER TABLE public.fleet_trips
  DROP CONSTRAINT IF EXISTS fleet_trips_destination_province_length_check;
ALTER TABLE public.fleet_trips
  ADD CONSTRAINT fleet_trips_destination_province_length_check
  CHECK (
    destination_province IS NULL
    OR char_length(btrim(destination_province)) BETWEEN 1 AND 100
  ) NOT VALID;

-- Overload ใหม่ห่อฟังก์ชันเดิมไว้ จึงคง transaction การยกเลิกคิวเดิมและสร้างคิวใหม่
-- พร้อมรองรับ client รุ่นเดิมที่ยังเรียก signature 11 parameters
CREATE OR REPLACE FUNCTION public.fleet_override_booking(
  p_municipality_id     uuid,
  p_vehicle_id          uuid,
  p_driver_id           uuid,
  p_department_id       uuid,
  p_planned_departure   timestamptz,
  p_planned_return      timestamptz,
  p_destination         text,
  p_destination_locality text,
  p_destination_province text,
  p_purpose             text,
  p_reason              text,
  p_passengers          smallint,
  p_requester_position  text
)
RETURNS TABLE(new_trip_id uuid, bumped_ids uuid[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_new_trip_id uuid;
  v_bumped_ids uuid[];
BEGIN
  IF coalesce(btrim(p_destination_locality), '') = '' THEN
    RAISE EXCEPTION 'ต้องระบุท้องที่ของปลายทาง' USING ERRCODE = '22023';
  END IF;
  IF char_length(btrim(p_destination_locality)) > 200 THEN
    RAISE EXCEPTION 'ท้องที่ของปลายทางยาวเกิน 200 ตัวอักษร' USING ERRCODE = '22023';
  END IF;
  IF coalesce(btrim(p_destination_province), '') = '' THEN
    RAISE EXCEPTION 'ต้องระบุจังหวัดของปลายทาง' USING ERRCODE = '22023';
  END IF;
  IF char_length(btrim(p_destination_province)) > 100 THEN
    RAISE EXCEPTION 'จังหวัดของปลายทางยาวเกิน 100 ตัวอักษร' USING ERRCODE = '22023';
  END IF;

  SELECT result.new_trip_id, result.bumped_ids
    INTO v_new_trip_id, v_bumped_ids
  FROM public.fleet_override_booking(
    p_municipality_id,
    p_vehicle_id,
    p_driver_id,
    p_department_id,
    p_planned_departure,
    p_planned_return,
    p_destination,
    p_purpose,
    p_reason,
    p_passengers,
    p_requester_position
  ) AS result;

  UPDATE public.fleet_trips
     SET destination_locality = btrim(p_destination_locality),
         destination_province = btrim(p_destination_province)
   WHERE id = v_new_trip_id
     AND municipality_id = p_municipality_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่สามารถบันทึกท้องที่ของคำขอใช้รถได้' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY SELECT v_new_trip_id, v_bumped_ids;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.fleet_override_booking(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz,
  text, text, text, text, text, smallint, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fleet_override_booking(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz,
  text, text, text, text, text, smallint, text
) TO authenticated;
