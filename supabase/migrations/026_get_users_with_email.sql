-- =====================================================
-- SmartLocal 026: Function ดึงรายชื่อผู้ใช้พร้อม email
-- ใช้ SECURITY DEFINER เพื่อเข้าถึง auth.users
-- =====================================================

DROP FUNCTION IF EXISTS get_users_with_email(uuid);

CREATE OR REPLACE FUNCTION public.get_users_with_email(p_municipality_id uuid DEFAULT NULL)
RETURNS TABLE (
  id             uuid,
  email          text,
  full_name      text,
  role           text,
  municipality_id uuid,
  phone          text,
  created_at     timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    COALESCE(NULLIF(p.email, ''), u.email) AS email,
    p.full_name,
    p.role,
    p.municipality_id,
    p.phone,
    p.created_at
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  WHERE
    CASE
      WHEN get_my_role() = 'superadmin' THEN true
      ELSE p.municipality_id = p_municipality_id
    END
  ORDER BY p.created_at DESC;
END;
$$;
