-- ส่งคำขอเริ่มรับบริการเก็บขนขยะไปกองสาธารณสุข/สิ่งแวดล้อมก่อน
-- หาก อปท. ไม่มีโครงสร้างกองดังกล่าว ให้ fallback สำนักปลัดเหมือนงานบริการประชาชนเดิม

BEGIN;

CREATE OR REPLACE FUNCTION public.route_document_request_department()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.department_id IS NULL THEN
    NEW.department_id := CASE NEW.document_type
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
    END;
  END IF;

  IF NOT public.department_belongs_to_municipality(NEW.department_id, NEW.municipality_id) THEN
    RAISE EXCEPTION 'Permission denied: department does not belong to municipality';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.route_document_request_department() FROM PUBLIC, anon, authenticated;

COMMIT;
