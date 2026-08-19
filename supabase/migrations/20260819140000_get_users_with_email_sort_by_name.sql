-- Fix: get_users_with_email() hardcoded ORDER BY p.created_at DESC. AdminDashboard.jsx's
-- "จัดการผู้ใช้และการแต่งตั้ง" list header lets the user click "ชื่อ-นามสกุล" to sort, but that
-- only re-sorts the CURRENT PAGE's already-fetched 50 rows client-side — pagination itself
-- still comes from the server in created_at order, so page 2 is not an alphabetical
-- continuation of page 1. Since name is the natural default browsing order for a user list
-- (not "most recently created"), sort server-side by full_name so it's correct across pages.
--
-- Also groups Thai names before Latin/English names (checked live: without this, the
-- database's default collation interleaves them by raw codepoint rather than putting the
-- ก-๙ script group first, which reads oddly for a Thai government user list where most
-- names are Thai and a handful are romanized).

CREATE OR REPLACE FUNCTION public.get_users_with_email(
  p_municipality_id uuid DEFAULT NULL,
  p_roles text[] DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT NULL,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, email text, full_name text, role text, municipality_id uuid, municipality_name text,
  phone text, id_card text, job_title text, address text, address_province text, address_district text,
  address_subdistrict text, address_moo text, address_detail text, avatar_url text, providers text[],
  last_sign_in_at timestamptz, created_at timestamptz, staff_id uuid, staff_name text, staff_title text,
  department_id uuid, department_name text, is_dept_head boolean, position_id uuid, position_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_muni uuid;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT p.role, p.municipality_id INTO v_role, v_muni
  FROM public.profiles p WHERE p.id = auth.uid();

  IF v_role IS NULL OR v_role NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF p_municipality_id IS NULL THEN
    RAISE EXCEPTION 'Municipality is required';
  END IF;
  IF v_role = 'admin' AND p_municipality_id IS DISTINCT FROM v_muni THEN
    RAISE EXCEPTION 'Permission denied: municipality mismatch';
  END IF;

  RETURN QUERY
  SELECT
    p.id, COALESCE(NULLIF(p.email, ''), u.email), p.full_name, p.role,
    p.municipality_id, m.name, p.phone, p.id_card, p.job_title, p.address,
    p.address_province, p.address_district, p.address_subdistrict,
    p.address_moo, p.address_detail, p.avatar_url,
    ARRAY(SELECT DISTINCT i.provider FROM auth.identities i WHERE i.user_id = p.id),
    u.last_sign_in_at, p.created_at,
    s.id, s.name, s.title, p.department_id, dep.name, p.is_dept_head,
    p.position_id, pos.name
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  LEFT JOIN public.municipalities m ON m.id = p.municipality_id
  LEFT JOIN public.staff s ON s.id = p.staff_id
  LEFT JOIN public.departments dep ON dep.id = p.department_id
  LEFT JOIN public.positions pos ON pos.id = p.position_id
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
  ORDER BY (p.full_name !~ '^[ก-๙]') ASC, p.full_name ASC NULLS LAST, p.created_at DESC
  LIMIT v_limit
  OFFSET v_offset;
END;
$$;
