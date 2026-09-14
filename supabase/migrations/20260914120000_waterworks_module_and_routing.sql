-- โมดูลงานประปา (waterworks) — คีย์โมดูล + ส่งคำขอเปลี่ยนมาตร/ยกเลิกใช้น้ำเข้ากอง + ด่านปิดโมดูล
--
-- ทำไมต้องเป็นโมดูล (ผู้ใช้สั่ง 2569-09-14): บาง อปท. อยู่ในเขต กปภ. หรือไม่มีกิจการประปาหมู่บ้าน
-- ต้องปิดคำขอประปาทั้งชุด (ขอใช้น้ำ / เปลี่ยนมาตร / ยกเลิกใช้น้ำ) ได้ในคลิกเดียว
--
-- ลำดับในไฟล์นี้ตั้งใจ — เติมคีย์ให้ทุกแถว "ก่อน" สร้างด่าน อยู่ไฟล์เดียวกันใน transaction เดียว
-- ถ้าแยกไฟล์แล้ว apply ด่านก่อน คำขอประปาของทุก อปท. จะถูกปฏิเสธทันทีจนกว่าจะเติมคีย์
--
-- 1) เติม 'waterworks' ให้ทุกแถว (กติกา: หลังบ้านทุก อปท. เหมือนกัน ยึด namlao — ใครไม่มีกิจการ
--    ประปา แอดมินค่อยติ๊กปิดเองในหน้าจัดการโมดูล) รูปแบบเดียวกับ 20260914100200_waste_module_key.sql
--    ต้อง apply ก่อน deploy โค้ดที่เพิ่ม 'waterworks' เข้า MANAGED_MODULE_KEYS
--
-- 2) route_document_request_department() — ⚠️ CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน
--    เนื้อด้านล่างคัดจาก pg_get_functiondef บนฐานข้อมูลจริง 2569-09-14 (ตรงกับ
--    20260912100100_route_asset_borrow_same_dept_assignee.sql) ห้ามตัดส่วนใดออก
--    สิ่งที่เพิ่ม: ด่านโมดูลบนสุด + WHEN ของ water_meter_change / water_supply_cancel
--
-- ด่านโมดูลอยู่ใน trigger BEFORE INSERT เท่านั้น (ตรวจแล้วว่า trigger นี้ไม่ทำงานตอน UPDATE)
-- — อปท. ปิดโมดูลภายหลัง คำขอเก่ายังรับเรื่อง/ปิดงาน/พิมพ์ได้ตามปกติ กันแค่การยื่นใหม่
-- enabled_modules = NULL แปลว่าเปิดทุกโมดูล ตรงกับ isModuleEnabled() ใน TenantContext.jsx
--
-- ⚠️ ลิสต์ 3 ประเภทต้องตรงกับ WATERWORKS_DOCUMENT_TYPES ใน src/lib/documentTypes.js

BEGIN;

UPDATE public.municipalities
SET enabled_modules = array_append(enabled_modules, 'waterworks')
WHERE enabled_modules IS NOT NULL
  AND NOT ('waterworks' = ANY (enabled_modules));

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
  -- หน้าจอซ่อนการ์ดแล้ว แต่ยิง API ตรงยังยื่นได้ ต้องกันซ้ำที่ฐานข้อมูล
  IF NEW.document_type IN ('water_supply_request', 'water_meter_change', 'water_supply_cancel')
     AND EXISTS (
       SELECT 1 FROM public.municipalities AS municipality
       WHERE municipality.id = NEW.municipality_id
         AND municipality.enabled_modules IS NOT NULL
         AND NOT ('waterworks' = ANY (municipality.enabled_modules))
     ) THEN
    RAISE EXCEPTION 'หน่วยงานนี้ไม่ได้เปิดใช้งานระบบประปา'
      USING ERRCODE = '42501';
  END IF;

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
        -- เปลี่ยนมาตร/ยกเลิกใช้น้ำ เป็นงานถอด/ติดตั้งมาตรหน้างานของงานกิจการประปาเดียวกัน
        -- ลำดับหากองเหมือนขอใช้น้ำทุกขั้น (ดูเหตุผลที่ 20260908190000_route_water_supply_request.sql)
        WHEN 'water_meter_change' THEN COALESCE(
          public.resolve_work_department(NEW.municipality_id, 'waterworks', 'ประปา'),
          public.resolve_work_department(NEW.municipality_id, 'engineering', 'กองช่าง'),
          public.resolve_work_department(NEW.municipality_id, 'general', 'สำนักปลัด')
        )
        WHEN 'water_supply_cancel' THEN COALESCE(
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
  -- คำขอยืมพัสดุต้องอยู่กองเดียวกันด้วย — ใบวิ่งเข้ากองเจ้าของพัสดุ ไม่ใช่กองในผังงาน
  -- ใช้ = ไม่ใช่ IS NOT DISTINCT FROM: คนที่ไม่มีกอง (department_id NULL) ต้องไม่ได้ใบไหนเลย
  IF NEW.assigned_to IS NULL AND v_assignee_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.profiles AS profile
      WHERE profile.id = v_assignee_id
        AND profile.municipality_id = NEW.municipality_id
        AND (
          NEW.document_type <> 'asset_borrow_request'
          OR profile.department_id = NEW.department_id
        )
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

COMMIT;
