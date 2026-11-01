-- 20261101100100_self_delete_account_functions.sql
--
-- ลบบัญชีด้วยตนเองสำหรับประชาชน — ต้อง apply หลัง 20261101100000 (FK + นโยบายลบรูป)
-- หน้าเว็บ: /account/delete (src/pages/AccountDeletePage.jsx) ลบรูปโปรไฟล์ก่อน แล้วเรียก delete_my_account()
--
-- [ทำไมต้องแก้ guard 2 ตัว] ตอนลบ auth.users ฐานข้อมูลตั้ง user_id ของคำร้อง/คำขอเป็น NULL ตาม FK
-- "ในนามผู้ใช้ที่กำลังลบตัวเอง" ซึ่งไม่ใช่แอดมิน:
--   - guard_adhoc_complaint_write ห้ามทุกคนที่ไม่ใช่แอดมินเปลี่ยน user_id ของคำร้องหมวดเฉพาะกิจ
--     ไม่ว่าจะล็อกอินหรือไม่ → ประชาชนที่เคยแจ้งกลิ่นจะลบบัญชีไม่ได้ทั้งก้อน
--   - protect_document_request_scope ห้ามผู้ล็อกอินที่ไม่ใช่แอดมินเปลี่ยนผู้ยื่นคำขอ
-- เปิดช่องด้วยธงประจำทรานแซกชัน app.account_delete แพทเทิร์นเดียวกับ app.retention_purge /
-- app.odor_ack / app.rating_write และยกเว้น "เฉพาะการล้าง user_id เป็น NULL" — คอลัมน์อื่นทุกตัว
-- ยังถูกตรวจเหมือนเดิม ธงนี้ตั้งได้จาก delete_my_account() เท่านั้น (ผู้ใช้ไม่มีทางรัน set_config เอง)
--
-- ⚠️ CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน: ตัวบท guard ด้านล่างคัดจากรุ่นล่าสุดในรีโปทุกบรรทัด
--   guard_adhoc_complaint_write   ← 20260902120000_complaint_contact_retention.sql
--   protect_document_request_scope ← 20260907120000_route_document_request_by_assignment.sql
-- ก้อน SQL ที่เจ้าของระบบรันตรวจ md5 ของรุ่นที่รันอยู่บนฐานจริงกับสองรุ่นนี้ก่อน ไม่ตรง = ยกเลิกทั้งก้อน

CREATE OR REPLACE FUNCTION public.guard_adhoc_complaint_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_owner_cleared boolean;
BEGIN
  IF NOT public.complaint_category_is_adhoc(OLD.municipality_id, OLD.category) THEN
    RETURN NEW;
  END IF;

  -- งานลบข้อมูลติดต่อตามระยะเวลาเก็บรักษา (purge_expired_complaint_contacts)
  IF coalesce(current_setting('app.retention_purge', true), '') = '1' THEN
    RETURN NEW;
  END IF;

  v_role := public.get_my_role();

  IF v_role IN ('admin', 'superadmin') THEN
    RETURN NEW;
  END IF;

  -- ผู้แจ้งลบบัญชีตัวเอง (delete_my_account): FK ล้าง user_id เป็น NULL — ยกเว้นเฉพาะคอลัมน์นี้
  v_owner_cleared := coalesce(current_setting('app.account_delete', true), '') = '1'
                     AND NEW.user_id IS NULL;

  IF NEW.municipality_id IS DISTINCT FROM OLD.municipality_id
    OR NEW.category      IS DISTINCT FROM OLD.category
    OR NEW.category_id   IS DISTINCT FROM OLD.category_id
    OR NEW.department_id IS DISTINCT FROM OLD.department_id
    OR (NEW.user_id      IS DISTINCT FROM OLD.user_id AND NOT v_owner_cleared)
    OR NEW.reporter_name IS DISTINCT FROM OLD.reporter_name
    OR NEW.phone         IS DISTINCT FROM OLD.phone
    OR NEW.latitude      IS DISTINCT FROM OLD.latitude
    OR NEW.longitude     IS DISTINCT FROM OLD.longitude
    OR NEW.subject       IS DISTINCT FROM OLD.subject
    OR NEW.detail        IS DISTINCT FROM OLD.detail
    OR NEW.status        IS DISTINCT FROM OLD.status
    OR NEW.assigned_to   IS DISTINCT FROM OLD.assigned_to
    OR NEW.ref_no        IS DISTINCT FROM OLD.ref_no
  THEN
    RAISE EXCEPTION 'คำร้องหมวดเฉพาะกิจแก้ไขข้อมูลหลักผ่าน API โดยตรงไม่ได้ (ต้องเป็นผู้ดูแลระบบ)'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.extra_data IS DISTINCT FROM OLD.extra_data
    AND coalesce(current_setting('app.odor_ack', true), '') <> '1'
  THEN
    RAISE EXCEPTION 'การรับทราบคำร้องเฉพาะกิจต้องทำผ่าน acknowledge_odor_complaint() เท่านั้น'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_document_request_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- ผู้ยื่นลบบัญชีตัวเอง (delete_my_account): FK ล้าง user_id เป็น NULL — ยกเว้นเฉพาะคอลัมน์นี้
  IF auth.uid() IS NOT NULL
     AND public.get_my_role() NOT IN ('admin', 'superadmin')
     AND (
       (NEW.user_id IS DISTINCT FROM OLD.user_id
        AND NOT (coalesce(current_setting('app.account_delete', true), '') = '1' AND NEW.user_id IS NULL))
       OR NEW.municipality_id IS DISTINCT FROM OLD.municipality_id
       OR NEW.department_id IS DISTINCT FROM OLD.department_id
     )
  THEN
    RAISE EXCEPTION 'Requester, municipality and department cannot be changed';
  END IF;

  IF auth.uid() IS NOT NULL
     AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
     AND public.get_my_role() NOT IN ('admin', 'superadmin')
     AND NOT (
       public.get_my_role() = 'officer'
       AND public.is_my_department(OLD.municipality_id, OLD.department_id)
     )
  THEN
    RAISE EXCEPTION 'Only an admin or the responsible department head may reassign this request';
  END IF;

  IF auth.uid() IS NOT NULL
     AND NEW.due_date IS DISTINCT FROM OLD.due_date
     AND public.get_my_role() NOT IN ('admin', 'superadmin')
     AND NOT (
       public.get_my_role() = 'officer'
       AND public.is_my_department(OLD.municipality_id, OLD.department_id)
     )
  THEN
    RAISE EXCEPTION 'Only an admin or the responsible department head may change the due date';
  END IF;

  IF NEW.assigned_to IS NOT NULL
     AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles AS profile
       WHERE profile.id = NEW.assigned_to
         AND profile.municipality_id = NEW.municipality_id
     )
  THEN
    RAISE EXCEPTION 'Assignee must belong to the same municipality as the request';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_document_request_scope() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_role       text;
  v_muni       uuid;
  v_constraint text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อนลบบัญชี' USING ERRCODE = '42501';
  END IF;

  SELECT p.role, p.municipality_id INTO v_role, v_muni
  FROM public.profiles p
  WHERE p.id = v_uid;

  -- เฉพาะประชาชน และบัญชีที่ยังไม่มีแถว profiles (สมัคร OAuth แล้วสร้างโปรไฟล์ไม่สำเร็จ)
  -- บัญชีเจ้าหน้าที่ผูกกับงานที่ได้รับมอบหมาย ทะเบียนผู้ลงนาม และลายเซ็นในเอกสาร ต้องให้แอดมินโอนงาน
  -- แล้วลบผ่าน delete_user_by_id ซึ่งมีด่านตรวจงานค้างครบ
  IF v_role IS NOT NULL AND v_role <> 'citizen' THEN
    RAISE EXCEPTION 'บัญชีเจ้าหน้าที่ลบเองไม่ได้ เพราะผูกกับงานและลายเซ็นในเอกสาร กรุณาติดต่อผู้ดูแลระบบของหน่วยงาน'
      USING ERRCODE = '42501';
  END IF;

  -- ร่องรอยว่ามีการลบบัญชีเกิดขึ้น โดยไม่เก็บชื่อ เบอร์ หรืออีเมล (จุดประสงค์ของการลบคือเอาข้อมูลพวกนี้ออก)
  -- รหัสบัญชีเก็บใน resource_id ซึ่งหลังลบแล้วไม่ผูกกับข้อมูลใดอีก (คำร้อง/คำขอถูกตั้งเป็น NULL หมด)
  INSERT INTO public.audit_logs (
    municipality_id, actor_id, actor_name, actor_role, action,
    resource_type, resource_id, resource_label, metadata
  ) VALUES (
    v_muni, NULL, NULL, coalesce(v_role, 'citizen'), 'self_delete_account',
    'profile', v_uid::text, NULL, jsonb_build_object('channel', 'self_service')
  );

  PERFORM set_config('app.account_delete', '1', true);

  -- ลบที่ auth.users แบบเดียวกับ delete_user_by_id — identities/sessions/profiles ตามไปตาม FK
  -- ชน FK ได้ทางเดียวคือบัญชีนี้เคยเป็นเจ้าหน้าที่ (ตารางงานเจ้าหน้าที่ยังเป็น NO ACTION โดยตั้งใจ)
  -- ยกเลิกทั้งหมดรวมแถว audit ด้านบน แล้วบอกผู้ใช้ตรงๆ ว่าต้องให้แอดมินจัดการ
  BEGIN
    DELETE FROM auth.users WHERE id = v_uid;
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    RAISE EXCEPTION 'บัญชีนี้ยังมีประวัติงานของเจ้าหน้าที่ผูกอยู่ ลบเองไม่ได้ กรุณาติดต่อผู้ดูแลระบบของหน่วยงาน'
      USING ERRCODE = '23503', DETAIL = coalesce(v_constraint, '');
  END;

  PERFORM set_config('app.account_delete', '0', true);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;

COMMENT ON FUNCTION public.delete_my_account() IS
  'ประชาชนลบบัญชีตัวเอง (App Store 5.1.1(v) / Google Play): ลบ auth.users + โปรไฟล์ทันที คำร้อง/คำขอ/การจองคงอยู่โดยไม่ผูกบัญชี รีวิวถูกลบ — เจ้าหน้าที่ลบเองไม่ได้';
