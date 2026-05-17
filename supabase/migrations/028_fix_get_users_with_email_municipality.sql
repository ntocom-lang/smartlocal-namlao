-- =====================================================
-- SmartLocal 028: Fix get_users_with_email
-- 1. เพิ่ม municipality_name ใน return
-- 2. แก้ bug: superadmin เห็น users ทุก municipality
--    → ถ้าส่ง p_municipality_id มา ให้ filter เสมอ
-- =====================================================

DROP FUNCTION IF EXISTS get_users_with_email(uuid);

CREATE OR REPLACE FUNCTION public.get_users_with_email(p_municipality_id uuid DEFAULT NULL)
RETURNS TABLE (
  id                uuid,
  email             text,
  full_name         text,
  role              text,
  municipality_id   uuid,
  municipality_name text,
  phone             text,
  created_at        timestamptz
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
    m.name AS municipality_name,
    p.phone,
    p.created_at
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  LEFT JOIN public.municipalities m ON m.id = p.municipality_id
  WHERE
    (p_municipality_id IS NULL AND get_my_role() = 'superadmin')
    OR p.municipality_id = p_municipality_id
    OR (
      p_municipality_id IS NOT NULL
      AND p.municipality_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.complaints c
        WHERE c.user_id = p.id
          AND c.municipality_id = p_municipality_id
      )
    )
  ORDER BY p.created_at DESC;
END;
$$;
