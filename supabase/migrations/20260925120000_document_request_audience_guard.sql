-- 20260925120000_document_request_audience_guard.sql
--
-- บังคับ "ใครยื่นคำขอเอกสาร/บริการประเภทนี้ได้" (ทุกคน / เฉพาะผู้มีตำแหน่ง) ที่ trigger ซึ่งคำขอทุกใบผ่าน
-- (route_document_request_department — BEFORE INSERT บน document_requests ตรวจแล้ว 2569-09-25
--  ครอบทั้ง insert ตรงจากหน้ายื่นคำขอ/วิซาร์ด และ RPC create_asset_borrow_request)
--
-- ค่าตั้งเก็บที่ municipalities.fee_schedule._officials_only_types (array ของ document_type) — ก้อนเดียวกับ
-- _removed_types ของสวิตช์เปิด/ปิดบริการ เพราะหน้าประชาชนอ่านได้ผ่าน tenant อยู่แล้ว (document_type_assignments
-- ถอนสิทธิ์ anon ไว้) · ไม่มี อปท. ไหนตั้งคีย์นี้ ณ วันที่ apply → ไม่มีผลกับใครจนกว่าแอดมินจะตั้งเอง
--
-- จำกัดเฉพาะช่องทางยื่นออนไลน์ด้วยตนเอง ไม่ใช่ตัดสิทธิ์ — เจ้าหน้าที่ยังรับคำขอแทนที่เคาน์เตอร์ได้ทุกประเภท
-- ⚠️ ประเภทที่เป็นคำขออนุญาตตามกฎหมาย ถ้าคู่มือประชาชนของ อปท. ประกาศช่องทางออนไลน์ไว้ ต้องแก้คู่มือด้วย
--    (ต้องยืนยันกับ พ.ร.บ.การอำนวยความสะดวกฯ ฉบับปัจจุบันก่อนตั้งค่าจริง)
--
-- ⚠️ ตัวฟังก์ชันด้านล่างคัดจาก pg_get_functiondef() ของ production วันที่ 2569-09-25 มาทั้งตัว
-- (ตรงกับ 20260914120000_waterworks_module_and_routing.sql ต่างแค่รูปแบบที่ PostgreSQL จัดเอง ตรวจ diff แล้ว)
-- แล้วแทรกเฉพาะด่าน "ใครยื่นประเภทนี้ได้" ต่อจากด่านโมดูลประปา ไม่ได้พิมพ์ใหม่เอง
-- trigger ผูกฟังก์ชันด้วยชื่อ CREATE OR REPLACE จึงไม่ต้องสร้าง trigger ใหม่

CREATE OR REPLACE FUNCTION public.route_document_request_department()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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

  -- ── ใครยื่นประเภทนี้ได้ (municipalities.fee_schedule._officials_only_types, 20260925120000) ────────
  -- แอดมินตั้งรายประเภทที่หน้า "ประเภทคำขอเอกสาร" ว่าเปิดให้เฉพาะผู้มีตำแหน่งยื่น (ประชาชนยังไม่เห็น)
  -- ผู้มีตำแหน่ง = role ไม่ใช่ประชาชนและสังกัด อปท. เดียวกับคำขอ (superadmin ผ่านทุกที่)
  -- ⚠️ ตัดสินจากตัวผู้เรียก (auth.uid()) เท่านั้น ห้ามอิง channel ในคำขอ — client ตั้งค่าเองได้
  --    เจ้าหน้าที่รับเรื่องแทนที่เคาน์เตอร์ผ่านเพราะตัวเจ้าหน้าที่เป็นผู้มีตำแหน่ง ไม่ใช่เพราะช่องทาง
  -- ⚠️ ต้องครอบ COALESCE — ผู้ไม่ล็อกอินไม่มีแถวใน profiles ได้ NULL และ IF NOT NULL ไม่ raise (หลุดผ่าน)
  -- ข้ามด่านเมื่อไม่มี JWT (psql/migration) หรือเป็น service_role — แพทเทิร์นเดียวกับ 20260901100000
  -- ⚠️ ลิสต์ role ต้องตรงกับ OFFICIAL_ROLES ใน src/lib/serviceAudience.js (tests/service-audience.test.mjs ตรวจให้)
  IF auth.role() IS NOT NULL AND auth.role() <> 'service_role'
     AND EXISTS (
       SELECT 1 FROM public.municipalities AS municipality
       WHERE municipality.id = NEW.municipality_id
         AND jsonb_typeof(municipality.fee_schedule -> '_officials_only_types') = 'array'
         AND (municipality.fee_schedule -> '_officials_only_types') ? NEW.document_type
     )
     AND NOT COALESCE((
       SELECT actor.role = 'superadmin'
         OR (
           actor.role IN ('admin', 'officer', 'staff', 'technician', 'viewer', 'council')
           AND actor.municipality_id = NEW.municipality_id
         )
       FROM public.profiles AS actor
       WHERE actor.id = auth.uid()
     ), false)
  THEN
    RAISE EXCEPTION 'บริการนี้ยังไม่เปิดให้ประชาชนยื่นทางออนไลน์ กรุณาติดต่อสำนักงาน'
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
$function$;

-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   select position('_officials_only_types' in pg_get_functiondef('public.route_document_request_department()'::regprocedure)) > 0;
--   → true
--   select slug, fee_schedule -> '_officials_only_types' from public.municipalities;
--   → ทุกแถวเป็น null (ยังไม่มี อปท. ไหนตั้ง)
