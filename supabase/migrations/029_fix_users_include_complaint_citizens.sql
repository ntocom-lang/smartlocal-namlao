-- =====================================================
-- SmartLocal 029: Fix get_users_with_email ให้รวม citizens
-- ที่ยื่นคำร้องกับ municipality แต่ profile.municipality_id ยัง NULL
-- (เกิดจาก trigger ไม่ได้ set municipality_id ตอนสมัคร)
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
    -- superadmin ไม่ระบุ municipality → ดูทั้งหมด
    (p_municipality_id IS NULL AND get_my_role() = 'superadmin')
    -- profile ถูก assign ไว้แล้ว
    OR p.municipality_id = p_municipality_id
    -- citizens ที่สมัครแล้วยื่นคำร้องกับ municipality นี้
    -- แต่ profile.municipality_id ยัง NULL (trigger ไม่ได้เซ็ต)
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
