-- วงจรโครงการก่อสร้าง: ปิดทางแก้ status ตรงของเมนูเดิม (legacy_status) — เจ้าของระบบเลือกทาง A 2026-11-08
-- ต้องรัน 20261108100200_civil_lifecycle_rls_triggers.sql ก่อน (ด่านตรวจหัวไฟล์ตรวจให้)
--
-- เดิม (ไฟล์ 3/3 ข้อ 2): ผู้ใช้ที่ล็อกอินแก้ civil_projects.status ตรงได้ช่วงเปลี่ยนผ่าน → ระบบเลือกขั้นให้ + ลงประวัติ 'legacy_status'
--   ช่องโหว่ของทางนั้นเทียบกับ RPC civil_set_project_stage (กติกาที่เจ้าของอนุมัติ):
--   - ข้ามขั้นได้ เช่น planned → in_progress = budgeted → construction ทั้งที่ยังไม่มีสัญญา (RPC: ผู้จัดการ + เหตุผล)
--   - ระงับ/ยกเลิกได้โดยไม่มีเหตุผลและเลขที่หนังสือ (RPC: บังคับทั้งคู่)
--   - "ยกเลิก" โครงการที่ลงนามสัญญาแล้วได้ (RPC: ยกเลิกได้เฉพาะก่อนลงนาม หลังลงนามต้อง "บอกเลิก")
-- หลัง PR-C1 (#656) หน้าโครงการเปลี่ยนขั้นผ่าน RPC ครบทุกทางแล้ว · ฐานจริงตรวจ 2026-11-08: civil_project_events ไม่มี legacy_status สักแถว
-- จุดเดียวในแอปที่ยังแก้ status ตรงคือดรอปดาวน์ "ปรับสถานะแบบเร็ว" บนแผนที่ศูนย์ข้อมูล — ถอดออกใน PR เดียวกับไฟล์นี้
--
-- หลังไฟล์นี้:
--   - ผู้ใช้ที่ล็อกอิน UPDATE status ให้ต่างจากเดิม → ปฏิเสธ (42501) พร้อมข้อความบอกให้ใช้ปุ่มเปลี่ยนขั้น
--     ส่ง status ค่าเดิมมาพร้อมช่องอื่น (เช่น แก้ชื่อโครงการ) ยังผ่านเหมือนเดิม
--   - ผู้ดูแลฐานข้อมูล (ไม่มีผู้ล็อกอิน) ยังแก้ status ตรงได้ ระบบเลือกขั้นให้เหมือนเดิม (กรณีจำเป็นจริง)
--   - INSERT ที่ส่งแค่ status ไม่ส่ง stage (งาน GPS ของช่าง TechnicianDashboard) ไม่เปลี่ยน — เจ้าของยังไม่ได้ตัดสิน แยกเรื่อง
--   - civil_projects_stage_log ไม่แก้: ประวัติ legacy_status ที่อาจมีอยู่ยังอ่านได้ (CHECK ของ kind คงค่าเดิม)
--   - ⚠️ ถ้ามีใครรันไฟล์ 20261108100200 ซ้ำ (เช่น db push ยิงซ้ำ) ฟังก์ชันจะกลับเป็นรุ่นเปิดทางเดิม → ต้องรันไฟล์นี้ซ้ำตาม
--
-- ⚠️ CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน (NOTES ข้อ 5): คัด civil_projects_stage_guard จาก 20261108100200 ทั้งตัว
--    แก้กิ่งเดียว "status เปลี่ยนแต่ stage ไม่เปลี่ยน" · ด่านตรวจหัวไฟล์เทียบ md5 ของเนื้อฟังก์ชันบนฐาน (ตัดคอมเมนต์ + ช่องว่าง ASCII)
--    ต้องเป็นรุ่นจากไฟล์ 3 หรือรุ่นของไฟล์นี้เท่านั้น — ไม่ตรง = มีคนแก้ฟังก์ชันไปแล้ว หยุดทั้งก้อน ห้ามเขียนทับ
--    เทียบฐานจริงแล้ว 2026-11-08: เนื้อฟังก์ชันตรงกับไฟล์ 3 ทุกตัวอักษร

BEGIN;

DO $guard$
DECLARE
  v_md5 text;
BEGIN
  IF to_regprocedure('public.civil_set_project_stage(uuid,text,text,text,date)') IS NULL
     OR to_regprocedure('public.civil_projects_stage_guard()') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261108100200_civil_lifecycle_rls_triggers.sql ก่อนไฟล์นี้';
  END IF;
  SELECT md5(regexp_replace(regexp_replace(prosrc, chr(45) || chr(45) || '[^\n]*', '', 'g'), '[ \t\r\n]+', '', 'g'))
    INTO v_md5
  FROM pg_proc WHERE oid = 'public.civil_projects_stage_guard()'::regprocedure;
  IF v_md5 NOT IN ('f26c021ac2ed5447bb276fd3648b80d4',   -- 20261108100200 (รุ่นที่เปิดทาง legacy_status)
                   '89cd1f580b29fad8a8e79f7ed5613d67') THEN                    -- ไฟล์นี้ (รันซ้ำได้)
    RAISE EXCEPTION 'civil_projects_stage_guard บนฐานไม่ตรงกับรุ่นที่รู้จัก (md5 %) — มีคนแก้ฟังก์ชันไปแล้ว หยุดเพื่อไม่เขียนทับ เทียบ pg_get_functiondef ก่อน', v_md5;
  END IF;
END $guard$;

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
      NEW.stage := public.civil_stage_for_status(NEW.status);   -- แถวใหม่ที่ส่งแค่ status (งาน GPS ของช่าง)
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
    -- ปิดทางเมนูเดิมแล้ว (20261108160000): ผู้ใช้ที่ล็อกอินแก้ status ตรงไม่ได้ทุกบทบาท รวมผู้จัดการ
    -- ทางเดียวคือ RPC civil_set_project_stage ซึ่งเปลี่ยน stage (เข้ากิ่งบน) ไม่ได้มาถึงกิ่งนี้
    IF v_user THEN
      RAISE EXCEPTION 'เปลี่ยนสถานะโครงการต้องทำที่ปุ่มเปลี่ยนขั้นในหน้าโครงการ (เมนูโครงการก่อสร้าง) — ระบบจะตรวจสิทธิ์และบันทึกเหตุผลให้'
        USING ERRCODE = '42501';
    END IF;
    -- ผู้ดูแลแก้ status ตรงในฐานข้อมูล → เลือกขั้นตัวแทน · กลับจากระงับไป status เดิม = กลับขั้นที่จำไว้
    -- (ด่านผู้จัดการของรุ่นเดิมตัดออก: ใช้กับผู้ใช้ที่ล็อกอินเท่านั้น ซึ่งถูกปฏิเสธไปแล้วข้างบน)
    v_target := public.civil_stage_for_status(NEW.status);
    IF v_target IS NULL THEN
      RAISE EXCEPTION 'ไม่รู้จักสถานะ "%"', NEW.status USING ERRCODE = '23514';
    END IF;
    IF OLD.stage = 'suspended' AND OLD.stage_before_hold IS NOT NULL
       AND public.civil_status_of_stage(OLD.stage_before_hold) = NEW.status THEN
      v_target := OLD.stage_before_hold;
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

REVOKE ALL ON FUNCTION public.civil_projects_stage_guard() FROM PUBLIC, anon, authenticated;

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                 WHERE tgname = 'civil_projects_stage_guard_trigger' AND tgrelid = 'public.civil_projects'::regclass
                   AND tgfoid = 'public.civil_projects_stage_guard()'::regprocedure AND tgenabled IN ('O', 'A')) THEN
    RAISE EXCEPTION 'trigger civil_projects_stage_guard_trigger ไม่มีหรือถูกปิดอยู่ — ตรวจไฟล์ 20261108100200';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.civil_projects_stage_guard()'::regprocedure) THEN
    RAISE EXCEPTION 'civil_projects_stage_guard ต้องเป็น SECURITY DEFINER';
  END IF;
  IF has_function_privilege('authenticated', 'public.civil_projects_stage_guard()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.civil_projects_stage_guard()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon/authenticated ต้องเรียก civil_projects_stage_guard ตรงไม่ได้';
  END IF;
  -- เนื้อฟังก์ชันหลังแทนที่ต้องตรงกับไฟล์นี้ทุกตัว (กันเครื่องมือรัน SQL ทำเนื้อเพี้ยนแล้วผ่านเงียบ) — ค่าเดียวกับด่านหัวไฟล์
  IF (SELECT md5(regexp_replace(regexp_replace(prosrc, chr(45) || chr(45) || '[^\n]*', '', 'g'), '[ \t\r\n]+', '', 'g'))
      FROM pg_proc WHERE oid = 'public.civil_projects_stage_guard()'::regprocedure) <> '89cd1f580b29fad8a8e79f7ed5613d67' THEN
    RAISE EXCEPTION 'civil_projects_stage_guard หลังแทนที่ไม่ตรงกับไฟล์ 20261108160000 — ย้อนทั้งก้อน';
  END IF;
  IF EXISTS (SELECT 1 FROM public.civil_projects WHERE status IS DISTINCT FROM public.civil_status_of_stage(stage)) THEN
    RAISE EXCEPTION 'มีโครงการที่ status ไม่ตรงกับ stage — ตรวจข้อมูลก่อน';
  END IF;
END $verify$;

COMMIT;
