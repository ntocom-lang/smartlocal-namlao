-- จองคิวรับบริการ (ขั้น 1D · E2) ไฟล์ 2/2 — RLS · GRANT · RPC · เปิดโมดูลให้ demo
--
-- ใครทำอะไรได้
--   ประชาชน (ล็อกอิน อปท. เดียวกัน) เห็นบริการที่เปิด · ดูช่องว่าง (ตัวเลขล้วน) · จอง/ยกเลิกของตัวเองผ่าน RPC
--   เจ้าหน้าที่ officer/staff/technician เห็นคิวของบริการที่ department_id = กองตัวเอง · กดมาแล้ว/ไม่มา ผ่าน RPC
--   แอดมิน อปท. ตั้งค่าบริการ + เห็นคิวทุกบริการของ อปท. ตัวเอง · superadmin ทุกอย่าง (รวมลบ)
--   viewer/council/kamnan ไม่เห็นรายชื่อผู้จอง (PDPA: ห้องผู้บริหารใช้ตัวเลขรวมเท่านั้น)
-- ใครเขียน department_id (NOTES ข้อ 13): แอดมินเลือกกองตอนตั้งบริการ · ว่าง = เห็นเฉพาะแอดมิน (ตั้งใจ ไม่ใช่ deadlock เงียบ
--   หน้าแอดมินขึ้นคำเตือนให้เลือกกอง)
-- กันจองเกินโควตา: book_queue_slot ล็อกแถวบริการ (SELECT … FOR UPDATE) ก่อนนับ ⇒ คำขอพร้อมกันเข้าคิวทีละคำขอ
-- "ไม่มาตามนัด" เป็นบันทึกข้อเท็จจริงเท่านั้น ระบบไม่ตัดสิทธิ์ผู้จองจากสถานะนี้
BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.queue_services') IS NULL OR to_regclass('public.queue_bookings') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261210100000_queue_booking_tables.sql ก่อน';
  END IF;
END $guard$;

-- ── ตัวช่วย: ผู้เรียกดูแลคิวของบริการนี้ได้ไหม ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.queue_can_staff_service(p_service_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.queue_services s
    WHERE s.id = p_service_id
      AND (
        public.get_my_role() = 'superadmin'
        OR (public.get_my_role() = 'admin' AND s.municipality_id = public.get_my_municipality_id())
        OR (public.get_my_role() IN ('officer', 'staff', 'technician')
            AND public.is_my_department(s.municipality_id, s.department_id))
      )
  );
$$;
REVOKE ALL ON FUNCTION public.queue_can_staff_service(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.queue_can_staff_service(uuid) TO authenticated;

-- ชุดบริการที่ผู้เรียกดูแลได้ — ใช้ใน RLS แบบ (SELECT …) ให้ประเมินครั้งเดียวต่อคำสั่ง (InitPlan) ไม่ใช่ทุกแถว
CREATE OR REPLACE FUNCTION public.queue_my_staff_service_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(array_agg(s.id), '{}'::uuid[])
  FROM public.queue_services s
  WHERE public.get_my_role() = 'superadmin'
     OR (public.get_my_role() = 'admin' AND s.municipality_id = public.get_my_municipality_id())
     OR (public.get_my_role() IN ('officer', 'staff', 'technician')
         AND public.is_my_department(s.municipality_id, s.department_id));
$$;
REVOKE ALL ON FUNCTION public.queue_my_staff_service_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.queue_my_staff_service_ids() TO authenticated;

CREATE OR REPLACE FUNCTION public.queue_module_enabled(p_municipality_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  -- enabled_modules = NULL (แถวเก่าไม่เคยตั้ง) = เปิดทุกโมดูล ตามพฤติกรรมเดิมของ TenantContext
  SELECT COALESCE((SELECT m.enabled_modules IS NULL OR 'queue-booking' = ANY (m.enabled_modules)
                   FROM public.municipalities m WHERE m.id = p_municipality_id), false);
$$;
REVOKE ALL ON FUNCTION public.queue_module_enabled(uuid) FROM PUBLIC, anon, authenticated;

-- ── trigger บริการ: ผู้สร้าง + เวลาแก้ล่าสุด ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.queue_services_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := now();
  ELSE
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    NEW.municipality_id := OLD.municipality_id;
    -- แก้ตารางเวลาตอนมีคิวค้าง: คิวที่หลุดตารางใหม่จะไม่ถูกนับ → ช่องจริงรับคนเกินโควตา ⇒ ห้าม (ให้ผู้จองยกเลิก/รอผ่านวันก่อน)
    IF (NEW.start_time, NEW.end_time, NEW.slot_minutes, NEW.open_weekdays)
       IS DISTINCT FROM (OLD.start_time, OLD.end_time, OLD.slot_minutes, OLD.open_weekdays)
       AND EXISTS (
         SELECT 1 FROM public.queue_bookings b
         WHERE b.service_id = NEW.id AND b.status = 'booked'
           AND b.booking_date >= (now() AT TIME ZONE 'Asia/Bangkok')::date
           AND NOT (extract(isodow FROM b.booking_date)::smallint = ANY (NEW.open_weekdays)
                    AND b.slot_time >= NEW.start_time
                    AND mod(extract(epoch FROM b.slot_time) - extract(epoch FROM NEW.start_time), NEW.slot_minutes * 60) = 0
                    AND extract(epoch FROM b.slot_time) + NEW.slot_minutes * 60 <= extract(epoch FROM NEW.end_time))
       ) THEN
      RAISE EXCEPTION 'มีคิวที่จองไว้แล้วซึ่งไม่ตรงกับตารางเวลาใหม่ — แก้วัน/เวลาได้หลังคิวเหล่านั้นผ่านไปหรือถูกยกเลิก'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_services_touch() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS queue_services_touch_trigger ON public.queue_services;
CREATE TRIGGER queue_services_touch_trigger BEFORE INSERT OR UPDATE ON public.queue_services
  FOR EACH ROW EXECUTE FUNCTION public.queue_services_touch();

-- ── สิทธิ์ตาราง ────────────────────────────────────────────────────────────────────
REVOKE ALL ON public.queue_services, public.queue_bookings FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.queue_services TO authenticated;
GRANT INSERT (municipality_id, department_id, name, description, location, open_weekdays, start_time, end_time,
              slot_minutes, per_slot_quota, book_ahead_days, is_active) ON public.queue_services TO authenticated;
GRANT UPDATE (department_id, name, description, location, open_weekdays, start_time, end_time,
              slot_minutes, per_slot_quota, book_ahead_days, is_active) ON public.queue_services TO authenticated;
GRANT SELECT, DELETE ON public.queue_bookings TO authenticated;
GRANT ALL ON public.queue_services, public.queue_bookings TO service_role;

-- ── RLS: queue_services ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS queue_services_select ON public.queue_services;
CREATE POLICY queue_services_select ON public.queue_services FOR SELECT TO authenticated
  USING (
    (SELECT public.get_my_role()) = 'superadmin'
    OR (municipality_id = (SELECT public.get_my_municipality_id())
        AND (is_active OR (SELECT public.get_my_role()) <> 'citizen'))
  );

DROP POLICY IF EXISTS queue_services_insert ON public.queue_services;
CREATE POLICY queue_services_insert ON public.queue_services FOR INSERT TO authenticated
  WITH CHECK (
    public.department_belongs_to_municipality(department_id, municipality_id)
    AND ((SELECT public.get_my_role()) = 'superadmin'
         OR ((SELECT public.get_my_role()) = 'admin' AND municipality_id = (SELECT public.get_my_municipality_id())))
  );

DROP POLICY IF EXISTS queue_services_update ON public.queue_services;
CREATE POLICY queue_services_update ON public.queue_services FOR UPDATE TO authenticated
  USING ((SELECT public.get_my_role()) = 'superadmin'
         OR ((SELECT public.get_my_role()) = 'admin' AND municipality_id = (SELECT public.get_my_municipality_id())))
  WITH CHECK (
    public.department_belongs_to_municipality(department_id, municipality_id)
    AND ((SELECT public.get_my_role()) = 'superadmin'
         OR ((SELECT public.get_my_role()) = 'admin' AND municipality_id = (SELECT public.get_my_municipality_id())))
  );

-- ลบบริการ = ลบประวัติคิวทั้งหมด (CASCADE) ⇒ แอดมินใช้ "ปิดบริการ" (is_active) แทน · ลบได้เฉพาะ superadmin
DROP POLICY IF EXISTS queue_services_delete ON public.queue_services;
CREATE POLICY queue_services_delete ON public.queue_services FOR DELETE TO authenticated
  USING ((SELECT public.get_my_role()) = 'superadmin');

-- ── RLS: queue_bookings (เขียนผ่าน RPC เท่านั้น) ────────────────────────────────────────
DROP POLICY IF EXISTS queue_bookings_select ON public.queue_bookings;
CREATE POLICY queue_bookings_select ON public.queue_bookings FOR SELECT TO authenticated
  USING (citizen_id = (SELECT auth.uid()) OR service_id = ANY ((SELECT public.queue_my_staff_service_ids())::uuid[]));
  -- ::uuid[] จำเป็น: ไม่ cast แล้ว = ANY (subquery) เทียบ uuid กับ uuid[] (42883) · ยังเป็น InitPlan ประเมินครั้งเดียว

DROP POLICY IF EXISTS queue_bookings_delete ON public.queue_bookings;
CREATE POLICY queue_bookings_delete ON public.queue_bookings FOR DELETE TO authenticated
  USING ((SELECT public.get_my_role()) = 'superadmin');

-- ── RPC: ช่องว่างของวันหนึ่ง (ตัวเลขล้วน ไม่มีชื่อผู้จอง) ───────────────────────────────────
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
            AND extract(isodow FROM p_date)::smallint = ANY (s.open_weekdays);

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

-- ── RPC: จองคิว ─────────────────────────────────────────────────────────────────────
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

-- ── RPC: ผู้จองยกเลิกเอง (เฉพาะคิวที่ยังไม่ถึงวัน/วันนี้ และยังไม่ถูกบันทึกมา/ไม่มา) ─────────────────
CREATE OR REPLACE FUNCTION public.cancel_queue_booking(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'กรุณาเข้าสู่ระบบก่อน' USING ERRCODE = '42501';
  END IF;
  UPDATE public.queue_bookings
     SET status = 'cancelled', cancelled_at = now()
   WHERE id = p_booking_id AND citizen_id = auth.uid() AND status = 'booked' AND booking_date >= v_today;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ยกเลิกคิวนี้ไม่ได้ (ไม่พบ ผ่านวันนัดแล้ว หรือเจ้าหน้าที่บันทึกผลแล้ว)' USING ERRCODE = 'P0001';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_queue_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_queue_booking(uuid) TO authenticated;

-- ── RPC: เจ้าหน้าที่บันทึก มาแล้ว / ไม่มา / ย้อนเป็นรอรับบริการ ────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_queue_booking(p_booking_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  b public.queue_bookings;
  v_today date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'กรุณาเข้าสู่ระบบก่อน' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('arrived', 'no_show', 'booked') THEN
    RAISE EXCEPTION 'สถานะไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO b FROM public.queue_bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR NOT public.queue_can_staff_service(b.service_id) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์บันทึกคิวนี้' USING ERRCODE = '42501';
  END IF;
  IF b.status = 'cancelled' THEN
    RAISE EXCEPTION 'คิวนี้ผู้จองยกเลิกแล้ว' USING ERRCODE = 'P0001';
  END IF;
  IF p_status IN ('arrived', 'no_show') AND b.booking_date > v_today THEN
    RAISE EXCEPTION 'ยังไม่ถึงวันนัด บันทึกผลไม่ได้' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.queue_bookings
     SET status = p_status,
         checked_at = CASE WHEN p_status = 'booked' THEN NULL ELSE now() END,
         checked_by = CASE WHEN p_status = 'booked' THEN NULL ELSE auth.uid() END
   WHERE id = b.id;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_queue_booking(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_queue_booking(uuid, text) TO authenticated;

-- ── เปิดโมดูลให้สนามซ้อม demo เท่านั้น (อปท. อื่นแอดมินเปิดเองที่หน้าจัดการโมดูล · ค่าเริ่มต้นปิด) ─────────
UPDATE public.municipalities
   SET enabled_modules = array_append(enabled_modules, 'queue-booking')
 WHERE slug = 'demo' AND enabled_modules IS NOT NULL
   AND array_position(enabled_modules::text[], 'queue-booking') IS NULL; -- ไม่ใช้ NOT (= ANY): มีสมาชิก NULL ปน = ข้ามเงียบ

DO $demo$
BEGIN
  IF EXISTS (SELECT 1 FROM public.municipalities WHERE slug = 'demo' AND enabled_modules IS NOT NULL
             AND array_position(enabled_modules::text[], 'queue-booking') IS NULL) THEN
    RAISE EXCEPTION 'เปิดโมดูล queue-booking ให้ demo ไม่สำเร็จ';
  END IF;
END $demo$;

-- ── ด่านท้ายไฟล์: ผู้รันไม่ใช่เจ้าของตาราง REVOKE จะไม่ error แต่ไม่มีผล (บทเรียน #657) ──
DO $verify$
DECLARE s regclass := 'public.queue_services'; b regclass := 'public.queue_bookings';
BEGIN
  IF (SELECT bool_or(NOT relrowsecurity) FROM pg_class WHERE oid IN (s, b))
     OR has_any_column_privilege('anon', s, 'SELECT,INSERT,UPDATE,REFERENCES')
     OR has_any_column_privilege('anon', b, 'SELECT,INSERT,UPDATE,REFERENCES')
     OR has_table_privilege('anon', s, 'DELETE,TRUNCATE,TRIGGER') OR has_table_privilege('anon', b, 'DELETE,TRUNCATE,TRIGGER')
     OR has_table_privilege('authenticated', s, 'TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('authenticated', b, 'TRUNCATE,REFERENCES,TRIGGER')
     OR has_any_column_privilege('authenticated', b, 'INSERT,UPDATE')
     OR has_column_privilege('authenticated', s, 'municipality_id', 'UPDATE')
     OR has_column_privilege('authenticated', s, 'created_by', 'UPDATE')
     OR has_column_privilege('authenticated', s, 'created_by', 'INSERT')
     OR NOT has_column_privilege('authenticated', s, 'per_slot_quota', 'UPDATE')
     OR NOT has_function_privilege('authenticated', 'public.book_queue_slot(uuid, date, time, text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.book_queue_slot(uuid, date, time, text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.mark_queue_booking(uuid, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.queue_my_staff_service_ids()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.queue_my_staff_service_ids()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.queue_module_enabled(uuid)', 'EXECUTE')
     OR (SELECT count(*) FROM pg_policy WHERE polrelid IN (s, b)) <> 6 THEN
    RAISE EXCEPTION 'queue_*: RLS/สิทธิ์ไม่ตรงตามที่ออกแบบ (ผู้รันต้องเป็นเจ้าของตาราง เช่น postgres)';
  END IF;
END $verify$;

COMMIT;
