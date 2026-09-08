-- ส่งคำร้อง "ขอรับการช่วยเหลือประชาชน" (public_assistance_request) เข้ากองที่ดูแลงานช่วยเหลือ
--
-- ลำดับการหากอง:
--   1. กองสวัสดิการสังคม (code = 'welfare' หรือชื่อมีคำว่า "สวัสดิการ") — งานสงเคราะห์และ
--      ช่วยเหลือประชาชนอยู่ในความรับผิดชอบของกองนี้ตามผังกองที่ระบบ seed ไว้
--      (ดู 108_security_fixes_round2.sql ที่สร้าง 'welfare' = กองสวัสดิการสังคม)
--   2. สำนักปลัด — อปท. ขนาดเล็กจำนวนมากไม่ได้ตั้งกองสวัสดิการสังคม งานช่วยเหลือประชาชน
--      (รวมงานป้องกันและบรรเทาสาธารณภัย) จึงอยู่ที่สำนักปลัด
--
-- ⚠️ ตัวคำร้องเป็นแค่ "จุดรับเรื่อง" ไม่ใช่ตัวตัดสินว่ากองไหนจะเป็นผู้ดำเนินการจริง — บนใบพิมพ์
-- มีช่องติ๊ก "ส่วนงานที่รับผิดชอบ" ให้ผู้บริหารสั่งการอีกชั้นหนึ่ง และเจ้าหน้าที่ย้ายกองในระบบได้
-- ค่านี้จึงเป็นค่าตั้งต้นให้เรื่องไม่ตกหล่นเท่านั้น
--
-- ⚠️ อปท. ที่ต้องการให้เข้ากองอื่นตั้งค่าเองได้ที่ document_type_assignments (ผังงานด้านบน
-- ของฟังก์ชันนี้ชนะ CASE เสมอ) ไม่ต้องแก้ไฟล์นี้
--
-- ⚠️ CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน เนื้อด้านล่างจึงคัดมาครบจาก
-- 20260908190000_route_water_supply_request.sql (ผังงานจาก document_type_assignments
-- + CASE เดิมทุก branch + การ์ด assigned_to/due_date) ห้ามตัดส่วนใดออก
--
-- ⚠️ ระเบียบที่เกี่ยวข้อง (ระเบียบกระทรวงมหาดไทยว่าด้วยค่าใช้จ่ายเพื่อช่วยเหลือประชาชนตาม
-- อำนาจหน้าที่ขององค์กรปกครองส่วนท้องถิ่น) กำหนดขั้นตอนของศูนย์ช่วยเหลือประชาชนไว้ต่างหาก
-- ยังไม่ได้เปิดตัวบทยืนยันรายข้อ — การจ่ายเงินช่วยเหลือจริงต้องทำตามระเบียบ ไม่ใช่ตามสถานะในระบบ
--
-- ไม่แตะ protect_document_request_scope() ในไฟล์นี้ — คนละฟังก์ชัน ไม่มีอะไรเปลี่ยน

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
