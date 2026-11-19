-- จองคิวรับบริการ: ปิดรับจองในวันหยุดราชการ (ต่อจาก 20261210100000 + 20261210100100 ที่รันบนฐานจริงแล้ว 2026-11-18)
--
-- ปัญหา: เดิมดูแค่ open_weekdays (จ.–ศ.) ⇒ ประชาชนจองวันหยุดนักขัตฤกษ์ที่ตรงวันธรรมดาได้ มาแล้วสำนักงานปิด
-- ทางแก้: ใช้ตาราง public_holidays ชุดเดียวกับที่นับวันทำการของคำร้อง (add_working_days) — แอดมินตั้งวันหยุด
--   ครั้งเดียวที่หน้า "วันหยุดราชการ" แล้วการจองคิวปิดเอง ไม่ต้องตั้งรายบริการ
--   ลำดับทับเหมือน add_working_days: แถวของ อปท. ชนะแถวทั่วประเทศ · is_working_day = true คือ "ยกเลิกวันหยุด" (เปิดจองได้)
--   วันที่ไม่อยู่ใน open_weekdays ยังปิดเหมือนเดิม — แถวยกเลิกวันหยุดไม่ได้เปิดวันเสาร์-อาทิตย์ให้บริการที่ไม่ได้ตั้งไว้
--
-- ไฟล์นี้: เพิ่ม queue_is_holiday() + เขียน queue_slot_availability / book_queue_slot ใหม่ทั้งตัว
--   (CREATE OR REPLACE ทับทั้งฟังก์ชัน — เนื้อเดิมคัดมาจาก 20261210100100 ทุกบรรทัด เพิ่มเฉพาะจุดที่กำกับ "เพิ่มในไฟล์นี้")
--   ไม่แตะตาราง/RLS/GRANT ของตาราง · ไม่แตะ cancel_queue_booking / mark_queue_booking
--
-- ⚠️ คิวที่จองไว้ก่อนแอดมินเพิ่มวันหยุดย้อนหลัง ไม่ถูกยกเลิกเอง (ระบบไม่ตัดสินแทนเจ้าหน้าที่)
--   หน้า "คิวของฉัน" ขึ้นคำเตือนให้ผู้จองเห็นแทน และผู้จองยกเลิกเองได้ตามปกติ
--
-- ตรวจหลังรัน (เลือกวันหยุดวันธรรมดาที่มีในตาราง):
--   SELECT public.queue_is_holiday('2026-12-07', NULL);   -- true ถ้ามีแถววันหยุดทั่วประเทศวันนั้น
--
-- ย้อนกลับ: รันส่วน queue_slot_availability + book_queue_slot ของไฟล์ 20261210100100 ซ้ำ แล้ว
--   DROP FUNCTION IF EXISTS public.queue_is_holiday(date, uuid);
BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.queue_services') IS NULL OR to_regprocedure('public.book_queue_slot(uuid, date, time, text, text)') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261210100000 + 20261210100100 (จองคิวรับบริการ) ก่อน';
  END IF;
  IF to_regclass('public.public_holidays') IS NULL THEN
    RAISE EXCEPTION 'ต้องมีตาราง public.public_holidays ก่อน (20260831100000_public_holidays.sql)';
  END IF;
END $guard$;

-- ── วันนั้นเป็นวันหยุดราชการของ อปท. นี้ไหม (เฉพาะตาราง public_holidays ไม่รวมเสาร์-อาทิตย์) ─────────────
-- เรียกจากฟังก์ชัน SECURITY DEFINER ด้านล่างเท่านั้น ⇒ ไม่ให้ client เรียกตรง
CREATE OR REPLACE FUNCTION public.queue_is_holiday(p_date date, p_municipality_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT NOT h.is_working_day
    FROM public.public_holidays h
    WHERE h.holiday_date = p_date
      AND (h.municipality_id = p_municipality_id OR h.municipality_id IS NULL)
    ORDER BY (h.municipality_id IS NULL)   -- แถวของ อปท. มาก่อนแถวทั่วประเทศ (เหมือน add_working_days)
    LIMIT 1
  ), false);
$$;
REVOKE ALL ON FUNCTION public.queue_is_holiday(date, uuid) FROM PUBLIC, anon, authenticated;

-- ── RPC: ช่องว่างของวันหนึ่ง (เขียนใหม่ทั้งตัว เพิ่มเงื่อนไขวันหยุด) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.queue_slot_availability(p_service_id uuid, p_date date)
RETURNS TABLE (slot_time time, quota integer, taken integer, bookable boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  s public.queue_services;
  v_today date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_now time := (now() AT TIME ZONE 'Asia/Bangkok')::time;
  v_open boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'กรุณาเข้าสู่ระบบก่อน' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.queue_services WHERE id = p_service_id;
  -- COALESCE: ผู้ใช้ไม่มีสังกัด (municipality_id NULL) ต้องไม่หลุดด่าน (NOT NULL = NULL → IF ไม่ทำงาน)
  IF NOT FOUND OR NOT COALESCE(s.municipality_id = public.get_my_municipality_id() OR public.get_my_role() = 'superadmin', false) THEN
    RAISE EXCEPTION 'ไม่พบบริการนี้' USING ERRCODE = 'P0002';
  END IF;

  v_open := s.is_active AND public.queue_module_enabled(s.municipality_id)
            AND p_date BETWEEN v_today AND v_today + s.book_ahead_days
            AND extract(isodow FROM p_date)::smallint = ANY (s.open_weekdays)
            AND NOT public.queue_is_holiday(p_date, s.municipality_id);   -- เพิ่มในไฟล์นี้

  RETURN QUERY
  WITH slots AS (
    SELECT (s.start_time + make_interval(mins => n * s.slot_minutes))::time AS t
    FROM generate_series(0, ((extract(epoch FROM s.end_time - s.start_time) / 60)::int / s.slot_minutes) - 1) AS n
  )
  SELECT sl.t,
         s.per_slot_quota::integer,
         (SELECT count(*)::integer FROM public.queue_bookings b
           WHERE b.service_id = s.id AND b.booking_date = p_date AND b.slot_time = sl.t AND b.status <> 'cancelled'),
         v_open AND NOT (p_date = v_today AND sl.t <= v_now)
           AND (SELECT count(*) FROM public.queue_bookings b
                 WHERE b.service_id = s.id AND b.booking_date = p_date AND b.slot_time = sl.t AND b.status <> 'cancelled') < s.per_slot_quota
  FROM slots sl
  ORDER BY sl.t;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_slot_availability(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.queue_slot_availability(uuid, date) TO authenticated;

-- ── RPC: จองคิว (เขียนใหม่ทั้งตัว เพิ่มด่านวันหยุด) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.book_queue_slot(
  p_service_id uuid, p_date date, p_slot_time time, p_phone text DEFAULT NULL, p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  s public.queue_services;
  v_today date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_now time := (now() AT TIME ZONE 'Asia/Bangkok')::time;
  v_taken integer;
  v_queue_no integer;
  v_name text;
  v_phone text;
  v_note text := NULLIF(btrim(p_note), '');
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'กรุณาเข้าสู่ระบบก่อนจองคิว' USING ERRCODE = '42501';
  END IF;
  IF p_service_id IS NULL OR p_date IS NULL OR p_slot_time IS NULL THEN
    RAISE EXCEPTION 'กรุณาเลือกบริการ วัน และช่วงเวลา' USING ERRCODE = '22023';
  END IF;

  -- ล็อกแถวบริการ: คำขอจองพร้อมกันของบริการเดียวกันต้องรอกันทีละราย ⇒ นับแล้วเขียนไม่ชนกัน
  SELECT * INTO s FROM public.queue_services WHERE id = p_service_id FOR UPDATE;
  IF NOT FOUND OR s.municipality_id IS DISTINCT FROM public.get_my_municipality_id() THEN
    RAISE EXCEPTION 'ไม่พบบริการนี้' USING ERRCODE = 'P0002';
  END IF;
  IF NOT s.is_active OR NOT public.queue_module_enabled(s.municipality_id) THEN
    RAISE EXCEPTION 'บริการนี้ปิดรับจองคิวอยู่' USING ERRCODE = 'P0001';
  END IF;
  IF p_date < v_today OR p_date > v_today + s.book_ahead_days THEN
    RAISE EXCEPTION 'จองล่วงหน้าได้ไม่เกิน % วัน และต้องไม่ใช่วันที่ผ่านมาแล้ว', s.book_ahead_days USING ERRCODE = 'P0001';
  END IF;
  IF NOT (extract(isodow FROM p_date)::smallint = ANY (s.open_weekdays)) THEN
    RAISE EXCEPTION 'บริการนี้ไม่เปิดในวันที่เลือก' USING ERRCODE = 'P0001';
  END IF;
  -- เพิ่มในไฟล์นี้: วันหยุดราชการ (ตาราง public_holidays) ปิดรับจองทุกบริการ
  IF public.queue_is_holiday(p_date, s.municipality_id) THEN
    RAISE EXCEPTION 'วันที่เลือกเป็นวันหยุดราชการ กรุณาเลือกวันอื่น' USING ERRCODE = 'P0001';
  END IF;

  IF p_slot_time < s.start_time
     -- numeric ไม่ cast เป็น integer: เวลาเศษวินาที ('09:00:00.4') ต้องไม่ถูกปัดจนผ่านด่าน แล้วนับโควตาไม่เจอ
     OR mod(extract(epoch FROM p_slot_time) - extract(epoch FROM s.start_time), s.slot_minutes * 60) <> 0
     OR extract(epoch FROM p_slot_time) + s.slot_minutes * 60 > extract(epoch FROM s.end_time) THEN
    RAISE EXCEPTION 'ช่วงเวลาที่เลือกไม่ตรงกับตารางของบริการนี้' USING ERRCODE = '22023';
  END IF;
  IF p_date = v_today AND p_slot_time <= v_now THEN
    RAISE EXCEPTION 'ช่วงเวลานี้ผ่านไปแล้ว' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.queue_bookings b
             WHERE b.service_id = s.id AND b.booking_date = p_date AND b.citizen_id = v_uid AND b.status <> 'cancelled') THEN
    RAISE EXCEPTION 'ท่านมีคิวของบริการนี้ในวันที่เลือกแล้ว' USING ERRCODE = '23505';
  END IF;
  -- กันจองกักคิว: คิวที่ยังไม่ถึงวันได้ไม่เกิน 5 คิวต่อคน (ทุกบริการรวมกัน)
  IF (SELECT count(*) FROM public.queue_bookings b
      WHERE b.citizen_id = v_uid AND b.status = 'booked' AND b.booking_date >= v_today) >= 5 THEN
    RAISE EXCEPTION 'มีคิวที่รอรับบริการครบ 5 คิวแล้ว กรุณายกเลิกคิวที่ไม่ใช้ก่อน' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_taken FROM public.queue_bookings b
  WHERE b.service_id = s.id AND b.booking_date = p_date AND b.slot_time = p_slot_time AND b.status <> 'cancelled';
  IF v_taken >= s.per_slot_quota THEN
    RAISE EXCEPTION 'ช่วงเวลานี้เต็มแล้ว กรุณาเลือกช่วงอื่น' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(max(b.queue_no), 0) + 1 INTO v_queue_no FROM public.queue_bookings b
  WHERE b.service_id = s.id AND b.booking_date = p_date;

  SELECT NULLIF(btrim(p.full_name), ''), NULLIF(regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g'), '')
    INTO v_name, v_phone
  FROM public.profiles p WHERE p.id = v_uid;
  IF NULLIF(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), '') IS NOT NULL THEN
    v_phone := regexp_replace(p_phone, '\D', '', 'g');
    IF v_phone !~ '^0[0-9]{8,9}$' THEN
      RAISE EXCEPTION 'เบอร์โทรไม่ถูกต้อง (ตัวเลข 9–10 หลัก ขึ้นต้นด้วย 0)' USING ERRCODE = '22023';
    END IF;
  ELSIF v_phone IS NOT NULL AND v_phone !~ '^0[0-9]{8,9}$' THEN
    v_phone := NULL; -- เบอร์ในโปรไฟล์รูปแบบแปลก ไม่บังคับ ไม่ทำให้จองล้ม
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 500 THEN
    RAISE EXCEPTION 'หมายเหตุยาวเกิน 500 ตัวอักษร' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.queue_bookings (municipality_id, service_id, citizen_id, citizen_name, contact_phone, note,
                                     booking_date, slot_time, queue_no)
  VALUES (s.municipality_id, s.id, v_uid, left(COALESCE(v_name, 'ไม่ระบุชื่อ'), 200), v_phone, v_note,
          p_date, p_slot_time, v_queue_no)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'queue_no', v_queue_no, 'booking_date', p_date, 'slot_time', p_slot_time,
                            'service_name', s.name, 'location', s.location);
END;
$$;
REVOKE ALL ON FUNCTION public.book_queue_slot(uuid, date, time, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.book_queue_slot(uuid, date, time, text, text) TO authenticated;

-- ── ด่านท้ายไฟล์ ─────────────────────────────────────────────────────────────────────
DO $verify$
BEGIN
  IF has_function_privilege('authenticated', 'public.queue_is_holiday(date, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.queue_is_holiday(date, uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.book_queue_slot(uuid, date, time, text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.book_queue_slot(uuid, date, time, text, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.queue_slot_availability(uuid, date)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.queue_slot_availability(uuid, date)', 'EXECUTE')
     OR position('queue_is_holiday' IN pg_get_functiondef('public.book_queue_slot(uuid, date, time, text, text)'::regprocedure)) = 0
     OR position('queue_is_holiday' IN pg_get_functiondef('public.queue_slot_availability(uuid, date)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'queue holidays: สิทธิ์ฟังก์ชัน/เนื้อฟังก์ชันไม่ตรงตามที่ออกแบบ';
  END IF;
END $verify$;

-- ด่านเจ้าของ (reviewer ข้อ 2): queue_is_holiday ไม่ใช่ SECURITY DEFINER และถอนสิทธิ์ PUBLIC แล้ว ⇒ ทำงานได้เมื่อ
--   (ก) เจ้าของฟังก์ชันจองคิวเรียกมันได้ (เป็นเจ้าของคนเดียวกัน) — ไม่งั้นจอง/ดูช่องว่างตอบ 42501 ทุก อปท.
--   (ข) เจ้าของอ่าน public_holidays ข้าม RLS ได้ (policy อ่านให้แค่ anon/authenticated) — ไม่งั้นได้ false เสมอ พังเงียบ
DO $verify_owner$
DECLARE
  v_owner oid := (SELECT proowner FROM pg_proc WHERE oid = 'public.book_queue_slot(uuid, date, time, text, text)'::regprocedure);
BEGIN
  IF v_owner IS DISTINCT FROM (SELECT proowner FROM pg_proc WHERE oid = 'public.queue_slot_availability(uuid, date)'::regprocedure)
     OR NOT has_function_privilege(v_owner, 'public.queue_is_holiday(date, uuid)', 'EXECUTE')
     OR NOT has_table_privilege(v_owner, 'public.public_holidays', 'SELECT')
     OR (NOT COALESCE((SELECT r.rolsuper OR r.rolbypassrls FROM pg_roles r WHERE r.oid = v_owner), false)
         AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.public_holidays'::regclass
                         AND c.relowner = v_owner AND NOT c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'queue holidays: เจ้าของฟังก์ชันจองคิวเรียก queue_is_holiday หรืออ่าน public_holidays ข้าม RLS ไม่ได้';
  END IF;
END $verify_owner$;

COMMIT;
