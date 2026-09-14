-- ตารางรอบเก็บขยะ เฟส 2/3 — สิทธิ์ตาราง + RLS + ตัวประทับผู้แก้ + RPC ฝั่งประชาชน
-- (ตารางสร้างไว้แล้วใน 20260914100000 ไฟล์นี้จึงอ้างถึงได้)
--
-- ใครแก้ตารางได้ — ผูกกับ "กองที่รับผิดชอบงานขยะ" อัตโนมัติ ไม่ต้องให้แอดมินมอบสิทธิ์รายคน:
--   superadmin · admin ของ อปท. · officer/staff ของกองที่ waste_owner_department_id() เลือก
-- กองที่เลือก = กองสาธารณสุข ถ้ามีคนสังกัดอยู่จริง ไม่งั้นตกไปสำนักปลัด
-- (ตรวจ production 2569-09-07: ยังไม่มี อปท. ไหนมีกองสาธารณสุขเลย) วันที่ อปท. เพิ่ม
-- กองสาธารณสุขและย้ายคนเข้าไป สิทธิ์จะย้ายตามเองโดยไม่ต้องแก้อะไร
--
-- ประชาชน (รวมผู้ไม่ล็อกอิน) อ่านผ่าน get_public_waste_schedule() เท่านั้น
-- เหตุผลเดียวกับ 20260905130000: RLS ไม่รู้ว่าผู้ไม่ล็อกอินเปิดเว็บของ อปท. ไหน
-- RPC จึงบังคับให้ระบุ อปท. ทุกครั้ง ส่ง NULL ได้ผลว่าง ไม่ใช่ทั้งหมด

DO $$
BEGIN
  IF to_regclass('public.waste_schedules') IS NULL
     OR to_regclass('public.waste_schedule_exceptions') IS NULL
     OR to_regclass('public.waste_villages') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20260914100000_waste_schedule_tables.sql ก่อนไฟล์นี้';
  END IF;
END;
$$;

BEGIN;

-- ===========================================================================
-- สิทธิ์ระดับตาราง — ALTER DEFAULT PRIVILEGES ของ Supabase ให้ anon ได้ ALL กับตารางใหม่
-- และ RLS ไม่บังคับกับ TRUNCATE ต้องถอนเองทุกครั้ง (ดู 20260905200000)
-- ===========================================================================
REVOKE ALL ON public.waste_villages, public.waste_schedules, public.waste_schedule_exceptions
  FROM anon, PUBLIC;
REVOKE TRUNCATE, TRIGGER, REFERENCES
  ON public.waste_villages, public.waste_schedules, public.waste_schedule_exceptions
  FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.waste_villages, public.waste_schedules, public.waste_schedule_exceptions
  TO authenticated;

-- ===========================================================================
-- กองเจ้าของงาน + ตัวตัดสินสิทธิ์
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.waste_owner_department_id(p_municipality_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT department.id
  FROM public.departments AS department
  WHERE department.municipality_id = p_municipality_id
    AND (
      lower(department.code) IN ('health', 'general')
      OR department.name ILIKE '%สาธารณสุข%'
      OR department.name ILIKE '%สำนักปลัด%'
    )
  ORDER BY
    -- กองที่มีคนอยู่จริงมาก่อน — กองสาธารณสุขที่เพิ่งสร้างแต่ยังไม่มีใคร ต้องไม่ดึงสิทธิ์
    -- ออกจากสำนักปลัดจนไม่เหลือใครแก้ตารางได้
    EXISTS (SELECT 1 FROM public.profiles AS profile WHERE profile.department_id = department.id) DESC,
    (lower(department.code) = 'health' OR department.name ILIKE '%สาธารณสุข%') DESC,
    department.sort_order,
    department.id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.waste_owner_department_id(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.can_manage_waste_schedule(p_municipality_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = auth.uid()
      AND p_municipality_id IS NOT NULL
      AND (
        profile.role = 'superadmin'
        OR (
          profile.municipality_id = p_municipality_id
          AND (
            profile.role = 'admin'
            OR (
              profile.role IN ('officer', 'staff')
              AND profile.department_id IS NOT NULL
              AND profile.department_id = public.waste_owner_department_id(p_municipality_id)
            )
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_manage_waste_schedule(uuid) FROM PUBLIC, anon;
-- หน้าเจ้าหน้าที่เรียกเพื่อสลับระหว่างโหมดแก้ไข/อ่านอย่างเดียว (ตัวบังคับจริงคือ RLS ข้างล่าง)
GRANT EXECUTE ON FUNCTION public.can_manage_waste_schedule(uuid) TO authenticated;

-- ===========================================================================
-- RLS — อ่านได้เฉพาะบุคลากรของ อปท. เดียวกัน (ประชาชนอ่านผ่าน RPC) · เขียนตามตัวตัดสินสิทธิ์
-- ===========================================================================
ALTER TABLE public.waste_villages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waste_schedules           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waste_schedule_exceptions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['waste_villages', 'waste_schedules', 'waste_schedule_exceptions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "read %1$s" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "insert %1$s" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "update %1$s" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "delete %1$s" ON public.%1$I', t);

    EXECUTE format($p$
      CREATE POLICY "read %1$s" ON public.%1$I
        FOR SELECT TO authenticated
        USING (
          public.get_my_role() = 'superadmin'
          OR (municipality_id = public.get_my_municipality_id() AND public.get_my_role() <> 'citizen')
        )
    $p$, t);

    EXECUTE format($p$
      CREATE POLICY "insert %1$s" ON public.%1$I
        FOR INSERT TO authenticated
        WITH CHECK (public.can_manage_waste_schedule(municipality_id))
    $p$, t);

    EXECUTE format($p$
      CREATE POLICY "update %1$s" ON public.%1$I
        FOR UPDATE TO authenticated
        USING (public.can_manage_waste_schedule(municipality_id))
        WITH CHECK (public.can_manage_waste_schedule(municipality_id))
    $p$, t);

    EXECUTE format($p$
      CREATE POLICY "delete %1$s" ON public.%1$I
        FOR DELETE TO authenticated
        USING (public.can_manage_waste_schedule(municipality_id))
    $p$, t);
  END LOOP;
END;
$$;

-- ===========================================================================
-- ประทับผู้สร้าง/ผู้แก้จากฝั่งเซิร์ฟเวอร์ + ห้ามย้ายแถวข้าม อปท.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.stamp_waste_schedule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := now();
  ELSE
    NEW.created_by      := OLD.created_by;
    NEW.created_at      := OLD.created_at;
    NEW.municipality_id := OLD.municipality_id;
  END IF;
  NEW.moo_nos    := ARRAY(SELECT DISTINCT unnest(NEW.moo_nos) ORDER BY 1);
  NEW.weekdays   := ARRAY(SELECT DISTINCT unnest(NEW.weekdays) ORDER BY 1);
  NEW.note       := nullif(btrim(NEW.note), '');
  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_waste_schedule() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS stamp_waste_schedule ON public.waste_schedules;
CREATE TRIGGER stamp_waste_schedule
  BEFORE INSERT OR UPDATE ON public.waste_schedules
  FOR EACH ROW EXECUTE FUNCTION public.stamp_waste_schedule();

CREATE OR REPLACE FUNCTION public.stamp_waste_schedule_exception()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := now();
  ELSE
    NEW.created_by      := OLD.created_by;
    NEW.created_at      := OLD.created_at;
    NEW.municipality_id := OLD.municipality_id;
  END IF;
  NEW.moo_nos := ARRAY(SELECT DISTINCT unnest(NEW.moo_nos) ORDER BY 1);
  NEW.reason  := nullif(btrim(NEW.reason), '');
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_waste_schedule_exception() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS stamp_waste_schedule_exception ON public.waste_schedule_exceptions;
CREATE TRIGGER stamp_waste_schedule_exception
  BEFORE INSERT OR UPDATE ON public.waste_schedule_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.stamp_waste_schedule_exception();

CREATE OR REPLACE FUNCTION public.stamp_waste_village()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.municipality_id := OLD.municipality_id;
    NEW.created_at      := OLD.created_at;
  END IF;
  NEW.name := nullif(btrim(NEW.name), '');
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_waste_village() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS stamp_waste_village ON public.waste_villages;
CREATE TRIGGER stamp_waste_village
  BEFORE INSERT OR UPDATE ON public.waste_villages
  FOR EACH ROW EXECUTE FUNCTION public.stamp_waste_village();

-- ===========================================================================
-- RPC ฝั่งประชาชน — ข้อมูลบริการสาธารณะล้วน ไม่มีข้อมูลส่วนบุคคล
-- ไม่คืน created_by/updated_by (ตัวตนเจ้าหน้าที่) และข้อยกเว้นที่ผ่านไปนานแล้ว
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.get_public_waste_schedule(_municipality_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'villages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('moo_no', v.moo_no, 'name', v.name) ORDER BY v.moo_no)
      FROM public.waste_villages AS v
      WHERE v.municipality_id = m.id
    ), '[]'::jsonb),
    'schedules', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'waste_type', s.waste_type, 'moo_nos', s.moo_nos, 'rule', s.rule,
        'interval_weeks', s.interval_weeks, 'weekdays', s.weekdays, 'nth', s.nth,
        'time_from', to_char(s.time_from, 'HH24:MI'), 'time_to', to_char(s.time_to, 'HH24:MI'),
        'holiday_policy', s.holiday_policy, 'starts_on', s.starts_on, 'ends_on', s.ends_on,
        'note', s.note
      ) ORDER BY s.waste_type, s.created_at)
      FROM public.waste_schedules AS s
      WHERE s.municipality_id = m.id
        AND s.is_active
        AND (s.ends_on IS NULL OR s.ends_on >= current_date - 1)
    ), '[]'::jsonb),
    'exceptions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'on_date', e.on_date, 'waste_type', e.waste_type, 'moo_nos', e.moo_nos,
        'action', e.action, 'new_date', e.new_date, 'reason', e.reason
      ) ORDER BY e.on_date)
      FROM public.waste_schedule_exceptions AS e
      WHERE e.municipality_id = m.id
        AND (e.on_date >= current_date - 7 OR e.new_date >= current_date - 1)
    ), '[]'::jsonb)
  )
  FROM public.municipalities AS m
  WHERE m.id = _municipality_id
    AND m.is_active = true;
$$;

REVOKE ALL ON FUNCTION public.get_public_waste_schedule(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_waste_schedule(uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.get_public_waste_schedule(uuid) IS
  'ตารางรอบเก็บขยะฝั่งประชาชน — บังคับระบุ อปท. เสมอ ส่ง NULL ได้ NULL. คืนกฎ ไม่ใช่รายการวันที่ หน้าเว็บคำนวณวันเอง';

COMMIT;
