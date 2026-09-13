-- เลขไมล์หลังกลับครั้งล่าสุดของรถหนึ่งคัน — ใช้เติมช่อง "เลขไมล์ก่อนออก" ตอนกด 🚀 ออกเดินทาง
--
-- ทำไมต้องเป็น RPC แทนการอ่าน fleet_trips จากหน้าจอ
-- RLS ให้เจ้าหน้าที่เห็นเฉพาะทริปของกองตัวเอง รถส่วนกลาง (is_pool) ที่กองอื่นใช้ครั้งล่าสุด
-- หน้าจอจะมองไม่เห็นทริปนั้น แล้วเติมเลขของทริปเก่ากว่าที่ตัวเองเห็นแทน = เลขไมล์ถอยหลัง
-- ฟังก์ชันนี้เห็นทุกทริปของ อปท. ผู้เรียก แต่คืนแค่เลขไมล์กับวันเวลา ไม่คืนชื่อผู้ใช้/ปลายทาง
--
-- ข้อมูลจริงก่อนทำ (น้ำเลา 2026-09-13): ทริปที่เสร็จแล้ว 40 รายการ เลขไมล์ก่อนออกตรงกับหลังกลับ
-- ครั้งก่อน 39 รายการ อีก 1 รายการกระโดด 7 กม. — ช่องจึงเติมให้แต่ต้องแก้ได้ และหน้าจอเตือนเมื่อ
-- ไม่ต่อเนื่อง (ระยะที่กระโดด = การใช้รถที่ไม่ได้บันทึก ห้ามล็อกให้หายไปเงียบๆ)
--
-- "ล่าสุด" เรียงตามเวลากลับจริง ไม่ใช่ตามค่ามากสุด — บันทึกย้อนหลังที่เพิ่มทีหลังแต่เป็นทริปเก่า
-- ต้องไม่กลายเป็นเลขล่าสุด และเลขที่พิมพ์ผิดหลักครั้งหนึ่งต้องไม่ค้างเป็นค่าสูงสุดตลอดไป

CREATE OR REPLACE FUNCTION public.fleet_vehicle_last_odometer(
  p_vehicle_id uuid,
  p_exclude_trip uuid DEFAULT NULL
)
 RETURNS TABLE(odometer numeric, returned_at timestamptz, trip_date date)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_mun uuid;
  v_role text;
BEGIN
  SELECT f.mun_id, f.frole INTO v_mun, v_role FROM public.my_fleet() f;
  IF v_mun IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'FLEET_ACCESS_DENIED' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.fleet_vehicles v WHERE v.id = p_vehicle_id AND v.municipality_id = v_mun
  ) THEN
    RAISE EXCEPTION 'FLEET_ASSET_TENANT_MISMATCH' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT t.odometer_end, t.returned_at, t.trip_date
      FROM public.fleet_trips t
     WHERE t.vehicle_id = p_vehicle_id
       AND t.municipality_id = v_mun
       AND t.status = 'completed'
       AND t.odometer_end IS NOT NULL
       AND t.id IS DISTINCT FROM p_exclude_trip
     ORDER BY COALESCE(t.returned_at, t.started_at, t.trip_date::timestamptz) DESC NULLS LAST,
              t.created_at DESC
     LIMIT 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.fleet_vehicle_last_odometer(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fleet_vehicle_last_odometer(uuid, uuid) TO authenticated;
