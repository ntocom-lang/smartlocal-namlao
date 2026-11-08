-- เมนู "แผนพัฒนาท้องถิ่น" แท็บ "ติดตามผล" ไฟล์ 2/3 — FK · กติกาสายรายการ · trigger · RPC อ่านขั้นโครงการก่อสร้าง · policy
--   ต้องรัน 20261110100000 ก่อน · ไฟล์ 3/3 (20261110100200) ใส่ FK civil_projects.registry_ref แยก (ไม่รันไฟล์ 3 ไฟล์นี้ก็ใช้ได้)
--
-- 1) สายรายการ (origin_item_id) — trigger ใหม่ local_op_plan_items_origin_trigger (ไม่แตะ guard เดิม)
--      ตั้งได้ตอนเพิ่มแถวเท่านั้น · ต้นทางต้องเป็นรายการของ อปท. เดียวกัน ปีงบเดียวกัน และอยู่ในฉบับครั้งก่อนหน้า
--      ส่ง id แถวไหนในสายมาก็ได้ ระบบแปลงเป็นต้นสายเอง (เก็บต้นสายตรงๆ ไม่ต้องไล่ทีละทอด) · 1 ฉบับมีสายเดียวกันซ้ำไม่ได้
--    source_op_plan_id — trigger ใหม่ local_op_plans_source_trigger: ตั้งได้ตอนสร้างฉบับเท่านั้น ต้องเป็นฉบับครั้งก่อนของปีเดียวกัน
--      ตรวจ อปท. จากฉบับ/แผนพัฒนาตรงๆ ไม่พึ่ง NEW.municipality_id จึงไม่ผูกความปลอดภัยกับลำดับชื่อ trigger
-- 2) ผลดำเนินการ (local_op_item_progress)
--      บันทึกได้เฉพาะสายที่มีฉบับ "ประกาศแล้ว" อย่างน้อย 1 ฉบับ (ฉบับร่างยังไม่ใช่แผน ไม่มีอะไรให้ติดตาม)
--      อปท. / ปีงบ / กอง ระบบคัดจากฉบับล่าสุดที่ประกาศแล้วในสายนั้นทุกครั้งที่เขียน (ผู้ใช้ส่งค่าอื่นมาก็ถูกทับ)
--      สิทธิ์: ผู้จัดการแผน = ทุกรายการ · officer/staff ของกองผู้รับผิดชอบ = รายการของกองตัวเอง (เพิ่ม/แก้/ลบ = กลับเป็นยังไม่ดำเนินการ)
--        policy ตัดสินจาก department_id ในแถว (แนวเดียวกับ R0-A ไม่ไล่ถามแม่) — WITH CHECK ใช้ค่าที่ trigger คัดใหม่แล้ว
--        ⇒ ฉบับแก้ไขย้ายรายการไปกองอื่น: กองเดิมแก้ต่อไม่ได้ทันที (WITH CHECK ไม่ผ่าน)
--        ⇒ และตอนประกาศ/ยกเลิกประกาศฉบับใด trigger local_op_plans_sync_progress ย้ายกองของแถวผลตามฉบับล่าสุดให้เอง
--      วันแล้วเสร็จ: ไม่เกินวันนี้ (เวลาไทย) และไม่ก่อนวันเริ่มปีงบ (1 ต.ค.) · วันเริ่ม: ไม่เกินวันนี้
--      ยกเลิกประกาศฉบับที่เป็นฉบับประกาศเดียวของสายที่มีผลบันทึกแล้ว = ไม่ได้ (ผลจะลอยไม่มีแผนรองรับ) ต้องลบผลก่อน
-- 3) ข้อมูลรายงานประจำปี (local_plan_evaluations) — ผู้จัดการแผนเขียน ทุกคนที่อ่านแผนได้อ่านได้
--      วันที่ทุกช่องไม่เกินวันนี้ (ข้อเท็จจริงที่ทำแล้ว) · ย้าย อปท./ปีงบไม่ได้
-- 4) ประวัติ: เขียนทับ local_plan_log_event ทั้งตัว (CREATE OR REPLACE แทนทั้งฟังก์ชัน — NOTES ข้อ CREATE OR REPLACE)
--      คัดของเดิมจาก 20261109100200 ครบทุกบรรทัด เพิ่มเฉพาะ entity 'op_progress' (entity_id = lineage_id) และ 'evaluation'
-- 5) RPC local_plan_civil_stages: คนที่อ่านแผนได้ (รวมผู้บริหาร viewer) เห็น "ขั้น" ของโครงการก่อสร้างที่ผูกทะเบียนแล้ว
--      เท่านั้น — คืน 4 ช่อง (registry_ref, ปีงบ, ขั้น, เวลาเปลี่ยนขั้น) ไม่คืน id ชื่อ ผู้รับจ้าง วงเงิน เลขสัญญา พิกัด
--      เพราะ civil_projects ปิดการอ่านไว้ (#649) สำนักปลัด/ผู้บริหารอ่านตรงไม่ได้ · ข้าม อปท. ไม่ได้
-- 6) ถอน TRUNCATE / REFERENCES / TRIGGER ของ authenticated (#657) · anon ไม่มีสิทธิ์ใดๆ
--
-- ย้อนกลับ: DROP TABLE local_op_item_progress, local_plan_evaluations · DROP TRIGGER/FUNCTION ที่ไฟล์นี้สร้าง
--           (local_op_plan_items_origin_*, local_op_plans_source_*, local_op_plans_sync_progress*, local_op_item_progress_guard*,
--            local_plan_evaluations_guard*, local_plan_civil_stages) · รัน CREATE FUNCTION local_plan_log_event จาก 20261109100200 กลับ
--           แล้ว DROP COLUMN origin_item_id / source_op_plan_id + คืน CHECK entity เดิม (ไฟล์ 1)
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE
  v_extra text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                   AND table_name = 'local_op_plan_items' AND column_name = 'origin_item_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                   AND table_name = 'local_op_plans' AND column_name = 'source_op_plan_id')
     OR to_regclass('public.local_op_item_progress') IS NULL OR to_regclass('public.local_plan_evaluations') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261110100000_local_plan_progress_tables.sql ก่อน';
  END IF;
  IF to_regprocedure('public.local_plan_is_manager(uuid)') IS NULL
     OR to_regprocedure('public.local_plan_can_read(uuid)') IS NULL
     OR to_regprocedure('public.local_plan_dept_can_edit(uuid,uuid)') IS NULL
     OR to_regprocedure('public.local_plan_stamp()') IS NULL THEN
    RAISE EXCEPTION 'Schema drift: ไม่พบฟังก์ชันสิทธิ์ของเมนูแผนพัฒนา (20261109100200)';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'civil_projects'
        AND column_name IN ('registry_ref', 'stage', 'stage_changed_at', 'fiscal_year', 'municipality_id')) <> 5 THEN
    RAISE EXCEPTION 'ต้องรัน 20261108100000_civil_lifecycle_columns.sql ก่อน (civil_projects ไม่มี registry_ref/stage ครบ)';
  END IF;
  -- trigger นอกรีโปบนตารางแผน = ลำดับ trigger ตามชื่อที่ไฟล์นี้พึ่ง (guard → origin/source → stamp) อาจถูกแทรก → หยุดดูก่อน
  SELECT string_agg(c.relname || '.' || t.tgname, ', ') INTO v_extra
  FROM pg_trigger AS t JOIN pg_class AS c ON c.oid = t.tgrelid
  WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
    AND ((c.relname = 'local_op_plans' AND t.tgname NOT IN ('local_op_plans_guard_trigger', 'local_op_plans_stamp_trigger',
            'local_op_plans_log_trigger', 'local_op_plans_source_trigger', 'local_op_plans_sync_progress_trigger'))
      OR (c.relname = 'local_op_plan_items' AND t.tgname NOT IN ('local_op_plan_items_guard_trigger', 'local_op_plan_items_stamp_trigger',
            'local_op_plan_items_log_trigger', 'local_op_plan_items_origin_trigger')));
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION 'Schema drift: มี trigger ที่ไม่รู้จักบนตารางแผน (%) — ตรวจก่อน', v_extra;
  END IF;
  -- sync (SECURITY DEFINER) ต้องข้าม RLS ของตารางผลได้ = เจ้าของตารางเป็นผู้รันไฟล์นี้ และไม่ได้ FORCE RLS
  IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace
               AND relname IN ('local_op_item_progress', 'local_op_plans', 'local_op_plan_items') AND relforcerowsecurity)
     OR (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'public.local_op_item_progress'::regclass) <> current_user THEN
    RAISE EXCEPTION 'ตารางผลต้องเป็นของผู้รันไฟล์นี้และไม่ FORCE RLS (trigger sync ต้องข้าม RLS ได้)';
  END IF;
END $guard$;

-- ── FK ───────────────────────────────────────────────────────────────────────────
DO $fk$
BEGIN
  -- ต้นสายลบไม่ได้ขณะที่ยังมีฉบับอื่นคัดไปใช้ (ไม่งั้นสายแตก ผลติดตามผูกผิดแถว)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'local_op_plan_items_origin_fk') THEN
    ALTER TABLE public.local_op_plan_items ADD CONSTRAINT local_op_plan_items_origin_fk
      FOREIGN KEY (origin_item_id) REFERENCES public.local_op_plan_items(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'local_op_plans_source_fk') THEN
    ALTER TABLE public.local_op_plans ADD CONSTRAINT local_op_plans_source_fk
      FOREIGN KEY (source_op_plan_id) REFERENCES public.local_op_plans(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'local_op_item_progress_lineage_fk') THEN
    ALTER TABLE public.local_op_item_progress ADD CONSTRAINT local_op_item_progress_lineage_fk
      FOREIGN KEY (lineage_id) REFERENCES public.local_op_plan_items(id) ON DELETE CASCADE;
  END IF;
END $fk$;
CREATE UNIQUE INDEX IF NOT EXISTS local_op_plan_items_one_per_lineage
  ON public.local_op_plan_items (op_plan_id, origin_item_id) WHERE origin_item_id IS NOT NULL;

-- ── 1) สายรายการ ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.local_op_plan_items_origin_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user     boolean := auth.uid() IS NOT NULL;
  v_muni     uuid;
  v_year     integer;
  v_rev      smallint;
  v_src_root uuid;
  v_src_muni uuid;
  v_src_year integer;
  v_src_rev  smallint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF v_user AND NEW.origin_item_id IS DISTINCT FROM OLD.origin_item_id THEN
      RAISE EXCEPTION 'ต้นสายของรายการตั้งได้ตอนเพิ่มแถวเท่านั้น' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.origin_item_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- อปท. อ่านจากฉบับตรงๆ ไม่พึ่ง NEW.municipality_id ที่ guard เดิมคัดให้ (ไม่ผูกความปลอดภัยกับลำดับชื่อ trigger)
  SELECT o.municipality_id, o.fiscal_year, o.revision_no INTO v_muni, v_year, v_rev
  FROM public.local_op_plans AS o WHERE o.id = NEW.op_plan_id;
  SELECT coalesce(i.origin_item_id, i.id), o.municipality_id, o.fiscal_year, o.revision_no
    INTO v_src_root, v_src_muni, v_src_year, v_src_rev
  FROM public.local_op_plan_items AS i JOIN public.local_op_plans AS o ON o.id = i.op_plan_id
  WHERE i.id = NEW.origin_item_id;
  IF v_src_root IS NULL THEN
    RAISE EXCEPTION 'ไม่พบรายการต้นทางที่คัดมา' USING ERRCODE = '23503';
  END IF;
  IF v_muni IS NULL OR v_src_muni IS DISTINCT FROM v_muni OR v_src_year IS DISTINCT FROM v_year OR v_src_rev >= v_rev THEN
    RAISE EXCEPTION 'รายการต้นทางต้องเป็นของ อปท. เดียวกัน ปีงบเดียวกัน และอยู่ในฉบับครั้งก่อนหน้า' USING ERRCODE = '23514';
  END IF;
  NEW.origin_item_id := v_src_root;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.local_op_plan_items_origin_guard() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.local_op_plans_source_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user     boolean := auth.uid() IS NOT NULL;
  v_muni     uuid;
  v_src_muni uuid;
  v_src_year integer;
  v_src_rev  smallint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- เว้นกรณี FK ตั้งเป็น NULL เพราะฉบับต้นทาง (ร่าง) ถูกลบไปแล้วจริง — ผู้ใช้ทำเงื่อนไขนี้เองไม่ได้
    IF v_user AND NEW.source_op_plan_id IS DISTINCT FROM OLD.source_op_plan_id
       AND NOT (NEW.source_op_plan_id IS NULL
                AND NOT EXISTS (SELECT 1 FROM public.local_op_plans AS s WHERE s.id = OLD.source_op_plan_id)) THEN
      RAISE EXCEPTION 'ฉบับต้นทางตั้งได้ตอนสร้างฉบับเท่านั้น' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.source_op_plan_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT municipality_id, fiscal_year, revision_no INTO v_src_muni, v_src_year, v_src_rev
  FROM public.local_op_plans WHERE id = NEW.source_op_plan_id;
  IF v_src_muni IS NULL THEN
    RAISE EXCEPTION 'ไม่พบฉบับต้นทางที่คัดมา' USING ERRCODE = '23503';
  END IF;
  -- อปท. อ่านจากแผนพัฒนาตรงๆ ไม่พึ่ง NEW.municipality_id ที่ guard เดิมคัดให้
  SELECT municipality_id INTO v_muni FROM public.local_dev_plans WHERE id = NEW.dev_plan_id;
  IF v_muni IS NULL OR v_src_muni IS DISTINCT FROM v_muni OR v_src_year <> NEW.fiscal_year OR v_src_rev >= NEW.revision_no THEN
    RAISE EXCEPTION 'ฉบับต้นทางต้องเป็นฉบับครั้งก่อนหน้าของปีงบเดียวกันใน อปท. เดียวกัน' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.local_op_plans_source_guard() FROM PUBLIC, anon, authenticated;

-- ── 2) ผลดำเนินการ ───────────────────────────────────────────────────────────────
-- ฉบับล่าสุดที่ประกาศแล้วของสาย → (อปท., ปีงบ, กอง) · ไม่มีฉบับประกาศ = ไม่พบแถว
CREATE OR REPLACE FUNCTION public.local_op_lineage_latest_published(p_lineage_id uuid)
RETURNS TABLE (municipality_id uuid, fiscal_year integer, department_id uuid)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT o.municipality_id, o.fiscal_year, i.department_id
  FROM public.local_op_plan_items AS i
  JOIN public.local_op_plans AS o ON o.id = i.op_plan_id
  WHERE (i.id = p_lineage_id OR i.origin_item_id = p_lineage_id) AND o.status = 'published'
  ORDER BY o.revision_no DESC
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.local_op_lineage_latest_published(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.local_op_item_progress_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user     boolean := auth.uid() IS NOT NULL;
  v_today    date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_root     uuid;
  v_muni     uuid;
  v_year     integer;
  v_dept     uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.lineage_id IS DISTINCT FROM OLD.lineage_id THEN
    RAISE EXCEPTION 'ย้ายผลไปรายการอื่นไม่ได้ — ลบแล้วบันทึกที่รายการนั้นแทน' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(i.origin_item_id, i.id) INTO v_root FROM public.local_op_plan_items AS i WHERE i.id = NEW.lineage_id;
  IF v_root IS NULL THEN
    RAISE EXCEPTION 'ไม่พบรายการในแผนการดำเนินงาน' USING ERRCODE = '23503';
  END IF;
  NEW.lineage_id := v_root;                         -- ส่งแถวไหนในสายมาก็ผูกที่ต้นสาย

  -- กัน race กับการประกาศ/ยกเลิกประกาศ (RPC ถือ FOR UPDATE ที่แถวฉบับ): ล็อกทุกฉบับในสาย ทุกสถานะ (migration-reviewer ข้อ 2)
  -- เฉพาะ INSERT — UPDATE/DELETE ถือ row lock ของแถวผลอยู่แล้วและอ่านค่าใหม่หลังรอ · ล็อกตอน UPDATE ด้วยจะสวนลำดับกับ sync → deadlock
  IF TG_OP = 'INSERT' THEN
    PERFORM 1 FROM public.local_op_plans AS o
    WHERE o.id IN (SELECT i.op_plan_id FROM public.local_op_plan_items AS i WHERE i.id = v_root OR i.origin_item_id = v_root)
    FOR SHARE OF o;
  END IF;

  SELECT l.municipality_id, l.fiscal_year, l.department_id INTO v_muni, v_year, v_dept
  FROM public.local_op_lineage_latest_published(v_root) AS l;
  IF v_muni IS NULL THEN
    RAISE EXCEPTION 'บันทึกผลได้เฉพาะรายการในแผนการดำเนินงานที่ประกาศแล้ว' USING ERRCODE = '42501';
  END IF;
  -- กองถูกลบไปแล้ว (FK ตั้ง NULL) = ไม่คัดกองที่ไม่มีอยู่กลับมา
  IF v_dept IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.departments AS d WHERE d.id = v_dept) THEN
    v_dept := NULL;
  END IF;
  NEW.municipality_id := v_muni;
  NEW.fiscal_year := v_year;
  NEW.department_id := v_dept;

  IF v_user THEN
    IF NEW.done_on > v_today OR NEW.started_on > v_today THEN
      RAISE EXCEPTION 'วันเริ่ม/วันแล้วเสร็จต้องไม่เกินวันนี้' USING ERRCODE = '22023';
    END IF;
    -- ปีงบ พ.ศ. Y เริ่ม 1 ต.ค. ของปี ค.ศ. (Y − 544) เช่น 2570 → 1 ต.ค. 2026
    IF NEW.done_on < make_date(v_year - 544, 10, 1) THEN
      RAISE EXCEPTION 'วันแล้วเสร็จอยู่ก่อนเริ่มปีงบประมาณ %', v_year USING ERRCODE = '22023';
    END IF;
  END IF;
  NEW.reason := nullif(btrim(coalesce(NEW.reason, '')), '');
  NEW.note := nullif(btrim(coalesce(NEW.note, '')), '');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.local_op_item_progress_guard() FROM PUBLIC, anon, authenticated;

-- ประกาศ/ยกเลิกประกาศฉบับใด → กองของแถวผลในสายที่ฉบับนั้นมี ตามฉบับล่าสุดที่ประกาศแล้ว
CREATE OR REPLACE FUNCTION public.local_op_plans_sync_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_orphans integer;
BEGIN
  SELECT count(*) INTO v_orphans
  FROM public.local_op_item_progress AS p
  WHERE p.lineage_id IN (SELECT coalesce(i.origin_item_id, i.id) FROM public.local_op_plan_items AS i WHERE i.op_plan_id = NEW.id)
    AND NOT EXISTS (SELECT 1 FROM public.local_op_lineage_latest_published(p.lineage_id));
  IF v_orphans > 0 THEN
    RAISE EXCEPTION 'ยกเลิกประกาศไม่ได้: มีผลดำเนินการบันทึกแล้ว % รายการที่ไม่มีฉบับประกาศอื่นรองรับ — ลบผลของรายการเหล่านั้นก่อน', v_orphans
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.local_op_item_progress AS p
     SET department_id = l.department_id
    FROM (SELECT DISTINCT coalesce(i.origin_item_id, i.id) AS lineage_id
          FROM public.local_op_plan_items AS i WHERE i.op_plan_id = NEW.id) AS s,
         LATERAL public.local_op_lineage_latest_published(s.lineage_id) AS l
   WHERE p.lineage_id = s.lineage_id
     AND p.department_id IS DISTINCT FROM l.department_id;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.local_op_plans_sync_progress() FROM PUBLIC, anon, authenticated;

-- ── 3) ข้อมูลรายงานประจำปี ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.local_plan_evaluations_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.municipality_id IS DISTINCT FROM OLD.municipality_id OR NEW.fiscal_year IS DISTINCT FROM OLD.fiscal_year) THEN
    RAISE EXCEPTION 'ย้าย อปท./ปีงบของรายงานไม่ได้' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NOT NULL AND (NEW.disbursed_as_of > v_today OR NEW.committee_met_on > v_today
       OR NEW.reported_to_exec_on > v_today OR NEW.presented_on > v_today OR NEW.announced_on > v_today) THEN
    RAISE EXCEPTION 'วันที่ต้องไม่เกินวันนี้ (บันทึกสิ่งที่ทำแล้วเท่านั้น)' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.local_plan_evaluations_guard() FROM PUBLIC, anon, authenticated;

-- ── 4) ประวัติ (เขียนทับทั้งตัว — คัดจาก 20261109100200 แล้วเพิ่ม op_progress / evaluation) ──────────
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
    WHEN 'local_op_item_progress' THEN 'op_progress'
    WHEN 'local_plan_evaluations' THEN 'evaluation'
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
          CASE v_entity
            WHEN 'dev_project_year' THEN (v_row ->> 'project_id')::uuid
            WHEN 'op_progress' THEN (v_row ->> 'lineage_id')::uuid
            ELSE (v_row ->> 'id')::uuid
          END,
          v_parent, v_action, v_changes, v_reason, auth.uid());
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.local_plan_log_event() FROM PUBLIC, anon, authenticated;

-- ── trigger ──────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS local_op_plan_items_origin_trigger ON public.local_op_plan_items;
CREATE TRIGGER local_op_plan_items_origin_trigger BEFORE INSERT OR UPDATE ON public.local_op_plan_items
  FOR EACH ROW EXECUTE FUNCTION public.local_op_plan_items_origin_guard();

DROP TRIGGER IF EXISTS local_op_plans_source_trigger ON public.local_op_plans;
CREATE TRIGGER local_op_plans_source_trigger BEFORE INSERT OR UPDATE ON public.local_op_plans
  FOR EACH ROW EXECUTE FUNCTION public.local_op_plans_source_guard();
DROP TRIGGER IF EXISTS local_op_plans_sync_progress_trigger ON public.local_op_plans;
CREATE TRIGGER local_op_plans_sync_progress_trigger AFTER UPDATE OF status ON public.local_op_plans
  FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.local_op_plans_sync_progress();

DROP TRIGGER IF EXISTS local_op_item_progress_guard_trigger ON public.local_op_item_progress;
CREATE TRIGGER local_op_item_progress_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON public.local_op_item_progress
  FOR EACH ROW EXECUTE FUNCTION public.local_op_item_progress_guard();
DROP TRIGGER IF EXISTS local_op_item_progress_stamp_trigger ON public.local_op_item_progress;
CREATE TRIGGER local_op_item_progress_stamp_trigger BEFORE INSERT OR UPDATE ON public.local_op_item_progress
  FOR EACH ROW EXECUTE FUNCTION public.local_plan_stamp();
DROP TRIGGER IF EXISTS local_op_item_progress_log_trigger ON public.local_op_item_progress;
CREATE TRIGGER local_op_item_progress_log_trigger AFTER INSERT OR UPDATE OR DELETE ON public.local_op_item_progress
  FOR EACH ROW EXECUTE FUNCTION public.local_plan_log_event();

DROP TRIGGER IF EXISTS local_plan_evaluations_guard_trigger ON public.local_plan_evaluations;
CREATE TRIGGER local_plan_evaluations_guard_trigger BEFORE INSERT OR UPDATE ON public.local_plan_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.local_plan_evaluations_guard();
DROP TRIGGER IF EXISTS local_plan_evaluations_stamp_trigger ON public.local_plan_evaluations;
CREATE TRIGGER local_plan_evaluations_stamp_trigger BEFORE INSERT OR UPDATE ON public.local_plan_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.local_plan_stamp();
DROP TRIGGER IF EXISTS local_plan_evaluations_log_trigger ON public.local_plan_evaluations;
CREATE TRIGGER local_plan_evaluations_log_trigger AFTER INSERT OR UPDATE OR DELETE ON public.local_plan_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.local_plan_log_event();

-- ── 5) RPC อ่านขั้นของโครงการก่อสร้างที่ผูกทะเบียน ─────────────────────────────────
-- ไม่คืน id ของโครงการก่อสร้าง (หน้าจอแผนไม่ลิงก์ไปหน้าก่อสร้าง — คืนเท่าที่ต้องใช้ migration-reviewer ข้อ 10)
-- ⚠️ กรองปีด้วยข้อความ '2570' ตรงตัว: ถ้าโมดูลก่อสร้างเก็บเลขไทย/มีคำนำหน้า แถวจะหาย — หน้าจอ R1-B ต้องเตือนเมื่อผูกแล้วแต่ไม่พบขั้น
CREATE OR REPLACE FUNCTION public.local_plan_civil_stages(p_municipality_id uuid, p_fiscal_year integer DEFAULT NULL)
RETURNS TABLE (registry_ref uuid, fiscal_year text, stage text, stage_changed_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.local_plan_can_read(p_municipality_id) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์อ่านแผนของ อปท. นี้' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT c.registry_ref, c.fiscal_year, c.stage, c.stage_changed_at
    FROM public.civil_projects AS c
    JOIN public.local_dev_plan_projects AS p ON p.id = c.registry_ref AND p.municipality_id = c.municipality_id
    WHERE c.municipality_id = p_municipality_id
      AND (p_fiscal_year IS NULL OR btrim(c.fiscal_year) = p_fiscal_year::text);
END;
$$;
REVOKE ALL ON FUNCTION public.local_plan_civil_stages(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.local_plan_civil_stages(uuid, integer) TO authenticated;

-- ── policy ───────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "local_op_item_progress_select" ON public.local_op_item_progress;
DROP POLICY IF EXISTS "local_op_item_progress_insert" ON public.local_op_item_progress;
DROP POLICY IF EXISTS "local_op_item_progress_update" ON public.local_op_item_progress;
DROP POLICY IF EXISTS "local_op_item_progress_delete" ON public.local_op_item_progress;
CREATE POLICY "local_op_item_progress_select" ON public.local_op_item_progress FOR SELECT TO authenticated
  USING (public.local_plan_can_read(municipality_id));
CREATE POLICY "local_op_item_progress_insert" ON public.local_op_item_progress FOR INSERT TO authenticated
  WITH CHECK (public.local_plan_is_manager(municipality_id) OR public.local_plan_dept_can_edit(municipality_id, department_id));
CREATE POLICY "local_op_item_progress_update" ON public.local_op_item_progress FOR UPDATE TO authenticated
  USING (public.local_plan_is_manager(municipality_id) OR public.local_plan_dept_can_edit(municipality_id, department_id))
  WITH CHECK (public.local_plan_is_manager(municipality_id) OR public.local_plan_dept_can_edit(municipality_id, department_id));
CREATE POLICY "local_op_item_progress_delete" ON public.local_op_item_progress FOR DELETE TO authenticated
  USING (public.local_plan_is_manager(municipality_id) OR public.local_plan_dept_can_edit(municipality_id, department_id));

DROP POLICY IF EXISTS "local_plan_evaluations_select" ON public.local_plan_evaluations;
DROP POLICY IF EXISTS "local_plan_evaluations_insert" ON public.local_plan_evaluations;
DROP POLICY IF EXISTS "local_plan_evaluations_update" ON public.local_plan_evaluations;
DROP POLICY IF EXISTS "local_plan_evaluations_delete" ON public.local_plan_evaluations;
CREATE POLICY "local_plan_evaluations_select" ON public.local_plan_evaluations FOR SELECT TO authenticated
  USING (public.local_plan_can_read(municipality_id));
CREATE POLICY "local_plan_evaluations_insert" ON public.local_plan_evaluations FOR INSERT TO authenticated
  WITH CHECK (public.local_plan_is_manager(municipality_id));
CREATE POLICY "local_plan_evaluations_update" ON public.local_plan_evaluations FOR UPDATE TO authenticated
  USING (public.local_plan_is_manager(municipality_id)) WITH CHECK (public.local_plan_is_manager(municipality_id));
CREATE POLICY "local_plan_evaluations_delete" ON public.local_plan_evaluations FOR DELETE TO authenticated
  USING (public.local_plan_is_manager(municipality_id));

-- ── สิทธิ์ตาราง ───────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.local_op_item_progress, public.local_plan_evaluations TO authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.local_op_item_progress, public.local_plan_evaluations FROM authenticated;
REVOKE ALL ON public.local_op_item_progress, public.local_plan_evaluations FROM anon;

-- ── ด่านตรวจท้ายไฟล์ ──────────────────────────────────────────────────────────────
DO $check$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['local_op_item_progress', 'local_plan_evaluations'] LOOP
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
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
        AND tablename IN ('local_op_item_progress', 'local_plan_evaluations')) <> 8 THEN
    RAISE EXCEPTION 'จำนวน policy ของตารางใหม่ไม่ครบ 8 (2 ตาราง × 4)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname ~ '^local_'
               AND has_function_privilege('anon', oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'anon ยังมีสิทธิ์ EXECUTE บนฟังก์ชัน local_*';
  END IF;
  IF position('op_progress' IN pg_get_functiondef('public.local_plan_log_event()'::regprocedure)) = 0
     OR position('local_dev_plan_project_years' IN pg_get_functiondef('public.local_plan_log_event()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'local_plan_log_event ไม่ครบ (ต้องมีทั้ง entity เดิมและ op_progress)';
  END IF;
END $check$;

NOTIFY pgrst, 'reload schema';

COMMIT;
