-- เมนู "แผนพัฒนาท้องถิ่น" แท็บ "คลัง-แหล่งงบ" ไฟล์ 2/2 — FK · trigger · policy · ประวัติ
--   ต้องรัน 20261112100000 ก่อน
--
-- สิทธิ์ (ตัวตัดสินชุดเดียวกับ R0-A: local_plan_can_read / local_plan_is_manager / local_plan_dept_can_edit)
--   อ่าน: ทุกคนที่อ่านแผนได้ (ผู้จัดการแผน + officer/staff/technician/viewer ของ อปท. เดียวกัน)
--   แหล่งงบ / รอบยื่น / คลังโครงการ / ช่องแบบฟอร์ม 001: ผู้จัดการแผนเขียน
--   ความพร้อม 4 ด้าน: ผู้จัดการแผนเพิ่ม/ลบ/มอบกอง · officer/staff ของกองเจ้าของงานแก้ได้เฉพาะ ระดับ/วันเสร็จ/ไฟล์/หมายเหตุ
--     ของด้านที่กองตัวเองถือ (trigger จำกัดช่อง — ย้ายด้านไปกองอื่นเองไม่ได้)
--   anon ไม่มีสิทธิ์ใดๆ
--
-- กติกาที่ระบบบังคับ (ทุกข้อเป็นการตรวจข้อมูล ไม่ใช่การตัดสินแทนคน)
--   - อปท. ของทุกแถวระบบคัดจากแม่เสมอ (แหล่ง → รอบ · โครงการ → คลัง/ความพร้อม/ช่อง 001) ผู้ใช้ส่งค่าอื่นมาก็ถูกทับ
--     policy จึงตัดสินจากแถวตรงๆ ได้ (แนวเดียวกับ R0-A — WITH CHECK ใช้ค่าหลัง BEFORE trigger)
--   - แหล่งงบของคลังต้องเป็นของ อปท. เดียวกับโครงการ · ย้ายแถวข้ามแม่ไม่ได้ (ลบแล้วเพิ่มใหม่แทน)
--   - วันที่ที่เป็นข้อเท็จจริง (วันที่หนังสือแจ้ง · วันยื่น · วันแจ้งผล · วันความพร้อมเสร็จ) ต้องไม่เกินวันนี้ (เวลาไทย)
--     วันเปิด/ปิดรอบเป็นวันในอนาคตได้ (หนังสือแจ้งล่วงหน้า)
--   - ความพร้อมระดับ 4 ไม่กรอกวันเสร็จ ระบบใส่วันนี้ให้ · ลดระดับต่ำกว่า 4 ระบบล้างวันเสร็จ (ไฟล์เก็บไว้)
--   - FK: ลบโครงการที่อยู่ในคลัง / ลบแหล่งที่มีรอบหรือโครงการอ้าง = ไม่ได้ (NO ACTION → 23503) ให้ถอน/ปิดแหล่งแทน
--     ความพร้อม + ช่อง 001 ลบตามโครงการ (CASCADE — ข้อมูลเตรียมยื่น ประวัติยังอยู่ใน local_plan_events)
--     ใช้ NO ACTION (ค่าปกติของ PostgreSQL) — ผลเท่ากับ RESTRICT ที่เลื่อนไม่ได้ ลบ อปท. ทั้งแถว (cascade) ผ่านทั้งสองแบบ
--     (migration-reviewer ข้อ 7: อย่าไปแก้ RESTRICT ของ R0-A/R1-A ตามเหตุผลว่า "RESTRICT ลบ อปท. ไม่ได้" — ไม่จริง)
--     ข้อความ 23503 เป็นภาษาอังกฤษ หน้าจอต้องแปลเอง (friendlyError)
--     ⚠️ ลบแผนพัฒนาฉบับร่างที่มีโครงการอยู่ในคลัง = ไม่ได้จนกว่าจะเอาโครงการออกจากคลังก่อน (ตั้งใจ — หน้าจอต้องบอก)
--
-- ⚠️ เขียนทับ local_plan_log_event ทั้งตัว (CREATE OR REPLACE แทนทั้งฟังก์ชัน — NOTES ข้อ CREATE OR REPLACE)
--      คัดจาก 20261110100100 ครบทุกบรรทัด เพิ่มเฉพาะ entity 5 ชนิดของคลัง · ด่านหัวไฟล์เทียบ md5 ฉบับ R1-A ก่อน
--      ถ้าภายหลังมีคนรัน 20261109100200 หรือ 20261110100100 ซ้ำ จะได้ฉบับเก่าที่ไม่รู้จักตารางคลัง
--      → ทุกการเขียนตารางคลังพัง (entity ว่าง ชน NOT NULL) ต้องรันไฟล์นี้ซ้ำตาม (ปลอดภัย รันซ้ำได้)
--
-- ย้อนกลับ: DROP TABLE local_bank_project_details, local_project_readiness, local_bank_candidates, local_funding_rounds,
--             local_funding_sources (ตามลำดับนี้) · DROP FUNCTION local_funding_sources_guard, local_funding_rounds_guard,
--             local_bank_candidates_guard, local_project_readiness_guard, local_bank_project_details_guard
--           · รัน CREATE FUNCTION local_plan_log_event จาก 20261110100100 กลับ (ตาราง 5 ตัวต้องถูก DROP ไปก่อน ไม่งั้นเขียนไม่ได้)
--           · CHECK entity: แนะนำ "คงที่ขยายแล้วไว้" (ไม่มีผลเสีย) — จะคืน 7 ชนิดเดิมต้อง DELETE ประวัติ 5 ชนิดใหม่ก่อน
--             (ประวัติการแก้คลังหายถาวร) ไม่งั้น ADD CONSTRAINT ล้ม
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE
  v_extra text;
BEGIN
  IF to_regclass('public.local_funding_sources') IS NULL OR to_regclass('public.local_funding_rounds') IS NULL
     OR to_regclass('public.local_bank_candidates') IS NULL OR to_regclass('public.local_project_readiness') IS NULL
     OR to_regclass('public.local_bank_project_details') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261112100000_local_plan_bank_tables.sql ก่อน';
  END IF;
  -- ฟังก์ชันที่ไฟล์นี้พึ่งพฤติกรรม ต้องตรงกับไฟล์ในรีโป (md5 ของเนื้อฟังก์ชันหลังตัด CR — ไฟล์ที่รันอาจเป็น CRLF หรือ LF)
  -- ไม่ตรง = มีคนแก้ตรงในฐาน/รันฉบับอื่น → หยุดหาสาเหตุก่อน
  -- local_plan_log_event รับ 2 ค่า: ฉบับ R1-A (รันครั้งแรก) และฉบับไฟล์นี้ (รันซ้ำ)
  IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.local_plan_is_manager(uuid)'::regprocedure), chr(13), '')) <> '4eb5e56075525093047fd7ea5ee37682'
     OR md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.local_plan_can_read(uuid)'::regprocedure), chr(13), '')) <> '691ea016aa24b1c449527dff8f478fe2'
     OR md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.local_plan_dept_can_edit(uuid,uuid)'::regprocedure), chr(13), '')) <> 'c53c2b9fe6bea26ecada11fe594aaa47'
     OR md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.local_plan_stamp()'::regprocedure), chr(13), '')) <> 'f5a87d89b243a01152d8cb38d8f2a382'
     OR md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.local_plan_changed_outside(jsonb,jsonb,text[])'::regprocedure), chr(13), '')) <> 'c61b174f58a98d835ff1fae75973f40a'
     OR md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.local_plan_log_event()'::regprocedure), chr(13), ''))
          NOT IN ('7bbb1c0328d1aab5b595fd026ccb5be0', '1a4e39ea1182642e5563ada1300ad9ba') THEN
    RAISE EXCEPTION 'Schema drift: ฟังก์ชันของเมนูแผนพัฒนาบนฐานไม่ตรงกับไฟล์ในรีโป (R0-A/R1-A) — ตรวจก่อน';
  END IF;
  -- trigger นอกรีโปบนตารางคลัง = ลำดับ trigger ตามชื่อที่ไฟล์นี้พึ่ง (guard → stamp) อาจถูกแทรก → หยุดดูก่อน
  SELECT string_agg(c.relname || '.' || t.tgname, ', ') INTO v_extra
  FROM pg_trigger AS t JOIN pg_class AS c ON c.oid = t.tgrelid
  WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
    AND c.relname IN ('local_funding_sources', 'local_funding_rounds', 'local_bank_candidates',
                      'local_project_readiness', 'local_bank_project_details')
    AND t.tgname <> ALL (ARRAY[c.relname || '_guard_trigger', c.relname || '_stamp_trigger', c.relname || '_log_trigger']);
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION 'Schema drift: มี trigger ที่ไม่รู้จักบนตารางคลัง (%) — ตรวจก่อน', v_extra;
  END IF;
  -- CHECK entity ต้องมีชนิดของคลังครบ (มีคนรัน R1-A ไฟล์ 1 ซ้ำหลังไฟล์ 1 ของชุดนี้ = CHECK หดกลับ 7 ชนิด → เขียนคลังพัง 23514)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.local_plan_events'::regclass AND contype = 'c'
                   AND pg_get_constraintdef(oid) LIKE '%bank_detail%' AND pg_get_constraintdef(oid) LIKE '%funding_round%') THEN
    RAISE EXCEPTION 'CHECK entity ของ local_plan_events ยังไม่รู้จักชนิดของคลัง — รัน 20261112100000_local_plan_bank_tables.sql ซ้ำก่อน';
  END IF;
END $guard$;

-- ── FK ───────────────────────────────────────────────────────────────────────────
DO $fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'local_funding_rounds_source_fk') THEN
    ALTER TABLE public.local_funding_rounds ADD CONSTRAINT local_funding_rounds_source_fk
      FOREIGN KEY (source_id) REFERENCES public.local_funding_sources(id) ON DELETE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'local_bank_candidates_project_fk') THEN
    ALTER TABLE public.local_bank_candidates ADD CONSTRAINT local_bank_candidates_project_fk
      FOREIGN KEY (project_id) REFERENCES public.local_dev_plan_projects(id) ON DELETE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'local_bank_candidates_source_fk') THEN
    ALTER TABLE public.local_bank_candidates ADD CONSTRAINT local_bank_candidates_source_fk
      FOREIGN KEY (source_id) REFERENCES public.local_funding_sources(id) ON DELETE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'local_project_readiness_project_fk') THEN
    ALTER TABLE public.local_project_readiness ADD CONSTRAINT local_project_readiness_project_fk
      FOREIGN KEY (project_id) REFERENCES public.local_dev_plan_projects(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'local_bank_project_details_project_fk') THEN
    ALTER TABLE public.local_bank_project_details ADD CONSTRAINT local_bank_project_details_project_fk
      FOREIGN KEY (project_id) REFERENCES public.local_dev_plan_projects(id) ON DELETE CASCADE;
  END IF;
END $fk$;

-- ── 1) แหล่งงบ ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.local_funding_sources_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.municipality_id IS DISTINCT FROM OLD.municipality_id THEN
    RAISE EXCEPTION 'ย้ายแหล่งงบข้าม อปท. ไม่ได้' USING ERRCODE = '42501';
  END IF;
  NEW.name := btrim(NEW.name);
  NEW.agency := nullif(btrim(coalesce(NEW.agency, '')), '');
  NEW.note := nullif(btrim(coalesce(NEW.note, '')), '');
  -- ด้านที่ต้องใช้: ตัดซ้ำ + เรียงตามลำดับในแบบฟอร์ม (หน้าจอเทียบชุดได้ตรงๆ)
  -- ค่าที่ไม่รู้จักคงไว้ท้ายชุด ให้ CHECK ของตารางปฏิเสธ (ส่งผิดต้องได้ error ไม่ใช่ถูกตัดทิ้งเงียบๆ)
  NEW.required_aspects := ARRAY(
    SELECT a FROM (SELECT DISTINCT a FROM unnest(coalesce(NEW.required_aspects, '{}'::text[])) AS u(a) WHERE a IS NOT NULL) AS d
    ORDER BY array_position(ARRAY['study', 'land', 'design', 'estimate']::text[], a) NULLS LAST, a);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.local_funding_sources_guard() FROM PUBLIC, anon, authenticated;

-- ── 2) รอบยื่นที่ยืนยันแล้ว ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.local_funding_rounds_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_muni  uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.source_id IS DISTINCT FROM OLD.source_id THEN
    RAISE EXCEPTION 'ย้ายรอบไปแหล่งอื่นไม่ได้ — ลบแล้วเพิ่มที่แหล่งนั้นแทน' USING ERRCODE = '42501';
  END IF;
  SELECT municipality_id INTO v_muni FROM public.local_funding_sources WHERE id = NEW.source_id;
  IF v_muni IS NULL THEN
    RAISE EXCEPTION 'ไม่พบแหล่งงบที่ระบุ' USING ERRCODE = '23503';
  END IF;
  NEW.municipality_id := v_muni;                  -- คัดจากแหล่งเสมอ (policy ตรวจกับค่านี้)
  IF auth.uid() IS NOT NULL AND NEW.ref_date > v_today THEN
    RAISE EXCEPTION 'วันที่หนังสือแจ้งต้องไม่เกินวันนี้' USING ERRCODE = '22023';
  END IF;
  NEW.ref_no := btrim(NEW.ref_no);
  NEW.note := nullif(btrim(coalesce(NEW.note, '')), '');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.local_funding_rounds_guard() FROM PUBLIC, anon, authenticated;

-- ── 3) คลังโครงการ ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.local_bank_candidates_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_today    date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_muni     uuid;
  v_src_muni uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.source_id IS DISTINCT FROM OLD.source_id) THEN
    RAISE EXCEPTION 'ย้ายโครงการ/แหล่งงบของรายการในคลังไม่ได้ — ลบแล้วเพิ่มใหม่แทน' USING ERRCODE = '42501';
  END IF;
  SELECT municipality_id INTO v_muni FROM public.local_dev_plan_projects WHERE id = NEW.project_id;
  IF v_muni IS NULL THEN
    RAISE EXCEPTION 'ไม่พบโครงการในทะเบียน' USING ERRCODE = '23503';
  END IF;
  SELECT municipality_id INTO v_src_muni FROM public.local_funding_sources WHERE id = NEW.source_id;
  IF v_src_muni IS NULL THEN
    RAISE EXCEPTION 'ไม่พบแหล่งงบที่ระบุ' USING ERRCODE = '23503';
  END IF;
  IF v_src_muni <> v_muni THEN
    RAISE EXCEPTION 'แหล่งงบต้องเป็นของ อปท. เดียวกับโครงการ' USING ERRCODE = '23514';
  END IF;
  NEW.municipality_id := v_muni;                  -- คัดจากโครงการเสมอ (policy ตรวจกับค่านี้)

  IF auth.uid() IS NOT NULL AND (NEW.submitted_on > v_today OR NEW.result_on > v_today) THEN
    RAISE EXCEPTION 'วันยื่น/วันแจ้งผลต้องไม่เกินวันนี้ (บันทึกสิ่งที่เกิดขึ้นแล้วเท่านั้น)' USING ERRCODE = '22023';
  END IF;
  NEW.result_ref_no := nullif(btrim(coalesce(NEW.result_ref_no, '')), '');
  NEW.reason := nullif(btrim(coalesce(NEW.reason, '')), '');
  NEW.note := nullif(btrim(coalesce(NEW.note, '')), '');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.local_bank_candidates_guard() FROM PUBLIC, anon, authenticated;

-- ── 4) ความพร้อม 4 ด้าน ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.local_project_readiness_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_muni  uuid;
  v_col   text;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.aspect IS DISTINCT FROM OLD.aspect) THEN
    RAISE EXCEPTION 'ย้ายความพร้อมไปโครงการ/ด้านอื่นไม่ได้' USING ERRCODE = '42501';
  END IF;
  SELECT municipality_id INTO v_muni FROM public.local_dev_plan_projects WHERE id = NEW.project_id;
  IF v_muni IS NULL THEN
    RAISE EXCEPTION 'ไม่พบโครงการในทะเบียน' USING ERRCODE = '23503';
  END IF;
  NEW.municipality_id := v_muni;                  -- คัดจากโครงการเสมอ (policy ตรวจกับค่านี้)

  -- ไม่ระบุกองเจ้าของงานตอนเพิ่ม = ใช้กองผู้รับผิดชอบของโครงการ (ระบบเติมเอง — ไม่งั้นกองไม่เห็นปุ่มแก้และไม่มีใครรู้ตัว
  -- migration-reviewer ข้อ 2) ผู้จัดการแผนเปลี่ยนเป็นกองอื่นได้ภายหลัง เช่น แบบ/ประมาณราคา = กองช่าง
  IF TG_OP = 'INSERT' AND NEW.department_id IS NULL THEN
    SELECT p.department_id INTO NEW.department_id FROM public.local_dev_plan_projects AS p WHERE p.id = NEW.project_id;
  END IF;

  -- กองเจ้าของงาน (ไม่ใช่ผู้จัดการแผน) แก้ได้เฉพาะงานของด้านตัวเอง — มอบ/ย้ายกองเป็นอำนาจผู้จัดการแผน
  -- (policy ให้ผ่านมาเฉพาะแถวที่ department_id = กองของผู้แก้อยู่แล้ว)
  -- เว้นกรณี FK ON DELETE SET NULL ตอนกองถูกลบจริง (คนลบกองอาจไม่ใช่ผู้จัดการแผน เช่น fleet_admin ตาม policy fdept_write
  -- — แนวเดียวกับ local_op_plan_items_guard ของ R0-A · migration-reviewer ข้อ 1) ผู้ใช้สร้างเงื่อนไขนี้เองไม่ได้
  -- เพราะขณะที่กองยังอยู่ FK รับประกันว่า OLD.department_id มีแถวใน departments
  IF TG_OP = 'UPDATE' AND auth.uid() IS NOT NULL AND NOT public.local_plan_is_manager(OLD.municipality_id)
     AND NOT (NEW.department_id IS NULL AND OLD.department_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM public.departments AS d WHERE d.id = OLD.department_id)) THEN
    v_col := public.local_plan_changed_outside(to_jsonb(OLD), to_jsonb(NEW),
               ARRAY['level', 'done_on', 'file_ref', 'file_name', 'mime_type', 'size_bytes', 'note']);
    IF v_col IS NOT NULL THEN
      RAISE EXCEPTION 'กองเจ้าของงานแก้ช่อง % ไม่ได้ (แก้ได้เฉพาะระดับ วันเสร็จ ไฟล์ และหมายเหตุ)', v_col USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.department_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.departments AS d WHERE d.id = NEW.department_id AND d.municipality_id = NEW.municipality_id) THEN
    RAISE EXCEPTION 'กองเจ้าของงานไม่ใช่ของ อปท. นี้' USING ERRCODE = '23514';
  END IF;

  -- วันเสร็จ: ระดับ 4 ไม่กรอก = วันนี้ · ต่ำกว่า 4 = ล้าง (ไฟล์เก็บไว้ — อาจเป็นฉบับร่างที่กำลังแก้)
  IF NEW.level = 4 THEN
    NEW.done_on := coalesce(NEW.done_on, v_today);
    IF auth.uid() IS NOT NULL AND NEW.done_on > v_today THEN
      RAISE EXCEPTION 'วันที่เสร็จต้องไม่เกินวันนี้' USING ERRCODE = '22023';
    END IF;
  ELSE
    NEW.done_on := NULL;
  END IF;
  IF NEW.file_ref IS NULL THEN                    -- ถอดไฟล์ = ล้างข้อมูลประกอบของไฟล์ด้วย
    NEW.file_name := NULL;
    NEW.mime_type := NULL;
    NEW.size_bytes := NULL;
  END IF;
  NEW.note := nullif(btrim(coalesce(NEW.note, '')), '');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.local_project_readiness_guard() FROM PUBLIC, anon, authenticated;

-- ── 5) ช่องแบบฟอร์ม 001 ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.local_bank_project_details_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_muni uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    RAISE EXCEPTION 'ย้ายข้อมูลไปโครงการอื่นไม่ได้' USING ERRCODE = '42501';
  END IF;
  SELECT municipality_id INTO v_muni FROM public.local_dev_plan_projects WHERE id = NEW.project_id;
  IF v_muni IS NULL THEN
    RAISE EXCEPTION 'ไม่พบโครงการในทะเบียน' USING ERRCODE = '23503';
  END IF;
  NEW.municipality_id := v_muni;                  -- คัดจากโครงการเสมอ (policy ตรวจกับค่านี้)
  NEW.activity := nullif(btrim(coalesce(NEW.activity, '')), '');
  NEW.village_no := nullif(btrim(coalesce(NEW.village_no, '')), '');
  NEW.water_master_plan := nullif(btrim(coalesce(NEW.water_master_plan, '')), '');
  NEW.kpi := nullif(btrim(coalesce(NEW.kpi, '')), '');
  NEW.note := nullif(btrim(coalesce(NEW.note, '')), '');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.local_bank_project_details_guard() FROM PUBLIC, anon, authenticated;

-- ── ประวัติ (เขียนทับทั้งตัว — คัดจาก 20261110100100 แล้วเพิ่ม entity ของคลัง 5 ชนิด) ─────────────
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
    WHEN 'local_funding_sources' THEN 'funding_source'
    WHEN 'local_funding_rounds' THEN 'funding_round'
    WHEN 'local_bank_candidates' THEN 'bank_candidate'
    WHEN 'local_project_readiness' THEN 'readiness'
    WHEN 'local_bank_project_details' THEN 'bank_detail'
  END;
  v_parent := CASE v_entity
    WHEN 'dev_project' THEN (v_row ->> 'dev_plan_id')::uuid
    WHEN 'op_plan' THEN (v_row ->> 'dev_plan_id')::uuid
    WHEN 'op_item' THEN (v_row ->> 'op_plan_id')::uuid
    WHEN 'funding_round' THEN (v_row ->> 'source_id')::uuid
    WHEN 'bank_candidate' THEN (v_row ->> 'project_id')::uuid
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
    IF v_entity = 'readiness' THEN                 -- บอกว่าเป็นด้านไหนเสมอ (entity_id = โครงการ)
      v_changes := v_changes || jsonb_build_object('aspect', jsonb_build_array(v_old -> 'aspect', v_new -> 'aspect'));
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
            WHEN 'readiness' THEN (v_row ->> 'project_id')::uuid
            WHEN 'bank_detail' THEN (v_row ->> 'project_id')::uuid
            ELSE (v_row ->> 'id')::uuid
          END,
          v_parent, v_action, v_changes, v_reason, auth.uid());
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.local_plan_log_event() FROM PUBLIC, anon, authenticated;

-- ── trigger (BEFORE: guard → stamp ตามลำดับชื่อ · AFTER: ประวัติ) ─────────────────
DO $triggers$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['local_funding_sources', 'local_funding_rounds', 'local_bank_candidates',
                           'local_project_readiness', 'local_bank_project_details'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_guard_trigger', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.%I()',
                   t || '_guard_trigger', t, t || '_guard');
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_stamp_trigger', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.local_plan_stamp()',
                   t || '_stamp_trigger', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_log_trigger', t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.local_plan_log_event()',
                   t || '_log_trigger', t);
  END LOOP;
END $triggers$;

-- ── policy ───────────────────────────────────────────────────────────────────────
DO $policies$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['local_funding_sources', 'local_funding_rounds', 'local_bank_candidates',
                           'local_project_readiness', 'local_bank_project_details'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.local_plan_can_read(municipality_id))', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.local_plan_is_manager(municipality_id))', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.local_plan_is_manager(municipality_id))', t || '_delete', t);
    IF t = 'local_project_readiness' THEN
      -- + กองเจ้าของงานแก้แถวของด้านที่กองตัวเองถือ (trigger จำกัดช่อง)
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated '
                     'USING (public.local_plan_is_manager(municipality_id) OR public.local_plan_dept_can_edit(municipality_id, department_id)) '
                     'WITH CHECK (public.local_plan_is_manager(municipality_id) OR public.local_plan_dept_can_edit(municipality_id, department_id))',
                     t || '_update', t);
    ELSE
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.local_plan_is_manager(municipality_id)) '
                     'WITH CHECK (public.local_plan_is_manager(municipality_id))', t || '_update', t);
    END IF;
  END LOOP;
END $policies$;

-- ── สิทธิ์ตาราง ───────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.local_funding_sources, public.local_funding_rounds, public.local_bank_candidates,
  public.local_project_readiness, public.local_bank_project_details TO authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.local_funding_sources, public.local_funding_rounds, public.local_bank_candidates,
  public.local_project_readiness, public.local_bank_project_details FROM authenticated;
REVOKE ALL ON public.local_funding_sources, public.local_funding_rounds, public.local_bank_candidates,
  public.local_project_readiness, public.local_bank_project_details FROM PUBLIC, anon;

-- ── ด่านตรวจท้ายไฟล์ ──────────────────────────────────────────────────────────────
DO $check$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['local_funding_sources', 'local_funding_rounds', 'local_bank_candidates',
                           'local_project_readiness', 'local_bank_project_details'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'RLS ของ % ไม่ได้เปิด', t;
    END IF;
    IF has_table_privilege('anon', 'public.' || t, 'SELECT') OR has_table_privilege('anon', 'public.' || t, 'INSERT')
       OR has_table_privilege('anon', 'public.' || t, 'UPDATE') OR has_table_privilege('anon', 'public.' || t, 'DELETE') THEN
      RAISE EXCEPTION 'anon ยังมีสิทธิ์บน %', t;
    END IF;
    IF has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE') THEN
      RAISE EXCEPTION 'authenticated ยังมี TRUNCATE บน %', t;
    END IF;
    IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = ('public.' || t)::regclass AND NOT tgisinternal) <> 3 THEN
      RAISE EXCEPTION 'trigger ของ % ไม่ครบ 3 ตัว (guard / stamp / log)', t;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
        AND tablename IN ('local_funding_sources', 'local_funding_rounds', 'local_bank_candidates',
                          'local_project_readiness', 'local_bank_project_details')) <> 20 THEN
    RAISE EXCEPTION 'จำนวน policy ของตารางคลังไม่ครบ 20 (5 ตาราง × 4)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname ~ '^local_'
               AND has_function_privilege('anon', oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'anon ยังมีสิทธิ์ EXECUTE บนฟังก์ชัน local_*';
  END IF;
  IF position('bank_detail' IN pg_get_functiondef('public.local_plan_log_event()'::regprocedure)) = 0
     OR position('op_progress' IN pg_get_functiondef('public.local_plan_log_event()'::regprocedure)) = 0
     OR position('local_dev_plan_project_years' IN pg_get_functiondef('public.local_plan_log_event()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'local_plan_log_event ไม่ครบ (ต้องมีทั้ง entity เดิม ของติดตามผล และของคลัง)';
  END IF;
END $check$;

NOTIFY pgrst, 'reload schema';

COMMIT;
