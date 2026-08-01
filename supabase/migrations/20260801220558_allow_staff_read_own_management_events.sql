-- บุคลากรภายในทุกบทบาทเพิ่มและเห็นปฏิทินของเทศบาลเดียวกันได้ ยกเว้น citizen
-- เจ้าของแก้ไข/ลบของตนเองได้ และหัวหน้ากองแก้ไข/ลบกิจกรรมในกองเดียวกันได้
-- Admin จัดการภายในเทศบาล และ SuperAdmin จัดการได้ทั้งหมด

BEGIN;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_department_id ON public.events(department_id);

-- ผูกกิจกรรมเดิมเข้ากองของผู้สร้างเท่าที่มีข้อมูลจริง ไม่เดาจากชื่อตำแหน่ง
UPDATE public.events AS e
SET department_id = p.department_id
FROM public.profiles AS p
WHERE e.created_by = p.id
  AND e.municipality_id = p.municipality_id
  AND e.department_id IS NULL
  AND p.department_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_my_department_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p.department_id
  FROM public.profiles AS p
  WHERE p.id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.can_manage_event_department(
  p_municipality_id uuid,
  p_department_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = auth.uid()
      AND p.municipality_id = p_municipality_id
      AND p.department_id = p_department_id
      AND p_department_id IS NOT NULL
      AND COALESCE(p.is_dept_head, false)
  );
$$;

REVOKE ALL ON FUNCTION public.get_my_department_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_event_department(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_department_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_event_department(uuid, uuid) TO authenticated;

-- ป้องกันผู้ใช้ทั่วไปปลอมเจ้าของ ย้ายเทศบาล หรือย้ายกองผ่าน REST API
CREATE OR REPLACE FUNCTION public.protect_event_scope_columns()
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
    RAISE EXCEPTION 'Event ownership, municipality and department cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_event_scope_columns() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS protect_event_scope_columns_trigger ON public.events;
CREATE TRIGGER protect_event_scope_columns_trigger
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.protect_event_scope_columns();

DROP POLICY IF EXISTS "events select by audience" ON public.events;
DROP POLICY IF EXISTS "staff insert events" ON public.events;
DROP POLICY IF EXISTS "staff update events" ON public.events;
DROP POLICY IF EXISTS "staff delete events" ON public.events;

CREATE POLICY "events select by audience" ON public.events
  FOR SELECT
  USING (
    get_my_role() = 'superadmin'
    OR 'public' = ANY(audiences)
    OR (
      get_my_role() IN ('admin', 'officer', 'viewer', 'council', 'staff', 'technician', 'kamnan')
      AND municipality_id = get_my_municipality_id()
    )
  );

CREATE POLICY "staff insert events" ON public.events
  FOR INSERT
  WITH CHECK (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin', 'viewer', 'council', 'officer', 'staff', 'technician', 'kamnan')
      AND municipality_id = get_my_municipality_id()
      AND created_by = auth.uid()
      AND (
        get_my_role() = 'admin'
        OR department_id IS NOT DISTINCT FROM public.get_my_department_id()
      )
    )
  );

CREATE POLICY "staff update events" ON public.events
  FOR UPDATE
  USING (
    get_my_role() = 'superadmin'
    OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
    OR (
      get_my_role() IN ('viewer', 'council', 'officer', 'staff', 'technician', 'kamnan')
      AND municipality_id = get_my_municipality_id()
      AND (
        created_by = auth.uid()
        OR public.can_manage_event_department(municipality_id, department_id)
      )
    )
  )
  WITH CHECK (
    get_my_role() = 'superadmin'
    OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
    OR (
      get_my_role() IN ('viewer', 'council', 'officer', 'staff', 'technician', 'kamnan')
      AND municipality_id = get_my_municipality_id()
      AND (
        created_by = auth.uid()
        OR public.can_manage_event_department(municipality_id, department_id)
      )
    )
  );

CREATE POLICY "staff delete events" ON public.events
  FOR DELETE
  USING (
    get_my_role() = 'superadmin'
    OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
    OR (
      get_my_role() IN ('viewer', 'council', 'officer', 'staff', 'technician', 'kamnan')
      AND municipality_id = get_my_municipality_id()
      AND (
        created_by = auth.uid()
        OR public.can_manage_event_department(municipality_id, department_id)
      )
    )
  );

DROP POLICY IF EXISTS "allow staff upload event attachments" ON storage.objects;
CREATE POLICY "allow staff upload event attachments"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'event-attachments'
    AND (
      get_my_role() = 'superadmin'
      OR (
        get_my_role() IN ('admin', 'viewer', 'council', 'officer', 'staff', 'technician', 'kamnan')
        AND (storage.foldername(name))[1] = get_my_municipality_id()::text
        AND (
          get_my_role() = 'admin'
          OR (storage.foldername(name))[2] = auth.uid()::text
        )
      )
    )
  );

DROP POLICY IF EXISTS "allow staff delete event attachments" ON storage.objects;
CREATE POLICY "allow staff delete event attachments"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'event-attachments'
    AND (
      get_my_role() = 'superadmin'
      OR (
        get_my_role() IN ('admin', 'viewer', 'council', 'officer', 'staff', 'technician', 'kamnan')
        AND (storage.foldername(name))[1] = get_my_municipality_id()::text
        AND (
          get_my_role() = 'admin'
          OR (storage.foldername(name))[2] = auth.uid()::text
        )
      )
    )
  );

COMMIT;