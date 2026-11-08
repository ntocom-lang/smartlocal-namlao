-- วงจรโครงการก่อสร้าง ไฟล์ 3/3 — เติมค่า ฟังก์ชัน trigger policy (ต้องรัน 20261108100000 และ 20261108100100 ก่อน)
--
-- 1) เติม stage ให้โครงการเดิมจาก status (แปลงตาม civil_stage_for_status) แล้ว SET NOT NULL
--      planned → budgeted · approved → procuring · in_progress → construction · completed → warranty ·
--      suspended → suspended · cancelled → cancelled
--    ⚠️ completed → warranty (ไม่ใช่ closed) โดยตั้งใจ: "ปิดโครงการ" แปลว่าคืนหลักประกันแล้ว ซึ่งระบบไม่รู้ ห้ามอ้างข้อเท็จจริงที่ไม่มี
--       ผู้จัดการโครงการเลื่อนเป็น closed ได้เองทีหลัง (ระบบตัดสินผิด = หัวหน้ากองเห็นในหน้าโครงการ แก้ได้ทันที มีประวัติ)
-- 2) stage ↔ status (trigger civil_projects_stage_guard)
--      - เปลี่ยน stage ได้ทางเดียวคือ RPC civil_set_project_stage (ตรวจสิทธิ์ เหตุผล เลขหนังสือ แล้วบันทึกประวัติ)
--        UPDATE stage ตรงๆ จากเบราว์เซอร์ถูกปฏิเสธ · status ตาม stage เสมอ (หมุดศูนย์ข้อมูล/หน้าช่างยังอ่าน status)
--      - ช่วงเปลี่ยนผ่าน: เมนูเดิม (ProjectSheet #648, CivilProjectAdmin, แผนที่ศูนย์ข้อมูล) ยังแก้ status ตรงได้เหมือนเดิม →
--        ระบบเลือกขั้นที่ตรงกับ status ให้ + ลงประวัติ kind = 'legacy_status' (ไม่ทำให้เมนูเดิมพังก่อน PR-C ขึ้น)
--        ⚠️ ทางนี้ใช้สิทธิ์ UPDATE เดิม แต่บังคับกติกาที่เจ้าของอนุมัติ 2 ข้อเหมือน RPC (migration-reviewer ข้อ 2):
--           "แล้วเสร็จ" (→ warranty = ตรวจรับงวดสุดท้ายแล้ว) และเปิดโครงการที่ปิด/บอกเลิกแล้วกลับมา = ผู้จัดการโครงการเท่านั้น
--           ผลข้างเคียงที่ตั้งใจ: ช่าง/เจ้าหน้าที่ที่ไม่ใช่หัวหน้ากองกด "แล้วเสร็จ" ในเมนูเดิมจะได้ข้อความให้หัวหน้ากองทำ
--           สร้างโครงการใหม่ที่ขั้น warranty/closed ตรงๆ ก็ต้องเป็นผู้จัดการเช่นกัน
--        หลัง PR-C เปลี่ยนหน้าจอครบแล้ว ให้ปิดทางแก้ status ตรงนี้ในไฟล์ถัดไป
--        "ยกเลิก" จากเมนูเดิมเป็น cancelled เสมอ แม้หลังลงนามสัญญา: ระบบไม่ตีความเป็น "บอกเลิกสัญญา" (ผลทางกฎหมายต่างกัน คนต้องตัดสิน)
-- 3) กติกาเปลี่ยนขั้น (civil_set_project_stage)
--      - ขั้นถัดไป 1 ขั้น: ผู้มีสิทธิ์เขียน (ผู้สร้าง / ผู้ควบคุมงานที่ถูกระบุ / หัวหน้ากอง / แอดมิน) ไม่ต้องใส่เหตุผล
--        ยกเว้น → warranty (= ตรวจรับงวดสุดท้ายแล้ว) และ → closed = ผู้จัดการโครงการเท่านั้น
--        → closed ต้องมีเหตุผลถ้ายังไม่มีจุดตรวจ guarantee_returned (คืนหลักประกันแล้ว) และสัญญาไม่ได้ระบุว่าไม่มีหลักประกัน
--      - ข้ามขั้น / ถอยขั้น / ระงับ / กลับมาดำเนินการ / ยกเลิก / บอกเลิก / เปิดใหม่ = ผู้จัดการโครงการ + เหตุผลบังคับ
--        ระงับ / ยกเลิก / บอกเลิก ต้องมีเลขที่หนังสือด้วย · ยกเลิกได้เฉพาะก่อนลงนามสัญญา · บอกเลิกได้ตั้งแต่ลงนามถึงก่อนตรวจรับงวดสุดท้ายเสร็จ
--      - เลื่อนเอง started → construction เมื่อล็อกรายงานประจำสัปดาห์ (civil_reports_auto_stage)
--    ผู้จัดการโครงการ = superadmin · admin ของ อปท. · officer ของกองที่ถือโครงการ (civil_can_manage_project เดิม)
-- 4) ประวัติ (civil_project_events) ระบบเขียนทุกครั้งที่ขั้นเปลี่ยน · ผู้ใช้เพิ่มได้เฉพาะ kind = 'note' · แก้ไม่ได้ ลบไม่ได้
--    ข้อมูลที่ RPC ส่งให้ trigger บันทึก (เหตุผล/เลขหนังสือ) ส่งผ่านค่าตั้งค่าของ transaction (set_config แบบ local)
--    ผู้ใช้ตั้งค่าเหล่านี้เองไม่ได้: PostgREST ไม่เปิด set_config และฟังก์ชันช่วยถูกถอนสิทธิ์ execute
-- 5) ช่องที่เป็น "ผลการตัดสินของผู้มีอำนาจ" บันทึกได้เฉพาะผู้จัดการโครงการ:
--      ผลตรวจรับงวด (installments.inspection_*) · ผลพิจารณาขยายเวลา/แก้สัญญา (changes.decision ฯลฯ) · จุดตรวจ guarantee_returned
-- 6) สิทธิ์อ่าน: เพิ่ม viewer (ผู้บริหาร) อ่านได้ทุกโครงการของ อปท. ตัวเอง (เจ้าของสั่ง "ผู้เห็นสถานะ: เจ้าหน้าที่และผู้บริหาร")
--    — council / citizen / anon ยังไม่ได้ · แก้ทั้ง civil_can_read_project (ตารางลูก) และ policy civil_projects_select (#649)
--    ⚠️ CREATE OR REPLACE ทับทั้งฟังก์ชัน (NOTES ข้อ 5): civil_can_read_project คัดจาก 20261106100100 ทั้งตัว + เพิ่มเงื่อนไข viewer ข้อเดียว
--       policy civil_projects_select คัดจาก 20261107100000 ทั้งตัว (เงื่อนไขตรง ไม่เรียกฟังก์ชัน — กับดัก INSERT … RETURNING ของ #649)
-- 7) โครงการที่ลงนามสัญญาแล้ว = บันทึกทางราชการ ห้ามหาย (เจ้าของระบบสั่ง 2569-11-08) → trigger civil_projects_delete_guard
--    ลบไม่ได้แม้ superadmin เมื่อ "มีหลักฐานว่าเคยลงนามสัญญา" ข้อใดข้อหนึ่ง: ขั้นตั้งแต่ contracted ขึ้นไป / terminated /
--    ระงับจากขั้นตั้งแต่ contracted / มีเลขที่สัญญาหรือวันที่ลงนาม / ประวัติเคยถึงขั้น contracted ขึ้นไป
--    (ข้อหลังกันช่องเมนูเดิมตั้ง "ยกเลิก" ให้โครงการหลังลงนามแล้วค่อยลบ) · บันทึกผิดให้แก้ข้อมูล หรือยกเลิก/บอกเลิกพร้อมเหตุผล
--    ลบได้เฉพาะโครงการที่ยังไม่ลงนามสัญญา (ตารางลูกหายตาม CASCADE) · ผู้ดูแลฐานข้อมูลลบตรงได้ (ไม่มีผู้ล็อกอิน) สำหรับกรณีจำเป็นจริง
--    + ถอน TRUNCATE ของ authenticated บน civil_projects (preflight ฐานจริง 2569-11-08 พบว่ายังมี — RLS และ trigger กันไม่ได้)
--
-- ย้อนกลับ (status ยังเป็นตัวหลักของระบบเดิม ย้อนแล้วระบบเดิมไม่กระทบ)
--   ฉุกเฉิน: DROP TRIGGER civil_projects_stage_guard_trigger / civil_projects_stage_log_insert_trigger /
--            civil_projects_stage_log_update_trigger / civil_projects_delete_guard_trigger ON civil_projects;
--            DROP TRIGGER civil_reports_auto_stage_trigger ON civil_weekly_reports;
--            แล้วคืน civil_can_read_project จาก 20261106100100 และ policy civil_projects_select จาก 20261107100000 (ตัด viewer)
--   เต็ม   : DROP 6 ตารางของไฟล์ 2 (เสียเฉพาะข้อมูลใหม่) · DROP คอลัมน์ของไฟล์ 1 · ลบแถว grp = 'price_committee' ก่อนคืน CHECK เดิม
BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.civil_project_milestones') IS NULL OR to_regclass('public.civil_project_installments') IS NULL
     OR to_regclass('public.civil_project_changes') IS NULL OR to_regclass('public.civil_project_defects') IS NULL
     OR to_regclass('public.civil_project_events') IS NULL OR to_regclass('public.civil_project_documents') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261108100100_civil_lifecycle_tables.sql ก่อน (ไม่พบตารางใหม่ครบ 6 ตาราง)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'civil_project_contracts' AND column_name = 'guarantee_type') THEN
    RAISE EXCEPTION 'ต้องรัน 20261108100000_civil_lifecycle_columns.sql ก่อน (ไม่พบ civil_project_contracts.guarantee_type)';
  END IF;
  IF to_regprocedure('public.civil_can_manage_project(uuid)') IS NULL
     OR to_regprocedure('public.civil_can_write_project(uuid)') IS NULL
     OR to_regprocedure('public.civil_can_read_project(uuid)') IS NULL
     OR to_regprocedure('public.civil_is_listed_on_project(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Schema drift: ไม่พบฟังก์ชันสิทธิ์ของโมดูล (20261106100100 / 20261107100000)';
  END IF;
  IF to_regprocedure('public.is_my_department(uuid,uuid)') IS NULL
     OR to_regprocedure('public.get_my_role()') IS NULL
     OR to_regprocedure('public.get_my_municipality_id()') IS NULL THEN
    RAISE EXCEPTION 'Schema drift: ไม่พบฟังก์ชันสิทธิ์พื้นฐาน (get_my_role / get_my_municipality_id / is_my_department)';
  END IF;
END $guard$;

-- ── ฟังก์ชันแปลงขั้น (ค่าคงที่ ไม่แตะตาราง) — src/lib/constructionLifecycle.js ต้องใช้ชุดเดียวกัน (PR-B มีเทสต์เทียบ) ──
CREATE OR REPLACE FUNCTION public.civil_stage_ord(p_stage text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE p_stage
    WHEN 'budgeted' THEN 1 WHEN 'designing' THEN 2 WHEN 'procuring' THEN 3 WHEN 'contracted' THEN 4
    WHEN 'started' THEN 5 WHEN 'construction' THEN 6 WHEN 'final_inspection' THEN 7 WHEN 'warranty' THEN 8
    WHEN 'closed' THEN 9
  END;
$$;

CREATE OR REPLACE FUNCTION public.civil_status_of_stage(p_stage text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN p_stage IN ('budgeted', 'designing') THEN 'planned'
    WHEN p_stage IN ('procuring', 'contracted') THEN 'approved'
    WHEN p_stage IN ('started', 'construction', 'final_inspection') THEN 'in_progress'
    WHEN p_stage IN ('warranty', 'closed') THEN 'completed'
    WHEN p_stage = 'suspended' THEN 'suspended'
    WHEN p_stage IN ('cancelled', 'terminated') THEN 'cancelled'
  END;
$$;

-- status (เมนูเดิม) → ขั้นตัวแทน ใช้ตอนเติมค่าแถวเดิม / แถวใหม่ที่ไม่ส่ง stage / เมนูเดิมแก้ status
CREATE OR REPLACE FUNCTION public.civil_stage_for_status(p_status text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE p_status
    WHEN 'planned' THEN 'budgeted' WHEN 'approved' THEN 'procuring' WHEN 'in_progress' THEN 'construction'
    WHEN 'completed' THEN 'warranty' WHEN 'suspended' THEN 'suspended' WHEN 'cancelled' THEN 'cancelled'
  END;
$$;

REVOKE ALL ON FUNCTION public.civil_stage_ord(text), public.civil_status_of_stage(text), public.civil_stage_for_status(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.civil_stage_ord(text), public.civil_status_of_stage(text), public.civil_stage_for_status(text) TO authenticated;

-- ── 1) เติมค่าแถวเดิม (ก่อนสร้าง trigger — ไม่ลงประวัติ 'legacy_status' ให้ทุกแถว) ───────────────────
-- ห่อใน DO: เครื่องมือบางตัว Parse ทุก statement ก่อนรัน DML ระดับบนสุดที่เรียกฟังก์ชันที่เพิ่งสร้างในไฟล์เดียวกันอาจพัง 42883
-- (สมมติฐานเดียวกับ NOTES ข้อ 3) — ภายใน DO ถูก plan ตอนรันจริง
DO $backfill$
BEGIN
  UPDATE public.civil_projects
     SET stage = public.civil_stage_for_status(status),
         stage_changed_at = coalesce(stage_changed_at, updated_at, created_at, now())
   WHERE stage IS NULL;
END $backfill$;

-- status นอก 6 ค่า → stage เป็น NULL → บรรทัดนี้พัง ทั้งไฟล์ย้อนกลับ (ดีกว่าเดาค่า)
ALTER TABLE public.civil_projects ALTER COLUMN stage SET NOT NULL;

-- ── 2) สิทธิ์อ่าน + viewer ────────────────────────────────────────────────────────
-- คัดจาก 20261106100100 ทั้งตัว เพิ่มเฉพาะบรรทัด viewer
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
      AND (
        -- ผู้บริหาร (viewer) อ่านอย่างเดียว ทุกโครงการของ อปท. ตัวเอง (2569-11-08)
        (public.get_my_role() = 'viewer' AND p.municipality_id = public.get_my_municipality_id())
        OR (
          public.get_my_role() IN ('staff', 'technician')
          AND p.municipality_id = public.get_my_municipality_id()
          AND (
            public.is_my_department(p.municipality_id, p.department_id)
            OR p.created_by = auth.uid()
            OR EXISTS (
              SELECT 1 FROM public.civil_project_people AS pp
              WHERE pp.project_id = p.id AND pp.profile_id = auth.uid()
            )
          )
        )
      )
  );
$$;
REVOKE ALL ON FUNCTION public.civil_can_read_project(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.civil_can_read_project(uuid) TO authenticated;

-- คัดจาก 20261107100000 ทั้งตัว เพิ่มเฉพาะบรรทัด viewer (ต้องตรงกับ civil_can_read_project ทุกคู่ — เทสต์เทียบให้)
DROP POLICY IF EXISTS "civil_projects_select" ON public.civil_projects;
CREATE POLICY "civil_projects_select" ON public.civil_projects
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
    OR (public.get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
    OR (public.get_my_role() = 'viewer' AND municipality_id = public.get_my_municipality_id())
    OR (
      public.get_my_role() IN ('staff', 'technician')
      AND municipality_id = public.get_my_municipality_id()
      AND (
        public.is_my_department(municipality_id, department_id)
        OR created_by = auth.uid()
        OR public.civil_is_listed_on_project(id)
      )
    )
  );

-- ── 3) stage ↔ status + ประวัติ ──────────────────────────────────────────────────

-- ตั้ง/ล้างบริบทการเปลี่ยนขั้นของ transaction นี้ (เรียกได้เฉพาะจากฟังก์ชัน SECURITY DEFINER ของโมดูล — ผู้ใช้ถูกถอนสิทธิ์)
CREATE OR REPLACE FUNCTION public.civil_stage_context(p_on boolean, p_kind text, p_reason text, p_ref_no text, p_ref_date date)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM set_config('civil.stage_rpc', CASE WHEN p_on THEN 'on' ELSE '' END, true);
  PERFORM set_config('civil.stage_kind', CASE WHEN p_on THEN coalesce(p_kind, '') ELSE '' END, true);
  PERFORM set_config('civil.stage_reason', CASE WHEN p_on THEN coalesce(p_reason, '') ELSE '' END, true);
  PERFORM set_config('civil.stage_ref_no', CASE WHEN p_on THEN coalesce(p_ref_no, '') ELSE '' END, true);
  PERFORM set_config('civil.stage_ref_date', CASE WHEN p_on AND p_ref_date IS NOT NULL THEN p_ref_date::text ELSE '' END, true);
END;
$$;
REVOKE ALL ON FUNCTION public.civil_stage_context(boolean, text, text, text, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.civil_projects_stage_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_rpc  boolean := coalesce(current_setting('civil.stage_rpc', true), '') = 'on';
  v_user boolean := auth.uid() IS NOT NULL;
  v_target text;
  -- ผู้จัดการโครงการ ตัดสินจากค่าในแถวตรงๆ (ห้ามเรียก civil_can_manage_project(NEW.id): มองไม่เห็นแถวที่กำลัง INSERT — กับดัก #649)
  -- ตอน UPDATE ใช้ค่าเดียวกันได้ เพราะคนที่ไม่ใช่แอดมินย้าย อปท./กองไม่ได้ (protect_department_record_scope)
  -- coalesce: ค่า NULL (เช่น โปรไฟล์ไม่มี อปท.) ต้องนับเป็น "ไม่ใช่ผู้จัดการ" ไม่ใช่ทำให้ด่านถูกข้าม
  v_manager boolean := coalesce(public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND NEW.municipality_id = public.get_my_municipality_id())
    OR (public.get_my_role() = 'officer' AND public.is_my_department(NEW.municipality_id, NEW.department_id)), false);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.stage IS NULL THEN
      NEW.stage := public.civil_stage_for_status(NEW.status);   -- เมนูเดิมที่ส่งแค่ status
    ELSIF v_user AND NEW.stage IN ('suspended', 'cancelled', 'terminated') THEN
      RAISE EXCEPTION 'โครงการใหม่ต้องเริ่มที่ขั้นในเส้นหลัก — ระงับ/ยกเลิก/บอกเลิก ทำผ่านปุ่มเปลี่ยนขั้นหลังสร้างโครงการแล้ว';
    END IF;
    IF public.civil_status_of_stage(NEW.stage) IS NULL THEN
      RAISE EXCEPTION 'ไม่รู้จักขั้นโครงการ "%" (หรือสถานะ "%")', NEW.stage, NEW.status USING ERRCODE = '23514';
    END IF;
    IF v_user AND NEW.stage IN ('warranty', 'closed') AND NOT v_manager THEN
      RAISE EXCEPTION 'ลงทะเบียนโครงการที่ตรวจรับงวดสุดท้ายแล้ว/ปิดแล้ว ให้หัวหน้ากองหรือผู้ดูแลระบบเป็นผู้ทำ' USING ERRCODE = '42501';
    END IF;
    NEW.status := public.civil_status_of_stage(NEW.stage);
    IF v_user OR NEW.stage <> 'suspended' THEN
      NEW.stage_before_hold := NULL;
    END IF;
    NEW.stage_changed_at := now();
    RETURN NEW;
  END IF;

  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    IF v_user AND NOT v_rpc THEN
      RAISE EXCEPTION 'เปลี่ยนขั้นโครงการต้องผ่านปุ่มเปลี่ยนขั้น (civil_set_project_stage) — ระบบจะตรวจสิทธิ์และบันทึกประวัติให้';
    END IF;
    IF NOT v_rpc THEN
      -- ผู้ดูแลแก้ตรงในฐานข้อมูล: ทำ stage_before_hold ให้สอดคล้องเอง
      IF NEW.stage = 'suspended' THEN
        NEW.stage_before_hold := coalesce(NEW.stage_before_hold,
          CASE WHEN public.civil_stage_ord(OLD.stage) BETWEEN 1 AND 8 THEN OLD.stage END);
      ELSE
        NEW.stage_before_hold := NULL;
      END IF;
    END IF;
    IF public.civil_status_of_stage(NEW.stage) IS NULL THEN
      RAISE EXCEPTION 'ไม่รู้จักขั้นโครงการ "%"', NEW.stage USING ERRCODE = '23514';
    END IF;
    NEW.status := public.civil_status_of_stage(NEW.stage);
    NEW.stage_changed_at := now();
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    -- เมนูเดิมแก้ status ตรง (ช่วงเปลี่ยนผ่านก่อน PR-C) → เลือกขั้นตัวแทน · กลับจากระงับไป status เดิม = กลับขั้นที่จำไว้
    v_target := public.civil_stage_for_status(NEW.status);
    IF v_target IS NULL THEN
      RAISE EXCEPTION 'ไม่รู้จักสถานะ "%"', NEW.status USING ERRCODE = '23514';
    END IF;
    IF OLD.stage = 'suspended' AND OLD.stage_before_hold IS NOT NULL
       AND public.civil_status_of_stage(OLD.stage_before_hold) = NEW.status THEN
      v_target := OLD.stage_before_hold;
    END IF;
    -- กติกาที่เจ้าของอนุมัติใช้กับเมนูเดิมด้วย: "แล้วเสร็จ" = ตรวจรับงวดสุดท้ายแล้ว · เปิดโครงการที่ปิด/บอกเลิกแล้ว = ผู้จัดการเท่านั้น
    -- OLD.stage = warranty ด้วย: ถอยออกจาก "ตรวจรับงวดสุดท้ายแล้ว" = ลบข้อเท็จจริงของผู้จัดการ (RPC ก็ต้องเป็นผู้จัดการ)
    IF v_user AND NOT v_manager
       AND (v_target IN ('warranty', 'closed') OR OLD.stage IN ('warranty', 'closed', 'terminated')) THEN
      RAISE EXCEPTION 'ตั้ง "แล้วเสร็จ" หรือเปิดโครงการที่ปิด/บอกเลิกสัญญาแล้วกลับมา ให้หัวหน้ากองหรือผู้ดูแลระบบเป็นผู้ทำ'
        USING ERRCODE = '42501';
    END IF;
    NEW.stage_before_hold := CASE WHEN v_target = 'suspended' AND public.civil_stage_ord(OLD.stage) BETWEEN 1 AND 8 THEN OLD.stage END;
    NEW.stage := v_target;
    NEW.status := public.civil_status_of_stage(v_target);
    NEW.stage_changed_at := now();
  ELSIF v_user AND NOT v_rpc THEN
    -- ช่องประกอบของขั้นแก้จากเบราว์เซอร์ไม่ได้
    NEW.stage_before_hold := OLD.stage_before_hold;
    NEW.stage_changed_at := OLD.stage_changed_at;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.civil_projects_stage_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_kind text := nullif(current_setting('civil.stage_kind', true), '');
  v_legacy boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.civil_project_events (project_id, kind, to_stage, actor)
    VALUES (NEW.id, 'created', NEW.stage, auth.uid());
    RETURN NULL;
  END IF;
  v_legacy := v_kind IS NULL AND auth.uid() IS NOT NULL;
  INSERT INTO public.civil_project_events (project_id, kind, from_stage, to_stage, reason, ref_no, ref_date, actor, detail)
  VALUES (
    NEW.id,
    coalesce(v_kind, CASE WHEN v_legacy THEN 'legacy_status' ELSE 'stage_change' END),
    OLD.stage,
    NEW.stage,
    nullif(current_setting('civil.stage_reason', true), ''),
    nullif(current_setting('civil.stage_ref_no', true), ''),
    nullif(current_setting('civil.stage_ref_date', true), '')::date,
    auth.uid(),
    CASE WHEN v_legacy THEN jsonb_build_object('status_from', OLD.status, 'status_to', NEW.status) ELSE '{}'::jsonb END
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.civil_projects_stage_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.civil_projects_stage_log() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS civil_projects_stage_guard_trigger ON public.civil_projects;
CREATE TRIGGER civil_projects_stage_guard_trigger
  BEFORE INSERT OR UPDATE ON public.civil_projects
  FOR EACH ROW EXECUTE FUNCTION public.civil_projects_stage_guard();

DROP TRIGGER IF EXISTS civil_projects_stage_log_insert_trigger ON public.civil_projects;
CREATE TRIGGER civil_projects_stage_log_insert_trigger
  AFTER INSERT ON public.civil_projects
  FOR EACH ROW EXECUTE FUNCTION public.civil_projects_stage_log();

DROP TRIGGER IF EXISTS civil_projects_stage_log_update_trigger ON public.civil_projects;
CREATE TRIGGER civil_projects_stage_log_update_trigger
  AFTER UPDATE ON public.civil_projects
  FOR EACH ROW WHEN (OLD.stage IS DISTINCT FROM NEW.stage)
  EXECUTE FUNCTION public.civil_projects_stage_log();

-- โครงการที่ลงนามสัญญาแล้วลบไม่ได้ (ข้อ 7 หัวไฟล์)
CREATE OR REPLACE FUNCTION public.civil_projects_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND (
    coalesce(public.civil_stage_ord(OLD.stage), 0) >= 4
    OR OLD.stage = 'terminated'
    OR (OLD.stage = 'suspended' AND coalesce(public.civil_stage_ord(OLD.stage_before_hold), 0) >= 4)
    OR nullif(btrim(coalesce(OLD.contract_no, '')), '') IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.civil_project_contracts AS c WHERE c.project_id = OLD.id AND c.contract_date IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.civil_project_events AS e
               WHERE e.project_id = OLD.id
                 AND (coalesce(public.civil_stage_ord(e.to_stage), 0) >= 4 OR e.to_stage = 'terminated'))
  ) THEN
    RAISE EXCEPTION 'โครงการที่ลงนามสัญญาแล้วเป็นบันทึกทางราชการ ลบไม่ได้ — ถ้าบันทึกผิดให้แก้ข้อมูล หรือเปลี่ยนเป็นยกเลิก/บอกเลิกสัญญาพร้อมเหตุผล'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.civil_projects_delete_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS civil_projects_delete_guard_trigger ON public.civil_projects;
CREATE TRIGGER civil_projects_delete_guard_trigger
  BEFORE DELETE ON public.civil_projects
  FOR EACH ROW EXECUTE FUNCTION public.civil_projects_delete_guard();

-- RLS และ trigger แถวไม่กัน TRUNCATE (ฐานจริงยังให้ authenticated อยู่ — preflight 2569-11-08)
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.civil_projects FROM authenticated;

-- ── 4) RPC เปลี่ยนขั้น ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.civil_set_project_stage(
  p_project_id uuid,
  p_stage      text,
  p_reason     text DEFAULT NULL,
  p_ref_no     text DEFAULT NULL,
  p_ref_date   date DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old      text;
  v_hold     text;
  v_base     text;
  v_new_hold text := NULL;
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
  v_ref      text := nullif(btrim(coalesce(p_ref_no, '')), '');
  v_old_ord  integer;
  v_new_ord  integer;
  v_base_ord integer;
  v_manage   boolean;
  v_write    boolean;
  v_need_manage boolean := true;
  v_need_reason boolean := true;
  v_need_ref    boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน' USING ERRCODE = '42501';
  END IF;
  IF p_stage IS NULL OR p_stage NOT IN ('budgeted', 'designing', 'procuring', 'contracted', 'started', 'construction',
       'final_inspection', 'warranty', 'closed', 'suspended', 'cancelled', 'terminated') THEN
    RAISE EXCEPTION 'ไม่รู้จักขั้นโครงการ "%"', p_stage;
  END IF;
  IF length(v_reason) > 4000 OR length(v_ref) > 200 THEN
    RAISE EXCEPTION 'เหตุผลยาวเกิน 4,000 ตัวอักษร หรือเลขที่หนังสือยาวเกิน 200 ตัวอักษร';
  END IF;
  IF p_project_id IS NULL OR NOT public.civil_can_read_project(p_project_id) THEN
    RAISE EXCEPTION 'ไม่พบโครงการ หรือไม่มีสิทธิ์เข้าถึง' USING ERRCODE = '42501';
  END IF;

  v_manage   := public.civil_can_manage_project(p_project_id);
  v_write    := v_manage OR public.civil_can_write_project(p_project_id);
  IF NOT v_write THEN   -- ตรวจสิทธิ์ก่อนล็อกแถวและก่อนกติกาขั้น: คนที่อ่านได้อย่างเดียว (viewer ฯลฯ) ได้ข้อความเรื่องสิทธิ์เสมอ
    RAISE EXCEPTION 'ไม่มีสิทธิ์เปลี่ยนขั้นโครงการนี้' USING ERRCODE = '42501';
  END IF;

  SELECT p.stage, p.stage_before_hold INTO v_old, v_hold
  FROM public.civil_projects AS p WHERE p.id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบโครงการ' USING ERRCODE = '42501';
  END IF;
  IF p_stage = v_old THEN
    RAISE EXCEPTION 'โครงการอยู่ขั้นนี้อยู่แล้ว (มีคนเปลี่ยนไปก่อนหรือไม่ — โหลดข้อมูลล่าสุด)';
  END IF;

  v_old_ord  := public.civil_stage_ord(v_old);
  v_new_ord  := public.civil_stage_ord(p_stage);
  v_base     := CASE WHEN v_old = 'suspended' THEN v_hold ELSE v_old END;
  v_base_ord := public.civil_stage_ord(v_base);

  IF v_old_ord IS NOT NULL AND v_new_ord = v_old_ord + 1 THEN
    -- ขั้นถัดไปตามเส้นหลัก
    v_need_reason := false;
    v_need_manage := p_stage IN ('warranty', 'closed');
    IF p_stage = 'closed' AND NOT (
      EXISTS (SELECT 1 FROM public.civil_project_milestones AS m
              WHERE m.project_id = p_project_id AND m.key = 'guarantee_returned' AND m.done_on IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.civil_project_contracts AS c
                 WHERE c.project_id = p_project_id AND c.guarantee_type = 'none')
    ) THEN
      v_need_reason := true;   -- ปิดข้ามเงื่อนไข "คืนหลักประกันแล้ว" ต้องบอกเหตุผล
    END IF;
  ELSIF v_old_ord IS NOT NULL AND v_new_ord IS NOT NULL THEN
    NULL;   -- ข้ามขั้น / ถอยขั้น: ผู้จัดการ + เหตุผล (ค่าตั้งต้น)
  ELSIF p_stage = 'suspended' THEN
    IF v_old_ord IS NULL OR v_old = 'closed' THEN
      RAISE EXCEPTION 'ระงับได้เฉพาะโครงการที่ยังดำเนินอยู่ (ไม่ใช่ปิดแล้ว/ยกเลิก/บอกเลิก)';
    END IF;
    v_need_ref := true;
    v_new_hold := v_old;
  ELSIF v_old = 'suspended' AND v_new_ord IS NOT NULL THEN
    NULL;   -- กลับมาดำเนินการ: ผู้จัดการ + เหตุผล
  ELSIF p_stage IN ('cancelled', 'terminated') AND v_old = 'suspended' AND v_hold IS NULL THEN
    RAISE EXCEPTION 'โครงการนี้ถูกระงับไว้ก่อนระบบจะจำขั้นเดิม — ให้ "กลับมาดำเนินการ" ที่ขั้นที่ถูกต้องก่อน แล้วค่อยยกเลิก/บอกเลิกสัญญา';
  ELSIF p_stage = 'cancelled' THEN
    IF v_base_ord IS NULL OR v_base_ord > 3 THEN
      RAISE EXCEPTION 'ยกเลิกได้เฉพาะโครงการที่ยังไม่ลงนามสัญญา — ลงนามแล้วให้ใช้ "บอกเลิกสัญญา"';
    END IF;
    v_need_ref := true;
  ELSIF p_stage = 'terminated' THEN
    IF v_base_ord IS NULL OR v_base_ord NOT BETWEEN 4 AND 7 THEN
      RAISE EXCEPTION 'บอกเลิกสัญญาได้เฉพาะช่วงหลังลงนามสัญญาจนถึงก่อนตรวจรับงวดสุดท้ายเสร็จ';
    END IF;
    v_need_ref := true;
  ELSIF v_old IN ('cancelled', 'terminated') AND v_new_ord IS NOT NULL THEN
    NULL;   -- เปิดโครงการใหม่ (แก้การกดผิด): ผู้จัดการ + เหตุผล
  ELSE
    RAISE EXCEPTION 'เปลี่ยนจากขั้น "%" ไปขั้น "%" ไม่ได้', v_old, p_stage;
  END IF;

  IF v_need_manage AND NOT v_manage THEN
    RAISE EXCEPTION 'การเปลี่ยนขั้นนี้ต้องให้หัวหน้ากองหรือผู้ดูแลระบบเป็นผู้ทำ' USING ERRCODE = '42501';
  END IF;
  IF v_need_reason AND v_reason IS NULL THEN
    RAISE EXCEPTION 'ต้องระบุเหตุผลของการเปลี่ยนขั้นนี้';
  END IF;
  IF v_need_ref AND v_ref IS NULL THEN
    RAISE EXCEPTION 'ต้องระบุเลขที่หนังสือ/คำสั่งที่เป็นเหตุของการเปลี่ยนขั้นนี้';
  END IF;

  PERFORM public.civil_stage_context(true, 'stage_change', v_reason, v_ref, p_ref_date);
  UPDATE public.civil_projects SET stage = p_stage, stage_before_hold = v_new_hold WHERE id = p_project_id;
  IF NOT FOUND THEN
    -- เกิดได้ถ้า RLS มีผลกับเจ้าของฟังก์ชันบนฐานจริง (FORCE RLS / เจ้าของตารางไม่ใช่ผู้สร้างฟังก์ชัน) — ห้ามตอบว่าสำเร็จเงียบๆ
    RAISE EXCEPTION 'บันทึกขั้นโครงการไม่สำเร็จ (ไม่มีแถวถูกแก้) — แจ้งผู้ดูแลระบบ';
  END IF;
  PERFORM public.civil_stage_context(false, NULL, NULL, NULL, NULL);
  RETURN p_stage;
END;
$$;
REVOKE ALL ON FUNCTION public.civil_set_project_stage(uuid, text, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.civil_set_project_stage(uuid, text, text, text, date) TO authenticated;

-- เลื่อนเอง started → construction เมื่อล็อกรายงานประจำสัปดาห์ (draft → final)
CREATE OR REPLACE FUNCTION public.civil_reports_auto_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.civil_projects WHERE id = NEW.project_id AND stage = 'started') THEN
    PERFORM public.civil_stage_context(true, 'auto_stage',
      format('ระบบเลื่อนขั้นเอง: ล็อกรายงานผลการก่อสร้างประจำสัปดาห์ที่ %s', NEW.week_no), NULL, NULL);
    UPDATE public.civil_projects SET stage = 'construction' WHERE id = NEW.project_id AND stage = 'started';
    PERFORM public.civil_stage_context(false, NULL, NULL, NULL, NULL);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.civil_reports_auto_stage() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS civil_reports_auto_stage_trigger ON public.civil_weekly_reports;
CREATE TRIGGER civil_reports_auto_stage_trigger
  AFTER UPDATE OF status ON public.civil_weekly_reports
  FOR EACH ROW WHEN (OLD.status = 'draft' AND NEW.status = 'final')
  EXECUTE FUNCTION public.civil_reports_auto_stage();

-- ── 5) ตารางลูก: ประทับผู้บันทึก/เวลา · ย้ายข้ามโครงการไม่ได้ ───────────────────────────────
CREATE OR REPLACE FUNCTION public.civil_child_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := coalesce(auth.uid(), NEW.created_by);
    NEW.updated_by := NEW.created_by;
    NEW.created_at := now();
    NEW.updated_at := now();
  ELSE
    IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
      RAISE EXCEPTION 'ย้ายข้อมูลไปโครงการอื่นไม่ได้ — ลบแล้วบันทึกใหม่ในโครงการที่ถูกต้อง';
    END IF;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    NEW.updated_by := coalesce(auth.uid(), NEW.updated_by);
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

-- ช่องที่เป็นผลการตัดสินของผู้มีอำนาจ — แก้ได้เฉพาะผู้จัดการโครงการ
-- อาร์กิวเมนต์ของ trigger: <คอลัมน์ผล>, <คอลัมน์ผู้จัดการเท่านั้น…>, '--', <คอลัมน์ที่ล็อกเมื่อมีผลแล้ว…>
--   ชุดหลัง '--' = ข้อเท็จจริงที่ผลอ้างถึง (เลขงวด วันส่งมอบ ชนิดคำขอ …) — มีผลแล้วคนอื่นแก้ย้อนหลังไม่ได้ (ประเด็น สตง.)
--   ช่องที่ไม่อยู่ในทั้งสองชุด (เช่น ฎีกา/เบิกจ่าย) ยังแก้ได้ตามสิทธิ์เขียนเดิม
CREATE OR REPLACE FUNCTION public.civil_manage_columns_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  v_decided boolean := coalesce(jsonb_typeof(v_old -> TG_ARGV[0]), 'null') <> 'null';
  v_locked boolean := false;
  v_col text;
BEGIN
  IF auth.uid() IS NULL OR public.civil_can_manage_project(NEW.project_id) THEN
    RETURN NEW;
  END IF;
  FOREACH v_col IN ARRAY TG_ARGV LOOP
    IF v_col = '--' THEN
      v_locked := true;
    ELSIF (NOT v_locked OR v_decided)
          AND coalesce(v_new -> v_col, 'null'::jsonb) IS DISTINCT FROM coalesce(v_old -> v_col, 'null'::jsonb) THEN
      IF v_locked THEN
        RAISE EXCEPTION 'ช่อง "%" แก้ไม่ได้ เพราะบันทึกผลการพิจารณาแล้ว — ให้หัวหน้ากองหรือผู้ดูแลระบบแก้', v_col
          USING ERRCODE = '42501';
      END IF;
      RAISE EXCEPTION 'ช่อง "%" เป็นผลการพิจารณาของผู้มีอำนาจ — ให้หัวหน้ากองหรือผู้ดูแลระบบเป็นผู้บันทึก', v_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

-- จุดตรวจที่บันทึกได้เฉพาะผู้จัดการโครงการ + คีย์ของแถวเปลี่ยนไม่ได้
CREATE OR REPLACE FUNCTION public.civil_milestones_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_key text := CASE WHEN TG_OP = 'DELETE' THEN OLD.key ELSE NEW.key END;
  v_project uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.project_id ELSE NEW.project_id END;
BEGIN
  -- ลบตามโครงการ (CASCADE): แถวโครงการหายไปแล้ว civil_can_manage_project จึงตอบ false เสมอ — สิทธิ์ลบถูกตรวจโดย
  -- policy civil_projects_delete แล้ว ไม่งั้นแอดมินลบโครงการที่บันทึกคืนหลักประกันแล้วไม่ได้ (ได้ 42501 หลอกตา)
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.civil_projects WHERE id = OLD.project_id) THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.key IS DISTINCT FROM OLD.key THEN
    RAISE EXCEPTION 'เปลี่ยนชนิดจุดตรวจของแถวเดิมไม่ได้ — ลบแล้วบันทึกจุดตรวจที่ถูกต้องใหม่';
  END IF;
  IF auth.uid() IS NOT NULL AND v_key IN ('guarantee_returned')
     AND NOT public.civil_can_manage_project(v_project) THEN
    RAISE EXCEPTION 'จุดตรวจ "คืนหลักประกันสัญญา" ให้หัวหน้ากองหรือผู้ดูแลระบบเป็นผู้บันทึก' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- ประวัติ: แก้ไม่ได้ · ผู้ใช้ (บทบาท authenticated) เพิ่มได้เฉพาะ note และระบบประทับผู้บันทึก/เวลาให้
-- ⚠️ ฟังก์ชันนี้ต้อง "ไม่" เป็น SECURITY DEFINER: แยกผู้ใช้กับระบบด้วย current_user
--    (แถวที่ trigger/RPC ของโมดูลเขียนรันในนามเจ้าของฟังก์ชัน current_user จึงไม่ใช่ authenticated)
CREATE OR REPLACE FUNCTION public.civil_events_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'ประวัติโครงการแก้ไขไม่ได้ (เขียนเพิ่มอย่างเดียว)';
  END IF;
  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.kind <> 'note' OR NEW.from_stage IS NOT NULL OR NEW.to_stage IS NOT NULL THEN
      RAISE EXCEPTION 'เพิ่มประวัติได้เฉพาะบันทึกข้อความ (note) — การเปลี่ยนขั้นระบบบันทึกเอง' USING ERRCODE = '42501';
    END IF;
    IF nullif(btrim(coalesce(NEW.reason, '')), '') IS NULL THEN
      RAISE EXCEPTION 'บันทึกข้อความต้องมีเนื้อหา (ช่อง reason)';
    END IF;
    NEW.actor := auth.uid();
    NEW.created_at := now();
    NEW.detail := '{}'::jsonb;   -- ช่อง detail สงวนให้ระบบ (กันขนาดไม่จำกัด + กันปลอม key ให้ดูเหมือนประวัติของระบบ)
    NEW.ref_no := nullif(btrim(coalesce(NEW.ref_no, '')), '');
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.civil_child_stamp() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.civil_manage_columns_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.civil_milestones_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.civil_events_guard() FROM PUBLIC, anon, authenticated;

DO $stamp$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['civil_project_milestones', 'civil_project_installments', 'civil_project_changes',
                                 'civil_project_defects', 'civil_project_documents'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', v_table || '_stamp_trigger', v_table);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.civil_child_stamp()',
                   v_table || '_stamp_trigger', v_table);
  END LOOP;
END $stamp$;

DROP TRIGGER IF EXISTS civil_installments_manage_guard_trigger ON public.civil_project_installments;
CREATE TRIGGER civil_installments_manage_guard_trigger
  BEFORE INSERT OR UPDATE ON public.civil_project_installments
  FOR EACH ROW EXECUTE FUNCTION public.civil_manage_columns_guard(
    'inspection_result', 'inspection_reason', 'inspection_dissent', 'egp_inspection_no',
    '--', 'installment_no', 'amount', 'work_pct', 'due_on', 'delivered_on', 'delivery_ref_no',
    'chair_acknowledged_on', 'inspected_on', 'fine_reserved');

DROP TRIGGER IF EXISTS civil_changes_manage_guard_trigger ON public.civil_project_changes;
CREATE TRIGGER civil_changes_manage_guard_trigger
  BEFORE INSERT OR UPDATE ON public.civil_project_changes
  FOR EACH ROW EXECUTE FUNCTION public.civil_manage_columns_guard(
    'decision', 'approved_on', 'approved_days', 'new_end_date', 'amount_change',
    '--', 'kind', 'cause', 'cause_ended_on', 'request_received_on', 'requested_days', 'ref_no', 'ref_date');

DROP TRIGGER IF EXISTS civil_milestones_guard_trigger ON public.civil_project_milestones;
CREATE TRIGGER civil_milestones_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON public.civil_project_milestones
  FOR EACH ROW EXECUTE FUNCTION public.civil_milestones_guard();

DROP TRIGGER IF EXISTS civil_events_guard_trigger ON public.civil_project_events;
CREATE TRIGGER civil_events_guard_trigger
  BEFORE INSERT OR UPDATE ON public.civil_project_events
  FOR EACH ROW EXECUTE FUNCTION public.civil_events_guard();

-- ── 6) สิทธิ์ตาราง + policy ─────────────────────────────────────────────────────────
REVOKE ALL ON TABLE public.civil_project_milestones, public.civil_project_installments, public.civil_project_changes,
  public.civil_project_defects, public.civil_project_events, public.civil_project_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.civil_project_milestones, public.civil_project_installments,
  public.civil_project_changes, public.civil_project_defects, public.civil_project_documents TO authenticated;
GRANT SELECT, INSERT ON TABLE public.civil_project_events TO authenticated;   -- ไม่มี UPDATE/DELETE โดยตั้งใจ

-- จุดตรวจ: ลบได้ตามสิทธิ์เขียน (แก้การติ๊กผิด) — guarantee_returned ถูกกันด้วย trigger
DROP POLICY IF EXISTS "civil_milestones_select" ON public.civil_project_milestones;
DROP POLICY IF EXISTS "civil_milestones_insert" ON public.civil_project_milestones;
DROP POLICY IF EXISTS "civil_milestones_update" ON public.civil_project_milestones;
DROP POLICY IF EXISTS "civil_milestones_delete" ON public.civil_project_milestones;
CREATE POLICY "civil_milestones_select" ON public.civil_project_milestones
  FOR SELECT TO authenticated USING (public.civil_can_read_project(project_id));
CREATE POLICY "civil_milestones_insert" ON public.civil_project_milestones
  FOR INSERT TO authenticated WITH CHECK (public.civil_can_write_project(project_id));
CREATE POLICY "civil_milestones_update" ON public.civil_project_milestones
  FOR UPDATE TO authenticated
  USING (public.civil_can_write_project(project_id)) WITH CHECK (public.civil_can_write_project(project_id));
CREATE POLICY "civil_milestones_delete" ON public.civil_project_milestones
  FOR DELETE TO authenticated USING (public.civil_can_write_project(project_id));

-- งวดงาน / ขยายเวลา-แก้สัญญา / ตรวจชำรุด: บันทึกทางราชการ ลบได้เฉพาะผู้จัดการโครงการ
DO $official$
DECLARE
  v_table text;
  v_short text;
BEGIN
  FOR v_table, v_short IN
    SELECT * FROM (VALUES ('civil_project_installments', 'civil_installments'),
                          ('civil_project_changes', 'civil_changes'),
                          ('civil_project_defects', 'civil_defects')) AS t(a, b)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_short || '_select', v_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_short || '_insert', v_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_short || '_update', v_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_short || '_delete', v_table);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.civil_can_read_project(project_id))',
                   v_short || '_select', v_table);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.civil_can_write_project(project_id))',
                   v_short || '_insert', v_table);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.civil_can_write_project(project_id)) '
                   'WITH CHECK (public.civil_can_write_project(project_id))', v_short || '_update', v_table);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.civil_can_manage_project(project_id))',
                   v_short || '_delete', v_table);
  END LOOP;
END $official$;

-- ไฟล์แนบ: ลบได้โดยผู้แนบเอง (ที่ยังมีสิทธิ์เขียน) หรือผู้จัดการโครงการ
DROP POLICY IF EXISTS "civil_documents_select" ON public.civil_project_documents;
DROP POLICY IF EXISTS "civil_documents_insert" ON public.civil_project_documents;
DROP POLICY IF EXISTS "civil_documents_update" ON public.civil_project_documents;
DROP POLICY IF EXISTS "civil_documents_delete" ON public.civil_project_documents;
CREATE POLICY "civil_documents_select" ON public.civil_project_documents
  FOR SELECT TO authenticated USING (public.civil_can_read_project(project_id));
CREATE POLICY "civil_documents_insert" ON public.civil_project_documents
  FOR INSERT TO authenticated WITH CHECK (public.civil_can_write_project(project_id));
CREATE POLICY "civil_documents_update" ON public.civil_project_documents
  FOR UPDATE TO authenticated
  USING (public.civil_can_write_project(project_id)) WITH CHECK (public.civil_can_write_project(project_id));
CREATE POLICY "civil_documents_delete" ON public.civil_project_documents
  FOR DELETE TO authenticated
  USING (public.civil_can_manage_project(project_id)
         OR (created_by = auth.uid() AND public.civil_can_write_project(project_id)));

-- ประวัติ: อ่านตามสิทธิ์อ่าน · เพิ่ม note ตามสิทธิ์เขียน · ไม่มี policy แก้/ลบ
DROP POLICY IF EXISTS "civil_events_select" ON public.civil_project_events;
DROP POLICY IF EXISTS "civil_events_insert" ON public.civil_project_events;
CREATE POLICY "civil_events_select" ON public.civil_project_events
  FOR SELECT TO authenticated USING (public.civil_can_read_project(project_id));
CREATE POLICY "civil_events_insert" ON public.civil_project_events
  FOR INSERT TO authenticated WITH CHECK (public.civil_can_write_project(project_id));

-- ── ด่านตรวจท้ายไฟล์: พังดังๆ แล้วย้อนกลับทั้งก้อน แทนการผ่านเงียบ ──────────────────────────────
DO $verify$
DECLARE
  v_other text;
  v_table text;
BEGIN
  -- (จาก #649) policy อ่านของ civil_projects ต้องเหลือตัวเดียว ไม่งั้นรวมกันแบบ OR แล้วอาจเปิดกว้าง
  SELECT string_agg(policyname || ' (' || cmd || ' → ' || array_to_string(roles, ',') || ')', ', ')
    INTO v_other
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'civil_projects'
    AND cmd IN ('SELECT', 'ALL') AND policyname <> 'civil_projects_select';
  IF v_other IS NOT NULL THEN
    RAISE EXCEPTION 'civil_projects ยังมี policy อ่านตัวอื่น ซึ่งรวมกับตัวใหม่แบบ OR และอาจเปิดกว้างอยู่: % — ตรวจก่อน (ไฟล์นี้ย้อนกลับทั้งก้อนแล้ว)', v_other;
  END IF;
  -- anon ต้องไม่มีสิทธิ์ใดๆ บนตาราง civil_* ทุกตาราง (รวมที่ได้ผ่าน PUBLIC)
  FOR v_table IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'civil\_%' LOOP
    IF has_table_privilege('anon', 'public.' || quote_ident(v_table), 'SELECT')
       OR has_table_privilege('anon', 'public.' || quote_ident(v_table), 'INSERT')
       OR has_table_privilege('anon', 'public.' || quote_ident(v_table), 'UPDATE')
       OR has_table_privilege('anon', 'public.' || quote_ident(v_table), 'DELETE')
       OR has_any_column_privilege('anon', 'public.' || quote_ident(v_table), 'SELECT')
       OR has_any_column_privilege('anon', 'public.' || quote_ident(v_table), 'INSERT')
       OR has_any_column_privilege('anon', 'public.' || quote_ident(v_table), 'UPDATE') THEN
      RAISE EXCEPTION 'anon ยังมีสิทธิ์บนตาราง % (ทั้งตารางหรือราย column) — ตรวจ GRANT ... TO PUBLIC/anon', v_table;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname IN ('civil_project_milestones', 'civil_project_installments',
               'civil_project_changes', 'civil_project_defects', 'civil_project_events', 'civil_project_documents')
               AND NOT c.relrowsecurity) THEN
    RAISE EXCEPTION 'ตารางใหม่บางตารางยังไม่ได้เปิด RLS';
  END IF;
  IF has_function_privilege('anon', 'public.civil_stage_context(boolean,text,text,text,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon ต้องเรียก civil_stage_context ไม่ได้';
  END IF;
  -- ชื่อคอลัมน์ที่ส่งให้ civil_manage_columns_guard พิมพ์ผิด = ด่านผ่านเงียบตลอดไป → ตรวจว่ามีจริงทุกตัว
  SELECT string_agg(t.tgrelid::regclass || '.' || a.arg, ', ')
    INTO v_other
  FROM pg_trigger AS t
  CROSS JOIN LATERAL unnest(string_to_array(encode(t.tgargs, 'escape'), '\000')) AS a(arg)   -- tgargs คั่นด้วย NUL
  WHERE t.tgfoid = 'public.civil_manage_columns_guard()'::regprocedure AND NOT t.tgisinternal
    AND a.arg NOT IN ('--', '')
    AND NOT EXISTS (SELECT 1 FROM pg_attribute AS c
                    WHERE c.attrelid = t.tgrelid AND c.attname = a.arg AND c.attnum > 0 AND NOT c.attisdropped);
  IF v_other IS NOT NULL THEN
    RAISE EXCEPTION 'trigger civil_manage_columns_guard อ้างคอลัมน์ที่ไม่มีจริง: %', v_other;
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgfoid = 'public.civil_manage_columns_guard()'::regprocedure AND NOT tgisinternal) <> 2 THEN
    RAISE EXCEPTION 'ต้องมี trigger civil_manage_columns_guard 2 ตัว (งวดงาน + ขยายเวลา/แก้สัญญา)';
  END IF;
  IF has_table_privilege('authenticated', 'public.civil_projects', 'TRUNCATE') THEN
    RAISE EXCEPTION 'authenticated ยังมีสิทธิ์ TRUNCATE บน civil_projects (อาจได้ผ่าน PUBLIC) — ตรวจ GRANT';
  END IF;
  IF has_table_privilege('authenticated', 'public.civil_project_events', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.civil_project_events', 'DELETE') THEN
    RAISE EXCEPTION 'civil_project_events ต้องเขียนเพิ่มอย่างเดียว แต่ authenticated ยังมีสิทธิ์ UPDATE/DELETE';
  END IF;
  IF has_function_privilege('authenticated', 'public.civil_stage_context(boolean,text,text,text,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated ต้องเรียก civil_stage_context ไม่ได้ (ไม่งั้นข้ามด่านเปลี่ยนขั้นได้)';
  END IF;
  -- stage กับ status ต้องสอดคล้องทุกแถว
  IF EXISTS (SELECT 1 FROM public.civil_projects WHERE status IS DISTINCT FROM public.civil_status_of_stage(stage)) THEN
    RAISE EXCEPTION 'มีโครงการที่ status ไม่ตรงกับ stage หลังเติมค่า — ตรวจข้อมูลก่อน';
  END IF;
END $verify$;

COMMIT;
