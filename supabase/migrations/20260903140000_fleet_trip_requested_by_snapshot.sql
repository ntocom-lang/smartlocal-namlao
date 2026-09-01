-- เฟส 2/3 ของ "ยื่นคำขอใช้รถแทนผู้อื่น" (ต้องรัน 20260903120000 ก่อน)
--
-- ⚠️ body นี้ต่อยอดจาก 20260902170000_fleet_trip_official_request_form.sql ครบทุกบรรทัด
--   ห้ามใส่ placeholder เด็ดขาด (บทเรียนจาก 20260829120000 ที่ทำ UPDATE profiles พังทั้งระบบ)
--
-- ที่เปลี่ยน:
--   1. requested_by ว่าง = ผู้บันทึกขอเอง เติมให้เท่ากับ created_by อัตโนมัติ
--      (fleet_override_booking และงานนำเข้าข้อมูลไม่ต้องแก้ตาม)
--   2. requester_position snapshot จาก requested_by แทน created_by — ชื่อกับตำแหน่งบนแบบ 3
--      ต้องเป็นของคนเดียวกัน ไม่งั้นเอกสารขึ้นชื่อผู้ขอแต่ตำแหน่งของคนพิมพ์
--   3. ผู้ขอตัวจริงต้องอยู่ อปท. เดียวกันและไม่ใช่ประชาชนทั่วไป — กันยื่นในนามคนนอกสังกัด
--   4. แก้ผู้ขอได้เฉพาะตอนคำขอยัง pending แล้ว re-snapshot ตำแหน่งตามคนใหม่
--      หลังถูกพิจารณาแล้วล็อกตาย เพราะเอกสารที่อนุมัติไปแล้วต้องไม่เปลี่ยนชื่อผู้ขอย้อนหลัง
--   5. created_by ยังบังคับ auth.uid() และห้ามเปลี่ยนตลอดกาลเหมือนเดิม

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'fleet_trips'
       AND column_name = 'requested_by'
  ) THEN
    RAISE EXCEPTION 'ต้องรัน 20260903120000_fleet_trip_requested_by_column.sql ก่อน';
  END IF;
END;
$guard$;

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

    -- แก้ผู้ขอได้ตอนคำขอยัง pending หรือเมื่อถูกเรียกจาก fleet_override_booking ซึ่งสร้างแถว
    -- เป็น approved ทันทีแล้วค่อยเติมผู้ขอในขั้นตอนถัดมา (ล้อ pattern app.user_management_rpc)
    IF (OLD.status = 'pending'
        OR coalesce(current_setting('app.fleet_requester_rpc', true), '') = '1')
       AND NEW.requested_by IS NOT NULL
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

      NEW.requester_position := coalesce(v_position, nullif(btrim(NEW.requester_position), ''));
    ELSE
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

  NEW.requester_position := coalesce(v_position, nullif(btrim(NEW.requester_position), ''));
  RETURN NEW;
END;
$fn$;

-- trigger เดิมเฝ้าแค่ created_by/requester_position — ต้องเพิ่ม requested_by ด้วย
-- ไม่งั้น UPDATE ที่แก้เฉพาะผู้ขอจะไม่ยิง trigger แล้วตำแหน่งบนเอกสารค้างเป็นของคนเดิม
DROP TRIGGER IF EXISTS trg_fleet_trip_requester_snapshot ON public.fleet_trips;
CREATE TRIGGER trg_fleet_trip_requester_snapshot
BEFORE INSERT OR UPDATE OF created_by, requester_position, requested_by
ON public.fleet_trips
FOR EACH ROW
EXECUTE FUNCTION public.fleet_set_trip_requester_snapshot();
