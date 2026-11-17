-- ค้นหาบริการ + คำถามที่พบบ่อย + คลังแบบฟอร์ม — เฟส 2/3: RLS + สิทธิ์ + trigger
-- ต้องรันหลัง 20261203100000_service_help_tables.sql
--
-- สิทธิ์ยึดแบบเดียวกับข่าวสาร (20260802060000 "department scoped ... posts"):
--   ประชาชน/ไม่ล็อกอิน  อ่านได้เฉพาะแถว is_published = true
--   บทบาทภายใน          อ่านทุกแถวของ อปท. ตัวเอง (รวมฉบับร่าง)
--   admin               เขียนได้ทั้ง อปท.
--   officer (ธุรการกอง)  เขียนได้เฉพาะแถวของกองตัวเอง
--   staff               เพิ่มได้ในกองตัวเอง · แก้/ลบได้เฉพาะแถวที่ตัวเองสร้าง
--   superadmin          ทุก อปท.
-- ไม่ให้ TRUNCATE/REFERENCES/TRIGGER กับใคร (RLS ไม่กัน TRUNCATE)

DO $$
BEGIN
  IF to_regclass('public.service_forms') IS NULL OR to_regclass('public.service_faqs') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261203100000_service_help_tables.sql ก่อน';
  END IF;
  IF to_regprocedure('public.protect_department_record_scope()') IS NULL
     OR to_regprocedure('public.is_my_department(uuid,uuid)') IS NULL
     OR to_regprocedure('public.department_belongs_to_municipality(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบฟังก์ชันตรวจสิทธิ์รายกอง (20260802060000) — หยุดก่อน';
  END IF;
END $$;

-- ── สิทธิ์ระดับตาราง (RLS เป็นด่านที่สอง) ─────────────────────────────────────────────────
-- REVOKE ซ้ำที่นี่ด้วย (ผลตรวจ M1): ถ้าตารางมีอยู่ก่อน IF NOT EXISTS ในไฟล์ 1 ข้ามไป และสิทธิ์ ALL ของ Supabase ยังติดอยู่
-- ด่านท้ายไฟล์ตรวจผลจริงด้วย has_table_privilege อีกชั้น (REVOKE โดยผู้ที่ไม่ใช่ grantor ไม่ error แต่ไม่มีผล)
REVOKE ALL ON TABLE public.service_forms, public.service_faqs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.service_forms, public.service_faqs TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.service_forms, public.service_faqs TO authenticated;

-- ── trigger: เวลาแก้ไขล่าสุด + ผู้แก้ (ตั้งที่เซิร์ฟเวอร์ ไม่เชื่อค่าจาก client) ─────────────────
CREATE OR REPLACE FUNCTION public.touch_service_help_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  -- เวลาสร้างตั้งที่เซิร์ฟเวอร์เสมอ ไม่รับค่าย้อนหลังจาก client (ผลตรวจ L1)
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
  ELSE
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.touch_service_help_row() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS touch_service_forms_trigger ON public.service_forms;
CREATE TRIGGER touch_service_forms_trigger
  BEFORE INSERT OR UPDATE ON public.service_forms
  FOR EACH ROW EXECUTE FUNCTION public.touch_service_help_row();

DROP TRIGGER IF EXISTS touch_service_faqs_trigger ON public.service_faqs;
CREATE TRIGGER touch_service_faqs_trigger
  BEFORE INSERT OR UPDATE ON public.service_faqs
  FOR EACH ROW EXECUTE FUNCTION public.touch_service_help_row();

-- กันผู้ไม่ใช่ admin ย้ายแถวข้าม อปท./กอง หรือเปลี่ยนผู้สร้าง (ฟังก์ชันเดิม ไม่แก้เนื้อ)
DROP TRIGGER IF EXISTS protect_service_forms_scope_trigger ON public.service_forms;
CREATE TRIGGER protect_service_forms_scope_trigger
  BEFORE UPDATE ON public.service_forms
  FOR EACH ROW EXECUTE FUNCTION public.protect_department_record_scope();

DROP TRIGGER IF EXISTS protect_service_faqs_scope_trigger ON public.service_faqs;
CREATE TRIGGER protect_service_faqs_scope_trigger
  BEFORE UPDATE ON public.service_faqs
  FOR EACH ROW EXECUTE FUNCTION public.protect_department_record_scope();

-- ── RLS: service_forms ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "public read published service_forms" ON public.service_forms;
DROP POLICY IF EXISTS "internal read municipality service_forms" ON public.service_forms;
DROP POLICY IF EXISTS "department scoped insert service_forms" ON public.service_forms;
DROP POLICY IF EXISTS "department scoped update service_forms" ON public.service_forms;
DROP POLICY IF EXISTS "department scoped delete service_forms" ON public.service_forms;

CREATE POLICY "public read published service_forms" ON public.service_forms
  FOR SELECT TO anon, authenticated
  USING (is_published = true);

CREATE POLICY "internal read municipality service_forms" ON public.service_forms
  FOR SELECT TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin', 'officer', 'staff', 'viewer', 'council', 'technician')
      AND municipality_id = get_my_municipality_id()
    )
  );

CREATE POLICY "department scoped insert service_forms" ON public.service_forms
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.department_belongs_to_municipality(department_id, municipality_id)
    AND (
      get_my_role() = 'superadmin'
      OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
      OR (get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
      OR (
        get_my_role() = 'staff'
        AND municipality_id = get_my_municipality_id()
        AND department_id IS NOT DISTINCT FROM get_my_department_id()
      )
    )
  );

CREATE POLICY "department scoped update service_forms" ON public.service_forms
  FOR UPDATE TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
    OR (get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
    OR (get_my_role() = 'staff' AND municipality_id = get_my_municipality_id() AND created_by = auth.uid())
  )
  WITH CHECK (
    public.department_belongs_to_municipality(department_id, municipality_id)
    AND (
      get_my_role() = 'superadmin'
      OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
      OR (get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
      OR (get_my_role() = 'staff' AND municipality_id = get_my_municipality_id() AND created_by = auth.uid())
    )
  );

CREATE POLICY "department scoped delete service_forms" ON public.service_forms
  FOR DELETE TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
    OR (get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
    OR (get_my_role() = 'staff' AND municipality_id = get_my_municipality_id() AND created_by = auth.uid())
  );

-- ── RLS: service_faqs (เงื่อนไขเดียวกันทุกข้อ) ─────────────────────────────────────────────
DROP POLICY IF EXISTS "public read published service_faqs" ON public.service_faqs;
DROP POLICY IF EXISTS "internal read municipality service_faqs" ON public.service_faqs;
DROP POLICY IF EXISTS "department scoped insert service_faqs" ON public.service_faqs;
DROP POLICY IF EXISTS "department scoped update service_faqs" ON public.service_faqs;
DROP POLICY IF EXISTS "department scoped delete service_faqs" ON public.service_faqs;

CREATE POLICY "public read published service_faqs" ON public.service_faqs
  FOR SELECT TO anon, authenticated
  USING (is_published = true);

CREATE POLICY "internal read municipality service_faqs" ON public.service_faqs
  FOR SELECT TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin', 'officer', 'staff', 'viewer', 'council', 'technician')
      AND municipality_id = get_my_municipality_id()
    )
  );

CREATE POLICY "department scoped insert service_faqs" ON public.service_faqs
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.department_belongs_to_municipality(department_id, municipality_id)
    AND (
      get_my_role() = 'superadmin'
      OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
      OR (get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
      OR (
        get_my_role() = 'staff'
        AND municipality_id = get_my_municipality_id()
        AND department_id IS NOT DISTINCT FROM get_my_department_id()
      )
    )
  );

CREATE POLICY "department scoped update service_faqs" ON public.service_faqs
  FOR UPDATE TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
    OR (get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
    OR (get_my_role() = 'staff' AND municipality_id = get_my_municipality_id() AND created_by = auth.uid())
  )
  WITH CHECK (
    public.department_belongs_to_municipality(department_id, municipality_id)
    AND (
      get_my_role() = 'superadmin'
      OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
      OR (get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
      OR (get_my_role() = 'staff' AND municipality_id = get_my_municipality_id() AND created_by = auth.uid())
    )
  );

CREATE POLICY "department scoped delete service_faqs" ON public.service_faqs
  FOR DELETE TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
    OR (get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
    OR (get_my_role() = 'staff' AND municipality_id = get_my_municipality_id() AND created_by = auth.uid())
  );

-- ── ด่านท้ายไฟล์: ตรวจผลจริง ไม่ตรง = ยกเลิกทั้งไฟล์ (แบบ 20261126100000) ─────────────────────
DO $$
DECLARE
  t regclass;
  v_policies integer;
BEGIN
  FOREACH t IN ARRAY ARRAY['public.service_forms'::regclass, 'public.service_faqs'::regclass] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = t) THEN
      RAISE EXCEPTION '% ยังไม่ได้เปิด RLS', t;
    END IF;
    IF NOT has_table_privilege('anon', t, 'SELECT') THEN
      RAISE EXCEPTION 'anon อ่าน % ไม่ได้ — หน้าค้นหาจะว่างทุก อปท.', t;
    END IF;
    IF has_table_privilege('anon', t, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'anon ยังมีสิทธิ์เขียน/TRUNCATE บน % (REVOKE ไม่มีผล — ตรวจ grantor)', t;
    END IF;
    IF has_table_privilege('authenticated', t, 'TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'authenticated ยังมี TRUNCATE/REFERENCES/TRIGGER บน %', t;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_policies
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN ('service_forms', 'service_faqs');
  IF v_policies <> 10 THEN
    RAISE EXCEPTION 'policy ของ 2 ตารางต้องมี 10 พบ %', v_policies;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ตรวจหลัง apply (อ่านอย่างเดียว) — ต้องได้ true/false ตามนี้:
--   select has_table_privilege('anon', 'public.service_forms', 'SELECT')          → true
--   select has_table_privilege('anon', 'public.service_forms', 'INSERT')          → false
--   select has_table_privilege('authenticated', 'public.service_faqs', 'TRUNCATE') → false
--   select count(*) from pg_policies where tablename in ('service_forms','service_faqs') → 10
