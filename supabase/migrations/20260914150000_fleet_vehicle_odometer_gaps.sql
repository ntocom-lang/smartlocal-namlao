-- ตรวจช่วงเลขไมล์ที่ขาดหายไปทั้งประวัติของรถคันหนึ่ง (ต่อจาก fleet_vehicle_last_odometer
-- ที่บอกได้แค่ "เลขไมล์ล่าสุดตามเวลา" ตัวเดียว) — ใช้ตอนเปิดโมดัล "บันทึกการใช้รถย้อนหลัง"
-- เพื่อโชว์ให้เจ้าหน้าที่เห็นช่องว่างที่มีอยู่จริงในประวัติ ไม่ต้องไปนั่งไล่ดูจากแบบ 4 ที่พิมพ์ออกมาเอง
--
-- ต้องเป็น RPC (query DB) ไม่ใช่คำนวณจากทริปที่โหลดมาบนหน้าจอ — รถส่วนกลางมีทริปจากกองอื่นที่ RLS
-- บังไว้ไม่ให้เห็น ถ้าคำนวณช่องว่างจากรายการที่มองเห็นได้บนจอ อาจไล่พลาดช่องว่างจริงหรือมโนช่องว่างปลอม
-- (เหตุผลเดียวกับที่ fleet_vehicle_last_odometer ต้องถาม DB — ดู #170)
--
-- นิยาม "ช่องว่าง": ทริป "เสร็จสิ้น" สองรายการที่เรียงติดกันตามเวลาที่เกิดขึ้นจริง (เวลากลับ > เวลาออก
-- > วันที่ ตามลำดับ) แต่เลขไมล์ปลายทริปก่อนน้อยกว่าเลขไมล์ต้นทริปหลัง — เลขไมล์เดินหน้าไปแล้วแต่ไม่มี
-- บันทึกใดคั่นกลาง ตรงข้ามกับเลขไมล์ถอยหลัง (เปลี่ยนหน้าปัด/พิมพ์ผิด) ซึ่งมีคำเตือนแยกอยู่แล้วบนหน้าจอ
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fleet_can_read_asset') THEN
    RAISE EXCEPTION 'ไม่พบ fleet_can_read_asset — schema drift ต้องตรวจก่อน apply';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.fleet_vehicle_odometer_gaps(
  p_vehicle_id uuid
)
 RETURNS TABLE(
   gap_start numeric,
   gap_end numeric,
   before_returned_at timestamptz,
   before_trip_date date,
   after_started_at timestamptz,
   after_trip_date date
 )
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_mun uuid;
BEGIN
  SELECT v.municipality_id INTO v_mun FROM public.fleet_vehicles v WHERE v.id = p_vehicle_id;
  IF v_mun IS NULL OR NOT public.fleet_can_read_asset(v_mun, p_vehicle_id) THEN
    RAISE EXCEPTION 'FLEET_ACCESS_DENIED' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    WITH ordered AS (
      SELECT t.odometer_start, t.odometer_end, t.returned_at, t.started_at, t.trip_date,
             COALESCE(t.returned_at, t.started_at, t.trip_date::timestamptz) AS occurred_at
        FROM public.fleet_trips t
       WHERE t.vehicle_id = p_vehicle_id
         AND t.municipality_id = v_mun
         AND t.status = 'completed'
         AND t.odometer_start IS NOT NULL
         AND t.odometer_end IS NOT NULL
    ),
    seq AS (
      SELECT odometer_end AS prev_end, returned_at AS prev_returned_at, trip_date AS prev_trip_date,
             LEAD(odometer_start) OVER (ORDER BY occurred_at) AS next_start,
             LEAD(started_at)     OVER (ORDER BY occurred_at) AS next_started_at,
             LEAD(trip_date)      OVER (ORDER BY occurred_at) AS next_trip_date
        FROM ordered
    )
    SELECT prev_end, next_start, prev_returned_at, prev_trip_date, next_started_at, next_trip_date
      FROM seq
     WHERE next_start IS NOT NULL AND next_start > prev_end
     ORDER BY prev_end;
END;
$function$;

REVOKE ALL ON FUNCTION public.fleet_vehicle_odometer_gaps(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fleet_vehicle_odometer_gaps(uuid) TO authenticated;
