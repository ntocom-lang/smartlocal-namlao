-- Overload ใหม่ของ fleet_override_booking รองรับการยื่นคำขอแทนผู้อื่น
-- (ต้องรัน 20260903120000 และ 20260903140000 ก่อน)
--
-- ทำไมต้องมี: ปุ่ม "จองแทนคิวเดิมกรณีฉุกเฉิน" ใช้ฟอร์มเดียวกับการขอใช้รถปกติ ซึ่งตอนนี้
-- เลือกผู้ขอใช้รถได้แล้ว ถ้า RPC ไม่รับ p_requested_by ชื่อที่ผู้ใช้เลือกจะถูกทิ้งเงียบๆ
-- แล้วใบขออนุญาตพิมพ์ชื่อผู้ดูแลที่กดปุ่มแทน = ข้อมูลบนเอกสารไม่ตรงกับที่เห็นบนจอ
--
-- ห่อ overload 13 พารามิเตอร์เดิมไว้เหมือนที่ 20260902180000 ทำ จึงคง transaction
-- การยกเลิกคิวเดิม + สร้างคิวใหม่ไว้ครบ และ client รุ่นเดิมยังเรียก signature เก่าได้
--
-- แถวถูกสร้างเป็น status='approved' ทันที ซึ่ง trigger snapshot ล็อกไม่ให้แก้ requested_by
-- หลังพ้น pending จึงต้องยก flag app.fleet_requester_rpc ก่อน UPDATE (ล้อ app.user_management_rpc)
-- flag เป็น local = หมดผลเมื่อจบ transaction ไม่รั่วไปคำสั่งอื่น

CREATE OR REPLACE FUNCTION public.fleet_override_booking(
  p_municipality_id      uuid,
  p_vehicle_id           uuid,
  p_driver_id            uuid,
  p_department_id        uuid,
  p_planned_departure    timestamptz,
  p_planned_return       timestamptz,
  p_destination          text,
  p_destination_locality text,
  p_destination_province text,
  p_purpose              text,
  p_reason               text,
  p_passengers           smallint,
  p_requester_position   text,
  p_requested_by         uuid
)
RETURNS TABLE(new_trip_id uuid, bumped_ids uuid[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_new_trip_id uuid;
  v_bumped_ids  uuid[];
  v_muni        uuid;
  v_role        text;
BEGIN
  -- ตรวจผู้ขอก่อนแตะข้อมูลใดๆ เพื่อไม่ให้ยกเลิกคิวของคนอื่นทิ้งแล้วมาล้มทีหลัง
  IF p_requested_by IS NOT NULL THEN
    SELECT municipality_id, role INTO v_muni, v_role
    FROM public.profiles WHERE id = p_requested_by;
    IF v_muni IS NULL OR v_muni <> p_municipality_id OR v_role = 'citizen' THEN
      RAISE EXCEPTION 'FLEET_TRIP_REQUESTER_INVALID' USING ERRCODE = '23503';
    END IF;
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
    p_destination_locality,
    p_destination_province,
    p_purpose,
    p_reason,
    p_passengers,
    p_requester_position
  ) AS result;

  IF p_requested_by IS NOT NULL THEN
    PERFORM set_config('app.fleet_requester_rpc', '1', true);

    UPDATE public.fleet_trips
       SET requested_by = p_requested_by
     WHERE id = v_new_trip_id
       AND municipality_id = p_municipality_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ไม่สามารถบันทึกผู้ขอใช้รถได้' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN QUERY SELECT v_new_trip_id, v_bumped_ids;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.fleet_override_booking(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz,
  text, text, text, text, text, smallint, text, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fleet_override_booking(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz,
  text, text, text, text, text, smallint, text, uuid
) TO authenticated;
