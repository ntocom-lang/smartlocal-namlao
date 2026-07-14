-- SmartLocal 117: fix "column reference is ambiguous" in get_users_with_email
-- ปัญหา: RETURNS TABLE มี column ชื่อ role, municipality_id, id ซึ่งชนกับ
--        column name ใน profiles ทำให้ PostgreSQL throw "ambiguous"
-- แก้: ใส่ table alias p. ใน DECLARE SELECT

CREATE OR REPLACE FUNCTION public.get_users_with_email(p_municipality_id uuid DEFAULT NULL)
RETURNS TABLE (
  id                uuid,
  email             text,
  full_name         text,
  role              text,
  municipality_id   uuid,
  municipality_name text,
  phone             text,
  id_card           text,
  job_title         text,
  address           text,
  avatar_url        text,
  providers         text[],
  last_sign_in_at   timestamptz,
  created_at        timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_muni uuid;
BEGIN
  -- ใส่ alias p เพื่อหลีกเลี่ยง ambiguous กับ column ใน RETURNS TABLE
  SELECT p.role, p.municipality_id INTO v_role, v_muni
  FROM public.profiles p WHERE p.id = auth.uid();

  -- เฉพาะ admin / superadmin / officer เท่านั้น
  IF v_role NOT IN ('admin', 'superadmin', 'officer') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  -- admin/officer ต้องเรียกเฉพาะ municipality ตัวเอง
  IF v_role IN ('admin', 'officer') AND p_municipality_id IS DISTINCT FROM v_muni THEN
    RAISE EXCEPTION 'Permission denied: municipality mismatch';
  END IF;

  RETURN QUERY
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
    p.avatar_url,
    ARRAY(
      SELECT DISTINCT i.provider
      FROM auth.identities i WHERE i.user_id = p.id
    ) AS providers,
    u.last_sign_in_at,
    p.created_at
  FROM public.profiles p
  LEFT JOIN auth.users        u ON u.id = p.id
  LEFT JOIN public.municipalities m ON m.id = p.municipality_id
  WHERE
    (p_municipality_id IS NULL AND v_role = 'superadmin')
    OR p.municipality_id = p_municipality_id
    OR (
      p_municipality_id IS NOT NULL
      AND p.municipality_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.complaints c
        WHERE c.user_id = p.id AND c.municipality_id = p_municipality_id
      )
    )
  ORDER BY p.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_users_with_email(uuid) TO authenticated;
