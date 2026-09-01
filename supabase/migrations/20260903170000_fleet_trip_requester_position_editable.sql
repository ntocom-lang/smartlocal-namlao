-- ให้เจ้าหน้าที่แก้ "ตำแหน่งผู้ขอใช้รถ" บนใบขออนุญาต (แบบ 3) เองได้
--
-- เดิมตั้งใจล็อกไว้ตาม 20260902170000 โดยให้ trigger เขียนทับด้วยตำแหน่งจากข้อมูลบุคลากร
-- เสมอ เพื่อกันการกรอกตำแหน่งเกินจริงลงเอกสารราชการ แต่หน้างานพบว่า:
--   - job_title/position ในโปรไฟล์ของหลายคนยังไม่ถูกกรอกหรือไม่เป็นปัจจุบัน
--   - กรณีรักษาราชการแทน/ปฏิบัติหน้าที่แทน ตำแหน่งบนเอกสารต่างจากตำแหน่งในทะเบียน
-- ล็อกไว้จึงทำให้พิมพ์เอกสารที่ตำแหน่งผิดออกมาโดยแก้ไม่ได้เลย
--
-- ที่เปลี่ยน: สลับลำดับ coalesce ให้ "ค่าที่ผู้ใช้กรอก" ชนะ และใช้ตำแหน่งจากข้อมูลบุคลากร
-- เป็นค่าตั้งต้นเมื่อผู้ใช้ไม่ได้กรอก (ฝั่งแอปเติมให้อัตโนมัติตอนเลือกผู้ขออยู่แล้ว)
--
-- ที่ยังคงไว้:
--   - หลังคำขอถูกพิจารณาแล้ว (พ้นสถานะ pending) ตำแหน่งล็อกตาย เอกสารที่อนุมัติไปแล้ว
--     ต้องไม่เปลี่ยนย้อนหลัง
--   - created_by ยังบังคับ auth.uid() และห้ามแก้ตลอดกาล
--   - ผู้ขอต้องอยู่ อปท. เดียวกันและไม่ใช่ประชาชนทั่วไป
--   - ความยาว 1-200 ตัวอักษร บังคับด้วย fleet_trips_requester_position_length_check อยู่แล้ว
--
-- ⚠️ body คัดจาก 20260903140000 ครบทุกบรรทัด ห้ามใส่ placeholder

CREATE OR REPLACE FUNCTION public.fleet_set_trip_requester_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_position text;
  v_muni     uuid;
  v_role     text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- ผู้บันทึกรายการเป็นหลักฐานว่าใครกด ห้ามแก้ไม่ว่ากรณีใด
    NEW.created_by := OLD.created_by;

    -- แก้ผู้ขอ/ตำแหน่งได้ตอนคำขอยัง pending หรือเมื่อถูกเรียกจาก fleet_override_booking
    -- ซึ่งสร้างแถวเป็น approved ทันทีแล้วค่อยเติมผู้ขอในขั้นตอนถัดมา
    -- (ล้อ pattern app.user_management_rpc)
    IF OLD.status = 'pending'
       OR coalesce(current_setting('app.fleet_requester_rpc', true), '') = '1' THEN

      IF NEW.requested_by IS NOT NULL
         AND NEW.requested_by IS DISTINCT FROM OLD.requested_by THEN
        SELECT p.municipality_id, p.role,
               coalesce(nullif(btrim(p.job_title), ''), nullif(btrim(pos.name), ''))
          INTO v_muni, v_role, v_position
          FROM public.profiles p
          LEFT JOIN public.positions pos ON pos.id = p.position_id
         WHERE p.id = NEW.requested_by;

        IF v_muni IS NULL OR v_muni <> NEW.municipality_id OR v_role = 'citizen' THEN
          RAISE EXCEPTION 'FLEET_TRIP_REQUESTER_INVALID';
        END IF;
      ELSE
        NEW.requested_by := coalesce(NEW.requested_by, OLD.requested_by);
      END IF;

      -- ค่าที่ผู้ใช้กรอกมาก่อน แล้วจึงตำแหน่งของผู้ขอคนใหม่ แล้วจึงค่าเดิมที่เคยบันทึกไว้
      NEW.requester_position := coalesce(
        nullif(btrim(NEW.requester_position), ''),
        v_position,
        OLD.requester_position
      );
    ELSE
      -- พ้น pending แล้ว = เอกสารถูกพิจารณาไปแล้ว ล็อกทั้งผู้ขอและตำแหน่ง
      NEW.requested_by := OLD.requested_by;
      NEW.requester_position := OLD.requester_position;
    END IF;

    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    NEW.created_by := auth.uid();
  END IF;

  -- ไม่ระบุ = ผู้บันทึกขอใช้รถเอง (พฤติกรรมเดิมก่อนมีฟีเจอร์ยื่นแทน)
  NEW.requested_by := coalesce(NEW.requested_by, NEW.created_by);

  SELECT p.municipality_id, p.role,
         coalesce(nullif(btrim(p.job_title), ''), nullif(btrim(pos.name), ''))
    INTO v_muni, v_role, v_position
    FROM public.profiles p
    LEFT JOIN public.positions pos ON pos.id = p.position_id
   WHERE p.id = NEW.requested_by;

  -- ยื่นแทนคนนอกสังกัดหรือในนามประชาชนทั่วไปไม่ได้
  -- auth.uid() IS NULL = service_role/นำเข้าข้อมูล ไม่บังคับ เพื่อไม่ให้ backfill พัง
  IF auth.uid() IS NOT NULL
     AND (v_muni IS NULL OR v_muni <> NEW.municipality_id OR v_role = 'citizen') THEN
    RAISE EXCEPTION 'FLEET_TRIP_REQUESTER_INVALID';
  END IF;

  NEW.requester_position := coalesce(nullif(btrim(NEW.requester_position), ''), v_position);
  RETURN NEW;
END;
$fn$;
