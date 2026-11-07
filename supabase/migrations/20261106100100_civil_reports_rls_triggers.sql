-- โมดูล "โครงการก่อสร้าง + รายงานผลการก่อสร้างประจำสัปดาห์" ไฟล์ 2/2 — ฟังก์ชันสิทธิ์ ตัวกระตุ้น policy (ตารางอยู่ที่ 20261106100000)
--
-- สิทธิ์ (เจ้าของเลือก "ใช้บทบาท+กองเดิม" 2569-11-06 — ไม่แตะ profiles / admin_update_user ไม่มีคอลัมน์สิทธิ์ใหม่)
--   อ่าน  : superadmin · admin (ทั้ง อปท.) · officer หัวหน้ากอง (เฉพาะกองตน) ·
--           staff/technician ที่อยู่กองเดียวกับโครงการ หรือเป็นผู้สร้างโครงการ หรือถูกระบุเป็นบุคคลของโครงการ (civil_project_people.profile_id)
--   เขียน : superadmin · admin · officer เฉพาะกองตน · staff/technician ที่เป็นผู้สร้างโครงการ หรือถูกระบุเป็น "ผู้ควบคุมงาน" ของโครงการนั้น
--   ลบ    : เฉพาะรายงานรายสัปดาห์ = admin/superadmin เท่านั้น (บันทึกทางราชการ) · รายการงาน/บุคคลลบได้ตามสิทธิ์เขียน
--   viewer (ผู้บริหาร) / council / citizen / anon = ไม่มีสิทธิ์ใดๆ ในเฟสนี้
--   ⚠️ โครงการเก่าที่ department_id เป็น NULL: เห็นเฉพาะ admin/ผู้สร้าง (is_my_department ต้องมีกอง) — admin ระบุกองให้ทีหลังได้
-- ตัวกระตุ้นรายงาน (civil_weekly_reports_guard)
--   - ฉบับใหม่ต้องเริ่มเป็น draft · รหัสผู้สร้างประทับจาก auth.uid() จริง ไม่เชื่อค่าจากเบราว์เซอร์
--   - ล็อก (draft→final): ต้องมีตัวเลขแช่แข็ง (frozen) + สัปดาห์ก่อนหน้าล็อกครบ · เวลา/ผู้ล็อกประทับโดยฐานข้อมูล
--   - final แก้ไม่ได้ ยกเว้นหัวบันทึก (เลขที่/วันที่/เรียน) เพราะเลขหนังสือออกหลังรายงานเสร็จได้
--   - ปลดล็อก (final→draft): เฉพาะ admin/officer ของกองนั้น และต้องไม่มีสัปดาห์หลังจากนี้ที่ล็อกแล้ว (ไล่ปลดจากล่าสุดย้อนขึ้น)
--     ปลดแล้วตัวเลขแช่แข็งถูกล้าง · เหตุผลปลดล็อกบันทึกฝั่งแอปด้วย logAction
--   - ตัวเลข frozen คำนวณจากเบราว์เซอร์ผู้ล็อก (ฐานข้อมูลไม่คำนวณสูตรซ้ำ) → ความน่าเชื่อถือเท่าสิทธิ์เขียน + บันทึกผู้ล็อก/เวลา
BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.civil_weekly_reports') IS NULL
     OR to_regclass('public.civil_project_people') IS NULL
     OR to_regclass('public.civil_project_work_items') IS NULL
     OR to_regclass('public.civil_project_contracts') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261106100000_civil_reports_tables.sql ก่อน';
  END IF;
  IF to_regprocedure('public.is_my_department(uuid,uuid)') IS NULL
     OR to_regprocedure('public.get_my_role()') IS NULL
     OR to_regprocedure('public.get_my_municipality_id()') IS NULL THEN
    RAISE EXCEPTION 'Schema drift: ไม่พบฟังก์ชันสิทธิ์พื้นฐาน (get_my_role / get_my_municipality_id / is_my_department)';
  END IF;
END $guard$;

-- ── ฟังก์ชันสิทธิ์ (ตรรกะอยู่ที่เดียว policy ทุกตารางเรียกใช้) ───────────────────

-- ผู้จัดการโครงการ: superadmin / admin ของ อปท. / officer ของกองที่ถือโครงการ
CREATE OR REPLACE FUNCTION public.civil_can_manage_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.civil_projects AS p
    WHERE p.id = p_project_id
      AND (
        public.get_my_role() = 'superadmin'
        OR (public.get_my_role() = 'admin' AND p.municipality_id = public.get_my_municipality_id())
        OR (public.get_my_role() = 'officer' AND public.is_my_department(p.municipality_id, p.department_id))
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.civil_can_read_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.civil_can_manage_project(p_project_id) OR EXISTS (
    SELECT 1
    FROM public.civil_projects AS p
    WHERE p.id = p_project_id
      AND public.get_my_role() IN ('staff', 'technician')
      AND p.municipality_id = public.get_my_municipality_id()
      AND (
        public.is_my_department(p.municipality_id, p.department_id)
        OR p.created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.civil_project_people AS pp
          WHERE pp.project_id = p.id AND pp.profile_id = auth.uid()
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.civil_can_write_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.civil_can_manage_project(p_project_id) OR EXISTS (
    SELECT 1
    FROM public.civil_projects AS p
    WHERE p.id = p_project_id
      AND public.get_my_role() IN ('staff', 'technician')
      AND p.municipality_id = public.get_my_municipality_id()
      AND (
        p.created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.civil_project_people AS pp
          WHERE pp.project_id = p.id AND pp.profile_id = auth.uid() AND pp.grp = 'supervisor'
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.civil_can_manage_project(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.civil_can_read_project(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.civil_can_write_project(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.civil_can_manage_project(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.civil_can_read_project(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.civil_can_write_project(uuid) TO authenticated;

-- ── ตัวกระตุ้น ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.civil_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.civil_weekly_reports_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL THEN
      NEW.created_by := auth.uid();
    END IF;
    IF NEW.status <> 'draft' OR NEW.frozen IS NOT NULL OR NEW.finalized_at IS NOT NULL OR NEW.finalized_by IS NOT NULL THEN
      RAISE EXCEPTION 'รายงานฉบับใหม่ต้องเริ่มเป็นฉบับร่างก่อน แล้วค่อยล็อก';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.week_no IS DISTINCT FROM OLD.week_no
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'โครงการ เลขสัปดาห์ และผู้สร้างของรายงานเปลี่ยนไม่ได้';
  END IF;

  IF OLD.status = 'final' AND NEW.status = 'final' THEN
    IF (to_jsonb(NEW) - 'memo_no' - 'memo_date' - 'memo_to' - 'updated_at')
       IS DISTINCT FROM (to_jsonb(OLD) - 'memo_no' - 'memo_date' - 'memo_to' - 'updated_at') THEN
      RAISE EXCEPTION 'รายงานที่ล็อกแล้วแก้ไม่ได้ (แก้ได้เฉพาะเลขที่/วันที่/เรียนของบันทึกข้อความ) — ให้หัวหน้ากองหรือผู้ดูแลปลดล็อกก่อน';
    END IF;
  ELSIF OLD.status = 'final' AND NEW.status = 'draft' THEN
    IF auth.uid() IS NOT NULL AND NOT public.civil_can_manage_project(OLD.project_id) THEN
      RAISE EXCEPTION 'เฉพาะหัวหน้ากองหรือผู้ดูแลระบบปลดล็อกรายงานได้';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.civil_weekly_reports AS r
      WHERE r.project_id = OLD.project_id AND r.week_no > OLD.week_no AND r.status = 'final'
    ) THEN
      RAISE EXCEPTION 'ปลดล็อกไม่ได้ เพราะมีสัปดาห์หลังจากนี้ที่ล็อกแล้ว — ให้ปลดจากสัปดาห์ล่าสุดย้อนขึ้นมา';
    END IF;
    NEW.frozen := NULL;
    NEW.finalized_at := NULL;
    NEW.finalized_by := NULL;
  ELSIF OLD.status = 'draft' AND NEW.status = 'final' THEN
    IF NEW.frozen IS NULL OR jsonb_typeof(NEW.frozen -> 'items') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'ล็อกรายงานต้องมีตารางผลงานที่คำนวณไว้ (frozen.items)';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.civil_weekly_reports AS r
      WHERE r.project_id = OLD.project_id AND r.week_no < OLD.week_no AND r.status <> 'final'
    ) THEN
      RAISE EXCEPTION 'ต้องล็อกรายงานสัปดาห์ก่อนหน้าให้ครบก่อน เพราะยอดสะสมต่อกันเป็นลูกโซ่';
    END IF;
    NEW.finalized_at := now();
    NEW.finalized_by := auth.uid();
  ELSE
    -- draft → draft: ตัวเลขแช่แข็งต้องว่างเสมอ
    NEW.frozen := NULL;
    NEW.finalized_at := NULL;
    NEW.finalized_by := NULL;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ลบรายการงานไม่ได้เมื่อมีรายงานที่ล็อกแล้วอ้างถึง (ตัวเลขแช่แข็งอ้างรหัสรายการ)
CREATE OR REPLACE FUNCTION public.civil_work_items_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.civil_weekly_reports AS r
    WHERE r.project_id = OLD.project_id AND r.status = 'final'
  ) THEN
    RAISE EXCEPTION 'ลบรายการงานไม่ได้ เพราะโครงการนี้มีรายงานที่ล็อกแล้ว — ให้ปลดล็อกหรือแก้ชื่อ/สัดส่วนแทน';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.civil_touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.civil_weekly_reports_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.civil_work_items_delete_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS civil_weekly_reports_guard_trigger ON public.civil_weekly_reports;
CREATE TRIGGER civil_weekly_reports_guard_trigger
  BEFORE INSERT OR UPDATE ON public.civil_weekly_reports
  FOR EACH ROW EXECUTE FUNCTION public.civil_weekly_reports_guard();

DROP TRIGGER IF EXISTS civil_work_items_delete_guard_trigger ON public.civil_project_work_items;
CREATE TRIGGER civil_work_items_delete_guard_trigger
  BEFORE DELETE ON public.civil_project_work_items
  FOR EACH ROW EXECUTE FUNCTION public.civil_work_items_delete_guard();

DROP TRIGGER IF EXISTS civil_project_contracts_touch_trigger ON public.civil_project_contracts;
CREATE TRIGGER civil_project_contracts_touch_trigger
  BEFORE UPDATE ON public.civil_project_contracts
  FOR EACH ROW EXECUTE FUNCTION public.civil_touch_updated_at();

-- ── สิทธิ์ตาราง: ถอด anon ทั้งหมด (RLS ไม่กัน TRUNCATE) ให้ authenticated แค่ CRUD แล้วให้ policy คัดกรอง ──
REVOKE ALL ON TABLE public.civil_project_contracts, public.civil_project_people,
  public.civil_project_work_items, public.civil_weekly_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.civil_project_contracts, public.civil_project_people,
  public.civil_project_work_items, public.civil_weekly_reports TO authenticated;

-- ── policy ────────────────────────────────────────────────────────────────

-- สัญญา (1:1): ลบตรงๆ เฉพาะผู้จัดการ (ปกติหายไปพร้อมโครงการผ่าน CASCADE)
DROP POLICY IF EXISTS "civil_contracts_select" ON public.civil_project_contracts;
DROP POLICY IF EXISTS "civil_contracts_insert" ON public.civil_project_contracts;
DROP POLICY IF EXISTS "civil_contracts_update" ON public.civil_project_contracts;
DROP POLICY IF EXISTS "civil_contracts_delete" ON public.civil_project_contracts;
CREATE POLICY "civil_contracts_select" ON public.civil_project_contracts
  FOR SELECT TO authenticated USING (public.civil_can_read_project(project_id));
CREATE POLICY "civil_contracts_insert" ON public.civil_project_contracts
  FOR INSERT TO authenticated WITH CHECK (public.civil_can_write_project(project_id));
CREATE POLICY "civil_contracts_update" ON public.civil_project_contracts
  FOR UPDATE TO authenticated
  USING (public.civil_can_write_project(project_id))
  WITH CHECK (public.civil_can_write_project(project_id));
CREATE POLICY "civil_contracts_delete" ON public.civil_project_contracts
  FOR DELETE TO authenticated USING (public.civil_can_manage_project(project_id));

-- บุคคลของโครงการ
DROP POLICY IF EXISTS "civil_people_select" ON public.civil_project_people;
DROP POLICY IF EXISTS "civil_people_insert" ON public.civil_project_people;
DROP POLICY IF EXISTS "civil_people_update" ON public.civil_project_people;
DROP POLICY IF EXISTS "civil_people_delete" ON public.civil_project_people;
CREATE POLICY "civil_people_select" ON public.civil_project_people
  FOR SELECT TO authenticated USING (public.civil_can_read_project(project_id));
CREATE POLICY "civil_people_insert" ON public.civil_project_people
  FOR INSERT TO authenticated WITH CHECK (public.civil_can_write_project(project_id));
CREATE POLICY "civil_people_update" ON public.civil_project_people
  FOR UPDATE TO authenticated
  USING (public.civil_can_write_project(project_id))
  WITH CHECK (public.civil_can_write_project(project_id));
CREATE POLICY "civil_people_delete" ON public.civil_project_people
  FOR DELETE TO authenticated USING (public.civil_can_write_project(project_id));

-- รายการงาน
DROP POLICY IF EXISTS "civil_work_items_select" ON public.civil_project_work_items;
DROP POLICY IF EXISTS "civil_work_items_insert" ON public.civil_project_work_items;
DROP POLICY IF EXISTS "civil_work_items_update" ON public.civil_project_work_items;
DROP POLICY IF EXISTS "civil_work_items_delete" ON public.civil_project_work_items;
CREATE POLICY "civil_work_items_select" ON public.civil_project_work_items
  FOR SELECT TO authenticated USING (public.civil_can_read_project(project_id));
CREATE POLICY "civil_work_items_insert" ON public.civil_project_work_items
  FOR INSERT TO authenticated WITH CHECK (public.civil_can_write_project(project_id));
CREATE POLICY "civil_work_items_update" ON public.civil_project_work_items
  FOR UPDATE TO authenticated
  USING (public.civil_can_write_project(project_id))
  WITH CHECK (public.civil_can_write_project(project_id));
CREATE POLICY "civil_work_items_delete" ON public.civil_project_work_items
  FOR DELETE TO authenticated USING (public.civil_can_write_project(project_id));

-- รายงานรายสัปดาห์: ลบได้เฉพาะ admin/superadmin ที่เห็นโครงการนั้น (บันทึกทางราชการ)
DROP POLICY IF EXISTS "civil_reports_select" ON public.civil_weekly_reports;
DROP POLICY IF EXISTS "civil_reports_insert" ON public.civil_weekly_reports;
DROP POLICY IF EXISTS "civil_reports_update" ON public.civil_weekly_reports;
DROP POLICY IF EXISTS "civil_reports_delete" ON public.civil_weekly_reports;
CREATE POLICY "civil_reports_select" ON public.civil_weekly_reports
  FOR SELECT TO authenticated USING (public.civil_can_read_project(project_id));
CREATE POLICY "civil_reports_insert" ON public.civil_weekly_reports
  FOR INSERT TO authenticated WITH CHECK (public.civil_can_write_project(project_id));
CREATE POLICY "civil_reports_update" ON public.civil_weekly_reports
  FOR UPDATE TO authenticated
  USING (public.civil_can_write_project(project_id))
  WITH CHECK (public.civil_can_write_project(project_id));
CREATE POLICY "civil_reports_delete" ON public.civil_weekly_reports
  FOR DELETE TO authenticated
  USING (public.get_my_role() IN ('admin', 'superadmin') AND public.civil_can_manage_project(project_id));

COMMIT;
