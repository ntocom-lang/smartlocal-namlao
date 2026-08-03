-- ทำเนียบผู้ดำรงตำแหน่งที่เปิดเผยต่อประชาชนสำหรับ Chatbot
-- คืนเฉพาะชื่อและตำแหน่งราชการ ไม่คืนข้อมูลบัญชี เบอร์โทร อีเมล หรือสิทธิ์ระบบ

CREATE OR REPLACE FUNCTION public.get_public_official_directory(p_municipality_id uuid)
RETURNS TABLE (
  full_name text,
  position_name text,
  position_category text,
  sort_order integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    btrim(profile.full_name) AS full_name,
    position.name AS position_name,
    position.category AS position_category,
    position.sort_order
  FROM public.profiles AS profile
  JOIN public.positions AS position ON position.id = profile.position_id
  WHERE profile.municipality_id = p_municipality_id
    AND NULLIF(btrim(profile.full_name), '') IS NOT NULL
    AND position.category IN ('political_exec', 'council', 'top_admin', 'dept_head')
  ORDER BY position.sort_order, profile.full_name;
$$;

REVOKE ALL ON FUNCTION public.get_public_official_directory(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_official_directory(uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.get_public_official_directory(uuid) IS
  'Public official directory: exposes only official full name and appointed position for deterministic in-app answers.';
