-- หน้า "จัดการผู้ใช้และการแต่งตั้ง" ต้องเรียงข้อมูลทั้งชุดก่อน LIMIT/OFFSET ไม่ใช่
-- เรียงซ้ำเฉพาะรายการในหน้าปัจจุบัน มิฉะนั้นหน้าถัดไปจะไม่ต่อเนื่องกัน
-- แยกเป็น RPC ใหม่เพื่อให้ frontend fallback ไป function เดิมได้ระหว่าง deploy แบบ DB-first

CREATE OR REPLACE FUNCTION public.get_users_with_email_sorted(
  p_municipality_id uuid,
  p_roles text[],
  p_search text,
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
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_muni uuid;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_sort_key text := COALESCE(NULLIF(lower(btrim(p_sort_key)), ''), 'full_name');
  v_sort_direction text := COALESCE(NULLIF(lower(btrim(p_sort_direction)), ''), 'asc');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT p.role, p.municipality_id INTO v_role, v_muni
  FROM public.profiles p
  WHERE p.id = auth.uid();

  IF v_role IS NULL OR v_role NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF p_municipality_id IS NULL THEN
    RAISE EXCEPTION 'Municipality is required';
  END IF;
  IF v_role = 'admin' AND p_municipality_id IS DISTINCT FROM v_muni THEN
    RAISE EXCEPTION 'Permission denied: municipality mismatch';
  END IF;
  IF v_sort_key NOT IN ('created_at', 'full_name', 'email', 'providers', 'role', 'assignment') THEN
    RAISE EXCEPTION 'Invalid sort key';
  END IF;
  IF v_sort_direction NOT IN ('asc', 'desc') THEN
    RAISE EXCEPTION 'Invalid sort direction';
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
        WHEN 'council' THEN 'สภาเทศบาล'
        WHEN 'citizen' THEN 'ประชาชน'
        ELSE COALESCE(p.role, '')
      END AS role_sort,
      concat_ws(' ',
        CASE WHEN 'google' = ANY(identity_data.providers) THEN 'Google' END,
        CASE WHEN 'custom:line' = ANY(identity_data.providers) THEN 'LINE' END,
        CASE
          WHEN COALESCE(NULLIF(p.email, ''), u.email) ILIKE '%@phone.smartlocal.app'
            AND 'email' = ANY(identity_data.providers)
          THEN 'เบอร์โทร'
        END,
        CASE
          WHEN COALESCE(NULLIF(p.email, ''), u.email) NOT ILIKE '%@phone.smartlocal.app'
            AND 'email' = ANY(identity_data.providers)
          THEN 'อีเมล/รหัสผ่าน'
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
      FROM auth.identities i
      WHERE i.user_id = p.id
    ) identity_data ON true
    WHERE (
        p.municipality_id = p_municipality_id
        OR (
          p.municipality_id IS NULL
          AND public.profile_linked_to_municipality(p.id, p_municipality_id)
        )
      )
      AND (p_roles IS NULL OR p.role = ANY(p_roles))
      AND (
        p_search IS NULL OR btrim(p_search) = ''
        OR p.full_name ILIKE '%' || btrim(p_search) || '%'
        OR COALESCE(NULLIF(p.email, ''), u.email) ILIKE '%' || btrim(p_search) || '%'
        OR p.phone ILIKE '%' || btrim(p_search) || '%'
        OR p.id_card ILIKE '%' || btrim(p_search) || '%'
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
    -- รายชื่อภาษาไทยอยู่ก่อนรายชื่ออักษรละตินเหมือนรายการเดิม ไม่ว่ากำลังเรียงขึ้นหรือลง
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
  LIMIT v_limit
  OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_users_with_email_sorted(uuid, text[], text, integer, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_users_with_email_sorted(uuid, text[], text, integer, integer, text, text) TO authenticated;

COMMENT ON FUNCTION public.get_users_with_email_sorted(uuid, text[], text, integer, integer, text, text)
IS 'Tenant-safe paginated user list with validated server-side sorting for Admin User Management.';
