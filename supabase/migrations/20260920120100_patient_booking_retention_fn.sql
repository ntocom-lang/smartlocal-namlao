-- 20260920120100_patient_booking_retention_fn.sql
--
-- เฟส 2 ของ 20260920120000 — ฟังก์ชันดูยอดและฟังก์ชันลบจริง
-- แยกไฟล์เพราะไฟล์เดียวกันอ้างคอลัมน์ที่เพิ่งเพิ่มในทรานแซกชันเดียวกันไม่ได้ (42703)
--
-- [ขอบเขตการลบ] ลบเฉพาะสิ่งที่ระบุตัวบุคคลได้: ชื่อผู้จอง ชื่อผู้เดินทาง เบอร์โทร จุดรับ และพิกัด
-- **คงไว้:** วันเดินทาง เส้นทาง ระดับการเคลื่อนไหว จำนวนผู้ติดตาม สถานะ เลขไมล์ และข้อความยินยอม
-- เพราะเป็นตัวเลขเชิงสถิติกับหลักฐานการให้บริการที่ต้องใช้ตอบ สตง. และทำสรุปรายเดือนให้กองทุน
-- เมื่อไม่มีชื่อ/เบอร์/ที่อยู่แล้ว แถวที่เหลือย้อนกลับไปหาตัวบุคคลไม่ได้
--
-- ⚠️ ประเด็นค้างที่ต้องรู้: patient_booking_events.detail เก็บ "เหตุผลที่เจ้าหน้าที่พิมพ์เอง"
-- (เช่น เหตุผลยกเลิก เหตุผลแก้ข้อมูล) ซึ่งอาจมีชื่อคนอยู่ในข้อความ ไฟล์นี้ไม่แตะ audit ตั้งใจ
-- เพราะ audit ที่ถูกแก้ย้อนหลังใช้ตรวจสอบไม่ได้อีก — ต้องตัดสินใจแยกว่าจะเก็บ audit นานแค่ไหน
-- (ปัญหาเดียวกับ complaints.detail ที่ระบุไว้ใน 20260902120000)

-- วันเดินทางจริงเป็นหมุดเวลา — ดูเหตุผลใน 20260920120000
CREATE OR REPLACE FUNCTION public.patient_booking_retention_anchor(b public.patient_bookings)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$ SELECT COALESCE(b.return_at, b.appointment_at) $$;

REVOKE ALL ON FUNCTION public.patient_booking_retention_anchor(public.patient_bookings)
  FROM PUBLIC, anon, authenticated;

-- ลบข้อมูลระบุตัวบุคคลของคำขอที่ปิดแล้วและครบกำหนดเก็บ
--   SELECT public.purge_expired_patient_booking_contacts('5 years', true);  -- ดูยอดก่อน ไม่ลบ
--   SELECT public.purge_expired_patient_booking_contacts('5 years');        -- ลบจริง + ลง audit_logs
CREATE OR REPLACE FUNCTION public.purge_expired_patient_booking_contacts(
  p_retention interval DEFAULT '5 years',
  p_dry_run   boolean  DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_cutoff  timestamptz := now() - p_retention;
  v_purged  int := 0;
  v_holding int := 0;
  v_open    int := 0;
BEGIN
  -- คำขอที่ครบกำหนดแล้วแต่ยังไม่ปิด (ยังรอจัดคิว/ยังไม่จบเที่ยว) ไม่ลบ และต้องรายงานให้คนเห็น
  -- ไม่ใช่เงียบ — เพราะแถวพวกนี้ยังค้างอยู่ในคิวของเจ้าหน้าที่ ลบชื่อทิ้งแล้วงานจะกลายเป็นผี
  SELECT count(*) INTO v_open
  FROM public.patient_bookings b
  WHERE b.contact_purged_at IS NULL
    AND b.status NOT IN ('completed', 'cancelled')
    AND public.patient_booking_retention_anchor(b) < v_cutoff;

  SELECT count(*) INTO v_holding
  FROM public.patient_bookings b
  WHERE b.contact_purged_at IS NULL;

  IF p_dry_run THEN
    SELECT count(*) INTO v_purged
    FROM public.patient_bookings b
    WHERE b.contact_purged_at IS NULL
      AND b.status IN ('completed', 'cancelled')
      AND public.patient_booking_retention_anchor(b) < v_cutoff;

    RETURN jsonb_build_object(
      'dry_run', true, 'cutoff', to_jsonb(v_cutoff),
      'would_purge', v_purged, 'skipped_still_open', v_open, 'holding_contacts', v_holding
    );
  END IF;

  -- audit กับการลบอยู่ใน CTE ชุดเดียวกัน ทำงานบน snapshot เดียวกันเสมอ บันทึกจึงตรงกับของจริง
  WITH targets AS (
    SELECT b.id, b.municipality_id
    FROM public.patient_bookings b
    WHERE b.contact_purged_at IS NULL
      AND b.status IN ('completed', 'cancelled')
      AND public.patient_booking_retention_anchor(b) < v_cutoff
  ), logged AS (
    INSERT INTO public.audit_logs (
      municipality_id, actor_id, actor_name, actor_role, action,
      resource_type, resource_id, resource_label, metadata
    )
    SELECT t.municipality_id, NULL, 'ระบบ (งานลบข้อมูลตามระยะเวลาเก็บรักษา)', 'system',
           'purge_contact_pii', 'patient_booking', NULL,
           'ลบข้อมูลระบุตัวบุคคลของคำขอจองรถที่ครบกำหนดเก็บรักษา',
           jsonb_build_object(
             'retention', p_retention::text,
             'cutoff', to_jsonb(v_cutoff),
             'bookings', count(*),
             'fields', jsonb_build_array('requester_name', 'patient_name', 'phone', 'pickup', 'pickup_lat', 'pickup_lng')
           )
    FROM targets t
    GROUP BY t.municipality_id
    RETURNING 1
  ), updated AS (
    UPDATE public.patient_bookings b
       SET requester_name    = 'ลบตามระยะเวลาเก็บรักษา',
           patient_name      = 'ลบตามระยะเวลาเก็บรักษา',
           phone             = '',
           pickup            = 'ลบตามระยะเวลาเก็บรักษา',
           pickup_lat        = NULL,
           pickup_lng        = NULL,
           contact_purged_at = now()
      FROM targets t
     WHERE b.id = t.id
    RETURNING b.id
  )
  SELECT count(*) INTO v_purged FROM updated;

  RETURN jsonb_build_object(
    'dry_run', false, 'cutoff', to_jsonb(v_cutoff),
    'purged', v_purged, 'skipped_still_open', v_open, 'holding_contacts', v_holding - v_purged
  );
END;
$$;

-- ฟังก์ชันนี้ลบข้อมูลจริง จึงไม่เปิดให้ role ไหนเรียกผ่าน API ได้เลย
-- เรียกได้จาก SQL editor ของผู้ดูแลฐานข้อมูลเท่านั้น (มี p_dry_run ให้ตรวจก่อนเสมอ)
REVOKE ALL ON FUNCTION public.purge_expired_patient_booking_contacts(interval, boolean)
  FROM PUBLIC, anon, authenticated;

-- **ไม่ตั้ง cron ตั้งใจ** — ตามการตัดสินใจเดียวกับ 20260902150000_drop_contact_retention_cron.sql
-- ถ้าวันหลังเจ้าของระบบสั่งให้ทำอัตโนมัติ (18:30 UTC = 01:30 น. เวลาไทย):
--   SELECT cron.schedule('patient-booking-contact-retention-daily', '30 18 * * *',
--     $job$ SELECT public.purge_expired_patient_booking_contacts(); $job$);
--
-- ⚠️ ผลที่ตามมาตราบใดที่ยังไม่มีใครสั่งลบ: ชื่อ เบอร์ และจุดรับของผู้ป่วยจะถูกเก็บไว้ตลอดไป
-- ต้องเขียนรอบการตรวจไว้ในงานประจำของผู้ดูแล หรือทำปุ่มให้แอดมินสั่งเมื่อครบกำหนด
NOTIFY pgrst, 'reload schema';
