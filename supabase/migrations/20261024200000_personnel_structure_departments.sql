-- จัดโครงสร้างบุคลากรตามกอง: ตำแหน่งผูกกองจริง, รายชื่อกรองก่อน pagination,
-- ตัวนับรายกองมาจากฐานข้อมูลทั้งชุด และบันทึกประวัติการแต่งตั้งโดยไม่เก็บ PII ซ้ำใน metadata

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'positions' AND column_name = 'department_id'
  ) THEN
    RAISE EXCEPTION 'Apply 20261024195900_positions_department_column first';
  END IF;
END;
$$;

-- ผูกเฉพาะชื่อที่ตรงกันเพียงกองเดียว และบุคลากรเดิมทุกคนสังกัดกองนั้นอยู่แล้ว
-- ไม่ย้ายบุคลากรเดิมจากข้อความ hint เพราะสังกัดกระทบขอบเขตงาน/สิทธิ์ที่เห็น
WITH exact_matches AS (
  SELECT
    p.id AS position_id,
    d.id AS department_id,
    d.name AS department_name,
    count(*) OVER (PARTITION BY p.id) AS match_count
  FROM public.positions p
  JOIN public.departments d
    ON d.municipality_id = p.municipality_id
   AND (
     lower(btrim(d.name)) = lower(btrim(p.department_hint))
     OR lower(btrim(COALESCE(d.short_name, ''))) = lower(btrim(p.department_hint))
   )
  WHERE p.department_id IS NULL
    AND NULLIF(btrim(p.department_hint), '') IS NOT NULL
)
UPDATE public.positions p
SET department_id = matched.department_id,
    department_hint = matched.department_name
FROM exact_matches matched
WHERE p.id = matched.position_id
  AND matched.match_count = 1
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles holder
    WHERE holder.position_id = p.id
      AND (holder.municipality_id IS DISTINCT FROM p.municipality_id
        OR holder.department_id IS DISTINCT FROM matched.department_id)
  );

CREATE OR REPLACE FUNCTION public.guard_position_department()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_department public.departments%ROWTYPE;
  v_match_count integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.position_id = OLD.id) THEN
      RAISE EXCEPTION 'Cannot delete a position while personnel hold it';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.department_id IS DISTINCT FROM NEW.department_id
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.position_id = OLD.id)
  THEN
    RAISE EXCEPTION 'Cannot change department while personnel hold this position';
  END IF;
  IF NEW.department_id IS NULL THEN
    -- รองรับ import_default_positions รุ่นเดิมที่ยังส่ง department_hint มาเป็นข้อความ:
    -- ผูก FK เฉพาะชื่อเต็ม/ชื่อย่อที่ตรงกัน exact เท่านั้น ไม่เดาจากคำบางส่วน
    IF NULLIF(btrim(NEW.department_hint), '') IS NOT NULL THEN
      SELECT count(*) INTO v_match_count
      FROM public.departments d
      WHERE d.municipality_id = NEW.municipality_id
        AND (lower(btrim(d.name)) = lower(btrim(NEW.department_hint))
          OR lower(btrim(COALESCE(d.short_name, ''))) = lower(btrim(NEW.department_hint)));
      IF v_match_count <> 1 THEN
        RETURN NEW;
      END IF;
      SELECT * INTO v_department
      FROM public.departments d
      WHERE d.municipality_id = NEW.municipality_id
        AND (
          lower(btrim(d.name)) = lower(btrim(NEW.department_hint))
          OR lower(btrim(COALESCE(d.short_name, ''))) = lower(btrim(NEW.department_hint))
        )
      ORDER BY d.sort_order, d.id
      LIMIT 1;

      IF FOUND THEN
        IF EXISTS (
          SELECT 1 FROM public.profiles p WHERE p.position_id = NEW.id
            AND (p.municipality_id IS DISTINCT FROM NEW.municipality_id
              OR p.department_id IS DISTINCT FROM v_department.id)
        ) THEN
          RETURN NEW;
        END IF;
        NEW.department_id := v_department.id;
        NEW.department_hint := v_department.name;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO v_department
  FROM public.departments d
  WHERE d.id = NEW.department_id;

  IF NOT FOUND OR v_department.municipality_id IS DISTINCT FROM NEW.municipality_id THEN
    RAISE EXCEPTION 'Department does not belong to the position municipality';
  END IF;

  -- คง department_hint ไว้ให้ client รุ่นเก่าอ่านได้ระหว่าง rollout แต่แหล่งจริงคือ FK
  NEW.department_hint := v_department.name;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_position_department ON public.positions;
CREATE TRIGGER trg_guard_position_department
BEFORE INSERT OR DELETE OR UPDATE OF municipality_id, department_id ON public.positions
FOR EACH ROW EXECUTE FUNCTION public.guard_position_department();

REVOKE EXECUTE ON FUNCTION public.guard_position_department() FROM PUBLIC, anon, authenticated;

-- ไม่ UPDATE profiles ระหว่าง migration: เจ้าของระบบต้องตรวจและยืนยันการแต่งตั้งเป็นรายบุคคล

CREATE OR REPLACE FUNCTION public.sync_profile_department_from_position()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_position_municipality uuid;
  v_position_department uuid;
BEGIN
  IF NEW.position_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.municipality_id, p.department_id
    INTO v_position_municipality, v_position_department
  FROM public.positions p
  WHERE p.id = NEW.position_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Position not found';
  END IF;
  IF v_position_municipality IS DISTINCT FROM NEW.municipality_id THEN
    RAISE EXCEPTION 'Position does not belong to the selected municipality';
  END IF;

  -- ตำแหน่งที่ผูกกองชัดเจนเป็น rule ที่ตั้งครั้งเดียว ส่วนตำแหน่งส่วนกลางยังให้คนเลือกกองได้
  IF v_position_department IS NOT NULL THEN
    NEW.department_id := v_position_department;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.department_id IS DISTINCT FROM OLD.department_id THEN
    NEW.is_dept_head := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_position_department_sync ON public.profiles;
CREATE TRIGGER trg_profile_position_department_sync
BEFORE INSERT OR UPDATE OF municipality_id, department_id, position_id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_profile_department_from_position();

REVOKE EXECUTE ON FUNCTION public.sync_profile_department_from_position() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_staff_department_counts(p_municipality_id uuid)
RETURNS TABLE (department_id uuid, staff_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_municipality_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT p.role, p.municipality_id INTO v_role, v_municipality_id
  FROM public.profiles p WHERE p.id = auth.uid();

  IF p_municipality_id IS NULL THEN
    RAISE EXCEPTION 'Municipality is required';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'superadmin')
     OR (v_role = 'admin' AND p_municipality_id IS DISTINCT FROM v_municipality_id)
  THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  RETURN QUERY
  SELECT p.department_id, count(*)::bigint
  FROM public.profiles p
  WHERE (
      p.municipality_id = p_municipality_id
      OR (p.municipality_id IS NULL AND public.profile_linked_to_municipality(p.id, p_municipality_id))
    )
    AND p.role IN ('staff', 'officer', 'technician', 'admin', 'superadmin', 'council', 'viewer')
  GROUP BY p.department_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_staff_department_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_staff_department_counts(uuid) TO authenticated;

-- ค้นหาบัญชีเพื่อแต่งตั้งโดยคืนเฉพาะข้อมูลที่ dialog ใช้ ไม่ส่งเลขบัตรหรือที่อยู่มาที่ browser
-- และตัดสิทธิ์เลือกตนเอง/superadmin ตั้งแต่ฝั่งฐานข้อมูล
CREATE OR REPLACE FUNCTION public.search_users_for_staff_assignment(
  p_municipality_id uuid,
  p_search text,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  email text,
  full_name text,
  role text,
  municipality_id uuid,
  phone text,
  department_id uuid,
  department_name text,
  is_dept_head boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_municipality_id uuid;
  v_query text := btrim(COALESCE(p_search, ''));
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 20);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT p.role, p.municipality_id INTO v_role, v_municipality_id
  FROM public.profiles p WHERE p.id = auth.uid();

  IF p_municipality_id IS NULL THEN
    RAISE EXCEPTION 'Municipality is required';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'superadmin')
     OR (v_role = 'admin' AND p_municipality_id IS DISTINCT FROM v_municipality_id)
  THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF length(v_query) < 2 THEN
    RAISE EXCEPTION 'Search requires at least 2 characters';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    COALESCE(NULLIF(p.email, ''), u.email),
    p.full_name,
    p.role,
    p.municipality_id,
    p.phone,
    p.department_id,
    d.name,
    p.is_dept_head
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  LEFT JOIN public.departments d ON d.id = p.department_id
  WHERE p.id <> auth.uid()
    AND (
      p.municipality_id = p_municipality_id
      OR (p.municipality_id IS NULL AND public.profile_linked_to_municipality(p.id, p_municipality_id))
    )
    AND p.role IN ('citizen', 'staff', 'officer', 'technician', 'viewer', 'council', 'admin')
    AND (v_role = 'superadmin' OR p.role <> 'admin')
    AND (
      p.full_name ILIKE '%' || v_query || '%'
      OR COALESCE(NULLIF(p.email, ''), u.email) ILIKE '%' || v_query || '%'
      OR p.phone ILIKE '%' || v_query || '%'
    )
  ORDER BY
    (COALESCE(p.full_name, '') !~ '^[ก-๙]') ASC,
    lower(p.full_name) ASC NULLS LAST,
    p.created_at DESC,
    p.id ASC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.search_users_for_staff_assignment(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_users_for_staff_assignment(uuid, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_users_with_email_sorted_filtered(
  p_municipality_id uuid,
  p_roles text[],
  p_search text,
  p_department_id uuid,
  p_without_department boolean,
  p_limit integer,
  p_offset integer,
  p_sort_key text,
  p_sort_direction text
)
RETURNS TABLE (
  id uuid, email text, full_name text, role text, municipality_id uuid, municipality_name text,
  phone text, id_card text, job_title text, address text, address_province text, address_district text,
  address_subdistrict text, address_moo text, address_detail text, avatar_url text, providers text[],
  last_sign_in_at timestamptz, created_at timestamptz, staff_id uuid, staff_name text, staff_title text,
  department_id uuid, department_name text, is_dept_head boolean, position_id uuid, position_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_municipality_id uuid;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_sort_key text := COALESCE(NULLIF(lower(btrim(p_sort_key)), ''), 'full_name');
  v_sort_direction text := COALESCE(NULLIF(lower(btrim(p_sort_direction)), ''), 'asc');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT p.role, p.municipality_id INTO v_role, v_municipality_id
  FROM public.profiles p WHERE p.id = auth.uid();

  IF p_municipality_id IS NULL THEN
    RAISE EXCEPTION 'Municipality is required';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'superadmin')
     OR (v_role = 'admin' AND p_municipality_id IS DISTINCT FROM v_municipality_id)
  THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF v_sort_key NOT IN ('created_at', 'full_name', 'email', 'providers', 'role', 'assignment')
     OR v_sort_direction NOT IN ('asc', 'desc')
  THEN
    RAISE EXCEPTION 'Invalid sort';
  END IF;
  IF COALESCE(p_without_department, false) AND p_department_id IS NOT NULL THEN
    RAISE EXCEPTION 'Department filters are mutually exclusive';
  END IF;
  IF p_department_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.departments d
    WHERE d.id = p_department_id AND d.municipality_id = p_municipality_id
  ) THEN
    RAISE EXCEPTION 'Department does not belong to the selected municipality';
  END IF;

  RETURN QUERY
  WITH user_rows AS (
    SELECT
      p.id,
      COALESCE(NULLIF(p.email, ''), u.email) AS email,
      p.full_name,
      p.role,
      p.municipality_id,
      m.name AS municipality_name,
      p.phone,
      p.id_card,
      p.job_title,
      p.address,
      p.address_province,
      p.address_district,
      p.address_subdistrict,
      p.address_moo,
      p.address_detail,
      p.avatar_url,
      identity_data.providers,
      u.last_sign_in_at,
      p.created_at,
      s.id AS staff_id,
      s.name AS staff_name,
      s.title AS staff_title,
      p.department_id,
      dep.name AS department_name,
      p.is_dept_head,
      p.position_id,
      pos.name AS position_name,
      CASE p.role
        WHEN 'superadmin' THEN 'Super Admin'
        WHEN 'admin' THEN 'แอดมินระบบ'
        WHEN 'officer' THEN 'หัวหน้ากอง'
        WHEN 'technician' THEN 'ปฏิบัติงาน'
        WHEN 'staff' THEN 'เจ้าหน้าที่'
        WHEN 'viewer' THEN 'ผู้บริหาร'
        WHEN 'council' THEN 'สมาชิกสภา'
        WHEN 'citizen' THEN 'ประชาชน'
        ELSE COALESCE(p.role, '')
      END AS role_sort,
      concat_ws(' ',
        CASE WHEN 'google' = ANY(identity_data.providers) THEN 'Google' END,
        CASE WHEN 'custom:line' = ANY(identity_data.providers) THEN 'LINE' END,
        CASE
          WHEN COALESCE(NULLIF(p.email, ''), u.email) ILIKE '%@phone.smartlocal.app'
            AND 'email' = ANY(identity_data.providers) THEN 'เบอร์โทร'
        END,
        CASE
          WHEN COALESCE(NULLIF(p.email, ''), u.email) NOT ILIKE '%@phone.smartlocal.app'
            AND 'email' = ANY(identity_data.providers) THEN 'อีเมล/รหัสผ่าน'
        END,
        CASE WHEN cardinality(identity_data.providers) = 0 THEN 'ไม่พบข้อมูล' END
      ) AS provider_sort,
      COALESCE(dep.name, 'ไม่ระบุกอง') || ' ' || COALESCE(pos.name, 'ไม่ระบุตำแหน่งในทำเนียบ') AS assignment_sort
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    LEFT JOIN public.municipalities m ON m.id = p.municipality_id
    LEFT JOIN public.staff s ON s.id = p.staff_id
    LEFT JOIN public.departments dep ON dep.id = p.department_id
    LEFT JOIN public.positions pos ON pos.id = p.position_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(array_agg(DISTINCT i.provider ORDER BY i.provider), ARRAY[]::text[]) AS providers
      FROM auth.identities i WHERE i.user_id = p.id
    ) identity_data ON true
    WHERE (
        p.municipality_id = p_municipality_id
        OR (p.municipality_id IS NULL AND public.profile_linked_to_municipality(p.id, p_municipality_id))
      )
      AND (p_roles IS NULL OR p.role = ANY(p_roles))
      AND (p_department_id IS NULL OR p.department_id = p_department_id)
      AND (NOT COALESCE(p_without_department, false) OR p.department_id IS NULL)
      AND (
        p_search IS NULL OR btrim(p_search) = ''
        OR p.full_name ILIKE '%' || btrim(p_search) || '%'
        OR COALESCE(NULLIF(p.email, ''), u.email) ILIKE '%' || btrim(p_search) || '%'
        OR p.phone ILIKE '%' || btrim(p_search) || '%'
        OR p.id_card ILIKE '%' || btrim(p_search) || '%'
        OR pos.name ILIKE '%' || btrim(p_search) || '%'
      )
  )
  SELECT
    r.id, r.email, r.full_name, r.role, r.municipality_id, r.municipality_name,
    r.phone, r.id_card, r.job_title, r.address, r.address_province, r.address_district,
    r.address_subdistrict, r.address_moo, r.address_detail, r.avatar_url, r.providers,
    r.last_sign_in_at, r.created_at, r.staff_id, r.staff_name, r.staff_title,
    r.department_id, r.department_name, r.is_dept_head, r.position_id, r.position_name
  FROM user_rows r
  ORDER BY
    CASE WHEN v_sort_key = 'full_name' THEN (COALESCE(r.full_name, '') !~ '^[ก-๙]') END ASC,
    CASE WHEN v_sort_key = 'created_at' AND v_sort_direction = 'asc' THEN r.created_at END ASC NULLS LAST,
    CASE WHEN v_sort_key = 'created_at' AND v_sort_direction = 'desc' THEN r.created_at END DESC NULLS LAST,
    CASE WHEN v_sort_key = 'full_name' AND v_sort_direction = 'asc' THEN lower(r.full_name) END ASC NULLS LAST,
    CASE WHEN v_sort_key = 'full_name' AND v_sort_direction = 'desc' THEN lower(r.full_name) END DESC NULLS LAST,
    CASE WHEN v_sort_key = 'email' AND v_sort_direction = 'asc' THEN lower(COALESCE(r.email, 'ยังไม่ระบุ')) END ASC,
    CASE WHEN v_sort_key = 'email' AND v_sort_direction = 'desc' THEN lower(COALESCE(r.email, 'ยังไม่ระบุ')) END DESC,
    CASE WHEN v_sort_key = 'providers' AND v_sort_direction = 'asc' THEN lower(r.provider_sort) END ASC,
    CASE WHEN v_sort_key = 'providers' AND v_sort_direction = 'desc' THEN lower(r.provider_sort) END DESC,
    CASE WHEN v_sort_key = 'role' AND v_sort_direction = 'asc' THEN lower(r.role_sort) END ASC,
    CASE WHEN v_sort_key = 'role' AND v_sort_direction = 'desc' THEN lower(r.role_sort) END DESC,
    CASE WHEN v_sort_key = 'assignment' AND v_sort_direction = 'asc' THEN lower(r.assignment_sort) END ASC,
    CASE WHEN v_sort_key = 'assignment' AND v_sort_direction = 'desc' THEN lower(r.assignment_sort) END DESC,
    (COALESCE(r.full_name, '') !~ '^[ก-๙]') ASC,
    lower(r.full_name) ASC NULLS LAST,
    r.created_at DESC,
    r.id ASC
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_users_with_email_sorted_filtered(uuid, text[], text, uuid, boolean, integer, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_users_with_email_sorted_filtered(uuid, text[], text, uuid, boolean, integer, integer, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
