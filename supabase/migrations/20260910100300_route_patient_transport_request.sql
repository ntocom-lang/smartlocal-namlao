-- ส่งคำขอ "ขออนุเคราะห์รถรับ-ส่งผู้ป่วย" (patient_transport_request) เข้ากองที่ดูแล
--
-- งานประสานส่งต่อผู้ป่วยให้หน่วยงานภายนอกเป็นงานสวัสดิการสังคม → กองสวัสดิการสังคม
-- ถ้า อปท. ไม่มีกองนี้จึงไปสำนักปลัด (แบบเดียวกับ public_assistance_request)
-- ผังงานที่ อปท. ตั้งเองใน document_type_assignments ยังชนะ CASE นี้เสมอ
--
-- ⚠️ CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน เนื้อด้านล่างจึงคัดมาครบจาก
-- 20260909100300_route_asset_borrow_request.sql (ผังงานจาก document_type_assignments
-- + CASE เดิมทุก branch + การ์ด assigned_to/due_date) ห้ามตัดส่วนใดออก
-- ส่วนที่เพิ่มคือ branch 'patient_transport_request' เท่านั้น

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
        WHEN 'waste_collection_cancel' THEN COALESCE(
          public.resolve_work_department(NEW.municipality_id, 'health', 'สาธารณสุข'),
          public.resolve_work_department(NEW.municipality_id, 'general', 'สำนักปลัด')
        )
        WHEN 'water_supply_request' THEN COALESCE(
          public.resolve_work_department(NEW.municipality_id, 'waterworks', 'ประปา'),
          public.resolve_work_department(NEW.municipality_id, 'engineering', 'กองช่าง'),
          public.resolve_work_department(NEW.municipality_id, 'general', 'สำนักปลัด')
        )
        WHEN 'public_assistance_request' THEN COALESCE(
          public.resolve_work_department(NEW.municipality_id, 'welfare', 'สวัสดิการ'),
          public.resolve_work_department(NEW.municipality_id, 'general', 'สำนักปลัด')
        )
        WHEN 'asset_borrow_request' THEN COALESCE(
          public.resolve_work_department(NEW.municipality_id, 'finance', 'กองคลัง'),
          public.resolve_work_department(NEW.municipality_id, 'general', 'สำนักปลัด')
        )
        WHEN 'patient_transport_request' THEN COALESCE(
          public.resolve_work_department(NEW.municipality_id, 'welfare', 'สวัสดิการ'),
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

COMMIT;
