-- Scope งานปฏิบัติการให้ธุรการกองจัดการได้เฉพาะกองที่สังกัด
-- ตารางสาธารณะยังอ่านข้อมูลที่เผยแพร่ได้ แต่สิทธิ์เขียนถูกบังคับด้วย RLS

BEGIN;

ALTER TABLE public.approval_requests
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;
ALTER TABLE public.document_requests
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;
ALTER TABLE public.data_center_entries
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;
ALTER TABLE public.org_projects
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;
ALTER TABLE public.tourism_places
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS approval_requests_department_id_idx ON public.approval_requests(department_id);
CREATE INDEX IF NOT EXISTS document_requests_department_id_idx ON public.document_requests(department_id);
CREATE INDEX IF NOT EXISTS data_center_entries_department_id_idx ON public.data_center_entries(department_id);
CREATE INDEX IF NOT EXISTS org_projects_department_id_idx ON public.org_projects(department_id);
CREATE INDEX IF NOT EXISTS tourism_places_department_id_idx ON public.tourism_places(department_id);

-- เลือก department record ที่มีบุคลากรใช้งานจริงก่อน รองรับข้อมูลเก่าที่มีชื่อกองซ้ำ
CREATE OR REPLACE FUNCTION public.resolve_work_department(
  p_municipality_id uuid,
  p_code text,
  p_name text
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT department.id
  FROM public.departments AS department
  WHERE department.municipality_id = p_municipality_id
    AND (
      lower(department.code) = lower(p_code)
      OR department.name ILIKE '%' || p_name || '%'
    )
  ORDER BY
    EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      WHERE profile.department_id = department.id
    ) DESC,
    (lower(department.code) = lower(p_code)) DESC,
    department.sort_order,
    department.id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.resolve_work_department(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- กำหนดกองจากผู้สร้างให้อัตโนมัติ และกันการอ้างกอง/เทศบาลของคนอื่น
CREATE OR REPLACE FUNCTION public.set_actor_department_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_role text;
  actor_municipality_id uuid;
  actor_department_id uuid;
BEGIN
  -- งานจาก service role/migration ไม่มี auth.uid(); ให้ RLS/สิทธิ์ฐานข้อมูลเป็นผู้ควบคุม
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT profile.role, profile.municipality_id, profile.department_id
  INTO actor_role, actor_municipality_id, actor_department_id
  FROM public.profiles AS profile
  WHERE profile.id = auth.uid();

  IF actor_role IS NULL THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF NEW.created_by IS NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  IF actor_role <> 'superadmin' AND NEW.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Permission denied: invalid record owner';
  END IF;
  IF actor_role <> 'superadmin' AND NEW.municipality_id IS DISTINCT FROM actor_municipality_id THEN
    RAISE EXCEPTION 'Permission denied: municipality mismatch';
  END IF;
  IF NEW.department_id IS NULL AND actor_role <> 'superadmin' THEN
    NEW.department_id := actor_department_id;
  END IF;
  IF actor_role IN ('officer', 'staff', 'technician')
     AND NEW.department_id IS DISTINCT FROM actor_department_id
  THEN
    RAISE EXCEPTION 'Permission denied: department mismatch';
  END IF;
  IF NOT public.department_belongs_to_municipality(NEW.department_id, NEW.municipality_id) THEN
    RAISE EXCEPTION 'Permission denied: department does not belong to municipality';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_actor_department_scope() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS set_approval_request_department_trigger ON public.approval_requests;
CREATE TRIGGER set_approval_request_department_trigger
  BEFORE INSERT ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_actor_department_scope();

DROP TRIGGER IF EXISTS set_data_center_entry_department_trigger ON public.data_center_entries;
CREATE TRIGGER set_data_center_entry_department_trigger
  BEFORE INSERT ON public.data_center_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_actor_department_scope();

DROP TRIGGER IF EXISTS set_org_project_department_trigger ON public.org_projects;
CREATE TRIGGER set_org_project_department_trigger
  BEFORE INSERT ON public.org_projects
  FOR EACH ROW EXECUTE FUNCTION public.set_actor_department_scope();

DROP TRIGGER IF EXISTS set_tourism_place_department_trigger ON public.tourism_places;
CREATE TRIGGER set_tourism_place_department_trigger
  BEFORE INSERT ON public.tourism_places
  FOR EACH ROW EXECUTE FUNCTION public.set_actor_department_scope();

-- ป้องกันผู้ใช้ระดับกองเปลี่ยนเจ้าของ/เทศบาล/กองระหว่างแก้รายการ
DROP TRIGGER IF EXISTS protect_approval_request_scope_trigger ON public.approval_requests;
CREATE TRIGGER protect_approval_request_scope_trigger
  BEFORE UPDATE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.protect_department_record_scope();
DROP TRIGGER IF EXISTS protect_data_center_entry_scope_trigger ON public.data_center_entries;
CREATE TRIGGER protect_data_center_entry_scope_trigger
  BEFORE UPDATE ON public.data_center_entries
  FOR EACH ROW EXECUTE FUNCTION public.protect_department_record_scope();
DROP TRIGGER IF EXISTS protect_org_project_scope_trigger ON public.org_projects;
CREATE TRIGGER protect_org_project_scope_trigger
  BEFORE UPDATE ON public.org_projects
  FOR EACH ROW EXECUTE FUNCTION public.protect_department_record_scope();
DROP TRIGGER IF EXISTS protect_tourism_place_scope_trigger ON public.tourism_places;
CREATE TRIGGER protect_tourism_place_scope_trigger
  BEFORE UPDATE ON public.tourism_places
  FOR EACH ROW EXECUTE FUNCTION public.protect_department_record_scope();

-- จัดกองคำขอเอกสารตามประเภทบริการ หากหาไม่พบให้ Admin จัดการรายการ unassigned
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

DROP TRIGGER IF EXISTS route_document_request_department_trigger ON public.document_requests;
CREATE TRIGGER route_document_request_department_trigger
  BEFORE INSERT ON public.document_requests
  FOR EACH ROW EXECUTE FUNCTION public.route_document_request_department();

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
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_document_request_scope() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_document_request_scope_trigger ON public.document_requests;
CREATE TRIGGER protect_document_request_scope_trigger
  BEFORE UPDATE ON public.document_requests
  FOR EACH ROW EXECUTE FUNCTION public.protect_document_request_scope();

-- Backfill จากผู้สร้างและประเภทบริการเดิม
UPDATE public.approval_requests AS request
SET department_id = profile.department_id
FROM public.profiles AS profile
WHERE request.created_by = profile.id
  AND request.municipality_id = profile.municipality_id
  AND request.department_id IS NULL;

UPDATE public.data_center_entries AS entry
SET department_id = profile.department_id
FROM public.profiles AS profile
WHERE entry.created_by = profile.id
  AND entry.municipality_id = profile.municipality_id
  AND entry.department_id IS NULL;

UPDATE public.org_projects AS project
SET department_id = profile.department_id
FROM public.profiles AS profile
WHERE project.created_by = profile.id
  AND project.municipality_id = profile.municipality_id
  AND project.department_id IS NULL;

UPDATE public.document_requests AS request
SET department_id = CASE request.document_type
  WHEN 'tax_notice' THEN public.resolve_work_department(request.municipality_id, 'finance', 'กองคลัง')
  WHEN 'building_permit' THEN public.resolve_work_department(request.municipality_id, 'engineering', 'กองช่าง')
  ELSE public.resolve_work_department(request.municipality_id, 'general', 'สำนักปลัด')
END
WHERE request.department_id IS NULL;

-- approval_requests
DROP POLICY IF EXISTS "staff read approval_requests" ON public.approval_requests;
DROP POLICY IF EXISTS "staff insert approval_requests" ON public.approval_requests;
DROP POLICY IF EXISTS "admin update approval_requests" ON public.approval_requests;
DROP POLICY IF EXISTS "admin delete approval_requests" ON public.approval_requests;

CREATE POLICY "staff read approval_requests" ON public.approval_requests
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR public.get_my_role() = 'superadmin'
    OR (public.get_my_role() IN ('admin', 'viewer') AND municipality_id = public.get_my_municipality_id())
    OR (public.get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
  );
CREATE POLICY "staff insert approval_requests" ON public.approval_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.department_belongs_to_municipality(department_id, municipality_id)
    AND (
      public.get_my_role() = 'superadmin'
      OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
      OR (public.get_my_role() IN ('officer', 'staff') AND public.is_my_department(municipality_id, department_id))
      OR (
        public.get_my_role() = 'council'
        AND municipality_id = public.get_my_municipality_id()
        AND department_id IS NOT DISTINCT FROM public.get_my_department_id()
      )
    )
  );
CREATE POLICY "admin update approval_requests" ON public.approval_requests
  FOR UPDATE TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
    OR (public.get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
    OR (
      created_by = auth.uid()
      AND municipality_id = public.get_my_municipality_id()
      AND status = 'pending'
    )
  )
  WITH CHECK (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
    OR (public.get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
    OR (
      created_by = auth.uid()
      AND municipality_id = public.get_my_municipality_id()
      AND status = 'pending'
    )
  );
CREATE POLICY "admin delete approval_requests" ON public.approval_requests
  FOR DELETE TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
  );

-- document_requests (มี PII): staff เห็นเฉพาะที่มอบหมาย, officer เห็นเฉพาะกอง
DROP POLICY IF EXISTS "public can insert document_requests" ON public.document_requests;
DROP POLICY IF EXISTS "read document_requests" ON public.document_requests;
DROP POLICY IF EXISTS "staff update document_requests" ON public.document_requests;

CREATE POLICY "public can insert document_requests" ON public.document_requests
  FOR INSERT
  WITH CHECK (
    municipality_id IS NOT NULL
    AND (user_id IS NULL OR user_id = auth.uid())
    AND public.department_belongs_to_municipality(department_id, municipality_id)
  );
CREATE POLICY "read document_requests" ON public.document_requests
  FOR SELECT
  USING (
    (user_id IS NOT NULL AND user_id = auth.uid())
    OR public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
    OR (public.get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
    OR (
      public.get_my_role() = 'staff'
      AND municipality_id = public.get_my_municipality_id()
      AND assigned_to = auth.uid()
    )
  );
CREATE POLICY "staff update document_requests" ON public.document_requests
  FOR UPDATE TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
    OR (public.get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
    OR (public.get_my_role() = 'staff' AND assigned_to = auth.uid())
  )
  WITH CHECK (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
    OR (public.get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
    OR (public.get_my_role() = 'staff' AND assigned_to = auth.uid())
  );

-- Storage ใช้ scope เดียวกับ document_requests
-- payment-slips ยังไม่เปิดใช้งาน: bucket เป็น private และไม่มี policy สำหรับผู้ใช้แอป
-- document-certs: {municipality_id}/{request_id}.html
CREATE OR REPLACE FUNCTION public.can_access_document_request_object(p_object_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  request_id uuid;
  path_municipality_id uuid;
  request_row record;
  caller_role text;
BEGIN
  BEGIN
    path_municipality_id := split_part(p_object_name, '/', 1)::uuid;
    request_id := split_part(split_part(p_object_name, '/', 2), '.', 1)::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN false;
  END;

  SELECT request.municipality_id, request.department_id, request.user_id, request.assigned_to
  INTO request_row
  FROM public.document_requests AS request
  WHERE request.id = request_id;

  IF NOT FOUND OR request_row.municipality_id IS DISTINCT FROM path_municipality_id THEN
    RETURN false;
  END IF;

  caller_role := public.get_my_role();
  RETURN
    (request_row.user_id IS NOT NULL AND request_row.user_id = auth.uid())
    OR caller_role = 'superadmin'
    OR (caller_role = 'admin' AND request_row.municipality_id = public.get_my_municipality_id())
    OR (
      caller_role = 'officer'
      AND public.is_my_department(request_row.municipality_id, request_row.department_id)
    )
    OR (
      caller_role = 'staff'
      AND request_row.municipality_id = public.get_my_municipality_id()
      AND request_row.assigned_to = auth.uid()
    );
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_document_request_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_document_request_object(text) TO authenticated;

-- ใบรับรองเดิมเป็น public bucket: เปลี่ยนเป็น private และเก็บ path แทน public URL
UPDATE storage.buckets
SET public = false
WHERE id IN ('payment-slips', 'document-certs');

UPDATE public.document_requests
SET document_url = split_part(document_url, '/document-certs/', 2)
WHERE document_url LIKE '%/document-certs/%';

DROP POLICY IF EXISTS "citizen upload payment slip" ON storage.objects;
DROP POLICY IF EXISTS "citizen update payment slip" ON storage.objects;
DROP POLICY IF EXISTS "staff read payment slips" ON storage.objects;
DROP POLICY IF EXISTS "staff delete payment slips" ON storage.objects;
-- ห้ามสร้าง policy ใหม่ให้ payment-slips จนกว่าหน่วยงานจะอนุมัติ workflow รับชำระเงิน
-- การไม่มี policy ทำให้ authenticated/anon อ่าน เขียน แก้ไข หรือลบไฟล์ใน bucket นี้ไม่ได้

DROP POLICY IF EXISTS "staff upload document certs" ON storage.objects;
DROP POLICY IF EXISTS "staff update document certs" ON storage.objects;
DROP POLICY IF EXISTS "staff delete document certs" ON storage.objects;
DROP POLICY IF EXISTS "public read document certs" ON storage.objects;

CREATE POLICY "staff upload document certs" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'document-certs'
    AND public.get_my_role() IN ('admin', 'superadmin', 'officer', 'staff')
    AND public.can_access_document_request_object(name)
  );
CREATE POLICY "staff update document certs" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'document-certs'
    AND public.get_my_role() IN ('admin', 'superadmin', 'officer', 'staff')
    AND public.can_access_document_request_object(name)
  )
  WITH CHECK (
    bucket_id = 'document-certs'
    AND public.get_my_role() IN ('admin', 'superadmin', 'officer', 'staff')
    AND public.can_access_document_request_object(name)
  );
CREATE POLICY "staff delete document certs" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'document-certs'
    AND public.get_my_role() IN ('admin', 'superadmin', 'officer', 'staff')
    AND public.can_access_document_request_object(name)
  );
CREATE POLICY "authorized read document certs" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'document-certs'
    AND public.can_access_document_request_object(name)
  );

-- data_center_entries
DROP POLICY IF EXISTS "dce staff read own municipality" ON public.data_center_entries;
DROP POLICY IF EXISTS "dce staff insert own municipality" ON public.data_center_entries;
DROP POLICY IF EXISTS "dce staff update own municipality" ON public.data_center_entries;
DROP POLICY IF EXISTS "dce admin delete own municipality" ON public.data_center_entries;

CREATE POLICY "dce staff read own municipality" ON public.data_center_entries
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (
      public.get_my_role() IN ('admin', 'viewer', 'council', 'officer', 'staff', 'technician')
      AND municipality_id = public.get_my_municipality_id()
    )
  );
CREATE POLICY "dce staff insert own municipality" ON public.data_center_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.department_belongs_to_municipality(department_id, municipality_id)
    AND (
      public.get_my_role() = 'superadmin'
      OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
      OR (public.get_my_role() IN ('officer', 'staff', 'technician') AND public.is_my_department(municipality_id, department_id))
    )
  );
CREATE POLICY "dce staff update own municipality" ON public.data_center_entries
  FOR UPDATE TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
    OR (public.get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
    OR (public.get_my_role() IN ('staff', 'technician') AND created_by = auth.uid())
  )
  WITH CHECK (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
    OR (public.get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
    OR (public.get_my_role() IN ('staff', 'technician') AND created_by = auth.uid())
  );
CREATE POLICY "dce admin delete own municipality" ON public.data_center_entries
  FOR DELETE TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
    OR (public.get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
  );

-- org_projects / org_project_updates
DROP POLICY IF EXISTS "staff insert projects" ON public.org_projects;
DROP POLICY IF EXISTS "admin update projects" ON public.org_projects;
DROP POLICY IF EXISTS "admin delete projects" ON public.org_projects;
CREATE POLICY "staff insert projects" ON public.org_projects
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.department_belongs_to_municipality(department_id, municipality_id)
    AND (
      public.get_my_role() = 'superadmin'
      OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
      OR (public.get_my_role() IN ('officer', 'staff') AND public.is_my_department(municipality_id, department_id))
    )
  );
CREATE POLICY "admin update projects" ON public.org_projects
  FOR UPDATE TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
    OR (public.get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
    OR (public.get_my_role() = 'staff' AND created_by = auth.uid())
  )
  WITH CHECK (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
    OR (public.get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
    OR (public.get_my_role() = 'staff' AND created_by = auth.uid())
  );
CREATE POLICY "admin delete projects" ON public.org_projects
  FOR DELETE TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
    OR (public.get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
  );

DROP POLICY IF EXISTS "staff insert updates" ON public.org_project_updates;
DROP POLICY IF EXISTS "staff update updates" ON public.org_project_updates;
DROP POLICY IF EXISTS "admin delete updates" ON public.org_project_updates;
CREATE POLICY "staff insert updates" ON public.org_project_updates
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.org_projects AS project
      WHERE project.id = org_project_updates.project_id
        AND project.municipality_id = org_project_updates.municipality_id
        AND (
          public.get_my_role() = 'superadmin'
          OR (public.get_my_role() = 'admin' AND project.municipality_id = public.get_my_municipality_id())
          OR (public.get_my_role() IN ('officer', 'staff') AND public.is_my_department(project.municipality_id, project.department_id))
        )
    )
  );
CREATE POLICY "staff update updates" ON public.org_project_updates
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.org_projects AS project
      WHERE project.id = org_project_updates.project_id
        AND (
          public.get_my_role() = 'superadmin'
          OR (public.get_my_role() = 'admin' AND project.municipality_id = public.get_my_municipality_id())
          OR (public.get_my_role() = 'officer' AND public.is_my_department(project.municipality_id, project.department_id))
          OR (public.get_my_role() = 'staff' AND org_project_updates.created_by = auth.uid())
        )
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    OR public.get_my_role() IN ('admin', 'superadmin', 'officer')
  );
CREATE POLICY "admin delete updates" ON public.org_project_updates
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.org_projects AS project
      WHERE project.id = org_project_updates.project_id
        AND (
          public.get_my_role() = 'superadmin'
          OR (public.get_my_role() = 'admin' AND project.municipality_id = public.get_my_municipality_id())
          OR (public.get_my_role() = 'officer' AND public.is_my_department(project.municipality_id, project.department_id))
        )
    )
  );

-- tourism_places: ผู้สร้างแก้ของตนเอง, ธุรการกองจัดการทั้งกอง
DROP POLICY IF EXISTS "admin manage own municipality tourism_places" ON public.tourism_places;
DROP POLICY IF EXISTS "department manage tourism_places" ON public.tourism_places;
CREATE POLICY "department manage tourism_places" ON public.tourism_places
  FOR ALL TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
    OR (public.get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
    OR (public.get_my_role() = 'staff' AND created_by = auth.uid())
  )
  WITH CHECK (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
    OR (public.get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
    OR (
      public.get_my_role() = 'staff'
      AND created_by = auth.uid()
      AND public.is_my_department(municipality_id, department_id)
    )
  );

COMMIT;
