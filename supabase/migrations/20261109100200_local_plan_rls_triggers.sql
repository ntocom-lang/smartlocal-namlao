-- เมนู "แผนพัฒนาท้องถิ่น" ไฟล์ 3/3 — FK ระหว่างตารางใหม่ · ฟังก์ชันสิทธิ์ · trigger · RPC ประกาศ/ยกเลิกประกาศ · policy
--   ต้องรัน 20261109100000 (plan_role) และ 20261109100100 (ตาราง) ก่อน
--
-- 1) สิทธิ์ (เจ้าของระบบอนุมัติ 2569-11-08)
--      ผู้จัดการแผน = superadmin · admin ของ อปท. · ผู้ถือ plan_role = 'plan_admin' (role admin/officer/staff) ของ อปท. นั้น
--        → เขียนได้ทุกตาราง ทุกช่อง (ภายใต้กติกาล็อกข้อ 3)
--      กองผู้รับผิดชอบ (officer/staff ของกองที่ระบุในรายการ) → แก้รายการในแผนดำเนินงาน "ฉบับร่าง" ของกองตัวเองได้
--        เฉพาะ เดือนเริ่ม–สิ้นสุด และหมายเหตุ · งบประมาณแก้ได้เฉพาะผู้จัดการแผน (ต้องตรงเทศบัญญัติ) · เพิ่ม/ลบแถวไม่ได้
--      อ่าน: ผู้จัดการแผน + เจ้าหน้าที่ทุกคนของ อปท. ตัวเอง (officer/staff/technician) + ผู้บริหาร (viewer)
--        council / citizen / anon ไม่ได้ (หน้าประชาชนของแผนที่ประกาศแล้วเป็นงานเฟสหลัง)
-- 2) อปท. ของแถวลูกระบบคัดจากแม่เสมอ (ส่งค่าอื่นมาก็ถูกทับ) — policy WITH CHECK ตรวจหลัง BEFORE trigger จึงตรวจกับ อปท. จริงของแม่
--    กองต้องเป็นของ อปท. เดียวกัน · รายการที่ผูกทะเบียนต้องผูกโครงการของแผนพัฒนาฉบับเดียวกับแผนดำเนินงาน แล้วชื่อรายการ = ชื่อทางการ
-- 3) ล็อก
--      แผนพัฒนาที่ประกาศแล้ว: ช่วงปี/ชื่อแผนแก้ไม่ได้ · โครงการเดิมของแผน (added_in_revision = 0) แก้ชื่อ/รหัส/ยุทธศาสตร์/สถานะ/วงเงินรายปีไม่ได้
--        ลบไม่ได้ (เปลี่ยนกองผู้รับผิดชอบ/หมายเหตุได้) · เพิ่มโครงการใหม่ได้เฉพาะเมื่อระบุการเพิ่มเติม/เปลี่ยนแปลงครั้งที่ ≥ 1 + เลขที่ประกาศ
--        (ข้อ 22) — ⚠️ ข้อห้าม "แผนเหลืออายุไม่ถึง 180 วัน" ยังไม่บล็อกในฐานข้อมูล หน้าจอเตือนแทน (วันประกาศมักบันทึกย้อนหลัง)
--      โครงการที่ถูกรายการในแผนดำเนินงานฉบับประกาศอ้างถึง: แก้ชื่อ/รหัส/ยุทธศาสตร์/สถานะ/วงเงินรายปีไม่ได้ ลบไม่ได้ ไม่ว่าเป็นโครงการเดิม
--        หรือโครงการเพิ่มเติม และไม่ว่าแผนพัฒนาประกาศแล้วหรือไม่ (ทะเบียนต้องตรงกับเอกสารที่ประกาศ) · ยกเลิกประกาศฉบับนั้นแล้วล็อกหลุดเอง
--      แผนดำเนินงานที่ประกาศแล้ว: แช่แข็งทั้งฉบับและทุกรายการ (แก้ได้เฉพาะหมายเหตุของฉบับ) — แก้ต้องทำฉบับเพิ่มเติม/แก้ไขครั้งถัดไป
--      ล็อกนี้ใช้กับผู้ล็อกอินทุกคนรวม superadmin · ผู้ดูแลฐานข้อมูล (ไม่มีผู้ล็อกอิน) แก้ตรงได้สำหรับกรณีจำเป็นจริง
-- 4) ประกาศ / ยกเลิกประกาศ ทำได้ทางเดียวผ่าน RPC local_dev_plan_set_status / local_op_plan_set_status (ผู้จัดการแผนเท่านั้น)
--      ประกาศ: ต้องมีวันที่ลงนามประกาศ (ไม่เกินวันนี้ เวลาไทย)
--      ยกเลิกประกาศ (เผื่อกดพลาด — เจ้าของอนุมัติ 2569-11-08): ต้องมีเหตุผล ลงประวัติเสมอ และทำไม่ได้เมื่อ
--        แผนพัฒนา: มีโครงการที่เพิ่มในการเพิ่มเติม/เปลี่ยนแปลงแล้ว หรือมีแผนดำเนินงานที่ประกาศแล้วอ้างแผนนี้
--        แผนดำเนินงาน: มีฉบับครั้งถัดไปของปีเดียวกันที่ประกาศแล้ว
--      บริบท (ธง/เหตุผล) ส่งให้ trigger ผ่านค่าตั้งค่าของ transaction (set_config แบบ local) — ผู้ใช้ตั้งเองไม่ได้ เพราะ PostgREST
--      ไม่เปิดฟังก์ชันใน pg_catalog (แนวเดียวกับ civil_stage_context 20261108100200)
-- 5) ประวัติ local_plan_events: trigger เขียนทุกการเพิ่ม/แก้/ลบ (ค่าเดิม → ค่าใหม่ เฉพาะช่องที่เปลี่ยน) ผู้ใช้อ่านได้อย่างเดียว
--      ไม่ลงประวัติการลากเรียง (sort_order) · ลบ อปท. ทั้งแถว (cascade) ไม่ลงประวัติ (ไม่งั้นลบ อปท. ไม่ได้เพราะ FK)
-- 6) ถอน TRUNCATE / REFERENCES / TRIGGER ของ authenticated ทุกตาราง (RLS และ trigger กัน TRUNCATE ไม่ได้ — #657)
--
-- ⚠️ ยังไม่ใส่ FK civil_projects.registry_ref → local_dev_plan_projects(id) (โมดูลก่อสร้างอยู่ในความดูแลของงานอื่น รออนุญาต)
--
-- ย้อนกลับ: DROP TABLE local_plan_events, local_op_plan_items, local_op_plans, local_dev_plan_project_years,
--           local_dev_plan_projects, local_dev_plans (เสียเฉพาะข้อมูลของเมนูนี้) แล้ว DROP FUNCTION ทุกตัวที่ชื่อขึ้นต้น local_ (local_plan_*, local_*_guard, local_dev_plan_projects_sync_name, local_*_set_status)
--           ไฟล์ 1 ย้อนแยก (ดูหัวไฟล์ 20261109100000)
BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.local_dev_plans') IS NULL OR to_regclass('public.local_dev_plan_projects') IS NULL
     OR to_regclass('public.local_dev_plan_project_years') IS NULL OR to_regclass('public.local_op_plans') IS NULL
     OR to_regclass('public.local_op_plan_items') IS NULL OR to_regclass('public.local_plan_events') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261109100100_local_plan_tables.sql ก่อน (ไม่พบตารางใหม่ครบ 6 ตาราง)';
  END IF;
  IF position('plan_role' IN pg_get_functiondef('public.guard_profile_privileged_update()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'ต้องรัน 20261109100000_profiles_plan_role.sql ก่อน (ด่านกัน profiles ยังไม่รู้จัก plan_role)';
  END IF;
  IF to_regprocedure('public.is_my_department(uuid,uuid)') IS NULL
     OR to_regprocedure('public.get_my_role()') IS NULL
     OR to_regprocedure('public.get_my_municipality_id()') IS NULL THEN
    RAISE EXCEPTION 'Schema drift: ไม่พบฟังก์ชันสิทธิ์พื้นฐาน (get_my_role / get_my_municipality_id / is_my_department)';
  END IF;
END $guard$;

-- ── FK ระหว่างตารางใหม่ ───────────────────────────────────────────────────────────
DO $fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'local_dev_plan_projects_dev_plan_fk') THEN
    ALTER TABLE public.local_dev_plan_projects ADD CONSTRAINT local_dev_plan_projects_dev_plan_fk
      FOREIGN KEY (dev_plan_id) REFERENCES public.local_dev_plans(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'local_dev_plan_project_years_project_fk') THEN
    ALTER TABLE public.local_dev_plan_project_years ADD CONSTRAINT local_dev_plan_project_years_project_fk
      FOREIGN KEY (project_id) REFERENCES public.local_dev_plan_projects(id) ON DELETE CASCADE;
  END IF;
  -- แผนพัฒนาที่มีแผนดำเนินงานอ้างอยู่ ลบไม่ได้
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'local_op_plans_dev_plan_fk') THEN
    ALTER TABLE public.local_op_plans ADD CONSTRAINT local_op_plans_dev_plan_fk
      FOREIGN KEY (dev_plan_id) REFERENCES public.local_dev_plans(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'local_op_plan_items_op_plan_fk') THEN
    ALTER TABLE public.local_op_plan_items ADD CONSTRAINT local_op_plan_items_op_plan_fk
      FOREIGN KEY (op_plan_id) REFERENCES public.local_op_plans(id) ON DELETE CASCADE;
  END IF;
  -- โครงการที่แผนดำเนินงานใช้อยู่ ลบไม่ได้ (ไม่ปล่อยให้รายการหลุดจากทะเบียนเงียบๆ)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'local_op_plan_items_dev_project_fk') THEN
    ALTER TABLE public.local_op_plan_items ADD CONSTRAINT local_op_plan_items_dev_project_fk
      FOREIGN KEY (dev_project_id) REFERENCES public.local_dev_plan_projects(id) ON DELETE RESTRICT;
  END IF;
END $fk$;

-- ── ฟังก์ชันสิทธิ์ (policy เรียก — ตัดสินจากค่าในแถว ไม่ไล่ถามตารางแม่) ───────────────
CREATE OR REPLACE FUNCTION public.local_plan_is_manager(p_municipality_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(
    public.get_my_role() = 'superadmin'
    OR (
      p_municipality_id IS NOT NULL
      AND p_municipality_id = public.get_my_municipality_id()
      AND (
        public.get_my_role() = 'admin'
        -- ตรวจ role ซ้ำ: กันค่าที่ค้างจากการแก้ตรงในฐานข้อมูล (admin_update_user ล้างให้อยู่แล้ว)
        OR EXISTS (SELECT 1 FROM public.profiles AS pr
                   WHERE pr.id = auth.uid() AND pr.plan_role = 'plan_admin' AND pr.role IN ('admin', 'officer', 'staff'))
      )
    ),
    false);
$$;

CREATE OR REPLACE FUNCTION public.local_plan_can_read(p_municipality_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.local_plan_is_manager(p_municipality_id) OR coalesce(
    p_municipality_id IS NOT NULL
    AND p_municipality_id = public.get_my_municipality_id()
    AND public.get_my_role() IN ('officer', 'staff', 'technician', 'viewer'),
    false);
$$;

-- กองผู้รับผิดชอบของรายการ (แก้เดือน/หมายเหตุ — trigger จำกัดช่อง)
CREATE OR REPLACE FUNCTION public.local_plan_dept_can_edit(p_municipality_id uuid, p_department_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(public.get_my_role() IN ('officer', 'staff') AND public.is_my_department(p_municipality_id, p_department_id), false);
$$;

REVOKE ALL ON FUNCTION public.local_plan_is_manager(uuid), public.local_plan_can_read(uuid),
  public.local_plan_dept_can_edit(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.local_plan_is_manager(uuid), public.local_plan_can_read(uuid),
  public.local_plan_dept_can_edit(uuid, uuid) TO authenticated;

-- ── ตัวช่วยของ trigger ────────────────────────────────────────────────────────────
-- ช่องที่เปลี่ยน (ไม่นับช่องประทับเวลา/ผู้แก้) นอกเหนือจาก p_allowed → คืนชื่อช่องแรกที่เปลี่ยน / NULL = ไม่มี
CREATE OR REPLACE FUNCTION public.local_plan_changed_outside(p_old jsonb, p_new jsonb, p_allowed text[])
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT k FROM jsonb_object_keys(p_new) AS k
  WHERE k <> ALL (p_allowed || ARRAY['updated_at', 'updated_by'])
    AND (p_new -> k) IS DISTINCT FROM (p_old -> k)
  ORDER BY k LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.local_plan_changed_outside(jsonb, jsonb, text[]) FROM PUBLIC, anon, authenticated;

-- โครงการนี้ถูกรายการในแผนการดำเนินงานที่ประกาศแล้วอ้างถึงไหม (เจ้าของอนุมัติ 2569-11-08)
CREATE OR REPLACE FUNCTION public.local_dev_project_in_published_op(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.local_op_plan_items AS i
    JOIN public.local_op_plans AS o ON o.id = i.op_plan_id
    WHERE i.dev_project_id = p_project_id AND o.status = 'published'
  );
$$;
REVOKE ALL ON FUNCTION public.local_dev_project_in_published_op(uuid) FROM PUBLIC, anon, authenticated;

-- ประทับผู้สร้าง/ผู้แก้/เวลา (ตารางที่มี created_by/created_at) — ผู้ใช้ปลอมค่าไม่ได้
CREATE OR REPLACE FUNCTION public.local_plan_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL THEN NEW.created_by := auth.uid(); END IF;
    NEW.created_at := now();
  ELSE
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  NEW.updated_by := coalesce(auth.uid(), CASE WHEN TG_OP = 'INSERT' THEN NEW.updated_by ELSE OLD.updated_by END);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.local_plan_stamp() FROM PUBLIC, anon, authenticated;

-- ── 1) แผนพัฒนา ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.local_dev_plans_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user boolean := auth.uid() IS NOT NULL;
  v_rpc  boolean := coalesce(current_setting('local_plan.status_rpc', true), '') = 'on';
  v_col  text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF v_user AND OLD.status = 'published' THEN
      RAISE EXCEPTION 'แผนพัฒนาที่ประกาศใช้แล้วลบไม่ได้' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_user AND NOT v_rpc AND (NEW.status <> 'draft' OR NEW.published_on IS NOT NULL OR NEW.published_by IS NOT NULL
                                 OR NEW.announce_ref_no IS NOT NULL) THEN
      RAISE EXCEPTION 'สร้างแผนเป็นฉบับร่างก่อน แล้วประกาศผ่านปุ่มประกาศใช้ (local_dev_plan_set_status)' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.municipality_id IS DISTINCT FROM OLD.municipality_id THEN
      RAISE EXCEPTION 'ย้ายแผนข้าม อปท. ไม่ได้' USING ERRCODE = '42501';
    END IF;
    IF v_user AND NOT v_rpc THEN
      IF NEW.status IS DISTINCT FROM OLD.status OR NEW.published_on IS DISTINCT FROM OLD.published_on
         OR NEW.published_by IS DISTINCT FROM OLD.published_by OR NEW.announce_ref_no IS DISTINCT FROM OLD.announce_ref_no THEN
        RAISE EXCEPTION 'สถานะประกาศเปลี่ยนได้ทางปุ่มประกาศใช้/ยกเลิกประกาศเท่านั้น (local_dev_plan_set_status)' USING ERRCODE = '42501';
      END IF;
      IF OLD.status = 'published' THEN
        v_col := public.local_plan_changed_outside(to_jsonb(OLD), to_jsonb(NEW), ARRAY['note', 'is_current']);
        IF v_col IS NOT NULL THEN
          RAISE EXCEPTION 'แผนพัฒนาที่ประกาศใช้แล้วแก้ช่อง % ไม่ได้ (แก้ได้เฉพาะหมายเหตุ / ฉบับที่เมนูแสดง)', v_col USING ERRCODE = '42501';
        END IF;
      END IF;
    END IF;
    -- หดช่วงปีแล้วมีข้อมูลตกขอบ = ห้าม (ข้อมูลจะอ้างปีที่ไม่อยู่ในแผน)
    IF NEW.year_from <> OLD.year_from OR NEW.year_to <> OLD.year_to THEN
      IF EXISTS (SELECT 1 FROM public.local_dev_plan_project_years AS y
                 JOIN public.local_dev_plan_projects AS p ON p.id = y.project_id
                 WHERE p.dev_plan_id = NEW.id AND y.fiscal_year NOT BETWEEN NEW.year_from AND NEW.year_to)
         OR EXISTS (SELECT 1 FROM public.local_op_plans AS o
                    WHERE o.dev_plan_id = NEW.id AND o.fiscal_year NOT BETWEEN NEW.year_from AND NEW.year_to) THEN
        RAISE EXCEPTION 'เปลี่ยนช่วงปีไม่ได้: มีวงเงินรายปีหรือแผนดำเนินงานอยู่นอกช่วง % – %', NEW.year_from, NEW.year_to;
      END IF;
    END IF;
  END IF;

  -- ฉบับที่เมนูแสดงมีได้ฉบับเดียวต่อ อปท. — ตั้งฉบับนี้แล้วปลดฉบับอื่นให้เอง
  IF NEW.is_current AND (TG_OP = 'INSERT' OR NOT OLD.is_current) THEN
    UPDATE public.local_dev_plans SET is_current = false
     WHERE municipality_id = NEW.municipality_id AND id <> NEW.id AND is_current;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.local_dev_plans_guard() FROM PUBLIC, anon, authenticated;

-- ── 2) ทะเบียนโครงการ ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.local_dev_plan_projects_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user   boolean := auth.uid() IS NOT NULL;
  v_muni   uuid;
  v_status text;
  v_col    text;
BEGIN
  SELECT municipality_id, status INTO v_muni, v_status
  FROM public.local_dev_plans WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.dev_plan_id ELSE NEW.dev_plan_id END
  FOR SHARE;                                      -- กันแก้แถวพร้อมกับที่มีคนกดประกาศ (RPC ถือ FOR UPDATE)

  IF TG_OP = 'DELETE' THEN
    -- v_status ว่าง = แผนแม่กำลังถูกลบ (cascade จากแผนฉบับร่าง) → ปล่อย
    IF v_user AND v_status = 'published' AND OLD.added_in_revision = 0 THEN
      RAISE EXCEPTION 'โครงการในแผนพัฒนาที่ประกาศใช้แล้วลบไม่ได้ — เปลี่ยนแปลงแผนตามข้อ 22 แล้วบันทึกสถานะแทน' USING ERRCODE = '42501';
    END IF;
    IF v_user AND public.local_dev_project_in_published_op(OLD.id) THEN
      RAISE EXCEPTION 'โครงการนี้ถูกอ้างในแผนการดำเนินงานที่ประกาศแล้ว ลบไม่ได้' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  IF v_muni IS NULL THEN
    RAISE EXCEPTION 'ไม่พบแผนพัฒนาที่ระบุ' USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.municipality_id := v_muni;                -- คัดจากแผนเสมอ (policy ตรวจกับค่านี้)
    IF v_user AND v_status = 'published'
       AND (NEW.added_in_revision < 1 OR length(btrim(coalesce(NEW.revision_ref_no, ''))) = 0) THEN
      RAISE EXCEPTION 'แผนประกาศใช้แล้ว: เพิ่มโครงการได้เฉพาะการเพิ่มเติม/เปลี่ยนแปลงแผน — ระบุครั้งที่ และเลขที่ประกาศ' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.dev_plan_id IS DISTINCT FROM OLD.dev_plan_id OR NEW.municipality_id IS DISTINCT FROM OLD.municipality_id THEN
      RAISE EXCEPTION 'ย้ายโครงการข้ามแผน/ข้าม อปท. ไม่ได้' USING ERRCODE = '42501';
    END IF;
    IF v_user AND v_status = 'published' THEN
      IF OLD.added_in_revision = 0 THEN
        v_col := public.local_plan_changed_outside(to_jsonb(OLD), to_jsonb(NEW), ARRAY['department_id', 'note']);
        IF v_col IS NOT NULL THEN
          RAISE EXCEPTION 'โครงการในแผนที่ประกาศใช้แล้วแก้ช่อง % ไม่ได้ (แก้ได้เฉพาะกองผู้รับผิดชอบ / หมายเหตุ)', v_col USING ERRCODE = '42501';
        END IF;
      ELSIF NEW.added_in_revision < 1 OR length(btrim(coalesce(NEW.revision_ref_no, ''))) = 0 THEN
        RAISE EXCEPTION 'โครงการที่เพิ่มในการเพิ่มเติม/เปลี่ยนแปลงแผน ต้องคงครั้งที่ และเลขที่ประกาศ' USING ERRCODE = '42501';
      END IF;
    END IF;
    -- ถูกใช้ในเอกสารที่ประกาศแล้ว ทะเบียนต้องตรงกับเอกสารนั้น (ครอบโครงการเพิ่มเติม และแผนพัฒนาที่ยังเป็นร่าง)
    IF v_user AND public.local_dev_project_in_published_op(OLD.id) THEN
      v_col := public.local_plan_changed_outside(to_jsonb(OLD), to_jsonb(NEW), ARRAY['department_id', 'note']);
      IF v_col IS NOT NULL THEN
        RAISE EXCEPTION 'โครงการนี้ถูกอ้างในแผนการดำเนินงานที่ประกาศแล้ว แก้ช่อง % ไม่ได้ (แก้ได้เฉพาะกองผู้รับผิดชอบ / หมายเหตุ)', v_col USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  IF NEW.department_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.departments AS d WHERE d.id = NEW.department_id AND d.municipality_id = NEW.municipality_id) THEN
    RAISE EXCEPTION 'กองผู้รับผิดชอบไม่ใช่ของ อปท. นี้' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.local_dev_plan_projects_guard() FROM PUBLIC, anon, authenticated;

-- ชื่อทางการเปลี่ยน → รายการในแผนดำเนินงาน "ฉบับร่าง" ที่ผูกโครงการนี้ใช้ชื่อใหม่ตาม (ฉบับประกาศแล้วคงชื่อตอนประกาศ)
CREATE OR REPLACE FUNCTION public.local_dev_plan_projects_sync_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.local_op_plan_items AS i
     SET item_name = NEW.official_name
    FROM public.local_op_plans AS o
   WHERE i.dev_project_id = NEW.id AND o.id = i.op_plan_id AND o.status = 'draft'
     AND i.item_name IS DISTINCT FROM NEW.official_name;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.local_dev_plan_projects_sync_name() FROM PUBLIC, anon, authenticated;

-- ── 3) วงเงินรายปี ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.local_dev_plan_project_years_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user     boolean := auth.uid() IS NOT NULL;
  v_muni     uuid;
  v_added    smallint;
  v_status   text;
  v_from     integer;
  v_to       integer;
BEGIN
  SELECT p.municipality_id, p.added_in_revision, d.status, d.year_from, d.year_to
    INTO v_muni, v_added, v_status, v_from, v_to
  FROM public.local_dev_plan_projects AS p
  JOIN public.local_dev_plans AS d ON d.id = p.dev_plan_id
  WHERE p.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.project_id ELSE NEW.project_id END
  FOR SHARE OF d;

  -- โครงการเดิมของแผนที่ประกาศแล้ว: วงเงินรายปีแช่แข็ง (v_status ว่าง = แม่กำลังถูกลบแบบ cascade → ปล่อย)
  IF v_user AND v_status = 'published' AND v_added = 0 THEN
    RAISE EXCEPTION 'วงเงินรายปีของโครงการในแผนที่ประกาศใช้แล้วแก้ไม่ได้' USING ERRCODE = '42501';
  END IF;
  IF v_user AND public.local_dev_project_in_published_op(CASE WHEN TG_OP = 'DELETE' THEN OLD.project_id ELSE NEW.project_id END) THEN
    RAISE EXCEPTION 'โครงการนี้ถูกอ้างในแผนการดำเนินงานที่ประกาศแล้ว แก้วงเงินรายปีไม่ได้' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF v_muni IS NULL THEN
    RAISE EXCEPTION 'ไม่พบโครงการที่ระบุ' USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    RAISE EXCEPTION 'ย้ายวงเงินข้ามโครงการไม่ได้' USING ERRCODE = '42501';
  END IF;
  IF NEW.fiscal_year NOT BETWEEN v_from AND v_to THEN
    RAISE EXCEPTION 'ปีงบประมาณ % อยู่นอกช่วงของแผน (% – %)', NEW.fiscal_year, v_from, v_to USING ERRCODE = '23514';
  END IF;
  NEW.municipality_id := v_muni;
  NEW.updated_by := coalesce(auth.uid(), CASE WHEN TG_OP = 'INSERT' THEN NEW.updated_by ELSE OLD.updated_by END);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.local_dev_plan_project_years_guard() FROM PUBLIC, anon, authenticated;

-- ── 4) แผนการดำเนินงาน ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.local_op_plans_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user boolean := auth.uid() IS NOT NULL;
  v_rpc  boolean := coalesce(current_setting('local_plan.status_rpc', true), '') = 'on';
  v_muni uuid;
  v_from integer;
  v_to   integer;
  v_col  text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF v_user AND OLD.status = 'published' THEN
      RAISE EXCEPTION 'แผนการดำเนินงานที่ประกาศแล้วลบไม่ได้' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  SELECT municipality_id, year_from, year_to INTO v_muni, v_from, v_to
  FROM public.local_dev_plans WHERE id = NEW.dev_plan_id;
  IF v_muni IS NULL THEN
    RAISE EXCEPTION 'ไม่พบแผนพัฒนาที่ระบุ' USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.municipality_id := v_muni;
    IF v_user AND NOT v_rpc AND (NEW.status <> 'draft' OR NEW.published_on IS NOT NULL OR NEW.published_by IS NOT NULL
                                 OR NEW.announce_ref_no IS NOT NULL) THEN
      RAISE EXCEPTION 'สร้างแผนการดำเนินงานเป็นฉบับร่างก่อน แล้วประกาศผ่านปุ่มประกาศ (local_op_plan_set_status)' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.dev_plan_id IS DISTINCT FROM OLD.dev_plan_id OR NEW.municipality_id IS DISTINCT FROM OLD.municipality_id THEN
      RAISE EXCEPTION 'ย้ายแผนการดำเนินงานข้ามแผนพัฒนา/ข้าม อปท. ไม่ได้' USING ERRCODE = '42501';
    END IF;
    IF v_user AND NOT v_rpc THEN
      IF NEW.status IS DISTINCT FROM OLD.status OR NEW.published_on IS DISTINCT FROM OLD.published_on
         OR NEW.published_by IS DISTINCT FROM OLD.published_by OR NEW.announce_ref_no IS DISTINCT FROM OLD.announce_ref_no THEN
        RAISE EXCEPTION 'สถานะประกาศเปลี่ยนได้ทางปุ่มประกาศ/ยกเลิกประกาศเท่านั้น (local_op_plan_set_status)' USING ERRCODE = '42501';
      END IF;
      IF OLD.status = 'published' THEN
        v_col := public.local_plan_changed_outside(to_jsonb(OLD), to_jsonb(NEW), ARRAY['note']);
        IF v_col IS NOT NULL THEN
          RAISE EXCEPTION 'แผนการดำเนินงานที่ประกาศแล้วแก้ช่อง % ไม่ได้ — ทำฉบับเพิ่มเติม/แก้ไขครั้งถัดไป', v_col USING ERRCODE = '42501';
        END IF;
      END IF;
    END IF;
  END IF;

  IF NEW.fiscal_year NOT BETWEEN v_from AND v_to THEN
    RAISE EXCEPTION 'ปีงบประมาณ % อยู่นอกช่วงของแผนพัฒนา (% – %)', NEW.fiscal_year, v_from, v_to USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.local_op_plans_guard() FROM PUBLIC, anon, authenticated;

-- ── 5) รายการในแผนการดำเนินงาน ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.local_op_plan_items_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user     boolean := auth.uid() IS NOT NULL;
  v_muni     uuid;
  v_status   text;
  v_dev_plan uuid;
  v_name     text;
  v_col      text;
BEGIN
  SELECT municipality_id, status, dev_plan_id INTO v_muni, v_status, v_dev_plan
  FROM public.local_op_plans WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.op_plan_id ELSE NEW.op_plan_id END
  FOR SHARE;                                      -- กันแก้แถวพร้อมกับที่มีคนกดประกาศ (RPC ถือ FOR UPDATE)

  -- ฉบับที่ประกาศแล้วแช่แข็งทุกแถว ทุกคน (v_status ว่าง = ฉบับร่างกำลังถูกลบแบบ cascade → ปล่อย)
  IF v_user AND v_status = 'published' THEN
    RAISE EXCEPTION 'แผนการดำเนินงานฉบับนี้ประกาศแล้ว แก้รายการไม่ได้ — ทำฉบับเพิ่มเติม/แก้ไขครั้งถัดไป' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF v_muni IS NULL THEN
    RAISE EXCEPTION 'ไม่พบแผนการดำเนินงานที่ระบุ' USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.municipality_id := v_muni;
  ELSE
    IF NEW.op_plan_id IS DISTINCT FROM OLD.op_plan_id OR NEW.municipality_id IS DISTINCT FROM OLD.municipality_id THEN
      RAISE EXCEPTION 'ย้ายรายการข้ามฉบับ/ข้าม อปท. ไม่ได้' USING ERRCODE = '42501';
    END IF;
    -- กองผู้รับผิดชอบ (ไม่ใช่ผู้จัดการแผน): แก้ได้เฉพาะเดือนเริ่ม–สิ้นสุด และหมายเหตุ (เจ้าของอนุมัติ 2569-11-08)
    -- ตรวจก่อนคัดชื่อจากทะเบียนด้านล่าง (ชื่อเป็นค่าที่ระบบเติม ไม่ใช่ผู้ใช้แก้)
    -- เว้นกรณีลบกอง (FK ตั้ง department_id เป็น NULL): กองแถวนั้นหายไปแล้วจริง ผู้ใช้ทำเงื่อนไขนี้เองไม่ได้
    -- ไม่เว้น = ผู้มีสิทธิ์ลบกองที่ไม่ใช่ผู้จัดการแผน (เช่น fleet_admin) ลบกองไม่ได้ทั้งที่ไม่เกี่ยวกับแผน
    IF v_user AND NOT public.local_plan_is_manager(OLD.municipality_id)
       AND NOT (NEW.department_id IS NULL AND OLD.department_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM public.departments AS d WHERE d.id = OLD.department_id)) THEN
      v_col := public.local_plan_changed_outside(to_jsonb(OLD), to_jsonb(NEW), ARRAY['month_from', 'month_to', 'note']);
      IF v_col IS NOT NULL THEN
        RAISE EXCEPTION 'กองผู้รับผิดชอบแก้ได้เฉพาะเดือนดำเนินการและหมายเหตุ (ช่อง % ให้นักวิเคราะห์ฯ แก้)', v_col USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  IF NEW.department_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.departments AS d WHERE d.id = NEW.department_id AND d.municipality_id = NEW.municipality_id) THEN
    RAISE EXCEPTION 'กองผู้รับผิดชอบไม่ใช่ของ อปท. นี้' USING ERRCODE = '23514';
  END IF;

  IF NEW.dev_project_id IS NOT NULL THEN
    SELECT official_name INTO v_name
    FROM public.local_dev_plan_projects WHERE id = NEW.dev_project_id AND dev_plan_id = v_dev_plan;
    IF v_name IS NULL THEN
      RAISE EXCEPTION 'โครงการที่ผูกต้องอยู่ในแผนพัฒนาฉบับเดียวกับแผนการดำเนินงานนี้' USING ERRCODE = '23514';
    END IF;
    NEW.item_name := v_name;                       -- ชื่อตรงกับทะเบียนเสมอ
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.local_op_plan_items_guard() FROM PUBLIC, anon, authenticated;

-- ── 6) ประวัติ ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.local_plan_log_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old     jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
  v_new     jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END;
  v_row     jsonb;
  v_skip    text[] := ARRAY['id', 'municipality_id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'sort_order'];
  v_entity  text;
  v_parent  uuid;
  v_action  text := lower(TG_OP);
  v_changes jsonb := '{}'::jsonb;
  v_reason  text;
  v_key     text;
BEGIN
  v_row := coalesce(v_new, v_old);
  -- อปท. ถูกลบทั้งแถว (cascade) → ไม่ลงประวัติ ไม่งั้น FK ของ local_plan_events ทำให้ลบ อปท. ไม่ได้
  IF NOT EXISTS (SELECT 1 FROM public.municipalities WHERE id = (v_row ->> 'municipality_id')::uuid) THEN
    RETURN NULL;
  END IF;

  v_entity := CASE TG_TABLE_NAME
    WHEN 'local_dev_plans' THEN 'dev_plan'
    WHEN 'local_dev_plan_projects' THEN 'dev_project'
    WHEN 'local_dev_plan_project_years' THEN 'dev_project_year'
    WHEN 'local_op_plans' THEN 'op_plan'
    WHEN 'local_op_plan_items' THEN 'op_item'
  END;
  v_parent := CASE v_entity
    WHEN 'dev_project' THEN (v_row ->> 'dev_plan_id')::uuid
    WHEN 'op_plan' THEN (v_row ->> 'dev_plan_id')::uuid
    WHEN 'op_item' THEN (v_row ->> 'op_plan_id')::uuid
  END;

  IF TG_OP = 'UPDATE' THEN
    FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
      CONTINUE WHEN v_key = ANY (v_skip);
      IF (v_new -> v_key) IS DISTINCT FROM (v_old -> v_key) THEN
        v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_array(v_old -> v_key, v_new -> v_key));
      END IF;
    END LOOP;
    IF v_changes = '{}'::jsonb THEN
      RETURN NULL;                                  -- ลากเรียง/ประทับเวลาอย่างเดียว ไม่ลงประวัติ
    END IF;
    IF v_entity = 'dev_project_year' THEN          -- บอกว่าเป็นปีไหนเสมอ
      v_changes := v_changes || jsonb_build_object('fiscal_year', jsonb_build_array(v_old -> 'fiscal_year', v_new -> 'fiscal_year'));
    END IF;
    IF v_entity IN ('dev_plan', 'op_plan') AND v_changes ? 'status' THEN
      v_action := CASE WHEN v_new ->> 'status' = 'published' THEN 'publish' ELSE 'unpublish' END;
      v_reason := nullif(current_setting('local_plan.reason', true), '');
    END IF;
  ELSE
    v_changes := jsonb_strip_nulls(v_row - v_skip);   -- เพิ่ม/ลบ = ภาพของแถวทั้งแถว
  END IF;

  INSERT INTO public.local_plan_events (municipality_id, entity, entity_id, parent_id, action, changes, reason, actor)
  VALUES ((v_row ->> 'municipality_id')::uuid, v_entity,
          CASE WHEN v_entity = 'dev_project_year' THEN (v_row ->> 'project_id')::uuid ELSE (v_row ->> 'id')::uuid END,
          v_parent, v_action, v_changes, v_reason, auth.uid());
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.local_plan_log_event() FROM PUBLIC, anon, authenticated;

-- ── trigger ──────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS local_dev_plans_guard_trigger ON public.local_dev_plans;
CREATE TRIGGER local_dev_plans_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON public.local_dev_plans
  FOR EACH ROW EXECUTE FUNCTION public.local_dev_plans_guard();
DROP TRIGGER IF EXISTS local_dev_plans_stamp_trigger ON public.local_dev_plans;
CREATE TRIGGER local_dev_plans_stamp_trigger BEFORE INSERT OR UPDATE ON public.local_dev_plans
  FOR EACH ROW EXECUTE FUNCTION public.local_plan_stamp();

DROP TRIGGER IF EXISTS local_dev_plan_projects_guard_trigger ON public.local_dev_plan_projects;
CREATE TRIGGER local_dev_plan_projects_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON public.local_dev_plan_projects
  FOR EACH ROW EXECUTE FUNCTION public.local_dev_plan_projects_guard();
DROP TRIGGER IF EXISTS local_dev_plan_projects_stamp_trigger ON public.local_dev_plan_projects;
CREATE TRIGGER local_dev_plan_projects_stamp_trigger BEFORE INSERT OR UPDATE ON public.local_dev_plan_projects
  FOR EACH ROW EXECUTE FUNCTION public.local_plan_stamp();
DROP TRIGGER IF EXISTS local_dev_plan_projects_sync_name_trigger ON public.local_dev_plan_projects;
CREATE TRIGGER local_dev_plan_projects_sync_name_trigger AFTER UPDATE OF official_name ON public.local_dev_plan_projects
  FOR EACH ROW WHEN (NEW.official_name IS DISTINCT FROM OLD.official_name)
  EXECUTE FUNCTION public.local_dev_plan_projects_sync_name();

DROP TRIGGER IF EXISTS local_dev_plan_project_years_guard_trigger ON public.local_dev_plan_project_years;
CREATE TRIGGER local_dev_plan_project_years_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON public.local_dev_plan_project_years
  FOR EACH ROW EXECUTE FUNCTION public.local_dev_plan_project_years_guard();

DROP TRIGGER IF EXISTS local_op_plans_guard_trigger ON public.local_op_plans;
CREATE TRIGGER local_op_plans_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON public.local_op_plans
  FOR EACH ROW EXECUTE FUNCTION public.local_op_plans_guard();
DROP TRIGGER IF EXISTS local_op_plans_stamp_trigger ON public.local_op_plans;
CREATE TRIGGER local_op_plans_stamp_trigger BEFORE INSERT OR UPDATE ON public.local_op_plans
  FOR EACH ROW EXECUTE FUNCTION public.local_plan_stamp();

DROP TRIGGER IF EXISTS local_op_plan_items_guard_trigger ON public.local_op_plan_items;
CREATE TRIGGER local_op_plan_items_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON public.local_op_plan_items
  FOR EACH ROW EXECUTE FUNCTION public.local_op_plan_items_guard();
DROP TRIGGER IF EXISTS local_op_plan_items_stamp_trigger ON public.local_op_plan_items;
CREATE TRIGGER local_op_plan_items_stamp_trigger BEFORE INSERT OR UPDATE ON public.local_op_plan_items
  FOR EACH ROW EXECUTE FUNCTION public.local_plan_stamp();

DROP TRIGGER IF EXISTS local_dev_plans_log_trigger ON public.local_dev_plans;
CREATE TRIGGER local_dev_plans_log_trigger AFTER INSERT OR UPDATE OR DELETE ON public.local_dev_plans
  FOR EACH ROW EXECUTE FUNCTION public.local_plan_log_event();
DROP TRIGGER IF EXISTS local_dev_plan_projects_log_trigger ON public.local_dev_plan_projects;
CREATE TRIGGER local_dev_plan_projects_log_trigger AFTER INSERT OR UPDATE OR DELETE ON public.local_dev_plan_projects
  FOR EACH ROW EXECUTE FUNCTION public.local_plan_log_event();
DROP TRIGGER IF EXISTS local_dev_plan_project_years_log_trigger ON public.local_dev_plan_project_years;
CREATE TRIGGER local_dev_plan_project_years_log_trigger AFTER INSERT OR UPDATE OR DELETE ON public.local_dev_plan_project_years
  FOR EACH ROW EXECUTE FUNCTION public.local_plan_log_event();
DROP TRIGGER IF EXISTS local_op_plans_log_trigger ON public.local_op_plans;
CREATE TRIGGER local_op_plans_log_trigger AFTER INSERT OR UPDATE OR DELETE ON public.local_op_plans
  FOR EACH ROW EXECUTE FUNCTION public.local_plan_log_event();
DROP TRIGGER IF EXISTS local_op_plan_items_log_trigger ON public.local_op_plan_items;
CREATE TRIGGER local_op_plan_items_log_trigger AFTER INSERT OR UPDATE OR DELETE ON public.local_op_plan_items
  FOR EACH ROW EXECUTE FUNCTION public.local_plan_log_event();

-- ── RPC ประกาศ / ยกเลิกประกาศ ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.local_dev_plan_set_status(
  p_plan_id uuid, p_status text, p_published_on date DEFAULT NULL, p_announce_ref_no text DEFAULT NULL, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_plan   public.local_dev_plans%ROWTYPE;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบ' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_plan FROM public.local_dev_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND OR NOT public.local_plan_can_read(v_plan.municipality_id) THEN
    RAISE EXCEPTION 'ไม่พบแผนพัฒนาที่ระบุ' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.local_plan_is_manager(v_plan.municipality_id) THEN
    RAISE EXCEPTION 'ประกาศ/ยกเลิกประกาศได้เฉพาะนักวิเคราะห์ฯ (plan_admin) หรือแอดมิน' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('draft', 'published') OR p_status = v_plan.status THEN
    RAISE EXCEPTION 'สถานะปลายทางไม่ถูกต้อง (ตอนนี้เป็น %)', v_plan.status USING ERRCODE = '22023';
  END IF;
  IF length(coalesce(v_reason, '')) > 2000 OR length(coalesce(p_announce_ref_no, '')) > 200 THEN
    RAISE EXCEPTION 'ข้อความยาวเกินไป' USING ERRCODE = '22001';
  END IF;

  IF p_status = 'published' THEN
    IF p_published_on IS NULL OR p_published_on > (now() AT TIME ZONE 'Asia/Bangkok')::date THEN
      RAISE EXCEPTION 'ต้องระบุวันที่ลงนามประกาศ และไม่เกินวันนี้' USING ERRCODE = '22023';
    END IF;
    -- ฉบับร่างไม่มีทางมีโครงการจาก "การเพิ่มเติมแผน" โดยชอบ (ยกเลิกประกาศถูกบล็อกเมื่อมีแถวแบบนี้)
    -- ปล่อยผ่าน = ตั้งครั้งที่ ≥ 1 ตอนร่างแล้วโครงการนั้นหลบล็อกหลังประกาศได้ (migration-reviewer ก1)
    IF EXISTS (SELECT 1 FROM public.local_dev_plan_projects WHERE dev_plan_id = p_plan_id AND added_in_revision <> 0) THEN
      RAISE EXCEPTION 'ฉบับร่างมีโครงการที่ระบุครั้งที่เพิ่มเติม ต้องเป็น 0 ก่อนประกาศ' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'ยกเลิกประกาศต้องระบุเหตุผล' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.local_dev_plan_projects WHERE dev_plan_id = p_plan_id AND added_in_revision >= 1) THEN
      RAISE EXCEPTION 'ยกเลิกประกาศไม่ได้: มีโครงการที่เพิ่มจากการเพิ่มเติม/เปลี่ยนแปลงแผนแล้ว' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.local_op_plans WHERE dev_plan_id = p_plan_id AND status = 'published') THEN
      RAISE EXCEPTION 'ยกเลิกประกาศไม่ได้: มีแผนการดำเนินงานที่ประกาศแล้วอ้างแผนนี้' USING ERRCODE = '42501';
    END IF;
  END IF;

  PERFORM set_config('local_plan.status_rpc', 'on', true);
  PERFORM set_config('local_plan.reason', coalesce(v_reason, ''), true);
  UPDATE public.local_dev_plans
     SET status = p_status,
         published_on = CASE WHEN p_status = 'published' THEN p_published_on END,
         published_by = CASE WHEN p_status = 'published' THEN auth.uid() END,
         announce_ref_no = CASE WHEN p_status = 'published' THEN nullif(btrim(coalesce(p_announce_ref_no, '')), '') END
   WHERE id = p_plan_id;
  PERFORM set_config('local_plan.status_rpc', '', true);
  PERFORM set_config('local_plan.reason', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.local_op_plan_set_status(
  p_op_plan_id uuid, p_status text, p_published_on date DEFAULT NULL, p_announce_ref_no text DEFAULT NULL, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_op     public.local_op_plans%ROWTYPE;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบ' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_op FROM public.local_op_plans WHERE id = p_op_plan_id FOR UPDATE;
  IF NOT FOUND OR NOT public.local_plan_can_read(v_op.municipality_id) THEN
    RAISE EXCEPTION 'ไม่พบแผนการดำเนินงานที่ระบุ' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.local_plan_is_manager(v_op.municipality_id) THEN
    RAISE EXCEPTION 'ประกาศ/ยกเลิกประกาศได้เฉพาะนักวิเคราะห์ฯ (plan_admin) หรือแอดมิน' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('draft', 'published') OR p_status = v_op.status THEN
    RAISE EXCEPTION 'สถานะปลายทางไม่ถูกต้อง (ตอนนี้เป็น %)', v_op.status USING ERRCODE = '22023';
  END IF;
  IF length(coalesce(v_reason, '')) > 2000 OR length(coalesce(p_announce_ref_no, '')) > 200 THEN
    RAISE EXCEPTION 'ข้อความยาวเกินไป' USING ERRCODE = '22001';
  END IF;

  IF p_status = 'published' THEN
    IF p_published_on IS NULL OR p_published_on > (now() AT TIME ZONE 'Asia/Bangkok')::date THEN
      RAISE EXCEPTION 'ต้องระบุวันที่ลงนามประกาศ และไม่เกินวันนี้' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'ยกเลิกประกาศต้องระบุเหตุผล' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.local_op_plans
               WHERE municipality_id = v_op.municipality_id AND fiscal_year = v_op.fiscal_year
                 AND revision_no > v_op.revision_no AND status = 'published') THEN
      RAISE EXCEPTION 'ยกเลิกประกาศไม่ได้: มีฉบับเพิ่มเติม/แก้ไขครั้งถัดไปของปีนี้ประกาศแล้ว' USING ERRCODE = '42501';
    END IF;
  END IF;

  PERFORM set_config('local_plan.status_rpc', 'on', true);
  PERFORM set_config('local_plan.reason', coalesce(v_reason, ''), true);
  UPDATE public.local_op_plans
     SET status = p_status,
         published_on = CASE WHEN p_status = 'published' THEN p_published_on END,
         published_by = CASE WHEN p_status = 'published' THEN auth.uid() END,
         announce_ref_no = CASE WHEN p_status = 'published' THEN nullif(btrim(coalesce(p_announce_ref_no, '')), '') END
   WHERE id = p_op_plan_id;
  PERFORM set_config('local_plan.status_rpc', '', true);
  PERFORM set_config('local_plan.reason', '', true);
END;
$$;

REVOKE ALL ON FUNCTION public.local_dev_plan_set_status(uuid, text, date, text, text),
  public.local_op_plan_set_status(uuid, text, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.local_dev_plan_set_status(uuid, text, date, text, text),
  public.local_op_plan_set_status(uuid, text, date, text, text) TO authenticated;

-- ── policy ───────────────────────────────────────────────────────────────────────
DO $policies$
DECLARE
  t text;
BEGIN
  -- 4 ตารางที่สิทธิ์เขียน = ผู้จัดการแผนอย่างเดียว
  FOREACH t IN ARRAY ARRAY['local_dev_plans', 'local_dev_plan_projects', 'local_dev_plan_project_years', 'local_op_plans'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.local_plan_can_read(municipality_id))', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.local_plan_is_manager(municipality_id))', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.local_plan_is_manager(municipality_id)) '
                   'WITH CHECK (public.local_plan_is_manager(municipality_id))', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.local_plan_is_manager(municipality_id))', t || '_delete', t);
  END LOOP;
END $policies$;

-- รายการในแผนดำเนินงาน: + กองผู้รับผิดชอบแก้แถวของกองตัวเอง (trigger จำกัดช่อง + ฉบับต้องเป็นร่าง)
DROP POLICY IF EXISTS "local_op_plan_items_select" ON public.local_op_plan_items;
DROP POLICY IF EXISTS "local_op_plan_items_insert" ON public.local_op_plan_items;
DROP POLICY IF EXISTS "local_op_plan_items_update" ON public.local_op_plan_items;
DROP POLICY IF EXISTS "local_op_plan_items_delete" ON public.local_op_plan_items;
CREATE POLICY "local_op_plan_items_select" ON public.local_op_plan_items FOR SELECT TO authenticated
  USING (public.local_plan_can_read(municipality_id));
CREATE POLICY "local_op_plan_items_insert" ON public.local_op_plan_items FOR INSERT TO authenticated
  WITH CHECK (public.local_plan_is_manager(municipality_id));
CREATE POLICY "local_op_plan_items_update" ON public.local_op_plan_items FOR UPDATE TO authenticated
  USING (public.local_plan_is_manager(municipality_id) OR public.local_plan_dept_can_edit(municipality_id, department_id))
  WITH CHECK (public.local_plan_is_manager(municipality_id) OR public.local_plan_dept_can_edit(municipality_id, department_id));
CREATE POLICY "local_op_plan_items_delete" ON public.local_op_plan_items FOR DELETE TO authenticated
  USING (public.local_plan_is_manager(municipality_id));

-- ประวัติ: อ่านอย่างเดียว
DROP POLICY IF EXISTS "local_plan_events_select" ON public.local_plan_events;
CREATE POLICY "local_plan_events_select" ON public.local_plan_events FOR SELECT TO authenticated
  USING (public.local_plan_can_read(municipality_id));

-- ── สิทธิ์ตาราง ───────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.local_dev_plans, public.local_dev_plan_projects,
  public.local_dev_plan_project_years, public.local_op_plans, public.local_op_plan_items TO authenticated;
GRANT SELECT ON public.local_plan_events TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.local_plan_events FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.local_dev_plans, public.local_dev_plan_projects,
  public.local_dev_plan_project_years, public.local_op_plans, public.local_op_plan_items,
  public.local_plan_events FROM authenticated;
REVOKE ALL ON public.local_dev_plans, public.local_dev_plan_projects, public.local_dev_plan_project_years,
  public.local_op_plans, public.local_op_plan_items, public.local_plan_events FROM anon;

-- ── ด่านตรวจท้ายไฟล์ ──────────────────────────────────────────────────────────────
DO $check$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['local_dev_plans', 'local_dev_plan_projects', 'local_dev_plan_project_years',
                           'local_op_plans', 'local_op_plan_items', 'local_plan_events'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'RLS ของ % ไม่ได้เปิด', t;
    END IF;
    IF has_table_privilege('anon', 'public.' || t, 'SELECT') OR has_table_privilege('anon', 'public.' || t, 'INSERT') THEN
      RAISE EXCEPTION 'anon ยังมีสิทธิ์บน %', t;
    END IF;
    IF has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE') THEN
      RAISE EXCEPTION 'authenticated ยังมี TRUNCATE บน %', t;
    END IF;
  END LOOP;
  IF has_table_privilege('authenticated', 'public.local_plan_events', 'INSERT')
     OR has_table_privilege('authenticated', 'public.local_plan_events', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.local_plan_events', 'DELETE') THEN
    RAISE EXCEPTION 'ประวัติต้องเขียนได้เฉพาะ trigger';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'local\_%' ESCAPE '\'
        AND tablename IN ('local_dev_plans', 'local_dev_plan_projects', 'local_dev_plan_project_years',
                          'local_op_plans', 'local_op_plan_items', 'local_plan_events')) <> 21 THEN
    RAISE EXCEPTION 'จำนวน policy ไม่ครบ 21 (5 ตาราง × 4 + ประวัติ 1)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname ~ '^local_'
               AND has_function_privilege('anon', oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'anon ยังมีสิทธิ์ EXECUTE บนฟังก์ชัน local_*';
  END IF;
END $check$;

NOTIFY pgrst, 'reload schema';

COMMIT;
