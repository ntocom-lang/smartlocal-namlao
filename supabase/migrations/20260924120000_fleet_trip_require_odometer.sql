-- บังคับเลขไมล์ตอนทริปเปลี่ยนเป็น "ออกเดินทาง" และ "เสร็จสิ้น" — กันโซ่เลขไมล์ขาด
--
-- เหตุการณ์จริง น้ำเลา 2569-09-24 (รถ กค 9700): บันทึกกลับถึงโดยไม่มีเลขไมล์หลังกลับ
-- fleet_vehicle_last_odometer (#170) ข้ามทริปที่ไม่มีเลขกลับ ทริปถัดไปจึงได้เลขของทริปก่อนหน้านั้น
-- (ซ้ำกับเลขออกของรอบเช้า) เจ้าหน้าที่เห็นว่า "เลขไมล์ไม่รันออโต้" และระยะทางของ 2 ทริปบนแบบ 4 ผิด
-- ช่องเลขไมล์ทั้งตอนออกและตอนกลับเดิมไม่บังคับ — หน้าเว็บบังคับแล้วในรอบเดียวกันนี้ แต่ต้องกันที่ DB ด้วย
-- เพราะแอปเป็น PWA เครื่องที่ยังเปิดหน้าเว็บรุ่นเก่าค้างไว้จะบันทึกช่องว่างได้ต่อจนกว่าจะอัปเดต
--
-- กติกา (ตรวจเฉพาะตอน "เข้า" สถานะ หรือตอนลบค่าที่มีอยู่แล้ว):
--   · เลขไมล์ก่อนออก: ต้องมีเมื่อเข้า in_progress และเมื่อเข้า completed โดยไม่ผ่านขั้นออกเดินทาง
--     (บันทึกย้อนหลัง = INSERT เป็น completed ตรงๆ)
--   · เลขไมล์หลังกลับ: ต้องมีเมื่อเข้า completed
--   · แถวที่เป็น in_progress/completed อยู่แล้ว ห้ามแก้เลขที่มีอยู่ให้กลายเป็นค่าว่าง
-- ข้อยกเว้นโดยเจตนา:
--   · แถวเก่าที่ว่างอยู่แล้วและไม่ได้เปลี่ยนสถานะ (เช่นแก้หมายเหตุ) แก้ได้ตามเดิม ไม่ทำให้งานเก่าติด
--   · ทริปที่ออกเดินทางไปแล้วโดยไม่มีเลขออก (ก่อนมีด่านนี้) ยังปิดทริปได้ด้วยเลขกลับอย่างเดียว
--     ไม่งั้นเป็นทางตัน เพราะหน้าบันทึกกลับไม่มีช่องให้เติมเลขออกของทริปแบบนั้น
--
-- ชื่อ trigger เรียงตามตัวอักษรอยู่หลัง trg_fleet_guard_trip_write (ตรวจสิทธิ์/สถานะก่อน)
-- และก่อน trg_fleet_trips_guard_overlap — ไม่พึ่งค่าที่ trigger อื่นเติม จึงไม่ผูกกับลำดับ

CREATE OR REPLACE FUNCTION public.fleet_trip_require_odometer()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_entering boolean;
  v_from_in_progress boolean;
BEGIN
  IF NEW.status NOT IN ('in_progress', 'completed') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_entering := true;
    v_from_in_progress := false;
  ELSE
    v_entering := OLD.status IS DISTINCT FROM NEW.status;
    v_from_in_progress := OLD.status = 'in_progress';
  END IF;

  IF NEW.odometer_start IS NULL AND (
       (v_entering AND NOT (NEW.status = 'completed' AND v_from_in_progress))
    OR (TG_OP = 'UPDATE' AND OLD.odometer_start IS NOT NULL)
  ) THEN
    -- ข้อความต่อท้ายรหัสเป็นภาษาไทย เพราะหน้าเว็บรุ่นเก่าที่ยังค้างในเครื่อง (PWA) แสดง error ดิบ
    -- หน้าเว็บรุ่นใหม่จับรหัสแล้วแปลเอง (TRIP_ERROR_TH ใน FleetTrips.jsx)
    RAISE EXCEPTION 'FLEET_TRIP_ODOMETER_START_REQUIRED: กรุณากรอกเลขไมล์ก่อนออก'
      USING ERRCODE = '23502';
  END IF;

  IF NEW.status = 'completed' AND NEW.odometer_end IS NULL AND (
       v_entering
    OR (TG_OP = 'UPDATE' AND OLD.odometer_end IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'FLEET_TRIP_ODOMETER_END_REQUIRED: กรุณากรอกเลขไมล์หลังกลับ'
      USING ERRCODE = '23502';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fleet_trip_require_odometer() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_fleet_trip_require_odometer ON public.fleet_trips;
CREATE TRIGGER trg_fleet_trip_require_odometer
  BEFORE INSERT OR UPDATE ON public.fleet_trips
  FOR EACH ROW EXECUTE FUNCTION public.fleet_trip_require_odometer();
