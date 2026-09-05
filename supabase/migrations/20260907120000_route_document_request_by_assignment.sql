-- เฟส 2 (ส่วนที่ 2/2): ให้ trigger รับคำขอ อ่านผังงานจาก document_type_assignments ก่อน
--
-- ลำดับการตัดสินใจตอนคำขอเข้ามา:
--   1) กอง      = ค่าที่ อปท. ตั้งไว้รายประเภท → ถ้าไม่ได้ตั้ง ใช้ CASE เดิม (พฤติกรรมเดิมทุกประการ)
--   2) ผู้รับผิดชอบ = ค่าที่ อปท. ตั้งไว้รายประเภท → ถ้าไม่ได้ตั้ง ปล่อย NULL (หัวหน้ากองมอบหมายเอง)
--   3) กำหนดเสร็จ  = วันที่ยื่น + sla_days → ถ้าไม่ได้ตั้ง ใช้ 3 วันเท่าค่าดีฟอลต์ของเรื่องร้องเรียน
--
-- ⚠️ CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน CASE ด้านล่างจึงคัดมาครบจาก 20260906180000
-- (รวม waste_collection_request → กองสาธารณสุข fallback สำนักปลัด) ห้ามตัดออก
--
-- ⚠️ ไม่ seed ข้อมูลตั้งต้นลงตารางใหม่โดยตั้งใจ — ตารางว่าง = ระบบทำงานเหมือนเดิมเป๊ะ
-- อปท. ที่ยังไม่ได้เข้าไปตั้งค่าจะไม่มีอะไรเปลี่ยน นอกจากได้ due_date เพิ่มมา

BEGIN;

CREATE OR REPLACE FUNCTION public.route_document_request_department()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_department_id uuid;
  v_assignee_id   uuid;
  v_sla_days      int;
BEGIN
  SELECT rule.department_id, rule.assignee_id, rule.sla_days
  INTO v_department_id, v_assignee_id, v_sla_days
  FROM public.document_type_assignments AS rule
  WHERE rule.municipality_id = NEW.municipality_id
    AND rule.document_type   = NEW.document_type;

  IF NEW.department_id IS NULL THEN
    NEW.department_id := COALESCE(
      v_department_id,
      CASE NEW.document_type
        WHEN 'tax_notice' THEN public.resolve_work_department(NEW.municipality_id, 'finance', 'กองคลัง')
        WHEN 'building_permit' THEN public.resolve_work_department(NEW.municipality_id, 'engineering', 'กองช่าง')
        WHEN 'residence_cert' THEN public.resolve_work_department(NEW.municipality_id, 'general', 'สำนักปลัด')
        WHEN 'personal_cert' THEN public.resolve_work_department(NEW.municipality_id, 'general', 'สำนักปลัด')
        WHEN 'waste_collection' THEN public.resolve_work_department(NEW.municipality_id, 'general', 'สำนักปลัด')
        WHEN 'waste_collection_request' THEN COALESCE(
          public.resolve_work_department(NEW.municipality_id, 'health', 'สาธารณสุข'),
          public.resolve_work_department(NEW.municipality_id, 'general', 'สำนักปลัด')
        )
        ELSE public.resolve_work_department(NEW.municipality_id, 'general', 'สำนักปลัด')
      END
    );
  END IF;

  -- มอบหมายอัตโนมัติเฉพาะเมื่อผู้บันทึกไม่ได้ระบุตัวมาเอง (เช่นเจ้าหน้าที่รับเรื่องหน้าเคาน์เตอร์
  -- สร้างคำขอแทนประชาชนแล้วถือเรื่องเอง) และเฉพาะเมื่อคนที่ตั้งไว้ยังสังกัด อปท. เดียวกันอยู่จริง
  -- — คนย้ายหน่วยงานแล้วต้องไม่ถูกส่งข้อมูลส่วนบุคคลของประชาชนอีก อปท. ให้ (PDPA)
  IF NEW.assigned_to IS NULL AND v_assignee_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.profiles AS profile
      WHERE profile.id = v_assignee_id
        AND profile.municipality_id = NEW.municipality_id
    ) THEN
      NEW.assigned_to := v_assignee_id;
    END IF;
  END IF;

  IF NEW.due_date IS NULL THEN
    NEW.due_date := (now() AT TIME ZONE 'Asia/Bangkok')::date + COALESCE(v_sla_days, 3);
  END IF;

  IF NOT public.department_belongs_to_municipality(NEW.department_id, NEW.municipality_id) THEN
    RAISE EXCEPTION 'Permission denied: department does not belong to municipality';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.route_document_request_department() FROM PUBLIC, anon, authenticated;

-- ── กันการเลื่อนกำหนดส่งเอง ────────────────────────────────────────────────
-- due_date เพิ่งเกิดในไฟล์ 20260907110000 การ์ดตัวนี้จึงมาอยู่ที่นี่ไม่ได้อยู่ในไฟล์ก่อนหน้า
-- (อ้างคอลัมน์ที่ยังไม่มี = 42703) เนื้อฟังก์ชันด้านล่างรวมกติกาทั้งหมดของ
-- 20260907100000_document_request_assignment_guard.sql ไว้ครบแล้วและแทนที่ของเดิม
--
-- ทำไมต้องกัน: ถ้าเจ้าหน้าที่เลื่อน due_date ของตัวเองได้ ตัวเลข "งานเกินกำหนด" ในรายงาน
-- จะกลายเป็นค่าที่ผู้ถูกวัดกำหนดเอง ใช้อ้างกับผู้ตรวจไม่ได้ (ประเด็น สตง.)
CREATE OR REPLACE FUNCTION public.protect_document_request_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND public.get_my_role() NOT IN ('admin', 'superadmin')
     AND (
       NEW.user_id IS DISTINCT FROM OLD.user_id
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

COMMIT;
