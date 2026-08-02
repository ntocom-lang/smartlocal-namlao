-- officer = ธุรการกอง: จัดการงานเฉพาะกองที่สังกัด
-- admin = ทุกกองในเทศบาล, superadmin = ทุกเทศบาล

BEGIN;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_posts_department_id ON public.posts(department_id);

UPDATE public.posts AS post
SET department_id = profile.department_id
FROM public.profiles AS profile
WHERE post.created_by = profile.id
  AND post.municipality_id = profile.municipality_id
  AND post.department_id IS NULL
  AND profile.department_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.department_belongs_to_municipality(
  p_department_id uuid,
  p_municipality_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p_department_id IS NULL OR EXISTS (
    SELECT 1
    FROM public.departments AS department
    WHERE department.id = p_department_id
      AND department.municipality_id = p_municipality_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_my_department(
  p_municipality_id uuid,
  p_department_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p_department_id IS NOT NULL
    AND p_municipality_id = public.get_my_municipality_id()
    AND p_department_id = public.get_my_department_id();
$$;

REVOKE ALL ON FUNCTION public.department_belongs_to_municipality(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_my_department(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.department_belongs_to_municipality(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_my_department(uuid, uuid) TO authenticated;

-- ตารางทั้งสามมีคอลัมน์ scope ชุดเดียวกัน ป้องกัน non-admin เปลี่ยนเจ้าของ/เทศบาล/กอง
CREATE OR REPLACE FUNCTION public.protect_department_record_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND public.get_my_role() NOT IN ('admin', 'superadmin')
     AND (
       NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.municipality_id IS DISTINCT FROM OLD.municipality_id
       OR NEW.department_id IS DISTINCT FROM OLD.department_id
     )
  THEN
    RAISE EXCEPTION 'Record owner, municipality and department cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_department_record_scope() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_posts_scope_trigger ON public.posts;
CREATE TRIGGER protect_posts_scope_trigger
  BEFORE UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.protect_department_record_scope();

DROP TRIGGER IF EXISTS protect_civil_projects_scope_trigger ON public.civil_projects;
CREATE TRIGGER protect_civil_projects_scope_trigger
  BEFORE UPDATE ON public.civil_projects
  FOR EACH ROW EXECUTE FUNCTION public.protect_department_record_scope();

DROP TRIGGER IF EXISTS protect_infrastructure_works_scope_trigger ON public.infrastructure_works;
CREATE TRIGGER protect_infrastructure_works_scope_trigger
  BEFORE UPDATE ON public.infrastructure_works
  FOR EACH ROW EXECUTE FUNCTION public.protect_department_record_scope();

-- ข่าวสาร/กิจกรรม: ทุกบทบาทภายในอ่านได้, ธุรการกองจัดการเฉพาะกองตนเอง
DROP POLICY IF EXISTS "public read published posts" ON public.posts;
DROP POLICY IF EXISTS "staff manage posts" ON public.posts;
DROP POLICY IF EXISTS "read published posts" ON public.posts;
DROP POLICY IF EXISTS "auth read all posts" ON public.posts;
DROP POLICY IF EXISTS "staff read all posts" ON public.posts;
DROP POLICY IF EXISTS "staff read drafts" ON public.posts;
DROP POLICY IF EXISTS "staff insert posts" ON public.posts;
DROP POLICY IF EXISTS "staff write posts" ON public.posts;
DROP POLICY IF EXISTS "staff update posts" ON public.posts;
DROP POLICY IF EXISTS "staff delete posts" ON public.posts;
DROP POLICY IF EXISTS "internal read municipality posts" ON public.posts;
DROP POLICY IF EXISTS "department scoped insert posts" ON public.posts;
DROP POLICY IF EXISTS "department scoped update posts" ON public.posts;
DROP POLICY IF EXISTS "department scoped delete posts" ON public.posts;

CREATE POLICY "read published posts" ON public.posts
  FOR SELECT USING (is_published = true);

CREATE POLICY "internal read municipality posts" ON public.posts
  FOR SELECT TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin', 'officer', 'staff', 'viewer', 'council', 'technician')
      AND municipality_id = get_my_municipality_id()
    )
  );

CREATE POLICY "department scoped insert posts" ON public.posts
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.department_belongs_to_municipality(department_id, municipality_id)
    AND (
      get_my_role() = 'superadmin'
      OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
      OR (get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
      OR (
        get_my_role() = 'staff'
        AND municipality_id = get_my_municipality_id()
        AND department_id IS NOT DISTINCT FROM get_my_department_id()
      )
    )
  );

CREATE POLICY "department scoped update posts" ON public.posts
  FOR UPDATE TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
    OR (get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
    OR (get_my_role() = 'staff' AND municipality_id = get_my_municipality_id() AND created_by = auth.uid())
  )
  WITH CHECK (
    public.department_belongs_to_municipality(department_id, municipality_id)
    AND (
      get_my_role() = 'superadmin'
      OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
      OR (get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
      OR (get_my_role() = 'staff' AND municipality_id = get_my_municipality_id() AND created_by = auth.uid())
    )
  );

CREATE POLICY "department scoped delete posts" ON public.posts
  FOR DELETE TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
    OR (get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
    OR (get_my_role() = 'staff' AND municipality_id = get_my_municipality_id() AND created_by = auth.uid())
  );

-- โครงการ: ธุรการกองแก้ไขได้ทั้งกอง, เจ้าหน้าที่/ช่างแก้เฉพาะรายการที่สร้าง
DROP POLICY IF EXISTS "civil_projects_insert" ON public.civil_projects;
DROP POLICY IF EXISTS "civil_projects_update" ON public.civil_projects;
DROP POLICY IF EXISTS "civil_projects_delete" ON public.civil_projects;

CREATE POLICY "civil_projects_insert" ON public.civil_projects
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.department_belongs_to_municipality(department_id, municipality_id)
    AND (
      get_my_role() = 'superadmin'
      OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
      OR (get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
      OR (
        get_my_role() IN ('staff', 'technician')
        AND municipality_id = get_my_municipality_id()
        AND department_id IS NOT DISTINCT FROM get_my_department_id()
      )
    )
  );

CREATE POLICY "civil_projects_update" ON public.civil_projects
  FOR UPDATE TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
    OR (get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
    OR (
      get_my_role() IN ('staff', 'technician')
      AND municipality_id = get_my_municipality_id()
      AND created_by = auth.uid()
    )
  )
  WITH CHECK (
    public.department_belongs_to_municipality(department_id, municipality_id)
    AND (
      get_my_role() = 'superadmin'
      OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
      OR (get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
      OR (
        get_my_role() IN ('staff', 'technician')
        AND municipality_id = get_my_municipality_id()
        AND created_by = auth.uid()
      )
    )
  );

CREATE POLICY "civil_projects_delete" ON public.civil_projects
  FOR DELETE TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
  );

-- งานโครงสร้างพื้นฐาน: ใช้หลักเดียวกับโครงการ และคง hard-delete ให้ admin เท่านั้น
DROP POLICY IF EXISTS "technician_insert_works" ON public.infrastructure_works;
DROP POLICY IF EXISTS "technician_update_own_works" ON public.infrastructure_works;
DROP POLICY IF EXISTS "admin_all_infrastructure_works" ON public.infrastructure_works;
DROP POLICY IF EXISTS "department scoped insert infrastructure works" ON public.infrastructure_works;
DROP POLICY IF EXISTS "department scoped update infrastructure works" ON public.infrastructure_works;
DROP POLICY IF EXISTS "admin delete infrastructure works" ON public.infrastructure_works;

CREATE POLICY "department scoped insert infrastructure works" ON public.infrastructure_works
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.department_belongs_to_municipality(department_id, municipality_id)
    AND (
      get_my_role() = 'superadmin'
      OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
      OR (get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
      OR (
        get_my_role() IN ('staff', 'technician')
        AND municipality_id = get_my_municipality_id()
        AND department_id IS NOT DISTINCT FROM get_my_department_id()
      )
    )
  );

CREATE POLICY "department scoped update infrastructure works" ON public.infrastructure_works
  FOR UPDATE TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
    OR (get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
    OR (
      get_my_role() IN ('staff', 'technician')
      AND municipality_id = get_my_municipality_id()
      AND created_by = auth.uid()
    )
  )
  WITH CHECK (
    public.department_belongs_to_municipality(department_id, municipality_id)
    AND (
      get_my_role() = 'superadmin'
      OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
      OR (get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
      OR (
        get_my_role() IN ('staff', 'technician')
        AND municipality_id = get_my_municipality_id()
        AND created_by = auth.uid()
      )
    )
  );

CREATE POLICY "admin delete infrastructure works" ON public.infrastructure_works
  FOR DELETE TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
  );

-- คำขอธุรกิจ: ธุรการกองรับรายการที่ยังไม่มีกองเข้ากองตนเอง แล้วจึงดำเนินการได้
DROP POLICY IF EXISTS "admin_all_business_registrations" ON public.business_registrations;
DROP POLICY IF EXISTS "internal read business registrations" ON public.business_registrations;
DROP POLICY IF EXISTS "department scoped update business registrations" ON public.business_registrations;
DROP POLICY IF EXISTS "admin delete business registrations" ON public.business_registrations;

CREATE POLICY "internal read business registrations" ON public.business_registrations
  FOR SELECT TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin', 'officer', 'staff', 'viewer', 'technician')
      AND municipality_id = get_my_municipality_id()
    )
  );

CREATE POLICY "department scoped update business registrations" ON public.business_registrations
  FOR UPDATE TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
    OR (
      get_my_role() = 'officer'
      AND municipality_id = get_my_municipality_id()
      AND get_my_department_id() IS NOT NULL
      AND (department_id = get_my_department_id() OR department_id IS NULL)
    )
  )
  WITH CHECK (
    public.department_belongs_to_municipality(department_id, municipality_id)
    AND (
      get_my_role() = 'superadmin'
      OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
      OR (get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
    )
  );

CREATE POLICY "admin delete business registrations" ON public.business_registrations
  FOR DELETE TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
  );

COMMIT;
